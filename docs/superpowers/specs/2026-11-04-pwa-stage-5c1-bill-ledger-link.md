# PWA stage 5, spec C1 — Connect a bill to a ledger and account

Third of four specs from the 2026-11-03 wishlist (split in
`2026-11-03-pwa-stage-5-signin-and-speed.md`). Item 5:

> Link the bills payment to their respective ledgers for real-time ledger
> monitoring. When a bill is marked "paid" it should deduct on its ledger.
> Connect the bill item to its dedicated ledger, with a "connect to ledger"
> and a "disconnect from this ledger" function. Ticking a checkbox in Bills
> should deposit to the connected ledger.

Decided with the user on 2026-11-03: a bill connects to a **ledger and an
account**; a tick **deposits** that payer's installment; a separate **Mark
paid** step **deducts** the bill's amount (so a variable bill such as
electricity is paid at its real figure); disconnecting keeps history. The
user then asked (2026-11-04) to finish all phases without further review
stops, so the mechanics below that go beyond those decisions are marked
**(ruling)** and are listed in the final report.

Same branches as the other specs (`stage-5`, `stage-5-api`); nothing is
deployed until all four specs are done.

## 1. The model: a bill is an envelope

The connected account's balance is the bill's envelope: ticks put money in,
**Mark paid** takes the bill out. What is left is what has been set aside
and not yet paid. Every ledger entry the app posts is an ordinary ledger row
(visible in Recent, editable, voidable by hand in the Ledger tab).

| Action | Ledger effect |
|---|---|
| Tick a share | **deposit** of that payer's installment (`amount ÷ (cutoffs × payers)`, to the centavo) into the connected account |
| Untick it | that deposit is **voided** |
| Mark paid | **withdrawal** of the bill's full amount from the connected account |
| Undo paid | that withdrawal is **voided** |
| Connect | existing ticks are **posted** (backfill) so the envelope starts correct **(ruling)** |
| Disconnect | nothing is posted or voided; entries already posted stay |
| Edit the amount (spec B) | nothing is rewritten; entries record what happened then |

Shares are rounded to the centavo, so deposits can differ from the bill's
amount by a few centavos; the envelope shows the true difference.

## 2. The link

Three new columns at the **end** of Bill Tracker (A–H do not move):
`Ledger`, `Account`, `Paid`.

- `Ledger` + `Account` are the connection; both blank means not connected.
- `Paid` holds `yyyy-MM-dd HH:mm~Actor` once marked paid; blank otherwise.
- A carried or new-cycle row **copies Ledger and Account** (the bill recurs)
  and leaves `Paid` blank. The row writer widens to eleven columns.
- Sheets made before this change have eight columns' worth of headers. The
  first write that needs the new columns adds their headers (and widens the
  sheet if it is narrower); reads tolerate a narrow sheet. **(ruling)**

### 2.1 Connecting

`connectBill(cycle, row, name, ledger, account)`:
- `ledger` must be an existing ledger (one with a live row); a typo cannot
  invent a book. `Pick a ledger.` / `That ledger could not be found.`
- `account` is free text, up to 60 characters (`Pick an account.`,
  `Enter an account of at most 60 characters.`): an account only exists once
  it has an entry, so a new envelope account is created by the first
  deposit, exactly as the ledger form does. The client suggests the ledger's
  existing accounts.
- Row guard as `editBill` (cycle, name; a money-adjacent write names its
  bill). Writes only the two cells, then backfills (§3.3).

`disconnectBill(cycle, row, name)` clears the two cells and nothing else.

`accountsOf(ledger)` (read-only) returns `{ ledger, accounts: [names] }` for
the suggestion list, without switching the person's active ledger.

## 3. Posting

### 3.1 Identity

Each posted entry carries a stable, readable Id:
`bill|<cycle>|<name>|<ledger>|<kind>|<n>`, with `|` inside a part replaced by
`/`, where `<kind>` is `<payday>|<payer, lower-case>` for a tick or `paid`,
and `<n>` counts every entry (voided or not) already carrying that key plus
one. Consequences:
- A retried call finds a **live** entry with the key and posts nothing: no
  duplicate on a lost reply or a queue retry.
- Two simultaneous calls compute the same `<n>`; the ledger's existing
  `idExists_` check, inside its lock, lets one through.
- A voided entry keeps its Id (so re-ticking after an untick gets `n+1`
  rather than being blocked by the voided row).
- Key includes the ledger, so reconnecting to another ledger posts afresh
  there while the old ledger keeps its history.

### 3.2 Entry content

`date` today in the script timezone; `category` `Bill set-aside` (tick) or
`Bill payment` (paid); `source_recipient` the bill's name; `description`
`Set aside for <payday> (<payer>)` or `Paid <name> (<cycle>)`; deposits
`direction: in`, payments `direction: out`; `Logged by` the person who acted
(the tapper, not the payer whose share it is). **(ruling)**

### 3.3 Order and failure

- **Tick / untick** (`setBillFunded`, unchanged signature, still queued
  offline): before writing, if the bill is connected and the ledger is gone,
  refuse with `The connected ledger could not be found. Reconnect the bill.`
  (kind `conflict`: the queue parks it with Discard). Then the existing tick
  write; **then** the posting. A failure after the tick write returns an
  error the queue retries; the retry re-sets the same tick and finds the
  deposit already posted (§3.1). The Apps Script app's ticks post too.
- **Untick** voids every live entry under the key (normally one). A deposit
  already voided by hand is simply not found: no error.
- **Mark paid** (`markBillPaid(cycle, row, name, paid)`, online only):
  needs a connection (`Connect this bill to a ledger first.`) and a bill
  that has an amount and due date; checks the ledger exists; stamps `Paid`;
  then posts the withdrawal. **Undo** clears `Paid` and voids the
  withdrawal; it works on a disconnected bill (clears the stamp only).
- **Connect** backfills one deposit per valid tick that has none, and the
  withdrawal if the bill is already marked paid.

## 4. Client

- Each bill card gets a link line below its schedule. Not connected:
  **Connect to ledger**. Connected: `→ <Ledger> / <Account>`, **Disconnect**,
  and for a bill with an amount, **Mark paid** (or `Paid ✓ <day>` with
  **Undo**).
- **Connect** opens an inline editor: a ledger picker (the ledgers from the
  bootstrap view) and an account text field with a datalist of that ledger's
  accounts, fetched with `accountsOf` when the editor opens and when the
  ledger changes (a late answer for a ledger no longer selected is ignored).
  Save / Cancel. One card editor open at a time (this one, the note editor
  and spec B's amount editor close each other).
- Connect, Disconnect, Mark paid and Undo go straight to the server through
  `billsAction` and are **online only** (disabled offline / signed out /
  busy), like Carry. Ticks are unchanged on the phone: still queued; the
  server posts the deposit.
- The ledger on the phone goes stale when a bill's postings change. So:
  (a) after a successful **Connect**, **Mark paid** or **Undo**, the app runs
  a sync, which (with an empty queue) refetches `bootstrap` and the open
  scope; (b) a bill-only sync (spec A's shortcut, which skips `bootstrap`)
  **still refetches `bootstrap` when any replied cycle view contains a
  connected bill**, because that tick posted a deposit. It still uses the
  replies for the Bills view, so only the ledger refetch is added. **(ruling)**

## 5. Out of scope

- Editing the link of already-posted entries; reposting after the amount or
  due date changes; a "reconcile everything" command.
- Creating a ledger from the Bills tab; the Ledger tab is unchanged.
- Posting for the payer's cash/digital method (the account is whatever the
  user connects).
- Deleting the bill's entries when it is disconnected.

## 6. Testing

- **Server** (`billsSelfCheck_`): column count and `billFromRow_` with the new
  columns (and short rows); `carryRow_` copies the link, blanks `Paid`;
  `billsView_` rows carry `ledger`, `account`, `paid`; the key builder
  (sanitising, prefix-safe for `Vin` vs `Vincent`); `liveWith_` ignores
  voided entries; `nextPostingId_` counts voided ones; the entry builders
  (direction, amount rounding, category, description).
- **Client** (`wiring.js`): the link line in each state; the connect editor
  (ledger list, account suggestions fetched and stale answers ignored,
  validation, Save sends `connectBill`); Disconnect; Mark paid / Undo; all
  disabled offline; a connected bill's tick is still queued with the same
  args as before.

## 7. Hand checks (go into `docs/RUNBOOK.md`, "Stage 5, spec C1")

1. Connect Electricity to ledger `Home`, account `Electricity` (new): the
   sheet gains the three headers; Home has no Electricity account yet.
2. Tick a share: Home gets an `Electricity` account with a deposit of that
   share; the tick on the other phone gives the second deposit.
3. Untick it: the deposit is voided in the ledger and the balance drops.
4. Edit the amount to the real bill, tick the rest, then **Mark paid**: a
   withdrawal of the full amount; the account balance is the leftover.
5. **Undo** paid: the withdrawal is voided.
6. Disconnect, then tick: nothing posts; the earlier entries remain.
7. Reconnect to the same account: existing ticks do not double-post.
8. Carry the bill to the next cycle: the link comes with it, `Paid` does not.
9. Offline: Connect / Mark paid are disabled; a tick still queues and posts
   on reconnect.
