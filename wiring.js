// Runs the real client modules against a fake DOM. It cannot see what is
// drawn — it catches what actually broke in stage 1: a renamed field, a
// wrong argument, a handler that throws, a promise that never settles, and
// above all an entry that reaches the queue in the wrong shape.
import assert from 'node:assert/strict';

// Matches one simple CSS selector — a single class, id, or tag name; no
// combinators, attribute selectors or pseudo-classes. That is the entire
// vocabulary main.js and ui.js reach for (`.submit`, nothing else so far).
function matchesSelector(el, sel) {
  if (sel[0] === '.') return String(el.className || '').split(/\s+/).includes(sel.slice(1));
  if (sel[0] === '#') return el.id === sel.slice(1);
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
      appendChild(child) { this.children.push(child); return child; },
      // Mirrors real DOM's insertBefore(node, null): appends. A reference
      // node not found in `children` also falls back to append rather than
      // throwing (a real DOM throws) — looser, but nothing here ever passes
      // a stray reference, and honest logging isn't worth the extra code.
      insertBefore(child, ref) {
        const i = ref == null ? -1 : this.children.indexOf(ref);
        if (i === -1) this.children.push(child); else this.children.splice(i, 0, child);
        return child;
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

  // The fixed elements index.html ships with.
  for (const id of ['screen', 'conn', 'whoami', 'foot']) {
    const el = make('div');
    el.id = id;
    byId.set(id, el);
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
    user: 'vin', ledger: 'Bills', ledgers: ['Bills'],
    accounts: [{ name: 'Groceries', balance: 300, txns: [] }],
  };
  await db.putView('bootstrap', bootstrapView);
  fetchImpl = fetchReturning({ ok: true, data: bootstrapView }); // answers boot()'s own background sync()

  await main.boot();
  await settle(); // boot() fires sync() without awaiting it — let that settle before asserting on it

  assert.match(document.getElementById('conn').textContent, /^synced \d{2}:\d{2}$/,
    'boot wired a real, successful sync before either scenario below touches it');

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
}

console.log('wiring self-check passed');
