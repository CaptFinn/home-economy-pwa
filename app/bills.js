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
