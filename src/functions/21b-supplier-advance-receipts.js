// Supplier advances inside register shifts (Sep 2026 download audit). Opening a supplier
// ledger used to download every shift (242 KB on 16 Sep, growing daily) to find the few
// pay-outs of type purchase_advance. /supplierAdvanceShifts/{shiftId} = true lists the shifts
// that hold one; onShiftPayOutsFinancial keeps it current for every writer. The first use
// fills it from each shift's payOuts child only. The fill never removes an entry, so it
// cannot undo a concurrent trigger; a stale entry only costs one small payOuts read.
const SUPPLIER_ADVANCE_SHIFT_INDEX_VERSION = 1;
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

