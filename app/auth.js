// Google sign-in. DOM- and Google-bound (needs a real `google.accounts.id`
// and a real `#screen`), so this cannot run under node — it is exercised by
// hand per the Task 8 runbook, never by selfcheck.js.
//
// Offline rule, stated once here because every method below leans on it: a
// token already in hand is treated as proof for about an hour (that's what
// its own `exp` says) — the app never blocks a screen on the network just to
// double-check who's holding the phone. But a queued write is only proved
// once it is actually SENT and the server accepts it; holding a valid token
// is not itself a claim that anything queued has gone through. Nothing is
// ever written to local state — the queue emptied, a cached view replaced —
// until the server has said so. Auth only decides whether the app tries.
import { getAuth, putAuth } from './db.js';
import { CLIENT_ID } from '../config.js';

// The GIS script tag (index.html) loads `async`, so it may not be attached
// to `window` yet when this module first runs. Poll briefly rather than
// assume a load order between two independently-scheduled scripts.
// ponytail: a fixed poll ceiling, not a general retry/backoff scheme — this
// gates one button render and one silent-refresh attempt, nothing more.
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
// in it client-side, so this decode proves nothing and is read for display
// only (the top bar's "signed in as…"). The server re-derives the email
// from the verified token itself and never trusts what the client sends.
// A credential that isn't three dot-separated segments of valid base64 JSON
// (never expected from Google, but a callback argument is never a promise
// worth trusting blindly) returns '' rather than throwing out of here.
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

async function storeCredential(response) {
  const auth = { email: emailFromToken(response.credential), token: response.credential };
  await putAuth(auth);
  return auth;
}

/** Renders Google's button into #screen and resolves once the person signs
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
    const screen = document.getElementById('screen');
    screen.textContent = '';
    const slot = document.createElement('div');
    screen.appendChild(slot);
    google.accounts.id.renderButton(slot, { type: 'standard' });
  });
}

/** The stored `{email, token}`, or null if no one has signed in on this
    device — works offline, since it never touches the network. */
export async function currentAuth() {
  const auth = await getAuth();
  return auth && auth.email ? auth : null;
}

/** Asks Google for a fresh credential with no visible prompt, for the sync
    run to call before it sends anything. Resolves null on anything short of
    a fresh token — offline, GIS not loaded, no session, or the user having
    dismissed a recent prompt — and the caller's job is to keep the queue and
    ask for a tap instead, never to block sync on a UI Google chose not to
    show. */
export async function refresh() {
  if (!navigator.onLine) return null;
  try {
    await whenGoogleReady();
    return await new Promise((resolve) => {
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        // Same detached-promise hazard as signIn() above: this callback's
        // own promise is not awaited by the try/catch wrapping this
        // function, so a rejection from storeCredential() here would
        // otherwise vanish rather than being caught below. Resolving null
        // on that rejection keeps refresh()'s contract — anything short of
        // a fresh token is null, never a hang or an uncaught rejection.
        callback: (response) => storeCredential(response).then(resolve, () => resolve(null)),
      });
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) resolve(null);
      });
    });
  } catch {
    return null;
  }
}

/** Clears the stored session. There is no delete-auth store method (db.js
    keeps one record per device); overwriting the email/token to null is
    enough, since currentAuth() above treats a missing email as signed out. */
export async function signOut() {
  await putAuth({ email: null, token: null });
}
