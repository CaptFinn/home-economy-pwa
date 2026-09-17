// Bare assertions over the pure modules, run by ./check.sh. No framework: the
// sibling Apps Script project checks itself the same way, and one runnable
// file beats a toolchain for a two-person app.
import assert from 'node:assert/strict';
import * as fmt from './app/fmt.js';
import { memoryStore } from './app/db.js';

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
