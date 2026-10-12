// Supplier advances inside register shifts (Sep 2026 download audit). Opening a supplier
// ledger used to download every shift (242 KB on 16 Sep, growing daily) to find the few
// pay-outs of type purchase_advance. /supplierAdvanceShifts/{shiftId} = true lists the shifts
// that hold one; onShiftPayOutsFinancial keeps it current for every writer. The first use
// fills it from each shift's payOuts child only. The fill never removes an entry, so it
// cannot undo a concurrent trigger; a stale entry only costs one small payOuts read.
const SUPPLIER_ADVANCE_SHIFT_INDEX_VERSION = 1;

// Fail-closed proof that a supplier advance has its original payment in Finance Books
// (Oct 2026). Every route that CREDITS Supplier Advances (1115) -- applying the advance to a
// purchase, returning the unallocated balance, voiding it -- must first show the debit. Without
// it, Finance Books ends up with a negative Supplier Advances balance that the control audit
// reports as a critical control mismatch, and a purchase looks paid although no posted cash ever
// left. The retired drawer-funded register release is how that happened historically.
//
// Cost: at most three single-record reads. Never a whole-node download, and no new listener.
// The remedy named in the error is the audited backfill, not a manual journal: 1115 refuses
// manual journals by design.
async function requireSupplierAdvancePosting(db, advanceId, options) {
  const ids = SupplierAdvancePosting.candidateMovementIds(advanceId, options);
  const entries = await Promise.all(ids.map(async (movementId) => [movementId, (await db.ref(`/financialMovements/${movementId}`).get()).val()]));
  const movements = {};
  entries.forEach(([movementId, row]) => { if (row) movements[movementId] = row; });
  const proof = SupplierAdvancePosting.postingEvidence(advanceId, movements);
  if (!proof) {
    throw new HttpsError("failed-precondition", `Supplier payment ${advanceId} has no original posting in Finance Books, so it cannot be used yet. Post the original payment first: for cash released from the register drawer run Admin > Finance > Cash Flow > "Backfill / verify 3C financial ledger" (idempotent, it posts only what is missing); for a converted or adopted advance whose Finance Books entry is missing or reversed, repair the conversion from Finance Books > the suspense journal > Convert to supplier advance; otherwise record or correct the payment in Admin > Cash Payments. Finance Books refuses a manual journal to Supplier Advances.`);
  }
  return proof;
}

function hasPurchaseAdvancePayOut(payOuts) {
  return Array.isArray(payOuts) && payOuts.some((row) => row && row.type === "purchase_advance");
}
async function ensureSupplierAdvanceShiftIndex(db) {
  const metaRef = db.ref("/supplierAdvanceShiftIndexMeta"), meta = (await metaRef.get()).val() || {};
  if (meta.version === SUPPLIER_ADVANCE_SHIFT_INDEX_VERSION && meta.complete === true) return;
  const ids = await shallowDatabaseKeys(db, "shifts"), writes = {};
  for (let i = 0; i < ids.length; i += 50) {
    await Promise.all(ids.slice(i, i + 50).map(async (shiftId) => {
      if (hasPurchaseAdvancePayOut((await db.ref(`/shifts/${shiftId}/payOuts`).get()).val())) writes[`supplierAdvanceShifts/${shiftId}`] = true;
    }));
  }
  writes.supplierAdvanceShiftIndexMeta = {version: SUPPLIER_ADVANCE_SHIFT_INDEX_VERSION, complete: true, builtAt: Date.now(), shiftsScanned: ids.length};
  await db.ref().update(writes);
}
// {shiftId: payOuts array} for the shifts that hold a purchase advance.
async function supplierAdvanceShiftPayOuts(db) {
  await ensureSupplierAdvanceShiftIndex(db);
  const ids = Object.keys((await db.ref("/supplierAdvanceShifts").get()).val() || {}), out = {};
  await Promise.all(ids.map(async (shiftId) => {
    const payOuts = (await db.ref(`/shifts/${shiftId}/payOuts`).get()).val();
    if (Array.isArray(payOuts)) out[shiftId] = payOuts;
  }));
  return out;
}

// Legacy inline receipt images: vouchers before Sep 2026 kept a 50–70 KB image inside the
// voucher, so every voucher list and supplier-advance lookup downloaded it. Each image is
// copied to /pettyCashReceipts/{id}, read back and compared, and only then removed from the
// voucher, which is marked hasReceipt. Evidence is never dropped: on any mismatch the inline
// copy stays. `vouchers` is the voucher list the caller already holds.
//
// Sep 2026 follow-up: the previous 1.5 MB size ceiling left every larger image inline for
// good -- a browser that compresses to the 5 MB proof ceiling the portal accepts produces a
// base64 string of about 6.7 M characters, and /pettyCashVouchers is still read in full by
// every nightly backup, so one stranded image cost its own size again every night, for ever.
// The ceiling now sits above anything the upload path can store, and "jpg" is accepted
// because that is what the portal's own proof decoder accepts. An inline copy that cannot be
// verified is still kept (see below), but nothing is skipped merely for being large.
const LEGACY_RECEIPT_PATTERN = /^data:image\/(jpeg|jpg|png|webp);base64,/;
const MAX_LEGACY_RECEIPT_CHARS = 8_000_000;
async function moveLegacyVoucherReceipts(db, vouchers, now = Date.now()) {
  const moved = [], kept = [];
  for (const [id, voucher] of Object.entries(vouchers || {})) {
    const image = voucher && voucher.receiptImg;
    if (typeof image !== "string" || !image) continue;
    if (!LEGACY_RECEIPT_PATTERN.test(image) || image.length > MAX_LEGACY_RECEIPT_CHARS) { kept.push(id); continue; }
    const receiptRef = db.ref(`/pettyCashReceipts/${id}`), existing = (await receiptRef.child("meta").get()).val();
    if (existing && Number(existing.bytes) !== image.length) { kept.push(id); continue; }
    if (!existing) await receiptRef.set({meta: {createdAt: Number(voucher.createdAt) || now, bytes: image.length, movedAt: now, source: "legacy_inline"}, image});
    if ((await receiptRef.child("image").get()).val() !== image) { kept.push(id); continue; }
    await db.ref().update({
      [`pettyCashVouchers/${id}/receiptImg`]: null,
      [`pettyCashVouchers/${id}/hasReceipt`]: true,
      [`pettyCashVouchers/${id}/receiptMovedAt`]: now,
      [`operationalAudit/${now}_voucher_receipt_moved_${id}`]: operationalAuditRecord("voucher_receipt_moved", "pettyCashVoucher", id, {uid: "server", role: "server"}, {bytes: image.length, to: `pettyCashReceipts/${id}`}),
    });
    moved.push(id);
  }
  if (moved.length || kept.length) logger.info("Legacy voucher receipts moved", {moved, kept});
  return {moved, kept};
}
async function ensureLegacyVoucherReceiptsMoved(db) {
  const flagRef = db.ref("/systemMaintenance/voucherReceiptsMoved");
  if ((await flagRef.get()).val()) return;
  const result = await moveLegacyVoucherReceipts(db, /* download-ok: migration one-time move of legacy inline receipt images, guarded by systemMaintenance/voucherReceiptsMoved */(await db.ref("/pettyCashVouchers").get()).val() || {});
  await flagRef.set({at: Date.now(), moved: result.moved.length, kept: result.kept});
}

