#!/bin/sh
# Runs the client's pure-module assertions under node (selfcheck.js), then
# the wiring assertions under a fake DOM (wiring.js) — what's left, auth.js
# and the parts of main.js selfcheck.js can't reach, is still exercised by
# hand on a phone. Everything that can be checked without a browser is
# checked here, the way the Apps Script project does it.
set -e
cd "$(dirname "$0")"
node selfcheck.js
node wiring.js
