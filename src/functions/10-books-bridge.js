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
    const ref = db.ref(`/cfAccounts/${id}`), old = (await ref.get()).val() || {}, opening = Financial.money(data.opening), oldOpening = Financial.money(old.opening), date = financeDate(data.openingDate), occurredAt = Date.parse(`${date}T00:00:00+08:00`) || Date.now(), reference=financeText(data.reference,120), reason=financeText(data.reason,300);
    const feedMethods = Array.isArray(data.feedMethods) ? data.feedMethods.map((x) => financeText(x, 60)).filter(Boolean).slice(0, 20) : [];
    const row = {name, type, opening, openingDate: date, feedMethods, order: Number.isFinite(Number(old.order)) ? Number(old.order) : Object.keys((await db.ref("/cfAccounts").get()).val() || {}).length, ts: old.ts || Date.now(), updatedAt: Date.now(), updatedBy: actor.uid};
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
