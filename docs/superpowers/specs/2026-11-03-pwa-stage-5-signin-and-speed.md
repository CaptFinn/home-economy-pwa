# PWA stage 5 — Stay signed in, and feel fast

Two months of daily use produced a seven-item list (2026-11-03). It is
split into four specs, each shipped on its own:

| Spec | Items | Content |
|---|---|---|
| **A — this one** | 2, 7 | Stop the constant sign-in; make the app feel fast |
| B | 4, 1 | Edit a bill's amount and due date in place; per-cut-off shared total |
| C1 | 5 | Connect a bill to a ledger and account; **tick deposits, Mark paid deducts** |
| C2 | 3, 6 | Ledger and per-account dashboards; monthly spending across all ledgers |

B, C1 and C2 get their own specs when their turn comes. Decisions already
taken for them are recorded in §9 so they are not lost.

## 1. Why this is needed

**Sign-in.** A Google ID token lives about an hour. The only renewal is
`refresh()` in `app/auth.js`, a silent One Tap `prompt()`, and Google
decides whether that shows: on phones and installed PWAs it is routinely
skipped (FedCM). When it is skipped, `sync()` falls back to the stored
token, which dies at the hour; the server answers `kind: 'auth'`; the
status line turns to "sign in again". *This diagnosis comes from reading
the code and Google's documented token lifetime, not from reproducing it
on a phone; hand check 1 confirms it.*

**Speed.** Reading `sync()` and the Bills handlers turned up four causes,
in the order a tap pays for them:

1. `sync()` awaits `refresh()` before sending anything: up to 4 s
   (`REFRESH_TIMEOUT_MS`) when Google stays silent.
2. A tap made while a sync is running is not sent: `if (syncing) return`.
   `drain` reads the queue once at the start, so the item waits for the
   retry timer, whose minimum is 5 s (`RETRY_MIN_MS`).
3. After every drain, `sync()` refetches `bootstrap`, and with the Bills tab
   open, the bills view: three Apps Script round trips for one tick. The
   server already answers a tick with the whole updated cycle view
   (`setBillFunded` and `setBillNotes` return `billsView_`); the client
   throws that away.
4. The tick shows "pending" until all of the above finish, so the delay is
   visible on the checkbox itself.

## 2. What changes

| | Before | After |
|---|---|---|
| Token the app sends | Google ID token, ~1 h | **Server session token, 30 days**, minted after one Google sign-in |
| Silent refresh | `refresh()` before each sync | **Removed** |
| Sign-in prompts | about hourly | **about monthly** |
| A tap during a running sync | waits ≥ 5 s for the retry | **Sent as soon as the run ends** |
| After a tick or note | 3 round trips | **1** (the reply is used) |
| Bills "pending" mark | always while queued | **Only when stuck** (offline, error, signed out) |
| Server | — | **New `session` op; session tokens accepted** |

Not a goal: making Apps Script itself faster. A call takes roughly 1–3 s
and still will; the change is that nothing waits on one, and the screen
no longer shows the wait.

## 3. Session token (server, `Api.gs`)

### 3.1 Format

`s1.<payload>.<signature>`:

- `payload` is base64url of `{"email": "<lower-case>", "exp": <unix seconds>}`.
  Same field names as a Google token's payload on purpose, so the client's
  existing `emailFromToken` reads either kind.
- `signature` is base64url of HMAC-SHA256 over the literal string
  `s1.<payload>`, keyed by the Script Property `SESSION_SECRET`.
- A Google ID token always starts `eyJ`, so the `s1.` prefix cannot clash.
- Lifetime is the constant `SESSION_DAYS_ = 30`. Fixed, not sliding: one
  sign-in a month is the goal, and a sliding window means a stolen token
  never dies. *ponytail: sliding renewal if monthly proves annoying.*

### 3.2 `verifyEmail_`

A token starting `s1.` goes to a new `emailFromSession_(token, secret,
nowSec)` and **never** to Google: recompute the MAC, compare, check `exp`,
return the email or `''`. No `UrlFetch`, so it costs nothing and does not
touch the rate cap (`rateOk_`), which exists only to bound `tokeninfo`
calls. Any other token takes today's path unchanged. A missing
`SESSION_SECRET` makes every session token invalid.

`doPost`'s order stays: verify → `allowed_()` → handler. So removing an
address from `ALLOWED_EMAILS` revokes that person's sessions on their
next call, and rotating `SESSION_SECRET` ends every session.

### 3.3 The `session` op

`session: function () { … }` in `opHandler_` returns
`{ token, exp }` for `API_EMAIL_`. It must only work when the request was
authenticated by a **Google** token: if it accepted a session, a session
could renew itself forever. `doPost` sets a second per-execution global,
`API_VIA_SESSION_` (declared beside `API_EMAIL_`, with the same lifetime
reasoning and cleared in the same `finally`), and the handler refuses when
it is true. If `SESSION_SECRET` is not set, the op refuses with a
plain-language message. Both refusals use wording `kindOf_` already maps
to `'auth'` ("…sign in…").

## 4. Sign-in (client, `app/auth.js`)

`storeCredential(response)` becomes: call `session` with the Google
credential; on `ok`, store `{ email, token: <session token> }`; on
anything else (an old server answering "not something this app does", no
connection, a refusal), store the Google credential exactly as today.

- The session token goes in the existing `token` field, so **no call site
  changes**: every `auth.token` in `main.js` keeps working.
- `refresh()`, `REFRESH_TIMEOUT_MS` and the `signingIn` flag (which existed
  only to stop `refresh()` stealing `signIn()`'s callback) are deleted.
  `sync()` uses `currentAuth()` alone.
- `signIn()` is unchanged otherwise. When the server answers `auth`, the
  status line says "sign in again" and a tap renders Google's button, as now.
- **Order of deployment does not matter.** Client first: the `session` call
  fails harmlessly and the app behaves as today. Server first: nothing
  calls `session` yet. The monthly behaviour starts at the first sign-in
  after both are live.

## 5. Speed (client)

### 5.1 No wait before sending

Falls out of §4: nothing awaits a refresh.

### 5.2 A tap during a sync runs next

`sync()` sets an `again` flag instead of returning when `syncing` is true,
and runs once more when the current run ends. The retry timer stays as the
backstop for real failures, not as the way a second tap gets sent.

### 5.3 Use the reply

`drain` records each successful reply with its item (`counts.replies`).
In `sync()`:

- If **every** item sent in the run was a bill op (`BILL_OPS`), the
  `bootstrap` refetch is skipped: bill ops change no balance.
- For each cycle in the replies, the **last** reply wins (the server works
  through the queue in order, so each reply already includes the earlier
  ones). It is cached under `billsKey('cycle', cycle)`, and shown if that
  is the cycle on screen in cycle mode; then the bills refetch is skipped.
- Anything else (payday mode, another cycle on screen, any ledger op in
  the run, a failed or partial run) takes today's refetch path unchanged.
- Still-queued items keep being drawn over the cached view by
  `overlayQueued`, as now.
- A successful bill-only drain moves `conn.at`: the server accepted the
  work, which is the existing rule for stamping the clock.

*Not done:* ledger `addEntry` still refetches `bootstrap`, because its
reply does not carry balances. Revisit if it is the next slow thing.

### 5.4 Quiet "pending" on Bills

`renderBills` already knows `state.conn`. A queued tick or note shows its
"pending" label and `.pending` styling only when
`!conn.online || conn.needsAuth || conn.error`; otherwise it is drawn as
done. Parked items, the offline hint and the banner are untouched.

**The Ledger tab keeps its pending list and "includes pending" note.**
Those confirm that money you typed has not yet reached the sheet, which
is worth the visual cost. They get shorter because of §5.1–5.2 but are
not hidden. *Review point: say so if you want them quieted the same way.*

## 6. Failure and security

- **Offline** is unchanged: ticks queue and show the pending mark (§5.4's
  stuck case); nothing about sessions needs the network after sign-in.
- **Expired session / bad MAC / rotated secret:** the server answers
  `auth`, the queue stops with items kept, the status line says "sign in
  again": today's path.
- **Secret handling:** `SESSION_SECRET` lives only in Script Properties
  (random, 32+ characters), never in the repo or `config.js`. The token
  proves an email; every call still re-checks `allowed_()`.
- **MAC comparison** is plain string equality (Apps Script has no
  constant-time compare). *ponytail:* the MAC is keyed with a secret the
  caller never sees, and each guess costs a full Apps Script round trip
  (~1 s), which makes a timing attack impractical; revisit only if the
  endpoint ever moves off Apps Script.
- **Stolen phone:** the 30-day token is the new exposure (an hour before).
  Removing the address from `ALLOWED_EMAILS`, or rotating the secret,
  cuts it off at once.

## 7. Testing

- `selfcheck.js`: `drain` returns replies in order with their items; the
  bill-op test that decides when `bootstrap` is skipped (kept as a small
  pure function in `bills.js`); the "stuck" predicate for §5.4.
- `wiring.js` (fake DOM, fetch, google): sign-in calls `session` and
  stores the session token; falls back to the Google token when `session`
  answers a refusal, an old-server message or a network failure; a tick
  produces exactly one POST (no `bootstrap`, no `bills`); a tick during a
  running sync is sent right after, without the retry timer; the Bills
  box shows no "pending" while syncing online and does while offline;
  the old `refresh()` wiring checks are removed.
- Server `apiSelfCheck_` (run by the server's `check.sh`, which stubs
  Apps Script services — `Utilities` gains an HMAC/base64url stub on
  node's `crypto`): a signed token round-trips to its email; a flipped
  payload, a flipped signature, another secret, an expired `exp`, a
  missing secret and a Google-shaped token are each refused by
  `emailFromSession_`.

## 8. Hand checks (go into `docs/RUNBOOK.md`, "Stage 5")

1. **Confirms the diagnosis, before the server is deployed:** note the
   time you sign in; it asks again within about an hour.
2. After both sides are live, sign in once; leave the app untouched for
   over an hour; tick a bill. No sign-in prompt, and the tick lands.
3. The next day, open the app and tick. Still no prompt.
4. Stopwatch a tick on Wi-Fi and on mobile data: the box looks done
   instantly and nothing flickers back when the sync lands.
5. Tick two boxes in quick succession: both land, the second does not wait
   several seconds.
6. Airplane mode: a tick shows "pending" and the offline hint; reconnect
   and it clears.
7. Remove your address from `ALLOWED_EMAILS` (then restore it): the next
   call is refused with the access-list message.
8. A sign-in on an unmigrated server (the old version) still works for the
   hour, as today.

## 9. Decided for later specs

- **B:** the edit is in place on the Bills tab (click the amount or due
  date). An `editBill` op with the existing row guard (`rowMatches_`);
  online-only like Carry. The earlier "declined" decision (2026-09-24) is
  replaced by the request of 2026-11-03.
- **C1:** each bill stores a connected **ledger and account** (two columns
  at the end of Bill Tracker). A tick deposits that payer's installment;
  **Mark paid** (a separate action, online-only) deducts the full bill
  amount; each is posted by the server inside the same call, with a stable
  entry Id (bill, cycle, payday, payer) so it cannot double-post;
  un-ticking or un-marking voids the entry; disconnecting keeps entries
  already posted; carry and Start-cycle copy the connection.
- **C2:** dashboards read what C1 produces; built last.

## 10. Out of scope

- Moving off Apps Script, a service-worker data cache, or any build tool.
- Sliding session renewal; upgrading an existing Google token to a session
  without a fresh sign-in.
- Changing the access list mechanism or the Google client id.
- Quieting the Ledger tab's pending list (§5.4, review point).
