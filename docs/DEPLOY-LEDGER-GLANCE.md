# Deploying the ledger glance (spent this month + ledger total)

Same moves as `docs/DEPLOY-STAGE-5.md`, shorter, because the secret and the
sheet are already set up. **STOP IF** anything differs from what a step says,
and send it to me.

**Never** run `clasp deploy` or `clasp redeploy`. **THE deployment to edit** is
the one whose ID starts `AKfycbxWIK3OPj` and ends `3o9n` (not the one *named*
"Api-deployment").

## 1. Merge (local only)
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git status --short                      # prints nothing
git switch main && git merge --ff-only ledger-glance
cd home-economy-app && ./check.sh 2>&1 | tail -1     # bills render smoke passed

cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git status --short                      # prints nothing
git switch main && git merge --ff-only ledger-glance
./check.sh 2>&1 | tail -1               # wiring self-check passed
```

## 2. Server
```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app
git branch --show-current               # main
clasp push                              # answer y if it asks about the manifest
clasp version "Ledger glance: month spent"
```
Expected: `Created version 14.` (use the number it prints below).

Apps Script (spreadsheet → Extensions → Apps Script) → **Deploy → Manage
deployments** → the `…3o9n` deployment → ✏ → **Version: 14** (not "New
version") → confirm **Execute as: Me**, **Who has access: Anyone** → **Deploy**.
No script properties change this time.

Check (note: no `-X POST`):
```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
curl -sL -H 'Content-Type: text/plain' -d '{}' "$(node -e "import('./config.js').then(m => console.log(m.API_URL))")"
```
Expected exactly `{"ok":false,"error":"Sign in again to continue.","kind":"auth"}`, then:
```bash
cd ../Home_Economy_PWA/home-economy-app && clasp list-deployments | grep AKfycbxWIK3OPj
```
Expected a line ending `@14`.

## 3. The app
```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git branch --show-current               # main
git push origin main                    # STOP IF rejected; never force
```
After 2 minutes: `curl -s https://captfinn.github.io/home-economy-pwa/sw.js | grep "const CACHE"`
should print `home-economy-v20`.

## 4. Phones
Close the app fully, open it, wait 5 seconds, close it fully, open it again.
Then do the checks under "Ledger glance" in `docs/RUNBOOK.md`.

## If something goes wrong
Server: Manage deployments → the `…3o9n` deployment → ✏ → **Version 13** →
Deploy. (The app copes with an older server: the card just stays hidden.)
App: `git revert --no-edit 4b3646a..HEAD && git push origin main`.
