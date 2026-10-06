
// AP Integrity Remediation (simple references): a purchase's own short number, PUR-YYYY-NNNN.
// New purchases are numbered at post time (reconcilePurchasePayable, purchase_cash,
// purchase_owner_funded). This Super-Admin tool, run by hand from Finance Books -> Payables,
// numbers purchases created before that, so the Purchases list and Payables stop showing the raw
// internal key. It draws from the same counter as live posting, so every number is unique; run it
// right after deploy, before posting new purchases, for clean chronological order. Idempotent: a
// purchase that already has a number is skipped, and preview allocates nothing (no counter burn).
// Two bounded reads (/purchaseInvoices, /payables) and one write; the number is mirrored onto the
// bill whether it is linked by payableId or back-linked by purchaseInvoiceId.
exports.backfillPurchaseDocumentNumbers = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request);
    if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can number old purchases.");
    const preview = !!(request.data && request.data.preview === true);
    const invoices = (/* download-ok: manual Super-Admin purchase-reference backfill, run by hand from Finance Books */await db.ref("/purchaseInvoices").get()).val() || {};
    const bills = (/* download-ok: manual Super-Admin purchase-reference backfill, mirrors the number onto each linked bill */await db.ref("/payables").get()).val() || {};
    const billByPurchase = {};
    for (const key of Object.keys(bills)) { const pid = financeText(bills[key] && bills[key].purchaseInvoiceId, 160); if (pid && !billByPurchase[pid]) billByPurchase[pid] = key; }
    const ids = Object.keys(invoices).sort((a, b) => (Number(invoices[a] && invoices[a].ts) || 0) - (Number(invoices[b] && invoices[b].ts) || 0) || a.localeCompare(b));
    const writes = {}; let numbered = 0, skipped = 0;
    for (const id of ids) {
      const inv = invoices[id] || {};
      if (financeText(inv.documentNo, 40)) { skipped += 1; continue; }
      if (preview) { numbered += 1; continue; }
      const year = (financeText(financeDate(inv.date), 10) || financeDateFromTimestamp(Number(inv.ts) || Date.now())).slice(0, 4);
      const no = await nextDocumentNumber(db, "PUR", year);
      if (!no) continue;
      writes[`purchaseInvoices/${id}/documentNo`] = no;
      const billKey = billByPurchase[id] || financeText(inv.payableId, 160);
      if (billKey && bills[billKey]) { try { writes[`payables/${financeKey(billKey, "Payable ID")}/documentNo`] = no; } catch (error) { /* skip a malformed legacy payable key */ } }
      numbered += 1;
    }
    if (preview) return {numbered, skipped, preview: true};
    if (Object.keys(writes).length) {
      const now = Date.now();
      writes[`operationalAudit/${now}_purchase_docno_backfill`] = operationalAuditRecord("backfill_purchase_document_numbers", "purchaseInvoice", "backfill", actor, {numbered, skipped});
      await db.ref().update(writes);
    }
    return {numbered, skipped};
  },
);
