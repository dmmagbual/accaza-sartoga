/* Supplier master maintenance — pure helpers, no Firebase.
   Every place a supplier id is stored and still drives behaviour. financialMovements is
   deliberately NOT in this list: the ledger is immutable and keeps the supplier id and the
   supplier name exactly as posted, which is the audit trail. A movement can only carry a
   supplier id if one of the operational records below created it, so this list is also the
   safety check for deleting a record. Register advances live inside shifts/<id>/payOuts/<id>. */
const REFERENCE_COLLECTIONS = ["purchaseInvoices", "payables", "pettyCashVouchers", "stockReceipts", "inventoryBatch", "inventorySku"];

function sameSupplier(row, supplierId) {
  return !!row && String(row.supplierId || "") === String(supplierId || "") && String(supplierId || "") !== "";
}

/* collections: {purchaseInvoices:{id:row}, ..., shifts:{id:{payOuts:{id:row}}}} */
function collectReferences(collections, supplierId) {
  const source = collections || {}, hits = {};
  REFERENCE_COLLECTIONS.forEach((name) => {
    const rows = source[name] || {};
    hits[name] = Object.keys(rows).filter((key) => sameSupplier(rows[key], supplierId));
  });
  hits.shiftAdvances = [];
  const shifts = source.shifts || {};
  Object.keys(shifts).forEach((shiftId) => {
    const payOuts = (shifts[shiftId] || {}).payOuts || {};
    Object.keys(payOuts).forEach((payOutId) => {
      if (sameSupplier(payOuts[payOutId], supplierId)) hits.shiftAdvances.push(`${shiftId}/${payOutId}`);
    });
  });
  hits.total = Object.keys(hits).reduce((sum, key) => sum + (Array.isArray(hits[key]) ? hits[key].length : 0), 0);
  return hits;
}

/* The live link moves to the surviving master. The supplier NAME already written on each
   historical document is not touched, so a purchase still prints the name it was received
   under, and no cash, inventory quantity, subledger balance or journal amount moves. */
function planMergeWrites(hits, targetId) {
  const writes = {};
  REFERENCE_COLLECTIONS.forEach((name) => {
    (hits[name] || []).forEach((id) => { writes[`${name}/${id}/supplierId`] = targetId; });
  });
  (hits.shiftAdvances || []).forEach((path) => { writes[`shifts/${path}/supplierId`] = targetId; });
  return writes;
}

function referenceSummary(hits) {
  return Object.keys(hits || {})
    .filter((key) => Array.isArray(hits[key]) && hits[key].length)
    .map((key) => `${key} (${hits[key].length})`)
    .join(", ");
}

module.exports = {REFERENCE_COLLECTIONS, collectReferences, planMergeWrites, referenceSummary};
