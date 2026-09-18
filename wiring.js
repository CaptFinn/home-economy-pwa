// Runs the real client modules against a fake DOM. It cannot see what is
// drawn — it catches what actually broke in stage 1: a renamed field, a
// wrong argument, a handler that throws, a promise that never settles, and
// above all an entry that reaches the queue in the wrong shape.
import assert from 'node:assert/strict';

// ── a DOM small enough to read, large enough to wire ──────────────────
export function makeDom() {
  const byId = new Map();

  const make = (tag = 'div') => {
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attributes: {},
      dataset: {},
      style: {},
      className: '',
      textContent: '',
      value: '',
      disabled: false,
      hidden: false,
      listeners: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') byId.set(String(v), this); },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      removeEventListener() {},
      dispatch(type, event = {}) {
        for (const fn of this.listeners[type] || []) fn({ type, preventDefault() {}, target: this, ...event });
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      focus() {},
      scrollIntoView() {},
      remove() {},
    };
    Object.defineProperty(el, 'id', {
      get() { return this.attributes.id || ''; },
      set(v) { this.setAttribute('id', v); },
    });
    return el;
  };

  const document = {
    createElement: (tag) => make(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    addEventListener() {},
    body: make('body'),
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
// the assignment the brief specifies, without changing what gets set.
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

console.log('wiring self-check passed');
