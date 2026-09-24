# PWA stage 4 — Desktop layout and the new look

Stages 1–3 brought the PWA to parity with the Apps Script app: ledger, bills,
and (since stage 3) its hero balance and account rail. This stage adds the
Apps Script app's desktop mode, brings back the bills progress ring, and —
by the user's choice during the parallel run — gives the PWA a look of its
own: an off-white ground with white cards, a quieter header, and an account
menu. The mockups agreed on 2026-09-24 are `whole-app.html` and
`topbar-v2.html` (phones 3 and 4) under `.superpowers/brainstorm/`, which is
git-ignored: they are a local reference, and this spec is the record.

**This ends visual parity.** Spec §7.1 ("Parity, not a redesign") held until
now; from this stage the PWA and the Apps Script app look different. The
Apps Script app is not changed. Whether to retire it (design spec §9, stage
4's "then the decision") stays the user's call and is not part of this work.
Install prompts, also listed under stage 4 there, are left out: Chrome on
Android already offers "Install app" from the manifest.

## 1. What changes

| | Before | After this stage |
|---|---|---|
| Layout | one 480px column | **Mobile \| Desktop switch**, per device |
| Header | wordmark, ledger picker, connection line, name, wrapping | **icon, wordmark, name · status; account button** |
| Ledger picker | header | **tab row, Ledger tab only** |
| Cycle / payday picker | heading and dropdown inside the Bills panel | **tab row, Bills tab only** |
| Ground and blocks | white, hairlines | **off-white ground, white cards** |
| Bills totals | a plain percentage | **the progress ring**, as in the Apps Script app |
| Server | — | **no change** |

## 2. The header and the tab row

### 2.1 Header

One row: the app icon (`icon.svg`, the existing peso mark — no new logo), a
stack of the wordmark over a status line, and the account button at the
right.

- The status line reads `<name> · <connection>`, for example
  `earvindeleon114 · synced 12:50`. `<name>` is `view.user` (what `#whoami`
  shows today); `<connection>` is `connLabel`'s text, unchanged.
- A small dot leads the line, coloured by state: green when synced, muted
  while syncing, red offline, amber for `sign in again` or a failed sync.
- Tapping the status line does what tapping `#conn` does today
  (`onConnClick`): sign in when needed, otherwise sync.
- The header and the tab row keep a white background; the ground below is
  off-white.

### 2.2 Tab row

`Ledger` and `Bills` on the left; the picker for the open tab on the right.

- Ledger tab: `#ledger-select`, moved here from the header. Same options,
  same disabling rules (`renderLedgers`), hidden on the Bills tab.
- Bills tab: `#bills-scope`, now a fixed element in the tab row instead of
  one `renderBills` creates inside `#bills`. Same options (cycles or
  paydays, plus the swap to the other view), same handler (`onScope`),
  hidden on the Ledger tab.
- The Bills panel's own heading (`2026-10`, `Payday sep 15, 2026`, `No
  cycles yet`) goes: the picker already names the scope. The empty and
  not-loaded messages in the panel body stay.

### 2.3 The account button and menu

A round button showing the first letter of `view.user`, uppercased (a
neutral person glyph before the first bootstrap). It opens a small menu:

1. `Signed in as` and the name.
2. `Layout` with the `Mobile | Desktop` switch (§3).
3. `Sync now` — `onConnClick`'s sync path; disabled offline.
4. `Sign in again` — shown only while `conn.needsAuth`; runs the same sign-in
   as tapping the status line.

- While `conn.needsAuth`, the button itself carries a small amber dot, so the
  state is visible with the menu closed.
- The button has `aria-haspopup="menu"` and `aria-expanded`. The menu closes
  on a tap outside it, on Escape (focus returns to the button), and after
  any of its actions.
- `#whoami` and `#conn` stay as the ids of the two halves of the status line,
  so `renderConn` and the whoami write keep their targets.

## 3. Desktop layout

### 3.1 The switch

- `Mobile | Desktop` in the account menu, default Mobile.
- Remembered per device in `localStorage` under `layout` — the same person is
  on a phone and a laptop. Read at the start of `boot()`, before the first
  render. Every access is in try/catch; a refused storage means Mobile for
  this visit.
- Desktop puts `class="desktop"` on `<body>`. No breakpoint auto-switching,
  as in the Apps Script app: the switch is the only thing that changes the
  layout.
- Switching closes an open log (it is arranged differently per layout),
  like the Apps Script app's `setLayout`.

### 3.2 Regions

`#screen` gets two fixed children in `index.html`:

- `#ledger-main`: the pending list slot, hero, account rail and entry form.
  `renderEntry` and `renderPending` write here instead of `#screen`.
- `#ledger-side`: Recent, or the full log. `renderRecent` and `renderLog`
  write here.

`renderBills` builds two regions inside `#bills`, after the full-width parked
items and pending banner:

- `.bill-rows`: the cards or payday lines, and the empty messages.
- `.bills-side`: the ring and totals, Start next cycle, and the hint line.

### 3.3 Mobile

The regions stack in order, one column, `.wrap` at 480px as today. The log
still takes the whole screen: while it is open, `#ledger-main` is hidden.

### 3.4 Desktop (`body.desktop`)

All CSS; nothing is measured in JS.

- `.wrap` widens to 1100px. Header and tab row span the width.
- Ledger: `#screen` is a two-column grid, `#ledger-main` left,
  `#ledger-side` right.
- The log opens in `#ledger-side`, in place of Recent; `#ledger-main` stays,
  with the form usable beside the log. This is the one behaviour difference
  between the layouts, and it is `render()`'s: on Desktop with the log open
  it renders the entry side too, and it hides `#ledger-main` only on Mobile.
- Bills: `#bills` is a grid, `.bill-rows` in a 2fr column, `.bills-side` in a
  1fr column that is `position: sticky` so the totals and Start stay in view
  while the list scrolls.

## 4. The look

- `--bg` becomes an off-white (`#f6f5f2`); `--surface` stays white.
- A shared `.panel` class — white, 16px radius, a soft two-layer shadow, no
  hairline border — goes on: the entry form, Recent, the full log, each bill
  card, the payday lines' block, the totals block, the ledger's pending list,
  and the Bills tab's parked items. The two lists are one panel each, rows
  inside, and a list with no rows draws no empty panel. (Not `.card`: that
  class is the account pill, copied from the Apps Script app.)
- The hero figure and the account rail sit on the ground, not in a panel:
  the balance stays the first thing read.
- Rows inside a panel keep their hairline dividers.
- `[hidden] { display: none !important; }`, as in the Apps Script app: the
  regions and pickers get grid and flex display rules, which would otherwise
  outrank the `hidden` attribute that §2.2 and §3.3 rely on.
- `manifest.webmanifest`'s `background_color` follows `--bg`. `theme-color`
  stays white, matching the header.

## 5. The progress ring

The cycle view's totals block gets the Apps Script app's ring in place of the
plain percentage (`totals-pct`), reversing stage 3 spec §2.3's omission at
the user's request.

- A 62px SVG: a hairline track circle and an ink fill circle whose
  `stroke-dashoffset` shows `pct(funded, billed)` — the same clamped
  percentage shown today — with the rounded percentage in its centre.
- The SVG has `role="img"` and an `aria-label` such as `30% funded`.
- The payday view's totals keep no ring, as in the Apps Script app.
- Styles are copied from the Apps Script app's `.ring` rules.

## 6. Files and checks

- `index.html`: header markup (icon, status stack, account button, menu), the
  two pickers in the tab row, `#ledger-main` / `#ledger-side` in `#screen`.
- `app/ui.js`: `renderEntry` / `renderPending` into `#ledger-main`,
  `renderRecent` / `renderLog` into `#ledger-side`; `renderConn` sets the
  dot's state; the panel class on the blocks it builds.
- `app/bills.js`: the two regions, the ring, the panel class; fills the fixed
  `#bills-scope` instead of creating a select; drops the heading.
- `app/main.js`: layout state, storage and `setLayout`; the account menu's
  open/close and actions; `render()`'s per-layout log rule; the tab row's
  picker visibility in `renderTabs`; `#bills-scope`'s own change listener.
- `app.css`: the header, tab row, menu, panel, ring and desktop grid rules;
  the new `--bg`.
- `manifest.webmanifest`: `background_color`.
- `sw.js`: bump the cache version.
- `docs/RUNBOOK.md`: a stage 4 section.

`check.sh` (selfcheck.js and the wiring.js stub DOM) gains:

- The layout: Desktop from the menu adds `desktop` to `<body>` and stores
  it; a boot with `layout=desktop` stored starts on Desktop; a storage that
  throws leaves Mobile and does not break boot.
- The log on Desktop renders into `#ledger-side` with the entry form still in
  `#ledger-main`; on Mobile `#ledger-main` is hidden while the log is open;
  switching layout closes the log.
- The tab row: `#ledger-select` shows on Ledger and hides on Bills;
  `#bills-scope` the reverse; choosing a scope from the fixed
  `#bills-scope` still loads it.
- The menu: opens and closes (button, outside tap, Escape); `Sign in again`
  shows only while `needsAuth`, and so does the button's dot.
- The status line: name and connection text together; the dot's state for
  offline and for `needsAuth`.
- The ring: its label and percentage match the totals, clamped at 100.
- Existing checks move with their targets (`#screen` → the two regions,
  `#bills-scope` into the tab row) without losing what they pin.

Hand-checked (runbook), on both phones and a laptop:

1. The phone header and tab row match the mockup; nothing wraps at 360px.
2. The account menu opens, closes, and switches layout; the choice survives a
   reload on that device only.
3. Desktop on the laptop: ledger in two columns; View all opens the log on
   the right with the form still usable on the left.
4. Desktop Bills: cards on the left, ring and totals staying in view on the
   right while scrolling.
5. Airplane mode: the status dot turns red, `Sync now` is disabled.
6. An expired session: the amber dot on the button, `Sign in again` in the
   menu, and signing in from there works.

## 7. Not in this stage

- Install prompts.
- Retiring the Apps Script UI, or changing its look.
- Editing a bill's amount or due date (declined 2026-09-24).
- Sign out.
