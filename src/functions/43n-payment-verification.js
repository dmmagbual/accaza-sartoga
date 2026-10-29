
// ---------------------------------------------------------------------------
// Payments awaiting verification (Danilo, 29 Oct 2026). A sale is a sale: a POS sale posts to
// Finance Books when it is captured, and an electronic payment a manager has not verified yet
// is debited to 1060 Payments Awaiting Verification instead of the bank. Each such sale has one
// row in /paymentVerificationQueue (live or archived orders alike) until a manager either
// verifies it (Dr bank, Cr 1060 on the sale date) or records it as not received (the sale is
// reversed like a credit note and its cost moves to 6120 Unpaid Sales Loss).
// ---------------------------------------------------------------------------
const PAYMENT_VERIFY_EXEMPT_ROLES = new Set(["superadmin", "owner"]);
const PAYMENT_NOT_RECEIVED_REASONS = {
  no_transfer_found: "No matching transfer in the receiving account",
  fake_proof: "Payment proof was not genuine",
  customer_left: "Customer left without completing payment",
  other: "Other (see note)",
};
function paymentDirectRows(order) {
  const rows = Array.isArray(order && order.payments) && order.payments.length ? order.payments : [{method: order && order.payment, amount: order && order.total}];
  return rows.filter((row) => String(row && row.method || "").toLowerCase() !== "cash");
}
function paymentVerificationQueueRow(order, clearing, movementId, occurredAt) {
  const direct = paymentDirectRows(order), saleAt = Number(occurredAt || order.completedAt || order.receivedAt || order.timestamp || Date.now());
  return {
    orderId: String(order.id), amount: Financial.money(clearing), total: Financial.money(order.total), saleAt, saleDate: financeDateFromTimestamp(saleAt),
    customer: financeText(order.name || "Walk-in", 120), staff: financeText(order.staff || order.onDuty || "", 120), shiftId: financeText(order.shiftId || "", 160) || null,
    channel: financeText(String(order.channel || "instore").toLowerCase(), 40), methods: direct.map((row) => financeText(row.method, 40)).filter(Boolean).join(", "),
    references: direct.map((row) => financeText(row.ref, 120)).filter(Boolean).join(", "), movementId, createdAt: Date.now(), schemaVersion: 1,
  };
}
async function periodOpenFor(db, at) {
  try { await assertAccountingPeriodOpen(db, at, "posting"); return true; } catch (error) { if (error && error.code === "failed-precondition") return false; throw error; }
}
// Separation of duties (Danilo, 29 Oct 2026): whoever took the sale - its cashier, the till login or
// anyone on that shift's crew - cannot verify or reject its payment. A super admin (or the owner)
// always can; that self-check is flagged in the audit trail.
async function paymentVerifierCheck(db, order, verifierUid, verifierRole) {
  const uid = String(verifierUid || ""), role = String(verifierRole || "").toLowerCase();
  if (!uid) throw new HttpsError("failed-precondition", "The verifying manager could not be identified.");
  const involved = new Set([order.syncedByUid, order.cashierUid, order.createdByUid, order.staffUid].filter(Boolean).map(String));
  if (order.shiftId) {
    const shiftId = financeKey(order.shiftId, "Shift ID");
    const [crew, owner] = await Promise.all([db.ref(`/shiftCrews/${shiftId}`).get(), db.ref(`/shifts/${shiftId}/accountUid`).get()]);
    Object.keys(crew.val() || {}).forEach((key) => involved.add(String(key)));
    if (owner.val()) involved.add(String(owner.val()));
  }
  const self = involved.has(uid);
  if (self && !PAYMENT_VERIFY_EXEMPT_ROLES.has(role)) throw new HttpsError("permission-denied", "The person who took this sale (its cashier or shift crew) cannot verify or reject its payment. Ask another manager or a super admin.");
  return {selfCheck: self};
}
// Everything a verification needs is checked before any order or ledger write.
async function preparePaymentVerification(db, order, data) {
  const id = financeKey(order.id, "Order ID"), sale = (await db.ref(`/financialMovements/sale_${id}`).get()).val();
  const clearing = Financial.verificationClearing(sale);
  if (!(clearing > 0)) return null;
  if ((await db.ref(`/financialMovements/payver_${id}`).limitToFirst(1).get()).exists()) return {duplicate: true};
  // "Received into" (like a Xero/QuickBooks deposit account): optional, must be an active cash account.
  const chosen = financeText(data && data.receivingAccountId, 160);
  if (chosen) {const account = (await db.ref(`/cfAccounts/${financeKey(chosen, "Receiving account")}`).get()).val(); if (!account || account.active === false) throw new HttpsError("invalid-argument", "Choose an active bank or e-wallet account the money was received into.");}
  return {id, clearing, accountId: chosen || "", saleAt: Number(sale.occurredAt || order.completedAt || order.timestamp || Date.now())};
}
function paymentNotReceivedReason(data) {
  const code = financeText(data && data.reasonCode, 40), note = financeText(data && data.note, 300);
  if (!PAYMENT_NOT_RECEIVED_REASONS[code]) throw new HttpsError("invalid-argument", "Choose why the payment was not received.");
  if (code === "other" && !note) throw new HttpsError("invalid-argument", "Describe why the payment was not received.");
  return {code, label: PAYMENT_NOT_RECEIVED_REASONS[code], note};
}
async function commitPaymentVerification(db, node, order, plan, actor, meta) {
  if (!plan || plan.duplicate) return plan || null;
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, id = plan.id;
  const movement = Financial.verificationPosting(order, accounts, {clearing: plan.clearing, accountId: plan.accountId});
  const open = await periodOpenFor(db, plan.saleAt), now = Date.now();
  movement.occurredAt = open ? plan.saleAt : now; if (!open) movement.originalSaleDate = financeDateFromTimestamp(plan.saleAt);
  movement.reference = financeText(paymentDirectRows(order).map((row) => row.ref).filter(Boolean).join(", "), 160);
  movement.actorName = financeText(meta.verifierName || actor.role, 160);
  if (meta.approvalId) {movement.approvalId = meta.approvalId; movement.approvedBy = financeText(meta.verifierName, 160);}
  const movementId = `payver_${id}`, writes = {};
  addOrderCashWrites(writes, movement, movementId, order, actor);
  writes[`${node}/${id}/paymentVerification`] = {amount: plan.clearing, receivingAccountId: plan.accountId || null, movementId, verifiedAt: now, verifiedBy: financeText(meta.verifierUid, 160), verifiedRole: financeText(meta.verifierRole, 40), selfCheck: meta.selfCheck === true, approvalId: meta.approvalId || null};
  writes[`paymentVerificationQueue/${id}`] = null;
  writes[`operationalAudit/${now}_payment_verified_${id}`] = operationalAuditRecord("verify_payment_posting", "order", id, actor, {movementId, amount: plan.clearing, selfCheck: meta.selfCheck === true, approvalId: meta.approvalId || null});
  return commitFinancial(db, movementId, movement, actor, writes);
}
// Payment not received: reverse the sale (dated like a void: the sale date when that month is open,
// otherwise today) and move its cost to 6120. Stock stays out.
async function commitUnpaidSale(db, node, order, amount, reason, actor, meta) {
  const id = financeKey(order.id, "Order ID"), movementId = `unpaid_${id}`;
  if ((await db.ref(`/financialMovements/${movementId}`).limitToFirst(1).get()).exists()) return {duplicate: true};
  const sale = (await db.ref(`/financialMovements/sale_${id}`).get()).val();
  if (!sale) throw new HttpsError("failed-precondition", "This sale has not been posted to Finance Books yet. Post it first.");
  const saleAt = Number(sale.occurredAt || order.completedAt || order.timestamp || Date.now());
  const [taxSettingsSnap, categoriesSnap] = await Promise.all([db.ref("/taxSettings").get(), db.ref("/posSettings/invCategories").get()]);
  const cogs = await readCatalogKeyed(db, ["inventory"], (maps) => BooksBridge.cogsMovement(order, id, maps.inventory, categoriesSnap.val() || {}));
  const movement = Financial.unpaidSalePosting(order, amount, Financial.effectiveTaxFor(taxSettingsSnap.val() || {}, saleAt), cogs && cogs.lines);
  const open = await periodOpenFor(db, saleAt), now = Date.now();
  movement.occurredAt = open ? saleAt : now; if (!open) movement.originalSaleDate = financeDateFromTimestamp(saleAt);
  movement.reason = financeText(`${reason.label}${reason.note ? ` — ${reason.note}` : ""}`, 400);
  movement.actorName = financeText(meta.verifierName || actor.role, 160);
  if (meta.approvalId) {movement.approvalId = meta.approvalId; movement.approvedBy = financeText(meta.verifierName, 160);}
  const unpaidSale = {amount: Financial.money(amount), reasonCode: reason.code, reason: reason.label, note: reason.note || "", movementId, recordedAt: now, recordedBy: financeText(meta.verifierUid, 160), recordedRole: financeText(meta.verifierRole, 40), approvalId: meta.approvalId || null, costMovedToLoss: movement.costMovedToLoss, selfCheck: meta.selfCheck === true};
  const writes = {[`${node}/${id}/unpaidSale`]: unpaidSale, [`paymentVerificationQueue/${id}`]: null,
    [`operationalAudit/${now}_payment_not_received_${id}`]: operationalAuditRecord("payment_not_received", "order", id, actor, {movementId, amount: unpaidSale.amount, reasonCode: reason.code, approvalId: meta.approvalId || null, selfCheck: meta.selfCheck === true})};
  writes[`${node}/${id}/paymentStatus`] = "not_received";
  return commitFinancial(db, movementId, movement, actor, writes);
}
// Catch-up for completed sales left unposted while their payment was unverified (12 sales,
// 15-19 Aug 2026). Posts on the sale date when that month is open, otherwise today with the
// original date kept on the movement; archived orders are touched so monthly history includes them.
async function recognizeUnverifiedSale(db, found, actor) {
  const o = found.order, id = financeKey(o.id, "Order ID");
  if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only managers may post unverified sales to Finance Books.");
  if (!Financial.recognizedSale(o) || !Financial.paymentAwaitingVerification(o)) throw new HttpsError("failed-precondition", "Only completed sales with an unverified payment are posted here.");
  if ((await db.ref(`/financialMovements/sale_${id}`).limitToFirst(1).get()).exists()) return {orderId: id, duplicate: true};
  const saleAt = Number(o.completedAt || o.receivedAt || o.timestamp || Date.now()), open = await periodOpenFor(db, saleAt);
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, taxSettings = (await db.ref("/taxSettings").get()).val() || {};
  const posted = await postOrderFinancial(db, o, accounts, actor, taxSettings, open ? {} : {occurredAt: Date.now(), originalSaleDate: financeDateFromTimestamp(saleAt)});
  const now = Date.now(), writes = {[`operationalAudit/${now}_recognize_unverified_sale_${id}`]: operationalAuditRecord("recognize_unverified_sale", "order", id, actor, {node: found.node, saleDate: financeDateFromTimestamp(saleAt), postedOn: open ? "sale_date" : "today"})};
  if (found.node === "archivedOrders") writes[`archivedOrders/${id}/salesRecognizedAt`] = now;
  await db.ref().update(writes);
  return {orderId: id, posted: !posted.skipped, duplicate: posted.duplicate === true, postedOn: open ? "sale_date" : "today"};
}
