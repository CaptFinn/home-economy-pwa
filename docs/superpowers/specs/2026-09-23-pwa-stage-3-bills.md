# PWA stage 3 — Bills

Stage 2 brought the ledger to parity with the Apps Script app. This stage does
the same for the Bill Tracker: both of its views, ticking, notes, carrying a
bill forward and starting the next cycle. The desktop layout is stage 4.

## 1. What it adds

| | Apps Script app | PWA after this stage |
|---|---|---|
| Cycle view (cards, schedule, progress, totals) | yes | **this stage** |
| Payday view (each / cash / digital / both) | yes | **this stage** |
| Tick a payer's share | yes | **this stage**, offline-queued |
| Edit a bill's note | yes | **this stage**, offline-queued |
| Carry a funded bill forward | yes | **this stage**, online only |
| Start next cycle | yes | **this stage**, online only |
| Add a bill | no — Bill Tracker tab | no |

Every op already exists in `Api.gs`'s op map. The one server change is the
row guard in §5.

The rules from stage 2 §2 still hold: nothing may silently strand a change,
the wired-up screens are built against the stub-DOM harness, and the server
decides while the client renders — no bill arithmetic in the client.

## 2. Screens

A `Ledger | Bills` tab bar under the top bar, as in the Apps Script app. The
app reopens on the tab it was last on (stored beside the views, §3).

### 2.1 Cycle view

```
2026-09                                   [ 2026-09 ▾ ]
  ⚠ 2 bills need an amount or due date — add them in the Bill Tracker tab.
  ┌────────────────────────────────────────────────┐
  │ Rent · due oct 1   digital   7,500.00  Partial │
  │   sep 15      3,750.00   ☑ Vin sep 15  ☐ Venice│
  │   sep 30      3,750.00   ☐ Vin  ☐ Venice (pending)
  │   ████████░░░░  1,875.00 / 7,500.00 · 5,625.00 remaining
  │   GCash 0917…                  Carry to 2026-10 →│
  └────────────────────────────────────────────────┘
  Billed 24,419.00   Funded 9,200.00   Remaining 15,219.00   38%
  [ Start 2026-10 ]
```

- Title and dropdown: the cycle; the dropdown lists `view.cycles` plus
  `↔ by payday`.
- One card per `view.rows` entry: name and due date, method tag, amount (`—`
  when pending), `status`; one line per `schedule` item with `both` and a box
  per payer (ticked boxes show the day and, on hover, who ticked it from
  `at`/`by`); a progress bar and `progress / amount · remaining` unless
  pending; the note (tap to edit, `Add note` when empty); `Carry to
  YYYY-MM →` when `status` is `Fully funded` and not `carried`, `In YYYY-MM ✓`
  when `carried`.
- Footer: `totals.billed`, `totals.funded`, `totals.remaining`, and their
  ratio as a plain percentage. `Start <next cycle>` names the cycle it will
  create. The pending banner shows when `totals.pending` is non-zero.
- Either payer may tick either box — the server's rule (`setBillFunded`
  doc). Who tapped is taken from the session server-side.

### 2.2 Payday view

One line per row: name, method tag, `each`, the payer boxes. Totals: `Each of
you`, `Cash`, `Digital`, `Both of you`. The dropdown lists `view.paydays`
plus `↔ by cycle`.

### 2.3 Left out

- Adding a bill: the Apps Script app sends people to the Bill Tracker tab
  too. Add it when entering bills from the phone is wanted.
- The progress ring: decorative (aria-hidden in the Apps Script app); a
  plain percentage carries the same number.

## 3. Reading and caching

- Every `bills` / `payday` response is stored with `putView` under
  `bills:cycle:<YYYY-MM>` or `bills:payday:<YYYY-MM-DD>`. The last-opened
  mode, scope and tab are stored under `bills:last`.
- Opening the tab loads the last scope from cache at once, then refetches
  when online. Offline, a scope never loaded shows `Not loaded yet — connect
  to see this cycle.` (or payday).
- An empty scope (`''`) asks the server for the latest cycle or payday; the
  response names the scope it chose, and that key is what gets cached.

## 4. Changes and the queue

### 4.1 Ticks and notes — queued, online or not

Both go through the stage-1 queue even online, like entries: `enqueue`,
then `sync()`. One path to the server.

- Tick: `enqueue('setBillFunded', { cycle, row, name, payday, funded, payer })`.
  In the payday view `cycle` is the row's own `cycle`, not blank.
- Note: `enqueue('setBillNotes', { cycle, row, name, text })`, with
  client-side validation of the 500-character limit only as a courtesy.
- A tick sets a value rather than toggling, so re-tapping simply queues
  another; for each (row, payday, payer) the newest pending item is what
  shows. Likewise the newest pending note per row.
- Pending state is drawn over the cached view: the box or note shows its
  queued value marked *pending*. `progress`, `status` and every total stay
  the server's until the sync lands — the client never recomputes them.

### 4.2 After a sync

`sync()` already refetches `bootstrap`. When the Bills tab is open it also
refetches the current bill scope and caches it, so pending marks clear
against fresh server figures. A failed refetch leaves the cached view up and
reports through the connection line, as `bootstrap` failures do.

### 4.3 Carry and Start next cycle — online only

Direct `api.call('carryBill', { cycle, row })` and
`api.call('newCycle', { cycle: nextCycle(view.cycle) })`. Both return a cycle
view, which is rendered and cached. Offline, or while signed out, the
buttons are disabled with a hint saying why. A refusal shows the server's
message on the bills hint line and re-enables the button. These add rows,
and the server re-derives every precondition inside its lock, so queueing
them would only widen the window for a stale decision.

### 4.4 Parked items

`drain` parks a bill item the server refuses as `conflict` or `validation`
(wrong row, a payday that does not fund the bill, a payer not on the list,
a note over 500 characters). Parked bill items list at the top of the Bills
tab with the server's message and **Discard**. There is no reopen: tapping
the box again is the retry.

The ledger's pending list already excludes them — `ledgerOf` finds no
`ledger` in bill args — and `pendingBalance` only counts `addEntry` items.
Both are pinned by checks (§6).

## 5. Server: the row guard

Bills are addressed by sheet row number (the `ponytail:` in `setFunded_`). A
row deleted or inserted by hand in the Bill Tracker tab shifts every row
below it. `setFunded_` checks only that the payday is on the row's schedule,
and most two-cutoff bills share paydays, so a tick queued before the shift
would land on the wrong bill. Offline queueing stretches that window from
seconds to hours.

In `../Home_Economy_PWA` on a `stage-3-api` branch:

- `setFunded_` and `setNotes_` take an optional expected `name`; `setFunded_`
  also receives the `cycle` it currently ignores.
- When given (non-blank), the row read inside the lock must match that cycle
  and that name (trimmed, case-insensitive), or it fails with the existing
  `That bill could not be found. Reload and try again.` — `kindOf_` already
  classes that as `conflict`, so `drain` parks it.
- Blank skips the check. The Apps Script app sends `''` as the cycle from its
  payday view and never sends a name, so it keeps working unchanged.
- `Api.gs` passes `a.name` through for both ops.
- `billsSelfCheck_` gains the matching / mismatched / blank cases for the
  pure match function.

Deployment, as for @11: merge to local `main`, `clasp push`, cut version 12,
`clasp redeploy` the `Api-deployment` whose id matches `config.js`
(`AKfycbxWIK3O…`) — never `@HEAD` or the `v2`–`v5.5` rows. The /exec URL is
unchanged, so `config.js` is untouched. Each clasp step that touches the live
deployment is confirmed first.

The server ships first. The client's extra `name` would be ignored by @11,
so the order is not fragile.

## 6. Files and checks

- `app/bills.js` (new): the bill renderers, plus pure helpers —
  `overlayQueued(view, queue)`, `billsKey(mode, scope)`, `nextCycle(cycle)`.
- `app/main.js`: tab state, bill state, the dropdown, tick / note / carry /
  new-cycle handlers, the post-sync refetch.
- `index.html`: the tab bar and an empty Bills section.
- `app.css`: card, schedule line and method tag styles, after the Apps
  Script app's.
- `sw.js`: precache `app/bills.js`; bump the cache version.
- `docs/RUNBOOK.md`: a stage 3 section.

`check.sh` (selfcheck.js + the wiring.js stub DOM) covers:

- `overlayQueued`: newest pending wins per box and per note; parked items
  do not overlay; totals untouched.
- `nextCycle`: December rolls the year; a non-cycle gives `''`.
- `billsKey`: the two key shapes.
- Wiring: an offline tick queues the right args (with `name`, and the row's
  own cycle from the payday view) and renders pending; a queued note renders
  its text pending; Carry and Start are disabled offline; a parked tick
  lists with Discard, and Discard removes it; a sync with the Bills tab open
  refetches the scope and clears the pending marks; the ledger's pending
  list and balance ignore bill items.

Hand-checked (runbook):

1. A tick from each phone; Vin ticking Venice's box records Vin as `by`.
2. An offline tick, then reconnect: it syncs and the progress updates.
3. A note edited offline syncs.
4. Carry a fully funded bill; it shows `In YYYY-MM ✓`.
5. Start next cycle from the latest cycle.
6. Queue a tick offline, delete a row above it in the Bill Tracker tab,
   reconnect: the tick is parked, and no other bill changed.
7. Stage 2 check 7 (discarding a parked conflict item), still unreported.

## 7. Not in this stage

- Adding, deleting or editing a bill's amount, due date, cutoffs or method.
- A stable bill id column (the fuller fix §5 stands in for).
- The desktop layout (stage 4).
