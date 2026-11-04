// The Dashboard tab (stage 5 spec C2): the month's spending across every
// ledger, each ledger's figures and trend, and each account's analysis, drawn
// from what the server sent. Nothing is computed here, and nothing touches the
// store or the network; main.js owns both. Bars and the trend are plain CSS
// (widths and heights), with the figures also written as text.
import { peso, day } from './fmt.js';

/** The views-store key for one month's dashboard. */
export function dashboardKey(month) {
  return 'dashboard:' + month;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/** A percentage for a bar's width, clamped; 0 when there is nothing to compare. */
function pct(part, whole) {
  return whole > 0 ? Math.max(0, Math.min(100, Number(part) / whole * 100)) : 0;
}

function bar(part, whole) {
  const b = el('div', 'bar');
  b.setAttribute('aria-hidden', 'true'); // the figure beside it says the same in words
  const fill = el('i');
  fill.style.width = pct(part, whole) + '%';
  b.appendChild(fill);
  return b;
}

/** Six columns, tallest = the series' own maximum. The text below it is what a
    screen reader gets; the columns are decoration. */
function trend(values, months) {
  const wrap = el('div', 'trend');
  const top = Math.max(...values, 0);
  const cols = el('div', 'trend-cols');
  cols.setAttribute('aria-hidden', 'true');
  values.forEach((v, i) => {
    const col = el('i');
    col.style.height = Math.max(pct(v, top), v > 0 ? 6 : 0) + '%';
    col.title = months[i] + ': ' + peso(v);
    cols.appendChild(col);
  });
  wrap.appendChild(cols);
  wrap.appendChild(el('span', 'sr-only', 'Last six months: ' + values.map(peso).join(', ')));
  return wrap;
}

function line(label, value, grand) {
  const row = el('div', grand ? 'dash-line grand' : 'dash-line');
  row.appendChild(el('span', null, label));
  row.appendChild(el('span', 'fig', value));
  return row;
}

function accountRow(a, months) {
  const row = el('div', 'dash-account');
  const head = el('div', 'dash-account-head');
  head.appendChild(el('span', 'dash-account-name', a.name));
  head.appendChild(el('span', 'fig', peso(a.balance)));
  row.appendChild(head);
  row.appendChild(el('div', 'dash-detail', 'Spent ' + peso(a.spent) + ' · in ' + peso(a.in)
    + (a.setAside ? ' · set aside ' + peso(a.setAside) : '') + ' · avg / month ' + peso(a.avg)));
  if (a.top.length) {
    row.appendChild(el('div', 'dash-detail', 'Top: ' + a.top.map((t) => t.name + ' ' + peso(t.spent)).join(' · ')));
  }
  row.appendChild(trend(a.trend, months));
  return row;
}

function ledgerPanel(l, max, months) {
  const box = el('section', 'dash-ledger panel');
  const head = el('div', 'dash-head');
  head.appendChild(el('span', 'dash-ledger-name', l.ledger));
  head.appendChild(el('span', 'fig', peso(l.spent)));
  box.appendChild(head);
  box.appendChild(bar(l.spent, max));
  box.appendChild(el('div', 'dash-detail', 'Money in ' + peso(l.in) + ' · set aside ' + peso(l.setAside)
    + ' · net ' + peso(l.net)));
  box.appendChild(trend(l.trend, months));
  l.accounts.forEach((a) => box.appendChild(accountRow(a, months)));
  return box;
}

/** 'YYYY-MM' as the picker names it: 'oct 2026'. */
function monthLabel(m) {
  return day(m + '-01').split(' ')[0] + ' ' + m.slice(0, 4);
}

/** Draws #dashboard and refills the month picker. `state` is { dash, conn }
    with `dash` being main.js's own object. */
export function renderDashboard(state) {
  const host = document.getElementById('dashboard');
  host.textContent = '';
  const { dash, conn } = state;
  const view = dash.view;

  const select = document.getElementById('dash-month');
  select.textContent = '';
  // The list outlives the view: a month that is not cached leaves no view to
  // read it from, and the picker must still offer the way back.
  const opts = (view ? view.months : dash.months).slice();
  const shown = view ? view.month : dash.month;
  if (shown && !opts.includes(shown)) opts.unshift(shown);
  opts.forEach((m) => {
    const o = el('option', null, monthLabel(m));
    o.value = m;
    select.appendChild(o);
  });
  if (shown) select.value = shown;
  select.disabled = !opts.length;

  if (dash.error) {
    const err = el('p', 'hint', dash.error);
    err.setAttribute('role', 'status');
    err.setAttribute('data-state', 'error');
    host.appendChild(err);
  }
  if (!view) {
    host.appendChild(el('p', 'empty', dash.loading ? 'Loading…'
      : conn.online ? 'Not loaded yet.' : 'Not loaded yet — connect to see this month.'));
    return;
  }
  if (!view.ledgers.length) {
    host.appendChild(el('p', 'empty', 'Nothing recorded yet.'));
    return;
  }

  const t = view.totals;
  const sum = el('section', 'dash-summary panel');
  sum.appendChild(line('Spent', peso(t.spent), true));
  sum.appendChild(line('Money in', peso(t.in)));
  sum.appendChild(line('Set aside for bills', peso(t.setAside)));
  sum.appendChild(line('Net', peso(t.net)));
  host.appendChild(sum);

  const max = Math.max(...view.ledgers.map((l) => l.spent), 0);
  view.ledgers.forEach((l) => host.appendChild(ledgerPanel(l, max, view.trendMonths)));
}
