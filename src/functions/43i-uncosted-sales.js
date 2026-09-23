
// ---------------------------------------------------------------------------
// Sales without a usable recipe (24 Sep 2026)
//
// Every paid sale proceeds. A line whose recipe is missing or broken takes no stock and
// carries no cost at the time of sale; it is recorded in /uncostedSales/{orderId}__{variant}_{line}
// and stays open until a manager resolves it:
//   - apply_recipe: once the recipe is built, the line is costed now. Stock is deducted with
//     order-linked movements ucs_<row>_<item>, and Dr Cost of Sales / Cr Inventory is posted
//     as its own Finance movement ucogs_<row>, dated on the original sale date when that
//     period is open, otherwise today. Posted sales are never rewritten.
//   - confirm_no_cost: the line genuinely has no cost (for example an add-on already costed
//     inside the drink); closed at zero with a reason, optionally marking the item
//     "no recipe needed" so it is not flagged again.
// Every step is idempotent (fixed IDs, a leased claim that stores the plan it will post) and
// is reversed with the sale when stock is returned on a void or refund.
// ---------------------------------------------------------------------------
const UNCOSTED_MANAGER_ROLES = ["owner", "superadmin", "admin", "manager"];
const UNCOSTED_APPLY_LEASE_MS = 5 * 60 * 1000;
const UNCOSTED_BATCH_LIMIT = 40;
const UNCOSTED_LIST_LIMIT = 500;
const UNCOSTED_SCAN_LIMIT = 150;
const UNCOSTED_SCAN_FIRST_DATE = "2026-09-01";

async function uncostedLinesForPlan(db, plan, lineItems) {
  if (plan && (plan.uncostedLines || Number(plan.uncostedVersion) >= 1)) return plan.uncostedLines ? UncostedSales.planUncostedLines(plan, lineItems, {}) : [];
  const keys = [...new Set(((plan && plan.warnings) || []).filter((row) => row && row.code === "MISSING_RECIPE" && row.itemKey).map((row) => String(row.itemKey)))].filter((key) => /^[A-Za-z0-9_-]{1,160}$/.test(key));
  if (!keys.length) return [];
  const menu = {};
  await Promise.all(keys.map(async (key) => { menu[key] = (await db.ref(`/menuItems/${key}`).get()).val() || {}; }));
  return UncostedSales.legacyUncostedLines(plan, lineItems, menu);
}

async function registerUncostedSale(db, orderId, order, lines, variant) {
  const now = Date.now(), occurredAt = Number(order.completedAt || order.receivedAt || order.timestamp) || now;
  const rows = UncostedSales.registerRows({order, orderId, lines, variant, now, businessDate: financeDateFromTimestamp(occurredAt)});
  // Registration never overwrites a row that already exists (it may be resolved).
  await Promise.all(Object.keys(rows).map((id) => db.ref(`/uncostedSales/${id}`).transaction((current) => current || rows[id], undefined, false)));
  return rows;
}

async function uncostedRowsForOrder(db, orderId) {
  return (await db.ref("/uncostedSales").orderByChild("orderId").equalTo(orderId).get()).val() || {};
}
async function refreshCostPendingLines(db, orderId) {
  const rows = await uncostedRowsForOrder(db, orderId);
  const pending = Object.values(rows).filter((row) => row && (row.status === "open" || row.status === "applying")).length;
  await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, orderId, {costPendingLines: pending || null});
  return pending;
}
// A completed-order item correction replaces the sale lines; flags for the old lines no longer apply.
async function supersedeUncostedSale(db, orderId, keepVariant) {
  const rows = await uncostedRowsForOrder(db, orderId), at = Date.now();
  await Promise.all(Object.keys(rows).filter((id) => rows[id] && rows[id].status === "open" && rows[id].variant !== keepVariant).map((id) =>
    db.ref(`/uncostedSales/${id}`).transaction((current) => current === null ? null : current.status === "open" ? Object.assign({}, current, {status: "superseded", closedAt: at}) : current, undefined, false)));
}
async function closeUncostedRowsForReversedSale(db, orderId, status) {
  const rows = await uncostedRowsForOrder(db, orderId), at = Date.now();
  await Promise.all(Object.keys(rows).filter((id) => rows[id] && rows[id].status === "open").map((id) =>
    db.ref(`/uncostedSales/${id}`).transaction((current) => current === null ? null : current.status === "open" ? Object.assign({}, current, {status, closedAt: at}) : current, undefined, false)));
}

async function uncostedPeriodOpen(db, at) {
  try { await assertAccountingPeriodOpen(db, at, "posting a cost correction"); return true; } catch (error) { if (error && error.code === "failed-precondition") return false; throw error; }
}

async function findOrderRecord(db, orderId) {
  const live = (await db.ref(`/orders/${orderId}`).get()).val();
  if (live && (live.id || live.status || live.lineItems)) return live;
  return (await db.ref(`/archivedOrders/${orderId}`).get()).val() || null;
}

// Stock returned on a void or refund includes what the cost corrections deducted later.
async function reverseUncostedCostCorrections(db, orderId, order, type) {
  const corrections = order.costCorrections || {}, reversed = {};
  for (const key of Object.keys(corrections).sort()) {
    const correction = corrections[key] || {};
    if (correction.reversedAt) continue;
    const usage = positiveOrderInventoryUsage(correction.usage || {});
    for (const itemId of Object.keys(usage).sort()) await applyInventoryMovement(db, {
      movementId: `${type}_ucs_${key}_${itemId}`, itemId, type, qty: qty6(usage[itemId]), sourceType: "order_cost_correction_reversal",
      sourceId: orderId, sourceLine: itemId, reversalOf: `ucs_${key}_${itemId}`, note: `Return stock deducted by the cost correction of ${orderId}`, actorName: "Order reversal",
    }, {uid: "server", role: "server"});
    if (correction.financialMovementId) {
      const original = (await db.ref(`/financialMovements/${correction.financialMovementId}`).get()).val();
      if (original) {
        const reversal = Financial.reverseMovement(Object.assign({id: correction.financialMovementId}, original), "order_cost_correction_reversal", "Stock returned");
        reversal.occurredAt = Date.now(); reversal.actorName = "Order reversal"; reversal.uncostedSaleId = key;
        await commitFinancial(db, `ucogs_rev_${key}`, reversal, {uid: "server", role: "server"});
      }
    }
    reversed[key] = Object.assign({}, correction, {reversedAt: Date.now(), reversalType: type});
  }
  const metadata = {costPendingLines: null};
  if (Object.keys(reversed).length) {
    const next = Object.assign({}, corrections, reversed);
    metadata.costCorrections = next;
    metadata.costCorrectionTotal = Financial.money(Object.values(next).filter((row) => row && !row.reversedAt).reduce((sum, row) => sum + Number(row.amount || 0), 0));
  }
  await closeUncostedRowsForReversedSale(db, orderId, "void");
  await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, orderId, metadata);
}

async function readOpenUncostedRows(db) {
  const [open, applying] = await Promise.all(["open", "applying"].map((status) => db.ref("/uncostedSales").orderByChild("status").equalTo(status).limitToFirst(UNCOSTED_LIST_LIMIT).get()));
  return Object.assign({}, open.val() || {}, applying.val() || {});
}

// Cost each open row of one item against the current recipe.
async function previewUncostedItem(db, itemKey, limit) {
  const rows = Object.values(await readOpenUncostedRows(db)).filter((row) => row && row.itemKey === itemKey && (row.status === "open" || row.status === "applying"))
    .sort((a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0)).slice(0, limit || UNCOSTED_BATCH_LIMIT);
  const costed = await withCostingCatalog(db, (catalog) => rows.map((row) => ({row, result: UncostedSales.costRow(row, catalog)})));
  const today = Date.now(), periodCache = {};
  const out = [];
  for (const {row, result} of costed) {
    const period = AccountingPeriods.periodForDate(Number(row.occurredAt) || today);
    if (!(period in periodCache)) periodCache[period] = await uncostedPeriodOpen(db, Number(row.occurredAt) || today);
    const postedToOriginalDate = periodCache[period] === true;
    out.push({id: row.id, orderId: row.orderId, occurredAt: Number(row.occurredAt) || 0, businessDate: row.businessDate || "", qty: Number(row.qty) || 0, size: row.size || "", optLabels: row.optLabels || [],
      ok: result.ok, cost: result.ok ? Financial.money(result.totalCost) : 0, message: result.ok ? "" : result.message, usage: result.ok ? result.usage : {},
      ingredients: result.ok ? result.lines.map((line) => ({name: line.ingredientName, qty: line.totalQuantity, unit: line.stockUnit, cost: Financial.money(line.totalCost)})) : [],
      postDate: postedToOriginalDate ? (row.businessDate || financeDateFromTimestamp(row.occurredAt)) : financeDateFromTimestamp(today), postedToOriginalDate, status: row.status});
  }
  const ready = out.filter((row) => row.ok);
  return {itemKey, rows: out, readyCount: ready.length, blockedCount: out.length - ready.length, total: Financial.money(ready.reduce((sum, row) => sum + row.cost, 0))};
}

async function applyUncostedRow(db, preview, actor, reason) {
  const id = preview.id, ref = db.ref(`/uncostedSales/${id}`), now = Date.now(), token = crypto.randomBytes(8).toString("hex");
  const effectiveAt = preview.postedToOriginalDate ? Number(preview.occurredAt) || now : now;
  const fresh = {token, at: now, by: actor.uid, usage: positiveOrderInventoryUsage(preview.usage || {}), planCost: Financial.money(preview.cost), effectiveAt, postedToOriginalDate: !!preview.postedToOriginalDate};
  const claimed = await ref.transaction((current) => {
    if (current === null) return null;
    if (current.status === "applying" && Number(current.claim && current.claim.at || 0) > now - UNCOSTED_APPLY_LEASE_MS) return;
    if (current.status !== "open" && current.status !== "applying") return;
    // A claim that was interrupted keeps the plan and date it started with, so a retry posts
    // exactly the same stock movements and journal.
    const prior = current.status === "applying" && current.claim && current.claim.usage ? current.claim : null;
    return Object.assign({}, current, {status: "applying", claim: prior ? Object.assign({}, prior, {token, at: now, by: actor.uid}) : fresh});
  }, undefined, false);
  const row = claimed.snapshot.val();
  if (!claimed.committed || !row || !row.claim || row.claim.token !== token) return {id, applied: false, skipped: "in_progress"};
  const claim = row.claim;
  try {
    const order = await findOrderRecord(db, row.orderId);
    if (!order) throw new HttpsError("not-found", `Order ${row.orderId} no longer exists.`);
    if (order.voided === true || order.inventoryReversed === true) {
      await ref.update({status: "void", closedAt: Date.now(), claim: null});
      await refreshCostPendingLines(db, row.orderId);
      return {id, applied: false, skipped: "voided"};
    }
    const usage = positiveOrderInventoryUsage(claim.usage || {}), movements = [];
    for (const itemId of Object.keys(usage).sort()) {
      const result = await applyInventoryMovement(db, {
        movementId: `ucs_${id}_${itemId}`, itemId, type: "sale_usage", qty: -qty6(usage[itemId]), sourceType: "order_cost_correction",
        sourceId: row.orderId, sourceLine: itemId, note: `Cost correction: ${row.itemName} sold without a recipe on order ${row.orderId}`,
        occurredAt: Number(claim.effectiveAt) || now, actorName: actor.role,
      }, actor);
      movements.push(result.movement);
    }
    const inventory = {};
    await Promise.all(movements.map(async (movement) => { inventory[movement.itemId] = (await db.ref(`/inventory/${movement.itemId}`).get()).val() || {}; }));
    const label = `Cost of ${row.itemName} sold on ${row.businessDate || row.orderId} without a recipe`;
    const lines = UncostedSales.financeLines(movements, inventory, label).map((line) => Financial.line(line.account, line.debit, line.credit, line.label));
    const amount = Financial.money(movements.reduce((sum, movement) => sum + Math.abs(Number(movement.totalCost) || 0), 0));
    let financialMovementId = "";
    if (lines.length) {
      financialMovementId = `ucogs_${id}`;
      const movement = Financial.movement("order_cost_correction", "orderCostCorrection", row.orderId, lines, {
        occurredAt: Number(claim.effectiveAt) || now, actorName: actor.role, channel: row.channel || "instore", uncostedSaleId: id, itemKey: row.itemKey,
        originalOccurredAt: Number(row.occurredAt) || 0, postedToOriginalDate: claim.postedToOriginalDate === true, controlReason: financeText(reason, 300),
      });
      await commitFinancial(db, financialMovementId, movement, actor);
    }
    const resolution = {type: "recipe_cost", amount, usage, effectiveAt: Number(claim.effectiveAt) || now, postedToOriginalDate: claim.postedToOriginalDate === true,
      financialMovementId, inventoryMovementIds: movements.map((movement) => movement.id), by: actor.uid, byRole: actor.role, at: Date.now(), reason: financeText(reason, 300)};
    const latest = await findOrderRecord(db, row.orderId), corrections = Object.assign({}, latest && latest.costCorrections || {});
    corrections[id] = {amount, usage, financialMovementId, effectiveAt: resolution.effectiveAt, postedToOriginalDate: resolution.postedToOriginalDate, appliedAt: resolution.at, appliedBy: actor.uid, itemKey: row.itemKey};
    await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, row.orderId, {costCorrections: corrections, costCorrectionTotal: Financial.money(Object.values(corrections).filter((c) => c && !c.reversedAt).reduce((sum, c) => sum + Number(c.amount || 0), 0))});
    await ref.update({status: "resolved", resolution, claim: null, closedAt: resolution.at});
    await db.ref(`/operationalAudit/${resolution.at}_uncosted_cost_${id}`).set({action: "apply_recipe_cost_to_uncosted_sale", sourceType: "order", sourceId: row.orderId, uncostedSaleId: id, itemKey: row.itemKey, amount, financialMovementId, effectiveAt: resolution.effectiveAt, postedToOriginalDate: resolution.postedToOriginalDate, reason: resolution.reason, actorUid: actor.uid, actorRole: actor.role, ts: resolution.at, schemaVersion: 1});
    await refreshCostPendingLines(db, row.orderId);
    return {id, applied: true, amount, financialMovementId, postDate: financeDateFromTimestamp(resolution.effectiveAt)};
  } catch (error) {
    // Leave the claim in place: its lease expires and a retry posts the same plan.
    await ref.child("lastError").set(String(error && error.message || error).slice(0, 300));
    return {id, applied: false, error: String(error && error.message || error).slice(0, 300)};
  }
}

async function scanUncostedSales(db, data) {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(data.since || "")) ? String(data.since) : UNCOSTED_SCAN_FIRST_DATE;
  const sinceAt = Date.parse(`${since}T00:00:00+08:00`), cursor = data.cursor && typeof data.cursor === "object" ? data.cursor : {};
  const summary = {since, scanned: 0, finalized: 0, flagged: 0, errors: [], cursor: {}, done: true};
  for (const node of ["orders", "archivedOrders"]) {
    const at = cursor[node] && Number(cursor[node].at) >= sinceAt ? cursor[node] : null;
    if (cursor[node] && cursor[node].done) { summary.cursor[node] = cursor[node]; continue; }
    let query = db.ref(`/${node}`).orderByChild("timestamp");
    query = at ? query.startAt(Number(at.at), String(at.key)) : query.startAt(sinceAt);
    // download-ok: owner/manager recovery scan, bounded by date and batch size
    const rows = (await query.limitToFirst(UNCOSTED_SCAN_LIMIT + (at ? 1 : 0)).get()).val() || {};
    const entries = Object.entries(rows).filter(([key]) => !(at && key === at.key)).sort((a, b) => Number(a[1] && a[1].timestamp || 0) - Number(b[1] && b[1].timestamp || 0) || a[0].localeCompare(b[0]));
    for (const [orderId, order] of entries) {
      summary.scanned++;
      const status = order && order.status === "Archived" ? order.prevStatus : order && order.status;
      if (!order || order.voided === true || !["Completed", "Received"].includes(status) || !Array.isArray(order.lineItems)) continue;
      try {
        if (order.inventoryDeducted !== true) {
          const result = await finalizeOrderInventory(db, orderId, order);
          summary.finalized++; summary.flagged += result.uncosted;
          continue;
        }
        if (order.cogsCovered !== false && !(Number(order.costPendingLines) > 0)) continue;
        const plan = (await db.ref(`/orderInventoryPlans/${orderId}`).get()).val();
        const lines = await uncostedLinesForPlan(db, plan, order.lineItems);
        if (!lines.length) continue;
        const existing = await uncostedRowsForOrder(db, orderId), known = new Set(Object.keys(existing));
        const rows = await registerUncostedSale(db, orderId, order, lines, "sale");
        summary.flagged += Object.keys(rows).filter((id) => !known.has(id)).length;
        await refreshCostPendingLines(db, orderId);
      } catch (error) { summary.errors.push({orderId, error: String(error && error.message || error).slice(0, 200)}); }
    }
    const last = entries[entries.length - 1];
    const nodeDone = entries.length < UNCOSTED_SCAN_LIMIT;
    summary.cursor[node] = last ? {at: Number(last[1] && last[1].timestamp || 0), key: last[0], done: nodeDone} : {done: true};
    if (!nodeDone) summary.done = false;
  }
  return summary;
}

exports.manageUncostedSales = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["recipes", "inventory"]), data = request.data || {};
    const action = financeText(data.action, 40) || "list", manager = UNCOSTED_MANAGER_ROLES.includes(actor.role);
    if (action === "list") {
      const rows = await readOpenUncostedRows(db), groups = UncostedSales.summarize(rows);
      return {groups, openCount: groups.reduce((sum, group) => sum + group.count, 0), canResolve: manager, scanFrom: UNCOSTED_SCAN_FIRST_DATE};
    }
    const itemKey = financeText(data.itemKey, 160);
    if (action === "preview") {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(itemKey)) throw new HttpsError("invalid-argument", "Choose an item.");
      return previewUncostedItem(db, itemKey);
    }
    if (!manager) throw new HttpsError("permission-denied", "Only a manager can resolve sales without a recipe.");
    if (action === "apply_recipe") {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(itemKey)) throw new HttpsError("invalid-argument", "Choose an item.");
      const preview = await previewUncostedItem(db, itemKey), ready = preview.rows.filter((row) => row.ok);
      if (!ready.length) throw new HttpsError("failed-precondition", preview.rows.length ? `The recipe is not complete yet: ${preview.rows[0].message}` : "No open sales remain for this item.");
      // The manager approved a specific total. If recipes or ingredient costs changed since the
      // preview, stop and show the new figures rather than post a different amount.
      if (data.expectedTotal == null || Math.abs(Financial.money(data.expectedTotal) - preview.total) > 0.009) throw new HttpsError("failed-precondition", `The cost is now PHP ${preview.total.toFixed(2)}. Review the new preview before applying.`);
      const reason = financeText(data.reason, 300);
      const results = [];
      for (const row of ready) results.push(await applyUncostedRow(db, row, actor, reason));
      const applied = results.filter((row) => row.applied);
      return {itemKey, applied: applied.length, amount: Financial.money(applied.reduce((sum, row) => sum + row.amount, 0)), skipped: results.filter((row) => !row.applied), blocked: preview.blockedCount};
    }
    if (action === "confirm_no_cost") {
      const reason = financeText(data.reason, 300);
      if (reason.length < 5) throw new HttpsError("invalid-argument", "Explain why this item has no cost.");
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(itemKey)) throw new HttpsError("invalid-argument", "Choose an item.");
      const rows = Object.values(await readOpenUncostedRows(db)).filter((row) => row && row.itemKey === itemKey && row.status === "open"), at = Date.now(), orderIds = new Set();
      for (const row of rows) {
        const result = await db.ref(`/uncostedSales/${row.id}`).transaction((current) => current === null ? null : current.status === "open" ? Object.assign({}, current, {status: "resolved", closedAt: at, resolution: {type: "no_cost", amount: 0, reason, by: actor.uid, byRole: actor.role, at}}) : current, undefined, false);
        if (result.snapshot.val() && result.snapshot.val().status === "resolved") orderIds.add(row.orderId);
      }
      for (const orderId of orderIds) await refreshCostPendingLines(db, orderId);
      if (data.markNoRecipe === true) await db.ref(`/menuItems/${itemKey}/noRecipe`).set(true);
      await db.ref(`/operationalAudit/${at}_uncosted_no_cost_${itemKey}`).set({action: "confirm_uncosted_sale_no_cost", sourceType: "menuItem", sourceId: itemKey, lines: rows.length, orders: [...orderIds], markNoRecipe: data.markNoRecipe === true, reason, actorUid: actor.uid, actorRole: actor.role, ts: at, schemaVersion: 1});
      return {itemKey, resolved: rows.length, markNoRecipe: data.markNoRecipe === true};
    }
    if (action === "scan") return scanUncostedSales(db, data);
    throw new HttpsError("invalid-argument", "Choose a supported action.");
  },
);
