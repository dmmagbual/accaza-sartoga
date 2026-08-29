# Accaza POS + Website — System Review & Blind Spots
_Build v50. Brutal, grounded review of the whole system: customer site (`index.html`), back-office (`admin.html`), and Firebase rules. Ordered by severity._

---

## CRITICAL — security & data integrity

### C1. Any signed-in user can CREATE an order with arbitrary data
Rule: `orders/$oid .write = auth != null && (!data.exists() || admin)`. Customers use anonymous auth, so **any visitor can write a brand-new order node with any fields** — arbitrary `total`, `lineItems`, prices, even `status:"Completed"` or `paymentStatus:"confirmed"`. They can't modify an existing order (good), but creation is wide open.
- **Impact:** spoofed sales in analytics/P&L; if a crafted order lands as `Completed`, the admin-side deduction engine will act on it and move real inventory; junk/huge payloads.
- **Fix:** add `.validate` rules on order creation for non-admins — force `status` to an allowed initial value (e.g. `Pending`), reject `cogsSnapshot`/`inventoryDeducted`/`paymentStatus` on create, cap string lengths, and (ideally) recompute/verify prices admin-side before a customer order is accepted. Prices are currently trusted from the client (`index.html` writes a client-built order object).

### C2. Staff = full database write; the permission tiers are UI-only
Every staff member is a member of `/admins` (as `"staff"`). Almost every rule checks only `root.child('admins').child(auth.uid).exists()` — so **any staff account can write inventory, orders, recipes, discrepancies, petty cash, etc. directly** via the DB, regardless of their `adminPerms` toggles or manager-PIN gates. Only `payment` is gated to the admin *role*.
- **Impact:** `adminPerms`, manager-PIN approvals (void/refund/discount/verify/petty), and "log-only" controls are **speed-bumps, not security** against a technically capable staffer.
- **Fix (choose one):** (a) accept it for a small trusted team and rely on the audit log as deterrence; or (b) move to role-aware rules that block staff from the sensitive nodes/fields. (b) is a meaningful rules rewrite.

### C3. PINs are plaintext and readable by any staff
`posStaff` (cashier + **manager** PINs) is readable by any `/admins` member. A staffer can open the DB and read the manager PIN, defeating every manager-PIN approval.
- **Fix:** store a hash of the PIN (compare hash client-side), or accept that PINs are a convenience control, not a security boundary. At minimum, don't treat manager PIN as protection against insiders.

---

## HIGH — architecture & reliability

### H1. Everything runs client-side; no server authority
Inventory deduction, COGS snapshot, discrepancy creation, and the petty-cash counter all execute **in whoever's browser has the tab open**. Consequences:
- Deduction/snapshot only happen if an admin/POS browser is open running the script. An order completed with no such tab open won't deduct until someone opens it (idempotency saves it later, but timing/cost-snapshot can drift).
- **Multi-device concurrency**: two devices completing/editing at once can race. Idempotency flags guard the worst cases, but this isn't robust.
- **Fix (long-term):** a Firebase **Cloud Function** that owns deduction + COGS on order-completion server-side. This is the single biggest robustness upgrade. Requires the Blaze plan.

### H2. No data archiving / pagination — load grows forever
`admin.html` attaches ~34 live listeners and loads **entire nodes** (`orders`, `archivedOrders`, `activityLog`, `internalUsage`, `discrepancies`, `pettyCashVouchers` with embedded base64 images, etc.). At 680 KB the file is already heavy; data volume will make initial load slower every month.
- **Fix:** archive/retire old records (you already archive orders — extend to activityLog, discrepancies, usage); load recent windows, not all-time; consider moving base64 receipts out of RTDB if petty-cash volume grows.

### H3. No backups
RTDB has no automated export configured. One bad delete/write (or a buggy edit) can lose data with no recovery. The Excel exports are partial, manual snapshots — not a backup.
- **Fix:** enable scheduled RTDB backups (Blaze), or a periodic manual export of the whole database JSON (Firebase console → Export JSON) on a schedule.

### H4. Client clock is the source of truth for time
All timestamps use `Date.now()` (device clock). A wrong tablet clock corrupts `monthKey` (wrong P&L month), shift timing, discrepancy timing, and voucher month/number.
- **Fix:** use Firebase `serverTimestamp()` for record timestamps, or at least validate device time on login.

### H5. No automated tests
Everything is validated with `node --check` (syntax only). Many features share the `computeUsage` deduction engine and the P&L math; a future edit can silently break costing with no signal.
- **Fix:** a small set of functional checks (even manual test scripts) for the deduction/COGS/discount math before each deploy.

---

## MEDIUM — financial & compliance

### M1. Not BIR-compliant
Receipts have no Authority-to-Print, serial range, or official-receipt formatting; the system isn't BIR-accredited. Fine while non-VAT and under ₱3M, but the moment you're inspected or cross the threshold this is exposure. Senior/PWD sales also legally need the OSCA/PWD logbook (name, ID, signature).
- **Fix:** treat current receipts as internal only; if you formalize, budget for a BIR-accredited POS or accreditation of this one. The scoped-discount build already captures ID + name to ease this.

### M2. Float money math
Peso amounts use JS floats; repeated rounding (discounts, allocations, COGS) can drift by centavos over time.
- **Fix:** round consistently at defined points (mostly done); consider integer-centavo math if precision ever bites.

### M3. Single active shift / single register
`posActiveShift` is one record — you can't run two registers/cashiers in parallel. Fine for one store today; a blocker if you add a second till.

### M4. COGS accuracy still depends on unentered data
The engine is built, but COGS/variance/margin are only as true as the per-size gram/ml quantities and unit costs — still largely unentered. Until then, every financial number is an estimate. **This remains your #1 practical gap.**

---

## MEDIUM — UX & operational

### U1. `prompt()`-driven flows
Stock adjust, change PIN, cash in/out, discount ID, void/refund reasons all use browser `prompt()`. On a tablet this is clunky, easy to mistype, and can't validate mid-entry. Works, but not point-of-sale-grade for speed.
- **Fix:** convert the high-frequency ones (adjust, cash out) to small modals like the close-shift counter.

### U2. Manager-PIN fatigue
Void, refund, discount, verify payment, petty approve, cash out, discrepancy review all prompt for a PIN. Real risk: the manager shares the PIN so staff stop interrupting them — which quietly collapses the control (compounded by C3).

### U3. iPad ergonomics
Landscape is fine; some tap targets are small; portrait is cramped (flagged earlier). Fine for careful use.

### U4. Offline mode limits
Cash-only, within an open session, per-browser queue; a hard refresh/close while offline can't reboot (SDK loads from CDN). Acceptable for router blips; not a true offline POS.

---

## WEBSITE-SPECIFIC (index.html)

### W1. Price trust (see C1)
Online orders are written with client-side prices. A tampered client could submit a mispriced or manipulated order; admin sees it as normal. Recompute/verify prices admin-side before accepting.

### W2. Customer status writes may be blocked by rules
The customer "Order Received" path issues an `update` to an existing order; under the current rules only admins can write an existing order, so customer-side status updates likely fail silently. **Verify** the received/confirm flow actually works for a real anonymous customer.

### W3. Anonymous account accumulation
Harmless (confirmed earlier), but the list grows unbounded without Identity Platform cleanup. Cosmetic.

### W4. Old admin code still lives in index.html
The retired admin is hidden via CSS but still shipped in the public file (larger download, and the code is present client-side). Consider stripping it from the public site eventually.

---

## Prioritized recommendations (what I'd actually do, in order)
1. **Tighten order-creation rules (C1)** — add `.validate` so customers can't set status/payment/cogs fields or oversized payloads. Highest risk-to-effort ratio; I can draft the rules now.
2. **Decide the security posture (C2/C3)** — if the team is small and trusted, document that PIN/permissions are deterrence + audit-trail, and lean on the activity log. If not, plan the role-aware rules rewrite.
3. **Turn on backups (H3)** — cheapest insurance against catastrophic loss. Do this week.
4. **Enter real recipe quantities + costs (M4)** — unlocks the entire costing/P&L investment you've already paid for in build time.
5. **Plan a Cloud Function for deduction/COGS (H1)** — the robustness endgame; schedule when you move to Blaze (also enables backups + storage).
6. **Archiving strategy (H2)** — keep the app fast as data grows.
7. **Verify the customer "received" flow (W2)** and price handling (W1).

## What's solid (credit where due)
- Clean separation of customer vs back-office, real Firebase Auth gating the admin.
- Idempotent deduction with reversible voids everywhere (orders, staff/R&D usage, petty vouchers).
- Ledger-based balances (petty cash, variance) — derived, traceable, no silent overwrites.
- Snapshot COGS (no historical drift), four-line P&L, full audit log, denomination counting, discrepancy trail.
- The whole thing is one deployable file with no build step — genuinely easy to ship and roll back.
