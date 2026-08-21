/**
 * Accaza Coffee House — Auto Web-Push (FCM) on order completion
 * Firebase Cloud Functions (2nd gen). FREE: no per-message cost.
 *
 * Trigger: when an order's status changes to "Completed", send a Web Push
 * notification to the customer's installed app (pick-up or delivery message).
 */
const {onValueUpdated, onValueWritten, onValueCreated} = require("firebase-functions/v2/database");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getAuth: getAdminAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");
const {getStorage} = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const crypto = require("node:crypto");
const Costing = require("./lib/costing");
const Financial = require("./lib/financial");
const OfflineSync = require("./lib/offline-sync");
const PaymentVerification = require("./lib/payment-verification");
const OrderStatus = require("./lib/order-status");
const OperationalExceptions = require("./lib/operational-exceptions");

initializeApp();

const SHOP_NAME = "Accaza Coffee House";
const PICKUP_ADDR = "Saratoga Ave, La Mediterranea Subd., Governor's Drive, Dasmarinas";

// Order reference: PREFIX-XXXXXX (6 base36 chars from the timestamp). Online
// orders use the "OO-" prefix; uniqueness is confirmed against /orders below.
function shortRefCode(seed) { return (Number(seed) % 2176782336).toString(36).toUpperCase().padStart(6, "0"); }

exports.notifyOnComplete = onValueUpdated(
  {ref: "/orders/{orderId}/status", region: "asia-southeast1"},
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (after !== "Ready" || before === "Ready") return;

    const orderId = event.params.orderId;
    const db = getDatabase();
    const snap = await db.ref("/orders/" + orderId).get();
    const o = snap.val();
    if (!o) return;
    if (o.pushNotified) return; // never notify twice

    const customerKey = o.ownerUid || String(o.phone || "").replace(/[^0-9]/g, "");
    if (!customerKey) return;
    const tokSnap = await db.ref("/appCustomers/" + customerKey + "/pushToken").get();
    const token = tokSnap.val();
    if (!token) {
      logger.info("No push token for customer; skipping", {orderId, customerKey});
      return;
    }

    const first = (String(o.name || "").trim().split(" ")[0]) || "there";
    const isDelivery = o.type === "Delivery";
    const title = SHOP_NAME;
    const body = isDelivery
      ? `Hi ${first}! Your order #${orderId} is ready for delivery. ` +
        `Kindly let us know once you've booked your preferred delivery/courier service so we can hand it over. Maraming salamat!`
      : `Hi ${first}! Your order #${orderId} is now ready for pick-up. See you soon at ${PICKUP_ADDR}. Thank you!`;

    try {
      await getMessaging().send({
        token: token,
        data: {title: title, body: body, orderId: String(orderId), link: "/"},
        webpush: {headers: {Urgency: "high"}, fcmOptions: {link: "/"}},
      });
      await db.ref("/orders/" + orderId).update({pushNotified: true, pushNotifiedAt: Date.now()});
      logger.info("Push sent", {orderId, customerKey});
    } catch (err) {
      const code = err && err.code;
      logger.error("Push failed", {orderId, code, error: String(err)});
      // Clean up dead tokens so we don't keep retrying a stale device
      if (code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-argument") {
        try { await db.ref("/appCustomers/" + customerKey + "/pushToken").remove(); } catch (e) {}
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Staff web-push: alert all registered staff devices on new online orders and
// new reservations, even when the admin app is closed. Tokens live under
// /staffPushTokens/{uid}; dead tokens are pruned on send.
// ---------------------------------------------------------------------------
async function notifyStaff(db, title, body, link) {
  const snap = await db.ref("/staffPushTokens").get();
  const tokens = snap.val() || {};
  const messaging = getMessaging();
  await Promise.all(Object.keys(tokens).map(async (uid) => {
    const token = tokens[uid] && tokens[uid].token;
    if (!token) return;
    try {
      await messaging.send({
        token,
        data: {title, body, link: link || "/admin.html"},
        webpush: {headers: {Urgency: "high"}, fcmOptions: {link: link || "/admin.html"}},
      });
    } catch (err) {
      const code = err && err.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument") {
        try { await db.ref("/staffPushTokens/" + uid).remove(); } catch (ignored) {}
      }
    }
  }));
}

exports.notifyStaffOnOrder = onValueCreated(
  {ref: "/orders/{orderId}", region: "asia-southeast1"},
  async (event) => {
    const o = event.data.val();
    if (!o || o.source !== "online") return; // POS/platform sales are entered by staff already
    const db = getDatabase();
    const who = String(o.name || "A customer");
    const items = String(o.items || "").slice(0, 80);
    await notifyStaff(db, "🛎️ New online order", `${who} · PHP ${Number(o.total) || 0}${items ? " · " + items : ""}`, "/admin.html");
  },
);

exports.notifyStaffOnReservation = onValueCreated(
  {ref: "/reservations/{resId}", region: "asia-southeast1"},
  async (event) => {
    const r = event.data.val();
    if (!r) return;
    const db = getDatabase();
    await notifyStaff(db, "📅 New reservation", `${String(r.name || "Guest")} · ${String(r.date || "")} ${String(r.time || "")} · ${r.guests || 1} guest(s)`, "/admin.html");
  },
);

// Website contact form: on a new /feedbacks entry of type "Contact", alert staff
// devices via push. The message itself is stored under /feedbacks and shown in the
// admin "Contact Messages" list, so delivery never depends on email.
exports.notifyOnContactMessage = onValueCreated(
  {ref: "/feedbacks/{fbId}", region: "asia-southeast1"},
  async (event) => {
    const f = event.data.val();
    if (!f || f.type !== "Contact") return;
    const db = getDatabase();
    const who = String(f.name || "Someone");
    const contact = String(f.contact || "").slice(0, 120);
    await notifyStaff(db, "✉️ New website message", `${who}${contact ? " · " + contact : ""}`, "/admin.html");
  },
);

// ---------------------------------------------------------------------------
// Release 1C: customer-owned, server-priced online ordering.
// ---------------------------------------------------------------------------
const ORDER_REGION = "asia-southeast1";
// CallableOptions requires a real Boolean. Passing a defineBoolean parameter
// object is truthy at runtime and accidentally enforces App Check even when
// ENFORCE_APP_CHECK=false.
const ENFORCE_APP_CHECK = String(process.env.ENFORCE_APP_CHECK || "false").toLowerCase() === "true";
const ORDER_LOCK_MS = 90 * 1000;
// Keep a 5 MB server ceiling during the v41 -> v42 cache transition. New v42
// browsers compress to roughly 1.3 MB before calling this function.
const MAX_PROOF_CHARS = 7_000_000;
const MAX_PROOF_BYTES = 5_000_000;
const PROOF_BUCKET = process.env.PROOF_STORAGE_BUCKET || "accaza-sartoga.firebasestorage.app";

function decodePaymentProof(dataUrl) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  if (!match || String(dataUrl).length > MAX_PROOF_CHARS) {
    throw new HttpsError("invalid-argument", "Attach a valid compressed PNG, JPEG, or WebP payment proof.");
  }
  const subtype = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) {
    throw new HttpsError("invalid-argument", "Payment proof must be under 5 MB.");
  }
  const isJpeg = subtype === "jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = subtype === "png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = subtype === "webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new HttpsError("invalid-argument", "Payment proof contents do not match a supported image format.");
  return {bytes, contentType: `image/${subtype}`, ext: subtype === "jpeg" ? "jpg" : subtype};
}

function portalRoleValue(raw) {
  const role = raw === true ? "owner" : typeof raw === "string" ? raw : raw && raw.role;
  return String(role || "").toLowerCase();
}

async function requirePortalUser(db, request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Staff login is required.");
  const snap = await db.ref(`/admins/${request.auth.uid}`).get();
  const role = portalRoleValue(snap.val());
  if (!["owner", "superadmin", "admin", "manager", "staff", "cashier", "kitchen", "finance"].includes(role)) {
    throw new HttpsError("permission-denied", "This account is not authorized for the Accaza portal.");
  }
  return {uid: request.auth.uid, role};
}

async function requirePortalPermission(db, request, permissions) {
  const portal = await requirePortalUser(db, request);
  if (["owner", "superadmin", "admin", "manager"].includes(portal.role)) return portal;
  const snap = await db.ref(`/adminPerms/${portal.uid}`).get();
  const granted = snap.val() || {};
  if (!(permissions || []).some((key) => granted[key] === true)) {
    throw new HttpsError("permission-denied", "This account does not have the required permission.");
  }
  return portal;
}

// Release 6A: privacy-safe, bounded operational telemetry. Only aggregate
// counters and timings are stored; no order/customer/payment content is accepted.
const CLIENT_METRICS = new Set(["pos_boot", "pos_build", "cart_render", "charge_to_durable", "offline_flush", "realtime_order_arrival"]);
function telemetryKey(value) {return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 50);}
exports.recordClientTelemetry = onCall(
  {region: ORDER_REGION, enforceAppCheck: false},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request), data = request.data || {}, raw = Array.isArray(data.events) ? data.events.slice(0, 20) : [];
    if (!raw.length) return {accepted: 0};
    const day = financeDateFromTimestamp(Date.now()), build = telemetryKey(data.build).slice(0, 24) || "unknown";
    const accepted = raw.map((event) => {
      const type = event && event.type === "error" ? "error" : "metric", name = telemetryKey(event && event.name);
      if (type === "metric" && !CLIENT_METRICS.has(name)) return null;
      if (type === "error" && !/^(js_[a-z0-9_-]+|unhandled_promise|proof_access)$/.test(name)) return null;
      return {type, name, duration: Math.max(0, Math.min(120000, Math.round(Number(event.duration) || 0))), ok: event.ok !== false};
    }).filter(Boolean);
    if (!accepted.length) return {accepted: 0};
    await db.ref(`/clientTelemetryDaily/${day}`).transaction((current) => {
      const row = current && typeof current === "object" ? current : {metrics: {}, errors: {}, builds: {}, updatedAt: 0};
      row.metrics = row.metrics || {}; row.errors = row.errors || {}; row.builds = row.builds || {};
      accepted.forEach((event) => {if (event.type === "metric") {const m = row.metrics[event.name] || {count: 0, totalMs: 0, maxMs: 0, failed: 0};m.count = Math.min(1000000, Number(m.count || 0) + 1);m.totalMs = Math.min(1000000000, Number(m.totalMs || 0) + event.duration);m.maxMs = Math.max(Number(m.maxMs || 0), event.duration);if (!event.ok) m.failed = Math.min(1000000, Number(m.failed || 0) + 1);row.metrics[event.name] = m;} else row.errors[event.name] = Math.min(1000000, Number(row.errors[event.name] || 0) + 1);});
      row.builds[build] = Math.min(1000000, Number(row.builds[build] || 0) + accepted.length);row.updatedAt = Date.now();row.lastRole = actor.role;return row;
    });
    return {accepted: accepted.length};
  },
);

// Release 7B: bounded, sanitized, management-only operational exception scan.
exports.getOperationalExceptions = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request);
    if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Operational exceptions are restricted to management accounts.");
    const now = Date.now(), days = [];for (let offset = 0; offset < 7; offset++) days.push(financeDateFromTimestamp(now - offset * 86400000));
    const [activeSnap, ordersSnap, offlineSnap, custodySnap, ...telemetrySnaps] = await Promise.all([db.ref("/activeOrders").limitToLast(250).get(),db.ref("/orders").limitToLast(100).get(),db.ref("/offlinePosSync").orderByChild("updatedAt").limitToLast(100).get(),db.ref("/cashCustody").orderByChild("closedAt").limitToLast(100).get(),...days.map((day) => db.ref(`/clientTelemetryDaily/${day}`).get())]);
    const orders = ordersSnap.val() || {}, financialPairs = await Promise.all(Object.keys(orders).slice(0, 100).map(async (id) => {const snap = await db.ref(`/financialMovements/sale_${id}`).get();return [id, snap.exists() ? snap.val() : null];}));
    const financialMovements = {};financialPairs.forEach(([id, value]) => {if (value) financialMovements[`sale_${id}`] = value;});const telemetry = {};days.forEach((day, i) => {telemetry[day] = telemetrySnaps[i].val() || {};});
    return OperationalExceptions.buildOperationalExceptions({activeOrders: activeSnap.val() || {}, orders, offlinePosSync: offlineSnap.val() || {}, cashCustody: custodySnap.val() || {}, financialMovements, telemetry}, now);
  },
);

// Release 7A: portal order-status changes are authenticated, transition-
// validated, idempotent server commands. Customer receipt remains a separate
// UID-owned command and offline POS creation remains syncOfflinePosSale.
exports.updateOrderStatus = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["orders", "pos"]);
    return OrderStatus.updateOrderStatusCommand({
      db, actor, data: request.data || {}, activeOrderProjection, shouldProjectOrder,
      error: (code, message) => new HttpsError(code, message),
    });
  },
);

// A website order becomes a POS-channel order only after staff verifies its
// payment and accepts it into the currently open shift.
exports.acceptOnlineOrder = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["orders", "pos"]);
    const orderId = String(request.data && request.data.orderId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(orderId)) throw new HttpsError("invalid-argument", "Order ID is invalid.");
    const [shiftSnap, orderSnap] = await Promise.all([db.ref("/posActiveShift").get(), db.ref(`/orders/${orderId}`).get()]);
    const shift = shiftSnap.val() || null, order = orderSnap.val() || null;
    if (!shift || !shift.id || shift.status === "closed") throw new HttpsError("failed-precondition", "Open a POS shift before accepting online orders.");
    if (!order) throw new HttpsError("not-found", "Online order not found.");
    if (order.source !== "online" && order.channel !== "online") throw new HttpsError("failed-precondition", "Only website orders can enter the Online Orders channel.");
    if (["Rejected", "Completed", "Received"].includes(String(order.status || ""))) throw new HttpsError("failed-precondition", "This order can no longer be accepted into POS.");
    if (!["cashier_verified", "manager_validated", "confirmed"].includes(order.paymentStatus)) throw new HttpsError("failed-precondition", "The cashier must verify the customer payment before accepting this order.");
    if (order.shiftId) {
      if (order.shiftId === shift.id && order.channel === "online") return {orderId, shiftId: shift.id, duplicate: true};
      throw new HttpsError("failed-precondition", "This order is already assigned to another shift.");
    }
    const now = Date.now(), status = order.status === "Pending" ? "Confirmed" : order.status;
    const captured = Object.assign({}, order, {
      channel: "online", shiftId: shift.id, staff: shift.staff || shift.cashier || actor.role,
      posCaptured: true, acceptedAt: now, acceptedBy: actor.uid, acceptedRole: actor.role,
      status, statusUpdatedAt: now, statusUpdatedBy: actor.uid,
      payments: Array.isArray(order.payments) && order.payments.length ? order.payments : [{method: order.payment || "Online payment", amount: Financial.money(order.total)}],
    });
    const writes = {
      [`orders/${orderId}`]: captured,
      [`activeOrders/${orderId}`]: activeOrderProjection(captured),
      [`operationalAudit/${now}_accept_${orderId}`]: {action: "accept_online_order", sourceType: "order", sourceId: orderId, shiftId: shift.id, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    };
    if (captured.ownerUid) writes[`customerOrders/${captured.ownerUid}/${orderId}/status`] = status;
    await db.ref().update(writes);
    return {orderId, shiftId: shift.id, status, duplicate: false};
  },
);

const MANAGER_APPROVAL_ACTIONS = new Set([
  "validate_payment", "refund", "void", "settle_platform_payout", "reopen_cash_count",
  "delete_archived_order", "review_discrepancy", "approve_petty_voucher",
  "reject_petty_voucher", "void_petty_voucher", "manual_discount", "cash_in", "fixed_float_exception", "reverse_purchase",
]);
function transactionCurrent(current, initial, state) {
  const value = current == null && !state.seen ? initial : current;
  state.seen = true;
  return value;
}
async function claimManagerApproval(db, data, action, sourceId, amount, operationKey) {
  const approvalId = financeKey(data && data.approvalId, "Privileged approval"); const ref = db.ref(`/financialApprovals/${approvalId}`), now = Date.now();
  const matches = (row) => !!row && row.action === action && row.sourceId === String(sourceId) && Number(row.expiresAt || 0) >= now && !row.usedAt && !(amount != null && Math.abs(Financial.money(row.amount) - Financial.money(amount)) > 0.009) && !(row.claimKey && row.claimKey !== operationKey);
  const initial = (await ref.get()).val();
  if (!matches(initial)) throw new HttpsError("failed-precondition", "Privileged approval is missing, expired, already used, or does not match this action.");
  const transactionState = {seen: false};
  const claimed = await ref.transaction((row) => {row = transactionCurrent(row, initial, transactionState); return matches(row) ? Object.assign({}, row, {claimKey: operationKey, claimedAt: now}) : undefined;}, undefined, false);
  if (!claimed.committed) throw new HttpsError("failed-precondition", "Privileged approval was changed or used before this action completed. Request a new approval.");
  return {id: approvalId, record: initial, usedWrites: {[`financialApprovals/${approvalId}/usedAt`]: now, [`financialApprovals/${approvalId}/usedBy`]: operationKey}};
}

exports.createManagerApproval = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const requester = await requirePortalUser(db, request); const data = request.data || {}, action = financeText(data.action, 40); if (!MANAGER_APPROVAL_ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Approval action is invalid.");
    let decoded; try {decoded = await getAdminAuth().verifyIdToken(String(data.managerIdToken || ""), true);} catch (_error) {throw new HttpsError("permission-denied", "Privileged sign-in could not be verified.");}
    const managerSnap = await db.ref(`/admins/${decoded.uid}`).get(), managerRole = portalRoleValue(managerSnap.val()); if (!["owner", "superadmin", "admin", "manager"].includes(managerRole)) throw new HttpsError("permission-denied", "That Firebase account is not an Owner, Superadmin, Admin, or Manager account.");
    const sourceId = financeText(data.sourceId, 160); if (!sourceId) throw new HttpsError("invalid-argument", "Approval source is required."); const amount = data.amount == null ? null : Financial.money(data.amount), now = Date.now(), id = `approval_${crypto.randomBytes(12).toString("hex")}`;
    await db.ref(`/financialApprovals/${id}`).set({action, sourceId, amount, reason: financeText(data.reason, 300), requestedBy: requester.uid, approvedBy: decoded.uid, approvedEmail: financeText(decoded.email, 160), approvedName: financeText(decoded.name, 160), approvedRole: managerRole, approvedAt: now, expiresAt: now + 5 * 60 * 1000, schemaVersion: 1});
    return {approvalId: id, approvedBy: decoded.email || managerRole, expiresAt: now + 5 * 60 * 1000};
  },
);

exports.consumeManagerApproval = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {const db = getDatabase(); await requirePortalPermission(db, request, ["registerOps", "pos"]); const data = request.data || {}, action = financeText(data.action, 40), sourceId = financeText(data.sourceId, 160), op = financeKey(data.operationKey || `${action}_${sourceId}`, "Operation ID"), approval = await claimManagerApproval(db, data, action, sourceId, data.amount, op); await db.ref().update(approval.usedWrites); return {approvalId: approval.id, approvedBy: approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, approvedByUid: approval.record.approvedBy, approvedRole: approval.record.approvedRole};},
);

// ---------------------------------------------------------------------------
// Release 3E: server-owned operational controls and retention.
// ---------------------------------------------------------------------------
const REJECTED_ORDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function operationalAuditRecord(action, sourceType, sourceId, actor, details = {}) {
  return Object.assign({
    action, sourceType, sourceId, actorUid: actor.uid, actorRole: actor.role,
    ts: Date.now(), schemaVersion: 1,
  }, details);
}

exports.manageOrderArchive = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["orders"]);
    const data = request.data || {};
    const action = financeText(data.action, 40);
    const orderId = financeKey(data.orderId, "Order ID");
    const now = Date.now();
    if (action === "archive") {
      const [orderSnap, archivedSnap] = await Promise.all([
        db.ref(`/orders/${orderId}`).get(), db.ref(`/archivedOrders/${orderId}`).get(),
      ]);
      if (!orderSnap.exists()) {
        if (archivedSnap.exists()) return {orderId, duplicate: true};
        throw new HttpsError("not-found", "Order not found.");
      }
      const order = Object.assign({id: orderId}, orderSnap.val() || {});
      if (!["Completed", "Received", "Rejected"].includes(String(order.status || "")) && order.voided !== true) {
        throw new HttpsError("failed-precondition", "Only completed, received, rejected, or voided orders can be archived.");
      }
      const archived = archivedOrderRecord(order, now, "manual-server");
      await db.ref().update({
        [`archivedOrders/${orderId}`]: archived,
        [`orders/${orderId}`]: null,
        [`activeOrders/${orderId}`]: null,
        [`operationalAudit/${now}_${orderId}`]: operationalAuditRecord("archive_order", "order", orderId, actor, {previousStatus: order.status || ""}),
      });
      return {orderId, archivedAt: now};
    }
    if (action === "delete") {
      const snap = await db.ref(`/archivedOrders/${orderId}`).get();
      if (!snap.exists()) throw new HttpsError("not-found", "Archived order not found.");
      const order = snap.val() || {};
      const archivedAt = Number(order.archivedAt || 0);
      if (String(order.prevStatus || "") !== "Rejected") {
        throw new HttpsError("failed-precondition", "Financial sales are retained and cannot be permanently deleted. Only rejected orders are eligible.");
      }
      if (!archivedAt || now - archivedAt < REJECTED_ORDER_RETENTION_MS) {
        throw new HttpsError("failed-precondition", "Rejected orders must remain archived for at least 90 days before deletion.");
      }
      const financialSnap = await db.ref(`/financialMovements/sale_${orderId}`).get();
      if (financialSnap.exists()) throw new HttpsError("failed-precondition", "This order has a financial posting and cannot be deleted.");
      const approval = await claimManagerApproval(db, data, "delete_archived_order", orderId, Financial.money(order.total), `delete_archived_order_${orderId}`);
      await db.ref().update(Object.assign({}, approval.usedWrites, {
        [`archivedOrders/${orderId}`]: null,
        [`deletionAudit/orders/${orderId}`]: {
          orderId, previousStatus: order.prevStatus || "Rejected", archivedAt,
          deletedAt: now, deletedBy: actor.uid, approvalId: approval.id,
          approvedBy: approval.record.approvedEmail || approval.record.approvedRole,
          policy: "rejected-order-90-days", schemaVersion: 1,
        },
        [`operationalAudit/${now}_${orderId}`]: operationalAuditRecord("delete_archived_order", "order", orderId, actor, {approvalId: approval.id}),
      }));
      return {orderId, deletedAt: now};
    }
    throw new HttpsError("invalid-argument", "Archive action is invalid.");
  },
);

exports.reviewDiscrepancy = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["discrepancy", "registerOps"]);
    const data = request.data || {}, id = financeKey(data.discrepancyId, "Discrepancy ID"), note = financeText(data.note, 500);
    if (!note) throw new HttpsError("invalid-argument", "A root-cause note is required.");
    const ref = db.ref(`/discrepancies/${id}`), snap = await ref.get();
    if (!snap.exists()) throw new HttpsError("not-found", "Discrepancy not found.");
    const row = snap.val() || {}; if (row.status === "reviewed") return {discrepancyId: id, duplicate: true};
    const approval = await claimManagerApproval(db, data, "review_discrepancy", id, null, `review_discrepancy_${id}`), now = Date.now(), reviewedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    let duplicate = false; const transactionState = {seen: false};
    const result = await ref.transaction((current) => {
      current = transactionCurrent(current, row, transactionState);
      if (!current) return;
      if (current.status === "reviewed") {if (current.reviewApprovalId === approval.id) {duplicate = true; return current;} return;}
      return Object.assign({}, current, {status: "reviewed", reviewedAt: now, reviewedBy, reviewedByUid: approval.record.approvedBy, reviewApprovalId: approval.id, note});
    }, undefined, false);
    if (!result.committed) throw new HttpsError("aborted", "This discrepancy was reviewed by another manager. Refresh the list.");
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord("review_discrepancy", "discrepancy", id, actor, {approvalId: approval.id})}));
    return {discrepancyId: id, reviewedAt: now, duplicate};
  },
);

exports.managePettyVoucher = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty"]);
    const data = request.data || {}, action = financeText(data.action, 20), id = financeKey(data.voucherId, "Voucher ID"), reason = financeText(data.reason, 500);
    const ref = db.ref(`/pettyCashVouchers/${id}`), snap = await ref.get(); if (!snap.exists()) throw new HttpsError("not-found", "Petty cash voucher not found.");
    const voucher = snap.val() || {}, value = Financial.money(voucher.amount), now = Date.now(); let approvalAction;
    if (action === "approve") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be approved.");
      if (!voucher.receiptImg) throw new HttpsError("failed-precondition", "A receipt is required before approval.");
      approvalAction = "approve_petty_voucher";
    } else if (action === "reject") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be rejected.");
      if (!reason) throw new HttpsError("invalid-argument", "A rejection reason is required."); approvalAction = "reject_petty_voucher";
    } else if (action === "void") {
      if (voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved voucher can be voided.");
      if (!reason) throw new HttpsError("invalid-argument", "A void reason is required."); approvalAction = "void_petty_voucher";
    } else throw new HttpsError("invalid-argument", "Petty voucher action is invalid.");
    const approval = await claimManagerApproval(db, data, approvalAction, id, value, `${approvalAction}_${id}`);
    const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    if (action === "approve") {
      const requesterName = financeText(voucher.requesterName, 160).toLowerCase();
      const managerNames = [approval.record.approvedName, String(approval.record.approvedEmail || "").split("@")[0]].map((x) => financeText(x, 160).toLowerCase()).filter(Boolean);
      if (requesterName && managerNames.includes(requesterName)) {await db.ref().update(approval.usedWrites); throw new HttpsError("failed-precondition", "The requester cannot approve their own voucher.");}
    }
    let baseFunds = 0;
    if (action === "approve") {
      const [settingsSnap, replSnap] = await Promise.all([db.ref("/pettyCashSettings/openingBalance").get(), db.ref("/pettyCashReplenishments").get()]);
      baseFunds = Financial.money(Number(settingsSnap.val() || 0) + Object.values(replSnap.val() || {}).reduce((sum, row) => sum + Financial.money(row && row.amount), 0));
    }
    let failure = "", duplicate = false; const vouchersRef = db.ref("/pettyCashVouchers"), vouchersInitial = (await vouchersRef.get()).val() || {}, transactionState = {seen: false};
    const result = await vouchersRef.transaction((all) => {
      all = transactionCurrent(all, vouchersInitial, transactionState); if (!all) return; all = Object.assign({}, all); const current = all[id]; failure = ""; duplicate = false;
      if (!current) {failure = "Petty cash voucher not found."; return;}
      if (action === "approve") {
        if (current.status === "approved" && current.approvalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be approved."; return;}
        if (!current.receiptImg) {failure = "A receipt is required before approval."; return;}
        const disbursed = Object.values(all).reduce((sum, row) => sum + (row && row.status === "approved" && !row.voided ? Financial.money(row.amount) : 0), 0), available = Financial.money(baseFunds - disbursed);
        if (value > available + 0.009) {failure = `Voucher exceeds available petty cash (${available.toFixed(2)}).`; return;}
        all[id] = Object.assign({}, current, {status: "approved", approvedBy, approvedByUid: approval.record.approvedBy, approvedAt: now, approvalId: approval.id});
      } else if (action === "reject") {
        if (current.status === "rejected" && current.rejectionApprovalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be rejected."; return;}
        all[id] = Object.assign({}, current, {status: "rejected", rejectReason: reason, rejectedBy: approvedBy, rejectedByUid: approval.record.approvedBy, rejectedAt: now, rejectionApprovalId: approval.id});
      } else {
        if (current.voided === true && current.voidApprovalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "approved" || current.voided === true) {failure = "Only an active approved voucher can be voided."; return;}
        all[id] = Object.assign({}, current, {voided: true, voidReason: reason, voidedBy: approvedBy, voidedByUid: approval.record.approvedBy, voidedAt: now, voidApprovalId: approval.id});
      }
      return all;
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", failure || "Voucher changed while it was being reviewed. Refresh and try again.");
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord(`${action}_petty_voucher`, "pettyVoucher", id, actor, {approvalId: approval.id, amount: value})}));
    return {voucherId: id, action, at: now, duplicate};
  },
);

exports.archiveActivityLog = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["registerOps"]), cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const snap = await db.ref("/activityLog").orderByChild("ts").endAt(cutoff).limitToFirst(500).get(), writes = {}; let count = 0;
    snap.forEach((child) => {writes[`activityLogArchive/${child.key}`] = Object.assign({}, child.val() || {}, {archivedAt: Date.now(), archivedBy: actor.uid}); writes[`activityLog/${child.key}`] = null; count++;});
    if (count) await db.ref().update(writes); return {archived: count, hasMore: count === 500};
  },
);

// ---------------------------------------------------------------------------
// Release 2C: bounded operational order projection.
// /orders remains authoritative. /activeOrders contains only orders needed by
// the live register/admin workflow and never carries legacy embedded proofs.
// ---------------------------------------------------------------------------
const ACTIVE_ONLINE_TTL_MS = 48 * 60 * 60 * 1000;
const ACTIVE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const READY_AUTO_COMPLETE_MS = 2 * 60 * 60 * 1000;

function readyForAutoComplete(order, now = Date.now()) {
  return !!order && order.channel === "online" && order.status === "Ready" && now - Number(order.statusUpdatedAt || order.readyAt || order.timestamp || 0) >= READY_AUTO_COMPLETE_MS;
}

function activeOrderProjection(order) {
  if (!order || typeof order !== "object") return null;
  const projected = Object.assign({}, order, {projectionVersion: 1});
  delete projected.proof;
  delete projected.proofData;
  return projected;
}

function shouldProjectOrder(order, activeShift, now = Date.now()) {
  if (!order || typeof order !== "object") return false;
  if (order.inventoryReversalRequested === true && order.inventoryReversed !== true) return true;
  const status = String(order.status || "Pending");
  if (["Pending", "Confirmed", "Preparing", "Ready"].includes(status)) return true;
  if (["pending", "cashier_verified"].includes(order.paymentStatus)) return true;
  if (["grabfood", "foodpanda"].includes(order.channel) && (order.settlementStatus || "unsettled") === "unsettled") return true;
  if (activeShift && order.shiftId && order.shiftId === activeShift.id) return true;
  const age = now - Number(order.timestamp || 0);
  if (order.source === "online" && age >= 0 && age <= ACTIVE_ONLINE_TTL_MS) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Release 5B: durable, idempotent POS offline-sale synchronization.
// IndexedDB retains the client command. This callable is the only authority
// that turns it into an order and applies denomination drawer deltas.
// ---------------------------------------------------------------------------
exports.syncOfflinePosSale = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["pos"]), data = request.data || {};
    return OfflineSync.syncOfflinePosSaleCommand({db, actor, data, textField, money, listFromFirebase, activeOrderProjection});
  },
);

function archivedOrderRecord(order, now = Date.now(), reason = "closed-shift") {
  return Object.assign({}, order, {
    status: "Archived", prevStatus: order.status || "Completed", archivedAt: now,
    archivedDate: new Intl.DateTimeFormat("en-PH", {timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric"}).format(new Date(now)),
    archiveReason: reason,
  });
}

async function rebuildActiveOrders(db, force = false) {
  const now = Date.now();
  const markerRef = db.ref("/systemMaintenance/activeOrdersLastSweep");
  const [markerSnap, activeShiftSnap, activeSnap] = await Promise.all([
    markerRef.get(), db.ref("/posActiveShift").get(), db.ref("/activeOrders").get(),
  ]);
  if (!force && now - Number(markerSnap.val() || 0) < ACTIVE_SWEEP_INTERVAL_MS && activeSnap.exists()) {
    return {skipped: true, active: activeSnap.numChildren()};
  }
  const ordersSnap = await db.ref("/orders").get();
  const orders = ordersSnap.val() || {};
  const existing = activeSnap.val() || {};
  const activeShift = activeShiftSnap.val() || null;
  const writes = {};
  let kept = 0;
  Object.keys(orders).forEach((id) => {
    if (shouldProjectOrder(orders[id], activeShift, now)) {
      writes[`activeOrders/${id}`] = activeOrderProjection(orders[id]);
      kept++;
    } else if (orders[id] && orders[id].source === "pos" && (["Completed", "Received"].includes(orders[id].status) || orders[id].voided)) {
      writes[`archivedOrders/${id}`] = archivedOrderRecord(orders[id], now, "2c-migration");
      writes[`orders/${id}`] = null;
      writes[`activeOrders/${id}`] = null;
    }
  });
  Object.keys(existing).forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(orders, id) || !shouldProjectOrder(orders[id], activeShift, now)) writes[`activeOrders/${id}`] = null;
  });
  writes["systemMaintenance/activeOrdersLastSweep"] = now;
  await db.ref().update(writes);
  return {skipped: false, scanned: Object.keys(orders).length, active: kept};
}

function textField(value, name, max, required = false) {
  const valueText = String(value == null ? "" : value).trim();
  if (required && !valueText) throw new HttpsError("invalid-argument", `${name} is required.`);
  if (valueText.length > max) throw new HttpsError("invalid-argument", `${name} is too long.`);
  return valueText;
}
function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
function listFromFirebase(value) {
  if (Array.isArray(value)) return value.filter((x) => x != null);
  if (value && typeof value === "object") return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]).filter((x) => x != null);
  return [];
}
function legacyOptionIdsForServer(cat) {
  const ids = [];
  if (["coffee", "noncaf"].includes(cat)) ids.push("og_temp");
  if (["coffee", "noncaf", "frappe", "nonfrappe", "soda"].includes(cat)) ids.push("og_sweet");
  if (["coffee", "noncaf", "frappe", "nonfrappe"].includes(cat)) ids.push("og_milk");
  if (["coffee", "frappe"].includes(cat)) ids.push("og_shot");
  if (["coffee", "noncaf", "frappe", "nonfrappe"].includes(cat)) ids.push("og_syrup");
  if (["coffee", "noncaf", "frappe", "nonfrappe", "soda"].includes(cat)) ids.push("og_top");
  return ids;
}
function effectiveOptionIdsServer(item) {
  if (Array.isArray(item.options)) return item.options;
  if (item.options && typeof item.options === "object") return Object.values(item.options);
  return item.optionsSet ? [] : legacyOptionIdsForServer(item.cat);
}
function menuPriceServer(item, requestedSize) {
  const sized = Number(item.priceM) > 0 || Number(item.priceL) > 0;
  if (!sized) {
    const flat = Number(item.priceS);
    if (!Number.isFinite(flat) || flat < 0) throw new HttpsError("failed-precondition", `No valid price is configured for ${item.name || "an item"}.`);
    return {size: null, price: money(flat)};
  }
  const size = String(requestedSize || "").toUpperCase();
  if (!["S", "M", "L"].includes(size)) throw new HttpsError("invalid-argument", `Choose a valid size for ${item.name || "the item"}.`);
  const price = Number(item[`price${size}`]);
  if (!Number.isFinite(price) || price < 0) throw new HttpsError("failed-precondition", `${size} price is unavailable for ${item.name || "the item"}.`);
  return {size, price: money(price)};
}
function priceLineServer(raw, menuItems, optionGroups, availability) {
  if (!raw || typeof raw !== "object") throw new HttpsError("invalid-argument", "Invalid order line.");
  const itemKey = textField(raw.itemKey, "Item key", 120, true);
  const item = menuItems[itemKey];
  if (!item) throw new HttpsError("failed-precondition", "One selected menu item no longer exists.");
  if (item.available === false || availability[item.name] === false) throw new HttpsError("failed-precondition", `${item.name || "An item"} is currently unavailable.`);
  const qty = Number(raw.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new HttpsError("invalid-argument", "Each item quantity must be between 1 and 20.");
  const base = menuPriceServer(item, raw.size);
  const groupIds = effectiveOptionIdsServer(item);
  const labels = Array.isArray(raw.optLabels) ? raw.optLabels : [];
  if (labels.length > 20) throw new HttpsError("invalid-argument", "Too many add-ons were selected.");
  const cleanLabels = [];
  const selectedByGroup = {};
  let optionTotal = 0;
  labels.forEach((labelRaw) => {
    const label = textField(labelRaw, "Add-on", 100, true);
    let match = null;
    for (const gid of groupIds) {
      const group = optionGroups[gid];
      const choice = listFromFirebase(group && group.choices).find((c) => c && c.label === label);
      if (choice) { match = {gid, group, choice}; break; }
    }
    if (!match) throw new HttpsError("failed-precondition", `${label} is not a valid option for ${item.name}.`);
    if (cleanLabels.includes(label)) throw new HttpsError("invalid-argument", `Duplicate add-on: ${label}.`);
    selectedByGroup[match.gid] = (selectedByGroup[match.gid] || 0) + 1;
    if ((match.group.type === "single" || match.group.type === "radio") && selectedByGroup[match.gid] > 1) {
      throw new HttpsError("invalid-argument", `Only one ${match.group.name || "option"} may be selected.`);
    }
    const addPrice = Number(match.choice.price) || 0;
    if (addPrice < 0 || addPrice > 100000) throw new HttpsError("failed-precondition", `Invalid configured price for ${label}.`);
    optionTotal += addPrice;
    cleanLabels.push(label);
  });
  const unit = money(base.price + optionTotal);
  return {
    itemKey,
    name: textField(item.name, "Menu item name", 160, true),
    size: base.size,
    optLabels: cleanLabels,
    qty,
    unitTotal: unit,
    stream: raw.stream === "promo" ? "promo" : raw.stream === "events" ? "events" : null,
    pkg: raw.pkg ? textField(raw.pkg, "Package ID", 120) : null,
    packageRole: raw.packageRole === "free" ? "free" : raw.packageRole === "paid" ? "paid" : null,
    cat: item.cat || "",
  };
}
function packageEligibleServer(pkg, line) {
  const eligibleItems = listFromFirebase(pkg.eligibleItems).map(String);
  return (pkg.eligibleCat && line.cat === pkg.eligibleCat) || eligibleItems.includes(line.itemKey);
}
function priceOrderLinesServer(rawLines, menuItems, optionGroups, availability, packages) {
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 60) throw new HttpsError("invalid-argument", "Order must contain between 1 and 60 lines.");
  const lines = rawLines.map((line) => priceLineServer(line, menuItems, optionGroups, availability));
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  if (totalQty > 100) throw new HttpsError("invalid-argument", "Order quantity is too large.");
  let total = 0;
  const packageGroups = {};
  lines.forEach((line) => {
    if (!line.pkg) { total += line.unitTotal * line.qty; return; }
    (packageGroups[line.pkg] = packageGroups[line.pkg] || []).push(line);
  });
  const packageSnapshots = [];
  Object.keys(packageGroups).forEach((pkgId) => {
    const pkg = packages[pkgId];
    const group = packageGroups[pkgId];
    if (!pkg) throw new HttpsError("failed-precondition", "A selected package or promotion no longer exists.");
    group.forEach((line) => { if (!packageEligibleServer(pkg, line)) throw new HttpsError("failed-precondition", `${line.name} is not eligible for ${pkg.name || "this package"}.`); });
    const requiredQty = Number(pkg.qty) || 0;
    if (!Number.isInteger(requiredQty) || requiredQty < 1) throw new HttpsError("failed-precondition", "Package quantity is not configured correctly.");
    let gross = 0; let discount = 0; let count = 0;
    if (pkg.type === "promo") {
      const paid = group.filter((line) => line.packageRole === "paid");
      const free = group.filter((line) => line.packageRole === "free");
      const paidQty = paid.reduce((sum, line) => sum + line.qty, 0);
      const freeQty = free.reduce((sum, line) => sum + line.qty, 0);
      count = paidQty / requiredQty;
      if (!Number.isInteger(count) || count < 1 || freeQty !== count * (Number(pkg.freeQty) || 0) || paid.length + free.length !== group.length) {
        throw new HttpsError("invalid-argument", `Items do not match promotion ${pkg.name || pkgId}. Please remove it and add it again.`);
      }
      gross = group.reduce((sum, line) => sum + line.unitTotal * line.qty, 0);
      discount = free.reduce((sum, line) => sum + line.unitTotal * line.qty, 0);
      free.forEach((line) => { line.unitTotal = 0; line.name += " (FREE)"; });
      total += gross - discount;
    } else {
      const qty = group.reduce((sum, line) => sum + line.qty, 0);
      count = qty / requiredQty;
      if (!Number.isInteger(count) || count < 1) throw new HttpsError("invalid-argument", `Items do not match package ${pkg.name || pkgId}. Please remove it and add it again.`);
      gross = group.reduce((sum, line) => sum + line.unitTotal * line.qty, 0);
      discount = pkg.discType === "percent" ? gross * (Number(pkg.discValue) || 0) / 100 : pkg.discType === "fixed" ? (Number(pkg.discValue) || 0) * count : 0;
      discount = Math.min(gross, Math.max(0, money(discount)));
      const factor = gross > 0 ? (gross - discount) / gross : 1;
      group.forEach((line) => { line.unitTotal = money(line.unitTotal * factor); });
      const allocatedNet = money(group.reduce((sum, line) => sum + line.unitTotal * line.qty, 0));
      discount = money(gross - allocatedNet);
      total += allocatedNet;
    }
    const extraCost = money((Number(pkg.extraCost) || 0) * count);
    if (extraCost < 0 || extraCost > 200000) throw new HttpsError("failed-precondition", "Package extra cost is invalid.");
    total += extraCost;
    packageSnapshots.push({id: pkgId, name: textField(pkg.name || "Package", "Package name", 160), type: pkg.type || "package", gross: money(gross), discount: money(discount), extraCost, count});
  });
  return {lines, packages: packageSnapshots, total: money(total), extraCost: money(packageSnapshots.reduce((sum, p) => sum + p.extraCost, 0))};
}
async function enforceOrderRateLimit(db, uid) {
  const now = Date.now();
  const ref = db.ref(`/rateLimits/orders/${uid}`);
  let limited = false;
  await ref.transaction((current) => {
    const value = current || {start: now, count: 0};
    if (now - Number(value.start || 0) >= 60000) return {start: now, count: 1};
    if (Number(value.count || 0) >= 5) { limited = true; return; }
    return {start: value.start, count: Number(value.count || 0) + 1};
  });
  if (limited) throw new HttpsError("resource-exhausted", "Too many order attempts. Please wait one minute and try again.");
}
exports.createOnlineOrder = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready. Refresh and try again.");
    if (!request.app) logger.warn("createOnlineOrder called without App Check", {uid: request.auth.uid});
    const uid = request.auth.uid;
    const input = request.data || {};
    const db = getDatabase();
    const shift = (await db.ref("/posActiveShift").get()).val() || null;
    if (!shift || shift.status === "closed") throw new HttpsError("failed-precondition", "Online orders are closed right now. Please try again when the shop is accepting orders.");
    await enforceOrderRateLimit(db, uid);
    const name = textField(input.name, "Name", 100, true);
    const phone = textField(input.phone, "Phone", 40, true);
    if (phone.replace(/\D/g, "").length < 10) throw new HttpsError("invalid-argument", "Enter a valid phone number.");
    const orderType = input.type === "Delivery" ? "Delivery" : input.type === "Pick-up" ? "Pick-up" : "";
    if (!orderType) throw new HttpsError("invalid-argument", "Invalid order type.");
    const address = orderType === "Delivery" ? textField(input.address, "Delivery address", 300, true) : "";
    const payment = ["GCash", "PayMaya", "Bank Transfer"].includes(input.payment) ? input.payment : "";
    if (!payment) throw new HttpsError("invalid-argument", "Invalid payment method.");
    const contactMethod = ["whatsapp", "viber", "sms", "call", "email"].includes(input.contactMethod) ? input.contactMethod : "";
    if (!contactMethod) throw new HttpsError("invalid-argument", "Invalid contact method.");
    const contact = textField(input.contact, "Contact", 120, true);
    const notes = textField(input.notes, "Notes", 500);
    const proof = decodePaymentProof(input.proof);
    const [menuSnap, groupsSnap, availSnap, packagesSnap] = await Promise.all([
      db.ref("/menuItems").get(), db.ref("/optionGroups").get(), db.ref("/availability").get(), db.ref("/packages").get(),
    ]);
    const priced = priceOrderLinesServer(input.lineItems, menuSnap.val() || {}, groupsSnap.val() || {}, availSnap.val() || {}, packagesSnap.val() || {});
    if (priced.total <= 0 || priced.total > 200000) throw new HttpsError("invalid-argument", "Calculated order total is outside the allowed range.");
    const expectedTotal = Number(input.expectedTotal);
    if (!Number.isFinite(expectedTotal) || Math.abs(money(expectedTotal) - priced.total) > 0.01) {
      throw new HttpsError("failed-precondition", `The menu price changed. The current total is PHP ${priced.total.toFixed(2)}. Refresh the menu and review your order.`);
    }
    const signature = crypto.createHash("sha256").update(JSON.stringify({uid, type: orderType, lines: priced.lines, total: priced.total})).digest("hex");
    const lockRef = db.ref(`/orderLocks/${uid}/${signature}`);
    const now = Date.now();
    const lock = await lockRef.transaction((current) => {
      if (current && now - Number(current.t || 0) < ORDER_LOCK_MS) return;
      return {t: now};
    });
    if (!lock.committed) throw new HttpsError("already-exists", "This exact order was already submitted. Wait a minute before submitting it again.");
    let orderId = "OO-" + shortRefCode(now);
    for (let i = 1; i < 8 && (await db.ref("/orders/" + orderId).get()).exists(); i++) orderId = "OO-" + shortRefCode(now + i);
    const nowDate = new Date(now);
    const itemText = priced.lines.map((line) => `${line.name}${line.size ? ` (${line.size})` : ""}${line.optLabels.length ? ` [${line.optLabels.join(", ")}]` : ""} x${line.qty}`).join(", ");
    const order = {
      id: orderId, ownerUid: uid, name, phone, type: orderType, address, payment, contact, contactMethod,
      items: itemText, total: priced.total, notes, status: "Pending", receivedByCustomer: false,
      time: new Intl.DateTimeFormat("en-PH", {timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit"}).format(nowDate),
      date: new Intl.DateTimeFormat("en-PH", {timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric"}).format(nowDate),
      timestamp: now, lineItems: priced.lines.map(({cat, ...line}) => line), packages: priced.packages,
      extraCost: priced.extraCost, source: "online", pricingVersion: "server-v1", pricedAt: now,
      channel: "online", paymentStatus: "pending", payments: [{method: payment, amount: priced.total}],
    };
    const proofPath = `payment-proofs/${uid}/${orderId}.${proof.ext}`;
    const proofFile = getStorage().bucket(PROOF_BUCKET).file(proofPath);
    order.proofPath = proofPath;
    order.proofContentType = proof.contentType;
    order.proofBytes = proof.bytes.length;
    order.proofStorageVersion = 1;
    try {
      await proofFile.save(proof.bytes, {
        resumable: false,
        validation: "crc32c",
        metadata: {contentType: proof.contentType, cacheControl: "private, max-age=0, no-store", metadata: {orderId, ownerUid: uid}},
      });
      await db.ref().update({[`orders/${orderId}`]: order, [`activeOrders/${orderId}`]: activeOrderProjection(order), [`customerOrders/${uid}/${orderId}`]: {createdAt: now, status: "Pending"}});
    } catch (error) {
      try { await proofFile.delete({ignoreNotFound: true}); } catch (ignored) {}
      try { await lockRef.remove(); } catch (ignored) {}
      logger.error("createOnlineOrder proof/order write failed", {uid, orderId, error: String(error)});
      throw new HttpsError("internal", "Order could not be saved. Please try again.");
    }
    try {
      await db.ref(`/appCustomers/${uid}`).transaction((current) => {
        const profile = current || {};
        return Object.assign({}, profile, {name, phone, orders: Number(profile.orders || 0) + 1, firstSeen: profile.firstSeen || now, lastSeen: now, lastOrder: now, lastOrderId: orderId});
      });
    } catch (error) { logger.warn("Order saved but customer profile update failed", {uid, orderId, error: String(error)}); }
    try { await lockRef.update({id: orderId}); } catch (error) { logger.warn("Order saved but duplicate lock annotation failed", {uid, orderId}); }
    logger.info("Server-priced online order created", {orderId, uid, total: priced.total, appCheck: Boolean(request.app)});
    return {orderId, total: priced.total};
  },
);

exports.getPaymentProof = onCall(
  {region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    await requirePortalUser(db, request);
    const orderId = textField(request.data && request.data.orderId, "Order ID", 80, true);
    let order = (await db.ref(`/orders/${orderId}`).get()).val();
    if (!order) order = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
    if (!order) throw new HttpsError("not-found", "Order not found.");
    const proofPath = String(order.proofPath || "");
    if (!/^payment-proofs\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(proofPath) || proofPath.includes("..")) {
      throw new HttpsError("not-found", "This order has no stored payment proof.");
    }
    const file = getStorage().bucket(PROOF_BUCKET).file(proofPath);
    try {
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size || 0);
      const contentType = String(metadata.contentType || order.proofContentType || "");
      if (!/^image\/(jpeg|png|webp)$/i.test(contentType) || size <= 0 || size > MAX_PROOF_BYTES) {
        throw new Error("Stored proof metadata is invalid");
      }
      const [bytes] = await file.download();
      return {dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`, contentType, bytes: bytes.length};
    } catch (error) {
      logger.error("getPaymentProof failed", {orderId, proofPath, error: String(error)});
      throw new HttpsError("not-found", "Payment proof could not be loaded.");
    }
  },
);

exports.confirmOrderReceived = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Customer session is not ready.");
    const orderId = textField(request.data && request.data.orderId, "Order ID", 80, true);
    const db = getDatabase();
    const orderRef = db.ref(`/orders/${orderId}`);
    const snap = await orderRef.get();
    const order = snap.val();
    if (!order || order.ownerUid !== request.auth.uid) throw new HttpsError("permission-denied", "This order does not belong to this customer session.");
    if (order.status === "Received" && order.receivedByCustomer === true) return {status: "Received"};
    if (order.status !== "Ready" && order.status !== "Completed") throw new HttpsError("failed-precondition", "The order is not ready for receipt confirmation.");
    const receivedAt = Date.now();
    await orderRef.update({receivedByCustomer: true, status: "Received", receivedAt, receivedByUid: request.auth.uid});
    await db.ref(`/activeOrders/${orderId}`).update({receivedByCustomer: true, status: "Received", receivedAt, receivedByUid: request.auth.uid});
    await db.ref(`/customerOrders/${request.auth.uid}/${orderId}`).update({status: "Received", receivedAt});
    return {status: "Received"};
  },
);

exports.ensureActiveOrders = onCall(
  {region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const portal = await requirePortalUser(db, request);
    const canForce = ["owner", "superadmin", "admin", "manager"].includes(portal.role);
    const result = await rebuildActiveOrders(db, canForce && Boolean(request.data && request.data.force));
    logger.info("Active-order projection sweep", result);
    return result;
  },
);

exports.syncActiveOrderProjection = onValueWritten(
  {ref: "/orders/{orderId}", region: ORDER_REGION},
  async (event) => {
    const db = getDatabase();
    const orderId = event.params.orderId;
    const order = event.data.after.val();
    if (!order) {
      await db.ref(`/activeOrders/${orderId}`).remove();
      return;
    }
    const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
    if (shouldProjectOrder(order, activeShift)) {
      await db.ref(`/activeOrders/${orderId}`).set(activeOrderProjection(order));
    } else if (order.source === "pos" && (["Completed", "Received"].includes(order.status) || order.voided)) {
      const now = Date.now();
      await db.ref().update({[`archivedOrders/${orderId}`]: archivedOrderRecord(order, now), [`activeOrders/${orderId}`]: null, [`orders/${orderId}`]: null});
    } else {
      await db.ref(`/activeOrders/${orderId}`).remove();
    }
  },
);

exports.pruneClosedShiftOrders = onValueWritten(
  {ref: "/posActiveShift", region: ORDER_REGION},
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!before || !before.id || (after && after.id === before.id)) return;
    const db = getDatabase();
    const snap = await db.ref("/orders").orderByChild("shiftId").equalTo(before.id).get();
    const writes = {};
    snap.forEach((child) => {
      const order = child.val();
      if (!shouldProjectOrder(order, after || null) && order && order.source === "pos") {
        const now = Date.now();
        writes[`archivedOrders/${child.key}`] = archivedOrderRecord(order, now);
        writes[`activeOrders/${child.key}`] = null;
        writes[`orders/${child.key}`] = null;
      }
    });
    if (Object.keys(writes).length) await db.ref().update(writes);
  },
);

// Publish only the customer-safe availability bit. Cashier and shift details
// remain protected under /posActiveShift.
exports.syncPublicOrderStatus = onValueWritten(
  {ref: "/posActiveShift", region: ORDER_REGION},
  async (event) => {
    const shift = event.data.after.exists() ? (event.data.after.val() || {}) : null;
    const acceptingOrders = !!(shift && shift.status !== "closed");
    await getDatabase().ref("/publicOrderStatus").set({acceptingOrders, updatedAt: Date.now()});
  },
);

// Release 3B recipe normalization, unit conversion, usage, and COGS all come
// from the shared pure engine mirrored from assets/js/shared/costing.js.

exports.validateRecipeDefinition = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["recipes"]);
    const inventory = (await db.ref("/inventory").get()).val() || {};
    const result = Costing.normalizeRecipe(request.data && request.data.recipe, inventory);
    if (!result.ok) throw new HttpsError("invalid-argument", "Recipe is invalid: " + result.errors.slice(0, 5).map((x) => x.message).join(" | "), {errors: result.errors});
    logger.info("Recipe definition validated", {uid: actor.uid, engineVersion: Costing.VERSION, warnings: result.warnings.length});
    return {recipe: result.recipe, engineVersion: Costing.VERSION, warnings: result.warnings};
  },
);

// ---------------------------------------------------------------------------
// Release 3C: immutable, idempotent financial movements and server projections.
// ---------------------------------------------------------------------------
function financeKey(value, label = "ID") {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return key;
}
function financeText(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }
function financeDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD.");
  return date;
}
function financeDateFromTimestamp(value) {const parts = new Intl.DateTimeFormat("en-US", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(Number(value) || Date.now())); const map = {}; parts.forEach((part) => {map[part.type] = part.value;}); return `${map.year}-${map.month}-${map.day}`;}
const DEFAULT_CHART_ACCOUNTS = {
  sales_revenue:{code:"4000", name:"Sales revenue", type:"revenue", active:true, system:true}, platform_commission:{code:"5100", name:"Platform commission", type:"expense", active:true, system:true}, purchases:{code:"5200", name:"Purchases / inventory", type:"expense", active:true, system:true}, rent:{code:"5300", name:"Rent", type:"expense", active:true, system:true}, utilities:{code:"5310", name:"Utilities", type:"expense", active:true, system:true}, salaries:{code:"5320", name:"Salaries", type:"expense", active:true, system:true}, bank_charges:{code:"5330", name:"Bank charges", type:"expense", active:true, system:true}, supplies:{code:"5340", name:"Supplies", type:"expense", active:true, system:true}, owner_draw:{code:"3100", name:"Owner draw", type:"equity", active:true, system:true}, capital_in:{code:"3000", name:"Owner capital", type:"equity", active:true, system:true}, other_income:{code:"4900", name:"Other income", type:"revenue", active:true, system:true}, other_expense:{code:"5900", name:"Other expense", type:"expense", active:true, system:true}
};
async function ensureChartAccounts(db) {const snap = await db.ref("/chartOfAccounts").get(), current = snap.val() || {}, writes = {}; Object.keys(DEFAULT_CHART_ACCOUNTS).forEach((id) => {if (!current[id]) writes[`chartOfAccounts/${id}`] = Object.assign({}, DEFAULT_CHART_ACCOUNTS[id], {createdAt: Date.now(), schemaVersion: 1});}); if (Object.keys(writes).length) await db.ref().update(writes); return Object.assign({}, DEFAULT_CHART_ACCOUNTS, current);}
function chartAccountFor(chart, id) {const key = financeKey(id, "Accounting category"), row = chart[key]; if (!row || row.active === false) throw new HttpsError("failed-precondition", "The selected accounting category is inactive or missing."); return {id:key, row};}
function chartAccountFromLegacy(chart, category, dir) {const text=financeText(category,80).toLowerCase(), map={"purchases":"purchases","supplier payment":"purchases","rent":"rent","utilities":"utilities","salaries":"salaries","bank charges":"bank_charges","owner draw":"owner_draw","capital in":"capital_in","sales deposit":"sales_revenue","platform payout":"sales_revenue"}, id=map[text]||(dir==="out"?"other_expense":"other_income");return chartAccountFor(chart,id);}
function financeRecord(id, movement, actor) {
  const now = Date.now();
  return Object.assign({}, movement, {id, schemaVersion: 1, occurredAt: Number(movement.occurredAt || now), postedAt: now, actorUid: actor.uid, actorRole: actor.role, actorName: financeText(movement.actorName || actor.role, 100)});
}
function cashLedgerRecord(entry, movementId, movement, actor) {
  return {date: entry.date, accountId: entry.accountId, dir: entry.dir, category: entry.category, amount: Financial.money(entry.amount), party: financeText(entry.party || "", 120), ref: financeText(entry.ref || movement.sourceId || "", 120), source: movement.sourceType, linkId: movement.sourceId, movementId, method: financeText(entry.method || "", 60), auto: entry.auto === true, immutable: true, ts: Number(movement.occurredAt || Date.now()), by: actor.role};
}
async function commitFinancial(db, movementId, movement, actor, extraWrites = {}) {
  movementId = financeKey(movementId, "Movement ID");
  const ref = db.ref(`/financialMovements/${movementId}`);
  const existing = await ref.get();
  if (existing.exists()) return {duplicate: true, movement: existing.val()};
  const record = financeRecord(movementId, movement, actor);
  const writes = Object.assign({}, extraWrites, {[`financialMovements/${movementId}`]: record});
  await db.ref().update(writes);
  return {duplicate: false, movement: record};
}
function accountIdFor(dbAccounts, id) {
  const key = financeKey(id, "Cash account");
  if (!dbAccounts[key]) throw new HttpsError("failed-precondition", "The selected cash-flow account no longer exists.");
  return key;
}
async function findOrder(db, orderId) {
  const id = financeKey(orderId, "Order ID");
  let node = "orders", snap = await db.ref(`/orders/${id}`).get();
  if (!snap.exists()) { node = "archivedOrders"; snap = await db.ref(`/archivedOrders/${id}`).get(); }
  if (!snap.exists()) throw new HttpsError("not-found", "Order not found.");
  return {id, node, order: Object.assign({id}, snap.val() || {})};
}
async function postOrderFinancial(db, order, accounts, actor) {
  if (!order || !order.id || order.paymentStatus === "pending" || !["Completed", "Received", "Archived"].includes(String(order.status || ""))) return {skipped: true};
  const movement = Financial.orderPosting(order, accounts || {});
  if (order.paymentApprovalId) {movement.approvalId = order.paymentApprovalId; movement.approvedBy = financeText(order.paymentApprovedBy, 160);}
  movement.occurredAt = Number(order.completedAt || order.receivedAt || order.timestamp || Date.now());
  movement.actorName = order.onDuty || order.staff || "POS";
  const date = financeDateFromTimestamp(movement.occurredAt);
  const writes = {};
  (movement.cashEntries || []).forEach((entry) => { entry.date = date; entry.party = order.name || "Walk-in"; entry.ref = order.id; entry.auto = true; writes[`cfLedger/${entry.id}`] = cashLedgerRecord(entry, `sale_${order.id}`, movement, actor); });
  return commitFinancial(db, `sale_${order.id}`, movement, actor, writes);
}
function addOrderCashWrites(writes, movement, movementId, order, actor) {
  const occurredAt = Number(movement.occurredAt || Date.now());
  const date = financeDateFromTimestamp(occurredAt);
  (movement.cashEntries || []).forEach((entry, index) => {entry.date = date; entry.party = order.name || "Walk-in"; entry.ref = order.id; entry.auto = true; const id = `cf_${movementId}_${index}`; writes[`cfLedger/${id}`] = cashLedgerRecord(entry, movementId, movement, actor);});
}

exports.onOrderFinancialPosting = onValueWritten(
  {ref: "/orders/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || {}, afterRaw = event.data.after.val();
    if (!afterRaw) return;
    const order = Object.assign({id: event.params.orderId}, afterRaw);
    const db = getDatabase(); const accounts = (await db.ref("/cfAccounts").get()).val() || {}; const actor = {uid: "server", role: "server"};
    await postOrderFinancial(db, order, accounts, actor);
    const beforeRefund = Financial.money(before.refundAmount), afterRefund = Financial.money(order.refundAmount);
    if (afterRefund > beforeRefund) {
      const delta = Financial.money(afterRefund - beforeRefund), movement = Financial.reversalPosting(order, delta, "refund", accounts);
      movement.occurredAt = Number(order.refundedAt || Date.now()); movement.actorName = order.refundedBy || order.staff || "Refund";
      const movementId = `refund_${order.id}_${Math.round(afterRefund * 100)}`, writes = {}; addOrderCashWrites(writes, movement, movementId, order, actor); await commitFinancial(db, movementId, movement, actor, writes);
    }
    if (order.voided === true && before.voided !== true) {
      const remaining = Financial.money(Math.max(0, Financial.money(order.total) - afterRefund));
      if (remaining > 0) { const movement = Financial.reversalPosting(order, remaining, "void", accounts); movement.occurredAt = Number(order.voidedAt || Date.now()); movement.actorName = order.voidedBy || order.staff || "Void"; const movementId = `void_${order.id}`, writes = {}; addOrderCashWrites(writes, movement, movementId, order, actor); await commitFinancial(db, movementId, movement, actor, writes); }
    }
  },
);

async function postShiftCashEntries(db, shiftId, entries, kind) {
  const actor = {uid: "server", role: "server"};
  for (let index = 0; index < (entries || []).length; index++) { const entry = entries[index] || {}, value = Financial.money(entry.amount); if (!(value > 0)) continue; const token = `${Number(entry.ts || 0)}_${index}`, movementId = `${kind}_${shiftId}_${token}`, isIn = kind === "shift_payin"; if (!isIn && /^petty cash replenish/i.test(String(entry.reason || ""))) continue; const lines = isIn ? [Financial.line("asset:register_cash", value, 0, entry.reason || "Cash in"), Financial.line(`offset:cash_in:${financeText(entry.reason || "other", 60)}`, 0, value, entry.reason || "Cash in")] : [Financial.line(`expense:cash_out:${financeText(entry.reason || "other", 60)}`, value, 0, entry.reason || "Cash out"), Financial.line("asset:register_cash", 0, value, entry.reason || "Cash out")]; const movement = Financial.movement(kind, "shift", shiftId, lines, {occurredAt: Number(entry.ts || Date.now()), actorName: entry.by || "Register"}); await commitFinancial(db, movementId, movement, actor); }
}
exports.onShiftPayInsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payIns", region: ORDER_REGION, retry: true}, async (event) => {if (!event.data.after.exists()) return; await postShiftCashEntries(getDatabase(), event.params.shiftId, event.data.after.val() || [], "shift_payin");});
exports.onShiftPayOutsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payOuts", region: ORDER_REGION, retry: true}, async (event) => {if (!event.data.after.exists()) return; await postShiftCashEntries(getDatabase(), event.params.shiftId, event.data.after.val() || [], "shift_payout");});
exports.onShiftOpenFinancial = onValueWritten({ref: "/shifts/{shiftId}", region: ORDER_REGION, retry: true}, async (event) => {if (event.data.before.exists() || !event.data.after.exists()) return; const shift=event.data.after.val()||{}, value=Financial.money(shift.openingFloat); if (!(value>0)) return; const db=getDatabase(), custody=(await db.ref("/cashCustody").get()).val()||{}, rows=Object.keys(custody).map((id)=>Object.assign({id},custody[id])).filter((x)=>Financial.money(x.remaining)>0).sort((a,b)=>Number(a.closedAt||0)-Number(b.closedAt||0)),writes={},allocations={};let need=value,fromCustody=0;for(const row of rows){if(need<=0)break;const available=Financial.money(row.remaining),use=Financial.money(Math.min(need,available));if(!(use>0))continue;allocations[row.id]=use;fromCustody=Financial.money(fromCustody+use);need=Financial.money(need-use);const next=Financial.money(available-use);writes[`cashCustody/${row.id}/remaining`]=next;writes[`cashCustody/${row.id}/status`]=next>0?"partially_issued":"issued_to_float";writes[`cashCustody/${row.id}/issuedToFloat`]=Financial.money(Number(row.issuedToFloat||0)+use);writes[`cashCustody/${row.id}/lastIssuedShiftId`]=event.params.shiftId;writes[`cashCustody/${row.id}/lastIssuedAt`]=Date.now();}const lines=[Financial.line("asset:register_cash",value,0,"Opening float issued")];if(fromCustody>0)lines.push(Financial.line("asset:cash_awaiting_deposit",0,fromCustody,"Opening float from custody"));if(need>0)lines.push(Financial.line("equity:cash_float_source",0,need,"Opening float from outside custody"));const movement=Financial.movement("shift_opening_float","shift",event.params.shiftId,lines,{occurredAt:Number(shift.openAt||Date.now()),actorName:shift.staff||"Register",custodyAllocations:allocations});await commitFinancial(db,`shift_open_float_${event.params.shiftId}`,movement,{uid:"server",role:"server"},writes);});
exports.onShiftCloseFinancial = onValueWritten({ref: "/shifts/{shiftId}/status", region: ORDER_REGION, retry: true}, async (event) => {if (event.data.after.val() !== "closed" || event.data.before.val() === "closed") return; const db = getDatabase(), id=event.params.shiftId, shift = (await db.ref(`/shifts/${id}`).get()).val() || {}, actor={uid:"server",role:"server"}, occurredAt=Number(shift.closeAt||Date.now()), remittable=Financial.money(Math.max(0,Number(shift.cashToSettle)||0)); if (remittable>0) {const custody=Financial.movement("shift_cash_to_custody","shift",id,[Financial.line("asset:cash_awaiting_deposit",remittable,0,"Closed shift cash to settle"),Financial.line("asset:register_cash",0,remittable,"Closed shift cash to settle")],{occurredAt,actorName:shift.staff||"Register",retainedFloat:Financial.money(shift.retainedFloat)}); await commitFinancial(db,`shift_custody_${id}`,custody,actor,{[`cashCustody/${id}`]:{shiftId:id,staff:financeText(shift.staff,100),amount:remittable,depositedAmount:0,remaining:remittable,retainedFloat:Financial.money(shift.retainedFloat),status:"awaiting_deposit",closedAt:occurredAt,movementId:`shift_custody_${id}`,schemaVersion:2}});} const value = Financial.money(Math.abs(Number(shift.variance) || 0)); if (!(value > 0)) return; const short = Number(shift.variance) < 0, lines = short ? [Financial.line("expense:cash_shortage", value, 0, "Cash shortage"), Financial.line("asset:register_cash", 0, value, "Cash shortage")] : [Financial.line("asset:register_cash", value, 0, "Cash overage"), Financial.line("revenue:cash_overage", 0, value, "Cash overage")]; const movement = Financial.movement("shift_cash_variance", "shift", id, lines, {occurredAt, actorName: shift.staff || "Register"}); await commitFinancial(db, `shift_variance_${id}`, movement, actor);});

exports.onPettyVoucherFinancial = onValueWritten(
  {ref: "/pettyCashVouchers/{voucherId}", region: ORDER_REGION, retry: true},
  async (event) => {const before = event.data.before.val() || {}, after = event.data.after.val(); if (!after) return; const db = getDatabase(), id = event.params.voucherId, value = Financial.money(after.amount), actor = {uid: "server", role: "server"}; if (after.status === "approved" && before.status !== "approved" && value > 0) {const movement = Financial.movement("petty_cash_expense", "pettyVoucher", id, [Financial.line(`expense:petty:${financeText(after.category || "other", 60)}`, value, 0, after.category), Financial.line("asset:petty_cash", 0, value, "Petty cash")], {occurredAt: Number(after.approvedAt || Date.now()), actorName: after.approvedBy || "Manager"}); await commitFinancial(db, `petty_${id}`, movement, actor);} if (after.voided === true && before.voided !== true && after.status === "approved" && value > 0) {const movement = Financial.movement("petty_cash_void", "pettyVoucher", id, [Financial.line("asset:petty_cash", value, 0, "Petty cash restored"), Financial.line(`expense:petty:${financeText(after.category || "other", 60)}`, 0, value, "Reverse petty expense")], {occurredAt: Number(after.voidedAt || Date.now()), actorName: "Manager"}); await commitFinancial(db, `petty_void_${id}`, movement, actor);}},
);
exports.onPettyReplenishmentFinancial = onValueWritten(
  {ref: "/pettyCashReplenishments/{replenishmentId}", region: ORDER_REGION, retry: true},
  async (event) => {if (!event.data.after.exists() || event.data.before.exists()) return; const row = event.data.after.val() || {}, value = Financial.money(row.amount); if (!(value > 0)) return; const id = event.params.replenishmentId, source = row.source === "register" ? "asset:register_cash" : "equity:owner_capital", movement = Financial.movement("petty_cash_replenishment", "pettyReplenishment", id, [Financial.line("asset:petty_cash", value, 0, "Petty cash replenished"), Financial.line(source, 0, value, row.source || "owner")], {occurredAt: Number(row.ts || Date.now()), actorName: row.by || "Admin"}); await commitFinancial(getDatabase(), `petty_replenish_${id}`, movement, {uid: "server", role: "server"});},
);
async function backfillPettyVoucher(db, id, row) {const value = Financial.money(row && row.amount), actor = {uid: "server", role: "server"}; if (!row || row.status !== "approved" || !(value > 0)) return; const expense = Financial.movement("petty_cash_expense", "pettyVoucher", id, [Financial.line(`expense:petty:${financeText(row.category || "other", 60)}`, value, 0, row.category), Financial.line("asset:petty_cash", 0, value, "Petty cash")], {occurredAt: Number(row.approvedAt || row.createdAt || Date.now()), actorName: row.approvedBy || "Manager"}); await commitFinancial(db, `petty_${id}`, expense, actor); if (row.voided === true) {const reversal = Financial.movement("petty_cash_void", "pettyVoucher", id, [Financial.line("asset:petty_cash", value, 0, "Petty cash restored"), Financial.line(`expense:petty:${financeText(row.category || "other", 60)}`, 0, value, "Reverse petty expense")], {occurredAt: Number(row.voidedAt || Date.now()), actorName: "Manager"}); await commitFinancial(db, `petty_void_${id}`, reversal, actor);}}
async function backfillPettyReplenishment(db, id, row) {const value = Financial.money(row && row.amount); if (!(value > 0)) return; const source = row.source === "register" ? "asset:register_cash" : "equity:owner_capital", movement = Financial.movement("petty_cash_replenishment", "pettyReplenishment", id, [Financial.line("asset:petty_cash", value, 0, "Petty cash replenished"), Financial.line(source, 0, value, row.source || "owner")], {occurredAt: Number(row.ts || Date.now()), actorName: row.by || "Admin"}); await commitFinancial(db, `petty_replenish_${id}`, movement, {uid: "server", role: "server"});}
async function backfillShiftVariance(db, id, shift) {if (!shift || shift.status !== "closed") return; const value = Financial.money(Math.abs(Number(shift.variance) || 0)); if (!(value > 0)) return; const short = Number(shift.variance) < 0, lines = short ? [Financial.line("expense:cash_shortage", value, 0, "Cash shortage"), Financial.line("asset:register_cash", 0, value, "Cash shortage")] : [Financial.line("asset:register_cash", value, 0, "Cash overage"), Financial.line("revenue:cash_overage", 0, value, "Cash overage")]; const movement = Financial.movement("shift_cash_variance", "shift", id, lines, {occurredAt: Number(shift.closeAt || Date.now()), actorName: shift.staff || "Register"}); await commitFinancial(db, `shift_variance_${id}`, movement, {uid: "server", role: "server"});}
async function backfillOpeningBalance(db, movementId, sourceType, sourceId, assetAccount, rawAmount, occurredAt, label) {
  const value = Financial.money(rawAmount); if (!value) return {skipped: true}; const absolute = Math.abs(value), lines = value > 0 ? [Financial.line(assetAccount, absolute, 0, label), Financial.line("equity:opening_balance", 0, absolute, label)] : [Financial.line("equity:opening_balance", absolute, 0, label), Financial.line(assetAccount, 0, absolute, label)];
  return commitFinancial(db, movementId, Financial.movement("opening_balance", sourceType, sourceId, lines, {occurredAt: Number(occurredAt || Date.now()), actorName: "3C migration"}), {uid: "server", role: "server"});
}
async function backfillFinancialDocument(db, id, row, isReceivable, accounts) {
  if (!row) return []; const value = Financial.money(row.amount); if (!(value > 0)) return []; const path = isReceivable ? "receivables" : "payables", source = isReceivable ? "receivable" : "payable", type = financeText(row.type || "legacy", 60), party = financeText(row.party || "Legacy balance", 120), occurredAt = Number(row.ts || Date.parse(`${row.date || ""}T00:00:00+08:00`) || Date.now()), movementId = financeText(row.movementId, 160) || `legacy_${isReceivable ? "ar" : "ap"}_${id}`;
  const recognitionLines = isReceivable ? [Financial.line(`asset:receivable:${id}`, value, 0, party), Financial.line(`revenue:${type}`, 0, value, party)] : [Financial.line(`expense_or_inventory:${type}`, value, 0, party), Financial.line(`liability:payable:${id}`, 0, value, party)];
  const results = [await commitFinancial(db, movementId, Financial.movement(`${source}_created`, source, id, recognitionLines, {occurredAt, actorName: "3C migration"}), {uid: "server", role: "server"})];
  const settled = isReceivable ? row.status === "collected" : row.status === "paid"; if (!settled || !row.accountId || !accounts[row.accountId]) return results; const settlementId = financeText(row.settlementMovementId, 160) || `legacy_${isReceivable ? "ar_collect" : "ap_pay"}_${id}`, asset = `asset:cash_account:${row.accountId}`, settlementLines = isReceivable ? [Financial.line(asset, value, 0, "Legacy AR collection"), Financial.line(`asset:receivable:${id}`, 0, value, "Legacy AR collection")] : [Financial.line(`liability:payable:${id}`, value, 0, "Legacy AP payment"), Financial.line(asset, 0, value, "Legacy AP payment")];
  results.push(await commitFinancial(db, settlementId, Financial.movement(isReceivable ? "receivable_collected" : "payable_paid", path, id, settlementLines, {occurredAt: Number(row.collectedAt || row.paidAt || occurredAt), actorName: "3C migration"}), {uid: "server", role: "server"})); return results;
}

exports.postFinancialCommand = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 40);
    const perms = action.includes("payable") ? ["payables", "purchases"] : action.includes("receivable") ? ["receivables"] : ["cashflow", "receivables", "payables", "purchases"];
    const actor = await requirePortalPermission(db, request, perms); const commandId = financeKey(data.commandId, "Command ID");
    const accounts = (await db.ref("/cfAccounts").get()).val() || {}, chart = await ensureChartAccounts(db); const now = Date.now(); let movement, writes = {}, result = {};
    function amount(v) { const x = Financial.money(v); if (!(x > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero."); return x; }
    function addCash(id, entry) { writes[`cfLedger/${id}`] = cashLedgerRecord(entry, commandId, movement, actor); }
    if (action === "manual") {
      const accountId = accountIdFor(accounts, data.accountId), value = amount(data.amount), dir = data.dir === "out" ? "out" : "in", selected = data.offsetAccountId ? chartAccountFor(chart, data.offsetAccountId) : chartAccountFromLegacy(chart, data.category, dir), category = financeText(selected.row.name, 80), asset = `asset:cash_account:${accountId}`, offset = `${selected.row.type}:${selected.id}`;
      movement = Financial.movement("manual_cash", "manual", commandId, dir === "in" ? [Financial.line(asset, value, 0, category), Financial.line(offset, 0, value, category)] : [Financial.line(offset, value, 0, category), Financial.line(asset, 0, value, category)], {occurredAt: now, actorName: financeText(data.actorName || "")});
      addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir, category, amount: value, party: data.party, ref: data.ref, auto: false});
    } else if (action === "transfer") {
      const from = accountIdFor(accounts, data.fromAccountId), to = accountIdFor(accounts, data.toAccountId); if (from === to) throw new HttpsError("invalid-argument", "Transfer accounts must be different."); const value = amount(data.amount), date = financeDate(data.date);
      movement = Financial.movement("cash_transfer", "transfer", commandId, [Financial.line(`asset:cash_account:${to}`, value, 0, "Transfer in"), Financial.line(`asset:cash_account:${from}`, 0, value, "Transfer out")], {occurredAt: now});
      addCash(`fm_${commandId}_out`, {date, accountId: from, dir: "out", category: "Transfer", amount: value, party: `→ ${financeText(accounts[to].name)}`}); addCash(`fm_${commandId}_in`, {date, accountId: to, dir: "in", category: "Transfer", amount: value, party: `← ${financeText(accounts[from].name)}`});
    } else if (action === "create_receivable" || action === "create_payable") {
      const isAr = action === "create_receivable", docId = financeKey(data.documentId, isAr ? "Receivable ID" : "Payable ID"), value = amount(data.amount), party = financeText(data.party, 120), documentType = financeText(data.type || "other", 60).toLowerCase(); if (!party) throw new HttpsError("invalid-argument", "Party is required.");
      if (!isAr && documentType === "inventory") throw new HttpsError("failed-precondition", "Inventory payables must be created from Purchases so the stock receipt and supplier liability stay linked.");
      movement = Financial.movement(isAr ? "receivable_created" : "payable_created", isAr ? "receivable" : "payable", docId, isAr ? [Financial.line(`asset:receivable:${docId}`, value, 0, party), Financial.line(`revenue:${documentType}`, 0, value, party)] : [Financial.line(`expense_or_inventory:${documentType}`, value, 0, party), Financial.line(`liability:payable:${docId}`, 0, value, party)], {occurredAt: now});
      const record = {party, type: documentType, amount: value, date: financeDate(data.date), due: data.due ? financeDate(data.due) : "", ref: financeText(data.ref, 120), status: "open", movementId: commandId, ts: now, createdBy: actor.uid, schemaVersion: 1}; writes[`${isAr ? "receivables" : "payables"}/${docId}`] = record; result.documentId = docId;
    } else if (["collect_receivable", "pay_payable", "reverse_receivable", "reverse_payable"].includes(action)) {
      const isAr = action.includes("receivable"), isReverse = action.startsWith("reverse_"), docId = financeKey(data.documentId, "Document ID"), path = isAr ? "receivables" : "payables", snap = await db.ref(`/${path}/${docId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Financial document not found."); const doc = snap.val(); if (doc.status !== "open") throw new HttpsError("failed-precondition", "This document is no longer open."); if (!isAr && doc.provisional === true && !isReverse) throw new HttpsError("failed-precondition", "Finalize the supplier invoice before paying this provisional obligation."); if (!isAr && doc.purchaseInvoiceId && isReverse) throw new HttpsError("failed-precondition", "Reverse purchase-linked obligations from Purchases so inventory and finance remain synchronized."); const value = amount(doc.amount);
      if (isReverse) {
        movement = Financial.movement(isAr ? "receivable_reversed" : "payable_reversed", path, docId, isAr ? [Financial.line(`revenue:${doc.type || "other"}`, value, 0, "Reverse receivable"), Financial.line(`asset:receivable:${docId}`, 0, value, "Reverse receivable")] : [Financial.line(`liability:payable:${docId}`, value, 0, "Reverse payable"), Financial.line(`expense_or_inventory:${doc.type || "other"}`, 0, value, "Reverse payable")], {occurredAt: now}); writes[`${path}/${docId}/status`] = "reversed"; writes[`${path}/${docId}/reversedAt`] = now; writes[`${path}/${docId}/reversalMovementId`] = commandId;
      } else {
        const accountId = accountIdFor(accounts, data.accountId), date = financeDate(data.date), asset = `asset:cash_account:${accountId}`;
        movement = Financial.movement(isAr ? "receivable_collected" : "payable_paid", path, docId, isAr ? [Financial.line(asset, value, 0, "AR collection"), Financial.line(`asset:receivable:${docId}`, 0, value, "AR collection")] : [Financial.line(`liability:payable:${docId}`, value, 0, "AP payment"), Financial.line(asset, 0, value, "AP payment")], {occurredAt: now}); addCash(`fm_${commandId}`, {date, accountId, dir: isAr ? "in" : "out", category: isAr ? "AR collection" : "AP payment", amount: value, party: doc.party, ref: doc.ref}); writes[`${path}/${docId}/status`] = isAr ? "collected" : "paid"; writes[`${path}/${docId}/${isAr ? "collectedAt" : "paidAt"}`] = now; writes[`${path}/${docId}/settlementMovementId`] = commandId; writes[`${path}/${docId}/accountId`] = accountId;
      }
    } else if (action === "payout_deposit") {
      const payoutId = financeKey(data.payoutId, "Payout ID"), snap = await db.ref(`/platformPayouts/${payoutId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Payout not found."); const payout = snap.val(); if (payout.depositMovementId) throw new HttpsError("already-exists", "This payout deposit is already recorded."); const accountId = accountIdFor(accounts, data.accountId), value = amount(payout.actualPayout);
      movement = Financial.movement("platform_payout_deposit", "platformPayout", payoutId, [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Platform payout deposit"), Financial.line(`asset:platform_clearing:${payout.channel}`, 0, value, "Clear platform payout")], {occurredAt: now}); addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir: "in", category: "Platform payout", amount: value, party: payout.channel, ref: payoutId}); writes[`platformPayouts/${payoutId}/depositMovementId`] = commandId; writes[`platformPayouts/${payoutId}/depositedAt`] = now; writes[`platformPayouts/${payoutId}/accountId`] = accountId;
    } else if (action === "cash_deposit") {
      const accountId = accountIdFor(accounts, data.accountId), allocations = data.allocations || {}, ids = Object.keys(allocations); if (!ids.length) throw new HttpsError("invalid-argument", "Select cash custody records to deposit."); let value = 0; for (const id of ids) {const key = financeKey(id, "Custody ID"), row = (await db.ref(`/cashCustody/${key}`).get()).val(); if (!row) throw new HttpsError("not-found", `Cash custody ${key} was not found.`); const use = amount(allocations[id]), remaining = Financial.money(row.remaining != null ? row.remaining : row.amount); if (use > remaining + 0.009) throw new HttpsError("failed-precondition", `Deposit exceeds remaining custody for ${key}.`); value = Financial.money(value + use); const next = Financial.money(remaining - use); writes[`cashCustody/${key}/depositedAmount`] = Financial.money(Number(row.depositedAmount || 0) + use); writes[`cashCustody/${key}/remaining`] = next; writes[`cashCustody/${key}/status`] = next > 0 ? "partially_deposited" : "deposited"; writes[`cashCustody/${key}/lastDepositMovementId`] = commandId; writes[`cashCustody/${key}/lastDepositAt`] = now; }
      movement = Financial.movement("register_cash_deposit", "cashCustody", ids.join("_"), [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Register cash deposited"), Financial.line("asset:cash_awaiting_deposit", 0, value, "Clear cash custody")], {occurredAt: now}); addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir: "in", category: "Register cash deposit", amount: value, party: "Register cash custody", ref: ids.join(",")}); result.amount = value;
    } else throw new HttpsError("invalid-argument", "Unsupported financial command.");
    const committed = await commitFinancial(db, commandId, movement, actor, writes); return Object.assign(result, {movementId: commandId, duplicate: committed.duplicate});
  },
);

// Reconciles the one-to-one link between an on-account purchase invoice and
// its payable. Safe to retry: the invoice, payable and financial movement use
// deterministic IDs, while legacy/manual matches are linked instead of copied.
exports.reconcilePurchasePayable = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["purchases", "payables"]), data = request.data || {};
    const requestedId = financeText(data.invoiceId, 160), requestedRef = financeText(data.invoiceRef, 120);
    const invoices = (await db.ref("/purchaseInvoices").get()).val() || {};
    let invoiceId = requestedId && invoices[requestedId] ? requestedId : "";
    if (!invoiceId && requestedRef) {
      const matches = Object.keys(invoices).filter((id) => financeText(invoices[id] && invoices[id].ref, 120).toLowerCase() === requestedRef.toLowerCase());
      if (matches.length > 1) throw new HttpsError("failed-precondition", "More than one purchase uses this invoice reference. Use the purchase invoice ID.");
      invoiceId = matches[0] || "";
    }
    if (!invoiceId) throw new HttpsError("not-found", "Purchase invoice was not found.");
    const invoice = invoices[invoiceId] || {};
    const legacyNoLiability = invoice.payMode === "none" && data.recovery === true, provisional = invoice.payMode === "pending";
    if (invoice.payMode !== "account" && !provisional && !legacyNoLiability) throw new HttpsError("failed-precondition", "This purchase is not eligible for payable reconciliation.");
    const amount = Financial.money(invoice.total); if (!(amount > 0)) throw new HttpsError("failed-precondition", "Purchase invoice total is invalid.");
    const party = financeText(invoice.supplier, 120); if (!party) throw new HttpsError("failed-precondition", "A supplier is required before recording the obligation.");
    const ref = financeText(data.invoiceRef || invoice.ref || `PENDING-${invoiceId}`, 120), date = financeDate(invoice.date), due = data.due ? financeDate(data.due) : (invoice.due ? financeDate(invoice.due) : ""), finalizing = provisional && data.finalize === true;
    if (finalizing && (!financeText(data.invoiceRef,120) || !due)) throw new HttpsError("invalid-argument", "Final invoice reference and due date are required.");
    const payables = (await db.ref("/payables").get()).val() || {}, baseCanonicalId=financeKey(`ap_${invoiceId}`,"Payable ID"), repairingReversed=payables[baseCanonicalId]&&payables[baseCanonicalId].status==="reversed", canonicalId=repairingReversed?financeKey(`ap_repair_${invoiceId}`,"Payable ID"):baseCanonicalId, movementId=financeKey(`${repairingReversed?"purchase_ap_repair":"purchase_ap"}_${invoiceId}`,"Movement ID");
    const candidates = Object.keys(payables).filter((id) => {const row=payables[id]||{},claimedBy=financeText(row.purchaseInvoiceId,160);return row.status==="open"&&Financial.money(row.amount)===amount&&financeText(row.party,120).toLowerCase()===party.toLowerCase()&&(!claimedBy||claimedBy===invoiceId);}).map((id)=>({id,party:financeText(payables[id].party,120),ref:financeText(payables[id].ref,120),due:payables[id].due||"",amount:Financial.money(payables[id].amount)}));
    if (data.preview === true) return {invoiceId,amount,party,candidates};
    const requestedPayableId=financeText(data.linkPayableId,160);
    if (requestedPayableId) {
      const selected=payables[financeKey(requestedPayableId,"Payable ID")],selectedId=financeKey(requestedPayableId,"Payable ID");if (!selected||selected.status!=="open") throw new HttpsError("failed-precondition","The selected payable is missing or is no longer open.");if (Financial.money(selected.amount)!==amount||financeText(selected.party,120).toLowerCase()!==party.toLowerCase()) throw new HttpsError("failed-precondition","The payable supplier or amount does not match this purchase.");if (selected.purchaseInvoiceId&&selected.purchaseInvoiceId!==invoiceId) throw new HttpsError("failed-precondition","The selected payable is already linked to another purchase.");const claimed=Object.keys(invoices).some((id)=>id!==invoiceId&&financeText(invoices[id]&&invoices[id].payableId,160)===selectedId);if (claimed) throw new HttpsError("failed-precondition","Another purchase already claims this payable.");const now=Date.now(),reason=financeText(data.reason,300);if (!reason) throw new HttpsError("invalid-argument","A linking reason is required.");const writes={[`purchaseInvoices/${invoiceId}/payMode`]:"account",[`purchaseInvoices/${invoiceId}/payableId`]:selectedId,[`purchaseInvoices/${invoiceId}/due`]:selected.due||invoice.due||"",[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`payables/${selectedId}/purchaseInvoiceId`]:invoiceId,[`payables/${selectedId}/linkedAt`]:now,[`operationalAudit/${now}_purchase_link_${invoiceId}`]:{action:"link_existing_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId:selectedId,amount,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/payMode`]="account";writes[`stockReceipts/${id}/payableId`]=selectedId;});await db.ref().update(writes);return {invoiceId,payableId:selectedId,amount,result:"linked_existing"};
    }
    const linkedId = financeText(invoice.payableId, 160), exact = [], refConflicts = [];
    Object.keys(payables).forEach((id) => {const row = payables[id] || {}, open=row.status==="open", sameLink = open&&(id === canonicalId || id === linkedId || row.purchaseInvoiceId === invoiceId || row.movementId === movementId), sameRef = open&&ref&&financeText(row.ref, 120).toLowerCase() === ref.toLowerCase();if (sameLink || (sameRef && Financial.money(row.amount) === amount && financeText(row.party, 120).toLowerCase() === party.toLowerCase())) exact.push(id);else if (sameRef) refConflicts.push(id);});
    const unique = [...new Set(exact)];
    if (unique.length > 1) throw new HttpsError("failed-precondition", "Multiple payables may belong to this purchase. Management review is required before recovery.");
    if (!unique.length && refConflicts.length) throw new HttpsError("failed-precondition", "A payable with this invoice reference has a different supplier or amount. Review it before recovery.");
    const now = Date.now(), auditId = `${now}_purchase_payable_${invoiceId}`;
    if (unique.length === 1) {
      const payableId = unique[0], row = payables[payableId] || {};
      if (Financial.money(row.amount) !== amount) throw new HttpsError("failed-precondition", "The linked payable amount does not match the purchase invoice.");
      const linkedWrites = {[`purchaseInvoices/${invoiceId}/payableId`]:payableId,[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`purchaseInvoices/${invoiceId}/due`]:due||row.due||"",[`payables/${payableId}/purchaseInvoiceId`]:invoiceId,[`operationalAudit/${auditId}`]:{action:"reconcile_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId,result:finalizing?"invoice_finalized":"linked_existing",amount,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      if (finalizing) {const finalizeId=`purchase_grni_finalize_${invoiceId}`, movement=Financial.movement("grni_finalized","purchaseInvoice",invoiceId,[Financial.line(`liability:grni:${payableId}`,amount,0,"Clear goods received not invoiced"),Financial.line(`liability:payable:${payableId}`,0,amount,"Recognize supplier invoice")],{occurredAt:now,actorName:actor.role});Object.assign(linkedWrites,{[`purchaseInvoices/${invoiceId}/payMode`]:"account",[`purchaseInvoices/${invoiceId}/ref`]:ref,[`purchaseInvoices/${invoiceId}/invoiceFinalizedAt`]:now,[`payables/${payableId}/ref`]:ref,[`payables/${payableId}/due`]:due,[`payables/${payableId}/type`]:"inventory",[`payables/${payableId}/provisional`]:false,[`payables/${payableId}/invoiceFinalizedAt`]:now});await commitFinancial(db,finalizeId,movement,actor,linkedWrites);} else await db.ref().update(linkedWrites);
      return {invoiceId, payableId, amount, result: finalizing ? "invoice_finalized" : "linked_existing"};
    }
    const payable = {party,type:provisional?"inventory_pending_invoice":"inventory",amount,date,due,ref,status:"open",provisional,movementId,purchaseInvoiceId:invoiceId,ts:now,createdBy:actor.uid,recovered:data.recovery === true,schemaVersion:1};
    const writes = {[`payables/${canonicalId}`]:payable,[`purchaseInvoices/${invoiceId}/payableId`]:canonicalId,[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`purchaseInvoices/${invoiceId}/due`]:due,[`purchaseInvoices/${invoiceId}/ref`]:ref,[`purchaseInvoices/${invoiceId}/payMode`]:legacyNoLiability?"account":invoice.payMode,[`operationalAudit/${auditId}`]:{action:"reconcile_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId:canonicalId,result:provisional?"grni_created":(legacyNoLiability?"legacy_liability_created":"created"),amount,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
    const movementSnap = await db.ref(`/financialMovements/${movementId}`).get();
    if (movementSnap.exists()) await db.ref().update(writes);
    else {const movement = Financial.movement(provisional?"grni_created":"payable_created", "payable", canonicalId, [Financial.line("expense_or_inventory:inventory", amount, 0, party), Financial.line(provisional?`liability:grni:${canonicalId}`:`liability:payable:${canonicalId}`, 0, amount, party)], {occurredAt:Number(Date.parse(`${date}T00:00:00+08:00`)||now),actorName:actor.role});await commitFinancial(db, movementId, movement, actor, writes);}
    return {invoiceId, payableId: canonicalId, amount, result: movementSnap.exists() ? "recreated_from_movement" : "created"};
  },
);

// Controlled purchase correction boundary. Metadata corrections preserve the
// original financial amount. Reversals offset inventory and finance with
// deterministic IDs so an interrupted request is safe to retry.
exports.managePurchaseCorrection = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["purchases"]), data = request.data || {}, action = financeText(data.action, 30);
    const invoices = (await db.ref("/purchaseInvoices").get()).val() || {}, requestedId = financeText(data.invoiceId, 160), requestedRef = financeText(data.invoiceRef, 120);
    let invoiceId = requestedId && invoices[requestedId] ? requestedId : "";
    if (!invoiceId && requestedRef) {const matches = Object.keys(invoices).filter((id) => financeText(invoices[id] && invoices[id].ref, 120).toLowerCase() === requestedRef.toLowerCase());if (matches.length > 1) throw new HttpsError("failed-precondition", "More than one purchase uses this reference. Management review is required.");invoiceId = matches[0] || "";}
    if (!invoiceId) throw new HttpsError("not-found", "Purchase invoice was not found.");
    const invoice = invoices[invoiceId] || {}, safeInvoice = {id:invoiceId,supplier:financeText(invoice.supplier,120),ref:financeText(invoice.ref,120),date:invoice.date||"",due:invoice.due||"",by:financeText(invoice.by,120),payMode:invoice.payMode||"none",payableId:invoice.payableId||"",total:Financial.money(invoice.total),lines:Array.isArray(invoice.lines)?invoice.lines:[]};
    if (action === "lookup") return {invoice:safeInvoice,reversed:invoice.reversed===true};
    if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase has already been reversed.");
    const now = Date.now(), reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    if (action === "correct_details") {
      const next = {ref:financeText(data.ref,120),due:data.due?financeDate(data.due):"",by:financeText(data.by,120)}; if (!next.ref) throw new HttpsError("invalid-argument", "Invoice reference is required.");
      const duplicate = Object.keys(invoices).some((id) => id !== invoiceId && financeText(invoices[id] && invoices[id].ref,120).toLowerCase() === next.ref.toLowerCase());if (duplicate) throw new HttpsError("already-exists", "Another purchase already uses this invoice reference.");
      const writes = {[`purchaseInvoices/${invoiceId}/ref`]:next.ref,[`purchaseInvoices/${invoiceId}/due`]:next.due,[`purchaseInvoices/${invoiceId}/by`]:next.by,[`purchaseInvoices/${invoiceId}/lastCorrectionAt`]:now,[`purchaseInvoices/${invoiceId}/lastCorrectionBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/lastCorrectionReason`]:reason,[`operationalAudit/${now}_purchase_correct_${invoiceId}`]:{action:"correct_purchase_details",sourceType:"purchaseInvoice",sourceId:invoiceId,before:{ref:invoice.ref||"",due:invoice.due||"",by:invoice.by||""},after:next,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      (invoice.receiptIds||[]).forEach((id) => {writes[`stockReceipts/${id}/ref`]=next.ref;writes[`stockReceipts/${id}/receivedBy`]=next.by;});if (invoice.payableId) {writes[`payables/${invoice.payableId}/ref`]=next.ref;writes[`payables/${invoice.payableId}/due`]=next.due;}
      await db.ref().update(writes);return {invoiceId,result:"corrected",invoice:Object.assign({},safeInvoice,next)};
    }
    if (action !== "reverse") throw new HttpsError("invalid-argument", "Purchase correction action is invalid.");
    const approval = await claimManagerApproval(db, data, "reverse_purchase", invoiceId, safeInvoice.total, `reverse_purchase_${invoiceId}`), movementIds = Array.isArray(invoice.movementIds)?invoice.movementIds:[], originals=[];
    const payable = invoice.payableId ? (await db.ref(`/payables/${financeKey(invoice.payableId,"Payable ID")}`).get()).val() : null,keepInvoiceId=financeText(data.keepInvoiceId,160),keepInvoice=keepInvoiceId&&invoices[keepInvoiceId],duplicateCleanup=data.duplicate===true&&keepInvoice&&keepInvoiceId!==invoiceId&&keepInvoice.reversed!==true&&financeText(keepInvoice.ref,120).toLowerCase()===financeText(invoice.ref,120).toLowerCase()&&financeText(keepInvoice.supplier,120).toLowerCase()===financeText(invoice.supplier,120).toLowerCase()&&Financial.money(keepInvoice.total)===safeInvoice.total;if (data.duplicate===true&&!duplicateCleanup) throw new HttpsError("failed-precondition","A single matching purchase must be selected as the record to keep.");if (payable && payable.status === "paid") throw new HttpsError("failed-precondition", "This payable has already been paid. Reverse the supplier payment before reversing the purchase.");const orphanAccount=invoice.payMode==="account"&&!payable;if (!duplicateCleanup&&orphanAccount&&(await db.ref(`/financialMovements/purchase_ap_${invoiceId}`).get()).exists()) throw new HttpsError("failed-precondition","This purchase has a payable movement but its payable record is missing. Repair the payable before reversal.");if (!duplicateCleanup&&invoice.payMode === "pending"&&(!payable||payable.status!=="open")) throw new HttpsError("failed-precondition", "The linked provisional obligation is missing or is no longer open.");if (!duplicateCleanup&&invoice.payMode==="account"&&payable&&payable.status!=="open") throw new HttpsError("failed-precondition","The linked supplier payable is no longer open.");
    const paidAccountId=invoice.payMode==="paid"?accountIdFor((await db.ref("/cfAccounts").get()).val()||{},invoice.accountId):"";
    for (const movementId of movementIds) {const movement=(await db.ref(`/inventoryMovements/${financeKey(movementId,"Movement ID")}`).get()).val();if (!movement) throw new HttpsError("failed-precondition", "An original inventory movement is missing. Run inventory review before reversal.");const accounting=(await db.ref(`/inventoryAccounting/${movement.itemId}`).get()).val()||{},reversalId=`purchase_reverse_${invoiceId}_${movement.itemId}`,already=accounting.applied&&accounting.applied[reversalId];if (!already&&qty6(accounting.balance)+0.000001<qty6(movement.qty)) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${movement.itemName||movement.itemId}.`);if (!already&&qty6(accounting.balance)>qty6(movement.qty)&&((qty6(accounting.balance)*qty6(accounting.unitCost))-(qty6(movement.qty)*qty6(movement.unitCost)))<-.000001) throw new HttpsError("failed-precondition", `The remaining stock value for ${movement.itemName||movement.itemId} cannot support this reversal.`);originals.push(movement);}
    for (const movement of originals) await applyInventoryMovement(db,{movementId:`purchase_reverse_${invoiceId}_${movement.itemId}`,itemId:movement.itemId,type:"purchase_reversal",qty:-qty6(movement.qty),unitCost:qty6(movement.unitCost),sourceType:"purchase-invoice-reversal",sourceId:invoiceId,sourceLine:movement.sourceLine||movement.itemId,note:`Reverse purchase ${invoice.ref||invoiceId}: ${reason}`,reversalOf:movement.id,actorName:actor.role,occurredAt:now},actor);
    const writes = Object.assign({},approval.usedWrites,{[`purchaseInvoices/${invoiceId}/reversed`]:true,[`purchaseInvoices/${invoiceId}/reversedAt`]:now,[`purchaseInvoices/${invoiceId}/reversedBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/reversalReason`]:reason,[`operationalAudit/${now}_purchase_reverse_${invoiceId}`]:{action:duplicateCleanup?"reverse_duplicate_purchase":"reverse_purchase",sourceType:"purchaseInvoice",sourceId:invoiceId,keptPurchaseId:duplicateCleanup?keepInvoiceId:"",amount:safeInvoice.total,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});if (duplicateCleanup&&payable) {if (payable.status==="open") {writes[`payables/${invoice.payableId}/purchaseInvoiceId`]=keepInvoiceId;writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=invoice.payableId;} else {writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=null;writes[`purchaseInvoices/${keepInvoiceId}/payableReconciledAt`]=null;}}(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/reversed`]=true;writes[`stockReceipts/${id}/reversedAt`]=now;});
    const batches=(await db.ref("/inventoryBatch").get()).val()||{};Object.keys(batches).forEach((id)=>{if (batches[id]&&batches[id].invoiceId===invoiceId){writes[`inventoryBatch/${id}/closed`]=true;writes[`inventoryBatch/${id}/reversedAt`]=now;}});
    let financialMovement=null,financialId="";if (!duplicateCleanup&&(invoice.payMode === "account"||invoice.payMode === "pending")&&payable) {financialId=`purchase_ap_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_payable_reversed","purchaseInvoice",invoiceId,[Financial.line(invoice.payMode==="pending"?`liability:grni:${invoice.payableId}`:`liability:payable:${invoice.payableId}`,safeInvoice.total,0,"Reverse supplier obligation"),Financial.line("expense_or_inventory:inventory",0,safeInvoice.total,"Reverse inventory purchase")],{occurredAt:now,actorName:actor.role});writes[`payables/${invoice.payableId}/status`]="reversed";writes[`payables/${invoice.payableId}/reversedAt`]=now;writes[`payables/${invoice.payableId}/reversalMovementId`]=financialId;} else if (invoice.payMode === "paid") {financialId=`purchase_cash_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_cash_reversed","purchaseInvoice",invoiceId,[Financial.line(`asset:cash_account:${paidAccountId}`,safeInvoice.total,0,"Reverse purchase payment"),Financial.line("expense_or_inventory:inventory",0,safeInvoice.total,"Reverse inventory purchase")],{occurredAt:now,actorName:actor.role});writes[`cfLedger/fm_${financialId}`]=cashLedgerRecord({date:financeDateFromTimestamp(now),accountId:paidAccountId,dir:"in",category:"Purchase reversal",amount:safeInvoice.total,party:invoice.supplier,ref:invoice.ref,auto:true},financialId,financialMovement,actor);}
    if (financialMovement) await commitFinancial(db,financialId,financialMovement,actor,writes);else await db.ref().update(writes);
    return {invoiceId,result:"reversed",amount:safeInvoice.total,invoice:safeInvoice};
  },
);

exports.settlePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]); const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), channel = financeText(data.channel, 30); if (!["grabfood", "foodpanda"].includes(channel)) throw new HttpsError("invalid-argument", "Platform is invalid.");
    const ids = Array.isArray(data.orderIds) ? [...new Set(data.orderIds.map((id) => financeKey(id, "Order ID")))] : []; if (!ids.length) throw new HttpsError("invalid-argument", "Select at least one order.");
    const found = await Promise.all(ids.map((id) => findOrder(db, id))); let expected = 0; found.forEach((entry) => { const o = entry.order; if (o.channel !== channel || o.voided || (o.settlementStatus || "unsettled") === "settled") throw new HttpsError("failed-precondition", `Order ${entry.id} is not eligible for this payout.`); expected += Financial.money(o.netPlatform != null ? o.netPlatform : Financial.money(o.grossPlatform || o.total) - Financial.money(o.commission)); }); expected = Financial.money(expected);
    const actual = Financial.money(data.actualPayout); if (actual < 0) throw new HttpsError("invalid-argument", "Actual payout cannot be negative."); const approval = await claimManagerApproval(db, data, "settle_platform_payout", payoutId, actual, `payout_${payoutId}`), variance = Financial.money(actual - expected), defs = (await db.ref("/platformVarAccounts").get()).val() || {}, allocations = data.allocations || {}; let netAlloc = 0; const lines = [Financial.line(`asset:platform_clearing:${channel}`, actual, 0, "Actual payout clearing")];
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]); if (!(value > 0) || !defs[id]) throw new HttpsError("invalid-argument", "Variance allocation is invalid."); if (defs[id].type === "revenue") {netAlloc += value; lines.push(Financial.line(`revenue:platform_variance:${id}`, 0, value, defs[id].name));} else {netAlloc -= value; lines.push(Financial.line(`expense:platform_variance:${id}`, value, 0, defs[id].name));} });
    if (Math.abs(Financial.money(netAlloc) - variance) > 0.009) throw new HttpsError("failed-precondition", "Variance allocations do not equal the server-calculated variance."); lines.push(Financial.line(`asset:platform_receivable:${channel}`, 0, expected, "Settle platform receivable")); const movement = Financial.movement("platform_payout_settlement", "platformPayout", payoutId, lines, {occurredAt: Date.now(),approvalId:approval.id,approvedBy:approval.record.approvedEmail||approval.record.approvedRole});
    const writes = Object.assign({}, approval.usedWrites), settledAt = Date.now(); found.forEach((entry) => {writes[`${entry.node}/${entry.id}/settlementStatus`] = "settled"; writes[`${entry.node}/${entry.id}/payoutId`] = payoutId;}); writes[`platformPayouts/${payoutId}`] = {channel, periodStart: financeText(data.periodStart, 10), periodEnd: financeText(data.periodEnd, 10), expectedNet: expected, actualPayout: actual, variance, allocations, orderIds: ids, by: actor.role, actorUid: actor.uid, approvedBy: approval.record.approvedEmail || approval.record.approvedRole, approvalId: approval.id, settledAt, movementId: `payout_${payoutId}`, schemaVersion: 1};
    const committed = await commitFinancial(db, `payout_${payoutId}`, movement, actor, writes); return {payoutId, expectedNet: expected, actualPayout: actual, variance, orderCount: ids.length, duplicate: committed.duplicate};
  },
);

exports.processOrderAdjustment = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["registerOps"]); const data = request.data || {}, found = await findOrder(db, data.orderId), o = found.order;
    if (data.action === "cashier_verify_payment") {
      if (["grabfood", "foodpanda"].includes(String(o.channel || "").toLowerCase())) throw new HttpsError("failed-precondition", "Platform orders are settled through their platform payout.");
      if (["cashier_verified", "manager_validated", "confirmed"].includes(o.paymentStatus)) return {alreadyVerified: true, paymentStatus: o.paymentStatus};
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row));
      const direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct GCash, Maya, or bank payment to verify.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY) throw new HttpsError("permission-denied", "This payment method requires manager-only verification.");
      const suppliedRef = financeText(data.reference, 120); if (direct.length === 1 && !financeText(direct[0].ref, 120) && suppliedRef) direct[0].ref = suppliedRef;
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Enter the transaction reference for every direct electronic payment.");
      const now = Date.now(), website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const verified = Object.assign({}, o, {payments, paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: Financial.money(direct.reduce((sum, row) => sum + Financial.money(row.amount), 0)), status: nextStatus, statusUpdatedAt: nextStatus !== o.status ? now : o.statusUpdatedAt, statusUpdatedBy: nextStatus !== o.status ? actor.uid : o.statusUpdatedBy});
      const writes = {[`${found.node}/${o.id}`]: verified, [`activeOrders/${o.id}`]: activeOrderProjection(verified), [`operationalAudit/${now}_cashier_verify_${o.id}`]: {action: "cashier_verify_payment", sourceType: "order", sourceId: o.id, amount: verified.cashierVerifiedAmount, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}};
      if (verified.ownerUid) writes[`customerOrders/${verified.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, posted = await postOrderFinancial(db, verified, accounts, {uid: "server", role: "server"});
      return {verified: true, status: nextStatus, paymentStatus: "cashier_verified", financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    if (data.action === "manager_validate_payment") {
      if (o.paymentStatus === "manager_validated" || o.paymentStatus === "confirmed") return {alreadyValidated: true};
      const payments = (Array.isArray(o.payments) && o.payments.length ? o.payments : [{method: o.payment, amount: o.total}]).map((row) => Object.assign({}, row)), direct = PaymentVerification.directPaymentRows(payments), posSettings = (await db.ref("/posSettings").get()).val() || {}, verificationPolicy = PaymentVerification.paymentPolicy(payments, posSettings.payMethods);
      if (!direct.length) throw new HttpsError("failed-precondition", "This order has no direct electronic payment to validate.");
      if (verificationPolicy === PaymentVerification.CASHIER_MANAGER && o.paymentStatus !== "cashier_verified") throw new HttpsError("failed-precondition", "Cashier verification is required before manager validation.");
      if (verificationPolicy === PaymentVerification.MANAGER_ONLY && !["pending", "cashier_verified"].includes(o.paymentStatus)) throw new HttpsError("failed-precondition", "This payment is not awaiting manager verification.");
      if (direct.some((row) => !financeText(row.ref, 120))) throw new HttpsError("invalid-argument", "Every direct electronic payment requires a transaction reference.");
      const approval = await claimManagerApproval(db, data, "validate_payment", o.id, Financial.money(o.total), `validate_${o.id}`), now = Date.now(), approvedBy = approval.record.approvedEmail || approval.record.approvedRole, website = o.source === "online" || o.channel === "online", nextStatus = website && String(o.status || "Pending") === "Pending" ? "Confirmed" : String(o.status || "Pending");
      const validated = Object.assign({}, o, {payments, paymentStatus: "manager_validated", paymentVerificationPolicy: verificationPolicy, managerValidatedAt: now, managerValidatedBy: approval.record.approvedBy, managerValidatedRole: approval.record.approvedRole, managerValidatedName: approvedBy, paymentApprovalId: approval.id, status: nextStatus, statusUpdatedAt: nextStatus !== o.status ? now : o.statusUpdatedAt, statusUpdatedBy: nextStatus !== o.status ? actor.uid : o.statusUpdatedBy});
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${o.id}`]: validated, [`activeOrders/${o.id}`]: shouldProjectOrder(validated, activeShift, now) ? activeOrderProjection(validated) : null, [`operationalAudit/${now}_manager_validate_${o.id}`]: {action: "manager_validate_payment", sourceType: "order", sourceId: o.id, actorUid: actor.uid, actorRole: actor.role, approvedBy: approval.record.approvedBy, approvedRole: approval.record.approvedRole, approvalId: approval.id, ts: now, schemaVersion: 1}});
      if (validated.ownerUid) writes[`customerOrders/${validated.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, posted = await postOrderFinancial(db, validated, accounts, {uid: "server", role: "server"}); return {validated: true, paymentStatus: "manager_validated", approvedBy, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "Reason is required."); const accounts = (await db.ref("/cfAccounts").get()).val() || {}; await postOrderFinancial(db, o, accounts, {uid: "server", role: "server"});
    const now = Date.now(), writes = {}; let movementId, movement;
    if (data.action === "refund") { const delta = Financial.money(data.amount), already = Financial.money(o.refundAmount), max = Financial.money(o.total); if (!(delta > 0) || already + delta > max + 0.009) throw new HttpsError("invalid-argument", "Refund exceeds the refundable amount."); const cumulative = Financial.money(already + delta), original = (Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior = o.refundPayments || {}, tender = Array.isArray(data.refundPayments)?data.refundPayments.map((row) => ({method:financeText(row.method,60),amount:Financial.money(row.amount)})).filter((row) => row.method&&row.amount>0):[]; if ((o.channel||"instore") === "instore") {if (Math.abs(tender.reduce((s,row)=>Financial.money(s+row.amount),0)-delta)>0.009) throw new HttpsError("invalid-argument","Refund tender allocations must equal the refund amount."); const allowed={}; original.forEach((row)=>{allowed[row.method]=Financial.money((allowed[row.method]||0)+Financial.money(row.amount));}); tender.forEach((row)=>{if (!allowed[row.method] || Financial.money((prior[row.method]||0)+row.amount)>allowed[row.method]+0.009) throw new HttpsError("invalid-argument",`Refund through ${row.method} exceeds the original payment.`);});} movementId = `refund_${o.id}_${Math.round(cumulative * 100)}`; const approval = await claimManagerApproval(db, data, "refund", o.id, delta, movementId); movement = Financial.reversalPosting(o, delta, "refund", accounts, tender); Object.assign(writes, approval.usedWrites); const nextRefundPayments=Object.assign({},prior);tender.forEach((row)=>{nextRefundPayments[row.method]=Financial.money((nextRefundPayments[row.method]||0)+row.amount);}); writes[`${found.node}/${o.id}/refundAmount`] = cumulative; writes[`${found.node}/${o.id}/refundPayments`] = nextRefundPayments; writes[`${found.node}/${o.id}/refundHistory/${movementId}`] = {amount:delta,payments:tender,reason,at:now,by:actor.uid,approvalId:approval.id,approvedBy:approval.record.approvedEmail||approval.record.approvedRole}; writes[`${found.node}/${o.id}/refundReason`] = reason; writes[`${found.node}/${o.id}/refundedAt`] = now; writes[`${found.node}/${o.id}/refundedBy`] = actor.uid; writes[`${found.node}/${o.id}/refunded`] = true; }
    else if (data.action === "void") { if (o.voided) throw new HttpsError("already-exists", "Order is already voided."); const value = Financial.money(Math.max(0, Financial.money(o.total) - Financial.money(o.refundAmount))); if (!(value > 0)) throw new HttpsError("failed-precondition", "Nothing remains to void."); movementId = `void_${o.id}`; const approval = await claimManagerApproval(db, data, "void", o.id, value, movementId), original=(Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior=o.refundPayments||{}, tender=[]; if ((o.channel||"instore")==="instore") {let rem=value; original.forEach((row)=>{const available=Financial.money(Math.max(0,Financial.money(row.amount)-Financial.money(prior[row.method]))),use=Financial.money(Math.min(rem,available));if(use>0){tender.push({method:row.method,amount:use});rem=Financial.money(rem-use);}});if(rem>0.009)throw new HttpsError("failed-precondition","Original payment allocation cannot support the void reversal.");} movement = Financial.reversalPosting(o, value, "void", accounts, tender); Object.assign(writes, approval.usedWrites); writes[`${found.node}/${o.id}/voided`] = true; writes[`${found.node}/${o.id}/voidPayments`] = tender; writes[`${found.node}/${o.id}/voidApprovalId`] = approval.id; writes[`${found.node}/${o.id}/voidApprovedBy`] = approval.record.approvedEmail||approval.record.approvedRole; writes[`${found.node}/${o.id}/voidReason`] = reason; writes[`${found.node}/${o.id}/voidedAt`] = now; writes[`${found.node}/${o.id}/voidedBy`] = actor.uid; }
    else throw new HttpsError("invalid-argument", "Adjustment action is invalid.");
    if (data.restock === true) {writes[`${found.node}/${o.id}/inventoryReversalRequested`] = true; writes[`${found.node}/${o.id}/inventoryReversalReason`] = reason;}
    movement.occurredAt = now; movement.actorName = actor.role; movement.approvalId=financeText(data.approvalId,160); addOrderCashWrites(writes, movement, movementId, o, actor); const committed = await commitFinancial(db, movementId, movement, actor, writes); return {movementId, duplicate: committed.duplicate};
  },
);

exports.ensureFinancialLedger = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["cashflow", "receivables"]);
    const [ordersSnap, archiveSnap, accountsSnap, ledgerSnap, shiftsSnap, vouchersSnap, replenishmentsSnap, pettySettingsSnap, receivablesSnap, payablesSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get(), db.ref("/cfAccounts").get(), db.ref("/cfLedger").get(), db.ref("/shifts").get(), db.ref("/pettyCashVouchers").get(), db.ref("/pettyCashReplenishments").get(), db.ref("/pettyCashSettings").get(), db.ref("/receivables").get(), db.ref("/payables").get()]);
    const accounts = accountsSnap.val() || {}, legacyLedger = ledgerSnap.val() || {}, all = Object.assign({}, archiveSnap.val() || {}, ordersSnap.val() || {}); let posted = 0, duplicates = 0, skipped = 0; const serverActor = {uid: "server", role: "server"};
    for (const id of Object.keys(all)) { try {const order = Object.assign({id}, all[id]), result = await postOrderFinancial(db, order, accounts, serverActor); if (result.skipped) skipped++; else if (result.duplicate) duplicates++; else posted++; const refund = Financial.money(order.refundAmount); if (refund > 0) {const movementId = `refund_${id}_${Math.round(refund * 100)}`, movement = Financial.reversalPosting(order, refund, "refund", accounts), writes = {}; movement.occurredAt = Number(order.refundedAt || order.timestamp || Date.now()); if (!legacyLedger[`cfrefund_${id}`]) addOrderCashWrites(writes, movement, movementId, order, serverActor); const rr = await commitFinancial(db, movementId, movement, serverActor, writes); rr.duplicate ? duplicates++ : posted++;} if (order.voided) {const remaining = Financial.money(Math.max(0, Financial.money(order.total) - refund)); if (remaining > 0) {const movementId = `void_${id}`, movement = Financial.reversalPosting(order, remaining, "void", accounts), writes = {}; movement.occurredAt = Number(order.voidedAt || order.timestamp || Date.now()); addOrderCashWrites(writes, movement, movementId, order, serverActor); const vr = await commitFinancial(db, movementId, movement, serverActor, writes); vr.duplicate ? duplicates++ : posted++;}}} catch (error) {logger.error("3C backfill order failed", {id, error: String(error)}); throw new HttpsError("internal", `Backfill stopped at order ${id}. It is safe to retry.`);} }
    const shifts = shiftsSnap.val() || {}; for (const id of Object.keys(shifts)) {await postShiftCashEntries(db, id, shifts[id].payIns || [], "shift_payin"); await postShiftCashEntries(db, id, shifts[id].payOuts || [], "shift_payout"); await backfillShiftVariance(db, id, shifts[id]);}
    const vouchers = vouchersSnap.val() || {}; for (const id of Object.keys(vouchers)) await backfillPettyVoucher(db, id, vouchers[id]);
    const replenishments = replenishmentsSnap.val() || {}; for (const id of Object.keys(replenishments)) await backfillPettyReplenishment(db, id, replenishments[id]);
    for (const id of Object.keys(accounts)) {const account = accounts[id] || {}, occurredAt = Date.parse(`${account.openingDate || ""}T00:00:00+08:00`) || account.ts || Date.now(); await backfillOpeningBalance(db, `opening_cash_${id}`, "cashAccount", id, `asset:cash_account:${id}`, account.opening, occurredAt, `Opening balance — ${financeText(account.name || id, 80)}`);}
    const pettySettings = pettySettingsSnap.val() || {}; await backfillOpeningBalance(db, "opening_petty_cash", "pettyCash", "pettyCash", "asset:petty_cash", pettySettings.openingBalance, pettySettings.updatedAt || Date.now(), "Petty cash opening balance");
    const receivables = receivablesSnap.val() || {}; for (const id of Object.keys(receivables)) await backfillFinancialDocument(db, id, receivables[id], true, accounts);
    const payables = payablesSnap.val() || {}; for (const id of Object.keys(payables)) await backfillFinancialDocument(db, id, payables[id], false, accounts);
    const scanned = Object.keys(all).length + Object.keys(shifts).length + Object.keys(vouchers).length + Object.keys(replenishments).length + Object.keys(accounts).length + Object.keys(receivables).length + Object.keys(payables).length + 1; await db.ref("/systemMaintenance/financialLedgerInitialized").set({at: Date.now(), by: actor.uid, scanned, posted, duplicates, skipped}); return {scanned, posted, duplicates, skipped};
  },
);

exports.manageChartAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {const db=getDatabase(), actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Privileged access is required.");const data=request.data||{}, action=financeText(data.action,30);await ensureChartAccounts(db);if(action==="initialize")return{initialized:true};const id=financeKey(data.accountId,"Chart account"), ref=db.ref(`/chartOfAccounts/${id}`), old=(await ref.get()).val();if(action==="upsert"){const name=financeText(data.name,100),code=financeText(data.code,20),type=financeText(data.type,20);if(!name||!code||!["asset","liability","equity","revenue","expense"].includes(type))throw new HttpsError("invalid-argument","Code, name, and valid account type are required.");await ref.set({code,name,type,active:data.active!==false,system:old&&old.system===true,createdAt:old&&old.createdAt||Date.now(),updatedAt:Date.now(),updatedBy:actor.uid,schemaVersion:1});return{accountId:id};}if(action==="deactivate"){if(!old)throw new HttpsError("not-found","Chart account not found.");await ref.update({active:false,updatedAt:Date.now(),updatedBy:actor.uid});return{accountId:id};}throw new HttpsError("invalid-argument","Chart action is invalid.");},
);

exports.auditFinancialControls = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["cashflow","receivables","payables"]);
    const snaps=await Promise.all([db.ref("/orders").get(),db.ref("/archivedOrders").get(),db.ref("/financialMovements").get(),db.ref("/cfLedger").get(),db.ref("/receivables").get(),db.ref("/payables").get(),db.ref("/platformPayouts").get(),db.ref("/cashCustody").get(),db.ref("/cfAccounts").get()]);
    const orders=Object.assign({},snaps[1].val()||{},snaps[0].val()||{}),movements=snaps[2].val()||{},cash=snaps[3].val()||{},ars=snaps[4].val()||{},aps=snaps[5].val()||{},payouts=snaps[6].val()||{},custody=snaps[7].val()||{},accounts=snaps[8].val()||{},issues=[];
    Object.keys(movements).forEach((id)=>{const m=movements[id],sum=Financial.totals(m.lines||[]);if(Math.abs(sum.debit-sum.credit)>0.009)issues.push({severity:"critical",kind:"unbalanced",source:id,amount:Financial.money(sum.debit-sum.credit)});(m.warnings||[]).forEach((w)=>issues.push({severity:"warning",kind:"movement_warning",source:id,detail:w}));});
    Object.keys(cash).forEach((id)=>{if(!cash[id].movementId)issues.push({severity:"warning",kind:"legacy_cash_without_movement",source:id,amount:Financial.money(cash[id].amount)});});
    let unsettledValue=0,unsettledCount=0;Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status,platform=["grabfood","foodpanda"].includes(o.channel);if(!o.voided&&["Completed","Received"].includes(status)&&o.paymentStatus!=="pending"&&!movements[`sale_${id}`])issues.push({severity:"critical",kind:"sale_not_posted",source:id,amount:Financial.money(o.total)});if(platform&&!o.voided&&(o.settlementStatus||"unsettled")!=="settled"){unsettledCount++;unsettledValue=Financial.money(unsettledValue+Financial.money(o.netPlatform));}if(!platform){const rows=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}];rows.forEach((p)=>{if(String(p.method||"").toLowerCase()==="cash")return;if(!Financial.accountForMethod(p.method,accounts))issues.push({severity:"warning",kind:"unmapped_payment_method",source:id,detail:financeText(p.method,60),amount:Financial.money(p.amount)});});}});
    let custodyValue=0,custodyCount=0;Object.keys(custody).forEach((id)=>{const rem=Financial.money(custody[id].remaining);if(rem>0){custodyCount++;custodyValue=Financial.money(custodyValue+rem);}});const openAr=Object.values(ars).filter((x)=>x&&x.status==="open"),openAp=Object.values(aps).filter((x)=>x&&x.status==="open"),undepositedPayouts=Object.values(payouts).filter((x)=>x&&!x.depositMovementId);
    return{generatedAt:Date.now(),issues:issues.slice(0,200),issueCount:issues.length,unsettledPlatform:{count:unsettledCount,amount:unsettledValue},cashAwaitingDeposit:{count:custodyCount,amount:custodyValue},openReceivables:{count:openAr.length,amount:Financial.money(openAr.reduce((s,x)=>s+Number(x.amount||0),0))},openPayables:{count:openAp.length,amount:Financial.money(openAp.reduce((s,x)=>s+Number(x.amount||0),0))},undepositedPayouts:undepositedPayouts.length};
  },
);

// ---------------------------------------------------------------------------
// Release 3A: immutable, retry-safe inventory movement ledger.
// /inventoryAccounting/{itemId} is the authoritative per-item transaction
// boundary. The public inventory stock and /inventoryBalances are projections.
// ---------------------------------------------------------------------------
const INVENTORY_MOVEMENT_TYPES = new Set([
  "opening_balance", "purchase", "sale_usage", "staff_use", "rnd_testing",
  "waste", "adjustment", "manual_edit", "usage_reversal",
  "void_reversal", "refund_reversal", "purchase_reversal",
]);
function qty6(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000;
}
function inventoryKey(value, label) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return key;
}
function movementPermissions(type) {
  if (type === "purchase") return ["purchases", "inventory"];
  if (["staff_use", "rnd_testing", "usage_reversal"].includes(type)) return ["usage", "inventory"];
  if (["void_reversal", "refund_reversal"].includes(type)) return ["registerOps", "inventory"];
  return ["inventory"];
}
function openingMovement(itemId, item, now) {
  const qty = qty6(item && item.stock);
  const cost = qty6(item && item.cost);
  const id = `opening_${itemId}`;
  return {
    id, itemId, itemName: String(item && item.name || itemId).slice(0, 160),
    unit: String(item && item.unit || "").slice(0, 40), type: "opening_balance",
    qty, unitCost: cost, totalCost: money(qty * cost), balanceBefore: 0,
    balanceAfter: qty, costBefore: cost, costAfter: cost,
    sourceType: "migration", sourceId: "legacy-inventory", sourceLine: itemId,
    note: "Opening balance migrated from legacy inventory stock", actorUid: "server",
    actorName: "Release 3A migration", occurredAt: now, createdAt: now,
    version: 1, schemaVersion: 1,
  };
}
function seedInventoryAccounting(itemId, item, now) {
  const opening = openingMovement(itemId, item || {}, now);
  return {
    balance: opening.balanceAfter, unitCost: opening.costAfter, version: 1,
    initializedAt: now, lastMovementId: opening.id, lastMovementAt: now,
    applied: {[opening.id]: opening},
  };
}
async function repairInventoryProjections(db, itemId, accounting, item) {
  const version = Number(accounting.version || 0);
  const projection = {
    itemId, itemName: String(item && item.name || itemId).slice(0, 160),
    unit: String(item && item.unit || "").slice(0, 40),
    qty: qty6(accounting.balance), unitCost: qty6(accounting.unitCost),
    value: money(qty6(accounting.balance) * qty6(accounting.unitCost)),
    version, lastMovementId: accounting.lastMovementId || "",
    updatedAt: Number(accounting.lastMovementAt || Date.now()), schemaVersion: 1,
  };
  await Promise.all([
    db.ref(`/inventoryBalances/${itemId}`).transaction((current) => {
      if (current && Number(current.version || 0) > version) return;
      return projection;
    }),
    db.ref(`/inventory/${itemId}`).transaction((current) => {
      if (!current) return;
      if (Number(current.ledgerVersion || 0) > version) return;
      return Object.assign({}, current, {
        stock: projection.qty, cost: projection.unitCost, ledgerVersion: version,
        ledgerUpdatedAt: projection.updatedAt,
      });
    }),
  ]);
  return projection;
}
async function applyInventoryMovement(db, raw, actor) {
  raw = raw || {};
  const itemId = inventoryKey(raw.itemId, "Inventory item");
  const movementId = inventoryKey(raw.movementId, "Movement ID");
  const type = String(raw.type || "").trim();
  if (!INVENTORY_MOVEMENT_TYPES.has(type) || type === "opening_balance") {
    throw new HttpsError("invalid-argument", "Inventory movement type is invalid.");
  }
  const qty = qty6(raw.qty);
  const requestedCost = qty6(raw.unitCost);
  const setCost = raw.setCost === true || type === "purchase" || type === "purchase_reversal";
  if (!Number.isFinite(qty) || Math.abs(qty) > 100000000) throw new HttpsError("invalid-argument", "Inventory quantity is invalid.");
  if (qty === 0 && !setCost) throw new HttpsError("invalid-argument", "Inventory movement quantity cannot be zero.");
  if (requestedCost < 0 || requestedCost > 100000000) throw new HttpsError("invalid-argument", "Inventory unit cost is invalid.");
  const itemRef = db.ref(`/inventory/${itemId}`);
  const item = (await itemRef.get()).val();
  if (!item) throw new HttpsError("not-found", "Inventory item no longer exists.");
  const now = Date.now();
  let duplicate = false, insufficient = false, insufficientValue = false;
  const accountingRef = db.ref(`/inventoryAccounting/${itemId}`);
  // RTDB transactions may invoke the updater once with an empty local cache
  // before the server value arrives.  A purchase reversal must not seed that
  // pass from the legacy inventory projection because its stock can be stale.
  // Preload the authoritative ledger so the first pass uses the real balance.
  const accountingSeed = (await accountingRef.get()).val() || seedInventoryAccounting(itemId, item, now);
  const result = await accountingRef.transaction((current) => {
    const base = current || accountingSeed;
    const state = Object.assign({}, base, {applied: Object.assign({}, base.applied || {})});
    if (state.applied[movementId]) { duplicate = true; return state; }
    const before = qty6(state.balance);
    const costBefore = qty6(state.unitCost || item.cost);
    const after = qty6(before + qty);
    if (type === "purchase_reversal" && after < 0) {insufficient = true; return;}
    let costAfter = costBefore;
    if (type === "purchase" && qty > 0 && requestedCost >= 0) {
      const denominator = before + qty;
      // A negative/zero opening balance represents prior uncosted consumption.
      // Blending it can create a nonsensical negative WAC, so the first receipt
      // that recovers such a balance establishes the new purchase cost.
      costAfter = before > 0 && denominator > 0 ? qty6(((before * costBefore) + (qty * requestedCost)) / denominator) : requestedCost;
    } else if (type === "purchase_reversal" && qty < 0 && requestedCost >= 0) {
      const remainingValue = (before * costBefore) + (qty * requestedCost);if (after > 0 && remainingValue < -0.000001) {insufficientValue=true;return;}
      costAfter = after > 0 ? qty6(remainingValue / after) : costBefore;
    } else if (setCost) {
      costAfter = requestedCost;
    }
    const version = Number(state.version || 0) + 1;
    const movement = {
      id: movementId, itemId,
      itemName: String(item.name || itemId).slice(0, 160), unit: String(item.unit || "").slice(0, 40),
      type, qty, unitCost: ["purchase", "purchase_reversal"].includes(type) ? requestedCost : costBefore,
      totalCost: money(qty * (["purchase", "purchase_reversal"].includes(type) ? requestedCost : costBefore)),
      balanceBefore: before, balanceAfter: after, costBefore, costAfter,
      sourceType: String(raw.sourceType || type).slice(0, 80),
      sourceId: String(raw.sourceId || "").slice(0, 160),
      sourceLine: String(raw.sourceLine || itemId).slice(0, 160),
      note: String(raw.note || "").slice(0, 500),
      actorUid: actor && actor.uid || "server", actorName: String(raw.actorName || actor && actor.role || "server").slice(0, 120),
      occurredAt: Number(raw.occurredAt || now), createdAt: now,
      reversalOf: String(raw.reversalOf || "").slice(0, 160), version, schemaVersion: 1,
    };
    state.balance = after; state.unitCost = costAfter; state.version = version;
    state.lastMovementId = movementId; state.lastMovementAt = now;
    state.applied[movementId] = movement;
    return state;
  });
  if (!result.committed) {if (insufficient) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${item.name || itemId}.`);if (insufficientValue) throw new HttpsError("failed-precondition", `The remaining stock value for ${item.name || itemId} cannot support this reversal.`);throw new Error(`Inventory transaction was not committed for ${itemId}`);}
  const accounting = result.snapshot.val();
  const movement = accounting.applied[movementId];
  const opening = accounting.applied[`opening_${itemId}`];
  const writes = {};
  if (opening) writes[`inventoryMovements/${opening.id}`] = opening;
  if (movement) writes[`inventoryMovements/${movementId}`] = movement;
  if (Object.keys(writes).length) await db.ref().update(writes);
  await repairInventoryProjections(db, itemId, accounting, item);
  return {movement, duplicate};
}

exports.postInventoryMovements = onCall(
  {region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const movements = listFromFirebase(request.data && request.data.movements);
    if (!movements.length || movements.length > 100) throw new HttpsError("invalid-argument", "Submit 1 to 100 inventory movements.");
    const serverOnly = new Set(["opening_balance", "sale_usage", "void_reversal", "refund_reversal", "purchase_reversal"]);
    if (movements.some((movement) => serverOnly.has(String(movement && movement.type || "")))) {
      throw new HttpsError("permission-denied", "That inventory movement type can only be posted by the server.");
    }
    const actor = await requirePortalUser(db, request);
    if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) {
      const granted = (await db.ref(`/adminPerms/${actor.uid}`).get()).val() || {};
      const denied = movements.some((movement) => !movementPermissions(String(movement && movement.type || "")).some((key) => granted[key] === true));
      if (denied) throw new HttpsError("permission-denied", "This account cannot post one or more inventory movement types.");
    }
    const results = [];
    for (const movement of movements) results.push(await applyInventoryMovement(db, movement, actor));
    logger.info("Inventory movements posted", {uid: actor.uid, count: results.length, duplicates: results.filter((x) => x.duplicate).length});
    return {count: results.length, duplicates: results.filter((x) => x.duplicate).length, movements: results.map((x) => x.movement && x.movement.id)};
  },
);

exports.ensureInventoryLedger = onCall(
  {region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 300, memory: "512MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["inventory"]);
    const markerRef = db.ref("/systemMaintenance/inventoryLedgerInitializedAt");
    const marker = Number((await markerRef.get()).val() || 0);
    if (marker && !(request.data && request.data.force === true && ["owner", "superadmin", "admin", "manager"].includes(actor.role))) {
      return {skipped: true, initializedAt: marker};
    }
    const inventory = (await db.ref("/inventory").get()).val() || {};
    let initialized = 0;
    for (const itemId of Object.keys(inventory)) {
      const ref = db.ref(`/inventoryAccounting/${itemId}`);
      const now = Date.now();
      let existed = false;
      const result = await ref.transaction((current) => {if (current) {existed = true; return current;} return seedInventoryAccounting(itemId, inventory[itemId], now);});
      const accounting = result.snapshot.val();
      const opening = accounting && accounting.applied && accounting.applied[`opening_${itemId}`];
      if (opening) await db.ref(`/inventoryMovements/${opening.id}`).set(opening);
      await repairInventoryProjections(db, itemId, accounting, inventory[itemId]);
      if (!existed) initialized++;
    }
    await markerRef.set(Date.now());
    logger.info("Inventory ledger ensured", {uid: actor.uid, items: Object.keys(inventory).length, initialized});
    return {items: Object.keys(inventory).length, initialized};
  },
);

exports.onOrderFinalize = onValueWritten(
  {ref: "/orders/{orderId}/status", region: "asia-southeast1", retry: true},
  async (event) => {
    const after = event.data.after.val();
    if (after !== "Completed" && after !== "Received") return;

    const orderId = event.params.orderId;
    const db = getDatabase();
    const oref = db.ref("/orders/" + orderId);
    const o = (await oref.get()).val();
    if (!o || !o.lineItems) return;
    if (o.inventoryDeducted && o.inventoryLedgerVersion === 1) return;

    try {
      const [recSnap, optSnap, invSnap, miSnap, psSnap, ogSnap] = await Promise.all([
        db.ref("/recipes").get(),
        db.ref("/optionRecipes").get(),
        db.ref("/inventory").get(),
        db.ref("/menuItems").get(),
        db.ref("/posSettings").get(),
        db.ref("/optionGroups").get(),
      ]);
      const recipes = recSnap.val() || {};
      const inv = invSnap.val() || {};
      const mi = miSnap.val() || {};
      const ps = psSnap.val() || {};
      const optRaw = optSnap.val() || {};
      const optMap = {};
      Object.keys(optRaw).forEach((k) => {
        const v = optRaw[k] || {};
        optMap[v.label || k] = v;
      });
      const optionCosts = ps.optionCosts || {};
      const optionGroups = ogSnap.val() || {};

      const costing = Costing.costOrder({
        lineItems: o.lineItems, recipes, inventory: inv, menuItems: mi,
        optionCosts, optionRecipes: optMap, optionGroups,
      });
      if (!costing.ok) {
        const summary = costing.errors.slice(0, 5).map((x) => x.code + ": " + x.message).join(" | ");
        throw new Error("Authoritative costing rejected order " + orderId + ": " + summary);
      }
      const usage = costing.usage;
      const ids = Object.keys(usage);
      const cogs = costing.totalCost;
      const invCategories = ps.invCategories || {};
      const cogsCategorySnapshot = {food: 0, beverage: 0, packaging: 0, directLabor: 0, unallocated: 0};
      costing.lines.forEach((costLine) => {
        const item = inv[costLine.ingredientId] || {};
        const category = invCategories[item.category] || {};
        const label = String(category.name || item.category || "").toLowerCase();
        let bucket = "unallocated";
        if (/packag|cup|lid|straw|napkin|container/.test(label)) bucket = "packaging";
        else if (/beverage|drink|coffee|tea|milk|syrup|powder/.test(label)) bucket = "beverage";
        else if (/food|ingredient|bakery|kitchen|pastry|meal/.test(label)) bucket = "food";
        cogsCategorySnapshot[bucket] += Number(costLine.totalCost) || 0;
      });
      Object.keys(cogsCategorySnapshot).forEach((key) => {cogsCategorySnapshot[key] = Math.round(cogsCategorySnapshot[key] * 100) / 100;});

      await Promise.all(ids.map((ing) => applyInventoryMovement(db, {
        movementId: `sale_${orderId}_${ing}`,
        itemId: ing, type: "sale_usage", qty: -qty6(usage[ing]),
        sourceType: "order", sourceId: orderId, sourceLine: ing,
        note: `Ingredient usage for order ${orderId}`,
        occurredAt: Number(o.completedAt || o.receivedAt || Date.now()),
        actorName: o.onDuty || o.staff || "Order finalization",
      }, {uid: "server", role: "server"})));
      await oref.update({
        inventoryDeducted: true,
        inventoryUsage: usage,
        inventoryDeductedAt: Date.now(),
        cogsSnapshot: cogs,
        cogsCategorySnapshot,
        cogsCategorySnapshotVersion: 1,
        cogsCovered: costing.cogsCovered,
        cogsDetail: {
          engineVersion: costing.engineVersion, computedAt: Date.now(),
          totalCost: cogs, lines: costing.lines, warnings: costing.warnings,
        },
        costingEngineVersion: costing.engineVersion,
        deductedBy: "server",
        inventoryLedgerVersion: 1,
      });
      logger.info("Server deducted order", {orderId, items: ids.length, cogs});
    } catch (err) {
      logger.error("onOrderFinalize failed", {orderId, error: String(err)});
      throw err;
    }
  },
);

exports.onOrderInventoryReversal = onValueWritten(
  {ref: "/orders/{orderId}/inventoryReversalRequested", region: ORDER_REGION, retry: true},
  async (event) => {
    if (event.data.after.val() !== true) return;
    const orderId = event.params.orderId;
    const db = getDatabase();
    const orderRef = db.ref(`/orders/${orderId}`);
    const order = (await orderRef.get()).val();
    if (!order || order.inventoryReversed) return;
    const usage = order.inventoryUsage || {};
    if (order.inventoryDeducted !== true || !Object.keys(usage).length) {
      // A void/refund can be requested milliseconds after completion. Wait for
      // finalization so the reversal can link to—and exactly offset—the sale.
      throw new Error(`Order ${orderId} inventory finalization is not complete; retry reversal.`);
    }
    const type = order.voided ? "void_reversal" : "refund_reversal";
    await Promise.all(Object.keys(usage).map((itemId) => applyInventoryMovement(db, {
      movementId: `${type}_${orderId}_${itemId}`,
      itemId, type, qty: qty6(usage[itemId]), sourceType: "order_reversal",
      sourceId: orderId, sourceLine: itemId,
      note: String(order.inventoryReversalReason || order.refundReason || order.voidReason || "Inventory returned").slice(0, 500),
      reversalOf: `sale_${orderId}_${itemId}`, actorName: order.onDuty || order.staff || "Order reversal",
    }, {uid: "server", role: "server"})));
    await orderRef.update({
      inventoryReversed: true, inventoryReversedAt: Date.now(), inventoryReversalRequested: null,
      inventoryReversalLedgerVersion: 1,
    });
    logger.info("Order inventory reversed", {orderId, type, items: Object.keys(usage).length});
  },
);

// Release 8A: bounded retention. Idempotency claims, order locks, rate-limit
// windows, and daily telemetry accumulate forever otherwise. This daily sweep
// deletes only entries far past the window in which they can affect any live
// decision (locks/rate windows are minute-scale; command claims guard replay of
// long-closed orders; telemetry keeps ~4 months for trend review). Live data is
// never touched — cutoffs are deliberately generous.
exports.pruneEphemeralNodes = onSchedule(
  {schedule: "every day 03:30", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now(), DAY = 86400000;
    const deletions = {};
    const mark = (path) => { deletions[path] = null; };

    // orderLocks/{uid}/{signature} = {t} — duplicate-submit guard (minute-scale)
    const locks = (await db.ref("/orderLocks").get()).val() || {};
    Object.keys(locks).forEach((uid) => {
      const sigs = locks[uid] || {};
      Object.keys(sigs).forEach((sig) => {
        if (now - Number((sigs[sig] && sigs[sig].t) || 0) > 7 * DAY) mark(`orderLocks/${uid}/${sig}`);
      });
    });

    // rateLimits/orders/{uid} = {start,count} — 1-minute windows
    const rl = (await db.ref("/rateLimits/orders").get()).val() || {};
    Object.keys(rl).forEach((uid) => {
      if (now - Number((rl[uid] && rl[uid].start) || 0) > 7 * DAY) mark(`rateLimits/orders/${uid}`);
    });

    // orderStatusCommands/{requestId} = {createdAt,appliedAt} — status idempotency
    const cmds = (await db.ref("/orderStatusCommands").get()).val() || {};
    Object.keys(cmds).forEach((rid) => {
      const ts = Number((cmds[rid] && (cmds[rid].appliedAt || cmds[rid].createdAt)) || 0);
      if (ts && now - ts > 45 * DAY) mark(`orderStatusCommands/${rid}`);
    });

    // clientTelemetryDaily/{YYYY-MM-DD} — keep ~4 months
    const cutoffDay = financeDateFromTimestamp(now - 120 * DAY);
    const tel = (await db.ref("/clientTelemetryDaily").get()).val() || {};
    Object.keys(tel).forEach((day) => { if (day < cutoffDay) mark(`clientTelemetryDaily/${day}`); });

    const paths = Object.keys(deletions);
    for (let i = 0; i < paths.length; i += 400) {
      const chunk = {};
      paths.slice(i, i + 400).forEach((p) => { chunk[p] = null; });
      await db.ref().update(chunk);
    }
    logger.info("pruneEphemeralNodes complete", {deleted: paths.length});
    return null;
  },
);

// Customer confirmation is optional. If neither the customer nor cashier closes
// a Ready online order, finalize it after two hours so it cannot remain active
// indefinitely. The authoritative order remains available for history/reports.
exports.autoCompleteReadyOnlineOrders = onSchedule(
  {schedule: "every 15 minutes", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 120, memory: "256MiB"},
  async () => {
    const db = getDatabase(), now = Date.now();
    const active = (await db.ref("/activeOrders").orderByChild("status").equalTo("Ready").limitToLast(250).get()).val() || {};
    let completed = 0;
    for (const orderId of Object.keys(active)) {
      if (!readyForAutoComplete(active[orderId], now)) continue;
      const result = await db.ref(`/orders/${orderId}`).transaction((order) => {
        if (!readyForAutoComplete(order, now)) return;
        return Object.assign({}, order, {status: "Completed", completedAt: now, statusUpdatedAt: now, statusUpdatedBy: "system", completionReason: "ready_timeout"});
      });
      if (!result.committed) continue;
      const order = result.snapshot.val() || {}, writes = {
        [`operationalAudit/${now}_auto_complete_${orderId}`]: {action: "auto_complete_ready_order", sourceType: "order", sourceId: orderId, ts: now, actorUid: "system", actorRole: "system", schemaVersion: 1},
      };
      if (order.ownerUid) writes[`customerOrders/${order.ownerUid}/${orderId}/status`] = "Completed";
      await db.ref().update(writes);
      completed++;
    }
    logger.info("autoCompleteReadyOnlineOrders complete", {completed});
    return null;
  },
);

// Release 8B: automated recovery point. Snapshots the durable business data to
// Cloud Storage once a day and keeps 30 days. Transient/reconstructable nodes
// (active-order projections, locks, rate windows, status-command claims, offline
// sync scratch, daily telemetry) are excluded — a restore rebuilds those. This
// is the safety net behind a corrupt write, a bad delete, or human error.
const BACKUP_EXCLUDE = new Set(["activeOrders", "orderLocks", "rateLimits", "orderStatusCommands", "offlinePosSync", "clientTelemetryDaily"]);
exports.backupDatabaseDaily = onSchedule(
  {schedule: "every day 03:00", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 300, memory: "256MiB"},
  async () => {
    const db = getDatabase(), bucket = getStorage().bucket(PROOF_BUCKET), now = Date.now();
    const root = (await db.ref("/").get()).val() || {};
    const snapshot = {};
    Object.keys(root).forEach((node) => { if (!BACKUP_EXCLUDE.has(node)) snapshot[node] = root[node]; });
    const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const objectName = `db-backups/accaza-${stamp}.json`;
    const payload = JSON.stringify({takenAt: now, version: "backup-v1", excluded: [...BACKUP_EXCLUDE], data: snapshot});
    await bucket.file(objectName).save(payload, {
      resumable: false, contentType: "application/json",
      metadata: {cacheControl: "private, max-age=0, no-store", metadata: {takenAt: String(now)}},
    });
    // Retention: delete snapshots older than 30 days.
    let removed = 0;
    try {
      const [files] = await bucket.getFiles({prefix: "db-backups/"});
      const cutoff = now - 30 * 86400000;
      await Promise.all(files.map(async (file) => {
        const created = Date.parse((file.metadata && file.metadata.timeCreated) || "") || 0;
        if (created && created < cutoff) { await file.delete({ignoreNotFound: true}); removed++; }
      }));
    } catch (error) { logger.warn("Backup retention sweep failed", {error: String(error)}); }
    logger.info("backupDatabaseDaily complete", {objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, removed, rev: 2});
    return null;
  },
);
