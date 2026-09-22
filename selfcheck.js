// Bare assertions over the pure modules, run by ./check.sh. No framework: the
// sibling Apps Script project checks itself the same way, and one runnable
// file beats a toolchain for a two-person app.
import assert from 'node:assert/strict';
import * as fmt from './app/fmt.js';
import { memoryStore } from './app/db.js';
import { enqueue, drain, pendingFor } from './app/queue.js';
import { overlayQueued, billsKey, nextCycle } from './app/bills.js';

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

import { nextRetryDelay, entryFrom, connLabel, directedAmount, pendingBalance, validateEntry } from './app/ui.js';

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

  // A blank ledger is refused client-side too (round-2 review, C1) — the
  // server's validateEntry_ already refused it, but with no client-side
  // check an entry queued before the first successful bootstrap (formValues
  // sends view.ledger, which is '' until then) sat in the queue getting
  // "Pick a ledger." forever, since retrying the same missing value can
  // never succeed. renderEntry disables the submit control for the same
  // reason; this is the second, independent guard.
  const good = { ledger: 'Household', date: '2026-09-16', account: 'A', source_recipient: 'x', amount: 5 };
  assert.equal(validateEntry({ ...good, ledger: '' }), 'Pick a ledger.', 'a blank ledger is refused');
  assert.equal(validateEntry({ ...good, ledger: '  ' }), 'Pick a ledger.', 'whitespace-only counts as blank');
  assert.equal(validateEntry(good), null, 'a real ledger passes');

  assert.equal(connLabel({ online: false }), 'offline', 'offline says so');
  assert.equal(connLabel({ online: true, syncing: true }), 'syncing…', 'syncing says so');
  assert.equal(connLabel({ online: true, syncing: false, at: '2026-09-16 15:40' }),
    'synced 15:40', 'otherwise the last sync time');
  assert.equal(connLabel({ online: true, syncing: false, error: 'Sign in again to continue.' }),
    'sync failed', 'a failed sync never reports itself as synced');
  assert.equal(connLabel({ online: true, syncing: false, at: '15:50', error: 'boom' }),
    'sync failed', 'and a stale timestamp does not override the failure');
  assert.equal(connLabel({ online: true, syncing: false }), 'not synced yet',
    'and nothing to report before the first sync');
  assert.equal(connLabel({ online: true, syncing: false, needsAuth: true }), 'sign in again',
    'a rejected token gets its own line, distinct from offline or unsynced');
}

{
  // Regression guard: a Withdrawal must never leave entryFrom (or, from
  // there, the queue) with a negative amount — Ledger.gs's appendEntry_
  // validates BEFORE it signs, so a pre-signed amount fails "Enter an
  // amount greater than zero." and gets permanently parked, silently
  // refusing every expense logged from this app.
  const withdrawal = entryFrom({ type: 'Withdrawal', amount: '75' }, 'z');
  assert.equal(withdrawal.amount, 75, 'entryFrom always reports a positive amount');
  assert.ok(withdrawal.amount > 0, 'never signed, whatever the direction');
  assert.equal(withdrawal.direction, 'out', 'the sign lives in direction instead');

  // pendingFor (queue.js, frozen) sums args.entry.amount as already
  // signed; pendingBalance reconciles that against the unsigned+direction
  // shape actual queued items carry, without touching what's queued.
  const queue = [
    { op: 'addEntry', state: 'pending', args: { entry: { account: 'A', amount: 100, direction: 'out' } } },
    { op: 'addEntry', state: 'pending', args: { entry: { account: 'A', amount: 50, direction: 'in' } } },
  ];
  assert.equal(pendingBalance(queue, 'A'), -50,
    'a withdrawal subtracts and a deposit adds, from unsigned amount + direction');
  assert.equal(directedAmount({ amount: 20, direction: 'out' }), -20, 'out is negative');
  assert.equal(directedAmount({ amount: 20, direction: 'in' }), 20, 'in is positive');
}

{
  assert.equal(nextRetryDelay(0, 5000, 60000), 5000, 'the first retry waits the minimum');
  assert.equal(nextRetryDelay(5000, 5000, 60000), 10000, 'then doubles');
  assert.equal(nextRetryDelay(40000, 5000, 60000), 60000, 'and is capped');
  assert.equal(nextRetryDelay(60000, 5000, 60000), 60000, 'staying at the cap');
}

console.log('ui self-check passed');

{
  assert.equal(billsKey('cycle', '2026-09'), 'bills:cycle:2026-09', 'a cycle scope key');
  assert.equal(billsKey('payday', '2026-09-15'), 'bills:payday:2026-09-15', 'a payday scope key');

  assert.equal(nextCycle('2026-09'), '2026-10', 'the next cycle');
  assert.equal(nextCycle('2026-12'), '2027-01', 'December rolls the year');
  assert.equal(nextCycle('2026-09-15'), '', 'a payday is not a cycle');
  assert.equal(nextCycle('2026-13'), '', 'nor is a month that does not exist');
  assert.equal(nextCycle(''), '', 'nor is nothing');

  const view = {
    cycle: '2026-09', payers: ['Vin', 'Venice'],
    rows: [{ row: 5, name: 'Rent', notes: '', status: 'Partially funded', progress: 1875,
             schedule: [{ payday: '2026-09-30', paid: [false, false] }] }],
    totals: { billed: 7500, funded: 1875, remaining: 5625, pending: 0 },
  };
  const tick = (at, funded, args = {}) => ({ id: 't' + at, op: 'setBillFunded', state: 'pending', at,
    args: { cycle: '2026-09', row: 5, name: 'Rent', payday: '2026-09-30', payer: 'Venice', funded, ...args } });
  const box = (v) => v.rows[0].schedule[0];

  let out = overlayQueued(view, [tick(1, true), tick(2, false)]);
  assert.deepEqual(box(out).paid, [false, false], 'the newest pending tick wins: an untick after a tick');
  assert.deepEqual(box(out).queued, [false, true], 'and only that box is marked');
  out = overlayQueued(view, [tick(1, false), tick(2, true)]);
  assert.deepEqual(box(out).paid, [false, true], 'a tick after an untick');

  out = overlayQueued(view, [{ ...tick(1, true), state: 'parked' }]);
  assert.deepEqual(box(out).queued, [false, false], 'a parked tick is not drawn: the server refused it');
  out = overlayQueued(view, [tick(1, true, { name: 'Water' })]);
  assert.deepEqual(box(out).queued, [false, false], 'a tick for another bill on the same row is not drawn');

  const note = (at, text, state = 'pending') => ({ id: 'n' + at, op: 'setBillNotes', state, at,
    args: { cycle: '2026-09', row: 5, name: 'Rent', text } });
  out = overlayQueued(view, [note(1, 'GCash'), note(2, 'GCash 0917')]);
  assert.equal(out.rows[0].notes, 'GCash 0917', 'the newest pending note wins');
  assert.equal(out.rows[0].notesQueued, true, 'marked as queued');
  out = overlayQueued(view, [note(1, 'GCash', 'parked')]);
  assert.equal(out.rows[0].notes, '', 'a parked note is not drawn');
  assert.equal(out.rows[0].notesQueued, false, 'nor marked');

  out = overlayQueued(view, [tick(1, true), note(2, 'x')]);
  assert.deepEqual(out.totals, view.totals, 'totals stay the server\'s');
  assert.equal(out.rows[0].progress, 1875, 'and so does progress');
  assert.equal(out.rows[0].status, 'Partially funded', 'and status');
  assert.deepEqual(box(view).paid, [false, false], 'the cached view itself is never mutated');

  const payday = {
    payday: '2026-09-15', payers: ['Vin', 'Venice'],
    rows: [{ row: 9, name: 'Internet', cycle: '2026-08', paid: [false, false] }],
    totals: { each: 674.5, cash: 0, digital: 674.5, all: 1349 },
  };
  out = overlayQueued(payday, [tick(1, true, { cycle: '2026-08', row: 9, name: 'Internet', payday: '2026-09-15', payer: 'Vin' })]);
  assert.deepEqual(out.rows[0].paid, [true, false], "the payday view matches on the row's own cycle");
  assert.deepEqual(out.rows[0].queued, [true, false], 'and marks the box');

  assert.equal(overlayQueued(null, [tick(1, true)]), null, 'no view, nothing to draw over');
}

console.log('bills self-check passed');
