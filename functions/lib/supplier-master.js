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

/* Supplier contact and tax details (Oct 2026). The BIR purchase listing needs each
   supplier's registered name, TIN, branch and address, and input VAT is claimable only from
   a VAT-registered supplier, so these live on the one shared master record. Everything is
   optional except that a VAT-registered supplier must carry its TIN. Returns
   {details, errors}; the caller rejects the save on the first error. */
const VAT_STATUSES = ["vat", "non_vat", "unknown"];
const DETAIL_FIELDS = ["registeredName", "tin", "branchCode", "vatStatus", "address", "contactPerson", "phone", "email", "notes"];
const DETAIL_LIMITS = {registeredName: 160, address: 240, contactPerson: 120, phone: 40, email: 120, notes: 300};

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeSupplierDetails(input) {
  const src = input && typeof input === "object" ? input : {}, errors = [];
  let tin = String(src.tin == null ? "" : src.tin).replace(/\D/g, ""), branch = String(src.branchCode == null ? "" : src.branchCode).replace(/\D/g, "");
  // A TIN typed with its branch (123-456-789-000) carries the branch in digits 10 onward.
  // An empty, all-zero or matching branch field gives way to the embedded branch.
  if (tin.length > 9 && (!branch || /^0+$/.test(branch) || branch.padStart(5, "0") === tin.slice(9).padStart(5, "0"))) { branch = tin.slice(9); tin = tin.slice(0, 9); }
  if (tin && (tin.length !== 9 || /^0+$/.test(tin))) errors.push("TIN must be 9 digits (example: 123-456-789).");
  if (branch.length > 5) errors.push("Branch code must be up to 5 digits (head office is 00000).");
  if (!tin && /[1-9]/.test(branch)) errors.push("Enter the TIN before a branch code.");
  const rawVat = String(src.vatStatus == null ? "" : src.vatStatus).trim().toLowerCase(), vatStatus = rawVat || "unknown";
  if (!VAT_STATUSES.includes(vatStatus)) errors.push("VAT status must be VAT-registered, Non-VAT or Unknown.");
  if (vatStatus === "vat" && !tin) errors.push("A VAT-registered supplier needs its TIN; input VAT cannot be claimed without it.");
  const email = cleanText(src.email, DETAIL_LIMITS.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email address is not valid.");
  const phone = cleanText(src.phone, DETAIL_LIMITS.phone);
  if (phone && (!/^[+0-9()\-\s./]+$/.test(phone) || phone.replace(/\D/g, "").length < 7)) errors.push("Phone number must contain at least 7 digits.");
  const details = {
    registeredName: cleanText(src.registeredName, DETAIL_LIMITS.registeredName),
    tin, branchCode: tin ? branch.padStart(5, "0") : "",
    vatStatus: VAT_STATUSES.includes(vatStatus) ? vatStatus : "unknown",
    address: cleanText(src.address, DETAIL_LIMITS.address),
    contactPerson: cleanText(src.contactPerson, DETAIL_LIMITS.contactPerson),
    phone, email,
    notes: cleanText(src.notes, DETAIL_LIMITS.notes),
  };
  return {details, errors};
}

function pickDetails(row) {
  const src = row || {}, out = {};
  DETAIL_FIELDS.forEach((field) => { out[field] = String(src[field] == null ? "" : src[field]); });
  if (!out.vatStatus) out.vatStatus = "unknown";
  return out;
}

/* {field: {before, after}} for every detail that changed — the audit-trail entry. */
function changedDetails(before, after) {
  const a = pickDetails(before), b = pickDetails(after), changes = {};
  DETAIL_FIELDS.forEach((field) => { if (a[field] !== b[field]) changes[field] = {before: a[field], after: b[field]}; });
  return changes;
}

/* One supplier per TIN + branch: the index key, empty when there is no TIN. */
function taxIdKey(tin, branchCode) {
  const t = String(tin || "").replace(/\D/g, "");
  return t ? `${t}_${String(branchCode || "").replace(/\D/g, "").padStart(5, "0")}` : "";
}

function formatTin(tin, branchCode) {
  const t = String(tin || "").replace(/\D/g, "");
  if (t.length !== 9) return "";
  return `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6, 9)}-${String(branchCode || "").replace(/\D/g, "").padStart(5, "0")}`;
}

module.exports = {REFERENCE_COLLECTIONS, collectReferences, planMergeWrites, referenceSummary,
  VAT_STATUSES, DETAIL_FIELDS, DETAIL_LIMITS, normalizeSupplierDetails, pickDetails, changedDetails, taxIdKey, formatTin};
