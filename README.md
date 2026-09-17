# Home economy — client

A PWA for two people to log household money. It talks to the Apps Script
project at `../Home_Economy_PWA` as a JSON API, and is built to open and
accept an entry with no signal, queueing writes until the phone reconnects.
Hosted on GitHub Pages as plain files — no bundler, no npm, no build step.

## `config.js` is public, on purpose

`config.js` holds the OAuth client id and the API deployment URL, and it is
committed. The client id is public by definition, and the API URL is a
capability, not a secret — the token check in the Apps Script API is what
protects the books, not the obscurity of the endpoint. Making the repo
private wouldn't change that: GitHub Pages needs a paid plan to serve a
private repo, and a private repo would only hide source history, not the
URL a request needs.

## Running it locally

```sh
python3 -m http.server 8000
```

then open `http://localhost:8000`. `localhost` counts as a secure context,
so the service worker and `crypto.randomUUID()` both work the same as they
will on Pages over HTTPS.

## Checking it

```sh
./check.sh
```

runs `node selfcheck.js` — bare assertions over the pure modules (`app/fmt.js`
so far). Anything DOM-facing is checked by hand on a phone instead.
