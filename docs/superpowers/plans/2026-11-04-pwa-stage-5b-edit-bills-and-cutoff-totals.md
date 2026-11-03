# PWA Stage 5, Spec B: Edit a Bill in Place, and Cut-off Totals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bill's amount and due date be edited on its card on the Bills tab, and show the shared set-aside total per cut-off on the cycle view.

**Architecture:** The Apps Script API gains an `editBill` op (row-guarded, two cells written under the script lock) and `billsView_` gains `cutoffTotals` computed with the existing `paydayTotals_`. The client opens an inline editor from the amount or due date, sends `editBill` straight to the server (online only, like Carry) through the existing `billsAction`, and draws a Cut-offs panel from `cutoffTotals`.

**Tech Stack:** Vanilla ES modules (client, no build), Apps Script V8 (server), node assertion scripts (`check.sh` in each repo).

**Spec:** `docs/superpowers/specs/2026-11-04-pwa-stage-5b-edit-bills-and-cutoff-totals.md`

## Global Constraints

- **Run every node command with Node 24:** `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH` (system node is v18 and cannot run the checks). In the server's `check.sh` never write the word "crypto" or an apostrophe inside the `node -e` block.
- **Repos and branches:** CLIENT = `/home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client`, branch `stage-5`. SERVER = `/home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA` (code in `home-economy-app/src/`), branch `stage-5-api`. Both are spec A's unmerged branches; spec B continues on them. **Nothing is merged, pushed or deployed** (user decision 2026-11-04).
- `editBill` writes **only** the Amount (col 3) and Due date (col 4) cells; never Name, Cutoffs, Method, Funded or Notes. The amount is stored as `round2_(amount)`; the date as `toDate_(due)` as `appendBill_` writes it.
- Server messages (`fail_` takes literals only): `Enter an amount greater than zero.`, `Pick a valid due date.`, `Pick a valid cycle, like 2026-09.`, `That bill could not be found. Reload and try again.`, `The tracker is busy right now. Try again in a moment.`
- View key is `cutoffTotals` (never `cutoffs`: each bill row already has a `cutoffs` count). Entry shape `{ payday, each, cash, digital, all }`.
- Editing is **online only**: never queued; controls disabled offline / signed out / busy.
- `sw.js` `CACHE` stays `home-economy-v19` (spec A's bump covers the undeployed set); no new files are added to the shell.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

1. `editBill` refuses a wrong cycle, wrong or blank name, row 1, a blank row and a row past the end; it never writes outside the two cells. (Task 1)
2. Editing a carried (blank) bill makes it a live one; the typed draft survives a repaint; a refusal keeps the editor open with the draft. (Task 3)
3. Offline or signed out: the edit controls are disabled and nothing is queued. (Task 3)
4. `cutoffTotals` equals `paydayTotals_` for each payday, including a payday that also funds a bill from another cycle; a view cached before this change has none and must not crash or draw a panel. (Tasks 1, 2)
5. Bad amounts (0, negative, empty, not a number) and an empty date are refused before any request, and by the server if sent anyway. (Tasks 1, 3)

---

## File Structure

| File | Repo | Responsibility | Tasks |
|---|---|---|---|
| `src/Bills.gs` | SERVER | `validateBillEdit_`, `billIsTarget_`, `editBill_`, `cutoffTotals` in `billsView_` | 1 |
| `src/Code.gs`, `src/Api.gs` | SERVER | `editBill` handler and op | 1 |
| `app/bills.js` | CLIENT | Cut-offs panel; card editor and tap targets; hints | 2, 3 |
| `app/main.js` | CLIENT | editor state, open/save, `billsAction` returns success | 3 |
| `app.css` | CLIENT | panel and editor styles | 2, 3 |
| `wiring.js`, `docs/RUNBOOK.md` | CLIENT | wired checks; spec B runbook | 2–4 |

---

### Task 1: Server: `editBill` and `cutoffTotals`

**Files:**
- Modify: `home-economy-app/src/Bills.gs`, `home-economy-app/src/Code.gs`, `home-economy-app/src/Api.gs`

**Interfaces:**
- Produces: `validateBillEdit_(amount, due_date) -> string|null`; `billIsTarget_(bill, cycle, name) -> boolean` (false for a blank name, a different cycle, or a different name); `editBill_(cycle, row, name, amount, dueISO)` (throws via `fail_`); `editBill(cycle, row, name, amount, due_date)` in `Code.gs` returning the cycle view plus `me`; op `editBill` taking `{cycle, row, name, amount, due_date}`; `billsView_(...)` result gains `cutoffTotals: Array<{payday, each, cash, digital, all}>`.

- [ ] **Step 1: Write the failing checks**

In `src/Bills.gs`, in `billsSelfCheck_`, replace the final line pair

```js
  console.log('bills self-check passed');
}
```

with:

```js
  // ── PWA stage 5 spec B: editing a bill, and cut-off totals ─────────────
  eq(validateBillEdit_(8123.45, '2026-10-01'), null, 'a good amount and date pass');
  eq(validateBillEdit_('8123.45', '2026-10-01'), null, 'an amount sent as text passes');
  eq(validateBillEdit_(0, '2026-10-01'), 'Enter an amount greater than zero.', 'zero is refused');
  eq(validateBillEdit_(-5, '2026-10-01'), 'Enter an amount greater than zero.', 'a negative is refused');
  eq(validateBillEdit_('', '2026-10-01'), 'Enter an amount greater than zero.', 'blank is refused');
  eq(validateBillEdit_('abc', '2026-10-01'), 'Enter an amount greater than zero.', 'text is refused');
  eq(validateBillEdit_(100, ''), 'Pick a valid due date.', 'a blank date is refused');
  eq(validateBillEdit_(100, '2026-02-30'), 'Pick a valid due date.', 'a date that does not exist is refused');
  eq(validateBill_({ cycle: '2026-09', name: 'Rent', amount: 0, due_date: '2026-10-01', cutoffs: 2, method: 'cash' }),
     'Enter an amount greater than zero.', 'adding a bill still refuses a zero amount, with the same message');
  eq(validateBill_({ cycle: '2026-09', name: 'Rent', amount: 5, due_date: 'x', cutoffs: 2, method: 'cash' }),
     'Pick a valid due date.', 'and a bad date');
  eq(validateBill_({ cycle: '2026-09', name: 'Rent', amount: 5, due_date: '2026-10-01', cutoffs: 2, method: 'cash' }),
     null, 'and passes a good bill');

  var target = { cycle: '2026-09', name: 'Rent' };
  eq(billIsTarget_(target, '2026-09', 'Rent'), true, 'the same cycle and name is the target');
  eq(billIsTarget_(target, '2026-09', ' rent '), true, 'matched trimmed and ignoring case');
  eq(billIsTarget_(target, '2026-10', 'Rent'), false, 'another cycle is not');
  eq(billIsTarget_(target, '2026-09', 'Water'), false, 'another bill on the row is not');
  eq(billIsTarget_(target, '2026-09', ''), false, 'a blank name is refused: a money edit must say which bill');
  eq(billIsTarget_({ cycle: '2026-09', name: '' }, '2026-09', ''), false, 'an empty row is not a target');
  eq(billIsTarget_(null, '2026-09', 'Rent'), false, 'no row is not a target');

  // Cut-off totals equal the payday view's figures, and a cycle view lists
  // only the paydays its own bills use while the amounts span every cycle.
  var extra = { cycle: '2026-08', name: 'Extra', amount: 1000, cutoffs: 1, method: 'digital',
                funded: '', due_date: '2026-07-30' };
  var both = july.concat([extra]);
  var julyView = billsView_(both, '2026-07', P2, '2026-07-01');
  eq(julyView.cutoffTotals.map(function (c) { return c.payday; }).join('|'), '2026-07-15|2026-07-30',
     'one entry per payday the cycle uses, oldest first');
  eq(julyView.cutoffTotals[0].all, 15103, 'the 15th matches the sheet total');
  var c30 = julyView.cutoffTotals[1];
  var p30 = paydayTotals_(both, '2026-07-30', P2);
  eq(c30.each + '|' + c30.cash + '|' + c30.digital + '|' + c30.all,
     p30.each + '|' + p30.cash + '|' + p30.digital + '|' + p30.all, 'equal to the payday view, field for field');
  eq(c30.each, paydayTotals_(july, '2026-07-30', P2).each + 500,
     'and it includes the other cycle\'s bill funded the same day');
  var augView = billsView_(both, '2026-08', P2, '2026-07-01');
  eq(augView.cutoffTotals.map(function (c) { return c.payday; }).join('|'), '2026-07-30',
     'a cycle lists only the paydays its own bills use');
  eq(augView.cutoffTotals[0].all, c30.all, 'with the same all-cycles amount');
  eq(billsView_([], '2026-09', P2, '2026-09-01').cutoffTotals.length, 0, 'an empty cycle has none');

  console.log('bills self-check passed');
}
```

In `src/Api.gs`, in `apiSelfCheck_`, after the line

```js
  eq(typeof opHandler_('session'), 'function', 'the session op exists');
```

add

```js
  eq(typeof opHandler_('editBill'), 'function', 'the editBill op exists');
  eq(kindOf_('Enter an amount greater than zero.'), 'validation', 'a bad edit amount parks, never retries');
  eq(kindOf_('Pick a valid due date.'), 'validation', 'and a bad edit date');
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app && ./check.sh 2>&1 | grep -v "^    at " | head -8
```

Expected: FAIL, `validateBillEdit_ is not defined` (a ReferenceError from `billsSelfCheck_`).

- [ ] **Step 3: Implement in `src/Bills.gs`**

Replace

```js
/** Returns a plain-language problem, or null when the bill is good. */
function validateBill_(bill) {
```

with

```js
/**
 * The two fields an edit may change, with the messages addBill already uses
 * (PWA stage 5 spec B §2.1). validateBill_ calls this so the two can never
 * drift.
 */
function validateBillEdit_(amount, due_date) {
  var a = Number(amount);
  if (!isFinite(a) || a <= 0) return 'Enter an amount greater than zero.';
  if (!isRealDate_(due_date)) return 'Pick a valid due date.';
  return null;
}

/** Returns a plain-language problem, or null when the bill is good. */
function validateBill_(bill) {
```

and inside `validateBill_` replace

```js
  var amount = Number(b.amount);
  if (!isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.';
  if (!isRealDate_(b.due_date)) return 'Pick a valid due date.';
```

with

```js
  var edit = validateBillEdit_(b.amount, b.due_date);
  if (edit) return edit;
```

In `billsView_`, replace

```js
    totals: cycleTotals_(rows, payerNames, todayISO)
  };
}
```

with

```js
    totals: cycleTotals_(rows, payerNames, todayISO),
    // The set-aside per cut-off (spec B §3). The paydays are the ones this
    // cycle's bills use; the amounts span every cycle (paydayTotals_ over all
    // bills), so they equal the payday view's. Not `cutoffs`: each row has one.
    cutoffTotals: paydaysOf_(rows).map(function (d) {
      var t = paydayTotals_(bills, d, payerNames);
      return { payday: d, each: t.each, cash: t.cash, digital: t.digital, all: t.all };
    })
  };
}
```

Insert before the comment `/** Appends whole rows at the bottom of the tab. The caller holds the lock. */`:

```js
/**
 * Is this row the bill the client meant? Stricter than rowMatches_: a money
 * edit must name its bill, so a blank name is refused too. The same row-number
 * handle caveat as setFunded_ applies.
 */
function billIsTarget_(bill, cycle, name) {
  return !!(bill && bill.name && String(name == null ? '' : name).trim() &&
            bill.cycle === String(cycle) && rowMatches_(bill, cycle, name));
}

/**
 * Changes one bill's Amount and Due date (PWA stage 5 spec B §2.1) and nothing
 * else. The row is re-read inside the lock and checked against the cycle and
 * name the page was showing, so a row shifted by a hand edit is refused rather
 * than overwritten.
 */
function editBill_(cycle, row, name, amount, dueISO) {
  var problem = validateBillEdit_(amount, dueISO);
  if (problem) fail_(problem);
  var n = Number(row);
  if (!isFinite(n) || n < 2) fail_('That bill could not be found. Reload and try again.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) fail_('The tracker is busy right now. Try again in a moment.');
  try {
    var sheet = getBillsSheet_();
    if (n > sheet.getLastRow()) fail_('That bill could not be found. Reload and try again.');
    var bill = billFromRow_(sheet.getRange(n, 1, 1, BILL_HEADERS.length).getValues()[0],
                            n, Session.getScriptTimeZone());
    if (!billIsTarget_(bill, cycle, name)) fail_('That bill could not be found. Reload and try again.');
    sheet.getRange(n, 3).setValue(round2_(Number(amount)));
    sheet.getRange(n, 4).setValue(toDate_(dueISO));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

```

- [ ] **Step 4: Implement the handler and the op**

In `src/Code.gs`, insert before `function newCycle(cycle) {`:

```js
/** Edits one bill's amount and due date; answers with the cycle it is in. */
function editBill(cycle, row, name, amount, due_date) {
  return safe_(function () {
    var email = requireUser_();
    var when = String(cycle || '').trim();
    if (!/^\d{4}-\d{2}$/.test(when)) fail_('Pick a valid cycle, like 2026-09.');
    editBill_(when, row, name, amount, due_date);
    var view = billsView_(readBills_(), when, payerNames_(), todayISO_());
    view.me = payerFor_(email, payers_());
    return view;
  });
}

```

In `src/Api.gs`, in `opHandler_`, replace

```js
    addBill: function (a) { return addBill(a.bill); },
```

with

```js
    addBill: function (a) { return addBill(a.bill); },
    editBill: function (a) { return editBill(a.cycle, a.row, a.name, a.amount, a.due_date); },
```

- [ ] **Step 5: Run to verify it passes**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -6
```

Expected: `bills self-check passed`, `api self-check passed`, `doPost self-check passed`, `bills render smoke passed`. (If the `cutoffTotals` checks fail because a fixture row lacks a field `billsView_` reads, add that field to the `extra` bill in the check, not to production code.)

- [ ] **Step 6: Commit**

```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git branch --show-current   # stage-5-api
git add home-economy-app/src/Bills.gs home-economy-app/src/Code.gs home-economy-app/src/Api.gs
git commit -m "Add editBill (amount and due date) and per-cut-off totals to the bills view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Client: the Cut-offs panel

**Files:**
- Modify: `app/bills.js` (new `cutoffPanel`, used in `renderBills`), `app.css`
- Test: `wiring.js`

**Interfaces:**
- Consumes: `view.cutoffTotals` (Task 1).
- Produces: a `.cutoffs.panel` in the cycle view's `.bills-side`, above `.totals`, absent when the array is missing or empty.

- [ ] **Step 1: Write the failing check**

In `wiring.js`, immediately before the line

```js
    // ── Carry and Start go straight to the server, online only (spec §4.3) ──
```

insert:

```js
    // ── the Cut-offs panel (stage 5 spec B §3; Review Focus 4) ────────────
    navigator.onLine = true;
    fireWindow('online');
    await settle();
    assert.equal(billsEl.querySelector('.cutoffs'), null,
      'a view without cutoffTotals (cached before this change) draws no panel');
    const withCutoffs = structuredClone(fresh);
    withCutoffs.cutoffTotals = [
      { payday: '2026-09-15', each: 1349, cash: 0, digital: 1349, all: 2698 },
      { payday: '2026-09-30', each: 3000.5, cash: 1000, digital: 2000.5, all: 6001 },
    ];
    answers.bills = { ok: true, data: withCutoffs };
    fireWindow('online');
    await settle();
    const panel = billsEl.querySelector('.cutoffs');
    assert.ok(panel, 'a view with cutoffTotals draws the panel');
    assert.ok(billsEl.querySelector('.bills-side').children.indexOf(panel)
      < billsEl.querySelector('.bills-side').children.indexOf(billsEl.querySelector('.totals')),
      'above the Billed / Funded / Remaining block');
    const panelText = textOf(panel);
    assert.ok(panelText.includes('sep 15') && panelText.includes('₱2,698.00'), "the 15th's shared amount");
    assert.ok(panelText.includes('sep 30') && panelText.includes('₱6,001.00'), "the 30th's shared amount");
    assert.ok(panelText.includes('₱1,349.00') && panelText.includes('₱3,000.50'), 'with each person\'s share');
    assert.ok(panelText.includes('cash ₱1,000.00') && panelText.includes('digital ₱2,000.50'), 'and the cash and digital split');
    withCutoffs.cutoffTotals = [];
    fireWindow('online');
    await settle();
    assert.equal(billsEl.querySelector('.cutoffs'), null, 'an empty list draws no panel');
    answers.bills = { ok: true, data: fresh };
    navigator.onLine = false;
    fireWindow('offline');

```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
node wiring.js 2>&1 | grep -v "^    at " | head -6
```

Expected: FAIL, `a view with cutoffTotals draws the panel`.

- [ ] **Step 3: Implement**

In `app/bills.js`, insert before `/** The footer figures, as sent.`:

```js
/** The set-aside per cut-off, as the server sent it (stage 5 spec B §3): the
    shared amount both people put aside that payday, then each person's share
    and the cash/digital split. Nothing here is computed on the phone. */
function cutoffPanel(list) {
  const box = el('div', 'cutoffs panel');
  list.forEach((c) => {
    const row = el('div', 'cutoff');
    row.appendChild(el('span', 'cutoff-day', day(c.payday)));
    row.appendChild(el('span', 'cutoff-all fig', peso(c.all)));
    row.appendChild(el('span', 'cutoff-detail', 'Both of you · each ' + peso(c.each)
      + ' · cash ' + peso(c.cash) + ' · digital ' + peso(c.digital)));
    box.appendChild(row);
  });
  return box;
}

```

In `renderBills`, in the cycle branch, replace

```js
    view.rows.forEach((r) => rowsEl.appendChild(billCard(view, r, ctx)));
    side.appendChild(totals(view.totals, false));
```

with

```js
    view.rows.forEach((r) => rowsEl.appendChild(billCard(view, r, ctx)));
    if (view.cutoffTotals && view.cutoffTotals.length) side.appendChild(cutoffPanel(view.cutoffTotals));
    side.appendChild(totals(view.totals, false));
```

Append to `app.css`:

```css

/* The set-aside per cut-off on the cycle view (stage 5 spec B). */
.cutoffs { padding: 10px 14px; }
.cutoff {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 0 12px;
  padding: 4px 0;
}
.cutoff-day { color: var(--muted); }
.cutoff-all { text-align: right; font-weight: 500; }
.cutoff-detail { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
```

- [ ] **Step 4: Run the whole suite and commit**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -3
git add app/bills.js app.css wiring.js
git commit -m "Show the shared set-aside per cut-off on the cycle view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: `wiring self-check passed`.

---

### Task 3: Client: the editor on the bill card

**Files:**
- Modify: `app/bills.js`, `app/main.js`, `app.css`
- Test: `wiring.js`

**Interfaces:**
- Consumes: op `editBill` (Task 1); `billsAction(kind, op, args, fallback)` and `showBills`/`keepBills` in `main.js`.
- Produces: `bills.editingBill` (row or null) and `bills.billDraft` (`{amount, due}` strings) in `main.js`; `billsAction` now returns `true` when the server answered `ok`, else `false`; DOM ids `edit-amount`, `edit-due`, `bill-save`, `bill-cancel`; tap targets carry `data-edit-row`.

- [ ] **Step 1: Write the failing checks**

In `wiring.js`, immediately before the line

```js
    // ── Carry and Start go straight to the server, online only (spec §4.3) ──
```

insert (after Task 2's block):

```js
    // ── edit a bill in place (stage 5 spec B §2; Review Focus 2, 3, 5) ────
    navigator.onLine = true;
    fireWindow('online');
    await settle();
    const tapEdit = (cls, row) => find(billsEl, (e) => e.dataset.editRow === String(row) && String(e.className).includes(cls));
    const editorField = (id) => billsEl.querySelector('#' + id);
    const typeInto = (id, value) => {
      const f = editorField(id);
      f.value = value;
      billsEl.dispatch('input', { target: f });
    };

    // Tapping the amount opens the editor with the current values.
    assert.equal(editorField('edit-amount'), null, 'precondition: no editor open');
    billsEl.dispatch('click', { target: tapEdit('bill-amount', 5) });
    assert.equal(editorField('edit-amount').value, '7500', 'the amount field holds the current amount');
    assert.equal(editorField('edit-due').value, '2026-10-01', 'and the date field the current due date');
    assert.equal(editorField('bill-save').disabled, false, 'Save is live online');

    // What is typed survives a repaint (a sync finishing).
    typeInto('edit-amount', '8123.45');
    typeInto('edit-due', '2026-10-05');
    fireWindow('online');
    await settle();
    assert.equal(editorField('edit-amount').value, '8123.45', 'the typed amount survives a repaint');
    assert.equal(editorField('edit-due').value, '2026-10-05', 'and so does the date');

    // Bad input is refused before any request.
    sent.length = 0;
    typeInto('edit-amount', '0');
    billsEl.dispatch('click', { target: editorField('bill-save') });
    await settle();
    assert.ok(textOf(billsEl).includes('Enter an amount greater than zero.'), 'zero is refused on the hint line');
    typeInto('edit-amount', '');
    billsEl.dispatch('click', { target: editorField('bill-save') });
    await settle();
    assert.ok(textOf(billsEl).includes('Enter an amount greater than zero.'), 'blank is refused too');
    typeInto('edit-amount', '8123.45');
    typeInto('edit-due', '');
    billsEl.dispatch('click', { target: editorField('bill-save') });
    await settle();
    assert.ok(textOf(billsEl).includes('Pick a valid due date.'), 'a missing date is refused');
    assert.equal(sent.filter((b) => b.op === 'editBill').length, 0, 'none of them reached the server');
    assert.ok(editorField('edit-amount'), 'and the editor stays open');

    // A refusal from the server keeps the editor open with the draft.
    typeInto('edit-due', '2026-10-05');
    answers.editBill = { ok: false, kind: 'conflict', error: 'That bill could not be found. Reload and try again.' };
    billsEl.dispatch('click', { target: editorField('bill-save') });
    await settle();
    assert.ok(textOf(billsEl).includes('That bill could not be found'), "the server's message shows");
    assert.equal(editorField('edit-amount').value, '8123.45', 'the draft is still there');

    // A good save sends the full handle, shows the reply, caches it, closes the editor.
    const edited = structuredClone(fresh);
    edited.rows[0].amount = 8123.45;
    edited.rows[0].due_date = '2026-10-05';
    answers.editBill = { ok: true, data: edited };
    billsEl.dispatch('click', { target: editorField('bill-save') });
    await settle();
    assert.deepEqual(sent.filter((b) => b.op === 'editBill').pop().args,
      { cycle: '2026-09', row: 5, name: 'Rent', amount: 8123.45, due_date: '2026-10-05' },
      'the edit names the cycle, row, bill, amount and date');
    assert.equal(editorField('edit-amount'), null, 'the editor closes on success');
    assert.ok(textOf(billsEl).includes('₱8,123.45') && textOf(billsEl).includes('due oct 5'), "the reply's values are on screen");
    assert.equal((await db.getView('bills:cycle:2026-09')).rows[0].amount, 8123.45, 'and cached');
    assert.equal((await db.listQueue()).length, 0, 'an edit never touches the queue');

    // Cancel closes without sending.
    sent.length = 0;
    billsEl.dispatch('click', { target: tapEdit('bill-due', 5) });
    assert.ok(editorField('edit-amount'), 'tapping the due date opens the same editor');
    billsEl.dispatch('click', { target: editorField('bill-cancel') });
    assert.equal(editorField('edit-amount'), null, 'Cancel closes it');
    assert.equal(sent.length, 0, 'and sends nothing');

    // Offline: the tap targets are disabled, with the hint saying why.
    navigator.onLine = false;
    fireWindow('offline');
    assert.equal(tapEdit('bill-amount', 5).disabled, true, 'offline, the amount cannot be tapped');
    assert.equal(tapEdit('bill-due', 5).disabled, true, 'nor the date');
    assert.ok(textOf(billsEl).includes('editing one'), 'and the hint names editing');

    // A carried bill with a blank amount and date offers to set them.
    const blank = structuredClone(fresh);
    blank.rows.push({ row: 8, name: 'Electricity', amount: '', due_date: '', cutoffs: 2, method: 'digital',
      notes: '', carried: false, pending: true, installment: 0, progress: 0, remaining: 0, status: 'Pending',
      schedule: [] });
    blank.totals = { ...blank.totals, pending: 1 };
    answers.bills = { ok: true, data: blank };
    navigator.onLine = true;
    fireWindow('online');
    await settle();
    assert.equal(tapEdit('bill-amount', 8).textContent, 'Set amount', 'a blank bill says what is missing');
    assert.equal(tapEdit('bill-due', 8).textContent, '· set due date', 'both of them');
    assert.ok(textOf(billsEl).includes('tap the bill to add them'), 'and the banner points at the card');
    assert.ok(!textOf(billsEl).includes('Bill Tracker tab'), 'no longer at the sheet');
    billsEl.dispatch('click', { target: tapEdit('bill-amount', 8) });
    assert.equal(editorField('edit-amount').value, '', 'its editor starts empty');
    assert.equal(editorField('edit-due').value, '', 'for both fields');
    billsEl.dispatch('click', { target: editorField('bill-cancel') });
    answers.bills = { ok: true, data: fresh };
    navigator.onLine = false;
    fireWindow('offline');

```

- [ ] **Step 2: Run to verify it fails**

```bash
node wiring.js 2>&1 | grep -v "^    at " | head -6
```

Expected: FAIL, a `TypeError`/assertion at the first `billsEl.dispatch('click', { target: tapEdit('bill-amount', 5) })` (no such element yet: `find` returns null).

- [ ] **Step 3: Implement in `app/bills.js`**

Replace

```js
const OFFLINE_HINT = "You're offline — ticks and notes sync when you reconnect; carrying a bill and starting a cycle need a connection.";
```

with

```js
const OFFLINE_HINT = "You're offline — ticks and notes sync when you reconnect; carrying a bill, editing one and starting a cycle need a connection.";
```

Insert before `/** One card per bill (spec §2.1): head, schedule, progress, note. */`:

```js
/** The amount and the due date are tap targets that open the editor (stage 5
    spec B §2.2). Online only, like Carry: disabled when the card cannot act. */
function editButton(className, text, r, ctx) {
  const b = button('linkish bill-edit ' + className, text);
  b.dataset.editRow = String(r.row);
  b.disabled = !ctx.canAct;
  return b;
}

/** The inline editor, between a card's head and its schedule: an amount, a due
    date (the native pickers), Save and Cancel. The values come from the draft
    main.js keeps across repaints. */
function billEditor(ctx) {
  const box = el('div', 'bill-editor');
  const field = (label, id, type, value) => {
    const wrap = el('label', 'bill-field');
    wrap.appendChild(el('span', null, label));
    const input = el('input', 'bill-input');
    input.id = id;
    input.type = type;
    input.value = value;
    wrap.appendChild(input);
    box.appendChild(wrap);
    return input;
  };
  const amount = field('Amount', 'edit-amount', 'number', ctx.billDraft.amount);
  amount.setAttribute('inputmode', 'decimal');
  amount.setAttribute('step', '0.01');
  amount.setAttribute('min', '0');
  field('Due date', 'edit-due', 'date', ctx.billDraft.due);
  const save = button('linkish', 'Save');
  save.id = 'bill-save';
  save.disabled = !ctx.canAct;
  box.appendChild(save);
  const cancel = button('linkish', 'Cancel');
  cancel.id = 'bill-cancel';
  box.appendChild(cancel);
  return box;
}

```

In `billCard`, replace

```js
  head.appendChild(el('span', 'bill-name', r.name + (r.due_date ? ' · due ' + day(r.due_date) : '')));
  head.appendChild(methodTag(r.method));
  head.appendChild(el('span', 'fig', r.pending ? '—' : peso(r.amount)));
```

with

```js
  const name = el('span', 'bill-name', r.name);
  name.appendChild(editButton('bill-due', r.due_date ? '· due ' + day(r.due_date) : '· set due date', r, ctx));
  head.appendChild(name);
  head.appendChild(methodTag(r.method));
  head.appendChild(editButton('fig bill-amount', Number(r.amount) > 0 ? peso(r.amount) : 'Set amount', r, ctx));
```

and after `card.appendChild(head);` add:

```js
  if (ctx.editingBill === r.row) card.appendChild(billEditor(ctx));
```

Replace the banner text

```js
      + ' an amount or due date — add them in the Bill Tracker tab.'));
```

with

```js
      + ' an amount or due date — tap the bill to add them.'));
```

Replace the busy hint

```js
    hint.textContent = b.busy === 'carry' ? 'Carrying…' : 'Starting ' + nextCycle(view && view.cycle) + '…';
```

with

```js
    hint.textContent = b.busy === 'carry' ? 'Carrying…' : b.busy === 'edit' ? 'Saving…'
      : 'Starting ' + nextCycle(view && view.cycle) + '…';
```

Replace the cycle-branch ctx

```js
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft, stuck };
```

with

```js
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft, stuck,
                  editingBill: b.editingBill, billDraft: b.billDraft };
```

- [ ] **Step 4: Implement in `app/main.js`**

Replace the Bills state line

```js
  view: null, loading: false, error: '', busy: '', editingNote: null, noteDraft: '',
```

with

```js
  view: null, loading: false, error: '', busy: '', editingNote: null, noteDraft: '',
  editingBill: null, billDraft: { amount: '', due: '' },
```

(and extend the comment above it: after `across repaints as \`draft\` is for the entry form.` it is enough to add `\`editingBill\` the row whose amount/due-date editor is open, with \`billDraft\` its typed values, kept the same way (stage 5 spec B).`)

In `loadBills`, replace

```js
  bills.editingNote = null;
  bills.loading = navigator.onLine;
```

with

```js
  bills.editingNote = null;
  bills.editingBill = null;
  bills.loading = navigator.onLine;
```

In `openNote`, replace

```js
  bills.editingNote = row;
  bills.noteDraft = r.notes || ''; // the newest queued text, when there is one
```

with

```js
  bills.editingNote = row;
  bills.editingBill = null;
  bills.noteDraft = r.notes || ''; // the newest queued text, when there is one
```

Make `billsAction` report success. Replace

```js
  if (bills.busy || !navigator.onLine || conn.needsAuth) return;
  const seq = ++billsSeq;
  bills.busy = kind;
  bills.error = '';
  render();
  try {
```

with

```js
  if (bills.busy || !navigator.onLine || conn.needsAuth) return false;
  const seq = ++billsSeq;
  bills.busy = kind;
  bills.error = '';
  render();
  let ok = false; // did the server answer `ok` (stage 5 spec B: saveBill closes its editor on it)
  try {
```

Replace

```js
    if (res.ok) {
      if (seq === billsSeq) {
        bills.mode = 'cycle';
```

with

```js
    if (res.ok) {
      ok = true;
      if (seq === billsSeq) {
        bills.mode = 'cycle';
```

Replace

```js
  } finally {
    bills.busy = '';
    render();
  }
}
```

with

```js
  } finally {
    bills.busy = '';
    render();
  }
  return ok;
}
```

Add the editor functions before `function onCarry(row) {`:

```js
/** A tap on a bill's amount or due date: open its editor with the values
    now on screen (blank for a bill that lacks them). One editor at a time. */
function openBillEdit(row) {
  const r = bills.view && bills.view.rows.find((x) => x.row === row);
  if (!r) return;
  bills.editingNote = null;
  bills.editingBill = row;
  bills.billDraft = { amount: Number(r.amount) > 0 ? String(r.amount) : '', due: r.due_date || '' };
  bills.error = '';
  render();
}

/** Save: the server's own rules (validateBillEdit_) checked first as a
    courtesy, so an obvious slip costs no round trip; then straight to the
    server like Carry. The editor closes only when the server accepted it. */
async function saveBill() {
  const r = bills.view && bills.view.rows.find((x) => x.row === bills.editingBill);
  if (!r) return;
  const amount = Number(bills.billDraft.amount);
  if (!(amount > 0)) { bills.error = 'Enter an amount greater than zero.'; render(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bills.billDraft.due)) { bills.error = 'Pick a valid due date.'; render(); return; }
  const ok = await billsAction('edit', 'editBill',
    { cycle: bills.view.cycle, row: r.row, name: r.name, amount, due_date: bills.billDraft.due },
    'Could not save that bill.');
  if (ok) { bills.editingBill = null; render(); }
}

```

In `onBillsClick`, replace

```js
  if (t.closest('#note-cancel')) { bills.editingNote = null; render(); return; }
```

with

```js
  const edit = t.closest('[data-edit-row]');
  if (edit) { openBillEdit(Number(edit.dataset.editRow)); return; }
  if (t.closest('#bill-cancel')) { bills.editingBill = null; bills.error = ''; render(); return; }
  if (t.closest('#bill-save')) { saveBill(); return; }
  if (t.closest('#note-cancel')) { bills.editingNote = null; render(); return; }
```

In `boot()`, replace

```js
    if (e.target.id === 'note-input') bills.noteDraft = e.target.value;
```

with

```js
    if (e.target.id === 'note-input') bills.noteDraft = e.target.value;
    if (e.target.id === 'edit-amount') bills.billDraft.amount = e.target.value;
    if (e.target.id === 'edit-due') bills.billDraft.due = e.target.value;
```

- [ ] **Step 5: Styles**

Append to `app.css`:

```css

/* The amount and due date open the editor (stage 5 spec B §2.2). */
.bill-edit { margin-left: 4px; text-align: inherit; }
.bill-edit.fig { margin-left: 0; }
.bill-edit:disabled { cursor: default; text-decoration: none; color: inherit; }
.bill-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
  padding: 8px 14px 10px;
  background: var(--surface);
}
.bill-field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
/* 16px, as .note-input: iOS zooms the page on focus below it. */
.bill-input {
  padding: 8px 10px;
  font: 400 16px var(--sans);
  color: var(--ink);
  background: var(--well);
  border: none;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 6: Run the whole suite and commit**

```bash
./check.sh 2>&1 | grep -v "^    at " | tail -3
git add app/bills.js app/main.js app.css wiring.js
git commit -m "Edit a bill's amount and due date in place on the Bills tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: `wiring self-check passed`. If an older Bills assertion fails because the card head text changed, read it first: `Rent · due oct 1` still reads the same (the name and the due-date button concatenate), but a check that expected `—` for a pending amount now sees `Set amount`; update that expectation only.

---

### Task 4: Runbook

**Files:**
- Modify: `docs/RUNBOOK.md` (append)

- [ ] **Step 1: Append the spec B section**

```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
cat >> docs/RUNBOOK.md <<'EOF'

# Stage 5, spec B runbook — edit a bill, cut-off totals

Deploys with the rest of stage 5 (same server version, same client push).
Nothing new to configure.

## Verify

1. Change the electricity bill's amount: the card, the progress line, the
   ring and the totals all move. In the sheet, the Amount cell holds the new
   number and nothing else in that row changed.
2. Change a due date by a month: the schedule's paydays change. Move it back
   and the earlier ticks count again.
3. Carry a cycle forward, then set the amount and due date on a carried bill
   from the phone: it stops being pending and the banner count drops.
4. Airplane mode: the amount and date cannot be tapped, and the hint says why.
5. The Cut-offs panel's *Both of you* for a payday equals the payday view's
   figure for the same day.
6. Change a due date on one phone so a payday drops out of the schedule,
   then, from a second phone still showing the old view, tick that payday: it
   is refused with "That payday does not fund this bill." and parks with
   Discard, and nothing else is affected.
EOF
./check.sh 2>&1 | tail -1
git add docs/RUNBOOK.md
git commit -m "Add the stage 5 spec B runbook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §2.1 (`editBill`, validation, row guard, two cells, lock, reply): Task 1. §2.2 (tap targets, inline editor, drafts, Save/Cancel, online only, banner): Task 3. §2.3 (side effects): no code needed; hand checks 1, 2, 6. §3.1 (`cutoffTotals`, all-cycles amounts, own-cycle paydays): Task 1. §3.2 (panel, hidden when absent): Task 2. §5 testing: server in Task 1, client in Tasks 2–3. §6 hand checks: Task 4.

**One deviation from the spec text, ruled here.** Spec §5 says the writer is checked "over a fake sheet, as the other writers' checks do". The codebase has no fake sheet (the sheet writers are verified by hand), so the guard is extracted as the pure `billIsTarget_` and the totals are checked through `billsView_`; the two `setValue` calls are covered by hand check 1. Spec §2.2 says one *Set amount and due date* control; the plan uses two tap targets that each say what is missing (`Set amount`, `· set due date`), which opens the same editor.

**Placeholder scan.** None. **Type consistency.** `cutoffTotals` entry fields (`payday, each, cash, digital, all`) match between Task 1 (server), Task 2 (`cutoffPanel`) and the test data; editor ids (`edit-amount`, `edit-due`, `bill-save`, `bill-cancel`) and `data-edit-row` match across `bills.js`, `main.js` and `wiring.js`; `billsAction` returning a boolean is only consumed by `saveBill`.
