// Everything that touches the DOM: the New Entry form, the pending-queue
// list, and the connection line. Pure data shaping (entryFrom, connLabel)
// lives in the same file because both are tiny and only this screen uses
// them — splitting them out would be a second file for no reader's benefit.
import { peso, signed, today } from './fmt.js';
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
    queue — retrying the same bad data on sync can't ever succeed. */
export function validateEntry(entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date))) return 'Pick a valid date.';
  if (!String(entry.account || '').trim()) return 'Pick an account.';
  if (!String(entry.source_recipient || '').trim()) return 'Enter a source or recipient.';
  if (entry.amount === null) return 'Enter an amount greater than zero.';
  return null;
}

/** The one line of connection status shown at the top of the screen. */
export function connLabel(state) {
  if (!state.online) return 'offline';
  if (state.syncing) return 'syncing…';
  // `at` may be a full 'YYYY-MM-DD HH:MM' or just 'HH:MM'; either way the
  // last space-separated token is the time, which is all this line shows.
  if (state.at) return 'synced ' + String(state.at).split(' ').pop();
  return 'not synced yet';
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

/** Draws the New Entry form into #screen: date, type, account (with a
    datalist of names already seen — an account is a value, not a fixed
    list, so typing a new one is allowed), source/recipient, description,
    amount, and the submit button. Account balances come from the cached
    bootstrap view, with any pending (still-queued) entries for that account
    added in — labelled as such, since it is only ever an estimate; the
    server's own sum on read is the number of record (queue.js's
    pendingFor). */
export function renderEntry(state) {
  const screen = document.getElementById('screen');
  screen.textContent = '';

  // A slot for renderPending to fill in, ahead of the form. Kept even
  // though this call just cleared #screen, so renderEntry and renderPending
  // can be called in either order without one wiping the other's part of
  // the screen (main.js always calls this one first, but nothing enforces
  // that from in here).
  const pendingSlot = document.createElement('div');
  pendingSlot.id = 'pending-list';
  screen.appendChild(pendingSlot);

  const view = state.view || { accounts: [] };
  const queue = state.queue || [];

  if (view.accounts.length) {
    const balances = document.createElement('div');
    balances.id = 'balances';
    view.accounts.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'txn';
      const body = document.createElement('div');
      body.className = 'txn-body';
      const title = document.createElement('div');
      title.className = 'txn-title';
      title.textContent = a.name;
      body.appendChild(title);
      row.appendChild(body);

      const right = document.createElement('div');
      right.className = 'txn-right';
      const amt = document.createElement('div');
      amt.className = 'txn-amount fig';
      amt.textContent = peso(a.balance + pendingFor(queue, a.name));
      right.appendChild(amt);
      const note = document.createElement('div');
      note.className = 'txn-balance';
      note.textContent = 'includes pending';
      right.appendChild(note);
      row.appendChild(right);

      balances.appendChild(row);
    });
    screen.appendChild(balances);
  }

  const form = document.createElement('form');
  form.id = 'entry-form';
  form.autocomplete = 'off';

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
  submit.textContent = 'Add entry';
  form.appendChild(submit);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.id = 'entry-hint';
  hint.setAttribute('role', 'status');
  form.appendChild(hint);

  screen.appendChild(form);
}

/** Lists queued entries above the form, newest first. A pending item is
    dimmed (the .pending class already used by the sibling app's styling); a
    parked one — the server rejected it, or it's stale — stays full-strength
    and shows its error, since that's the one that needs a person to look at
    it. Both carry a delete control, wired up by main.js via the
    data-remove-id attribute (this module never touches the store). */
export function renderPending(queue) {
  const screen = document.getElementById('screen');
  let slot = document.getElementById('pending-list');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'pending-list';
    screen.insertBefore(slot, screen.firstChild);
  }
  slot.textContent = '';

  const items = queue.filter((i) => i.op === 'addEntry').slice().reverse(); // newest first
  items.forEach((item) => {
    const e = item.args.entry;
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
    meta.textContent = item.state === 'parked' ? (item.error || 'Could not send.') : 'pending';
    body.appendChild(meta);
    row.appendChild(body);

    const right = document.createElement('div');
    right.className = 'txn-right';
    const amt = document.createElement('div');
    amt.className = 'txn-amount fig';
    // Queued amounts are already signed (main.js folds direction into the
    // sign before enqueuing — see its onSubmit comment) to match pendingFor's
    // own contract below, so this is just the sum's sign, not a re-derive.
    amt.textContent = signed(e.amount);
    right.appendChild(amt);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'linkish pending-mark';
    del.textContent = 'Remove';
    del.dataset.removeId = item.id;
    right.appendChild(del);
    row.appendChild(right);

    slot.appendChild(row);
  });
}

/** Writes the connection line into #conn — already in index.html's topbar,
    never recreated — and marks it offline for the CSS to color red. */
export function renderConn(state) {
  const conn = document.getElementById('conn');
  conn.textContent = connLabel(state);
  if (state.online) conn.removeAttribute('data-state');
  else conn.setAttribute('data-state', 'offline');
}
