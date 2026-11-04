# PWA stage 5, spec C2 — Dashboard

Last of four specs from the 2026-11-03 wishlist. Items 3 and 6:

> 3. Dashboard for Ledger and analysis for each account.
> 6. Basic dashboard of what is needed (open for recos), but we should put
>    the monthly spending dashboard for all ledgers.

The user left the contents open ("open for recos") and asked on 2026-11-04 to
finish all phases without review stops, so what follows is my recommendation
and every choice that is mine is marked **(ruling)**.

## 1. What it is

A third tab, **Dashboard**, beside Ledger and Bills. A month picker in the tab
row (the same slot as the ledger and cycle pickers) chooses the month; the
panel shows, for that month:

1. **All ledgers** — total *Spent*, *Money in*, *Set aside for bills*, *Net*.
2. **Each ledger** — its Spent, Money in, Set aside and Net, a bar comparing
   its spending with the other ledgers', and a six-month spending trend.
3. **Each account** (listed under its ledger) — balance now; *Spent* and
   *Money in* this month; average monthly spend over the last six months;
   the top three places the money went this month; and the same six-month
   trend.

Spending is money out (negative live rows). Voided rows never count. All
figures come from the Ledger tab; nothing on the phone is computed, and a
queued entry that has not synced is not in it. **(ruling)**

### 1.1 Set-asides are not income **(ruling)**

A tick posts a deposit into a bill's envelope account (spec C1) but there is
no matching withdrawal from anywhere, so counting it as *Money in* would
inflate income by exactly what was reserved. Entries with category
`Bill set-aside` are therefore reported on their own line, *Set aside for
bills*, and excluded from *Money in*. They still count in *Net* and in the
account's balance, because the envelope really holds that money. A bill's
payment (`Bill payment`, money out) is ordinary spending.

### 1.2 Months **(ruling)**

- The picker lists every month that has at least one live entry, newest
  first (at most 24). It opens on the latest such month, or the current month
  when the ledger is empty.
- The six-month trend ends at the chosen month and starts five months earlier;
  months with no spending are zero, not skipped.
- The average is the trend's total over six, i.e. a month with no spending
  counts as zero.

## 2. Server

`dashboard(month)` (read-only; any signed-in person) returns, from one read
of the Ledger tab:

```
{ month: '2026-11',
  months: ['2026-11', '2026-10', …],
  trendMonths: ['2026-06', …, '2026-11'],
  totals: { spent, in, setAside, net },
  ledgers: [{
    ledger, spent, in, setAside, net, trend: [spent per trend month],
    accounts: [{ name, balance, spent, in, setAside, avg,
                 top: [{ name, spent }], trend: [...] }]
  }] }
```

- A bad or blank `month` falls back to §1.2's default.
- Ledgers and accounts keep the order they first appear in the tab, as the
  ledger switcher does.
- `top` groups by `source_recipient`, case-folded and trimmed, most spent first,
  at most three, spent above zero only.
- Money is rounded to the centavo (`round2_`) at the end, never per row.
- The pure function `dashboardOf_(entries, month, nowMonth)` does all of it;
  the handler only reads the sheet and supplies the current month.

## 3. Client

- `index.html` gains the tab button, a month `<select>` and the panel section;
  `app/dashboard.js` (new, in the service worker's shell list) draws it.
- Opening the tab shows the cached view at once and fetches when online, as
  the Bills tab does; changing the month fetches that month. Views are cached
  per month (`dashboard:<month>`) and the last month shown is remembered, so
  the tab opens offline. A sync with the tab open refreshes it. A failed fetch
  keeps the cached view and says so on the panel's hint line.
- Empty states: no data → "Nothing recorded yet."; not loaded and offline →
  "Not loaded yet — connect to see this month."
- Bars and the trend are plain CSS (widths and heights), no charting library.
  The figures are also written as text, so nothing depends on seeing the
  graphic. **(ruling)**
- Tab selection is remembered with the rest of the tab state.

## 4. Out of scope

Budgets and targets; category breakdowns beyond the top three recipients;
exporting; editing from the dashboard; comparing arbitrary months; anything
about bills' funding progress (that stays on the Bills tab).

## 5. Testing

- **Server** (`billsSelfCheck_`, a ledger fixture over two ledgers and three
  months): totals and per-ledger and per-account figures; voided rows
  ignored; `Bill set-aside` kept out of *Money in* but in *Net* and balance;
  top-three grouping and case folding; trend length, order and zero months;
  the average; month default and fallback; an empty tab.
- **Client** (`wiring.js`): the tab shows its panel and hides the others;
  opening fetches `dashboard` with no month; the totals, each ledger and
  each account are drawn; the picker lists the months and choosing one
  refetches it; offline shows the cached month; an empty view says so.

## 6. Hand checks (go into `docs/RUNBOOK.md`, "Stage 5, spec C2")

1. Open Dashboard: this month's Spent equals the sum of this month's
   withdrawals across the Ledger tab (spot-check one ledger by hand).
2. A connected bill's tick raises *Set aside for bills*, not *Money in*.
3. Mark that bill paid: Spent rises by the bill's amount.
4. Void an entry in the Ledger tab and pull the dashboard again: it moves.
5. Pick last month: figures and the trend's last bar change; the picker lists
   only months that have entries.
6. Airplane mode: the last month viewed still shows.
