// The transport to the Apps Script endpoint. Every call is a POST with a
// text/plain body: Apps Script's web app has no way to answer a CORS
// preflight, and a JSON content type is exactly what makes a browser send
// one. text/plain never triggers a preflight, so the JSON still travels —
// just typed as plain text — and doPost parses it itself.
import { API_URL } from '../config.js';

/** Shapes one request. `redirect: 'follow'` matters because `/exec` answers
    with a redirect to a googleusercontent.com URL where the real response
    lives — fetch must chase it rather than stop at the 3xx. */
export function buildRequest(token, op, args) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, op, args }),
    redirect: 'follow',
  };
}

/** Parses the server's `{ok, ...}` envelope. The one thing this endpoint
    returns instead of JSON is an HTML sign-in page (an expired Apps Script
    session), so a body that doesn't parse means "sign in again", not
    "the server is broken". */
export function readResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, kind: 'auth', error: 'Sign in again to continue.' };
  }
}

/** Calls the endpoint and always resolves — never throws — because
    queue.js's `drain` expects a `{ok, ...}` shape from `send` and stops the
    run on a shape it can't reach a conflict/auth branch from, not on an
    exception. `fetch` itself is the only thing that can throw here (offline,
    DNS, …); an HTTP error status never happens since Apps Script always
    answers 200 with either JSON or the sign-in page. */
export async function call(op, args, token) {
  try {
    const res = await fetch(API_URL, buildRequest(token, op, args));
    return readResponse(await res.text());
  } catch {
    return { ok: false, kind: 'server', error: 'No connection.' };
  }
}
