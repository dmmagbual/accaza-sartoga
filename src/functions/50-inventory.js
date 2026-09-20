const INVENTORY_MOVEMENT_TYPES = new Set([
  "opening_balance", "purchase", "sale_usage", "staff_use", "rnd_testing",
  "waste", "adjustment", "manual_edit", "usage_reversal",
  "void_reversal", "refund_reversal", "purchase_reversal", "purchase_quantity_correction", "revaluation",
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
// /inventoryAccounting/{itemId}.applied is the in-transaction idempotency set. It used to
// keep a full copy of every movement ever applied, so each sale re-downloaded the item's
// whole history (217 KB for a busy packaging item by Sep 2026) inside its transaction.
// A full copy is now kept only until its /inventoryMovements projection is written; then
// it becomes a small marker that is pruned after the retention window. Movements already
// projected are recognized before the transaction by their projection record.
// Markers only need to outlive the gap between the balance transaction and the projection
// write (seconds) plus event redelivery (retry-guard stops redelivery after two hours); after
// that the /inventoryMovements projection is the duplicate check, and projections are never
// deleted. 24 hours keeps a wide margin while holding a seventh of the markers that 7 days did
// -- every movement downloads this record twice (read + transaction).
const INVENTORY_APPLIED_RETENTION_MS = 24 * 3600000;
const INVENTORY_LEGACY_SETTLE_MS = 3600000;
function inventoryAppliedMarker(entry) { return !!(entry && typeof entry === "object" && Number(entry.projectedAt) > 0 && !entry.itemId); }
function compactInventoryApplied(applied, now) {
  const out = {};
  Object.keys(applied || {}).forEach((id) => {
    const entry = applied[id];
    if (inventoryAppliedMarker(entry) && Number(entry.projectedAt) < now - INVENTORY_APPLIED_RETENTION_MS) return;
    out[id] = entry;
  });
  return out;
}
// One-time, idempotent migration of legacy full copies: confirm (or restore) each old
// movement's projection, then replace the copy with a marker dated at the movement.
async function settleLegacyInventoryApplied(db, itemId, accounting, now) {
  const applied = accounting && accounting.applied || {};
  const legacy = Object.keys(applied).filter((id) => { const entry = applied[id]; return entry && !inventoryAppliedMarker(entry) && Number(entry.createdAt || 0) > 0 && Number(entry.createdAt) < now - INVENTORY_LEGACY_SETTLE_MS; });
  if (!legacy.length) return 0;
  const writes = {};
  for (let i = 0; i < legacy.length; i += 50) {
    const batch = legacy.slice(i, i + 50);
    const snaps = await Promise.all(batch.map((id) => db.ref(`/inventoryMovements/${id}`).get()));
    batch.forEach((id, index) => {
      if (!snaps[index].exists()) writes[`inventoryMovements/${id}`] = applied[id];
      writes[`inventoryAccounting/${itemId}/applied/${id}`] = {projectedAt: Number(applied[id].createdAt), version: Number(applied[id].version || 0), legacy: true};
    });
  }
  const restore = {}, mark = {};
  Object.keys(writes).forEach((path) => { (path.indexOf("inventoryMovements/") === 0 ? restore : mark)[path] = writes[path]; });
  if (Object.keys(restore).length) await db.ref().update(restore);
  await db.ref().update(mark);
  return legacy.length;
}
async function markInventoryProjected(db, itemId, ids, version, now) {
  const writes = {};
  ids.filter(Boolean).forEach((id) => { writes[`inventoryAccounting/${itemId}/applied/${id}`] = {projectedAt: now, version: Number(version || 0)}; });
  if (Object.keys(writes).length) await db.ref().update(writes);
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
const INVENTORY_BOOK_POSTING_TYPES = new Set(["waste", "staff_use", "rnd_testing", "adjustment", "manual_edit", "usage_reversal", "revaluation"]);
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
  const COST_OF_SALES_ACCOUNTS=["5000","5030","5040"];
  if(type==="revaluation"){
    /* A revaluation restates the cost of stock still on hand. It is a costing correction, not wastage,
       so 5900 is not offered. Owner's Capital is allowed only where the quantity path allows it too:
       correcting inventory the owner brought in, never an operating costing error. */
    const want=String(movement&&movement.offsetAccount||"5905").trim(),why=String(movement&&movement.adjustmentNature||"").trim().toLowerCase();
    if(!["3000","5905"].includes(want))throw new HttpsError("failed-precondition","A revaluation must offset 5905 Inventory Reconciliation Gain / (Loss), or 3000 Owner's Capital for a beginning inventory correction.");
    if(want==="3000"&&why!=="beginning-inventory")throw new HttpsError("failed-precondition","Owner's Capital may only offset a beginning inventory correction.");
    return want;
  }
  if(!["adjustment","manual_edit","waste"].includes(type))return "";
  const requested=String(movement&&movement.offsetAccount||"").trim(),nature=String(movement&&movement.adjustmentNature||movement&&movement.note||"").trim().toLowerCase();
  /* A costing correction puts back stock that was expensed but never consumed, so it credits the
     cost-of-sales account the error was charged to. It is not wastage and not a reconciliation
     gain, and no other adjustment may reach a cost-of-sales account. */
  if(COST_OF_SALES_ACCOUNTS.includes(requested)){
    if(nature!=="costing-correction")throw new HttpsError("failed-precondition","A cost of sales account may only offset a costing correction.");
    if(type!=="adjustment")throw new HttpsError("failed-precondition","A costing correction must be posted as a stock adjustment.");
    return requested;
  }
  if(nature==="costing-correction")throw new HttpsError("failed-precondition","A costing correction must offset the cost of sales account it was charged to.");
  if(!["3000","5900","5905"].includes(requested))throw new HttpsError("failed-precondition","Choose one approved Finance offset account: 3000 Owner's Capital, 5900 Wastage & Spoilage, or 5905 Inventory Reconciliation Gain / (Loss).");
  if(nature==="beginning-inventory"&&requested!=="3000")throw new HttpsError("failed-precondition","Beginning inventory must offset Owner's Capital and cannot affect profit or COGS.");
  if(requested==="3000"&&nature!=="beginning-inventory")throw new HttpsError("failed-precondition","Owner's Capital may only offset a beginning inventory correction.");
  if(String(movement&&movement.sourceType||"")==="new-inventory-item"&&requested!=="3000")throw new HttpsError("failed-precondition","New-item opening inventory must offset Owner's Capital.");
  if(String(movement&&movement.sourceType||"")==="inventory-xlsx"){
    const purpose=String(movement&&movement.importPurpose||"").trim().toLowerCase(),confirmed=movement&&movement.classificationConfirmed===true;
    if(!confirmed||!["opening","reconciliation"].includes(purpose))throw new HttpsError("failed-precondition","Choose and confirm the inventory import accounting purpose before posting.");
    if(purpose==="opening"&&(nature!=="beginning-inventory"||requested!=="3000"))throw new HttpsError("failed-precondition","A beginning-inventory import must post against Owner's Capital.");
    if(purpose==="reconciliation"&&(nature!=="inventory-reconciliation"||requested!=="5905"))throw new HttpsError("failed-precondition","A current inventory reconciliation import must post against account 5905.");
  }
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
  const setCost = raw.setCost === true || type === "purchase" || type === "purchase_reversal" || type === "purchase_quantity_correction" || type === "revaluation";
  if (type === "purchase" && qty > 0 && !(requestedCost > 0)) throw new HttpsError("invalid-argument", "A received purchase must have a unit cost greater than zero.");
  if (type === "revaluation") {
    if (qty !== 0) throw new HttpsError("invalid-argument", "A revaluation changes the unit cost only. Use a stock adjustment to move quantity.");
    if (!(requestedCost >= 0)) throw new HttpsError("invalid-argument", "Enter the corrected unit cost.");
  }
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
  let duplicate = false, insufficient = false, insufficientValue = false, nothingToRevalue = false;
  const accountingRef = db.ref(`/inventoryAccounting/${itemId}`);
  const projectedSnap = await db.ref(`/inventoryMovements/${movementId}`).get();
  let existingAccounting = (await accountingRef.get()).val();
  if (existingAccounting && await settleLegacyInventoryApplied(db, itemId, existingAccounting, now)) existingAccounting = (await accountingRef.get()).val();
  if (projectedSnap.exists() && existingAccounting) {
    // Already applied and projected: never touch the balance again.
    const projected = projectedSnap.val();
    await postInventoryMovementToBooks(db, projected, item, actor, postingContext);
    await repairInventoryProjections(db, itemId, existingAccounting, item);
    return {movement: projected, duplicate: true};
  }
  if (!existingAccounting && qty6(item.stock) > 0 && !(qty6(item.cost) > 0) && type !== "purchase") throw new HttpsError("failed-precondition", `${String(item.name || itemId)} has positive opening stock without a unit cost. Restate its invoice-backed opening cost before posting inventory usage or adjustments.`);
  // RTDB transactions may invoke the updater once with an empty local cache
  // before the server value arrives.  A purchase reversal must not seed that
  // pass from the legacy inventory projection because its stock can be stale.
  // Preload the authoritative ledger so the first pass uses the real balance.
  const accountingSeed = existingAccounting || seedInventoryAccounting(itemId, item, now);
  const result = await accountingRef.transaction((current) => {
    const base = current || accountingSeed;
    const state = Object.assign({}, base, {applied: compactInventoryApplied(base.applied, now)});
    if (state.applied[movementId]) { duplicate = true; return state; }
    const before = qty6(state.balance);
    const costBefore = qty6(state.unitCost || item.cost);
    const after = qty6(before + qty);
    if (["purchase_reversal", "purchase_quantity_correction"].includes(type) && after < 0) {insufficient = true; return;}
    if (type === "revaluation" && !(before > 0)) {nothingToRevalue = true; return;}
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
    } else if (type === "purchase_quantity_correction") {
      // This fixes units on the source document without changing money. Keep
      // the current carrying value and spread it over the corrected quantity.
      costAfter = after > 0 ? qty6((before * costBefore) / after) : costBefore;
    } else if (setCost) {
      costAfter = requestedCost;
    }
    const version = Number(state.version || 0) + 1;
    const movement = {
      id: movementId, itemId,
      itemName: String(item.name || itemId).slice(0, 160), unit: String(item.unit || "").slice(0, 40),
      type, qty, unitCost: (type === "revaluation" || ["purchase", "purchase_reversal"].includes(type)) ? requestedCost : costBefore,
      /* A revaluation moves no quantity, so qty * cost is zero and nothing would reach the ledger.
         Its value is the restatement of the stock still on hand: qty on hand * (new cost - old cost). */
      totalCost: type === "purchase_quantity_correction" ? 0 : type === "revaluation" ? money(before * (requestedCost - costBefore)) : money(qty * (["purchase", "purchase_reversal"].includes(type) ? requestedCost : costBefore)),
      balanceBefore: before, balanceAfter: after, costBefore, costAfter,
      sourceType: String(raw.sourceType || type).slice(0, 80),
      sourceId: String(raw.sourceId || "").slice(0, 160),
      sourceLine: String(raw.sourceLine || itemId).slice(0, 160),
      note: String(raw.note || "").slice(0, 500),
      actorUid: actor && actor.uid || "server", actorName: String(raw.actorName || actor && actor.role || "server").slice(0, 120),
      occurredAt: Number(raw.occurredAt || now), createdAt: now,
      reversalOf: String(raw.reversalOf || "").slice(0, 160), usageKind:String(raw.usageKind||"").slice(0,80),usageAccount:String(raw.usageAccount||"").slice(0,4),offsetAccount:String(raw.offsetAccount||"").slice(0,4),adjustmentNature:String(raw.adjustmentNature||"").slice(0,80),importPurpose:String(raw.importPurpose||"").slice(0,20),classificationConfirmed:raw.classificationConfirmed===true, version, schemaVersion: 3,
    };
    state.balance = after; state.unitCost = costAfter; state.version = version;
    state.lastMovementId = movementId; state.lastMovementAt = now;
    state.applied[movementId] = movement;
    return state;
  });
  if (!result.committed) {if (nothingToRevalue) throw new HttpsError("failed-precondition", `${item.name || itemId} has no stock on hand, so there is no value to restate. Receive stock first.`);if (insufficient) throw new HttpsError("failed-precondition", `Not enough remaining stock to reverse ${item.name || itemId}.`);if (insufficientValue) throw new HttpsError("failed-precondition", `The remaining stock value for ${item.name || itemId} cannot support this reversal.`);throw new Error(`Inventory transaction was not committed for ${itemId}`);}
  const accounting = result.snapshot.val();
  const appliedEntry = (accounting.applied || {})[movementId];
  let movement = inventoryAppliedMarker(appliedEntry) ? null : appliedEntry;
  const openingEntry = (accounting.applied || {})[`opening_${itemId}`];
  const opening = inventoryAppliedMarker(openingEntry) ? null : openingEntry;
  const writes = {};
  if (opening) writes[`inventoryMovements/${opening.id}`] = opening;
  if (movement) writes[`inventoryMovements/${movementId}`] = movement;
  if (Object.keys(writes).length) await db.ref().update(writes);
  // A concurrent attempt may already have projected and marked this movement.
  if (!movement && inventoryAppliedMarker(appliedEntry)) movement = (await db.ref(`/inventoryMovements/${movementId}`).get()).val();
  if (Object.keys(writes).length) await markInventoryProjected(db, itemId, [opening && opening.id, (accounting.applied || {})[movementId] === movement ? movementId : ""], accounting.version, Date.now());
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
    const serverOnly = new Set(["opening_balance", "sale_usage", "void_reversal", "refund_reversal", "purchase_reversal", "purchase_quantity_correction"]);
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
    const inventory = /* download-ok: manual inventory ledger initialisation */(await db.ref("/inventory").get()).val() || {};
    const uncosted = Object.keys(inventory).filter((itemId) => qty6(inventory[itemId] && inventory[itemId].stock) > 0 && !(qty6(inventory[itemId] && inventory[itemId].cost) > 0));
    if (uncosted.length) throw new HttpsError("failed-precondition", `Inventory ledger initialization stopped: ${uncosted.slice(0, 8).map((itemId) => String(inventory[itemId].name || itemId)).join(", ")} ${uncosted.length > 8 ? `and ${uncosted.length - 8} more ` : ""}have positive stock without a unit cost. Enter invoice-backed opening costs first.`);
    let initialized = 0;
    for (const itemId of Object.keys(inventory)) {
      const ref = db.ref(`/inventoryAccounting/${itemId}`);
      const now = Date.now();
      let existed = false;
      const result = await ref.transaction((current) => {if (current) {existed = true; return current;} return seedInventoryAccounting(itemId, inventory[itemId], now);});
      const accounting = result.snapshot.val();
      const opening = accounting && accounting.applied && accounting.applied[`opening_${itemId}`];
      if (opening && !inventoryAppliedMarker(opening) && opening.id) await db.ref(`/inventoryMovements/${opening.id}`).set(opening);
      await repairInventoryProjections(db, itemId, accounting, inventory[itemId]);
      if (!existed) initialized++;
    }
    await markerRef.set(Date.now());
    logger.info("Inventory ledger ensured", {uid: actor.uid, items: Object.keys(inventory).length, initialized});
    return {items: Object.keys(inventory).length, initialized};
  },
);

function positiveOrderInventoryUsage(raw) {
  const usage={};
  Object.keys(raw||{}).forEach((itemId)=>{const quantity=qty6(raw[itemId]);if(quantity<0)throw new Error(`Order inventory usage cannot be negative for ${itemId}.`);if(quantity>0)usage[itemId]=quantity;});
  return usage;
}

function buildOrderInventoryPlan(costing, inv, ps, capturedAt) {
  const invCategories=ps.invCategories||{},categorySnapshot={food:0,beverage:0,packaging:0,directLabor:0,unallocated:0},accountSnapshot={};
  costing.lines.forEach((line)=>{const item=inv[line.ingredientId]||{},category=invCategories[item.category]||{},label=String(category.name||item.category||"").toLowerCase();let bucket="unallocated";if(/packag|cup|lid|straw|napkin|container/.test(label))bucket="packaging";else if(/beverage|drink|coffee|tea|milk|syrup|powder/.test(label))bucket="beverage";else if(/food|ingredient|bakery|kitchen|pastry|meal/.test(label))bucket="food";categorySnapshot[bucket]+=Number(line.totalCost)||0;const mapping=BooksBridge.itemAccounts(item),key=mapping.inventory&&mapping.cost?`${mapping.inventory}|${mapping.cost}`:"1290|5090";accountSnapshot[key]=Financial.money((accountSnapshot[key]||0)+Number(line.totalCost||0));});
  Object.keys(categorySnapshot).forEach((key)=>{categorySnapshot[key]=Math.round(categorySnapshot[key]*100)/100;});
  return{schemaVersion:1,capturedAt,capturedBy:"server",engineVersion:costing.engineVersion,usage:positiveOrderInventoryUsage(costing.usage),totalCost:costing.totalCost,categorySnapshot,accountSnapshot,cogsCovered:costing.cogsCovered,lines:costing.lines,warnings:costing.warnings};
}

// Sale-time costing. Recipes, menu items, inventory and packaging rules are read record by
// record for the lines of this order (readCatalogKeyed), so a sale downloads a few KB instead
// of the whole catalog; the plan is identical to one built from the full catalog.
async function calculateOrderInventoryPlan(db,order,capturedAt=Date.now(),orderId="") {
  const [optSnap,ps]=await Promise.all([/* download-ok: catalog option recipes are menu configuration, not history (empty on 16 Sep 2026) */db.ref("/optionRecipes").get(),readPosSettings(db,["sharedBaseIngredients","optionCosts","packagingAssignments","invCategories"])]),optionRaw=optSnap.val()||{},optionRecipes={};
  Object.keys(optionRaw).forEach((key)=>{const row=optionRaw[key]||{};optionRecipes[row.label||key]=row;});
  return readCatalogKeyed(db,["recipes","inventory","menuItems","optionGroups","packagingRules"],(maps)=>{
    const costing=Costing.costOrder({lineItems:order.lineItems||[],recipes:maps.recipes,inventory:maps.inventory,menuItems:maps.menuItems,sharedBaseIngredients:ps.sharedBaseIngredients||{},optionCosts:ps.optionCosts||{},optionRecipes,optionGroups:maps.optionGroups,packagingRules:maps.packagingRules,packagingAssignments:ps.packagingAssignments||{}});
    if(!costing.ok)throw new Error("Authoritative costing rejected order"+(orderId?" "+orderId:"")+": "+costing.errors.slice(0,5).map(row=>row.code+": "+row.message).join(" | "));
    return buildOrderInventoryPlan(costing,maps.inventory,ps,capturedAt);
  });
}

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
      // The immutable sale-time plan is read first. When it already exists (a
      // retry, or a re-write of an order that was finalized before archiving),
      // the catalog is not needed and is not downloaded again.
      const planSnap = await db.ref(`/orderInventoryPlans/${orderId}`).get();
      const hasPlan = planSnap.exists();
      // Otherwise the plan is costed now from the records this order uses.
      const capturedAt=Date.now(),candidate=hasPlan?null:await calculateOrderInventoryPlan(db,o,capturedAt,orderId);
      const planResult=await db.ref(`/orderInventoryPlans/${orderId}`).transaction((current)=>current||candidate,undefined,false),plan=planResult.snapshot.val();
      if(!plan||plan.capturedBy!=="server"||Number(plan.schemaVersion)!==1||!plan.usage)throw new Error("Immutable server inventory plan is missing for order "+orderId);
      const usage = positiveOrderInventoryUsage(plan.usage);
      const ids = Object.keys(usage);
      const cogs = Number(plan.totalCost)||0,cogsCategorySnapshot=plan.categorySnapshot||{},cogsAccountSnapshot=plan.accountSnapshot||{};

      await Promise.all(ids.map((ing) => applyInventoryMovement(db, {
        movementId: `sale_${orderId}_${ing}`,
        itemId: ing, type: "sale_usage", qty: -qty6(usage[ing]),
        sourceType: "order", sourceId: orderId, sourceLine: ing,
        note: `Ingredient usage for order ${orderId}`,
        occurredAt: Number(o.completedAt || o.receivedAt || Date.now()),
        actorName: o.onDuty || o.staff || "Order finalization",
      }, {uid: "server", role: "server"})));
      const finalizationMetadata = {
        inventoryDeducted: true,
        inventoryUsage: usage,
        inventoryDeductedAt: Date.now(),
        cogsSnapshot: cogs,
        cogsCategorySnapshot,
        cogsCategorySnapshotVersion: 1,
        cogsAccountSnapshot,
        cogsAccountSnapshotVersion: 1,
        cogsCovered: plan.cogsCovered,
        // The line-by-line COGS trace stays in the immutable plan. Copying it onto the order
        // (about two thirds of every order record) made every order list download it again.
        cogsDetailSource: {
          path: `orderInventoryPlans/${orderId}`, engineVersion: plan.engineVersion, computedAt: plan.capturedAt,
          totalCost: cogs, lineCount: (plan.lines||[]).length, warningCount: (plan.warnings||[]).length,
        },
        costingEngineVersion: plan.engineVersion,
        deductedBy: "server",
        inventoryLedgerVersion: 1,
      };
      // Archiving can win the race while costing is running. A transaction will
      // never recreate a deleted live order; if it has already moved, attach the
      // exact same confirmation metadata to the archived source record instead.
      await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, orderId, finalizationMetadata);
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
    const corrected = !!(order.completedOrderCorrectionId && order.correctedInventoryUsage), usage = positiveOrderInventoryUsage(corrected ? order.correctedInventoryUsage : (order.inventoryUsage || {}));
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
      reversalOf: corrected ? `crs_${order.correctionInventoryToken}_${itemId}` : `sale_${orderId}_${itemId}`, actorName: order.onDuty || order.staff || "Order reversal",
    }, {uid: "server", role: "server"})));
    await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, orderId, {
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
