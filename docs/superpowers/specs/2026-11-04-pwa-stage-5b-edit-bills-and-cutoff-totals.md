# PWA stage 5, spec B — Edit a bill in place, and cut-off totals

The second of four specs from the 2026-11-03 wishlist (see
`2026-11-03-pwa-stage-5-signin-and-speed.md`, which has the split). This one
covers items 4 and 1:

- **4.** Edit a bill's amount and due date on the Bills tab, by tapping the
  value and changing it there. (The electricity bill varies every month.)
- **1.** A total for the whole cut-off: the shared amount both people set
  aside on a payday, shown on the cycle view.

Spec A (session token, speed) is built on branches `stage-5` (client) and
`stage-5-api` (server) and is **not deployed**. By the user's decision on
2026-11-04 nothing deploys until all four specs are done, so this work goes
on the same two branches and joins the same server deploy. It does not
depend on spec A's code except that both touch `app/main.js`'s Bills paths.

## 1. What changes

| | Before | After |
|---|---|---|
| Amount and due date | edited only in the sheet | **tap them on the bill's card to change them** |
| A carried bill (blank amount and due date) | banner: "add them in the Bill Tracker tab" | **tap the card to set them** |
| Cycle view | per-bill cards, one Billed / Funded / Remaining block | **plus a total per cut-off** |
| Server | — | **new `editBill` op; cycle view gains `cutoffTotals`** |

## 2. Edit a bill (item 4)

### 2.1 Server: `editBill(cycle, row, name, amount, due_date)`

Reached through `opHandler_` like every op, wrapped in `safe_`, answering
with `billsView_` for the cycle plus `view.me`, exactly as `addBill`,
`setBillNotes` and `carryBill` do.

- **Validation**, in plain language, the same messages `addBill` uses:
  `Enter an amount greater than zero.` and `Pick a valid due date.`, plus
  `Pick a valid cycle, like 2026-09.`. `validateBill_` is changed to call
  the shared check (`validateBillEdit_(amount, due_date)`) so the two can
  never drift. `kindOf_` already files all three as `validation`.
- **Row guard.** The row is addressed by sheet row, so, as `setNotes_` does,
  the bill is re-read inside the lock and refused with
  `That bill could not be found. Reload and try again.` (kind `conflict`)
  unless its cycle equals `cycle` **and** its name matches `name`
  (`rowMatches_`). A row shifted by a hand edit can never be overwritten.
- **Write.** Under `LockService.getScriptLock()` (30 s, then
  `The tracker is busy right now…`, as the other writers): the Amount cell
  gets `round2_(amount)` as a number, the Due date cell gets `toDate_(due)`
  as `appendBill_` writes it. **Only those two cells.** Name, Cutoffs,
  Method, Funded and Notes are never touched.
- Editing a bill whose amount and due date are already set, and one whose
  are blank (a carried bill), are the same operation.

### 2.2 Client: the editor on the card

- On a bill card, the amount and the due date are tappable. A bill that
  still lacks them shows a **Set amount and due date** control in their
  place. Tapping any of these opens an inline editor in that card: a number
  field (`inputmode="decimal"`, step 0.01, min 0), a date field (`type="date"`,
  native picker), **Save** and **Cancel**. Only one editor is open at a
  time, and opening the note editor closes it (and the reverse).
- What is typed survives repaints (a sync finishing, a tick landing), as the
  note draft does: `bills.editingBill` (the row) and `bills.billDraft`
  (`{amount, due}`) in `main.js`.
- **Save** checks the two values for the server's own rules first
  (amount above zero, a date present) and shows the message on the Bills
  hint line without a request if they fail. Otherwise it sends `editBill`
  straight to the server and shows `Saving…`. On success the reply view
  replaces the one on screen and is cached under its cycle, exactly as
  Carry's reply is (`billsAction`); on a refusal the server's message shows
  on the hint line and the editor stays open with what was typed.
- **Online only**, like Carry and Start: the edit controls are disabled
  offline and signed out, with the same hint line saying why. An edit is
  never queued.
- The banner `N bills need an amount or due date — add them in the Bill
  Tracker tab.` becomes `… — tap the bill to add them.`.

### 2.3 What an edit does to everything else

These follow from how the sheet is computed; none needs new code.

- **Ticks keep their stored value.** An installment is `amount ÷
  (cutoffs × payers)`, so changing the amount re-prices progress and
  remaining at once. Nothing is rewritten in the Funded cell.
- **A due date change can change which paydays fund the bill.** Ticks on a
  payday that is no longer in the schedule stay in the sheet but stop
  counting (`validFunded_`); they count again if the date goes back. The
  editor does not warn; the card shows what counts.
- **A queued tick for a payday that no longer funds the bill** is refused by
  the existing rule (`That payday does not fund this bill.`, kind
  `conflict`) and parks with Discard, like any refused tick.
- **A bill with no amount yet** (pending) has no schedule and no ticks;
  setting the amount and due date makes it a normal bill.
- Spec C1 will post ledger entries when ticks and payments happen. Those
  entries record what happened then; an amount edit later does **not**
  rewrite them. (Recorded here so C1 does not have to rediscover it.)

## 3. Cut-off totals (item 1)

### 3.1 Server

`billsView_` gains `cutoffTotals`: an array, one entry per payday that any
bill **in the cycle on screen** is funded from, oldest first:

```
{ payday: '2026-09-15', each: 1349, cash: 0, digital: 1349, all: 2698 }
```

- `paydaysOf_(rowsOfThisCycle)` picks the paydays.
- Each entry's figures come from the existing `paydayTotals_(allBills,
  payday, payerNames)` over **all** bills, not just this cycle's, so the
  numbers are the same ones the payday view shows for that day ("Each of
  you", "Cash", "Digital", "Both of you" is `all`). A payday can fund bills
  from two cycles, and the real cash to set aside that day includes both;
  the two views must never disagree.
- The key is `cutoffTotals`, not `cutoffs`: each bill row already carries a
  `cutoffs` count.
- Pending bills are skipped by `paydayTotals_` already.

### 3.2 Client

A **Cut-offs** panel in the cycle view's side region, above the Billed /
Funded / Remaining block. One line per entry: the payday (`sep 15`), then
`Both of you ₱2,698.00` as the figure, with `Each ₱1,349.00 · Cash ₱0.00 ·
Digital ₱1,349.00` beneath. No panel when the array is empty or absent (a
view cached before this change has none). Ticks never change these figures:
they are what is to be set aside, not what has been funded, so the pending
overlay does not touch them.

## 4. Out of scope

- Editing a bill's name, cutoffs or method; adding a bill from the phone;
  deleting a bill.
- Editing offline, or any queued edit.
- An edit history or "last edited by" (the sheet's own version history has
  it).
- Warning that a due date change will hide ticks (§2.3).

## 5. Testing

- **Server** (`apiSelfCheck_`/`billsSelfCheck_`, run by `check.sh`):
  `validateBillEdit_` accepts and refuses each case; `validateBill_`
  still refuses what it did; `editBill` is in `opHandler_`; the write
  helper refuses a wrong cycle, a wrong name, a blank row, row 1 and a
  row past the end (over a fake sheet, as the other writers' checks do),
  and writes exactly the two cells; `billsView_` returns `cutoffTotals`
  that equal `paydayTotals_` for each payday, including a payday that also
  funds a bill from another cycle.
- **Client** (`selfcheck.js`, `wiring.js`): tapping the amount opens the
  editor with the current values; Save sends `editBill` with the cycle,
  row, name, amount and due date and shows the reply (cached); a refusal
  keeps the editor open with its draft; the draft survives a repaint; the
  controls are disabled offline; a blank carried bill offers *Set amount
  and due date* and the banner text is the new one; the Cut-offs panel
  shows the server's figures and is absent without them.

## 6. Hand checks (go into `docs/RUNBOOK.md`, "Stage 5, spec B")

1. Change the electricity bill's amount: the card, the progress line, the
   ring and the totals all move; the sheet's Amount cell holds the number
   and nothing else in the row changed.
2. Change a due date by a month: the schedule's paydays change; move it
   back and the earlier ticks count again.
3. Carry a cycle forward, then set the amount and due date on a carried
   bill from the phone: it stops being "pending" and the banner count drops.
4. Airplane mode: the amount and date are not tappable and the hint says why.
5. The Cut-offs panel's *Both of you* for a payday equals the payday view's
   for the same day.
6. Change a due date on one phone so a payday drops out of the schedule,
   then, from a second phone still showing the old view, tick that payday:
   it is refused with "That payday does not fund this bill." and parks with
   Discard, and nothing else is affected.
