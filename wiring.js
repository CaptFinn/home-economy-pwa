// Runs the real client modules against a fake DOM. It cannot see what is
// drawn — it catches what actually broke in stage 1: a renamed field, a
// wrong argument, a handler that throws, a promise that never settles, and
// above all an entry that reaches the queue in the wrong shape.
import assert from 'node:assert/strict';

// Matches one simple CSS selector — a class, an id, a tag name, or a bare
// `[data-x]` presence check; no combinators or pseudo-classes. The last form
// is what onScreenClick's own `.closest('[data-remove-id]')` (and, this
// task, `[data-account]`) needs — main.js already reached for it before this
// stub could answer it, so this is closing a gap the harness had, not adding
// one main.js doesn't use.
function matchesSelector(el, sel) {
  if (sel[0] === '.') return String(el.className || '').split(/\s+/).includes(sel.slice(1));
  if (sel[0] === '#') return el.id === sel.slice(1);
  const attr = /^\[data-([a-z-]+)\]$/.exec(sel);
  if (attr) {
    const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return el.dataset ? el.dataset[key] !== undefined : false;
  }
  return el.tagName === sel.toUpperCase();
}

// Depth-first search of `root`'s descendants (not `root` itself) for every
// element matching one simple selector.
function queryAll(root, sel) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (matchesSelector(child, sel)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

// ── a DOM small enough to read, large enough to wire ──────────────────
export function makeDom() {
  const byId = new Map();

  const make = (tag = 'div') => {
    // Real textContent and id both need their own per-element setter
    // (below), so both live in closure variables rather than as plain
    // object fields.
    let text = '';

    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attributes: {},
      dataset: {},
      style: {},
      className: '',
      value: '',
      disabled: false,
      hidden: false,
      listeners: {},
      appendChild(child) { child.parent = this; this.children.push(child); return child; },
      // Mirrors real DOM's insertBefore(node, null): appends. A reference
      // node not found in `children` also falls back to append rather than
      // throwing (a real DOM throws) — looser, but nothing here ever passes
      // a stray reference, and honest logging isn't worth the extra code.
      insertBefore(child, ref) {
        child.parent = this;
        const i = ref == null ? -1 : this.children.indexOf(ref);
        if (i === -1) this.children.push(child); else this.children.splice(i, 0, child);
        return child;
      },
      // Real Element.closest: this element, then each ancestor in turn,
      // until one matches or the tree runs out. Needed the moment a click's
      // `target` is a nested child (a title, an arrow) rather than the row
      // itself — the common case for a real tap, and the one thing a test
      // that always dispatches straight on the row would never catch going
      // missing.
      closest(sel) {
        let el = this;
        while (el) {
          if (matchesSelector(el, sel)) return el;
          el = el.parent || null;
        }
        return null;
      },
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') byId.set(String(v), this); },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      removeEventListener() {},
      dispatch(type, event = {}) {
        for (const fn of this.listeners[type] || []) fn({ type, preventDefault() {}, target: this, ...event });
      },
      // Enough to answer `.class`, `#id` and a bare tag name over the
      // subtree — see matchesSelector/queryAll above.
      querySelector(sel) { return queryAll(this, sel)[0] || null; },
      querySelectorAll(sel) { return queryAll(this, sel); },
      focus() {},
      scrollIntoView() {},
      remove() {},
    };
    Object.defineProperty(el, 'id', {
      get() { return this.attributes.id || ''; },
      set(v) { this.setAttribute('id', v); },
    });
    Object.defineProperty(el, 'firstChild', {
      get() { return this.children[0] || null; },
    });
    // A real DOM's textContent setter removes every existing child. Without
    // this, renderEntry's `screen.textContent = ''` only erased a string the
    // stub never read back — the stale children from a PREVIOUS render stayed
    // in `children`, so textOf() could still see them and a test asserting
    // on the current render could pass on output it never produced (review
    // finding 1).
    Object.defineProperty(el, 'textContent', {
      get() { return text; },
      set(v) { text = v == null ? '' : String(v); this.children = []; },
    });
    return el;
  };

  const bodyEl = make('body');
  const document = {
    createElement: (tag) => make(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => queryAll(bodyEl, sel)[0] || null,
    querySelectorAll: (sel) => queryAll(bodyEl, sel),
    addEventListener() {},
    body: bodyEl,
  };

  // The fixed elements index.html ships with. Registered in byId (so
  // getElementById finds them, as it always did) AND appended to the body —
  // without that second step document.querySelector/All, which walks the
  // body's actual children rather than the byId map, searched an empty
  // tree and returned null for every one of them.
  for (const id of ['screen', 'conn', 'whoami', 'foot', 'ledger-select']) {
    const el = make('div');
    el.id = id;
    byId.set(id, el);
    bodyEl.appendChild(el);
  }
  return { document, make, byId };
}

/** Every bit of text in a subtree, flattened — enough to assert what a
    render produced without pretending to be a browser. */
export function textOf(el) {
  if (!el) return '';
  const own = el.textContent || '';
  return [own, ...el.children.map(textOf)].filter(Boolean).join(' ');
}

/** Depth-first search for the first element matching a predicate. */
export function find(el, fn) {
  if (!el) return null;
  if (fn(el)) return el;
  for (const child of el.children) {
    const hit = find(child, fn);
    if (hit) return hit;
  }
  return null;
}

const { document, byId } = makeDom();
globalThis.document = document;
globalThis.window = { addEventListener() {}, location: { origin: 'https://example.test' } };
// Node itself defines a read-only `navigator` global (its own Navigator-ish
// object, since Node 21) — a plain assignment throws where a browser would
// just let this replace `window.navigator`. defineProperty stands in for
// the assignment a browser would allow, without changing what gets set.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
globalThis.localStorage = undefined;

const ui = await import('./app/ui.js');
const { memoryStore } = await import('./app/db.js');
const { enqueue } = await import('./app/queue.js');

// ── what reaches the queue (the stage 1 Critical) ─────────────────────
{
  const store = memoryStore();
  const entry = ui.entryFrom({
    ledger: 'Bills', date: '2026-09-18', account: 'Groceries',
    type: 'Withdrawal', source: 'SM', description: 'weekly', amount: '1240.50',
  }, 'id-1');
  await enqueue(store, 'addEntry', { entry });
  const [queued] = await store.listQueue();

  assert.equal(queued.args.entry.amount, 1240.5,
    'the queued amount is POSITIVE — the server applies the sign, once');
  assert.equal(queued.args.entry.direction, 'out', 'and the direction travels with it');
  assert.ok(queued.args.entry.amount > 0,
    'a pre-signed amount is refused by validateEntry_ before signAmount_ ever runs');
  assert.equal(queued.args.entry.id, 'id-1', 'the idempotency id rides along');
}

// ── the connection line can never claim a sync it did not do ──────────
{
  assert.equal(ui.connLabel({ online: true, syncing: false, at: '23:40' }), 'synced 23:40',
    'a real sync reports its time');
  assert.equal(ui.connLabel({ online: true, syncing: false, at: '23:40', error: 'boom' }),
    'sync failed', 'a stale timestamp never outranks a failure');
  assert.equal(ui.connLabel({ online: false, syncing: false, at: '23:40' }), 'offline',
    'and offline outranks both');
}

// ── the home screen renders what the server sent ──────────────────────
{
  const view = {
    user: 'vin', ledger: 'Bills', ledgers: ['Bills', 'Account 1'],
    accounts: [
      { name: 'Groceries', balance: 301, txns: [] },
      { name: 'Electricity', balance: 1500, txns: [] },
    ],
  };
  ui.renderEntry({ view, queue: [], conn: { online: true } });
  const text = textOf(document.getElementById('screen'));
  assert.ok(text.includes('Groceries'), 'every account is listed');
  assert.ok(text.includes('Electricity'), 'not just the first');
  assert.ok(text.includes('301.00'), 'with its balance');
}

// ── a second render must not leak the first one's nodes (review finding 1) ──
{
  const view2 = {
    user: 'vin', ledger: 'Bills', ledgers: ['Bills'],
    accounts: [{ name: 'Rent', balance: 500, txns: [] }],
  };
  ui.renderEntry({ view: view2, queue: [], conn: { online: true } });
  const text2 = textOf(document.getElementById('screen'));
  assert.ok(text2.includes('Rent'), 'the second render shows its own account');
  assert.ok(!text2.includes('Groceries'),
    'and none of the previous render survives — textContent really clears children, not just its own text');
}

// ── renderPending, including the insertBefore branch it only avoids
// throwing on because renderEntry always seeds #pending-list first
// (review finding 4) ────────────────────────────────────────────────────
{
  byId.delete('pending-list'); // forces renderPending to build the slot itself
  const queue = [{
    id: 'q1', op: 'addEntry', state: 'pending',
    args: { entry: { account: 'Groceries', amount: 40, direction: 'out' } },
  }];
  ui.renderPending(queue);
  const screen = document.getElementById('screen');
  assert.equal(document.getElementById('pending-list'), screen.firstChild,
    'insertBefore actually placed the new slot at the front of #screen');
  const text3 = textOf(screen);
  assert.ok(text3.includes('Groceries'), 'a pending entry is listed');
  assert.ok(text3.includes('pending'), 'and marked pending');
}

// ── the cross-ledger leak (fix round 1, item 1 — CRITICAL): an unsent
// entry queued for one book must not bleed into another book's balance or
// list just because two books happen to share an account name ───────────
{
  byId.delete('pending-list');
  const queue = [
    { id: 'q1', op: 'addEntry', state: 'pending',
      args: { entry: { ledger: 'Bills', account: 'Groceries', amount: 40, direction: 'out' } } },
    { id: 'q2', op: 'addEntry', state: 'pending',
      args: { entry: { ledger: 'Account 1', account: 'Groceries', amount: 999, direction: 'out' } } },
  ];
  assert.equal(ui.pendingBalance(queue, 'Groceries', 'Bills'), -40,
    "only Bills' own unsent entry counts toward Bills' Groceries balance");
  assert.equal(ui.pendingBalance(queue, 'Groceries', 'Account 1'), -999,
    "and Account 1 sees only its own 999, not Bills' 40");

  ui.renderPending(queue, 'Bills');
  const text4 = textOf(document.getElementById('screen'));
  assert.ok(!text4.includes('999.00'), "Account 1's queued entry is not listed while Bills is on screen");
}

// ── recent entries (spec §3.1) ────────────────────────────────────────
{
  const view = {
    ledger: 'Bills',
    ledgers: ['Bills'],
    accounts: [{
      name: 'Joint Wallet', balance: 1840,
      txns: [
        { row: 12, fp: 'a', date: '2026-09-17', account: 'Joint Wallet',
          source_recipient: 'Food', description: 'Beef loaf and eggs',
          amount: -60, balance: 1840 },
        { row: 11, fp: 'b', date: '2026-09-16', account: 'Joint Wallet',
          source_recipient: 'Salary', description: '', amount: 1955, balance: 1900 },
      ],
    }],
  };
  ui.renderRecent({ view, account: 'Joint Wallet', queue: [] });
  const text = textOf(document.getElementById('screen'));
  assert.ok(text.includes('Beef loaf and eggs'), 'the description is the title when there is one');
  assert.ok(text.includes('Salary'), 'and the source stands in when there is not');
  assert.ok(text.includes('60.00') && text.includes('1,955.00'), 'both amounts are shown');
  assert.ok(text.includes('sep 17'), 'dates read like the Apps Script app');
}

// ── Recent's own pending rows are per-account, not per-ledger (unlike the
// list above the form) — reusing pendingRow's markup, filtered one step
// further, per spec §3.1's "queued entries appear above them" ───────────
{
  const view = {
    ledger: 'Bills', ledgers: ['Bills'],
    accounts: [
      { name: 'Groceries', balance: 300, txns: [] },
      { name: 'Electricity', balance: 1500, txns: [] },
    ],
  };
  const queue = [
    { id: 'q1', op: 'addEntry', state: 'pending',
      args: { entry: { ledger: 'Bills', account: 'Groceries', amount: 40, direction: 'out' } } },
    { id: 'q2', op: 'addEntry', state: 'pending',
      args: { entry: { ledger: 'Bills', account: 'Electricity', amount: 700, direction: 'out' } } },
  ];
  ui.renderRecent({ view, account: 'Groceries', queue });
  const text = textOf(document.getElementById('screen'));
  assert.ok(text.includes('pending'), "Groceries' own queued entry shows, marked pending");
  assert.ok(!text.includes('700.00'), "Electricity's queued entry does not bleed into Groceries' Recent");
}

// ── the full log (spec §3.2) ──────────────────────────────────────────
{
  ui.renderLog({
    log: {
      account: 'Groceries',
      rows: [{ row: 3, fp: 'x', date: '2026-09-16', account: 'Groceries',
               source_recipient: 'SM', description: 'Groceries',
               amount: -1699, balance: 301 }],
      hasMore: true, loading: false, error: '',
    },
    conn: { online: true },
  });
  const text = textOf(document.getElementById('screen'));
  assert.ok(text.includes('Groceries'), 'the account is named');
  assert.ok(text.includes('1,699.00'), 'its rows are listed');
  assert.ok(text.includes('Load 50 more'), 'and more can be asked for');

  ui.renderLog({
    log: { account: 'Groceries', rows: [], hasMore: true, loading: false, error: '' },
    conn: { online: false },
  });
  assert.ok(textOf(document.getElementById('screen')).includes('offline'),
    'offline, the log says what it cannot do rather than offering a dead button');
}

// ── main.js's actual wiring: the submit handler and a failed sync ─────
// Everything above exercises ui.js's pure and DOM-drawing halves directly.
// Two of stage 1's three shipped bugs — the client-signed amount, and the
// status line reporting a sync that failed — lived in main.js itself
// (onSubmit and sync()), which nothing above ever imports or runs. This
// block drives the real event handlers, stubbing only the three globals
// the app actually bottoms out at: fetch, google, and indexedDB.
{
  // A small, honest stand-in for IndexedDB: one named database, three
  // keyPath stores, backed by Maps. It models exactly what db.js's real
  // implementation calls — open()/onupgradeneeded, transaction()/
  // objectStore(), get/put/getAll/delete — and nothing else: no indexes,
  // no cursors, no transaction durability or readonly enforcement, no
  // versionchange handling. db.js never reaches for any of those, so this
  // is enough to run its real (not memoryStore's stand-in) code path.
  const databases = new Map();
  function makeRequest() { return { result: undefined, error: undefined, onsuccess: null, onerror: null }; }
  function succeed(req, result) {
    req.result = result;
    queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); });
  }
  function objectStoreFor(def) {
    return {
      get(key) { const r = makeRequest(); succeed(r, def.data.get(key)); return r; },
      put(value) { const r = makeRequest(); def.data.set(value[def.keyPath], value); succeed(r, value[def.keyPath]); return r; },
      getAll() { const r = makeRequest(); succeed(r, [...def.data.values()]); return r; },
      delete(key) { const r = makeRequest(); def.data.delete(key); succeed(r, undefined); return r; },
    };
  }
  globalThis.indexedDB = {
    open(name, version) {
      const req = makeRequest();
      let record = databases.get(name);
      const isNew = !record; // onupgradeneeded fires only the first time this named db is opened
      if (isNew) { record = { version, stores: new Map() }; databases.set(name, record); }
      req.result = {
        createObjectStore(storeName, { keyPath }) { record.stores.set(storeName, { keyPath, data: new Map() }); },
        transaction(storeName) {
          const def = record.stores.get(storeName);
          return { objectStore: () => objectStoreFor(def) };
        },
      };
      queueMicrotask(() => {
        if (isNew && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };

  // A fake accounts.id whose prompt(cb) reports a skipped moment straight
  // away, so refresh() resolves null promptly instead of waiting out its
  // real 4-second timeout for a popup that will never appear under node.
  const fakeGoogle = {
    accounts: {
      id: {
        initialize() {},
        prompt(cb) { cb({ isNotDisplayed: () => false, isSkippedMoment: () => true }); },
        renderButton() {},
      },
    },
  };
  globalThis.google = fakeGoogle;
  globalThis.window.google = fakeGoogle;

  // fetch is api.js's one call to the outside world; this swaps its answer
  // per scenario below rather than adding any test-only branch to api.js.
  let fetchImpl = async () => ({ text: async () => '{}' });
  globalThis.fetch = (...args) => fetchImpl(...args);
  function fetchReturning(body) {
    return async () => ({ text: async () => JSON.stringify(body) });
  }
  const settle = () => new Promise((r) => setTimeout(r, 0)); // flushes any pending microtask chain

  const db = await import('./app/db.js');
  const main = await import('./app/main.js');

  // Seeded so boot() finds a signed-in session and a real ledger, and never
  // has to render Google's actual sign-in button — which would hang this
  // script waiting for a tap that can never come under node.
  await db.putAuth({ email: 'vin@example.test', token: 'tok-1' });
  const bootstrapView = {
    // Two ledgers (not one) so the switcher boot() renders is actually
    // enabled — the switchLedger scenario further down needs a live
    // control to dispatch `change` against.
    user: 'vin', ledger: 'Bills', ledgers: ['Bills', 'Account 1'],
    // Two accounts, each with one recent row of its own — the recent-entries
    // scenario just below needs a second account to tap into, and content
    // in each that only shows up if Recent is actually reading the right one.
    accounts: [
      { name: 'Groceries', balance: 300,
        txns: [{ row: 1, fp: 'g1', date: '2026-09-15', account: 'Groceries',
                 source_recipient: 'SM', description: 'Rice', amount: -200, balance: 300 }] },
      { name: 'Electricity', balance: 500,
        txns: [{ row: 2, fp: 'e1', date: '2026-09-14', account: 'Electricity',
                 source_recipient: 'Meralco', description: '', amount: -500, balance: 500 }] },
    ],
  };
  await db.putView('bootstrap', bootstrapView);
  fetchImpl = fetchReturning({ ok: true, data: bootstrapView }); // answers boot()'s own background sync()

  await main.boot();
  await settle(); // boot() fires sync() without awaiting it — let that settle before asserting on it

  assert.match(document.getElementById('conn').textContent, /^synced \d{2}:\d{2}$/,
    'boot wired a real, successful sync before either scenario below touches it');

  // ── Recent defaults to the first account, and a real tap (or Enter) on a
  // balances-list row switches it — through main.js's actual listeners, not
  // ui.renderRecent called directly (that is the block above this one) ────
  {
    const bootedText = textOf(document.getElementById('screen'));
    assert.ok(bootedText.includes('Rice'), 'the first account is selected on boot, before any tap');
    assert.ok(!bootedText.includes('Meralco'), 'and only its own recent row shows');

    // A click's `target` is often a nested child, not the row itself — this
    // dispatches on the title inside the Electricity row, the way a real tap
    // would, so the assertion also covers closest() actually walking up to
    // the ancestor that carries data-account, not just matching on itself.
    const electricityRow = find(document.getElementById('screen'), (el) => el.dataset.account === 'Electricity');
    assert.ok(electricityRow, 'the balances list marks each row with the account it belongs to');
    const electricityTitle = electricityRow.querySelector('.txn-title');
    document.getElementById('screen').dispatch('click', { target: electricityTitle });

    const afterClick = textOf(document.getElementById('screen'));
    assert.ok(afterClick.includes('Meralco'), 'tapping a balances row switches Recent to that account');
    assert.ok(!afterClick.includes('Rice'), 'and the previous account no longer shows');

    // Back to Groceries, this time by keyboard — the row is a div, not a
    // button, so Enter has to be wired up on purpose rather than arriving free.
    const groceriesRow = find(document.getElementById('screen'), (el) => el.dataset.account === 'Groceries');
    document.getElementById('screen').dispatch('keydown', { target: groceriesRow, key: 'Enter' });
    const afterKey = textOf(document.getElementById('screen'));
    assert.ok(afterKey.includes('Rice'), 'Enter on a balances row selects it too, not just a click');
  }

  // ── the full log through main.js: View all, a page, a failed page, the
  // retry, Back (spec §3.2) ───────────────────────────────────────────────
  {
    const sent = [];
    const answer = (body) => async (url, req) => {
      sent.push(JSON.parse(req.body));
      return { text: async () => JSON.stringify(body) };
    };
    const logRow = (n) => ({ row: n, fp: 'l' + n, date: '2026-08-01', account: 'Groceries',
                             source_recipient: 'Old shop ' + n, description: '', amount: -1, balance: 1 });
    const screen = document.getElementById('screen');

    fetchImpl = answer({ ok: true, data: { rows: [logRow(90)], hasMore: true } });
    screen.dispatch('click', { target: find(screen, (el) => el.id === 'view-all') });
    await settle();
    assert.deepEqual(sent.map((b) => [b.op, b.args.account, b.args.offset]), [['entries', 'Groceries', 0]],
      'View all asks for page one of the selected account');
    assert.ok(textOf(screen).includes('Old shop 90'), 'and shows what came back');

    fetchImpl = answer({ ok: false, error: 'The sheet is busy right now. Try again in a moment.', kind: 'server' });
    screen.dispatch('click', { target: find(screen, (el) => el.id === 'log-more') });
    await settle();
    assert.ok(textOf(screen).includes('busy right now'), 'a failed page says why');
    assert.ok(textOf(screen).includes('Old shop 90'), 'and leaves the rows already loaded alone');

    fetchImpl = answer({ ok: true, data: { rows: [logRow(89)], hasMore: false } });
    screen.dispatch('click', { target: find(screen, (el) => el.id === 'log-more') });
    await settle();
    assert.equal(sent[2].args.offset, 1, 'the retry asks for the offset after what is shown, not past it');
    assert.ok(textOf(screen).includes('Old shop 89'), 'the next page is appended');
    assert.ok(!find(screen, (el) => el.id === 'log-more'), 'and no more is offered once hasMore is false');

    screen.dispatch('click', { target: find(screen, (el) => el.id === 'log-back') });
    assert.ok(find(screen, (el) => el.id === 'entry-form'), 'Back returns home');
  }

  // ── the stage 1 Critical, through the actual submit handler ──────────
  document.getElementById('f-date').value = '2026-09-19';
  document.getElementById('f-type').value = 'Withdrawal';
  document.getElementById('f-account').value = 'Groceries';
  document.getElementById('f-source').value = 'SM';
  document.getElementById('f-desc').value = 'weekly';
  document.getElementById('f-amount').value = '75';

  navigator.onLine = false; // so onSubmit's own fire-and-forget sync() can't race this assertion
  document.getElementById('screen').dispatch('submit', { target: document.getElementById('entry-form') });
  await settle(); // let onSubmit's awaited enqueue() finish

  const queuedAfterSubmit = (await db.listQueue()).filter((q) => q.op === 'addEntry');
  assert.equal(queuedAfterSubmit.length, 1, 'the real submit handler queued exactly one entry');
  assert.equal(queuedAfterSubmit[0].args.entry.amount, 75,
    'through onSubmit, not just entryFrom directly — the queued amount is still POSITIVE');
  assert.equal(queuedAfterSubmit[0].args.entry.direction, 'out', 'and direction still carries the sign');

  // ── a failed sync is not a synced one, through the actual sync() ─────
  fetchImpl = fetchReturning({ ok: false, error: 'Could not reach the sheet.', kind: 'server' });
  // Still offline from above — sidesteps scheduleRetry()'s real setTimeout,
  // which would otherwise leave a live timer holding this script open for
  // up to 60 real seconds after the console.log below.
  await main.sync();

  const queuedAfterFailedSync = (await db.listQueue()).filter((q) => q.op === 'addEntry');
  assert.equal(queuedAfterFailedSync.length, 1, 'a failed send leaves the entry queued — nothing actually went');
  assert.equal(queuedAfterFailedSync[0].state, 'pending', 'still pending, not parked');
  assert.equal(document.getElementById('conn').textContent, 'sync failed',
    'the connection line never claims a sync that did not happen');

  // ── losing the session must not leave the OLD clock standing (task 2,
  // carried from Task 1's review) ──────────────────────────────────────
  // The assertion just above can't catch a regression that stamps conn.at
  // on failure, because connLabel checks `error` before `at` — the label
  // still reads 'sync failed' and the lie only surfaces on the NEXT
  // render, once something (like this) resets `error` without a fresh
  // success ever having run. Clearing the stored token reproduces exactly
  // that next render, on a device nobody is signed into any more.
  await db.putAuth({ email: null, token: null });
  await main.sync();
  assert.doesNotMatch(document.getElementById('conn').textContent, /^synced/,
    'a lost session must not read as a sync that happened');

  // ── switchLedger, through the actual `change` event (fix round 1, item
  // 2) ───────────────────────────────────────────────────────────────────
  // Everything above drives ui.renderLedgers directly; nothing yet has ever
  // dispatched a real `change` on #ledger-select, so main.js's own handler
  // — the one property this task exists to guarantee — had no coverage at
  // all. Restoring a session first: the scenario just above deliberately
  // erased it, and this exercises the signed-in tap, not the signed-out one.
  await db.putAuth({ email: 'vin@example.test', token: 'tok-1' });

  const ledgerSelect = document.getElementById('ledger-select');
  assert.equal(ledgerSelect.value, 'Bills', 'boot rendered the switcher on the seeded ledger');

  // A rejected switch: the select must snap back to the book actually
  // active, not sit on the one the person tapped — main.js's own `finally`
  // is what has to do that, not this test.
  fetchImpl = fetchReturning({ ok: false, error: 'Pick a ledger.', kind: 'validation' });
  ledgerSelect.value = 'Account 1'; // what a real <select> already shows the instant `change` fires
  ledgerSelect.dispatch('change');
  // Fix round 1, item 4: the guard at the top of switchLedger runs
  // synchronously, before its first `await` — so it's already in effect
  // the instant dispatch() returns, ahead of letting the round trip settle.
  // A second tap landing in this window must not start a concurrent switch.
  assert.equal(ledgerSelect.disabled, true,
    'the select is disabled for the round trip, not just after it fails or succeeds');
  await settle();
  assert.equal(ledgerSelect.value, 'Bills',
    'a rejected switch restores the select to the ledger actually active');
  assert.equal(ledgerSelect.disabled, false, 'and lifts the guard once it is done');

  // A successful switch: read the MERGED view back from the store it
  // claims to survive a reload in, not just main.js's in-memory `view` —
  // an assertion on the in-memory object alone would still pass if the
  // putView call were deleted. It also has to clear conn.needsAuth (fix
  // round 1, item 3's other half): the carried-item scenario above
  // deliberately left it stuck true, and the auth-kind scenario further
  // below only proves anything if this success first brings it back to
  // false on its own.
  // Precondition, not guessed: this assertion only proves the success below
  // cleared needsAuth if needsAuth was actually still true walking in — the
  // rejected-switch scenario just above never touches it (its kind is
  // 'validation', not 'auth'), so it is still standing from the lost-session
  // block much further up. Without checking that here, an unrelated change
  // that leaves needsAuth false the whole time would pass this block too.
  assert.equal(document.getElementById('conn').textContent, 'sign in again',
    'precondition: this scenario starts with needsAuth still true from the earlier lost session');
  fetchImpl = fetchReturning({
    ok: true,
    data: { ledger: 'Account 1', accounts: [{ name: 'Cash', balance: 50, txns: [] }] },
  });
  ledgerSelect.value = 'Account 1';
  ledgerSelect.dispatch('change');
  await settle();

  const stored = await db.getView('bootstrap');
  assert.equal(stored.ledger, 'Account 1', 'the switch reached the views store, not just memory');
  assert.equal(stored.accounts[0].name, 'Cash', "with the new book's own accounts");
  assert.notEqual(document.getElementById('conn').textContent, 'sign in again',
    'a real success clears a needsAuth left over from an earlier rejected switch');

  // A token the server itself rejects mid-switch (fix round 1, item 3):
  // distinct from a plain validation failure — sync()'s own auth-kind
  // handling is the model this follows, so the tap-to-sign-in affordance
  // gets armed right away instead of waiting for some later sync to notice.
  // The success just above is what proves conn.needsAuth starts this
  // scenario false, so the line below can only read 'sign in again' if
  // THIS switch is what set it.
  assert.notEqual(document.getElementById('conn').textContent, 'sign in again',
    'precondition: this scenario starts with needsAuth already cleared');
  fetchImpl = fetchReturning({ ok: false, error: 'Sign in again to continue.', kind: 'auth' });
  ledgerSelect.value = 'Bills';
  ledgerSelect.dispatch('change');
  await settle();
  assert.equal(document.getElementById('conn').textContent, 'sign in again',
    'a token the server rejects mid-switch arms the sign-in affordance immediately');
}

// ── the ledger switcher (spec §4) ─────────────────────────────────────
{
  const select = document.getElementById('ledger-select');
  assert.ok(select, 'index.html ships a ledger select in the top bar');

  ui.renderLedgers({
    view: { ledger: 'Bills', ledgers: ['Bills', 'Account 1'] },
    conn: { online: true },
  });
  assert.equal(select.children.length, 2, 'one option per ledger');
  assert.equal(select.value, 'Bills', 'the current book is selected');
  assert.equal(select.disabled, false, 'and it is usable online');

  ui.renderLedgers({
    view: { ledger: 'Bills', ledgers: ['Bills', 'Account 1'] },
    conn: { online: false },
  });
  assert.equal(select.disabled, true,
    'offline it is disabled: the other books are not cached, and offering a switch that cannot work is a lie');

  ui.renderLedgers({ view: null, conn: { online: true } });
  assert.equal(select.disabled, true, 'nothing to switch between before the first sync');
}

console.log('wiring self-check passed');
