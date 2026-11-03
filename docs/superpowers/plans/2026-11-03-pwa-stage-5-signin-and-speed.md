# PWA Stage 5 (Spec A): Stay Signed In, and Feel Fast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hourly Google sign-in with a 30-day server session token, and stop the app waiting on the network for things the user has already done.

**Architecture:** The Apps Script API gains a `session` op that trades one Google-verified call for an HMAC-signed `s1.` token, which `verifyEmail_` accepts locally with no Google round trip. The client swaps the token at sign-in, deletes the silent refresh, re-runs `sync()` when a tap arrives mid-run, uses the server's cycle-view reply to a tick instead of refetching, and draws bill "pending" marks only when the queue is stuck.

**Tech Stack:** Vanilla ES modules (client, no build), Apps Script V8 (server), node assertion scripts (`check.sh` in each repo).

**Spec:** `docs/superpowers/specs/2026-11-03-pwa-stage-5-signin-and-speed.md` (client repo). §5.4 is amended in Task 5.

## Global Constraints

- **Run every node command with Node 24:** `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH`. The system `node` is v18 and cannot run either repo's checks (no ES-module detection). Baseline on 2026-11-03: both `./check.sh` suites pass under Node 24.
- **Repos:** CLIENT = `/home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client` (branch `main`, work directly as stages 1–4 did). SERVER = `/home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA` (git root; code in `home-economy-app/src/`; work on a new branch `stage-5-api`).
- Session token format `s1.<payload>.<signature>`; payload = base64url of `{"email": "<lower-case>", "exp": <unix seconds>}`; signature = base64url HMAC-SHA256 over the literal `s1.<payload>`, keyed by Script Property `SESSION_SECRET`. Lifetime constant `SESSION_DAYS_ = 30`, fixed, not sliding.
- A Google ID token starts `eyJ`; the `s1.` prefix cannot clash with it.
- Session tokens are verified locally: never `UrlFetch`, never counted by `rateOk_`. A missing `SESSION_SECRET` refuses every session token. `doPost`'s order stays verify → `allowed_()` → handler.
- Only a Google-authenticated call may mint a session (`API_VIA_SESSION_`, per-execution global, cleared in `doPost`'s `finally`).
- The session token is stored in the existing auth record's `token` field: **no `auth.token` call site changes.**
- Never `clasp redeploy` the API deployment. `clasp push` and `clasp version` are fine; the user moves `Api-deployment` to the new version in the web editor (Execute as: Me, Who has access: Anyone).
- The Ledger tab's pending list and "includes pending" note are **not** changed.
- No new dependencies, no build step. `sw.js` `CACHE` is bumped once, in Task 6.
- **Shell quoting in the server's `check.sh`:** its node code sits inside `node -e '…'`. Inside that block never write an apostrophe (not in strings, not in comments); use double quotes.
- Commit message trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

Failure modes the spec implies; each has a test in the named task.

1. A tampered, expired, rotated-away or off-allow-list session token is refused as `auth`, never trusted; and a session token cannot mint another session. (Task 1)
2. Sign-in while the server can't issue a session (old server, refusal, no connection) must still sign the person in, with the Google token. (Task 3)
3. A tap made while a sync is mid-flight is sent right after, in tap order, with the later tap winning. (Task 4)
4. A reply for a cycle that is not on screen (payday view), or a run that includes a ledger entry, must not suppress the refetch the screen needs. (Task 4)
5. A tick the server refuses to take must not look done: the pending mark comes back when the queue is stuck, even if the follow-up refetch succeeded. (Task 5)

---

## File Structure

| File | Repo | Responsibility | Tasks |
|---|---|---|---|
| `home-economy-app/src/Api.gs` | SERVER | session mint/verify, `session` op, `doPost` flag | 1 |
| `home-economy-app/check.sh` | SERVER | `Utilities` stub; `doPost` session checks | 1 |
| `app/queue.js` | CLIENT | `drain` returns each success's reply | 2 |
| `app/bills.js` | CLIENT | `onlyBillOps`, `lastCycleViews`, `isStuck`; quiet pending marks | 2, 5 |
| `app/auth.js` | CLIENT | session swap at sign-in; silent refresh deleted | 3 |
| `app/main.js` | CLIENT | no refresh; `syncAgain`; reply use; `conn.unsent` | 3, 4, 5 |
| `selfcheck.js`, `wiring.js` | CLIENT | pure and wired checks | 2–5 |
| `sw.js`, `docs/RUNBOOK.md`, spec | CLIENT | cache bump, stage 5 runbook, §5.4 amendment | 5, 6 |

---

### Task 1: Server session tokens

**Files:**
- Modify: `Home_Economy_PWA/home-economy-app/src/Api.gs`
- Modify: `Home_Economy_PWA/home-economy-app/check.sh`

**Interfaces:**
- Produces (Api.gs globals): `SESSION_DAYS_` (30); `makeSession_(email, secret, nowSec) -> string`; `emailFromSession_(token, secret, nowSec) -> string` ('' when refused); `mintSession_() -> {token, exp}`; `API_VIA_SESSION_` (boolean); op `session` in `opHandler_`. The `session` op's reply is `{ok:true, data:{token, exp}}`; its refusals use `kind:'auth'` (called with a session token) or `kind:'server'` (no secret set).

- [ ] **Step 1: Branch**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git status --short   # expect clean
git switch -c stage-5-api
```

- [ ] **Step 2: Add the `Utilities` stub to `check.sh`**

`verifyEmail_` and `decodeJwt_` have never run under node, so no `Utilities` exists there. Edit `home-economy-app/check.sh`: replace the line

```
["src/Ledger.gs", "src/Bills.gs", "src/Api.gs", "src/Code.gs"].forEach(function (f) {
```

with (the new lines first, the original line last):

```
// Utilities, just enough for the session token: HMAC-SHA256 and web-safe
// base64 over node builtin hashing module. Real Apps Script returns signed bytes;
// Uint8Array handles both. Keep apostrophes out of this block: the whole script
// is inside single quotes in the shell.
// The module name is split on purpose: Node 24 treats a node -e script containing
// the whole word as a different kind of script (anywhere in the text, comments
// too), and every var in it stops being global, which breaks the
// FAKE_SESSION_EMAIL_ check further down. For the same reason, never call
// require("crypto") here.
var nodeCrypto = process.getBuiltinModule("cry" + "pto");
function toBuf(v) {
  return Buffer.isBuffer(v) ? v : typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.from(Uint8Array.from(v));
}
global.Utilities = {
  newBlob: function (s) {
    var b = toBuf(s); // a string or a byte array, as the real newBlob takes
    return { getBytes: function () { return Array.from(b); }, getDataAsString: function () { return b.toString("utf8"); } };
  },
  base64EncodeWebSafe: function (v) { return toBuf(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"); },
  base64DecodeWebSafe: function (s) { return Array.from(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")); },
  computeHmacSha256Signature: function (v, k) { return Array.from(nodeCrypto.createHmac("sha256", toBuf(k)).update(toBuf(v)).digest()); }
};

["src/Ledger.gs", "src/Bills.gs", "src/Api.gs", "src/Code.gs"].forEach(function (f) {
```

- [ ] **Step 3: Write the failing pure checks in `apiSelfCheck_`**

In `src/Api.gs`, replace the last two lines of `apiSelfCheck_`

```js
  console.log('api self-check passed');
}
```

with:

```js
  // ── session tokens (PWA stage 5 spec §3) ──────────────
  eq(typeof opHandler_('session'), 'function', 'the session op exists');
  eq(kindOf_('Please sign in with Google to start a new session.'), 'auth',
     'a session asking to renew itself is told to sign in');
  eq(kindOf_('Sessions are not set up on this app yet.'), 'server',
     'a missing secret is a plain failure the client ignores');

  var t0 = 1789000000;
  var tok = makeSession_('Vin@X.com', 'sekret', t0);
  eq(tok.indexOf('s1.'), 0, 'a session token announces itself');
  eq(emailFromSession_(tok, 'sekret', t0 + 60), 'vin@x.com', 'it round-trips to the folded email');
  eq(emailFromSession_(tok, 'sekret', t0 + SESSION_DAYS_ * 86400 - 1), 'vin@x.com',
     'and lives to the last second of its 30 days');
  eq(emailFromSession_(tok, 'sekret', t0 + SESSION_DAYS_ * 86400), '', 'then is refused');
  eq(emailFromSession_(tok, 'other', t0 + 60), '', 'a different secret refuses it');
  eq(emailFromSession_(tok, '', t0 + 60), '', 'no secret set refuses every session');
  var parts = tok.split('.');
  var flipped = parts[0] + '.' + parts[1] + '.' + (parts[2].charAt(0) === 'A' ? 'B' : 'A') + parts[2].slice(1);
  eq(emailFromSession_(flipped, 'sekret', t0), '', 'a flipped signature is refused');
  var other = makeSession_('stranger@x.com', 'sekret', t0).split('.');
  eq(emailFromSession_(parts[0] + '.' + other[1] + '.' + parts[2], 'sekret', t0), '',
     'a payload swapped in under another signature is refused');
  eq(emailFromSession_('eyJhbGciOi.abc.def', 'sekret', t0), '', 'a Google-shaped token is not a session');
  eq(emailFromSession_('', 'sekret', t0), '', 'nor is nothing');

  console.log('api self-check passed');
}
```

- [ ] **Step 4: Run to verify it fails**

```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app && ./check.sh 2>&1 | grep -v "^    at " | head -12
```

Expected: FAIL with `eq(typeof opHandler_('session'), 'function'…` (got `"object"`, since `opHandler_` returns `null`): the first new check, before the missing functions are reached.

- [ ] **Step 5: Implement the token functions**

In `src/Api.gs`, insert before the doc comment that begins `* The verified email inside a Google ID token` (the comment above `function verifyEmail_`), i.e. replace

```js
/**
 * The verified email inside a Google ID token, or '' when it does not check
```

with:

```js
/**
 * Session tokens (PWA stage 5 spec §3). A Google ID token lives about an
 * hour and the PWA cannot renew one without a prompt Google may never show,
 * so after one Google sign-in the app trades it for one of these:
 * 's1.<payload>.<signature>', payload base64url of {email, exp}, signature
 * an HMAC-SHA256 over 's1.<payload>' keyed by the SESSION_SECRET Script
 * Property. A fixed 30-day life, not sliding.
 * ponytail: sliding renewal if monthly proves annoying.
 */
var SESSION_DAYS_ = 30;

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function sessionMac_(body, secret) {
  return b64url_(Utilities.computeHmacSha256Signature(body, secret));
}

function makeSession_(email, secret, nowSec) {
  var payload = b64url_(Utilities.newBlob(JSON.stringify({
    email: String(email).toLowerCase(),
    exp: nowSec + SESSION_DAYS_ * 86400
  })).getBytes());
  var body = 's1.' + payload;
  return body + '.' + sessionMac_(body, secret);
}

/**
 * The email inside a valid, unexpired session token, or ''. Never goes to
 * Google. A missing secret refuses every token, so a half-set-up deploy
 * fails closed. Allow-list membership is doPost's job, as for Google tokens.
 * ponytail: a plain string compare of the MAC (Apps Script has no
 * constant-time one); the secret is keyed and each guess costs a full round
 * trip. decodeJwt_ reads the payload because it takes the middle segment of
 * any three-part token.
 */
function emailFromSession_(token, secret, nowSec) {
  if (!secret) return '';
  var parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 's1') return '';
  if (sessionMac_(parts[0] + '.' + parts[1], secret) !== parts[2]) return '';
  var p = decodeJwt_(token);
  if (!p || !(Number(p.exp) > Number(nowSec))) return '';
  return String(p.email || '').toLowerCase();
}

/**
 * The `session` op (spec §3.3): trades a Google-authenticated call for a
 * session token. Refuses a call that itself came in on a session token, so a
 * session can never renew itself, and refuses when no secret is set. Both
 * messages are literals (fail_ rule); the first contains "sign in" so kindOf_
 * files it under 'auth'.
 */
function mintSession_() {
  if (API_VIA_SESSION_) fail_('Please sign in with Google to start a new session.');
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET') || '';
  if (!secret) fail_('Sessions are not set up on this app yet.');
  var now = Math.floor(Date.now() / 1000);
  return { token: makeSession_(API_EMAIL_, secret, now), exp: now + SESSION_DAYS_ * 86400 };
}

/**
 * The verified email inside a Google ID token, or '' when it does not check
```

Also add the op to the map: replace

```js
    addBill: function (a) { return addBill(a.bill); }
  };
```

with

```js
    addBill: function (a) { return addBill(a.bill); },
    session: function (a) { return safe_(function () { return mintSession_(); }); }
  };
```

And declare the flag: replace `var API_EMAIL_ = '';` with

```js
var API_EMAIL_ = '';

/**
 * True when this execution's caller authenticated with a SESSION token, not a
 * Google one. Same lifetime reasoning as API_EMAIL_: a plain global, set by
 * doPost and cleared in its finally, never a Script Property. mintSession_
 * reads it to refuse renewing a session with a session.
 */
var API_VIA_SESSION_ = false;
```

- [ ] **Step 6: Run to verify the pure checks pass**

```bash
./check.sh 2>&1 | grep -v "^    at " | head -12
```

Expected: `api self-check passed` appears, and the run continues to later checks (the expected `TypeError`/`boom` traces are normal per the comment atop `check.sh`).

- [ ] **Step 7: Write the failing `doPost` checks**

In `check.sh`, change the helper

```
  function callDoPost(op) {
    var e = { postData: { contents: JSON.stringify({ token: "t", op: op, args: {} }) } };
```

to

```
  function callDoPost(op, token) {
    var e = { postData: { contents: JSON.stringify({ token: token || "t", op: op, args: {} }) } };
```

and replace the two closing lines of that block

```
  verifyEmail_ = realVerifyEmail_;
  console.log("doPost self-check passed");
```

with:

```
  // ── PWA stage 5 spec §3: session tokens ─────────────────────────────────
  var nowSec = Math.floor(Date.now() / 1000);
  fakeScriptProps.SESSION_SECRET = "sekret";

  // The session op, reached with a Google-shaped token (stand-in verifier).
  opHandler_ = realOpHandler_;
  verifyEmail_ = function () { return "vin@x.com"; };
  var minted = callDoPost("session", "google-token");
  eq(minted.ok, true, "a Google-authenticated caller can mint a session");
  eq(emailFromSession_(minted.data.token, "sekret", nowSec), "vin@x.com", "for their own verified email");
  eq(minted.data.exp > nowSec, true, "and is told when it ends");

  var renewed = callDoPost("session", "s1.a.b");
  eq(renewed.ok, false, "a session cannot mint another session");
  eq(renewed.kind, "auth", "it is told to sign in with Google");

  delete fakeScriptProps.SESSION_SECRET;
  var unset = callDoPost("session", "google-token");
  eq(unset.ok, false, "with no SESSION_SECRET the op refuses");
  eq(unset.kind, "server", "as a plain failure the client ignores, not an auth demand");
  fakeScriptProps.SESSION_SECRET = "sekret";

  // verifyEmail_ itself: a session is checked locally and never fetched.
  verifyEmail_ = realVerifyEmail_;
  global.UrlFetchApp = { fetch: function () { throw new Error("a session must not reach Google"); } };
  var live = makeSession_("vin@x.com", "sekret", nowSec);
  eq(callDoPost("nonsense-op", live).kind, "validation", "a good session gets past auth to the op lookup");

  var offList = callDoPost("nonsense-op", makeSession_("stranger@x.com", "sekret", nowSec));
  eq(offList.kind, "auth", "a good session for an address off the list is still refused");
  eq(offList.error.indexOf("access list") > -1, true, "with the access-list message");

  var stale = callDoPost("nonsense-op", makeSession_("vin@x.com", "sekret", nowSec - 31 * 86400));
  eq(stale.kind, "auth", "an expired session asks for a sign-in");
  eq(stale.error, "Sign in again to continue.", "in the usual words");

  fakeScriptProps.SESSION_SECRET = "rotated";
  eq(callDoPost("nonsense-op", live).kind, "auth", "rotating the secret ends every session");
  delete fakeScriptProps.SESSION_SECRET;
  eq(callDoPost("nonsense-op", live).kind, "auth", "and with no secret at all, none is honoured");
  delete global.UrlFetchApp;

  opHandler_ = realOpHandler_;
  verifyEmail_ = realVerifyEmail_;
  console.log("doPost self-check passed");
```

- [ ] **Step 8: Run to verify the new `doPost` checks fail**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -8
```

Expected: FAIL, `a Google-authenticated caller can mint a session: got false, want true` (the op exists but `doPost` has not set `API_VIA_SESSION_`, and `verifyEmail_` does not know session tokens yet, so the later checks would also fail).

- [ ] **Step 9: Wire `verifyEmail_` and `doPost`**

In `verifyEmail_`, replace

```js
  var raw = String(token || '');
  if (!raw) return '';

  var cache = CacheService.getScriptCache();
```

with

```js
  var raw = String(token || '');
  if (!raw) return '';

  // A session token is checked here, locally: no cache, no rate cap (that cap
  // exists only to bound the tokeninfo fetch below), and never Google.
  if (raw.indexOf('s1.') === 0) {
    return emailFromSession_(raw,
      PropertiesService.getScriptProperties().getProperty('SESSION_SECRET') || '',
      Math.floor(Date.now() / 1000));
  }

  var cache = CacheService.getScriptCache();
```

In `doPost`, replace `    API_EMAIL_ = email;` with

```js
    API_EMAIL_ = email;
    API_VIA_SESSION_ = String(body.token || '').indexOf('s1.') === 0;
```

and in its `finally`, replace

```js
      API_EMAIL_ = '';
    }
    return apiJson_(apiOk_(out));
```

with

```js
      API_EMAIL_ = '';
      API_VIA_SESSION_ = false;
    }
    return apiJson_(apiOk_(out));
```

- [ ] **Step 10: Run to verify everything passes**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -8
```

Expected: `doPost self-check passed`, `self-check passed`, `bills render smoke passed`.

- [ ] **Step 11: Commit**

```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git add home-economy-app/src/Api.gs home-economy-app/check.sh
git commit -m "Add session tokens: a 30-day signed token the PWA trades a Google sign-in for

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client helpers: drain replies, bill-op test, reply picker, stuck predicate

**Files:**
- Modify: `app/queue.js` (`drain`)
- Modify: `app/bills.js` (add three exports)
- Test: `selfcheck.js`

**Interfaces:**
- Produces: `drain(store, send)` now returns `{ sent, parked, stopped, needsAuth, replies }` where `replies` is `Array<{ item, data }>`, one per success, oldest first. `onlyBillOps(items) -> boolean`; `lastCycleViews(replies) -> Array<cycleView>`; `isStuck(conn) -> boolean` (all in `app/bills.js`).

- [ ] **Step 1: Write the failing checks**

In `selfcheck.js`, change the import line

```js
import { overlayQueued, billsKey, nextCycle } from './app/bills.js';
```

to

```js
import { overlayQueued, billsKey, nextCycle, onlyBillOps, lastCycleViews, isStuck } from './app/bills.js';
```

In the first drain block, after the line `  assert.equal((await store.listQueue()).length, 0, 'and the queue is empty');` insert:

```js

  // Stage 5 spec §5.3: each success hands back its reply, oldest first.
  const r1 = await enqueue(store, 'setBillFunded', { cycle: '2026-09', row: 5 });
  const r2 = await enqueue(store, 'setBillNotes', { cycle: '2026-09', row: 5 });
  out = await drain(store, async (item) => ({ ok: true, data: { echo: item.op } }));
  assert.deepEqual(out.replies.map((r) => [r.item.id, r.data.echo]),
    [[r1.id, 'setBillFunded'], [r2.id, 'setBillNotes']],
    'replies come back with their items, oldest first');
```

After the line `  assert.equal(out.sent, 1, 'the healthy item still went');` insert:

```js
  assert.equal(out.replies.length, 1, 'and only the item that went has a reply');
```

Before `console.log('bills self-check passed');` insert:

```js
// ── stage 5: what a bill-only sync can skip, and when "pending" shows ──
{
  const op = (name) => ({ op: name });
  assert.equal(onlyBillOps([op('setBillFunded'), op('setBillNotes')]), true, 'ticks and notes are bill ops');
  assert.equal(onlyBillOps([op('setBillFunded'), op('addEntry')]), false,
    'one ledger op makes it a ledger run: balances need the bootstrap');
  assert.equal(onlyBillOps([]), false, 'an empty run has nothing to use');

  const v = (cycle, tag) => ({ cycle, rows: [], tag });
  const kept = lastCycleViews([
    { item: op('setBillFunded'), data: v('2026-09', 'first') },
    { item: op('setBillFunded'), data: v('2026-08', 'other') },
    { item: op('setBillNotes'), data: v('2026-09', 'last') },
    { item: op('setBillNotes'), data: {} },
    { item: op('setBillNotes'), data: null },
  ]);
  assert.deepEqual(kept.map((d) => d.tag).sort(), ['last', 'other'],
    'the last reply per cycle wins, and replies that are not cycle views are ignored');

  assert.equal(isStuck({ online: true }), false, 'online and well: nothing is stuck');
  assert.equal(isStuck({ online: false }), true, 'offline is stuck');
  assert.equal(isStuck({ online: true, needsAuth: true }), true, 'signed out is stuck');
  assert.equal(isStuck({ online: true, error: 'Could not reach the sheet.' }), true, 'a failed sync is stuck');
  assert.equal(isStuck({ online: true, unsent: true }), true, 'a run that left an item unsent is stuck');
}

```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client && node selfcheck.js 2>&1 | head -6
```

Expected: FAIL, `SyntaxError: The requested module './app/bills.js' does not provide an export named 'onlyBillOps'`.

- [ ] **Step 3: Implement**

In `app/queue.js`, change

```js
  const counts = { sent: 0, parked: 0, stopped: false, needsAuth: false };
```

to

```js
  const counts = { sent: 0, parked: 0, stopped: false, needsAuth: false, replies: [] };
```

and in the success branch change

```js
      await store.removeQueued(item.id);
      counts.sent += 1;
      continue;
```

to

```js
      await store.removeQueued(item.id);
      counts.sent += 1;
      counts.replies.push({ item, data: result.data }); // stage 5 spec §5.3: sync() may use what the server answered
      continue;
```

In `app/bills.js`, after the `SWAP_CYCLE` constant (before `billsKey`), insert:

```js
/** True when a run sent bill ticks and notes and nothing else (stage 5 spec
    §5.3). A ledger op changes balances, which only a bootstrap refetch
    brings back. */
export function onlyBillOps(items) {
  return items.length > 0 && items.every((i) => BILL_OPS.includes(i.op));
}

/** The server answers a tick or a note with the whole updated cycle view.
    Of the replies a run collected, the last one per cycle is the freshest:
    the server works through the queue in order, so each reply already holds
    the earlier ones. Anything that is not a cycle view is skipped. */
export function lastCycleViews(replies) {
  const byCycle = new Map();
  replies.forEach(({ data }) => {
    if (data && data.cycle && Array.isArray(data.rows)) byCycle.set(data.cycle, data);
  });
  return [...byCycle.values()];
}

/** Is the queue stuck rather than flowing (stage 5 spec §5.4)? A bill
    tick or note only shows "pending" then: offline, signed out, a failed
    sync, or a run that left an item unsent. */
export function isStuck(conn) {
  return !conn.online || !!conn.needsAuth || !!conn.error || !!conn.unsent;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node selfcheck.js 2>&1 | tail -4
```

Expected: ends with `bills self-check passed`.

- [ ] **Step 5: Commit**

```bash
./check.sh 2>&1 | tail -3   # whole suite still green
git add app/queue.js app/bills.js selfcheck.js
git commit -m "Give drain its replies, and add the helpers stage 5's sync and Bills use

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sign-in trades for a session; the silent refresh goes

**Files:**
- Modify: `app/auth.js` (rewrite)
- Modify: `app/main.js` (import; `sync()` auth line; `boot()` comment)
- Test: `wiring.js`

**Interfaces:**
- Consumes: `api.call(op, args, token) -> {ok, data?, kind?, error?}` (never throws); the server `session` op from Task 1 (`data: {token, exp}`).
- Produces: `signIn() -> Promise<{email, token}>` resolving once stored (token = session token when the server issued one, else the Google credential). `refresh` is **removed** from `auth.js`. `currentAuth()` and `signOut()` are unchanged.

- [ ] **Step 1: Write the failing wiring check**

In `wiring.js`, replace the whole last block of the main.js scenario, from the comment `// ── a silent refresh must not steal a waiting sign-in's callback (spec` through its closing `}`, i.e. replace exactly:

```js
  // ── a silent refresh must not steal a waiting sign-in's callback (spec
  // §7.1). Last in this block: the sign-in below waits on a tap that never
  // comes under node, so it is left pending on purpose. ───────────────────
  {
    const auth = await import('./app/auth.js');
    let inits = 0;
    fakeGoogle.accounts.id.initialize = () => { inits += 1; };
    navigator.onLine = true;
    auth.signIn();
    await settle();
    assert.equal(inits, 1, 'precondition: the sign-in has initialised Google and is waiting');
    assert.equal(await auth.refresh(), null, 'a refresh during sign-in stands aside');
    assert.equal(inits, 1, 'without re-initialising Google over the sign-in\'s callback');
    navigator.onLine = false;
  }
```

with:

```js
  // ── sign-in trades the Google token for the server's session (stage 5
  // spec §4; Review Focus 2) ────────────────────────────────────────────
  {
    const auth = await import('./app/auth.js');
    let cb = null;
    fakeGoogle.accounts.id.initialize = (opts) => { cb = opts.callback; };
    navigator.onLine = true;
    const b64 = (email) => Buffer.from(JSON.stringify({ email })).toString('base64url');
    const google = 'h.' + b64('vin@example.test') + '.s';
    const sessionToken = 's1.' + b64('vin@example.test') + '.sig';
    const signInWith = async () => {
      const waiting = auth.signIn();
      await settle();
      cb({ credential: google });
      return waiting;
    };

    // The server issues a session: it is kept, in the field every call reads.
    const calls = [];
    fetchImpl = async (url, req) => {
      calls.push(JSON.parse(req.body));
      return { text: async () => JSON.stringify({ ok: true, data: { token: sessionToken, exp: 1 } }) };
    };
    const stored = await signInWith();
    assert.deepEqual(calls.map((c) => [c.op, c.token]), [['session', google]],
      'sign-in asks the server for a session, presenting the Google token');
    assert.equal(stored.token, sessionToken, 'and keeps the session token');
    assert.equal(stored.email, 'vin@example.test', 'with the email its payload names');
    assert.equal((await db.getAuth()).token, sessionToken, 'saved for every later call');

    // An old server, a refusal, or no connection: the Google token is kept.
    for (const reply of [
      { ok: false, kind: 'validation', error: 'That request is not something this app does.' },
      { ok: false, kind: 'server', error: 'Sessions are not set up on this app yet.' },
    ]) {
      fetchImpl = fetchReturning(reply);
      assert.equal((await signInWith()).token, google, 'a refused session keeps the Google token');
    }
    fetchImpl = async () => { throw new Error('offline'); };
    assert.equal((await signInWith()).token, google, 'no connection keeps it too');

    assert.equal(auth.refresh, undefined, 'the silent refresh is gone');
    navigator.onLine = false;
  }
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client && node wiring.js 2>&1 | grep -v "^    at " | head -8
```

Expected: FAIL, `AssertionError … sign-in asks the server for a session` (`calls` is empty).

- [ ] **Step 3: Rewrite `app/auth.js`**

Replace the whole file with:

```js
// Google sign-in. DOM- and Google-bound (needs a real `google.accounts.id`
// and a real `#screen`), so the real popup is exercised by hand per the
// runbook; wiring.js drives this module with a fake Google and a fake fetch.
//
// Offline rule, stated once here because every method below leans on it: a
// token already in hand is treated as proof until the server says
// otherwise — the app never blocks a screen on the network just to
// double-check who's holding the phone. But a queued write is only proved
// once it is actually SENT and the server accepts it; holding a valid token
// is not itself a claim that anything queued has gone through. Nothing is
// ever written to local state — the queue emptied, a cached view replaced —
// until the server has said so. Auth only decides whether the app tries.
//
// The token the app sends is the server's session (stage 5 spec §3, §4):
// after one Google sign-in it is traded for a 30-day token, so there is no
// silent refresh to wait on. If the trade fails — an old server, no
// connection — the Google token is kept, which lasts about an hour, as it
// always did.
import { getAuth, putAuth } from './db.js';
import * as api from './api.js';
import { CLIENT_ID } from '../config.js';

// The GIS script tag (index.html) loads `async`, so it may not be attached
// to `window` yet when this module first runs. Poll briefly rather than
// assume a load order between two independently-scheduled scripts.
// ponytail: a fixed poll ceiling, not a general retry/backoff scheme — this
// gates one button render, nothing more.
function whenGoogleReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function check() {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      if (Date.now() > deadline) return reject(new Error('Google sign-in did not load.'));
      setTimeout(check, 50);
    })();
  });
}

// A JWT's payload is unsigned-looking base64 — anyone could write anything
// in it client-side, so this decode proves nothing. It is used only to fill
// `email` on the stored auth record, which currentAuth()/signOut() below
// test for truthiness to decide "is someone signed in" — never trusted for
// anything money-related. The server re-derives the email from the verified
// token itself and never trusts what the client sends. (The top bar's
// "signed in as…" — round-2 review, C5 — reads `view.user` from the
// bootstrap payload instead, in main.js's render(): that name comes from
// the server's own verified email, not this unverified decode.)
// A session token (`s1.<payload>.<sig>`) keeps its payload in the same middle
// segment, so this reads either kind. A credential that isn't three
// dot-separated segments of valid base64 JSON (never expected from Google,
// but a callback argument is never a promise worth trusting blindly)
// returns '' rather than throwing out of here.
function emailFromToken(token) {
  const segment = String(token).split('.')[1];
  if (!segment) return '';
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)).email || '';
  } catch {
    return '';
  }
}

// The token goes in the existing `token` field, so no call site changes
// whichever kind it is. api.call never throws, so a dead network is just
// another reply that is not a session.
async function storeCredential(response) {
  const traded = await api.call('session', {}, response.credential);
  const token = traded.ok && traded.data && traded.data.token ? traded.data.token : response.credential;
  const auth = { email: emailFromToken(token), token };
  await putAuth(auth);
  return auth;
}

/** Renders Google's button into #ledger-main and resolves once the person signs
    in, with the auth already saved to IndexedDB. */
export async function signIn() {
  await whenGoogleReady();
  return new Promise((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      // storeCredential() can reject (putAuth() throwing on a blocked or
      // quota-full IndexedDB). That rejection lands on the promise this
      // callback creates, not on any surrounding try/catch — there isn't
      // one here, and GIS never awaits this callback either — so left
      // unhandled it is simply lost and this signIn() promise hangs
      // forever. Rejecting here instead means a broken sign-in surfaces as
      // a rejected promise the caller can catch and show, rather than a
      // screen that never moves.
      callback: (response) => storeCredential(response).then(resolve, reject),
    });
    // #ledger-main, not #screen: #screen holds the two fixed regions
    // (stage 4 spec §3.2), and clearing it would remove them. The side is
    // emptied too, so nothing stale and tappable sits beside the button.
    const host = document.getElementById('ledger-main');
    host.textContent = '';
    document.getElementById('ledger-side').textContent = '';
    const slot = document.createElement('div');
    host.appendChild(slot);
    google.accounts.id.renderButton(slot, { type: 'standard' });
  });
}

/** The stored `{email, token}`, or null if no one has signed in on this
    device — works offline, since it never touches the network. */
export async function currentAuth() {
  const auth = await getAuth();
  return auth && auth.email ? auth : null;
}

/** Clears the stored session. There is no delete-auth store method (db.js
    keeps one record per device); overwriting the email/token to null is
    enough, since currentAuth() above treats a missing email as signed out. */
export async function signOut() {
  await putAuth({ email: null, token: null });
}
```

- [ ] **Step 4: Update `app/main.js`**

Change the import line

```js
import { currentAuth, refresh, signIn } from './auth.js';
```

to

```js
import { currentAuth, signIn } from './auth.js';
```

In `sync()`, replace

```js
    // A fresh silent refresh is preferred, but refresh() returns null for
    // plenty of reasons short of "not signed in" (offline, GIS not loaded
    // yet, a dismissed prompt) — the auth rule is that a token already in
    // hand is proof for about an hour, so falling back to the stored one
    // avoids blocking a sync on a UI Google chose not to show.
    const auth = (await refresh()) || (await currentAuth());
```

with

```js
    // The stored token is the session (stage 5 spec §4): nothing here waits
    // on Google. When it has lapsed the server says so (`auth`) and the
    // status line asks for a sign-in.
    const auth = await currentAuth();
```

In `boot()`, replace the first paragraph of the comment above `if (!(await currentAuth()))`:

```js
  // Checked, and fully resolved, before ANY listener below is registered
  // (round-2 review, C4) — not just before the first render. sync() (which
  // every one of online/visibilitychange/conn-click can reach) calls
  // refresh(), which calls google.accounts.id.initialize() a second time.
  // GIS's initialize is global, so that second call silently replaces the
  // callback THIS signIn() is still waiting on, and signIn()'s promise never
  // settles — a visibilitychange firing while the sign-in popup is open
  // (switching to it is often what triggers one) is the common case. Doing
  // this before registering any listener means none of them can fire sync()
  // while a sign-in is still in flight.
```

with

```js
  // Checked, and fully resolved, before ANY listener below is registered
  // (round-2 review, C4) — not just before the first render. A sync fired by
  // online/visibilitychange while the sign-in popup is open would run for a
  // device nobody is signed into yet. (It used to be worse: sync() called
  // refresh(), whose second google.accounts.id.initialize() replaced the
  // callback this signIn() waits on. The silent refresh is gone as of stage
  // 5, but the ordering is still right.)
```

- [ ] **Step 5: Tidy the now-stale fake in `wiring.js`**

Replace

```js
  // A fake accounts.id whose prompt(cb) reports a skipped moment straight
  // away, so refresh() resolves null promptly instead of waiting out its
  // real 4-second timeout for a popup that will never appear under node.
  const fakeGoogle = {
    accounts: {
      id: {
        initialize() {},
        prompt(cb) { cb({ isNotDisplayed: () => false, isSkippedMoment: () => true }); },
        renderButton() {},
      },
    },
  };
```

with

```js
  // A fake accounts.id. Nothing calls prompt() any more: the silent refresh
  // went in stage 5, so sign-in is the only Google call left.
  const fakeGoogle = {
    accounts: {
      id: {
        initialize() {},
        renderButton() {},
      },
    },
  };
```

- [ ] **Step 6: Run the whole suite**

```bash
grep -n "refresh\|signingIn\|REFRESH_TIMEOUT" app/*.js
./check.sh 2>&1 | tail -4
```

Expected: `wiring self-check passed`. The grep matches only comments that mention the silent refresh (in `auth.js`'s header and `main.js`'s `boot()`), and no code: no `refresh(` call, no `signingIn`, no `REFRESH_TIMEOUT_MS`.

- [ ] **Step 7: Commit**

```bash
git add app/auth.js app/main.js wiring.js
git commit -m "Trade the Google sign-in for a 30-day session, and drop the silent refresh

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `sync()` re-runs for a mid-sync tap, and uses the server's reply

**Files:**
- Modify: `app/main.js` (`sync()`, imports)
- Test: `wiring.js` (inside the Bills scenario)

**Interfaces:**
- Consumes: `drain(...).replies`, `onlyBillOps`, `lastCycleViews` (Task 2); `billsKey`, `showBills`, `putView`, `fetchBills`, `billsSeq`, `bills`, `tab` (already in `main.js`).
- Produces: behaviour only. A run whose every sent item was a bill op, with no parked item and no stop, skips the `bootstrap` refetch; each reply's cycle is cached, and the one on screen in cycle mode is shown and spares the bills refetch.

- [ ] **Step 1: Write the failing wiring checks**

In `wiring.js`, immediately before the line

```js
    // ── Carry and Start go straight to the server, online only (spec §4.3) ──
```

insert:

```js
    // ── a bill-only sync uses the server's reply, and a tap made mid-sync
    // is not left waiting (stage 5 spec §5.2, §5.3; Review Focus 3, 4) ────
    navigator.onLine = true;
    fireWindow('online'); // an empty queue: bootstrap, then the scope, as before
    await settle();

    const setBox = async (row, payday, payer, on) => {
      const b = box(row, payday, payer);
      b.checked = on;
      billsEl.dispatch('change', { target: b });
      await settle();
    };
    // The stub server keeps its own copy of the cycle and answers every tick
    // with all of it, as setBillFunded does. `notes` carries a counter so a
    // reply's own text can be told from the cache it replaced.
    const server = structuredClone(fresh);
    let replies = 0;
    answers.setBillFunded = (args) => {
      if (args.row === 9) return { ok: true, data: { ...cycleView, cycle: '2026-08', rows: [] } };
      const s = server.rows[0].schedule.find((x) => x.payday === args.payday);
      s.paid[server.payers.indexOf(args.payer)] = args.funded;
      replies += 1;
      server.rows[0].notes = 'reply ' + replies;
      return { ok: true, data: structuredClone(server) };
    };
    const poison = { ok: false, kind: 'server', error: 'must not be asked' };
    answers.bootstrap = poison;
    answers.bills = poison;

    // One tick is one round trip, and the reply is what is on screen.
    sent.length = 0;
    await setBox('5', '2026-09-15', 'Venice', true);
    assert.deepEqual(sent.map((b) => b.op), ['setBillFunded'],
      'a tick costs one round trip: no bootstrap, no bills refetch');
    assert.ok(textOf(billsEl).includes('reply 1'), "the reply's own view is what is on screen");
    assert.equal(box('5', '2026-09-15', 'Venice').checked, true, 'and it carries the tick');
    assert.ok(!textOf(billsEl).includes('pending'), 'with no pending mark left');
    assert.equal((await db.getView('bills:cycle:2026-09')).rows[0].notes, 'reply 1', 'and it is cached');
    assert.equal((await db.listQueue()).length, 0, 'the queue is empty');

    // A tap made while a send is in flight is sent right after it, in tap
    // order, and the later tap wins — without waiting for the retry timer.
    const realFetch = fetchImpl;
    let release;
    const held = new Promise((r) => { release = r; });
    let holding = true;
    fetchImpl = async (url, req) => {
      if (holding && JSON.parse(req.body).op === 'setBillFunded') { holding = false; await held; }
      return realFetch(url, req);
    };
    sent.length = 0;
    await setBox('5', '2026-09-30', 'Vin', true);      // its send is held
    await setBox('5', '2026-09-15', 'Venice', false);  // tapped mid-sync
    assert.equal(box('5', '2026-09-30', 'Vin').checked, true, 'the first tap shows');
    assert.equal(box('5', '2026-09-15', 'Venice').checked, false, 'and so does the second');
    release();
    for (let i = 0; i < 4; i += 1) await settle();
    fetchImpl = realFetch;
    assert.deepEqual(sent.map((b) => [b.op, b.args.payer, b.args.funded]),
      [['setBillFunded', 'Vin', true], ['setBillFunded', 'Venice', false]],
      'both were sent, in tap order, with no refetch between or after');
    assert.ok(textOf(billsEl).includes('reply 3'), 'the last reply is what is on screen');
    assert.equal(box('5', '2026-09-30', 'Vin').checked, true, 'Vin stays ticked');
    assert.equal(box('5', '2026-09-15', 'Venice').checked, false, 'and Venice is unticked, the later tap');
    assert.equal((await db.listQueue()).length, 0, 'nothing is left queued');

    // From the payday view the reply is for a cycle that is not on screen:
    // cached for later, and the payday on screen is still refetched.
    await pickScope(SWAP_PAYDAY);
    sent.length = 0;
    await tickBox('9', '2026-09-15', 'Vin');
    assert.deepEqual(sent.map((b) => b.op), ['setBillFunded', 'payday'],
      'a reply for a cycle not on screen does not stand in for the view that is');
    assert.ok(await db.getView('bills:cycle:2026-08'), "but the reply's cycle is cached for next time");
    answers.bootstrap = { ok: true, data: bootstrapView };
    answers.bills = { ok: true, data: fresh };
    await pickScope(SWAP_CYCLE);

    // A run that includes a ledger entry still refetches balances.
    await db.putQueued({ id: 'led-1', op: 'addEntry', at: Date.now(), state: 'pending',
      args: { entry: ui.entryFrom({ ledger: 'Bills', date: '2026-09-18', account: 'Groceries',
        type: 'Withdrawal', source: 'SM', description: 'weekly', amount: '10' }, 'e-1') } });
    sent.length = 0;
    await setBox('5', '2026-09-15', 'Venice', true);
    assert.deepEqual(sent.map((b) => b.op), ['addEntry', 'setBillFunded', 'bootstrap', 'bills'],
      'a ledger entry in the run brings the bootstrap refetch back');

    navigator.onLine = false;
    fireWindow('offline');

```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
node wiring.js 2>&1 | grep -v "^    at " | head -10
```

Expected: FAIL at `a tick costs one round trip` (today the run also sends `bootstrap` and `bills`).

- [ ] **Step 3: Implement in `app/main.js`**

Change the bills import line

```js
import { renderBills, overlayQueued, billsKey, SWAP_PAYDAY, SWAP_CYCLE, nextCycle } from './bills.js';
```

to

```js
import { renderBills, overlayQueued, billsKey, SWAP_PAYDAY, SWAP_CYCLE, nextCycle, onlyBillOps, lastCycleViews } from './bills.js';
```

Replace the guard comment and declaration

```js
// Guards sync() against overlap: two runs racing would drain the same queue
// twice and could double-send an item mid-flight before the first run
// removes it.
let syncing = false;
```

with

```js
// Guards sync() against overlap: two runs racing would drain the same queue
// twice and could double-send an item mid-flight before the first run
// removes it. A call that arrives mid-run is not dropped, though: drain read
// the queue when it started, so an item queued since would otherwise wait for
// the retry timer (5 s at the least). `syncAgain` makes the run that is
// finishing start one more (stage 5 spec §5.2).
let syncing = false;
let syncAgain = false;
```

Replace

```js
  if (syncing) return;
  syncing = true;
  conn.syncing = true;
```

with

```js
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  conn.syncing = true;
```

Replace the refetch section. Old text (from the `bootstrap` call to the end of the Bills refetch):

```js
    const res = await api.call('bootstrap', {}, auth.token);
    if (!res.ok) {
      // Only a real success may move the clock. Stamping conn.at here
      // regardless is what let the line read "synced 15:50" while the view
      // was still null and the form stayed dead — a status that lies is
      // worse than no status, because it sends you looking in the wrong
      // place. An empty queue means drain never saw this rejection, so
      // this is the only chance to report it.
      if (res.kind === 'auth') conn.needsAuth = true;
      conn.error = res.error || 'Could not reach the sheet.';
      return;
    }

    await putView('bootstrap', res.data);
    view = res.data;

    // Spec §4.2: with the Bills tab open, its scope is refetched too, so
    // pending marks clear against the server's own figures. A failure
    // leaves the cached view up and says so on the connection line, as a
    // failed bootstrap does, and does not move the clock.
    if (tab === 'bills') {
```

New text:

```js
    // Stage 5 spec §5.3: a run that sent only bill ticks and notes, all of
    // them accepted, changed no balance, and the server answered each with
    // the whole updated cycle. Use the replies instead of asking again.
    // Anything else (a ledger entry, a parked or stopped run, or no sends at
    // all) takes the full refetch below, as it always did.
    const fromReplies = !result.stopped && !result.parked
      && onlyBillOps(result.replies.map((r) => r.item));
    let shown = false; // the reply already put the scope on screen
    if (fromReplies) {
      for (const data of lastCycleViews(result.replies)) {
        await putView(billsKey('cycle', data.cycle), data);
        if (tab === 'bills' && bills.mode === 'cycle' && bills.scopes.cycle === data.cycle) {
          billsSeq += 1; // a fetch still in flight predates this reply
          showBills(data);
          shown = true;
        }
      }
    } else {
      const res = await api.call('bootstrap', {}, auth.token);
      if (!res.ok) {
        // Only a real success may move the clock. Stamping conn.at here
        // regardless is what let the line read "synced 15:50" while the view
        // was still null and the form stayed dead — a status that lies is
        // worse than no status, because it sends you looking in the wrong
        // place. An empty queue means drain never saw this rejection, so
        // this is the only chance to report it.
        if (res.kind === 'auth') conn.needsAuth = true;
        conn.error = res.error || 'Could not reach the sheet.';
        return;
      }

      await putView('bootstrap', res.data);
      view = res.data;
    }

    // Spec §4.2: with the Bills tab open, its scope is refetched too, so
    // pending marks clear against the server's own figures. A failure
    // leaves the cached view up and says so on the connection line, as a
    // failed bootstrap does, and does not move the clock.
    if (tab === 'bills' && !shown) {
```

Replace the `finally` tail

```js
    if (queue.length) scheduleRetry();
    render();
  }
}
```

with

```js
    if (queue.length) scheduleRetry();
    render();
    if (syncAgain) { syncAgain = false; sync(); }
  }
}
```

- [ ] **Step 4: Run the whole suite**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -6
```

Expected: `wiring self-check passed`. If an older wiring assertion now fails, read it before touching it: a `sync()` that used to be dropped (because one was already running) now runs once more. Change the old expectation only if the extra run is exactly that, and say so in the commit message. Do not loosen the new assertions.

- [ ] **Step 5: Commit**

```bash
git add app/main.js wiring.js
git commit -m "Re-run sync for a tap made mid-sync, and use the reply to a tick instead of refetching

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bills "pending" only when the queue is stuck

**Files:**
- Modify: `app/bills.js` (`ticks`, `noteLine`, `billCard`, `paydayLine`, `renderBills`)
- Modify: `app/main.js` (`conn`, `sync()` finally)
- Modify: `docs/superpowers/specs/2026-11-03-pwa-stage-5-signin-and-speed.md` (§5.4)
- Test: `wiring.js`

**Interfaces:**
- Consumes: `isStuck(conn)` (Task 2).
- Produces: `conn.unsent` (boolean) maintained by `sync()`: true when a run ended with a still-pending item and no immediate re-run. Parked items do not count.

- [ ] **Step 1: Write the failing wiring checks**

First, in the block Task 4 added, make the mid-sync taps check what they look like while the send is still held. Replace

```js
    assert.equal(box('5', '2026-09-30', 'Vin').checked, true, 'the first tap shows');
```

with

```js
    assert.ok(!textOf(billsEl).includes('pending'), 'online and flowing, both taps already look done');
    assert.equal(box('5', '2026-09-30', 'Vin').checked, true, 'the first tap shows');
```

Then, at the end of that same block, replace the last two lines of it

```js
    navigator.onLine = false;
    fireWindow('offline');

```

with:

```js
    // A send the server will not take keeps its mark, even when the refetch
    // after it succeeds: the item is still unsent (spec §5.4; Review Focus 5).
    answers.setBillFunded = { ok: false, kind: 'server', error: 'The sheet is busy right now. Try again in a moment.' };
    sent.length = 0;
    await setBox('5', '2026-09-30', 'Vin', false);
    assert.equal((await db.listQueue()).length, 1, 'the refused tick stays queued');
    assert.ok(textOf(box('5', '2026-09-30', 'Vin').parent).includes('pending'),
      'and wears its pending mark, though bootstrap and bills both answered');
    navigator.onLine = false;
    fireWindow('offline'); // clears the retry timer the failed run left running
    for (const q of await db.listQueue()) await db.removeQueued(q.id);
    answers.setBillFunded = { ok: true, data: {} };

```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
node wiring.js 2>&1 | grep -v "^    at " | head -8
```

Expected: FAIL at `online and flowing, both taps already look done` (today a queued tick always wears its mark). The stuck-queue check after it only goes red once `isStuck` is wired but `conn.unsent` is not, so it guards Step 3's `main.js` half specifically.

- [ ] **Step 3: Implement in `app/main.js`**

Change

```js
const conn = { online: navigator.onLine, syncing: false, at: null, error: '' };
```

to

```js
const conn = { online: navigator.onLine, syncing: false, at: null, error: '', unsent: false };
```

In `sync()`'s `finally`, replace

```js
    if (queue.length) scheduleRetry();
    render();
    if (syncAgain) { syncAgain = false; sync(); }
```

with

```js
    if (queue.length) scheduleRetry();
    // Stage 5 spec §5.4: a send the server would not take can leave conn.error
    // empty (the refetch after it may well succeed), so the Bills tab asks
    // this instead. Not set when a re-run is about to start: that item is
    // about to be sent, not stuck.
    conn.unsent = !syncAgain && queue.some((i) => i.state === 'pending');
    render();
    if (syncAgain) { syncAgain = false; sync(); }
```

- [ ] **Step 4: Implement in `app/bills.js`**

In `ticks`, change the signature and the two places that read `boxes.queued[k]`:

```js
function ticks(view, boxes, handle) {
```
→
```js
function ticks(view, boxes, handle, stuck) {
```

```js
    const label = el('label', boxes.queued[k] ? 'pending' : null);
```
→
```js
    // A queued value is drawn as done; it wears the mark only while the queue
    // is stuck (stage 5 spec §5.4).
    const marked = boxes.queued[k] && stuck;
    const label = el('label', marked ? 'pending' : null);
```

```js
    if (boxes.queued[k]) {
      label.appendChild(el('span', 'tick-at', 'pending'));
    } else if (box.checked) {
```
→
```js
    if (marked) {
      label.appendChild(el('span', 'tick-at', 'pending'));
    } else if (box.checked) {
```

In `noteLine`, replace

```js
  const text = button('linkish note-text' + (r.notesQueued ? ' pending' : ''),
    (r.notes || 'Add note') + (r.notesQueued ? ' · pending' : ''));
```

with

```js
  const noteMark = r.notesQueued && ctx.stuck;
  const text = button('linkish note-text' + (noteMark ? ' pending' : ''),
    (r.notes || 'Add note') + (noteMark ? ' · pending' : ''));
```

In `billCard`, replace

```js
    line.appendChild(ticks(view, s, { cycle: view.cycle, row: r.row, name: r.name, payday: s.payday }));
```

with

```js
    line.appendChild(ticks(view, s, { cycle: view.cycle, row: r.row, name: r.name, payday: s.payday }, ctx.stuck));
```

Change `paydayLine`:

```js
function paydayLine(view, r) {
```
→
```js
function paydayLine(view, r, stuck) {
```

```js
  line.appendChild(ticks(view, r, { cycle: r.cycle, row: r.row, name: r.name, payday: view.payday }));
```
→
```js
  line.appendChild(ticks(view, r, { cycle: r.cycle, row: r.row, name: r.name, payday: view.payday }, stuck));
```

In `renderBills`, after the `canAct` declaration add `const stuck = isStuck(state.conn);`, so:

```js
  const canAct = state.conn.online && !state.conn.needsAuth && !b.busy;
  const stuck = isStuck(state.conn);
```

and update the two call sites:

```js
    view.rows.forEach((r) => lines.appendChild(paydayLine(view, r)));
```
→
```js
    view.rows.forEach((r) => lines.appendChild(paydayLine(view, r, stuck)));
```

```js
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft };
```
→
```js
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft, stuck };
```

- [ ] **Step 5: Amend spec §5.4**

In `docs/superpowers/specs/2026-11-03-pwa-stage-5-signin-and-speed.md`, replace

```
`renderBills` already knows `state.conn`. A queued tick or note shows its
"pending" label and `.pending` styling only when
`!conn.online || conn.needsAuth || conn.error`; otherwise it is drawn as
done. Parked items, the offline hint and the banner are untouched.
```

with

```
`renderBills` already knows `state.conn`. A queued tick or note shows its
"pending" label and `.pending` styling only when
`!conn.online || conn.needsAuth || conn.error || conn.unsent`; otherwise it
is drawn as done. `conn.unsent` is set by `sync()` when a run ends with an
item still pending and no immediate re-run: a send the server refuses can
leave `conn.error` empty (the refetch after it may succeed), and that item
must not look done. Parked items, the offline hint and the banner are
untouched.
```

- [ ] **Step 6: Run the whole suite**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -6
```

Expected: `wiring self-check passed`. The older offline assertions (`marked pending`, `GCash 0917 · pending`) must pass unchanged: those run offline, which is stuck.

- [ ] **Step 7: Commit**

```bash
git add app/bills.js app/main.js wiring.js docs/superpowers/specs/2026-11-03-pwa-stage-5-signin-and-speed.md
git commit -m "Show a bill's pending mark only when the queue is stuck; amend spec 5.4 for unsent items

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cache bump, runbook, and the hand-off to deploy

**Files:**
- Modify: `sw.js` (`CACHE`)
- Modify: `docs/RUNBOOK.md` (append)

- [ ] **Step 1: Bump the cache**

In `sw.js` change `const CACHE = 'home-economy-v18';` to `const CACHE = 'home-economy-v19';` (everything else on that line, including the comment, stays).

- [ ] **Step 2: Append the stage 5 runbook**

````bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
cat >> docs/RUNBOOK.md <<'EOF'

# Stage 5 runbook — stay signed in, and feel fast

`sw.js`'s `CACHE` is `home-economy-v19`: close and reopen the installed app
once on each phone to pick it up. **This stage has a server half.** Client and
server can go live in either order; the monthly sign-in starts at the first
sign-in after both are.

## Deploy the server (once)

1. In `Home_Economy_PWA/home-economy-app`: `clasp push`, then
   `clasp version "Stage 5: session tokens"`. **Not** `clasp redeploy`.
2. Make a secret and keep it out of the repo and out of chat:

   ```bash
   openssl rand -base64 36
   ```

   In the Apps Script web editor: **Project Settings → Script Properties →
   Add script property**, name `SESSION_SECRET`, value the output above.
3. **Deploy → Manage deployments → `Api-deployment`** (the id in `config.js`)
   **→ Edit → Version: the new one → Deploy.** Check it still says
   **Execute as: Me** and **Who has access: Anyone**.
4. Confirm it answers as the API, not as the household app:

   ```bash
   curl -sL -X POST -H 'Content-Type: text/plain' -d '{}' "$(node -e "import('./config.js').then(m => console.log(m.API_URL))")"
   ```

   Expected: `{"ok":false,"error":"Sign in again to continue.","kind":"auth"}`.
   A 401 or an HTML page means the access settings were reset: go back to
   step 3.

## Verify

0. **Before anything is deployed (optional, confirms the diagnosis):** note
   the time you sign in on the current app. It asks for a sign-in again
   within about an hour.
1. After both halves are live, sign in once. Leave the app untouched for over
   an hour, then tick a bill. No sign-in prompt, and the tick lands.
2. The next day, open the app and tick. Still no prompt.
3. Tick a bill on Wi-Fi and on mobile data: the box looks done at once and
   nothing flickers back when the sync lands.
4. Tick two boxes in quick succession: both land, and the second does not wait
   several seconds.
5. Airplane mode: a tick shows `pending` and the offline hint; reconnect and
   it clears.
6. Remove your address from the `ALLOWED_EMAILS` Script Property (then put it
   back): the next action is refused with the access-list message.
7. A sign-in against the old server version (before step 3 above) still works
   for the hour, as it does today.
8. The Ledger tab: a new entry still shows in the pending list until it
   syncs, and the balance still says `includes pending`.
EOF
````

- [ ] **Step 3: Run both suites and confirm the tree**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
./check.sh 2>&1 | tail -3
(cd ../Home_Economy_PWA/home-economy-app && ./check.sh 2>&1 | tail -3)
git status --short
```

Expected: `wiring self-check passed`; `bills render smoke passed`; only `sw.js` and `docs/RUNBOOK.md` modified.

- [ ] **Step 4: Commit**

```bash
git add sw.js docs/RUNBOOK.md
git commit -m "Bump the cache to v19 and add the stage 5 runbook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Stop and hand over. Do NOT deploy or push without being asked.**

Everything outward-facing is the user's call. Report: both suites green, the commits, and the deploy checklist (RUNBOOK "Deploy the server", steps 1–4: `clasp push`/`clasp version`, the `SESSION_SECRET` Script Property, the web-editor deployment edit, the `curl` confirmation) and that the server branch `stage-5-api` still needs merging into the server's local `main` (as `stage-3-api` was) and the client needs `git push`. Ask which to do. After the user confirms both halves are live and the Verify list passes, update the `pwa-stage-status` memory.

---

## Self-Review

**Spec coverage.** §3.1–3.3 (format, `verifyEmail_`, `session` op, `API_VIA_SESSION_`): Task 1. §4 (sign-in swap, `refresh`/flag deleted, no call-site change, either deploy order): Task 3 (the fallback tests cover an old server). §5.1 (no wait): Task 3. §5.2 (re-run): Task 4. §5.3 (reply use; skip bootstrap only for a clean bill-only run; payday/other-cycle refetch; ledger op refetch; last reply per cycle): Tasks 2 and 4. §5.4 (quiet pending; Ledger tab untouched): Task 5, with the `unsent` amendment the spec lacked. §6 failure/security: Task 1 tests (expiry, rotation, off-list, session-renews-session). §7 testing and §8 hand checks: tests inline; hand checks in Task 6's runbook. §9–10: no tasks (deliberately).

**Placeholder scan.** No TBD/TODO; every code step carries the code. The one conditional instruction (Task 4 step 4: an older wiring assertion may need updating) gives the rule for deciding, not a blank.

**Type consistency.** `drain().replies: Array<{item, data}>` (Task 2) is consumed as `result.replies.map((r) => r.item)` and `lastCycleViews(result.replies)` (Task 4). `isStuck` reads `online / needsAuth / error / unsent`; `conn.unsent` is created in Task 5 and referenced in Task 2's `isStuck` and its selfcheck (which passes an object literal, so no ordering problem). `makeSession_(email, secret, nowSec)` / `emailFromSession_(token, secret, nowSec)` / `SESSION_DAYS_` / `API_VIA_SESSION_` names match across `Api.gs`, `apiSelfCheck_` and `check.sh`. The `session` op reply `{token, exp}` is what `auth.js` reads as `traded.data.token`.

**Known soft spots.** (1) Task 4/5 wiring tests share state with a long scenario; the first run may need small ordering fixes (e.g. which box is ticked) that a reader of the live test, not this plan, can settle. (2) The real Google popup and a real 1-hour wait cannot run under node; they are hand checks 0–2.
