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
