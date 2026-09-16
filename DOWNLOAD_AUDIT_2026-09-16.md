# Realtime Database Download Audit — 16 September 2026

**Scope:** every Realtime Database read and listener reachable from the customer site, the
Admin/POS portal and Finance Books, plus the Cloud Functions that write the nodes those
clients watch. Follow-up to the 16 Sep 2026 audit that fixed the first round of over-reads.

**Symptom:** the project is consuming its no-cost Realtime Database download allowance
(10 GB/month ≈ 360 MB/day on the Spark plan). There is **no Firebase Hosting target in this
repository** (`firebase.json` has no `hosting` block and static files publish through GitHub
Pages), so the allowance being consumed is the Realtime Database one, not the Hosting
transfer allowance. Confirm this on the Firebase console **Realtime Database → Usage** tab:
the metric that matters is **Downloads**, and `Connections` is worth reading at the same time
because connection setup and SSL handshake bytes are billed too.

---

## What was actually wrong

The previous pass fixed whole-node reads and unindexed queries. This pass found a different
class of leak: **nodes that grow forever, attached as a live listener for a whole session**,
plus a **guard that only looked at a subset of the browser code**.

### 1. Staff Inbox read the entire message and receipt history, on every POS terminal

`assets/js/admin/staff-inbox.js` opened two whole-node listeners with `critical: true`:

```js
a.subscribe('staffMessages',        ..., {critical:true});
a.subscribe('staffMessageReceipts', ..., {critical:true});
```

- `critical: true` means **always attached for the whole session in every signed-in admin and
  POS session**, regardless of which tab is open.
- The Staff Inbox module is loaded by the POS route (`module-loader.js` →
  `pos:['inbox','pos']`), so **every cashier terminal paid this cost all day**.
- `staffMessages` grows one record per message and nothing ever deletes one (the 30-day
  expiry is applied in the browser only).
- `staffMessageReceipts/<messageId>/<uid>` grows as **messages × staff members**, and the
  browser downloaded all of it — every other staff member's receipts included — while the
  Inbox only ever reads the signed-in user's own read/acknowledge state.
- `staffMessageReceipts` has no `.indexOn`, so it could not have been bounded by a query
  without a rules change.

### 2. Finance Books downloaded the whole suspense-conversion node on every sign-in

`assets/js/books/suspense-advance.mjs` opened `onValue(ref(db,"/suspenseAdvanceConversions"))`
— the entire node, at module scope, with no auth or tab gating, one record per conversion.
The only consumer was a single boolean lookup:

```js
suspenseAdvanceEligible = manualEntry && !(window.__suspenseAdvanceConversions||{})[e.id] && ...
```

The server already stamps that same fact onto data the journal had **already downloaded**:
`books/journal/<originalId>/supplierAdvanceConversionId` and
`financialMovements/<originalId>/supplierAdvanceConversionId`
(`src/functions/42c-financial-command-controls.js`). The listener was redundant.

### 3. The release guard could not see either of them

`tests/client-download-guard-check.mjs` is the gate that is supposed to catch this class. It
had two blind spots:

- It scanned a hand-picked file list — `src/**`, `assets/js/admin/core.mjs`,
  `assets/js/admin/realtime-hub.mjs`, `assets/js/books/live-pos.mjs` and `assets/js/shared/*`.
  **Every other file under `assets/js/admin/` and `assets/js/books/` was never checked**, which
  is where `staff-inbox.js`, `operations-dashboard.js`, `live-operations.js`,
  `sales-history.js` and `suspense-advance.mjs` live.
- It validated only paths listed in the hub's own `scopes` object. A path subscribed with
  explicit options — `{critical:true}`, `{scopes:[...]}` — or not listed at all escaped
  entirely. `staffMessages`, `staffMessageReceipts`, `suspenseAdvanceConversions`,
  `staffReceiptIndex` and `posDeviceHealth/<shiftId>` were all in that hole.

### 4. Growing nodes were attached as whole-node listeners

The hub attached these paths with a plain `onValue` on the whole node, so the client holds the
entire node and rebuilds it — `snapshot.val()` — for every consumer on every single write
anywhere inside it:

`reviews` (attached in the **default dashboard scope**), `feedbacks`, `appCustomers`,
`pettyCashVouchers`, `pettyCashReplenishments`, `suppliers`, `inventorySku`,
`posDeviceHealth/<shiftId>`, `shiftCloseReceipts/<shiftId>`, `ownerDailySummaries/<day>`.

Be careful how you read this one. The **initial** download is identical either way, and
Firebase may already send only the changed subtree over the wire for a `value` listener. So
this is a certain reduction in per-write client work — which matters on a POS tablet — and an
**unconfirmed** reduction in wire bytes. The audit document said so rather than quietly
claiming the win; the console Usage tab is what settles it.

`posDeviceHealth` is the worst of these because of how often it is written:
`assets/js/admin/pos-sync-health.js` calls `reportPosDeviceHealth` **every 60 seconds per
device**, and the function does an unconditional `set()` on
`/posDeviceHealth/<shiftId>/<deviceId>` (`src/functions/25-pos-assurance.js`). The 60-second
cadence cannot simply be slowed down: `verifyShiftCloseReadiness` rejects a device whose
`lastContactAt` is older than `POS_HEALTH_MAX_AGE_MS` (120 s), so the report keeps its
cadence and the read side has to become cheaper instead.

### 5. A permanently stranded receipt image in a node the backup reads in full every night

`moveLegacyVoucherReceipts` copies each voucher's old inline `receiptImg` to
`/pettyCashReceipts/{id}`, reads it back to prove the copy is identical, and only then clears
the inline copy. It refused to touch any image at or over 1,500,000 characters:

```js
if (!LEGACY_RECEIPT_PATTERN.test(image) || image.length >= 1500000) { kept.push(id); continue; }
```

That ceiling is below what the portal can actually store. `decodePaymentProof` accepts proofs
up to `MAX_PROOF_BYTES` (5 MB) and browsers compress to roughly 1.3 MB — whose base64 form is
about 1.73 M characters. So the **largest** receipts were exactly the ones that could never be
moved, and `/pettyCashVouchers` is not in the backup's tracked-path list: it is read **in full
by every nightly backup**, so one stranded image is re-downloaded at its own size every night,
for ever, and is also downloaded by every browser that attaches the `petty` or `purchases`
scope (the `purchases` tab is a POS page).

The ceiling is now above anything the upload path can produce, and `jpg` is accepted because
that is what the portal's own proof decoder accepts. Nothing is skipped for being large; an
inline copy that cannot be *verified* is still kept, exactly as before.

## What was checked on the server side and found already sound

The audit also walked every Cloud Function read, since server SDK reads are billed downloads
too. These were verified, not assumed:

- **The nightly backup is already incremental.** `BackupDelta` copies the large history nodes
  from the previous verified backup file and takes only the records a write trigger marked
  dirty; one rotating ~2 MB key-range slice is re-read each night to catch a missed marker. A
  full read of everything happens only when the previous file is missing, invalid or older than
  eight days. The file header records why: the full read was 13 MB on 15 Sep 2026 and growing
  ~0.3 MB/day.
- **Every `orderByChild` in the bundle is backed by an `.indexOn`.** Without the index the
  Admin SDK downloads the whole node and filters in memory, so this is a silent multiplier on
  every query. Checked mechanically against `database.rules.json`.
- **No scheduled job reads a growing node whole.** `autoCompleteReadyOnlineOrders` (15 min)
  reads `/activeOrders` filtered by status with `limitToLast(250)`; `pruneEphemeralNodes`
  (daily) reads only the nodes it exists to prune; `evaluateProductionHealth` (hourly) reads
  four single records.
- **`/posDeviceHealth` write cadence is unchanged.** `verifyShiftCloseReadiness` rejects a
  device whose `lastContactAt` is older than `POS_HEALTH_MAX_AGE_MS` (120 s), so the 60-second
  report is needed and the read side is what was made cheaper.

## What changed

| Area | Change |
| --- | --- |
| `assets/js/admin/realtime-hub.mjs` | New `GROWING_PATHS` list: growing nodes attach per child (`onChildAdded/Changed/Removed`) instead of a whole-node `onValue`, so one write no longer makes every consumer rebuild the whole node. A dynamic child matches its first path segment, so `posDeviceHealth/<shiftId>` and `staffReceiptIndex/<uid>` inherit the policy. `reservations` is deliberately excluded — its page detects new bookings by diffing the previous key list, and per-child delivery would report every already-open booking as fresh (that regression was found and fixed during this pass). |
| `assets/js/admin/realtime-hub.mjs` | New `WINDOWED_PATHS`: `staffMessages` is read through `orderByChild('createdAt').startAt(now − 30 days)`, the same 30 days the server stamps as `expiresAt`, and then kept live per child. |
| `assets/js/admin/staff-inbox.js` | Reads the windowed message list and the reader's **own** receipt index. A one-time bridge reads the legacy receipt for each still-active message (a single record each, never the node) and publishes the index, so nobody loses their read state. |
| `src/functions/20-portal-auth.js` | `manageStaffMessage` maintains `staffReceiptIndex/<uid>/<messageId>` alongside the existing per-message receipt, which remains the audit record. |
| `database.rules.json` | `staffReceiptIndex/$uid` is readable and writable only by that signed-in user. |
| `assets/js/books/suspense-advance.mjs` | Whole-node listener removed; no browser read of the node at all. |
| `src/books/app/30-statements-pages.js` | The conversion action tests `!e.supplierAdvanceConversionId` on the journal entry it already holds. |
| `assets/js/books/live-pos.mjs` | `toEntries()` carries `supplierAdvanceConversionId` onto the journal entry. |
| `tests/client-download-guard-check.mjs` | Now scans **all 135 browser files** (built bundles excluded because the drift check proves they match `src/`), validates **every** `.subscribe('…')` call site against a bound / incremental attach / documented reason, and adds behavioural checks that the audited paths attach per child rather than whole-node. |
| `src/functions/21b-supplier-advance-receipts.js` | Legacy receipt ceiling raised above what the upload path can store, and `jpg` accepted; a large inline receipt can now move out of the node the backup reads in full every night. |
| `tests/download-bounded-reads-check.mjs` | Regression case for that ceiling: a 1.6 M-character receipt must move, not be stranded. |
| `tests/download-attach-cost-check.mjs` | New. Runs the real hub against a byte-measuring database and reports what one client session pays to attach. |

## Measured effect

`node tests/download-attach-cost-check.mjs` — one session, against a fixture holding a year of
messages (520), the receipts for each of them across 6 staff members, and 240 conversions:

```
Attach cost for one client session (bytes downloaded):
  Staff Inbox messages             340837 ->   81222  62 of 520 messages are inside the 30-day window
  Staff receipts (shared node)     349961 ->   63441  own index instead of every staff member's
  Suspense conversions             106381 ->       0  read from the journal entry instead
  Device health (one shift)           469 ->     469  scoped to the open shift
  TOTAL                            797648 ->  145132  81.8% less
```

These are **per session**. The Staff Inbox is loaded by every POS terminal and every admin
session, so the saving repeats for each one, all day. Counts are conservative: the meter
charges a `get()` and a listen separately and de-duplicates listeners that share one query,
the way the SDK does.

**What those numbers are, and are not.** They are the bytes this session's *listeners
download*, measured by the meter in `tests/helpers/fake-rtdb.mjs`. The three that carry the
saving are proven of their kind: a 30-day window instead of every message ever sent, one
user's index instead of every staff member's, and no read at all where the journal already
carries the answer. The fourth row is unchanged on purpose.

They are **not** the same as the console's Downloads figure, and this document does not claim
they are: the meter does not model WebSocket framing, TLS, connection setup, or reconnects,
and it cannot see the bytes the SDK already avoids by sending deltas. Treat 81.8% as the
portion of this session's attach payload that was genuinely unnecessary, and read the console
bar for the effect on the bill.

## Reading the console before and after

Firebase console → **Realtime Database → Usage**. Two numbers matter:

- **Downloads** — the billed one, and the one this audit attacks. Compare the 24-hour bar
  before and after this release. The allowance is a monthly 10 GB that the console expresses
  as roughly 360 MB/day, so a flat daily bar anywhere near that means something is re-reading
  a growing node; a bar that steps up only on days the shop is busy points at a per-write cost.
- **Connections** — each connection is billed for its setup and its TLS handshake (about 3.5 KB
  each), so a device that reconnects repeatedly pays even when it reads nothing. A high
  connection count with a modest download figure means the leak is churn, not payload.

Also worth knowing when reading any other figure: the console's own reads are billed, and
**operations denied by the security rules are billed too**. A sign-in that starts listeners
before the token is ready pays for the rejections.

## What is deliberately left alone

- **`payables` and `receivables`** stay whole-node, but they already attach through `watchMap`
  (per child), so a write costs one bill rather than the whole ledger. `payables` is about
  12 KB; bounding it to open bills only would change supplier-ledger history and is a
  financial-correctness decision, not a bandwidth one. Recorded as a follow-up, not done.
- **`reservations`** stays whole-node for the reason above; it holds only still-open bookings
  because archived ones move to `archivedReservations`.
- **`/posDeviceHealth` write cadence** is unchanged at 60 s. Slowing it risks blocking shift
  close inside the 120 s freshness window. The read side is what became cheaper.
- **Menu/recipe/SKU/price configuration** is still read whole. It is configuration, not
  history, and the versioned master cache already avoids re-reading it.

## Verification

```
npm test           # 292 PASS, exit 0
npm run test:release
npm run test:safety
```

`npm run test:rules` needs the Firebase emulator CLI, which is not installed in this
sandbox — it runs in CI. Coverage for the new node was added to
`tests/rules-ownership-check.mjs`: the owner can read and seed `staffReceiptIndex/owner`,
and cannot read another user's index, while no browser can write `staffMessages` or
`staffMessageReceipts`.

Builds bumped: **admin 538**, **books 121**, service-worker cache **v516**
(`admin.html`, `src/html/admin/*`, `books.html`, `build-version.json`, `release-manifest.json`,
`sw.js`, and the admin module graph's `?v=` import tags).

## State of this work

**Local only.** Nothing has been committed, pushed or deployed. The changes sit in the Arena
workspace on branch `arena/01a0aaf3-accaza-sartoga`, so they are not on your PC yet and not on
`main`. `npm test`, `npm run test:release` and `npm run test:safety` all pass here
(292 PASS). `npm run test:rules` needs the Firebase emulator CLI, which only CI has.

Say **"push it"** and I will commit these files, push the branch and open a pull request. After
that PR merges, GitHub Actions deploys Functions and rules and GitHub Pages publishes the
static files — no manual deploy step.

```powershell
Set-Location -LiteralPath "C:\AKALIKO\DMM\PERSONAL\CLAUDE\Projects\Accaza Coffee Shop"

# After the branch is pushed: bring the work to this PC and verify it here.
git fetch origin --prune
git switch arena/01a0aaf3-accaza-sartoga
npm install
npm ci --prefix functions
npm test
npm run test:release
npm run test:safety
npm run test:download-guards

# Read the measured saving for yourself (one client session, before and after).
node tests/download-attach-cost-check.mjs

# After the pull request is merged to main, watch the two workflows, then confirm the
# visible builds on production match this release: admin 538, Books 121, cache v516.
gh run list --branch main --limit 4
gh run watch
gh pr view --web
```

Once production serves admin **538** / Books **121**, hard-refresh every terminal and phone
that uses the portal with **Ctrl + Shift + R** so the new service worker (cache v516) replaces
the old one. The saving is only realised on clients that actually pick up the new build — a
stale service worker keeps re-downloading the old shapes.

Then open Firebase console → **Realtime Database → Usage** and compare the **Downloads** bar
for the next 24 hours against the days before this release. That bar is the number this whole
audit was aimed at; nothing here is a substitute for reading it.
