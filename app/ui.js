// Everything that touches the DOM: the New Entry form, the pending-queue
// list, and the connection line. Pure data shaping (entryFrom, connLabel)
// lives in the same file because both are tiny and only this screen uses
// them — splitting them out would be a second file for no reader's benefit.
import { peso, signed, today, day } from './fmt.js';
import { pendingFor } from './queue.js';

/** Builds the `entry` object addEntry expects, from the form's raw strings
    plus the id assigned when this entry was queued (queue.js's `enqueue`
    never overwrites an id, so the same id rides through to the server and
    makes a replayed send safe). Money and dates are the two things worth
    coercing here; everything else is a straight pass-through of what the
    person typed. */
export function entryFrom(form, id) {
  // Number('1,500') is NaN, not 1500 — parseFloat('1,500') would silently
  // read 1500 and let a mistyped comma send the wrong amount. NaN (and 0,
  // and negative) all mean "not a usable amount", so they all become null
  // and let validate() below refuse the submit rather than guess.
  const amount = Number(form.amount);
  return {
    ledger: form.ledger,
    date: form.date,
    account: form.account,
    category: '', // this form doesn't offer one — spec §10, open item
    source_recipient: form.source,
    description: form.description,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    direction: form.type === 'Deposit' ? 'in' : 'out',
    id,
  };
}

/** Same checks the Apps Script app runs server-side (Ledger.gs's
    validateEntry_), run again here so a bad entry never even reaches the
    queue — retrying the same bad data on sync can't ever succeed. The ledger
    check goes first, matching validateEntry_'s own order, and matters for a
    reason the others don't: renderEntry disables the submit control whenever
    there is no ledger yet (round-2 review, C1), so this is a second line of
    defence for anything that can still call entryFrom/validateEntry without
    going through that form — never the only guard. */
export function validateEntry(entry) {
  if (!String(entry.ledger || '').trim()) return 'Pick a ledger.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date))) return 'Pick a valid date.';
  if (!String(entry.account || '').trim()) return 'Pick an account.';
  if (!String(entry.source_recipient || '').trim()) return 'Enter a source or recipient.';
  if (entry.amount === null) return 'Enter an amount greater than zero.';
  return null;
}

/** An entry as the form's fields, for edit mode (spec §3.3). The amount is
    shown unsigned because the type control carries the sign — the same rule
    the wire follows (entryFrom above), and the sibling app's own editFields. */
export function editFields(t) {
  const amount = Number(t.amount || 0);
  return {
    date: t.date,
    type: amount < 0 ? 'Withdrawal' : 'Deposit',
    account: t.account,
    source: t.source_recipient,
    description: t.description,
    amount: String(Math.abs(amount)),
  };
}

/** The one line of connection status shown at the top of the screen. */
export function connLabel(state) {
  if (!state.online) return 'offline';
  if (state.syncing) return 'syncing…';
  // Distinct from offline or a server hiccup: the server rejected the
  // token itself, so nothing will send again until a person actually
  // signs in — it won't clear on its own the way "offline" does the
  // moment the network comes back.
  if (state.needsAuth) return 'sign in again';
  // A failed sync is not a synced one. Without this the line falls through
  // to the previous `at` and reports success that did not happen.
  if (state.error) return 'sync failed';
  // `at` may be a full 'YYYY-MM-DD HH:MM' or just 'HH:MM'; either way the
  // last space-separated token is the time, which is all this line shows.
  if (state.at) return 'synced ' + String(state.at).split(' ').pop();
  return 'not synced yet';
}

/** The status dot's state (stage 4 spec §2.1), in connLabel's own order;
    '' means all is well. */
export function connState(state) {
  if (!state.online) return 'offline';
  if (state.syncing) return 'syncing';
  if (state.needsAuth) return 'auth';
  if (state.error) return 'error';
  return '';
}

/** entryFrom (and the wire format addEntry expects) always carries an
    unsigned amount plus a separate `direction` — Ledger.gs's appendEntry_
    runs validateEntry_ (which rejects amount <= 0) BEFORE entryRow_ applies
    signAmount_, so a pre-signed negative amount fails validation every
    time and gets permanently parked. Nothing that reaches the wire may
    ever be signed. This is only for turning that unsigned+direction shape
    back into a plain signed number for display and for the one local sum
    below — never for what gets queued or sent. */
export function directedAmount(entry) {
  const n = Math.abs(Number(entry.amount) || 0);
  return entry.direction === 'out' ? -n : n;
}

/** queue.js's pendingFor sums `args.entry.amount` assuming it is already
    signed (that's the shape its own selfcheck.js fixtures use, and it is
    reviewed and frozen). The queue actually holds addEntry items in the
    unsigned+direction wire shape above, so this maps a local, throwaway
    copy — never written back to the store — to a signed amount just for
    that one arithmetic call.

    The `ledger` filter belongs here, on the caller's side, not in
    pendingFor itself: pendingFor matches by account name only, and every
    queued entry already carries `entry.ledger` (entryFrom, above) — but
    widening pendingFor's own signature would break queue.js's frozen
    selfcheck fixtures for nothing. Two books can share an account name
    (e.g. both have a "Groceries"), and the switcher (this stage) is what
    first makes `view.ledger` change under a queue that still holds another
    book's unsent entries — without this filter, an unsent Bills entry
    would leak into Account 1's balance the moment someone switches books. */
export function pendingBalance(queue, account, ledger) {
  const forLedger = queue.filter((item) => item.op !== 'addEntry' || item.args.entry.ledger === ledger);
  const signedQueue = forLedger.map((item) => (item.op !== 'addEntry' ? item : {
    ...item,
    args: { ...item.args, entry: { ...item.args.entry, amount: directedAmount(item.args.entry) } },
  }));
  return pendingFor(signedQueue, account);
}

function field(labelText, input) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function input(id, attrs) {
  const el = document.createElement('input');
  el.id = id;
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'className') el.className = v;
    else el.setAttribute(k, v);
  });
  return el;
}

/** Draws the New Entry form into #ledger-main: date, type, account (with a
    datalist of names already seen — an account is a value, not a fixed
    list, so typing a new one is allowed), source/recipient, description,
    amount, and the submit button. Account balances come from the cached
    bootstrap view, with any pending (still-queued) entries for that account
    added in — labelled as such, since it is only ever an estimate; the
    server's own sum on read is the number of record (queue.js's
    pendingFor). */
/** An account's own colour, from app.css's --acct-<slug> variables; one
    with no colour of its own falls through to neutral. As the sibling app's
    acctColor. */
function acctColor(name) {
  const slug = String(name).toLowerCase().replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return 'var(--acct-' + slug + ', var(--acct-neutral))';
}

export function renderEntry(state) {
  const main = document.getElementById('ledger-main');
  main.textContent = '';

  // A slot for renderPending to fill in, ahead of the form. Kept even
  // though this call just cleared #ledger-main, so renderEntry and
  // renderPending can be called in either order without one wiping the
  // other's part of the screen (main.js always calls this one first, but
  // nothing enforces that from in here). Hidden until it has rows: an
  // empty white panel is noise (stage 4 spec §4).
  const pendingSlot = document.createElement('div');
  pendingSlot.id = 'pending-list';
  pendingSlot.className = 'pending-list panel';
  pendingSlot.hidden = true;
  main.appendChild(pendingSlot);

  const view = state.view || { accounts: [] };
  const queue = state.queue || [];

  if (view.accounts.length) {
    // The hero and the account rail, as in the sibling app (spec §7.1): one
    // figure for the selected account, and a pill per account that selects
    // it. main.js's onScreenClick/onScreenKeydown read data-account (via
    // .closest) — a tap here never talks to the server.
    const selected = view.accounts.find((a) => a.name === state.account) || view.accounts[0];
    const withPending = (a) => a.balance + pendingBalance(queue, a.name, view.ledger);

    const hero = document.createElement('div');
    hero.className = 'hero';
    const figure = document.createElement('div');
    figure.className = 'hero-balance fig';
    figure.textContent = peso(withPending(selected));
    hero.appendChild(figure);
    const label = document.createElement('div');
    label.className = 'hero-label';
    label.textContent = selected.name + ' · balance';
    hero.appendChild(label);
    // Only when something is actually queued for this account (round-2
    // review, C5): otherwise the figure is the server's own.
    if (withPending(selected) !== selected.balance) {
      const note = document.createElement('div');
      note.className = 'txn-balance';
      note.textContent = 'includes pending';
      hero.appendChild(note);
    }
    main.appendChild(hero);

    const rail = document.createElement('div');
    rail.className = 'rail';
    rail.setAttribute('aria-label', 'Accounts');
    view.accounts.forEach((a) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'card';
      pill.dataset.account = a.name;
      pill.setAttribute('aria-pressed', String(a === selected));
      pill.style.setProperty('--card-color', acctColor(a.name));
      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = a.name;
      pill.appendChild(name);
      const amt = document.createElement('span');
      amt.className = 'card-balance fig';
      amt.textContent = peso(withPending(a));
      pill.appendChild(amt);
      rail.appendChild(pill);
    });
    main.appendChild(rail);
  }

  const form = document.createElement('form');
  form.id = 'entry-form';
  form.className = 'entry panel';
  form.autocomplete = 'off';
  // Same heading and button wording as the sibling app in both modes
  // (spec §3.3): the same two people use both.
  const heading = document.createElement('h2');
  heading.textContent = state.editing ? 'Edit entry' : 'New entry';
  form.appendChild(heading);

  const row2 = document.createElement('div');
  row2.className = 'row2';
  const dateInput = input('f-date', { type: 'date', className: 'fig', required: '' });
  dateInput.value = today();
  row2.appendChild(field('Date', dateInput));

  const type = document.createElement('select');
  type.id = 'f-type';
  ['Withdrawal', 'Deposit'].forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t; // not user text — a fixed pair of labels this app defines
    opt.textContent = t;
    type.appendChild(opt);
  });
  row2.appendChild(field('Type', type));
  form.appendChild(row2);

  const account = input('f-account', { list: 'account-names', placeholder: 'Which account' });
  form.appendChild(field('Account', account));
  const datalist = document.createElement('datalist');
  datalist.id = 'account-names';
  view.accounts.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.name; // a property assignment, not HTML — safe for a name typed by a user earlier
    datalist.appendChild(opt);
  });
  form.appendChild(datalist);

  const source = input('f-source', { placeholder: 'Who it came from or went to', required: '' });
  form.appendChild(field('Source or recipient', source));

  const desc = input('f-desc', { placeholder: 'What it was for' });
  form.appendChild(field('Description', desc));

  const amount = input('f-amount', { className: 'fig', inputmode: 'decimal', placeholder: '0.00', required: '' });
  form.appendChild(field('Amount', amount));

  const submit = document.createElement('button');
  submit.className = 'submit';
  submit.type = 'submit';
  submit.textContent = state.editing ? 'Save changes' : 'Add entry';
  form.appendChild(submit);

  if (state.editing) {
    // Voiding is a quiet link, not a second loud button, and it asks twice
    // (state.voidArmed, owned by main.js) — a browser confirm() is no better
    // on a phone, and a money row is worth asking about twice.
    const actions = document.createElement('div');
    actions.className = 'edit-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'edit-cancel';
    cancel.className = 'linkish';
    cancel.textContent = 'Cancel';
    actions.appendChild(cancel);
    const voidBtn = document.createElement('button');
    voidBtn.type = 'button';
    voidBtn.id = 'edit-void';
    voidBtn.className = 'linkish danger';
    voidBtn.textContent = state.voidArmed ? 'Tap again to void' : 'Void this entry';
    actions.appendChild(voidBtn);
    form.appendChild(actions);
  }

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.id = 'entry-hint';
  hint.setAttribute('role', 'status');

  // formValues() (main.js) sends whatever ledger is in `view`, which is ''
  // before the first successful bootstrap (a fresh install taken offline,
  // or just the window before the first sync returns) — and the server
  // refuses a blank ledger permanently, since retrying the same missing
  // value can't ever succeed. Disabling here (round-2 review, C1) stops
  // that entry from ever being queued, rather than parking it forever
  // after the fact.
  if (!view.ledger) {
    submit.disabled = true;
    // The real reason, when there is one: "waiting" is only true while
    // nothing has gone wrong.
    hint.textContent = (state.conn && state.conn.error)
      ? state.conn.error
      : 'Waiting for the first sync before you can add entries.';
    hint.setAttribute('data-state', 'error');
  }
  form.appendChild(hint);

  main.appendChild(form);
}

/** What a still-pending queued item says about itself, per op. */
const OP_PENDING = { addEntry: 'pending', updateEntry: 'edit pending', voidEntry: 'void pending' };

/** Which book a queued item belongs to: an addEntry names it inside its
    entry, an edit or void alongside its row handle. */
function ledgerOf(item) {
  return item.args.ledger || (item.args.entry && item.args.entry.ledger);
}

function shownInRecent(item, acct) {
  if (item.op === 'addEntry') return item.args.entry.account === acct.name;
  return item.state === 'pending' && acct.txns.some((t) => t.row === item.args.row);
}

/** One row for a still-queued addEntry — pulled out so renderPending (the
    ledger-wide list above the form) and renderRecent (below; the same rows,
    filtered one step further to a single account) draw the exact same
    markup for "not sent yet" rather than two implementations that could
    quietly drift apart. */
function pendingRow(item) {
  // A void carries no entry of its own — just the row handle, plus the
  // label main.js copies in for exactly this line.
  const e = item.args.entry || { account: item.args.label || 'An entry' };
  const row = document.createElement('div');
  row.className = item.state === 'parked' ? 'txn' : 'txn pending';
  row.dataset.state = item.state;

  const body = document.createElement('div');
  body.className = 'txn-body';
  const title = document.createElement('div');
  title.className = 'txn-title';
  title.textContent = e.account;
  body.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'txn-meta';
  meta.textContent = item.state === 'parked' ? (item.error || 'Could not send.') : OP_PENDING[item.op];
  body.appendChild(meta);
  row.appendChild(body);

  const right = document.createElement('div');
  right.className = 'txn-right';
  const amt = document.createElement('div');
  amt.className = 'txn-amount fig';
  // e.amount is unsigned (the wire shape, per entryFrom's own doc
  // comment) — directedAmount folds e.direction back in for display only.
  if (e.amount != null) amt.textContent = signed(directedAmount(e));
  right.appendChild(amt);
  // A refused edit or void (spec §5): no automatic merge, this is money —
  // the person picks. Reopen fetches the entry fresh and opens it in the
  // form to redo; Discard drops the refused change and touches nothing on
  // the server.
  if (item.state === 'parked' && item.op !== 'addEntry') {
    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.className = 'linkish pending-mark';
    reopen.textContent = 'Reopen';
    reopen.dataset.reopenId = item.id;
    right.appendChild(reopen);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'linkish pending-mark';
  del.textContent = item.state === 'parked' ? 'Discard' : 'Remove';
  del.dataset.removeId = item.id;
  right.appendChild(del);
  row.appendChild(right);

  return row;
}

/** Lists queued entries above the form, newest first. A pending item is
    dimmed (the .pending class already used by the sibling app's styling); a
    parked one — the server rejected it, or it's stale — stays full-strength
    and shows its error, since that's the one that needs a person to look at
    it. Both carry a delete control, wired up by main.js via the
    data-remove-id attribute (this module never touches the store).

    `ledger` filters the list to the book currently on screen — same reason
    as pendingBalance's own filter above: the queue can hold unsent entries
    for a book the switcher has since moved away from, and listing them
    under the wrong book's accounts is the same leak, just for the list
    instead of the sum.

    `recent` (the account Recent is showing, when there is one) drops what
    is already said further down (spec §7.3): that account's own unsent
    entries are listed in Recent, and a pending edit or void against one of
    its rows is marked on the row itself. A refused edit or void stays here
    even then — its message and its Reopen/Discard live on this list, not on
    the row. */
export function renderPending(queue, ledger, recent) {
  const main = document.getElementById('ledger-main');
  let slot = document.getElementById('pending-list');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'pending-list';
    slot.className = 'pending-list panel';
    main.insertBefore(slot, main.firstChild);
  }
  slot.textContent = '';

  queue
    .filter((i) => ledgerOf(i) === ledger && !(recent && shownInRecent(i, recent)))
    .slice().reverse() // newest first
    .forEach((item) => slot.appendChild(pendingRow(item)));
  slot.hidden = !slot.children.length;
}

/** One confirmed row from bootstrap's own `txns` — same shape as pendingRow
    above (`.txn`, `.txn-body`, `.txn-title`, `.txn-meta`, `.txn-right`,
    `.txn-amount`), plus the arrow and the running balance a queued entry
    does not have yet, matching the Apps Script app's own renderRows because
    the same two people read both. */
function txnRow(t, ctx) {
  const out = Number(t.amount) < 0;
  // A queued edit or void against this very row (spec §5): shown on the row
  // itself, so the history never quietly disagrees with what was typed.
  // Matched by row number within the book — rows never move in this sheet
  // (nothing deletes one), and a stale fingerprint is the server's to judge.
  const queued = ctx.queue.filter((i) => i.op !== 'addEntry' && i.args.ledger === ctx.ledger && i.args.row === t.row).pop();
  const row = document.createElement('div');
  row.className = 'txn'
    + (queued && queued.state === 'pending' ? ' pending' : '')
    + (ctx.editingRow === t.row ? ' is-editing' : '');
  row.dataset.type = out ? 'Withdrawal' : 'Deposit'; // what app.css's .txn[data-type] colors on
  // Tapping a row edits it (main.js reads this via .closest). A div, not a
  // button, because it is a two-line layout; tabindex and main.js's
  // Enter/Space handling keep it reachable without a finger.
  row.dataset.row = String(t.row);
  row.tabIndex = 0;

  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = out ? '↑' : '↓';
  row.appendChild(arrow);

  const body = document.createElement('div');
  body.className = 'txn-body';
  const title = document.createElement('div');
  title.className = 'txn-title';
  title.textContent = t.description || t.source_recipient;
  body.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'txn-meta';
  meta.textContent = day(t.date) + (t.description ? ' · ' + t.source_recipient : '')
    + (!queued ? '' : ' · ' + (queued.state === 'pending' ? OP_PENDING[queued.op] : 'not applied'));
  body.appendChild(meta);
  row.appendChild(body);

  const right = document.createElement('div');
  right.className = 'txn-right';
  const amt = document.createElement('div');
  amt.className = 'txn-amount fig';
  amt.textContent = signed(Number(t.amount));
  right.appendChild(amt);
  const bal = document.createElement('div');
  bal.className = 'txn-balance fig';
  bal.textContent = peso(Number(t.balance));
  right.appendChild(bal);
  row.appendChild(right);

  return row;
}

/** The Recent section (spec §3.1): the selected account's own last-synced
    rows — bootstrap already sends 20 per account with a running balance,
    and stage 1 simply threw them away — with this account's still-queued
    entries above them, reusing pendingRow rather than a second "not sent"
    rendering (carried defect §7, item 3: reconcile, don't accumulate, so
    this task does not add a second way of saying "pending").

    It clears #ledger-side itself, so the section here is always rebuilt
    fresh rather than patched; there is nothing to reuse across renders. */
export function renderRecent(state) {
  // Its own region now (stage 4 spec §3.2), so it clears it itself rather
  // than relying on renderEntry's wipe.
  const side = document.getElementById('ledger-side');
  side.textContent = '';
  const view = state.view || { accounts: [] };
  const queue = state.queue || [];
  const acct = view.accounts.find((a) => a.name === state.account);
  if (!acct) return; // no view yet, or the selected name is gone from this ledger

  const section = document.createElement('section');
  section.className = 'recent panel';
  section.id = 'recent';

  const head = document.createElement('div');
  head.className = 'section-head';
  const h2 = document.createElement('h2');
  h2.textContent = 'Recent';
  head.appendChild(h2);
  const viewAll = document.createElement('button');
  viewAll.type = 'button';
  viewAll.id = 'view-all';
  viewAll.className = 'linkish';
  viewAll.textContent = 'View all';
  head.appendChild(viewAll);
  section.appendChild(head);

  // This account's own unsent entries, above its confirmed ones — the same
  // row pendingRow draws for the ledger-wide list above the form, filtered
  // one step further (account, not just ledger) since Recent is per-account.
  queue
    .filter((i) => i.op === 'addEntry' && i.args.entry.ledger === view.ledger && i.args.entry.account === acct.name)
    .slice().reverse()
    .forEach((item) => section.appendChild(pendingRow(item)));

  const ctx = { queue, ledger: view.ledger, editingRow: state.editing ? state.editing.row : null };
  acct.txns.forEach((t) => section.appendChild(txnRow(t, ctx)));

  side.appendChild(section);
}

/** The full log (spec §3.2): one account's whole history, fifty rows a page,
    in the side region, in place of Recent. The rows arrive with their
    running balance already attached — page two's balances depend on every
    newer row, which only the server has, so nothing here recomputes them.

    Offline there is no `Load 50 more` at all, only a line saying why: a
    button that can only fail is the lie spec §2 rule 1 forbids. */
export function renderLog(state) {
  const side = document.getElementById('ledger-side');
  side.textContent = '';
  const log = state.log;

  const section = document.createElement('section');
  section.className = 'log panel';
  section.id = 'log';

  const head = document.createElement('div');
  head.className = 'section-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.id = 'log-back';
  back.className = 'linkish';
  back.textContent = '‹ Back';
  head.appendChild(back);
  const h2 = document.createElement('h2');
  h2.textContent = log.account + ' — all entries'; // the sibling app's own title
  head.appendChild(h2);
  section.appendChild(head);

  // No is-editing here: tapping a log row closes the log to open the form.
  const ctx = { queue: state.queue || [], ledger: state.ledger, editingRow: null };
  log.rows.forEach((t) => section.appendChild(txnRow(t, ctx)));

  if (log.hasMore && state.conn.online) {
    const more = document.createElement('button');
    more.type = 'button';
    more.id = 'log-more';
    more.className = 'more';
    more.disabled = log.loading;
    // 'Retry' after a failure, as the sibling app does: the rows already
    // shown stay, and the same offset is asked for again.
    more.textContent = log.loading ? 'Loading…' : (log.error ? 'Retry' : 'Load 50 more');
    section.appendChild(more);
  }

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.id = 'log-hint';
  hint.setAttribute('role', 'status');
  if (log.error) {
    hint.textContent = log.error;
    hint.setAttribute('data-state', 'error');
  } else if (log.hasMore && !state.conn.online) {
    hint.textContent = "You're offline — older entries need a connection.";
  } else if (!log.rows.length && !log.loading) {
    hint.textContent = 'No entries for this account.';
  }
  section.appendChild(hint);

  side.appendChild(section);
}

/** Rebuilds the ledger switcher — #ledger-select, fixed in index.html's
    topbar, like #conn — from `state.view.ledgers`, and selects the active
    book. Disabled whenever a switch could not actually work: no view yet
    (nothing to switch between before the first sync), offline (the other
    books' accounts are not cached — offering a switch that cannot work is
    the same lie as a status line reporting a sync it never did), or only
    one ledger to begin with. */
export function renderLedgers(state) {
  const select = document.getElementById('ledger-select');
  const view = state.view;
  const ledgers = (view && view.ledgers) || [];

  select.textContent = '';
  ledgers.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name; // a ledger name typed by a person earlier — never built as HTML
    opt.textContent = name;
    select.appendChild(opt);
  });
  if (view) select.value = view.ledger;

  select.disabled = !view || !state.conn.online || ledgers.length < 2;
}

/** Everything the connection decides (stage 4 spec §2.1, §2.3), all fixed
    in index.html and never recreated: the line's text, the status dot, the
    account button's alert, and the menu's Sync now and Sign in again.
    Called wherever the connection changes, not only from render(). */
export function renderConn(state) {
  document.getElementById('conn').textContent = connLabel(state);
  const status = document.getElementById('status');
  const s = connState(state);
  if (s) status.setAttribute('data-state', s);
  else status.removeAttribute('data-state');
  const btn = document.getElementById('account-btn');
  if (state.needsAuth) btn.setAttribute('data-alert', 'true');
  else btn.removeAttribute('data-alert');
  document.getElementById('menu-signin').hidden = !state.needsAuth;
  document.getElementById('menu-sync').disabled = !state.online;
}

/** Backoff for the sync retry: first wait `min`, then double up to `max`.
    Lives here rather than in main.js because main.js boots the app on
    import and cannot be loaded by the checks — and this rule is worth
    pinning. */
export function nextRetryDelay(previous, min = 5000, max = 60000) {
  return previous ? Math.min(previous * 2, max) : min;
}
