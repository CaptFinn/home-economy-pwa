# Stage 1 runbook — deploying the PWA client

Stage 1's code (this repo, plus `Api.gs` and the `Id` column on the
`pwa-api` branch of `../Home_Economy_PWA`) is written, reviewed, and
self-checked. Nothing has been deployed and nothing on the live sheet or the
live Apps Script project has been touched. Every step below is a human step —
GitHub, Google Cloud, the Apps Script project, and the spreadsheet all belong
to Vin, and no agent may perform any of them. Work through this in order;
several steps depend on a value produced by the one before it.

## 1. GitHub — host the client

1. On github.com, create a new repository (public — GitHub Pages needs a
   paid plan to serve a private repo, and the client's own `README.md`
   already explains why that's fine: `config.js` is a public capability,
   not a secret). Don't initialize it with a README; this repo already has
   commits.
2. From a terminal in this repo:
   ```sh
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin HEAD:main
   ```
   `HEAD:main` pushes whatever branch you currently have checked out to the
   remote's `main`, regardless of what your local branch is named — one
   less thing to get wrong if stage 1's work is still on a branch other
   than `main` locally.
3. On the repo's GitHub page: **Settings → Pages**. Under "Build and
   deployment", set Source to **Deploy from a branch**, Branch to `main`,
   folder to `/ (root)`, then **Save**.
4. Wait a minute, reload that same Settings → Pages screen. It shows
   "Your site is live at `https://<you>.github.io/<repo>/`". **Note that
   URL down** — the next step needs it.

## 2. Google Cloud — the OAuth client

1. Go to console.cloud.google.com. Top-left project picker → **New
   Project** → give it a name (e.g. "Home economy") → **Create**, then make
   sure it's the selected project.
2. Left sidebar → **APIs & Services → OAuth consent screen**.
   - User type: **External** → Create.
   - App name: anything recognisable (e.g. "Home economy"). User support
     email and developer contact email: yours.
   - Scopes: none needed — Google Identity Services' sign-in button only
     asks for the basic profile/email scopes it always asks for. Save and
     continue.
   - Test users: **Add users**, and add both Google accounts that will use
     the app — `earvindeleon114@gmail.com` and
     `veniceninasablas@gmail.com`. While this app is unverified (the normal
     state for a two-person household app), only accounts on this list can
     sign in at all.
   - Save through to the summary screen.
3. Left sidebar → **Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: anything (e.g. "Home economy PWA").
   - **Authorized JavaScript origins → Add URI.** This field does **not**
     accept a path or a trailing slash — Google's console rejects it if you
     try. So if your Pages URL from step 1 is
     `https://you.github.io/home-economy-pwa-client/`, what you type here
     is just `https://you.github.io` — the scheme and host, nothing after
     it. (If your repo happens to be named `<you>.github.io` itself, the
     Pages URL and this origin are the same string minus the trailing
     slash.)
   - Leave **Authorized redirect URIs** empty — the sign-in button this app
     uses doesn't redirect anywhere.
   - **Create.** A dialog shows a Client ID and a Client secret. **Copy only
     the Client ID** (it ends in `.apps.googleusercontent.com`). The secret
     is unused by this app — the sign-in flow runs entirely in the browser
     and never presents it to this project's server — so leave it alone.

## 3. Apps Script — Script Properties and the second deployment

Open the spreadsheet → **Extensions → Apps Script**. This opens the
existing, already-bound project — nothing to create here.

1. **Project Settings** (gear icon, left sidebar) → **Script Properties →
   Add script property**:
   - Property: `OAUTH_CLIENT_ID`
   - Value: the Client ID you copied in step 2.
   - Save.
2. **While you're on that screen, check for a property named `API_EMAIL`.**
   An earlier design passed identity through it; the code no longer reads
   it, so if it's still there it's inert — but it's credential-shaped
   leftover data sitting in Script Properties, so delete it (the bin icon
   next to the row).
3. **Deploy → New deployment** — not "Manage deployments" on the existing
   one. The existing deployment (execute as the user accessing, access
   "Anyone with a Google account") is what the household uses today; opening
   it and clicking Edit instead of creating a fresh deployment would change
   *that* one and could break the app Vin and Venice already rely on. Make
   sure you're looking at a blank "New deployment" dialog before continuing.
   - Gear icon next to "Select type" → **Web app**.
   - Description: anything (e.g. "PWA JSON API").
   - Execute as: **Me** (your account).
   - Who has access: **Anyone**.
   - **Deploy.**
4. If Google shows an authorization prompt, choose your account, then
   (since the app is unverified) **Advanced → Go to <project name>
   (unsafe) → Allow**. "Unsafe" here only means Google hasn't reviewed the
   app's branding — it's the same one-time consent every Apps Script
   project asks its owner for.
5. **Copy the Web app URL shown** — it ends in `/exec`. This is the API
   deployment URL, needed in step 5.
6. **Heads-up for later:** this deploy is the first time anything in the
   project calls out to another Google service (`Api.gs`'s token check).
   Apps Script computes one shared permission set for the *whole* project,
   not per deployment, so the next time each of you opens the **existing**
   app (the one you use today), Google will show the authorization prompt
   again for that scope. That's expected — click through it the same way
   (Advanced → Go to … (unsafe) → Allow) — it is not a sign that anything
   broke.

## 4. The sheet — the `Id` column

1. Open the spreadsheet, click the **Ledger** tab.
2. Scroll right and confirm the sheet actually has a column K. If the grid
   stops at J, right-click the J column header → **Insert 1 column right**
   first — the code reads a fixed 11-column row, and a trimmed grid breaks
   every screen, not just this one.
3. Click cell **K1**, type `Id`, then bold it (Ctrl/Cmd+B) to match the
   other headers.
4. Select **K2:K** (click the column K header, or type `K2:K` into the Name
   box and press Enter) → **Format → Number → Plain text**, so a UUID never
   gets mangled into a number.

## 5. This repo — `config.js`

1. Open `config.js`.
2. Replace `PASTE_THE_API_DEPLOYMENT_URL` with the `/exec` URL from step 3.
3. Replace `PASTE_THE_OAUTH_CLIENT_ID` with the Client ID from step 2.
4. Commit and push:
   ```sh
   git add config.js
   git commit -m "Fill in the API URL and OAuth client id"
   git push
   ```
5. Give GitHub Pages a minute to redeploy (Settings → Pages shows the time
   of the latest deployment), then move on to Verify.

**Every future deploy, not just this first one:** any change under `app/`
(or to `index.html`, `app.css`, etc. — anything in `sw.js`'s `SHELL` list)
must also bump the `CACHE` string at the top of `sw.js` (e.g. `home-economy-v1`
→ `-v2`). The service worker only re-fetches and re-caches the shell when
that string changes; an already-installed phone otherwise keeps serving the
old cached files from before the change forever, even after the new code is
live on Pages — there is no other signal that tells it to update. Bump it as
part of the same commit as the change, not as an afterthought once someone
reports the phone "isn't updating."

## 6. Verify

Each check below is something that can fail on its own — work through them
in order, so a failure points at one specific thing rather than "it doesn't
work."

1. **Open the Pages URL on a laptop.** With no one signed in on this device
   yet, the very first thing the screen shows is Google's sign-in button —
   `boot()` checks for a stored session before it renders anything else, so
   there's no flash of a form first. Tap the button and sign in with your
   Google account. The New Entry form then appears. The top bar has a
   `#whoami` slot reserved for showing the signed-in email, but nothing in
   this stage's code writes to it yet — that's a known gap in this stage,
   not something broken by these deploy steps, so no need to chase it here.
2. **Add an entry.** Fill the form (`Which account`, `Who it came from or
   went to`, `What it was for`, an amount) and tap **Add entry**. Within a
   few seconds it appears in the sheet, with `Logged by` showing **your**
   email and the `Id` column filled in with a long random string.
3. **Have Venice sign in on her phone and add one entry.** `Logged by`
   shows **hers**, not yours — this is the check that the verified token,
   not who owns the deployment, is deciding identity (§3.3/§4.1 of the
   design spec).
4. **Airplane mode, offline add.** With the app already opened once (so the
   service worker has cached the shell), turn on airplane mode, then close
   and reopen the app (or reload the page). It still opens to the New Entry
   form — no browser error page. Add two entries; both appear at the top of
   the screen dimmed and marked **pending**, and the top-bar connection
   line reads **offline**.
5. **Reconnect.** Turn airplane mode off. Within a few seconds the
   connection line moves from **offline** to **syncing…** to **synced
   HH:MM**, the two pending entries disappear from the list, and the
   account balance shown updates to include them.
6. **Force-quit before syncing.** Add an entry while still offline (or
   airplane mode back on), then force-quit the browser tab or app entirely
   before reconnecting. Reopen it, still offline: the entry is still listed
   as pending — it was written to the phone's IndexedDB, not held only in
   memory, so quitting mid-flight doesn't lose it.
7. **The idempotency check — this is the one that protects the books.**
   Best done on a laptop, where DevTools is easy to reach:
   - Open the app in a laptop browser. DevTools (F12) → **Network** tab →
     throttling dropdown → **Offline** (this simulates airplane mode without
     leaving the laptop's actual network).
   - Add one entry. It shows as pending.
   - DevTools → **Application** tab → **IndexedDB → home-economy → queue**.
     Click the one row and copy the `id` **inside its `args.entry` object**
     — not the queue record's own top-level `id`. There are two UUIDs on
     this row: the queue record's own `id` (queue.js's bookkeeping, used to
     remove the item once it sends) and `args.entry.id` (the one entryFrom
     assigned, which is what actually travels to the server and lands in
     column K — see `entryFrom` in `app/ui.js`). Pasting the wrong one below
     will look like a failure — column K never matches, because the id
     you'd have copied was never sent anywhere — while the actual mechanism
     works fine.
   - In the spreadsheet's `Ledger` tab, pick any row (a throwaway one is
     fine) and paste that same string into its `Id` (column K) cell by
     hand — this stands in for "the row already made it to the sheet, but
     the reply never reached the phone," the exact failure `Id` exists to
     survive.
   - Back in DevTools, set the Network throttling dropdown back to **No
     throttling** (or online).
   - The queued entry syncs. Confirm: **no new row appears from this
     sync** — only the row you pasted the id into exists with that id —
     and the account balance does not go up a second time for the same
     entry. The server saw the id already present and answered "already
     done" instead of writing a second row.
   - Delete the throwaway row afterward.
8. **Install to the home screen.** Android Chrome: **⋮ menu → Install
   app** (or "Add to Home screen"). iPhone Safari: **Share → Add to Home
   Screen**. Open it from the home screen icon — it opens full-screen, with
   no address bar and no browser chrome, per the manifest's `"display":
   "standalone"`.

## 7. Report back

Two things from the design spec were unknowns going into stage 1 and are
worth writing down now that they've been tested for real, since they'd
change the design if the answer were bad:

1. **Did the cross-origin POST work at all** — no CORS error, no failed
   redirect, on the very first attempt back in "Add an entry" above? (It's
   expected to work — Apps Script's `/exec` redirect plus its
   `Access-Control-Allow-Origin: *` response is a well-worn pattern — but it
   was verified here, not assumed.)
2. **How long did a tap take on mobile data** — specifically, the first
   "Add entry" of the day (a cold token-verification call, no
   `CacheService` hit) versus one a few minutes later (should hit the
   cache and be fast). If the first one is noticeably slow (more than a
   second or two), that's worth mentioning — it's the trigger for switching
   to a short-lived session token instead of verifying Google's token on
   every call.
