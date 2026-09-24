# PWA Stage 4 — Desktop Layout and the New Look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Mobile | Desktop layout switch, a quieter header with an account menu, per-tab pickers in the tab row, the off-white-and-panels look, and the bills progress ring.

**Architecture:** Plain ES modules and vanilla DOM, as in stages 1–3. `#screen` gains two fixed regions (`#ledger-main`, `#ledger-side`) and `#bills` builds two (`.bill-rows`, `.bills-side`); Desktop is a `desktop` class on `<body>` that CSS turns into grids. Everything the connection decides (status dot, account alert, Sign in again, Sync now) is drawn by `renderConn`; the menu and layout state live in `main.js`.

**Tech Stack:** Vanilla JS (ES modules), CSS, a service worker; checks are `./check.sh` = `node selfcheck.js` (pure modules) + `node wiring.js` (real modules against a stub DOM).

**Spec:** `docs/superpowers/specs/2026-09-24-pwa-stage-4-desktop-and-look.md`

## Global Constraints

- No new dependencies, no build step, no server change, no deploy.
- Fixed element ids (index.html and wiring.js's stub must agree): `screen`, `ledger-main`, `ledger-side`, `status`, `whoami`, `conn`, `account-btn`, `account-initial`, `account-menu`, `menu-user`, `menu-sync`, `menu-signin`, `layout-mobile`, `layout-desktop`, `ledger-select`, `bills-scope`, `tab-ledger`, `tab-bills`, `bills`, `foot`.
- Class names: `panel` (white block), `pending-list`, `parked-list`, `payday-lines`, `bill-rows`, `bills-side`; `desktop` on `<body>`.
- Layout storage: `localStorage` key `layout`, values `mobile` | `desktop`; every access in try/catch.
- Colours: `--bg: #f6f5f2`, `--warn: #b4711a`; `manifest.webmanifest` `background_color` `#f6f5f2`; `theme-color` stays `#ffffff`.
- `sw.js` `CACHE` becomes `home-economy-v17`.
- One deliberate deviation from spec §2.3: the menu uses the disclosure pattern (`aria-expanded` + `aria-controls`, no `aria-haspopup`), because it holds a toggle group, not only menu items; `role="menu"` would demand arrow-key navigation it does not have.
- `./check.sh` must print all seven `… self-check passed` lines after every task.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK
  ```

## Review Focus

1. **Sign in again from the Bills tab (or a phone's open log):** Google's button renders into `#ledger-main`, which is hidden there; the person must see the button they are asked to tap. Pinned in Task 2.
2. **Tapping the account button while the menu is open:** it must close, not close-then-reopen via the page-level listener; a tap inside the menu must not close it. Pinned in Task 2.
3. **A browser that refuses storage writes (private mode):** the layout still switches for the visit, with no exception. Pinned in Task 3.
4. **Nothing to list:** an empty pending list or no parked bill items draws no empty white panel. Pinned in Tasks 1 and 5.
5. **Desktop with the log open:** Recent is not on screen, so the pending list must name the selected account's own unsent entries. Pinned in Task 3.

---

### Task 1: The ledger regions

**Files:**
- Modify: `index.html` (`<main id="screen">`)
- Modify: `app/ui.js` (`renderEntry`, `renderPending`, `renderRecent`, `renderLog`)
- Modify: `app/auth.js` (`signIn`'s button host)
- Modify: `app/main.js` (`render()`'s ledger branch)
- Test: `wiring.js`

**Interfaces:**
- Produces: `#ledger-main` (pending list, hero, rail, form) and `#ledger-side` (Recent or log), both fixed children of `#screen`. `renderRecent` and `renderLog` clear `#ledger-side` themselves. `#pending-list` carries `panel` and is `hidden` when empty. Forms and sections carry `entry panel`, `recent panel`, `log panel`.

- [ ] **Step 1: Give the stub DOM the regions, nested as index.html will have them**

In `wiring.js`'s `makeDom`, replace the loop that creates the fixed elements:

```js
  for (const id of ['screen', 'conn', 'whoami', 'foot', 'ledger-select', 'tab-ledger', 'tab-bills', 'bills']) {
    const el = make('div');
    el.id = id;
    byId.set(id, el);
    bodyEl.appendChild(el);
  }
```

with:

```js
  // Each under the parent it has in index.html (null: the body), parents
  // first, so textOf(#screen) still reads both ledger regions.
  const FIXED = [
    ['screen', null], ['ledger-main', 'screen'], ['ledger-side', 'screen'],
    ['conn', null], ['whoami', null], ['foot', null], ['ledger-select', null],
    ['tab-ledger', null], ['tab-bills', null], ['bills', null],
  ];
  for (const [id, parent] of FIXED) {
    const el = make('div');
    el.id = id;
    byId.set(id, el);
    (parent ? byId.get(parent) : bodyEl).appendChild(el);
  }
```

- [ ] **Step 2: Write the failing checks**

In `wiring.js`, in the `renderPending … insertBefore` block, change the assertion on where the slot lands:

```js
  const screen = document.getElementById('screen');
  assert.equal(document.getElementById('pending-list'), screen.firstChild,
    'insertBefore actually placed the new slot at the front of #screen');
```

to:

```js
  const screen = document.getElementById('screen');
  assert.equal(document.getElementById('pending-list'), document.getElementById('ledger-main').firstChild,
    'insertBefore actually placed the new slot at the front of the form side');
```

Then add a new block directly after the `each queued item is said once` block:

```js
// ── the two ledger regions (stage 4 spec §3.2; Review Focus 4) ────────
{
  const rent = { name: 'Rent', balance: 500, txns: [
    { row: 3, fp: 'r3', date: '2026-09-10', account: 'Rent', source_recipient: 'Landlord',
      description: 'Sept', amount: -500, balance: 500 }] };
  const view = { user: 'vin', ledger: 'Bills', ledgers: ['Bills'], accounts: [rent] };
  const mainEl = document.getElementById('ledger-main');
  const sideEl = document.getElementById('ledger-side');
  ui.renderEntry({ view, account: 'Rent', queue: [], conn: { online: true } });
  ui.renderPending([], 'Bills', rent);
  ui.renderRecent({ view, account: 'Rent', queue: [] });
  ui.renderRecent({ view, account: 'Rent', queue: [] });
  assert.ok(mainEl.querySelector('#entry-form'), 'the form is drawn in the form side');
  assert.equal(sideEl.querySelectorAll('.recent').length, 1, 'Recent is in the side region, once, however often it is drawn');
  assert.equal(document.getElementById('pending-list').hidden, true, 'an empty pending list draws no empty panel');
  ui.renderLog({ log: { account: 'Rent', rows: rent.txns, hasMore: false, loading: false, error: '' },
                 conn: { online: true }, queue: [], ledger: 'Bills' });
  assert.ok(sideEl.querySelector('#log') && !sideEl.querySelector('.recent'), 'the log takes the side region in place of Recent');
  assert.ok(mainEl.querySelector('#entry-form'), 'and leaves the form side alone');
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `./check.sh`
Expected: FAIL in `wiring.js` at the `insertBefore actually placed …` assertion (the slot still goes to `#screen`).

- [ ] **Step 4: Add the regions to index.html**

Replace:

```html
  <main id="screen" role="tabpanel"></main>
```

with:

```html
  <main id="screen" role="tabpanel">
    <!-- The two regions the Desktop layout places side by side (stage 4
         spec §3.2): the form side and the history side. Fixed here, like
         #screen itself; the renderers rebuild what is inside them. -->
    <div id="ledger-main"></div>
    <div id="ledger-side"></div>
  </main>
```

- [ ] **Step 5: Point the ledger renderers at their regions**

In `app/ui.js`, `renderEntry`: replace

```js
  const screen = document.getElementById('screen');
  screen.textContent = '';

  // A slot for renderPending to fill in, ahead of the form. Kept even
  // though this call just cleared #screen, so renderEntry and renderPending
  // can be called in either order without one wiping the other's part of
  // the screen (main.js always calls this one first, but nothing enforces
  // that from in here).
  const pendingSlot = document.createElement('div');
  pendingSlot.id = 'pending-list';
  screen.appendChild(pendingSlot);
```

with

```js
  const main = document.getElementById('ledger-main');
  main.textContent = '';

  // A slot for renderPending to fill in, ahead of the form. Kept even
  // though this call just cleared #ledger-main, so renderEntry and
  // renderPending can be called in either order without one wiping the
  // other's part of the screen (main.js always calls this one first, but
  // nothing enforces that from in here). Hidden until it has rows: an
  // empty white panel is noise (stage 4 spec §4).
  const pendingSlot = document.createElement('div');
  pendingSlot.id = 'pending-list';
  pendingSlot.className = 'pending-list panel';
  pendingSlot.hidden = true;
  main.appendChild(pendingSlot);
```

In the rest of `renderEntry`, change the three remaining `screen.appendChild(` calls (`hero`, `rail`, `form`) to `main.appendChild(`, and change `form.className = 'entry';` to `form.className = 'entry panel';`.

`renderPending`: replace

```js
  const screen = document.getElementById('screen');
  let slot = document.getElementById('pending-list');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'pending-list';
    screen.insertBefore(slot, screen.firstChild);
  }
  slot.textContent = '';

  queue
    .filter((i) => ledgerOf(i) === ledger && !(recent && shownInRecent(i, recent)))
    .slice().reverse() // newest first
    .forEach((item) => slot.appendChild(pendingRow(item)));
}
```

with

```js
  const main = document.getElementById('ledger-main');
  let slot = document.getElementById('pending-list');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'pending-list';
    slot.className = 'pending-list panel';
    main.insertBefore(slot, main.firstChild);
  }
  slot.textContent = '';

  queue
    .filter((i) => ledgerOf(i) === ledger && !(recent && shownInRecent(i, recent)))
    .slice().reverse() // newest first
    .forEach((item) => slot.appendChild(pendingRow(item)));
  slot.hidden = !slot.children.length;
}
```

`renderRecent`: replace

```js
  const screen = document.getElementById('screen');
  const view = state.view || { accounts: [] };
```

with

```js
  // Its own region now (stage 4 spec §3.2), so it clears it itself rather
  // than relying on renderEntry's wipe.
  const side = document.getElementById('ledger-side');
  side.textContent = '';
  const view = state.view || { accounts: [] };
```

and in the same function change `section.className = 'recent';` to `section.className = 'recent panel';` and the final `screen.appendChild(section);` to `side.appendChild(section);`. Update the doc comment's "Called after renderEntry, which already wiped #screen for this repaint, so — like renderPending's slot — the section here is always rebuilt fresh" to "It clears #ledger-side itself, so the section here is always rebuilt fresh".

`renderLog`: replace

```js
  const screen = document.getElementById('screen');
  screen.textContent = '';
```

with

```js
  const side = document.getElementById('ledger-side');
  side.textContent = '';
```

change `section.className = 'log';` to `section.className = 'log panel';`, and the final `screen.appendChild(section);` to `side.appendChild(section);`. In its doc comment change "replacing the home screen while it is open" to "in the side region, in place of Recent".

- [ ] **Step 6: Keep Google's sign-in button out of #screen**

In `app/auth.js`, replace

```js
    const screen = document.getElementById('screen');
    screen.textContent = '';
    const slot = document.createElement('div');
    screen.appendChild(slot);
```

with

```js
    // #ledger-main, not #screen: #screen holds the two fixed regions
    // (stage 4 spec §3.2), and clearing it would remove them.
    const host = document.getElementById('ledger-main');
    host.textContent = '';
    const slot = document.createElement('div');
    host.appendChild(slot);
```

and change the doc comment above `signIn` from "Renders Google's button into #screen" to "Renders Google's button into #ledger-main". In `app/main.js`'s `boot`, change the comment `// renders Google's button into #screen itself` to `// renders Google's button into #ledger-main itself`.

- [ ] **Step 7: Hide the form side while the log is open**

In `app/main.js`'s `render()`, replace

```js
  } else if (log) {
    renderLog({ log, conn, queue, ledger: view ? view.ledger : '' });
  } else {
    // conn travels too: when a sync fails, the form's own hint is where the
    // reason belongs — that is the line someone reads when the button is dead.
    renderEntry({ view, account, queue, conn, editing, voidArmed }); // rebuilds #screen, including an empty pending slot
    if (draft) fillForm(draft);
    // Fills that slot in: this book's items only, minus what Recent already says.
    renderPending(queue, view ? view.ledger : '', view && view.accounts.find((a) => a.name === account));
    renderRecent({ view, account, queue, editing }); // the selected account's last-synced rows, plus its own pending ones
  }
```

with

```js
  } else {
    // The log takes the whole screen (stage 2 spec §3.2), so the form side
    // is hidden while it is open.
    const formSide = !log;
    document.getElementById('ledger-main').hidden = !formSide;
    if (formSide) {
      // conn travels too: when a sync fails, the form's own hint is where the
      // reason belongs — that is the line someone reads when the button is dead.
      renderEntry({ view, account, queue, conn, editing, voidArmed }); // rebuilds #ledger-main, including an empty pending slot
      if (draft) fillForm(draft);
      // Fills that slot in: this book's items only, minus what Recent already says.
      renderPending(queue, view ? view.ledger : '', view && view.accounts.find((a) => a.name === account));
    }
    if (log) renderLog({ log, conn, queue, ledger: view ? view.ledger : '' });
    else renderRecent({ view, account, queue, editing }); // the selected account's last-synced rows, plus its own pending ones
  }
```

- [ ] **Step 8: Run the checks**

Run: `./check.sh`
Expected: all seven `… self-check passed` lines.

- [ ] **Step 9: Commit**

```bash
git add index.html app/ui.js app/auth.js app/main.js wiring.js
git commit -m "Split the ledger screen into a form side and a history side

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 2: The header, status line and account menu

**Files:**
- Modify: `index.html` (`.topbar`)
- Modify: `app/ui.js` (`connState`, `renderConn`)
- Modify: `app/main.js` (`render()`'s user writes, `setMenu`, `onConnClick`, `boot` listeners)
- Test: `selfcheck.js`, `wiring.js`

**Interfaces:**
- Consumes: `#ledger-main` from Task 1.
- Produces: `connState(state) → '' | 'offline' | 'syncing' | 'auth' | 'error'` (exported from `app/ui.js`); `renderConn(state)` also sets `#status[data-state]`, `#account-btn[data-alert]`, `#menu-signin.hidden`, `#menu-sync.disabled`; `setMenu(open: boolean)` in `main.js` (Task 3's `setLayout` calls it).

- [ ] **Step 1: Write the failing pure check**

In `selfcheck.js`, extend the ui import line to include `connState`:

```js
import { nextRetryDelay, entryFrom, connLabel, directedAmount, pendingBalance, validateEntry, connState } from './app/ui.js';
```

and add, just before `console.log('ui self-check passed');`:

```js
// The status dot (stage 4 spec §2.1), in connLabel's own order.
assert.equal(connState({ online: false, needsAuth: true }), 'offline', 'offline outranks everything');
assert.equal(connState({ online: true, syncing: true }), 'syncing', 'then a sync in flight');
assert.equal(connState({ online: true, needsAuth: true, error: 'x' }), 'auth', 'then a lost session');
assert.equal(connState({ online: true, error: 'boom' }), 'error', 'then a failed sync');
assert.equal(connState({ online: true, at: '12:50' }), '', 'and otherwise all is well');
```

- [ ] **Step 2: Grow the stub DOM for the header, and let it record page-level listeners**

In `wiring.js`'s `makeDom`, in `FIXED`, replace `['conn', null], ['whoami', null],` with:

```js
    ['status', null], ['whoami', 'status'], ['conn', 'status'],
    ['account-btn', null], ['account-initial', 'account-btn'],
    ['account-menu', null], ['menu-user', 'account-menu'],
    ['menu-sync', 'account-menu'], ['menu-signin', 'account-menu'],
```

and directly after the `for (const [id, parent] of FIXED)` loop add:

```js
  // As index.html ships them.
  for (const id of ['account-menu', 'menu-signin']) byId.get(id).hidden = true;
```

In the stub `document` object, replace `addEventListener() {},` with:

```js
    // Recorded, so a check can fire a page-level click or keydown the way a
    // real tap outside the menu, or Escape, reaches main.js.
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
```

and after `const fireWindow = …` add:

```js
const fireDocument = (type, event = {}) =>
  (document.listeners[type] || []).forEach((fn) => fn({ type, preventDefault() {}, ...event }));
```

- [ ] **Step 3: Write the failing wiring checks**

After the `the connection line can never claim a sync it did not do` block add:

```js
// ── the status line and the account menu's connection-driven parts
// (stage 4 spec §2.1, §2.3) ─────────────────────────────────────────────
{
  const status = document.getElementById('status');
  const btn = document.getElementById('account-btn');
  ui.renderConn({ online: false });
  assert.equal(status.getAttribute('data-state'), 'offline', 'offline turns the dot red');
  assert.equal(document.getElementById('menu-sync').disabled, true, 'and Sync now cannot be tapped');
  ui.renderConn({ online: true, needsAuth: true });
  assert.equal(status.getAttribute('data-state'), 'auth', 'a lost session turns it amber');
  assert.equal(btn.getAttribute('data-alert'), 'true', 'and marks the account button, menu closed or not');
  assert.equal(document.getElementById('menu-signin').hidden, false, 'Sign in again shows only now');
  ui.renderConn({ online: true, at: '12:50' });
  assert.equal(status.getAttribute('data-state'), null, 'synced is the plain state');
  assert.equal(btn.getAttribute('data-alert'), null, 'the alert clears');
  assert.equal(document.getElementById('menu-signin').hidden, true, 'and so does Sign in again');
  assert.equal(document.getElementById('menu-sync').disabled, false, 'Sync now is live again');
}
```

In the main-module block, directly after

```js
  assert.match(document.getElementById('conn').textContent, /^synced \d{2}:\d{2}$/,
    'boot wired a real, successful sync before either scenario below touches it');
```

add:

```js
  // ── the header and the account menu (stage 4 spec §2.1, §2.3; Review
  // Focus 2). The stub's dispatch does not bubble, so a tap on the button
  // is its own click plus the same click reaching the page. ───────────────
  {
    const menu = document.getElementById('account-menu');
    const btn = document.getElementById('account-btn');
    const tapButton = () => { btn.dispatch('click'); fireDocument('click', { target: btn }); };
    assert.match(textOf(document.getElementById('status')), /^vin synced \d{2}:\d{2}$/,
      'the status line is the name, then the connection');
    assert.equal(document.getElementById('account-initial').textContent, 'V', "the button shows the name's first letter");
    assert.equal(menu.hidden, true, 'the menu starts closed');
    tapButton();
    assert.equal(menu.hidden, false, 'the button opens it');
    assert.equal(btn.getAttribute('aria-expanded'), 'true', 'and says so');
    assert.equal(document.getElementById('menu-user').textContent, 'vin', 'naming who is signed in');
    fireDocument('click', { target: document.getElementById('menu-user') });
    assert.equal(menu.hidden, false, 'a tap inside the menu leaves it open');
    tapButton();
    assert.equal(menu.hidden, true, 'the button closes it again, and the same tap reaching the page does not reopen it');
    tapButton();
    fireDocument('click', { target: document.getElementById('ledger-main') });
    assert.equal(menu.hidden, true, 'a tap outside closes it');
    tapButton();
    fireDocument('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, true, 'and so does Escape');
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'and says so');
  }
```

Directly before the block headed `// ── a silent refresh must not steal a waiting sign-in's callback`, add:

```js
  // ── Sign in again from the account menu, on the Bills tab (stage 4 spec
  // §2.3; Review Focus 1): Google's button renders into #ledger-main, so
  // the ledger has to come into view first ─────────────────────────────
  {
    let signInCallback = null;
    fakeGoogle.accounts.id.initialize = (opts) => { signInCallback = opts.callback; };
    fetchImpl = fetchReturning({ ok: false, error: 'Sign in again to continue.', kind: 'auth' });
    navigator.onLine = true;
    fireWindow('online');
    await settle();
    document.getElementById('tab-bills').dispatch('click');
    await settle();
    assert.equal(document.getElementById('bills').hidden, false, 'precondition: on the Bills tab');
    assert.equal(document.getElementById('menu-signin').hidden, false, 'precondition: the session is lost');

    document.getElementById('account-btn').dispatch('click');
    document.getElementById('menu-signin').dispatch('click');
    await settle();
    assert.equal(document.getElementById('account-menu').hidden, true, 'the menu closes on its action');
    assert.equal(document.getElementById('bills').hidden, true, "Google's button needs the ledger in view");
    assert.equal(document.getElementById('ledger-main').hidden, false, 'with the region it renders into showing');

    fetchImpl = fetchReturning({ ok: true, data: bootstrapView });
    const payload = Buffer.from(JSON.stringify({ email: 'vin@example.test' })).toString('base64url');
    signInCallback({ credential: 'h.' + payload + '.s' });
    for (let i = 0; i < 5; i += 1) await settle();
    assert.equal(document.getElementById('menu-signin').hidden, true, 'signed in, Sign in again goes away');
    assert.equal(document.getElementById('account-btn').getAttribute('data-alert'), null, 'and so does the alert');
    navigator.onLine = false;
    fireWindow('offline');
  }
```

- [ ] **Step 4: Run them to verify they fail**

Run: `./check.sh`
Expected: FAIL in `selfcheck.js` — `connState` is not exported.

- [ ] **Step 5: The header markup**

In `index.html`, replace

```html
  <div class="topbar">
    <h1>Home economy</h1>
    <select class="ledger-select" id="ledger-select" aria-label="Ledger"></select>
    <span class="conn" id="conn"></span>
    <span class="whoami" id="whoami"></span>
  </div>
```

with

```html
  <div class="topbar">
    <img class="brand" src="icon.svg" alt="" width="28" height="28">
    <div class="masthead">
      <h1>Home economy</h1>
      <!-- The status line (stage 4 spec §2.1): who is signed in, then the
           connection. A tap signs in when needed, otherwise syncs. -->
      <button type="button" class="status" id="status"><span class="whoami" id="whoami"></span><span class="conn" id="conn"></span></button>
    </div>
    <select class="ledger-select" id="ledger-select" aria-label="Ledger"></select>
    <!-- A disclosure, not role=menu: it holds a toggle group as well as
         actions (spec §2.3; plan's one deviation). -->
    <button type="button" class="account-btn" id="account-btn" aria-label="Account" aria-expanded="false" aria-controls="account-menu"><span id="account-initial"></span><svg class="account-glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 14c.8-2.8 3-4.2 5.5-4.2s4.7 1.4 5.5 4.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
    <div class="account-menu" id="account-menu" hidden>
      <p class="menu-who">Signed in as <span id="menu-user"></span></p>
      <button type="button" class="menu-item" id="menu-sync">Sync now</button>
      <button type="button" class="menu-item" id="menu-signin" hidden>Sign in again</button>
    </div>
  </div>
```

(`#ledger-select` moves to the tab row in Task 4.)

- [ ] **Step 6: renderConn draws everything the connection decides**

In `app/ui.js`, directly after `connLabel`, add:

```js
/** The status dot's state (stage 4 spec §2.1), in connLabel's own order;
    '' means all is well. */
export function connState(state) {
  if (!state.online) return 'offline';
  if (state.syncing) return 'syncing';
  if (state.needsAuth) return 'auth';
  if (state.error) return 'error';
  return '';
}
```

Replace `renderConn` and its doc comment:

```js
/** Writes the connection line into #conn — already in index.html's topbar,
    never recreated — and marks it offline for the CSS to color red. */
export function renderConn(state) {
  const conn = document.getElementById('conn');
  conn.textContent = connLabel(state);
  if (state.online) conn.removeAttribute('data-state');
  else conn.setAttribute('data-state', 'offline');
}
```

with:

```js
/** Everything the connection decides (stage 4 spec §2.1, §2.3), all fixed
    in index.html and never recreated: the line's text, the status dot, the
    account button's alert, and the menu's Sync now and Sign in again.
    Called wherever the connection changes, not only from render(). */
export function renderConn(state) {
  document.getElementById('conn').textContent = connLabel(state);
  const status = document.getElementById('status');
  const s = connState(state);
  if (s) status.setAttribute('data-state', s);
  else status.removeAttribute('data-state');
  const btn = document.getElementById('account-btn');
  if (state.needsAuth) btn.setAttribute('data-alert', 'true');
  else btn.removeAttribute('data-alert');
  document.getElementById('menu-signin').hidden = !state.needsAuth;
  document.getElementById('menu-sync').disabled = !state.online;
}
```

- [ ] **Step 7: The name, the menu, and signing in where the button can be seen**

In `app/main.js`'s `render()`, replace

```js
  const whoami = document.getElementById('whoami');
  if (whoami) whoami.textContent = view && view.user ? view.user : '';
```

with

```js
  const user = view && view.user ? view.user : '';
  document.getElementById('whoami').textContent = user;
  document.getElementById('menu-user').textContent = user;
  document.getElementById('account-initial').textContent = user ? user[0].toUpperCase() : '';
```

and in the comment just above it change "#whoami is a fixed element in index.html's topbar" to "#whoami, #menu-user and #account-initial are fixed elements in index.html's topbar".

Directly above `async function onConnClick() {`, add:

```js
/** The account menu (stage 4 spec §2.3): a disclosure under the account
    button. It closes on any of its actions, on a tap outside it, and on
    Escape (boot wires those). */
function setMenu(open) {
  document.getElementById('account-menu').hidden = !open;
  document.getElementById('account-btn').setAttribute('aria-expanded', String(open));
}

function menuOpen() {
  return !document.getElementById('account-menu').hidden;
}
```

In `onConnClick`, replace

```js
    if (!navigator.onLine) return;
    try {
      await signIn();
```

with

```js
    if (!navigator.onLine) return;
    // Google's button renders into #ledger-main (auth.js), which is hidden
    // on the Bills tab and behind a phone's open log: bring it into view
    // first, or the person is asked to tap a button they cannot see.
    tab = 'ledger';
    log = null;
    renderTabs();
    document.getElementById('ledger-main').hidden = false;
    try {
      await signIn();
```

In `boot()`, replace

```js
  document.getElementById('conn').addEventListener('click', onConnClick);
```

with

```js
  document.getElementById('status').addEventListener('click', onConnClick);
  document.getElementById('account-btn').addEventListener('click', () => setMenu(!menuOpen()));
  document.getElementById('menu-sync').addEventListener('click', () => { setMenu(false); onConnClick(); });
  document.getElementById('menu-signin').addEventListener('click', () => { setMenu(false); onConnClick(); });
  // A tap anywhere else closes the menu. The button's own tap reaches here
  // too, after its toggle, and must not undo it.
  document.addEventListener('click', (e) => {
    if (!menuOpen()) return;
    if (e.target.closest('#account-menu') || e.target.closest('#account-btn')) return;
    setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menuOpen()) return;
    setMenu(false);
    document.getElementById('account-btn').focus();
  });
```

- [ ] **Step 8: Run the checks**

Run: `./check.sh`
Expected: all seven `… self-check passed` lines.

- [ ] **Step 9: Commit**

```bash
git add index.html app/ui.js app/main.js selfcheck.js wiring.js
git commit -m "Add the status line and the account menu to the header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 3: The Mobile | Desktop switch

**Files:**
- Modify: `index.html` (the menu's layout row)
- Modify: `app/ui.js` (`storedLayout`)
- Modify: `app/main.js` (`layout`, `applyLayout`, `setLayout`, `render()`'s log rule, `boot`)
- Test: `selfcheck.js`, `wiring.js`

**Interfaces:**
- Consumes: `setMenu(open)` (Task 2); `#ledger-main` / `#ledger-side` and `render()`'s `formSide` (Task 1).
- Produces: `storedLayout() → 'mobile' | 'desktop'` (exported from `app/ui.js`, reads `globalThis.localStorage`); `body.desktop` when Desktop.

- [ ] **Step 1: Write the failing pure check**

In `selfcheck.js`, add `storedLayout` to the ui import line:

```js
import { nextRetryDelay, entryFrom, connLabel, directedAmount, pendingBalance, validateEntry, connState, storedLayout } from './app/ui.js';
```

and before `console.log('ui self-check passed');` add:

```js
// The layout read back at boot (stage 4 spec §3.1): only a stored
// 'desktop' is Desktop; anything else, or a storage that throws, is Mobile.
{
  const withStorage = (s) => { globalThis.localStorage = s; return storedLayout(); };
  assert.equal(withStorage({ getItem: () => 'desktop' }), 'desktop', 'a stored Desktop is read back');
  assert.equal(withStorage({ getItem: () => null }), 'mobile', 'nothing stored is Mobile');
  assert.equal(withStorage({ getItem: () => 'sideways' }), 'mobile', 'anything else is Mobile');
  assert.equal(withStorage({ getItem() { throw new Error('denied'); } }), 'mobile', 'a storage that throws is Mobile');
  assert.equal(withStorage(undefined), 'mobile', 'and so is none at all');
  delete globalThis.localStorage;
}
```

- [ ] **Step 2: Grow the stub DOM: the layout buttons, and classList**

In `wiring.js`'s `FIXED`, after `['menu-signin', 'account-menu'],` add:

```js
    ['layout-mobile', 'account-menu'], ['layout-desktop', 'account-menu'],
```

In `make()`, directly before `return el;`, add:

```js
    // Enough of DOMTokenList for main.js's layout class (stage 4 spec
    // §3.1), kept on className so matchesSelector('.desktop') still sees it.
    el.classList = {
      contains: (c) => String(el.className).split(/\s+/).includes(c),
      add: (c) => { if (!el.classList.contains(c)) el.className = (el.className ? el.className + ' ' : '') + c; },
      remove: (c) => { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle: (c, force) => {
        const on = force === undefined ? !el.classList.contains(c) : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
    };
```

- [ ] **Step 3: Write the failing wiring checks**

In the main-module block, directly before the `Sign in again from the account menu, on the Bills tab` block (added in Task 2), add:

```js
  // ── the layout switch (stage 4 spec §3; Review Focus 3 and 5) ─────────
  {
    const stored = new Map();
    globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => { stored.set(k, String(v)); } };
    const mainEl = document.getElementById('ledger-main');
    const sideEl = document.getElementById('ledger-side');
    const screen = document.getElementById('screen');
    const choose = (id) => { document.getElementById('account-btn').dispatch('click'); document.getElementById(id).dispatch('click'); };

    document.getElementById('tab-ledger').dispatch('click');
    await settle();
    assert.equal(document.body.classList.contains('desktop'), false, 'boot with nothing stored is Mobile');

    // An unsent entry for the selected account. Recent lists it, so the
    // pending list above the form leaves it out — until the log hides Recent.
    screen.dispatch('click', { target: find(mainEl, (el) => el.dataset.account === 'Groceries') });
    document.getElementById('f-date').value = '2026-09-24';
    document.getElementById('f-type').value = 'Withdrawal';
    document.getElementById('f-source').value = 'Desk';
    document.getElementById('f-desc').value = 'layout check';
    document.getElementById('f-amount').value = '4321';
    screen.dispatch('submit', { target: document.getElementById('entry-form') });
    await settle();

    choose('layout-desktop');
    assert.equal(document.body.classList.contains('desktop'), true, 'Desktop from the menu marks the page');
    assert.equal(stored.get('layout'), 'desktop', 'and is remembered on this device');
    assert.equal(document.getElementById('layout-desktop').getAttribute('aria-pressed'), 'true', 'the switch shows it');
    assert.equal(document.getElementById('account-menu').hidden, true, 'the menu closes on its action');

    screen.dispatch('click', { target: document.getElementById('view-all') });
    await settle();
    assert.ok(sideEl.querySelector('#log'), 'on Desktop the log opens in the side region');
    assert.equal(mainEl.hidden, false, 'the form side stays');
    assert.ok(mainEl.querySelector('#entry-form'), 'with the form in it');
    assert.ok(textOf(document.getElementById('pending-list')).includes('4,321.00'),
      "with Recent gone, the pending list names the account's own unsent entry");

    choose('layout-mobile');
    assert.equal(document.body.classList.contains('desktop'), false, 'Mobile again');
    assert.equal(stored.get('layout'), 'mobile', 'remembered too');
    assert.ok(sideEl.querySelector('.recent') && !sideEl.querySelector('#log'), 'switching layout closed the log');

    screen.dispatch('click', { target: document.getElementById('view-all') });
    await settle();
    assert.equal(mainEl.hidden, true, 'on Mobile the log takes the whole screen');
    screen.dispatch('click', { target: document.getElementById('log-back') });
    assert.equal(mainEl.hidden, false, 'and Back brings the form back');

    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    choose('layout-desktop');
    assert.equal(document.body.classList.contains('desktop'), true, 'a storage that refuses writes still switches, for this visit');
    choose('layout-mobile');
    globalThis.localStorage = undefined;
  }
```

- [ ] **Step 4: Run them to verify they fail**

Run: `./check.sh`
Expected: FAIL in `selfcheck.js` — `storedLayout` is not exported.

- [ ] **Step 5: The layout row in the menu**

In `index.html`, inside `#account-menu`, directly after the `<p class="menu-who">…</p>` line, add:

```html
      <div class="menu-row">Layout
        <span class="layout-switch" role="group" aria-label="Layout"><button type="button" id="layout-mobile" aria-pressed="true">Mobile</button><button type="button" id="layout-desktop" aria-pressed="false">Desktop</button></span>
      </div>
```

- [ ] **Step 6: storedLayout**

In `app/ui.js`, directly after `connState`, add:

```js
/** The layout this device last chose (stage 4 spec §3.1). Per device, not
    per person — the same person is on a phone and a laptop — so it lives in
    localStorage. The property itself can throw in a locked-down browser,
    so it is read inside the try too; any failure is Mobile. */
export function storedLayout() {
  try {
    return globalThis.localStorage.getItem('layout') === 'desktop' ? 'desktop' : 'mobile';
  } catch {
    return 'mobile';
  }
}
```

and add `storedLayout` to `main.js`'s import from `./ui.js`.

- [ ] **Step 7: Layout state, the switch, and the log rule**

In `app/main.js`, after the `const conn = { … };` line add:

```js
// 'mobile' or 'desktop' (stage 4 spec §3), per device. applyLayout draws
// it; setLayout is the account menu's switch, which also remembers it.
let layout = 'mobile';

function applyLayout(mode) {
  layout = mode === 'desktop' ? 'desktop' : 'mobile';
  const desktop = layout === 'desktop';
  document.body.classList.toggle('desktop', desktop);
  document.getElementById('layout-mobile').setAttribute('aria-pressed', String(!desktop));
  document.getElementById('layout-desktop').setAttribute('aria-pressed', String(desktop));
}

function setLayout(mode) {
  applyLayout(mode);
  try {
    localStorage.setItem('layout', layout);
  } catch {
    // Storage refused (private mode): the choice holds for this visit only.
  }
  setMenu(false);
  // The log is arranged differently per layout, so switching closes it, as
  // the Apps Script app's setLayout does.
  log = null;
  render();
}
```

In `render()`, replace

```js
    // The log takes the whole screen (stage 2 spec §3.2), so the form side
    // is hidden while it is open.
    const formSide = !log;
```

with

```js
    // On Mobile the log takes the whole screen (stage 2 spec §3.2); on
    // Desktop it takes the side region and the form stays (stage 4 §3.4).
    const formSide = !log || layout === 'desktop';
```

and replace

```js
      // Fills that slot in: this book's items only, minus what Recent already says.
      renderPending(queue, view ? view.ledger : '', view && view.accounts.find((a) => a.name === account));
```

with

```js
      // Fills that slot in: this book's items only, minus what Recent already
      // says. With the log open Recent is not on screen, so nothing is left out.
      renderPending(queue, view ? view.ledger : '', log ? null : view && view.accounts.find((a) => a.name === account));
```

At the very start of `boot()`, before the `serviceWorker` registration, add:

```js
  // Before anything draws, so a laptop on Desktop never paints Mobile first.
  applyLayout(storedLayout());
```

In `boot()`, after the `menu-signin` listener, add:

```js
  document.getElementById('layout-mobile').addEventListener('click', () => setLayout('mobile'));
  document.getElementById('layout-desktop').addEventListener('click', () => setLayout('desktop'));
```

- [ ] **Step 8: Run the checks**

Run: `./check.sh`
Expected: all seven `… self-check passed` lines.

- [ ] **Step 9: Commit**

```bash
git add index.html app/ui.js app/main.js selfcheck.js wiring.js
git commit -m "Add the Mobile | Desktop switch, remembered per device

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 4: The pickers move to the tab row

**Files:**
- Modify: `index.html` (`.views`)
- Modify: `app/bills.js` (`renderBills`'s head)
- Modify: `app/main.js` (`renderTabs`, `onBillsChange`, `boot`)
- Test: `wiring.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `#bills-scope` is a fixed element in the tab row; `renderBills` fills its options and value; `main.js` listens on it directly. `renderBills` no longer draws a heading.

- [ ] **Step 1: Grow the stub DOM**

In `wiring.js`'s `FIXED`, after `['tab-bills', null],` add `['bills-scope', null],`.

- [ ] **Step 2: Write the failing checks**

In the Bills scenario, replace

```js
    const pickScope = async (value) => {
      scopeSelect().value = value;
      billsEl.dispatch('change', { target: scopeSelect() });
      await settle();
    };
```

with

```js
    const pickScope = async (value) => {
      scopeSelect().value = value;
      scopeSelect().dispatch('change');
      await settle();
    };
```

Directly after `assert.equal(billsEl.hidden, true, 'precondition: the app booted on the ledger, Bills hidden');` add:

```js
    assert.equal(scopeSelect().hidden, true, 'the tab row holds no cycle picker on the Ledger tab');
    assert.equal(document.getElementById('ledger-select').hidden, false, 'it holds the ledger picker there');
```

Directly after `assert.equal(document.getElementById('screen').hidden, true, 'in place of the ledger');` add:

```js
    assert.equal(document.getElementById('ledger-select').hidden, true, 'the ledger picker steps aside on Bills');
    assert.equal(scopeSelect().hidden, false, 'for the cycle picker, in the same tab-row spot');
```

Replace

```js
    assert.ok(text.includes('Payday sep 15, 2026'), 'the payday view names its payday');
```

with

```js
    const shown = scopeSelect().children.find((o) => o.value === scopeSelect().value);
    assert.equal(shown.textContent, 'sep 15, 2026', 'the tab-row picker names the payday on screen');
    assert.ok(!find(billsEl, (el) => el.tagName === 'H2'), 'and the panel no longer repeats it as a heading');
```

Replace

```js
    scopeSelect().value = SWAP_PAYDAY;
    billsEl.dispatch('change', { target: scopeSelect() });
    await settle();
```

with

```js
    scopeSelect().value = SWAP_PAYDAY;
    scopeSelect().dispatch('change');
    await settle();
```

- [ ] **Step 3: Run them to verify they fail**

Run: `./check.sh`
Expected: FAIL in `wiring.js` at `the tab row holds no cycle picker on the Ledger tab` (nothing manages `#bills-scope` yet).

- [ ] **Step 4: The tab row markup**

In `index.html`, remove `<select class="ledger-select" id="ledger-select" aria-label="Ledger"></select>` from `.topbar`, and replace

```html
  <div class="views" role="tablist">
    <button type="button" class="view-tab" id="tab-ledger" role="tab" aria-selected="true" aria-controls="screen">Ledger</button>
    <button type="button" class="view-tab" id="tab-bills" role="tab" aria-selected="false" aria-controls="bills">Bills</button>
  </div>
```

with

```html
  <div class="views">
    <div class="view-tabs" role="tablist">
      <button type="button" class="view-tab" id="tab-ledger" role="tab" aria-selected="true" aria-controls="screen">Ledger</button>
      <button type="button" class="view-tab" id="tab-bills" role="tab" aria-selected="false" aria-controls="bills">Bills</button>
    </div>
    <!-- The open tab's picker (stage 4 spec §2.2); renderTabs shows one. -->
    <select class="ledger-select" id="ledger-select" aria-label="Ledger"></select>
    <select class="ledger-select" id="bills-scope" aria-label="Cycle or payday" hidden></select>
  </div>
```

- [ ] **Step 5: renderBills fills the fixed picker and drops its heading**

In `app/bills.js`'s `renderBills`, replace

```js
  const head = el('div', 'section-head');
  head.appendChild(el('h2', null, isPayday
    ? (scope ? 'Payday ' + longDay(scope) : (view ? 'No paydays yet' : 'Payday'))
    : (scope || (view ? 'No cycles yet' : 'Bills'))));
  const select = el('select', 'ledger-select');
  select.id = 'bills-scope';
  select.setAttribute('aria-label', 'Cycle or payday');
```

with

```js
  // The scope picker is fixed in the tab row (stage 4 spec §2.2) and names
  // the scope, so the panel has no heading of its own; this refills it, as
  // renderLedgers refills #ledger-select.
  const select = document.getElementById('bills-scope');
  select.textContent = '';
```

and delete the two lines

```js
  head.appendChild(select);
  host.appendChild(head);
```

Update `renderBills`'s doc comment: change "the heading and scope dropdown, refused items," to "the tab row's scope picker, refused items,".

- [ ] **Step 6: renderTabs shows the open tab's picker; main listens on it**

In `app/main.js`'s `renderTabs`, after the two `aria-selected` lines add:

```js
  document.getElementById('ledger-select').hidden = onBills;
  document.getElementById('bills-scope').hidden = !onBills;
```

and change its doc comment's "Both tabs and both panels are fixed in index.html" to "The tabs, the panels and the two tab-row pickers are fixed in index.html".

In `onBillsChange`, delete the line

```js
  if (t.id === 'bills-scope') onScope(t.value);
```

In `boot()`, after the `tab-bills` click listener, add:

```js
  document.getElementById('bills-scope').addEventListener('change', (e) => onScope(e.target.value));
```

- [ ] **Step 7: Run the checks**

Run: `./check.sh`
Expected: all seven `… self-check passed` lines.

- [ ] **Step 8: Commit**

```bash
git add index.html app/bills.js app/main.js wiring.js
git commit -m "Put the open tab's picker in the tab row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 5: The Bills regions, panels and progress ring

**Files:**
- Modify: `app/bills.js` (`renderBills`'s body, `billCard`, `totals`, new `ring`)
- Test: `wiring.js`

**Interfaces:**
- Consumes: the fixed `#bills-scope` (Task 4).
- Produces: inside `#bills`, in order: `.parked-list.panel` (only when something is parked), the pending banner, `.bill-rows` (cards, or `.payday-lines.panel`, or the empty message), `.bills-side` (`.totals.panel`, `#bills-newcycle`, `#bills-hint`). The cycle totals start with an `<svg role="img" aria-label="N% funded">`.

- [ ] **Step 1: Let the stub DOM make SVG elements**

In `wiring.js`'s stub `document`, after `createElement: (tag) => make(tag),` add:

```js
    createElementNS: (ns, tag) => make(tag),
```

- [ ] **Step 2: Write the failing checks**

In the Bills scenario, replace

```js
    assert.ok(text.includes('30%'), 'the totals carry their ratio as a plain percentage');
```

with

```js
    const ringEl = find(billsEl, (e) => e.getAttribute('role') === 'img');
    assert.equal(ringEl.getAttribute('aria-label'), '30% funded', 'the ring names its figure');
    assert.ok(textOf(ringEl).includes('30%'), 'and prints it in the middle');
    const sideEl = billsEl.querySelector('.bills-side');
    assert.ok(sideEl.querySelector('.totals') && sideEl.querySelector('#bills-newcycle') && sideEl.querySelector('#bills-hint'),
      'totals, Start and the hint share the side region');
    assert.equal(billsEl.querySelector('.bill-rows').querySelectorAll('.bill-card').length, 2, 'the cards are in the list region');
    assert.equal(billsEl.querySelector('.parked-list'), null, 'nothing parked, no empty panel');
```

After `assert.equal(discard.textContent, 'Discard', 'offering Discard');` add:

```js
    assert.ok(billsEl.querySelector('.parked-list').querySelector('[data-remove-id]'), 'refused items sit together in one panel');
```

After `assert.ok(!textOf(billsEl).includes('could not be found'), 'and it leaves the list');` add:

```js
    assert.equal(billsEl.querySelector('.parked-list'), null, 'and with nothing left refused, no empty panel stays');
```

At the end of the Bills scenario, directly before its closing

```js
    navigator.onLine = false;
    fireWindow('offline');
  }
```

add:

```js
    // The ring clamps as the bar does: a hand-typed extra tick in the sheet
    // must not draw it past 100. Drawn directly; main's next render repaints.
    const { renderBills } = await import('./app/bills.js');
    renderBills({
      bills: { mode: 'cycle', scopes: { cycle: '2026-09', payday: '' }, options: { cycle: ['2026-09'], payday: [] },
               view: { ...cycleView, totals: { billed: 100, funded: 130, remaining: 0, pending: 0 } } },
      queue: [], conn: { online: true },
    });
    assert.equal(find(billsEl, (e) => e.getAttribute('role') === 'img').getAttribute('aria-label'), '100% funded',
      'the ring never claims more than 100%');
```

- [ ] **Step 3: Run them to verify they fail**

Run: `./check.sh`
Expected: FAIL in `wiring.js` — `ringEl` is null (`Cannot read properties of null`).

- [ ] **Step 4: The ring**

In `app/bills.js`, directly after `pct`, add:

```js
const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 19; // on a 44 viewBox, as the Apps Script app's ringHTML

/** The Apps Script app's progress ring (stage 4 spec §5): a track, and a
    fill whose dash offset leaves `percent` of the circle drawn, with the
    figure in the middle. `class` goes through setAttribute: className is
    read-only on an SVG element. */
function ring(percent) {
  const p = Math.round(percent);
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
    return e;
  };
  const c = 2 * Math.PI * RING_R;
  const svg = svgEl('svg', { class: 'ring', viewBox: '0 0 44 44', role: 'img', 'aria-label': p + '% funded' });
  svg.appendChild(svgEl('circle', { class: 'ring-track', cx: 22, cy: 22, r: RING_R }));
  svg.appendChild(svgEl('circle', {
    class: 'ring-fill', cx: 22, cy: 22, r: RING_R,
    'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - p / 100)).toFixed(2),
  }));
  const label = svgEl('text', { class: 'ring-pct', x: 22, y: 22 });
  label.textContent = p + '%';
  svg.appendChild(label);
  return svg;
}
```

In `totals`, replace

```js
  const box = el('div', 'totals');
  if (!isPayday) box.appendChild(el('span', 'totals-pct fig', Math.round(pct(t.funded, t.billed)) + '%'));
```

with

```js
  const box = el('div', 'totals panel');
  if (!isPayday) box.appendChild(ring(pct(t.funded, t.billed)));
```

and change its doc comment to: "The footer figures, as sent. The cycle view leads with the Apps Script app's progress ring (stage 4 spec §5); the payday view has none, as there."

In `billCard`, change `const card = el('div', 'bill-card');` to `const card = el('div', 'bill-card panel');`.

- [ ] **Step 5: The regions**

In `renderBills`, replace everything from

```js
  state.queue
    .filter((i) => i.state === 'parked' && BILL_OPS.includes(i.op))
    .forEach((item) => host.appendChild(parkedRow(item)));
```

to the end of the function with:

```js
  // Refused items share one panel, and there is no panel when there are
  // none (stage 4 spec §4).
  const parked = state.queue.filter((i) => i.state === 'parked' && BILL_OPS.includes(i.op));
  if (parked.length) {
    const list = el('div', 'parked-list panel');
    parked.forEach((item) => list.appendChild(parkedRow(item)));
    host.appendChild(list);
  }

  const missing = view && !isPayday && view.totals ? view.totals.pending : 0;
  if (missing) {
    host.appendChild(el('p', 'banner', missing + (missing === 1 ? ' bill needs' : ' bills need')
      + ' an amount or due date — add them in the Bill Tracker tab.'));
  }

  // The list, and beside it on Desktop the figures and actions that stay
  // in view while it scrolls (stage 4 spec §3.2, §3.4).
  const rowsEl = el('div', 'bill-rows');
  const side = el('div', 'bills-side');
  host.appendChild(rowsEl);
  host.appendChild(side);

  if (!view) {
    rowsEl.appendChild(el('p', 'empty', b.loading ? 'Loading…'
      : state.conn.online ? 'Not loaded yet.'
      : 'Not loaded yet — connect to see this ' + (isPayday ? 'payday.' : 'cycle.')));
  } else if (!view.rows.length) {
    rowsEl.appendChild(el('p', 'empty', 'Nothing here yet.'));
  } else if (isPayday) {
    const lines = el('div', 'payday-lines panel');
    view.rows.forEach((r) => lines.appendChild(paydayLine(view, r)));
    rowsEl.appendChild(lines);
    side.appendChild(totals(view.totals, true));
  } else {
    const ctx = { canAct, editingNote: b.editingNote, noteDraft: b.noteDraft };
    view.rows.forEach((r) => rowsEl.appendChild(billCard(view, r, ctx)));
    side.appendChild(totals(view.totals, false));
  }

  if (!isPayday && view && view.cycle) {
    const next = nextCycle(view.cycle);
    const start = button('more', next ? 'Start ' + next : 'Start next cycle');
    start.id = 'bills-newcycle';
    start.disabled = !canAct;
    side.appendChild(start);
  }

  const hint = el('p', 'hint');
  hint.id = 'bills-hint';
  hint.setAttribute('role', 'status');
  if (b.error) {
    hint.textContent = b.error;
    hint.setAttribute('data-state', 'error');
  } else if (b.busy) {
    hint.textContent = b.busy === 'carry' ? 'Carrying…' : 'Starting ' + nextCycle(view && view.cycle) + '…';
  } else if (!state.conn.online) {
    hint.textContent = OFFLINE_HINT;
  } else if (state.conn.needsAuth) {
    hint.textContent = SIGNED_OUT_HINT;
  }
  side.appendChild(hint);
}
```

- [ ] **Step 6: Run the checks**

Run: `./check.sh`
Expected: all seven `… self-check passed` lines.

- [ ] **Step 7: Commit**

```bash
git add app/bills.js wiring.js
git commit -m "Give the Bills tab its regions, panels and progress ring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 6: The look — CSS, manifest and cache

**Files:**
- Modify: `app.css`
- Modify: `manifest.webmanifest`
- Modify: `sw.js`

**Interfaces:**
- Consumes: every id and class from Tasks 1–5.
- Produces: the approved look (spec §4, mockups `whole-app.html` and `topbar-v2.html` phones 3–4).

CSS has no automated check here; the runbook's hand checks (Task 7) cover it. Step 8 guards against a broken stylesheet.

- [ ] **Step 1: The tokens**

In `app.css`'s `:root`, replace

```css
  /* Seamless: the page and its panels are the same white, and hairlines do
     all the dividing. --well is the one step off that ground, for the inset
     a form field needs to look like something you type into. */
  --bg:       #ffffff;
```

with

```css
  /* An off-white ground with white panels on it (stage 4 spec §4). --well
     is the inset a form field needs, inside a white panel, to look like
     something you type into. */
  --bg:       #f6f5f2;
```

After the `--out:` line add:

```css
  --warn:     #b4711a; /* the status dot and the account alert, for a lost session */
```

After the `--radius-sm:` line add:

```css
  --radius-panel: 16px;
  --shadow-panel: 0 1px 3px rgba(20, 22, 26, 0.06), 0 4px 14px rgba(20, 22, 26, 0.04);
```

- [ ] **Step 2: The header**

Replace the `.topbar` rule with:

```css
.topbar {
  position: relative; /* anchors the account menu */
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px var(--pad);
  background: var(--surface);
  border-bottom: 0.5px solid var(--hairline);
}
```

Replace `.whoami { color: var(--muted); font-size: 12px; }` with:

```css
/* The name gives way before the connection does on a narrow phone. */
.whoami { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.whoami:not(:empty) + .conn::before { content: "\00a0·\00a0"; }
```

Replace

```css
.conn { font-size: 11px; color: var(--muted); }
.conn[data-state="offline"] { color: var(--out); }
```

with

```css
.conn { flex: 0 0 auto; }
```

- [ ] **Step 3: The form, the totals and the bill cards become panel content**

Replace the `.entry` rule and the comment above it with:

```css
/* The form is a .panel (stage 4 spec §4); this is only its inset. */
.entry { padding: 20px var(--pad) var(--pad); }
```

In the `.totals` rule, delete the line `border-top: 0.5px solid var(--hairline);`.

Replace

```css
/* Stands in for the sibling app's decorative ring: the same number, as text. */
.totals-pct { flex: 0 0 auto; font: 400 22px var(--display); }
```

with

```css
/* The Apps Script app's ring (stage 4 spec §5), copied from its Index.html. */
.ring { flex: 0 0 auto; width: 62px; height: 62px; }
.ring circle {
  fill: none;
  stroke-width: 2.5;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}
.ring-track { stroke: var(--hairline); }
.ring-fill { stroke: var(--ink); stroke-linecap: round; }
.ring-pct {
  fill: var(--ink);
  font: 500 9px var(--display);
  text-anchor: middle;
  dominant-baseline: central;
}
```

Replace the `.bill-card` rule (the one with `margin: 10px var(--pad);`) with:

```css
.bill-card { overflow: hidden; } /* a .panel; its rows keep their own insets */
```

- [ ] **Step 4: The tab row**

Replace the `.views` rule with:

```css
.views {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 var(--pad);
  background: var(--surface);
  border-bottom: 0.5px solid var(--hairline);
}
/* The tabs sit on the row's bottom edge, so the selected underline meets it. */
.view-tabs { display: flex; gap: 20px; align-self: stretch; align-items: flex-end; }
.views .ledger-select { margin-left: auto; }
```

- [ ] **Step 5: Append the stage 4 rules**

At the end of `app.css`, append:

```css
/* ── stage 4: header, account menu, panels, desktop (spec §2–§5) ── */

/* The hidden attribute is display:none in the UA stylesheet, which any
   author display rule outranks. The regions, pickers and menu all get one,
   and hidden has to keep winning (as in the Apps Script app). */
[hidden] { display: none !important; }

.brand { flex: 0 0 auto; width: 28px; height: 28px; }
.masthead {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

/* The status line: a button, because a tap signs in or syncs. */
.status {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 0;
  font: 400 12px var(--sans);
  color: var(--muted);
  white-space: nowrap;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
}
.status::before {
  content: "";
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--in);
}
.status[data-state="syncing"]::before { background: var(--muted); }
.status[data-state="offline"]::before { background: var(--out); }
.status[data-state="offline"] .conn { color: var(--out); }
.status[data-state="auth"]::before,
.status[data-state="error"]::before { background: var(--warn); }

.account-btn {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  font: 500 13px var(--sans);
  color: var(--ink);
  background: var(--surface);
  border: 0.5px solid var(--hairline);
  border-radius: 50%;
  cursor: pointer;
}
.account-btn[aria-expanded="true"] { border-color: var(--ink); }
.account-glyph { width: 16px; height: 16px; }
#account-initial:not(:empty) + .account-glyph { display: none; }
/* A lost session shows on the button with the menu closed (spec §2.3). */
.account-btn[data-alert]::after {
  content: "";
  position: absolute;
  top: -1px;
  right: -1px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--warn);
}

.account-menu {
  position: absolute;
  top: calc(100% - 8px);
  right: var(--pad);
  z-index: 10;
  width: 240px;
  padding: 4px 0;
  font-size: 13px;
  background: var(--surface);
  border: 0.5px solid var(--hairline);
  border-radius: 14px;
  box-shadow: 0 8px 28px rgba(20, 22, 26, 0.14);
}
.menu-who { margin: 0; padding: 10px 14px; color: var(--muted); }
.menu-who span { display: block; color: var(--ink); overflow-wrap: anywhere; }
.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 0.5px solid var(--hairline);
}
.menu-item {
  display: block;
  width: 100%;
  padding: 11px 14px;
  font: inherit;
  color: var(--ink);
  text-align: left;
  background: none;
  border: none;
  border-top: 0.5px solid var(--hairline);
  cursor: pointer;
}
.menu-item:disabled { opacity: 0.4; cursor: default; }
/* Copied from the Apps Script app's .layout-switch. */
.layout-switch {
  display: flex;
  border: 0.5px solid var(--hairline);
  border-radius: 8px;
  overflow: hidden;
}
.layout-switch button {
  padding: 4px 8px;
  font: 500 11px var(--sans);
  color: var(--muted);
  background: var(--surface);
  border: none;
  cursor: pointer;
}
.layout-switch button[aria-pressed="true"] { color: var(--bg); background: var(--ink); }

/* A white block on the off-white ground (spec §4). */
.panel {
  margin: 12px var(--pad);
  background: var(--surface);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}
/* Rows keep their hairlines between them, not around the panel's edge. */
.panel > .txn:first-child { border-top: none; }
.panel > .txn:last-child { border-bottom: none; }

/* ── Desktop (spec §3.4): the same elements, placed on a grid. Nothing is
   measured in JS; hidden still decides what shows. ── */
body.desktop .wrap { max-width: 1100px; }
body.desktop #screen,
body.desktop #bills {
  display: grid;
  column-gap: 24px;
  align-items: start;
  padding: 4px var(--pad);
}
body.desktop #screen { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
body.desktop #bills { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
body.desktop #bills > .parked-list,
body.desktop #bills > .banner { grid-column: 1 / -1; }
body.desktop .bill-rows { grid-column: 1; }
body.desktop .bills-side { grid-column: 2; position: sticky; top: 16px; }
/* The grid's padding does the side spacing on Desktop. */
body.desktop .panel { margin-left: 0; margin-right: 0; }
body.desktop .hero,
body.desktop .rail { padding-left: 0; padding-right: 0; }
```

Also update the file's opening comment: replace "The hero and the account rail followed after stage 3; desktop mode is stage 4." with "The hero and the account rail followed after stage 3. Stage 4 gave the PWA its own look (off-white ground, white panels) and desktop mode, at the foot of this file."

- [ ] **Step 6: The manifest**

In `manifest.webmanifest`, change `"background_color": "#ffffff",` to `"background_color": "#f6f5f2",`.

- [ ] **Step 7: The cache**

In `sw.js`, change `const CACHE = 'home-economy-v16';` to `const CACHE = 'home-economy-v17';`.

- [ ] **Step 8: Run the checks, and guard the stylesheet**

Run: `./check.sh && node -e "const s=require('fs').readFileSync('app.css','utf8'); const o=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length; if (o!==c) { console.error('unbalanced braces', o, c); process.exit(1); } console.log('app.css braces balanced')" && ! grep -n "totals-pct" app.css app/*.js && echo "no totals-pct left"`
Expected: all seven `… self-check passed` lines, `app.css braces balanced`, and `no totals-pct left` (nothing still names the retired percentage).

- [ ] **Step 9: Commit**

```bash
git add app.css manifest.webmanifest sw.js
git commit -m "Give the PWA its own look: off-white ground, white panels, desktop grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

### Task 7: The runbook

**Files:**
- Modify: `docs/RUNBOOK.md` (append)

- [ ] **Step 1: Add the stage 4 section**

Append to `docs/RUNBOOK.md`:

````markdown

---

# Stage 4 runbook — desktop layout and the new look

**No server change, no deploy, no Script Property.** `sw.js`'s `CACHE` is
bumped to `home-economy-v17`: close and reopen the installed app once on each
phone to pick it up.

**About deploying the API in later stages.** Never `clasp redeploy` the
`Api-deployment`: clasp rebuilds a deployment's access from `appsscript.json`,
which holds the household app's settings (execute as the user accessing,
anyone with a Google account), and the PWA then gets a 401 with no CORS header
and reports "No connection" (2026-09-24). `clasp push` and `clasp version` are
fine; then move `Api-deployment` (the id in `config.js`) to the new version in
the web editor: **Deploy → Manage deployments → Edit**, and check it still
says **Execute as: Me** and **Who has access: Anyone**. The stage 3 spec's §5
and plan's Task 7 say otherwise and are superseded by this note.

## Verify

1. **The phone header.** On both phones: the peso icon, `HOME ECONOMY` over
   `<name> · synced HH:MM` with a green dot, and the round account button. The
   tab row has `Ledger | Bills` and, on the right, the ledger picker (Ledger
   tab) or the cycle picker (Bills tab). Nothing wraps or scrolls sideways.
2. **The look.** Off-white ground; the form, Recent, the bill cards and the
   totals are white cards; the balance and the account pills sit on the ground.
   The Bills totals show the ring with the same percentage as before.
3. **The account menu.** Tap the button: it shows who is signed in, Layout,
   and Sync now. Tap outside it, and it closes; open it and tap the button
   again, and it closes.
4. **Desktop on the laptop.** Menu → Desktop. The ledger splits in two:
   balance, pills and form on the left, Recent on the right. View all opens
   the log on the right; the form on the left still works. Reload: still
   Desktop. The phones are still on Mobile.
5. **Desktop Bills.** Bill cards on the left; the ring, totals and Start stay
   in view on the right while the list scrolls.
6. **Offline.** Airplane mode: the dot turns red, the line says `offline`, and
   Sync now is greyed out.
7. **A lost session.** When the line says `sign in again` (or after signing
   out of Google in the browser): the account button has an amber dot, the
   menu offers Sign in again, and signing in from there works — including from
   the Bills tab.
````

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "Add the stage 4 runbook, and the web-editor rule for API deploys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TdRzDR8eoza2BPAeacwupK"
```

---

## After the tasks (controller only)

1. Whole-branch review of `main..stage-4`.
2. The user runs the runbook's checks from a preview if they want one before merge; otherwise merge to `main` and push **only after the user confirms** — pushing publishes to GitHub Pages.
3. Update the `pwa-stage-status` memory: stage 4 merged, cache v17, what the user verified.

## Self-review against the spec

| Spec | Task |
|---|---|
| §2.1 header: icon, wordmark, name · status, dot states, tap signs in or syncs, white header | 2 (markup, `connState`, `renderConn`, status listener), 6 (styles) |
| §2.2 tab row: ledger picker on Ledger, scope picker on Bills, heading dropped | 4 |
| §2.3 account button, initial or glyph, menu items, amber dot, closes on outside / Escape / action, ids kept | 2 (menu, alert, Sign in again, Sync now), 3 (Layout row), 6 (styles) |
| §3.1 switch, per device, try/catch, body class, no auto-switch, switching closes the log | 3 |
| §3.2 regions | 1 (ledger), 5 (bills) |
| §3.3 Mobile: log takes the screen | 1, pinned again in 3 |
| §3.4 Desktop grids, log beside the form, sticky side | 3 (render rule), 6 (CSS) |
| §4 off-white, panels, hero on the ground, hairlines inside panels, `[hidden]`, manifest | 1 and 5 (panel classes), 6 |
| §5 ring, `role="img"` label, clamped, none on payday | 5 (markup, checks), 6 (styles) |
| §6 files, checks, sw bump, runbook | 1–7 |
| §6 hand checks 1–6 | 7 (plus a look check, 2) |
| §7 not in this stage | nothing built for it |
