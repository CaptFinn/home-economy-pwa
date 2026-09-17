// Bare assertions over the pure modules, run by ./check.sh. No framework: the
// sibling Apps Script project checks itself the same way, and one runnable
// file beats a toolchain for a two-person app.
import assert from 'node:assert/strict';
import * as fmt from './app/fmt.js';
import { memoryStore } from './app/db.js';
import { enqueue, drain, pendingFor } from './app/queue.js';

assert.equal(fmt.peso(1500), '₱1,500.00', 'pesos get a sign-free peso format');
assert.equal(fmt.peso(0), '₱0.00', 'zero formats');
assert.equal(fmt.peso(-1240.5), '−₱1,240.50', 'a negative keeps a real minus sign');
assert.equal(fmt.signed(-1240.5), '−₱1,240.50', 'signed shows the minus');
assert.equal(fmt.signed(1240.5), '+₱1,240.50', 'and a plus for money in');
assert.equal(fmt.day('2026-09-16'), 'sep 16', 'dates read like the Apps Script app');
assert.equal(fmt.day(''), '', 'a blank date formats to nothing');
assert.equal(fmt.today(new Date(2026, 8, 16, 1, 0)), '2026-09-16',
  'today uses local parts, never toISOString');

console.log('fmt self-check passed');

{
  const store = memoryStore();
  await store.putView('bootstrap', { accounts: [{ name: 'A', balance: 10 }] });
  assert.equal((await store.getView('bootstrap')).accounts[0].balance, 10, 'a view round-trips');
  assert.equal(await store.getView('missing'), null, 'an unseen view is null');

  await store.putQueued({ id: 'a', op: 'addEntry', args: {}, at: 1, state: 'pending' });
  await store.putQueued({ id: 'b', op: 'addEntry', args: {}, at: 2, state: 'pending' });
  assert.equal((await store.listQueue()).length, 2, 'the queue holds both');
  assert.deepEqual((await store.listQueue()).map(q => q.id), ['a', 'b'], 'oldest first');

  await store.putQueued({ id: 'a', op: 'addEntry', args: {}, at: 1, state: 'parked' });
  assert.equal((await store.listQueue()).length, 2, 'putting the same id updates rather than adds');
  assert.equal((await store.listQueue())[0].state, 'parked', 'and keeps its place');

  await store.removeQueued('a');
  assert.deepEqual((await store.listQueue()).map(q => q.id), ['b'], 'removing leaves the rest');

  await store.putAuth({ email: 'vin@x.com', token: 't' });
  assert.equal((await store.getAuth()).email, 'vin@x.com', 'auth round-trips');
}

console.log('db self-check passed');

{
  const store = memoryStore();
  const a = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -100 } });
  const b = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -50 } });
  assert.ok(a.id && b.id && a.id !== b.id, 'each queued item gets its own id');
  assert.equal(a.state, 'pending', 'and starts pending');

  // Everything succeeds: the queue empties, oldest first.
  const seen = [];
  let out = await drain(store, async (item) => { seen.push(item.id); return { ok: true }; });
  assert.deepEqual(seen, [a.id, b.id], 'sent oldest first');
  assert.equal(out.sent, 2, 'both sent');
  assert.equal((await store.listQueue()).length, 0, 'and the queue is empty');

  // A conflict parks one item and the run continues.
  const c = await enqueue(store, 'updateEntry', { row: 7 });
  const d = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -20 } });
  out = await drain(store, async (item) => item.id === c.id
    ? { ok: false, kind: 'conflict', error: 'That entry changed. Reload and try again.' }
    : { ok: true });
  assert.equal(out.sent, 1, 'the healthy item still went');
  assert.equal(out.parked, 1, 'the conflict was parked');
  const left = await store.listQueue();
  assert.equal(left.length, 1, 'only the parked item remains');
  assert.equal(left[0].state, 'parked', 'marked parked');
  assert.equal(left[0].error, 'That entry changed. Reload and try again.', 'with its message');

  // A validation failure parks exactly like a conflict — retrying the same
  // bad data can't ever succeed, so it must not jam the queue — and the run
  // continues past it rather than stopping.
  const v = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -30 } });
  out = await drain(store, async (item) => item.id === v.id
    ? { ok: false, kind: 'validation', error: 'That account does not exist.' }
    : { ok: true });
  assert.equal(out.parked, 1, 'the validation failure was parked, not stopped');
  assert.equal(out.stopped, false, 'the run did not stop');
  const parkedV = (await store.listQueue()).find(q => q.id === v.id);
  assert.equal(parkedV.state, 'parked', 'marked parked');
  assert.equal(parkedV.error, 'That account does not exist.', 'with its message');

  // A parked validation failure is never retried by a later drain either.
  let retriedV = false;
  await drain(store, async (item) => { if (item.id === v.id) retriedV = true; return { ok: true }; });
  assert.equal(retriedV, false, 'the parked validation item was skipped');
  await store.removeQueued(v.id);

  // A server error stops the run and keeps everything, in order.
  await store.removeQueued(c.id);
  const e1 = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -1 } });
  const e2 = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -2 } });
  out = await drain(store, async () => ({ ok: false, kind: 'server', error: 'busy' }));
  assert.equal(out.stopped, true, 'the run stopped');
  assert.equal(out.sent, 0, 'nothing was sent');
  assert.deepEqual((await store.listQueue()).map(q => q.id), [e1.id, e2.id],
    'both remain, in order, still pending');
  assert.equal((await store.listQueue())[0].state, 'pending', 'not parked');

  // An auth failure stops the run too — the user has to sign in.
  out = await drain(store, async () => ({ ok: false, kind: 'auth', error: 'Sign in again to continue.' }));
  assert.equal(out.stopped, true, 'auth stops the run');
  assert.equal(out.needsAuth, true, 'and says why');

  // A parked item is never retried by a later drain.
  await store.putQueued({ ...e1, state: 'parked', error: 'x' });
  let tried = [];
  await drain(store, async (item) => { tried.push(item.id); return { ok: true }; });
  assert.deepEqual(tried, [e2.id], 'the parked item was skipped');

  // A thrown send (a network error) stops the run without crashing drain —
  // it must return its counts, not reject — and the item stays pending.
  const f = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -5 } });
  out = await drain(store, async () => { throw new Error('offline'); });
  assert.equal(out.stopped, true, 'a thrown send stops the run');
  assert.equal((await store.listQueue()).find(q => q.id === f.id).state, 'pending',
    'and the item stays pending rather than crashing drain');

  // A malformed (nullish) resolution is not a crash either — just not
  // success — so it falls through to the same stop branch.
  out = await drain(store, async () => undefined);
  assert.equal(out.stopped, true, 'an undefined resolution stops the run too');
  assert.equal((await store.listQueue()).find(q => q.id === f.id).state, 'pending',
    'still pending, not parked');
}

{
  // Two entries queued in the same millisecond must still sort in the order
  // they were queued — a tie broken by a random UUID would silently reorder
  // two money entries for the same account.
  const store = memoryStore();
  const realNow = Date.now;
  Date.now = () => 1000; // force the tie enqueue must break, rather than relying on real timing
  let a2, b2;
  try {
    a2 = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -1 } });
    b2 = await enqueue(store, 'addEntry', { entry: { account: 'A', amount: -2 } });
  } finally {
    Date.now = realNow;
  }
  assert.ok(b2.at > a2.at, 'a stamped tie is broken, strictly increasing');
  assert.deepEqual((await store.listQueue()).map(q => q.id), [a2.id, b2.id],
    'and the queue sorts in the order they were queued');
}

{
  const queue = [
    { op: 'addEntry', state: 'pending', args: { entry: { account: 'A', amount: -100 } } },
    { op: 'addEntry', state: 'pending', args: { entry: { account: 'A', amount: -50 } } },
    { op: 'addEntry', state: 'pending', args: { entry: { account: 'B', amount: -25 } } },
    { op: 'addEntry', state: 'parked', args: { entry: { account: 'A', amount: -999 } } },
    { op: 'voidEntry', state: 'pending', args: { row: 4 } },
  ];
  assert.equal(pendingFor(queue, 'A'), -150, 'pending entries for one account are summed');
  assert.equal(pendingFor(queue, 'B'), -25, 'per account');
  assert.equal(pendingFor(queue, 'C'), 0, 'an account with nothing queued is zero');
}

console.log('queue self-check passed');

import { buildRequest, readResponse } from './app/api.js';

{
  const req = buildRequest('tok', 'addEntry', { entry: { amount: 5 } });
  assert.equal(req.method, 'POST', 'always POST');
  assert.equal(req.headers['Content-Type'], 'text/plain;charset=utf-8',
    'text/plain, or the browser preflights and Apps Script cannot answer');
  const body = JSON.parse(req.body);
  assert.equal(body.token, 'tok', 'the token travels in the body');
  assert.equal(body.op, 'addEntry', 'with the op');
  assert.equal(body.args.entry.amount, 5, 'and the args');

  assert.deepEqual(readResponse('{"ok":true,"data":{"a":1}}'), { ok: true, data: { a: 1 } },
    'a success unwraps');
  const bad = readResponse('{"ok":false,"error":"nope","kind":"conflict"}');
  assert.equal(bad.ok, false, 'a failure stays a failure');
  assert.equal(bad.kind, 'conflict', 'and keeps its kind');
  const html = readResponse('<!doctype html><title>Sign in</title>');
  assert.equal(html.ok, false, 'an HTML page is not a response');
  assert.equal(html.kind, 'auth', 'and means the deployment is asking us to sign in');
}

console.log('api self-check passed');

import { entryFrom, connLabel } from './app/ui.js';

{
  const e = entryFrom({
    ledger: 'Household', date: '2026-09-16', account: 'Electricity',
    type: 'Withdrawal', source: 'Meralco', description: 'oct bill', amount: '1500',
  }, 'id-1');
  assert.equal(e.direction, 'out', 'Withdrawal is money out');
  assert.equal(e.amount, 1500, 'the amount is unsigned — the server applies the sign');
  assert.equal(e.id, 'id-1', 'the idempotency id rides along');
  assert.equal(e.category, '', 'category is not offered by this form');
  assert.equal(entryFrom({ type: 'Deposit', amount: '20' }, 'x').direction, 'in',
    'Deposit is money in');
  assert.equal(entryFrom({ type: 'Withdrawal', amount: '1,500' }, 'x').amount, null,
    'a comma is not a number — the form must refuse it, not send 1');

  assert.equal(connLabel({ online: false }), 'offline', 'offline says so');
  assert.equal(connLabel({ online: true, syncing: true }), 'syncing…', 'syncing says so');
  assert.equal(connLabel({ online: true, syncing: false, at: '2026-09-16 15:40' }),
    'synced 15:40', 'otherwise the last sync time');
  assert.equal(connLabel({ online: true, syncing: false }), 'not synced yet',
    'and nothing to report before the first sync');
}

console.log('ui self-check passed');
