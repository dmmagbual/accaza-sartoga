/**
 * Accaza Coffee House — Auto Web-Push (FCM) on order completion
 * Firebase Cloud Functions (2nd gen). FREE: no per-message cost.
 *
 * Trigger: when an order's status changes to "Completed", send a Web Push
 * notification to the customer's installed app (pick-up or delivery message).
 */
const {onValueUpdated, onValueWritten, onValueCreated, onValueDeleted} = require("firebase-functions/v2/database");
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
const BooksBridge = require("./lib/books-bridge");
const FinancialClose = require("./lib/financial-close");
const AccountingPeriods = require("./lib/accounting-periods");
const ReconciliationControls = require("./lib/reconciliation-controls");
const RecoveryValidation = require("./lib/recovery-validation");
const ProductionHealth = require("./lib/production-health");
const IncidentControls = require("./lib/incident-controls");
const ReleaseCertification = require("./lib/release-certification");

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
async function notifyStaff(db, title, body, link, audience) {
  const [tokenSnap, adminsSnap] = await Promise.all([db.ref("/staffPushTokens").get(), db.ref("/admins").get()]);
  const tokens = tokenSnap.val() || {}, admins = adminsSnap.val() || {}, target = String(audience || "all").toLowerCase();
  const messaging = getMessaging();
  await Promise.all(Object.keys(tokens).map(async (uid) => {
    const rawRole=admins[uid],role=String(rawRole===true?"owner":(typeof rawRole==="string"?rawRole:(rawRole&&rawRole.role)||"staff")).toLowerCase();
    if(target!=="all"&&!(target==="management"&&["owner","superadmin","admin","manager"].includes(role))&&!(target==="cashier"&&["cashier","staff"].includes(role))&&target!==role)return;
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
// Accaza Books bridge: mirror every POS financialMovement into /books/journal.
// Sale movements roll up into a daily-summary-per-channel entry; all other
// movements post as their own discrete entry. Idempotent by sources[id].
// ---------------------------------------------------------------------------
