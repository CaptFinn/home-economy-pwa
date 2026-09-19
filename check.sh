#!/bin/sh
# Runs the client's pure-module assertions under node (selfcheck.js), then
# main.js's and ui.js's wiring under a fake DOM plus fake fetch/google/
# indexedDB (wiring.js). What's left — the real Google sign-in popup and
# service worker registration — needs an actual browser, so those are still
# exercised by hand on a phone. Everything that can be checked without one
# is checked here, the way the Apps Script project does it.
set -e
cd "$(dirname "$0")"
node selfcheck.js
node wiring.js
