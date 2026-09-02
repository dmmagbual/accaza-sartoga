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
const CashJournalEdit = require("./lib/cash-journal-edit");
const JournalReclassification = require("./lib/journal-reclassification");
const ReconciliationControls = require("./lib/reconciliation-controls");
const RecoveryValidation = require("./lib/recovery-validation");
const ProductionHealth = require("./lib/production-health");
const IncidentControls = require("./lib/incident-controls");
const ReleaseCertification = require("./lib/release-certification");
const ProductionValidation = require("./lib/production-validation");
const AlertEscalation = require("./lib/alert-escalation");
const AssuranceControls = require("./lib/assurance-controls");

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
const WriteSafety = require("./lib/write-safety");

function operationCorrelationId(request, operation) {
  const rawTrace = String(request && request.rawRequest && request.rawRequest.headers && request.rawRequest.headers["x-cloud-trace-context"] || "").split("/")[0];
  const trace = rawTrace.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return trace || `${String(operation || "operation").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20)}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeErrorCode(error) { return String(error && (error.code || error.name) || "unknown").replace(/[^A-Za-z0-9_/-]/g, "").slice(0, 80); }

async function observeFinancialOperation(request, operation, handler) {
  const correlationId = operationCorrelationId(request, operation), startedAt = Date.now();
  logger.info("Financial operation started", {operation, correlationId, authenticated:!!(request && request.auth && request.auth.uid)});
  try {
    const result = await handler({correlationId});
    logger.info("Financial operation completed", {operation, correlationId, durationMs:Date.now()-startedAt, duplicate:!!(result && result.duplicate)});
    return result && typeof result === "object" && !Array.isArray(result) ? Object.assign({}, result, {correlationId}) : result;
  } catch (error) {
    logger.error("Financial operation failed", {operation, correlationId, durationMs:Date.now()-startedAt, code:safeErrorCode(error), expected:error instanceof HttpsError});
    if (error instanceof HttpsError) {
      const details = error.details && typeof error.details === "object" ? Object.assign({}, error.details, {correlationId}) : {correlationId};
      throw new HttpsError(error.code, error.message, details);
    }
    throw new HttpsError("internal", `The financial operation could not be completed. Nothing was posted. Reference: ${correlationId}.`, {correlationId});
  }
}

async function safeFinancialUpdate(db, writes, context) {
  try { return await WriteSafety.safeAtomicUpdate(db, writes); }
  catch (error) {
    if (!(error instanceof WriteSafety.UnsafeAtomicUpdateError)) throw error;
    logger.error("Unsafe atomic update blocked", {context:financeText(context || "financial", 80), code:error.code, details:error.details || {}});
    throw new HttpsError("internal", `The ${context || "financial"} update could not be prepared safely. Nothing was posted.`);
  }
}
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

async function booksMovementContext(db,mv){
  const sourceId=String(mv&&mv.sourceId||"");let purchaseInvoice=null;
  if(sourceId){purchaseInvoice=(await db.ref(`/purchaseInvoices/${sourceId}`).get()).val()||null;if(!purchaseInvoice){const payable=(await db.ref(`/payables/${sourceId}`).get()).val()||{},derivedId=sourceId.indexOf("ap_")===0?sourceId.slice(3):sourceId,invoiceId=String(payable.purchaseInvoiceId||derivedId);purchaseInvoice=(await db.ref(`/purchaseInvoices/${invoiceId}`).get()).val()||null;}}
  if(!purchaseInvoice)return {};
  return {purchaseInvoice,inventory:(await db.ref("/inventory").get()).val()||{}};
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
    let context={};
    if (bucket.mode === "daily") {
      const ref = db.ref(`/books/journal/${bucket.key}`);
      await ref.transaction((cur) => {
        const next = BooksBridge.applyDaily(cur, mv, cashMap);
        return next === undefined ? cur : next; // abort (already applied) leaves node unchanged
      });
      await ref.child("updatedAt").set(Date.now());
    } else {
      context=await booksMovementContext(db,mv);const built = BooksBridge.buildSingle(mv, cashMap, context);
      const ref = db.ref(`/books/journal/${built.entry.id}`);
      built.entry.createdAt = Date.now();
      await ref.transaction((current)=>current||built.entry,undefined,false);
    }
    const unmapped = BooksBridge.mappedLines(mv, cashMap, context).unmapped;
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
    await ensureBooksChart(db);
    await ensureHistoricalInternalUsageFinance(db,actor);
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
    Object.keys(existing).forEach((key) => {
      const entry=existing[key]||{};
      if (entry.net && entry.source === "pos-bridge" && !daily[key]) writes[`books/journal/${key}`] = null;
      if (!daily[key]&&!singles[key]&&Array.isArray(entry.lines)&&entry.lines.some((line)=>String(line&&line.code||"")==="4995")) writes[`books/journal/${key}`]=Object.assign({},entry,{lines:entry.lines.map((line)=>String(line&&line.code||"")==="4995"?Object.assign({},line,{code:"5905"}):line),legacyAccountMigratedFrom:"4995",legacyAccountMigratedTo:"5905",legacyAccountMigratedAt:Date.now()});
    });
    Object.keys(daily).forEach((key) => { daily[key].updatedAt = Date.now(); writes[`books/journal/${key}`] = daily[key]; });
    // A rebuild may have read a movement before an in-place edit completed.
    // Never overwrite a newer audited revision with that older snapshot.
    for(const key of Object.keys(singles))await db.ref(`/books/journal/${key}`).transaction((current)=>Number(current&&current.revision||0)>Number(singles[key].revision||0)?current:singles[key],undefined,false);
    const registerFloat = resolveRegisterFloat(posSettingsSnap.val(), activeShiftSnap.val());
    writes["books/journal/register_float_control"] = registerFloat.amount > 0 ? registerFloatControlEntry(registerFloat.amount, Date.now(), registerFloat) : null;
    writes["books/journal/historical_suspense_capital_20260826"] = historicalSuspenseCapitalEntry();
    // Reconciliation metadata is non-financial. It changes only how the audit
    // distinguishes verified legacy history from genuinely new exceptions.
    // It must never create or amend a journal or today's account balances.
    writes["books/reconciliationConfig"] = ReconciliationControls.DEFAULT_ACCOUNT_RULES;
    writes["books/reviewQueue"] = review;
    writes["books/config/cashAccountMap"] = cashMap;
    const paths = Object.keys(writes); for (let i = 0; i < paths.length; i += 300) { const batch = {}; paths.slice(i, i + 300).forEach((path) => { batch[path] = writes[path]; }); await db.ref().update(batch); }
    const openingCash = BooksBridge.r2(Object.values(cashAccountsSnap.val() || {}).reduce((sum, account) => sum + Number(account && account.opening || 0), 0));
    const netSales = BooksBridge.r2(Object.values(daily).reduce((sum, entry) => sum + BooksBridge.netSales(entry && entry.net), 0));
    const result = {at: Date.now(), by: actor.uid, movements: movementIds.length, dailyEntries: Object.keys(daily).length, singleEntries: Object.keys(singles).length, netSales, cogsPosted, missingCogs, reviewItems: Object.keys(review).length, openingCash, fixedFloat: registerFloat.amount, registerFloatSource: registerFloat.source};
    await db.ref("/systemMaintenance/booksJournalSynced").set(result); return result;
  },
);

async function ensureHistoricalInternalUsageFinance(db,actor){
  const [inventorySnap,financeSnap]=await Promise.all([db.ref("/inventoryMovements").get(),db.ref("/financialMovements").get()]),inventory=inventorySnap.val()||{},finance=financeSnap.val()||{};
  for(const id of Object.keys(inventory)){
    const reversal=Object.assign({id},inventory[id]||{});if(reversal.type!=="usage_reversal"||finance[`invmove_${id}`])continue;
    const originalId=String(reversal.reversalOf||""),originalInventory=inventory[originalId]||{},original=finance[`invmove_${originalId}`];if(originalInventory.sourceType!=="internal-usage"||!original||!Array.isArray(original.lines)||!["inventory_staff_use","inventory_rnd_testing","inventory_waste"].includes(String(original.type||"")))continue;
    const usageAccount=String(original.usageAccount||(original.type==="inventory_rnd_testing"?"6078":original.type==="inventory_waste"?"5900":"6077")),lines=original.lines.map((line)=>Financial.line(line.account,Number(line.credit)||0,Number(line.debit)||0,`Historical internal-usage reversal · ${reversal.itemName||reversal.itemId||id}`)),movement=Financial.movement("inventory_usage_reversal","inventoryMovement",id,lines,{occurredAt:Number(reversal.occurredAt||reversal.createdAt||Date.now()),actorName:actor.role,itemId:String(reversal.itemId||""),usageAccount,reversalOf:originalId,automaticRepair:true});
    await commitFinancial(db,`invmove_${id}`,movement,actor);
  }
}

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
    const ref = db.ref(`/cfAccounts/${id}`), old = (await ref.get()).val() || {}, accounts=(await db.ref("/cfAccounts").get()).val()||{}, duplicateId=Object.keys(accounts).find((key)=>key!==id&&financeText(accounts[key]&&accounts[key].name,100).trim().toLowerCase()===name.trim().toLowerCase());if(duplicateId)throw new HttpsError("already-exists","A Finance cash account with this name already exists. Select the existing account instead of creating a duplicate.");const opening = Financial.money(data.opening), oldOpening = Financial.money(old.opening), date = financeDate(data.openingDate), occurredAt = Date.parse(`${date}T00:00:00+08:00`) || Date.now(), reference=financeText(data.reference,120), reason=financeText(data.reason,300);
    const feedMethods = Array.isArray(data.feedMethods) ? data.feedMethods.map((x) => financeText(x, 60)).filter(Boolean).slice(0, 20) : [];
    const row = {name, type, opening, openingDate: date, feedMethods, order: Number.isFinite(Number(old.order)) ? Number(old.order) : Object.keys(accounts).length, ts: old.ts || Date.now(), updatedAt: Date.now(), updatedBy: actor.uid};
    const writes = {[`cfAccounts/${id}`]: row}, delta = Financial.money(opening - oldOpening);
    if (Math.abs(delta) >= 0.005) {
      if(!reference||!reason)throw new HttpsError("invalid-argument","Opening-balance corrections require a supporting reference and reason.");
      const value = Math.abs(delta), asset = `asset:cash_account:${id}`, lines = delta > 0 ? [Financial.line(asset, value, 0, "Opening cash adjustment"), Financial.line("equity:opening_balance", 0, value, "Opening cash adjustment")] : [Financial.line("equity:opening_balance", value, 0, "Opening cash adjustment"), Financial.line(asset, 0, value, "Opening cash adjustment")];
      const movementId = financeKey(`opening_adjust_${id}_${commandId}`, "Movement ID"), movement = Financial.movement("opening_balance_adjustment", "cashAccount", id, lines, {occurredAt, actorName: name,reference,reason,oldOpening,opening});
      writes[`financialMovements/${movementId}`] = financeRecord(movementId, movement, actor);
    }
    writes[`operationalAudit/${Date.now()}_cash_account_${id}`] = {action: "cash_account_upsert", sourceType: "cashAccount", sourceId: id, oldOpening, opening, adjustment:delta, openingDate: date, reference, reason, actorUid: actor.uid, actorRole: actor.role, ts: Date.now(), schemaVersion: 1};
    await db.ref().update(writes); return {accountId: id, opening, adjustment: delta};
  },
);

// Platform (Grab/FoodPanda) order-number uniqueness. Every platform reference
// may be used ONCE. This trigger keeps an authoritative index the POS reads at
// entry to block a re-key, and records any duplicate that still slips through
// (offline/race) so nothing is silently double-counted in the receivable.
function platformRefKey(ref) {
  return String(ref || "").trim().toUpperCase().replace(/[.#$/\[\]\x00-\x1f\x7f]/g, "_");
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
  const raw=snap.val(),role = portalRoleValue(raw);
  if (!["owner", "superadmin", "admin", "manager", "staff", "cashier", "kitchen", "finance"].includes(role)) {
    throw new HttpsError("permission-denied", "This account is not authorized for the Accaza portal.");
  }
  return {uid: request.auth.uid, role, name:financeText(raw&&typeof raw==="object"&&(raw.name||raw.displayName||raw.email)||request.auth.token&&request.auth.token.email||role,120)};
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

function supplierNameKey(value) {
  return financeText(value, 120).trim().replace(/\s+/g, " ").toLowerCase();
}

async function requireActiveSupplier(db, supplierId, supplierName) {
  const id = financeKey(supplierId, "Supplier ID"), row = (await db.ref(`/suppliers/${id}`).get()).val();
  if (!row || row.active === false || row.mergedInto) throw new HttpsError("failed-precondition", "Select an active supplier from the supplier master.");
  const name = financeText(row.name, 120); if (!name) throw new HttpsError("failed-precondition", "The selected supplier master record has no valid name.");
  if (supplierName && supplierNameKey(supplierName) !== supplierNameKey(name)) throw new HttpsError("failed-precondition", "The supplier name changed. Refresh and select the current supplier record.");
  return {id, name, row};
}

exports.manageSupplier = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["purchases","petty","payables"]),data=request.data||{},action=financeText(data.action,20).toLowerCase(),now=Date.now();
    if(!["create","update","deactivate","reactivate","initialize_legacy","validate"].includes(action))throw new HttpsError("invalid-argument","Supplier action is invalid.");
    if(action==="validate"){const supplier=await requireActiveSupplier(db,data.supplierId,data.name);return{supplierId:supplier.id,name:supplier.name,active:true};}
    if(action==="initialize_legacy"){
      const [suppliersSnap,purchasesSnap,vouchersSnap,payablesSnap,receiptsSnap,batchesSnap]=await Promise.all([db.ref("/suppliers").get(),db.ref("/purchaseInvoices").get(),db.ref("/pettyCashVouchers").get(),db.ref("/payables").get(),db.ref("/stockReceipts").get(),db.ref("/inventoryBatch").get()]),suppliers=suppliersSnap.val()||{},purchases=purchasesSnap.val()||{},vouchers=vouchersSnap.val()||{},payables=payablesSnap.val()||{},receipts=receiptsSnap.val()||{},batches=batchesSnap.val()||{},byKey={},writes={};
      Object.keys(suppliers).forEach(id=>{const row=suppliers[id]||{},key=supplierNameKey(row.name);if(key)byKey[key]={id,name:financeText(row.name,120)};});
      const ensure=(value)=>{const name=financeText(value,120).trim().replace(/\s+/g," "),key=supplierNameKey(name);if(!key)return null;if(byKey[key])return byKey[key];const hash=crypto.createHash("sha256").update(key).digest("hex").slice(0,32),id=`sup_${hash}`,row={id,name};byKey[key]=row;writes[`suppliers/${id}`]={name,normalizedName:key,active:true,createdAt:now,createdBy:actor.uid,createdByRole:actor.role,updatedAt:now,legacyInitialized:true,schemaVersion:1};writes[`supplierNameIndex/${hash}`]={supplierId:id,normalizedName:key,claimedAt:now};return row;};
      Object.keys(purchases).forEach(id=>{const x=purchases[id]||{},s=ensure(x.supplier);if(s&&!x.supplierId){writes[`purchaseInvoices/${id}/supplierId`]=s.id;writes[`purchaseInvoices/${id}/supplier`]=s.name;}});
      Object.keys(vouchers).forEach(id=>{const x=vouchers[id]||{};if(x.transactionType!=="purchase_advance")return;const s=ensure(x.supplierName||x.recipient);if(s&&!x.supplierId){writes[`pettyCashVouchers/${id}/supplierId`]=s.id;writes[`pettyCashVouchers/${id}/supplierName`]=s.name;writes[`pettyCashVouchers/${id}/recipient`]=s.name;}});
      Object.keys(payables).forEach(id=>{const x=payables[id]||{};if(x.type==="customer_change_refund"||x.type==="owner reimbursement")return;const s=ensure(x.party);if(s&&!x.supplierId){writes[`payables/${id}/supplierId`]=s.id;writes[`payables/${id}/party`]=s.name;}});
      Object.keys(receipts).forEach(id=>{const x=receipts[id]||{},s=ensure(x.supplier);if(s&&!x.supplierId)writes[`stockReceipts/${id}/supplierId`]=s.id;});Object.keys(batches).forEach(id=>{const x=batches[id]||{},s=ensure(x.supplier);if(s&&!x.supplierId)writes[`inventoryBatch/${id}/supplierId`]=s.id;});
      const count=Object.keys(writes).length;if(count){writes[`supplierMigrations/legacyToMaster`]={status:"complete",linkedWrites:count,completedAt:now,completedBy:actor.uid,schemaVersion:1};writes[`operationalAudit/${now}_supplier_legacy_initialize`]=operationalAuditRecord("initialize_legacy_suppliers","supplierMaster","legacyToMaster",actor,{linkedWrites:count,accounting:"No cash, inventory quantity, subledger balance, Finance movement, or Books journal amount changed; stable supplier IDs were added to existing records."});await db.ref().update(writes);}return{initialized:true,linkedWrites:count,supplierCount:Object.keys(byKey).length};
    }
    if(action==="create"){
      const name=financeText(data.name,120).trim().replace(/\s+/g," "),key=supplierNameKey(name);if(!name)throw new HttpsError("invalid-argument","Supplier name is required.");
      const indexId=crypto.createHash("sha256").update(key).digest("hex").slice(0,32),indexRef=db.ref(`/supplierNameIndex/${indexId}`),claim=await indexRef.transaction(current=>current||{supplierId:`sup_${indexId}`,normalizedName:key,claimedAt:now});
      const supplierId=financeKey(claim.snapshot.val().supplierId,"Supplier ID"),existing=(await db.ref(`/suppliers/${supplierId}`).get()).val();
      if(existing){if(supplierNameKey(existing.name)!==key)throw new HttpsError("already-exists","A supplier-name index conflict requires management review.");return{supplierId,name:existing.name,duplicate:true};}
      const record={name,normalizedName:key,active:true,createdAt:now,createdBy:actor.uid,createdByRole:actor.role,updatedAt:now,schemaVersion:1};
      await db.ref().update({[`suppliers/${supplierId}`]:record,[`operationalAudit/${now}_supplier_create_${supplierId}`]:operationalAuditRecord("create_supplier","supplier",supplierId,actor,{name})});return{supplierId,name,duplicate:false};
    }
    const supplierId=financeKey(data.supplierId,"Supplier ID"),supplier=(await db.ref(`/suppliers/${supplierId}`).get()).val();if(!supplier)throw new HttpsError("not-found","Supplier was not found.");
    if(action==="deactivate"){
      const linked=await Promise.all([db.ref("/pettyCashVouchers").orderByChild("supplierId").equalTo(supplierId).limitToFirst(1).get(),db.ref("/purchaseInvoices").orderByChild("supplierId").equalTo(supplierId).limitToFirst(1).get()]);
      await db.ref().update({[`suppliers/${supplierId}/active`]:false,[`suppliers/${supplierId}/deactivatedAt`]:now,[`suppliers/${supplierId}/deactivatedBy`]:actor.uid,[`operationalAudit/${now}_supplier_deactivate_${supplierId}`]:operationalAuditRecord("deactivate_supplier","supplier",supplierId,actor,{name:supplier.name||"",hasTransactions:linked.some(s=>s.exists())})});return{supplierId,active:false};
    }
    if(action==="reactivate"){
      await db.ref().update({[`suppliers/${supplierId}/active`]:true,[`suppliers/${supplierId}/deactivatedAt`]:null,[`suppliers/${supplierId}/deactivatedBy`]:null,[`suppliers/${supplierId}/reactivatedAt`]:now,[`suppliers/${supplierId}/reactivatedBy`]:actor.uid,[`operationalAudit/${now}_supplier_reactivate_${supplierId}`]:operationalAuditRecord("reactivate_supplier","supplier",supplierId,actor,{name:supplier.name||""})});return{supplierId,active:true};
    }
    const name=financeText(data.name,120).trim().replace(/\s+/g," "),key=supplierNameKey(name),oldKey=supplierNameKey(supplier.name);if(!name)throw new HttpsError("invalid-argument","Supplier name is required.");
    const indexId=crypto.createHash("sha256").update(key).digest("hex").slice(0,32),index=(await db.ref(`/supplierNameIndex/${indexId}`).get()).val();if(index&&index.supplierId!==supplierId)throw new HttpsError("already-exists","Another supplier already uses this name.");
    const oldIndexId=crypto.createHash("sha256").update(oldKey).digest("hex").slice(0,32),writes={[`suppliers/${supplierId}/name`]:name,[`suppliers/${supplierId}/normalizedName`]:key,[`suppliers/${supplierId}/updatedAt`]:now,[`suppliers/${supplierId}/updatedBy`]:actor.uid,[`supplierNameIndex/${indexId}`]:{supplierId,normalizedName:key,claimedAt:now},[`operationalAudit/${now}_supplier_update_${supplierId}`]:operationalAuditRecord("update_supplier","supplier",supplierId,actor,{beforeName:supplier.name||"",afterName:name})};if(oldIndexId!==indexId)writes[`supplierNameIndex/${oldIndexId}`]=null;await db.ref().update(writes);return{supplierId,name,active:supplier.active!==false};
  },
);

// Period status is a controlled setting, not a client-editable flag. Reopening
// restores purpose-built correction workflows; it never edits posted history.
exports.manageAccountingPeriod = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow"]), data = request.data || {};
    if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only a manager can close or reopen an accounting period.");
    const action = financeText(data.action, 20).toLowerCase(), reason = financeText(data.reason, 300);
    let period;
    try { period = AccountingPeriods.periodKey(data.period); } catch (error) { throw new HttpsError("invalid-argument", error.message); }
    if (!reason) throw new HttpsError("invalid-argument", "A clear reason is required for closing or reopening a period.");
    const now = Date.now(), periodRef = db.ref(`/accountingPeriods/${period}`); let next;
    const result = await periodRef.transaction((current) => {
      try { next = AccountingPeriods.transition(current, action, period, actor, reason, now); return next; } catch (error) { throw error; }
    }, undefined, false);
    if (!result.committed) throw new HttpsError("aborted", "The accounting period changed at the same time. Refresh and try again.");
    const record = result.snapshot.val() || next;
    await db.ref(`/operationalAudit/${now}_accounting_period_${period}_${record.revision || 0}`).set(operationalAuditRecord(action === "close" ? "close_accounting_period" : "reopen_accounting_period", "accountingPeriod", period, actor, {period, status: record.status, reason, revision: record.revision || 0}));
    return {period, status: record.status, revision: record.revision || 0, duplicate: record.status !== (action === "close" ? "closed" : "open")};
  }
);

exports.manageStaffMessage = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalUser(db,request),data=request.data||{},action=financeText(data.action,30),messageId=financeKey(data.messageId,"Message ID"),now=Date.now();
    if(action==="send"){
      const title=financeText(data.title,100),body=financeText(data.body,1000),audience=financeText(data.audience||"all",30).toLowerCase(),priority=financeText(data.priority||"normal",20).toLowerCase()==="urgent"?"urgent":"normal";
      if(!title||!body)throw new HttpsError("invalid-argument","Message title and body are required.");if(!["all","management","cashier","kitchen"].includes(audience))throw new HttpsError("invalid-argument","Select a valid audience.");
      const existing=await db.ref(`/staffMessages/${messageId}`).get();if(existing.exists())return{messageId,duplicate:true};
      const rateRef=db.ref(`/staffMessageRate/${actor.uid}`),rate=await rateRef.transaction((current)=>{const last=Number(current&&current.lastSentAt||0);if(now-last<15000)return;return{lastSentAt:now,messageId};});if(!rate.committed)throw new HttpsError("resource-exhausted","Please wait 15 seconds before sending another message.");
      const record={title,body,audience,priority,ackRequired:data.ackRequired===true,senderUid:actor.uid,senderName:financeText(actor.name||actor.email||actor.role,120),senderRole:actor.role,createdAt:now,expiresAt:now+30*86400000,status:"active",schemaVersion:1};
      await db.ref().update({[`staffMessages/${messageId}`]:record,[`operationalAudit/${now}_staff_message_${messageId}`]:operationalAuditRecord("send_staff_message","staffMessage",messageId,actor,{audience,priority,ackRequired:record.ackRequired})});
      await notifyStaff(db,priority==="urgent"?`🚨 ${title}`:`📨 ${title}`,body.slice(0,180),"/admin.html#tab-inbox",audience);return{messageId,duplicate:false};
    }
    if(!["read","acknowledge"].includes(action))throw new HttpsError("invalid-argument","Staff message action is invalid.");
    const message=(await db.ref(`/staffMessages/${messageId}`).get()).val();if(!message)throw new HttpsError("not-found","Staff message not found.");
    const receiptRef=db.ref(`/staffMessageReceipts/${messageId}/${actor.uid}`);await receiptRef.transaction((current)=>{current=current||{userUid:actor.uid,userName:financeText(actor.name||actor.email||actor.role,120),role:actor.role};if(!current.readAt)current.readAt=now;if(action==="acknowledge"&&!current.acknowledgedAt)current.acknowledgedAt=now;current.updatedAt=now;return current;});
    return{messageId,action};
  },
);

// Phase 14: append-only management incident evidence. No operational or
// financial business node is writable from this callable.
exports.manageIncident = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalUser(db,request),data=request.data||{},action=String(data.action||"").toLowerCase(),now=Date.now();
    if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Incident response is restricted to management accounts.");
    let requestId;try{requestId=IncidentControls.key(data.requestId,"Request ID");}catch(error){throw new HttpsError("invalid-argument",error.message);}
    const claimRef=db.ref(`/incidentCommandClaims/${requestId}`),claimed=await claimRef.transaction(current=>current?undefined:{claimedAt:now,actorUid:actor.uid,action});if(!claimed.committed)return{duplicate:true,requestId,incidentId:String(claimed.snapshot.val()&&claimed.snapshot.val().incidentId||"")};
    try{
      const incidentId=data.incidentId?IncidentControls.key(data.incidentId,"Incident ID"):`inc_${requestId}`;let incident=(await db.ref(`/incidents/${incidentId}`).get()).val(),writes={};
      if(action==="create"){if(incident)return{duplicate:true,requestId,incidentId};try{incident=IncidentControls.normalizeCreate(data,actor,now);}catch(error){throw new HttpsError("invalid-argument",error.message);}writes[`incidents/${incidentId}`]=incident;}
      else{if(!incident)throw new HttpsError("not-found","Incident not found.");if(incident.status==="resolved")throw new HttpsError("failed-precondition","Resolved incidents are immutable.");if(action==="update"){let status;try{status=IncidentControls.nextStatus(incident.status,data.status);}catch(error){throw new HttpsError("failed-precondition",error.message);}writes[`incidents/${incidentId}/status`]=status;writes[`incidents/${incidentId}/updatedAt`]=now;}else if(action==="resolve"){if(incident.financialImpact===true&&incident.createdBy===actor.uid)throw new HttpsError("failed-precondition","A different management reviewer must resolve a financial-impact incident.");let evidence;try{evidence=IncidentControls.resolutionEvidence(data);}catch(error){throw new HttpsError("failed-precondition",error.message);}writes[`incidents/${incidentId}/status`]="resolved";writes[`incidents/${incidentId}/resolvedAt`]=now;writes[`incidents/${incidentId}/resolvedBy`]=actor.uid;writes[`incidents/${incidentId}/resolutionEvidence`]=evidence;writes[`incidents/${incidentId}/updatedAt`]=now;}else throw new HttpsError("invalid-argument","Incident action is invalid.");}
      const note=IncidentControls.text(data.note||data.summary||`${action} incident`,1000),status=action==="create"?"investigating":(action==="resolve"?"resolved":String(data.status||""));writes[`incidents/${incidentId}/timeline/${requestId}`]={action,note,at:now,actorUid:actor.uid,actorRole:actor.role,status};writes[`incidentCommandClaims/${requestId}/incidentId`]=incidentId;writes[`operationalAudit/${now}_incident_${requestId}`]=operationalAuditRecord(`${action}_incident`,"incident",incidentId,actor,{severity:incident&&incident.severity||String(data.severity||""),financialImpact:incident&&incident.financialImpact===true,status,accounting:"Incident evidence only; no order, stock, subledger, Finance movement, or Books journal changed."});await db.ref().update(writes);return{duplicate:false,requestId,incidentId,status};
    }catch(error){await claimRef.remove().catch(()=>{});throw error;}
  },
);

// Release 6A: privacy-safe, bounded operational telemetry. Only aggregate
// counters and timings are stored; no order/customer/payment content is accepted.
const CLIENT_METRICS = new Set(["pos_boot", "pos_build", "cart_render", "charge_to_durable", "offline_flush", "realtime_order_arrival", "module_load", "live_ready"]);
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
    return scanOperationalExceptions(db, Date.now());
  },
);

async function scanOperationalExceptions(db, now) {
    const days = [];for (let offset = 0; offset < 7; offset++) days.push(financeDateFromTimestamp(now - offset * 86400000));
    const [activeSnap, ordersSnap, offlineSnap, custodySnap, inventoryMovementSnap, booksJournalSnap, ...telemetrySnaps] = await Promise.all([db.ref("/activeOrders").limitToLast(250).get(),db.ref("/orders").limitToLast(100).get(),db.ref("/offlinePosSync").orderByChild("updatedAt").limitToLast(100).get(),db.ref("/cashCustody").orderByChild("closedAt").limitToLast(100).get(),db.ref("/inventoryMovements").orderByChild("occurredAt").limitToLast(500).get(),db.ref("/books/journal").get(),...days.map((day) => db.ref(`/clientTelemetryDaily/${day}`).get())]);
    const orders = ordersSnap.val() || {},orderIds=Object.keys(orders).slice(0,100),financialPairs=await Promise.all(orderIds.map(async(id)=>{const snap=await db.ref(`/financialMovements/sale_${id}`).get();return[id,snap.exists()?snap.val():null];}));
    const financialMovements = {},inventoryMovementEvidence={};financialPairs.forEach(([id, value]) => {if (value) financialMovements[`sale_${id}`] = value;});Object.values(inventoryMovementSnap.val()||{}).forEach(m=>{if(m&&m.sourceType==="order"&&m.sourceId)inventoryMovementEvidence[m.sourceId]=true;});const telemetry = {};days.forEach((day, i) => {telemetry[day] = telemetrySnaps[i].val() || {};});
    return OperationalExceptions.buildOperationalExceptions({activeOrders: activeSnap.val() || {}, orders, offlinePosSync: offlineSnap.val() || {}, cashCustody: custodySnap.val() || {}, financialMovements,inventoryMovementEvidence, telemetry, booksJournal: booksJournalSnap.val() || {}}, now);
}

// Phase 16: bounded, read-only production certification snapshot. It does not
// certify the release or mutate operational, inventory, or accounting data.
exports.getProductionCertification = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Production certification is restricted to management accounts.");
    const now=Date.now(),today=financeDateFromTimestamp(now),yesterday=financeDateFromTimestamp(now-86400000),[backup,health,incidents,admins,permissions,todayClose,yesterdayClose,operational]=await Promise.all([db.ref("/systemHealth/backups/latest").get(),db.ref("/systemHealth/productionMonitor/current").get(),db.ref("/incidents").orderByChild("createdAt").limitToLast(100).get(),db.ref("/admins").get(),db.ref("/adminPerms").get(),db.ref(`/financialCloseIndex/${today}`).get(),db.ref(`/financialCloseIndex/${yesterday}`).get(),scanOperationalExceptions(db,now)]);
    return ReleaseCertification.evaluate({backup:backup.val()||{},health:health.val()||{},incidents:incidents.val()||{},admins:admins.val()||{},permissions:permissions.val()||{},closeIndexes:[todayClose.val()||{},yesterdayClose.val()||{}],operational},now);
  },
);

// Phase 17: bounded, read-only production validation. It returns counts and
// control states only; no customer, payment, reservation, review, inventory,
// subledger, Finance, or Books content is returned or changed.
exports.getProductionValidation = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Production validation is restricted to management accounts.");
    const now=Date.now(),today=financeDateFromTimestamp(now),yesterday=financeDateFromTimestamp(now-86400000);
    const [menu,categories,publicStatus,calendar,reviews,payment,orders,backup,health,incidents,admins,permissions,todayClose,yesterdayClose,movements,audits,approvals,operational]=await Promise.all([
      db.ref("/menuItems").get(),db.ref("/categories").get(),db.ref("/publicOrderStatus").get(),db.ref("/calBlocks").get(),db.ref("/reviews").get(),db.ref("/payment").get(),
      db.ref("/orders").limitToLast(25).get(),db.ref("/systemHealth/backups/latest").get(),db.ref("/systemHealth/productionMonitor/current").get(),
      db.ref("/incidents").orderByChild("createdAt").limitToLast(100).get(),db.ref("/admins").get(),db.ref("/adminPerms").get(),db.ref(`/financialCloseIndex/${today}`).get(),db.ref(`/financialCloseIndex/${yesterday}`).get(),db.ref("/financialMovements").limitToLast(100).get(),db.ref("/operationalAudit").limitToLast(100).get(),db.ref("/financialApprovals").limitToLast(100).get(),scanOperationalExceptions(db,now)
    ]);
    const certification=ReleaseCertification.evaluate({backup:backup.val()||{},health:health.val()||{},incidents:incidents.val()||{},admins:admins.val()||{},permissions:permissions.val()||{},closeIndexes:[todayClose.val()||{},yesterdayClose.val()||{}],operational},now);
    const validation=ProductionValidation.evaluate({menuItems:menu.val()||{},categories:categories.val()||{},publicOrderStatus:publicStatus.val()||{},calendarReadable:true,calendarBlockCount:calendar.numChildren(),reviewsReadable:true,reviewCount:reviews.numChildren(),payment:payment.val()||{},orders:orders.val()||{},certification},now);validation.assurance=AssuranceControls.evaluate({movements:movements.val()||{},audits:audits.val()||{},approvals:approvals.val()||{},admins:admins.val()||{},permissions:permissions.val()||{}});return validation;
  },
);

// Restores confirmation metadata only after every expected deterministic
// ingredient movement is proven to exist with the exact quantity. No stock is
// changed by this repair.
exports.repairOrderInventoryMarker = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["inventory"]),orderId=financeKey((request.data||{}).orderId,"Order ID"),order=(await db.ref(`/orders/${orderId}`).get()).val();
    if(!order||!["Completed","Received"].includes(order.status)||order.voided===true)throw new HttpsError("failed-precondition","Only a completed, non-voided order can restore inventory confirmation.");
    if(order.inventoryDeducted===true&&order.inventoryLedgerVersion===1)return{orderId,duplicate:true,items:Object.keys(order.inventoryUsage||{}).length};
    const [recSnap,optSnap,invSnap,miSnap,psSnap,ogSnap,movementSnap]=await Promise.all([db.ref("/recipes").get(),db.ref("/optionRecipes").get(),db.ref("/inventory").get(),db.ref("/menuItems").get(),db.ref("/posSettings").get(),db.ref("/optionGroups").get(),db.ref("/inventoryMovements").orderByKey().startAt(`sale_${orderId}_`).endAt(`sale_${orderId}_\uf8ff`).get()]),recipes=recSnap.val()||{},inventory=invSnap.val()||{},menuItems=miSnap.val()||{},settings=psSnap.val()||{},optionRaw=optSnap.val()||{},optionRecipes={};
    Object.keys(optionRaw).forEach(k=>{const row=optionRaw[k]||{};optionRecipes[row.label||k]=row;});
    const costing=Costing.costOrder({lineItems:order.lineItems||[],recipes,inventory,menuItems,optionCosts:settings.optionCosts||{},optionRecipes,optionGroups:ogSnap.val()||{}});if(!costing.ok)throw new HttpsError("failed-precondition","The saved order recipe no longer produces a valid inventory calculation.");
    const rawUsage=costing.usage||{},usage={};Object.keys(rawUsage).forEach(itemId=>{const quantity=qty6(rawUsage[itemId]);if(Math.abs(quantity)>.000001)usage[itemId]=quantity;});const expectedIds=Object.keys(usage).sort(),movements=movementSnap.val()||{},actualIds=Object.keys(movements).sort();if(!expectedIds.length||expectedIds.length!==actualIds.length)throw new HttpsError("failed-precondition","Order inventory movements are incomplete; no marker was restored.");
    expectedIds.forEach(itemId=>{const movementId=`sale_${orderId}_${itemId}`,movement=movements[movementId],expected=-qty6(usage[itemId]);if(!movement||movement.sourceType!=="order"||movement.sourceId!==orderId||movement.itemId!==itemId||Math.abs(Number(movement.qty)-expected)>.000001)throw new HttpsError("failed-precondition",`Inventory evidence does not match the expected order usage for ${itemId}.`);});
    const invCategories=settings.invCategories||{},cogsCategorySnapshot={food:0,beverage:0,packaging:0,directLabor:0,unallocated:0},cogsAccountSnapshot={};costing.lines.forEach(line=>{const inv=inventory[line.ingredientId]||{},category=invCategories[inv.category]||{},label=String(category.name||inv.category||"").toLowerCase();let bucket="unallocated";if(/packag|cup|lid|straw|napkin|container/.test(label))bucket="packaging";else if(/beverage|drink|coffee|tea|milk|syrup|powder/.test(label))bucket="beverage";else if(/food|ingredient|bakery|kitchen|pastry|meal/.test(label))bucket="food";cogsCategorySnapshot[bucket]+=Number(line.totalCost)||0;const mapping=BooksBridge.itemAccounts(inv),key=mapping.inventory&&mapping.cost?`${mapping.inventory}|${mapping.cost}`:"1290|5090";cogsAccountSnapshot[key]=Financial.money((cogsAccountSnapshot[key]||0)+Number(line.totalCost||0));});Object.keys(cogsCategorySnapshot).forEach(k=>{cogsCategorySnapshot[k]=Math.round(cogsCategorySnapshot[k]*100)/100;});
    const repairedAt=Date.now(),writes={},movementTimes=actualIds.map(id=>Number(movements[id].createdAt||movements[id].occurredAt||0)).filter(Boolean);writes[`orders/${orderId}/inventoryDeducted`]=true;writes[`orders/${orderId}/inventoryUsage`]=usage;writes[`orders/${orderId}/inventoryDeductedAt`]=movementTimes.length?Math.max(...movementTimes):repairedAt;writes[`orders/${orderId}/cogsSnapshot`]=costing.totalCost;writes[`orders/${orderId}/cogsCategorySnapshot`]=cogsCategorySnapshot;writes[`orders/${orderId}/cogsCategorySnapshotVersion`]=1;writes[`orders/${orderId}/cogsAccountSnapshot`]=cogsAccountSnapshot;writes[`orders/${orderId}/cogsAccountSnapshotVersion`]=1;writes[`orders/${orderId}/cogsCovered`]=costing.cogsCovered;writes[`orders/${orderId}/cogsDetail`]={engineVersion:costing.engineVersion,computedAt:repairedAt,totalCost:costing.totalCost,lines:costing.lines,warnings:costing.warnings};writes[`orders/${orderId}/costingEngineVersion`]=costing.engineVersion;writes[`orders/${orderId}/deductedBy`]="server-marker-repair";writes[`orders/${orderId}/inventoryLedgerVersion`]=1;writes[`orders/${orderId}/inventoryMarkerRepairedAt`]=repairedAt;writes[`operationalAudit/${repairedAt}_inventory_marker_${orderId}`]=operationalAuditRecord("repair_order_inventory_marker","order",orderId,actor,{items:expectedIds.length,cogs:costing.totalCost,movementIds:actualIds,accounting:"Restore confirmation metadata from exact existing inventory movements; no stock or Finance movement posted."});await db.ref().update(writes);return{orderId,duplicate:false,items:expectedIds.length,cogs:costing.totalCost};
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
  "validate_payment", "refund", "void", "settle_platform_payout", "reopen_cash_count", "reopen_discrepancy",
  "delete_archived_order", "review_discrepancy", "approve_petty_voucher", "correct_petty_voucher",
  "reject_petty_voucher", "void_petty_voucher", "return_supplier_payment", "manual_discount", "cash_in", "purchase_cash_advance", "fixed_float_exception", "reverse_purchase",
  "rekey_platform_order", "reverse_platform_payout", "correct_platform_presettlement", "set_undeposited_opening_balance", "retire_revolving_fund",
  "repair_closed_shift_turnover", "repair_reversed_payout_deposit", "reconcile_undeposited_custody", "certify_financial_close",
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
    await assertAccountingPeriodOpen(db, financeText(row.date, 10) || financeDateFromTimestamp(Number(row.closedAt || row.ts || row.createdAt || Date.now())), "resolving this Admin cash discrepancy");
    const now = Date.now(); let approval, reviewedBy;
    if(row.kind==="cash"&&Number(data.caseVersion)===2){
      const short=Number(row.variance)<0,totalValue=Financial.money(Math.abs(Number(row.variance)||0)),shiftId=financeKey(row.shiftId,"Shift ID"),raw=Array.isArray(data.allocations)?data.allocations:[],prior=row.resolutionAllocations||{},priorTotal=Financial.money(Object.values(prior).reduce((sum,x)=>sum+Number(x&&x.amount||0),0)),remaining=Financial.money(totalValue-priorTotal),revision=Math.max(0,Math.floor(Number(row.resolutionRevision)||0))+1;
      if(!raw.length||raw.length>20)throw new HttpsError("invalid-argument","Add between one and twenty treatment allocations.");
      const allowed=short?new Set(["cash_recovered","business_expense","supplier_purchase","staff_receivable","owner_draw","counting_error","offset_prior_overage"]):new Set(["customer_refund","unrecorded_sale","capital_contribution","supplier_refund","unrecorded_cash_in","unexplained_overage","counting_error","offset_prior_shortage"]),allocations=[],seen=new Set();let batchTotal=0;
      raw.forEach((x,index)=>{const allocationId=financeKey(x&&x.id||`a${index+1}`,"Allocation ID"),treatment=financeText(x&&x.treatment,50),value=Financial.money(x&&x.amount);if(seen.has(allocationId)||prior[allocationId])throw new HttpsError("already-exists",`Allocation ${allocationId} has already been used.`);if(!allowed.has(treatment))throw new HttpsError("invalid-argument",`Allocation ${index+1} has an invalid treatment.`);if(!(value>0))throw new HttpsError("invalid-argument",`Allocation ${index+1} must be greater than zero.`);seen.add(allocationId);batchTotal=Financial.money(batchTotal+value);allocations.push({id:allocationId,treatment,amount:value,details:x.details||{}});});
      if(batchTotal>remaining+.009)throw new HttpsError("failed-precondition",`Allocations exceed the remaining difference of ${remaining.toFixed(2)}.`);
      const note=financeText(data.note,500);if(!note)throw new HttpsError("invalid-argument","A case explanation is required.");approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}_${revision}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
      const accounts=(await db.ref("/cfAccounts").get()).val()||{},booksChart=await ensureBooksChart(db),movements=(await db.ref("/financialMovements").get()).val()||{},shiftRow=(await db.ref(`/shifts/${shiftId}`).get()).val()||{},purchasePayouts=Array.isArray(shiftRow.payOuts)?shiftRow.payOuts.slice():[],pending=short?"asset:cash_shortage_pending":"liability:cash_overage_pending",legacyMovement=movements[`shift_variance_${shiftId}`]||{},source=legacyMovement.type==="shift_cash_variance"?(short?"expense:cash_shortage":"revenue:cash_overage"):pending,newLines=[],writes=Object.assign({},approval.usedWrites),allocationRecords={},offsetCases={};
      function text(v,n){return financeText(v,n||160);}function cashAccount(destination){if(destination==="undeposited")return"asset:cash_awaiting_deposit";if(destination==="register")return"asset:register_cash";const key=financeKey(destination,"Cash destination");if(!accounts[key]||accounts[key].active===false)throw new HttpsError("failed-precondition","The selected receiving cash account is inactive or missing.");return`asset:cash_account:${key}`;}
      for(const allocation of allocations){const d=allocation.details||{},v=allocation.amount,label=`${short?"Shortage":"Overage"} · ${allocation.treatment}`,record={id:allocation.id,treatment:allocation.treatment,amount:v,details:{},approvedAt:now,approvedBy:reviewedBy,approvalId:approval.id};
        if(allocation.treatment==="cash_recovered"){
          const destination=text(d.destination||"undeposited",160),asset=cashAccount(destination),requested=text(d.correctionMovementId,160),reference=text(d.reference,120);if(!reference)throw new HttpsError("invalid-argument","Recovered cash requires a return, acknowledgement, shift, or manager control reference.");let linked=requested&&movements[requested]?requested:"";
          if(!linked){const matches=Object.keys(movements).filter((mid)=>{const m=movements[mid]||{};if(m.discrepancyAllocationId||m.reversalOf)return false;const cashDelta=Financial.money((m.lines||[]).reduce((s,l)=>s+(l.account===asset?(Number(l.debit)||0)-(Number(l.credit)||0):0),0)),clear=Financial.money((m.lines||[]).reduce((s,l)=>s+([source,"coa:1190"].includes(l.account)?(Number(l.credit)||0)-(Number(l.debit)||0):0),0));return Math.abs(cashDelta-v)<.009&&Math.abs(clear-v)<.009;});if(matches.length===1)linked=matches[0];else if(matches.length>1)throw new HttpsError("failed-precondition","More than one matching recovery journal exists. Select the exact Finance movement.");}
          if(linked){const m=movements[linked],cashDelta=Financial.money((m.lines||[]).reduce((s,l)=>s+(l.account===asset?(Number(l.debit)||0)-(Number(l.credit)||0):0),0)),clear=Financial.money((m.lines||[]).reduce((s,l)=>s+([source,"coa:1190"].includes(l.account)?(Number(l.credit)||0)-(Number(l.debit)||0):0),0));if(Math.abs(cashDelta-v)>.009||Math.abs(clear-v)>.009)throw new HttpsError("failed-precondition","The selected journal does not match the recovery amount, cash destination, and shortage control account.");const linkRef=db.ref(`/financialControlLinks/correctionMovements/${financeKey(linked,"Correction movement ID")}`),claim=await linkRef.transaction((current)=>{if(current&&(current.discrepancyId!==id||current.allocationId!==allocation.id))return;return current||{discrepancyId:id,allocationId:allocation.id,amount:v,linkedAt:now,approvalId:approval.id};},undefined,false);if(!claim.committed)throw new HttpsError("already-exists","The selected journal is already linked to another resolution.");record.correctionMovementId=linked;}else newLines.push(Financial.line(asset,v,0,label),Financial.line(source,0,v,label));
          if(destination==="undeposited"){const custodyId=`cash_recovery_${id}_${allocation.id}`;writes[`cashCustody/${custodyId}`]={shiftId,staff:`Recovered cash · ${text(row.staff,80)||"Manager"}`,amount:v,depositedAmount:0,remaining:v,retainedFloat:0,status:"awaiting_deposit",closedAt:now,movementId:record.correctionMovementId||`cash_difference_${id}_${revision}`,source:"cash_shortage_recovery",reference,discrepancyId:id,allocationId:allocation.id,schemaVersion:3};record.recoveryCustodyId=custodyId;}record.details={destination,date:financeDate(d.date||financeDateFromTimestamp(now)),reference};
        }else if(allocation.treatment==="business_expense"){
          const code=text(d.expenseCode,4),account=booksChart[code];if(!account||account.active===false||account.type!=="Expense"||code==="6110")throw new HttpsError("failed-precondition","Select an active operating-expense account. Cash Short / Over cannot be used as the business-expense category.");const payee=text(d.payee,160),reference=text(d.reference,120),purpose=text(d.purpose,300);if(!payee||!reference||!purpose)throw new HttpsError("invalid-argument","Business expense requires payee, receipt/reference, and business purpose.");newLines.push(Financial.line(`coa:${code}`,v,0,account.name),Financial.line(source,0,v,label));record.details={expenseCode:code,expenseName:account.name,payee,reference,purpose,taxTreatment:text(d.taxTreatment||"none",40)};writes[`cashDifferenceExpenses/${id}/${allocation.id}`]=Object.assign({},record,{date:financeDate(d.date||financeDateFromTimestamp(now)),status:"recorded"});
        }else if(allocation.treatment==="supplier_purchase"){
          const supplier=text(d.supplier,160),purpose=text(d.purpose,300),reference=text(d.reference,120);if(!supplier||!purpose||!reference)throw new HttpsError("invalid-argument","Supplier purchase requires supplier, purchase purpose, and receipt reference.");const advanceId=`variance_purchase_${id}_${allocation.id}`;newLines.push(Financial.line(`asset:purchase_cash_advance:${advanceId}`,v,0,"Supplier payment pending inventory allocation"),Financial.line(source,0,v,label));record.details={supplier,purpose,reference};record.purchaseAdvanceId=advanceId;purchasePayouts.push({id:advanceId,type:"purchase_advance",status:"pending_details",amount:v,remainingAmount:v,recipient:supplier,purpose,reference,reason:`Cash difference purchase · ${purpose}`,approvalId:approval.id,discrepancyId:id,allocationId:allocation.id,ts:now});writes[`cashDifferencePurchaseAdvances/${advanceId}`]=Object.assign({},record,{shiftId,remainingAmount:v,status:"pending_inventory_allocation",createdAt:now});
        }else if(allocation.treatment==="staff_receivable"){
          const staffId=financeKey(d.staffId,"Staff ID");
          const staffRows=(await db.ref("/posStaff").get()).val()||{},staffRow=staffRows[staffId];if(!staffRow)throw new HttpsError("not-found","The selected staff member was not found.");const receivableId=`cash_shortage_${id}_${allocation.id}`;newLines.push(Financial.line(`asset:receivable:${receivableId}`,v,0,"Staff cash shortage receivable"),Financial.line(source,0,v,label));record.details={staffId,staffName:text(staffRow.name||staffRow.email,160),repaymentTerms:text(d.repaymentTerms,240),reference:text(d.reference,120)};record.receivableId=receivableId;writes[`receivables/${receivableId}`]={party:record.details.staffName,type:"staff_cash_shortage",amount:v,remainingAmount:v,date:financeDate(d.date||financeDateFromTimestamp(now)),due:d.due?financeDate(d.due,true):"",ref:record.details.reference||id,status:"open",movementId:`cash_difference_${id}_${revision}`,discrepancyId:id,allocationId:allocation.id,ts:now,createdBy:actor.uid,schemaVersion:2};
        }else if(allocation.treatment==="owner_draw"){
          const owner=text(d.owner,160),reference=text(d.reference,120);if(!owner||!reference)throw new HttpsError("invalid-argument","Owner withdrawal requires the owner and authorization reference.");newLines.push(Financial.line("equity:owner_draw",v,0,"Owner withdrawal"),Financial.line(source,0,v,label));record.details={owner,reference,reason:text(d.reason,300)};
        }else if(allocation.treatment==="customer_refund"){
          const customer=text(d.customer,160),reference=text(d.reference,120);if(!customer||!reference)throw new HttpsError("invalid-argument","Customer refund requires customer/payee and order or receipt reference.");const payableId=`cash_overage_refund_${id}_${allocation.id}`;newLines.push(Financial.line(source,v,0,label),Financial.line(`liability:customer_change_refund:${payableId}`,0,v,"Customer refund due"));record.details={customer,reference,reason:text(d.reason,300)};record.payableId=payableId;writes[`payables/${payableId}`]={party:customer,type:"customer_change_refund",amount:v,remainingAmount:v,paidAmount:0,date:financeDate(d.date||financeDateFromTimestamp(now)),due:"",ref:reference,status:"open",movementId:`cash_difference_${id}_${revision}`,liabilityAccount:`liability:customer_change_refund:${payableId}`,sourceType:"discrepancy",sourceId:id,discrepancyId:id,allocationId:allocation.id,shiftId,approvalId:approval.id,ts:now,createdBy:actor.uid,schemaVersion:2};
        }else if(allocation.treatment==="unrecorded_sale"){
          const orderId=financeKey(d.orderId,"Order ID"),sale=movements[`sale_${orderId}`];if(!sale)throw new HttpsError("failed-precondition","Post or restore the complete sale first so revenue, tax, COGS, and inventory are linked.");const saleCash=Financial.money((sale.lines||[]).reduce((s,l)=>s+(l.account==="asset:register_cash"?(Number(l.debit)||0)-(Number(l.credit)||0):0),0));if(Math.abs(saleCash-v)>.009)throw new HttpsError("failed-precondition","The linked sale cash amount does not match this allocation.");newLines.push(Financial.line(source,v,0,label),Financial.line("asset:register_cash",0,v,"Offset cash already recognized by shift overage"));record.details={orderId};record.sourceMovementId=`sale_${orderId}`;
        }else if(allocation.treatment==="capital_contribution"){
          const owner=text(d.owner,160),reference=text(d.reference,120);if(!owner||!reference)throw new HttpsError("invalid-argument","Capital contribution requires owner and source reference.");newLines.push(Financial.line(source,v,0,label),Financial.line("equity:capital_in",0,v,"Owner capital contribution"));record.details={owner,reference};
        }else if(allocation.treatment==="supplier_refund"){
          const purchaseId=financeKey(d.purchaseId,"Purchase ID"),reference=text(d.reference,120);if(!reference||(await db.ref(`/purchaseInvoices/${purchaseId}`).get()).exists()===false)throw new HttpsError("failed-precondition","Select the original purchase and supplier refund reference.");const code=text(d.offsetCode,4),account=booksChart[code];if(!account||account.active===false||!["Asset","Expense","COGS"].includes(account.type))throw new HttpsError("failed-precondition","Select the original purchase, inventory, or expense account being reduced.");newLines.push(Financial.line(source,v,0,label),Financial.line(`coa:${code}`,0,v,"Supplier refund"));record.details={purchaseId,reference,offsetCode:code};
        }else if(allocation.treatment==="unrecorded_cash_in"){
          const code=text(d.offsetCode,4),account=booksChart[code],reference=text(d.reference,120);if(!account||account.active===false||!["Liability","Equity","Income"].includes(account.type)||!reference)throw new HttpsError("failed-precondition","Select an active liability, equity, or income source account and reference.");newLines.push(Financial.line(source,v,0,label),Financial.line(`coa:${code}`,0,v,account.name));record.details={offsetCode:code,offsetName:account.name,sourceName:text(d.sourceName,160),reference};
        }else if(allocation.treatment==="unexplained_overage"){
          const investigation=text(d.investigation,400);if(!investigation)throw new HttpsError("invalid-argument","Document the investigation before recognizing unexplained overage income.");newLines.push(Financial.line(source,v,0,label),Financial.line("revenue:unexplained_cash_overage",0,v,"Unexplained cash overage"));record.details={investigation};
        }else if(allocation.treatment==="counting_error"){
          const evidence=text(d.evidence,300);if(!evidence)throw new HttpsError("invalid-argument","Counting correction requires recount evidence.");newLines.push(short?Financial.line("asset:register_cash",v,0,"Correct understated cash count"):Financial.line(source,v,0,label),short?Financial.line(source,0,v,label):Financial.line("asset:register_cash",0,v,"Correct overstated cash count"));record.details={evidence,correctedCount:Financial.money(d.correctedCount)};
        }else if(allocation.treatment==="offset_prior_overage"||allocation.treatment==="offset_prior_shortage"){
          if(legacyMovement.type==="shift_cash_variance")throw new HttpsError("failed-precondition","This legacy final variance cannot be offset automatically. Use a documented Finance correction so its original audit trail remains intact.");
          const otherId=financeKey(d.oppositeDiscrepancyId,"Opposite cash variance ID");if(otherId===id||offsetCases[otherId])throw new HttpsError("invalid-argument","Select one different opposite cash variance for each offset allocation.");const other=(await db.ref(`/discrepancies/${otherId}`).get()).val()||{};
          const otherShort=Number(other.variance)<0,expectedOtherShort=!short;if(other.kind!=="cash"||otherShort!==expectedOtherShort||other.status==="reviewed")throw new HttpsError("failed-precondition","The selected opposite cash variance is no longer open and eligible for offset.");
          const otherAllocations=other.resolutionAllocations||{},otherResolved=Financial.money(Object.values(otherAllocations).reduce((sum,x)=>sum+Number(x&&x.amount||0),0)),otherTotal=Financial.money(Math.abs(Number(other.variance)||0)),otherRemaining=Financial.money(otherTotal-otherResolved);if(v>otherRemaining+.009)throw new HttpsError("failed-precondition",`The selected opposite variance has only ${otherRemaining.toFixed(2)} remaining.`);
          newLines.push(short?Financial.line("liability:cash_overage_pending",v,0,"Offset verified cash overage"):Financial.line(source,v,0,"Offset verified cash overage"),short?Financial.line(source,0,v,"Offset verified cash shortage"):Financial.line("asset:cash_shortage_pending",0,v,"Offset verified cash shortage"));record.details={oppositeDiscrepancyId:otherId,oppositeShiftId:text(other.shiftId,160),evidence:text(d.evidence,300)};offsetCases[otherId]={row:other,total:otherTotal,resolved:otherResolved,remaining:otherRemaining,amount:v,allocationId:allocation.id};
        }
        allocationRecords[allocation.id]=record;
      }
      if(purchasePayouts.length!==(Array.isArray(shiftRow.payOuts)?shiftRow.payOuts.length:0))writes[`shifts/${shiftId}/payOuts`]=purchasePayouts;
      const resolvedTotal=Financial.money(priorTotal+batchTotal),caseRemaining=Financial.money(totalValue-resolvedTotal),status=caseRemaining>.009?"partially_resolved":"reviewed",movementId=`cash_difference_${id}_${revision}`;Object.keys(allocationRecords).forEach((key)=>{allocationRecords[key].resolutionMovementId=newLines.length?movementId:null;writes[`cashDifferenceCases/${id}/allocations/${key}`]=allocationRecords[key];writes[`discrepancies/${id}/resolutionAllocations/${key}`]=allocationRecords[key];});Object.assign(writes,{[`cashDifferenceCases/${id}/discrepancyId`]:id,[`cashDifferenceCases/${id}/shiftId`]:shiftId,[`cashDifferenceCases/${id}/kind`]:short?"shortage":"overage",[`cashDifferenceCases/${id}/originalAmount`]:totalValue,[`cashDifferenceCases/${id}/resolvedAmount`]:resolvedTotal,[`cashDifferenceCases/${id}/remainingAmount`]:caseRemaining,[`cashDifferenceCases/${id}/status`]:status,[`cashDifferenceCases/${id}/updatedAt`]:now,[`discrepancies/${id}/status`]:status,[`discrepancies/${id}/financialStatus`]:status,[`discrepancies/${id}/resolvedAmount`]:resolvedTotal,[`discrepancies/${id}/remainingAmount`]:caseRemaining,[`discrepancies/${id}/resolutionRevision`]:revision,[`discrepancies/${id}/reviewedAt`]:status==="reviewed"?now:null,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:status,[`operationalAudit/${now}_${id}_case_${revision}`]:operationalAuditRecord("resolve_cash_difference_case","discrepancy",id,actor,{shiftId,short,originalAmount:totalValue,batchAmount:batchTotal,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,allocationIds:Object.keys(allocationRecords),approvalId:approval.id,movementId:newLines.length?movementId:null,note})});
      Object.keys(offsetCases).forEach((otherId)=>{const other=offsetCases[otherId],nextResolved=Financial.money(other.resolved+other.amount),nextRemaining=Financial.money(other.total-nextResolved),nextStatus=nextRemaining>.009?"partially_resolved":"reviewed",offsetId=`offset_${id}_${other.allocationId}`,otherRecord={id:offsetId,treatment:short?"offset_later_shortage":"offset_later_overage",amount:other.amount,oppositeDiscrepancyId:id,oppositeShiftId:shiftId,approvedAt:now,approvedBy:reviewedBy,approvalId:approval.id,resolutionMovementId:movementId};writes[`cashDifferenceCases/${otherId}/allocations/${offsetId}`]=otherRecord;writes[`cashDifferenceCases/${otherId}/resolvedAmount`]=nextResolved;writes[`cashDifferenceCases/${otherId}/remainingAmount`]=nextRemaining;writes[`cashDifferenceCases/${otherId}/status`]=nextStatus;writes[`cashDifferenceCases/${otherId}/updatedAt`]=now;writes[`discrepancies/${otherId}/resolutionAllocations/${offsetId}`]=otherRecord;writes[`discrepancies/${otherId}/status`]=nextStatus;writes[`discrepancies/${otherId}/financialStatus`]=nextStatus;writes[`discrepancies/${otherId}/resolvedAmount`]=nextResolved;writes[`discrepancies/${otherId}/remainingAmount`]=nextRemaining;writes[`discrepancies/${otherId}/reviewedAt`]=nextStatus==="reviewed"?now:null;writes[`discrepancies/${otherId}/reviewedBy`]=reviewedBy;writes[`discrepancies/${otherId}/reviewApprovalId`]=approval.id;writes[`shifts/${financeKey(other.row.shiftId,"Opposite shift ID")}/varianceStatus`]=nextStatus;});
      if(!newLines.length){assertNoOverlappingUpdatePaths(writes,"cash-difference resolution");await db.ref().update(writes);return{discrepancyId:id,status,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,movementId:null,duplicate:false};}const movement=Financial.movement("cash_difference_case_resolution","discrepancy",id,newLines,{occurredAt:now,actorName:reviewedBy,approvalId:approval.id,shiftId,revision,note,allocationIds:Object.keys(allocationRecords)}),committed=await commitFinancial(db,movementId,movement,actor,writes);return{discrepancyId:id,status,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,movementId,duplicate:committed.duplicate};
    }
    if(row.kind==="cash"){
      const treatment=financeText(data.treatment,40),short=Number(row.variance)<0,value=Financial.money(Math.abs(Number(row.variance)||0)),shiftId=financeKey(row.shiftId,"Shift ID"),movementId=`shift_variance_resolution_${id}`,allowed=short?["cash_recovered_to_undeposited","supplier_payment_pending_allocation","documented_cash_correction","shortage_expense","staff_receivable","owner_draw"]:["customer_change_refund_payable","documented_cash_correction","overage_other_income"];
      if(!allowed.includes(treatment))throw new HttpsError("invalid-argument","Select a valid cash-variance treatment.");
      const pending=short?"asset:cash_shortage_pending":"liability:cash_overage_pending",correctionMovementId=financeText(data.correctionMovementId,160),recipient=financeText(data.recipient,160),purpose=financeText(data.purpose,300),reference=financeText(data.reference,120),originalMovement=(await db.ref(`/financialMovements/shift_variance_${shiftId}`).get()).val()||{},legacyFinal=originalMovement.type==="shift_cash_variance";let lines,target="",advanceId="",payableId="";
      if(treatment==="cash_recovered_to_undeposited"){
        if(!short)throw new HttpsError("failed-precondition","Only a cash shortage can be resolved as physically recovered cash.");
        if(!correctionMovementId)throw new HttpsError("invalid-argument","Select the posted Finance journal that recorded the recovered cash.");
        const correctionKey=financeKey(correctionMovementId,"Correction movement ID"),correction=(await db.ref(`/financialMovements/${correctionKey}`).get()).val();
        if(!correction)throw new HttpsError("not-found","The referenced Finance movement was not found.");
        const totals=Financial.totals(correction.lines||[]),undepositedDelta=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(line.account==="asset:cash_awaiting_deposit"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0)),shortageClearing=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(["asset:cash_shortage_pending","coa:1190"].includes(line.account)?(Number(line.credit)||0)-(Number(line.debit)||0):0),0));
        if(Math.abs(totals.debit-totals.credit)>0.009)throw new HttpsError("failed-precondition","The referenced Finance movement is not balanced.");
        if(Math.abs(undepositedDelta-value)>0.009||Math.abs(shortageClearing-value)>0.009)throw new HttpsError("failed-precondition",`The referenced movement must debit Undeposited Collection and credit Cash Shortage Under Review by exactly ${value.toFixed(2)}.`);
        approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
        const correctionLinkRef=db.ref(`/financialControlLinks/correctionMovements/${correctionKey}`),correctionLinkResult=await correctionLinkRef.transaction((current)=>{if(current&&current.discrepancyId!==id)return;return current||{discrepancyId:id,shiftId,amount:value,approvalId:approval.id,linkedAt:now,linkedBy:reviewedBy};},undefined,false);
        if(!correctionLinkResult.committed)throw new HttpsError("already-exists","That Finance movement is already linked to another discrepancy.");
        const custodyRows=(await db.ref("/cashCustody").get()).val()||{},existingCustodyKey=Object.prototype.hasOwnProperty.call(custodyRows,shiftId)?shiftId:Object.keys(custodyRows).find((key)=>custodyRows[key]&&(custodyRows[key].shiftId===shiftId||custodyRows[key].movementId===`shift_custody_${shiftId}`)),custodyKey=existingCustodyKey||`shortage_recovery_${id}`,custodyRef=db.ref(`/cashCustody/${custodyKey}`);let custodyDuplicate=false,custodyCreated=false;
        const custodyResult=await custodyRef.transaction((current)=>{
          if(!current){custodyCreated=true;current={shiftId,staff:`Recovered cash · ${financeText(row.staff,80)||"Manager"}`,amount:0,depositedAmount:0,remaining:0,retainedFloat:0,status:"awaiting_deposit",closedAt:now,movementId:correctionKey,source:"cash_shortage_recovery",discrepancyId:id,schemaVersion:3};}
          const recoveries=current.recoveries||{};
          if(recoveries[id]){custodyDuplicate=true;return current;}
          const next=Object.assign({},current),nextRecoveries=Object.assign({},recoveries);
          next.amount=Financial.money(Number(current.amount||0)+value);next.remaining=Financial.money(Number(current.remaining||0)+value);next.recoveredAmount=Financial.money(Number(current.recoveredAmount||0)+value);next.status=next.remaining>0?"awaiting_deposit":current.status;next.lastRecoveryAt=now;
          nextRecoveries[id]={amount:value,correctionMovementId:correctionKey,approvalId:approval.id,recoveredAt:now,recoveredBy:reviewedBy,note};next.recoveries=nextRecoveries;return next;
        },undefined,false);
        if(!custodyResult.committed)throw new HttpsError("aborted","The recovered-cash custody record changed during approval. Retry the resolution.");
        const recoveryWrites=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:"reviewed",[`discrepancies/${id}/financialStatus`]:"cash_recovered_to_undeposited",[`discrepancies/${id}/treatment`]:treatment,[`discrepancies/${id}/correctionMovementId`]:correctionKey,[`discrepancies/${id}/recoveryCustodyId`]:custodyKey,[`discrepancies/${id}/reviewedAt`]:now,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewedByUid`]:approval.record.approvedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/resolutionMovementId`]:correctionKey,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:"cash_recovered_to_undeposited",[`shifts/${shiftId}/varianceResolution`]:{treatment,note,correctionMovementId:correctionKey,recoveryCustodyId:custodyKey,approvalId:approval.id,approvedBy:reviewedBy,resolutionMovementId:correctionKey,resolvedAt:now},[`operationalAudit/${now}_${id}_cash_recovered`]:operationalAuditRecord("recover_shift_shortage_to_undeposited","discrepancy",id,actor,{shiftId,amount:value,correctionMovementId:correctionKey,recoveryCustodyId:custodyKey,custodyCreated,approvalId:approval.id,custodyAdjusted:!custodyDuplicate,newFinancialMovement:false,note})});
        await db.ref().update(recoveryWrites);
        return{discrepancyId:id,reviewedAt:now,treatment,movementId:correctionKey,recoveryCustodyId:custodyKey,custodyCreated,duplicate:custodyDuplicate,custodyAdjusted:!custodyDuplicate,financialMovementPosted:false};
      }else if(treatment==="supplier_payment_pending_allocation"){
        if(!recipient||!purpose||!reference)throw new HttpsError("invalid-argument","Supplier/payee, purchase purpose, and receipt reference are required.");advanceId=`variance_purchase_${shiftId}`;const source=legacyFinal?"expense:cash_shortage":pending;lines=[Financial.line(`asset:purchase_cash_advance:${advanceId}`,value,0,"Supplier payment pending inventory allocation"),Financial.line(source,0,value,"Clear supplier-funded cash shortage")];
      }else if(treatment==="customer_change_refund_payable"){
        if(!recipient||!reference)throw new HttpsError("invalid-argument","Customer/payee and order, receipt, or customer reference are required.");payableId=`change_refund_${shiftId}`;const source=legacyFinal?"revenue:cash_overage":pending;lines=[Financial.line(source,value,0,"Reclassify customer cash overage"),Financial.line(`liability:customer_change_refund:${payableId}`,0,value,"Customer change or refund due")];
      }else if(treatment==="documented_cash_correction"){
        if(!correctionMovementId)throw new HttpsError("invalid-argument","The posted purchase, sale, refund, or cash-movement reference is required.");const correction=(await db.ref(`/financialMovements/${financeKey(correctionMovementId,"Correction movement ID")}`).get()).val();if(!correction)throw new HttpsError("not-found","The referenced Finance movement was not found.");const registerDelta=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(line.account==="asset:register_cash"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0)),required=short?-value:value;if(Math.abs(registerDelta-required)>0.009)throw new HttpsError("failed-precondition",`The referenced movement must ${short?"reduce":"increase"} Register Cash by exactly ${value.toFixed(2)}.`);const source=legacyFinal?(short?"expense:cash_shortage":"revenue:cash_overage"):pending;lines=short?[Financial.line("asset:register_cash",value,0,"Clear documented cash shortage"),Financial.line(source,0,value,"Clear documented cash shortage")]:[Financial.line(source,value,0,"Clear documented cash overage"),Financial.line("asset:register_cash",0,value,"Clear documented cash overage")];
      }else{target=treatment==="shortage_expense"?"expense:cash_shortage":treatment==="staff_receivable"?`asset:receivable:shift_${shiftId}`:treatment==="owner_draw"?"equity:owner_draw":"revenue:unexplained_cash_overage";const label=`Resolve ${short?"cash shortage":"cash overage"} · ${note}`;if(legacyFinal&&short&&treatment==="shortage_expense")lines=[];else{const source=legacyFinal?(short?"expense:cash_shortage":"revenue:cash_overage"):pending;lines=short?[Financial.line(target,value,0,label),Financial.line(source,0,value,label)]:[Financial.line(source,value,0,label),Financial.line(target,0,value,label)];}}
      approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;const financialStatus=treatment==="supplier_payment_pending_allocation"?"awaiting_inventory_allocation":treatment==="customer_change_refund_payable"?"awaiting_customer_refund":"resolved",writes=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:"reviewed",[`discrepancies/${id}/financialStatus`]:financialStatus,[`discrepancies/${id}/treatment`]:treatment,[`discrepancies/${id}/correctionMovementId`]:correctionMovementId||null,[`discrepancies/${id}/purchaseAdvanceId`]:advanceId||null,[`discrepancies/${id}/customerRefundPayableId`]:payableId||null,[`discrepancies/${id}/reviewedAt`]:now,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewedByUid`]:approval.record.approvedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/resolutionMovementId`]:movementId,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:financialStatus,[`shifts/${shiftId}/varianceResolution`]:{treatment,note,correctionMovementId:correctionMovementId||null,purchaseAdvanceId:advanceId||null,customerRefundPayableId:payableId||null,approvalId:approval.id,approvedBy:reviewedBy,resolutionMovementId:movementId,resolvedAt:now}});if(advanceId){const shift=(await db.ref(`/shifts/${shiftId}`).get()).val()||{},payOuts=Array.isArray(shift.payOuts)?shift.payOuts:[];writes[`shifts/${shiftId}/payOuts/${payOuts.length}`]={id:advanceId,type:"purchase_advance",status:"pending_details",amount:value,remainingAmount:value,recipient,purpose,reference,reason:`Emergency supplier payment — ${purpose}`,by:reviewedBy,approvalId:approval.id,ts:now,source:"closed_shift_variance"};}if(payableId){writes[`payables/${payableId}`]={party:recipient,type:"customer_change_refund",amount:value,remainingAmount:value,paidAmount:0,date:financeDate(row.date||new Date(now).toISOString().slice(0,10)),due:"",ref:reference,status:"open",movementId,liabilityAccount:`liability:customer_change_refund:${payableId}`,reversalOffsetAccount:pending,sourceType:"discrepancy",sourceId:id,discrepancyId:id,shiftId,approvalId:approval.id,ts:now,createdBy:actor.uid,schemaVersion:2};}
      if(!lines.length){writes[`discrepancies/${id}/resolutionMovementId`]=null;writes[`shifts/${shiftId}/varianceResolution/resolutionMovementId`]=null;await db.ref().update(writes);return{discrepancyId:id,reviewedAt:now,treatment,movementId:null,duplicate:false,legacyAlreadyPosted:true};}const committed=await commitFinancial(db,movementId,Financial.movement("shift_cash_variance_resolution","discrepancy",id,lines,{occurredAt:now,actorName:reviewedBy,approvalId:approval.id,treatment,shiftId,controlReason:note,legacyFinal}),actor,writes);return{discrepancyId:id,reviewedAt:now,treatment,movementId,duplicate:committed.duplicate};
    }
    approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
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

// Reviewed discrepancy records are never a dead end. They may be reopened
// only when nothing downstream has been posted; otherwise the caller is told
// to reverse the exact linked treatment first. The original event is retained.
exports.reopenDiscrepancy = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["discrepancy","registerOps"]),data=request.data||{},id=financeKey(data.discrepancyId,"Discrepancy ID"),reason=financeText(data.reason,500),ref=db.ref(`/discrepancies/${id}`),snap=await ref.get();
    if(!reason)throw new HttpsError("invalid-argument","Explain why this reviewed record must be corrected.");
    if(!snap.exists())throw new HttpsError("not-found","Discrepancy record not found.");
    const row=snap.val()||{};if(row.status!=="reviewed")throw new HttpsError("failed-precondition","Only a reviewed discrepancy can be corrected from this workflow.");
    const isCash=row.kind==="cash",shiftId=isCash?financeKey(row.shiftId,"Shift ID"):"",[caseSnap,linksSnap,originalSnap]=await Promise.all([isCash?db.ref(`/cashDifferenceCases/${id}`).get():Promise.resolve({val:()=>({})}),db.ref("/financialControlLinks/correctionMovements").get(),isCash?db.ref(`/financialMovements/shift_variance_${shiftId}`).get():Promise.resolve({exists:()=>true})]);
    if(isCash&&!originalSnap.exists())throw new HttpsError("failed-precondition","The original cash-variance posting is missing. Use the Finance correction workflow instead.");
    const caseRow=caseSnap.val()||{},allocations=Object.assign({},row.resolutionAllocations||{},caseRow.allocations||{}),controlLinks=linksSnap.val()||{},linkedEntries=Object.entries(controlLinks).filter(([,link])=>link&&link.discrepancyId===id),linked=linkedEntries.length>0,linkedIds=[row.resolutionMovementId,row.correctionMovementId,row.recoveryCustodyId,row.customerRefundPayableId,row.purchaseAdvanceId,...linkedEntries.map(([key,link])=>link.movementId||link.correctionMovementId||link.id||key)].filter(Boolean).map(String),hasTreatment=linked||linkedIds.length>0||Object.keys(allocations).length>0;
    if(hasTreatment){const labels=[...new Set(linkedIds)].slice(0,4);throw new HttpsError("failed-precondition",`This record has linked Finance treatment${labels.length?`: ${labels.join(", ")}`:" or settlement"}. Reverse that linked treatment first, then return here to correct the original record. Its audit trail remains intact.`);}
    const amount=isCash?Financial.money(Math.abs(Number(row.variance)||0)):null,approval=await claimManagerApproval(db,data,"reopen_discrepancy",id,amount,`reopen_discrepancy_${id}`),now=Date.now(),revision=Math.max(0,Math.floor(Number(row.reopenRevision)||0))+1,approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,history={revision,reopenedAt:now,reopenedBy:approvedBy,reopenedByUid:approval.record.approvedBy,approvalId:approval.id,reason,originalStatus:row.status,originalTreatment:row.treatment||"",originalNote:row.note||"",originalMovementId:isCash?`shift_variance_${shiftId}`:""};
    const status=isCash?"pending_manager_reconciliation":"open",writes=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:status,[`discrepancies/${id}/financialStatus`]:isCash?status:(row.financialStatus||"pending_manager_review"),[`discrepancies/${id}/reviewedAt`]:null,[`discrepancies/${id}/reopenedAt`]:now,[`discrepancies/${id}/reopenedBy`]:approvedBy,[`discrepancies/${id}/reopenRevision`]:revision,[`discrepancies/${id}/reopenHistory/${revision}`]:history,[`operationalAudit/${now}_${id}_reopen_discrepancy`]:operationalAuditRecord("reopen_discrepancy","discrepancy",id,actor,{amount,approvalId:approval.id,reason,originalMovementId:history.originalMovementId,accounting:isCash?"No Finance entry is posted on reopen. The original variance stays in its control account until a new approved treatment is selected.":"No inventory or Finance entry is posted on reopen. The original discrepancy stays in the audit trail until it is reviewed again."})});
    if(isCash)Object.assign(writes,{[`cashDifferenceCases/${id}/status`]:status,[`cashDifferenceCases/${id}/resolvedAmount`]:0,[`cashDifferenceCases/${id}/remainingAmount`]:amount,[`cashDifferenceCases/${id}/updatedAt`]:now,[`cashDifferenceCases/${id}/reopenHistory/${revision}`]:history,[`shifts/${shiftId}/varianceStatus`]:status});
    await db.ref().update(writes);return{discrepancyId:id,status,amount,reopenRevision:revision,duplicate:false};
  },
);

exports.managePettyVoucher = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty"]);
    const data = request.data || {}, action = financeText(data.action, 20), id = financeKey(data.voucherId, "Voucher ID"), reason = financeText(data.reason, 500);
    const ref = db.ref(`/pettyCashVouchers/${id}`), snap = await ref.get(); if (!snap.exists()) throw new HttpsError("not-found", "Revolving Fund voucher not found.");
    const voucher = snap.val() || {}, value = Financial.money(voucher.amount), now = Date.now(); let approvalAction;
    // Editing a voucher changes the Admin subledger as well as its linked
    // Finance correction, so the voucher's own accounting month must be open.
    if (["correct", "approve"].includes(action)) await assertAccountingPeriodOpen(db, action === "correct" && voucher.status === "pending" ? financeDate(data.date) : (financeText(voucher.date, 10) || financeDateFromTimestamp(now)), "editing or approving this Admin cash payment");
    if (action === "correct") {
      if (!["pending", "approved"].includes(voucher.status) || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active pending or approved cash payment can be edited.");
      if (voucher.returnedAt) throw new HttpsError("failed-precondition", "A returned supplier payment cannot be edited. Record a new correcting payment instead.");
      const nextAmount = Financial.money(data.amount), nextPurpose = financeText(data.purpose, 300), nextApprover = financeText(data.approverName, 160), reason = financeText(data.reason, 500), type = financeText(voucher.transactionType, 40) || "expense", selectedSupplier=type==="purchase_advance"?await requireActiveSupplier(db,data.supplierId,data.payee):null,nextPayee=selectedSupplier?selectedSupplier.name:financeText(data.payee,160),nextSupplierId=selectedSupplier?selectedSupplier.id:"";
      if (!(nextAmount > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero.");
      if (!nextPayee) throw new HttpsError("invalid-argument", "Requester or supplier payee is required.");
      if (!voucher.receiptImg && !nextPurpose) throw new HttpsError("invalid-argument", "A receipt or clear explanation is required.");
      if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
      const expenseCategories = new Set(["operating_supplies","office_supplies","utilities","internet_phone","marketing","repairs","bank_fees","rent","salaries","transport","staff_meals","miscellaneous","other_expense"]), nextCategory = type === "purchase_advance" ? "Supplier payment pending inventory allocation" : type === "owner_withdrawal" ? "owner_draw" : financeText(data.category, 80);
      if (type === "expense" && !expenseCategories.has(nextCategory)) throw new HttpsError("invalid-argument", "Expense category is invalid.");
      const allocated = Financial.money(Object.values(voucher.allocations || {}).reduce((sum, row) => sum + Number(row && row.amount || 0), 0));
      if (type === "purchase_advance" && allocated > 0 && financeText(voucher.supplierId,160) !== nextSupplierId) throw new HttpsError("failed-precondition", "Reverse every linked inventory purchase before changing the supplier on this payment.");
      if (type === "purchase_advance" && nextAmount + 0.009 < allocated) throw new HttpsError("failed-precondition", `Amount cannot be below the ${allocated.toFixed(2)} already allocated to inventory purchases.`);
      const nextDate = voucher.status === "pending" ? financeDate(data.date) : financeText(voucher.date, 10), before = {date:financeText(voucher.date,10),amount:value,category:financeText(voucher.category,80),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),approverName:financeText(voucher.approverName,160)}, after = {date:nextDate,amount:nextAmount,category:nextCategory,payee:nextPayee,purpose:nextPurpose,approverName:nextApprover};
      const revision = Math.max(0, Math.floor(Number(voucher.correctionRevision)||0)) + 1, writes = {[`pettyCashVouchers/${id}/date`]:nextDate,[`pettyCashVouchers/${id}/amount`]:nextAmount,[`pettyCashVouchers/${id}/category`]:nextCategory,[`pettyCashVouchers/${id}/supplierId`]:nextSupplierId,[`pettyCashVouchers/${id}/supplierName`]:type==="purchase_advance"?nextPayee:"",[`pettyCashVouchers/${id}/requesterName`]:nextPayee,[`pettyCashVouchers/${id}/recipient`]:nextPayee,[`pettyCashVouchers/${id}/purpose`]:nextPurpose,[`pettyCashVouchers/${id}/approverName`]:nextApprover,[`pettyCashVouchers/${id}/correctionRevision`]:revision,[`pettyCashVouchers/${id}/lastCorrectedAt`]:now,[`pettyCashVouchers/${id}/lastCorrectionReason`]:reason};
      if (type === "purchase_advance") {writes[`pettyCashVouchers/${id}/allocatedAmount`]=allocated;writes[`pettyCashVouchers/${id}/remainingAmount`]=Financial.money(nextAmount-allocated);writes[`pettyCashVouchers/${id}/allocationStatus`]=allocated>0?(nextAmount-allocated>0?"partially_allocated":"fully_allocated"):"unallocated";}
      if (voucher.status === "pending") {writes[`operationalAudit/${now}_${id}_correct_${revision}`]=operationalAuditRecord("correct_pending_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision});await db.ref().update(writes);return {voucherId:id,action,revision,pending:true};}
      const approval = await claimManagerApproval(db,data,"correct_petty_voucher",id,nextAmount,`correct_petty_voucher_${id}_${revision}`), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, oldPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:voucher.recipient||"Supplier payment pending allocation"} : revolvingFundPosting(voucher), nextVoucher = Object.assign({},voucher,{amount:nextAmount,category:nextCategory,recipient:nextPayee,requesterName:nextPayee,purpose:nextPurpose,approverName:nextApprover}), nextPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:nextPayee} : revolvingFundPosting(nextVoucher), delta = Financial.money(nextAmount-value), correctionId = `petty_correct_${id}_${revision}`, funding = type === "purchase_advance" ? advanceFundingAccount(voucher) : {kind:"undeposited",account:"asset:cash_awaiting_deposit"};
      let custodyWrites = {}; if (funding.kind === "undeposited") { if (delta > 0) {const custodyOut=await poolCustodyOutflow(db,delta);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`The increase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);custodyWrites=custodyOut.writes;} else if (delta < 0) custodyWrites = poolCustodyInflowRecord(correctionId,-delta,"Cash payment correction returned",now,correctionId); }
      const movement = Financial.movement("petty_cash_payment_correction","pettyVoucher",id,[Financial.line(funding.account,value,0,"Reverse previous cash payment"),Financial.line(oldPosting.account,0,value,"Reverse "+oldPosting.label),Financial.line(nextPosting.account,nextAmount,0,nextPosting.label),Financial.line(funding.account,0,nextAmount,"Corrected cash payment")],{occurredAt:now,actorName:approvedBy,approvalId:approval.id,voucherNo:financeText(voucher.voucherNo,60),category:nextCategory,payee:nextPayee,purpose:nextPurpose,correctionRevision:revision,correctionReason:reason});
      Object.assign(writes,approval.usedWrites,custodyWrites,{[`pettyCashVouchers/${id}/lastCorrectedBy`]:approvedBy,[`pettyCashVouchers/${id}/lastCorrectionApprovalId`]:approval.id,[`pettyCashVouchers/${id}/correctionMovementIds/${revision}`]:correctionId,[`operationalAudit/${now}_${id}_correct_${revision}`]:operationalAuditRecord("correct_approved_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision,approvalId:approval.id,movementId:correctionId})});
      const committed = await commitFinancial(db,correctionId,movement,actor,writes);return {voucherId:id,action,revision,movementId:correctionId,duplicate:committed.duplicate};
    }
    if (action === "return") {if(voucher.transactionType!=="purchase_advance"||voucher.status!=="approved"||voucher.voided===true)throw new HttpsError("failed-precondition","Only an active supplier payment can be returned.");const remaining=Financial.money(voucher.remainingAmount!=null?voucher.remainingAmount:value);if(!(remaining>0))throw new HttpsError("failed-precondition","This supplier payment has no unallocated balance to return.");if(!reason)throw new HttpsError("invalid-argument","A return reason is required.");const funding=advanceFundingAccount(voucher),approval=await claimManagerApproval(db,data,"return_supplier_payment",id,remaining,`return_supplier_payment_${id}`),movementId=`petty_return_${id}`,movement=Financial.movement("revolving_fund_supplier_payment_return","pettyVoucher",id,[Financial.line(funding.account,remaining,0,funding.kind==="undeposited"?"Returned to Undeposited Collection":"Returned to selected cash account"),Financial.line(`asset:purchase_cash_advance:${id}`,0,remaining,"Clear unallocated supplier payment")],{occurredAt:now,actorName:approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,approvalId:approval.id}),writes=Object.assign({},approval.usedWrites,funding.kind==="undeposited"?poolCustodyInflowRecord(`petty_return_${id}`,remaining,"Supplier payment returned",now,`petty_return_${id}`):{},{[`pettyCashVouchers/${id}/remainingAmount`]:0,[`pettyCashVouchers/${id}/allocationStatus`]:(Number(voucher.allocatedAmount)||0)>0?"partially_allocated_returned":"returned_unallocated",[`pettyCashVouchers/${id}/returnedAmount`]:remaining,[`pettyCashVouchers/${id}/returnedAt`]:now,[`pettyCashVouchers/${id}/returnReason`]:reason,[`pettyCashVouchers/${id}/returnApprovalId`]:approval.id,[`operationalAudit/${now}_${id}_return`]:operationalAuditRecord("return_supplier_payment","pettyVoucher",id,actor,{approvalId:approval.id,amount:remaining,reason})});const committed=await commitFinancial(db,movementId,movement,actor,writes);return {voucherId:id,action,amount:remaining,duplicate:committed.duplicate};}
    if (action === "approve") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be approved.");
      if (voucher.transactionType === "purchase_advance") await requireActiveSupplier(db,voucher.supplierId,voucher.supplierName||voucher.recipient);
      if (voucher.transactionType === "purchase_advance") {
        const fundingAccountId = financeText(voucher.fundingAccountId, 120) || "undeposited", fundingValue = Financial.money(voucher.amount);
        if (["register", "cash_float"].includes(fundingAccountId)) throw new HttpsError("failed-precondition", "Register Cash is retired and Cash Float is controlled. Select Undeposited Collection, Cash on Hand, or an active bank/cash account.");
        if (fundingAccountId === "cash_on_hand") {
          const cash = await availableCashOnHandAboveFloat(db);
          if (fundingValue > cash.available + 0.009) throw new HttpsError("failed-precondition", `This payment exceeds available Cash on Hand by ${Financial.money(fundingValue - cash.available).toFixed(2)}. The protected Register Cash Float of ${cash.float.toFixed(2)} cannot be used.`);
        } else if (fundingAccountId === "undeposited") {
          const custodyPreview = await poolCustodyOutflow(db, fundingValue);
          if (custodyPreview.shortfall > 0.009) throw new HttpsError("failed-precondition", `This payment exceeds available Undeposited Collection by ${custodyPreview.shortfall.toFixed(2)}.`);
        } else {
          const fundingAccounts = (await db.ref("/cfAccounts").get()).val() || {};
          accountIdFor(fundingAccounts, fundingAccountId);
        }
      }
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
    const approvalFunding = action === "approve" && voucher.transactionType === "purchase_advance" ? advanceFundingAccount(voucher) : {kind:"undeposited"};
    let baseFunds = 0;
    if (action === "approve" && approvalFunding.kind === "undeposited") {
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
        if (!current.receiptImg && !financeText(current.purpose, 300)) {failure = "A receipt or clear explanation is required before approval."; return;}
        if (approvalFunding.kind === "undeposited") {const available = Financial.money(baseFunds);if (value > available + 0.009) {failure = `Voucher exceeds available Undeposited Collection (₱${available.toFixed(2)}).`; return;}}
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

exports.getUndepositedControlSnapshot = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["petty","cashflow"]);
    const [movementSnap,voucherSnap]=await Promise.all([db.ref("/financialMovements").get(),db.ref("/pettyCashVouchers").get()]);
    const movementMap=movementSnap.val()||{},voucherMap=voucherSnap.val()||{};let undeposited=0,revolving=0;const postedVoucherIds={};
    Object.keys(movementMap).forEach((id)=>{const movement=movementMap[id]||{};(movement.lines||[]).forEach((line)=>{const net=Financial.money((Number(line.debit)||0)-(Number(line.credit)||0));if(line.account==="asset:cash_awaiting_deposit")undeposited=Financial.money(undeposited+net);if(line.account==="asset:petty_cash")revolving=Financial.money(revolving+net);});if(movement.sourceType==="pettyVoucher"&&movement.sourceId)postedVoucherIds[String(movement.sourceId)]=id;});
    const missingApproved=[];Object.keys(voucherMap).forEach((id)=>{const voucher=voucherMap[id]||{};if(voucher.status==="approved"&&voucher.voided!==true&&!postedVoucherIds[id])missingApproved.push(id);});
    return{undepositedBalance:undeposited,revolvingBalance:revolving,postedVoucherIds,missingApprovedVoucherIds:missingApproved,retirementPosted:movementSnap.child("revolving_fund_retirement").exists(),calculatedAt:Date.now(),authority:"server_all_time"};
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

// Links a historical Finance journal that increased Undeposited Collection
// without creating the matching physical-cash custody record. This repairs
// only the subledger: the existing balanced journal remains the sole GL entry.
exports.reconcileUndepositedCustody = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["cashflow","registerOps"]),data=request.data||{},movementId=financeKey(data.movementId,"Finance movement ID"),now=Date.now();
    const [movementSnap,movementsSnap,custodySnap,linkSnap]=await Promise.all([db.ref(`/financialMovements/${movementId}`).get(),db.ref("/financialMovements").get(),db.ref("/cashCustody").get(),db.ref(`/financialControlLinks/custodyRepairs/${movementId}`).get()]);
    if(linkSnap.exists())return{movementId,amount:Financial.money(linkSnap.val().amount),duplicate:true,preview:data.preview===true};
    const movement=movementSnap.val(),allMovements=movementsSnap.val()||{},custodyRows=custodySnap.val()||{};
    if(!movement||!Array.isArray(movement.lines)||movement.reversalOf||movement.reversedByMovementId)throw new HttpsError("failed-precondition","Select an active balanced Finance journal.");
    const totals=Financial.totals(movement.lines),amount=Financial.money(movement.lines.reduce((sum,line)=>sum+(line.account==="asset:cash_awaiting_deposit"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0));
    if(Math.abs(totals.debit-totals.credit)>.009||!(amount>0))throw new HttpsError("failed-precondition","The selected journal must be balanced and must increase Undeposited Collection.");
    if(Object.values(custodyRows).some((row)=>row&&row.movementId===movementId))throw new HttpsError("already-exists","This Finance journal already has a cash custody record.");
    let pool=0;Object.values(allMovements).forEach((m)=>{if(!m||!Array.isArray(m.lines))return;m.lines.forEach((line)=>{if(line.account==="asset:cash_awaiting_deposit")pool=Financial.money(pool+Number(line.debit||0)-Number(line.credit||0));});});
    const custodyRemaining=Financial.money(Object.values(custodyRows).reduce((sum,row)=>sum+Number(row&&row.remaining||0),0)),difference=Financial.money(pool-custodyRemaining);
    if(!(difference>0)||Math.abs(difference-amount)>.009)throw new HttpsError("failed-precondition",`The selected journal is ${amount.toFixed(2)}, but the current ledger-to-custody difference is ${difference.toFixed(2)}. Select the exact journal that caused the difference.`);
    if(data.preview===true)return{movementId,amount,difference,memo:financeText(movement.memo||movement.reference||movement.sourceId,200),occurredAt:Number(movement.occurredAt||movement.postedAt||0),preview:true,duplicate:false};
    const reason=financeText(data.reason,500);if(!reason)throw new HttpsError("invalid-argument","Explain why this existing journal represents physical cash awaiting deposit.");
    const approval=await claimManagerApproval(db,data,"reconcile_undeposited_custody",movementId,amount,`reconcile_undeposited_custody_${movementId}`),approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,custodyId=`journal_custody_${movementId}`,occurredAt=Number(movement.occurredAt||movement.postedAt||now);
    const writes=Object.assign({},approval.usedWrites,{[`cashCustody/${custodyId}`]:{shiftId:custodyId,staff:`Finance journal recovery · ${approvedBy}`,amount,depositedAmount:0,remaining:amount,retainedFloat:0,status:"awaiting_deposit",closedAt:occurredAt,movementId,source:"historical_finance_journal_custody_reconciliation",reference:financeText(movement.reference||movement.sourceId,120),createdAt:now,createdBy:actor.uid,approvalId:approval.id,schemaVersion:3},[`financialControlLinks/custodyRepairs/${movementId}`]:{movementId,custodyId,amount,reason,linkedAt:now,linkedBy:actor.uid,approvedBy,approvalId:approval.id,schemaVersion:1},[`operationalAudit/${now}_${movementId}_custody_reconcile`]:operationalAuditRecord("reconcile_undeposited_custody","booksManualJournal",movementId,actor,{amount,custodyId,reason,approvalId:approval.id,approvedBy,newFinancialMovement:false,expectedDifferenceAfter:0})});
    await db.ref().update(writes);return{movementId,custodyId,amount,differenceBefore:difference,differenceAfter:0,duplicate:false,repaired:true,newFinancialMovement:false};
  },
);

// One-time, date-bounded cutover: clears historical variance-control balances
// without deleting source history. Later discrepancies remain operationally open.
exports.legacyOwnerCapitalReset = onCall({region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"}, async (request) => {
  const db=getDatabase(),actor=await requirePortalPermission(db,request,["cashflow","discrepancy"]),data=request.data||{},cutoffDate=financeDate(data.cutoffDate||data.date||financeDateFromTimestamp(Date.now())),date=financeDate(data.date||cutoffDate),reason=financeText(data.reason,500),id=`legacy_owner_capital_reset_v5_${cutoffDate}`;
  if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Only a manager may run the legacy financial reset.");
  if(cutoffDate>"2026-08-29"||date>"2026-08-29")throw new HttpsError("failed-precondition","The legacy close is limited to August 29, 2026 or earlier so August 30 and later activity remains operationally visible.");
  const [journalSnap,discrepancySnap,existingSnap]=await Promise.all([db.ref("/books/journal").get(),db.ref("/discrepancies").get(),db.ref(`/financialMovements/${id}`).get()]);
  const normal={"4990":"credit","6110":"debit","1190":"debit","2100":"credit"},balances={"4990":0,"6110":0,"1190":0,"2100":0};
  const journal=journalSnap.val()||{},journalById=new Map(Object.entries(journal).map(([key,value])=>[key,Object.assign({id:key},value||{})]));
  Object.values(journal).forEach((entry)=>{if(!entry)return;const entryDate=String(entry.date||financeDateFromTimestamp(entry.occurredAt||entry.postedAt||0)).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||entryDate>cutoffDate)return;(entry.lines||[]).forEach((line)=>{const code=String(line.code||"");if(!Object.prototype.hasOwnProperty.call(balances,code))return;balances[code]=Financial.money(balances[code]+(normal[code]==="debit"?(Number(line.debit)||0)-(Number(line.credit)||0):(Number(line.credit)||0)-(Number(line.debit)||0)));});});
  // A reversal posted in August for an original dated before August is zero
  // all-time, but leaves a misleading negative August expense. Reclass only
  // those linked reversal lines to opening equity; genuine August expenses
  // are deliberately excluded.
  const augustStart="2026-08-01",crossPeriodReversals={"6100":0,"6110":0},crossPeriodSources=[];
  Object.entries(journal).forEach(([key,entry])=>{if(!entry)return;const entryDate=String(entry.date||financeDateFromTimestamp(entry.occurredAt||entry.postedAt||0)).slice(0,10);if(entryDate<augustStart||entryDate>cutoffDate)return;(entry.lines||[]).forEach((line)=>{const code=String(line.code||"");if(!Object.prototype.hasOwnProperty.call(crossPeriodReversals,code))return;crossPeriodReversals[code]=Financial.money(crossPeriodReversals[code]+(Number(line.debit)||0)-(Number(line.credit)||0));});if(entry.reversalOf){const original=journalById.get(String(entry.reversalOf)),originalDate=String(original&&(original.date||financeDateFromTimestamp(original.occurredAt||original.postedAt||0))||"").slice(0,10);if(originalDate&&originalDate<augustStart)crossPeriodSources.push({reversalId:key,originalId:String(entry.reversalOf),reversalDate:entryDate,originalDate});}});
  const lines=[];Object.keys(balances).forEach((code)=>{const value=Financial.money(balances[code]);if(Math.abs(value)<.005)return;if(value>0){lines.push(Financial.line(`coa:${code}`,normal[code]==="debit"?0:value,normal[code]==="debit"?value:0,"Legacy cutover"));lines.push(Financial.line("equity:owner_capital",normal[code]==="debit"?value:0,normal[code]==="debit"?0:value,"Legacy cutover"));}else{const v=Math.abs(value);lines.push(Financial.line(`coa:${code}`,normal[code]==="debit"?v:0,normal[code]==="debit"?0:v,"Legacy cutover"));lines.push(Financial.line("equity:owner_capital",normal[code]==="debit"?0:v,normal[code]==="debit"?v:0,"Legacy cutover"));}});
  Object.keys(crossPeriodReversals).forEach((code)=>{const net=Financial.money(crossPeriodReversals[code]);if(net>=-0.005)return;const value=Math.abs(net);lines.push(Financial.line(`coa:${code}`,value,0,"Close remaining negative August legacy expense activity"));lines.push(Financial.line("equity:owner_capital",0,value,"Negative legacy expense activity reclassified to opening equity"));});
  const protectedDate="2026-08-30",protectedShortage=120,protectedDiscrepancies=[],affected=Object.entries(discrepancySnap.val()||{}).filter(([key,row])=>{if(!row||row.status==="legacy_closed")return false;const rowDate=String(row.date||financeDateFromTimestamp(row.closedAt||row.ts||row.createdAt||0)).slice(0,10),isProtected=rowDate===protectedDate&&Number(row.variance)<0&&Math.abs(Math.abs(Number(row.variance))-protectedShortage)<.005;if(isProtected){protectedDiscrepancies.push(key);return false;}return true;}).map(([key])=>key);
  if(data.preview===true)return{preview:true,date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length,protectedDate,protectedShortage,duplicate:existingSnap.exists(),movementId:existingSnap.exists()?id:""};if(existingSnap.exists())return{duplicate:true,movementId:id,date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length};if(!reason)throw new HttpsError("invalid-argument","A legacy cutover reason is required.");if(!lines.length&&!affected.length)throw new HttpsError("failed-precondition","There are no remaining legacy balances, negative August legacy expenses, or discrepancies to close.");
  const now=Date.now(),writes={};affected.forEach((key)=>{writes[`discrepancies/${key}/status`]="legacy_closed";writes[`discrepancies/${key}/financialStatus`]="legacy_cleanup_closed";writes[`discrepancies/${key}/legacyCutover`]={movementId:id,cutoffDate,closedAt:now,closedBy:actor.uid,reason,protectedException:`${protectedDate} shortage ${protectedShortage.toFixed(2)} retained`};});writes[`operationalAudit/${now}_${id}`]=operationalAuditRecord("legacy_owner_capital_reset","legacyCutover",id,actor,{date,cutoffDate,balances,crossPeriodReversals,crossPeriodSources,affectedDiscrepancies:affected.length,protectedDiscrepancies:protectedDiscrepancies.length,protectedDate,protectedShortage,reason});
  const movement=Financial.movement("legacy_owner_capital_reset","legacyCutover",id,lines,{occurredAt:accountingTimestamp(date,now),actorName:actor.role,reference:`LEGACY-CUTOVER-${cutoffDate}`,memo:reason});const committed=await commitFinancial(db,id,movement,actor,writes);return{movementId:id,cutoffDate,balances,affectedDiscrepancies:affected.length,duplicate:committed.duplicate};
});

exports.runFinancialClose = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "512MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["dailyreport","cashflow","registerOps"]),data=request.data||{},closeType=data.closeType==="SHIFT_CLOSE"?"SHIFT_CLOSE":"DAILY_CLOSE",businessDate=financeText(data.businessDate,10),shiftId=closeType==="SHIFT_CLOSE"?financeKey(data.shiftId,"Shift ID"):"";
    if(!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))throw new HttpsError("invalid-argument","Business date must use YYYY-MM-DD.");
    const closeId=closeType==="SHIFT_CLOSE"?`shift_${shiftId}`:`daily_${businessDate.replace(/-/g,"_")}`,closeRef=db.ref(`/financialCloses/${closeId}`),existing=(await closeRef.get()).val()||{};
    if(data.action==="get")return{closeId,current:existing.current||null,latestRevision:Number(existing.latestRevision||0)};
    if(data.action==="certify"){
      const current=existing.current;if(!current)throw new HttpsError("failed-precondition","Run the reconciliation before certifying this close.");if(!["RECONCILED","RECONCILED_WITH_TIMING_ITEMS"].includes(current.status))throw new HttpsError("failed-precondition","Open exceptions must be resolved or documented before certification.");if(current.certification&&current.certification.approvalId)return{closeId,revision:current.revision,status:"CERTIFIED",duplicate:true};
      const reason=financeText(data.reason,500);if(!reason)throw new HttpsError("invalid-argument","A certification note is required.");const approval=await claimManagerApproval(db,data,"certify_financial_close",closeId,null,`certify_financial_close_${closeId}_${current.revision}`),now=Date.now(),approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,certification={approvalId:approval.id,approvedAt:now,approvedBy,approvedByUid:approval.record.approvedBy,note:reason,snapshotHash:current.snapshotHash};
      await db.ref().update(Object.assign({},approval.usedWrites,{[`financialCloses/${closeId}/current/status`]:"CERTIFIED",[`financialCloses/${closeId}/current/certification`]:certification,[`financialCloses/${closeId}/revisions/${current.revision}/status`]:"CERTIFIED",[`financialCloses/${closeId}/revisions/${current.revision}/certification`]:certification,[`operationalAudit/${now}_${closeId}_certify`]:operationalAuditRecord("certify_financial_close","financialClose",closeId,actor,{revision:current.revision,snapshotHash:current.snapshotHash,approvalId:approval.id,approvedBy,reason})}));return{closeId,revision:current.revision,status:"CERTIFIED",certification,duplicate:false};
    }
    const nodes=["orders","archivedOrders","shifts","financialMovements","inventoryMovements","purchaseInvoices","books/journal","cashCustody","receivables","payables","platformPayouts"],snapshots=await Promise.all(nodes.map((path)=>db.ref(`/${path}`).get())),input={closeType,businessDate,shiftId};nodes.forEach((path,index)=>{input[path==="books/journal"?"booksJournal":path]=snapshots[index].val()||{};});
    const selectedShift=shiftId&&input.shifts[shiftId],cutoff=closeType==="SHIFT_CLOSE"?Number(selectedShift&&selectedShift.closeAt||Date.now()):(Date.parse(`${businessDate}T23:59:59.999+08:00`)||Date.now());if(closeType==="SHIFT_CLOSE"&&(!selectedShift||selectedShift.status!=="closed"))throw new HttpsError("failed-precondition","Only a closed shift can be reconciled and certified.");input.cutoff=cutoff;
    const result=FinancialClose.buildClose(input),current=existing.current;if(current&&current.snapshotHash===result.snapshotHash&&current.status!=="REOPENED")return Object.assign({closeId,revision:current.revision,duplicate:true},current);
    if(data.preview===true)return Object.assign({closeId,revision:Number(existing.latestRevision||0)+1,preview:true,duplicate:false},result);
    const now=Date.now(),claimToken=crypto.randomBytes(12).toString("hex"),claimRef=db.ref(`/financialCloseClaims/${closeId}`),claim=await claimRef.transaction((value)=>{if(value&&value.status==="processing"&&Number(value.claimedAt||0)>now-300000)return;return{status:"processing",token:claimToken,claimedAt:now,claimedBy:actor.uid,snapshotHash:result.snapshotHash};},undefined,false);
    if(!claim.committed||!claim.snapshot.val()||claim.snapshot.val().token!==claimToken)throw new HttpsError("aborted","This close is already being reconciled. Refresh and retry after it finishes.");
    const latest=(await closeRef.get()).val()||{},latestCurrent=latest.current;if(latestCurrent&&latestCurrent.snapshotHash===result.snapshotHash&&latestCurrent.status!=="REOPENED"){await claimRef.set({status:"duplicate",token:claimToken,completedAt:Date.now(),revision:latestCurrent.revision,snapshotHash:result.snapshotHash});return Object.assign({closeId,revision:latestCurrent.revision,duplicate:true},latestCurrent);}
    const revision=Math.max(0,Math.floor(Number(latest.latestRevision)||0))+1,record=Object.assign({},result,{closeId,revision,preparedAt:now,preparedBy:actor.uid,preparedRole:actor.role,previousRevision:latest.latestRevision||null,status:result.status});
    const writes={[`financialCloses/${closeId}/closeId`]:closeId,[`financialCloses/${closeId}/closeType`]:closeType,[`financialCloses/${closeId}/businessDate`]:businessDate,[`financialCloses/${closeId}/shiftId`]:shiftId||null,[`financialCloses/${closeId}/latestRevision`]:revision,[`financialCloses/${closeId}/current`]:record,[`financialCloses/${closeId}/revisions/${revision}`]:record,[`financialCloseIndex/${businessDate}/${closeId}`]:{closeId,closeType,shiftId:shiftId||null,revision,status:record.status,snapshotHash:record.snapshotHash,preparedAt:now,exceptionCount:record.exceptions.length,timingItemCount:record.timingItems.length},[`operationalAudit/${now}_${closeId}_reconcile`]:operationalAuditRecord("run_financial_close","financialClose",closeId,actor,{revision,status:record.status,snapshotHash:record.snapshotHash,exceptionCount:record.exceptions.length,timingItemCount:record.timingItems.length,controlTotals:record.controlTotals})};
    try{await db.ref().update(writes);await claimRef.set({status:"posted",token:claimToken,completedAt:Date.now(),revision,snapshotHash:record.snapshotHash});return Object.assign({duplicate:false},record);}catch(error){await claimRef.transaction((value)=>value&&value.token===claimToken?null:value,undefined,false);throw error;}
  },
);

async function reopenCertifiedFinancialCloses(date,activityId,activity) {
  const db=getDatabase(),index=(await db.ref(`/financialCloseIndex/${date}`).get()).val()||{},now=Date.now(),writes={};
  Object.keys(index).forEach((closeId)=>{const row=index[closeId]||{};if(row.status!=="CERTIFIED")return;writes[`financialCloses/${closeId}/current/status`]="REOPENED";writes[`financialCloses/${closeId}/current/reopenedAt`]=now;writes[`financialCloses/${closeId}/current/reopenedByActivityId`]=activityId;writes[`financialCloses/${closeId}/subsequentActivity/${activityId}`]=Object.assign({detectedAt:now},activity||{});writes[`financialCloseIndex/${date}/${closeId}/status`]="REOPENED";writes[`financialCloseIndex/${date}/${closeId}/reopenedAt`]=now;});if(Object.keys(writes).length)await db.ref().update(writes);
}

exports.reopenFinancialCloseOnMovement = onValueCreated(
  {ref:"/financialMovements/{movementId}",region:ORDER_REGION},
  async (event)=>{const movement=event.data.val()||{},movementId=event.params.movementId,date=BooksBridge.businessDate(movement.occurredAt||movement.postedAt||Date.now());await reopenCertifiedFinancialCloses(date,`movement_${movementId}`,{kind:"financial_movement",movementId,type:movement.type||"",sourceType:movement.sourceType||"",sourceId:movement.sourceId||"",occurredAt:Number(movement.occurredAt||movement.postedAt||Date.now())});},
);

exports.reopenFinancialCloseOnOrderChange = onValueWritten(
  {ref:"/orders/{orderId}",region:ORDER_REGION},
  async (event)=>{const order=event.data.after.val()||event.data.before.val();if(!order)return;const orderId=event.params.orderId,date=order.shiftId?(await getDatabase().ref(`/shifts/${order.shiftId}/openAt`).get()).val():0,businessDate=BooksBridge.businessDate(date||order.completedAt||order.receivedAt||order.timestamp||Date.now());await reopenCertifiedFinancialCloses(businessDate,`order_${orderId}_${Date.now()}`,{kind:"admin_order_change",orderId,shiftId:order.shiftId||"",status:order.status||"",occurredAt:Number(order.completedAt||order.receivedAt||order.timestamp||Date.now())});},
);

// Repairs only the narrow historical case where a payout was reversed first
// and a legacy deposit was posted afterward. The correction is append-only:
// it restores platform clearing, removes the duplicate cash receipt, and
// preserves every original movement and source link.
exports.repairReversedPayoutDeposit = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["cashflow", "receivables"]), data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), reason = financeText(data.reason, 300), movementId = `repair_reversed_payout_deposit_${payoutId}`;
    if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    const payout = (await db.ref(`/platformPayouts/${payoutId}`).get()).val();
    if (!payout) throw new HttpsError("not-found", "Payout not found.");
    if (payout.depositReversalMovementId) return {payoutId, movementId:payout.depositReversalMovementId, amount:Financial.money(payout.actualPayout), duplicate:true};
    if (payout.reversed !== true || !payout.depositMovementId) throw new HttpsError("failed-precondition", "Only a reversed payout with an unreversed deposit can be repaired.");
    const amount = Financial.money(payout.actualPayout), channel = financeText(payout.channel, 30), accountId = financeKey(payout.accountId, "Cash account ID"), depositId = financeKey(payout.depositMovementId, "Deposit movement ID");
    if (!(amount > 0)) throw new HttpsError("failed-precondition", "The payout deposit amount is invalid.");
    const [depositSnap, accountSnap] = await Promise.all([db.ref(`/financialMovements/${depositId}`).get(), db.ref(`/cfAccounts/${accountId}`).get()]), deposit = depositSnap.val(), account = accountSnap.val();
    if (!deposit || deposit.type !== "platform_payout_deposit" || deposit.sourceId !== payoutId) throw new HttpsError("failed-precondition", "The linked deposit movement does not match this payout.");
    if (!account) throw new HttpsError("failed-precondition", "The linked receiving account is unavailable.");
    const cashAccount = `asset:cash_account:${accountId}`, clearingAccount = `asset:platform_clearing:${channel}`, cashDebit = Financial.money((deposit.lines||[]).filter((line)=>line.account===cashAccount).reduce((sum,line)=>sum+Number(line.debit||0)-Number(line.credit||0),0)), clearingCredit = Financial.money((deposit.lines||[]).filter((line)=>line.account===clearingAccount).reduce((sum,line)=>sum+Number(line.credit||0)-Number(line.debit||0),0));
    if (Math.abs(cashDebit-amount)>0.009 || Math.abs(clearingCredit-amount)>0.009) throw new HttpsError("failed-precondition", "The linked deposit lines do not match the payout amount and accounts.");
    const approval = await claimManagerApproval(db, data, "repair_reversed_payout_deposit", payoutId, amount, movementId), now = Date.now(), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, reference = financeText(payout.depositReference || payoutId, 120), movement = Financial.movement("reversed_payout_deposit_repair", "platformPayout", payoutId, [Financial.line(clearingAccount,amount,0,"Restore clearing for deposit posted after payout reversal"),Financial.line(cashAccount,0,amount,`Reverse orphaned payout deposit from ${account.name}`)], {occurredAt:now,actorName:approvedBy,approvalId:approval.id,approvedBy,reason,reference,reversalOf:depositId,repair:true});
    const writes = Object.assign({}, approval.usedWrites, {[`platformPayouts/${payoutId}/depositReversalMovementId`]:movementId,[`platformPayouts/${payoutId}/depositReversedAt`]:now,[`platformPayouts/${payoutId}/depositReversalReason`]:reason,[`platformPayouts/${payoutId}/depositReversalApprovalId`]:approval.id,[`cfLedger/fm_${movementId}`]:cashLedgerRecord({date:financeDateFromTimestamp(now),accountId,dir:"out",category:"Platform payout deposit correction",amount,party:channel,ref:reference,auto:true},movementId,movement,actor),[`operationalAudit/${now}_${payoutId}_deposit_repair`]:operationalAuditRecord("repair_reversed_payout_deposit","platformPayout",payoutId,actor,{amount,channel,accountId,accountName:account.name,depositMovementId:depositId,repairMovementId:movementId,approvalId:approval.id,approvedBy,reason})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes);
    return {payoutId, amount, movementId, accountId, duplicate:committed.duplicate, repaired:!committed.duplicate};
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
async function assertAccountingPeriodOpen(db, effectiveDate, postingLabel) {
  let period;
  try { period = AccountingPeriods.periodForDate(effectiveDate); } catch (error) { throw new HttpsError("invalid-argument", error.message); }
  const record = (await db.ref(`/accountingPeriods/${period}`).get()).val();
  if (AccountingPeriods.isClosed(record)) throw new HttpsError("failed-precondition", `${period} is closed. Reopen it in Admin Settings before ${postingLabel || "posting or changing this financial record"}. Existing history remains unchanged.`);
  return period;
}
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
// ---------------------------------------------------------------------------
// Server-authoritative Books chart of accounts (replaces the hardcoded whitelist).
// ---------------------------------------------------------------------------
const BOOKS_TYPES = ["Asset","Liability","Equity","Income","COGS","Expense"];
const SENSITIVE_BOOKS_CODES = new Set("1000 1005 1010 1011 1012 1013 1014 1020 1021 1030 1040 1100 1110 1200 1210 1220 1230 1240 1260 1270 1280 1290 1900 2000 2020 2050 2090 3000 3100 3900 4000 4010 4020 4030 4900 4910".split(" "));
SENSITIVE_BOOKS_CODES.add("1001");
const BOOKS_CHART_SEED_ROWS = [
  ["1000","Cash on Hand","Asset"],["1005","Register Cash Float","Asset","Fixed imprest tied to POS Settings"],["1010","Other Bank Accounts","Asset"],["1011","Union Bank","Asset"],["1012","BDO","Asset"],["1013","Security Bank - 4538","Asset"],["1014","Security Bank - 4389","Asset"],["1020","GCash / Maya Wallet","Asset"],["1021","FoodPanda GCash Wallet","Asset","Dedicated FoodPanda payout destination"],["1030","Undeposited Collection","Asset","Cash awaiting bank deposit"],["1040","Revolving Fund","Asset"],["1050","Platform Payouts in Transit","Asset","Settled platform payouts awaiting bank deposit"],["1100","Accounts Receivable - Platforms","Asset","Grab/Panda settlements owed to us"],["1110","Other Receivables","Asset"],["1190","Cash Shortage Under Review","Asset","Pending manager reconciliation"],["1200","Inventory - Coffee & Beans","Asset"],["1210","Inventory - Milk & Dairy","Asset"],["1220","Inventory - Syrups & Flavors","Asset"],["1230","Inventory - Cups & Packaging","Asset"],["1240","Inventory - Food & Pastries","Asset"],["1250","Input VAT (creditable)","Asset","Used when VAT-registered"],["1260","Creditable Withholding Tax","Asset","CWT withheld by platforms/customers"],["1270","Inventory - Operating & Cleaning Supplies","Asset"],["1280","Inventory - Office Supplies","Asset"],["1290","Inventory Receiving Clearing","Asset","Received inventory awaiting complete posting"],["1500","Equipment","Asset","Espresso machine, grinders"],["1510","Furniture & Fixtures","Asset"],["1590","Accumulated Depreciation","Asset","Contra-asset (credit balance)"],["1900","Suspense","Asset","Unmapped POS accounts land here for review"],
  ["2000","Accounts Payable - Suppliers","Liability"],["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"],["2030","Customer Change / Refund Payable","Liability","Customer-related cash overages awaiting refund"],["2050","Due to Owner / Partners","Liability","Personally funded business costs awaiting reimbursement"],["2090","Unrecorded Payables Clearing","Liability","Supplier obligations awaiting complete posting"],["2100","Cash Overage Under Review","Liability","Pending manager reconciliation"],["2120","Accrued Salaries","Liability"],["2200","Taxes Payable","Liability"],["2210","Output VAT Payable","Liability","Used when VAT-registered"],["2220","Percentage Tax Payable","Liability","Non-VAT percentage tax on gross receipts"],["2230","Withholding Tax Payable","Liability","EWT withheld from payments"],["2300","Loans Payable","Liability"],["2310","Loan 2","Liability"],["2320","Loan 3","Liability"],
  ["3000","Owner's Capital","Equity"],["3050","Cash Float Clearing","Equity","POS shift float source"],["3100","Owner's Drawings","Equity","Contra-equity (debit balance)"],["3900","Retained Earnings","Equity"],
  ["4000","Sales - In-store","Income"],["4010","Sales - Online (own)","Income"],["4020","Sales - GrabFood","Income"],["4030","Sales - FoodPanda","Income"],["4900","Discounts & Comps","Income","Contra-income (debit balance)"],["4910","Sales Returns & Refunds","Income","Existing void and refund adjustments"],["4990","Other Income","Income"],
  ["5000","COGS - Coffee & Beans","COGS"],["5010","COGS - Milk & Dairy","COGS"],["5020","COGS - Syrups & Flavors","COGS"],["5030","COGS - Food & Pastries","COGS"],["5040","COGS - Cups & Packaging","COGS"],["5090","Unposted COGS Clearing","COGS","Costs awaiting complete item-level posting"],["5900","Wastage & Spoilage","COGS","Physical spoilage, expiry, spillage, or discard only"],["5905","Inventory Reconciliation Gain / (Loss)","COGS","Count or valuation variance only: debit is loss, credit is gain"],
  ["6000","Salaries & Wages","Expense"],["6010","Rent","Expense"],["6020","Utilities","Expense","Electricity, water"],["6030","Internet & Phone","Expense"],["6040","Platform Commissions","Expense","Grab/Panda fees"],["6045","Platform Discounts","Expense","Grab/Panda-funded or shared discounts"],["6046","Platform Service VAT","Expense"],["6050","Marketing & Promotions","Expense"],["6060","Repairs & Maintenance","Expense"],["6070","Cleaning & Operating Supplies","Expense"],["6075","Office & Administrative Supplies","Expense"],["6076","Transportation & Delivery","Expense"],["6077","Staff Consumption & Welfare","Expense","Inventory consumed by staff; never sales COGS or inventory variance"],["6078","Product R&D & Testing","Expense","Inventory consumed for product development, testing, training, or sampling"],["6080","Bank & Payment Fees","Expense"],["6085","Platform Penalties & Adjustments","Expense"],["6090","Depreciation","Expense"],["6100","Miscellaneous","Expense"],["6110","Cash Short / Over","Expense","Register variance"]
].map(function(row){if(row[0]==="1000")return ["1000","Cash on Hand - Cash in Register","Asset"];if(row[0]==="1030")return ["1001","Cash on Hand - Undeposited Collection","Asset","Cash awaiting bank deposit; controlled by cash custody"];return row;});
function booksChartSeed(){const out={};BOOKS_CHART_SEED_ROWS.forEach(function(r){out[r[0]]={code:r[0],name:r[1],type:r[2],note:r[3]||"",active:true,system:true,sensitive:SENSITIVE_BOOKS_CODES.has(r[0])};});return out;}
async function ensureBooksChart(db) {
  const seed = booksChartSeed();
  const snap = await db.ref("/booksChart").get();
  const current = snap.val() || {}, writes = {}, resolved = Object.assign({}, current), now = Date.now();
  // A Firebase multi-location update cannot contain both /booksChart/CODE and
  // /booksChart/CODE/field. Missing or malformed accounts therefore use one
  // complete-record write; only existing object records receive child updates.
  Object.keys(seed).forEach(function(code) {
    const existing = current[code];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      resolved[code] = Object.assign({}, seed[code], {createdAt: now, schemaVersion: 1});
      writes[`booksChart/${code}`] = resolved[code];
    } else {
      resolved[code] = existing;
    }
  });
  ["1000", "2100", "5900", "5905", "6077", "6078"].forEach(function(code) {
    const canonical = seed[code], existing = current[code];
    if (!canonical || !existing || typeof existing !== "object" || Array.isArray(existing)) return;
    resolved[code] = Object.assign({}, existing, canonical);
    Object.keys(canonical).forEach(function(key) {
      if (existing[key] !== canonical[key]) writes[`booksChart/${code}/${key}`] = canonical[key];
    });
  });
  if (current["1030"] && typeof current["1030"] === "object" && !Array.isArray(current["1030"])) {
    // Move the existing chart record and its journal presentation lines. The
    // durable financial account is asset:cash_awaiting_deposit, so movements,
    // cash custody, deposits, and audit links are intentionally untouched.
    const journal=(await db.ref("/books/journal").get()).val()||{},legacy=current["1030"],canonical=Object.assign({},seed["1001"],current["1001"]||{}, {code:"1001",name:"Cash on Hand - Undeposited Collection",type:"Asset",note:"Cash awaiting bank deposit; controlled by cash custody",active:true,system:true,sensitive:true,migratedFrom:"1030",migratedAt:now}),changed=[];
    Object.keys(journal).forEach(function(id){const entry=journal[id]||{},lines=Array.isArray(entry.lines)?entry.lines:[],next=lines.map(function(line){return line&&line.code==="1030"?Object.assign({},line,{code:"1001"}):line;});if(next.some(function(line,index){return line!==lines[index];})){writes[`books/journal/${id}/lines`]=next;changed.push(id);}});
    writes["booksChart/1001"]=canonical;writes["booksChart/1030"]=null;writes["books/chartCodeMigrations/1030_to_1001"]={from:"1030",to:"1001",migratedAt:now,journalEntriesMoved:changed.length,legacyChartCreatedAt:legacy.createdAt||null,schemaVersion:1};writes[`operationalAudit/${now}_books_chart_1030_to_1001`]={action:"move_books_chart_code",sourceType:"booksChart",sourceId:"1030",replacementCode:"1001",journalEntriesMoved:changed.length,ts:now};
    delete resolved["1030"];resolved["1001"]=canonical;
  }
  if (current["4995"]) {
    const retired = {active: false, system: true, note: "Retired legacy inventory reconciliation gain account; consolidated into 5905", consolidatedInto: "5905"};
    resolved["4995"] = Object.assign({}, current["4995"], retired);
    Object.keys(retired).forEach(function(key) {
      if (current["4995"][key] !== retired[key]) writes[`booksChart/4995/${key}`] = retired[key];
    });
  }
  if (Object.keys(writes).length) await db.ref().update(writes);
  return Object.assign({}, seed, resolved);
}
const DEFAULT_BOOKS_CHART_MANAGERS=["danilomagbual@gmail.com","contact.mariadaniela@gmail.com"];
function booksManagerKey(email){return String(email||"").toLowerCase().replace(/[^a-z0-9]+/g,"_");}
async function ensureBooksChartManagers(db){const ref=db.ref("/config/booksChartManagers");const snap=await ref.get();let current=snap.val();if(!current||typeof current!=="object"||!Object.keys(current).length){const seed={};DEFAULT_BOOKS_CHART_MANAGERS.forEach(function(email){seed[booksManagerKey(email)]={email:String(email).toLowerCase(),active:true,seededAt:Date.now()};});await ref.set(seed);current=seed;}const allow=new Set();Object.keys(current).forEach(function(k){const row=current[k];if(row&&row.active!==false&&row.email)allow.add(String(row.email).toLowerCase());});return allow;}
async function requireBooksChartManager(db,request){const portal=await requirePortalUser(db,request);const email=String(request.auth&&request.auth.token&&request.auth.token.email||"").toLowerCase();const allow=await ensureBooksChartManagers(db);if(!email||!allow.has(email))throw new HttpsError("permission-denied","Only the finance owners can manage the chart of accounts.");return Object.assign({},portal,{email:email});}
function booksCodeAccount(code, accounts, booksChart) {
  code = financeText(code, 4);
  if (!/^\d{4}$/.test(code)) throw new HttpsError("invalid-argument", "Every journal line requires a valid four-digit account code.");
  if (code === "1030") code = "1001";
  const chartRow = booksChart && booksChart[code];
  if (chartRow) {
    if (chartRow.active === false) throw new HttpsError("failed-precondition", `Books account ${code} is inactive. Reactivate it in the chart of accounts before posting.`);
  } else {
    const allowed = new Set("1000 1005 1010 1011 1012 1013 1014 1020 1021 1030 1040 1100 1110 1200 1210 1220 1230 1240 1250 1260 1270 1280 1290 1500 1510 1590 1900 2000 2020 2030 2050 2090 2100 2120 2200 2210 2220 2230 2300 2310 2320 3000 3050 3100 3900 4000 4010 4020 4030 4900 4910 4990 4995 5000 5010 5020 5030 5040 5090 5900 5905 6000 6010 6020 6030 6040 6045 6046 6050 6060 6070 6075 6076 6077 6078 6080 6085 6090 6100 6110".split(" "));
    allowed.add("1001");
    if (!allowed.has(code)) throw new HttpsError("failed-precondition", `Books account ${code} is not in the approved chart of accounts.`);
  }
  if (code === "1000") return {account:"asset:register_cash", cashKey:"register"};
  if (code === "1005") return {account:"asset:register_float", cashKey:"float"};
  if (code === "1001") return {account:"asset:cash_awaiting_deposit", cashKey:"undeposited"};
  if (code === "1040") return {account:"asset:petty_cash", cashKey:"petty"};
  const matches = Object.keys(accounts || {}).filter((id) => BooksBridge.cashCodeForAccount(accounts[id]) === code);
  if (matches.length > 1) throw new HttpsError("failed-precondition", `Cash account code ${code} is assigned to more than one cash account.`);
  if (matches.length === 1) return {account:`asset:cash_account:${matches[0]}`, cashKey:matches[0]};
  if (/^(1010|1011|1012|1013|1014|1020|1021)$/.test(code)) throw new HttpsError("failed-precondition", `Cash account code ${code} is not linked to a live cash account.`);
  return {account:`coa:${code}`, cashKey:""};
}
async function prepareManualBooksJournal(db, data, accounts, actor, allowedLinkedPayable) {
  const memo=financeText(data.memo,240),reference=financeText(data.ref,120),date=financeDate(data.date),rawLines=Array.isArray(data.lines)?data.lines:[];
  await assertAccountingPeriodOpen(db, date, "posting or correcting a manual journal");
  if(!memo)throw new HttpsError("invalid-argument","Memo / description is required.");
  if(rawLines.length<2||rawLines.length>20)throw new HttpsError("invalid-argument","A journal requires between two and twenty lines.");
  const lines=[],cashLines=[];let debit=0,credit=0;const booksChart=await ensureBooksChart(db);
  rawLines.forEach((row,index)=>{const dr=Financial.money(row&&row.debit),cr=Financial.money(row&&row.credit);if((dr>0&&cr>0)||(!(dr>0)&&!(cr>0)))throw new HttpsError("invalid-argument",`Journal line ${index+1} must contain either a debit or a credit.`);const mapped=booksCodeAccount(row.code,accounts,booksChart);debit=Financial.money(debit+dr);credit=Financial.money(credit+cr);lines.push(Financial.line(mapped.account,dr,cr,memo));if(mapped.cashKey)cashLines.push({mapped,dr,cr,index});});
  if(Math.abs(debit-credit)>0.009||!(debit>0))throw new HttpsError("invalid-argument","Journal debits and credits must balance.");
  const payableLines=rawLines.filter((row)=>String(row&&row.code||"")==="2000"),linkedPayableId=payableLines.length?financeKey(data.linkedPayableId,"Linked payable ID"):"";let linkedPayable=null;
  if(payableLines.length>1)throw new HttpsError("invalid-argument","A manual journal may contain only one Accounts Payable control line.");
  if(payableLines.length){const row=payableLines[0],value=Financial.money(row.debit);if(Financial.money(row.credit)>0)throw new HttpsError("failed-precondition","Create supplier liabilities with New bill or Purchases so the payable subledger stays linked.");linkedPayable=(await db.ref(`/payables/${linkedPayableId}`).get()).val();if(!linkedPayable)throw new HttpsError("not-found","The selected payable was not found.");const allowed=allowedLinkedPayable&&linkedPayableId===allowedLinkedPayable.id&&linkedPayable.reversalMovementId===allowedLinkedPayable.movementId;if(linkedPayable.status!=="open"&&!allowed)throw new HttpsError("failed-precondition","The selected payable is no longer open.");if(linkedPayable.purchaseInvoiceId)throw new HttpsError("failed-precondition","Inventory payables must be corrected from Purchases so stock and valuation remain linked.");const remaining=Financial.money(linkedPayable.remainingAmount!=null?linkedPayable.remainingAmount:linkedPayable.amount);if(Math.abs(value-remaining)>0.009)throw new HttpsError("failed-precondition",`Accounts Payable must debit the selected payable's full remaining balance of ${remaining.toFixed(2)}.`);}
  const sensitive=rawLines.some((row)=>{const c=String(row&&row.code||""),entry=booksChart&&booksChart[c];return entry?entry.sensitive===true:SENSITIVE_BOOKS_CODES.has(c);});
  if(sensitive&&!reference)throw new HttpsError("invalid-argument","A source reference is required for cash, sales, platform, inventory, receivable, payable, suspense, or equity journals.");
  if(sensitive&&!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError("permission-denied","A privileged Finance role must post journals affecting cash, sales, platforms, inventory, receivables, payables, suspense, or equity.");
  return {memo,reference,date,lines,cashLines,debit,sensitive,linkedPayableId,linkedPayable};
}
async function reviseJournalClassification(db,id,data,prepared,actor,commandId,now){
  if(!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError('permission-denied','A privileged Finance role is required.');
  const expected=Number(data.expectedRevision),reason=financeText(data.reason,300);
  if(data.expectedRevision==null||!Number.isInteger(expected)||expected<0||!reason)throw new HttpsError('failed-precondition','Refresh the journal and provide a correction reason.');
  const signature=JournalReclassification.signature(id,data,actor),lockRef=db.ref('/financialControlLocks/cashJournalEdit'),token=crypto.randomBytes(12).toString('hex');
  // Returning undefined aborts locally, even when that value came from stale
  // SDK cache. Let Firebase reconcile with the server and verify ownership.
  const lock=await lockRef.transaction(current=>!current||Number(current.claimedAt||0)<now-120000?{token,claimedAt:now,commandId,actorUid:actor.uid}:current,undefined,false);
  if(!lock.committed||!lock.snapshot.exists()||lock.snapshot.val().token!==token)throw new HttpsError('aborted','Another journal correction is being saved. Wait briefly, then refresh and retry.');
  try{
    const receipt=(await db.ref(`/cashJournalEditCommands/${commandId}`).get()).val();
    if(receipt){if(receipt.signature!==signature)throw new HttpsError('failed-precondition','This submission ID was used for a different edit.');return{movementId:id,revision:receipt.revision,editedInPlace:true,duplicate:true};}
    const original=(await db.ref(`/financialMovements/${id}`).get()).val();
    if(!JournalReclassification.allowed(original,prepared)||Number(original.revision||0)!==expected)throw new HttpsError('failed-precondition','The journal changed since you opened it. Refresh before editing.');
    if((await db.ref(`/financialControlLinks/correctionMovements/${id}`).get()).exists())throw new HttpsError('failed-precondition','This journal is linked to an operational correction. Use its source workflow.');
    const pending=(await db.ref('/financialCommandClaims').orderByChild('status').equalTo('processing').get()).val()||{};
    if(Object.values(pending).some(x=>x.status==='processing'&&Number(x.claimedAt||0)>now-900000))throw new HttpsError('aborted','A Finance posting is in progress. Wait and retry.');
    await assertAccountingPeriodOpen(db,prepared.date,'reclassifying this journal');
    const journal=(await db.ref(`/books/journal/${id}`).get()).val(),cashMap=(await db.ref('/books/config/cashAccountMap').get()).val()||{};
    if(!journal)throw new HttpsError('failed-precondition','The journal projection is missing. Refresh Finance Books first.');
    const revision=expected+1,edited={...original,id,lines:prepared.lines,memo:prepared.memo,reference:prepared.reference,amount:prepared.debit,revision,classificationRevision:revision,updatedAt:now,updatedBy:actor.uid};
    const writes={
      [`financialMovements/${id}`]:edited,
      [`books/journal/${id}`]:{...journal,...BooksBridge.buildSingle(edited,cashMap).entry,revision,updatedAt:now,updatedBy:actor.uid},
      [`cashJournalRevisions/${id}/${revision}`]:{revision,commandId,reason,changedAt:now,changedBy:actor.uid,changedByRole:actor.role,before:original,after:edited,journalBefore:journal,kind:'classification_only'},
      [`cashJournalEditCommands/${commandId}`]:{signature,movementId:id,revision,postedAt:now,actorUid:actor.uid,kind:'classification_only'},
      [`operationalAudit/${commandId}`]:{action:'reclassify_open_journal',sourceId:id,revision,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,date:prepared.date}
    };
    const indexes=(await db.ref(`/financialCloseIndex/${prepared.date}`).get()).val()||{};
    for(const closeId of Object.keys(indexes)){const current=(await db.ref(`/financialCloses/${closeId}/current`).get()).val();if(current){writes[`financialCloses/${closeId}/current/status`]='REOPENED';writes[`financialCloses/${closeId}/current/reopenedAt`]=now;writes[`financialCloses/${closeId}/current/reopenedByActivityId`]=commandId;writes[`financialCloseIndex/${prepared.date}/${closeId}/status`]='REOPENED';}}
    await safeFinancialUpdate(db,writes,'journal classification edit');
    return{movementId:id,revision,editedInPlace:true};
  }finally{try{await lockRef.transaction(current=>current&&current.token===token?null:current,undefined,false);}catch(error){logger.error('Journal classification lock release failed',{commandId,message:error.message});}}
}
function assertNoOverlappingUpdatePaths(writes, context) {
  const paths = Object.keys(writes);
  for (const parentPath of paths) for (const childPath of paths) if (childPath !== parentPath && childPath.startsWith(`${parentPath}/`)) throw new HttpsError("internal", `The ${context || "financial"} update contains conflicting record paths. Nothing was posted.`);
}
async function commitFinancial(db, movementId, movement, actor, extraWrites = {}) {
  movementId = financeKey(movementId, "Movement ID");
  const ref = db.ref(`/financialMovements/${movementId}`);
  const existing = await ref.get();
  if (existing.exists()) return {duplicate: true, movement: existing.val()};
  await assertAccountingPeriodOpen(db, Number(movement && movement.occurredAt || Date.now()), "creating this financial posting");
  const record = financeRecord(movementId, movement, actor);
  const claimRef = db.ref(`/financialCommandClaims/${movementId}`), claimToken = crypto.randomBytes(12).toString("hex"), claimedAt = Date.now();
  const claim = await claimRef.transaction((current) => {
    // The longest financial maintenance callable can run for nine minutes.
    // A 15-minute lease prevents a live invocation from being taken over.
    const stale = current && current.status === "processing" && Number(current.claimedAt || 0) < claimedAt - 900000;
    return !current || stale ? {status:"processing",token:claimToken,claimedAt,actorUid:actor.uid,movementId,operationType:financeText(movement && movement.type,80),schemaVersion:2} : current;
  });
  if (!claim.committed || !claim.snapshot.exists() || claim.snapshot.val().token !== claimToken) {
    const posted = await ref.get();
    if (posted.exists()) return {duplicate: true, movement: posted.val()};
    throw new HttpsError("aborted", "This financial command is already being processed. Wait a moment, then refresh before trying again.");
  }
  try {
    // While this claim is processing, guarded cash-journal edits cannot run.
    // Detect edits completed after a custody calculation but before this claim.
    if(Object.keys(extraWrites).some(path=>path.startsWith('cashCustody/'))){
      try{CashJournalEdit.assertCustodyDelta((await db.ref('/cashCustody').get()).val()||{},extraWrites,record.lines);}catch(error){throw new HttpsError('failed-precondition',error.message);}
    }
    if(record.reversalOf){const source=(await db.ref(`/financialMovements/${financeKey(record.reversalOf,'Reversal source')}`).get()).val();if(source&&Number(source.revision)>0&&CashJournalEdit.eligible(source))throw new HttpsError('failed-precondition','This cash journal has an audited revision. Refresh and use Edit / correct; journal-only reversal would break its custody link.');}
    const writes = Object.assign({}, extraWrites, {[`financialMovements/${movementId}`]: record,[`financialCommandClaims/${movementId}`]:{status:"posted",token:claimToken,claimedAt,postedAt:Date.now(),actorUid:actor.uid,movementId,operationType:financeText(movement && movement.type,80),schemaVersion:2}});
    await safeFinancialUpdate(db, writes, "financial");
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

async function availableCashOnHandAboveFloat(db) {
  const [movementsSnap, settingsSnap, activeShiftSnap] = await Promise.all([db.ref("/financialMovements").get(), db.ref("/posSettings").get(), db.ref("/posActiveShift").get()]);
  let gross = 0;
  Object.values(movementsSnap.val() || {}).forEach((movement) => ((movement && movement.lines) || []).forEach((line) => {
    if (line && line.account === "asset:register_cash") gross = Financial.money(gross + Financial.money(line.debit) - Financial.money(line.credit));
  }));
  const float = resolveRegisterFloat(settingsSnap.val(), activeShiftSnap.val()).amount;
  return {gross: Financial.money(gross), float, available: Financial.money(Math.max(0, gross - float))};
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
  const actor = {uid: "server", role: "server"}, shift=(await db.ref(`/shifts/${shiftId}`).get()).val()||{}, shiftReference=durableShiftReference(shift,shiftId);
  for (let index = 0; index < (entries || []).length; index++) { const entry = entries[index] || {}, value = Financial.money(entry.amount); if (!(value > 0)) continue; const token = `${Number(entry.ts || 0)}_${index}`, movementId = `${kind}_${shiftId}_${token}`, isIn = kind === "shift_payin"; if (!isIn && (entry.type === "revolving_fund_replenishment" || /^petty cash replenish/i.test(String(entry.reason || "")))) continue; const isPurchaseAdvance = !isIn && entry.type === "purchase_advance" && entry.id; const lines = isIn ? [Financial.line("asset:register_cash", value, 0, entry.reason || "Cash in"), Financial.line(`offset:cash_in:${financeText(entry.reason || "other", 60)}`, 0, value, entry.reason || "Cash in")] : isPurchaseAdvance ? [Financial.line(`asset:purchase_cash_advance:${financeKey(entry.id, "Purchase advance ID")}`, value, 0, entry.reason || "Purchase cash advance"), Financial.line("asset:register_cash", 0, value, entry.reason || "Purchase cash advance")] : [Financial.line(`expense:cash_out:${financeText(entry.reason || "other", 60)}`, value, 0, entry.reason || "Cash out"), Financial.line("asset:register_cash", 0, value, entry.reason || "Cash out")]; const movement = Financial.movement(isPurchaseAdvance ? "purchase_cash_advance" : kind, "shift", shiftId, lines, {occurredAt: Number(entry.ts || Date.now()), actorName: entry.by || "Register", shiftReference, reference:financeText(entry.reference,120)||shiftReference, advanceId: entry.id || "", recipient: financeText(entry.recipient || "", 120)}); await commitFinancial(db, movementId, movement, actor); }
}
exports.onShiftPayInsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payIns", region: ORDER_REGION, retry: true}, async (event) => {if (!event.data.after.exists()) return; await postShiftCashEntries(getDatabase(), event.params.shiftId, event.data.after.val() || [], "shift_payin");});
exports.onShiftPayOutsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payOuts", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the register drawer never funds payments — cash out is drawn from Undeposited Collection via approved vouchers. Historical drawer pay-outs already posted (idempotent) and are unaffected. */ return; });
exports.onShiftOpenFinancial = onValueWritten({ref: "/shifts/{shiftId}", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the opening float stays in the drawer between shifts — no financial entry, no custody draw. */ return; });
function durableShiftReference(shift,id) { const existing=financeText(shift&&shift.shiftReference,80); if(existing)return existing; const day=financeDateFromTimestamp(Number(shift&&shift.openAt)||Date.now()).replace(/-/g,""); return `SHIFT-${day}-LEGACY-${financeKey(id,"Shift ID").slice(-8).toUpperCase()}`; }
async function ensureShiftReferenceRecord(db,id,shift) { const shiftReference=durableShiftReference(shift,id),refKey=financeKey(shiftReference,"Shift reference"),indexRef=db.ref(`/shiftReferenceIndex/${refKey}`),claim=await indexRef.transaction((current)=>{if(current&&current.shiftId!==id)return;return current||{shiftId:id,shiftReference,openedAt:Number(shift.openAt||0),closedAt:Number(shift.closeAt||0)||null};},undefined,false);if(!claim.committed)throw new HttpsError("already-exists",`Shift reference ${shiftReference} is already linked to another shift.`);const custody=(await db.ref(`/cashCustody/${id}`).get()).val()||null,writes={[`shifts/${id}/shiftReference`]:shiftReference,[`shifts/${id}/zReport/shiftReference`]:shiftReference};if(custody)Object.assign(writes,{[`cashCustody/${id}/shiftReference`]:shiftReference,[`cashCustody/${id}/reference`]:shiftReference});await db.ref().update(writes);return shiftReference; }
exports.ensureShiftReference = onCall({region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"}, async (request) => {const db=getDatabase(),actor=await requirePortalPermission(db,request,["registerOps"]),id=financeKey((request.data||{}).shiftId,"Shift ID"),shift=(await db.ref(`/shifts/${id}`).get()).val();if(!shift)throw new HttpsError("not-found","Shift not found.");const shiftReference=await ensureShiftReferenceRecord(db,id,shift);return{shiftId:id,shiftReference,updatedBy:actor.uid};});
exports.onShiftCloseFinancial = onValueWritten({ref: "/shifts/{shiftId}/status", region: ORDER_REGION, retry: true}, async (event) => {if (event.data.after.val() !== "closed" || event.data.before.val() === "closed") return; const db = getDatabase(), id=event.params.shiftId, shift = (await db.ref(`/shifts/${id}`).get()).val() || {}, actor={uid:"server",role:"server"}, occurredAt=Number(shift.closeAt||Date.now()), shiftReference=await ensureShiftReferenceRecord(db,id,shift); const remittable=Financial.money(Math.max(0,Number(shift.cashToSettle)||0)); if (remittable>0) {const label=`${shiftReference} · closed shift cash to settle`,custody=Financial.movement("shift_cash_to_custody","shift",id,[Financial.line("asset:cash_awaiting_deposit",remittable,0,label),Financial.line("asset:register_cash",0,remittable,label)],{occurredAt,actorName:shift.staff||"Register",shiftReference,retainedFloat:Financial.money(shift.actualFloatRetained!=null?shift.actualFloatRetained:shift.retainedFloat)}); await commitFinancial(db,`shift_custody_${id}`,custody,actor,{[`cashCustody/${id}`]:{shiftId:id,shiftReference,staff:financeText(shift.staff,100),amount:remittable,depositedAmount:0,remaining:remittable,retainedFloat:Financial.money(shift.actualFloatRetained!=null?shift.actualFloatRetained:shift.retainedFloat),floatShortfall:Financial.money(shift.floatShortfall),status:"awaiting_deposit",closedAt:occurredAt,movementId:`shift_custody_${id}`,reference:shiftReference,schemaVersion:4}});} const value = Financial.money(Math.abs(Number(shift.variance) || 0)); if (!(value > 0)) return; const short = Number(shift.variance) < 0, label=`${shiftReference} · ${short?"Cash shortage pending manager reconciliation":"Cash overage pending manager reconciliation"}`, lines = short ? [Financial.line("asset:cash_shortage_pending", value, 0, label), Financial.line("asset:register_cash", 0, value, label)] : [Financial.line("asset:register_cash", value, 0, label), Financial.line("liability:cash_overage_pending", 0, value, label)]; const movement = Financial.movement("shift_cash_variance_pending", "shift", id, lines, {occurredAt,actorName:shift.staff||"Register",shiftReference,status:"pending_manager_reconciliation"}); await commitFinancial(db,`shift_variance_${id}`,movement,actor);});

function advanceFundingAccount(row) {
  const id = financeText(row && row.fundingAccountId, 120) || "undeposited";
  if (id === "cash_on_hand") return {kind:"cash_on_hand", account:"asset:register_cash", id:"cash_on_hand"};
  if (id === "undeposited") return {kind:"undeposited", account:"asset:cash_awaiting_deposit", id:"undeposited"};
  return {kind:"account", account:`asset:cash_account:${id}`, id};
}
function revolvingFundPosting(row) {
  const type = financeText(row && row.transactionType, 40).toLowerCase(), raw = financeText(row && row.category, 80), key = raw.toLowerCase();
  if (type === "owner_withdrawal" || key === "owner_draw" || key === "owner draw" || key === "owner withdrawal") return {account:"equity:owner_draw", label:"Owner withdrawal", movementType:"revolving_fund_owner_withdrawal"};
  const map = {
    operating_supplies:["expense:supplies","Cleaning & operating supplies"], supplies:["expense:supplies","Cleaning & operating supplies"],
    office_supplies:["expense:office_supplies","Office & administrative supplies"], utilities:["expense:utilities","Utilities"],
    internet_phone:["expense:internet","Internet & phone"], "internet & phone":["expense:internet","Internet & phone"],
    marketing:["expense:marketing","Marketing & promotions"], repairs:["expense:repairs","Repairs & maintenance"], "repairs & maintenance":["expense:repairs","Repairs & maintenance"],
    bank_fees:["expense:bank_charges","Bank & payment fees"], rent:["expense:rent","Rent"], salaries:["expense:salaries","Salaries & wages"],
    transport:["expense:transportation","Transportation / delivery"], "transportation / delivery":["expense:transportation","Transportation / delivery"],
    staff_meals:["expense:staff_meals","Staff meals / welfare"], "staff meals":["expense:staff_meals","Staff meals / welfare"],
    miscellaneous:["expense:other_expense","Other operating expense"], other_expense:["expense:other_expense","Other operating expense"]
  }, mapped = map[key] || ["expense:other_expense", raw || "Other operating expense"];
  return {account:mapped[0], label:mapped[1], movementType:"petty_cash_expense"};
}

// Append-only repair for historical cash payments whose Admin category was
// previously collapsed into Miscellaneous. It changes expense classification
// only: Undeposited Collection, custody allocations, and the voucher stay intact.
exports.repairPettyExpenseClassifications = onCall({region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "512MiB"}, async (request) => {
  const db=getDatabase(),actor=await requirePortalPermission(db,request,["cashflow","registerOps"]),data=request.data||{},reason=financeText(data.reason,500);
  if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Only a manager may repair cash-payment classifications.");
  const [voucherSnap,movementSnap]=await Promise.all([db.ref("/pettyCashVouchers").get(),db.ref("/financialMovements").get()]),vouchers=voucherSnap.val()||{},movements=movementSnap.val()||{},repairs=[],blocked=[];
  for(const [id,row] of Object.entries(vouchers)){
    if(!row||row.status!=="approved"||row.voided===true||row.transactionType==="purchase_advance"||row.transactionType==="owner_withdrawal")continue;
    const amount=Financial.money(row.amount),target=revolvingFundPosting(row),repairMovementId=`petty_category_reclass_v1_${id}`;if(!(amount>0)||!/^expense:/.test(target.account)||movements[repairMovementId])continue;
    const nets={};Object.entries(movements).forEach(([movementId,movement])=>{if(!movement||movement.sourceType!=="pettyVoucher"||movement.sourceId!==id||movementId.indexOf("petty_category_reclass_v1_")===0)return;(movement.lines||[]).forEach((line)=>{const account=String(line.account||"");if(!/^expense:/.test(account))return;nets[account]=Financial.money((nets[account]||0)+(Number(line.debit)||0)-(Number(line.credit)||0));});});
    const total=Financial.money(Object.values(nets).reduce((sum,value)=>sum+Number(value||0),0));if(Math.abs(total-amount)>.009){blocked.push({voucherId:id,voucherNo:financeText(row.voucherNo,60),amount,expenseNet:total,reason:"Expense movements do not equal the active voucher amount"});continue;}
    const accounts=new Set([...Object.keys(nets),target.account]),lines=[];accounts.forEach((account)=>{const desired=account===target.account?amount:0,delta=Financial.money(desired-Number(nets[account]||0));if(Math.abs(delta)<.005)return;lines.push(Financial.line(account,delta>0?delta:0,delta<0?-delta:0,account===target.account?`Reclassify ${financeText(row.voucherNo||id,60)} to ${target.label}`:`Remove ${financeText(row.voucherNo||id,60)} from prior category`));});
    const debits=Financial.money(lines.reduce((sum,line)=>sum+Number(line.debit||0),0)),credits=Financial.money(lines.reduce((sum,line)=>sum+Number(line.credit||0),0));if(lines.length&&Math.abs(debits-credits)<.009)repairs.push({voucherId:id,voucherNo:financeText(row.voucherNo,60),amount,targetAccount:target.account,targetLabel:target.label,lines,movementId:repairMovementId});
  }
  if(data.preview===true)return{preview:true,repairCount:repairs.length,blockedCount:blocked.length,repairs:repairs.map(r=>({voucherId:r.voucherId,voucherNo:r.voucherNo,amount:r.amount,targetLabel:r.targetLabel})),blocked};
  if(!reason)throw new HttpsError("invalid-argument","Explain why the historical cash-payment classifications are being repaired.");
  let posted=0,duplicates=0;for(const repair of repairs){const now=Date.now(),movement=Financial.movement("petty_cash_expense_reclassification","pettyVoucher",repair.voucherId,repair.lines,{occurredAt:now,actorName:actor.role,reference:repair.voucherNo||repair.voucherId,memo:reason,classificationRepair:true}),writes={[`pettyCashVouchers/${repair.voucherId}/classificationRepair`]:{movementId:repair.movementId,targetAccount:repair.targetAccount,targetLabel:repair.targetLabel,repairedAt:now,repairedBy:actor.uid,reason,schemaVersion:1},[`operationalAudit/${now}_${repair.movementId}`]:operationalAuditRecord("repair_petty_expense_classification","pettyVoucher",repair.voucherId,actor,{movementId:repair.movementId,amount:repair.amount,targetAccount:repair.targetAccount,targetLabel:repair.targetLabel,reason,cashChanged:false,custodyChanged:false})},result=await commitFinancial(db,repair.movementId,movement,actor,writes);if(result.duplicate)duplicates++;else posted++;}
  return{repairCount:repairs.length,posted,duplicates,blockedCount:blocked.length,blocked};
});
function cashPaymentOccurredAt(row) {
  const date = financeText(row && row.date, 10);
  return (/^\d{4}-\d{2}-\d{2}$/.test(date) && Date.parse(`${date}T00:00:00+08:00`)) || Number(row && (row.approvedAt || row.createdAt)) || Date.now();
}

exports.onPettyVoucherFinancial = onValueWritten(
  {ref: "/pettyCashVouchers/{voucherId}", region: ORDER_REGION, retry: true},
  async (event) => {const before = event.data.before.val() || {}, after = event.data.after.val(); if (!after) return; const db = getDatabase(), id = event.params.voucherId, value = Financial.money(after.amount), actor = {uid: "server", role: "server"}, isAdvance=after.transactionType==="purchase_advance", posting=revolvingFundPosting(after), funding=isAdvance?advanceFundingAccount(after):{kind:"undeposited",account:"asset:cash_awaiting_deposit",id:"undeposited"}; if (after.status === "approved" && before.status !== "approved" && value > 0) {let custodyOut={writes:{},fromCustody:0,shortfall:0,allocations:{}};if(funding.kind==="undeposited"){custodyOut = await poolCustodyOutflow(db, value);if(custodyOut.shortfall>0.009){const blockedAt=Date.now();await db.ref().update({[`pettyCashVouchers/${id}/cashCustodyStatus`]:"blocked_insufficient_custody",[`pettyCashVouchers/${id}/cashCustodyShortfall`]:custodyOut.shortfall,[`pettyCashVouchers/${id}/cashCustodyCheckedAt`]:blockedAt,[`operationalAudit/${blockedAt}_${id}_custody_blocked`]:operationalAuditRecord("block_cash_payment_without_custody","pettyVoucher",id,actor,{amount:value,available:custodyOut.fromCustody,shortfall:custodyOut.shortfall})});return;}}const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType, "pettyVoucher", id, [Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, value, 0, isAdvance?(after.recipient||"Supplier payment pending allocation"):posting.label), Financial.line(funding.account, 0, value, funding.kind==="undeposited"?"Paid from Undeposited Collection":(funding.kind==="cash_on_hand"?"Paid from Cash on Hand":"Paid from selected cash account"))], {occurredAt:cashPaymentOccurredAt(after),approvedAt:Number(after.approvedAt||Date.now()),actorName:after.approvedBy||"Manager",voucherNo:financeText(after.voucherNo,60),category:financeText(after.category,80),payee:financeText(after.recipient||after.requesterName,160),purpose:financeText(after.purpose,300),custodyAllocations:custodyOut.allocations,fundingAccountId:funding.id||"undeposited"}); await commitFinancial(db, `petty_${id}`, movement, actor, Object.assign({},custodyOut.writes,funding.kind==="undeposited"?{[`pettyCashVouchers/${id}/cashCustodyStatus`]:"allocated",[`pettyCashVouchers/${id}/cashCustodyAllocations`]:custodyOut.allocations,[`pettyCashVouchers/${id}/cashCustodyCheckedAt`]:Date.now()}:{[`pettyCashVouchers/${id}/cashCustodyStatus`]:"not_applicable",[`pettyCashVouchers/${id}/cashCustodyCheckedAt`]:Date.now()}));} if (after.voided === true && before.voided !== true && after.status === "approved" && value > 0) {const inflow = funding.kind==="undeposited"?poolCustodyInflowRecord(`petty_void_${id}`, value, isAdvance?"Supplier payment voided":"Expense voided", Number(after.voidedAt || Date.now()), `petty_void_${id}`):{}; const movement = Financial.movement(isAdvance?"revolving_fund_purchase_advance_void":posting.movementType+"_void", "pettyVoucher", id, [Financial.line(funding.account, value, 0, funding.kind==="undeposited"?"Returned to Undeposited Collection":"Returned to selected cash account"), Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, 0, value, isAdvance?"Reverse supplier payment":"Reverse "+posting.label)], {occurredAt:Number(after.voidedAt||Date.now()),actorName:"Manager",voucherNo:financeText(after.voucherNo,60),category:financeText(after.category,80),payee:financeText(after.recipient||after.requesterName,160),purpose:financeText(after.purpose,300)}); await commitFinancial(db, `petty_void_${id}`, movement, actor, inflow);}},
);
exports.onPettyReplenishmentFinancial = onValueWritten(
  {ref: "/pettyCashReplenishments/{replenishmentId}", region: ORDER_REGION, retry: true},
  async (event) => {if (!event.data.after.exists() || event.data.before.exists()) return; const row = event.data.after.val() || {}, value = Financial.money(row.amount); if (!(value > 0)) return; const id = event.params.replenishmentId, source = row.source === "register" ? "asset:register_cash" : "equity:owner_capital", movement = Financial.movement("petty_cash_replenishment", "pettyReplenishment", id, [Financial.line("asset:petty_cash", value, 0, "Revolving Fund replenished"), Financial.line(source, 0, value, row.source || "owner")], {occurredAt: Number(row.ts || Date.now()), actorName: row.by || "Admin"}); await commitFinancial(getDatabase(), `petty_replenish_${id}`, movement, {uid: "server", role: "server"});},
);
async function backfillPettyVoucher(db, id, row) {const value = Financial.money(row && row.amount), actor = {uid: "server", role: "server"}, isAdvance=row&&row.transactionType==="purchase_advance", posting=revolvingFundPosting(row), funding=isAdvance?advanceFundingAccount(row):{kind:"undeposited",account:"asset:cash_awaiting_deposit",id:"undeposited"}; if (!row || row.status !== "approved" || !(value > 0)) return; let custodyOut={writes:{},fromCustody:0,shortfall:0,allocations:{}};if(funding.kind==="undeposited"){custodyOut=await poolCustodyOutflow(db,value);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`Cash payment ${id} cannot be posted because ${custodyOut.shortfall.toFixed(2)} is no longer available in Undeposited Collection.`);}const detail={occurredAt:cashPaymentOccurredAt(row),approvedAt:Number(row.approvedAt||0),actorName:row.approvedBy||"Manager",voucherNo:financeText(row.voucherNo,60),category:financeText(row.category,80),payee:financeText(row.recipient||row.requesterName,160),purpose:financeText(row.purpose,300),custodyAllocations:custodyOut.allocations,fundingAccountId:funding.id||"undeposited"},expense = Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType, "pettyVoucher", id, [Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, value, 0, isAdvance?(row.recipient||"Supplier payment pending allocation"):posting.label), Financial.line(funding.account, 0, value, funding.kind==="undeposited"?"Paid from Undeposited Collection":(funding.kind==="cash_on_hand"?"Paid from Cash on Hand":"Paid from selected cash account"))], detail); await commitFinancial(db, `petty_${id}`, expense, actor, Object.assign({},custodyOut.writes,funding.kind==="undeposited"?{[`pettyCashVouchers/${id}/cashCustodyStatus`]:"allocated",[`pettyCashVouchers/${id}/cashCustodyAllocations`]:custodyOut.allocations,[`pettyCashVouchers/${id}/cashCustodyCheckedAt`]:Date.now()}:{[`pettyCashVouchers/${id}/cashCustodyStatus`]:"not_applicable",[`pettyCashVouchers/${id}/cashCustodyCheckedAt`]:Date.now()})); if (row.voided === true) {const inflow=funding.kind==="undeposited"?poolCustodyInflowRecord(`petty_void_${id}`,value,isAdvance?"Supplier payment voided":"Expense voided",Number(row.voidedAt||Date.now()),`petty_void_${id}`):{};const reversal = Financial.movement(isAdvance?"revolving_fund_purchase_advance_void":posting.movementType+"_void", "pettyVoucher", id, [Financial.line(funding.account, value, 0, funding.kind==="undeposited"?"Returned to Undeposited Collection":"Returned to selected cash account"), Financial.line(isAdvance?`asset:purchase_cash_advance:${id}`:posting.account, 0, value, isAdvance?"Reverse supplier payment":"Reverse "+posting.label)], {occurredAt:Number(row.voidedAt||Date.now()),actorName:"Manager",voucherNo:detail.voucherNo,category:detail.category,payee:detail.payee,purpose:detail.purpose}); await commitFinancial(db, `petty_void_${id}`, reversal, actor, inflow);}}
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
    if(action==="register_purchase"){
      const invoiceId=financeKey(data.invoiceId,"Purchase invoice ID"),invoice=(await db.ref(`/purchaseInvoices/${invoiceId}`).get()).val();if(!invoice)throw new HttpsError("not-found","Purchase invoice was not found.");if(invoice.reversed===true)throw new HttpsError("failed-precondition","A reversed purchase cannot create fixed assets.");if(Array.isArray(invoice.fixedAssetIds)&&invoice.fixedAssetIds.length){const existing=await Promise.all(invoice.fixedAssetIds.map((id)=>db.ref(`/fixedAssets/${financeKey(id,"Asset ID")}`).get()));if(existing.every((snap)=>snap.exists()))return{invoiceId,assetIds:invoice.fixedAssetIds,count:invoice.fixedAssetIds.length,duplicate:true};throw new HttpsError("failed-precondition","The purchase asset registration is incomplete. Repair the missing asset card before retrying.");}
      const acquisitionMovementId=financeText(invoice.paymentMovementId||invoice.fundingMovementId||(invoice.payableId?`purchase_ap_${invoiceId}`:""),160);if(!acquisitionMovementId||!(await db.ref(`/financialMovements/${acquisitionMovementId}`).get()).exists())throw new HttpsError("failed-precondition","Post the purchase funding or supplier obligation before registering its fixed assets.");
      const lines=Array.isArray(invoice.lines)?invoice.lines:[],writes={},assetIds=[];for(let lineIndex=0;lineIndex<lines.length;lineIndex++){const line=lines[lineIndex];if(!line||line.lineType!=="fixed_asset")continue;const qty=Math.round(Number(line.qty)||0);if(qty<1||qty>100||qty!==Number(line.qty))throw new HttpsError("invalid-argument","Fixed-asset quantity must be a whole number from 1 to 100.");const total=M(line.total),unitCost=M(total/qty),salvage=Math.max(0,M(line.salvagePerUnit||0)),life=Math.round(Number(line.usefulLifeMonths)||0),category=line.assetCategory==="furniture"?"furniture":"equipment",method=financeText(line.depreciationMethod||"straight-line",30);if(!(unitCost>0)||life<1||salvage>=unitCost||method!=="straight-line")throw new HttpsError("invalid-argument","Fixed-asset cost, salvage, life, or depreciation method is invalid.");const name=financeText(line.itemName,120),location=financeText(line.location,120),custodian=financeText(line.custodian,120),inServiceDate=financeDate(line.inServiceDate||invoice.date);if(!name||!location||!custodian)throw new HttpsError("invalid-argument","Asset name, location, and custodian are required.");for(let unitIndex=0;unitIndex<qty;unitIndex++){const assetId=financeKey(`fa_${invoiceId}_${lineIndex}_${unitIndex+1}`,"Asset ID");assetIds.push(assetId);writes[`fixedAssets/${assetId}`]={name:qty>1?`${name} #${unitIndex+1}`:name,category,cost:unitCost,salvage,usefulLifeMonths:life,method,acquiredDate:financeDate(invoice.date),inServiceDate,reference:financeText(invoice.ref,120),location,custodian,accumulatedDepreciation:0,status:"active",depreciation:{},movementId:acquisitionMovementId,purchaseInvoiceId:invoiceId,purchaseLineIndex:lineIndex,purchaseUnitIndex:unitIndex+1,fundingType:"purchase_invoice",createdBy:actor.uid,ts:now,schemaVersion:2};}}
      if(!assetIds.length)throw new HttpsError("failed-precondition","This purchase has no fixed-asset lines.");writes[`purchaseInvoices/${invoiceId}/fixedAssetIds`]=assetIds;writes[`purchaseInvoices/${invoiceId}/fixedAssetsRegisteredAt`]=now;writes[`purchaseInvoices/${invoiceId}/fixedAssetsRegisteredBy`]=actor.uid;await db.ref().update(writes);return{invoiceId,assetIds,count:assetIds.length,duplicate:false};
    }
    if (action === "create") {
      throw new HttpsError("failed-precondition", "New fixed assets must be acquired through Purchasing to prevent duplicate financial postings.");
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
        const a = assets[id]; if (!a || a.status !== "active") continue;if(period<String(a.inServiceDate||a.acquiredDate||"").slice(0,7))continue;
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
  async (request) => observeFinancialOperation(request, "postFinancialCommand", async () => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 40);
    const perms = action.indexOf("inventory_opening_balance") === 0 ? ["purchases", "cashflow"] : action.includes("payable") ? ["payables", "purchases"] : action.includes("receivable") ? ["receivables"] : ["cashflow", "receivables", "payables", "purchases"];
    const actor = await requirePortalPermission(db, request, perms); const commandId = financeKey(data.commandId, "Command ID");
    if(action==='cash_journal_edit_status'){
      if(!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError('permission-denied','A privileged Finance role is required to verify a cash-journal edit.');
      const editCommandId=financeKey(data.editCommandId,'Edit submission ID'),movementId=financeKey(data.originalMovementId,'Journal ID'),receipt=(await db.ref(`/cashJournalEditCommands/${editCommandId}`).get()).val();
      return{committed:!!(receipt&&receipt.movementId===movementId&&receipt.actorUid===actor.uid),movementId:receipt&&receipt.movementId||'',revision:Number(receipt&&receipt.revision||0)};
    }
    if(action==='cash_journal_history'){
      if(!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError('permission-denied','A privileged Finance role is required to view cash-journal revisions.');
      const id=financeKey(data.originalMovementId,'Journal ID');return{revisions:(await db.ref(`/cashJournalRevisions/${id}`).get()).val()||{}};
    }
    const accounts = (await db.ref("/cfAccounts").get()).val() || {}, chart = await ensureChartAccounts(db); const now = Date.now(); let movement, writes = {}, result = {}, depositReferenceClaim = null;
    function amount(v) { const x = Financial.money(v); if (!(x > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero."); return x; }
    function addCash(id, entry) { writes[`cfLedger/${id}`] = cashLedgerRecord(entry, commandId, movement, actor); }
    function manualCashWrites(target,movementId,mv,date,cashLines,category,party,reference){(cashLines||[]).forEach(({mapped,dr,cr,index})=>{if(mapped.cashKey==="float")return;const value=Financial.money(dr-cr);if(!value)return;const accountId=mapped.cashKey==="register"?"register":mapped.cashKey==="undeposited"?"undeposited":mapped.cashKey==="petty"?"petty":mapped.cashKey;target[`cfLedger/fm_${movementId}_${index}`]=cashLedgerRecord({date,accountId,dir:value>0?"in":"out",category,amount:Math.abs(value),party,ref:reference,auto:category!=="Manual journal"},movementId,mv,actor);});}
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
    } else if (action === "inventory_reconciliation_adjustment") {
      const inventory=(await db.ref("/inventory").get()).val()||{},journal=(await db.ref("/books/journal").get()).val()||{},reconciliation=BooksBridge.inventoryReconciliationSnapshot(inventory,journal),date=financeDate(data.date),today=financeDateFromTimestamp(Date.now());
      if(date!==today)throw new HttpsError("failed-precondition","Inventory reconciliation adjustments must use today’s verified stock valuation. Select today as the To date.");
      if(reconciliation.unmapped.length)throw new HttpsError("failed-precondition",`${reconciliation.unmapped.length} stock item(s) with value are missing an inventory account. Map them before auto-adjusting.`);
      if(Math.abs(reconciliation.clearingBalance)>=0.005)throw new HttpsError("failed-precondition",`Inventory Receiving Clearing 1290 is ${reconciliation.clearingBalance.toFixed(2)}. Finish or correct the receiving records before auto-adjusting inventory.`);
      const legacyGainNet=Financial.money(Object.values(journal).reduce((sum,entry)=>sum+(entry&&Array.isArray(entry.lines)?entry.lines:[]).reduce((lineSum,line)=>lineSum+(String(line.code||"")==="4995"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0),0)),legacyGainBalance=Financial.money(-legacyGainNet);
      const rows=reconciliation.rows.filter((row)=>row.code!=="1290"&&Math.abs(Number(row.difference)||0)>=0.005),rowFingerprint=rows.map((row)=>`${row.code}_${Number(row.difference)<0?"n":"p"}${Math.round(Math.abs(Number(row.difference)||0)*100)}`).join("_")||"balanced",legacyFingerprint=Math.abs(legacyGainNet)>=0.005?`_legacy4995_${legacyGainNet<0?"c":"d"}${Math.round(Math.abs(legacyGainNet)*100)}`:"",fingerprint=`${rowFingerprint}${legacyFingerprint}`,expectedFingerprint=financeText(data.expectedFingerprint,160);
      if(expectedFingerprint&&expectedFingerprint!==fingerprint)throw new HttpsError("failed-precondition","Inventory or Finance Books changed after preview. Refresh and run the current reconciliation again.");
      if(data.preview===true)return Object.assign({preview:true,fingerprint,adjustmentRows:rows,legacyGainBalance,legacyGainConsolidation:Math.abs(legacyGainNet)>=0.005},reconciliation);
      if(!rows.length&&Math.abs(legacyGainNet)<0.005)return Object.assign({alreadyReconciled:true,movementId:"",adjustment:0,fingerprint,legacyGainBalance:0},reconciliation);
      await ensureBooksChart(db);const movementId=financeKey(`inventory_reconciliation_${date.replace(/-/g,"")}_${fingerprint}`,"Inventory reconciliation movement ID"),existing=(await db.ref(`/financialMovements/${movementId}`).get()).val();
      if(existing)return Object.assign({movementId,duplicate:true,adjustment:Financial.money(existing.amount),fingerprint},reconciliation);
      const lines=[];if(Math.abs(legacyGainNet)>=0.005){const value=Math.abs(legacyGainNet);lines.push(Financial.line("coa:4995",legacyGainNet<0?value:0,legacyGainNet>0?value:0,"Consolidate legacy inventory reconciliation gain account"),Financial.line("coa:5905",legacyGainNet>0?value:0,legacyGainNet<0?value:0,"Move legacy inventory reconciliation balance into single net account"));writes["booksChart/4995/active"]=false;writes["booksChart/4995/note"]="Retired after consolidation into 5905 Inventory Reconciliation Gain / (Loss)";writes["booksChart/4995/consolidatedInto"]="5905";writes["booksChart/4995/consolidatedAt"]=now;}
      rows.forEach((row)=>{const difference=Financial.money(row.difference),label=`Inventory reconciliation ${row.code} · ${date}`;if(difference>0){lines.push(Financial.line(`coa:${row.code}`,difference,0,label),Financial.line("coa:5905",0,difference,`${label} gain`));}else{const value=Math.abs(difference);lines.push(Financial.line("coa:5905",value,0,`${label} loss`),Financial.line(`coa:${row.code}`,0,value,label));}});
      movement=Financial.movement("inventory_reconciliation_adjustment","inventoryReconciliation",fingerprint,lines,{occurredAt:accountingTimestamp(date,now),actorName:actor.role,reconciliationDate:date,reconciliationFingerprint:fingerprint,automatic:true});
      writes[`inventoryReconciliations/adjustments/${movementId}`]={movementId,date,fingerprint,stockValue:reconciliation.totalStock,booksValueBefore:reconciliation.totalBooks,adjustmentRows:rows,legacyGainBalance,legacyGainConsolidated:Math.abs(legacyGainNet)>=0.005,postingAccount:"5905",postedAt:now,postedBy:actor.uid,postedRole:actor.role,schemaVersion:2};
      const committed=await commitFinancial(db,movementId,movement,actor,writes);return Object.assign({movementId,duplicate:committed.duplicate,adjustment:Financial.money(movement.amount),fingerprint},reconciliation);
    } else if (action === "purchase_owner_funded") {
      const invoiceId = financeKey(data.invoiceId, "Purchase invoice ID"), invoice = (await db.ref(`/purchaseInvoices/${invoiceId}`).get()).val();
      if (!invoice) throw new HttpsError("not-found", "Purchase invoice was not found.");
      const supplierMaster=await requireActiveSupplier(db,invoice.supplierId,invoice.supplier);
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
      const supplierMaster=await requireActiveSupplier(db,invoice.supplierId,invoice.supplier);
      const requestedAccount = financeText(data.accountId, 120), advanceId = data.advanceId ? financeKey(data.advanceId, "Purchase advance ID") : "", savedAccount = financeText(invoice.accountId,120), fromCashOnHand = requestedAccount === "cash_on_hand", fromUndeposited = requestedAccount === "undeposited";
      if (!advanceId && savedAccount !== requestedAccount) throw new HttpsError("failed-precondition", "The selected payment account does not match the saved purchase record. Refresh and retry the same purchase.");
      if (!advanceId && (requestedAccount === "register" || requestedAccount === "cash_float")) throw new HttpsError("failed-precondition", "Register Cash is retired and Cash Float is controlled. Select Cash on Hand, Undeposited Collection, or an active bank/cash account.");
      const accountId = advanceId ? "" : (fromCashOnHand || fromUndeposited ? requestedAccount : accountIdFor(accounts, requestedAccount)), value = amount(invoice.total), date = financeDate(data.date), split = await purchaseInventoryLines(db, invoice, false); let cashAsset = fromCashOnHand ? "asset:register_cash" : fromUndeposited ? "asset:cash_awaiting_deposit" : `asset:cash_account:${accountId}`, custodyAllocations = {};
      if (fromCashOnHand) {const cash = await availableCashOnHandAboveFloat(db);if (value > cash.available + 0.009) throw new HttpsError("failed-precondition", `Purchase exceeds available Cash on Hand by ${Financial.money(value-cash.available).toFixed(2)}. The protected Register Cash Float of ${cash.float.toFixed(2)} cannot be used.`);}
      if (fromUndeposited) {const custodyOut = await poolCustodyOutflow(db, value);if (custodyOut.shortfall > 0.009) throw new HttpsError("failed-precondition", `Purchase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);Object.assign(writes,custodyOut.writes);custodyAllocations=custodyOut.allocations;Object.keys(custodyOut.allocations).forEach((id)=>{writes[`cashCustody/${id}/lastPaymentMovementId`]=commandId;});}
      if (advanceId) {const [shiftsSnap,fundSnap]=await Promise.all([db.ref("/shifts").get(),db.ref(`/pettyCashVouchers/${advanceId}`).get()]),shifts=shiftsSnap.val()||{};let found=null;for(const shiftId of Object.keys(shifts)){const rows=Array.isArray(shifts[shiftId].payOuts)?shifts[shiftId].payOuts:[];const index=rows.findIndex((row)=>row&&row.id===advanceId&&row.type==="purchase_advance");if(index>=0){found={kind:"shift",shiftId,index,row:rows[index]};break;}}if(!found&&fundSnap.exists()){const row=fundSnap.val()||{};if(row.transactionType==="purchase_advance"&&row.status==="approved"&&!row.voided)found={kind:"revolving",row};}if(!found)throw new HttpsError("not-found","Purchase cash advance was not found.");const allocations=found.row.allocations||{};if(allocations[invoiceId])throw new HttpsError("already-exists","This purchase is already allocated to the selected cash advance.");const allocated=Financial.money(Object.values(allocations).reduce((sum,row)=>sum+Number(row&&row.amount||0),0)),remaining=Financial.money(Number(found.row.amount||0)-allocated);if(value>remaining+0.009)throw new HttpsError("failed-precondition",`Purchase exceeds the remaining cash advance of ${remaining}.`);const next=Financial.money(remaining-value),base=found.kind==="shift"?`shifts/${found.shiftId}/payOuts/${found.index}`:`pettyCashVouchers/${advanceId}`;cashAsset=`asset:purchase_cash_advance:${advanceId}`;writes[`${base}/allocations/${invoiceId}`]={purchaseInvoiceId:invoiceId,amount:value,supplier:financeText(invoice.supplier,120),ref:financeText(invoice.ref,120),allocatedAt:now,allocatedBy:actor.uid};writes[`${base}/allocatedAmount`]=Financial.money(allocated+value);writes[`${base}/remainingAmount`]=next;writes[`${base}/allocationStatus`]=next>0?"partially_allocated":"fully_allocated";if(!(next>0))writes[`${base}/completedAt`]=now;writes[`purchaseInvoices/${invoiceId}/purchaseAdvanceId`]=advanceId;writes[`purchaseInvoices/${invoiceId}/advanceSource`]=found.kind;}
      if(advanceId){const supplierAdvance=(await db.ref(`/pettyCashVouchers/${advanceId}`).get()).val();if(supplierAdvance){if(!supplierAdvance.supplierId||supplierAdvance.supplierId!==supplierMaster.id)throw new HttpsError("failed-precondition","The selected advance payment belongs to a different supplier master record.");}}
      movement = Financial.movement("purchase_cash", "purchaseInvoice", invoiceId, split.concat([Financial.line(cashAsset, 0, value, invoice.supplier || "Inventory purchase")]), {occurredAt: Date.parse(`${date}T00:00:00+08:00`) || now, actorName: actor.role,supplierId:supplierMaster.id,supplierName:supplierMaster.name, accountId:advanceId?"purchase_advance":accountId, custodyAllocations});
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
      if(Array.isArray(data.lines))data.lines=data.lines.map(line=>Object.assign({},line,{code:String(line&&line.code||"")==="1030"?"1001":line&&line.code}));
      const manualCodes=new Set((Array.isArray(data.lines)?data.lines:[]).map((line)=>String(line&&line.code||""))),linkedDiscrepancyId=financeText(data.linkedDiscrepancyId,160),usesVarianceControl=manualCodes.has("1190")||manualCodes.has("2100")||manualCodes.has("6110");if(usesVarianceControl&&!linkedDiscrepancyId)throw new HttpsError("failed-precondition","Select Correct an Admin cash variance and link the exact shortage or overage before posting this control-account journal.");if(linkedDiscrepancyId&&!usesVarianceControl)throw new HttpsError("failed-precondition","A variance-linked journal must use Cash Shortage Under Review, Cash Overage Under Review, or Cash Short / Over.");if([...manualCodes].some((code)=>/^12[0-9]0$/.test(code)))throw new HttpsError("failed-precondition","Inventory control accounts must be corrected from Purchases so quantities, valuation, and Finance Books remain linked.");if(manualCodes.has("1100")||manualCodes.has("1110"))throw new HttpsError("failed-precondition","Receivable control accounts must be corrected from Receivables or the related sale so the customer or platform subledger remains linked.");
      const prepared=await prepareManualBooksJournal(db,data,accounts,actor),{memo,reference,date,lines,cashLines,debit,sensitive}=prepared;
      let linkedVariance=null;if(linkedDiscrepancyId){const discrepancyKey=financeKey(linkedDiscrepancyId,"Linked discrepancy ID"),discrepancy=(await db.ref(`/discrepancies/${discrepancyKey}`).get()).val();if(!discrepancy||discrepancy.kind!=="cash"||discrepancy.status==="reviewed")throw new HttpsError("failed-precondition","The selected cash variance is missing or already resolved.");const short=Number(discrepancy.variance)<0,total=Financial.money(Math.abs(Number(discrepancy.variance)||0)),resolved=Financial.money(discrepancy.resolvedAmount),remaining=Financial.money(total-resolved),controlCode=short?"1190":"2100",controlRows=(Array.isArray(data.lines)?data.lines:[]).filter((line)=>String(line&&line.code||"")===controlCode),controlAmount=Financial.money(controlRows.reduce((sum,line)=>sum+(short?Number(line.credit)||0:Number(line.debit)||0),0));if(controlRows.length!==1||!(controlAmount>0)||controlAmount>remaining+.009)throw new HttpsError("failed-precondition",`This journal must ${short?"credit Cash Shortage":"debit Cash Overage"} Under Review for no more than the remaining ${remaining.toFixed(2)}.`);const wrongDirection=controlRows.some((line)=>short?Number(line.debit)>0:Number(line.credit)>0);if(wrongDirection)throw new HttpsError("failed-precondition","The variance control-account direction is incorrect for the selected discrepancy.");linkedVariance={id:discrepancyKey,row:discrepancy,short,total,resolved,remaining,amount:controlAmount};}
      const occurredAt=accountingTimestamp(date,now);
      movement=Financial.movement("manual_books_journal","booksManualJournal",commandId,lines,{occurredAt,actorName:actor.role,reference,memo,linkedPayableId:prepared.linkedPayableId,linkedDiscrepancyId:linkedVariance&&linkedVariance.id||""});
      manualCashWrites(writes,commandId,movement,date,cashLines,"Manual journal",memo,reference);
      if(prepared.linkedPayableId){writes[`payables/${prepared.linkedPayableId}/status`]="reversed";writes[`payables/${prepared.linkedPayableId}/remainingAmount`]=0;writes[`payables/${prepared.linkedPayableId}/reversedAt`]=now;writes[`payables/${prepared.linkedPayableId}/reversalMovementId`]=commandId;}
      if(linkedVariance){const allocationId=`journal_${commandId}`,nextResolved=Financial.money(linkedVariance.resolved+linkedVariance.amount),nextRemaining=Financial.money(linkedVariance.total-nextResolved),status=nextRemaining>.009?"partially_resolved":"reviewed",allocation={id:allocationId,treatment:"finance_journal_correction",amount:linkedVariance.amount,correctionMovementId:commandId,reference,memo,approvedAt:now,approvedBy:actor.role,resolutionMovementId:commandId};writes[`financialControlLinks/correctionMovements/${commandId}`]={discrepancyId:linkedVariance.id,allocationId,amount:linkedVariance.amount,linkedAt:now,linkedBy:actor.role};writes[`cashDifferenceCases/${linkedVariance.id}/allocations/${allocationId}`]=allocation;writes[`cashDifferenceCases/${linkedVariance.id}/discrepancyId`]=linkedVariance.id;writes[`cashDifferenceCases/${linkedVariance.id}/shiftId`]=linkedVariance.row.shiftId;writes[`cashDifferenceCases/${linkedVariance.id}/kind`]=linkedVariance.short?"shortage":"overage";writes[`cashDifferenceCases/${linkedVariance.id}/originalAmount`]=linkedVariance.total;writes[`cashDifferenceCases/${linkedVariance.id}/resolvedAmount`]=nextResolved;writes[`cashDifferenceCases/${linkedVariance.id}/remainingAmount`]=nextRemaining;writes[`cashDifferenceCases/${linkedVariance.id}/status`]=status;writes[`discrepancies/${linkedVariance.id}/resolutionAllocations/${allocationId}`]=allocation;writes[`discrepancies/${linkedVariance.id}/resolvedAmount`]=nextResolved;writes[`discrepancies/${linkedVariance.id}/remainingAmount`]=nextRemaining;writes[`discrepancies/${linkedVariance.id}/status`]=status;writes[`discrepancies/${linkedVariance.id}/financialStatus`]=status;writes[`discrepancies/${linkedVariance.id}/reviewedAt`]=status==="reviewed"?now:null;writes[`discrepancies/${linkedVariance.id}/reviewedBy`]=actor.role;writes[`discrepancies/${linkedVariance.id}/note`]=memo;writes[`shifts/${financeKey(linkedVariance.row.shiftId,"Shift ID")}/varianceStatus`]=status;const undepositedDebit=Financial.money((Array.isArray(data.lines)?data.lines:[]).reduce((sum,line)=>sum+(String(line&&line.code||"")==="1030"?(Number(line.debit)||0):0),0));if(linkedVariance.short&&undepositedDebit>0){if(Math.abs(undepositedDebit-linkedVariance.amount)>.009)throw new HttpsError("failed-precondition","The Undeposited Collection debit must equal the linked shortage correction amount.");const custodyId=`cash_recovery_${linkedVariance.id}_${allocationId}`;writes[`cashCustody/${custodyId}`]={shiftId:linkedVariance.row.shiftId,staff:`Recovered cash · ${financeText(linkedVariance.row.staff,80)||"Finance"}`,amount:linkedVariance.amount,depositedAmount:0,remaining:linkedVariance.amount,retainedFloat:0,status:"awaiting_deposit",closedAt:occurredAt,movementId:commandId,source:"cash_shortage_recovery",discrepancyId:linkedVariance.id,allocationId,schemaVersion:3};writes[`cashDifferenceCases/${linkedVariance.id}/allocations/${allocationId}/recoveryCustodyId`]=custodyId;writes[`discrepancies/${linkedVariance.id}/resolutionAllocations/${allocationId}/recoveryCustodyId`]=custodyId;}}
      writes[`operationalAudit/${now}_manual_journal_${commandId}`]=operationalAuditRecord("post_manual_journal","booksManualJournal",commandId,actor,{amount:debit,reference,memo,date,sensitive});
      result={amount:debit,date};
    } else if(action==="correct_manual_journal"){
      const originalId=financeKey(data.originalMovementId,"Original movement ID"),original=(await db.ref(`/financialMovements/${originalId}`).get()).val();
      if(!original)throw new HttpsError("not-found","The journal entry was not found.");
      const priorClassification=(await db.ref(`/cashJournalEditCommands/${commandId}`).get()).val();
      if(priorClassification&&priorClassification.kind==='classification_only'){
        if(priorClassification.signature!==JournalReclassification.signature(originalId,data,actor))throw new HttpsError('failed-precondition','This submission ID was used for a different edit.');
        return{movementId:originalId,revision:priorClassification.revision,editedInPlace:true,duplicate:true};
      }
      if(CashJournalEdit.eligible(original)){
        const reason=financeText(data.reason,300),prepared=await prepareManualBooksJournal(db,data,accounts,actor),expectedRevision=Number(data.expectedRevision);
        if(data.expectedRevision==null||!Number.isInteger(expectedRevision))throw new HttpsError("failed-precondition","Refresh Books before editing this cash journal.");
        const input={id:originalId,commandId,expectedRevision,prepared:{date:prepared.date,memo:prepared.memo,reference:prepared.reference,lines:prepared.lines},actor,reason,now};
        const lockRef=db.ref('/financialControlLocks/cashJournalEdit'),lockToken=crypto.randomBytes(12).toString('hex'),lock=await lockRef.transaction(current=>!current||Number(current.claimedAt||0)<now-120000?{token:lockToken,commandId,claimedAt:now,actorUid:actor.uid}:current,undefined,false);
        if(!lock.committed||!lock.snapshot.exists()||lock.snapshot.val().token!==lockToken)throw new HttpsError('aborted','Another cash correction is being saved. Wait a moment, refresh, and try again.');
        try{
          const existingReceipt=(await db.ref(`/cashJournalEditCommands/${commandId}`).get()).val();
          if(existingReceipt){if(existingReceipt.signature!==CashJournalEdit.editSignature(input))throw new HttpsError('failed-precondition','This submission ID was already used for a different edit.');return{movementId:originalId,revision:existingReceipt.revision,editedInPlace:true,duplicate:true};}
          const shape=CashJournalEdit.shape(original.lines),primaryCashAccount=shape&&shape.kind==='cash_transfer'?shape.accounts[0]:shape&&shape.account,cashId=String(primaryCashAccount||'').startsWith('asset:cash_account:')?String(primaryCashAccount).slice(19):'register',oldDate=BooksBridge.businessDate(original.occurredAt||original.postedAt),dates=[...new Set([oldDate,prepared.date])];
          const [movementsSnap,custodySnap,ledgerSnap,journalSnap,cashMapSnap,periodsSnap,claimsSnap,linkSnap,accountsSnap,settingsSnap,shiftSnap,historySnap,depositRefsSnap,...indexSnaps]=await Promise.all([
            db.ref('/financialMovements').get(),db.ref('/cashCustody').get(),db.ref('/cfLedger').orderByChild('movementId').equalTo(originalId).get(),db.ref(`/books/journal/${originalId}`).get(),db.ref('/books/config/cashAccountMap').get(),db.ref('/accountingPeriods').get(),db.ref('/financialCommandClaims').orderByChild('status').equalTo('processing').get(),db.ref(`/financialControlLinks/correctionMovements/${originalId}`).get(),db.ref('/cfAccounts').get(),db.ref('/posSettings').get(),db.ref('/posActiveShift').get(),db.ref(`/cashJournalRevisions/${originalId}`).get(),db.ref(`/cashDepositReferences/${cashId}`).get(),...dates.map(date=>db.ref(`/financialCloseIndex/${date}`).get())
          ]);
          const indexes={};dates.forEach((date,index)=>{indexes[date]=indexSnaps[index].val()||{};});const closeIds=[...new Set(Object.values(indexes).flatMap(rows=>Object.keys(rows||{})))],closeSnaps=await Promise.all(closeIds.map(id=>db.ref(`/financialCloses/${id}`).get())),closes={};closeIds.forEach((id,index)=>{closes[id]=closeSnaps[index].val()||{};});
          const before={financialMovements:movementsSnap.val()||{},cashCustody:custodySnap.val()||{},cfLedger:ledgerSnap.val()||{},books:{journal:{[originalId]:journalSnap.val()},config:{cashAccountMap:cashMapSnap.val()||{}}},accountingPeriods:periodsSnap.val()||{},financialCommandClaims:claimsSnap.val()||{},financialControlLinks:{correctionMovements:linkSnap.exists()?{[originalId]:linkSnap.val()}:{}},cfAccounts:accountsSnap.val()||{},posSettings:settingsSnap.val()||{},posActiveShift:shiftSnap.val()||{},cashJournalRevisions:{[originalId]:historySnap.val()||{}},cashDepositReferences:{[cashId]:depositRefsSnap.val()||{}},financialCloseIndex:indexes,financialCloses:closes};
          const next=CashJournalEdit.revise(before,{...input,floatFloor:resolveRegisterFloat(before.posSettings,before.posActiveShift).amount}),writes=CashJournalEdit.revisionWrites(before,next,originalId,commandId);
          await safeFinancialUpdate(db,writes,'cash journal edit');
          return{movementId:originalId,revision:next.cashJournalEditCommands[commandId].revision,editedInPlace:true};
        }catch(error){if(error instanceof HttpsError)throw error;throw new HttpsError('failed-precondition',error.message||'The cash journal could not be saved. Refresh and retry.');}
        finally{try{await lockRef.transaction(current=>current&&current.token===lockToken?null:current,undefined,false);}catch(error){logger.error('Cash-journal edit lock release failed',{commandId,message:error.message});}}
      }
      const originalType=financeText(original.type,100),originalSourceType=financeText(original.sourceType,100),originalReference=financeText(original.reference||original.sourceId,120);
      if(originalSourceType==="order"||/^order_|^pos_/i.test(originalType)||/^POS-/i.test(originalReference))throw new HttpsError("failed-precondition","POS sale and COGS journals are system-controlled and cannot be edited.");
      const reason=financeText(data.reason,300);if(!reason)throw new HttpsError("invalid-argument","Correction reason is required.");
      const prepared=await prepareManualBooksJournal(db,data,accounts,actor,original.linkedPayableId?{id:original.linkedPayableId,movementId:originalId}:null),reverseId=`books_edit_reverse_${originalId}`,replacementId=commandId;
      if(JournalReclassification.allowed(original,prepared))return await reviseJournalClassification(db,originalId,data,prepared,actor,commandId,now);
      if(original.classificationRevision)throw new HttpsError('failed-precondition','Keep the date and all operational account balances unchanged when editing this reclassified journal.');
      const controlAccount=(account)=>/^asset:(register_cash|register_float|cash_awaiting_deposit|petty_cash|cash_account:|inventory|platform_receivable|other_receivable)/.test(String(account||""))||/^liability:(accounts_payable|customer_change_refund|due_to_|cash_overage)/.test(String(account||""))||/^coa:(1100|1110|1190|12\d0|1290|2000|2020|2030|2050|2090|2100|3000|3050|3100|3900)$/.test(String(account||""));
      const controlNet=(lines)=>{const out={};(lines||[]).forEach((line)=>{const account=String(line.account||"");if(controlAccount(account))out[account]=Financial.money((out[account]||0)+(Number(line.debit)||0)-(Number(line.credit)||0));});return out;};
      const before=controlNet(original.lines),after=controlNet(prepared.lines),controlKeys=new Set([...Object.keys(before),...Object.keys(after)]);for(const account of controlKeys)if(Math.abs(Financial.money(before[account])-Financial.money(after[account]))>.009)throw new HttpsError("failed-precondition","This edit changes a cash, payable, receivable, inventory, or equity control balance. Use that account's dedicated Admin or Finance workflow so its subledger changes with the journal.");
      if(original.reversedByMovementId&&original.reversedByMovementId!==reverseId)throw new HttpsError("failed-precondition","This journal has already been reversed or voided.");
      // A correction must remove the original from the period in which it was
      // posted. Dating both the reversal and replacement in the new period
      // leaves the old period wrong and only records a net change in the new
      // one. Closed-period controls can later redirect this to an approved
      // current-period adjustment; until then the original accounting date is
      // the only period-correct treatment.
      const originalDate=BooksBridge.businessDate(original.occurredAt||original.postedAt||now),reverseDate=financeDate(originalDate),reverseMovement=Financial.reverseMovement(Object.assign({id:originalId},original),"manual_books_journal_correction_reversal",reason);reverseMovement.occurredAt=accountingTimestamp(reverseDate,now);reverseMovement.actorName=actor.role;reverseMovement.reversalOf=originalId;reverseMovement.reason=reason;reverseMovement.correctionReplacementId=replacementId;
      const reverseCashLines=(reverseMovement.lines||[]).map((row,index)=>{const a=String(row.account||"");let cashKey="";if(a.indexOf("asset:cash_account:")===0)cashKey=a.slice(19);else if(a==="asset:register_cash")cashKey="register";else if(a==="asset:cash_awaiting_deposit")cashKey="undeposited";else if(a==="asset:petty_cash")cashKey="petty";return cashKey?{mapped:{cashKey},dr:row.debit,cr:row.credit,index}:null;}).filter(Boolean),reverseWrites={};manualCashWrites(reverseWrites,reverseId,reverseMovement,reverseDate,reverseCashLines,"Manual journal correction reversal",reason,financeText(original.reference||original.sourceId,120));reverseWrites[`financialMovements/${originalId}/reversedByMovementId`]=reverseId;reverseWrites[`financialMovements/${originalId}/correctionReplacementId`]=replacementId;reverseWrites[`books/journal/${originalId}/reversedByMovementId`]=reverseId;reverseWrites[`books/journal/${originalId}/correctionReplacementId`]=replacementId;if(original.linkedPayableId){reverseWrites[`payables/${original.linkedPayableId}/status`]="open";reverseWrites[`payables/${original.linkedPayableId}/remainingAmount`]=Financial.money((await db.ref(`/payables/${original.linkedPayableId}/amount`).get()).val());reverseWrites[`payables/${original.linkedPayableId}/reversalMovementId`]=null;reverseWrites[`payables/${original.linkedPayableId}/reversedAt`]=null;}await commitFinancial(db,reverseId,reverseMovement,actor,reverseWrites);
      const replacement=Financial.movement("manual_books_journal","booksManualJournal",replacementId,prepared.lines,{occurredAt:accountingTimestamp(prepared.date,now),actorName:actor.role,reference:prepared.reference,memo:prepared.memo,correctsMovementId:originalId,correctionReversalMovementId:reverseId,correctionReason:reason,linkedPayableId:prepared.linkedPayableId}),replacementWrites={};manualCashWrites(replacementWrites,replacementId,replacement,prepared.date,prepared.cashLines,"Manual journal correction",prepared.memo,prepared.reference);if(prepared.linkedPayableId){replacementWrites[`payables/${prepared.linkedPayableId}/status`]="reversed";replacementWrites[`payables/${prepared.linkedPayableId}/remainingAmount`]=0;replacementWrites[`payables/${prepared.linkedPayableId}/reversedAt`]=now;replacementWrites[`payables/${prepared.linkedPayableId}/reversalMovementId`]=replacementId;}replacementWrites[`operationalAudit/${now}_manual_journal_correct_${originalId}`]=operationalAuditRecord("correct_manual_journal","booksManualJournal",originalId,actor,{reversalMovementId:reverseId,replacementMovementId:replacementId,reason,date:prepared.date,amount:prepared.debit,linkedPayableId:prepared.linkedPayableId});const committed=await commitFinancial(db,replacementId,replacement,actor,replacementWrites);return{movementId:replacementId,reversalMovementId:reverseId,duplicate:committed.duplicate};
    } else if(action==="repair_late_manual_journal_correction"){
      const originalId=financeKey(data.originalMovementId,"Original movement ID"),original=(await db.ref(`/financialMovements/${originalId}`).get()).val();
      if(!original||original.type!=="manual_books_journal"||!original.correctionReplacementId||!original.reversedByMovementId)throw new HttpsError("failed-precondition","This is not a completed manual-journal correction.");
      if(original.linkedPayableId)throw new HttpsError("failed-precondition","Payable-linked journals must be repaired through the payable subledger.");
      const reversalId=financeKey(original.reversedByMovementId,"Correction reversal ID"),replacementId=financeKey(original.correctionReplacementId,"Correction replacement ID"),[reversalSnap,replacementSnap]=await Promise.all([db.ref(`/financialMovements/${reversalId}`).get(),db.ref(`/financialMovements/${replacementId}`).get()]),reversal=reversalSnap.val(),replacement=replacementSnap.val();
      if(!reversal||reversal.type!=="manual_books_journal_correction_reversal"||reversal.reversalOf!==originalId)throw new HttpsError("failed-precondition","The correction reversal does not match the original journal.");
      if(!replacement||replacement.type!=="manual_books_journal"||replacement.correctsMovementId!==originalId)throw new HttpsError("failed-precondition","The corrected replacement does not match the original journal.");
      const originalDate=financeDate(BooksBridge.businessDate(original.occurredAt||original.postedAt)),reversalDate=financeDate(BooksBridge.businessDate(reversal.occurredAt||reversal.postedAt));
      if(reversalDate<=originalDate)throw new HttpsError("failed-precondition","The correction reversal is already in the proper accounting period.");
      const cashAccount=(account)=>account==="asset:register_cash"||account==="asset:cash_awaiting_deposit"||account==="asset:petty_cash"||String(account||"").indexOf("asset:cash_account:")===0,originalLines=Array.isArray(original.lines)?original.lines:[];
      if(originalLines.length<2||originalLines.some((line)=>!cashAccount(line&&line.account))||Math.abs(originalLines.reduce((sum,line)=>sum+Number(line.debit||0)-Number(line.credit||0),0))>=.005)throw new HttpsError("failed-precondition","Only a balanced cash-to-cash correction can use this controlled repair.");
      const reason=financeText(data.reason,300);if(!reason)throw new HttpsError("invalid-argument","Repair reason is required.");
      const backdateId=`books_period_repair_backdate_${originalId}`,currentId=`books_period_repair_current_${originalId}`,repairRef=db.ref(`/manualJournalPeriodRepairs/${originalId}`),repairToken=crypto.randomBytes(12).toString("hex"),repairClaim=await repairRef.transaction((current)=>current||{status:"processing",token:repairToken,claimedAt:now,actorUid:actor.uid,schemaVersion:1});
      if(!repairClaim.committed||!repairClaim.snapshot.exists()||repairClaim.snapshot.val().token!==repairToken){const prior=repairClaim.snapshot.val()||{};if(prior.status==="repaired")return{duplicate:true,originalMovementId:originalId,backdateMovementId:prior.backdateMovementId,currentMovementId:prior.currentMovementId};throw new HttpsError("aborted","This correction repair is already being processed. Refresh and try again.");}
      try{
        const backdate=Financial.movement("manual_books_journal_period_repair_backdate","booksManualJournalPeriodRepair",originalId,originalLines.map((line)=>Financial.line(line.account,Number(line.credit)||0,Number(line.debit)||0,"Backdate correction reversal")),{occurredAt:accountingTimestamp(originalDate,now),actorName:actor.role,reference:financeText(original.reference||originalId,120),reason,repairsMovementId:reversalId});
        const current=Financial.movement("manual_books_journal_period_repair_current","booksManualJournalPeriodRepair",originalId,originalLines.map((line)=>Financial.line(line.account,Number(line.debit)||0,Number(line.credit)||0,"Neutralize late correction reversal")),{occurredAt:accountingTimestamp(reversalDate,now),actorName:actor.role,reference:financeText(original.reference||originalId,120),reason,repairsMovementId:reversalId});
        const writes={},cashRows=(mv)=>mv.lines.map((row,index)=>{const a=String(row.account||""),cashKey=a.indexOf("asset:cash_account:")===0?a.slice(19):a==="asset:register_cash"?"register":a==="asset:cash_awaiting_deposit"?"undeposited":a==="asset:petty_cash"?"petty":"";return cashKey?{mapped:{cashKey},dr:row.debit,cr:row.credit,index}:null;}).filter(Boolean);
        manualCashWrites(writes,backdateId,backdate,originalDate,cashRows(backdate),"Period correction repair",reason,financeText(original.reference||originalId,120));manualCashWrites(writes,currentId,current,reversalDate,cashRows(current),"Period correction repair",reason,financeText(original.reference||originalId,120));
        writes[`financialMovements/${backdateId}`]=financeRecord(backdateId,backdate,actor);writes[`financialMovements/${currentId}`]=financeRecord(currentId,current,actor);writes[`financialCommandClaims/${backdateId}`]={status:"posted",token:repairToken,claimedAt:now,postedAt:now,actorUid:actor.uid,schemaVersion:1};writes[`financialCommandClaims/${currentId}`]={status:"posted",token:repairToken,claimedAt:now,postedAt:now,actorUid:actor.uid,schemaVersion:1};writes[`financialMovements/${originalId}/lateCorrectionRepairId`]=originalId;writes[`books/journal/${originalId}/lateCorrectionRepairId`]=originalId;writes[`manualJournalPeriodRepairs/${originalId}`]={status:"repaired",token:repairToken,claimedAt:now,repairedAt:now,repairedBy:actor.uid,originalMovementId:originalId,reversalMovementId:reversalId,replacementMovementId:replacementId,backdateMovementId:backdateId,currentMovementId:currentId,originalDate,reversalDate,reason,schemaVersion:1};writes[`operationalAudit/${now}_repair_late_manual_correction_${originalId}`]=operationalAuditRecord("repair_late_manual_journal_correction","booksManualJournal",originalId,actor,{reversalMovementId:reversalId,replacementMovementId:replacementId,backdateMovementId:backdateId,currentMovementId:currentId,originalDate,reversalDate,reason,accounting:"Neutralize the original on its accounting date and the late mechanical reversal on its posted date; corrected replacement remains authoritative."});
        await db.ref().update(writes);return{duplicate:false,originalMovementId:originalId,backdateMovementId:backdateId,currentMovementId:currentId,originalDate,reversalDate};
      }catch(error){await repairRef.transaction((current)=>current&&current.token===repairToken&&current.status==="processing"?null:current);throw error;}
    } else if(action==="reverse_manual_journal"||action==="void_manual_journal"){
      const originalId=financeKey(data.originalMovementId,"Original movement ID"),original=(await db.ref(`/financialMovements/${originalId}`).get()).val();
      const originalShape=original&&CashJournalEdit.shape(original.lines),cashTransfer=!!original&&original.type==="cash_transfer"&&originalShape&&originalShape.kind==="cash_transfer",manualCash=!!original&&original.type==="manual_cash";
      if(!original||(!cashTransfer&&!manualCash&&original.type!=="manual_books_journal"))throw new HttpsError("failed-precondition","Only a user-entered manual Books journal or cash transfer can be voided or reversed here.");
      if((cashTransfer||manualCash)&&!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError("permission-denied","A privileged Finance role must approve a manual cash-journal void or reversal.");
      if(original.classificationRevision)throw new HttpsError('failed-precondition','This journal has audited classification revisions. Use Edit / correct or its original source workflow.');
      if(Number(original.revision)>0&&CashJournalEdit.eligible(original))throw new HttpsError('failed-precondition','This revised cash journal maintains a linked custody pool. Use Edit / correct; journal-only void or reversal would break that link.');
      const isVoid=action==="void_manual_journal",reverseId=`books_${isVoid?"void":"reverse"}_${originalId}`,existingReverse=(await db.ref(`/financialMovements/${reverseId}`).get()).val();if(existingReverse)return{movementId:reverseId,duplicate:true};if(original.reversedByMovementId)throw new HttpsError("failed-precondition","This journal has already been reversed, voided, or corrected.");
      const reason=financeText(data.reason,300),date=isVoid?financeDate(BooksBridge.businessDate(original.occurredAt||original.postedAt||now)):financeDate(data.date);if(!reason)throw new HttpsError("invalid-argument","Reversal reason is required.");
      if(cashTransfer){
        const journal=(await db.ref(`/books/journal/${originalId}`).get()).val()||{},ledger=(await db.ref('/cfLedger').orderByChild('movementId').equalTo(originalId).get()).val()||{},locked=(row)=>!!row&&(row.bankReconciled===true||row.reconciled===true||!!row.reconciledAt||!!row.bankReconciliationId||!!row.statementId);
        if(isVoid&&(locked(original)||locked(journal)||Object.values(ledger).some(locked)))throw new HttpsError("failed-precondition","This cash transfer is already bank-reconciled and cannot be voided on its original date. Use Reverse to record the later correction.");
        for(const account of originalShape.accounts){const cashId=account.slice(19),row=accounts[cashId];if(!row||row.active===false)throw new HttpsError("failed-precondition","A cash account in this transfer is missing or inactive.");if(isVoid&&(locked(row)||(row.reconciledThrough&&date<=row.reconciledThrough)))throw new HttpsError("failed-precondition","This cash transfer falls within a bank-reconciled period and cannot be voided on its original date. Use Reverse to record the later correction.");}
        const all=(await db.ref('/financialMovements').get()).val()||{},balance=(account)=>Financial.money(Object.values(all).reduce((sum,m)=>sum+(m.lines||[]).reduce((net,line)=>net+(line.account===account?Number(line.debit||0)-Number(line.credit||0):0),0),0));
        for(const line of original.lines){const after=Financial.money(balance(line.account)-Number(line.debit||0)+Number(line.credit||0));if(after<-.009)throw new HttpsError("failed-precondition","Voiding this transfer would make a cash account negative. Reconcile the missing cash activity or opening balance first.");}
      }
      const occurredAt=accountingTimestamp(date,now);
      movement=Financial.reverseMovement(Object.assign({id:originalId},original),cashTransfer?(isVoid?"cash_transfer_void":"cash_transfer_reversal"):manualCash?(isVoid?"manual_cash_void":"manual_cash_reversal"):isVoid?"manual_books_journal_void":"manual_books_journal_reversal",reason);movement.occurredAt=occurredAt;movement.actorName=actor.role;movement.reversalOf=originalId;movement.reason=reason;movement.voided=isVoid;
      (movement.lines||[]).forEach((row,index)=>{const a=String(row.account||""),value=Financial.money(Number(row.debit||0)-Number(row.credit||0));let accountId="";if(a.indexOf("asset:cash_account:")===0)accountId=a.slice(19);else if(a==="asset:register_cash")accountId="register";else if(a==="asset:cash_awaiting_deposit")accountId="undeposited";else if(a==="asset:petty_cash")accountId="petty";if(accountId&&value)addCash(`fm_${reverseId}_${index}`,{date,accountId,dir:value>0?"in":"out",category:"Manual journal reversal",amount:Math.abs(value),party:reason,ref:financeText(original.reference||original.sourceId,120),auto:true});});
      writes[`financialMovements/${originalId}/reversedByMovementId`]=reverseId;writes[`financialMovements/${originalId}/${isVoid?"voidedAt":"reversedAt"}`]=now;writes[`books/journal/${originalId}/reversedByMovementId`]=reverseId;writes[`books/journal/${originalId}/${isVoid?"voidedAt":"reversedAt"}`]=now;if(original.linkedPayableId){const payable=(await db.ref(`/payables/${original.linkedPayableId}`).get()).val()||{};if(payable.reversalMovementId!==originalId)throw new HttpsError("failed-precondition","The linked payable no longer matches this journal. Refresh and review before continuing.");writes[`payables/${original.linkedPayableId}/status`]="open";writes[`payables/${original.linkedPayableId}/remainingAmount`]=Financial.money(payable.amount);writes[`payables/${original.linkedPayableId}/reversalMovementId`]=null;writes[`payables/${original.linkedPayableId}/reversedAt`]=null;}
      const varianceLink=(await db.ref(`/financialControlLinks/correctionMovements/${originalId}`).get()).val();if(varianceLink){const discrepancyId=financeKey(varianceLink.discrepancyId,"Linked discrepancy ID"),allocationId=financeKey(varianceLink.allocationId,"Variance allocation ID"),discrepancy=(await db.ref(`/discrepancies/${discrepancyId}`).get()).val()||{},allocation=((discrepancy.resolutionAllocations||{})[allocationId])||{},custodyId=financeText(allocation.recoveryCustodyId,180);if(custodyId){const custody=(await db.ref(`/cashCustody/${custodyId}`).get()).val()||{};if(Number(custody.depositedAmount)>0||Number(custody.remaining)+.009<Number(custody.amount))throw new HttpsError("failed-precondition","This variance correction has already been deposited or settled. Reverse that settlement first.");writes[`cashCustody/${custodyId}`]=null;}const total=Financial.money(Math.abs(Number(discrepancy.variance)||0)),nextResolved=Math.max(0,Financial.money(Number(discrepancy.resolvedAmount)-Number(varianceLink.amount))),nextRemaining=Financial.money(total-nextResolved),nextStatus=nextResolved>.009?"partially_resolved":"pending_manager_reconciliation";writes[`financialControlLinks/correctionMovements/${originalId}`]=null;writes[`cashDifferenceCases/${discrepancyId}/allocations/${allocationId}`]=null;writes[`cashDifferenceCases/${discrepancyId}/resolvedAmount`]=nextResolved;writes[`cashDifferenceCases/${discrepancyId}/remainingAmount`]=nextRemaining;writes[`cashDifferenceCases/${discrepancyId}/status`]=nextStatus;writes[`discrepancies/${discrepancyId}/resolutionAllocations/${allocationId}`]=null;writes[`discrepancies/${discrepancyId}/resolvedAmount`]=nextResolved;writes[`discrepancies/${discrepancyId}/remainingAmount`]=nextRemaining;writes[`discrepancies/${discrepancyId}/status`]=nextStatus;writes[`discrepancies/${discrepancyId}/financialStatus`]=nextStatus;writes[`discrepancies/${discrepancyId}/reviewedAt`]=null;if(discrepancy.shiftId)writes[`shifts/${financeKey(discrepancy.shiftId,"Shift ID")}/varianceStatus`]=nextStatus;}
      writes[`operationalAudit/${now}_manual_journal_${isVoid?"void":"reverse"}_${originalId}`]=operationalAuditRecord(action,cashTransfer?"cashTransfer":manualCash?"manualCash":"booksManualJournal",originalId,actor,{reversalMovementId:reverseId,reason,date,linkedPayableId:original.linkedPayableId||"",linkedDiscrepancyId:varianceLink&&varianceLink.discrepancyId||"",accounting:cashTransfer?(isVoid?"Void the invalid transfer on its original accounting date; reverse both cash-account legs; retain the source and linked void for audit.":"Reverse a previously valid transfer on the current accounting date; reverse both cash-account legs; retain the source and linked reversal for audit."):""});
      const committed=await commitFinancial(db,reverseId,movement,actor,writes);return{movementId:reverseId,duplicate:committed.duplicate};
    } else if (action === "manual") {
      const accountId = accountIdFor(accounts, data.accountId), value = amount(data.amount), dir = data.dir === "out" ? "out" : "in", selected = data.offsetAccountId ? chartAccountFor(chart, data.offsetAccountId) : chartAccountFromLegacy(chart, data.category, dir), category = financeText(selected.row.name, 80), asset = `asset:cash_account:${accountId}`, offset = `${selected.row.type}:${selected.id}`,reference=financeText(data.ref,120);
      movement = Financial.movement("manual_cash", "manual", commandId, dir === "in" ? [Financial.line(asset, value, 0, category), Financial.line(offset, 0, value, category)] : [Financial.line(offset, value, 0, category), Financial.line(asset, 0, value, category)], {occurredAt: accountingTimestamp(data.date,now), actorName: financeText(data.actorName || ""),reference});
      addCash(`fm_${commandId}`, {date: financeDate(data.date), accountId, dir, category, amount: value, party: data.party, ref: data.ref, auto: false});
    } else if (action === "transfer") {
      const from = accountIdFor(accounts, data.fromAccountId), to = accountIdFor(accounts, data.toAccountId); if (from === to) throw new HttpsError("invalid-argument", "Transfer accounts must be different."); const value = amount(data.amount), date = financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument","Transfer reference is required.");
      movement = Financial.movement("cash_transfer", "transfer", commandId, [Financial.line(`asset:cash_account:${to}`, value, 0, "Transfer in"), Financial.line(`asset:cash_account:${from}`, 0, value, "Transfer out")], {occurredAt: accountingTimestamp(date,now),reference});
      addCash(`fm_${commandId}_out`, {date, accountId: from, dir: "out", category: "Transfer", amount: value, party: `→ ${financeText(accounts[to].name)}`,ref:reference}); addCash(`fm_${commandId}_in`, {date, accountId: to, dir: "in", category: "Transfer", amount: value, party: `← ${financeText(accounts[from].name)}`,ref:reference});
    } else if (action === "close_customer_payable_to_capital") {
      const docId=financeKey(data.documentId,"Payable ID"),doc=(await db.ref(`/payables/${docId}`).get()).val();if(!doc)throw new HttpsError("not-found","The customer payable was not found.");if(doc.type!=="customer_change_refund")throw new HttpsError("failed-precondition","Only a Customer Change / Refund Payable can use this correction.");if(doc.status!=="open")throw new HttpsError("failed-precondition","This customer payable is no longer open.");
      const value=Financial.money(doc.remainingAmount!=null?doc.remainingAmount:doc.amount),date=financeDate(data.date),reference=financeText(data.ref,120),reason=financeText(data.reason,300),ownerName=financeText(data.ownerName,120);if(!(value>0))throw new HttpsError("failed-precondition","This customer payable has no remaining balance.");if(!reference||!reason||!ownerName)throw new HttpsError("invalid-argument","Owner or partner, correction reference, and reason are required.");await assertAccountingPeriodOpen(db,date,"closing this customer payable to Owner's Capital");
      movement=Financial.movement("customer_change_payable_closed_to_capital","payables",docId,[Financial.line(doc.liabilityAccount||`liability:customer_change_refund:${docId}`,value,0,"Close customer payable"),Financial.line("equity:capital_in",0,value,"Owner's Capital correction")],{occurredAt:accountingTimestamp(date,now),reference,reason,ownerName,originalMovementId:financeText(doc.movementId,160),sourceReference:financeText(doc.ref,120)});
      writes[`payables/${docId}/status`]="capital_closed";writes[`payables/${docId}/remainingAmount`]=0;writes[`payables/${docId}/capitalClosedAmount`]=value;writes[`payables/${docId}/capitalClosedAt`]=now;writes[`payables/${docId}/capitalClosedBy`]=actor.uid;writes[`payables/${docId}/capitalClosedOwner`]=ownerName;writes[`payables/${docId}/capitalCloseReason`]=reason;writes[`payables/${docId}/capitalCloseReference`]=reference;writes[`payables/${docId}/settlementMovementId`]=commandId;
      if(doc.discrepancyId){writes[`discrepancies/${doc.discrepancyId}/financialStatus`]="closed_to_capital";writes[`discrepancies/${doc.discrepancyId}/customerRefundPayableId`]=docId;writes[`discrepancies/${doc.discrepancyId}/capitalCloseMovementId`]=commandId;writes[`discrepancies/${doc.discrepancyId}/capitalCloseReason`]=reason;}if(doc.shiftId)writes[`shifts/${doc.shiftId}/varianceStatus`]="closed_to_capital";
      writes[`operationalAudit/${now}_customer_payable_capital_${docId}`]=operationalAuditRecord("close_customer_payable_to_capital","payables",docId,actor,{amount:value,ownerName,reference,reason,originalMovementId:doc.movementId||"",correctionMovementId:commandId});result={documentId:docId,amount:value,status:"capital_closed"};
    } else if (action === "create_receivable" || action === "create_payable") {
      const isAr = action === "create_receivable", docId = financeKey(data.documentId, isAr ? "Receivable ID" : "Payable ID"), value = amount(data.amount), supplierMaster=isAr?null:await requireActiveSupplier(db,data.supplierId,data.party),party = supplierMaster?supplierMaster.name:financeText(data.party, 120), documentType = financeText(data.type || "other", 60).toLowerCase(),reference=financeText(data.ref,120); if (!party) throw new HttpsError("invalid-argument", "Party is required.");if(!reference)throw new HttpsError("invalid-argument",`${isAr?"Receivable":"Bill or invoice"} reference is required.`);
      if (!isAr && ["inventory","inventory_pending_invoice","purchases"].includes(documentType)) throw new HttpsError("failed-precondition", "Inventory payables must be created from Purchases so the stock receipt, valuation, and supplier liability stay linked.");
      movement = Financial.movement(isAr ? "receivable_created" : "payable_created", isAr ? "receivable" : "payable", docId, isAr ? [Financial.line(`asset:receivable:${docId}`, value, 0, party), Financial.line(`revenue:${documentType}`, 0, value, party)] : [Financial.line(`expense_or_inventory:${documentType}`, value, 0, party), Financial.line(`liability:payable:${docId}`, 0, value, party)], {occurredAt: accountingTimestamp(data.date,now),reference,supplierId:supplierMaster?supplierMaster.id:"",supplierName:supplierMaster?supplierMaster.name:""});
      const record = {supplierId:supplierMaster?supplierMaster.id:"",party, type: documentType, amount: value, date: financeDate(data.date), due: data.due ? financeDate(data.due, true) : "", ref: reference, status: "open", movementId: commandId, ts: now, createdBy: actor.uid, schemaVersion: supplierMaster?2:1}; writes[`${isAr ? "receivables" : "payables"}/${docId}`] = record; result.documentId = docId;
    } else if (["collect_receivable", "pay_payable", "reverse_receivable", "reverse_payable"].includes(action)) {
      const isAr = action.includes("receivable"), isReverse = action.startsWith("reverse_"), docId = financeKey(data.documentId, "Document ID"), path = isAr ? "receivables" : "payables", snap = await db.ref(`/${path}/${docId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Financial document not found."); const doc = snap.val(); if (doc.status !== "open") throw new HttpsError("failed-precondition", "This document is no longer open."); if (!isAr && doc.provisional === true && !isReverse) throw new HttpsError("failed-precondition", "Finalize the supplier invoice before paying this provisional obligation."); if (!isAr && (doc.purchaseInvoiceId||doc.fixedAssetId||doc.personalFundingId) && isReverse) throw new HttpsError("failed-precondition", "Reverse this owner/partner obligation from its source transaction so the cost and funding remain synchronized."); const customerRefund=!isAr&&doc.type==="customer_change_refund",remaining=Financial.money(doc.remainingAmount!=null?doc.remainingAmount:doc.amount);if(customerRefund&&isReverse&&Number(doc.paidAmount||0)>0)throw new HttpsError("failed-precondition","A partly refunded customer payable cannot be reversed. Settle the remaining balance or post a documented correction so completed refunds remain in the audit trail.");const value=customerRefund&&!isReverse?amount(data.amount||remaining):amount(remaining);if(customerRefund&&value>remaining+0.009)throw new HttpsError("failed-precondition",`Refund exceeds the remaining customer payable by ${Financial.money(value-remaining).toFixed(2)}.`);
      if (isReverse) {
        movement = Financial.movement(isAr ? "receivable_reversed" : "payable_reversed", path, docId, isAr ? [Financial.line(`revenue:${doc.type || "other"}`, value, 0, "Reverse receivable"), Financial.line(`asset:receivable:${docId}`, 0, value, "Reverse receivable")] : [Financial.line(doc.liabilityAccount||`liability:payable:${docId}`, value, 0, "Reverse payable"), Financial.line(doc.reversalOffsetAccount||`expense_or_inventory:${doc.type || "other"}`, 0, value, "Reverse payable")], {occurredAt: now}); writes[`${path}/${docId}/status`] = "reversed"; writes[`${path}/${docId}/remainingAmount`] = 0; writes[`${path}/${docId}/reversedAt`] = now; writes[`${path}/${docId}/reversalMovementId`] = commandId;if(customerRefund&&doc.discrepancyId){writes[`discrepancies/${doc.discrepancyId}/status`]="open";writes[`discrepancies/${doc.discrepancyId}/financialStatus`]="pending_manager_review";writes[`discrepancies/${doc.discrepancyId}/customerRefundPayableId`]=null;writes[`discrepancies/${doc.discrepancyId}/payableReversalMovementId`]=commandId;if(doc.shiftId)writes[`shifts/${doc.shiftId}/varianceStatus`]="pending_manager_review";}
      } else {
        const date=financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument",`${isAr?"Collection":"Payment"} reference is required.`);let accountId="",asset="",ownerName="",custodyAllocations={};
        if(isAr){accountId=accountIdFor(accounts,data.accountId);asset=`asset:cash_account:${accountId}`;}
        else {const source=financeText(data.paymentSource||data.accountId,120);if(source==="cash_float"||source==="register")throw new HttpsError("failed-precondition","Register Cash Float is protected and cannot be used to pay bills.");if(source==="owner_capital"){ownerName=financeText(data.ownerName,120);if(!ownerName)throw new HttpsError("invalid-argument","Owner or partner name is required for a personally paid bill.");accountId="owner_capital";asset="equity:capital_in";}else if(source==="cash_on_hand"){accountId=source;asset="asset:register_cash";}else if(source==="undeposited"){accountId=source;asset="asset:cash_awaiting_deposit";const custodyOut=await poolCustodyOutflow(db,value);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`Bill payment exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);Object.assign(writes,custodyOut.writes);custodyAllocations=custodyOut.allocations;Object.keys(custodyAllocations).forEach((id)=>{writes[`cashCustody/${id}/lastPaymentMovementId`]=commandId;});}else if(source==="revolving_fund"){accountId=source;asset="asset:petty_cash";}else{accountId=accountIdFor(accounts,source);asset=`asset:cash_account:${accountId}`;}}
        const label=isAr?"AR collection":ownerName?`AP paid personally by ${ownerName}`:(doc.type==="owner reimbursement"?"Owner/partner reimbursement":"AP payment"),extra={occurredAt:accountingTimestamp(date,now),reference,sourceReference:financeText(doc.ref,120),paymentSource:accountId};if(ownerName)extra.ownerName=ownerName;if(Object.keys(custodyAllocations).length)extra.custodyAllocations=custodyAllocations;
        movement=Financial.movement(isAr?"receivable_collected":(customerRefund?"customer_change_refunded":ownerName?"payable_paid_owner_capital":"payable_paid"),path,docId,isAr?[Financial.line(asset,value,0,"AR collection"),Financial.line(`asset:receivable:${docId}`,0,value,"AR collection")]:[Financial.line(doc.liabilityAccount||`liability:payable:${docId}`,value,0,customerRefund?"Customer change / refund paid":label),Financial.line(asset,0,value,customerRefund?"Customer change / refund paid":label)],extra);
        if(!ownerName)addCash(`fm_${commandId}`,{date,accountId,dir:isAr?"in":"out",category:isAr?"AR collection":customerRefund?"Customer refund":(doc.type==="owner reimbursement"?"Owner/partner reimbursement":"AP payment"),amount:value,party:doc.party,ref:reference});const nextRemaining=customerRefund?Financial.money(remaining-value):0,nextPaid=customerRefund?Financial.money(Number(doc.paidAmount||0)+value):value;writes[`${path}/${docId}/status`]=isAr?"collected":nextRemaining>0?"open":"paid";writes[`${path}/${docId}/remainingAmount`]=nextRemaining;writes[`${path}/${docId}/paidAmount`]=nextPaid;writes[`${path}/${docId}/${isAr?"collectedAt":"paidAt"}`]=now;writes[`${path}/${docId}/settlementReference`]=reference;writes[`${path}/${docId}/settlementMovementId`]=commandId;writes[`${path}/${docId}/accountId`]=accountId;if(customerRefund){writes[`${path}/${docId}/settlements/${commandId}`]={amount:value,date,reference,accountId,movementId:commandId,ts:now,createdBy:actor.uid};if(doc.discrepancyId){writes[`discrepancies/${doc.discrepancyId}/refundPaidAmount`]=nextPaid;writes[`discrepancies/${doc.discrepancyId}/refundRemainingAmount`]=nextRemaining;writes[`discrepancies/${doc.discrepancyId}/financialStatus`]=nextRemaining>0?"partially_refunded":"refunded";}if(doc.shiftId)writes[`shifts/${doc.shiftId}/varianceStatus`]=nextRemaining>0?"partially_refunded":"refunded";}if(ownerName)writes[`${path}/${docId}/paidPersonallyBy`]=ownerName;
      }
    } else if (action === "payout_deposit") {
      const payoutId = financeKey(data.payoutId, "Payout ID"), snap = await db.ref(`/platformPayouts/${payoutId}`).get(); if (!snap.exists()) throw new HttpsError("not-found", "Payout not found."); const payout = snap.val(); if (payout.reversed) throw new HttpsError("failed-precondition","A reversed payout cannot be deposited."); if (payout.depositMovementId) throw new HttpsError("already-exists", "This payout deposit is already recorded."); const accountId = accountIdFor(accounts, data.accountId), value = amount(payout.actualPayout),date=financeDate(data.date),reference=financeText(data.ref,120);if(!reference)throw new HttpsError("invalid-argument","Bank transaction or platform statement reference is required.");
      movement = Financial.movement("platform_payout_deposit", "platformPayout", payoutId, [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Platform payout deposit"), Financial.line(`asset:platform_clearing:${payout.channel}`, 0, value, "Clear platform payout")], {occurredAt: accountingTimestamp(date,now),reference}); addCash(`fm_${commandId}`, {date, accountId, dir: "in", category: "Platform payout", amount: value, party: payout.channel, ref: reference}); writes[`platformPayouts/${payoutId}/depositMovementId`] = commandId; writes[`platformPayouts/${payoutId}/depositReference`] = reference; writes[`platformPayouts/${payoutId}/depositedAt`] = now; writes[`platformPayouts/${payoutId}/accountId`] = accountId;
    } else if (action === "cash_deposit") {
      const accountId = accountIdFor(accounts, data.accountId), allocations = data.allocations || {}, ids = Object.keys(allocations); if (!ids.length) throw new HttpsError("invalid-argument", "Select cash custody records to deposit."); let value = 0; for (const id of ids) {const key = financeKey(id, "Custody ID"), row = (await db.ref(`/cashCustody/${key}`).get()).val(); if (!row) throw new HttpsError("not-found", `Cash custody ${key} was not found.`); const use = amount(allocations[id]), remaining = Financial.money(row.remaining != null ? row.remaining : row.amount); if (use > remaining + 0.009) throw new HttpsError("failed-precondition", `Deposit exceeds remaining custody for ${key}.`); value = Financial.money(value + use); const next = Financial.money(remaining - use); writes[`cashCustody/${key}/depositedAmount`] = Financial.money(Number(row.depositedAmount || 0) + use); writes[`cashCustody/${key}/remaining`] = next; writes[`cashCustody/${key}/status`] = next > 0 ? "partially_deposited" : "deposited"; writes[`cashCustody/${key}/lastDepositMovementId`] = commandId; writes[`cashCustody/${key}/lastDepositAt`] = now; }
      const depositReference = financeText(data.reference, 120); if (!depositReference) throw new HttpsError("invalid-argument", "Deposit slip or transfer reference is required.");const depositDate=financeDate(data.date),referenceKey=crypto.createHash("sha256").update(`${accountId}|${depositReference.trim().toLowerCase()}`).digest("hex"),referenceRef=db.ref(`/cashDepositReferences/${accountId}/${referenceKey}`),referenceToken=crypto.randomBytes(12).toString("hex"),referenceClaim=await referenceRef.transaction((current)=>{if(!current)return{status:"processing",token:referenceToken,movementId:commandId,claimedAt:now,actorUid:actor.uid,schemaVersion:1};if(current.status==="processing"&&Number(current.claimedAt||0)<now-300000)return{status:"processing",token:referenceToken,movementId:commandId,claimedAt:now,actorUid:actor.uid,schemaVersion:1};return current;}),referenceState=referenceClaim.snapshot.val()||{};
      if(!referenceClaim.committed||referenceState.token!==referenceToken){if(referenceState.status==="posted")return{movementId:referenceState.movementId,duplicate:true,amount:Number(referenceState.amount)||0,date:referenceState.date||""};throw new HttpsError("aborted","This deposit reference is already being processed. Refresh before trying again.");}
      depositReferenceClaim={ref:referenceRef,token:referenceToken};writes[`cashDepositReferences/${accountId}/${referenceKey}`]={status:"posted",token:referenceToken,movementId:commandId,amount:value,date:depositDate,reference:depositReference,claimedAt:now,postedAt:now,actorUid:actor.uid,schemaVersion:1};
      movement = Financial.movement("register_cash_deposit", "cashCustody", ids.join("_"), [Financial.line(`asset:cash_account:${accountId}`, value, 0, "Register cash deposited"), Financial.line("asset:cash_awaiting_deposit", 0, value, "Clear cash custody")], {occurredAt: accountingTimestamp(depositDate,now),actorName:actor.role,reference:depositReference,accountId,custodyAllocations:allocations}); addCash(`fm_${commandId}`, {date: depositDate, accountId, dir: "in", category: "Register cash deposit", amount: value, party: "Register cash custody", ref: depositReference});writes[`operationalAudit/${now}_cash_deposit_${commandId}`]=operationalAuditRecord("cash_deposit","cashCustody",ids.join("_"),actor,{movementId:commandId,amount:value,date:depositDate,destinationAccountId:accountId,reference:depositReference,custodyAllocations:allocations,accounting:"Debit destination cash account; credit Undeposited Collection; total cash and income unchanged."}); result.amount = value;result.date=depositDate;
    } else throw new HttpsError("invalid-argument", "Unsupported financial command.");
    try {const committed = await commitFinancial(db, commandId, movement, actor, writes);if(depositReferenceClaim&&committed.duplicate)await depositReferenceClaim.ref.update({status:"posted",movementId:commandId,amount:result.amount,date:result.date,postedAt:Date.now()});return Object.assign(result, {movementId: commandId, duplicate: committed.duplicate});}catch(error){if(depositReferenceClaim)await depositReferenceClaim.ref.transaction((current)=>current&&current.token===depositReferenceClaim.token&&current.status==="processing"?null:current);throw error;}
  }),
);

// Reconciles the one-to-one link between an on-account purchase invoice and
// its payable. Safe to retry: the invoice, payable and financial movement use
// deterministic IDs, while legacy/manual matches are linked instead of copied.
async function purchaseInventoryLines(db, invoice, credit) {
  const inventorySnap = await db.ref("/inventory").get(), inventory = inventorySnap.val() || {}, totals = {};
  (Array.isArray(invoice && invoice.lines) ? invoice.lines : []).forEach((line) => {const expense=line&&line.lineType==="expense",fixedAsset=line&&line.lineType==="fixed_asset",expenseCode=String(line&&line.expenseAccount||""),item=inventory[line.itemId]||{},mapping=BooksBridge.itemAccounts(item),code=fixedAsset?(line.assetCategory==="furniture"?"1510":"1500"):expense?(["6070","6075"].includes(expenseCode)?expenseCode:""):mapping.inventory||"1290",value=Financial.money(line.total);if(expense&&!code)throw new HttpsError("failed-precondition", "A one-time purchase expense has an invalid Finance Books account.");if(value>0)totals[code]=Financial.money((totals[code]||0)+value);});
  const expected=Financial.money(invoice&&invoice.total),found=Financial.money(Object.values(totals).reduce((sum,value)=>sum+value,0)),gap=Financial.money(expected-found);if(gap)totals["1290"]=Financial.money((totals["1290"]||0)+gap);
  return Object.keys(totals).filter((code)=>totals[code]>0).sort().map((code)=>Financial.line(`coa:${code}`,credit?0:totals[code],credit?totals[code]:0,invoice.supplier||"Purchase"));
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
    const supplierMaster=await requireActiveSupplier(db,invoice.supplierId,invoice.supplier);
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
    const payable = {supplierId:supplierMaster.id,party,type:provisional?"inventory_pending_invoice":"inventory",amount,date,due,ref,status:"open",provisional,movementId,purchaseInvoiceId:invoiceId,ts:now,createdBy:actor.uid,recovered:data.recovery === true,schemaVersion:2};
    const writes = {[`payables/${canonicalId}`]:payable,[`purchaseInvoices/${invoiceId}/payableId`]:canonicalId,[`purchaseInvoices/${invoiceId}/payableReconciledAt`]:now,[`purchaseInvoices/${invoiceId}/due`]:due,[`purchaseInvoices/${invoiceId}/ref`]:ref,[`purchaseInvoices/${invoiceId}/payMode`]:legacyNoLiability?"account":invoice.payMode,[`operationalAudit/${auditId}`]:{action:"reconcile_purchase_payable",sourceType:"purchaseInvoice",sourceId:invoiceId,payableId:canonicalId,result:provisional?"grni_created":(legacyNoLiability?"legacy_liability_created":"created"),amount,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
    const movementSnap = await db.ref(`/financialMovements/${movementId}`).get();
    if (movementSnap.exists()) await db.ref().update(writes);
    else {const inventoryLines=await purchaseInventoryLines(db,invoice,false),movement = Financial.movement(provisional?"grni_created":"payable_created", "payable", canonicalId, inventoryLines.concat([Financial.line(provisional?`liability:grni:${canonicalId}`:`liability:payable:${canonicalId}`, 0, amount, party)]), {occurredAt:Number(Date.parse(`${date}T00:00:00+08:00`)||now),actorName:actor.role,supplierId:supplierMaster.id,supplierName:supplierMaster.name});await commitFinancial(db, movementId, movement, actor, writes);}
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
    const invoice = invoices[invoiceId] || {}, safeInvoice = {id:invoiceId,supplier:financeText(invoice.supplier,120),ref:financeText(invoice.ref,120),date:invoice.date||"",due:invoice.due||"",by:financeText(invoice.by,120),description:financeText(invoice.description,240),payMode:invoice.payMode||"none",payableId:invoice.payableId||"",total:Financial.money(invoice.total),lines:Array.isArray(invoice.lines)?invoice.lines:[]};
    if (action === "lookup") return {invoice:safeInvoice,reversed:invoice.reversed===true};
    if (invoice.reversed === true) throw new HttpsError("failed-precondition", "This purchase has already been reversed.");
    const now = Date.now(), reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    if (action === "correct_details") {
      const supplierMaster=await requireActiveSupplier(db,invoice.supplierId,invoice.supplier),requestedSupplierId=financeText(data.supplierId,160);if(requestedSupplierId&&requestedSupplierId!==supplierMaster.id)throw new HttpsError("failed-precondition","Changing a posted purchase supplier requires reversing and re-entering the purchase so inventory, advance, payable, and Finance Books links remain intact.");const next = {supplier:supplierMaster.name,ref:financeText(data.ref,120),due:data.due?financeDate(data.due, true):"",by:financeText(data.by,120),description:financeText(data.description,240)};if (!next.ref) throw new HttpsError("invalid-argument", "Invoice reference is required.");
      const duplicate = Object.keys(invoices).some((id) => id !== invoiceId && financeText(invoices[id] && invoices[id].ref,120).toLowerCase() === next.ref.toLowerCase());if (duplicate) throw new HttpsError("already-exists", "Another purchase already uses this invoice reference.");
      const writes = {[`purchaseInvoices/${invoiceId}/supplier`]:next.supplier,[`purchaseInvoices/${invoiceId}/ref`]:next.ref,[`purchaseInvoices/${invoiceId}/due`]:next.due,[`purchaseInvoices/${invoiceId}/by`]:next.by,[`purchaseInvoices/${invoiceId}/description`]:next.description,[`purchaseInvoices/${invoiceId}/lastCorrectionAt`]:now,[`purchaseInvoices/${invoiceId}/lastCorrectionBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/lastCorrectionReason`]:reason,[`operationalAudit/${now}_purchase_correct_${invoiceId}`]:{action:"correct_purchase_details",sourceType:"purchaseInvoice",sourceId:invoiceId,before:{supplier:invoice.supplier||"",ref:invoice.ref||"",due:invoice.due||"",by:invoice.by||"",description:invoice.description||""},after:next,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};
      (invoice.receiptIds||[]).forEach((id,index) => {writes[`stockReceipts/${id}/supplier`]=next.supplier;writes[`stockReceipts/${id}/ref`]=next.ref;writes[`stockReceipts/${id}/receivedBy`]=next.by;writes[`inventoryBatch/bat_${invoiceId}_${index}/supplier`]=next.supplier;});if (invoice.payableId) {writes[`payables/${invoice.payableId}/party`]=next.supplier;writes[`payables/${invoice.payableId}/ref`]=next.ref;writes[`payables/${invoice.payableId}/due`]=next.due;}
      await db.ref().update(writes);return {invoiceId,result:"corrected",invoice:Object.assign({},safeInvoice,next)};
    }
    if (action !== "reverse") throw new HttpsError("invalid-argument", "Purchase correction action is invalid.");
    const linkedAssetIds=Array.isArray(invoice.fixedAssetIds)?invoice.fixedAssetIds:[],linkedAssets={};for(const assetId of linkedAssetIds){const key=financeKey(assetId,"Asset ID"),asset=(await db.ref(`/fixedAssets/${key}`).get()).val();if(!asset)throw new HttpsError("failed-precondition","A linked fixed-asset card is missing. Repair the asset register before reversing this purchase.");if(asset.status==="disposed"||Financial.money(asset.accumulatedDepreciation||0)>0)throw new HttpsError("failed-precondition","Dispose or reverse posted depreciation before reversing this equipment purchase.");linkedAssets[key]=asset;}
    let approval;
    if (data.ownerAmend === true) { if (!["owner","superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can amend a purchase in one step; other roles need a manager approval to reverse."); approval = {id:`owner_amend_${invoiceId}`, usedWrites:{}}; }
    else { approval = await claimManagerApproval(db, data, "reverse_purchase", invoiceId, safeInvoice.total, `reverse_purchase_${invoiceId}`); }
    const movementIds = Array.isArray(invoice.movementIds)?invoice.movementIds:[], originals=[];
    const payable = invoice.payableId ? (await db.ref(`/payables/${financeKey(invoice.payableId,"Payable ID")}`).get()).val() : null,keepInvoiceId=financeText(data.keepInvoiceId,160),keepInvoice=keepInvoiceId&&invoices[keepInvoiceId],duplicateCleanup=data.duplicate===true&&keepInvoice&&keepInvoiceId!==invoiceId&&keepInvoice.reversed!==true&&financeText(keepInvoice.ref,120).toLowerCase()===financeText(invoice.ref,120).toLowerCase()&&financeText(keepInvoice.supplier,120).toLowerCase()===financeText(invoice.supplier,120).toLowerCase()&&Financial.money(keepInvoice.total)===safeInvoice.total;if (data.duplicate===true&&!duplicateCleanup) throw new HttpsError("failed-precondition","A single matching purchase must be selected as the record to keep.");if (payable && payable.status === "paid") throw new HttpsError("failed-precondition", "This payable has already been paid. Reverse the supplier payment before reversing the purchase.");const orphanAccount=invoice.payMode==="account"&&!payable;if (!duplicateCleanup&&orphanAccount&&(await db.ref(`/financialMovements/purchase_ap_${invoiceId}`).get()).exists()) throw new HttpsError("failed-precondition","This purchase has a payable movement but its payable record is missing. Repair the payable before reversal.");if (!duplicateCleanup&&invoice.payMode === "pending"&&(!payable||payable.status!=="open")) throw new HttpsError("failed-precondition", "The linked provisional obligation is missing or is no longer open.");if (!duplicateCleanup&&invoice.payMode==="account"&&payable&&payable.status!=="open") throw new HttpsError("failed-precondition","The linked supplier payable is no longer open.");
    const paidAccountId=invoice.payMode==="paid"?financeText(invoice.accountId,120):"",paidSpecial=paidAccountId==="cash_on_hand"||paidAccountId==="undeposited"||paidAccountId==="register",paidCashAccount=invoice.payMode==="paid"&&!paidSpecial?accountIdFor((await db.ref("/cfAccounts").get()).val()||{},paidAccountId):paidAccountId;
    for (const movementId of movementIds) {const movement=(await db.ref(`/inventoryMovements/${financeKey(movementId,"Movement ID")}`).get()).val();if (!movement) throw new HttpsError("failed-precondition", "An original inventory movement is missing. Run inventory review before reversal.");const accounting=(await db.ref(`/inventoryAccounting/${movement.itemId}`).get()).val()||{},reversalId=`purchase_reverse_${invoiceId}_${movement.itemId}`,already=accounting.applied&&accounting.applied[reversalId];if (!already&&qty6(accounting.balance)+0.000001<qty6(movement.qty)) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${movement.itemName||movement.itemId}.`);if (!already&&qty6(accounting.balance)>qty6(movement.qty)&&((qty6(accounting.balance)*qty6(accounting.unitCost))-(qty6(movement.qty)*qty6(movement.unitCost)))<-.000001) throw new HttpsError("failed-precondition", `The remaining stock value for ${movement.itemName||movement.itemId} cannot support this reversal.`);originals.push(movement);}
    for (const movement of originals) await applyInventoryMovement(db,{movementId:`purchase_reverse_${invoiceId}_${movement.itemId}`,itemId:movement.itemId,type:"purchase_reversal",qty:-qty6(movement.qty),unitCost:qty6(movement.unitCost),sourceType:"purchase-invoice-reversal",sourceId:invoiceId,sourceLine:movement.sourceLine||movement.itemId,note:`Reverse purchase ${invoice.ref||invoiceId}: ${reason}`,reversalOf:movement.id,actorName:actor.role,occurredAt:now},actor);
    const writes = Object.assign({},approval.usedWrites,{[`purchaseInvoices/${invoiceId}/reversed`]:true,[`purchaseInvoices/${invoiceId}/reversedAt`]:now,[`purchaseInvoices/${invoiceId}/reversedBy`]:actor.uid,[`purchaseInvoices/${invoiceId}/reversalReason`]:reason,[`operationalAudit/${now}_purchase_reverse_${invoiceId}`]:{action:duplicateCleanup?"reverse_duplicate_purchase":"reverse_purchase",sourceType:"purchaseInvoice",sourceId:invoiceId,keptPurchaseId:duplicateCleanup?keepInvoiceId:"",amount:safeInvoice.total,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}});if (duplicateCleanup&&payable) {if (payable.status==="open") {writes[`payables/${invoice.payableId}/purchaseInvoiceId`]=keepInvoiceId;writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=invoice.payableId;} else {writes[`purchaseInvoices/${keepInvoiceId}/payableId`]=null;writes[`purchaseInvoices/${keepInvoiceId}/payableReconciledAt`]=null;}}(invoice.receiptIds||[]).forEach((id)=>{writes[`stockReceipts/${id}/reversed`]=true;writes[`stockReceipts/${id}/reversedAt`]=now;});
    Object.keys(linkedAssets).forEach((id)=>{writes[`fixedAssets/${id}/status`]="acquisition_reversed";writes[`fixedAssets/${id}/reversedAt`]=now;writes[`fixedAssets/${id}/reversalReason`]=reason;});
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
    const o = found.order, channel = financeText(o.channel, 20).toLowerCase(), oldGross = Financial.money(o.grossPlatform != null ? o.grossPlatform : (o.subtotal != null ? o.subtotal : o.total)), oldCommission = Financial.money(o.commission), oldMerchantPromo=Financial.money(o.platformMerchantPromo), oldDeliveryFeeDiscount=Financial.money(o.platformDeliveryFeeDiscount), oldAdsMarketing=Financial.money(o.platformAdsMarketing), oldMarketingFee=Financial.money(o.platformMarketingFee), oldWht=Financial.money(o.platformWht), oldVat=Financial.money(o.platformVat), oldNet=Financial.money(o.netPlatform != null ? o.netPlatform : oldGross-oldCommission-Financial.money(o.platformDiscount)-oldWht-oldVat-oldAdsMarketing-oldMarketingFee);
    if (data.action === "lookup") return {orderId: found.id, platformRef: o.platformRef || found.id, channel, gross: oldGross, commission: oldCommission, merchantPromo:oldMerchantPromo, deliveryFeeDiscount:oldDeliveryFeeDiscount, adsMarketing:oldAdsMarketing, marketingFee:oldMarketingFee, wht:oldWht, vat:oldVat, net:oldNet, settlementStatus: o.settlementStatus || "unsettled", hasStructuredItems: Array.isArray(o.lineItems) && o.lineItems.length > 0};
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
    const gross = Financial.money(data.gross), commission = Financial.money(data.commission), merchantPromo=Financial.money(data.merchantPromo), deliveryFeeDiscount=Financial.money(data.deliveryFeeDiscount), adsMarketing=Financial.money(data.adsMarketing), marketingFee=Financial.money(data.marketingFee), reason = financeText(data.reason, 300);
    if (!(gross > 0)) throw new HttpsError("invalid-argument", "Verified gross must be greater than zero.");
    if (commission < 0 || commission > gross + 0.009) throw new HttpsError("invalid-argument", "Verified commission must be between zero and the verified gross.");
    if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    if ([merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee].some((value)=>value<0)) throw new HttpsError("invalid-argument", "Verified platform deductions cannot be negative.");
    const discount = Financial.money(merchantPromo+deliveryFeeDiscount), wht = oldWht, vat = oldVat, net = Financial.money(gross - commission - discount - wht - vat - adsMarketing - marketingFee);
    if (net < -0.009) throw new HttpsError("failed-precondition", "The verified platform deductions exceed the verified gross.");
    const delta = Financial.money(Math.abs(oldNet - net)), referenceChanged = newPlatformRef !== previousPlatformRef,figuresChanged=[oldGross-gross,oldCommission-commission,oldMerchantPromo-merchantPromo,oldDeliveryFeeDiscount-deliveryFeeDiscount,oldAdsMarketing-adsMarketing,oldMarketingFee-marketingFee].some((value)=>Math.abs(value)>0.009); if (!referenceChanged && !figuresChanged) throw new HttpsError("failed-precondition", "The verified reference and figures are unchanged.");
    const version = Math.max(1, Number(o.preSettlementCorrectionVersion || 0) + 1), movementId = `platform_presettle_${found.id}_${version}`;
    const approval = await claimManagerApproval(db, data, "correct_platform_presettlement", found.id, delta, movementId), now = Date.now(), accounts = (await db.ref("/cfAccounts").get()).val() || {};
    const corrected = Object.assign({}, o, {platformRef:newPlatformRef,grossPlatform:gross,subtotal:gross,total:gross,platformDiscount:discount,platformMerchantPromo:merchantPromo,platformDeliveryFeeDiscount:deliveryFeeDiscount,platformAdsMarketing:adsMarketing,platformMarketingFee:marketingFee,netSalesPlatform:Financial.money(gross-discount),commission,netPlatform:Math.max(0,net),preSettlementCorrected:true,preSettlementCorrectionVersion:version,preSettlementCorrectedAt:now,preSettlementCorrectedBy:actor.uid,preSettlementCorrectionReason:reason});
    delete corrected.dupPlatformRef;
    if (Array.isArray(corrected.payments)) corrected.payments = corrected.payments.map((payment) => Object.assign({}, payment, {amount:corrected.payments.length === 1 ? gross : payment.amount, ref:platformRefKey(payment.ref) === oldRefKey ? newPlatformRef : payment.ref}));
    const beforePosting = Financial.orderPosting(o, accounts), afterPosting = Financial.orderPosting(corrected, accounts), movement = Financial.postingDifference(beforePosting, afterPosting, "platform_presettlement_correction", found.id, "Pre-settlement correction");
    const approvedBy = approval.record.approvedEmail || approval.record.approvedRole;
    if (movement) {movement.occurredAt = Number(o.timestamp || now); movement.approvalId = approval.id; movement.approvedBy = approvedBy; movement.correctionRecordedAt = now; movement.platformRef = newPlatformRef; movement.previousPlatformRef = previousPlatformRef;}
    const history = {version,before:{platformRef:previousPlatformRef,gross:oldGross,commission:oldCommission,merchantPromo:oldMerchantPromo,deliveryFeeDiscount:oldDeliveryFeeDiscount,adsMarketing:oldAdsMarketing,marketingFee:oldMarketingFee,net:oldNet},after:{platformRef:newPlatformRef,gross,commission,merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee,net:Math.max(0,net)},reason,platformRef:newPlatformRef,previousPlatformRef,approvalId:approval.id,approvedBy,actorUid:actor.uid,actorRole:actor.role,at:now,inventoryEffect:0,cogsEffect:0,movementId:movement?movementId:""};
    corrected.preSettlementCorrections = Object.assign({}, o.preSettlementCorrections || {}, {[version]:history});
    const writes = Object.assign({}, approval.usedWrites, {[`${found.node}/${found.id}`]:corrected,[`operationalAudit/${now}_platform_presettle_${found.id}`]:{action:"correct_platform_presettlement",sourceType:"order",sourceId:found.id,platformRef:newPlatformRef,previousPlatformRef,channel,before:history.before,after:history.after,reason,approvalId:approval.id,actorUid:actor.uid,actorRole:actor.role,inventoryEffect:0,cogsEffect:0,financialEffect:movement?"posting_difference":"none",ts:now,schemaVersion:1}});
    if (referenceChanged) {writes[`platformRefIndex/${channel}/${newRefKey}`]={orderId:found.id,ref:newPlatformRef,at:Number(o.timestamp)||now,correctedAt:now}; if (newRefKey !== oldRefKey) {const oldIndex=(await db.ref(`/platformRefIndex/${channel}/${oldRefKey}`).get()).val(); if (oldIndex && oldIndex.orderId === found.id) writes[`platformRefIndex/${channel}/${oldRefKey}`]=null;} writes[`platformRefDuplicates/${found.id}`]=null;}
    const active=(await db.ref(`/activeOrders/${found.id}`).get()).val(); if (active) {writes[`activeOrders/${found.id}/platformRef`]=newPlatformRef; if (Array.isArray(active.payments)) writes[`activeOrders/${found.id}/payments`]=corrected.payments;}
    let duplicate=false; if (movement) {const committed=await commitFinancial(db,movementId,movement,actor,writes);duplicate=committed.duplicate;} else await db.ref().update(writes);
    return {orderId:found.id,previousPlatformRef,platformRef:newPlatformRef,gross,commission,merchantPromo,deliveryFeeDiscount,adsMarketing,marketingFee,net:Math.max(0,net),movementId:movement?movementId:"",financialPosted:!!movement,duplicate};
  },
);

exports.settlePlatformPayout = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]); const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), channel = financeText(data.channel, 30); if (!["grabfood", "foodpanda"].includes(channel)) throw new HttpsError("invalid-argument", "Platform is invalid.");
    const accounts=(await db.ref("/cfAccounts").get()).val()||{};
    const ids = Array.isArray(data.orderIds) ? [...new Set(data.orderIds.map((id) => financeKey(id, "Order ID")))] : []; if (!ids.length) throw new HttpsError("invalid-argument", "Select at least one order.");
    const found = await Promise.all(ids.map((id) => findOrder(db, id))); let expected = 0; found.forEach((entry) => { const o = entry.order; if (o.channel !== channel || o.voided || (o.settlementStatus || "unsettled") === "settled") throw new HttpsError("failed-precondition", `Order ${entry.id} is not eligible for this payout.`); expected += Financial.money(o.netPlatform != null ? o.netPlatform : Financial.money(o.grossPlatform || o.total) - Financial.money(o.commission) - Financial.money(o.platformDiscount) - Financial.money(o.platformWht) - Financial.money(o.platformVat) - Financial.money(o.platformAdsMarketing) - Financial.money(o.platformMarketingFee)); }); expected = Financial.money(expected);
    const actual = Financial.money(data.actualPayout),destinationAccountId=actual>0?accountIdFor(accounts,data.destinationAccountId):""; const approval = await claimManagerApproval(db, data, "settle_platform_payout", payoutId, actual, `payout_${payoutId}`), variance = Financial.money(actual - expected), configuredDefs = (await db.ref("/platformVarAccounts").get()).val() || {}, defs = Object.assign({}, configuredDefs, {va_refund:{name:"Grab refund / cancellation deduction",type:"expense"},va_refund_recovery:{name:"Grab refund recovery / reversal",type:"revenue"}}), allocations = data.allocations || {}, requestedAllocationRefs = data.allocationRefs || {}, allocationRefs = {}, allocationMeta = {}; const _allPo = (await db.ref("/platformPayouts").get()).val() || {}; let outstandingOwing = 0; const owingSources = []; Object.keys(_allPo).forEach((k) => { const po = _allPo[k] || {}; if (po.channel === channel && !po.reversed && Financial.money(po.owingOutstanding) > 0.009) { outstandingOwing = Financial.money(outstandingOwing + Financial.money(po.owingOutstanding)); owingSources.push(k); } });
    let netAlloc = 0, owingApplied = 0, owingCreated = 0; const lines = [];
    if (actual < 0) { owingCreated = Financial.money(-actual); lines.push(Financial.line(`liability:platform_owing:${channel}`, 0, owingCreated, "Owing to platform (penalties exceeded payout)")); } else { lines.push(Financial.line(`asset:platform_clearing:${channel}`, actual, 0, "Actual payout clearing")); if (outstandingOwing > 0.009) { owingApplied = outstandingOwing; lines.push(Financial.line(`liability:platform_owing:${channel}`, owingApplied, 0, "Recover prior owing to platform")); } }
    Object.keys(allocations).forEach((id) => { const value = Financial.money(allocations[id]), suppliedSourceRef = financeText(requestedAllocationRefs[id], 120), payoutSourced = ["va_refund", "va_refund_recovery"].includes(id), automaticPayoutSource = payoutSourced ? financeText(`${channel === "grabfood" ? "Grab" : "FoodPanda"} payout ${payoutId} · ${financeText(data.payoutDate, 10) || "date pending"} · ${financeText(data.periodStart, 10) || "open"} to ${financeText(data.periodEnd, 10) || "open"}`, 120) : "", sourceRef = suppliedSourceRef || automaticPayoutSource; if (!(value > 0) || !defs[id]) throw new HttpsError("invalid-argument", "Variance allocation is invalid."); const name = financeText(defs[id].name || id, 120), type = defs[id].type === "revenue" ? "revenue" : "expense", label = `${name}${sourceRef ? ` · ${sourceRef}` : ""}`; if (sourceRef) allocationRefs[id] = sourceRef; allocationMeta[id] = {name,type,sourceRef,sourceKind:suppliedSourceRef ? "entered_reference" : (payoutSourced ? "payout" : "none")}; if (type === "revenue") {netAlloc += value; lines.push(Financial.line(`revenue:platform_variance:${id}`, 0, value, label));} else {netAlloc -= value; lines.push(Financial.line(`expense:platform_variance:${id}`, value, 0, label));} });
    if (Math.abs(Financial.money(netAlloc) - Financial.money(variance + owingApplied)) > 0.009) throw new HttpsError("failed-precondition", "Variance allocations do not equal the server-calculated variance.");
    const writes = Object.assign({}, approval.usedWrites), settledAt = Date.now(), payoutDate=/^\d{4}-\d{2}-\d{2}$/.test(financeText(data.payoutDate, 10))?financeText(data.payoutDate, 10):null;if(!payoutDate)throw new HttpsError("invalid-argument","The platform payout date is required.");
    const platformStatementReference=financeText(data.platformStatementReference,120),depositReference=financeText(data.depositReference,120);if(actual>0&&!depositReference)throw new HttpsError("invalid-argument","The bank transaction or payout reference is required.");
    const payoutRecord = {channel, periodStart: financeText(data.periodStart, 10), periodEnd: financeText(data.periodEnd, 10), payoutDate, accountingOccurredAt:accountingTimestamp(payoutDate,settledAt), platformStatementReference:platformStatementReference||null, depositReference:depositReference||null, owing: owingCreated || null, owingOutstanding: owingCreated || 0, owingApplied: owingApplied || null, owingRecoveredSources: (owingApplied > 0 ? owingSources : null), expectedNet: expected, actualPayout: actual, variance, allocations, allocationRefs, allocationMeta, orderIds: ids, by: actor.role, actorUid: actor.uid, approvedBy: approval.record.approvedEmail || approval.record.approvedRole, approvalId: approval.id, settledAt, movementId: `payout_${payoutId}`, schemaVersion: 1};
    const movement = Financial.platformPayoutPosting(Object.assign({id:payoutId}, payoutRecord), defs);
    if(actual>0){const accountId=destinationAccountId,platformName=channel==="grabfood"?"Grab":"FoodPanda",depositId=`payout_deposit_${payoutId}`,reference=depositReference,occurredAt=accountingTimestamp(payoutDate,settledAt),deposit=Financial.movement("platform_payout_deposit","platformPayout",payoutId,[Financial.line(`asset:cash_account:${accountId}`,actual,0,`${platformName} payout deposited directly to ${accounts[accountId].name}`),Financial.line(`asset:platform_clearing:${channel}`,0,actual,`Clear ${platformName} payout in transit`)],{occurredAt,reference,accountId,automatic:true});payoutRecord.depositMovementId=depositId;payoutRecord.depositedAt=settledAt;payoutRecord.accountId=accountId;payoutRecord.autoDeposited=true;writes[`financialMovements/${depositId}`]=financeRecord(depositId,deposit,actor);writes[`cfLedger/fm_${depositId}`]=cashLedgerRecord({date:payoutDate,accountId,dir:"in",category:`${platformName} payout`,amount:actual,party:channel,ref:reference,auto:true},depositId,deposit,actor);writes[`operationalAudit/${settledAt}_${channel}_direct_deposit_${payoutId}`]=operationalAuditRecord("platform_payout_auto_deposit","platformPayout",payoutId,actor,{channel,amount:actual,date:payoutDate,accountId,accountName:accounts[accountId].name,movementId:depositId,reference,platformStatementReference});}
    found.forEach((entry) => {writes[`${entry.node}/${entry.id}/settlementStatus`] = "settled"; writes[`${entry.node}/${entry.id}/payoutId`] = payoutId;}); owingSources.forEach((sid) => { writes[`platformPayouts/${sid}/owingOutstanding`] = 0; writes[`platformPayouts/${sid}/owingRecoveredBy`] = payoutId; writes[`platformPayouts/${sid}/owingRecoveredAt`] = settledAt; }); writes[`platformPayouts/${payoutId}`] = payoutRecord;
    const committed = await commitFinancial(db, `payout_${payoutId}`, movement, actor, writes); return {payoutId, expectedNet: expected, actualPayout: actual, variance, orderCount: ids.length, owingApplied, owingCreated,depositMovementId:payoutRecord.depositMovementId||"",depositAccountId:payoutRecord.accountId||"", duplicate: committed.duplicate};
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

// Correct payout metadata and keep the authoritative payout date synchronized
// across the Admin subledger, Finance movements, Books journals, and cash ledger.
exports.setPlatformPayoutDate = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["receivables"]);
    const data = request.data || {}, payoutId = financeKey(data.payoutId, "Payout ID"), raw = financeDate(financeText(data.payoutDate, 10));
    const lockRef=db.ref(`/platformPayoutDateEditLocks/${payoutId}`),token=crypto.randomBytes(12).toString("hex"),startedAt=Date.now(),lock=await lockRef.transaction((current)=>!current||Number(current.claimedAt||0)<startedAt-120000?{token,claimedAt:startedAt,actorUid:actor.uid}:current,undefined,false);
    if(!lock.committed||!lock.snapshot.exists()||lock.snapshot.val().token!==token)throw new HttpsError("aborted","This payout is already being edited. Wait a moment, refresh, and try again.");
    try{
      const payoutSnap = await db.ref(`/platformPayouts/${payoutId}`).get();
      if (!payoutSnap.exists()) throw new HttpsError("not-found", "Payout not found.");
      const payout = payoutSnap.val() || {}, hasDepositReference = Object.prototype.hasOwnProperty.call(data, "depositReference"), hasPlatformStatementReference = Object.prototype.hasOwnProperty.call(data, "platformStatementReference"), hasNotes = Object.prototype.hasOwnProperty.call(data, "notes"), depositReference = hasDepositReference ? financeText(data.depositReference, 120) : financeText(payout.depositReference, 120), platformStatementReference = hasPlatformStatementReference ? financeText(data.platformStatementReference, 120) : financeText(payout.platformStatementReference, 120), notes = hasNotes ? financeText(data.notes, 500) : financeText(payout.notes, 500), oldDate=financeText(payout.payoutDate,10)||financeDateFromTimestamp(Number(payout.accountingOccurredAt||payout.settledAt)),dateChanged=oldDate!==raw,now=Date.now(),occurredAt=accountingTimestamp(raw,now),settlementMovementId=financeText(payout.movementId,160)||`payout_${payoutId}`,depositMovementId=financeText(payout.depositMovementId,160);
      const writes = {
        [`platformPayouts/${payoutId}/payoutDate`]: raw,
        [`platformPayouts/${payoutId}/metadataUpdatedAt`]: now,
        [`platformPayouts/${payoutId}/metadataUpdatedBy`]: actor.uid,
      };
      let linkedRecordsUpdated=0;
      if(dateChanged){
        await assertAccountingPeriodOpen(db,oldDate,"changing this payout date");await assertAccountingPeriodOpen(db,raw,"changing this payout date");
        const movementIds=[settlementMovementId].concat(depositMovementId?[depositMovementId]:[]),movementSnaps=await Promise.all(movementIds.map(id=>db.ref(`/financialMovements/${id}`).get())),journalSnaps=await Promise.all(movementIds.map(id=>db.ref(`/books/journal/${id}`).get())),ledgerSnap=depositMovementId?await db.ref("/cfLedger").orderByChild("movementId").equalTo(depositMovementId).get():null;
        movementSnaps.forEach((snap,index)=>{if(!snap.exists())throw new HttpsError("failed-precondition",`Linked Finance movement ${movementIds[index]} is missing. Run financial reconciliation before editing this payout date.`);});
        journalSnaps.forEach((snap,index)=>{if(!snap.exists())throw new HttpsError("failed-precondition",`Linked Finance Books journal ${movementIds[index]} is missing. Run financial reconciliation before editing this payout date.`);});
        const ledger=ledgerSnap&&ledgerSnap.val()||{};if(Object.values(ledger).some(row=>row&&(row.bankReconciled===true||row.reconciled===true||row.reconciledAt||row.bankReconciliationId||row.statementId)))throw new HttpsError("failed-precondition","This payout is bank-reconciled. Reopen its bank reconciliation before changing the payout date.");
        writes[`platformPayouts/${payoutId}/accountingOccurredAt`]=occurredAt;
        movementIds.forEach((id,index)=>{const movement=movementSnaps[index].val()||{},journal=journalSnaps[index].val()||{};writes[`financialMovements/${id}`]=Object.assign({},movement,{occurredAt,payoutDateRevision:Number(movement.payoutDateRevision||0)+1,payoutDateUpdatedAt:now,payoutDateUpdatedBy:actor.uid});writes[`books/journal/${id}`]=Object.assign({},journal,{date:raw,payoutDateRevision:Number(journal.payoutDateRevision||0)+1,updatedAt:now,updatedBy:actor.uid});linkedRecordsUpdated+=2;});
        Object.keys(ledger).forEach(id=>{const row=ledger[id]||{};writes[`cfLedger/${id}`]=Object.assign({},row,{date:raw,ts:occurredAt,payoutDateRevision:Number(row.payoutDateRevision||0)+1,payoutDateUpdatedAt:now,payoutDateUpdatedBy:actor.uid});linkedRecordsUpdated++;});
        const dates=[...new Set([oldDate,raw])];for(const date of dates){const indexes=(await db.ref(`/financialCloseIndex/${date}`).get()).val()||{};for(const closeId of Object.keys(indexes)){const current=(await db.ref(`/financialCloses/${closeId}/current`).get()).val();if(current){writes[`financialCloses/${closeId}/current/status`]="REOPENED";writes[`financialCloses/${closeId}/current/reopenedAt`]=now;writes[`financialCloses/${closeId}/current/reopenedByActivityId`]=`${now}_update_payout_date_${payoutId}`;writes[`financialCloseIndex/${date}/${closeId}/status`]="REOPENED";}}}
        writes[`platformPayoutDateRevisions/${payoutId}/${now}`]={from:oldDate,to:raw,settlementMovementId,depositMovementId:depositMovementId||null,linkedRecordsUpdated,changedAt:now,changedBy:actor.uid,changedByRole:actor.role,schemaVersion:1};
      }
      if (hasDepositReference) writes[`platformPayouts/${payoutId}/depositReference`] = depositReference || null;
      if (hasPlatformStatementReference) writes[`platformPayouts/${payoutId}/platformStatementReference`] = platformStatementReference || null;
      if (hasNotes) writes[`platformPayouts/${payoutId}/notes`] = notes || null;
      writes[`operationalAudit/${now}_update_payout_metadata_${payoutId}`] = {action: dateChanged?"update_platform_payout_date":"update_platform_payout_metadata", sourceType: "platformPayout", sourceId: payoutId, detail: {payoutDate: raw, depositReference: depositReference || "", platformStatementReference: platformStatementReference || "", notes: notes || ""}, previous: {payoutDate: oldDate, depositReference: payout.depositReference || "", platformStatementReference: payout.platformStatementReference || "", notes: payout.notes || ""}, financialEffect: dateChanged?"linked_dates_updated":"none",linkedRecordsUpdated, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1};
      assertNoOverlappingUpdatePaths(writes,"platform payout date edit");await safeFinancialUpdate(db,writes,"platform payout date edit");
      return {payoutId, payoutDate: raw, depositReference, platformStatementReference, notes, financialEffect: dateChanged?"linked_dates_updated":"none",linkedRecordsUpdated};
    }finally{try{await lockRef.transaction(current=>current&&current.token===token?null:current,undefined,false);}catch(error){logger.error("Payout date edit lock release failed",{payoutId,message:error.message});}}
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
    const accounts = accountsSnap.val() || {}, legacyLedger = ledgerSnap.val() || {}, all = Object.assign({}, archiveSnap.val() || {}, ordersSnap.val() || {}), originalMovements = movementsSnap.val() || {}; let posted = 0, duplicates = 0, skipped = 0, salesDiscountsReclassified = 0; const serverActor = {uid: "server", role: "server"};
    for (const id of Object.keys(all)) { try {const order = Object.assign({id}, all[id]), result = await postOrderFinancial(db, order, accounts, serverActor); if (result.skipped) skipped++; else if (result.duplicate) duplicates++; else posted++; const orderStatus=order.status==="Archived"?order.prevStatus:order.status,discountReclass=!order.voided&&["Completed","Received"].includes(orderStatus)&&order.paymentStatus!=="pending"?Financial.platformDiscountReclassification(order,originalMovements[`sale_${id}`]):null;if(discountReclass){const movementId=`sales_discount_reclass_${id}`,now=Date.now(),rr=await commitFinancial(db,movementId,discountReclass,serverActor,{[`operationalAudit/${now}_sales_discount_reclass_${id}`]:{action:"platform_sales_discount_reclassified",sourceType:"order",sourceId:id,movementId,originalMovementId:`sale_${id}`,amount:Financial.money(discountReclass.amount),actorUid:actor.uid,ts:now,schemaVersion:1,accounting:"Reclassify platform-funded discounts from selling expense to contra-revenue; no cash, receivable, inventory, or profit change."}});if(rr.duplicate)duplicates++;else{posted++;salesDiscountsReclassified++;}}const refund = Financial.money(order.refundAmount); if (refund > 0) {const movementId = `refund_${id}_${Math.round(refund * 100)}`, movement = Financial.reversalPosting(order, refund, "refund", accounts), writes = {}; movement.occurredAt = Number(order.refundedAt || order.timestamp || Date.now()); if (!legacyLedger[`cfrefund_${id}`]) addOrderCashWrites(writes, movement, movementId, order, serverActor); const rr = await commitFinancial(db, movementId, movement, serverActor, writes); rr.duplicate ? duplicates++ : posted++;} if (order.voided) {const remaining = Financial.money(Math.max(0, Financial.money(order.total) - refund)); if (remaining > 0) {const movementId = `void_${id}`, movement = Financial.reversalPosting(order, remaining, "void", accounts), writes = {}; movement.occurredAt = Number(order.voidedAt || order.timestamp || Date.now()); addOrderCashWrites(writes, movement, movementId, order, serverActor); const vr = await commitFinancial(db, movementId, movement, serverActor, writes); vr.duplicate ? duplicates++ : posted++;}}} catch (error) {logger.error("3C backfill order failed", {id, error: String(error)}); throw new HttpsError("internal", `Backfill stopped at order ${id}. It is safe to retry.`);} }
      let orphanReversed = 0;
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
    const beforeVoidCorrections=(await db.ref("/financialMovements").get()).val()||{}; let voidBalancesCorrected=0;
    for (const id of Object.keys(all).sort()) {
      const order=all[id]||{}; if(!order.voided||!["grabfood","foodpanda"].includes(String(order.channel||"").toLowerCase()))continue;
      const correction=Financial.netMovementCorrection(Object.values(beforeVoidCorrections),id,"void_balance_correction","Bring voided platform order posting chain to zero");if(!correction)continue;
      correction.occurredAt=Number(order.voidedAt||order.timestamp||Date.now());correction.actorName="Automated platform AR reconciliation";correction.controlReason="Admin Sales marks this order void; correct only the remaining source-specific posting balance";
      const movementId=`void_balance_correction_${id}`,now=Date.now(),result=await commitFinancial(db,movementId,correction,serverActor,{[`operationalAudit/${now}_void_balance_${id}`]:{action:"voided_platform_order_balance_corrected",sourceType:"order",sourceId:id,movementId,channel:order.channel,actorUid:actor.uid,ts:now,schemaVersion:1}});if(result.duplicate)duplicates++;else{posted++;voidBalancesCorrected++;}
    }
    const repairedMovements=(await db.ref("/financialMovements").get()).val()||{}, adminByChannel={grabfood:0,foodpanda:0}, ledgerByChannel={grabfood:0,foodpanda:0};
    Object.values(all).forEach((o)=>{const channel=String(o&&o.channel||"").toLowerCase();if(!["grabfood","foodpanda"].includes(channel)||o.voided||(o.settlementStatus||"unsettled")==="settled")return;adminByChannel[channel]=Financial.money(adminByChannel[channel]+Financial.money(o.netPlatform!=null?o.netPlatform:Financial.money(o.grossPlatform||o.total)-Financial.money(o.commission)));});
    Object.values(repairedMovements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerByChannel[channel]=Financial.money(ledgerByChannel[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));
    const adminTotal=Financial.money(adminByChannel.grabfood+adminByChannel.foodpanda),ledgerTotal=Financial.money(ledgerByChannel.grabfood+ledgerByChannel.foodpanda),platformAr={adminByChannel,ledgerByChannel,adminTotal,ledgerTotal,difference:Financial.money(ledgerTotal-adminTotal),reconciled:Math.abs(ledgerTotal-adminTotal)<0.01,payoutsChecked:Object.keys(payouts).length,payoutsPosted,payoutDuplicates,settledOrdersLinked,voidBalancesCorrected,issues:payoutIssues.slice(0,200)};
    const scanned = Object.keys(all).length + Object.keys(shifts).length + Object.keys(vouchers).length + Object.keys(replenishments).length + Object.keys(accounts).length + Object.keys(receivables).length + Object.keys(payables).length + Object.keys(payouts).length + 1; await db.ref("/systemMaintenance/financialLedgerInitialized").set({at: Date.now(), by: actor.uid, scanned, posted, duplicates, skipped, orphanReversed, salesDiscountsReclassified, platformAr}); return {scanned, posted, duplicates, skipped, orphanReversed, salesDiscountsReclassified, platformAr};
  },
);

exports.manageBooksAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => observeFinancialOperation(request, "manageBooksAccount", async () => {
    const db = getDatabase();
    const actor = await requireBooksChartManager(db, request);
    const data = request.data || {};
    const action = financeText(data.action, 20);
    const chart = await ensureBooksChart(db);
    if (action === "initialize" || action === "list" || !action) return {chart: chart, managerEmail: actor.email};
    const now = Date.now();
    function cleanAccount(input){const code=financeText(input&&input.code,4);if(!/^\d{4}$/.test(code))throw new HttpsError("invalid-argument","Account code must be exactly four digits.");const name=financeText(input&&input.name,100);const type=financeText(input&&input.type,12);if(!name)throw new HttpsError("invalid-argument","Account name is required.");if(!BOOKS_TYPES.includes(type))throw new HttpsError("invalid-argument","Account type must be one of: "+BOOKS_TYPES.join(", ")+".");return {code:code,name:name,type:type,note:financeText(input&&input.note,160)};}
    if (action === "upsert") {
      const clean = cleanAccount(data);
      const ref = db.ref(`/booksChart/${clean.code}`);
      const old = (await ref.get()).val();
      const isSystem = !!(old && old.system === true);
      const type = isSystem ? old.type : clean.type;
      const record = {code: clean.code, name: clean.name, type: type, note: clean.note, active: data.active === false ? false : (old ? old.active !== false : true), system: isSystem, sensitive: !!(old && old.sensitive === true), createdAt: (old && old.createdAt) || now, createdBy: (old && old.createdBy) || actor.uid, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email, schemaVersion: 1};
      await ref.set(record);
      await db.ref(`/operationalAudit/${now}_booksacct_${old ? "edit" : "add"}_${clean.code}`).set(operationalAuditRecord(old ? "edit_books_account" : "add_books_account", "booksChart", clean.code, actor, {name: record.name, type: record.type, email: actor.email}));
      return {account: record, created: !old};
    }
    if (action === "deactivate" || action === "reactivate") {
      const code = financeText(data && data.code, 4);
      if(!/^\d{4}$/.test(code))throw new HttpsError("invalid-argument","A four-digit account code is required.");
      const ref = db.ref(`/booksChart/${code}`);
      const old = (await ref.get()).val();
      if (!old) throw new HttpsError("not-found", `Books account ${code} was not found.`);
      if (action === "deactivate" && old.system === true) throw new HttpsError("failed-precondition", "System accounts are required by the ledger and can\u2019t be deactivated. Rename it instead if needed.");
      const active = action === "reactivate";
      await ref.update({active: active, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email});
      await db.ref(`/operationalAudit/${now}_booksacct_${action}_${code}`).set(operationalAuditRecord(action + "_books_account", "booksChart", code, actor, {email: actor.email}));
      return {account: Object.assign({}, old, {active: active})};
    }
    if (action === "import") {
      const rows = Array.isArray(data.accounts) ? data.accounts.slice(0, 300) : [];
      const results = {added: [], skipped: [], conflicts: []};
      for (const row of rows) {
        let clean;
        try { clean = cleanAccount(row); } catch (e) { results.skipped.push({code: row && row.code, reason: e.message}); continue; }
        const existing = (await db.ref(`/booksChart/${clean.code}`).get()).val();
        if (existing) {
          if (existing.name !== clean.name || existing.type !== clean.type) results.conflicts.push({code: clean.code, server: {name: existing.name, type: existing.type}, local: {name: clean.name, type: clean.type}});
          else results.skipped.push({code: clean.code, reason: "already present"});
          continue;
        }
        await db.ref(`/booksChart/${clean.code}`).set({code: clean.code, name: clean.name, type: clean.type, note: clean.note, active: true, system: false, sensitive: false, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email, schemaVersion: 1});
        results.added.push(clean.code);
      }
      if (results.added.length) await db.ref(`/operationalAudit/${now}_booksacct_import`).set(operationalAuditRecord("import_books_accounts", "booksChart", "import", actor, {added: results.added, email: actor.email}));
      return results;
    }
    throw new HttpsError("invalid-argument", "Unknown chart action.");
  }),
);

exports.manageChartAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {const db=getDatabase(), actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Privileged access is required.");const data=request.data||{}, action=financeText(data.action,30);await ensureChartAccounts(db);if(action==="initialize")return{initialized:true};const id=financeKey(data.accountId,"Chart account"), ref=db.ref(`/chartOfAccounts/${id}`), old=(await ref.get()).val();if(action==="upsert"){const name=financeText(data.name,100),code=financeText(data.code,20),type=financeText(data.type,20);if(!name||!code||!["asset","liability","equity","revenue","expense"].includes(type))throw new HttpsError("invalid-argument","Code, name, and valid account type are required.");await ref.set({code,name,type,active:data.active!==false,system:old&&old.system===true,createdAt:old&&old.createdAt||Date.now(),updatedAt:Date.now(),updatedBy:actor.uid,schemaVersion:1});return{accountId:id};}if(action==="deactivate"){if(!old)throw new HttpsError("not-found","Chart account not found.");await ref.update({active:false,updatedAt:Date.now(),updatedBy:actor.uid});return{accountId:id};}throw new HttpsError("invalid-argument","Chart action is invalid.");},
);

function cashFinanceDateMismatches(cash, movements) {
  const byMovement = {};
  Object.keys(cash || {}).forEach((id) => {
    const row = cash[id] || {}, mid = row.movementId, mv = mid && movements[mid];
    if (!mv || !row.date || mv.dateRepairSupersededBy) return;
    const currentDate = BooksBridge.businessDate(mv.occurredAt);
    if (currentDate === row.date) return;
    const previous = byMovement[mid];
    if (previous && previous.targetDate !== row.date) { previous.ambiguous = true; return; }
    if (!previous) byMovement[mid] = {movementId: mid, amount: Financial.money(row.amount), currentDate, targetDate: row.date, type: String(mv.type || ""), cfLedgerId: id, ambiguous: false};
  });
  return Object.keys(byMovement).map((id) => byMovement[id]);
}
async function automaticallyRepairFinanceDates(db, cash, movements, trigger) {
  const candidates = cashFinanceDateMismatches(cash, movements), now = Date.now(), actor = {uid:"system", role:"system"}; let repaired = 0, skipped = 0;
  for (const candidate of candidates) {
    const mid = candidate.movementId, mv = Object.assign({id: mid}, movements[mid] || {});
    if (candidate.ambiguous || !Array.isArray(mv.lines) || !mv.lines.length || Math.abs(Financial.totals(mv.lines).debit - Financial.totals(mv.lines).credit) > 0.009 || mv.reversalOf || mv.reversedByMovementId) { skipped++; continue; }
    const reversalId = `finance_datefix_rev_${mid}`, repostId = `finance_datefix_new_${mid}`, reason = "System maintenance: align Finance posting date with its single linked cash-ledger date.";
    try {
      const reversal = Financial.reverseMovement(mv, "finance_date_repair_reversal", "System date alignment"); reversal.occurredAt = Number(mv.occurredAt) || now; reversal.controlReason = reason; reversal.redatedFromMovementId = mid;
      const repost = Financial.movement(mv.type || "finance_date_repair", mv.sourceType || "financeDateRepair", mv.sourceId || mid, mv.lines.map((line) => Financial.line(line.account, line.debit, line.credit, line.label || "Re-dated posting")), {occurredAt: accountingTimestamp(candidate.targetDate, now), actorName:"system", controlReason:reason, redatedFromMovementId:mid, redatedFrom:candidate.currentDate, redatedTo:candidate.targetDate, systemMaintenance:true});
      const reversalResult = await commitFinancial(db, reversalId, reversal, actor, {[`operationalAudit/${now}_automatic_datefix_${mid}`]:operationalAuditRecord("automatic_repair_finance_date", "financeDateRepair", mid, actor, {trigger, from:candidate.currentDate, to:candidate.targetDate, amount:candidate.amount, reversalId, repostId, reason})});
      const repostResult = await commitFinancial(db, repostId, repost, actor);
      await db.ref(`/financialMovements/${mid}`).update({dateRepairSupersededBy:repostId, dateRepairedAt:now, dateRepairType:"automatic_cash_date_alignment", dateRepairTrigger:trigger});
      if (!reversalResult.duplicate || !repostResult.duplicate) repaired++;
    } catch (error) { skipped++; logger.error("automatic finance-date repair skipped", {movementId:mid, error:String(error)}); }
  }
  return {repaired, skipped, examined:candidates.length};
}

exports.autoRepairFinanceDateOnCashLedgerCreate = onValueCreated(
  {ref:"/cfLedger/{ledgerId}", region: ORDER_REGION},
  async (event) => {
    const row = event.data.val() || {}, movementId = String(row.movementId || ""); if (!movementId || !row.date) return;
    const db = getDatabase(), movement = (await db.ref(`/financialMovements/${movementId}`).get()).val(); if (!movement) return;
    await automaticallyRepairFinanceDates(db, {[event.params.ledgerId]:row}, {[movementId]:movement}, "cash_ledger_created");
  },
);

exports.repairFinanceDates = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 20);
    const actor = await requirePortalPermission(db, request, ["cashflow", "receivables", "payables"]);
    const [cashSnap, mvSnap] = await Promise.all([db.ref("/cfLedger").get(), db.ref("/financialMovements").get()]);
    const cash = cashSnap.val() || {}, movements = mvSnap.val() || {};
    const byMovement = {};
    Object.keys(cash).forEach((id) => {
      const row = cash[id] || {}, mid = row.movementId, mv = mid && movements[mid];
      if (!mv || !row.date) return;
      if (mv.dateRepairSupersededBy) return;
      const cur = BooksBridge.businessDate(mv.occurredAt);
      if (cur === row.date) return;
      const prev = byMovement[mid];
      if (prev && prev.targetDate !== row.date) { prev.ambiguous = true; return; }
      if (!prev) byMovement[mid] = {movementId: mid, amount: Financial.money(row.amount), currentDate: cur, targetDate: row.date, type: String(mv.type || ""), cfLedgerId: id};
    });
    const mismatches = Object.keys(byMovement).map((k) => byMovement[k]);
    if (action === "preview" || !action) return {mismatches: mismatches.slice(0, 500), count: mismatches.length, ambiguous: mismatches.filter((m) => m.ambiguous).length};
    if (action !== "apply") throw new HttpsError("invalid-argument", "Unknown action.");
    if (!["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can apply date corrections.");
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    const approved = Array.isArray(data.movementIds) ? new Set(data.movementIds.map(String)) : null;
    const now = Date.now(); let repaired = 0, skipped = 0; const done = [];
    for (const m of mismatches) {
      if (m.ambiguous) { skipped++; continue; }
      if (approved && !approved.has(m.movementId)) { skipped++; continue; }
      const mid = m.movementId, mv = Object.assign({id: mid}, movements[mid] || {});
      if (!Array.isArray(mv.lines) || !mv.lines.length) { skipped++; continue; }
      const revId = `finance_datefix_rev_${mid}`, newId = `finance_datefix_new_${mid}`, targetTs = accountingTimestamp(m.targetDate, now);
      const reversal = Financial.reverseMovement(mv, "finance_date_repair_reversal", "Re-date correction"); reversal.occurredAt = Number(mv.occurredAt) || now; reversal.controlReason = reason; reversal.redatedFromMovementId = mid;
      const repost = Financial.movement(mv.type || "finance_date_repair", mv.sourceType || "financeDateRepair", mv.sourceId || mid, mv.lines.map((l) => Financial.line(l.account, l.debit, l.credit, l.label || "Re-dated posting")), {occurredAt: targetTs, actorName: actor.role, controlReason: reason, redatedFromMovementId: mid, redatedFrom: m.currentDate, redatedTo: m.targetDate});
      const rr = await commitFinancial(db, revId, reversal, actor, {[`operationalAudit/${now}_datefix_${mid}`]: operationalAuditRecord("repair_finance_date", "financeDateRepair", mid, actor, {from: m.currentDate, to: m.targetDate, amount: m.amount, reversalId: revId, repostId: newId, reason})});
      const pr = await commitFinancial(db, newId, repost, actor, {[`financialMovements/${mid}/dateRepairSupersededBy`]: newId, [`financialMovements/${mid}/dateRepairedAt`]: now});
      if (rr.duplicate && pr.duplicate) skipped++; else { repaired++; done.push({movementId: mid, from: m.currentDate, to: m.targetDate, amount: m.amount}); }
    }
    return {repaired, skipped, done: done.slice(0, 500)};
  },
);

function financialControlResolution(issue) {
  const resolutions = {
    unbalanced:["Open the source Finance posting and correct it through its original workflow. Do not create an offsetting journal just to force it to balance.","books_transactions","Open Finance Books"],
    movement_warning:["Open the linked payment method in Cash Accounts and assign its receiving account. The system will preserve the original sale and post the supported reclassification.","admin_finance","Open Cash Accounts"],
    sale_amount_mismatch:["Open the Admin sale, verify its completion, discount and refund status, then run the Daily Financial Close again. The close identifies the exact missing or duplicated posting.","admin_sales","Open Sales History"],
    legacy_cash_without_movement:["Review the original cash record and create its missing Finance movement through the controlled Cash Flow workflow. Do not manually edit the ledger row.","books_cashflow","Open Cash Flow"],
    cash_finance_date_mismatch:["Automatic repair was skipped because this movement has conflicting or unsafe date evidence. Verify the original cash date and linked Finance entry before a Finance owner corrects the period.","books_cashflow","Review Cash Flow"],
    sale_not_posted:["Open the completed order in Admin and run the Daily Financial Close. The system will identify the specific order posting that must be restored.","admin_sales","Open Sales History"],
    payout_movement_missing:["Open the platform payout and verify its linked settled orders. Re-run the controlled payout settlement; never journal Platform Payouts in Transit manually.","admin_finance","Open Platform Payouts"],
    reversed_payout_cash_not_reversed:["Use the controlled payout-deposit repair. It restores the clearing account and reverses the orphaned bank receipt while retaining the audit trail.","repair_reversed_payout","Repair deposit"],
    payout_deposit_missing_reference:["Open this exact platform payout and add the platform statement or bank transaction reference. This updates only evidence metadata; its amount, linked orders, receiving account, and Finance posting remain unchanged.","edit_payout_reference","Add payout reference"],
    payout_order_link_mismatch:["Open the platform payout and its listed orders. Correct the payout/order assignment from Platform Payouts, then run Daily Financial Close.","admin_finance","Open Platform Payouts"],
    platform_ar_control_mismatch:["Open Platform Receivables and compare unsettled orders with payout settlements. Correct the affected payout or order from its source workflow, then rerun Daily Financial Close.","admin_finance","Open Platform Receivables"],
    duplicate_cash_account_code:["Open Cash Accounts and give each bank or wallet a unique Finance Books account mapping before recording more deposits.","books_cashflow","Open Cash Accounts"],
    register_float_differs_from_control:["Open POS Settings and verify the approved register float. Use the controlled float adjustment; do not record it as a receipt or expense.","admin_finance","Open POS Settings"],
    undeposited_subledger_mismatch:["Open Undeposited Collection, reconcile the custody rows to the Finance balance, and use the controlled custody correction shown there.","admin_finance","Open Undeposited Collection"],
    cash_payment_missing_custody:["Open the exact approved cash payment. Record or restore enough physical cash custody first, then use the controlled repair so the payment and its custody allocation post together. Do not deposit the original shift amount.","admin_petty","Open Cash Payments"],
    holding_account_balance:["Open the original operational workflow named in the account description and finish its allocation, settlement, or variance resolution. Do not clear control accounts with a free-form journal.","books_transactions","Open Finance Books"],
    balance_off_chart:["Open Chart of Accounts, restore the account definition, and then review the linked posting before changing its account mapping.","books_transactions","Open Chart of Accounts"],
    balance_on_inactive_account:["Open Chart of Accounts and either reactivate the account while its balance is resolved, or complete the controlled transfer from its original source workflow.","books_transactions","Open Chart of Accounts"],
    unreviewed_discrepancies:["Open Admin Discrepancies, select the actual cause, and complete the linked Finance treatment. Each option records the operational and accounting resolution together.","admin_discrepancies","Open Discrepancies"],
  };
  const resolution = resolutions[issue.kind] || ["Open the linked source record, verify the supporting evidence, and use its controlled correction workflow. The audit trail must remain intact.","books_cashflow","Review source"];
  const titles = {payout_deposit_missing_reference:"Platform payout needs a reference",payout_movement_missing:"Platform payout posting is missing",payout_order_link_mismatch:"Platform payout order links need review",reversed_payout_cash_not_reversed:"Reversed platform payout still has a bank receipt"};
  return Object.assign(issue, {title:titles[issue.kind] || String(issue.kind || "Control exception").replace(/_/g, " "), solution:resolution[0], actionTarget:resolution[1], actionLabel:resolution[2]});
}

exports.auditFinancialControls = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["cashflow","receivables","payables"]);
    const snaps=await Promise.all([db.ref("/orders").get(),db.ref("/archivedOrders").get(),db.ref("/financialMovements").get(),db.ref("/cfLedger").get(),db.ref("/receivables").get(),db.ref("/payables").get(),db.ref("/platformPayouts").get(),db.ref("/cashCustody").get(),db.ref("/cfAccounts").get(),db.ref("/posSettings").get(),db.ref("/posActiveShift").get()]);
    const orders=Object.assign({},snaps[1].val()||{},snaps[0].val()||{}),cash=snaps[3].val()||{},ars=snaps[4].val()||{},aps=snaps[5].val()||{},payouts=snaps[6].val()||{},custody=snaps[7].val()||{},accounts=snaps[8].val()||{},issues=[];let movements=snaps[2].val()||{};
    const dateMaintenance=await automaticallyRepairFinanceDates(db,cash,movements,"financial_control_audit");if(dateMaintenance.repaired)movements=(await db.ref("/financialMovements").get()).val()||{};
    const resolvedPaymentMappings=new Set();Object.values(movements).forEach((m)=>{if(m&&m.type==="payment_account_reclassification"&&m.originalMovementId&&m.method)resolvedPaymentMappings.add(`${m.originalMovementId}|${financeText(m.method,60).toLowerCase()}`);});
    Object.keys(movements).forEach((id)=>{const m=movements[id],sum=Financial.totals(m.lines||[]);if(Math.abs(sum.debit-sum.credit)>0.009)issues.push({severity:"critical",kind:"unbalanced",source:id,amount:Financial.money(sum.debit-sum.credit)});(m.warnings||[]).forEach((w)=>{const match=/^No cash-flow account mapping for (.+)\.$/.exec(String(w||"")),resolved=match&&resolvedPaymentMappings.has(`${id}|${financeText(match[1],60).toLowerCase()}`);if(!resolved)issues.push({severity:"warning",kind:"movement_warning",source:id,detail:w});});});
    const saleMovementRows=Object.values(movements);Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status;if(o.voided||!["Completed","Received"].includes(status)||o.paymentStatus==="pending"||!movements[`sale_${id}`])return;const expected=Financial.orderNetSales(o),actual=Financial.sourceNetSales(saleMovementRows,id),difference=Financial.money(actual-expected);if(Math.abs(difference)>0.009)issues.push({severity:"critical",kind:"sale_amount_mismatch",source:id,detail:`Admin net sales ${expected.toFixed(2)}; Finance Books ${actual.toFixed(2)}`,amount:difference,expected,actual});});
    Object.keys(cash).forEach((id)=>{if(!cash[id].movementId)issues.push({severity:"warning",kind:"legacy_cash_without_movement",source:id,amount:Financial.money(cash[id].amount)});});
    Object.keys(cash).forEach((id)=>{const row=cash[id]||{},mv=movements[row.movementId];if(mv&&row.date&&!mv.dateRepairSupersededBy&&BooksBridge.businessDate(mv.occurredAt)!==row.date)issues.push({severity:"critical",kind:"cash_finance_date_mismatch",source:id,detail:`Cash ${row.date}; Finance ${BooksBridge.businessDate(mv.occurredAt)}`,amount:Financial.money(row.amount)});});
    let unsettledValue=0,unsettledCount=0;Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status,platform=["grabfood","foodpanda"].includes(o.channel);if(!o.voided&&["Completed","Received"].includes(status)&&o.paymentStatus!=="pending"&&!movements[`sale_${id}`])issues.push({severity:"critical",kind:"sale_not_posted",source:id,amount:Financial.money(o.total)});if(platform&&!o.voided&&(o.settlementStatus||"unsettled")!=="settled"){unsettledCount++;unsettledValue=Financial.money(unsettledValue+Financial.money(o.netPlatform));}if(!platform){const rows=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}];rows.forEach((p)=>{if(String(p.method||"").toLowerCase()==="cash")return;if(!Financial.accountForPayment(p,accounts))issues.push({severity:"warning",kind:"unmapped_payment_method",source:id,detail:financeText(p.method,60),amount:Financial.money(p.amount)});});}});
    Object.keys(payouts).forEach((id)=>{const p=payouts[id]||{},movementId=p.movementId||`payout_${id}`,channel=financeText(p.channel,40)||"Platform",payoutDate=financeText(p.payoutDate,10)||financeDateFromTimestamp(Number(p.settledAt)||Date.now()),account=accounts[p.accountId]||{},accountName=financeText(account.name,80)||"the selected receiving account",sourceLabel=`${channel} payout · ${payoutDate} · ${Financial.money(p.actualPayout).toFixed(2)}`;if(!movements[movementId])issues.push({severity:"critical",kind:"payout_movement_missing",source:id,sourceLabel,amount:Financial.money(p.expectedNet)});if(p.reversed&&p.depositMovementId&&!p.depositReversalMovementId)issues.push({severity:"critical",kind:"reversed_payout_cash_not_reversed",source:id,sourceLabel,amount:Financial.money(p.actualPayout)});if(p.depositMovementId&&!p.depositReference)issues.push({severity:"warning",kind:"payout_deposit_missing_reference",source:id,sourceLabel,detail:`Missing bank or platform reference for the ${channel} payout dated ${payoutDate} to ${accountName}.`,amount:Financial.money(p.actualPayout)});if(!p.reversed)(p.orderIds||[]).forEach((orderId)=>{const o=orders[orderId];if(!o||o.payoutId!==id||(o.settlementStatus||"unsettled")!=="settled")issues.push({severity:"critical",kind:"payout_order_link_mismatch",source:id,sourceLabel,detail:String(orderId)});});});
    const ledgerPlatform={grabfood:0,foodpanda:0};Object.values(movements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerPlatform[channel]=Financial.money(ledgerPlatform[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));const ledgerPlatformTotal=Financial.money(ledgerPlatform.grabfood+ledgerPlatform.foodpanda),platformDifference=Financial.money(ledgerPlatformTotal-unsettledValue);if(Math.abs(platformDifference)>0.009)issues.push({severity:"critical",kind:"platform_ar_control_mismatch",source:"platform_receivables",amount:platformDifference,expected:unsettledValue,actual:ledgerPlatformTotal});
    const codes={};Object.keys(accounts).forEach((id)=>{const code=BooksBridge.cashCodeForAccount(accounts[id]);(codes[code]||(codes[code]=[])).push(id);});Object.keys(codes).forEach((code)=>{if(codes[code].length>1)issues.push({severity:"critical",kind:"duplicate_cash_account_code",source:code,detail:codes[code].join(", ")});});
    const floatControl=resolveRegisterFloat(snaps[9].val()||{},snaps[10].val()||{});if(Math.abs(floatControl.amount-4000)>.009)issues.push({severity:"warning",kind:"register_float_differs_from_control",source:floatControl.source,amount:floatControl.amount,expected:4000});
    let custodyValue=0,custodyCount=0;Object.keys(custody).forEach((id)=>{const rem=Financial.money(custody[id].remaining);if(rem>0){custodyCount++;custodyValue=Financial.money(custodyValue+rem);}});let undepositedLedgerValue=0;Object.values(movements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{if(line.account==="asset:cash_awaiting_deposit")undepositedLedgerValue=Financial.money(undepositedLedgerValue+(Number(line.debit)||0)-(Number(line.credit)||0));}));const undepositedDifference=Financial.money(undepositedLedgerValue-custodyValue);if(Math.abs(undepositedDifference)>0.009)issues.push({severity:"critical",kind:"undeposited_subledger_mismatch",source:"cashCustody",detail:`Finance Books ${undepositedLedgerValue.toFixed(2)}; custody subledger ${custodyValue.toFixed(2)}`,amount:undepositedDifference,expected:custodyValue,actual:undepositedLedgerValue});const openAr=Object.values(ars).filter((x)=>x&&x.status==="open"),openAp=Object.values(aps).filter((x)=>x&&x.status==="open"),undepositedPayouts=Object.values(payouts).filter((x)=>x&&!x.reversed&&!x.depositMovementId&&Financial.money(x.actualPayout)>0);
    // --- Additive control checks (read-only; each guarded so a failure degrades, never breaks the audit) ---
    try {
      const [journalControlSnap,chartControlSnap,reconciliationConfigSnap]=await Promise.all([db.ref("/books/journal").get(),db.ref("/booksChart").get(),db.ref("/books/reconciliationConfig").get()]),journal=journalControlSnap.val()||{},bChart=chartControlSnap.val()||{},reconciliationConfig=ReconciliationControls.accountRules(reconciliationConfigSnap.val()||{}),bal=ReconciliationControls.journalBalances(journal);
      ReconciliationControls.controlAccountIssues(journal,reconciliationConfig).forEach((item)=>{const period=item.oldestDate&&item.newestDate?(item.oldestDate===item.newestDate?item.oldestDate:`${item.oldestDate} to ${item.newestDate}`):"undated";issues.push({severity:Math.abs(item.balance)>=1000?"critical":"warning",kind:"holding_account_balance",source:item.code,detail:`${item.rule.name||item.code}: ${item.count} post-cutover source entr${item.count===1?"y":"ies"} (${period}) remain uncleared`,amount:item.balance,sourceCount:item.count,oldestDate:item.oldestDate,newestDate:item.newestDate});});
      Object.keys(bal).forEach((code)=>{if(Math.abs(bal[code])<0.5)return;const row=bChart[code];if(!row)issues.push({severity:"critical",kind:"balance_off_chart",source:code,detail:"Account carries a balance but is not in the chart of accounts",amount:Financial.money(bal[code])});else if(row.active===false)issues.push({severity:"warning",kind:"balance_on_inactive_account",source:code,detail:financeText(row.name,60)+" is deactivated but still carries a balance",amount:Financial.money(bal[code])});});
    } catch(e){logger.warn("auditFinancialControls: holding/chart check skipped",{error:String(e)});}
    try {
      const discrepancies=(await db.ref("/discrepancies").get()).val()||{}, open=Object.keys(discrepancies).map((k)=>discrepancies[k]||{}).filter(ReconciliationControls.operationalDiscrepancy);
      if(open.length)issues.push({severity:"warning",kind:"unreviewed_discrepancies",source:"discrepancies",detail:open.length+" cash discrepancy(ies) awaiting manager review in Discrepancies",amount:Financial.money(open.reduce((s,d)=>s+Math.abs(Number(d.value!=null?d.value:d.variance||0)),0))});
    } catch(e){logger.warn("auditFinancialControls: discrepancy check skipped",{error:String(e)});}
    try {
      const petty=(await db.ref("/pettyCashVouchers").get()).val()||{};Object.keys(petty).forEach((id)=>{const voucher=petty[id]||{};if(voucher.status==="approved"&&!voucher.voided&&!movements[`petty_${id}`])issues.push({severity:"critical",kind:"cash_payment_missing_custody",source:id,detail:`Approved cash payment ${financeText(voucher.voucherNo||id,80)} has not reduced Undeposited Collection.`,amount:Financial.money(voucher.amount)});});
    } catch(e){logger.warn("auditFinancialControls: cash-payment custody check skipped",{error:String(e)});}
    // Never expose an internal key as the business-facing reference. Keep the
    // raw source for controlled actions, but present the actual transaction
    // context a manager can recognise from Admin or Finance Books.
    function businessReference(issue) {
      if (issue.sourceLabel) return issue;
      const source = String(issue.source || ""), order = orders[source] || {}, movement = movements[source] || {}, cashRow = cash[source] || {}, custodyRow = custody[source] || {}, receivable = ars[source] || {}, payable = aps[source] || {}, account = accounts[source] || {};
      const dated = (value) => financeDateFromTimestamp(Number(value) || Date.now());
      const amount = (value) => Financial.money(Number(value) || 0).toFixed(2);
      let label = "Related Finance control";
      if (Object.keys(order).length) { const reference = financeText(order.platformRef || order.orderNo || order.receiptNo,80); label = `${financeText(order.channel,40)||"POS"} sale${reference ? ` · ${reference}` : ""} · ${financeText(order.date,10)||dated(order.timestamp)} · ${amount(order.total)}`; }
      else if (Object.keys(cashRow).length) { label = `Cash entry · ${financeText(cashRow.category || cashRow.ref || cashRow.party,80)||"cash movement"} · ${financeText(cashRow.date,10)||dated(cashRow.ts)} · ${amount(cashRow.amount)}`; }
      else if (Object.keys(movement).length) { label = `Finance posting · ${financeText(movement.type,80).replace(/_/g," ")||"transaction"} · ${dated(movement.occurredAt)}`; }
      else if (Object.keys(custodyRow).length) { label = `Undeposited Collection · ${financeText(custodyRow.staff || custodyRow.shiftId,80)||"cash custody"} · ${amount(custodyRow.remaining)}`; }
      else if (Object.keys(receivable).length) { label = `Receivable · ${financeText(receivable.party || receivable.ref,80)||"customer balance"} · ${amount(receivable.amount)}`; }
      else if (Object.keys(payable).length) { label = `Payable · ${financeText(payable.party || payable.ref,80)||"supplier bill"} · ${amount(payable.amount)}`; }
      else if (Object.keys(account).length) { label = `Cash account · ${financeText(account.name,80)||"account"}`; }
      else if (source === "cashCustody") label = "Undeposited Collection control account";
      else if (source === "platform_receivables") label = "Platform receivables control account";
      else if (source === "discrepancies") label = "Cash differences awaiting manager review";
      else if (/^\d{4}$/.test(source)) label = `Finance Books account ${source}`;
      return Object.assign(issue, {sourceLabel: label});
    }
    const resolvedIssues=issues.map(businessReference).map(financialControlResolution);return{generatedAt:Date.now(),issues:resolvedIssues.slice(0,200),issueCount:resolvedIssues.length,systemDateMaintenance:dateMaintenance,registerFloat:{amount:floatControl.amount,expected:4000,source:floatControl.source},unsettledPlatform:{count:unsettledCount,amount:unsettledValue},cashAwaitingDeposit:{count:custodyCount,amount:custodyValue},openReceivables:{count:openAr.length,amount:Financial.money(openAr.reduce((s,x)=>s+Number(x.amount||0),0))},openPayables:{count:openAp.length,amount:Financial.money(openAp.reduce((s,x)=>s+Number(x.amount||0),0))},undepositedPayouts:undepositedPayouts.length};
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
const INVENTORY_BOOK_POSTING_TYPES = new Set(["waste", "staff_use", "rnd_testing", "adjustment", "manual_edit", "usage_reversal"]);
function inventoryBookAccountCode(item) {
  const code = String(item && item.inventoryAccount || "");
  return /^12[0-8]0$/.test(code) ? code : "1290";
}
// Every value-changing manual inventory movement posts a matching balanced
// Finance entry so inventory and the books can never diverge. Reconciliation
// adjustments/manual edits use one COGS basket (5905): debit is a loss and
// credit is a gain. Waste remains in 5900; staff and R&D use their mapped
// operating-expense accounts. Reversals exactly invert the original posting.
// Idempotent via commitFinancial(`invmove_${id}`); auto-mirrors to /books/journal.
function internalUsageAccount(type,movement){
  const fallback=type==="staff_use"?"6077":type==="rnd_testing"?"6078":"",requested=String(movement&&movement.usageAccount||fallback);
  if(!/^(5900|60\d{2})$/.test(requested)||requested==="5905")throw new HttpsError("failed-precondition","Internal usage requires an approved operating-expense account and cannot use inventory reconciliation 5905.");
  return requested;
}
function inventoryAdjustmentOffset(type,movement){
  if(!["adjustment","manual_edit","waste"].includes(type))return "";
  const requested=String(movement&&movement.offsetAccount||"").trim(),nature=String(movement&&movement.adjustmentNature||movement&&movement.note||"").trim().toLowerCase();
  if(!["3000","5900","5905"].includes(requested))throw new HttpsError("failed-precondition","Choose one approved Finance offset account: 3000 Owner's Capital, 5900 Wastage & Spoilage, or 5905 Inventory Reconciliation Gain / (Loss).");
  if(requested==="3000"&&nature!=="beginning-inventory")throw new HttpsError("failed-precondition","Owner's Capital may only offset a beginning inventory correction.");
  if(String(movement&&movement.sourceType||"")==="new-inventory-item"&&requested!=="3000")throw new HttpsError("failed-precondition","New-item opening inventory must offset Owner's Capital.");
  return requested;
}
async function postInventoryMovementToBooks(db, movement, item, actor, context) {
  const type = String(movement && movement.type || "");
  if (!INVENTORY_BOOK_POSTING_TYPES.has(type)) return;
  const value = Financial.money(movement.totalCost); // signed: negative = stock out
  if (Math.abs(value) < 0.005) return;
  const invCode = inventoryBookAccountCode(item);
  const label = `${type.replace(/_/g, " ")} \u00b7 ${String(item && item.name || movement.itemId || "").slice(0, 120)}`;
  const varianceBasket = type === "adjustment" || type === "manual_edit",usageBasket=type==="staff_use"||type==="rnd_testing"?internalUsageAccount(type,movement):"",adjustmentOffset=inventoryAdjustmentOffset(type,movement);
  let lines;
  if(type==="usage_reversal"){
    const original=context&&context.originalFinancial;
    if(!original||!Array.isArray(original.lines)||!original.lines.length)throw new HttpsError("failed-precondition","The original internal-usage Finance posting is missing. Repair it before restoring inventory.");
    lines=original.lines.map((line)=>Financial.line(line.account,Number(line.credit)||0,Number(line.debit)||0,`Reverse ${label}`));
  } else
  if (value < 0) {
    const out = Financial.money(-value);
    lines = [Financial.line(adjustmentOffset?`coa:${adjustmentOffset}`:varianceBasket ? "coa:5905" : usageBasket?`coa:${usageBasket}`:"coa:5900", out, 0, label), Financial.line(`coa:${invCode}`, 0, out, label)];
  } else {
    lines = [Financial.line(`coa:${invCode}`, value, 0, label), Financial.line(adjustmentOffset?`coa:${adjustmentOffset}`:varianceBasket ? "coa:5905" : "coa:4990", 0, value, label)];
  }
  const mv = Financial.movement(`inventory_${type}`, "inventoryMovement", String(movement.id || ""), lines, {occurredAt: Number(movement.occurredAt || movement.createdAt || Date.now()), actorName: String(actor && actor.role || "server"), itemId: String(movement.itemId || ""), invAccount: invCode,inventorySourceType:String(movement.sourceType||""),adjustmentOffsetAccount:adjustmentOffset,adjustmentNature:String(movement.adjustmentNature||""),usageAccount:usageBasket||String(originalUsageAccount(context)||"")});
  await commitFinancial(db, `invmove_${String(movement.id || "")}`, mv, actor || {uid: "server", role: "server"});
}
function originalUsageAccount(context){const original=context&&context.originalFinancial,line=original&&Array.isArray(original.lines)&&original.lines.find((row)=>/^coa:(5900|60\d{2})$/.test(String(row.account||"")));return line?String(line.account).slice(4):"";}
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
  let postingContext={};
  if(type==="staff_use"||type==="rnd_testing"){
    const chart=await ensureBooksChart(db),usageAccount=internalUsageAccount(type,raw),row=chart[usageAccount];
    if(!row||row.active===false||!(row.type==="Expense"||usageAccount==="5900"))throw new HttpsError("failed-precondition",`Internal usage account ${usageAccount} must be an active Expense account (or 5900 Wastage & Spoilage).`);
    raw.usageAccount=usageAccount;raw.usageKind=String(raw.usageKind||type).slice(0,80);
  }
  if(type==="usage_reversal"){
    const reversalOf=inventoryKey(raw.reversalOf,"Original inventory movement ID"),[originalInventorySnap,originalFinancialSnap]=await Promise.all([db.ref(`/inventoryMovements/${reversalOf}`).get(),db.ref(`/financialMovements/invmove_${reversalOf}`).get()]),originalInventory=originalInventorySnap.val()||{},originalFinancial=originalFinancialSnap.val();
    if(originalInventory.sourceType!=="internal-usage"||!originalFinancial||!["inventory_staff_use","inventory_rnd_testing","inventory_waste"].includes(String(originalFinancial.type||"")))throw new HttpsError("failed-precondition","Only a posted internal-usage movement can be reversed through Internal Usage.");
    postingContext={originalFinancial};
  }
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
      reversalOf: String(raw.reversalOf || "").slice(0, 160), usageKind:String(raw.usageKind||"").slice(0,80),usageAccount:String(raw.usageAccount||"").slice(0,4),offsetAccount:String(raw.offsetAccount||"").slice(0,4),adjustmentNature:String(raw.adjustmentNature||"").slice(0,80), version, schemaVersion: 3,
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
  if (movement) await postInventoryMovementToBooks(db, movement, item, actor, postingContext);
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
  // Watch the complete order. A later POS retry can replace the order after
  // finalization and accidentally drop the confirmation metadata. Re-running
  // is safe because every ingredient movement has a deterministic ID.
  {ref: "/orders/{orderId}", region: "asia-southeast1", retry: true},
  async (event) => {
    const orderId = event.params.orderId;
    const db = getDatabase();
    const oref = db.ref("/orders/" + orderId);
    const o = event.data.after.val();
    if (!o || (o.status !== "Completed" && o.status !== "Received") || !o.lineItems) return;
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

    // Production-monitor history is change-only and sanitized; retain the same
    // bounded four-month window as client telemetry.
    const monitorHistory = (await db.ref("/systemHealth/productionMonitor/history").get()).val() || {};
    Object.keys(monitorHistory).forEach((day) => { if (day < cutoffDay) mark(`systemHealth/productionMonitor/history/${day}`); });

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
    const envelope = RecoveryValidation.createEnvelope(snapshot, now, BACKUP_EXCLUDE);
    // Always preserve a recovery point, even when the business data later needs
    // reconciliation. Upload is blocked only for an invalid/corrupt envelope;
    // the isolated restore gate performs the strict accounting validation.
    const validation = RecoveryValidation.validateEnvelope(envelope, {reconcile: false});
    if (!validation.ok) throw new Error(`Backup validation failed: ${validation.issues.join("; ")}`);
    const payload = JSON.stringify(envelope);
    await bucket.file(objectName).save(payload, {
      resumable: false, contentType: "application/json",
      metadata: {cacheControl: "private, max-age=0, no-store", metadata: {takenAt: String(now), dataSha256: validation.actualSha256, backupVersion: "backup-v2"}},
    });
    await db.ref("/systemHealth/backups/latest").set({takenAt: now, objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, version: "backup-v2", dataSha256: validation.actualSha256, validation: "passed"});
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
    logger.info("backupDatabaseDaily complete", {objectName, bytes: payload.length, nodes: Object.keys(snapshot).length, dataSha256: validation.actualSha256, removed, rev: 3});
    return null;
  },
);

// Phase 13: hourly, read-only early-warning evaluation. It records sanitized
// health evidence only; it never edits an order, stock, subledger, or journal.
exports.evaluateProductionHealth = onSchedule(
  {schedule: "every 60 minutes", timeZone: "Asia/Manila", region: ORDER_REGION, timeoutSeconds: 120, memory: "256MiB"},
  async () => {
    const db=getDatabase(),now=Date.now(),today=financeDateFromTimestamp(now),yesterday=financeDateFromTimestamp(now-86400000);
    const [backupSnap,todaySnap,yesterdaySnap,previousSnap,notificationSnap,operational]=await Promise.all([db.ref("/systemHealth/backups/latest").get(),db.ref(`/clientTelemetryDaily/${today}`).get(),db.ref(`/clientTelemetryDaily/${yesterday}`).get(),db.ref("/systemHealth/productionMonitor/current").get(),db.ref("/systemHealth/productionMonitor/notificationState").get(),scanOperationalExceptions(db,now)]);
    const health=ProductionHealth.evaluate({backup:backupSnap.val()||{},telemetry:[todaySnap.val()||{},yesterdaySnap.val()||{}],operational},now),previous=previousSnap.val()||{},decision=AlertEscalation.decide(previous,health,notificationSnap.val()||{},now),writes={"systemHealth/productionMonitor/current":health};
    if(previous.signature!==health.signature||previous.status!==health.status)writes[`systemHealth/productionMonitor/history/${today}/${now}`]={evaluatedAt:now,status:health.status,signature:health.signature,counts:health.counts,alerts:health.alerts};
    await db.ref().update(writes);
    if(decision.notify){await notifyStaff(db,decision.title,decision.body,decision.link,decision.audience);await db.ref("/systemHealth/productionMonitor/notificationState").set(decision.nextState);}
    logger.info("Production health evaluated",{status:health.status,critical:health.counts.critical,warning:health.counts.warning,changed:previous.signature!==health.signature,notification:decision.reason});return null;
  },
);
