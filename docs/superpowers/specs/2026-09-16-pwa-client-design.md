# Home Economy PWA client — design

An installable web app for logging household money, hosted on GitHub Pages,
talking to the existing Apps Script project as an API. It runs with no signal:
the app opens, you log, and what you logged is sent when the phone has a
connection again.

The target is **full parity** with the Apps Script web app — ledger, bills,
editing, voiding, desktop layout. It is built in stages (§9), each usable on a
phone before the next begins. The Apps Script app keeps running untouched
throughout; the two are used side by side until parity is reached and Vin
decides to retire one.

Sibling project: `../Home_Economy_PWA` (the Apps Script app and the sheet it
owns). Its `CLAUDE.md`, `docs/spec.md` and the specs under
`docs/superpowers/specs/` describe the data model this client renders. Nothing
in this document changes that model except §4.2, which adds one column.

## 1. Why this exists

The Apps Script app cannot work offline and never will: its HTML is served
from `script.google.com` and rendered inside a sandboxed `googleusercontent`
iframe, so there is no origin we control and no way to register a service
worker. Logging a shop's worth of expenses today means typing them into a
notes app and re-entering them later — the step where amounts get mistyped.

That is the whole reason for a second front end. Everything else here follows
from wanting it to be correct, not from wanting it to be new.

## 2. Architecture

```
  phone (offline-capable)                 Google
  ┌────────────────────────────┐          ┌────────────────────────────┐
  │ PWA on GitHub Pages        │  POST    │ Apps Script project        │
  │  service worker (shell)    │ ───────► │  Api.gs   doPost  (new)    │
  │  IndexedDB: views + queue  │ ◄─────── │  Ledger.gs / Bills.gs      │
  │  Google Sign-In            │   JSON   │   (unchanged logic)        │
  └────────────────────────────┘          │  Code.gs  doGet   (the     │
                                          │   existing GAS UI)         │
                                          └──────────┬─────────────────┘
                                                     │
                                              Google Sheet (the books)
```

**The money math is not duplicated.** Balances, signed amounts, installments,
funding schedules, statuses, the fingerprint guard — all of it stays in
`Ledger.gs` and `Bills.gs`, where it is already written and tested. The client
renders what the server computes and never recomputes it.

The one exception, deliberate and small: the client adds the sum of its own
queued entries to a displayed balance, so a just-logged ₱890 is visible
immediately. That is one addition over the queue, not a second implementation
of any rule, and it is always labelled as pending (§7.3).

### 2.1 What the client is responsible for

Rendering, input validation for immediate feedback, the offline cache, the
write queue, and sign-in. Nothing else.

### 2.2 What the server is responsible for

Every rule about money, identity, and what is allowed. The client is treated
as untrusted: it can lie about who it is (the token check catches it), about
which row it is editing (the fingerprint catches it), and about what a bill is
worth (the server recomputes).

## 3. The API

A new file `Api.gs` in the Apps Script project, containing `doPost` and
nothing else of consequence. `doGet`, `Code.gs`'s handlers, `Ledger.gs` and
`Bills.gs` are not modified except as §4.2 and §5.3 require.

### 3.1 Transport

One endpoint, `POST` only, body `text/plain` containing JSON:

```json
{ "token": "<google id token>", "op": "addEntry", "args": { … } }
```

`text/plain` is not a stylistic choice: Apps Script cannot answer a CORS
preflight (`OPTIONS`), so the request must stay a "simple" request. A JSON
content type would trigger a preflight and fail. The body is parsed with
`JSON.parse` regardless.

The response is `ContentService` JSON:

```json
{ "ok": true,  "data": { … } }
{ "ok": false, "error": "Plain-language message.", "kind": "conflict" }
```

`kind` is one of `auth`, `conflict`, `validation`, `server`. The client needs
it to decide whether to park a queued item (conflict), retry it (server), or
ask for sign-in (auth). The message is the same plain-language string the
Apps Script UI already shows, produced by the same `fail_`/`safe_` pair.

### 3.2 Operations

Each `op` maps to a function that already exists, called with the same
arguments the current UI passes:

| op | Maps to | Notes |
|---|---|---|
| `bootstrap` | `getBootstrap` | accounts, balances, recent, ledgers |
| `ledger` | `getLedger` | switch books |
| `entries` | `getEntries` | one page of the full log |
| `addEntry` | `addEntry` | plus the idempotency id, §4.2 |
| `updateEntry` | `updateEntry` | fingerprint-guarded |
| `voidEntry` | `voidEntry` | fingerprint-guarded |
| `bills` | `getBills` | one cycle |
| `payday` | `getPayday` | one payday |
| `setBillFunded` | `setBillFunded` | tick a box |
| `setBillNotes` | `setBillNotes` | |
| `carryBill` | `carryBill` | |
| `newCycle` | `newCycle` | |
| `addBill` | `addBill` | has no UI today; the PWA gives it one |

An unknown `op` is a `validation` error. The map is explicit — never
`this[op]()` or `eval` — so a crafted request cannot reach an arbitrary
function.

### 3.3 Deployment

The script project gets a **second deployment**, leaving the existing one
alone:

| Deployment | Serves | Execute as | Who may access |
|---|---|---|---|
| existing | the Apps Script UI (`doGet`) | the user accessing | anyone with a Google account |
| new (API) | `doPost` | **me (Vin)** | **anyone** |

"Anyone" is required because a `fetch` from another origin arrives with no
Google session; without it the request is answered with a sign-in HTML page.
The gate is our own token check (§4), not Google's.

Two consequences, both accepted:

- Sheet revision history attributes PWA writes to Vin's account whoever made
  them. `Logged by` still records the truth, because it is written from the
  verified token.
- The API URL is a capability. It is not a secret — the token check is what
  protects the data — but it is not published either.

## 4. Identity

### 4.1 Sign-in and verification

The client uses Google Identity Services. The first run on a device shows one
button; afterwards the app holds an ID token and the email it belongs to.

Every request carries the token. `doPost` verifies it before dispatching:

1. `UrlFetchApp` → `https://oauth2.googleapis.com/tokeninfo?id_token=…`
2. `aud` equals our OAuth client id (stored in Script Properties, never in
   tracked source — the sibling project's rule).
3. `email_verified` is true and `exp` is in the future.
4. The email is on `ALLOWED_EMAILS`, the list the Apps Script app already uses.

A verified token is cached in `CacheService` under a hash of itself until it
expires, so the round trip happens about once an hour per device, not once per
tap. A token that fails any check produces `kind: "auth"`.

**Before spending that network call**, the token is decoded locally and
discarded unless its `aud`, `iss`, `exp` and `email` already look right. The
decode proves nothing — the payload is unsigned and a forger can write
anything in it — so step 1 still runs for everything that passes. Its purpose
is that a junk request costs no quota. A per-minute cap in `CacheService`
backs it up, answering `kind: "server"` when the endpoint is being hammered.

This matters because the endpoint's address is public (§8): anyone who opens
the site can read it out of the network tab, as with every client-side app.
Junk requests are therefore expected, and must be cheap.

The client never sends an email address as a claim about who it is. The email
is read out of the verified token, server side.

### 4.2 The idempotency id — new `Ledger` column K

`HEADERS` in `Ledger.gs` gains an eleventh column, `Id`, after `Status`.

A queued entry is created on the phone with `crypto.randomUUID()`. The id
travels with it, and `appendEntry_` refuses to write a row whose id is already
in the tab, returning success instead. Without this, a reply lost to a dropped
connection means the retry writes the money row twice — the one offline
failure that silently corrupts a balance.

Rows written by the Apps Script UI get an id too, so the column is never
partly filled. Rows that predate the column have a blank id, which matches
nothing and is therefore never mistaken for a duplicate.

Nothing else needs an id: ticks are keyed by `(payday, payer)` and already
idempotent, a carry is refused once the bill is in the next cycle, and an edit
or void is guarded by the fingerprint (`2026-09-16-ledger-edit-void-design.md`
§2). A replayed void of an already-void row returns "That entry is already
void." — the client treats that specific message as success, since the
intended end state holds.

## 5. Offline

### 5.1 The shell

A hand-written service worker (`sw.js`, expected to stay under ~60 lines)
precaches `index.html`, the CSS, the JS modules and the icons at install, and
serves them cache-first. The app therefore opens with no signal.

It is registered with a relative scope, because GitHub Pages serves the app
from a subpath (`/<repo>/`), not from the domain root. Every path in the
manifest and the worker is relative for the same reason.

Updates: a new deployment changes the cache name; the worker takes over on the
next launch, and the app shows a quiet "updated" note rather than reloading
under the user's hands.

### 5.2 The stores

IndexedDB, two object stores:

- `views` — the last successful response per view key (`bootstrap`,
  `bills:2026-09`, `payday:2026-09-30`, …). This is what the app renders when
  it is offline, with the time of the last sync shown.
- `queue` — writes that have not been accepted yet, in order, each with its
  op, args, the id (for `addEntry`), the time it was made, and its state
  (`pending`, `sending`, `parked`).

### 5.3 What "offline" looks like per screen

| Screen | Offline behaviour |
|---|---|
| New entry | Fully usable. Writes queue. |
| Accounts / balances | Last synced figures, plus queued entries (§7.3). |
| Recent / full log | Last synced rows; queued entries shown as pending at the top. |
| Bills — both views | Last synced state, read-only figures. |
| Tick a box | Queues; the box shows as pending rather than moving the ring. |
| Edit / void | Queues; the row shows as pending. Conflicts surface on sync. |
| Notes, carry, new cycle | Queue the same way. |

Bill progress and payday totals are **as of the last sync** while offline.
That is the accepted cost of not duplicating the money math (§2).

## 6. The queue

One at a time, oldest first.

- **Success** → the item leaves the queue; the response refreshes the affected
  view.
- **`server` or a network failure** → stop the run, keep the queue, retry on
  the next trigger (regaining connectivity, opening the app, or a manual
  "sync now").
- **`conflict`** → that item is marked `parked` with its message, and the run
  continues with the rest. One stale edit cannot block a shop's worth of
  entries behind it.
- **`auth`** → stop and ask for sign-in, keeping everything queued.

Parked items are listed on their own screen with what happened and two
choices: discard, or open the entry again with fresh data and redo it. There
is no automatic merge — this is money, and a wrong guess is worse than a
question.

The queue is visible from every screen as a count, and nothing is ever
silently dropped: an item leaves only by being accepted, or by the user
deleting it.

## 7. UI

### 7.1 Parity, not a redesign

The Apps Script app's visual language carries over: white ground, Jost for
display and DM Sans for text, tabular figures, the hero balance, the account
rail, bill cards. It is the same app in a different delivery mechanism, and
the person using it should not have to learn anything.

### 7.2 What is new

- **Install**: a manifest with icons, standalone display, and the app's own
  colours, so it sits on the home screen.
- **A connection line**: offline / syncing / last synced at HH:MM, in the top
  bar, always visible.
- **Pending marks** on queued rows and boxes.
- **A queue screen**, reachable from the count.

### 7.3 Pending and balances

A queued entry is listed at the top of Recent, marked pending, and its amount
is added to the displayed account balance with the figure marked as including
pending items. The arithmetic is `balance + Σ(queued amounts for that
account)`. Once the entry is accepted, the server's own figure replaces it.

Bills progress does not do this (§5.3): a tick's effect on a funding ring is
computed from a schedule the client does not own.

## 8. Security notes

- The OAuth client id and the API URL live in a config file in this repo,
  which is public: GitHub Pages serves it, and the browser must know the
  endpoint to call it, so a private repo would hide the source history and not
  the address. That is accepted. The **script id, the sheet id, the allow-list
  and the `PAYERS` property never appear here** — they stay in the Apps Script
  project and its Script Properties.
- **The allow-list is the gate, not the URL.** A stranger who opens the site
  gets an empty shell and a sign-in button; signing in with their own Google
  account produces a genuine token whose email is not on the list, and the
  server refuses it. No request they can construct reaches the books.
- What the public address does expose is **abuse**, not access — hence the
  local pre-check and the rate cap in §4.1.
- The token is stored in memory and in IndexedDB on the device. It expires in
  about an hour; a stolen device is a bigger problem than a stolen token.
- The server validates every argument again. The client's validation exists to
  give fast feedback, never as a gate.
- `doPost` never dispatches by name lookup (§3.2).

## 9. Stages

Each stage ends with something installable and usable.

1. **The supermarket case.** `Api.gs`, sign-in, the `Id` column, the shell,
   the queue, and one screen: log an entry. Reads: accounts and balances, to
   pick an account. Proves the two unknowns (§11) before anything depends on
   them.
2. **Ledger parity.** Recent, the full log with paging, editing, voiding,
   ledger switching, the account field.
3. **Bills parity.** Cycle view, payday view, ticks with times and
   attribution, notes, per-bill carry, start next cycle, add a bill.
4. **Polish and decide.** Desktop layout, install prompts, whatever the
   parallel run has shown to be missing. Then the decision about retiring the
   Apps Script UI — which this document does not presume.

## 10. Out of scope

- Any change to how the sheet models money.
- Editing rows the app never stamped (the sibling spec's rule stands).
- Multi-device conflict *merging*; conflicts are surfaced, never resolved
  automatically.
- Push notifications, background sync beyond a foreground retry, and any
  server the household has to pay for.
- Retiring the Apps Script app.

## 11. Unknowns to settle in stage 1

Both are cheap to test and expensive to design around:

1. **Cross-origin POST to `/exec`.** The endpoint answers with a redirect to
   `googleusercontent.com`; browsers follow it on `fetch`, and
   `ContentService` responses carry `Access-Control-Allow-Origin: *`. This is
   widely used, but it is verified with a throwaway call from the Pages origin
   before stage 1 continues — not assumed.
2. **Token verification latency** on mobile data, with and without the
   `CacheService` hit. If a tap costs a second, the sign-in design changes
   (a short-lived session token minted by the server, rather than verifying
   Google's token per request).

## 12. Prerequisites Vin does by hand

No agent touches the sheet, the script project, or any Google console.

1. A GitHub account, a repository, and this machine able to push to it.
2. GitHub Pages enabled for that repository.
3. A Google Cloud project with an OAuth 2.0 **Web application** client id,
   whose authorised JavaScript origin is the Pages URL.
4. In the Apps Script project: the client id in Script Properties, and the
   second deployment from §3.3.
5. In the `Ledger` tab: the `Id` header in `K1`, with `K2:K` set to plain
   text.

Each is written as a numbered runbook step in this repo before it is needed.
