
// Read-only audit registers (5 Nov 2026). The menu price history (audit R-09) and the cancelled
// invoice numbers (audit C-17) are written by the server only and are not readable by any client;
// this callable is the one way to view them. It reads and returns; it never writes.
const AUDIT_REGISTER_LIMIT = 300;
const PRICE_FIELD_LABELS = {price: "Price", priceS: "Small / first option", priceM: "Medium", priceL: "Large / second option"};
async function auditRegisterNames(db, uids) {
  const names = {};
  await Promise.all([...new Set(uids.filter(Boolean))].slice(0, 40).map(async (uid) => {
    try { const raw = (await db.ref(`/admins/${uid}`).get()).val(); names[uid] = financeText(raw && typeof raw === "object" && (raw.name || raw.displayName || raw.email) || "", 120) || null; } catch (ignored) { names[uid] = null; }
  }));
  return names;
}
async function readMenuPriceHistory(db, itemId) {
  const id = financeText(itemId, 120);
  if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpsError("invalid-argument", "Unknown menu item.");
  // The whole register is one row per saved price edit (not per sale), so it grows with menu edits only.
  const snap = id ? await db.ref(`/menuPriceHistory/${id}`).get() : /* download-ok: catalog menu price edits; grows only when a price is saved, never with sales */await db.ref("/menuPriceHistory").get();
  const tree = id ? {[id]: snap.val() || {}} : snap.val() || {}, rows = [];
  Object.keys(tree).forEach((itemKey) => Object.values(tree[itemKey] || {}).forEach((r) => {
    if (!r || typeof r !== "object") return;
    Object.keys(r.fields || {}).forEach((field) => {
      const change = r.fields[field] || {};
      rows.push({itemId: itemKey, name: financeText(r.name, 120), field, fieldLabel: PRICE_FIELD_LABELS[field] || financeText(field, 40), from: change.from == null ? null : change.from, to: change.to == null ? null : change.to, at: Number(r.at) || 0, byUid: r.byUid || null, removed: r.removed === true});
    });
  }));
  rows.sort((a, b) => b.at - a.at || String(a.itemId).localeCompare(String(b.itemId)));
  const list = rows.slice(0, AUDIT_REGISTER_LIMIT), names = await auditRegisterNames(db, list.map((row) => row.byUid));
  list.forEach((row) => { row.byName = row.byUid ? names[row.byUid] || null : null; });
  return {rows: list, total: rows.length, truncated: rows.length > AUDIT_REGISTER_LIMIT, limit: AUDIT_REGISTER_LIMIT};
}
async function readCancelledInvoices(db) {
  const snap = await db.ref("/posInvoiceVoided").orderByChild("at").limitToLast(AUDIT_REGISTER_LIMIT + 1).get(), rows = [];
  snap.forEach((child) => { const r = child.val() || {}; rows.push({invoiceNumber: financeText(r.invoiceNumber || child.key, 60), invoiceSeq: Number(r.invoiceSeq) || 0, amount: Math.round(Number(r.amountCents) || 0) / 100, cumulativeGrandTotal: Math.round(Number(r.cumulativeGrandTotalCents) || 0) / 100, sourceId: financeText(r.sourceId, 160), reason: financeText(r.reason, 80), at: Number(r.at) || 0, includedInGrandTotal: r.includedInGrandTotal !== false}); });
  rows.sort((a, b) => b.invoiceSeq - a.invoiceSeq || b.at - a.at);
  return {rows: rows.slice(0, AUDIT_REGISTER_LIMIT), truncated: rows.length > AUDIT_REGISTER_LIMIT, limit: AUDIT_REGISTER_LIMIT};
}
exports.getAuditRegisters = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), data = request.data || {}, register = financeText(data.register, 40);
    if (register === "price_history") { await requirePortalPermission(db, request, ["availability"]); return readMenuPriceHistory(db, data.itemId); }
    if (register === "cancelled_invoices") { await requirePortalPermission(db, request, ["taxcompliance"]); return readCancelledInvoices(db); }
    throw new HttpsError("invalid-argument", "Unknown audit register.");
  },
);
