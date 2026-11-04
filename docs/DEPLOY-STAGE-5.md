# Deploying stage 5 — follow this top to bottom

**What ships:** monthly sign-in instead of hourly, a faster feel, edit a bill's
amount and due date, cut-off totals, connect a bill to a ledger (Mark paid),
and the Dashboard tab.

**Time:** about 40 minutes. **You need:** the laptop (terminal + browser), your
phone, Venice's phone for the last step.

**The rules that keep this safe**

1. Do the parts **in order**. Each step says what you should see. If you see
   something else, **STOP** and send it to me. Do not improvise.
2. Server first (Part 3), then the app (Part 4).
3. Nothing here deletes data. Part 1 makes a backup copy anyway.
4. A step marked **STOP IF** means exactly that.

---

## Part 0 — Names that are easy to confuse (read this once)

| What | How to recognise it | Do what |
|---|---|---|
| **THE deployment to edit** (your app talks to it) | Deployment ID starts `AKfycbxWIK3OPj…` and ends `…3o9n`. Its label today: **"PWA stage 3: bill row guard"**, Version **12**. This is the ID written in `config.js`. | **Edit this one** (Part 3.4) |
| The deployment *named* "Api-deployment" | ID starts `AKfycbxg2-Xi…`, Version 10 | **Do not touch.** The name is misleading: it is not the one your app uses. |
| `@HEAD` | ID starts `AKfycbyWE04…` | Do not touch |
| Older ones (v2 … v5.5, "PWA_v1", "HomeEconomy_Alpha…") | the household app | Do not touch |

**Never run** `clasp deploy` or `clasp redeploy`. `redeploy` resets the API's
access settings and takes the app down ("No connection").
`clasp push` and `clasp version` are fine.

---

## Part 1 — Before you start (10 min)

### 1.1 Back up the spreadsheet
Open the Home Economy spreadsheet → **File → Make a copy** → name it
`Home Economy BACKUP before stage 5` → **Make a copy**. Close the copy; don't
use it.

### 1.2 Check the Bill Tracker is clear in columns I, J and K
Open the **Bill Tracker** tab. Look at columns **I, J, K** from row 1 down.

- **They are empty** (nothing in any cell): good, continue.
- **STOP IF** anything is in I, J or K. The app will treat it as a
  connection. Tell me what it is.

### 1.3 Open a terminal and check the tools
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app
clasp show-authorized-user
```
You should see `You are logged in as earvindeleon114@gmail.com.`
**STOP IF** it says you are not logged in: run `clasp login`, sign in with that
account, then run the line above again.

> Every time you open a *new* terminal window in this runbook, run the
> `export PATH=…` line first. The system's default `node` is too old.

---

## Part 2 — Put the finished code on `main` (local only, nothing public yet)

### 2.1 Server code
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA
git status --short
git switch main
git merge --ff-only stage-5-api
git branch --show-current
```
- `git status --short` prints **nothing**.
- The last line prints `main`.
- **STOP IF** `git merge` says it cannot fast-forward or reports a conflict.

Run the server's checks:
```bash
cd home-economy-app
./check.sh 2>&1 | tail -3
```
You should see these three lines (the order may vary, nothing else is red):
`doPost self-check passed`, `self-check passed`, `bills render smoke passed`.
(A big error trace *earlier* in that output is normal. Only the last lines matter.)

### 2.2 App code
```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git status --short
git switch main
git merge --ff-only stage-5
git branch --show-current
./check.sh 2>&1 | tail -1
```
- `git status --short` prints nothing; the branch line prints `main`.
- The last line prints `wiring self-check passed`.
- **STOP IF** the merge refuses, or the last line is anything else.

---

## Part 3 — The server (15 min)

### 3.1 Send the code to Google
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app
git branch --show-current       # must print: main
clasp push
```
Expected: it lists the files it pushed (including `Api.gs`, `Bills.gs`,
`Code.gs`, `Ledger.gs`, `Index.html` and `appsscript.json`) and ends with
`Pushed <a number> files.` 
If it asks whether to overwrite the manifest (`appsscript.json`), answer **y**:
this work did not change that file, and it is the same file used for stages
2 and 3.
**STOP IF** `git branch --show-current` did not print `main`.

> This only updates the project's code. The live app keeps running the old
> version until step 3.4.

### 3.2 Freeze it as a numbered version
```bash
clasp version "Stage 5: sessions, bill edit, ledger link, dashboard"
```
Expected: `Created version 13.`
If it says a different number, write it down and use **that** number wherever
this runbook says "13".

### 3.3 Add the secret that signs the new sign-ins
1. In the terminal, make a secret:
   ```bash
   openssl rand -base64 36
   ```
   It prints 48 random characters. **Select and copy it** (don't retype it).
2. Open the spreadsheet → **Extensions → Apps Script**.
3. Left side: the **gear icon ⚙ Project Settings** → scroll to **Script Properties**
   → **Edit script properties** → **Add script property**.
4. **Property:** `SESSION_SECRET` (capital letters, exactly like that).
   **Value:** paste the 48 characters. → **Save script properties**.
5. Leave the other properties (`ALLOWED_EMAILS`, `PAYERS`, `OAUTH_CLIENT_ID`)
   exactly as they are.

Do not post the secret anywhere. If you ever change it, everyone is signed out
once and signs in again; nothing else is lost.

### 3.4 Point THE deployment at version 13
Still in the Apps Script editor:

1. Top right: **Deploy → Manage deployments**.
2. Find the deployment whose **Deployment ID starts `AKfycbxWIK3OPj` and ends
   `3o9n`** (click an item in the list to see its ID). Its description should
   read **PWA stage 3: bill row guard**, Version **12**.
   **STOP IF** you are looking at the one named "Api-deployment": that is the
   wrong one (Part 0).
3. Click its **pencil icon ✏ (Edit)**.
4. **Version:** open the dropdown and choose **13** (the one described "Stage 5:
   …"). Do **not** choose "New version".
5. Optional: set Description to `PWA stage 5`.
6. Look at the two settings in that same dialog and make sure they read:
   - **Execute as:** **Me** (earvindeleon114@gmail.com)
   - **Who has access:** **Anyone**
   If either differs, change it to match.
7. Click **Deploy**. Then **Done**.
8. Click that deployment again: the **Deployment ID** is unchanged (still ends
   `3o9n`) and the **Version** shows **13**.

### 3.5 Prove the server answers correctly
Back in the terminal:
```bash
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
curl -sL -H 'Content-Type: text/plain' -d '{}' "$(node -e "import('./config.js').then(m => console.log(m.API_URL))")"
```
**Expected, exactly:**
`{"ok":false,"error":"Sign in again to continue.","kind":"auth"}`

> Do **not** add `-X POST` to this command. Google answers a POST with a
> redirect, and `-X POST` makes curl send a second POST to the redirect address,
> which refuses it and shows a long "Page Not Found" web page (in your Google
> account's language). That page is a quirk of the test command, not a problem
> with the server. `-d` already makes it a POST, and curl switches to GET for
> the redirect, as the app does.

- That is **success**: the server is up and refusing a stranger.
- **STOP IF** you see a web page, `401`, `Unauthorized`, or "Sorry, unable to
  open the file". That means the access settings reset. Redo step 3.4 item 6
  and Deploy again, then re-run this check. If it still fails, go to **Part 6**.

Then confirm which version is live:
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/Home_Economy_PWA/home-economy-app
clasp list-deployments | grep AKfycbxWIK3OPj
```
Expected: a line ending `@13`.

---

## Part 4 — Publish the app (5 min)

### 4.1 Push
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git branch --show-current       # must print: main
git status -sb | head -1        # prints: ## main...origin/main [ahead N]
git push origin main
```
Expected: it uploads the commits and ends with `main -> main`.
**STOP IF** git reports `rejected` or asks you to pull first. Do not force it.

### 4.2 Wait for GitHub to publish, then check
Wait 2 minutes, then:
```bash
curl -s https://captfinn.github.io/home-economy-pwa/sw.js | grep "const CACHE"
```
Expected: `const CACHE = 'home-economy-v19'` (before the push it said `v18`).
If it still says `v18`, wait 2 more minutes and run it again.

---

## Part 5 — Your phone, then Venice's (10 min)

### 5.1 Load the new version (do this on each phone)
1. Fully close the app (swipe it away).
2. Open it, wait 5 seconds, **close it fully again**.
3. Open it a third time. (The first open downloads the update, the next one
   runs it.)

You should now see three tabs: **Ledger | Bills | Dashboard**.

### 5.2 Sign in once
The app asks you to sign in with Google. Do it. This is the last forced sign-in
for about 30 days.

### 5.3 Five-minute smoke test (do all of it)
1. **Ledger tab:** your balances look the same as before.
2. **Bills tab → tick any box** on a bill. It looks done at once, and the
   progress updates within a few seconds. Untick it to put it back.
3. **Bills tab → tap an amount** on one bill → the editor opens → **Cancel**.
4. **Dashboard tab:** this month's **Spent** shows a figure; each ledger is listed.
5. Turn on airplane mode, switch tabs; the Dashboard still shows. Turn it off.

**STOP IF** any of 1–4 fails. Send me what you see. Nothing is broken that
Part 6 can't undo.

### 5.4 Then Venice
Repeat 5.1–5.3 on her phone. Her address is already on the allowed list.

### 5.5 The full checks (when you have time, not today's emergency)
`docs/RUNBOOK.md` has the detailed checks under each "Stage 5" heading. The
important one for money is **spec C1**: connect *one* bill to a *test*
account first, tick, untick, Mark paid, Undo, and watch the Ledger tab. Do not
connect all your bills until that behaves.

---

## Part 6 — If something goes wrong

**Server problem** (curl check fails, or the app says "No connection" or
"sign in again" over and over):
1. Apps Script → **Deploy → Manage deployments** → the `…3o9n` deployment → ✏
   Edit → **Version: 12** → confirm **Execute as: Me**, **Who has access:
   Anyone** → **Deploy**.
2. Re-run the curl check from 3.5. The app returns to how it was before today.
   (The new app falls back safely to the old server; only the new features
   stop working.)

**App problem** (the page itself is broken after Part 4):
```bash
export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH
cd /home/captfinn/Documents/Claude/Claude_Code_Projects/home-economy-pwa-client
git switch main
git revert --no-edit 980e667..HEAD
git push origin main
```
`980e667` is the last version you had live. Wait 2 minutes, then close and
reopen the app on each phone twice.

**Data problem** (a number looks wrong): do not edit anything. The backup copy
from 1.1 is the reference. Send me a screenshot.

**Never:** force-push, run `clasp deploy`/`redeploy`, delete a deployment, or
touch `@HEAD` or the other deployments.

---

## Part 7 — Tell me afterwards
Send me: the result of step 3.5 (the curl line), which phone steps passed, and
anything that looked odd. I'll record the deployment and the checks.

### Things that look odd but are normal
- The first time you **connect** a bill, the Bill Tracker tab gains three header
  cells: `Ledger`, `Account`, `Paid`.
- Connected bills add rows to the Ledger tab with the category **Bill
  set-aside** (a tick) or **Bill payment** (Mark paid). That is the feature.
- If you change a bill's due date so that a payday drops out of its schedule,
  a deposit already made for that payday stays in the ledger; void it by hand.
