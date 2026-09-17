#!/bin/sh
# Runs the client's pure-module assertions under node. The DOM-facing modules
# are exercised by hand on a phone; everything that can be checked without a
# browser is checked here, the way the Apps Script project does it.
set -e
cd "$(dirname "$0")"
node selfcheck.js
