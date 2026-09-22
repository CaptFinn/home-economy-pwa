# PWA Stage 3 — Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Apps Script app's Bill Tracker to the PWA: both views, ticks and notes through the offline queue, carry and start-next-cycle online only, plus a server row guard so a queued tick cannot land on a row someone shifted by hand.

**Architecture:** One new client module, `app/bills.js`, holds the pure helpers (`overlayQueued`, `billsKey`, `nextCycle`) and the renderers. `main.js` owns tab and bill state, the handlers, and the post-sync refetch. The server does every sum: the client draws the views as sent and adds only a pending overlay. The server change is one pure match function (`rowMatches_`) called inside the two existing single-row writers.

**Tech Stack:** Browser-native ES modules, IndexedDB, a hand-written service worker, and `node` as a bare assertion runner (`selfcheck.js`, plus `wiring.js`'s stub DOM). Apps Script (ES5) on the server. No bundler, no npm, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-pwa-stage-3-bills.md`. Read it before any task. The stage 2 spec (`2026-09-19-pwa-stage-2-ledger-parity.md`) §2 rules still hold.

**Repos:** client = `/home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client`, branch `stage-3` (already checked out). Server = `/home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA`, branch `stage-3-api` off `main` (Task 1 creates it). Never commit both repos in one step.

## Global Constraints

- **Modern ES modules** on the client (`const`/`let`, arrows, `async`/`await`). **ES5** in the Apps Script repo (`var`, `function`, no arrows or template literals). No bundler, no npm, no dependencies on either side.
- **Comprehension-first:** non-obvious choices get a comment that says *why*. Match the surrounding comment density.
- **No bill arithmetic on the client.** `progress`, `status`, `remaining` and every total are drawn exactly as the server sent them, even while ticks are pending. The only numbers the client derives are display ones: a bar width and the totals percentage (`pct`).
- **Ticks and notes always go through the queue** (`enqueue`, then `sync()`), even online. **Carry and new cycle never do**: they are direct `api.call`s and are disabled offline or signed out.
- **Nothing may silently strand a change.** A refused bill item parks and is listed with its message and **Discard**.
- **All user text enters the DOM via `textContent`** or property assignment. Never build HTML from strings.
- **Never write a raw NUL byte.** Use the `'\u0000…'` escape.
- **No subagent touches the sheet, the live Apps Script project, Google Cloud or GitHub.** No `clasp`, no `gh`, no `git push`. Task 7 (deploy) is the controller's, and the user confirms each `clasp` step first.
- **Verification:** in the client, `./check.sh` must stay green. It prints `fmt`, `db`, `queue`, `api`, `ui`, from Task 2 also `bills`, then `wiring self-check passed`. In the server repo, `home-economy-app/check.sh` must print its six lines (`ledger`, `bills`, `api`, `doPost`, `self-check passed`, `bills render smoke passed`). The mid-run `TypeError: x.y is not a function` and `Error: boom outside any handler` traces there are EXPECTED.
- **Bump `CACHE` in `sw.js`** in any commit that changes a precached file (Task 3 does this once, for the whole stage).
- **Commit messages:** sentence case and imperative, like `Edit and void entries, offline included`. End each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `Home_Economy_PWA/home-economy-app/src/Bills.gs` | `rowMatches_`, and the guard in `setFunded_` / `setNotes_` | Modify (Task 1) |
| `Home_Economy_PWA/home-economy-app/src/Code.gs` | pass `cycle`/`name` through `setBillFunded` / `setBillNotes` | Modify (Task 1) |
| `Home_Economy_PWA/home-economy-app/src/Api.gs` | pass `a.name` through the op map | Modify (Task 1) |
| `app/bills.js` | pure helpers + the Bills tab renderers | Create (Task 2), extend (Task 3) |
| `selfcheck.js` | pins `overlayQueued`, `nextCycle`, `billsKey` | Modify (Task 2) |
| `index.html` | the `Ledger \| Bills` tab bar and an empty `#bills` section | Modify (Task 3) |
| `app.css` | the bill styles, carried from the Apps Script app | Modify (Task 3) |
| `sw.js` | precache `app/bills.js`; bump `CACHE` | Modify (Task 3) |
| `app/main.js` | tab and bill state, loading/caching, handlers, post-sync refetch | Modify (Tasks 3, 4, 5) |
| `wiring.js` | fixed ids for the new elements, recorded window listeners, the Bills scenarios | Modify (Tasks 3, 4, 5) |
| `docs/RUNBOOK.md` | a stage 3 section | Modify (Task 6) |

`app/ui.js`, `app/queue.js`, `app/db.js`, `app/api.js` do not change. The ledger already ignores bill items: `ledgerOf` finds no `ledger` in bill args, and `pendingFor` counts only `addEntry`. Task 4 pins both.

---

### Task 1: The server row guard

**Repo:** `Home_Economy_PWA`. Start with `git -C /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA checkout -b stage-3-api main`. Run everything below from `Home_Economy_PWA/home-economy-app`.

**Files:**
- Modify: `src/Bills.gs`: add `rowMatches_` after `validateNotes_` (around line 358); change `setFunded_` (around 655) and `setNotes_` (around 690); add cases at the end of `billsSelfCheck_`
- Modify: `src/Code.gs`: `setBillFunded` (around 221) and `setBillNotes` (around 250)
- Modify: `src/Api.gs:26-27`

**Interfaces:**
- Produces: `rowMatches_(bill, cycle, name) -> boolean`. `setFunded_(row, payday, payer, funded, by, cycle, name)`. `setNotes_(cycle, row, text, name)`. `setBillFunded(cycle, row, payday, funded, payer, name)`. `setBillNotes(cycle, row, text, name)`. The API ops `setBillFunded` / `setBillNotes` now read `args.name`.
- Wire contract the client relies on: a mismatch fails with exactly `That bill could not be found. Reload and try again.`, which `kindOf_` already classes as `conflict`, so the client's `drain` parks it.

- [ ] **Step 1: Write the failing self-check cases**

In `src/Bills.gs`, at the end of `billsSelfCheck_`, just before `console.log('bills self-check passed');`, add:

```js
  // The row guard (PWA stage 3 spec §5): a tick or note names the bill it
  // meant, and a row that now holds another bill is refused.
  var rent = { cycle: '2026-09', name: 'Rent' };
  eq(rowMatches_(rent, '2026-09', 'Rent'), true, 'the same cycle and name match');
  eq(rowMatches_(rent, '2026-09', '  rent '), true, 'the name is matched trimmed and ignoring case');
  eq(rowMatches_(rent, '2026-09', 'Water'), false, 'another bill on the row is refused');
  eq(rowMatches_(rent, '2026-10', 'Rent'), false, 'the same name in another cycle is refused');
  eq(rowMatches_(rent, '', ''), true, 'blank skips the check: the Apps Script app sends neither');
  eq(rowMatches_(rent, '', 'Rent'), true, 'a blank cycle checks the name alone');
  eq(rowMatches_(rent, undefined, undefined), true, 'and a missing value is blank');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL, with `ReferenceError: rowMatches_ is not defined` after `ledger self-check passed`.

- [ ] **Step 3: Add `rowMatches_`**

In `src/Bills.gs`, directly after `validateNotes_`:

```js
/**
 * Is the row just read inside the lock still the bill the client meant?
 * Bills are addressed by sheet row (see setFunded_), and a row deleted or
 * inserted by hand in the Bill Tracker tab shifts every row below it. A tick
 * queued offline before that shift would otherwise land on whichever bill
 * now sits there, and most two-cutoff bills share paydays, so the payday
 * check alone does not catch it. Each expected value is optional: blank
 * skips that half. The Apps Script app never sends a name, and it sends ''
 * as the cycle from its payday view, so it keeps working unchanged.
 */
function rowMatches_(bill, cycle, name) {
  var c = String(cycle == null ? '' : cycle).trim();
  var n = String(name == null ? '' : name).trim().toLowerCase();
  if (c && bill.cycle !== c) return false;
  if (n && String(bill.name || '').trim().toLowerCase() !== n) return false;
  return true;
}
```

- [ ] **Step 4: Guard `setFunded_` and `setNotes_`**

`setFunded_`: change the signature to `function setFunded_(row, payday, payer, funded, by, cycle, name)`. Directly after the existing `if (!bill.name) fail_('That bill could not be found. Reload and try again.');` line, add:

```js
    if (!rowMatches_(bill, cycle, name)) fail_('That bill could not be found. Reload and try again.');
```

In its doc comment, replace the `ponytail:` paragraph with:

```
 * ponytail: the row number is the handle. When the caller names the cycle
 * and bill it meant, rowMatches_ refuses a row that now holds another one
 * (a hand edit shifted it). A stable id column is the full fix.
```

`setNotes_`: change the signature to `function setNotes_(cycle, row, text, name)` and its identity check to:

```js
    if (!bill.name || bill.cycle !== String(cycle) || !rowMatches_(bill, cycle, name)) {
      fail_('That bill could not be found. Reload and try again.');
    }
```

(The cycle check stays strict here, as before. The Apps Script app always sends the cycle for a note.)

- [ ] **Step 5: Pass the values through `Code.gs` and `Api.gs`**

`src/Code.gs`, `setBillFunded`:

```js
function setBillFunded(cycle, row, payday, funded, payer, name) {
  return safe_(function () {
    var email = requireUser_();
    var me = requirePayer_(email);
    var when = String(cycle || '').trim();
    setFunded_(row, String(payday || '').trim(),
               rosterName_(payer, payerNames_()), !!funded, me, when, name);
    var view = billsView_(readBills_(), when, payerNames_(), todayISO_());
    view.me = me;
    return view;
  });
}
```

Add one sentence to its doc comment: `` `cycle` and `name`, when given, must still match the row (rowMatches_); the PWA sends both, the Apps Script app neither name nor, from its payday view, a cycle. ``

`src/Code.gs`, `setBillNotes`: signature `function setBillNotes(cycle, row, text, name)`, and the call becomes `setNotes_(when, row, text, name);`.

`src/Api.gs` lines 26–27:

```js
    setBillFunded: function (a) { return setBillFunded(a.cycle, a.row, a.payday, a.funded, a.payer, a.name); },
    setBillNotes: function (a) { return setBillNotes(a.cycle, a.row, a.text, a.name); },
```

Note for the reviewer: the Apps Script app's *cycle* view already sends `BILLS.cycle`, so its ticks now get the cycle half of the check. The row being ticked is always in that cycle, so the result only changes when a hand edit has shifted the row, which is the point.

- [ ] **Step 6: Run the checks**

Run: `./check.sh`
Expected: the six lines, including `bills self-check passed`.

- [ ] **Step 7: Commit (server repo)**

```bash
git add src/Bills.gs src/Code.gs src/Api.gs
git commit -m "Guard bill ticks and notes against a shifted row

A tick or note may now name the cycle and bill it meant. Inside the lock,
the row read back must still match, or the write fails with the existing
not-found message, which the PWA parks as a conflict. Blank skips the
check, so the Apps Script app is unaffected.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `app/bills.js`'s pure helpers

**Files:**
- Create: `app/bills.js`
- Modify: `selfcheck.js` (import at the top; block at the end)

**Interfaces:**
- Produces:
  - `billsKey(mode: 'cycle'|'payday', scope: string) -> string`, e.g. `bills:cycle:2026-09`
  - `nextCycle(cycle: string) -> string`: `'2026-12'` gives `'2027-01'`; anything not `YYYY-MM` gives `''`
  - `overlayQueued(view, queue) -> view'`: a copy. Every box set (cycle `rows[].schedule[]`, payday `rows[]`) gains `queued: boolean[]` beside a possibly-overridden `paid`, and each cycle row gains `notesQueued: boolean` beside a possibly-overridden `notes`. `null` in gives `null` out.
  - `BILL_OPS = ['setBillFunded', 'setBillNotes']`, `SWAP_PAYDAY = '\u0000payday'`, `SWAP_CYCLE = '\u0000cycle'`
- Queue item shapes (Task 4 produces them):
  - `{ op: 'setBillFunded', state, at, args: { cycle, row, name, payday, funded, payer } }`
  - `{ op: 'setBillNotes', state, at, args: { cycle, row, name, text } }`

- [ ] **Step 1: Write the failing checks**

In `selfcheck.js`, add to the imports at the top:

```js
import { overlayQueued, billsKey, nextCycle } from './app/bills.js';
```

At the end of the file:

```js
{
  assert.equal(billsKey('cycle', '2026-09'), 'bills:cycle:2026-09', 'a cycle scope key');
  assert.equal(billsKey('payday', '2026-09-15'), 'bills:payday:2026-09-15', 'a payday scope key');

  assert.equal(nextCycle('2026-09'), '2026-10', 'the next cycle');
  assert.equal(nextCycle('2026-12'), '2027-01', 'December rolls the year');
  assert.equal(nextCycle('2026-09-15'), '', 'a payday is not a cycle');
  assert.equal(nextCycle('2026-13'), '', 'nor is a month that does not exist');
  assert.equal(nextCycle(''), '', 'nor is nothing');

  const view = {
    cycle: '2026-09', payers: ['Vin', 'Venice'],
    rows: [{ row: 5, name: 'Rent', notes: '', status: 'Partially funded', progress: 1875,
             schedule: [{ payday: '2026-09-30', paid: [false, false] }] }],
    totals: { billed: 7500, funded: 1875, remaining: 5625, pending: 0 },
  };
  const tick = (at, funded, args = {}) => ({ id: 't' + at, op: 'setBillFunded', state: 'pending', at,
    args: { cycle: '2026-09', row: 5, name: 'Rent', payday: '2026-09-30', payer: 'Venice', funded, ...args } });
  const box = (v) => v.rows[0].schedule[0];

  let out = overlayQueued(view, [tick(1, true), tick(2, false)]);
  assert.deepEqual(box(out).paid, [false, false], 'the newest pending tick wins: an untick after a tick');
  assert.deepEqual(box(out).queued, [false, true], 'and only that box is marked');
  out = overlayQueued(view, [tick(1, false), tick(2, true)]);
  assert.deepEqual(box(out).paid, [false, true], 'a tick after an untick');

  out = overlayQueued(view, [{ ...tick(1, true), state: 'parked' }]);
  assert.deepEqual(box(out).queued, [false, false], 'a parked tick is not drawn: the server refused it');
  out = overlayQueued(view, [tick(1, true, { name: 'Water' })]);
  assert.deepEqual(box(out).queued, [false, false], 'a tick for another bill on the same row is not drawn');

  const note = (at, text, state = 'pending') => ({ id: 'n' + at, op: 'setBillNotes', state, at,
    args: { cycle: '2026-09', row: 5, name: 'Rent', text } });
  out = overlayQueued(view, [note(1, 'GCash'), note(2, 'GCash 0917')]);
  assert.equal(out.rows[0].notes, 'GCash 0917', 'the newest pending note wins');
  assert.equal(out.rows[0].notesQueued, true, 'marked as queued');
  out = overlayQueued(view, [note(1, 'GCash', 'parked')]);
  assert.equal(out.rows[0].notes, '', 'a parked note is not drawn');
  assert.equal(out.rows[0].notesQueued, false, 'nor marked');

  out = overlayQueued(view, [tick(1, true), note(2, 'x')]);
  assert.deepEqual(out.totals, view.totals, 'totals stay the server\'s');
  assert.equal(out.rows[0].progress, 1875, 'and so does progress');
  assert.equal(out.rows[0].status, 'Partially funded', 'and status');
  assert.deepEqual(box(view).paid, [false, false], 'the cached view itself is never mutated');

  const payday = {
    payday: '2026-09-15', payers: ['Vin', 'Venice'],
    rows: [{ row: 9, name: 'Internet', cycle: '2026-08', paid: [false, false] }],
    totals: { each: 674.5, cash: 0, digital: 674.5, all: 1349 },
  };
  out = overlayQueued(payday, [tick(1, true, { cycle: '2026-08', row: 9, name: 'Internet', payday: '2026-09-15', payer: 'Vin' })]);
  assert.deepEqual(out.rows[0].paid, [true, false], "the payday view matches on the row's own cycle");
  assert.deepEqual(out.rows[0].queued, [true, false], 'and marks the box');

  assert.equal(overlayQueued(null, [tick(1, true)]), null, 'no view, nothing to draw over');
}

console.log('bills self-check passed');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL, with `ERR_MODULE_NOT_FOUND` for `app/bills.js`.

- [ ] **Step 3: Create `app/bills.js` with the helpers**

```js
// The Bills tab (stage 3 spec §2): the cycle view and the payday view,
// drawn from what the server sent plus whatever is still queued. The server
// does every sum (installments, progress, status, totals) and this file
// draws them as sent, so the one thing it adds to a view is which boxes and
// notes are still waiting to sync (overlayQueued). Nothing here touches the
// store or the network; main.js owns both.
import { peso, day } from './fmt.js';

/** The queued ops that belong to this tab, not the ledger. */
export const BILL_OPS = ['setBillFunded', 'setBillNotes'];

// Dropdown values no real cycle or payday can be: the Apps Script app's own
// sentinels, written as escapes (a raw NUL byte makes a file binary to grep
// and every other line-oriented tool).
export const SWAP_PAYDAY = '\u0000payday';
export const SWAP_CYCLE = '\u0000cycle';

/** The views-store key for one scope (spec §3). */
export function billsKey(mode, scope) {
  return 'bills:' + mode + ':' + scope;
}

/** 'YYYY-MM' plus one month, rolling the year at December; '' for anything
    that is not a cycle. It is the label Carry and Start show, and the cycle
    Start asks the server to create. */
export function nextCycle(cycle) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(cycle || ''));
  if (!m) return '';
  const month = Number(m[2]);
  return (Number(m[1]) + (month === 12 ? 1 : 0)) + '-' + String(month % 12 + 1).padStart(2, '0');
}

/** Same bill, judged the way the server's row guard judges it (spec §5):
    the queued item's cycle and row, still under the same name. Without the
    name, a row shifted by a hand edit would wear another bill's pending
    mark. */
function isFor(item, cycle, row) {
  return item.args.cycle === cycle && item.args.row === row.row
    && String(item.args.name || '').trim().toLowerCase() === String(row.name || '').trim().toLowerCase();
}

/**
 * A copy of `view` with every still-pending tick and note drawn over it
 * (spec §4.1). `queue` is oldest first (listQueue's order), so a later item
 * simply overwrites an earlier one: the newest pending value is what shows.
 * Each set of boxes gains `queued` (which of them are waiting), and each
 * cycle row gains `notesQueued`. Parked items are not drawn: the server
 * refused them, so the view's own value is the true one. Progress, status
 * and every total stay the server's until the sync lands; the client never
 * recomputes them.
 */
export function overlayQueued(view, queue) {
  if (!view || !view.rows) return view;
  const pending = queue.filter((i) => i.state === 'pending');
  const ticks = pending.filter((i) => i.op === 'setBillFunded');
  const notes = pending.filter((i) => i.op === 'setBillNotes');

  const boxes = (paid, cycle, row, payday) => {
    const out = { paid: paid.slice(), queued: paid.map(() => false) };
    ticks.forEach((i) => {
      const k = view.payers.indexOf(i.args.payer);
      if (k < 0 || i.args.payday !== payday || !isFor(i, cycle, row)) return;
      out.paid[k] = !!i.args.funded;
      out.queued[k] = true;
    });
    return out;
  };

  const rows = view.rows.map((r) => {
    // A payday-view row carries its own cycle and one set of boxes, for the
    // payday on screen; a cycle-view row has a schedule and a note.
    if (!r.schedule) return { ...r, ...boxes(r.paid, r.cycle, r, view.payday) };
    const note = notes.filter((i) => isFor(i, view.cycle, r)).pop();
    return {
      ...r,
      notes: note ? note.args.text : r.notes,
      notesQueued: !!note,
      schedule: r.schedule.map((s) => ({ ...s, ...boxes(s.paid, view.cycle, r, s.payday) })),
    };
  });
  return { ...view, rows };
}
```

(`peso` and `day` are imported now because Task 3's renderers in this same file use them.)

- [ ] **Step 4: Run the checks**

Run: `./check.sh`
Expected: PASS, with `bills self-check passed` after `ui self-check passed`, then `wiring self-check passed`.

- [ ] **Step 5: Commit**

```bash
git add app/bills.js selfcheck.js
git commit -m "Add the pure bill helpers: pending overlay, scope keys, next cycle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Bills tab, read-only

Both views render from the server or the cache. The tab bar works, the dropdown switches scope and view, and the app reopens where it was. Ticks, notes, Carry and Start are drawn, but their handlers arrive in Tasks 4 and 5.

**Files:**
- Modify: `app/bills.js` (append the renderers)
- Modify: `index.html` (tab bar + `#bills`)
- Modify: `app/main.js` (state, `render()`, loaders, tab/scope handlers, `online`/`offline` listeners, `boot()`)
- Modify: `app.css` (append), `sw.js`
- Modify: `wiring.js` (fixed ids, window listeners, the Bills scenario)

**Interfaces:**
- Consumes: `billsKey`, `nextCycle`, `overlayQueued`, `BILL_OPS`, `SWAP_*` (Task 2); `peso`, `day` (`app/fmt.js`).
- Produces:
  - `renderBills({ bills, queue, conn })` draws into `#bills`. `bills` is main.js's object: `{ mode, scopes: {cycle, payday}, options: {cycle: [], payday: []}, view, loading, error, busy, editingNote, noteDraft }`.
  - DOM hooks read by main.js: `#bills-scope` (select); `input[data-tick-row]` with `data-cycle`, `data-name`, `data-payday`, `data-payer`; `[data-note-row]`; `#note-input`, `#note-save`, `#note-cancel`; `[data-carry-row]`; `#bills-newcycle`; `[data-remove-id]` on parked rows.
  - main.js: `tab`, `bills`, `billsSeq`, `showBills(data)`, `rememberBills()`, `fetchBills(token)`, `keepBills(data)`, `loadBills()`, `setTab(which)`, `onScope(value)`, `onBillsChange(event)`.
  - Views-store keys: `bills:cycle:<YYYY-MM>`, `bills:payday:<YYYY-MM-DD>`, `bills:last` = `{ tab, mode, scopes }`.
  - wiring.js: `fireWindow(type)`.

- [ ] **Step 1: Let the harness reach the new elements**

In `wiring.js`, `makeDom()`'s fixed-element loop becomes:

```js
  for (const id of ['screen', 'conn', 'whoami', 'foot', 'ledger-select', 'tab-ledger', 'tab-bills', 'bills']) {
```

Replace the `globalThis.window = …` line with:

```js
// Records listeners, so a check can fire `online`/`offline` the way the
// browser would: main.js's conn.online only ever changes through them.
const windowListeners = {};
globalThis.window = {
  addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
  location: { origin: 'https://example.test' },
};
const fireWindow = (type) => (windowListeners[type] || []).forEach((fn) => fn({ type }));
```

- [ ] **Step 2: Write the failing scenario**

In `wiring.js`, inside the big main.js block, directly **before** the block commented `a silent refresh must not steal a waiting sign-in's callback`, add:

```js
  // ── the Bills tab (stage 3 spec §2–§3) ────────────────────────────────
  {
    const { SWAP_PAYDAY, SWAP_CYCLE } = await import('./app/bills.js');
    const billsEl = document.getElementById('bills');
    const scopeSelect = () => document.getElementById('bills-scope');
    const pickScope = async (value) => {
      scopeSelect().value = value;
      billsEl.dispatch('change', { target: scopeSelect() });
      await settle();
    };

    // One fetch stand-in for every op below, answering per op, so a sync
    // (queued items, then bootstrap, then the open scope) can run for real.
    const sent = [];
    const answers = { bootstrap: { ok: true, data: bootstrapView } };
    fetchImpl = async (url, req) => {
      const body = JSON.parse(req.body);
      sent.push(body);
      const a = answers[body.op];
      return { text: async () => JSON.stringify(typeof a === 'function' ? a(body.args) : (a || { ok: true, data: {} })) };
    };

    const cycleView = {
      cycle: '2026-09', cycles: ['2026-09', '2026-08'], payers: ['Vin', 'Venice'], me: 'Vin',
      rows: [
        { row: 5, name: 'Rent', amount: 7500, due_date: '2026-10-01', cutoffs: 2, method: 'digital',
          notes: '', carried: false, pending: false, installment: 1875, progress: 1875, remaining: 5625,
          status: 'Partially funded',
          schedule: [
            { payday: '2026-09-15', each: 1875, both: 3750, paid: [true, false], at: ['2026-09-15 09:30', ''], by: ['Vin', ''] },
            { payday: '2026-09-30', each: 1875, both: 3750, paid: [false, false], at: ['', ''], by: ['', ''] },
          ] },
        { row: 6, name: 'Water', amount: 510, due_date: '2026-09-20', cutoffs: 1, method: 'cash',
          notes: 'Maynilad', carried: false, pending: false, installment: 255, progress: 510, remaining: 0,
          status: 'Fully funded',
          schedule: [
            { payday: '2026-09-15', each: 255, both: 510, paid: [true, true],
              at: ['2026-09-15 09:30', '2026-09-15 10:00'], by: ['Vin', 'Venice'] },
          ] },
      ],
      totals: { billed: 8010, funded: 2385, remaining: 5625, pending: 0 },
    };
    const paydayView = {
      payday: '2026-09-15', paydays: ['2026-09-15', '2026-09-30'], payers: ['Vin', 'Venice'], me: 'Vin',
      rows: [{ row: 9, name: 'Internet', cycle: '2026-08', method: 'digital', due_date: '2026-09-20',
               each: 674.5, paid: [false, false], at: ['', ''], by: ['', ''] }],
      totals: { each: 674.5, cash: 0, digital: 674.5, all: 1349 },
    };
    answers.bills = { ok: true, data: cycleView };
    answers.payday = { ok: true, data: paydayView };

    // The stub's `hidden` starts false, so this is what proves render()
    // actually manages it rather than the assertion after the tap passing
    // on the default.
    assert.equal(billsEl.hidden, true, 'precondition: the app booted on the ledger, Bills hidden');

    navigator.onLine = true;
    document.getElementById('tab-bills').dispatch('click');
    await settle();
    assert.equal(billsEl.hidden, false, 'the Bills tab shows its panel');
    assert.equal(document.getElementById('screen').hidden, true, 'in place of the ledger');
    assert.deepEqual(sent.filter((b) => b.op === 'bills').map((b) => b.args.cycle), [''],
      'the first open asks the server for the latest cycle');
    let text = textOf(billsEl);
    assert.ok(text.includes('Rent · due oct 1'), 'a card per bill, with its due date');
    assert.ok(text.includes('₱1,875.00 / ₱7,500.00 · ₱5,625.00 remaining'), "progress, exactly as the server sent it");
    assert.ok(text.includes('Carry to 2026-10 →'), 'a fully funded bill offers to carry');
    assert.ok(text.includes('Start 2026-10'), 'Start names the cycle it will create');
    assert.ok(text.includes('30%'), 'the totals carry their ratio as a plain percentage');
    assert.ok(await db.getView('bills:cycle:2026-09'), 'cached under the scope the server named, not under ""');

    await pickScope(SWAP_PAYDAY);
    text = textOf(billsEl);
    assert.ok(text.includes('Payday sep 15, 2026'), 'the payday view names its payday');
    assert.ok(text.includes('Internet') && text.includes('Each of you') && text.includes('Both of you'),
      'one line per bill, and the payday totals');
    assert.ok(await db.getView('bills:payday:2026-09-15'), 'and is cached too');

    navigator.onLine = false;
    fireWindow('offline');
    await pickScope(SWAP_CYCLE);
    assert.ok(textOf(billsEl).includes('Rent'), 'offline, swapping back brings the cycle last opened from the cache');
    assert.equal(find(billsEl, (el) => el.dataset.carryRow === '6').disabled, true, 'Carry is disabled offline');
    assert.equal(document.getElementById('bills-newcycle').disabled, true, 'and so is Start');
    assert.ok(textOf(billsEl).includes('need a connection'), 'with a hint saying why');

    await pickScope('2026-08');
    assert.ok(textOf(billsEl).includes('Not loaded yet — connect to see this cycle.'),
      'a scope never loaded says so offline');
    assert.ok(scopeSelect().children.some((o) => o.value === '2026-09'),
      'and the dropdown still offers the way back');
    await pickScope('2026-09');
    assert.ok(textOf(billsEl).includes('Rent'), 'back on the cached cycle');
  }
```

- [ ] **Step 3: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL at `precondition: the app booted on the ledger, Bills hidden`. Nothing in main.js manages `#bills` yet.

- [ ] **Step 4: Append the renderers to `app/bills.js`**

```js
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function button(className, text) {
  const b = el('button', className, text);
  b.type = 'button';
  return b;
}

/** 'sep 15, 2026': how the Apps Script app names a payday. */
function longDay(iso) {
  return iso ? day(iso) + ', ' + String(iso).slice(0, 4) : '—';
}

/** A percentage for display only (a bar's width, the totals' ratio),
    clamped both ends: the figures come from a sheet a person can edit by
    hand, and a hand-typed extra tick must not draw a 130% bar. */
function pct(part, whole) {
  if (!Number(whole)) return 0;
  return Math.max(0, Math.min(100, Number(part) / Number(whole) * 100));
}

/** A tick's stamp ('YYYY-MM-DD HH:mm', already Manila time) as the day
    shown under its box and the hover line naming who ticked it. Split by
    hand, as fmt.day is: new Date() would read it in the phone's own zone. */
function ticked(stamp, by) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(String(stamp || ''));
  if (!m) return null;
  const h = Number(m[2]);
  return {
    day: day(m[1]),
    tip: 'Ticked ' + day(m[1]) + ', ' + (h % 12 || 12) + ':' + m[3] + (h < 12 ? ' am' : ' pm')
      + (by ? ' by ' + by : ''),
  };
}

/** Method is a tag, not a colour, as in the Apps Script app. */
function methodTag(method) {
  const t = el('span', 'tag', method);
  t.dataset.method = method;
  return t;
}

/**
 * One box per payer. Either payer may tick either box (the server's rule;
 * who tapped is taken from the session there), so every box is live.
 * Everything a tick queues rides on the box itself; main.js reads it back.
 */
function ticks(view, boxes, handle) {
  const wrap = el('span', 'ticks');
  view.payers.forEach((name, k) => {
    const label = el('label', boxes.queued[k] ? 'pending' : null);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!boxes.paid[k];
    box.dataset.tickRow = String(handle.row);
    box.dataset.cycle = handle.cycle;
    box.dataset.name = handle.name;
    box.dataset.payday = handle.payday;
    box.dataset.payer = name;
    label.appendChild(box);
    label.appendChild(el('span', null, name));
    if (boxes.queued[k]) {
      label.appendChild(el('span', 'tick-at', 'pending'));
    } else if (box.checked) {
      const when = ticked(boxes.at && boxes.at[k], boxes.by && boxes.by[k]);
      if (when) {
        label.title = when.tip;
        label.appendChild(el('span', 'tick-at', when.day));
      }
    }
    wrap.appendChild(label);
  });
  return wrap;
}

/** The note (tap to edit, or Add note) and, at the end of the row, the
    carry: a button once the bill is fully funded, a check once it is in the
    next cycle. The server re-checks both before carrying; the button
    showing only then is a courtesy, not the guard. */
function noteLine(view, r, ctx) {
  const line = el('div', 'bill-note');
  if (ctx.editingNote === r.row) {
    const input = el('textarea', 'note-input');
    input.id = 'note-input';
    input.setAttribute('maxlength', '500');
    input.setAttribute('rows', '2');
    input.setAttribute('aria-label', 'Note');
    input.value = ctx.noteDraft;
    line.appendChild(input);
    const save = button('linkish', 'Save');
    save.id = 'note-save';
    line.appendChild(save);
    const cancel = button('linkish', 'Cancel');
    cancel.id = 'note-cancel';
    line.appendChild(cancel);
    return line;
  }

  const text = button('linkish note-text' + (r.notesQueued ? ' pending' : ''),
    (r.notes || 'Add note') + (r.notesQueued ? ' · pending' : ''));
  text.dataset.empty = String(!r.notes);
  text.dataset.noteRow = String(r.row);
  line.appendChild(text);

  const carry = el('span', 'carry');
  const next = nextCycle(view.cycle);
  if (r.carried) {
    carry.textContent = 'In ' + next + ' ✓';
  } else if (r.status === 'Fully funded') {
    const btn = button('carry-btn', 'Carry to ' + next + ' →');
    btn.dataset.carryRow = String(r.row);
    btn.disabled = !ctx.canAct;
    carry.appendChild(btn);
  }
  line.appendChild(carry);
  return line;
}

/** One card per bill (spec §2.1): head, schedule, progress, note. */
function billCard(view, r, ctx) {
  const card = el('div', 'bill-card');
  const head = el('div', 'bill-head');
  head.appendChild(el('span', 'bill-name', r.name + (r.due_date ? ' · due ' + day(r.due_date) : '')));
  head.appendChild(methodTag(r.method));
  head.appendChild(el('span', 'fig', r.pending ? '—' : peso(r.amount)));
  const status = el('span', 'bill-status', r.status);
  status.dataset.s = r.status; // app.css colours Overdue and Fully funded
  head.appendChild(status);
  card.appendChild(head);

  r.schedule.forEach((s) => {
    const line = el('div', 'sched');
    line.appendChild(el('span', 'sched-day', day(s.payday)));
    line.appendChild(el('span', 'sched-amt fig', peso(s.both)));
    line.appendChild(ticks(view, s, { cycle: view.cycle, row: r.row, name: r.name, payday: s.payday }));
    card.appendChild(line);
  });

  if (!r.pending) {
    const foot = el('div', 'bill-foot');
    const bar = el('div', 'bar');
    bar.setAttribute('aria-hidden', 'true'); // the line under it says the same in words
    const fill = el('i');
    fill.style.width = pct(r.progress, r.amount) + '%';
    bar.appendChild(fill);
    foot.appendChild(bar);
    foot.appendChild(el('span', null,
      peso(r.progress) + ' / ' + peso(r.amount) + ' · ' + peso(r.remaining) + ' remaining'));
    card.appendChild(foot);
  }

  card.appendChild(noteLine(view, r, ctx));
  return card;
}

/** One line per bill funded from the payday on screen (spec §2.2). The
    boxes tick the row's own cycle, never a blank one. */
function paydayLine(view, r) {
  const line = el('div', 'sched');
  line.appendChild(el('span', 'sched-day', r.name));
  line.appendChild(methodTag(r.method));
  line.appendChild(el('span', 'sched-amt fig', peso(r.each)));
  line.appendChild(ticks(view, r, { cycle: r.cycle, row: r.row, name: r.name, payday: view.payday }));
  return line;
}

/** The footer figures, as sent. The cycle view's percentage stands in for
    the Apps Script app's decorative ring (spec §2.3): same number, no SVG. */
function totals(t, isPayday) {
  const box = el('div', 'totals');
  if (!isPayday) box.appendChild(el('span', 'totals-pct fig', Math.round(pct(t.funded, t.billed)) + '%'));
  const rows = isPayday
    ? [['Each of you', t.each], ['Cash', t.cash], ['Digital', t.digital], ['Both of you', t.all, true]]
    : [['Billed', t.billed], ['Funded', t.funded], ['Remaining', t.remaining, true]];
  const list = el('dl', 'totals-list');
  rows.forEach(([label, value, grand]) => {
    list.appendChild(el('dt', grand ? 'grand' : null, label));
    list.appendChild(el('dd', grand ? 'fig grand' : 'fig', peso(value)));
  });
  box.appendChild(list);
  return box;
}

/** A bill item the server refused (spec §4.4), with its message and
    Discard. There is no Reopen: tapping the box again is the retry. It
    reuses the ledger's .txn row and data-remove-id, which main.js handles. */
function parkedRow(item) {
  const a = item.args;
  const row = el('div', 'txn');
  const body = el('div', 'txn-body');
  body.appendChild(el('div', 'txn-title',
    a.name + (item.op === 'setBillNotes' ? ' · note' : ' · ' + a.payer + ' ' + day(a.payday))));
  body.appendChild(el('div', 'txn-meta', item.error || 'Could not send.'));
  row.appendChild(body);
  const right = el('div', 'txn-right');
  const discard = button('linkish pending-mark', 'Discard');
  discard.dataset.removeId = item.id;
  right.appendChild(discard);
  row.appendChild(right);
  return row;
}

const OFFLINE_HINT = "You're offline — ticks and notes sync when you reconnect; carrying a bill and starting a cycle need a connection.";
const SIGNED_OUT_HINT = 'Sign in again to carry a bill or start a cycle.';

/**
 * Draws the Bills tab into #bills, which index.html creates once, as it does
 * #screen: the heading and scope dropdown, refused items, the pending
 * banner, the cards or payday lines, the totals, Start, and a hint line.
 * `state` is { bills, queue, conn }, with `bills` being main.js's own object.
 */
export function renderBills(state) {
  const host = document.getElementById('bills');
  host.textContent = '';
  const b = state.bills;
  const isPayday = b.mode === 'payday';
  const view = overlayQueued(b.view, state.queue);
  const scope = b.scopes[b.mode];
  // Carry and Start go straight to the server (spec §4.3). Offline or signed
  // out they could only fail, so they are disabled rather than offered.
  const canAct = state.conn.online && !state.conn.needsAuth && !b.busy;

  const head = el('div', 'section-head');
  head.appendChild(el('h2', null, isPayday
    ? (scope ? 'Payday ' + longDay(scope) : (view ? 'No paydays yet' : 'Payday'))
    : (scope || (view ? 'No cycles yet' : 'Bills'))));
  const select = el('select', 'ledger-select');
  select.id = 'bills-scope';
  select.setAttribute('aria-label', 'Cycle or payday');
  // The list the server last sent for this view, kept by main.js even when
  // the scope on screen was never loaded, so there is always a way back.
  const opts = b.options[b.mode].slice();
  if (!opts.includes(scope)) opts.unshift(scope);
  opts.forEach((o) => {
    const opt = el('option', null, isPayday ? longDay(o) : (o || '—'));
    opt.value = o;
    select.appendChild(opt);
  });
  const swap = el('option', null, isPayday ? '↔ by cycle' : '↔ by payday');
  swap.value = isPayday ? SWAP_CYCLE : SWAP_PAYDAY;
  select.appendChild(swap);
  select.value = scope;
  head.appendChild(select);
  host.appendChild(head);

  state.queue
    .filter((i) => i.state === 'parked' && BILL_OPS.includes(i.op))
    .forEach((item) => host.appendChild(parkedRow(item)));

  const missing = view && !isPayday && view.totals ? view.totals.pending : 0;
  if (missing) {
    host.appendChild(el('p', 'banner', missing + (missing === 1 ? ' bill needs' : ' bills need')
      + ' an amount or due date — add them in the Bill Tracker tab.'));
  }

  if (!view) {
    host.appendChild(el('p', 'empty', b.loading ? 'Loading…'
      : state.conn.online ? 'Not loaded yet.'
      : 'Not loaded yet — connect to see this ' + (isPayday ? 'payday.' : 'cycle.')));
  } else if (!view.rows.length) {
    host.appendChild(el('p', 'empty', 'Nothing here yet.'));
  } else if (isPayday) {
    view.rows.forEach((r) => host.appendChild(paydayLine(view, r)));
    host.appendChild(totals(view.totals, true));
  } else {
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft };
    view.rows.forEach((r) => host.appendChild(billCard(view, r, ctx)));
    host.appendChild(totals(view.totals, false));
  }

  if (!isPayday && view && view.cycle) {
    const next = nextCycle(view.cycle);
    const start = button('more', next ? 'Start ' + next : 'Start next cycle');
    start.id = 'bills-newcycle';
    start.disabled = !canAct;
    host.appendChild(start);
  }

  const hint = el('p', 'hint');
  hint.id = 'bills-hint';
  hint.setAttribute('role', 'status');
  if (b.error) {
    hint.textContent = b.error;
    hint.setAttribute('data-state', 'error');
  } else if (b.busy) {
    hint.textContent = b.busy === 'carry' ? 'Carrying…' : 'Starting ' + nextCycle(view && view.cycle) + '…';
  } else if (!state.conn.online) {
    hint.textContent = OFFLINE_HINT;
  } else if (state.conn.needsAuth) {
    hint.textContent = SIGNED_OUT_HINT;
  }
  host.appendChild(hint);
}
```

- [ ] **Step 5: The tab bar and panel in `index.html`**

Replace `<main id="screen"></main>` with:

```html
  <div class="views" role="tablist">
    <button type="button" class="view-tab" id="tab-ledger" role="tab" aria-selected="true" aria-controls="screen">Ledger</button>
    <button type="button" class="view-tab" id="tab-bills" role="tab" aria-selected="false" aria-controls="bills">Bills</button>
  </div>
  <main id="screen" role="tabpanel"></main>
  <!-- Filled by app/bills.js's renderBills; shown in place of #screen while
       the Bills tab is open. -->
  <section class="bills" id="bills" role="tabpanel" hidden></section>
```

- [ ] **Step 6: Wire it in `app/main.js`**

Import, after the `ui.js` import:

```js
import { renderBills, billsKey, SWAP_PAYDAY, SWAP_CYCLE } from './bills.js';
```

State, directly after `let draft = null;`:

```js
// The Bills tab (stage 3 spec §2–§4). `tab` is which of the two panels
// shows. In `bills`: `mode` is 'cycle' or 'payday'; `scopes` is the scope
// last opened in each mode ('' until the server has named the latest), so
// swapping modes offline comes back to something cached; `options` is the
// dropdown list the server last sent for each mode, kept because a scope
// never loaded has no view to read one from; `view` is the scope on screen,
// from the server or the cache; `loading` a fetch in flight; `error` the
// last refusal or failed load, shown on the bills hint line; `busy` the
// online-only action in flight ('carry' or 'new'); `editingNote` the row
// whose note editor is open, and `noteDraft` what is typed there, kept
// across repaints as `draft` is for the entry form.
let tab = 'ledger';
const bills = {
  mode: 'cycle', scopes: { cycle: '', payday: '' }, options: { cycle: [], payday: [] },
  view: null, loading: false, error: '', busy: '', editingNote: null, noteDraft: '',
};
// Which bills request is still wanted. A reply that lands after the person
// has moved to another scope is for a view nobody is looking at any more.
let billsSeq = 0;
```

In `render()`, the `if (log) { … } else { … }` becomes a three-way branch:

```js
  if (tab === 'bills') {
    renderBills({ bills, queue, conn });
  } else if (log) {
```

(the rest of the existing branch unchanged). Directly after that branch, before `renderConn(conn);`, add `renderTabs();`, and define beside `render()`:

```js
/** The Ledger | Bills tab bar (spec §2), and which panel shows. Both tabs
    and both panels are fixed in index.html, like #conn. */
function renderTabs() {
  const onBills = tab === 'bills';
  document.getElementById('screen').hidden = onBills;
  document.getElementById('bills').hidden = !onBills;
  document.getElementById('tab-ledger').setAttribute('aria-selected', String(!onBills));
  document.getElementById('tab-bills').setAttribute('aria-selected', String(onBills));
}
```

The loaders and handlers. Put them after `switchLedger`, before `boot`:

```js
/** Puts a bills view on screen and keeps the dropdown list it came with. */
function showBills(data) {
  bills.view = data;
  if (data) bills.options[bills.mode] = (bills.mode === 'payday' ? data.paydays : data.cycles) || [];
}

/** So the app reopens on this tab, view and scope after a reload (spec §3). */
function rememberBills() {
  return putView('bills:last', { tab, mode: bills.mode, scopes: bills.scopes });
}

/** Shows and caches a bills view the server sent, under the scope the
    server named. For '' that is the latest, which is the key a later
    offline open looks for. */
async function keepBills(data) {
  const scope = (bills.mode === 'payday' ? data.payday : data.cycle) || '';
  bills.scopes[bills.mode] = scope;
  showBills(data);
  if (scope) await putView(billsKey(bills.mode, scope), data);
  await rememberBills();
}

/** Asks the server for the scope on screen. Returns the envelope, so each
    caller reports a failure its own way. */
async function fetchBills(token) {
  const seq = ++billsSeq;
  const mode = bills.mode;
  const scope = bills.scopes[mode];
  const res = mode === 'payday'
    ? await api.call('payday', { payday: scope }, token)
    : await api.call('bills', { cycle: scope }, token);
  // Superseded: the person moved on, so there is nothing to show or report.
  if (seq !== billsSeq) return { ok: true };
  if (res.ok) await keepBills(res.data);
  return res;
}

/** Opens the scope in `bills`: the cached copy at once, then the server's
    when online (spec §3). Offline, a scope never loaded has no view, and
    renderBills says so. */
async function loadBills() {
  billsSeq += 1; // whatever was in flight was for the scope being left
  const scope = bills.scopes[bills.mode];
  showBills(scope ? await getView(billsKey(bills.mode, scope)) : null);
  bills.error = '';
  bills.editingNote = null;
  bills.loading = navigator.onLine;
  render();
  if (!navigator.onLine) return;
  try {
    const auth = await currentAuth();
    const res = auth && auth.token
      ? await fetchBills(auth.token)
      : { ok: false, kind: 'auth', error: 'Sign in again to see the bills.' };
    if (!res.ok) {
      if (res.kind === 'auth') conn.needsAuth = true; // same signal sync() arms
      bills.error = res.error || 'Could not load the bills.';
    }
  } finally {
    bills.loading = false;
    if (tab === 'bills') render();
  }
}

/** A tap on the tab bar. Like the Apps Script app's showView, changing tab
    closes the log and leaves edit mode. */
async function setTab(which) {
  if (which === tab) return;
  tab = which;
  log = null;
  leaveEditMode();
  await rememberBills();
  if (tab === 'bills') await loadBills();
  else render();
}

/** The scope dropdown: a cycle or payday, or the swap to the other view,
    which comes back to that view's last-opened scope. */
async function onScope(value) {
  if (value === SWAP_PAYDAY) bills.mode = 'payday';
  else if (value === SWAP_CYCLE) bills.mode = 'cycle';
  else bills.scopes[bills.mode] = value;
  await rememberBills();
  await loadBills();
}

function onBillsChange(event) {
  const t = event.target;
  if (t.id === 'bills-scope') onScope(t.value);
}
```

In `boot()`, with the other listeners:

```js
  document.getElementById('tab-ledger').addEventListener('click', () => setTab('ledger'));
  document.getElementById('tab-bills').addEventListener('click', () => setTab('bills'));
  document.getElementById('bills').addEventListener('change', onBillsChange);
```

In both the `online` and `offline` listeners, change `if (log) render();` to `if (log || tab === 'bills') render();`. Carry and Start must disable on the spot, for the same reason the ledger switcher does.

In `boot()`, replace the lines `view = await getView('bootstrap'); queue = await store.listQueue(); render();` with:

```js
  // Reopens on the tab, view and scopes last used (spec §3). Only the
  // cached copy here: the sync just below refetches the open scope.
  const last = await getView('bills:last');
  if (last) {
    tab = last.tab === 'bills' ? 'bills' : 'ledger';
    bills.mode = last.mode === 'payday' ? 'payday' : 'cycle';
    bills.scopes = { cycle: '', payday: '', ...last.scopes };
  }
  const lastScope = bills.scopes[bills.mode];
  if (tab === 'bills' && lastScope) showBills(await getView(billsKey(bills.mode, lastScope)));

  view = await getView('bootstrap');
  queue = await store.listQueue();
  render();
```

- [ ] **Step 7: Styles and the service worker**

Append to `app.css` (copied from `Home_Economy_PWA/home-economy-app/src/Index.html`'s `<style>`, except `.totals-pct` and `#bills-hint`, which are new):

```css
/* ── bills (stage 3) — carried from the sibling app ── */

.views {
  display: flex;
  gap: 20px;
  padding: 14px var(--pad) 0;
}
.view-tab {
  min-height: 32px;
  padding: 0 0 8px;
  font: 400 11px var(--display);
  text-transform: uppercase;
  letter-spacing: var(--track);
  color: var(--muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.view-tab[aria-selected="true"] {
  color: var(--ink);
  font-weight: 500;
  border-bottom-color: var(--ink);
}

.bill-name { font-size: 15px; }

/* Method is a tag, not a colour. The old sheet used red alone to mean cash,
   which is invisible to anyone who cannot separate the two hues. */
.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 0.5px solid var(--hairline);
}
.tag[data-method="cash"] { color: var(--out); border-color: currentColor; }

.ticks { flex: 0 0 auto; display: flex; gap: 10px; }
.ticks label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.ticks input { width: 20px; height: 20px; margin: 0; accent-color: var(--ink); }
.tick-at { font-size: 10px; line-height: 1; }

.bar {
  height: 2px;
  margin: 2px 0 8px;
  background: var(--hairline);
  border-radius: 2px;
  overflow: hidden;
}
.bar > i { display: block; height: 100%; background: var(--ink); }

.totals {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px var(--pad);
  border-top: 0.5px solid var(--hairline);
  font-size: 14px;
}
.totals-list {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
  margin: 0;
}
.totals dt { color: var(--muted); }
.totals dd { margin: 0; }
.totals .grand { font-weight: 500; }
/* Stands in for the sibling app's decorative ring: the same number, as text. */
.totals-pct { flex: 0 0 auto; font: 400 22px var(--display); }

.banner {
  margin: 0;
  padding: 10px var(--pad);
  border-top: 0.5px solid var(--hairline);
  border-bottom: 0.5px solid var(--hairline);
  background: var(--surface);
  color: var(--out);
  font-size: 13px;
}
.empty {
  padding: 22px var(--pad);
  border-top: 0.5px solid var(--hairline);
  border-bottom: 0.5px solid var(--hairline);
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
}

.bill-card {
  margin: 10px var(--pad);
  border: 0.5px solid var(--hairline);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}
.bill-card .bill-head,
.bill-card .sched,
.bill-card .bill-foot,
.bill-card .bill-note {
  padding-left: 14px;
  padding-right: 14px;
}
.bill-card .bill-head { border-top: none; padding-top: 14px; }
.bill-card .bill-note { padding-bottom: 14px; }

.bill-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px var(--pad) 4px;
  border-top: 0.5px solid var(--hairline);
  background: var(--surface);
}
.bill-head .bill-name { flex: 1 1 auto; font-size: 15px; }
.bill-status { flex: 0 0 auto; font-size: 11px; color: var(--muted); }
.bill-status[data-s="Overdue"] { color: var(--out); }
.bill-status[data-s="Fully funded"] { color: var(--in); }

.bill-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 12px;
  padding: 10px var(--pad) 16px 28px;
  background: var(--surface);
  font-size: 12px;
}
.note-text {
  flex: 1 1 220px;
  min-width: 0;
  padding: 2px 0;
  text-align: left;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.note-text[data-empty="false"] {
  color: var(--muted);
  text-decoration: none;
  white-space: pre-wrap;
}
.carry { flex: 0 0 auto; color: var(--muted); }
.carry-btn {
  min-height: 34px;
  padding: 7px 14px;
  font: 400 12px var(--sans);
  color: var(--ink);
  background: var(--surface);
  border: 0.5px solid var(--hairline);
  border-radius: 999px;
  cursor: pointer;
}
.carry-btn:disabled { opacity: 0.5; cursor: default; }
/* 16px, not the 13px around it: iOS zooms the page on focus below 16px. */
.note-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 8px 10px;
  font: 400 16px var(--sans);
  color: var(--ink);
  background: var(--well);
  border: none;
  border-radius: var(--radius-sm);
  resize: vertical;
}

.sched {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px var(--pad) 6px 28px;
  background: var(--surface);
  font-size: 13px;
}
.sched-day { flex: 0 0 auto; color: var(--muted); width: 62px; }
.sched-amt { flex: 1 1 auto; }
.bill-foot {
  padding: 4px var(--pad) 12px 28px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
}
#bills-hint { padding: 0 var(--pad); }
```

In `sw.js`: add `'app/bills.js'` to `SHELL` after `'app/ui.js'`, and change `CACHE` to `'home-economy-v14'`.

- [ ] **Step 8: Run the checks**

Run: `./check.sh`
Expected: PASS, every line through `wiring self-check passed`. The earlier wiring scenarios must still pass unchanged. `bills:last` is absent at their boot, so the app starts on the ledger.

- [ ] **Step 9: Commit**

```bash
git add app/bills.js app/main.js index.html app.css sw.js wiring.js
git commit -m "Show the Bills tab: both views, cached per scope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ticks and notes through the queue, parked items, the post-sync refetch

**Files:**
- Modify: `app/main.js`
- Modify: `wiring.js` (a ui-level block, plus a continuation of Task 3's Bills scenario)

**Interfaces:**
- Consumes: Task 3's `bills`, `billsSeq`, `fetchBills`, `loadBills`, the DOM hooks; Task 2's `overlayQueued`.
- Produces: `queueOp(op, args)`, the single serialized path to `enqueue`; `removeItem(id)`; `queueBill(op, args)`; `onTick(box)`; `openNote(row)`; `saveNote()`; `onBillsClick(event)`. `sync()` refetches the open bill scope.
- Wire shapes (spec §4.1): `setBillFunded` `{ cycle, row, name, payday, funded, payer }` and `setBillNotes` `{ cycle, row, name, text }`, where `row` is a number and `funded` a boolean.

- [ ] **Step 1: Pin that the ledger ignores bill items**

In `wiring.js`, after the block commented `each queued item is said once, where it belongs`, add:

```js
// ── bill items never reach the ledger's list or balances (stage 3 spec §4.4) ──
{
  const billItems = [
    { id: 'b1', op: 'setBillFunded', state: 'pending',
      args: { cycle: '2026-09', row: 5, name: 'Rent', payday: '2026-09-30', funded: true, payer: 'Venice' } },
    { id: 'b2', op: 'setBillNotes', state: 'parked', error: 'Notes can be at most 500 characters.',
      args: { cycle: '2026-09', row: 5, name: 'Rent', text: 'x' } },
  ];
  assert.equal(ui.pendingBalance(billItems, 'Rent', 'Bills'), 0, 'a queued tick is not money in any account');
  ui.renderEntry({ view: null, queue: [], conn: { online: true } });
  ui.renderPending(billItems, 'Bills');
  assert.equal(textOf(document.getElementById('pending-list')), '', "the ledger's pending list skips bill items");
  ui.renderPending(billItems, '');
  assert.equal(textOf(document.getElementById('pending-list')), '', 'even before the first sync, with no ledger yet');
}
```

These pin behaviour that already holds. They pass now and must keep passing.

- [ ] **Step 2: Write the failing scenario**

In `wiring.js`, inside Task 3's Bills block, append after its last assertion (`'back on the cached cycle'`), still offline:

```js
    // ── ticks and notes go through the queue, online or not (spec §4.1) ──
    const box = (row, payday, payer) => find(billsEl, (el) =>
      el.dataset.tickRow === row && el.dataset.payday === payday && el.dataset.payer === payer);
    const tickBox = async (row, payday, payer) => {
      const b = box(row, payday, payer);
      b.checked = true; // what a real checkbox already shows the instant `change` fires
      billsEl.dispatch('change', { target: b });
      await settle();
    };

    await tickBox('5', '2026-09-30', 'Venice');
    let queued = await db.listQueue();
    assert.deepEqual(queued.find((i) => i.op === 'setBillFunded').args,
      { cycle: '2026-09', row: 5, name: 'Rent', payday: '2026-09-30', funded: true, payer: 'Venice' },
      'an offline tick queues the bill, the payday, whose share, and the name the server re-checks');
    assert.equal(box('5', '2026-09-30', 'Venice').checked, true, 'the box shows its queued value');
    assert.ok(textOf(box('5', '2026-09-30', 'Venice').parent).includes('pending'), 'marked pending');
    assert.ok(textOf(billsEl).includes('₱1,875.00 / ₱7,500.00'), "progress stays the server's until it syncs");

    billsEl.dispatch('click', { target: find(billsEl, (el) => el.dataset.noteRow === '5') });
    const noteInput = document.getElementById('note-input');
    assert.ok(noteInput, 'tapping Add note opens the editor');
    noteInput.value = 'GCash 0917';
    billsEl.dispatch('input', { target: noteInput });
    billsEl.dispatch('click', { target: document.getElementById('note-save') });
    await settle();
    queued = await db.listQueue();
    assert.deepEqual(queued.find((i) => i.op === 'setBillNotes').args,
      { cycle: '2026-09', row: 5, name: 'Rent', text: 'GCash 0917' }, 'a note is queued with its bill');
    assert.ok(textOf(billsEl).includes('GCash 0917 · pending'), 'and shows its queued text, pending');

    await pickScope(SWAP_PAYDAY);
    await tickBox('9', '2026-09-15', 'Vin');
    queued = await db.listQueue();
    assert.deepEqual(queued.filter((i) => i.op === 'setBillFunded').pop().args,
      { cycle: '2026-08', row: 9, name: 'Internet', payday: '2026-09-15', funded: true, payer: 'Vin' },
      "from the payday view, the row's own cycle travels, not a blank");
    await pickScope(SWAP_CYCLE);

    document.getElementById('tab-ledger').dispatch('click');
    await settle();
    const ledgerText = textOf(document.getElementById('screen'));
    assert.ok(!ledgerText.includes('Rent') && !ledgerText.includes('Internet'),
      "the ledger's pending list ignores queued bill items");
    assert.ok(!ledgerText.includes('pending'), 'and no balance claims to include them');
    document.getElementById('tab-bills').dispatch('click');
    await settle();

    // ── a sync with the tab open refetches it (spec §4.2); a refused tick
    // parks with Discard (§4.4) ─────────────────────────────────────────
    const fresh = structuredClone(cycleView);
    fresh.rows[0].schedule[1].paid = [false, true];
    fresh.rows[0].notes = 'GCash 0917';
    answers.bills = { ok: true, data: fresh };
    answers.setBillFunded = (args) => (args.row === 9
      ? { ok: false, kind: 'conflict', error: 'That bill could not be found. Reload and try again.' }
      : { ok: true, data: {} });
    answers.setBillNotes = { ok: true, data: {} };
    sent.length = 0;
    navigator.onLine = true;
    fireWindow('online'); // the real trigger: conn.online, then sync()
    await settle();
    navigator.onLine = false;
    fireWindow('offline'); // and clears the retry the parked item would leave running

    assert.deepEqual(sent.map((b) => b.op), ['setBillFunded', 'setBillNotes', 'setBillFunded', 'bootstrap', 'bills'],
      'the queue drains oldest first, then bootstrap, then the open scope');
    assert.equal(sent[4].args.cycle, '2026-09', 'the refetch asks for the scope on screen');
    assert.equal(box('5', '2026-09-30', 'Venice').checked, true, "the server's own figures now carry the tick");
    assert.ok(!textOf(billsEl).includes('pending'), 'and every pending mark is gone');
    assert.ok(textOf(billsEl).includes('That bill could not be found'), "the refused tick is listed with the server's message");
    const discard = find(billsEl, (el) => el.dataset.removeId !== undefined);
    assert.equal(discard.textContent, 'Discard', 'offering Discard');
    billsEl.dispatch('click', { target: discard });
    await settle();
    assert.equal((await db.listQueue()).length, 0, 'Discard drops it');
    assert.ok(!textOf(billsEl).includes('could not be found'), 'and it leaves the list');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL at `an offline tick queues…`, because nothing handles the checkbox's `change` yet (`find` returns `undefined`, so reading `.args` throws).

- [ ] **Step 4: Implement in `app/main.js`**

Import `overlayQueued` too: `import { renderBills, overlayQueued, billsKey, SWAP_PAYDAY, SWAP_CYCLE } from './bills.js';`

The serializer, directly after `let submitting = false;`:

```js
// Every enqueue in this module goes through here, one at a time. enqueue
// reads the queue's newest `at` and writes one past it, which is not
// atomic, so two overlapping calls can read the same max and tie, and a
// tie is broken by random id. For entries that decides the order money
// lands in; for ticks, which of two quick taps on one box is the newest
// (spec §4.1). `submitting` still stops a double submit; this stops two
// different taps racing.
let enqueued = Promise.resolve();
function queueOp(op, args) {
  const next = enqueued.then(() => enqueue(store, op, args));
  enqueued = next.catch(() => {});
  return next;
}
```

Route the three existing calls through it. In `onSubmit`, use `await queueOp('updateEntry', { … })` and `await queueOp('addEntry', { entry })`. In `onVoid`, use `await queueOp('voidEntry', { … })`. The arguments stay exactly as they are.

Extract the removal from `onScreenClick`:

```js
/** Drops one queued item (Remove, or Discard on either tab). Touches
    nothing on the server. */
async function removeItem(id) {
  await removeQueued(id);
  queue = await store.listQueue();
  render();
}
```

In `onScreenClick`, the `[data-remove-id]` branch becomes `if (button) { removeItem(button.dataset.removeId); return; }`.

The bill handlers, after `onBillsChange`:

```js
/** A tick or a note, queued like an entry even online (spec §4.1): one
    path to the server. The queued value shows at once, marked pending. */
async function queueBill(op, args) {
  await queueOp(op, args);
  queue = await store.listQueue();
  render();
  if (navigator.onLine) sync();
}

/** A tick sets a value rather than toggling one, so a second tap simply
    queues the opposite value, and the newest is what shows and lands. */
function onTick(box) {
  const d = box.dataset;
  queueBill('setBillFunded', {
    cycle: d.cycle, row: Number(d.tickRow), name: d.name,
    payday: d.payday, funded: !!box.checked, payer: d.payer,
  });
}

function openNote(row) {
  const shown = overlayQueued(bills.view, queue);
  const r = shown && shown.rows.find((x) => x.row === row);
  if (!r) return;
  bills.editingNote = row;
  bills.noteDraft = r.notes || ''; // the newest queued text, when there is one
  render();
}

async function saveNote() {
  const r = bills.view && bills.view.rows.find((x) => x.row === bills.editingNote);
  if (!r) return;
  // The server's own limit (validateNotes_), checked here only as a
  // courtesy: an over-long note would otherwise park after the fact.
  if (bills.noteDraft.trim().length > 500) {
    bills.error = 'Notes can be at most 500 characters.';
    render();
    return;
  }
  bills.error = '';
  bills.editingNote = null;
  await queueBill('setBillNotes', { cycle: bills.view.cycle, row: r.row, name: r.name, text: bills.noteDraft });
}

function onBillsClick(event) {
  const t = event.target;
  const discard = t.closest('[data-remove-id]');
  if (discard) { removeItem(discard.dataset.removeId); return; }
  const note = t.closest('[data-note-row]');
  if (note) { openNote(Number(note.dataset.noteRow)); return; }
  if (t.closest('#note-cancel')) { bills.editingNote = null; render(); return; }
  if (t.closest('#note-save')) saveNote();
}
```

In `onBillsChange`, add after the scope branch:

```js
  if (t.dataset && t.dataset.tickRow !== undefined) onTick(t);
```

In `boot()`, beside the `change` listener on `#bills`:

```js
  document.getElementById('bills').addEventListener('click', onBillsClick);
  document.getElementById('bills').addEventListener('input', (e) => {
    if (e.target.id === 'note-input') bills.noteDraft = e.target.value;
  });
```

In `sync()`, directly after `view = res.data;` and before `conn.error = '';`:

```js
    // Spec §4.2: with the Bills tab open, its scope is refetched too, so
    // pending marks clear against the server's own figures. A failure
    // leaves the cached view up and says so on the connection line, as a
    // failed bootstrap does, and does not move the clock.
    if (tab === 'bills') {
      const b = await fetchBills(auth.token);
      if (!b.ok) {
        if (b.kind === 'auth') conn.needsAuth = true;
        conn.error = b.error || 'Could not load the bills.';
        return;
      }
    }
```

- [ ] **Step 5: Run the checks**

Run: `./check.sh`
Expected: PASS through `wiring self-check passed`. The stage 2 submit, edit and void scenarios still pass through `queueOp`.

- [ ] **Step 6: Commit**

```bash
git add app/main.js wiring.js
git commit -m "Queue bill ticks and notes, and refetch the open scope after a sync

Every enqueue now runs through one serialized path, so two quick taps
cannot tie on their ordering stamp. A refused bill item parks at the top
of the Bills tab with Discard.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Carry and Start next cycle, online only

**Files:**
- Modify: `app/main.js`
- Modify: `wiring.js` (append to the Bills scenario)

**Interfaces:**
- Consumes: `keepBills`, `billsSeq`, `bills` (Task 3); `nextCycle` (Task 2); `onBillsClick` (Task 4).
- Produces: `billsAction(kind, op, args, fallback)`, `onCarry(row)`, `onStart()`. Wire: `carryBill` `{ cycle, row }` and `newCycle` `{ cycle: nextCycle(view.cycle) }`, each a direct `api.call` that returns a cycle view.

- [ ] **Step 1: Write the failing scenario**

In `wiring.js`, append to the Bills block, after `'and it leaves the list'`:

```js
    // ── Carry and Start go straight to the server, online only (spec §4.3) ──
    navigator.onLine = true;
    fireWindow('online'); // its sync finds an empty queue: bootstrap, then the scope
    await settle();
    const carryBtn = () => find(billsEl, (el) => el.dataset.carryRow === '6');
    assert.equal(carryBtn().disabled, false, 'online, Carry is live');

    answers.carryBill = { ok: false, kind: 'conflict', error: 'That bill is already in the next cycle.' };
    billsEl.dispatch('click', { target: carryBtn() });
    await settle();
    assert.ok(textOf(billsEl).includes('already in the next cycle'), "a refusal shows the server's message");
    assert.equal(carryBtn().disabled, false, 'and re-enables the button');

    const carried = structuredClone(fresh);
    carried.rows[1].carried = true;
    answers.carryBill = { ok: true, data: carried };
    billsEl.dispatch('click', { target: carryBtn() });
    await settle();
    assert.ok(textOf(billsEl).includes('In 2026-10 ✓'), 'a carried bill says where it went');
    assert.equal((await db.getView('bills:cycle:2026-09')).rows[1].carried, true, 'and the returned view is cached');
    assert.deepEqual(sent.filter((b) => b.op === 'carryBill').map((b) => b.args),
      [{ cycle: '2026-09', row: 6 }, { cycle: '2026-09', row: 6 }], 'carry names the cycle and the row');
    assert.equal((await db.listQueue()).length, 0, 'and never touches the queue');

    answers.newCycle = { ok: true, data: { ...cycleView, cycle: '2026-10', cycles: ['2026-10', '2026-09', '2026-08'],
                                           rows: [], totals: { billed: 0, funded: 0, remaining: 0, pending: 0 } } };
    billsEl.dispatch('click', { target: document.getElementById('bills-newcycle') });
    await settle();
    assert.deepEqual([sent.at(-1).op, sent.at(-1).args], ['newCycle', { cycle: '2026-10' }],
      'Start asks for the cycle after the one on screen');
    assert.ok(textOf(billsEl).includes('Start 2026-11'), 'the new cycle is shown, and Start moves on');
    assert.ok(await db.getView('bills:cycle:2026-10'), 'cached under its own key');

    navigator.onLine = false;
    fireWindow('offline');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL at `a refusal shows the server's message`, because nothing handles the carry click yet.

- [ ] **Step 3: Implement in `app/main.js`**

Add `nextCycle` to the `./bills.js` import. Then, after `saveNote`:

```js
/** Carry and Start next cycle go straight to the server, never through
    the queue (spec §4.3): both add rows, the server re-derives every
    precondition inside its lock, and queueing them would only widen the
    window for a stale decision. Both answer with a cycle view, which is
    shown and cached. Their buttons are disabled offline and signed out;
    the guard here is the second line. */
async function billsAction(kind, op, args, fallback) {
  if (bills.busy || !navigator.onLine || conn.needsAuth) return;
  bills.busy = kind;
  bills.error = '';
  render();
  try {
    const auth = await currentAuth();
    const res = auth && auth.token
      ? await api.call(op, args, auth.token)
      : { ok: false, kind: 'auth', error: 'Sign in again to continue.' };
    if (res.ok) {
      billsSeq += 1; // a load still in flight is older than this answer
      bills.mode = 'cycle';
      await keepBills(res.data);
    } else {
      if (res.kind === 'auth') conn.needsAuth = true;
      bills.error = res.error || fallback;
    }
  } finally {
    bills.busy = '';
    render();
  }
}

function onCarry(row) {
  if (bills.view) billsAction('carry', 'carryBill', { cycle: bills.view.cycle, row }, 'Could not carry that bill.');
}

function onStart() {
  const next = bills.view && nextCycle(bills.view.cycle);
  if (next) billsAction('new', 'newCycle', { cycle: next }, 'Could not start that cycle.');
}
```

At the end of `onBillsClick`, replace `if (t.closest('#note-save')) saveNote();` with:

```js
  if (t.closest('#note-save')) { saveNote(); return; }
  const carry = t.closest('[data-carry-row]');
  if (carry) { onCarry(Number(carry.dataset.carryRow)); return; }
  if (t.closest('#bills-newcycle')) onStart();
```

- [ ] **Step 4: Run the checks**

Run: `./check.sh`
Expected: PASS through `wiring self-check passed`.

- [ ] **Step 5: Commit**

```bash
git add app/main.js wiring.js
git commit -m "Carry a bill and start the next cycle, online only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Runbook

**Files:**
- Modify: `docs/RUNBOOK.md` (append after the stage 2 section)

- [ ] **Step 1: Add a stage 3 section**

````markdown
---

# Stage 3 runbook — bills

**No sheet change and no new Script Property.** Every bill op was already
in `Api.gs`'s op map. The one server change is the row guard (`rowMatches_`
in `Bills.gs`), which ships as version 12 of the existing `Api-deployment`
**before** this client goes live: same /exec URL, so `config.js` does not
change. The Apps Script app is unaffected: it never sends a bill name, and
its ticks and notes behave as before.

`sw.js`'s `CACHE` is bumped to `home-economy-v14`, so an installed phone
picks up the new code on its next load (close and reopen the app once if
the tab bar does not appear).

## Verify

1. **A tick from each phone.** Vin ticks a box, Venice ticks another. Then
   Vin ticks one of *Venice's* boxes: in the Bill Tracker tab its `Funded`
   entry records **Vin** as `by`. The hover title on a laptop says the same.
2. **An offline tick.** Airplane mode, tick a box: it shows ticked and
   marked *pending*, and the progress line does not move. Reconnect: it
   syncs without a tap, the mark clears, and the progress updates.
3. **An offline note.** Airplane mode, edit a bill's note and save: it shows
   with *pending*. Reconnect: it syncs, and the sheet's `Notes` cell has it.
4. **Carry.** On a fully funded bill, tap `Carry to YYYY-MM →`: the card now
   reads `In YYYY-MM ✓`, and the bill is in the next cycle in the sheet
   with a blank amount and due date. Offline, the button is disabled with a
   hint saying why.
5. **Start next cycle.** From the latest cycle, tap `Start YYYY-MM`: the new
   cycle opens, holding every bill not already carried.
6. **The row guard.** Airplane mode, tick a box on a bill. In the Bill
   Tracker tab, delete a row **above** that bill. Reconnect: the tick is
   parked at the top of the Bills tab with "That bill could not be found.
   Reload and try again.", and **no other bill's `Funded` cell changed**.
   Discard it.
7. **Stage 2 check 7, still unreported:** a parked ledger item can be
   discarded, and discarding it does not touch the sheet.
8. **Reopen.** Leave the app on the Bills tab's payday view, close it and
   reopen: it comes back on that tab, view and payday.
````

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "Add the stage 3 runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Deploy the row guard (controller only)

**Not a subagent task.** The controller runs this after the whole-branch review, and **the user confirms each command that touches the live project before it runs**. The server must be live before the client branch is merged, because merging to `main` publishes the client on GitHub Pages.

The deployment to update is the one whose id matches `config.js`: `AKfycbxWIK3OPjAbdTO7m2kFUHt12DOfRVrYQSH6_QnUPoVttF3Sb_0XglsWSvg4iAfB3o9n`. Never touch `@HEAD` or the `v2`–`v5.5` rows (the household app's history).

- [ ] **Step 1: Merge the server branch locally**

```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git checkout main && git merge --ff-only stage-3-api && git branch -d stage-3-api
cd home-economy-app && ./check.sh
```

Expected: the six lines.

- [ ] **Step 2: Push the code (confirm first)**

Run: `clasp push`
Expected: the pushed-files list, with no errors.

- [ ] **Step 3: Cut a version (confirm first)**

Run: `clasp version "PWA stage 3: bill row guard"`
Expected: `Created version 12` (use whatever number it prints below).

- [ ] **Step 4: Redeploy the API deployment (confirm first)**

Run: `clasp deployments` and find the row whose id equals the one above. Then:

```bash
clasp redeploy AKfycbxWIK3OPjAbdTO7m2kFUHt12DOfRVrYQSH6_QnUPoVttF3Sb_0XglsWSvg4iAfB3o9n -V 12 -d "PWA stage 3: bill row guard"
```

Run `clasp deployments` again. Expected: that id at `@12`, and every other row unchanged.

- [ ] **Step 5: Update the project memory**

Record the new state in `pwa-stage-status.md`: the server is at @12 with the row guard, and the stage 3 client is ready to merge.

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §1 the six rows; add-bill left out | 3 (views), 4 (tick, note), 5 (carry, start); no add-bill anywhere |
| §2 tab bar; reopens on the last tab | 3 (`renderTabs`, `bills:last`, `boot`) |
| §2.1 cycle view: cards, schedule, boxes with day + hover, progress, note, carry, totals + %, Start names the cycle, pending banner | 3 (`billCard`, `ticks`, `ticked`, `noteLine`, `totals`, `renderBills`) |
| §2.2 payday view and its totals | 3 (`paydayLine`, `totals(…, true)`) |
| §2.3 no add-bill, percentage instead of the ring | 3 (`.totals-pct`) |
| §3 cache keys, cache first then refetch, not-loaded message, '' means latest and caches under the named scope | 3 (`keepBills`, `loadBills`, `fetchBills`); checks in Task 3's scenario |
| §4.1 ticks and notes queued even online, `name` in args, payday view sends the row's cycle, newest pending wins, overlay only, 500-char courtesy | 2 (`overlayQueued`), 4 (`onTick`, `saveNote`, `queueOp`) |
| §4.2 post-sync refetch; failure reported on the connection line | 4 (`sync()`) |
| §4.3 carry and new cycle direct, disabled offline or signed out, refusal on the hint and re-enabled | 3 (disabled state), 5 (`billsAction`) |
| §4.4 parked bill items listed with Discard, no reopen; ledger list and balance ignore bill items | 3 (`parkedRow`), 4 (`removeItem`, pins) |
| §5 server row guard, blank skips, `Api.gs` passes `name`, self-check cases; deploy as v12 of the matching id | 1, 7 |
| §6 files; `sw.js` precache and bump; runbook | 2, 3, 6 |
| §6 checks: overlay, `nextCycle`, `billsKey`, and the wiring list | 2 (selfcheck), 3–5 (wiring), 4 (ledger pins) |
| §6 hand checks 1–7 | 6 (plus a reopen check, 8) |
