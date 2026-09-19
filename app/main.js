// Boots the app and runs the sync loop. DOM- and network-bound end to end,
// so — like auth.js — this is exercised by hand (Task 8's runbook), never by
// selfcheck.js.
import { getView, putView, listQueue, putQueued, removeQueued } from './db.js';
import { enqueue, drain } from './queue.js';
import * as api from './api.js';
import { currentAuth, refresh, signIn } from './auth.js';
import { entryFrom, validateEntry, renderEntry, renderPending, renderRecent, renderLog, renderConn, renderLedgers, nextRetryDelay } from './ui.js';

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
// The account Recent currently shows. render() (below) is the one place
// that keeps it valid: it defaults to the ledger's first account the
// moment there is no selection yet, or the selection no longer exists in
// this ledger — switching ledgers being the one thing that can make that
// happen. Keeping that rule in one place beats repeating it in boot, sync,
// switchLedger and onConnClick, everywhere `view` itself gets reassigned.
let account = null;
// The full log, when it is open instead of the home screen (spec §3.2):
// { account, rows, hasMore, loading, error }, or null for home. One view at
// a time — spec §3 has no router and needs none.
let log = null;
const conn = { online: navigator.onLine, syncing: false, at: null, error: '' };

// navigator.onLine goes true the moment the OS sees an interface, which is
// routinely before anything can actually be reached — so the sync fired by
// the `online` event often fails, and without this nothing would try again
// until a person tapped the status line. Unsent money must never depend on
// somebody noticing.
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;
let retryTimer = null;
let retryDelay = 0;

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 0;
}

function scheduleRetry() {
  // One timer at a time; nothing to retry when the queue is empty, the device
  // is offline (the `online` event covers that), or the token was rejected —
  // a retry cannot fix that one and would just spin.
  if (retryTimer || !queue.length || !navigator.onLine || conn.needsAuth) return;
  retryDelay = nextRetryDelay(retryDelay);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    sync();
  }, retryDelay);
}

function render() {
  // Resolved here, not at every call site that reassigns `view`: see
  // `account`'s own comment above for why this is the one place that rule
  // has to live.
  if (view && view.accounts.length) {
    if (!account || !view.accounts.some((a) => a.name === account)) {
      account = view.accounts[0].name; // spec §3.1: the first account is selected by default
    }
  } else {
    account = null;
  }

  if (log) {
    renderLog({ log, conn });
  } else {
    // conn travels too: when a sync fails, the form's own hint is where the
    // reason belongs — that is the line someone reads when the button is dead.
    renderEntry({ view, queue, conn }); // rebuilds #screen, including an empty pending slot
    renderPending(queue, view ? view.ledger : ''); // fills that slot in, this book's entries only
    renderRecent({ view, account, queue }); // the selected account's last-synced rows, plus its own pending ones
  }
  renderConn(conn);
  renderLedgers({ view, conn }); // #ledger-select is fixed in index.html's topbar, like #conn
  // bootstrap.data.user is already on the wire (Code.gs's getBootstrap) and
  // was simply discarded until now (round-2 review, C5) — #whoami is a
  // fixed element in index.html's topbar, never recreated, so this can just
  // write it directly rather than routing it through ui.js's rebuild-heavy
  // render functions.
  const whoami = document.getElementById('whoami');
  if (whoami) whoami.textContent = view && view.user ? view.user : '';
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
  if (button) {
    removeQueued(button.dataset.removeId).then(async () => {
      queue = await store.listQueue();
      render();
    });
    return;
  }

  if (event.target.closest('#view-all')) { openLog(); return; }
  if (event.target.closest('#log-back')) { closeLog(); return; }
  if (event.target.closest('#log-more')) { loadMore(); return; }

  const acctRow = event.target.closest('[data-account]');
  if (acctRow) selectAccount(acctRow.dataset.account);
}

/** `View all` (spec §3.2). Online, page one comes from the server like every
    other page. Offline, the cached bootstrap already holds this account's
    newest rows with their balances — the same rows Recent shows — so those
    stand in for page one, and renderLog says later pages need a connection. */
function openLog() {
  const acct = view && view.accounts.find((a) => a.name === account);
  if (!acct) return;
  if (navigator.onLine) {
    log = { account: acct.name, rows: [], hasMore: true, loading: false, error: '' };
    loadMore(); // renders, with the control already reading Loading…
  } else {
    // ponytail: bootstrap sends at most 20 rows per account (Ledger.gs's
    // RECENT_LIMIT); fewer than that is the whole history. Change both if
    // that limit ever moves.
    log = { account: acct.name, rows: acct.txns, hasMore: acct.txns.length >= 20, loading: false, error: '' };
    render();
  }
}

function closeLog() {
  log = null;
  render();
}

/** Asks for the next page, at an offset of however many rows are already
    shown — advancing by what arrived, not by the page size, so a short page
    never skips rows. A failure keeps the rows already loaded and shows why;
    the control turns into Retry for the same offset. */
async function loadMore() {
  if (!log || log.loading) return;
  const current = log;
  current.loading = true;
  current.error = '';
  render();
  try {
    const auth = await currentAuth();
    const res = auth && auth.token
      ? await api.call('entries', { ledger: view.ledger, account: current.account, offset: current.rows.length }, auth.token)
      : { ok: false, kind: 'auth', error: 'Sign in again to see more entries.' };
    if (res.ok) {
      current.rows = current.rows.concat(res.data.rows);
      current.hasMore = res.data.hasMore;
    } else {
      if (res.kind === 'auth') conn.needsAuth = true; // same signal sync() and switchLedger arm
      current.error = res.error || 'Could not load more entries.';
    }
  } finally {
    current.loading = false;
    // Back was tapped while this was in flight: that page belongs to a log
    // nobody is looking at any more, so it must not repaint over home.
    if (log === current) render();
  }
}

/** A tap (or Enter/Space — onScreenKeydown below) on a row in the balances
    list. Nothing here talks to the server, so unlike the branch above,
    there is nothing to await: just a new account in state and a re-render. */
function selectAccount(name) {
  account = name;
  render();
}

/** The keyboard equivalent of onScreenClick's account-row branch — the row
    is a div, not a button, so it gets its own Enter/Space handling rather
    than one for free (same reason the sibling app's tappable rows carry an
    onkeydown of their own). */
function onScreenKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const acctRow = event.target.closest('[data-account]');
  if (!acctRow) return;
  event.preventDefault();
  selectAccount(acctRow.dataset.account);
}

/** A tap on the connection line. When the server has rejected the token
    (connLabel's 'sign in again'), that's the sign-in affordance itself —
    tapping re-runs signIn() rather than a sync that would just fail the
    same way again; otherwise a tap is just a manual sync trigger. */
async function onConnClick() {
  if (conn.needsAuth) {
    // signIn() needs the network the same as any other Google call — no
    // point starting it offline (round-2 review, C5). And it can reject the
    // same way boot() found it can (C3: the library never loaded); without
    // a catch that would be an unhandled rejection out of an event handler
    // instead of just leaving conn.needsAuth true for the next tap.
    if (!navigator.onLine) return;
    try {
      await signIn();
    } catch (err) {
      return;
    }
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
  conn.error = '';
  renderConn(conn);

  try {
    // A fresh silent refresh is preferred, but refresh() returns null for
    // plenty of reasons short of "not signed in" (offline, GIS not loaded
    // yet, a dismissed prompt) — the auth rule is that a token already in
    // hand is proof for about an hour, so falling back to the stored one
    // avoids blocking a sync on a UI Google chose not to show.
    const auth = (await refresh()) || (await currentAuth());
    if (!auth || !auth.token) {
      // No stored session at all — not a server rejection, not a network
      // blip, just nobody signed in on this device. Without needsAuth this
      // returns having touched neither conn.error nor conn.at, so the next
      // render falls through connLabel's error check (already reset to ''
      // above) straight to the OLD `at` and reports a sync that did not
      // just happen — the exact stale-clock lie §Task 2 review flagged.
      conn.needsAuth = true;
      return;
    }

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
    if (!res.ok) {
      // Only a real success may move the clock. Stamping conn.at here
      // regardless is what let the line read "synced 15:50" while the view
      // was still null and the form stayed dead — a status that lies is
      // worse than no status, because it sends you looking in the wrong
      // place. An empty queue means drain never saw this rejection, so
      // this is the only chance to report it.
      if (res.kind === 'auth') conn.needsAuth = true;
      conn.error = res.error || 'Could not reach the sheet.';
      return;
    }

    await putView('bootstrap', res.data);
    view = res.data;
    conn.error = '';
    clearRetry(); // a good sync resets the backoff

    const d = new Date();
    conn.at = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } finally {
    syncing = false;
    conn.syncing = false;
    // Anything still queued means the run did not clear it — a failure, a
    // stop, or a token that needs a person. Keep trying on our own.
    if (queue.length) scheduleRetry();
    render();
  }
}

/** The `ledger-select` change handler. Consumes the `ledger` op (spec §4):
    stage 1 pinned each person to whichever book the server remembered,
    changeable only by hand-editing a Script Property. This is a foreground
    action — the control is disabled until a sync has already succeeded
    once (renderLedgers), so a stored token is already proof of a working
    session; there's no need to repeat sync()'s refresh()-then-fallback
    dance for it. */
export async function switchLedger(name) {
  // The native <select> already shows the tapped option the moment `change`
  // fires, before this round trip even starts, and the balances below still
  // belong to the OLD book for as long as the request is in flight — so the
  // control is disabled for the duration, both to stop a second tap from
  // racing this one and so nothing on screen claims a book that hasn't
  // actually loaded yet. The `finally` below is the one place that lifts
  // it again, on every exit from this function alike (success, a rejected
  // switch, or an unexpected throw) — so it never gets stuck disabled.
  const select = document.getElementById('ledger-select');
  if (select) select.disabled = true;

  try {
    const auth = await currentAuth();
    if (!auth || !auth.token) {
      hint('Sign in again to switch ledgers.');
      return;
    }

    const res = await api.call('ledger', { ledger: name }, auth.token);
    if (!res.ok) {
      if (res.kind === 'auth') {
        // Same signal sync() reacts to (round-2 review parity): the server
        // itself rejected the token. Without this the connection line kept
        // reading whatever the last successful sync left it as — "synced
        // HH:MM" — with the tap-to-sign-in affordance unarmed until some
        // later sync happened to run and notice on its own.
        conn.needsAuth = true;
        renderConn(conn);
      }
      hint(res.error || 'Could not switch ledgers.');
      return;
    }

    // A real success is proof the token IS good — mirrors sync()'s own
    // "only a real success may move the clock" rule: without clearing this,
    // a switch that succeeds right after an earlier one got rejected for
    // 'auth' would still leave the connection line reading "sign in again".
    conn.needsAuth = false;

    // Only ledger and accounts change; `ledgers` (the roster) and `user`
    // carry over from the last bootstrap.
    view = { ...view, ledger: res.data.ledger, accounts: res.data.accounts };
    log = null; // the account it was showing belongs to the other book
    await putView('bootstrap', view); // survives a reload
    render();
  } finally {
    // Restores the select to whatever ledger is ACTUALLY active (the old
    // one on failure, the new one on success — render() above already
    // updated `view` first) and lifts the disable from the top of this
    // function. Never skipped, so a failed switch never leaves the control
    // claiming a book it did not reach.
    renderLedgers({ view, conn });
  }
}

export async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {}); // offline-first still works if this fails
  }

  // Checked, and fully resolved, before ANY listener below is registered
  // (round-2 review, C4) — not just before the first render. sync() (which
  // every one of online/visibilitychange/conn-click can reach) calls
  // refresh(), which calls google.accounts.id.initialize() a second time.
  // GIS's initialize is global, so that second call silently replaces the
  // callback THIS signIn() is still waiting on, and signIn()'s promise never
  // settles — a visibilitychange firing while the sign-in popup is open
  // (switching to it is often what triggers one) is the common case. Doing
  // this before registering any listener means none of them can fire sync()
  // while a sign-in is still in flight.
  //
  // Rendering the cached form and then swapping it for the sign-in button a
  // moment later would also flash a screen the signed-out person isn't
  // allowed to act on — checked before the first render() call below for
  // that reason too.
  if (!(await currentAuth())) {
    try {
      await signIn(); // renders Google's button into #screen itself
    } catch (err) {
      // signIn() rejects if Google's library never loads at all — offline
      // on first run, an ad-blocker, corporate DNS (round-2 review, C3).
      // Unhandled, that rejection propagates out of boot(), render() never
      // runs, and the person is left staring at a blank page with nothing
      // to tap. Painting a plain message is the least this can do; nothing
      // past this point can work without a session anyway, so stop here
      // rather than fall through into a render() that has nothing to show.
      const screen = document.getElementById('screen');
      if (screen) screen.textContent = 'Could not load sign-in. Check your connection and reload.';
      return;
    }
  }

  // The form itself is rebuilt on every render(), so its listener has to be
  // delegated from #screen (which index.html creates once and never
  // replaces) rather than attached to the form directly.
  document.getElementById('screen').addEventListener('submit', (e) => {
    if (e.target.id === 'entry-form') onSubmit(e);
  });
  document.getElementById('screen').addEventListener('click', onScreenClick);
  document.getElementById('screen').addEventListener('keydown', onScreenKeydown);
  document.getElementById('conn').addEventListener('click', onConnClick);
  document.getElementById('ledger-select').addEventListener('change', (e) => switchLedger(e.target.value));
  // renderLedgers alongside renderConn, not a full render(): going offline
  // must disable the switcher on the spot (the other books' accounts are
  // not cached — leaving it live is the same lie as a status line
  // claiming a sync that never happened), not whenever the next unrelated
  // render happens to run.
  window.addEventListener('online', () => { conn.online = true; clearRetry(); renderConn(conn); renderLedgers({ view, conn }); if (log) render(); sync(); });
  window.addEventListener('offline', () => { conn.online = false; clearRetry(); renderConn(conn); renderLedgers({ view, conn }); if (log) render(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) sync();
  });

  view = await getView('bootstrap');
  queue = await store.listQueue();
  render();

  if (navigator.onLine) sync();
}
