// Boots the app and runs the sync loop. DOM- and network-bound end to end,
// so — like auth.js — this is exercised by hand (Task 8's runbook), never by
// selfcheck.js.
import { getView, putView, listQueue, putQueued, removeQueued } from './db.js';
import { enqueue, drain } from './queue.js';
import * as api from './api.js';
import { currentAuth, refresh, signIn } from './auth.js';
import { entryFrom, validateEntry, renderEntry, renderPending, renderConn } from './ui.js';

// memoryStore()'s shape, over the real IndexedDB functions — queue.js and
// this module don't need to know the difference.
const store = {
  getView, putView, listQueue, putQueued, removeQueued,
};

// Rendered state, kept here rather than re-read from IndexedDB on every
// paint. `view` is the last bootstrap payload (server or cache); `queue` is
// the offline write queue; `conn` is what renderConn/connLabel show.
let view = null;
let queue = [];
const conn = { online: navigator.onLine, syncing: false, at: null };

function render() {
  renderEntry({ view, queue }); // rebuilds #screen, including an empty pending slot
  renderPending(queue); // fills that slot in
  renderConn(conn);
}

function hint(message) {
  const el = document.getElementById('entry-hint');
  if (!el) return;
  el.textContent = message;
  if (message) el.setAttribute('data-state', 'error');
  else el.removeAttribute('data-state');
}

function formValues() {
  const val = (id) => document.getElementById(id).value;
  return {
    ledger: view ? view.ledger : '',
    date: val('f-date'),
    account: val('f-account'),
    type: val('f-type'),
    source: val('f-source'),
    description: val('f-desc'),
    amount: val('f-amount'),
  };
}

// Serializes enqueue calls: enqueue reads the queue's current max ordering
// stamp, then writes a new one — not atomic — so two overlapping calls could
// read the same max and tie, silently reordering two entries for the same
// account (the exact bug an earlier review round fixed). Disabling the
// submit button for the length of the await makes "two enqueues in flight"
// impossible from this form, on top of always awaiting the call.
let submitting = false;

async function onSubmit(event) {
  event.preventDefault();
  if (submitting) return;

  const entry = entryFrom(formValues(), crypto.randomUUID());
  const problem = validateEntry(entry);
  if (problem) { hint(problem); return; }

  // entry goes to the queue exactly as entryFrom built it — unsigned amount
  // plus `direction` — because that is the wire shape addEntry expects.
  // Ledger.gs's appendEntry_ runs validateEntry_ (rejects amount <= 0)
  // BEFORE entryRow_ signs it; a pre-signed negative amount fails that
  // check every time and gets parked forever, silently refusing every
  // withdrawal. (ui.js's pendingBalance reconciles queue.js's pendingFor,
  // which wants a signed amount, on the display side instead — nothing
  // that reaches here or the wire is ever signed.)
  submitting = true;
  const submit = event.target.querySelector('.submit');
  if (submit) submit.disabled = true;
  try {
    await enqueue(store, 'addEntry', { entry });
  } finally {
    submitting = false;
    if (submit) submit.disabled = false;
  }

  // The entry is queued and must show as pending right now — the form never
  // waits on the network to clear itself; that's the entire point of the
  // queue (spec). Whatever sync() does next happens in the background.
  queue = await store.listQueue();
  render();
  if (navigator.onLine) sync(); // fire-and-forget: submit is already done
}

function onScreenClick(event) {
  const button = event.target.closest('[data-remove-id]');
  if (!button) return;
  removeQueued(button.dataset.removeId).then(async () => {
    queue = await store.listQueue();
    render();
  });
}

/** A tap on the connection line. When the server has rejected the token
    (connLabel's 'sign in again'), that's the sign-in affordance itself —
    tapping re-runs signIn() rather than a sync that would just fail the
    same way again; otherwise a tap is just a manual sync trigger. */
async function onConnClick() {
  if (conn.needsAuth) {
    await signIn();
    conn.needsAuth = false;
    view = await getView('bootstrap');
    queue = await store.listQueue();
    render();
  }
  if (navigator.onLine) sync();
}

// Guards sync() against overlap: two runs racing would drain the same queue
// twice and could double-send an item mid-flight before the first run
// removes it.
let syncing = false;

/** Sends everything queued, oldest first, then refreshes the cached
    bootstrap view. A queued item is removed from the queue only once
    store.removeQueued runs inside drain — which only happens after the
    server has said `ok: true` — so nothing is ever "sent" from the phone's
    point of view before the server actually has it: the queue itself, still
    showing the item, is the only place that fact would otherwise be lost. */
export async function sync() {
  if (syncing) return;
  syncing = true;
  conn.syncing = true;
  conn.needsAuth = false; // each run starts by assuming the token is still good
  renderConn(conn);

  try {
    // A fresh silent refresh is preferred, but refresh() returns null for
    // plenty of reasons short of "not signed in" (offline, GIS not loaded
    // yet, a dismissed prompt) — the auth rule is that a token already in
    // hand is proof for about an hour, so falling back to the stored one
    // avoids blocking a sync on a UI Google chose not to show.
    const auth = (await refresh()) || (await currentAuth());
    if (!auth || !auth.token) return; // nothing to sync with; try again next trigger

    const result = await drain(store, (item) => api.call(item.op, item.args, auth.token));
    queue = await store.listQueue();

    if (result.needsAuth) {
      // The server itself rejected the token mid-drain — unlike offline or
      // a server hiccup, this doesn't clear on its own when the network
      // comes back, so the connection line has to say something the
      // person can act on (connLabel's 'sign in again', and a tap on it
      // re-runs signIn — see onConnClick). Skip the bootstrap refetch: the
      // same rejected token can't fetch that either.
      conn.needsAuth = true;
      return;
    }

    const res = await api.call('bootstrap', {}, auth.token);
    if (res.ok) {
      await putView('bootstrap', res.data);
      view = res.data;
    }

    const d = new Date();
    conn.at = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } finally {
    syncing = false;
    conn.syncing = false;
    render();
  }
}

export async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {}); // offline-first still works if this fails
  }

  // The form itself is rebuilt on every render(), so its listener has to be
  // delegated from #screen (which index.html creates once and never
  // replaces) rather than attached to the form directly.
  document.getElementById('screen').addEventListener('submit', (e) => {
    if (e.target.id === 'entry-form') onSubmit(e);
  });
  document.getElementById('screen').addEventListener('click', onScreenClick);
  document.getElementById('conn').addEventListener('click', onConnClick);
  window.addEventListener('online', () => { conn.online = true; renderConn(conn); sync(); });
  window.addEventListener('offline', () => { conn.online = false; renderConn(conn); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) sync();
  });

  // Checked before the first render, not after: rendering the cached form
  // and then swapping it for the sign-in button a moment later would flash
  // a screen the signed-out person isn't allowed to act on.
  if (!(await currentAuth())) {
    await signIn(); // renders Google's button into #screen itself
  }

  view = await getView('bootstrap');
  queue = await store.listQueue();
  render();

  if (navigator.onLine) sync();
}

boot();
