// The offline write queue: money entries the phone has accepted but the
// server has not yet seen. Order is part of what these entries mean (two
// withdrawals from the same account must land in the order they happened),
// so the queue is a strict FIFO, drained one item at a time, never in
// parallel. The `at` stamp is not simply Date.now(): two entries queued in
// the same millisecond would otherwise tie, and IndexedDB's getAll() breaks
// a tie by primary key — a random UUID — silently reordering two money
// entries for the same account. Forcing each stamp past the previous one
// makes the sort total.

/** Stores a pending operation and returns the stored record. */
export async function enqueue(store, op, args) {
  const queue = await store.listQueue(); // oldest first, so the last entry holds the current max `at`
  const maxAt = queue.length ? queue[queue.length - 1].at : 0;
  const at = Math.max(Date.now(), maxAt + 1);
  const item = { id: crypto.randomUUID(), op, args, at, state: 'pending' };
  await store.putQueued(item);
  return item;
}

/**
 * Sends queued items to the server, oldest first, one at a time.
 * Returns counts and flags describing what happened, so the caller can
 * decide what to tell the user without re-deriving it from queue state.
 */
export async function drain(store, send) {
  const counts = { sent: 0, parked: 0, stopped: false, needsAuth: false };
  for (const item of await store.listQueue()) {
    if (item.state !== 'pending') continue; // parked items sit until the user resolves them by hand

    let result;
    try {
      result = await send(item);
    } catch {
      // A thrown network error is the same signal as {ok: false, kind:
      // 'server'} — the request never reached the server — so it stops the
      // run the same way, below.
      result = { ok: false, kind: 'server' };
    }

    // Guard against a nullish or malformed resolution (undefined, null, {})
    // — that is not a crash, just not success, so it falls through to the
    // same generic stop branch as a thrown error rather than throwing a
    // TypeError out of drain and losing the run's counts.
    if (result && result.ok === true) {
      await store.removeQueued(item.id);
      counts.sent += 1;
      continue;
    }

    if (result && (result.kind === 'conflict' || result.kind === 'validation')) {
      // A conflict means this one item is stale (e.g. edited elsewhere since
      // it was queued); a validation failure means the server rejected the
      // data itself (e.g. a bad account name). Neither is a broken
      // connection or a broken queue, and neither improves by being
      // retried — retrying the same bad data just fails the same way again,
      // forever, and would jam every healthy entry behind it. Both need a
      // person to look at them, so both get parked with their message and
      // the run moves on: one bad item must not block a shopping trip's
      // worth of other, healthy entries behind it.
      await store.putQueued({ ...item, state: 'parked', error: result.error });
      counts.parked += 1;
      continue;
    }

    if (result && result.kind === 'auth') {
      // The user needs to sign in again; nothing after this can succeed
      // either, so stop and say why. The item stays pending.
      counts.stopped = true;
      counts.needsAuth = true;
      break;
    }

    // Anything else — 'server', a thrown network error — stops the run and
    // leaves the item pending (not parked: nothing here says this item is
    // bad, only that the trip there just failed). A network that just
    // failed will fail again immediately; retrying the rest out of order
    // would also break the ordering guarantee this queue exists to keep.
    counts.stopped = true;
    break;
  }
  return counts;
}

/**
 * Sums the amounts of pending addEntry items queued for one account. This is
 * the only arithmetic on money this client is allowed to do (spec §7.3): a
 * client-side estimate shown beside the server's balance so the user isn't
 * staring at a stale number while offline. It is never persisted and never
 * sent to the server — the server's own sum, computed on read, is the only
 * number of record.
 */
export function pendingFor(queue, account) {
  return queue
    .filter((item) => item.state === 'pending' && item.op === 'addEntry' && item.args.entry.account === account)
    .reduce((total, item) => total + item.args.entry.amount, 0);
}
