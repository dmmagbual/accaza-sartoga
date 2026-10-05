// Single source of truth for every JavaScript byte budget (Sep 2026). The Phase 11 budget check
// and the Phase 6 / Phase 4C static guards all read these ceilings, so one file can never carry
// two different limits again.
// Budget policy (Sep 2026). A ceiling is a growth-review gate, not a measured device limit.
// When a bundle is re-baselined its ceiling is set about 5% above the reviewed size (rounded
// up to 100 bytes), so ordinary feature work does not stop a release. Once less than 2.5% of
// a ceiling is left, every run prints a warning (and annotates the GitHub check) so the bundle
// is split or its ceiling re-reviewed before it blocks. Ceilings are never raised automatically.
// A hard reserve is protected capacity inside a ceiling. Normal growth fails at the usable
// limit (ceiling minus reserve), so the reserve cannot be silently consumed by feature work.
export const BUDGET_WARN_ROOM=0.025;
export const usableBudget=(maximum,reserve=0)=>maximum-reserve;
export const budgetState=(bytes,maximum,reserve=0)=>{
  const usable=usableBudget(maximum,reserve);
  return bytes>usable?'fail':usable-bytes<usable*BUDGET_WARN_ROOM?'warn':'ok';
};
export const BUNDLE_HARD_RESERVES=Object.freeze({
  // POS is the shop's lifeline. Keep 50 KB inaccessible to ordinary feature growth so a
  // release cannot use the last reviewed capacity before the module is split or re-assessed.
  'assets/js/admin/pos.js':50000
});
export const BUNDLE_BUDGETS=Object.freeze({
  // Also enforced by the Phase 6 customer-runtime guard in tests/static/10-syntax-rendering.mjs.
  // Sep 2026 re-baseline under the budget policy: reviewed 110,089 bytes (customer 85).
  // Oct 2026 (customer 96): the help chat moved to customer/chatbot.mjs (115,002 -> ~109,750 bytes).
  'assets/js/customer/core.mjs':115600,
  // Also enforced by the Phase 4C core guard in tests/static/30-server-release.mjs (formerly a
  // separate, tighter 126,000 ceiling). Sep 2026 re-baseline: reviewed 120,880 bytes (admin 611).
  // Oct 2026 (admin 646): Order Archive panel moved to order-archive-panel.mjs and 109 garbled
  // (double-encoded) characters repaired, 126,976 -> ~121,970 bytes. Ceiling unchanged.
  'assets/js/admin/core.mjs':127000,
  // Build 491 adds stock-item archiving: a retire path for ledger items that cannot be deleted,
  // with the guards, pickers and filter that go with it.
  // Per-item pastry packaging overrides (Customize/Edit/Revert) add ~11.6 KB: private
  // packagingRules/item_<key> drafts, their editor, and Menu applicability wiring.
  // Build 498 adds completed-sale item correction before preparation: corrected-cart
  // checkout, server repricing, cash-refund controls, immutable inventory replacement,
  // linked receipt/audit evidence and explicit cashier feedback.
  // Keep the ceiling narrowly above the reviewed generated bundle.
  // Build 542 adds controlled cash-payment account selection while preserving split-payment routing.
  // Build 580 refreshes IndexedDB immediately before a forced shift-close health report,
  // preventing a stale browser count from blocking a cashier after all sales have synced.
  // Build 582 adds the shift crew till lock (join prompt, seller stamp on each sale).
  // Sep 2026 re-baseline under the budget policy above: reviewed 526,141 bytes (admin 611).
  // Build 615 (+23.0 KB, 526.3 -> 549.3 KB) adds the serving queue: left queue column, preparation
  // controls, Bar view, not-collected review and the close-of-shift review. The 2.5%
  // warning fired at 552,500; re-baselined under the budget policy to ~5% above the reviewed size.
  // Oct 2026 lifeline safeguard: reviewed at 575,062 bytes. The 650 KB envelope includes the
  // protected 50 KB reserve above, giving normal releases a 600 KB hard limit and 24,938 bytes
  // of usable growth at review time. Changing the reserve requires an explicit test update.
  // Oct 2026 (admin 647): unreachable code from the Recipes screens retired on 6 Sep (option
  // library, repair & restore incl. the COGS correction, consumables) and the Receive Stock and
  // brand-breakdown dialogs was deleted, 584,513 -> 527,670 bytes. Ceiling and reserve unchanged.
  'assets/js/admin/pos.js':650000,
  // Build 497 adds the visible cash-refund tag and preserved refund detail to shift reports.
  // +1.4 KB (Sep 2026): receipt images load on demand from pettyCashReceipts instead of riding
  // on every voucher in the Petty/Purchases listeners.
  // Build 540 adds the Cash Payments funding-account loading guard and in-place refresh.
  // Build 542 adds six server-validated cash-payment treatments and their audit fields.
  // Build 580 adds cashier handover and the bounded management recovery dialog.
  // Build 582 adds the shift crew panel, refused-sale recovery screen and per-seller Z lines.
  // Build 589 (+6.9 KB, 208.3 -> 215.1 KB): shift close no longer fails on a tablet blip; it waits,
  // retries once, tags the failed step, shows the server's automatic Z report and an in-page Z fallback.
  // Build 590 (+6.6 KB): every close ends with a Z report - provisional/exception/amended Z
  // rendering, the till-built provisional Z, and management follow-ups.
  // Build 596 (+3.4 KB, 220.0 -> 223.3 KB) replaces the dense payment-method form with
  // accessible summary cards and progressive configuration; no data read or listener is added.
  // Sep 2026 re-baseline under the budget policy above: reviewed 223,322 bytes (admin 611).
  // 30 Sep 2026 (+14.9 KB, 225.1 -> 240.0 KB) adds the Rewards stamps card to POS Settings:
  // the stamp list, the add/edit form and the fixed six-colour picker. It is config-only --
  // no listener and no loyalty history read -- and rides the already lazy-loaded register
  // bundle. Re-baselined under the budget policy to ~5% above the reviewed 240,003 bytes.
  // Sep 2026 re-baseline under the budget policy above: reviewed 223,322 bytes (admin 611).
// Oct 2026 (+25.5 KB, 240.0 -> 265.5 KB) adds BIR tax compliance: the dedicated Tax
// Compliance tab (VAT / percentage tax card with the BIR requirement checklist), the
// Company Information tab, and one-click quarterly 2550Q/2551Q return preparation with
// the annual accountant export. One-shot reads only (taxSettings, companyInfo,
// taxReturns history); no standing listener. Re-baselined under the budget policy to
// ~5% above the reviewed 265,488 bytes.
'assets/js/admin/register.js':278800,
  // Build 527 secures completed-sale corrections while retaining the sales reconciliation bridge;
  // retain a narrow ceiling above the reviewed generated bundle.
  // Build 533 replaces Stock Value's whole-journal listener with monthly totals plus the
  // current month (about 0.4 KB of loader code in exchange for ~0.5 MB per tab open).
  // Build 547 decouples the opening-balance and gain/loss reconciliation buttons so each
  // gates on its own server precondition instead of a shared check that silently re-hid
  // the opening-balance repost whenever 1290 carried a balance (regression of PR #171).
  // Build 566 keeps compact, validated monthly summaries before reporting.
  // summaries and a bounded live-order merge. The extra renderer code prevents an
  // unbounded historical download and stays under this reviewed narrow ceiling.
  // Build 569 adds weekly, peak-hour, and menu-level drink views from the same
  // compact summaries, replacing the obsolete renderer without raw-order reads.
  // Build 574 adds MTD/YTD cashier, weekday and peak-hour rendering on the
  // bounded monthly summary. The module remains lazy-loaded under Analytics.
  // Build 580 adds source-coverage gating plus the compact Top drinks panel and
  // in-cell comparison bars; it does not add any historical-order download.
  // Build 585 adds the reviewed MTD/YTD cashier pies, Top 12 grid, dual thin
  // peak-hour bars and weekday trend lines without adding another data read.
  // Reviewed generated size: 180,306 bytes; the module remains Analytics-only.
  // Sep 2026 re-baseline under the budget policy above: reviewed 180,598 bytes (admin 611).
  // Oct 2026 (admin 646): Daily Report print view and Excel export moved to
  // daily-report-output.mjs, 187,556 -> 177,411 bytes. Ceiling unchanged.
  'assets/js/admin/analytics.js':189700,
  'assets/js/admin/finance.js':75000,
  // Build 106 adds consistent interactive feedback to Finance Books buttons.
  // Build 110 adds only the AP-page hooks; its 6 KB form remains isolated below.
  // Build 115 adds supplier-advance details for account 1115.
  // Build 115 generated bundle is 205,505 bytes after the account-1115 drilldown;
  // retain a narrow ceiling so future Finance Books growth requires review.
  // Build 119 adds supplier-level AP balances, invoice payment history and bounded
  // partial-payment controls without adding another Firebase listener.
  // Books 124 adds the read-only original-journal viewer to every subsidiary
  // ledger row, exposing both entry legs without any additional Firebase read.
  // Sep 2026 re-baseline under the budget policy above: reviewed 223,307 bytes (books 132).
  'assets/js/books/app.js':234500,
  // Build 110 isolates the owner-only supplier AP cutover form from the core Books bundle.
  'src/books/opening-payables.js':7500
});
