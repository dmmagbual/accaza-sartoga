
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
function paymentDirectAmount(order) {
  return Financial.money(paymentDirectRows(order).reduce((sum, row) => sum + Financial.money(row.amount), 0));
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
  if (order.shiftId && order.source === "pos") {
    const shiftId = financeKey(order.shiftId, "Shift ID");
    const [crew, owner] = await Promise.all([db.ref(`/shiftCrews/${shiftId}`).get(), db.ref(`/shifts/${shiftId}/accountUid`).get()]);
    Object.keys(crew.val() || {}).forEach((key) => involved.add(String(key)));
    if (owner.val()) involved.add(String(owner.val()));
  }
  const self = involved.has(uid);
  if (self && !PAYMENT_VERIFY_EXEMPT_ROLES.has(role)) throw new HttpsError("permission-denied", "The person who took this sale (its cashier or shift crew) cannot verify or reject its payment. Ask another manager or a super admin.");
  return {selfCheck: self};
}
// "Received into" (like a Xero/QuickBooks deposit account): optional, must be an active cash account.
async function verifiedReceivingAccount(db, data) {
  const chosen = financeText(data && data.receivingAccountId, 160);
  if (!chosen) return "";
  const account = (await db.ref(`/cfAccounts/${financeKey(chosen, "Receiving account")}`).get()).val();
  if (!account || account.active === false) throw new HttpsError("invalid-argument", "Choose an active bank or e-wallet account the money was received into.");
  return chosen;
}
// One idempotent step (QuickBooks bank deposit): whenever a sale's payment is verified and its
// money still sits in 1060, post Dr bank / Cr 1060 on the sale date (today if that month is
// closed). Run by the verify actions and by the posting trigger, so neither the order in which
// they finish nor a failed write can leave a verified payment stuck in 1060.
const VERIFIED_PAYMENT_STATUSES = new Set(["manager_validated", "confirmed"]);
async function withPaymentDecisionLock(db, orderId, actor, work) {
  const id = financeKey(orderId, "Order ID"), ref = db.ref(`/paymentDecisionLocks/${id}`), now = Date.now(), token = crypto.randomBytes(12).toString("hex");
  const claim = await ref.transaction((current) => {
    // Stale only well after the 120s callable timeout, so a slow first decision is never overtaken.
    if (current && Number(current.claimedAt || 0) > now - 300000) return;
    return {token, claimedAt: now, claimedBy: actor.uid, schemaVersion: 1};
  }, undefined, false);
  if (!claim.committed || !claim.snapshot.val() || claim.snapshot.val().token !== token) throw new HttpsError("aborted", "This payment review is already being decided. Refresh and retry.");
  try { return await work(); }
  finally {
    // A failed release must not mask the decision's own error; the lock then expires as stale.
    try { await ref.transaction((current) => current && current.token === token ? null : current, undefined, false); } catch (error) { console.warn("payment decision lock release failed", id, error && error.message); }
  }
}
// What this order still holds in 1060 is the net of ALL its movements (one indexed read), so a
// cashier deposit posted between 29 Oct and the manager-review rule (payver_ Dr bank / Cr 1060)
// is counted and never reported as still open.
async function paymentVerificationOpenAmount(db, id) {
  const snap = await db.ref("/financialMovements").orderByChild("sourceId").equalTo(String(id)).get(), movements = snap.val() || {};
  return {
    movements,
    sale: movements[`sale_${id}`] || null,
    review: movements[`payreview_${id}`] || null,
    deposit: movements[`payver_${id}`] || null,
    clearing: Financial.verificationBalance(Object.keys(movements).map((key) => movements[key])),
  };
}
// Current cashier-manager reviews created before this rule already debited a bank. Preserve the
// immutable sale and move only its electronic receipt back to 1060. Archived reviews are owner-
// accepted as received and are deliberately excluded.
async function prepareActivePaymentReview(db, orderId, actor) {
  const id = financeKey(orderId, "Order ID"), found = await findOrder(db, id), order = found.order;
  if (found.node !== "orders" || order.status === "Archived") throw new HttpsError("failed-precondition", "Archived sales are accepted as received and are not moved back into payment review.");
  if (order.paymentStatus !== "cashier_verified") throw new HttpsError("failed-precondition", "Only a current cashier-verified payment awaiting manager review can be prepared.");
  if (String(order.paymentVerificationPolicy || "cashier_manager") !== "cashier_manager") throw new HttpsError("failed-precondition", "This payment does not use cashier-and-manager verification.");
  if (Financial.money(order.refundAmount) > 0) throw new HttpsError("failed-precondition", "This manager-review sale already has a refund. Verify the actual receipt or use a controlled financial correction; it cannot be moved or rejected automatically without double-reversing revenue.");
  let state = await paymentVerificationOpenAmount(db, id);
  if (!state.sale) {
    const [accountsSnap, taxSnap] = await Promise.all([db.ref("/cfAccounts").get(), db.ref("/taxSettings").get()]);
    await postOrderFinancial(db, order, accountsSnap.val() || {}, {uid: "server", role: "server"}, taxSnap.val() || {});
    state = await paymentVerificationOpenAmount(db, id);
  }
  if (!state.sale) throw new HttpsError("failed-precondition", "The sale has not reached Finance Books yet. Wait for posting and retry.");
  const saleAt = Number(state.sale.occurredAt || order.completedAt || order.timestamp || Date.now()), now = Date.now();
  if (state.clearing > 0) {
    const queue = (await db.ref(`/paymentVerificationQueue/${id}`).get()).val();
    if (!queue) await db.ref().update({[`paymentVerificationQueue/${id}`]: paymentVerificationQueueRow(order, state.clearing, state.review ? `payreview_${id}` : `sale_${id}`, saleAt), [`operationalAudit/${now}_restore_payment_review_queue_${id}`]: operationalAuditRecord("restore_payment_review_queue", "order", id, actor, {amount: state.clearing})});
    return {orderId: id, amount: state.clearing, duplicate: true, alreadyInReview: true};
  }
  if (state.review) return {orderId: id, duplicate: true, alreadyInReview: Financial.verificationClearing(state.review) > 0};
  // Reverse the receipt from wherever it was banked: the earlier cashier deposit when one exists
  // (sale in 1060, then Dr bank / Cr 1060), otherwise the pre-rule sale that debited the bank.
  const movement = Financial.paymentReviewPosting(order, state.deposit || state.sale), open = await periodOpenFor(db, saleAt);
  movement.occurredAt = open ? saleAt : now; if (!open) movement.originalSaleDate = financeDateFromTimestamp(saleAt);
  movement.actorName = financeText(actor.role, 160); movement.reference = id;
  const movementId = `payreview_${id}`, writes = {
    [`paymentVerificationQueue/${id}`]: paymentVerificationQueueRow(order, movement.amount, movementId, saleAt),
    [`orders/${id}/paymentReviewClearing`]: {amount: movement.amount, movementId, preparedAt: now, preparedBy: actor.uid, schemaVersion: 1},
    [`operationalAudit/${now}_prepare_payment_review_${id}`]: operationalAuditRecord("prepare_payment_review", "order", id, actor, {movementId, amount: movement.amount, accounting: "Dr 1060 / Cr originally posted receiving account; archived sales excluded."}),
  };
  addOrderCashWrites(writes, movement, movementId, order, actor);
  const result = await commitFinancial(db, movementId, movement, actor, writes);
  return {orderId: id, amount: movement.amount, duplicate: result.duplicate === true, alreadyInReview: true};
}
async function settleVerifiedPayment(db, orderId, actor) {
  const id = financeKey(orderId, "Order ID");
  let found; try { found = await findOrder(db, id); } catch (error) { return null; }
  const order = found.order;
  if (order.voided === true || !VERIFIED_PAYMENT_STATUSES.has(String(order.paymentStatus || ""))) return null;
  const state = await paymentVerificationOpenAmount(db, id), sale = state.sale, clearing = state.clearing;
  if (!(clearing > 0)) return null;
  // A cashier deposit already used payver_; after review reclassification the manager's deposit
  // is a second, distinct movement. Each ID posts once; the net 1060 balance gates both.
  const movementId = state.deposit ? `payvalid_${id}` : `payver_${id}`;
  if (state.movements[movementId]) return {duplicate: true};
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, saleAt = Number((sale && sale.occurredAt) || order.completedAt || order.timestamp || Date.now());
  const movement = Financial.verificationPosting(order, accounts, {clearing, accountId: financeText(order.paymentReceivingAccountId, 160)});
  const open = await periodOpenFor(db, saleAt), now = Date.now();
  movement.occurredAt = open ? saleAt : now; if (!open) movement.originalSaleDate = financeDateFromTimestamp(saleAt);
  movement.reference = financeText(paymentDirectRows(order).map((row) => row.ref).filter(Boolean).join(", "), 160);
  movement.actorName = financeText(order.managerValidatedName || order.cashierVerifiedRole || actor.role, 160);
  if (order.paymentApprovalId) movement.approvalId = financeText(order.paymentApprovalId, 160);
  const writes = {[`paymentVerificationQueue/${id}`]: null};
  addOrderCashWrites(writes, movement, movementId, order, actor);
  writes[`${found.node}/${id}/paymentVerification`] = {amount: clearing, receivingAccountId: financeText(order.paymentReceivingAccountId, 160) || null, movementId, verifiedAt: now, verifiedBy: financeText(order.managerValidatedBy || order.cashierVerifiedBy, 160), selfCheck: order.paymentSelfCheck === true};
  writes[`operationalAudit/${now}_payment_verified_${id}`] = operationalAuditRecord("verify_payment_posting", "order", id, actor, {movementId, amount: clearing, selfCheck: order.paymentSelfCheck === true, approvalId: order.paymentApprovalId || null});
  return commitFinancial(db, movementId, movement, actor, writes);
}
function paymentNotReceivedReason(data) {
  const code = financeText(data && data.reasonCode, 40), note = financeText(data && data.note, 300);
  if (!PAYMENT_NOT_RECEIVED_REASONS[code]) throw new HttpsError("invalid-argument", "Choose why the payment was not received.");
  if (code === "other" && !note) throw new HttpsError("invalid-argument", "Describe why the payment was not received.");
  return {code, label: PAYMENT_NOT_RECEIVED_REASONS[code], note};
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
  const writes = {...(meta.usedWrites || {}), [`${node}/${id}/unpaidSale`]: unpaidSale, [`paymentVerificationQueue/${id}`]: null,
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
  const posted = await postOrderFinancial(db, o, accounts, actor, taxSettings);
  const now = Date.now(), writes = {[`operationalAudit/${now}_recognize_unverified_sale_${id}`]: operationalAuditRecord("recognize_unverified_sale", "order", id, actor, {node: found.node, saleDate: financeDateFromTimestamp(saleAt), postedOn: open ? "sale_date" : "today"})};
  if (found.node === "archivedOrders") writes[`archivedOrders/${id}/salesRecognizedAt`] = now;
  await db.ref().update(writes);
  return {orderId: id, posted: !posted.skipped, duplicate: posted.duplicate === true, postedOn: open ? "sale_date" : "today"};
}
