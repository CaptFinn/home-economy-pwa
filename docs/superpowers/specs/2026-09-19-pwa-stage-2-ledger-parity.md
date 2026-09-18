# PWA stage 2 — ledger parity

Stage 1 shipped one screen: log an expense, offline, and sync it. This stage
makes the PWA a usable replacement for the Apps Script app's **Ledger** side —
seeing your money, correcting it, and choosing which book you are in.

Parent design: `2026-09-16-pwa-client-design.md` (architecture, auth,
transport, the queue). Stage 2 is its §9.2. Nothing there changes except where
§7 below says so. Bills are stage 3; the desktop layout is stage 4.

## 1. What it adds

| | Apps Script app | PWA after this stage |
|---|---|---|
| Accounts and balances | yes | yes (stage 1) |
| Log an entry | yes | yes (stage 1), offline |
| **Switch ledger** | yes | **this stage** |
| **Recent entries** | yes | **this stage** |
| **Full log, paged** | yes | **this stage** |
| **Edit an entry** | yes | **this stage**, offline-queued |
| **Void an entry** | yes | **this stage**, offline-queued |
| Bills | yes | stage 3 |
| Desktop layout | yes | stage 4 |

Every one of these already exists on the server and is already reachable
through `Api.gs`'s op map. This stage is client work plus whatever the real
device turns up.

## 2. Rules this stage is built under

These come from stage 1's deployment, where every genuine defect was invisible
to a green test suite:

1. **Nothing may silently strand money.** Any path that leaves an entry unsent
   either retries itself, or shows a state the person can act on. A status
   line that can report success it did not achieve is a defect, not a cosmetic
   issue — that one cost an evening.
2. **A wired-up screen is testable.** Stage 1 left `main.js` and the renderers
   outside the checks because they touch the DOM, and that is exactly where
   the withdrawal bug, the lying status line and the unbounded refresh lived.
   This stage adds a stub-DOM harness (§6) and the screens are built against
   it.
3. **The server decides; the client renders.** Unchanged, and it held up
   perfectly: no money rule is implemented twice.

## 3. Screens

One page, three views, switched client-side. No router, no URLs — the app
opens where it was.

### 3.1 Home

The stage 1 screen, plus what it was missing:

```
HOME ECONOMY        [ Bills ▾ ]     synced 23:40   vin
  Electricity                              ₱1,500.00
  Groceries                                  ₱301.00
  Joint Wallet                             ₱1,840.00                 ⋯
  ────────────────────────────────────────────────
  NEW ENTRY
  Date            Type
  Account         Source or recipient
  Description     Amount
  [ Add entry ]
  ────────────────────────────────────────────────
  RECENT                                   View all →
  ↑ Beef loaf and eggs   sep 17 · Joint Wallet   −₱60.00
  ↓ Funding for Internet sep 17 · Internet    +₱1,499.00
```

`Recent` is the 20 rows `bootstrap` already returns per account, for the
selected account, with its running balance — the same data the Apps Script app
shows. Queued entries appear above them, marked pending, exactly as in stage 1.

### 3.2 Full log

`View all` opens the account's whole history, 50 rows a page, `Load 50 more`
at the foot — `getEntries` already paginates. Back returns home.

### 3.3 Edit

Tapping any entry — recent or log — opens it in the form: heading `Edit
entry`, button `Save changes`, `Cancel`, and a quiet `Void this entry` that
takes a second tap. Identical in wording and behaviour to the Apps Script app,
because the same two people use both.

## 4. The ledger switcher

A select in the top bar listing `bootstrap`'s ledgers. Choosing one calls the
`ledger` op, which returns that book's accounts and remembers the choice
**per person** server-side.

- **Offline** it is disabled and shows the current ledger. The other books'
  accounts are not cached, and offering a switch that cannot work is the kind
  of lie rule 1 forbids.
- A new entry always belongs to the ledger on screen.
- Creating a ledger is out of scope — the Apps Script app does that.

This closes stage 1's sharpest edge: each person was pinned to whichever book
the server happened to pick, changeable only by editing a Script Property.

## 5. Offline behaviour

| Action | Offline |
|---|---|
| Log an entry | queues (stage 1) |
| **Edit an entry** | **queues; the row shows as pending-edit** |
| **Void an entry** | **queues; the row shows as pending-void** |
| Recent | last synced rows |
| Full log | page 1 only if cached; later pages need the network and say so |
| Switch ledger | disabled |

Edits and voids ride the existing queue. The server's fingerprint check means
a queued edit that arrives stale is **refused, not applied** — it parks with
its message, and the person chooses: discard, or reopen the entry with fresh
data and redo it. No automatic merge; this is money.

A queued edit is shown on the row it edits, not only in the pending list, so
the history never quietly disagrees with what you typed.

## 6. Testing

Stage 1's checks covered the pure modules well and the wiring not at all. This
stage closes that, because the wiring is where the defects were.

- **A stub-DOM harness in `check.sh`**, modelled on the sibling Apps Script
  repo's, which evaluates the client modules against a fake `document` and
  runs the real `render`/submit paths. It cannot assert what is *drawn*; it
  catches what actually broke in stage 1 — a renamed field, a wrong argument,
  a handler that throws, a promise that never settles.
- **Assertions for every state the connection line can report**, including
  that a failed sync can never render as a successful one.
- **A submit-path assertion** that what reaches the queue carries an unsigned
  amount and its direction — the stage 1 Critical, which no test could catch
  at the time.
- The edit and void paths get the same treatment: what reaches the queue is
  asserted, not just what the form produced.

Hand verification stays for what no harness can reach: a real phone, a real
sign-in, a real flaky network.

## 7. Carried defects to fix here

Named because they were deferred with reasons that expire when this stage
touches the same code:

1. **`signIn()` can hang if a sync runs at the same moment** — `refresh()`
   re-initialises Google's client and steals the callback `signIn()` awaits.
   Stage 1 narrowed it to `onConnClick`; this stage serialises the two.
2. **`doPost`'s inner catch wraps serialisation as well as the handler**, so a
   serialisation failure would relay unsanitised text (`Api.gs`). One line.
3. **The "includes pending" note and the pending list** duplicate what a
   pending row on the entry itself will say, once §5's pending-edit marks
   exist. Reconcile rather than accumulate.

## 8. Out of scope

- Bills of any kind (stage 3).
- The desktop layout (stage 4).
- Creating or renaming ledgers and accounts.
- Editing an entry's ledger, or rows the app never stamped — the server
  refuses both, and the client should not offer them.
- Any change to how the sheet models money.

## 9. Deployment

No sheet change, no new Script Property, no new deployment: every op this
stage uses is already live. A `docs/RUNBOOK.md` section covers what to verify
by hand — chiefly that an edit made offline lands correctly, that a stale one
refuses rather than overwriting, and that Venice's edits record as hers.
