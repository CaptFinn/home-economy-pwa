// Google sign-in. DOM- and Google-bound (needs a real `google.accounts.id`
// and a real `#screen`), so the real popup is exercised by hand per the
// runbook; wiring.js drives this module with a fake Google and a fake fetch.
//
// Offline rule, stated once here because every method below leans on it: a
// token already in hand is treated as proof until the server says
// otherwise — the app never blocks a screen on the network just to
// double-check who's holding the phone. But a queued write is only proved
// once it is actually SENT and the server accepts it; holding a valid token
// is not itself a claim that anything queued has gone through. Nothing is
// ever written to local state — the queue emptied, a cached view replaced —
// until the server has said so. Auth only decides whether the app tries.
//
// The token the app sends is the server's session (stage 5 spec §3, §4):
// after one Google sign-in it is traded for a 30-day token, so there is no
// silent refresh to wait on. If the trade fails — an old server, no
// connection — the Google token is kept, which lasts about an hour, as it
// always did.
import { getAuth, putAuth } from './db.js';
import * as api from './api.js';
import { CLIENT_ID } from '../config.js';

// The GIS script tag (index.html) loads `async`, so it may not be attached
// to `window` yet when this module first runs. Poll briefly rather than
// assume a load order between two independently-scheduled scripts.
// ponytail: a fixed poll ceiling, not a general retry/backoff scheme — this
// gates one button render, nothing more.
function whenGoogleReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function check() {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      if (Date.now() > deadline) return reject(new Error('Google sign-in did not load.'));
      setTimeout(check, 50);
    })();
  });
}

// A JWT's payload is unsigned-looking base64 — anyone could write anything
// in it client-side, so this decode proves nothing. It is used only to fill
// `email` on the stored auth record, which currentAuth()/signOut() below
// test for truthiness to decide "is someone signed in" — never trusted for
// anything money-related. The server re-derives the email from the verified
// token itself and never trusts what the client sends. (The top bar's
// "signed in as…" — round-2 review, C5 — reads `view.user` from the
// bootstrap payload instead, in main.js's render(): that name comes from
// the server's own verified email, not this unverified decode.)
// A session token (`s1.<payload>.<sig>`) keeps its payload in the same middle
// segment, so this reads either kind. A credential that isn't three
// dot-separated segments of valid base64 JSON (never expected from Google,
// but a callback argument is never a promise worth trusting blindly)
// returns '' rather than throwing out of here.
function emailFromToken(token) {
  const segment = String(token).split('.')[1];
  if (!segment) return '';
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)).email || '';
  } catch {
    return '';
  }
}

// The token goes in the existing `token` field, so no call site changes
// whichever kind it is. api.call never throws, so a dead network is just
// another reply that is not a session.
//
// The trade is bounded: boot() waits on signIn() before it registers a single
// listener, and a fetch has no timeout of its own, so on a connection that
// stalls (bars showing, nothing arriving) an unbounded wait would freeze the
// app on Google's button. Past the bound the Google token is kept, as for any
// other failed trade.
const SESSION_TIMEOUT_MS = 8000;

async function storeCredential(response) {
  let timer;
  const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), SESSION_TIMEOUT_MS); });
  let traded;
  try {
    traded = await Promise.race([api.call('session', {}, response.credential), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
  const token = traded.ok && traded.data && traded.data.token ? traded.data.token : response.credential;
  const auth = { email: emailFromToken(token), token };
  await putAuth(auth);
  return auth;
}

/** Renders Google's button into #ledger-main and resolves once the person signs
    in, with the auth already saved to IndexedDB. */
export async function signIn() {
  await whenGoogleReady();
  return new Promise((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      // storeCredential() can reject (putAuth() throwing on a blocked or
      // quota-full IndexedDB). That rejection lands on the promise this
      // callback creates, not on any surrounding try/catch — there isn't
      // one here, and GIS never awaits this callback either — so left
      // unhandled it is simply lost and this signIn() promise hangs
      // forever. Rejecting here instead means a broken sign-in surfaces as
      // a rejected promise the caller can catch and show, rather than a
      // screen that never moves.
      callback: (response) => storeCredential(response).then(resolve, reject),
    });
    // #ledger-main, not #screen: #screen holds the two fixed regions
    // (stage 4 spec §3.2), and clearing it would remove them. The side is
    // emptied too, so nothing stale and tappable sits beside the button.
    const host = document.getElementById('ledger-main');
    host.textContent = '';
    document.getElementById('ledger-side').textContent = '';
    const slot = document.createElement('div');
    host.appendChild(slot);
    google.accounts.id.renderButton(slot, { type: 'standard' });
  });
}

/** The stored `{email, token}`, or null if no one has signed in on this
    device — works offline, since it never touches the network. */
export async function currentAuth() {
  const auth = await getAuth();
  return auth && auth.email ? auth : null;
}

/** Clears the stored session. There is no delete-auth store method (db.js
    keeps one record per device); overwriting the email/token to null is
    enough, since currentAuth() above treats a missing email as signed out. */
export async function signOut() {
  await putAuth({ email: null, token: null });
}
