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
async function postInventoryMovementToBooks(db, movement, item, actor, context) {
  const type = String(movement && movement.type || "");
  if (!INVENTORY_BOOK_POSTING_TYPES.has(type)) return;
  const value = Financial.money(movement.totalCost); // signed: negative = stock out
  if (Math.abs(value) < 0.005) return;
  const invCode = inventoryBookAccountCode(item);
  const label = `${type.replace(/_/g, " ")} \u00b7 ${String(item && item.name || movement.itemId || "").slice(0, 120)}`;
  const varianceBasket = type === "adjustment" || type === "manual_edit",usageBasket=type==="staff_use"||type==="rnd_testing"?internalUsageAccount(type,movement):"";
  let lines;
  if(type==="usage_reversal"){
    const original=context&&context.originalFinancial;
    if(!original||!Array.isArray(original.lines)||!original.lines.length)throw new HttpsError("failed-precondition","The original internal-usage Finance posting is missing. Repair it before restoring inventory.");
    lines=original.lines.map((line)=>Financial.line(line.account,Number(line.credit)||0,Number(line.debit)||0,`Reverse ${label}`));
  } else
  if (value < 0) {
    const out = Financial.money(-value);
    lines = [Financial.line(varianceBasket ? "coa:5905" : usageBasket?`coa:${usageBasket}`:"coa:5900", out, 0, label), Financial.line(`coa:${invCode}`, 0, out, label)];
  } else {
    lines = [Financial.line(`coa:${invCode}`, value, 0, label), Financial.line(varianceBasket ? "coa:5905" : "coa:4990", 0, value, label)];
  }
  const mv = Financial.movement(`inventory_${type}`, "inventoryMovement", String(movement.id || ""), lines, {occurredAt: Number(movement.occurredAt || movement.createdAt || Date.now()), actorName: String(actor && actor.role || "server"), itemId: String(movement.itemId || ""), invAccount: invCode,inventorySourceType:String(movement.sourceType||""),usageAccount:usageBasket||String(originalUsageAccount(context)||"")});
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
      reversalOf: String(raw.reversalOf || "").slice(0, 160), usageKind:String(raw.usageKind||"").slice(0,80),usageAccount:String(raw.usageAccount||"").slice(0,4), version, schemaVersion: 2,
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
