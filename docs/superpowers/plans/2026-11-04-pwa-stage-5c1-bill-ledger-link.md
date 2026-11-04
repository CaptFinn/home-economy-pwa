# PWA Stage 5, Spec C1: Connect a Bill to a Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps are TDD: failing check, watch it fail, minimal code, watch it pass, commit.

**Goal:** A bill connects to a ledger and account; ticks deposit that payer's installment there, a separate Mark paid withdraws the bill's amount, disconnecting keeps history.

**Architecture:** Three new Bill Tracker columns (Ledger, Account, Paid). Server writers post and void ordinary ledger rows through the existing `appendEntry_` / `voidEntry_`, keyed by a readable Id (`bill|cycle|name|ledger|kind|n`) so retries never double-post and a voided entry never blocks a re-post. The client adds a link line and an inline connect editor on each card; all link actions are online-only and go through `billsAction`.

**Tech Stack:** as the other specs (Apps Script V8 server, vanilla ES modules client, node assertion scripts).

**Spec:** `docs/superpowers/specs/2026-11-04-pwa-stage-5c1-bill-ledger-link.md`

**Plan style (ruling).** This plan is lean on purpose: exact interfaces, behaviours, test cases and the risky edit points, with the code itself written in the commits. The user asked for all phases to run without review stops; duplicating every line of code into a document first would cost more than it protects.

## Global Constraints

- Node 24: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH`. Server `check.sh` `node -e` block: no apostrophes, never the word "crypto".
- CLIENT `home-economy-pwa-client` branch `stage-5`; SERVER `Home_Economy_PWA` branch `stage-5-api` (code in `home-economy-app/src/`). Nothing merged, pushed or deployed.
- New Bill Tracker columns appended after Notes: `Ledger` (I), `Account` (J), `Paid` (K). `BILL_HEADERS.length` becomes 11. A–H do not move.
- Entry Id: `bill|<cycle>|<name>|<ledger>|<kind>|<n>`; `|` inside a part becomes `/`; `<kind>` is `<payday>|<payer lower-case>` or `paid`; `<n>` = count of ALL entries (voided too) carrying that key, plus one.
- Entries: `category` `Bill set-aside` (deposit, `direction: 'in'`) or `Bill payment` (withdrawal, `'out'`); `source_recipient` = bill name; date = `todayISO_()`; amount `round2_`.
- Messages (literals): `Pick a ledger.`, `Pick an account.`, `Enter an account of at most 60 characters.`, `That ledger could not be found.`, `The connected ledger could not be found. Reconnect the bill.`, `Connect this bill to a ledger first.`, `That bill needs an amount and a due date first.`
- `kindOf_` gains the prefix `Connect ` under `validation`; the rest already classify (`could not be found` is `conflict`).
- Ticks stay queued on the phone with unchanged args; connect / disconnect / mark paid / undo are online only.
- `sw.js` stays `home-economy-v19`. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

1. A retried tick or paid call never posts twice; an untick after a hand-voided deposit does not error; a re-tick after an untick posts again (the voided Id does not block it).
2. Reconnecting to the same account does not double-post existing ticks; disconnecting posts and voids nothing.
3. The connected ledger being gone refuses the tick/paid before any write (tick parks as a conflict), never silently creates a book.
4. Sheets with only eight columns still read; the first write adds headers; carried rows are eleven wide and copy the link but not `Paid`.
5. A bill-only sync whose reply contains a connected bill still refetches `bootstrap`; one with none still does not.

---

### Task 1: Server — sheet shape and the view

**Files:** `src/Bills.gs`, `src/Code.gs` (comment only)

**Interfaces — Produces:** `BILL_HEADERS` (11 entries, last three `Ledger`, `Account`, `Paid`); `billWidth_(sheet) -> number` (`min(BILL_HEADERS.length, sheet.getMaxColumns())`); `ensureBillColumns_(sheet)` (widens a narrow sheet, writes any blank header cells bold, formats I2:K text); `billFromRow_` rows gain `ledger`, `account`, `paid` (strings, blank for short rows); `carryRow_` returns 11 values (`ledger`, `account` copied through `asText_`, `Paid` blank); `billsView_` rows gain `ledger`, `account`, `paid`.

- [ ] **Step 1 (RED).** In `billsSelfCheck_`: change `eq(BILL_HEADERS.length, 8, 'eight columns')` to `eq(BILL_HEADERS.length, 11, 'eleven columns')` and add `eq(BILL_HEADERS.slice(8).join('|'), 'Ledger|Account|Paid', 'the link columns come last')`; change the `carryRow_` join expectation to `"2026-10|Rent|||2|digital||'- GCash|||"`; add: `billFromRow_` of an 11-value row returns `ledger`/`account`/`paid` trimmed; of the 8-value row returns `''` for all three; `carryRow_({name:'Rent',cutoffs:2,method:'digital',ledger:'Home',account:'Electricity',paid:'2026-09-20 10:00~vin'}, '2026-10')` equals `['2026-10','Rent','','',2,'digital','','','Home','Electricity','']`; `billsView_` row for a bill with a link exposes `ledger`, `account`, `paid`. Run `check.sh`; expect FAIL on the first changed expectation.
- [ ] **Step 2 (GREEN).** Implement. Replace the four `getRange(…, BILL_HEADERS.length)` reads in `readBills_`, `setFunded_`, `setNotes_`, `carryBill_` (and `editBill_` from spec B) with `billWidth_(sheet)`; call `ensureBillColumns_(sheet)` at the top of `appendBillRows_`; add the `I2:K` text format to `createBillTrackerTab`. Fix the stale "never read or write the Ledger tab" comment in `Code.gs`.
- [ ] **Step 3.** `check.sh` green. Commit (`stage-5-api`).

### Task 2: Server — posting, connect, paid

**Files:** `src/Bills.gs`, `src/Code.gs`, `src/Api.gs`

**Interfaces — Produces (Bills.gs):** `postingKey_(bill, kind)`; `tickKind_(payday, payer)`; `entriesWithKey_(entries, key)`; `nextPostingId_(entries, key)`; `tickEntry_(bill, payday, payer, amount, dateISO)`; `paidEntry_(bill, dateISO)`; `postOnce_(bill, kind, entry, email)` (does nothing when a LIVE entry with the key exists; else `appendEntry_` with the next Id); `unpost_(bill, kind, who)` (voids every live entry under the key via `voidEntry_(e.ledger, e.row, fingerprintOf_(e), who)`, ignoring only `already void`); `requireLinkLive_(bill)`; `billAtRow_(row) -> bill|null`; `validateLink_(ledger, account) -> string|null`; `setLink_(cycle, row, name, ledger, account) -> bill` (lock, `billIsTarget_` guard, `ensureBillColumns_`, writes cols 9–10); `setPaid_(cycle, row, name, paid, who) -> bill` (lock, guard; paying needs a non-pending bill, a connection, a live ledger; stamps col 11 `yyyy-MM-dd HH:mm~who`, keeps an existing stamp; unpaying clears it); `backfillPostings_(bill, email)` (one deposit per valid tick of a non-pending bill, plus the withdrawal if `bill.paid`); `syncTickPosting_(row, payday, payer, funded, email)`.
**(Code.gs):** `connectBill(cycle,row,name,ledger,account)`, `disconnectBill(cycle,row,name)`, `markBillPaid(cycle,row,name,paid)`, `accountsOf(ledger) -> {ledger, accounts}`; `setBillFunded` calls `requireLinkLive_(billAtRow_(row))` before the tick when `funded`, then `syncTickPosting_` after it. Each of the first three returns the cycle `billsView_` plus `me`. **(Api.gs):** the four ops.

- [ ] **Step 1 (RED).** Pure checks (key builder sanitises `|`; `Vin` key does not match `Vincent`; `entriesWithKey_` / `nextPostingId_` count voided entries; entry builders: direction, category, rounding of `1875.005`, description; `validateLink_` cases; `kindOf_('Connect this bill to a ledger first.') === 'validation'`; `opHandler_` has the four ops). Then fake-ledger checks: reassign the globals `readEntries_`, `appendEntry_`, `voidEntry_` inside `billsSelfCheck_` to an in-memory array (restore after), and assert: `postOnce_` twice leaves one live entry; `unpost_` leaves none and the voided one remains; `postOnce_` again adds a second entry with the next Id; `unpost_` after the entry was voided by hand does not throw; two payers post separately; paid and tick keys do not collide. Run; expect FAIL (`postingKey_ is not defined`).
- [ ] **Step 2 (GREEN).** Implement as specified, plus `kindOf_` prefix `Connect `.
- [ ] **Step 3.** `check.sh` green. Commit.

### Task 3: Client — link line, connect editor, actions

**Files:** `app/bills.js`, `app/main.js`, `app.css`, `wiring.js`, `selfcheck.js`

**Interfaces — Consumes:** ops from Task 2; `row.ledger/account/paid`; `view.ledgers` (bootstrap). **Produces:** `anyLinked(replies) -> boolean` in `bills.js`; state `bills.connecting`, `bills.linkDraft {ledger, account}`, `bills.linkAccounts []` in `main.js`; ids `link-ledger`, `link-account`, `link-accounts` (datalist), `link-save`, `link-cancel`; data attributes `data-connect-row`, `data-disconnect-row`, `data-pay-row`, `data-unpay-row`; `renderBills` state gains `ledgers`.

- [ ] **Step 1 (RED).** `selfcheck.js`: `anyLinked` true when any reply's `rows` has a `ledger`, false for none / `{}` / `null`. `wiring.js` (inside the Bills block, after spec B's checks): an unconnected card shows **Connect to ledger**; tapping it opens the editor whose ledger picker lists `bootstrapView.ledgers`; `accountsOf` is fetched and the datalist holds its accounts; changing the ledger refetches and a late answer for the old ledger is ignored; an empty account is refused with `Pick an account.` and sends nothing; Save sends `connectBill` with `{cycle, row, name, ledger, account}`, the card then reads `→ Bills / Electricity`, and a sync follows (`bootstrap` is among the requests); **Mark paid** sends `markBillPaid` with `paid: true` and the card reads `Paid ✓ sep 20` with **Undo**; Undo sends `paid: false`; **Disconnect** sends `disconnectBill`; Connect / Mark paid / Disconnect are disabled offline; a tick on a connected bill queues the same args as before and its run requests `bootstrap` (but not `bills`); a tick on an unconnected bill still requests neither. Run; expect FAIL.
- [ ] **Step 2 (GREEN).** `bills.js`: `linkLine`, `linkEditor`, `BUSY_TEXT` map for the hint (`carry`, `edit`, `connect`, `disconnect`, `pay`, `unpay`; `Starting …` stays the fallback), `anyLinked`. `main.js`: state and handlers; `renderBills` call passes `ledgers`; `openConnect`, `fetchLinkAccounts` (sequence-guarded), `saveLink`, disconnect / pay / unpay via `billsAction`, a `sync()` after a successful connect / pay / unpay; opening the connect editor closes the note and amount editors and vice versa; `onBillsChange` handles `link-ledger`; `onBillsClick` handles the new targets; `input` handler keeps the draft. In `sync()`, split `if (fromReplies) {…} else {bootstrap}` into `if (fromReplies) {…}` then `if (!fromReplies || anyLinked(result.replies)) {bootstrap}`. CSS for the link line.
- [ ] **Step 3.** `./check.sh` green; mutation check (drop `anyLinked` from the condition → the linked-tick check fails). Commit.

### Task 4: Runbook

- [ ] Append "Stage 5, spec C1" with the spec's nine hand checks plus: the first connect adds `Ledger`, `Account`, `Paid` headers to Bill Tracker (a one-time sheet change the user may see). Commit.
