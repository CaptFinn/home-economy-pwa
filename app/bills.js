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
