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
// Accaza Books bridge: mirror every POS financialMovement into /books/journal.
// Sale movements roll up into a daily-summary-per-channel entry; all other
// movements post as their own discrete entry. Idempotent by sources[id].
// ---------------------------------------------------------------------------
async function flagUnmappedBooks(db, mv, unmapped) {
  if (!unmapped || !unmapped.length) return;
  await db.ref(`/books/reviewQueue/${mv.id}`).set({movementId: String(mv.id || ""), type: String(mv.type || ""), sourceId: String(mv.sourceId || ""), accounts: unmapped, at: Date.now()});
}

async function booksCashAccountMap(db) {
  const [configuredSnap, accountsSnap] = await Promise.all([
    db.ref("/books/config/cashAccountMap").get(), db.ref("/cfAccounts").get(),
  ]);
  const map = Object.assign({}, configuredSnap.val() || {}), accounts = accountsSnap.val() || {};
  Object.keys(accounts).forEach((id) => { if (!map[id]) map[id] = BooksBridge.cashCodeForAccount(accounts[id]); });
  return map;
}

exports.mirrorPosMovementToBooks = onValueCreated(
  {ref: "/financialMovements/{movementId}", region: "asia-southeast1"},
  async (event) => {
    const mv = event.data.val();
    if (!mv || !Array.isArray(mv.lines) || !mv.lines.length) return;
    if (!mv.id) mv.id = event.params.movementId;
    const db = getDatabase();
    const cashMap = await booksCashAccountMap(db);
    const bucket = BooksBridge.bucketFor(mv);
    if (bucket.mode === "daily") {
      const ref = db.ref(`/books/journal/${bucket.key}`);
      await ref.transaction((cur) => {
        const next = BooksBridge.applyDaily(cur, mv, cashMap);
        return next === undefined ? cur : next; // abort (already applied) leaves node unchanged
      });
      await ref.child("updatedAt").set(Date.now());
    } else {
      const built = BooksBridge.buildSingle(mv, cashMap);
      const ref = db.ref(`/books/journal/${built.entry.id}`);
      const existing = await ref.get();
      if (!existing.exists()) { built.entry.createdAt = Date.now(); await ref.set(built.entry); }
    }
    const unmapped = BooksBridge.mappedLines(mv, cashMap).unmapped;
    await flagUnmappedBooks(db, mv, unmapped);
  },
);

// COGS leg: when an order's COGS snapshot is written, fold Dr COGS / Cr Inventory
// into the same daily-summary-per-channel entry. Idempotent via sources[cogs_<orderId>].
exports.mirrorPosCogsToBooks = onValueWritten(
  {ref: "/orders/{orderId}/cogsSnapshot", region: "asia-southeast1"},
  async (event) => {
    const after = event.data && event.data.after && event.data.after.val();
    if (!(Number(after) > 0)) return;
    const orderId = event.params.orderId;
    const db = getDatabase();
    let order = (await db.ref(`/orders/${orderId}`).get()).val();
    if (!order) order = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
    if (!order) return;
    const [inventorySnap, categoriesSnap] = await Promise.all([db.ref("/inventory").get(), db.ref("/posSettings/invCategories").get()]);
    const mv = BooksBridge.cogsMovement(order, orderId, inventorySnap.val() || {}, categoriesSnap.val() || {});
    if (!mv.lines.length) return;
    const bucket = BooksBridge.bucketFor(mv);
    const ref = db.ref(`/books/journal/${bucket.key}`);
    await ref.transaction((cur) => {
      const next = BooksBridge.applyDaily(cur, mv, {});
      return next === undefined ? cur : next;
    });
    await ref.child("updatedAt").set(Date.now());
  },
);

// Rebuild every authoritative Finance movement into Books. This closes the
// one-time historical gap left by movements created before the Books trigger
// existed, and is safe to rerun because journal keys and daily source ids are stable.
exports.ensureBooksJournal = onCall(
  {region: "asia-southeast1", enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true", timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["cashflow", "receivables", "payables"]);
    await ensureHistoricalSecurityBankDrawings(db, actor);
    const [movementSnap, ordersSnap, archiveSnap, journalSnap, cashAccountsSnap, inventorySnap, categoriesSnap, purchasesSnap, payablesSnap, posSettingsSnap, activeShiftSnap] = await Promise.all([
      db.ref("/financialMovements").get(), db.ref("/orders").get(), db.ref("/archivedOrders").get(), db.ref("/books/journal").get(), db.ref("/cfAccounts").get(), db.ref("/inventory").get(), db.ref("/posSettings/invCategories").get(), db.ref("/purchaseInvoices").get(), db.ref("/payables").get(), db.ref("/posSettings").get(), db.ref("/posActiveShift").get(),
    ]);
    const movements = movementSnap.val() || {}, allOrders = Object.assign({}, archiveSnap.val() || {}, ordersSnap.val() || {}), purchases=purchasesSnap.val()||{}, payables=payablesSnap.val()||{}, inventory=inventorySnap.val()||{};
    const cashMap = await booksCashAccountMap(db), daily = {}, singles = {}, review = {}, voidedSourceIds = BooksBridge.fullyVoidedSourceIds(movements);
    const movementIds = Object.keys(movements).sort((a, b) => Number(movements[a].occurredAt || 0) - Number(movements[b].occurredAt || 0) || a.localeCompare(b));
    movementIds.forEach((id) => {
      const mv = Object.assign({id}, movements[id] || {}); if (!Array.isArray(mv.lines) || !mv.lines.length) return;
      if (!BooksBridge.includeInAuthoritativeBooks(mv, voidedSourceIds, allOrders)) {
        if (BooksBridge.isSaleMovement(mv)) review[`sales_authority_${id}`] = {movementId: id, type: String(mv.type || ""), sourceId: String(mv.sourceId || ""), accounts: [], detail: "Excluded from recognized sales because Admin Sales History has no qualifying completed/received order for this Finance movement. The immutable Finance evidence remains available for audit.", at: Date.now()};
        return;
      }
      const payable=payables[mv.sourceId]||{},derivedId=String(mv.sourceId||"").indexOf("ap_")===0?String(mv.sourceId).slice(3):String(mv.sourceId||""),purchaseInvoice=purchases[payable.purchaseInvoiceId]||purchases[mv.sourceId]||purchases[derivedId]||null,context={purchaseInvoice,inventory};
      const bucket = BooksBridge.bucketFor(mv), mapped = BooksBridge.mappedLines(mv, cashMap, context);
      if (mapped.unmapped.length) review[id] = {movementId: id, type: String(mv.type || ""), sourceId: String(mv.sourceId || ""), accounts: mapped.unmapped, at: Date.now()};
      if (bucket.mode === "daily") daily[bucket.key] = BooksBridge.applyDaily(daily[bucket.key] || null, mv, cashMap);
      else singles[bucket.key] = Object.assign(BooksBridge.buildSingle(mv, cashMap, context).entry, {createdAt: Date.now(), rebuiltAt: Date.now()});
    });
    let cogsPosted = 0, missingCogs = 0;
    Object.keys(allOrders).forEach((id) => {
      const order = allOrders[id] || {};
      if (!BooksBridge.recognizedOrderForCogs(order)) return;
      const cogs = BooksBridge.cogsMovement(order, id, inventorySnap.val() || {}, categoriesSnap.val() || {});
      if (!cogs.lines.length) { missingCogs++; review[`cogs_missing_${id}`] = {movementId: `cogs_missing_${id}`, type: "unposted_cogs", sourceId: id, accounts: [{account: "cogs:missing_snapshot", code: "5090"}], detail: "Historical order has no reliable COGS snapshot; review in Unposted COGS Clearing without guessing a cost.", at: Date.now()}; return; }
      const bucket = BooksBridge.bucketFor(cogs); daily[bucket.key] = BooksBridge.applyDaily(daily[bucket.key] || null, cogs, cashMap); cogsPosted++;
    });
    const existing = journalSnap.val() || {}, writes = {};
    Object.keys(existing).forEach((key) => { if (existing[key] && existing[key].net && existing[key].source === "pos-bridge" && !daily[key]) writes[`books/journal/${key}`] = null; });
    Object.keys(daily).forEach((key) => { daily[key].updatedAt = Date.now(); writes[`books/journal/${key}`] = daily[key]; });
    Object.keys(singles).forEach((key) => { writes[`books/journal/${key}`] = singles[key]; });
    const registerFloat = resolveRegisterFloat(posSettingsSnap.val(), activeShiftSnap.val());
    writes["books/journal/register_float_control"] = registerFloat.amount > 0 ? registerFloatControlEntry(registerFloat.amount, Date.now(), registerFloat) : null;
    writes["books/journal/historical_suspense_capital_20260826"] = historicalSuspenseCapitalEntry();
    writes["books/reviewQueue"] = review;
    writes["books/config/cashAccountMap"] = cashMap;
    const paths = Object.keys(writes); for (let i = 0; i < paths.length; i += 300) { const batch = {}; paths.slice(i, i + 300).forEach((path) => { batch[path] = writes[path]; }); await db.ref().update(batch); }
    const openingCash = BooksBridge.r2(Object.values(cashAccountsSnap.val() || {}).reduce((sum, account) => sum + Number(account && account.opening || 0), 0));
    const netSales = BooksBridge.r2(Object.values(daily).reduce((sum, entry) => sum + BooksBridge.netSales(entry && entry.net), 0));
    const result = {at: Date.now(), by: actor.uid, movements: movementIds.length, dailyEntries: Object.keys(daily).length, singleEntries: Object.keys(singles).length, netSales, cogsPosted, missingCogs, reviewItems: Object.keys(review).length, openingCash, fixedFloat: registerFloat.amount, registerFloatSource: registerFloat.source};
    await db.ref("/systemMaintenance/booksJournalSynced").set(result); return result;
  },
);

async function ensureHistoricalSecurityBankDrawings(db, actor) {
  const accounts = (await db.ref("/cfAccounts").get()).val() || {}, byCode = {};
  Object.keys(accounts).forEach((id) => { byCode[BooksBridge.cashCodeForAccount(accounts[id])] = id; });
  const rows = [{code: "1013", amount: 10050}, {code: "1014", amount: 3000}], occurredAt = Date.parse("2026-08-25T12:00:00+10:00");
  for (const row of rows) {
    const accountId = byCode[row.code];
    if (!accountId) throw new HttpsError("failed-precondition", `Security Bank cash account ${row.code} is not configured.`);
    const movementId = `books_manual_draw25_${row.code}`;
    const movement = Financial.movement("manual_books_owner_draw", "booksManualJournal", movementId, [Financial.line("equity:owner_draw", row.amount, 0, "Owner personal drawing"), Financial.line(`asset:cash_account:${accountId}`, 0, row.amount, "Owner personal drawing")], {occurredAt, actorName: actor.role, reference: "DRAW-25", originalJournalDate: "2026-08-25"});
    await commitFinancial(db, movementId, movement, actor);
  }
}

function resolveRegisterFloat(settings, activeShift) {
  settings = settings || {}; activeShift = activeShift || {};
  if (settings.fixedFloat != null && Financial.money(settings.fixedFloat) > 0) return {amount: Financial.money(settings.fixedFloat), source: "posSettings/fixedFloat", shiftId: activeShift.id || ""};
  const retained = activeShift.retainedFloat != null ? activeShift.retainedFloat : activeShift.openingFloat;
  if (Financial.money(retained) > 0) return {amount: Financial.money(retained), source: activeShift.id ? `posActiveShift/${activeShift.id}` : "posActiveShift", shiftId: activeShift.id || ""};
  return {amount: 4000, source: "financeControl/defaultFixedFloat", shiftId: activeShift.id || ""};
}

function firebaseSafeSourceKey(value, fallback) {
  return financeText(value, 160).replace(/[.#$\/\[\]]/g, "_") || fallback || "source";
}
function historicalSuspenseCapitalEntry() {
  const at = Date.parse("2026-08-26T00:00:00+10:00");
  const sourceRef = "books/review/suspense-through-2026-08-26", sources = {}; sources[firebaseSafeSourceKey(sourceRef, "historical_suspense")] = true;
  return {id: "historical_suspense_capital_20260826", date: "2026-08-26", ref: "EQUITY-RECLASS-20260826", memo: "One-time close of verified historical POS payment-reclassification residual to Owner's Capital", lines: [{code: "1900", debit: 995, credit: 0}, {code: "3000", debit: 0, credit: 995}], source: "finance-control", sourceType: "equityMigration", sourceId: "historical_pos_suspense_through_2026_08_26", sourceRef, sources, createdAt: at, rebuiltAt: at, schemaVersion: 1};
}

function registerFloatControlEntry(amount, at, control) {
  amount = Financial.money(amount); at = Number(at) || Date.now();
  control = control || {source: "posSettings/fixedFloat", shiftId: ""};
  const sourceRef = financeText(control.source, 160), sourceKey = firebaseSafeSourceKey(sourceRef, "register_float");
  const sources = {}; sources[sourceKey] = true;
  return {id: "register_float_control", date: BooksBridge.businessDate(at), ref: "REGISTER-FLOAT", memo: "Register retained cash float · tied to live Register", lines: [{code: "1005", debit: amount, credit: 0}, {code: "1000", debit: 0, credit: amount}], source: "pos", sourceType: "registerFloat", sourceId: control.shiftId || "fixedFloat", sourceRef, sources, createdAt: at, rebuiltAt: at};
}

exports.syncRegisterCashFloat = onValueWritten(
  {ref: "/posSettings/fixedFloat", region: "asia-southeast1"},
  async (event) => {
    const db = getDatabase(), at = Date.now(), writes = {}, activeShift = (await db.ref("/posActiveShift").get()).val() || {};
    const before = resolveRegisterFloat({fixedFloat: event.data.before.val()}, activeShift), after = resolveRegisterFloat({fixedFloat: event.data.after.val()}, activeShift);
    if (Math.abs(before.amount - after.amount) < 0.005 && before.source === after.source) return;
    writes["books/journal/register_float_control"] = after.amount > 0 ? registerFloatControlEntry(after.amount, at, after) : null;
    writes[`operationalAudit/${at}_register_float`] = {action: "register_float_changed", sourceType: "posSettings", sourceId: "fixedFloat", before: before.amount, after: after.amount, journalId: "register_float_control", accounting: "Reclassify Cash on Hand to Register Cash Float; total cash unchanged", ts: at, schemaVersion: 1};
    await db.ref().update(writes);
  },
);

exports.syncActiveRegisterCashFloat = onValueWritten(
  {ref: "/posActiveShift", region: "asia-southeast1"},
  async (event) => {
    const db = getDatabase(), at = Date.now();
    const settings = (await db.ref("/posSettings").get()).val() || {};
    const before = resolveRegisterFloat(settings, event.data.before.val()), after = resolveRegisterFloat(settings, event.data.after.val());
    if (Math.abs(before.amount - after.amount) < 0.005 && before.source === after.source) return;
    const writes = {};
    writes["books/journal/register_float_control"] = after.amount > 0 ? registerFloatControlEntry(after.amount, at, after) : null;
    writes[`operationalAudit/${at}_register_float_live`] = {action: "register_float_synced", sourceType: "posActiveShift", sourceId: after.shiftId || "", before: before.amount, after: after.amount, journalId: "register_float_control", accounting: "Reclassify Cash on Hand to Register Cash Float; total cash unchanged", ts: at, schemaVersion: 1};
    await db.ref().update(writes);
  },
);

// Finance / Books owns cash-account maintenance. Opening changes are posted as
// append-only adjustments so later activity and the audit trail are preserved.
exports.manageCashAccount = onCall(
  {region: "asia-southeast1", enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true", timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow"]), data = request.data || {};
    if (financeText(data.action, 20) !== "upsert") throw new HttpsError("invalid-argument", "Unsupported cash-account action.");
    const id = financeKey(data.accountId, "Cash account"), commandId = financeKey(data.commandId, "Command ID"), name = financeText(data.name, 100), type = financeText(data.type, 20);
    if (!name || !["bank", "ewallet"].includes(type)) throw new HttpsError("invalid-argument", "Account name and a valid type are required.");
    const ref = db.ref(`/cfAccounts/${id}`), old = (await ref.get()).val() || {}, opening = Financial.money(data.opening), oldOpening = Financial.money(old.opening), date = financeDate(data.openingDate), occurredAt = Date.parse(`${date}T00:00:00+08:00`) || Date.now();
    const feedMethods = Array.isArray(data.feedMethods) ? data.feedMethods.map((x) => financeText(x, 60)).filter(Boolean).slice(0, 20) : [];
    const row = {name, type, opening, openingDate: date, feedMethods, order: Number.isFinite(Number(old.order)) ? Number(old.order) : Object.keys((await db.ref("/cfAccounts").get()).val() || {}).length, ts: old.ts || Date.now(), updatedAt: Date.now(), updatedBy: actor.uid};
    const writes = {[`cfAccounts/${id}`]: row}, delta = Financial.money(opening - oldOpening);
    if (Math.abs(delta) >= 0.005) {
      const value = Math.abs(delta), asset = `asset:cash_account:${id}`, lines = delta > 0 ? [Financial.line(asset, value, 0, "Opening cash adjustment"), Financial.line("equity:opening_balance", 0, value, "Opening cash adjustment")] : [Financial.line("equity:opening_balance", value, 0, "Opening cash adjustment"), Financial.line(asset, 0, value, "Opening cash adjustment")];
      const movementId = financeKey(`opening_adjust_${id}_${commandId}`, "Movement ID"), movement = Financial.movement("opening_balance_adjustment", "cashAccount", id, lines, {occurredAt, actorName: name});
      writes[`financialMovements/${movementId}`] = financeRecord(movementId, movement, actor);
    }
    writes[`operationalAudit/${Date.now()}_cash_account_${id}`] = {action: "cash_account_upsert", sourceType: "cashAccount", sourceId: id, oldOpening, opening, openingDate: date, actorUid: actor.uid, actorRole: actor.role, ts: Date.now(), schemaVersion: 1};
    await db.ref().update(writes); return {accountId: id, opening, adjustment: delta};
  },
);

// Platform (Grab/FoodPanda) order-number uniqueness. Every platform reference
// may be used ONCE. This trigger keeps an authoritative index the POS reads at
// entry to block a re-key, and records any duplicate that still slips through
// (offline/race) so nothing is silently double-counted in the receivable.
function platformRefKey(ref) {
  return String(ref || "").trim().toUpperCase().replace(/[.#$/\[\] -]/g, "_");
}
async function existingPlatformOrder(db, channel, ref, excludeOrderId) {
  const [ordersSnap, archiveSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get()]);
  const wantedChannel = String(channel || "").toLowerCase(), wantedKey = platformRefKey(ref), exclude = String(excludeOrderId || "");
  for (const [node, rows] of [["orders", ordersSnap.val() || {}], ["archivedOrders", archiveSnap.val() || {}]]) {
    for (const id of Object.keys(rows)) {
      const order = rows[id] || {};
      if (id === exclude || String(order.channel || "").toLowerCase() !== wantedChannel) continue;
      if (platformRefKey(order.platformRef || order.id || id) === wantedKey) return {id, node, order};
    }
  }
  return null;
}

exports.indexPlatformOrderRef = onValueCreated(
  {ref: "/orders/{orderId}", region: "asia-southeast1"},
  async (event) => {
    const o = event.data.val();
    if (!o) return;
    const channel = String(o.channel || "").toLowerCase();
    if (channel !== "grabfood" && channel !== "foodpanda") return;
    const rawRef = o.platformRef || o.id;
    const key = platformRefKey(rawRef);
    if (!key) return;
    const orderId = event.params.orderId;
    const db = getDatabase();
    const idxRef = db.ref(`/platformRefIndex/${channel}/${key}`);
    const tx = await idxRef.transaction((cur) => {
      if (cur == null) return {orderId, ref: String(rawRef), at: Number(o.timestamp) || Date.now()};
      return; // occupied -> abort, keep the first order that claimed this ref
    });
    if (tx.committed) return; // we reserved it for this order (first use)
    const existing = tx.snapshot.val() || {};
    if (existing.orderId === orderId) return; // same order re-fired -> already ours
    // A different order already owns this reference -> duplicate. Do not hide it.
    await db.ref(`/platformRefDuplicates/${orderId}`).set({
      channel, ref: String(rawRef), key,
      duplicateOf: existing.orderId || "", orderId,
      total: Number(o.total) || 0, detectedAt: Date.now(),
    });
    await db.ref(`/orders/${orderId}/dupPlatformRef`).set(true);
    logger.warn("Duplicate platform reference", {channel, ref: String(rawRef), orderId, duplicateOf: existing.orderId});
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
  "delete_archived_order", "review_discrepancy", "approve_petty_voucher", "correct_petty_voucher",
  "reject_petty_voucher", "void_petty_voucher", "return_supplier_payment", "manual_discount", "cash_in", "purchase_cash_advance", "fixed_float_exception", "reverse_purchase",
  "rekey_platform_order", "reverse_platform_payout", "correct_platform_presettlement", "set_undeposited_opening_balance", "retire_revolving_fund",
  "repair_closed_shift_turnover",
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
      if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) {
        throw new HttpsError("permission-denied", "Only managers may archive orders.");
      }
      const [orderSnap, archivedSnap] = await Promise.all([
        db.ref(`/orders/${orderId}`).get(), db.ref(`/archivedOrders/${orderId}`).get(),
      ]);
      if (!orderSnap.exists()) {
        if (archivedSnap.exists()) return {orderId, duplicate: true};
        throw new HttpsError("not-found", "Order not found.");
      }
      const order = Object.assign({id: orderId}, orderSnap.val() || {});
      if (order.shiftId) {
        const shift = (await db.ref(`/shifts/${financeKey(order.shiftId, "Shift ID")}`).get()).val() || null;
        if (shift && shift.status !== "closed") throw new HttpsError("failed-precondition", "Orders cannot be archived while their shift is open.");
      }
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
    const ref = db.ref(`/pettyCashVouchers/${id}`), snap = await ref.get(); if (!snap.exists()) throw new HttpsError("not-found", "Revolving Fund voucher not found.");
    const voucher = snap.val() || {}, value = Financial.money(voucher.amount), now = Date.now(); let approvalAction;
    if (action === "correct") {
      if (!["pending", "approved"].includes(voucher.status) || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active pending or approved cash payment can be edited.");
      if (voucher.returnedAt) throw new HttpsError("failed-precondition", "A returned supplier payment cannot be edited. Record a new correcting payment instead.");
      const nextAmount = Financial.money(data.amount), nextPayee = financeText(data.payee, 160), nextPurpose = financeText(data.purpose, 300), nextApprover = financeText(data.approverName, 160), reason = financeText(data.reason, 500), type = financeText(voucher.transactionType, 40) || "expense";
      if (!(nextAmount > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero.");
      if (!nextPayee) throw new HttpsError("invalid-argument", "Requester or supplier payee is required.");
      if (type === "purchase_advance" && !voucher.receiptImg) throw new HttpsError("failed-precondition", "A supplier receipt is required for this payment.");
      if (!voucher.receiptImg && !nextPurpose) throw new HttpsError("invalid-argument", "A receipt or clear explanation is required.");
      if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
      const expenseCategories = new Set(["operating_supplies","office_supplies","utilities","internet_phone","marketing","repairs","bank_fees","rent","salaries","transport","staff_meals","miscellaneous","other_expense"]), nextCategory = type === "purchase_advance" ? "Supplier payment pending inventory allocation" : type === "owner_withdrawal" ? "owner_draw" : financeText(data.category, 80);
      if (type === "expense" && !expenseCategories.has(nextCategory)) throw new HttpsError("invalid-argument", "Expense category is invalid.");
      const allocated = Financial.money(Object.values(voucher.allocations || {}).reduce((sum, row) => sum + Number(row && row.amount || 0), 0));
      if (type === "purchase_advance" && nextAmount + 0.009 < allocated) throw new HttpsError("failed-precondition", `Amount cannot be below the ${allocated.toFixed(2)} already allocated to inventory purchases.`);
      const nextDate = voucher.status === "pending" ? financeDate(data.date) : financeText(voucher.date, 10), before = {date:financeText(voucher.date,10),amount:value,category:financeText(voucher.category,80),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),approverName:financeText(voucher.approverName,160)}, after = {date:nextDate,amount:nextAmount,category:nextCategory,payee:nextPayee,purpose:nextPurpose,approverName:nextApprover};
      const revision = Math.max(0, Math.floor(Number(voucher.correctionRevision)||0)) + 1, writes = {[`pettyCashVouchers/${id}/date`]:nextDate,[`pettyCashVouchers/${id}/amount`]:nextAmount,[`pettyCashVouchers/${id}/category`]:nextCategory,[`pettyCashVouchers/${id}/requesterName`]:nextPayee,[`pettyCashVouchers/${id}/recipient`]:nextPayee,[`pettyCashVouchers/${id}/purpose`]:nextPurpose,[`pettyCashVouchers/${id}/approverName`]:nextApprover,[`pettyCashVouchers/${id}/correctionRevision`]:revision,[`pettyCashVouchers/${id}/lastCorrectedAt`]:now,[`pettyCashVouchers/${id}/lastCorrectionReason`]:reason};
      if (type === "purchase_advance") {writes[`pettyCashVouchers/${id}/allocatedAmount`]=allocated;writes[`pettyCashVouchers/${id}/remainingAmount`]=Financial.money(nextAmount-allocated);writes[`pettyCashVouchers/${id}/allocationStatus`]=allocated>0?(nextAmount-allocated>0?"partially_allocated":"fully_allocated"):"unallocated";}
      if (voucher.status === "pending") {writes[`operationalAudit/${now}_${id}_correct_${revision}`]=operationalAuditRecord("correct_pending_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision});await db.ref().update(writes);return {voucherId:id,action,revision,pending:true};}
      const approval = await claimManagerApproval(db,data,"correct_petty_voucher",id,nextAmount,`correct_petty_voucher_${id}_${revision}`), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, oldPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:voucher.recipient||"Supplier payment pending allocation"} : revolvingFundPosting(voucher), nextVoucher = Object.assign({},voucher,{amount:nextAmount,category:nextCategory,recipient:nextPayee,requesterName:nextPayee,purpose:nextPurpose,approverName:nextApprover}), nextPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:nextPayee} : revolvingFundPosting(nextVoucher), delta = Financial.money(nextAmount-value), correctionId = `petty_correct_${id}_${revision}`;
      let custodyWrites = {}; if (delta > 0) {const custodyOut=await poolCustodyOutflow(db,delta);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`The increase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);custodyWrites=custodyOut.writes;} else if (delta < 0) custodyWrites = poolCustodyInflowRecord(correctionId,-delta,"Cash payment correction returned",now,correctionId);
      const movement = Financial.movement("petty_cash_payment_correction","pettyVoucher",id,[Financial.line("asset:cash_awaiting_deposit",value,0,"Reverse previous cash payment"),Financial.line(oldPosting.account,0,value,"Reverse "+oldPosting.label),Financial.line(nextPosting.account,nextAmount,0,nextPosting.label),Financial.line("asset:cash_awaiting_deposit",0,nextAmount,"Corrected cash payment")],{occurredAt:now,actorName:approvedBy,approvalId:approval.id,voucherNo:financeText(voucher.voucherNo,60),category:nextCategory,payee:nextPayee,purpose:nextPurpose,correctionRevision:revision,correctionReason:reason});
      Object.assign(writes,approval.usedWrites,custodyWrites,{[`pettyCashVouchers/${id}/lastCorrectedBy`]:approvedBy,[`pettyCashVouchers/${id}/lastCorrectionApprovalId`]:approval.id,[`pettyCashVouchers/${id}/correctionMovementIds/${revision}`]:correctionId,[`operationalAudit/${now}_${id}_correct_${revision}`]:operationalAuditRecord("correct_approved_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision,approvalId:approval.id,movementId:correctionId})});
      const committed = await commitFinancial(db,correctionId,movement,actor,writes);return {voucherId:id,action,revision,movementId:correctionId,duplicate:committed.duplicate};
    }
    if (action === "return") {if(voucher.transactionType!=="purchase_advance"||voucher.status!=="approved"||voucher.voided===true)throw new HttpsError("failed-precondition","Only an active supplier payment can be returned.");const remaining=Financial.money(voucher.remainingAmount!=null?voucher.remainingAmount:value);if(!(remaining>0))throw new HttpsError("failed-precondition","This supplier payment has no unallocated balance to return.");if(!reason)throw new HttpsError("invalid-argument","A return reason is required.");const approval=await claimManagerApproval(db,data,"return_supplier_payment",id,remaining,`return_supplier_payment_${id}`),movementId=`petty_return_${id}`,movement=Financial.movement("revolving_fund_supplier_payment_return","pettyVoucher",id,[Financial.line("asset:cash_awaiting_deposit",remaining,0,"Returned to Undeposited Collection"),Financial.line(`asset:purchase_cash_advance:${id}`,0,remaining,"Clear unallocated supplier payment")],{occurredAt:now,actorName:approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,approvalId:approval.id}),writes=Object.assign({},approval.usedWrites,poolCustodyInflowRecord(`petty_return_${id}`,remaining,"Supplier payment returned",now,`petty_return_${id}`),{[`pettyCashVouchers/${id}/remainingAmount`]:0,[`pettyCashVouchers/${id}/allocationStatus`]:(Number(voucher.allocatedAmount)||0)>0?"partially_allocated_returned":"returned_unallocated",[`pettyCashVouchers/${id}/returnedAmount`]:remaining,[`pettyCashVouchers/${id}/returnedAt`]:now,[`pettyCashVouchers/${id}/returnReason`]:reason,[`pettyCashVouchers/${id}/returnApprovalId`]:approval.id,[`operationalAudit/${now}_${id}_return`]:operationalAuditRecord("return_supplier_payment","pettyVoucher",id,actor,{approvalId:approval.id,amount:remaining,reason})});const committed=await commitFinancial(db,movementId,movement,actor,writes);return {voucherId:id,action,amount:remaining,duplicate:committed.duplicate};}
    if (action === "approve") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be approved.");
      if (voucher.transactionType === "purchase_advance" && !voucher.receiptImg) throw new HttpsError("failed-precondition", "A supplier receipt is required before approval.");
      if (!voucher.receiptImg && !financeText(voucher.purpose, 300)) throw new HttpsError("failed-precondition", "A receipt or clear explanation is required before approval.");
      approvalAction = "approve_petty_voucher";
    } else if (action === "reject") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be rejected.");
      if (!reason) throw new HttpsError("invalid-argument", "A rejection reason is required."); approvalAction = "reject_petty_voucher";
    } else if (action === "void") {
      if (voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved voucher can be voided.");
      if (voucher.transactionType === "purchase_advance" && (Object.keys(voucher.allocations || {}).length || voucher.returnedAt)) throw new HttpsError("failed-precondition", "An allocated or returned supplier payment cannot be voided. Reverse its linked activity first.");
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
      const custodySnap = await db.ref("/cashCustody").get();
      baseFunds = Financial.money(Object.values(custodySnap.val() || {}).reduce((sum, row) => sum + Financial.money(row && row.remaining), 0));
    }
    let failure = "", duplicate = false; const vouchersRef = db.ref("/pettyCashVouchers"), vouchersInitial = (await vouchersRef.get()).val() || {}, transactionState = {seen: false};
    const result = await vouchersRef.transaction((all) => {
      all = transactionCurrent(all, vouchersInitial, transactionState); if (!all) return; all = Object.assign({}, all); const current = all[id]; failure = ""; duplicate = false;
      if (!current) {failure = "Revolving Fund voucher not found."; return;}
      if (action === "approve") {
        if (current.status === "approved" && current.approvalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be approved."; return;}
        if (current.transactionType === "purchase_advance" && !current.receiptImg) {failure = "A supplier receipt is required before approval."; return;}
        if (!current.receiptImg && !financeText(current.purpose, 300)) {failure = "A receipt or clear explanation is required before approval."; return;}
        const available = Financial.money(baseFunds);
        if (value > available + 0.009) {failure = `Voucher exceeds available Undeposited Collection (₱${available.toFixed(2)}).`; return;}
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
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord(`${action}_petty_voucher`, "pettyVoucher", id, actor, {approvalId: approval.id, amount: value, evidenceType: voucher.receiptImg ? "receipt" : "manager_reviewed_explanation", explanation: financeText(voucher.purpose, 300)})}));
    return {voucherId: id, action, at: now, duplicate};
  },
);

exports.retireRevolvingFund = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty", "cashflow"]);
    const data = request.data || {}, now = Date.now();
    const movementsSnap = await db.ref("/financialMovements").get(); let bal = 0;
    Object.values(movementsSnap.val() || {}).forEach((m) => ((m && m.lines) || []).forEach((l) => { if (l && l.account === "asset:petty_cash") bal = Financial.money(bal + Financial.money(l.debit) - Financial.money(l.credit)); }));
    bal = Financial.money(bal);
    if (data.preview === true) return {balance: bal, retired: false, preview: true};
    if (!(bal > 0)) return {balance: bal, retired: false, reason: "The Revolving Fund balance is already zero — nothing to retire."};
    const approval = await claimManagerApproval(db, data, "retire_revolving_fund", "revolvingFund", bal, "retire_revolving_fund");
    const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    const movementId = "revolving_fund_retirement", custodyId = "revfund_retirement";
    const movement = Financial.movement("revolving_fund_retirement", "revolvingFund", "retirement", [Financial.line("asset:cash_awaiting_deposit", bal, 0, "Revolving Fund folded into Undeposited Collection"), Financial.line("asset:petty_cash", 0, bal, "Retire Revolving Fund")], {occurredAt: now, actorName: approvedBy, approvalId: approval.id});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${custodyId}`]: {shiftId: custodyId, staff: "Revolving Fund retirement", amount: bal, depositedAmount: 0, remaining: bal, retainedFloat: 0, status: "awaiting_deposit", closedAt: now, movementId, source: "revolving_fund_retirement", schemaVersion: 2}, [`operationalAudit/${now}_revolving_fund_retirement`]: operationalAuditRecord("retire_revolving_fund", "revolvingFund", "retirement", actor, {approvalId: approval.id, amount: bal})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes);
    if (committed.duplicate) { await db.ref().update(approval.usedWrites); return {balance: bal, retired: false, duplicate: true}; }
    return {balance: bal, retired: true, amount: bal, approvalId: approval.id};
  },
);

function savedShiftCashSales(shift) {
  const sales = shift && shift.zReport && Array.isArray(shift.zReport.sales) ? shift.zReport.sales : [];
  let cash = 0;
  sales.forEach((order) => {
    const rows = Array.isArray(order.payments) && order.payments.length ? order.payments : [{method: order.payment, amount: order.total}];
    rows.forEach((row) => {if (String(row && row.method || "").toLowerCase() === "cash") cash = Financial.money(cash + Financial.money(row.amount));});
    const refunds = order.refundPayments || {};
    cash = Financial.money(cash - Financial.money(refunds.Cash || refunds.cash));
  });
  return Financial.money(Math.max(0, cash));
}

exports.repairClosedShiftTurnover = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow", "registerOps"]), data = request.data || {}, shiftId = financeKey(data.shiftId, "Shift ID"), movementId = `shift_custody_${shiftId}`;
    const [shiftSnap, movementSnap, custodySnap] = await Promise.all([db.ref(`/shifts/${shiftId}`).get(), db.ref(`/financialMovements/${movementId}`).get(), db.ref(`/cashCustody/${shiftId}`).get()]);
    const shift = shiftSnap.val() || null;
    if (!shift || shift.status !== "closed") throw new HttpsError("failed-precondition", "Select a closed shift.");
    const amount = savedShiftCashSales(shift);
    if (!(amount > 0)) throw new HttpsError("failed-precondition", "The saved shift transaction lines contain no cash turnover to repair.");
    if (movementSnap.exists() || custodySnap.exists()) return {shiftId, amount, duplicate: true, preview: data.preview === true};
    if (data.preview === true) return {shiftId, amount, staff: financeText(shift.staff, 100), closedAt: Number(shift.closeAt || 0), preview: true, duplicate: false};
    const approval = await claimManagerApproval(db, data, "repair_closed_shift_turnover", shiftId, amount, movementId), now = Date.now(), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    const movement = Financial.movement("shift_cash_to_custody", "shift", shiftId, [Financial.line("asset:cash_awaiting_deposit", amount, 0, "Confirmed closed-shift cash received"), Financial.line("asset:register_cash", 0, amount, "Closed-shift cash handed over")], {occurredAt:Number(shift.closeAt||now),actorName:approvedBy,approvalId:approval.id,repair:true,controlReason:"Manager confirmed omitted cash was physically received"});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${shiftId}`]:{shiftId,staff:financeText(shift.staff,100),amount,depositedAmount:0,remaining:amount,retainedFloat:Financial.money(shift.retainedFloat),status:"awaiting_deposit",closedAt:Number(shift.closeAt||now),movementId,source:"closed_shift_turnover_repair",schemaVersion:2},[`shifts/${shiftId}/turnoverCorrection`]:{amount,movementId,postedAt:now,postedBy:actor.uid,approvedBy,approvalId:approval.id,reason:"Confirmed cash received into Undeposited Collection",schemaVersion:1},[`operationalAudit/${now}_${shiftId}_turnover_repair`]:operationalAuditRecord("repair_closed_shift_turnover","shift",shiftId,actor,{amount,movementId,approvalId:approval.id,approvedBy})});
    const committed = await commitFinancial(db,movementId,movement,actor,writes);
    return {shiftId,amount,movementId,duplicate:committed.duplicate,repaired:!committed.duplicate};
  },
);

exports.setUndepositedOpeningBalance = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["petty", "cashflow"]), data = request.data || {}, amount = Financial.money(data.amount), date = financeDate(data.date), reference = financeText(data.reference, 120), reason = financeText(data.reason, 500);
    if (!(amount > 0)) throw new HttpsError("invalid-argument", "Beginning balance must be greater than zero.");
    if (!reference) throw new HttpsError("invalid-argument", "A cash-count or opening-balance reference is required.");
    if (!reason) throw new HttpsError("invalid-argument", "An opening-balance basis is required.");
    const movementId = "undeposited_opening_balance", custodyId = "undeposited_opening_balance", existing = await db.ref(`/financialMovements/${movementId}`).get();
    if (existing.exists()) throw new HttpsError("already-exists", "The Undeposited Collection beginning balance has already been posted.");
    const approval = await claimManagerApproval(db, data, "set_undeposited_opening_balance", "undepositedCollection", amount, movementId), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, occurredAt = Date.parse(`${date}T00:00:00+08:00`) || Date.now(), movement = Financial.movement("undeposited_opening_balance", "cashCustody", custodyId, [Financial.line("asset:cash_awaiting_deposit", amount, 0, "Undeposited Collection beginning balance"), Financial.line("equity:opening_balance", 0, amount, "Opening balance source")], {occurredAt,actorName:approvedBy,approvalId:approval.id,reference,reason});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${custodyId}`]:{shiftId:custodyId,staff:"Beginning balance",amount,depositedAmount:0,remaining:amount,retainedFloat:0,status:"awaiting_deposit",closedAt:occurredAt,movementId,source:"undeposited_opening_balance",reference,createdAt:Date.now(),createdBy:actor.uid,schemaVersion:2},[`undepositedOpeningBalance`]:{amount,date,reference,reason,movementId,custodyId,postedAt:Date.now(),postedBy:actor.uid,approvedBy,approvalId:approval.id,schemaVersion:1},[`operationalAudit/${Date.now()}_undeposited_opening_balance`]:operationalAuditRecord("set_undeposited_opening_balance","cashCustody",custodyId,actor,{amount,date,reference,reason,approvalId:approval.id,movementId})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes); return {amount,date,reference,movementId,duplicate:committed.duplicate};
  },
);

exports.repairPettyVoucherFinancial = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["petty", "cashflow"]), data = request.data || {}, id = financeKey(data.voucherId, "Voucher ID"), movementId = `petty_${id}`, existing = await db.ref(`/financialMovements/${movementId}`).get();
    if (existing.exists()) return {voucherId:id,movementId,duplicate:true};
    const voucher = (await db.ref(`/pettyCashVouchers/${id}`).get()).val();
    if (!voucher || voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved cash payment with a missing posting can be repaired.");
    const value = Financial.money(voucher.amount); if (!(value > 0)) throw new HttpsError("failed-precondition", "The approved cash payment amount is invalid.");
    const isAdvance = voucher.transactionType === "purchase_advance", posting = revolvingFundPosting(voucher), custodyOut = await poolCustodyOutflow(db, value);
    if (custodyOut.shortfall > 0.009) throw new HttpsError("failed-precondition", `Post the Undeposited Collection beginning balance first. Available cash is short by ${custodyOut.shortfall.toFixed(2)}.`);
    const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType,"pettyVoucher",id,[Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account,value,0,isAdvance?(voucher.recipient||"Supplier payment pending allocation"):posting.label),Financial.line("asset:cash_awaiting_deposit",0,value,"Paid from Undeposited Collection")],{occurredAt:cashPaymentOccurredAt(voucher),approvedAt:Number(voucher.approvedAt||0),actorName:voucher.approvedBy||"Manager",voucherNo:financeText(voucher.voucherNo,60),category:financeText(voucher.category,80),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),custodyAllocations:custodyOut.allocations,repairedAt:Date.now(),repairedBy:actor.uid});
    const now=Date.now(),writes=Object.assign({},custodyOut.writes,{[`pettyCashVouchers/${id}/financialMovementId`]:movementId,[`pettyCashVouchers/${id}/financialRepairedAt`]:now,[`pettyCashVouchers/${id}/financialRepairedBy`]:actor.uid,[`operationalAudit/${now}_${id}_financial_repair`]:operationalAuditRecord("repair_petty_voucher_financial","pettyVoucher",id,actor,{amount:value,movementId,custodyAllocations:custodyOut.allocations})}),committed=await commitFinancial(db,movementId,movement,actor,writes);
    return {voucherId:id,movementId,amount:value,duplicate:committed.duplicate};
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
function financeDate(value, allowFuture) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD.");
  if (allowFuture !== true) {
    const maxDate = financeDateFromTimestamp((Date.parse(`${financeDateFromTimestamp(Date.now())}T00:00:00+08:00`) || Date.now()) + 86400000);
    if (date > maxDate) throw new HttpsError("invalid-argument", `That date (${date}) is in the future. Postings can\u2019t be future-dated \u2014 use today\u2019s date or the date it actually happened.`);
  }
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
function accountingTimestamp(date, fallback) {
  const value = financeDate(date);
  return Date.parse(`${value}T12:00:00+08:00`) || Number(fallback) || Date.now();
}
function booksCodeAccount(code, accounts) {
  code = financeText(code, 4);
  if (!/^\d{4}$/.test(code)) throw new HttpsError("invalid-argument", "Every journal line requires a valid four-digit account code.");
  const allowed = new Set("1000 1005 1010 1011 1012 1013 1014 1020 1030 1040 1100 1110 1200 1210 1220 1230 1240 1250 1260 1270 1280 1290 1500 1510 1590 1900 2000 2020 2050 2090 2100 2200 2210 2220 2230 2300 3000 3050 3100 3900 4000 4010 4020 4030 4900 4910 4990 5000 5010 5020 5030 5040 5090 5900 6000 6010 6020 6030 6040 6045 6046 6050 6060 6070 6075 6080 6085 6090 6100 6110".split(" "));
  if (!allowed.has(code)) throw new HttpsError("failed-precondition", `Books account ${code} is not in the approved chart of accounts.`);
  if (code === "1000") return {account:"asset:register_cash", cashKey:"register"};
  if (code === "1005") return {account:"asset:register_float", cashKey:"float"};
  if (code === "1030") return {account:"asset:cash_awaiting_deposit", cashKey:"undeposited"};
  if (code === "1040") return {account:"asset:petty_cash", cashKey:"petty"};
  const matches = Object.keys(accounts || {}).filter((id) => BooksBridge.cashCodeForAccount(accounts[id]) === code);
  if (matches.length > 1) throw new HttpsError("failed-precondition", `Cash account code ${code} is assigned to more than one cash account.`);
  if (matches.length === 1) return {account:`asset:cash_account:${matches[0]}`, cashKey:matches[0]};
  if (/^(1010|1011|1012|1013|1014|1020)$/.test(code)) throw new HttpsError("failed-precondition", `Cash account code ${code} is not linked to a live cash account.`);
  return {account:`coa:${code}`, cashKey:""};
}
async function commitFinancial(db, movementId, movement, actor, extraWrites = {}) {
  movementId = financeKey(movementId, "Movement ID");
  const ref = db.ref(`/financialMovements/${movementId}`);
  const existing = await ref.get();
  if (existing.exists()) return {duplicate: true, movement: existing.val()};
  const record = financeRecord(movementId, movement, actor);
  const claimRef = db.ref(`/financialCommandClaims/${movementId}`), claimToken = crypto.randomBytes(12).toString("hex"), claimedAt = Date.now();
  const claim = await claimRef.transaction((current) => current || {status:"processing",token:claimToken,claimedAt,actorUid:actor.uid,schemaVersion:1});
  if (!claim.committed || !claim.snapshot.exists() || claim.snapshot.val().token !== claimToken) {
    const posted = await ref.get();
    return {duplicate: true, movement: posted.val() || null};
  }
  try {
    const writes = Object.assign({}, extraWrites, {[`financialMovements/${movementId}`]: record,[`financialCommandClaims/${movementId}`]:{status:"posted",token:claimToken,claimedAt,postedAt:Date.now(),actorUid:actor.uid,schemaVersion:1}});
    await db.ref().update(writes);
    return {duplicate: false, movement: record};
  } catch (error) {
    await claimRef.transaction((current) => current && current.token === claimToken && current.status === "processing" ? null : current);
    throw error;
  }
}
async function poolCustodyOutflow(db, value) {
  const need0 = Financial.money(value); if (!(need0 > 0)) return {writes: {}, fromCustody: 0, shortfall: 0, allocations: {}};
  const custody = (await db.ref("/cashCustody").get()).val() || {};
  const rows = Object.keys(custody).map((cid) => Object.assign({id: cid}, custody[cid])).filter((x) => Financial.money(x.remaining) > 0).sort((a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0));
  const writes = {}, allocations = {}; let need = need0, fromCustody = 0;
  for (const row of rows) { if (need <= 0) break; const available = Financial.money(row.remaining), use = Financial.money(Math.min(need, available)); if (!(use > 0)) continue; allocations[row.id] = use; fromCustody = Financial.money(fromCustody + use); need = Financial.money(need - use); const next = Financial.money(available - use); writes[`cashCustody/${row.id}/remaining`] = next; writes[`cashCustody/${row.id}/status`] = next > 0 ? "partially_paid_out" : "paid_out"; writes[`cashCustody/${row.id}/paidOutAmount`] = Financial.money(Number(row.paidOutAmount || 0) + use); writes[`cashCustody/${row.id}/lastPaymentAt`] = Date.now(); }
  return {writes, fromCustody, shortfall: Financial.money(need), allocations};
}
function poolCustodyInflowRecord(cid, value, label, occurredAt, movementId) {
  return {[`cashCustody/${cid}`]: {shiftId: cid, staff: financeText(label, 100), amount: Financial.money(value), depositedAmount: 0, remaining: Financial.money(value), retainedFloat: 0, status: "awaiting_deposit", closedAt: Number(occurredAt || Date.now()), movementId, source: "pool_inflow", schemaVersion: 2}};
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
  const effectiveStatus = order && order.status === "Archived" ? order.prevStatus : order && order.status;
  if (!order || !order.id || order.paymentStatus === "pending" || !["Completed", "Received"].includes(String(effectiveStatus || ""))) return {skipped: true};
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

async function fullOrderVoidMovement(db, order, accounts, settlementPayments) {
  const movementSnap = await db.ref("/financialMovements").get();
  const movement = Financial.netMovementCorrection(Object.values(movementSnap.val() || {}), order.id, "order_void", "Fully reverse voided order");
  if (!movement) return null;
  const remaining = Financial.money(Math.max(0, Financial.money(order.total) - Financial.money(order.refundAmount)));
  const settlement = Financial.reversalPosting(order, remaining, "void", accounts || {}, settlementPayments);
  movement.cashEntries = settlement.cashEntries || [];
  movement.settlementPayments = settlement.settlementPayments || [];
  movement.warnings = settlement.warnings || [];
  return movement;
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
      if (remaining > 0) { const movement = await fullOrderVoidMovement(db, order, accounts); if (movement) { movement.occurredAt = Number(order.voidedAt || Date.now()); movement.actorName = order.voidedBy || order.staff || "Void"; const movementId = `void_${order.id}`, writes = {}; addOrderCashWrites(writes, movement, movementId, order, actor); await commitFinancial(db, movementId, movement, actor, writes); } }
    }
  },
);

// Revenue-completeness control. Controlled archiving writes archivedOrders
// before removing the active record. If a posted sale is hard-deleted by any
// other path, preserve the evidence automatically and record the exception.
exports.preservePostedOrderOnDelete = onValueDeleted(
  {ref: "/orders/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const id = event.params.orderId, order = event.data.val() || {};
    if (!id) return;
    const db = getDatabase(), archivedRef = db.ref(`/archivedOrders/${id}`);
    if ((await archivedRef.get()).exists() || !(await db.ref(`/financialMovements/sale_${id}`).get()).exists()) return;
    const now = Date.now(), effectiveStatus = order.status === "Archived" ? order.prevStatus : order.status;
    const retained = Object.assign({}, order, {id, status: "Archived", prevStatus: effectiveStatus || "Completed", archivedAt: now, archiveReason: "Automatically preserved after unexpected deletion", recoveredFromDeletion: true, schemaVersion: Math.max(2, Number(order.schemaVersion) || 0)});
    const result = await archivedRef.transaction((current) => current || retained);
    if (result.committed) await db.ref(`/deletionAudit/${now}_order_${id}`).set({action: "posted_order_auto_preserved", sourceType: "order", sourceId: id, reason: "Posted sale had no archived order after deletion", ts: now, actorUid: "server", schemaVersion: 1});
  },
);

async function postShiftCashEntries(db, shiftId, entries, kind) {
  const actor = {uid: "server", role: "server"};
  for (let index = 0; index < (entries || []).length; index++) { const entry = entries[index] || {}, value = Financial.money(entry.amount); if (!(value > 0)) continue; const token = `${Number(entry.ts || 0)}_${index}`, movementId = `${kind}_${shiftId}_${token}`, isIn = kind === "shift_payin"; if (!isIn && (entry.type === "revolving_fund_replenishment" || /^petty cash replenish/i.test(String(entry.reason || "")))) continue; const isPurchaseAdvance = !isIn && entry.type === "purchase_advance" && entry.id; const lines = isIn ? [Financial.line("asset:register_cash", value, 0, entry.reason || "Cash in"), Financial.line(`offset:cash_in:${financeText(entry.reason || "other", 60)}`, 0, value, entry.reason || "Cash in")] : isPurchaseAdvance ? [Financial.line(`asset:purchase_cash_advance:${financeKey(entry.id, "Purchase advance ID")}`, value, 0, entry.reason || "Purchase cash advance"), Financial.line("asset:register_cash", 0, value, entry.reason || "Purchase cash advance")] : [Financial.line(`expense:cash_out:${financeText(entry.reason || "other", 60)}`, value, 0, entry.reason || "Cash out"), Financial.line("asset:register_cash", 0, value, entry.reason || "Cash out")]; const movement = Financial.movement(isPurchaseAdvance ? "purchase_cash_advance" : kind, "shift", shiftId, lines, {occurredAt: Number(entry.ts || Date.now()), actorName: entry.by || "Register", advanceId: entry.id || "", recipient: financeText(entry.recipient || "", 120)}); await commitFinancial(db, movementId, movement, actor); }
}
exports.onShiftPayInsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payIns", region: ORDER_REGION, retry: true}, async (event) => {if (!event.data.after.exists()) return; await postShiftCashEntries(getDatabase(), event.params.shiftId, event.data.after.val() || [], "shift_payin");});
exports.onShiftPayOutsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payOuts", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the register drawer never funds payments — cash out is drawn from Undeposited Collection via approved vouchers. Historical drawer pay-outs already posted (idempotent) and are unaffected. */ return; });
exports.onShiftOpenFinancial = onValueWritten({ref: "/shifts/{shiftId}", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the opening float stays in the drawer between shifts — no financial entry, no custody draw. */ return; });
exports.onShiftCloseFinancial = onValueWritten({ref: "/shifts/{shiftId}/status", region: ORDER_REGION, retry: true}, async (event) => {if (event.data.after.val() !== "closed" || event.data.before.val() === "closed") return; const db = getDatabase(), id=event.params.shiftId, shift = (await db.ref(`/shifts/${id}`).get()).val() || {}, actor={uid:"server",role:"server"}, occurredAt=Number(shift.closeAt||Date.now()), remittable=Financial.money(Math.max(0,Number(shift.cashToSettle)||0)); if (remittable>0) {const custody=Financial.movement("shift_cash_to_custody","shift",id,[Financial.line("asset:cash_awaiting_deposit",remittable,0,"Closed shift cash to settle"),Financial.line("asset:register_cash",0,remittable,"Closed shift cash to settle")],{occurredAt,actorName:shift.staff||"Register",retainedFloat:Financial.money(shift.retainedFloat)}); await commitFinancial(db,`shift_custody_${id}`,custody,actor,{[`cashCustody/${id}`]:{shiftId:id,staff:financeText(shift.staff,100),amount:remittable,depositedAmount:0,remaining:remittable,retainedFloat:Financial.money(shift.retainedFloat),status:"awaiting_deposit",closedAt:occurredAt,movementId:`shift_custody_${id}`,schemaVersion:2}});} const value = Financial.money(Math.abs(Number(shift.variance) || 0)); if (!(value > 0)) return; const short = Number(shift.variance) < 0, lines = short ? [Financial.line("expense:cash_shortage", value, 0, "Cash shortage"), Financial.line("asset:register_cash", 0, value, "Cash shortage")] : [Financial.line("asset:register_cash", value, 0, "Cash overage"), Financial.line("revenue:cash_overage", 0, value, "Cash overage")]; const movement = Financial.movement("shift_cash_variance", "shift", id, lines, {occurredAt, actorName: shift.staff || "Register"}); await commitFinancial(db, `shift_variance_${id}`, movement, actor);});

function revolvingFundPosting(row) {
  const type = financeText(row && row.transactionType, 40).toLowerCase(), raw = financeText(row && row.category, 80), key = raw.toLowerCase();
  if (type === "owner_withdrawal" || key === "owner_draw" || key === "owner draw" || key === "owner withdrawal") return {account:"equity:owner_draw", label:"Owner withdrawal", movementType:"revolving_fund_owner_withdrawal"};
  const map = {
    operating_supplies:["expense:supplies","Cleaning & operating supplies"], supplies:["expense:supplies","Cleaning & operating supplies"],
    office_supplies:["expense:office_supplies","Office & administrative supplies"], utilities:["expense:utilities","Utilities"],
    internet_phone:["expense:internet","Internet & phone"], "internet & phone":["expense:internet","Internet & phone"],
    marketing:["expense:marketing","Marketing & promotions"], repairs:["expense:repairs","Repairs & maintenance"], "repairs & maintenance":["expense:repairs","Repairs & maintenance"],
    bank_fees:["expense:bank_charges","Bank & payment fees"], rent:["expense:rent","Rent"], salaries:["expense:salaries","Salaries & wages"],
    transport:["expense:other_expense","Transportation / delivery"], "transportation / delivery":["expense:other_expense","Transportation / delivery"],
    staff_meals:["expense:other_expense","Staff meals / welfare"], "staff meals":["expense:other_expense","Staff meals / welfare"],
    miscellaneous:["expense:other_expense","Other operating expense"], other_expense:["expense:other_expense","Other operating expense"]
  }, mapped = map[key] || ["expense:other_expense", raw || "Other operating expense"];
  return {account:mapped[0], label:mapped[1], movementType:"petty_cash_expense"};
}
function cashPaymentOccurredAt(row) {
  const date = financeText(row && row.date, 10);
  return (/^\d{4}-\d{2}-\d{2}$/.test(date) && Date.parse(`${date}T00:00:00+08:00`)) || Number(row && (row.approvedAt || row.createdAt)) || Date.now();
}

exports.onPettyVoucherFinancial = onValueWritten(
  {ref: "/pettyCashVouchers/{voucherId}", region: ORDER_REGION, retry: true},
  async (event) => {const before = event.data.before.val() || {}, after = event.data.after.val(); if (!after) return; const db = getDatabase(), id = event.params.voucherId, value = Financial.money(after.amount), actor = {uid: "server", role: "server"}, isAdvance=after.transactionType==="purchase_advance", posting=revolvingFundPosting(after); if (after.status === "approved" && before.status !== "approved" && value > 0) {const custodyOut = await poolCustodyOutflow(db, value); const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType, "pettyVoucher", id, [Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, value, 0, isAdvance?(after.recipient||"Supplier payment pending allocation"):posting.label), Financial.line("asset:cash_awaiting_deposit", 0, value, "Paid from Undeposited Collection")], {occurredAt:cashPaymentOccurredAt(after),approvedAt:Number(after.approvedAt||Date.now()),actorName:after.approvedBy||"Manager",voucherNo:financeText(after.voucherNo,60),category:financeText(after.category,80),payee:financeText(after.recipient||after.requesterName,160),purpose:financeText(after.purpose,300),custodyAllocations:custodyOut.allocations}); await commitFinancial(db, `petty_${id}`, movement, actor, custodyOut.writes);} if (after.voided === true && before.voided !== true && after.status === "approved" && value > 0) {const inflow = poolCustodyInflowRecord(`petty_void_${id}`, value, isAdvance?"Supplier payment voided":"Expense voided", Number(after.voidedAt || Date.now()), `petty_void_${id}`); const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance_void":posting.movementType+"_void", "pettyVoucher", id, [Financial.line("asset:cash_awaiting_deposit", value, 0, "Returned to Undeposited Collection"), Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, 0, value, isAdvance?"Reverse supplier payment":"Reverse "+posting.label)], {occurredAt:Number(after.voidedAt||Date.now()),actorName:"Manager",voucherNo:financeText(after.voucherNo,60),category:financeText(after.category,80),payee:financeText(after.recipient||after.requesterName,160),purpose:financeText(after.purpose,300)}); await commitFinancial(db, `petty_void_${id}`, movement, actor, inflow);}},
);
exports.onPettyReplenishmentFinancial = onValueWritten(
  {ref: "/pettyCashReplenishments/{replenishmentId}", region: ORDER_REGION, retry: true},
  async (event) => {if (!event.data.after.exists() || event.data.before.exists()) return; const row = event.data.after.val() || {}, value = Financial.money(row.amount); if (!(value > 0)) return; const id = event.params.replenishmentId, source = row.source === "register" ? "asset:register_cash" : "equity:owner_capital", movement = Financial.movement("petty_cash_replenishment", "pettyReplenishment", id, [Financial.line("asset:petty_cash", value, 0, "Revolving Fund replenished"), Financial.line(source, 0, value, row.source || "owner")], {occurredAt: Number(row.ts || Date.now()), actorName: row.by || "Admin"}); await commitFinancial(getDatabase(), `petty_replenish_${id}`, movement, {uid: "server", role: "server"});},
);
async function backfillPettyVoucher(db, id, row) {const value = Financial.money(row && row.amount), actor = {uid: "server", role: "server"}, isAdvance=row&&row.transactionType==="purchase_advance", posting=revolvingFundPosting(row); if (!row || row.status !== "approved" || !(value > 0)) return; const detail={occurredAt:cashPaymentOccurredAt(row),approvedAt:Number(row.approvedAt||0),actorName:row.approvedBy||"Manager",voucherNo:financeText(row.voucherNo,60),category:financeText(row.category,80),payee:financeText(row.recipient||row.requesterName,160),purpose:financeText(row.purpose,300)},expense = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType, "pettyVoucher", id, [Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, value, 0, isAdvance?(row.recipient||"Supplier payment pending allocation"):posting.label), Financial.line("asset:cash_awaiting_deposit", 0, value, "Paid from Undeposited Collection")], detail); await commitFinancial(db, `petty_${id}`, expense, actor); if (row.voided === true) {const reversal = Financial.movement(isAdvance?"revolving_fund_purchase_advance_void":posting.movementType+"_void", "pettyVoucher", id, [Financial.line("asset:cash_awaiting_deposit", value, 0, "Returned to Undeposited Collection"), Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, 0, value, isAdvance?"Reverse supplier payment":"Reverse "+posting.label)], {occurredAt:Number(row.voidedAt||Date.now()),actorName:"Manager",voucherNo:detail.voucherNo,category:detail.category,payee:detail.payee,purpose:detail.purpose}); await commitFinancial(db, `petty_void_${id}`, reversal, actor);}}
async function backfillPettyReplenishment(db, id, row) {const value = Financial.money(row && row.amount); if (!(value > 0)) return; const source = row.source === "register" ? "asset:register_cash" : "equity:owner_capital", movement = Financial.movement("petty_cash_replenishment", "pettyReplenishment", id, [Financial.line("asset:petty_cash", value, 0, "Revolving Fund replenished"), Financial.line(source, 0, value, row.source || "owner")], {occurredAt: Number(row.ts || Date.now()), actorName: row.by || "Admin"}); await commitFinancial(db, `petty_replenish_${id}`, movement, {uid: "server", role: "server"});}
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

// Fixed assets register: acquire, manual straight-line depreciation run, and disposal.
// Posts double-entry movements (bridge maps fixed_asset->1500/1510, accum dep->1590,
// depreciation->6090) and maintains /fixedAssets. Depreciation is idempotent per period.
exports.manageFixedAsset = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 40);
    const actor = await requirePortalPermission(db, request, ["cashflow", "purchases"]);
    const commandId = financeKey(data.commandId, "Command ID"); const now = Date.now();
    const M = (v) => Financial.money(v);
    if (action === "create") {
      const assetId = financeKey(data.assetId, "Asset ID"), name = financeText(data.name, 120) || "Asset";
      const reference = financeText(data.ref || (data.funding && data.funding.ref), 120); if (!reference) throw new HttpsError("invalid-argument", "Receipt, invoice, or acquisition reference is required.");
      const category = financeText(data.category || "equipment", 40).toLowerCase();
      const cost = M(data.cost); if (!(cost > 0)) throw new HttpsError("invalid-argument", "Cost must be greater than zero.");
      const salvage = Math.max(0, M(data.salvage || 0)); if (salvage >= cost) throw new HttpsError("invalid-argument", "Salvage must be less than cost.");
      const life = Math.max(1, Math.round(Number(data.usefulLifeMonths) || 0));
      const acquiredDate = financeDate(data.acquiredDate); const occurredAt = Date.parse(`${acquiredDate}T00:00:00+08:00`) || now;
      const funding = data.funding || {}; const writes = {}; let creditLine,fundingMeta={fundingType:financeText(funding.type||"cash",20)};
      if (funding.type === "payable") {
        creditLine = Financial.line(`liability:payable:${assetId}`, 0, cost, name);
        writes[`payables/${assetId}`] = {party: financeText(funding.party || name, 120), type: "fixed asset", amount: cost, date: acquiredDate, due: funding.due ? financeDate(funding.due, true) : "", ref: reference, status: "open", movementId: commandId, ts: now, createdBy: actor.uid, schemaVersion: 1};
      } else if (funding.type === "owner_funded") {
        const ownerName=financeText(funding.ownerName,120),treatment=financeText(funding.treatment,20)==="reimburse"?"reimburse":"capital",reimbursementId=`owner_fa_${assetId}`;
        if(!ownerName)throw new HttpsError("invalid-argument","Owner or partner name is required.");
        creditLine=Financial.line(treatment==="reimburse"?`liability:due_to_owner:${reimbursementId}`:"equity:capital_in",0,cost,`Paid personally by ${ownerName}`);
        if(treatment==="reimburse")writes[`payables/${reimbursementId}`]={party:ownerName,type:"owner reimbursement",amount:cost,date:acquiredDate,due:"",ref:reference,status:"open",movementId:commandId,fixedAssetId:assetId,liabilityAccount:`liability:due_to_owner:${reimbursementId}`,ts:now,createdBy:actor.uid,schemaVersion:1};
        fundingMeta={fundingType:"owner_funded",ownerName,ownerTreatment:treatment,ownerReimbursementId:treatment==="reimburse"?reimbursementId:"",fundingOffsetAccount:treatment==="reimburse"?`liability:due_to_owner:${reimbursementId}`:"equity:capital_in"};
      } else {
        const accounts = (await db.ref("/cfAccounts").get()).val() || {}; const accountId = accountIdFor(accounts, funding.accountId);
        creditLine = Financial.line(`asset:cash_account:${accountId}`, 0, cost, name);
      }
      const movement = Financial.movement("fixed_asset_acquired", "fixedAsset", assetId, [Financial.line(`asset:fixed_asset:${category}`, cost, 0, name), creditLine], {occurredAt, actorName: actor.role, reference});
      writes[`fixedAssets/${assetId}`] = Object.assign({name, category, cost, salvage, usefulLifeMonths: life, method: "straight-line", acquiredDate, reference, accumulatedDepreciation: 0, status: "active", depreciation: {}, movementId: commandId, createdBy: actor.uid, ts: now, schemaVersion: 1},fundingMeta);
      const res = await commitFinancial(db, `fa_acq_${assetId}`, movement, actor, writes);
      return {assetId, duplicate: res.duplicate === true};
    }
    if (action === "depreciate") {
      const period = financeText(data.period, 7); if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpsError("invalid-argument", "Period must be YYYY-MM.");
      const assets = (await db.ref("/fixedAssets").get()).val() || {}; const posted = []; const occurredAt = Date.parse(`${period}-28T00:00:00+08:00`) || now;
      for (const id of Object.keys(assets)) {
        const a = assets[id]; if (!a || a.status !== "active") continue;
        if (a.depreciation && a.depreciation[period] != null) continue;
        const depreciable = M(M(a.cost) - M(a.salvage || 0)), already = M(a.accumulatedDepreciation || 0), remaining = M(depreciable - already);
        if (!(remaining > 0)) continue;
        const monthly = M(depreciable / Math.max(1, a.usefulLifeMonths)), amount = M(Math.min(monthly, remaining));
        if (!(amount > 0)) continue;
        const movement = Financial.movement("depreciation", "fixedAsset", id, [Financial.line("expense:depreciation", amount, 0, `${a.name} ${period}`), Financial.line("asset:accumulated_depreciation", 0, amount, `${a.name} ${period}`)], {occurredAt, actorName: actor.role});
        const writes = {[`fixedAssets/${id}/accumulatedDepreciation`]: M(already + amount), [`fixedAssets/${id}/depreciation/${period}`]: amount};
        if (M(already + amount) >= depreciable - 0.005) writes[`fixedAssets/${id}/status`] = "fully_depreciated";
        await commitFinancial(db, `dep_${id}_${period}`, movement, actor, writes); posted.push({assetId: id, amount});
      }
      return {period, count: posted.length, posted};
    }
    if(action==="reverse_acquisition"){
      const assetId=financeKey(data.assetId,"Asset ID"),a=(await db.ref(`/fixedAssets/${assetId}`).get()).val();if(!a)throw new HttpsError("not-found","Asset not found.");if(a.status==="acquisition_reversed")throw new HttpsError("failed-precondition","Asset acquisition is already reversed.");if(a.fundingType!=="owner_funded")throw new HttpsError("failed-precondition","Only personally funded acquisitions use this reversal.");if(M(a.accumulatedDepreciation||0)>0)throw new HttpsError("failed-precondition","Reverse posted depreciation before reversing this acquisition.");const reason=financeText(data.reason,300);if(!reason)throw new HttpsError("invalid-argument","Reversal reason is required.");const reimbursementId=financeText(a.ownerReimbursementId,160),reimbursement=reimbursementId?(await db.ref(`/payables/${reimbursementId}`).get()).val():null;if(reimbursement&&reimbursement.status==="paid")throw new HttpsError("failed-precondition","The owner/partner was already reimbursed. Reverse that payment first.");const cost=M(a.cost),offset=a.fundingOffsetAccount||(a.ownerTreatment==="reimburse"?`liability:due_to_owner:${reimbursementId}`:"equity:capital_in"),writes={[`fixedAssets/${assetId}/status`]:"acquisition_reversed",[`fixedAssets/${assetId}/reversedAt`]:now,[`fixedAssets/${assetId}/reversalReason`]:reason};if(reimbursementId){writes[`payables/${reimbursementId}/status`]="reversed";writes[`payables/${reimbursementId}/reversedAt`]=now;}const movement=Financial.movement("fixed_asset_acquisition_reversed","fixedAsset",assetId,[Financial.line(offset,cost,0,"Reverse personal funding"),Financial.line(`asset:fixed_asset:${a.category}`,0,cost,"Reverse asset acquisition")],{occurredAt:now,actorName:actor.role,reason});const res=await commitFinancial(db,`fa_acq_reverse_${assetId}`,movement,actor,writes);return{assetId,duplicate:res.duplicate===true};
    }
    if (action === "dispose") {
      const assetId = financeKey(data.assetId, "Asset ID"), a = (await db.ref(`/fixedAssets/${assetId}`).get()).val();
      if (!a) throw new HttpsError("not-found", "Asset not found.");
      if (a.status === "disposed") throw new HttpsError("failed-precondition", "Asset already disposed.");
      const proceeds = Math.max(0, M(data.proceeds || 0)), cost = M(a.cost), accum = M(a.accumulatedDepreciation || 0), nbv = M(cost - accum);
      const lines = [Financial.line("asset:accumulated_depreciation", accum, 0, "Remove accumulated depreciation")];
      if (proceeds > 0) { const accounts = (await db.ref("/cfAccounts").get()).val() || {}; const accountId = accountIdFor(accounts, data.accountId); lines.push(Financial.line(`asset:cash_account:${accountId}`, proceeds, 0, "Disposal proceeds")); }
      lines.push(Financial.line(`asset:fixed_asset:${a.category}`, 0, cost, "Remove asset cost"));
      const gainLoss = M(proceeds - nbv);
      if (gainLoss > 0) lines.push(Financial.line("revenue:asset_disposal_gain", 0, gainLoss, "Gain on disposal"));
      else if (gainLoss < 0) lines.push(Financial.line("expense:asset_disposal_loss", M(-gainLoss), 0, "Loss on disposal"));
      const occurredAt = Date.parse(`${financeDate(data.date)}T00:00:00+08:00`) || now;
      const reference=financeText(data.ref,120),movement = Financial.movement("fixed_asset_disposed", "fixedAsset", assetId, lines, {occurredAt, actorName: actor.role, reference});
      await commitFinancial(db, `fa_disp_${assetId}`, movement, actor, {[`fixedAssets/${assetId}/status`]: "disposed", [`fixedAssets/${assetId}/disposedAt`]: now, [`fixedAssets/${assetId}/disposalReference`]:reference, [`fixedAssets/${assetId}/proceeds`]: proceeds, [`fixedAssets/${assetId}/gainLoss`]: gainLoss});
      return {assetId, gainLoss};
    }
    throw new HttpsError("invalid-argument", "Unknown fixed-asset action.");
  },
);

exports.postFinancialCommand = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 40);
    const perms = action.indexOf("inventory_opening_balance") === 0 ? ["purchases", "cashflow"] : action.includes("payable") ? ["payables", "purchases"] : action.includes("receivable") ? ["receivables"] : ["cashflow", "receivables", "payables", "purchases"];
    const actor = await requirePortalPermission(db, request, perms); const commandId = financeKey(data.commandId, "Command ID");
    const accounts = (await db.ref("/cfAccounts").get()).val() || {}, chart = await ensureChartAccounts(db); const now = Date.now(); let movement, writes = {}, result = {};
    function amount(v) { const x = Financial.money(v); if (!(x > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero."); return x; }
    function addCash(id, entry) { writes[`cfLedger/${id}`] = cashLedgerRecord(entry, commandId, movement, actor); }
    if (action === "inventory_opening_balance") {
      const inventory = (await db.ref("/inventory").get()).val() || {}, journal = (await db.ref("/books/journal").get()).val() || {}, reconciliation = BooksBridge.inventoryReconciliationSnapshot(inventory, journal);
      if (reconciliation.unmapped.length) throw new HttpsError("failed-precondition", `${reconciliation.unmapped.length} stock item(s) with value are missing an inventory account. Map them before posting.`);
      if (Math.abs(reconciliation.clearingBalance) >= 0.005) throw new HttpsError("failed-precondition", `Inventory Receiving Clearing 1290 must be zero before posting. Current balance: ${reconciliation.clearingBalance}.`);
      const existing = (await db.ref("/inventoryReconciliations/openingBalance").get()).val();
      if (data.preview === true) return Object.assign({alreadyPosted:!!existing}, reconciliation);
      if (existing) throw new HttpsError("already-exists", "The inventory opening balance has already been posted.");
      const expected = Financial.money(data.expectedDifference);
      if (Math.abs(expected - reconciliation.totalDifference) >= 0.005) throw new HttpsError("failed-precondition", "Inventory or Books changed after preview. Refresh and review the new reconciliation before posting.");
      const lines=[];reconciliation.rows.forEach((row)=>{if(Math.abs(row.difference)<0.005)return;lines.push(Financial.line(`coa:${row.code}`,row.difference>0?row.difference:0,row.difference<0?-row.difference:0,`Opening inventory reconciliation ${row.code}`));});
      if (reconciliation.totalDifference>0) lines.push(Financial.line("equity:opening_balance",0,reconciliation.totalDifference,"Opening inventory balance"));
      else if (reconciliation.totalDifference<0) lines.push(Financial.line("equity:opening_balance",-reconciliation.totalDifference,0,"Opening inventory balance"));
      if (!lines.length || !BooksBridge.linesBalanced(lines)) throw new HttpsError("failed-precondition", "The calculated opening inventory entry is empty or unbalanced.");
      const date=financeDate(data.date),occurredAt=Date.parse(`${date}T00:00:00+08:00`)||now,movementId="inventory_opening_balance";
      movement=Financial.movement("inventory_opening_balance","inventoryReconciliation","openingBalance",lines,{occurredAt,actorName:actor.role});
      writes["inventoryReconciliations/openingBalance"]={movementId,date,stockValue:reconciliation.totalStock,booksValueBefore:reconciliation.totalBooks,adjustment:reconciliation.totalDifference,rows:reconciliation.rows,postedAt:now,postedBy:actor.uid,postedRole:actor.role,schemaVersion:1};
      result={stockValue:reconciliation.totalStock,booksValueBefore:reconciliation.totalBooks,adjustment:reconciliation.totalDifference,rows:reconciliation.rows};
      const committed = await commitFinancial(db,movementId,movement,actor,writes);return Object.assign(result,{movementId,duplicate:committed.duplicate});
    } else if (action === "inventory_opening_balance_repost") {
      const inventory = (await db.ref("/inventory").get()).val() || {}, journal = (await db.ref("/books/journal").get()).val() || {}, reconciliation = BooksBridge.inventoryReconciliationSnapshot(inventory, journal);
      const existing = (await db.ref("/inventoryReconciliations/openingBalance").get()).val();
      if (data.preview === true) return Object.assign({canRepost: !!(existing && existing.movementId)}, reconciliation);
      if (!existing || !existing.movementId) throw new HttpsError("failed-precondition", "There is no posted opening inventory balance to re-post.");
      if (reconciliation.unmapped.length) throw new HttpsError("failed-precondition", `${reconciliation.unmapped.length} stock item(s) with value are missing an inventory account. Map them before re-posting.`);
      const original = (await db.ref(`/financialMovements/${financeKey(existing.movementId, "Opening movement ID")}`).get()).val();
      if (!original || !Array.isArray(original.lines)) throw new HttpsError("failed-precondition", "The prior opening balance movement is missing; cannot reverse it cleanly.");
      const seq = Number(existing.repostSeq || 0) + 1, date = financeDate(data.date), occurredAt = Date.parse(`${date}T00:00:00+08:00`) || now;
      const oldRows = {};
      original.lines.forEach((l) => { const m = /^coa:(\d{4})$/.exec(String(l.account || "")); if (m) oldRows[m[1]] = Financial.money((oldRows[m[1]] || 0) + Number(l.debit || 0) - Number(l.credit || 0)); });
      const reversal = Financial.reverseMovement(original, "inventory_opening_balance_reversal", "Reverse prior opening inventory");
      reversal.occurredAt = occurredAt; reversal.reversesMovementId = existing.movementId;
      const reversalId = `inventory_opening_balance_reversal_${seq}`;
      // Include 1290 clearing (physical stock 0) so the re-post also zeroes any parked
      // COGS/receiving balance in one action - no separate Books rebuild required.
      const rebalanceRows = reconciliation.rows.concat([{code: "1290", stockValue: 0, booksValue: reconciliation.clearingBalance}]);
      const freshLines = BooksBridge.openingRebalanceLines(rebalanceRows, oldRows).map((l) => Financial.line(l.account, l.debit, l.credit, l.label));
      if (!freshLines.length || !BooksBridge.linesBalanced(freshLines)) throw new HttpsError("failed-precondition", "The recomputed opening inventory entry is empty or unbalanced.");
      const freshId = `inventory_opening_balance_v${seq}`, fresh = Financial.movement("inventory_opening_balance", "inventoryReconciliation", "openingBalance", freshLines, {occurredAt, actorName: actor.role, repostSeq: seq});
      const extra = {};
      extra[`inventoryReconciliations/history/${now}_${financeKey(existing.movementId, "Opening movement ID")}`] = Object.assign({}, existing, {archivedAt: now, archivedBy: actor.uid});
      extra["inventoryReconciliations/openingBalance"] = {movementId: freshId, repostSeq: seq, reversedMovementId: existing.movementId, reversalMovementId: reversalId, date, stockValue: reconciliation.totalStock, booksValueBefore: reconciliation.totalBooks, adjustment: reconciliation.totalDifference, rows: reconciliation.rows, postedAt: now, postedBy: actor.uid, postedRole: actor.role, schemaVersion: 1};
      await commitFinancial(db, reversalId, reversal, actor);
      const committed = await commitFinancial(db, freshId, fresh, actor, extra);
      return {movementId: freshId, reversalMovementId: reversalId, stockValue: reconciliation.totalStock, booksValueBefore: reconciliation.totalBooks, adjustment: reconciliation.totalDifference, reposted: seq, duplicate: committed.duplicate};
    } else if (action === "purchase_owner_funded") {
      const invoiceId = financeKey(data.invoiceId, "Purchase invoice ID"), invoice = (await db.ref(`/purchaseInvoices/${invoiceId}`).get()).val();
      if (!invoice) throw new HttpsError("not-found", "Purchase invoice was not found.");
      if (invoice.reversed === true) throw new HttpsError("failed-precondition", "A reversed purchase cannot be funded by owner capital.");
      if (invoice.payMode !== "owner_funded") throw new HttpsError("failed-precondition", "This purchase is not marked as paid personally by owner/partner.");
      const value = amount(invoice.total), date = financeDate(data.date || invoice.date), split = await purchaseInventoryLines(db, invoice, false), ownerName=financeText(data.ownerName||invoice.ownerName,120),ownerTreatment=financeText(data.ownerTreatment||invoice.ownerTreatment,20)==="reimburse"?"reimburse":"capital";
      if (!ownerName) throw new HttpsError("invalid-argument", "Owner or partner name is required.");
      const reimbursementId=`owner_${invoiceId}`,offset=ownerTreatment==="reimburse"?`liability:due_to_owner:${reimbursementId}`:"equity:capital_in";
      movement = Financial.movement("purchase_owner_funded", "purchaseInvoice", invoiceId, split.concat([Financial.line(offset, 0, value, `Paid personally by ${ownerName}`)]), {occurredAt: Date.parse(`${date}T00:00:00+08:00`) || now, actorName: actor.role,ownerName,ownerTreatment});
      if(ownerTreatment==="reimburse")writes[`payables/${reimbursementId}`]={party:ownerName,type:"owner reimbursement",amount:value,date,due:"",ref:financeText(invoice.ref,120),status:"open",movementId:commandId,purchaseInvoiceId:invoiceId,liabilityAccount:offset,ts:now,createdBy:actor.uid,schemaVersion:1};
      writes[`purchaseInvoices/${invoiceId}/fundingMovementId`] = commandId;
      writes[`purchaseInvoices/${invoiceId}/ownerName`] = ownerName;
      writes[`purchaseInvoices/${invoiceId}/ownerTreatment`] = ownerTreatment;
      writes[`purchaseInvoices/${invoiceId}/ownerReimbursementId`] = ownerTreatment==="reimburse"?reimbursementId:"";
      writes[`purchaseInvoices/${invoiceId}/ownerFundedAt`] = now;
      writes[`purchaseInvoices/${invoiceId}/ownerFundedBy`] = actor.uid;
    } else if (action === "purchase_paid") {
      const invoiceId = financeKey(data.invoiceId, "Purchase invoice ID"), invoice = (await db.ref(`/purchaseInvoices/${invoiceId}`).get()).val();
      if (!invoice) throw new HttpsError("not-found", "Purchase invoice was not found.");
      const requestedAccount = financeText(data.accountId, 120), advanceId = data.advanceId ? financeKey(data.advanceId, "Purchase advance ID") : "", savedAccount = financeText(invoice.accountId,120), fromCashOnHand = requestedAccount === "cash_on_hand", fromUndeposited = requestedAccount === "undeposited";
      if (!advanceId && savedAccount !== requestedAccount) throw new HttpsError("failed-precondition", "The selected payment account does not match the saved purchase record. Refresh and retry the same purchase.");
      if (!advanceId && (requestedAccount === "register" || requestedAccount === "cash_float")) throw new HttpsError("failed-precondition", "Register Cash is retired and Cash Float is controlled. Select Cash on Hand, Undeposited Collection, or an active bank/cash account.");
      const accountId = advanceId ? "" : (fromCashOnHand || fromUndeposited ? requestedAccount : accountIdFor(accounts, requestedAccount)), value = amount(invoice.total), date = financeDate(data.date), split = await purchaseInventoryLines(db, invoice, false); let cashAsset = fromCashOnHand ? "asset:register_cash" : fromUndeposited ? "asset:cash_awaiting_deposit" : `asset:cash_account:${accountId}`, custodyAllocations = {};
      if (fromUndeposited) {const custodyOut = await poolCustodyOutflow(db, value);if (custodyOut.shortfall > 0.009) throw new HttpsError("failed-precondition", `Purchase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);Object.assign(writes,custodyOut.writes);custodyAllocations=custodyOut.allocations;Object.keys(custodyOut.allocations).forEach((id)=>{writes[`cashCustody/${id}/lastPaymentMovementId`]=commandId;});}
      if (advanceId) {const [shiftsSnap,fundSnap]=await Promise.all([db.ref("/shifts").get(),db.ref(`/pettyCashVouchers/${advanceId}`).get()]),shifts=shiftsSnap.val()||{};let found=null;for(const shiftId of Object.keys(shifts)){const rows=Array.isArray(shifts[shiftId].payOuts)?shifts[shiftId].payOuts:[];const index=rows.findIndex((row)=>row&&row.id===advanceId&&row.type==="purchase_advance");if(index>=0){found={kind:"shift",shiftId,index,row:rows[index]};break;}}if(!found&&fundSnap.exists()){const row=fundSnap.val()||{};if(row.transactionType==="purchase_advance"&&row.status==="approved"&&!row.voided)found={kind:"revolving",row};}if(!found)throw new HttpsError("not-found","Purchase cash advance was not found.");const allocations=found.row.allocations||{};if(allocations[invoiceId])throw new HttpsError("already-exists","This purchase is already allocated to the selected cash advance.");const allocated=Financial.money(Object.values(allocations).reduce((sum,row)=>sum+Number(row&&row.amount||0),0)),remaining=Financial.money(Number(found.row.amount||0)-allocated);if(value>remaining+0.009)throw new HttpsError("failed-precondition",`Purchase exceeds the remaining cash advance of ${remaining}.`);const next=Financial.money(remaining-value),base=found.kind==="shift"?`shifts/${found.shiftId}/payOuts/${found.index}`:`pettyCashVouchers/${advanceId}`;cashAsset=`asset:purchase_cash_advance:${advanceId}`;writes[`${base}/allocations/${invoiceId}`]={purchaseInvoiceId:invoiceId,amount:value,supplier:financeText(invoice.supplier,120),ref:financeText(invoice.ref,120),allocatedAt:now,allocatedBy:actor.uid};writes[`${base}/allocatedAmount`]=Financial.money(allocated+value);writes[`${base}/remainingAmount`]=next;writes[`${base}/allocationStatus`]=next>0?"partially_allocated":"fully_allocated";if(!(next>0))writes[`${base}/completedAt`]=now;writes[`purchaseInvoices/${invoiceId}/purchaseAdvanceId`]=advanceId;writes[`purchaseInvoices/${invoiceId}/advanceSource`]=found.kind;}
      movement = Financial.movement("purchase_cash", "purchaseInvoice", invoiceId, split.concat([Financial.line(cashAsset, 0, value, invoice.supplier || "Inventory purchase")]), {occurredAt: Date.parse(`${date}T00:00:00+08:00`) || now, actorName: actor.role, accountId:advanceId?"purchase_advance":accountId, custodyAllocations});
      writes[`purchaseInvoices/${invoiceId}/paymentMovementId`]=commandId;writes[`purchaseInvoices/${invoiceId}/paymentAccountId`]=advanceId?"purchase_advance":accountId;writes[`purchaseInvoices/${invoiceId}/paymentPostedAt`]=now;
      if (!advanceId) addCash(`fm_${commandId}`, {date, accountId, dir:"out", category:"Inventory purchase", amount:value, party:invoice.supplier, ref:invoice.ref, auto:true});
    } else if (action === "personal_business_cost") {
      const value=amount(data.amount),date=financeDate(data.date),ownerName=financeText(data.ownerName,120),ownerTreatment=financeText(data.ownerTreatment,20)==="reimburse"?"reimburse":"capital",reference=financeText(data.ref,120),selected=chartAccountFromLegacy(chart,data.category,"out"),category=financeText(selected.row.name,80),costAccount=`${selected.row.type}:${selected.id}`,reimbursementId=`owner_cost_${commandId}`;
      if(!ownerName)throw new HttpsError("invalid-argument","Owner or partner name is required.");if(!reference)throw new HttpsError("invalid-argument","Receipt or reference is required.");
      const offset=ownerTreatment==="reimburse"?`liability:due_to_owner:${reimbursementId}`:"equity:capital_in";
      movement=Financial.movement("personal_business_cost","personalFunding",commandId,[Financial.line(costAccount,value,0,category),Financial.line(offset,0,value,`Paid personally by ${ownerName}`)],{occurredAt:Date.parse(`${date}T00:00:00+08:00`)||now,actorName:actor.role,ownerName,ownerTreatment,reference});
      writes[`personalFundings/${commandId}`]={ownerName,ownerTreatment,amount:value,date,party:financeText(data.party,120),ref:reference,category,expenseAccount:costAccount,offsetAccount:offset,reimbursementId:ownerTreatment==="reimburse"?reimbursementId:"",movementId:commandId,status:"posted",createdAt:now,createdBy:actor.uid,schemaVersion:1};
      if(ownerTreatment==="reimburse")writes[`payables/${reimbursementId}`]={party:ownerName,type:"owner reimbursement",amount:value,date,due:"",ref:reference,status:"open",movementId:commandId,personalFundingId:commandId,liabilityAccount:offset,ts:now,createdBy:actor.uid,schemaVersion:1};
    } else if(action==="reverse_personal_business_cost"){
      const fundingId=financeKey(data.fundingId,"Personal funding ID"),row=(await db.ref(`/personalFundings/${fundingId}`).get()).val();if(!row)throw new HttpsError("not-found","Owner/partner-funded cost was not found.");if(row.status==="reversed")return{movementId:`personal_reverse_${fundingId}`,duplicate:true};const reason=financeText(data.reason,300);if(!reason)throw new HttpsError("invalid-argument","Reversal reason is required.");const reimbursementId=financeText(row.reimbursementId,160),reimbursement=reimbursementId?(await db.ref(`/payables/${reimbursementId}`).get()).val():null;if(reimbursement&&reimbursement.status==="paid")throw new HttpsError("failed-precondition","The owner/partner was already reimbursed. Reverse that payment first.");const value=amount(row.amount),movementId=`personal_reverse_${fundingId}`,reversal=Financial.movement("personal_business_cost_reversed","personalFunding",fundingId,[Financial.line(row.offsetAccount,value,0,"Reverse personal funding"),Financial.line(row.expenseAccount,0,value,"Reverse business cost")],{occurredAt:now,actorName:actor.role,reason});const reverseWrites={[`personalFundings/${fundingId}/status`]:"reversed",[`personalFundings/${fundingId}/reversedAt`]:now,[`personalFundings/${fundingId}/reversalReason`]:reason,[`personalFundings/${fundingId}/reversalMovementId`]:movementId};if(reimbursementId){reverseWrites[`payables/${reimbursementId}/status`]="reversed";reverseWrites[`payables/${reimbursementId}/reversedAt`]=now;reverseWrites[`payables/${reimbursementId}/reversalMovementId`]=movementId;}const committed=await commitFinancial(db,movementId,reversal,actor,reverseWrites);return{movementId,duplicate:committed.duplicate};
    } else if (action === "manual_journal") {
      const memo=financeText(data.memo,240),reference=financeText(data.ref,120),date=financeDate(data.date),rawLines=Array.isArray(data.lines)?data.lines:[];
      if(!memo)throw new HttpsError("invalid-argument","Memo / description is required.");
      if(rawLines.length<2||rawLines.length>20)throw new HttpsError("invalid-argument","A journal requires between two and twenty lines.");
      const lines=[],cashWrites=[];let debit=0,credit=0;
      rawLines.forEach((row,index)=>{const dr=Financial.money(row&&row.debit),cr=Financial.money(row&&row.credit);if((dr>0&&cr>0)||(!(dr>0)&&!(cr>0)))throw new HttpsError("invalid-argument",`Journal line ${index+1} must contain either a debit or a credit.`);const mapped=booksCodeAccount(row.code,accounts);debit=Financial.money(debit+dr);credit=Financial.money(credit+cr);lines.push(Financial.line(mapped.account,dr,cr,memo));if(mapped.cashKey)cashWrites.push({mapped,dr,cr,index});});
      if(Math.abs(debit-credit)>0.009||!(debit>0))throw new HttpsError("invalid-argument","Journal debits and credits must balance.");
      const sensitive=rawLines.some((row)=>/^(1000|1005|1010|1011|1012|1013|1014|1020|1030|1040|1100|1110|1200|1210|1220|1230|1240|1260|1270|1280|1290|1900|2000|2020|2050|2090|3000|3100|3900|4000|4010|4020|4030|4900|4910)$/.test(String(row&&row.code||"")));
      if(sensitive&&!reference)throw new HttpsError("invalid-argument","A source reference is required for cash, sales, platform, inventory, receivable, payable, suspense, or equity journals.");
      if(sensitive&&!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError("permission-denied","A privileged Finance role must post journals affecting cash, sales, platforms, inventory, receivables, payables, suspense, or equity.");
      const occurredAt=accountingTimestamp(date,now);
      movement=Financial.movement("manual_books_journal","booksManualJournal",commandId,lines,{occurredAt,actorName:actor.role,reference,memo});
      cashWrites.forEach(({mapped,dr,cr,index})=>{if(mapped.cashKey==="float")return;const value=Financial.money(dr-cr);if(!value)return;const accountId=mapped.cashKey==="register"?"register":mapped.cashKey==="undeposited"?"undeposited":mapped.cashKey==="petty"?"petty":mapped.cashKey;addCash(`fm_${commandId}_${index}`,{date,accountId,dir:value>0?"in":"out",category:"Manual journal",amount:Math.abs(value),party:memo,ref:reference,auto:false});});
      writes[`operationalAudit/${now}_manual_journal_${commandId}`]=operationalAuditRecord("post_manual_journal","booksManualJournal",commandId,actor,{amount:debit,reference,memo,date,sensitive});
      result={amount:debit,date};
    } else if(action==="reverse_manual_journal"){
      const originalId=financeKey(data.originalMovementId,"Original movement ID"),original=(await db.ref(`/financialMovements/${originalId}`).get()).val();
      if(!original||original.type!=="manual_books_journal")throw new HttpsError("failed-precondition","Only a shared manual Books journal can be reversed here.");
      const existingReverse=(await db.ref(`/financialMovements/books_reverse_${originalId}`).get()).val();if(existingReverse)return{movementId:`books_reverse_${originalId}`,duplicate:true};
      const reason=financeText(data.reason,300),date=financeDate(data.date);if(!reason)throw new HttpsError("invalid-argument","Reversal reason is required.");
      const occurredAt=accountingTimestamp(date,now),reverseId=`books_reverse_${originalId}`;
      movement=Financial.reverseMovement(Object.assign({id:originalId},original),"manual_books_journal_reversal",reason);movement.occurredAt=occurredAt;movement.actorName=actor.role;movement.reversalOf=originalId;movement.reason=reason;
      (movement.lines||[]).forEach((row,index)=>{const a=String(row.account||""),value=Financial.money(Number(row.debit||0)-Number(row.credit||0));let accountId="";if(a.indexOf("asset:cash_account:")===0)accountId=a.slice(19);else if(a==="asset:register_cash")accountId="register";else if(a==="asset:cash_awaiting_deposit")accountId="undeposited";else if(a==="asset:petty_cash")accountId="petty";if(accountId&&value)addCash(`fm_${reverseId}_${index}`,{date,accountId,dir:value>0?"in":"out",category:"Manual journal reversal",amount:Math.abs(value),party:reason,ref:financeText(original.reference||original.sourceId,120),auto:true});});
      writes[`financialMovements/${originalId}/reversedByMovementId`]=reverseId;writes[`operationalAudit/${now}_manual_journal_reverse_${originalId}`]=operationalAuditRecord("reverse_manual_journal","booksManualJournal",originalId,actor,{reversalMovementId:reverseId,reason,date});
      const committed=await commitFinancial(db,reverseId,movement,actor,writes);return{movementId:reverseId,duplicate:committed.duplicate};
    } else if (action === "manual") {
      const accountId = accountIdFor(accounts, data.accountId), value = amount(data.amount), dir = data.dir === "out" ? "out" : "in", selected = data.offsetAccountId ? chartAccountFor(chart, data.offsetAccountId) : chartAccountFromLegacy(chart, data.category, dir), category = financeText(selected.row.name, 80), asset = `asset:cash_account:${accountId}`, offset = `${selected.row.type}:${selected.id}`,reference=financeText(data.ref,120);
      movement = Financial.movement("manual_cash", "manual", commandId, dir === "in" ? [Financial.line(asset, value, 0, category), Financial.line(offset, 0, value, category)] : [Financial.line(offset, value, 0, category), Financial.line(asset, 0, value, category)], {occurredAt: accountingTimestamp(data.date,now), actorName: financeText(data.actorName || ""),reference});
      addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir, category, amount: value, party: data.party, ref: data.ref, auto: false});
    } else if (action === "transfer") {
      const from = accountIdFor(accounts, data.fromAccountId), to = accountIdFor(accounts, data.toAccountId); if (from === to) throw new HttpsError("invalid-argument", "Transfer accounts must be different."); const value = amount(data.amount), date = financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument","Transfer reference is required.");
      movement = Financial.movement("cash_transfer", "transfer", commandId, [Financial.line(`asset:cash_account:${to}`, value, 0, "Transfer in"), Financial.line(`asset:cash_account:${from}`, 0, value, "Transfer out")], {occurredAt: accountingTimestamp(date,now),reference});
      addCash(`fm_${commandId}_out`, {date, accountId: from, dir: "out", category: "Transfer", amount: value, party: `→ ${financeText(accounts[to].name)}`,ref:reference}); addCash(`fm_${commandId}_in`, {date, accountId: to, dir: "in", category: "Transfer", amount: value, party: `← ${financeText(accounts[from].name)}`,ref:reference});
    } else if (action === "create_receivable" || action === "create_payable") {
      const isAr = action === "create_receivable", docId = financeKey(data.documentId, isAr ? "Receivable ID" : "Payable ID"), value = amount(data.amount), party = financeText(data.party, 120), documentType = financeText(data.type || "other", 60).toLowerCase(),reference=financeText(data.ref,120); if (!party) throw new HttpsError("invalid-argument", "Party is required.");if(!reference)throw new HttpsError("invalid-argument",`${isAr?"Receivable":"Bill or invoice"} reference is required.`);
      if (!isAr && ["inventory","inventory_pending_invoice","purchases"].includes(documentType)) throw new HttpsError("failed-precondition", "Inventory payables must be created from Purchases so the stock receipt, valuation, and supplier liability stay linked.");
      movement = Financial.movement(isAr ? "receivable_created" : "payable_created", isAr ? "receivable" : "payable", docId, isAr ? [Financial.line(`asset:receivable:${docId}`, value, 0, party), Financial.line(`revenue:${documentType}`, 0, value, party)] : [Financial.line(`expense_or_inventory:${documentType}`, value, 0, party), Financial.line(`liability:payable:${docId}`, 0, value, party)], {occurredAt: accountingTimestamp(data.date,now),reference});
      const record = {party, type: documentType, amount: value, date: financeDate(data.date), due: data.due ? financeDate(data.due, true) : "", ref: reference, status: "open", movementId: commandId, ts: now, createdBy: actor.uid, schemaVersion: 1}; writes[`${isAr ? "receivables" : "payables"}/${docId}`] = record; result.documentId = docId;
    } else if (["collect_receivable", "pay_payable", "reverse_receivable", "reverse_payable"].includes(action)) {
      const isAr = action.includes("receivable"), isReverse = action.startsWith("reverse_"), docId = financeKey(data.documentId, "Document ID"), path = isAr ? "receivables" : "payables", snap = await db.ref(`/${path}/${docId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Financial document not found."); const doc = snap.val(); if (doc.status !== "open") throw new HttpsError("failed-precondition", "This document is no longer open."); if (!isAr && doc.provisional === true && !isReverse) throw new HttpsError("failed-precondition", "Finalize the supplier invoice before paying this provisional obligation."); if (!isAr && (doc.purchaseInvoiceId||doc.fixedAssetId||doc.personalFundingId) && isReverse) throw new HttpsError("failed-precondition", "Reverse this owner/partner obligation from its source transaction so the cost and funding remain synchronized."); const value = amount(doc.amount);
      if (isReverse) {
        movement = Financial.movement(isAr ? "receivable_reversed" : "payable_reversed", path, docId, isAr ? [Financial.line(`revenue:${doc.type || "other"}`, value, 0, "Reverse receivable"), Financial.line(`asset:receivable:${docId}`, 0, value, "Reverse receivable")] : [Financial.line(doc.liabilityAccount||`liability:payable:${docId}`, value, 0, "Reverse payable"), Financial.line(`expense_or_inventory:${doc.type || "other"}`, 0, value, "Reverse payable")], {occurredAt: now}); writes[`${path}/${docId}/status`] = "reversed"; writes[`${path}/${docId}/reversedAt`] = now; writes[`${path}/${docId}/reversalMovementId`] = commandId;
      } else {
        const date=financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument",`${isAr?"Collection":"Payment"} reference is required.`);let accountId="",asset="",ownerName="",custodyAllocations={};
        if(isAr){accountId=accountIdFor(accounts,data.accountId);asset=`asset:cash_account:${accountId}`;}
        else {const source=financeText(data.paymentSource||data.accountId,120);if(source==="cash_float"||source==="register")throw new HttpsError("failed-precondition","Register Cash Float is protected and cannot be used to pay bills.");if(source==="owner_capital"){ownerName=financeText(data.ownerName,120);if(!ownerName)throw new HttpsError("invalid-argument","Owner or partner name is required for a personally paid bill.");accountId="owner_capital";asset="equity:capital_in";}else if(source==="cash_on_hand"){accountId=source;asset="asset:register_cash";}else if(source==="undeposited"){accountId=source;asset="asset:cash_awaiting_deposit";const custodyOut=await poolCustodyOutflow(db,value);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`Bill payment exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);Object.assign(writes,custodyOut.writes);custodyAllocations=custodyOut.allocations;Object.keys(custodyAllocations).forEach((id)=>{writes[`cashCustody/${id}/lastPaymentMovementId`]=commandId;});}else if(source==="revolving_fund"){accountId=source;asset="asset:petty_cash";}else{accountId=accountIdFor(accounts,source);asset=`asset:cash_account:${accountId}`;}}
        const label=isAr?"AR collection":ownerName?`AP paid personally by ${ownerName}`:(doc.type==="owner reimbursement"?"Owner/partner reimbursement":"AP payment"),extra={occurredAt:accountingTimestamp(date,now),reference,sourceReference:financeText(doc.ref,120),paymentSource:accountId};if(ownerName)extra.ownerName=ownerName;if(Object.keys(custodyAllocations).length)extra.custodyAllocations=custodyAllocations;
        movement=Financial.movement(isAr?"receivable_collected":(ownerName?"payable_paid_owner_capital":"payable_paid"),path,docId,isAr?[Financial.line(asset,value,0,"AR collection"),Financial.line(`asset:receivable:${docId}`,0,value,"AR collection")]:[Financial.line(doc.liabilityAccount||`liability:payable:${docId}`,value,0,label),Financial.line(asset,0,value,label)],extra);
        if(!ownerName)addCash(`fm_${commandId}`,{date,accountId,dir:isAr?"in":"out",category:isAr?"AR collection":(doc.type==="owner reimbursement"?"Owner/partner reimbursement":"AP payment"),amount:value,party:doc.party,ref:reference});writes[`${path}/${docId}/status`]=isAr?"collected":"paid";writes[`${path}/${docId}/${isAr?"collectedAt":"paidAt"}`]=now;writes[`${path}/${docId}/settlementReference`]=reference;writes[`${path}/${docId}/settlementMovementId`]=commandId;writes[`${path}/${docId}/accountId`]=accountId;if(ownerName)writes[`${path}/${docId}/paidPersonallyBy`]=ownerName;
      }
    } else if (action === "payout_deposit") {
      const payoutId = financeKey(data.payoutId, "Payout ID"), snap = await db.ref(`/platformPayouts/${payoutId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Payout not found."); const payout = snap.val(); if (payout.reversed) throw new HttpsError("failed-precondition","A reversed payout cannot be deposited."); if (payout.depositMovementId) throw new HttpsError("already-exists", "This payout deposit is already recorded."); const accountId = accountIdFor(accounts, data.accountId), value = amount(payout.actualPayout),date=financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument","Bank transaction or platform statement reference is required.");
      movement = Financial.movement("platform_payout_deposit", "platformPayout", payoutId, [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Platform payout deposit"), Financial.line(`asset:platform_clearing:${payout.channel}`, 0, value, "Clear platform payout")], {occurredAt: accountingTimestamp(date,now),reference}); addCash(`fm_${commandId}`, {date, accountId, dir: "in", category: "Platform payout", amount: value, party: payout.channel, ref: reference}); writes[`platformPayouts/${payoutId}/depositMovementId`] = commandId; writes[`platformPayouts/${payoutId}/depositReference`] = reference; writes[`platformPayouts/${payoutId}/depositedAt`] = now; writes[`platformPayouts/${payoutId}/accountId`] = accountId;
    } else if (action === "cash_deposit") {
      const accountId = accountIdFor(accounts, data.accountId), allocations = data.allocations || {}, ids = Object.keys(allocations); if (!ids.length) throw new HttpsError("invalid-argument", "Select cash custody records to deposit."); let value = 0; for (const id of ids) {const key = financeKey(id, "Custody ID"), row = (await db.ref(`/cashCustody/${key}`).get()).val(); if (!row) throw new HttpsError("not-found", `Cash custody ${key} was not found.`); const use = amount(allocations[id]), remaining = Financial.money(row.remaining != null ? row.remaining : row.amount); if (use > remaining + 0.009) throw new HttpsError("failed-precondition", `Deposit exceeds remaining custody for ${key}.`); value = Financial.money(value + use); const next = Financial.money(remaining - use); writes[`cashCustody/${key}/depositedAmount`] = Financial.money(Number(row.depositedAmount || 0) + use); writes[`cashCustody/${key}/remaining`] = next; writes[`cashCustody/${key}/status`] = next > 0 ? "partially_deposited" : "deposited"; writes[`cashCustody/${key}/lastDepositMovementId`] = commandId; writes[`cashCustody/${key}/lastDepositAt`] = now; }
      const depositReference = financeText(data.reference, 120); if (!depositReference) throw new HttpsError("invalid-argument", "Deposit slip or transfer reference is required.");
      movement = Financial.movement("register_cash_deposit", "cashCustody", ids.join("_"), [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Register cash deposited"), Financial.line("asset:cash_awaiting_deposit", 0, value, "Clear cash custody")], {occurredAt: now,actorName:actor.role,reference:depositReference,accountId,custodyAllocations:allocations}); addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir: "in", category: "Register cash deposit", amount: value, party: "Register cash custody", ref: depositReference}); result.amount = value;
    } else throw new HttpsError("invalid-argument", "Unsupported financial command.");
    const committed = await commitFinancial(db, commandId, movement, actor, writes); return Object.assign(result, {movementId: commandId, duplicate: committed.duplicate});
  },
);

// Reconciles the one-to-one link between an on-account purchase invoice and
// its payable. Safe to retry: the invoice, payable and financial movement use
// deterministic IDs, while legacy/manual matches are linked instead of copied.
async function purchaseInventoryLines(db, invoice, credit) {
  const inventorySnap = await db.ref("/inventory").get(), inventory = inventorySnap.val() || {}, totals = {};
  (Array.isArray(invoice && invoice.lines) ? invoice.lines : []).forEach((line) => {const item=inventory[line.itemId]||{},mapping=BooksBridge.itemAccounts(item),code=mapping.inventory||"1290",value=Financial.money(line.total);if(value>0)totals[code]=Financial.money((totals[code]||0)+value);});
  const expected=Financial.money(invoice&&invoice.total),found=Financial.money(Object.values(totals).reduce((sum,value)=>sum+value,0)),gap=Financial.money(expected-found);if(gap)totals["1290"]=Financial.money((totals["1290"]||0)+gap);
  return Object.keys(totals).filter((code)=>totals[code]>0).sort().map((code)=>Financial.line(`coa:${code}`,credit?0:totals[code],credit?totals[code]:0,invoice.supplier||"Inventory purchase"));
}

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
    const ref = financeText(data.invoiceRef || invoice.ref || `PENDING-${invoiceId}`, 120), date = financeDate(invoice.date), due = data.due ? financeDate(data.due, true) : (invoice.due ? financeDate(invoice.due, true) : ""), finalizing = provisional && data.finalize === true;
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
    else {const inventoryLines=await purchaseInventoryLines(db,invoice,false),movement = Financial.movement(provisional?"grni_created":"payable_created", "payable", canonicalId, inventoryLines.concat([Financial.line(provisional?`liability:grni:${canonicalId}`:`liability:payable:${canonicalId}`, 0, amount, party)]), {occurredAt:Number(Date.parse(`${date}T00:00:00+08:00`)||now),actorName:actor.role});await commitFinancial(db, movementId, movement, actor, writes);}
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
      const next = {ref:financeText(data.ref,120),due:data.due?financeDate(data.due, true):"",by:financeText(data.by,120)}; if (!next.ref) throw new HttpsError("invalid-argument", "Invoice reference is required.");
      const duplicate = Object.keys(invoices).some((id) => id !== invoiceId && financeText(invoices[id] && invoices[id].ref,120).toLowerCase() === next.ref.toLowerCase());if (duplicate) throw new HttpsError("already-exists", "Another purchase already uses this invoice reference.");
      const writes = {[`purchaseInvoices/${invoiceId}/ref`]:next.ref,[`purchaseInvoices/${invoiceId}/due`]:next.due,[`purchaseInvoices/${invoiceId}/by`]:next.by,[`purchaseInvoices/${invoiceId}/lastCorrectionAt`]:now,[`purchaseInvoices/${invoiceId}/lastCorrectionBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/lastCorrectionReason`]:reason,[`operationalAudit/${now}_purchase_correct_${invoiceId}`]:{action:"correct_purchase_details",sourceType:"purchaseInvoice",sourceId:invoiceId,before:{ref:invoice.ref||"",due:invoice.due||"",by:invoice.by||""},after:next,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      (invoice.receiptIds||[]).forEach((id) => {writes[`stockReceipts/${id}/ref`]=next.ref;writes[`stockReceipts/${id}/receivedBy`]=next.by;});if (invoice.payableId) {writes[`payables/${invoice.payableId}/ref`]=next.ref;writes[`payables/${invoice.payableId}/due`]=next.due;}
      await db.ref().update(writes);return {invoiceId,result:"corrected",invoice:Object.assign({},safeInvoice,next)};
    }
    if (action !== "reverse") throw new HttpsError("invalid-argument", "Purchase correction action is invalid.");
    const approval = await claimManagerApproval(db, data, "reverse_purchase", invoiceId, safeInvoice.total, `reverse_purchase_${invoiceId}`), movementIds = Array.isArray(invoice.movementIds)?invoice.movementIds:[], originals=[];
    const payable = invoice.payableId ? (await db.ref(`/payables/${financeKey(invoice.payableId,"Payable ID")}`).get()).val() : null,keepInvoiceId=financeText(data.keepInvoiceId,160),keepInvoice=keepInvoiceId&&invoices[keepInvoiceId],duplicateCleanup=data.duplicate===true&&keepInvoice&&keepInvoiceId!==invoiceId&&keepInvoice.reversed!==true&&financeText(keepInvoice.ref,120).toLowerCase()===financeText(invoice.ref,120).toLowerCase()&&financeText(keepInvoice.supplier,120).toLowerCase()===financeText(invoice.supplier,120).toLowerCase()&&Financial.money(keepInvoice.total)===safeInvoice.total;if (data.duplicate===true&&!duplicateCleanup) throw new HttpsError("failed-precondition","A single matching purchase must be selected as the record to keep.");if (payable && payable.status === "paid") throw new HttpsError("failed-precondition", "This payable has already been paid. Reverse the supplier payment before reversing the purchase.");const orphanAccount=invoice.payMode==="account"&&!payable;if (!duplicateCleanup&&orphanAccount&&(await db.ref(`/financialMovements/purchase_ap_${invoiceId}`).get()).exists()) throw new HttpsError("failed-precondition","This purchase has a payable movement but its payable record is missing. Repair the payable before reversal.");if (!duplicateCleanup&&invoice.payMode === "pending"&&(!payable||payable.status!=="open")) throw new HttpsError("failed-precondition", "The linked provisional obligation is missing or is no longer open.");if (!duplicateCleanup&&invoice.payMode==="account"&&payable&&payable.status!=="open") throw new HttpsError("failed-precondition","The linked supplier payable is no longer open.");
    const paidAccountId=invoice.payMode==="paid"?financeText(invoice.accountId,120):"",paidSpecial=paidAccountId==="cash_on_hand"||paidAccountId==="undeposited"||paidAccountId==="register",paidCashAccount=invoice.payMode==="paid"&&!paidSpecial?accountIdFor((await db.ref("/cfAccounts").get()).val()||{},paidAccountId):paidAccountId;
    for (const movementId of movementIds) {const movement=(await db.ref(`/inventoryMovements/${financeKey(movementId,"Movement ID")}`).get()).val();if (!movement) throw new HttpsError("failed-precondition", "An original inventory movement is missing. Run inventory review before reversal.");const accounting=(await db.ref(`/inventoryAccounting/${movement.itemId}`).get()).val()||{},reversalId=`purchase_reverse_${invoiceId}_${movement.itemId}`,already=accounting.applied&&accounting.applied[reversalId];if (!already&&qty6(accounting.balance)+0.000001<qty6(movement.qty)) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${movement.itemName||movement.itemId}.`);if (!already&&qty6(accounting.balance)>qty6(movement.qty)&&((qty6(accounting.balance)*qty6(accounting.unitCost))-(qty6(movement.qty)*qty6(movement.unitCost)))<-.000001) throw new HttpsError("failed-precondition", `The remaining stock value for ${movement.itemName||movement.itemId} cannot support this reversal.`);originals.push(movement);}
    for (const movement of originals) await applyInventoryMovement(db,{movementId:`purchase_reverse_${invoiceId}_${movement.itemId}`,itemId:movement.itemId,type:"purchase_reversal",qty:-qty6(movement.qty),unitCost:qty6(movement.unitCost),sourceType:"purchase-invoice-reversal",sourceId:invoiceId,sourceLine:movement.sourceLine||movement.itemId,note:`Reverse purchase ${invoice.ref||invoiceId}: ${reason}`,reversalOf:movement.id,actorName:actor.role,occurredAt:now},actor);
    const writes = Object.assign({},approval.usedWrites,{[`purchaseInvoices/${invoiceId}/reversed`]:true,[`purchaseInvoices/${invoiceId}/reversedAt`]:now,[`purchaseInvoices/${invoiceId}/reversedBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/reversalReason`]:reason,[`operationalAudit/${now}_purchase_reverse_${invoiceId}`]:{action:duplicateCleanup?"reverse_duplicate_purchase":"reverse_purchase",sourceType:"purchaseInvoice",sourceId:invoiceId,keptPurchaseId:duplicateCleanup?keepInvoiceId:"",amount:safeInvoice.total,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});if (duplicateCleanup&&payable) {if (payable.status==="open") {writes[`payables/${invoice.payableId}/purchaseInvoiceId`]=keepInvoiceId;writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=invoice.payableId;} else {writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=null;writes[`purchaseInvoices/${keepInvoiceId}/payableReconciledAt`]=null;}}(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/reversed`]=true;writes[`stockReceipts/${id}/reversedAt`]=now;});
    const batches=(await db.ref("/inventoryBatch").get()).val()||{};Object.keys(batches).forEach((id)=>{if (batches[id]&&batches[id].invoiceId===invoiceId){writes[`inventoryBatch/${id}/closed`]=true;writes[`inventoryBatch/${id}/reversedAt`]=now;}});
    if (invoice.payMode === "owner_funded") {
      const ownerReversalLines=await purchaseInventoryLines(db,invoice,true),financialId=`purchase_owner_reversal_${invoiceId}`,reimbursementId=financeText(invoice.ownerReimbursementId,160),reimbursement=reimbursementId?(await db.ref(`/payables/${reimbursementId}`).get()).val():null;
      if(reimbursement&&reimbursement.status==="paid")throw new HttpsError("failed-precondition","Reimbursement was already paid. Reverse the reimbursement before reversing this purchase.");
      const ownerOffset=invoice.ownerTreatment==="reimburse"?`liability:due_to_owner:${reimbursementId||`owner_${invoiceId}`}`:"equity:capital_in";
      const ownerReversal=Financial.movement("purchase_owner_funded_reversed","purchaseInvoice",invoiceId,[Financial.line(ownerOffset,safeInvoice.total,0,"Reverse owner/partner-funded purchase")].concat(ownerReversalLines),{occurredAt:now,actorName:actor.role,ownerName:invoice.ownerName||"",ownerTreatment:invoice.ownerTreatment||"capital"});
      if(reimbursementId){writes[`payables/${reimbursementId}/status`]="reversed";writes[`payables/${reimbursementId}/reversedAt`]=now;writes[`payables/${reimbursementId}/reversalMovementId`]=financialId;}
      writes[`purchaseInvoices/${invoiceId}/fundingReversalMovementId`]=financialId;
      await commitFinancial(db,financialId,ownerReversal,actor,writes);
      return {invoiceId,result:"reversed",amount:safeInvoice.total,invoice:safeInvoice};
    }
    const reversalInventoryLines=await purchaseInventoryLines(db,invoice,true);let financialMovement=null,financialId="";if (!duplicateCleanup&&(invoice.payMode === "account"||invoice.payMode === "pending")&&payable) {financialId=`purchase_ap_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_payable_reversed","purchaseInvoice",invoiceId,[Financial.line(invoice.payMode==="pending"?`liability:grni:${invoice.payableId}`:`liability:payable:${invoice.payableId}`,safeInvoice.total,0,"Reverse supplier obligation")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role});writes[`payables/${invoice.payableId}/status`]="reversed";writes[`payables/${invoice.payableId}/reversedAt`]=now;writes[`payables/${invoice.payableId}/reversalMovementId`]=financialId;} else if (invoice.payMode === "paid") {financialId=`purchase_cash_reversal_${invoiceId}`;const paidAsset=paidCashAccount==="cash_on_hand"||paidCashAccount==="register"?"asset:register_cash":paidCashAccount==="undeposited"?"asset:cash_awaiting_deposit":`asset:cash_account:${paidCashAccount}`;financialMovement=Financial.movement("purchase_cash_reversed","purchaseInvoice",invoiceId,[Financial.line(paidAsset,safeInvoice.total,0,"Reverse purchase payment")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role,accountId:paidCashAccount});if(paidCashAccount==="undeposited"){const original=(await db.ref(`/financialMovements/purchase_cash_${invoiceId}`).get()).val()||{},allocations=original.custodyAllocations||{};if(!Object.keys(allocations).length)throw new HttpsError("failed-precondition","The original Undeposited Collection custody allocation is missing. Repair it before reversing this purchase.");for(const id of Object.keys(allocations)){const key=financeKey(id,"Custody ID"),row=(await db.ref(`/cashCustody/${key}`).get()).val();if(!row)throw new HttpsError("failed-precondition",`Cash custody ${key} is missing.`);const restore=Financial.money(allocations[id]),remaining=Financial.money(Number(row.remaining||0)+restore),paidOut=Financial.money(Math.max(0,Number(row.paidOutAmount||0)-restore));writes[`cashCustody/${key}/remaining`]=remaining;writes[`cashCustody/${key}/paidOutAmount`]=paidOut;writes[`cashCustody/${key}/status`]="awaiting_deposit";writes[`cashCustody/${key}/lastPaymentReversalMovementId`]=financialId;}}writes[`cfLedger/fm_${financialId}`]=cashLedgerRecord({date:financeDateFromTimestamp(now),accountId:paidCashAccount==="register"?"cash_on_hand":paidCashAccount,dir:"in",category:"Purchase reversal",amount:safeInvoice.total,party:invoice.supplier,ref:invoice.ref,auto:true},financialId,financialMovement,actor);} else if (invoice.payMode === "advance" && invoice.purchaseAdvanceId) {const advanceId=financeKey(invoice.purchaseAdvanceId,"Purchase advance ID");let base="",advance=null;if(invoice.advanceSource==="revolving"){base=`pettyCashVouchers/${advanceId}`;advance=(await db.ref(`/${base}`).get()).val();}else{const shifts=(await db.ref("/shifts").get()).val()||{};for(const shiftId of Object.keys(shifts)){const rows=Array.isArray(shifts[shiftId].payOuts)?shifts[shiftId].payOuts:[],index=rows.findIndex((row)=>row&&row.id===advanceId);if(index>=0){base=`shifts/${shiftId}/payOuts/${index}`;advance=rows[index];break;}}}if(!advance||!(advance.allocations&&advance.allocations[invoiceId]))throw new HttpsError("failed-precondition","The linked supplier-payment allocation is missing. Repair it before reversing this purchase.");const restored=Financial.money(Number(advance.remainingAmount!=null?advance.remainingAmount:advance.amount)+safeInvoice.total),allocated=Financial.money(Math.max(0,Number(advance.allocatedAmount||0)-safeInvoice.total));writes[`${base}/allocations/${invoiceId}`]=null;writes[`${base}/remainingAmount`]=restored;writes[`${base}/allocatedAmount`]=allocated;writes[`${base}/allocationStatus`]=allocated>0?"partially_allocated":"pending_allocation";financialId=`purchase_advance_reversal_${invoiceId}`;financialMovement=Financial.movement("purchase_advance_allocation_reversed","purchaseInvoice",invoiceId,[Financial.line(`asset:purchase_cash_advance:${advanceId}`,safeInvoice.total,0,"Restore supplier payment for allocation")].concat(reversalInventoryLines),{occurredAt:now,actorName:actor.role});}
    if (financialMovement) await commitFinancial(db,financialId,financialMovement,actor,writes);else await db.ref().update(writes);
    return {invoiceId,result:"reversed",amount:safeInvoice.total,invoice:safeInvoice};
  },
);

// Correct an amount-only platform mismatch before payout settlement. The
// operational order is updated to the statement-confirmed figures while an
// append-only movement preserves the original posting and audit trail.
exports.correctPlatformPresettlement = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["payouts", "receivables"]), data = request.data || {};
    const requested = financeText(data.platformRef, 60), channelHint = financeText(data.channel, 20).toLowerCase();
    if (!requested) throw new HttpsError("invalid-argument", "Platform order reference is required.");
    const [ordersSnap, archiveSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get()]);
    const wanted = platformRefKey(requested); let found = null;
    for (const [node, rows] of [["orders", ordersSnap.val() || {}], ["archivedOrders", archiveSnap.val() || {}]]) {
      for (const id of Object.keys(rows)) {
        const order = Object.assign({id}, rows[id] || {}), channel = financeText(order.channel, 20).toLowerCase();
        if (!["grabfood", "foodpanda"].includes(channel) || (channelHint && channel !== channelHint)) continue;
        if (platformRefKey(order.platformRef || order.id || id) === wanted) {found = {id, node, order}; break;}
      }
      if (found) break;
    }
    if (!found) throw new HttpsError("not-found", "No matching GrabFood or FoodPanda order was found.");
    const o = found.order, channel = financeText(o.channel, 20).toLowerCase(), oldGross = Financial.money(o.grossPlatform != null ? o.grossPlatform : (o.subtotal != null ? o.subtotal : o.total)), oldCommission = Financial.money(o.commission);
    if (data.action === "lookup") return {orderId: found.id, platformRef: o.platformRef || found.id, channel, gross: oldGross, commission: oldCommission, net: Financial.money(o.netPlatform != null ? o.netPlatform : oldGross - oldCommission), settlementStatus: o.settlementStatus || "unsettled", hasStructuredItems: Array.isArray(o.lineItems) && o.lineItems.length > 0};
    if (o.voided) throw new HttpsError("failed-precondition", "A voided order cannot be corrected.");
    if ((o.settlementStatus || "unsettled") === "settled" || o.payoutId) throw new HttpsError("failed-precondition", "This order is already settled. Reverse its payout before correcting it.");
    const previousPlatformRef = financeText(o.platformRef || found.id, 60), newPlatformRef = financeText(data.newPlatformRef || previousPlatformRef, 60).trim(), oldRefKey = platformRefKey(previousPlatformRef), newRefKey = platformRefKey(newPlatformRef);
    if (!newPlatformRef || !newRefKey) throw new HttpsError("invalid-argument", "The corrected platform order reference is required.");
    if (newRefKey !== oldRefKey) {
      const duplicate = await existingPlatformOrder(db, channel, newPlatformRef, found.id);
      if (duplicate) throw new HttpsError("already-exists", `Platform reference ${newPlatformRef} already belongs to another ${channel === "grabfood" ? "GrabFood" : "FoodPanda"} order.`);
      const indexed = (await db.ref(`/platformRefIndex/${channel}/${newRefKey}`).get()).val();
      if (indexed && indexed.orderId !== found.id) throw new HttpsError("already-exists", `Platform reference ${newPlatformRef} is already reserved by another order.`);
    }
    const gross = Financial.money(data.gross), commission = Financial.money(data.commission), reason = financeText(data.reason, 300);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Verified gross must be greater than zero.");
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Verified commission must be between zero and the verified gross.");
    if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    const discount = Financial.money(o.platformDiscount), wht = Financial.money(o.platformWht), vat = Financial.money(o.platformVat), net = Financial.money(gross - commission - discount - wht - vat);
    if (net < -0.009) throw new HttpsError("failed-precondition", "The existing platform deductions exceed the verified gross. Review the order deductions first.");
    const delta = Financial.money(Math.abs(oldGross - gross)), referenceChanged = newPlatformRef !== previousPlatformRef; if (!referenceChanged && !(delta > 0.009) && Math.abs(oldCommission - commission) < 0.009) throw new HttpsError("failed-precondition", "The verified reference and figures are unchanged.");
    const version = Math.max(1, Number(o.preSettlementCorrectionVersion || 0) + 1), movementId = `platform_presettle_${found.id}_${version}`;
    const approval = await claimManagerApproval(db, data, "correct_platform_presettlement", found.id, delta, movementId), now = Date.now(), accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const corrected = Object.assign({}, o, {platformRef:newPlatformRef,grossPlatform:gross,subtotal:gross,total:gross,netSalesPlatform:Financial.money(gross-discount),commission,netPlatform:Math.max(0,net),preSettlementCorrected:true,preSettlementCorrectionVersion:version,preSettlementCorrectedAt:now,preSettlementCorrectedBy:actor.uid,preSettlementCorrectionReason:reason});
    delete corrected.dupPlatformRef;
    if (Array.isArray(corrected.payments)) corrected.payments = corrected.payments.map((payment) => Object.assign({}, payment, {amount:corrected.payments.length === 1 ? gross : payment.amount, ref:platformRefKey(payment.ref) === oldRefKey ? newPlatformRef : payment.ref}));
    const beforePosting = Financial.orderPosting(o, accounts), afterPosting = Financial.orderPosting(corrected, accounts), movement = Financial.postingDifference(beforePosting, afterPosting, "platform_presettlement_correction", found.id, "Pre-settlement correction");
    const approvedBy = approval.record.approvedEmail || approval.record.approvedRole;
    if (movement) {movement.occurredAt = Number(o.timestamp || now); movement.approvalId = approval.id; movement.approvedBy = approvedBy; movement.correctionRecordedAt = now; movement.platformRef = newPlatformRef; movement.previousPlatformRef = previousPlatformRef;}
    const history = {version,before:{platformRef:previousPlatformRef,gross:oldGross,commission:oldCommission,net:Financial.money(o.netPlatform)},after:{platformRef:newPlatformRef,gross,commission,net:Math.max(0,net)},reason,platformRef:newPlatformRef,previousPlatformRef,approvalId:approval.id,approvedBy,actorUid:actor.uid,actorRole:actor.role,at:now,inventoryEffect:0,cogsEffect:0,movementId:movement?movementId:""};
    corrected.preSettlementCorrections = Object.assign({}, o.preSettlementCorrections || {}, {[version]:history});
    const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${found.id}`]:corrected,[`operationalAudit/${now}_platform_presettle_${found.id}`]:{action:"correct_platform_presettlement",sourceType:"order",sourceId:found.id,platformRef:newPlatformRef,previousPlatformRef,channel,before:history.before,after:history.after,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,inventoryEffect:0,cogsEffect:0,financialEffect:movement?"posting_difference":"none",ts:now,schemaVersion:1}});
    if (referenceChanged) {writes[`platformRefIndex/${channel}/${newRefKey}`]={orderId:found.id,ref:newPlatformRef,at:Number(o.timestamp)||now,correctedAt:now}; if (newRefKey !== oldRefKey) {const oldIndex=(await db.ref(`/platformRefIndex/${channel}/${oldRefKey}`).get()).val(); if (oldIndex && oldIndex.orderId === found.id) writes[`platformRefIndex/${channel}/${oldRefKey}`]=null;} writes[`platformRefDuplicates/${found.id}`]=null;}
    const active=(await db.ref(`/activeOrders/${found.id}`).get()).val(); if (active) {writes[`activeOrders/${found.id}/platformRef`]=newPlatformRef; if (Array.isArray(active.payments)) writes[`activeOrders/${found.id}/payments`]=corrected.payments;}
    let duplicate=false; if (movement) {const committed=await commitFinancial(db,movementId,movement,actor,writes);duplicate=committed.duplicate;} else await db.ref().update(writes);
    return {orderId:found.id,previousPlatformRef,platformRef:newPlatformRef,gross,commission,net:Math.max(0,net),movementId:movement?movementId:"",financialPosted:!!movement,duplicate};
  },
);

exports.settlePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]); const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), channel = financeText(data.channel, 30); if (!["grabfood", "foodpanda"].includes(channel)) throw new HttpsError("invalid-argument", "Platform is invalid.");
    const ids = Array.isArray(data.orderIds) ? [...new Set(data.orderIds.map((id) => financeKey(id, "Order ID")))] : []; if (!ids.length) throw new HttpsError("invalid-argument", "Select at least one order.");
    const found = await Promise.all(ids.map((id) => findOrder(db, id))); let expected = 0; found.forEach((entry) => { const o = entry.order; if (o.channel !== channel || o.voided || (o.settlementStatus || "unsettled") === "settled") throw new HttpsError("failed-precondition", `Order ${entry.id} is not eligible for this payout.`); expected += Financial.money(o.netPlatform != null ? o.netPlatform : Financial.money(o.grossPlatform || o.total) - Financial.money(o.commission)); }); expected = Financial.money(expected);
    const actual = Financial.money(data.actualPayout); const approval = await claimManagerApproval(db, data, "settle_platform_payout", payoutId, actual, `payout_${payoutId}`), variance = Financial.money(actual - expected), configuredDefs = (await db.ref("/platformVarAccounts").get()).val() || {}, defs = Object.assign({}, configuredDefs, {va_refund:{name:"Grab refund / cancellation deduction",type:"expense"},va_refund_recovery:{name:"Grab refund recovery / reversal",type:"revenue"}}), allocations = data.allocations || {}, requestedAllocationRefs = data.allocationRefs || {}, allocationRefs = {}, allocationMeta = {}; const _allPo = (await db.ref("/platformPayouts").get()).val() || {}; let outstandingOwing = 0; const owingSources = []; Object.keys(_allPo).forEach((k) => { const po = _allPo[k] || {}; if (po.channel === channel && !po.reversed && Financial.money(po.owingOutstanding) > 0.009) { outstandingOwing = Financial.money(outstandingOwing + Financial.money(po.owingOutstanding)); owingSources.push(k); } });
    let netAlloc = 0, owingApplied = 0, owingCreated = 0; const lines = [];
    if (actual < 0) { owingCreated = Financial.money(-actual); lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingCreated, "Owing to platform (penalties exceeded payout)")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, actual, 0, "Actual payout clearing")); if (outstandingOwing > 0.009) { owingApplied = outstandingOwing; lines.push(Financial.line(`liability:platform_owing:${channel}`, owingApplied, 0, "Recover prior owing to platform")); } }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]), sourceRef = financeText(requestedAllocationRefs[id], 120); if (!(value > 0) || !defs[id]) throw new HttpsError("invalid-argument", "Variance allocation is invalid."); if (["va_refund", "va_refund_recovery"].includes(id) && !sourceRef) throw new HttpsError("invalid-argument", "Grab refund deductions and recoveries require the original order or statement reference."); const name = financeText(defs[id].name || id, 120), type = defs[id].type === "revenue" ? "revenue" : "expense", label = `${name}${sourceRef ? ` · ${sourceRef}` : ""}`; if (sourceRef) allocationRefs[id] = sourceRef; allocationMeta[id] = {name,type,sourceRef}; if (type === "revenue") {netAlloc += value; lines.push(Financial.line(`revenue:platform_variance:${id}`, 0, value, label));} else {netAlloc -= value; lines.push(Financial.line(`expense:platform_variance:${id}`, value, 0, label));} });
    if (Math.abs(Financial.money(netAlloc) - Financial.money(variance + owingApplied)) > 0.009) throw new HttpsError("failed-precondition", "Variance allocations do not equal the server-calculated variance.");
    const writes = Object.assign({}, approval.usedWrites), settledAt = Date.now(), payoutRecord = {channel, periodStart: financeText(data.periodStart, 10), periodEnd: financeText(data.periodEnd, 10), payoutDate: /^\d{4}-\d{2}-\d{2}$/.test(financeText(data.payoutDate, 10)) ? financeText(data.payoutDate, 10) : null, owing: owingCreated || null, owingOutstanding: owingCreated || 0, owingApplied: owingApplied || null, owingRecoveredSources: (owingApplied > 0 ? owingSources : null), expectedNet: expected, actualPayout: actual, variance, allocations, allocationRefs, allocationMeta, orderIds: ids, by: actor.role, actorUid: actor.uid, approvedBy: approval.record.approvedEmail || approval.record.approvedRole, approvalId: approval.id, settledAt, movementId: `payout_${payoutId}`, schemaVersion: 1};
    const movement = Financial.platformPayoutPosting(Object.assign({id:payoutId}, payoutRecord), defs);
    found.forEach((entry) => {writes[`${entry.node}/${entry.id}/settlementStatus`] = "settled"; writes[`${entry.node}/${entry.id}/payoutId`] = payoutId;}); owingSources.forEach((sid) => { writes[`platformPayouts/${sid}/owingOutstanding`] = 0; writes[`platformPayouts/${sid}/owingRecoveredBy`] = payoutId; writes[`platformPayouts/${sid}/owingRecoveredAt`] = settledAt; }); writes[`platformPayouts/${payoutId}`] = payoutRecord;
    const committed = await commitFinancial(db, `payout_${payoutId}`, movement, actor, writes); return {payoutId, expectedNet: expected, actualPayout: actual, variance, orderCount: ids.length, owingApplied, owingCreated, duplicate: committed.duplicate};
  },
);

// Reverse a settled platform payout: unwinds the settlement posting (append-only
// reversing entry), and sends its orders back to unsettled so they can be
// re-settled correctly. The payout record is kept and marked reversed (audit).
exports.reversePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), reason = financeText(data.reason, 300);
    if (!reason) throw new HttpsError("invalid-argument", "Reversal reason is required.");
    const payout = (await db.ref(`/platformPayouts/${payoutId}`).get()).val();
    if (!payout) throw new HttpsError("not-found", "Payout not found.");
    if (payout.reversed) throw new HttpsError("already-exists", "This payout has already been reversed.");
    const channel = financeText(payout.channel, 30), ids = Array.isArray(payout.orderIds) ? payout.orderIds : [];
    const expected = Financial.money(payout.expectedNet), actual = Financial.money(payout.actualPayout), allocations = payout.allocations || {}, allocationRefs = payout.allocationRefs || {}, allocationMeta = payout.allocationMeta || {};
    const owing = Financial.money(payout.owing), owingApplied = Financial.money(payout.owingApplied), owingOutstanding = Financial.money(payout.owingOutstanding);
    if (owing > 0.009 && Math.abs(owingOutstanding - owing) > 0.009) throw new HttpsError("failed-precondition", "This payout\u2019s owing was already recovered by a later payout. Reverse that payout first.");
    const approval = await claimManagerApproval(db, data, "reverse_platform_payout", payoutId, null, `reverse_payout_${payoutId}`);
    const defs = (await db.ref("/platformVarAccounts").get()).val() || {};
    const lines = [Financial.line(`asset:platform_receivable:${channel}`, expected, 0, "Restore platform receivable")];
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const depositAccount=accountIdFor((await db.ref("/cfAccounts").get()).val()||{},payout.accountId); lines.push(Financial.line(`asset:platform_clearing:${channel}`,actual,0,"Reverse deposited payout")); lines.push(Financial.line(`asset:cash_account:${depositAccount}`,0,actual,"Reverse deposited payout")); }
    if (owing > 0.009) { lines.push(Financial.line(`liability:platform_owing:${channel}`, owing, 0, "Reverse owing to platform")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, 0, actual, "Reverse actual payout clearing")); if (owingApplied > 0.009) lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingApplied, "Reverse prior-owing recovery")); }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]); if (!(value > 0)) return; const def = allocationMeta[id] || defs[id] || {}, sourceRef = financeText(def.sourceRef || allocationRefs[id], 120), label = `Reverse ${def.name || id}${sourceRef ? ` · ${sourceRef}` : ""}`; if (def.type === "revenue") lines.push(Financial.line(`revenue:platform_variance:${id}`, value, 0, label)); else lines.push(Financial.line(`expense:platform_variance:${id}`, 0, value, label)); });
    const now = Date.now(), movement = Financial.movement("platform_payout_reversal", "platformPayout", payoutId, lines, {occurredAt: now, approvalId: approval.id, approvedBy: approval.record.approvedEmail || approval.record.approvedRole});
    const writes = Object.assign({}, approval.usedWrites);
    const found = await Promise.all(ids.map((id) => findOrder(db, id).catch(() => null)));
    found.forEach((entry) => { if (!entry) return; if ((entry.order.payoutId || "") === payoutId) { writes[`${entry.node}/${entry.id}/settlementStatus`] = "unsettled"; writes[`${entry.node}/${entry.id}/payoutId`] = ""; } });
    if (owingApplied > 0.009 && Array.isArray(payout.owingRecoveredSources)) { const allPo = (await db.ref("/platformPayouts").get()).val() || {}; payout.owingRecoveredSources.forEach((sid) => { const src = allPo[sid] || {}; writes[`platformPayouts/${sid}/owingOutstanding`] = Financial.money(src.owing); writes[`platformPayouts/${sid}/owingRecoveredBy`] = null; writes[`platformPayouts/${sid}/owingRecoveredAt`] = null; }); }
    writes[`platformPayouts/${payoutId}/reversed`] = true;
    writes[`platformPayouts/${payoutId}/reversedAt`] = now;
    writes[`platformPayouts/${payoutId}/reversedBy`] = actor.uid;
    writes[`platformPayouts/${payoutId}/reversalReason`] = reason;
    writes[`platformPayouts/${payoutId}/reversalApprovalId`] = approval.id;
    if (payout.depositMovementId && !payout.depositReversalMovementId) { const reverseDate=financeDateFromTimestamp(now); writes[`platformPayouts/${payoutId}/depositReversalMovementId`]=`reverse_payout_${payoutId}`; writes[`platformPayouts/${payoutId}/depositReversedAt`]=now; writes[`cfLedger/fm_reverse_payout_${payoutId}`]=cashLedgerRecord({date:reverseDate,accountId:payout.accountId,dir:"out",category:"Platform payout reversal",amount:actual,party:channel,ref:payout.depositReference||payoutId,auto:true},`reverse_payout_${payoutId}`,movement,actor); }
    writes[`operationalAudit/${now}_reverse_payout_${payoutId}`] = {action: "reverse_platform_payout", sourceType: "platformPayout", sourceId: payoutId, channel, amount: actual, orderCount: ids.length, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reason, ts: now, schemaVersion: 1};
    const committed = await commitFinancial(db, `reverse_payout_${payoutId}`, movement, actor, writes);
    return {payoutId, orderCount: ids.length, duplicate: committed.duplicate};
  },
);

// Set/clear the actual platform payout date on a settled payout (from the
// platform statement). Metadata only — no ledger posting, no approval needed.
exports.setPlatformPayoutDate = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), raw = financeText(data.payoutDate, 10);
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new HttpsError("invalid-argument", "Payout date must be YYYY-MM-DD.");
    if (!(await db.ref(`/platformPayouts/${payoutId}`).get()).exists()) throw new HttpsError("not-found", "Payout not found.");
    const now = Date.now();
    await db.ref().update({
      [`platformPayouts/${payoutId}/payoutDate`]: raw || null,
      [`operationalAudit/${now}_set_payout_date_${payoutId}`]: {action: "set_payout_date", sourceType: "platformPayout", sourceId: payoutId, detail: raw || "(cleared)", actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1},
    });
    return {payoutId, payoutDate: raw || ""};
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
      const verified = Object.assign({}, o, {payments, paymentStatus: "cashier_verified", paymentVerificationPolicy: verificationPolicy, cashierVerifiedAt: now, cashierVerifiedBy: actor.uid, cashierVerifiedRole: actor.role, cashierVerifiedAmount: Financial.money(direct.reduce((sum, row) => sum + Financial.money(row.amount), 0)), status: nextStatus});
      if (nextStatus !== o.status) { verified.statusUpdatedAt = now; verified.statusUpdatedBy = actor.uid; }
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
      const validated = Object.assign({}, o, {payments, paymentStatus: "manager_validated", paymentVerificationPolicy: verificationPolicy, managerValidatedAt: now, managerValidatedBy: approval.record.approvedBy, managerValidatedRole: approval.record.approvedRole, managerValidatedName: approvedBy, paymentApprovalId: approval.id, status: nextStatus});
      if (nextStatus !== o.status) { validated.statusUpdatedAt = now; validated.statusUpdatedBy = actor.uid; }
      const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
      const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${o.id}`]: validated, [`activeOrders/${o.id}`]: shouldProjectOrder(validated, activeShift, now) ? activeOrderProjection(validated) : null, [`operationalAudit/${now}_manager_validate_${o.id}`]: {action: "manager_validate_payment", sourceType: "order", sourceId: o.id, actorUid: actor.uid, actorRole: actor.role, approvedBy: approval.record.approvedBy, approvedRole: approval.record.approvedRole, approvalId: approval.id, ts: now, schemaVersion: 1}});
      if (validated.ownerUid) writes[`customerOrders/${validated.ownerUid}/${o.id}/status`] = nextStatus;
      await db.ref().update(writes); const accounts = (await db.ref("/cfAccounts").get()).val() || {}, posted = await postOrderFinancial(db, validated, accounts, {uid: "server", role: "server"}); return {validated: true, paymentStatus: "manager_validated", approvedBy, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
    }
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "Reason is required."); const accounts = (await db.ref("/cfAccounts").get()).val() || {}; await postOrderFinancial(db, o, accounts, {uid: "server", role: "server"});
    const now = Date.now(), writes = {}; let movementId, movement;
    if (data.action === "refund") { const delta = Financial.money(data.amount), already = Financial.money(o.refundAmount), max = Financial.money(o.total); if (!(delta > 0) || already + delta > max + 0.009) throw new HttpsError("invalid-argument", "Refund exceeds the refundable amount."); const cumulative = Financial.money(already + delta), original = (Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior = o.refundPayments || {}, tender = Array.isArray(data.refundPayments)?data.refundPayments.map((row) => ({method:financeText(row.method,60),amount:Financial.money(row.amount)})).filter((row) => row.method&&row.amount>0):[]; if ((o.channel||"instore") === "instore") {if (Math.abs(tender.reduce((s,row)=>Financial.money(s+row.amount),0)-delta)>0.009) throw new HttpsError("invalid-argument","Refund tender allocations must equal the refund amount."); const allowed={}; original.forEach((row)=>{allowed[row.method]=Financial.money((allowed[row.method]||0)+Financial.money(row.amount));}); tender.forEach((row)=>{if (!allowed[row.method] || Financial.money((prior[row.method]||0)+row.amount)>allowed[row.method]+0.009) throw new HttpsError("invalid-argument",`Refund through ${row.method} exceeds the original payment.`);});} movementId = `refund_${o.id}_${Math.round(cumulative * 100)}`; const approval = await claimManagerApproval(db, data, "refund", o.id, delta, movementId); movement = Financial.reversalPosting(o, delta, "refund", accounts, tender); Object.assign(writes, approval.usedWrites); const nextRefundPayments=Object.assign({},prior);tender.forEach((row)=>{nextRefundPayments[row.method]=Financial.money((nextRefundPayments[row.method]||0)+row.amount);}); writes[`${found.node}/${o.id}/refundAmount`] = cumulative; writes[`${found.node}/${o.id}/refundPayments`] = nextRefundPayments; writes[`${found.node}/${o.id}/refundHistory/${movementId}`] = {amount:delta,payments:tender,reason,at:now,by:actor.uid,approvalId:approval.id,approvedBy:approval.record.approvedEmail||approval.record.approvedRole}; writes[`${found.node}/${o.id}/refundReason`] = reason; writes[`${found.node}/${o.id}/refundedAt`] = now; writes[`${found.node}/${o.id}/refundedBy`] = actor.uid; writes[`${found.node}/${o.id}/refunded`] = true; }
    else if (data.action === "void") { if (o.voided) throw new HttpsError("already-exists", "Order is already voided."); const value = Financial.money(Math.max(0, Financial.money(o.total) - Financial.money(o.refundAmount))); if (!(value > 0)) throw new HttpsError("failed-precondition", "Nothing remains to void."); movementId = `void_${o.id}`; const approval = await claimManagerApproval(db, data, "void", o.id, value, movementId), original=(Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment||"Cash",amount:o.total}]), prior=o.refundPayments||{}, tender=[]; if ((o.channel||"instore")==="instore") {let rem=value; original.forEach((row)=>{const available=Financial.money(Math.max(0,Financial.money(row.amount)-Financial.money(prior[row.method]))),use=Financial.money(Math.min(rem,available));if(use>0){tender.push({method:row.method,amount:use});rem=Financial.money(rem-use);}});if(rem>0.009)throw new HttpsError("failed-precondition","Original payment allocation cannot support the void reversal.");} movement = await fullOrderVoidMovement(db, o, accounts, tender); if (!movement) throw new HttpsError("failed-precondition", "The void has no remaining financial balance to reverse."); Object.assign(writes, approval.usedWrites); writes[`${found.node}/${o.id}/voided`] = true; writes[`${found.node}/${o.id}/voidPayments`] = tender; writes[`${found.node}/${o.id}/voidApprovalId`] = approval.id; writes[`${found.node}/${o.id}/voidApprovedBy`] = approval.record.approvedEmail||approval.record.approvedRole; writes[`${found.node}/${o.id}/voidReason`] = reason; writes[`${found.node}/${o.id}/voidedAt`] = now; writes[`${found.node}/${o.id}/voidedBy`] = actor.uid; }
    else throw new HttpsError("invalid-argument", "Adjustment action is invalid.");
    if (data.restock === true) {writes[`${found.node}/${o.id}/inventoryReversalRequested`] = true; writes[`${found.node}/${o.id}/inventoryReversalReason`] = reason;}
    movement.occurredAt = now; movement.actorName = actor.role; movement.approvalId=financeText(data.approvalId,160); addOrderCashWrites(writes, movement, movementId, o, actor); const committed = await commitFinancial(db, movementId, movement, actor, writes); return {movementId, duplicate: committed.duplicate};
  },
);

// Re-key a missed Grab/FoodPanda order from the Payout Reconciliation screen.
// Amount-only (no line items, no COGS/inventory deduction — by design). Books
// revenue + commission + the platform receivable, dated on the real order date.
// Duplicate-safe via platformRefIndex; requires a privileged approval (managers
// self-approve on the client, other roles need a manager sign-in).
exports.recordPlatformCatchup = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["payouts", "receivables"]);
    const data = request.data || {};
    const channel = financeText(data.channel, 20).toLowerCase();
    if (channel !== "grabfood" && channel !== "foodpanda") throw new HttpsError("invalid-argument", "Channel must be grabfood or foodpanda.");
    const prefix = channel === "grabfood" ? "GF-" : "FP-";
    let ref = financeText(data.platformRef, 60).trim();
    if (!ref) throw new HttpsError("invalid-argument", "Platform order number is required.");
    if (!new RegExp("^" + prefix, "i").test(ref)) ref = prefix + ref;
    const gross = Financial.money(data.gross);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Gross amount must be greater than zero.");
    const commission = Financial.money(data.commission);
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Commission must be between 0 and the gross amount.");
    const dateStr = financeText(data.date, 10);
    const parsedTs = Date.parse(dateStr + "T12:00:00+08:00");
    if (!parsedTs) throw new HttpsError("invalid-argument", "A valid order date (YYYY-MM-DD) is required.");
    if (parsedTs > Date.now() + 86400000) throw new HttpsError("invalid-argument", "Order date cannot be in the future.");
    const reference = financeText(data.reference, 200);
    const key = platformRefKey(ref);
    const historical = await existingPlatformOrder(db, channel, ref);
    if (historical) throw new HttpsError("already-exists", `${ref} was already recorded (order ${historical.id}). A platform reference can only be used once.`);
    const idxSnap = await db.ref(`/platformRefIndex/${channel}/${key}`).get();
    if (idxSnap.exists()) { const ex = idxSnap.val() || {}; throw new HttpsError("already-exists", `${ref} was already recorded (order ${ex.orderId || "unknown"}). A platform reference can only be used once.`); }
    const approval = await claimManagerApproval(db, data, "rekey_platform_order", ref, gross, `rekey_${ref}`);
    const now = Date.now(), net = Financial.money(gross - commission);
    const oid = prefix + "LATE-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const d = new Date(parsedTs), label = channel === "grabfood" ? "GrabFood" : "FoodPanda";
    const order = {
      id: oid, source: "pos", channel, platformRef: ref,
      name: label + " (late entry)", type: label, payment: label,
      grossPlatform: gross, commission, commissionRate: Financial.money(data.commissionRate), platformDiscount: 0,
      netSalesPlatform: gross, netPlatform: net, total: gross,
      settlementStatus: "unsettled", payoutId: "",
      status: "Completed", paymentStatus: "confirmed", receivedByCustomer: true,
      lateEntry: true, catchup: true, enteredVia: "payout-rekey", cogsSkipped: true,
      reference, catchupBy: actor.uid, catchupByRole: actor.role, catchupApprovalId: approval.id,
      staff: actor.email || actor.role, onDuty: actor.email || actor.role,
      date: d.toLocaleDateString("en-PH", {year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila"}),
      time: d.toLocaleTimeString("en-PH", {hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"}),
      timestamp: parsedTs, completedAt: parsedTs, schemaVersion: 2,
    };
    const accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const writes = Object.assign({}, approval.usedWrites, {
      [`orders/${oid}`]: order,
      [`operationalAudit/${now}_rekey_${oid}`]: {action: "rekey_platform_order", sourceType: "order", sourceId: oid, platformRef: ref, channel, amount: gross, actorUid: actor.uid, actorRole: actor.role, approvalId: approval.id, reference, orderDate: dateStr, ts: now, schemaVersion: 1},
    });
    await db.ref().update(writes);
    const posted = await postOrderFinancial(db, order, accounts, {uid: actor.uid, role: actor.role});
    return {orderId: oid, platformRef: ref, net, financialPosted: !posted.skipped, duplicate: posted.duplicate === true};
  },
);

exports.ensureFinancialLedger = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["cashflow", "receivables"]);
    const [ordersSnap, archiveSnap, accountsSnap, ledgerSnap, shiftsSnap, vouchersSnap, replenishmentsSnap, pettySettingsSnap, receivablesSnap, payablesSnap, movementsSnap, payoutsSnap, varianceDefsSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get(), db.ref("/cfAccounts").get(), db.ref("/cfLedger").get(), db.ref("/shifts").get(), db.ref("/pettyCashVouchers").get(), db.ref("/pettyCashReplenishments").get(), db.ref("/pettyCashSettings").get(), db.ref("/receivables").get(), db.ref("/payables").get(), db.ref("/financialMovements").get(), db.ref("/platformPayouts").get(), db.ref("/platformVarAccounts").get()]);
    const accounts = accountsSnap.val() || {}, legacyLedger = ledgerSnap.val() || {}, all = Object.assign({}, archiveSnap.val() || {}, ordersSnap.val() || {}); let posted = 0, duplicates = 0, skipped = 0; const serverActor = {uid: "server", role: "server"};
    for (const id of Object.keys(all)) { try {const order = Object.assign({id}, all[id]), result = await postOrderFinancial(db, order, accounts, serverActor); if (result.skipped) skipped++; else if (result.duplicate) duplicates++; else posted++; const refund = Financial.money(order.refundAmount); if (refund > 0) {const movementId = `refund_${id}_${Math.round(refund * 100)}`, movement = Financial.reversalPosting(order, refund, "refund", accounts), writes = {}; movement.occurredAt = Number(order.refundedAt || order.timestamp || Date.now()); if (!legacyLedger[`cfrefund_${id}`]) addOrderCashWrites(writes, movement, movementId, order, serverActor); const rr = await commitFinancial(db, movementId, movement, serverActor, writes); rr.duplicate ? duplicates++ : posted++;} if (order.voided) {const remaining = Financial.money(Math.max(0, Financial.money(order.total) - refund)); if (remaining > 0) {const movementId = `void_${id}`, movement = Financial.reversalPosting(order, remaining, "void", accounts), writes = {}; movement.occurredAt = Number(order.voidedAt || order.timestamp || Date.now()); addOrderCashWrites(writes, movement, movementId, order, serverActor); const vr = await commitFinancial(db, movementId, movement, serverActor, writes); vr.duplicate ? duplicates++ : posted++;}}} catch (error) {logger.error("3C backfill order failed", {id, error: String(error)}); throw new HttpsError("internal", `Backfill stopped at order ${id}. It is safe to retry.`);} }
      const originalMovements = movementsSnap.val() || {}; let orphanReversed = 0;
      for (const movementId of Object.keys(originalMovements)) {
        const original = originalMovements[movementId] || {}, sourceId = String(original.sourceId || "");
        if (original.type !== "order_sale" || !sourceId || all[sourceId]) continue;
        if (!(original.lines || []).length) continue;
        const reversalId = `orphan_balance_correction_${sourceId}`, reversal = Financial.netMovementCorrection(Object.values(originalMovements), sourceId, "orphan_order_reversal", "Correct orphaned sale balance");
        if (!reversal) continue;
        reversal.actorName = "Automated sales reconciliation"; reversal.controlReason = "Admin order record is authoritative; correct only the remaining source balance";
      const result = await commitFinancial(db, reversalId, reversal, serverActor, {[`operationalAudit/${Date.now()}_orphan_sale_${sourceId}`]: {action: "orphan_sale_reversed", sourceType: "order", sourceId, movementId, reversalId, amount: Financial.money(original.amount), actorUid: actor.uid, ts: Date.now(), schemaVersion: 1}});
      if (result.duplicate) duplicates++; else {posted++; orphanReversed++;}
    }
    const shifts = shiftsSnap.val() || {}; for (const id of Object.keys(shifts)) {await postShiftCashEntries(db, id, shifts[id].payIns || [], "shift_payin"); await postShiftCashEntries(db, id, shifts[id].payOuts || [], "shift_payout"); await backfillShiftVariance(db, id, shifts[id]);}
    const vouchers = vouchersSnap.val() || {}; for (const id of Object.keys(vouchers)) await backfillPettyVoucher(db, id, vouchers[id]);
    const replenishments = replenishmentsSnap.val() || {}; for (const id of Object.keys(replenishments)) await backfillPettyReplenishment(db, id, replenishments[id]);
    for (const id of Object.keys(accounts)) {const account = accounts[id] || {}, occurredAt = Date.parse(`${account.openingDate || ""}T00:00:00+08:00`) || account.ts || Date.now(); await backfillOpeningBalance(db, `opening_cash_${id}`, "cashAccount", id, `asset:cash_account:${id}`, account.opening, occurredAt, `Opening balance — ${financeText(account.name || id, 80)}`);}
    const pettySettings = pettySettingsSnap.val() || {}; await backfillOpeningBalance(db, "opening_petty_cash", "pettyCash", "pettyCash", "asset:petty_cash", pettySettings.openingBalance, pettySettings.updatedAt || Date.now(), "Revolving Fund opening balance");
    const receivables = receivablesSnap.val() || {}; for (const id of Object.keys(receivables)) await backfillFinancialDocument(db, id, receivables[id], true, accounts);
    const payables = payablesSnap.val() || {}; for (const id of Object.keys(payables)) await backfillFinancialDocument(db, id, payables[id], false, accounts);
    const payouts = payoutsSnap.val() || {}, varianceDefs = varianceDefsSnap.val() || {}; let payoutsPosted = 0, payoutDuplicates = 0, settledOrdersLinked = 0; const payoutIssues = [];
    for (const id of Object.keys(payouts).sort()) {
      const payout = Object.assign({id}, payouts[id] || {}), movementId = `payout_${id}`;
      if (!["grabfood", "foodpanda"].includes(String(payout.channel || "").toLowerCase()) || payout.expectedNet == null) {payoutIssues.push({kind:"payout_record_incomplete", payoutId:id});continue;}
      const linkWrites = {};
      if (!payout.reversed) for (const orderId of (Array.isArray(payout.orderIds) ? payout.orderIds : [])) {try {const entry=await findOrder(db,orderId);if ((entry.order.settlementStatus||"unsettled")!=="settled"||entry.order.payoutId!==id){linkWrites[`${entry.node}/${entry.id}/settlementStatus`]="settled";linkWrites[`${entry.node}/${entry.id}/payoutId`]=id;settledOrdersLinked++;}} catch (_) {payoutIssues.push({kind:"payout_order_missing",payoutId:id,orderId});}}
      try {const rebuilt=Financial.platformPayoutPosting(Object.assign({},payout,{reconstructedFromPayoutRecord:true}),varianceDefs), now=Date.now(), auditKey=`operationalAudit/${now}_payout_rebuild_${id}`, result=await commitFinancial(db,movementId,rebuilt,serverActor,Object.assign({},linkWrites,{[auditKey]:{action:"platform_payout_movement_rebuilt",sourceType:"platformPayout",sourceId:id,movementId,channel:payout.channel,expectedNet:Financial.money(payout.expectedNet),actualPayout:Financial.money(payout.actualPayout),orderCount:(payout.orderIds||[]).length,actorUid:actor.uid,ts:now,schemaVersion:1}}));if(result.duplicate){payoutDuplicates++;if(Object.keys(linkWrites).length)await db.ref().update(linkWrites);}else{posted++;payoutsPosted++;}} catch(error){payoutIssues.push({kind:"payout_rebuild_failed",payoutId:id,detail:String(error)});}
    }
    const repairedMovements=(await db.ref("/financialMovements").get()).val()||{}, adminByChannel={grabfood:0,foodpanda:0}, ledgerByChannel={grabfood:0,foodpanda:0};
    Object.values(all).forEach((o)=>{const channel=String(o&&o.channel||"").toLowerCase();if(!["grabfood","foodpanda"].includes(channel)||o.voided||(o.settlementStatus||"unsettled")==="settled")return;adminByChannel[channel]=Financial.money(adminByChannel[channel]+Financial.money(o.netPlatform!=null?o.netPlatform:Financial.money(o.grossPlatform||o.total)-Financial.money(o.commission)));});
    Object.values(repairedMovements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerByChannel[channel]=Financial.money(ledgerByChannel[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));
    const adminTotal=Financial.money(adminByChannel.grabfood+adminByChannel.foodpanda),ledgerTotal=Financial.money(ledgerByChannel.grabfood+ledgerByChannel.foodpanda),platformAr={adminByChannel,ledgerByChannel,adminTotal,ledgerTotal,difference:Financial.money(ledgerTotal-adminTotal),reconciled:Math.abs(ledgerTotal-adminTotal)<0.01,payoutsChecked:Object.keys(payouts).length,payoutsPosted,payoutDuplicates,settledOrdersLinked,issues:payoutIssues.slice(0,200)};
    const scanned = Object.keys(all).length + Object.keys(shifts).length + Object.keys(vouchers).length + Object.keys(replenishments).length + Object.keys(accounts).length + Object.keys(receivables).length + Object.keys(payables).length + Object.keys(payouts).length + 1; await db.ref("/systemMaintenance/financialLedgerInitialized").set({at: Date.now(), by: actor.uid, scanned, posted, duplicates, skipped, orphanReversed, platformAr}); return {scanned, posted, duplicates, skipped, orphanReversed, platformAr};
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
    const snaps=await Promise.all([db.ref("/orders").get(),db.ref("/archivedOrders").get(),db.ref("/financialMovements").get(),db.ref("/cfLedger").get(),db.ref("/receivables").get(),db.ref("/payables").get(),db.ref("/platformPayouts").get(),db.ref("/cashCustody").get(),db.ref("/cfAccounts").get(),db.ref("/posSettings").get(),db.ref("/posActiveShift").get()]);
    const orders=Object.assign({},snaps[1].val()||{},snaps[0].val()||{}),movements=snaps[2].val()||{},cash=snaps[3].val()||{},ars=snaps[4].val()||{},aps=snaps[5].val()||{},payouts=snaps[6].val()||{},custody=snaps[7].val()||{},accounts=snaps[8].val()||{},issues=[];
    const resolvedPaymentMappings=new Set();Object.values(movements).forEach((m)=>{if(m&&m.type==="payment_account_reclassification"&&m.originalMovementId&&m.method)resolvedPaymentMappings.add(`${m.originalMovementId}|${financeText(m.method,60).toLowerCase()}`);});
    Object.keys(movements).forEach((id)=>{const m=movements[id],sum=Financial.totals(m.lines||[]);if(Math.abs(sum.debit-sum.credit)>0.009)issues.push({severity:"critical",kind:"unbalanced",source:id,amount:Financial.money(sum.debit-sum.credit)});(m.warnings||[]).forEach((w)=>{const match=/^No cash-flow account mapping for (.+)\.$/.exec(String(w||"")),resolved=match&&resolvedPaymentMappings.has(`${id}|${financeText(match[1],60).toLowerCase()}`);if(!resolved)issues.push({severity:"warning",kind:"movement_warning",source:id,detail:w});});});
    Object.keys(cash).forEach((id)=>{if(!cash[id].movementId)issues.push({severity:"warning",kind:"legacy_cash_without_movement",source:id,amount:Financial.money(cash[id].amount)});});
    Object.keys(cash).forEach((id)=>{const row=cash[id]||{},mv=movements[row.movementId];if(mv&&row.date&&BooksBridge.businessDate(mv.occurredAt)!==row.date)issues.push({severity:"critical",kind:"cash_finance_date_mismatch",source:id,detail:`Cash ${row.date}; Finance ${BooksBridge.businessDate(mv.occurredAt)}`,amount:Financial.money(row.amount)});});
    let unsettledValue=0,unsettledCount=0;Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status,platform=["grabfood","foodpanda"].includes(o.channel);if(!o.voided&&["Completed","Received"].includes(status)&&o.paymentStatus!=="pending"&&!movements[`sale_${id}`])issues.push({severity:"critical",kind:"sale_not_posted",source:id,amount:Financial.money(o.total)});if(platform&&!o.voided&&(o.settlementStatus||"unsettled")!=="settled"){unsettledCount++;unsettledValue=Financial.money(unsettledValue+Financial.money(o.netPlatform));}if(!platform){const rows=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}];rows.forEach((p)=>{if(String(p.method||"").toLowerCase()==="cash")return;if(!Financial.accountForMethod(p.method,accounts))issues.push({severity:"warning",kind:"unmapped_payment_method",source:id,detail:financeText(p.method,60),amount:Financial.money(p.amount)});});}});
    Object.keys(payouts).forEach((id)=>{const p=payouts[id]||{},movementId=p.movementId||`payout_${id}`;if(!movements[movementId])issues.push({severity:"critical",kind:"payout_movement_missing",source:id,amount:Financial.money(p.expectedNet)});if(p.reversed&&p.depositMovementId&&!p.depositReversalMovementId)issues.push({severity:"critical",kind:"reversed_payout_cash_not_reversed",source:id,amount:Financial.money(p.actualPayout)});if(p.depositMovementId&&!p.depositReference)issues.push({severity:"warning",kind:"payout_deposit_missing_reference",source:id,amount:Financial.money(p.actualPayout)});if(!p.reversed)(p.orderIds||[]).forEach((orderId)=>{const o=orders[orderId];if(!o||o.payoutId!==id||(o.settlementStatus||"unsettled")!=="settled")issues.push({severity:"critical",kind:"payout_order_link_mismatch",source:id,detail:String(orderId)});});});
    const ledgerPlatform={grabfood:0,foodpanda:0};Object.values(movements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerPlatform[channel]=Financial.money(ledgerPlatform[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));const ledgerPlatformTotal=Financial.money(ledgerPlatform.grabfood+ledgerPlatform.foodpanda),platformDifference=Financial.money(ledgerPlatformTotal-unsettledValue);if(Math.abs(platformDifference)>0.009)issues.push({severity:"critical",kind:"platform_ar_control_mismatch",source:"platform_receivables",amount:platformDifference,expected:unsettledValue,actual:ledgerPlatformTotal});
    const codes={};Object.keys(accounts).forEach((id)=>{const code=BooksBridge.cashCodeForAccount(accounts[id]);(codes[code]||(codes[code]=[])).push(id);});Object.keys(codes).forEach((code)=>{if(codes[code].length>1)issues.push({severity:"critical",kind:"duplicate_cash_account_code",source:code,detail:codes[code].join(", ")});});
    const floatControl=resolveRegisterFloat(snaps[9].val()||{},snaps[10].val()||{});if(Math.abs(floatControl.amount-4000)>.009)issues.push({severity:"warning",kind:"register_float_differs_from_control",source:floatControl.source,amount:floatControl.amount,expected:4000});
    let custodyValue=0,custodyCount=0;Object.keys(custody).forEach((id)=>{const rem=Financial.money(custody[id].remaining);if(rem>0){custodyCount++;custodyValue=Financial.money(custodyValue+rem);}});const openAr=Object.values(ars).filter((x)=>x&&x.status==="open"),openAp=Object.values(aps).filter((x)=>x&&x.status==="open"),undepositedPayouts=Object.values(payouts).filter((x)=>x&&!x.reversed&&!x.depositMovementId&&Financial.money(x.actualPayout)>0);
    return{generatedAt:Date.now(),issues:issues.slice(0,200),issueCount:issues.length,registerFloat:{amount:floatControl.amount,expected:4000,source:floatControl.source},unsettledPlatform:{count:unsettledCount,amount:unsettledValue},cashAwaitingDeposit:{count:custodyCount,amount:custodyValue},openReceivables:{count:openAr.length,amount:Financial.money(openAr.reduce((s,x)=>s+Number(x.amount||0),0))},openPayables:{count:openAp.length,amount:Financial.money(openAp.reduce((s,x)=>s+Number(x.amount||0),0))},undepositedPayouts:undepositedPayouts.length};
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
    (async () => {
      // Read + conditional partial update (a transaction here aborted on the
      // admin SDK's initial null-cache pass, so /inventory.stock never synced
      // from the ledger). Only update fields the ledger owns; skip if a newer
      // ledger version already wrote.
      const invRef = db.ref(`/inventory/${itemId}`);
      const cur = (await invRef.get()).val();
      if (!cur) return;
      if (Number(cur.ledgerVersion || 0) > version) return;
      await invRef.update({stock: projection.qty, cost: projection.unitCost, ledgerVersion: version, ledgerUpdatedAt: projection.updatedAt});
    })(),
  ]);
  return projection;
}
const INVENTORY_BOOK_POSTING_TYPES = new Set(["waste", "staff_use", "rnd_testing", "adjustment", "manual_edit"]);
function inventoryBookAccountCode(item) {
  const code = String(item && item.inventoryAccount || "");
  return /^12[0-8]0$/.test(code) ? code : "1290";
}
// Every value-changing manual inventory movement posts a matching balanced
// Finance entry so inventory and the books can never diverge. Stock reduced ->
// Cr inventory / Dr 5900 Wastage & Spoilage (waste/staff/R&D/adjustment loss);
// stock increased (positive adjustment) -> Dr inventory / Cr 4990 Other Income.
// Idempotent via commitFinancial(`invmove_${id}`); auto-mirrors to /books/journal.
async function postInventoryMovementToBooks(db, movement, item, actor) {
  const type = String(movement && movement.type || "");
  if (!INVENTORY_BOOK_POSTING_TYPES.has(type)) return;
  const value = Financial.money(movement.totalCost); // signed: negative = stock out
  if (Math.abs(value) < 0.005) return;
  const invCode = inventoryBookAccountCode(item);
  const label = `${type.replace(/_/g, " ")} \u00b7 ${String(item && item.name || movement.itemId || "").slice(0, 120)}`;
  let lines;
  if (value < 0) {
    const out = Financial.money(-value);
    lines = [Financial.line("coa:5900", out, 0, label), Financial.line(`coa:${invCode}`, 0, out, label)];
  } else {
    lines = [Financial.line(`coa:${invCode}`, value, 0, label), Financial.line("coa:4990", 0, value, label)];
  }
  const mv = Financial.movement(`inventory_${type}`, "inventoryMovement", String(movement.id || ""), lines, {occurredAt: Number(movement.occurredAt || movement.createdAt || Date.now()), actorName: String(actor && actor.role || "server"), itemId: String(movement.itemId || ""), invAccount: invCode});
  await commitFinancial(db, `invmove_${String(movement.id || "")}`, mv, actor || {uid: "server", role: "server"});
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
  if (["purchase", "waste", "staff_use", "rnd_testing", "adjustment", "manual_edit"].includes(type)) {
    const invAcct = String(item.inventoryAccount || ""), costAcct = String(item.costAccount || item.cogsAccount || "");
    const invOk = ["1200", "1210", "1220", "1230", "1240", "1270", "1280"].includes(invAcct);
    const costOk = ["5000", "5010", "5020", "5030", "5040", "6070", "6075"].includes(costAcct);
    if (!invOk || !costOk) throw new HttpsError("failed-precondition", `\u201c${String(item.name || itemId)}\u201d is missing its Inventory Asset (12xx) and/or COGS account (5xxx). Map the item under Stock Items before recording a ${type.replace(/_/g, " ")}.`);
  }
  const now = Date.now();
  if (Number(raw.occurredAt) && Number(raw.occurredAt) > now + 2 * 86400000) throw new HttpsError("invalid-argument", "An inventory movement can\u2019t be dated in the future.");
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
  if (movement) await postInventoryMovementToBooks(db, movement, item, actor);
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
      const cogsAccountSnapshot = {};
      costing.lines.forEach((costLine) => {
        const item = inv[costLine.ingredientId] || {}, mapping = BooksBridge.itemAccounts(item);
        const key = mapping.inventory && mapping.cost ? `${mapping.inventory}|${mapping.cost}` : "1290|5090";
        cogsAccountSnapshot[key] = Financial.money((cogsAccountSnapshot[key] || 0) + Number(costLine.totalCost || 0));
      });

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
        cogsAccountSnapshot,
        cogsAccountSnapshotVersion: 1,
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
    await db.ref("/systemHealth/backups/latest").set({takenAt: now, objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, version: "backup-v1"});
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
