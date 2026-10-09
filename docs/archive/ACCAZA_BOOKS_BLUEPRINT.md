# Accaza Books — Architecture Blueprint

**Status:** agreed design, pre-build · **Updated:** 22 Aug 2026
**Apps:** `index.html` (customer) · `admin.html` (POS/operations) · **`books.html` (finance — new)**

---

## 1. Core principle

**One server-authoritative ledger. Two front-ends. No copies, no sync.**

There is a single shared database (the existing Firebase project) and one set of Cloud Functions. The POS/admin and Accaza Books are two windows onto the *same* data. "Moving X to finance" never means duplicating data into a second store — it means moving *ownership and the management UI* to finance while the data stays shared. Bidirectional sync between two stores is explicitly rejected (it causes drift and double-posting).

> This supersedes the earlier idea of giving Books its own separate Firebase project. One shared project is required for "finance is the source, admin reflects it live."

Two systems, one truth:
- **Operational system (POS/admin):** runs the store — sells, consumes stock, takes cash, receives online orders. Reads live inventory.
- **System of record (Books/finance):** owns the money records and all reporting — AR, AP, purchases, inventory valuation, P&L, cash flow, balance sheet.

Flow is one-directional: **operational events → shared ledger → finance owns the record.** Admin reflects finance live; never the reverse.

---

## 2. Domain ownership

| Concern | Owner | Notes |
|---|---|---|
| Sales, taking cash | Operations | POS, real-time, offline-capable |
| Inventory **out** (consumption on sale) | Operations | POS deducts stock + posts COGS at weighted-avg cost, offline |
| Inventory **in** (receiving / purchase) | **Finance** | Back-office; creates payable + sets WAC; not time-critical |
| Purchases (supplier invoices) | **Finance** | Subledger document (see §4) |
| Accounts Payable (pay, age, report) | **Finance** | Ops only *triggers* creation via receiving |
| Accounts Receivable (collect, age, report) | **Finance** | Platform AR auto-created from sales; named-account AR managed in finance |
| Inventory **valuation** + COGS accounting | **Finance** | Same ledger, financial lens |
| P&L, Balance Sheet, Cash Flow, Books of Accounts | **Finance** | Removed from admin |
| Operational sales dashboards (today's take, shift/Z-report) | Operations | Stays in POS — this is *not* the accounting P&L |
| Read-only inventory on-hand view | Operations | So COGS/costing stay visible; cannot receive |

Reversing/correcting a **purchase** stays with whoever owns receiving (finance), because it unwinds inventory too. Reversing a **sale** stays operational.

---

## 3. Subledgers feed the General Ledger

Proper CAS-grade structure: **subledgers hold the detail; the GL is the summary they post into.**

- Subledgers: **Purchases, Sales, AR, AP, Inventory.**
- Each subledger transaction posts a summarized journal entry to the GL and stays linked to it (drill from any GL number back to the source document).
- **Control-account lockdown:** AP (2000), AR (1100/1110), Inventory (12xx) may only be moved by their subledger functions — never by free-form manual journal entries. Manual JEs are reserved for items with no subledger (accruals, depreciation, corrections). This keeps subledger totals tied to GL control accounts.

---

## 4. Purchases (finance subledger)

A purchase is a **source document, not a raw journal entry**, because it carries inventory detail the GL never should.

- **Document fields:** supplier (master record), invoice #, date, due date, line items (SKU, qty, unit cost, tax), totals.
- **Posts:** Dr Inventory (+ recompute weighted-average cost) / Dr Input VAT (only when VAT-activated) / Cr Accounts Payable — plus the inventory-ledger movement.
- Uses the existing server functions (`reconcilePurchasePayable`, `postInventoryMovements`, `managePurchaseCorrection`) — a **UI relocation** from admin, not a backend rebuild.
- The admin "one receiving sheet" is retired from the POS; admin keeps read-only inventory.

---

## 5. AR / AP + aging

- Both are party-based subledgers keyed to supplier/customer master records.
- **Aging reports:** per party, bucketed current / 1–30 / 31–60 / 61–90 / 90+ as of any date, with totals and a net working-capital line.
- Payment **terms** on the master record auto-set due dates (what makes aging honest).
- Platform receivables (Grab/Panda) auto-create from sales and are **not cash until settled** — settlement is the operating cash inflow.

---

## 6. Master data (in Settings)

- **Suppliers:** name, **TIN**, contact, payment terms, default category, opening balance.
- **Customers (AR accounts):** name, **TIN**, contact, terms, opening balance. *Billing accounts* (corporate/catering/wholesale/tabs) — kept separate from the POS loyalty/customer registry; reconcile later only if a named account is both.
- Capture **TIN now** even while Non-VAT — the BIR Summary Lists of Sales/Purchases are keyed by TIN; retrofitting is painful.

---

## 7. Settings tab

Configuration + master-data hub, separate from transaction tabs:
- Business profile (registered name, TIN, RDO, address)
- Tax mode — Non-VAT ⇄ VAT toggle, rates, OR/SI series ("activate when needed")
- Suppliers master · Customers master
- POS→COA account mapping (editable bridge map)
- Opening balances / cutover
- Access — finance vs operations roles (segregation of duties)

Chart of Accounts stays its own top tab (touched often).

---

## 8. BIR-ready (internal / accountant-filed, not accredited CAS)

- **Non-VAT now**, VAT activatable by a Settings toggle — no rebuild.
- CAS-**grade** controls + BIR-format **Books of Accounts** (General Journal, General Ledger, Sales, Purchases, Cash Receipts, Cash Disbursements) + tax worksheets the accountant files.
- Honest scope: the software is *accreditable* (immutable, sequential numbering, audit trail, no delete) but "BIR-approved" is a filing you do, not a code feature.

---

## 9. Statements in Books

- **P&L** (revenue − COGS − opex = net income), vs prior period / budget.
- **Balance Sheet** (Assets = Liabilities + Equity), inventory/AR/AP from subledgers.
- **Cash Flow — direct method**, from the cash ledger (cash in/out classified Operating / Investing / Financing), reconciling to the change in cash + bank + wallet. Platform sales counted as operating cash only at settlement, not at sale.

---

## 10. Controls / non-negotiables

- All ledger writes go through **Cloud Functions** (approvals, idempotency, audit) — Books never writes ledger nodes directly.
- **Append-only**; corrections are reversing entries, never edits/deletes.
- Manager-approval gates travel with the action regardless of which UI.
- **Segregation of duties** — receiving vs payment approval; cashier vs bookkeeper.
- Offline: only the POS is offline-capable; finance actions are online-only.
- **Cutover:** a clean opening-balance snapshot (real cash, open AR, open AP, stock valuation, capital) as of a cutover date — nothing reconciles without it.

---

## 11. Blind-spot register

1. Two masters = corruption → one shared ledger, never sync.
2. Books must never bypass the server functions (would break controls).
3. Control accounts locked from manual JEs (subledger-to-GL integrity).
4. Cutover/opening balances are the #1 migration killer.
5. Auto (bridge) vs manual boundary must be crisp — no double-count.
6. Concurrency across two UIs → locking (as with POS `orderLocks`).
7. Approvals must not be skippable via the second UI.
8. Blast radius — keep the operational path independent of the accounting app.
9. Online-only receiving during an outage (record from invoice later).
10. Append-only + audit must hold in Books too.
11. "Two places to do one thing" — pick which UI owns each action.

---

## 12. Build order

1. **Cash Flow Statement** (Books) — direct method, low-risk, asked for.
2. **AR / AP subledgers + aging** (Books) — read + finance-owned actions via existing functions.
3. **Suppliers / Customers master + Settings tab** (Books).
4. **Purchases subledger** (Books) — posts inventory + payable; relocate receiving.
5. **BIR spine** — Non-VAT/VAT toggle, tax accounts, Books of Accounts + worksheets.
6. **Retire from admin last** — P&L and the receiving sheet, once finance covers them.

Backend already merged/ready: PR #58 POS→journal auto-capture bridge (daily-summary-per-channel + discrete non-sale entries, idempotent, unmapped→Suspense).

---

## 13. Open decisions

- Online-only receiving acceptable? (recommended: yes)
- Purchase *corrections* — finance-owned (touches inventory)? (recommended: yes)
- Opening balance vs strip the demo seed — need real cutover figures to make statements true.
