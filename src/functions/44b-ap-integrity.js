
// AP Integrity Remediation Plan, step 0.3: read-only baseline of existing AP damage.
// Super Admin only, run by hand from Finance Books → Payables → AP integrity check. It reads the
// supplier bills, purchase invoices, purchase stock movements and open cash custody once, and
// writes nothing except one audit row. Findings are corrected later by documented reversals.
exports.apIntegrityBaseline = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request);
    if (actor.role !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can run the AP integrity check.");
    const payables = (/* download-ok: manual Super-Admin AP integrity baseline, run by hand from Finance Books */await db.ref("/payables").get()).val() || {};
    const purchaseInvoices = (/* download-ok: manual Super-Admin AP integrity baseline, run by hand from Finance Books */await db.ref("/purchaseInvoices").get()).val() || {};
    const purchaseMovements = (await db.ref("/inventoryMovements").orderByChild("type").equalTo("purchase").get()).val() || {};
    const custodyRows = Object.assign({}, (await db.ref("/cashCustody").orderByChild("remaining").endAt(-0.005).get()).val() || {}, await openCustodyRows(db)), cash = await currentCashBalances(db), now = Date.now();
    const report = ApIntegrity.buildReport({payables, purchaseInvoices, purchaseMovements, custodyRows, undepositedGl: Number(cash.balances && cash.balances.undepositedCents || 0) / 100, generatedAt: now});
    report.cashBalanceSource = cash.source || "";
    await db.ref(`/operationalAudit/${now}_ap_integrity_baseline`).set(operationalAuditRecord("ap_integrity_baseline", "apIntegrity", "baseline", actor, {counts: report.counts, issues: report.issues, scanned: report.scanned, readOnly: true}));
    return report;
  },
);
