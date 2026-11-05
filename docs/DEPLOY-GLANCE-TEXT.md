# Deploying the plain-text "Spent in" line (app only)

Only the app changes. **The server is not touched**: no `clasp`, no deployment
edit, no script property. **STOP IF** anything differs from a step.

## 1. Merge and check
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git status --short                       # prints nothing
git switch main && git merge --ff-only glance-text
./check.sh 2>&1 | tail -1                # wiring self-check passed
```

## 2. Publish
```bash
git branch --show-current                # main
git push origin main                     # STOP IF rejected; never force
```
After 2 minutes:
```bash
curl -s https://captfinn.github.io/home-economy-pwa/sw.js | grep "const CACHE"
```
Expected `home-economy-v21`.

## 3. Phones and laptop
Close the app fully, open it, wait 5 seconds, close it fully, open it again.
Under the big balance you should see two quiet lines:
`Ledger total ₱…` and `Spent in Nov: ₱…` (no card).

## If something goes wrong
`git revert --no-edit HEAD && git push origin main` undoes it; the previous
screen (with the card) comes back after the same close-and-reopen.
