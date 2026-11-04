# PWA Stage 5, Spec C2: Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). TDD throughout.

**Goal:** A Dashboard tab with the month's spending across all ledgers, each ledger's figures and trend, and per-account analysis.

**Architecture:** One read-only server op, `dashboard(month)`, computed by a pure `dashboardOf_(entries, month, nowMonth)`; one new client module `app/dashboard.js` draws it in a third tab, cached per month like the Bills views.

**Spec:** `docs/superpowers/specs/2026-11-04-pwa-stage-5c2-dashboard.md`. **Style:** lean plan (as C1): interfaces, behaviours and tests; code in the commits.

## Global Constraints

- Node 24 on PATH (`$HOME/.nvm/versions/node/v24.20.0/bin`); server `check.sh` block: no apostrophes, never the word "crypto".
- CLIENT `home-economy-pwa-client` branch `stage-5`; SERVER `Home_Economy_PWA` branch `stage-5-api`. Nothing merged, pushed or deployed. `sw.js` stays `home-economy-v19` but `app/dashboard.js` is added to its shell list.
- Spending = live rows with `amount < 0`. `Bill set-aside` rows (category) are excluded from *Money in* and reported as *Set aside*, but count in *Net* and balances.
- Result shape exactly as spec §2. Money rounded with `round2_` at the end.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

1. Voided rows never count; set-asides never inflate *Money in*; a payment counts as spending.
2. A blank or malformed month falls back; an empty ledger does not crash; months without spending are zero in the trend.
3. Offline: the last month viewed still shows; a failed fetch keeps it.
4. The new tab does not disturb the Ledger or Bills tab (panels, pickers, remembered tab).

---

### Task 1: Server — `dashboardOf_`, handler, op

**Files:** `src/Bills.gs` (the pure function lives beside the other pure helpers and is checked in `billsSelfCheck_`), `src/Code.gs`, `src/Api.gs`

**Produces:** `dashboardOf_(entries, month, nowMonth) -> result` (spec §2); `getDashboard(month)` in `Code.gs` (read-only: `requireUser_`, `readEntries_`, `todayISO_().slice(0, 7)`); op `dashboard` taking `{month}`.

- [ ] **Step 1 (RED).** In `billsSelfCheck_` add a fixture of live and voided entries over two ledgers (`Home`, `Fun`), accounts with `Bill set-aside` deposits, a `Bill payment`, and rows in three months, and assert: totals; each ledger's `spent/in/setAside/net`; account `balance` (all time, voided excluded); `top` grouping case-folded and capped at three; `trend` has six numbers ending at the chosen month with zeros for empty months; `avg` equals trend total / 6 (rounded); `months` newest first and only months with live rows; a blank / `'bad'` month falls back to the latest month; an empty entry list returns `month` = `nowMonth`, no ledgers, zero totals; `Bill set-aside` excluded from `in` but present in `net`. Also `opHandler_('dashboard')` is a function. Run; expect FAIL (`dashboardOf_ is not defined`).
- [ ] **Step 2 (GREEN).** Implement, wire `getDashboard` and the op. `check.sh` green. Commit on `stage-5-api`.

### Task 2: Client — the tab

**Files:** `index.html`, `app/dashboard.js` (new), `app/main.js`, `app.css`, `sw.js`, `wiring.js`

**Produces:** `renderDashboard(state)` with `state = { dash, conn }`, `dash = { view, month, loading, error }`; ids `tab-dashboard`, `dash-month` (picker), `dashboard` (panel). `main.js`: `tab` may be `'dashboard'`; `loadDashboard()`, `fetchDashboard(token)`, views cached as `dashboard:<month>` and `dashboard:last`.

- [ ] **Step 1 (RED).** `wiring.js`: add `tab-dashboard`, `dash-month`, `dashboard` to the fake DOM's fixed list (`dashboard` and `dash-month` hidden). New block after the Bills scenario: online, click the tab → `dashboard` is requested with `{month: ''}`; the Dashboard panel shows and Ledger/Bills panels and their pickers hide; the totals, each ledger, each account (balance, spent, average, top recipients) are drawn; the month picker lists `months`; choosing one requests it; offline the cached month still shows; an empty view says "Nothing recorded yet."; a failed fetch keeps the cached view and shows the error; switching back to Bills restores its panel. Run; expect FAIL.
- [ ] **Step 2 (GREEN).** Implement. `renderTabs` becomes three-way; `setTab` loads the dashboard; boot restores `'dashboard'` as a remembered tab; `sync()` refreshes it when open; `render()` branches. CSS for panels, bars and the trend. Add `app/dashboard.js` to `sw.js` SHELL.
- [ ] **Step 3.** `./check.sh` green; mutation check (drop the cached-view fallback → the offline check fails). Commit on `stage-5`.

### Task 3: Runbook

- [ ] Append "Stage 5, spec C2" with the spec's six hand checks. Commit.
