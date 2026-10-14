/* ══════════════════════════════════════════════════════════════════════════════
   HOMEMADE PASTRY BATCH CARD (admin 676, 14 Oct 2026)

   A batch card records one bake that has already happened. Ingredients and the
   baked pastries both live in inventory account 1240, so posting a card moves
   value between stock items and NEVER touches profit: the debit is the pastry's
   own inventory account, the credit is each ingredient's own account. Profit
   moves only when the pastry is sold (Dr 5030 / Cr 1240).

   `production` and `production_reversal` are server-only movement types, so these
   callables are the only door. The browser sends a product, its lines and the
   piece count; every cost, total, account and balance is derived here.

   See docs/plans/homemade-pastry-production-batch.md for the full design.
   ══════════════════════════════════════════════════════════════════════════════ */

const BAKING_MANAGER_ROLES = ["owner", "superadmin", "admin", "manager"];
const BAKING_PASTRY_INVENTORY_ACCOUNT = "1240";
const BAKING_PASTRY_COST_ACCOUNT = "5030";
const BAKING_ALLOWED_INGREDIENT_ACCOUNTS = ["1200", "1210", "1220", "1230", "1240", "1270", "1280"];
const BAKING_ALLOWED_INGREDIENT_COST_ACCOUNTS = ["5000", "5010", "5020", "5030", "5040", "6070", "6075"];
const BAKING_MAX_PIECES = 5000;
const BAKING_MAX_LINES = 40;

function bakingText(value, max) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max); }
function bakingItemAccount(item) {
  return { inventory: String(item && item.inventoryAccount || ""), cost: String(item && (item.costAccount || item.cogsAccount) || "") };
}
/* Archived items are excluded from every picker and every card. Absent means active. */
function bakingItemActive(item) { return !(item && item.active === false); }
function bakingIsSupply(item) { return String(item && item.type || "").indexOf("supply") >= 0 || (item && item.recipeItem === false); }

/* The confirmation fingerprint covers only the facts the ledger entry depends on: which item is
   produced and which account it lands in. Names are never included, so renaming an item is cosmetic
   and can never force a re-confirmation. Quantities and the ingredient list are deliberately
   excluded too, so the template stays editable without invalidating the confirmation. */
function bakingMappingFingerprint(pastryItem, pastryItemId) {
  const accounts = bakingItemAccount(pastryItem);
  return ["v1", String(pastryItemId || ""), accounts.inventory, accounts.cost, bakingItemActive(pastryItem) ? "active" : "archived"].join("|");
}

async function requireBakingAccess(db, actor) {
  if (BAKING_MANAGER_ROLES.includes(String(actor && actor.role || ""))) return;
  const granted = (await db.ref(`/adminPerms/${actor.uid}/baking`).get()).val();
  if (granted !== true) throw new HttpsError("permission-denied", "This account cannot post baking batch cards.");
}

/* One place decides what "properly mapped" means, so saving a product and posting a card can never
   disagree. Every message names the item and what to fix. */
function bakingPastryProblem(item, itemId) {
  if (!item) return "The pastry stock item for this product no longer exists. Pick another under Baking.";
  const name = String(item.name || itemId);
  if (!bakingItemActive(item)) return `${name} is archived. Restore it before posting a bake.`;
  if (!String(item.unit || "").trim()) return `${name} has no unit. Set one under Stock Items.`;
  const accounts = bakingItemAccount(item);
  if (accounts.inventory !== BAKING_PASTRY_INVENTORY_ACCOUNT) return `${name} must map to inventory account ${BAKING_PASTRY_INVENTORY_ACCOUNT} — it maps to ${accounts.inventory || "nothing"}.`;
  if (accounts.cost !== BAKING_PASTRY_COST_ACCOUNT) return `${name} must map to cost account ${BAKING_PASTRY_COST_ACCOUNT} — it maps to ${accounts.cost || "nothing"}.`;
  return "";
}
function bakingLineProblem(item, itemId, pastryItemId, unitCost) {
  if (!item) return `A template ingredient no longer exists (${itemId}).`;
  const name = String(item.name || itemId);
  if (!bakingItemActive(item)) return `${name} is archived. Restore it or remove the line.`;
  if (itemId === pastryItemId) return `${name} cannot be an ingredient of its own batch card.`;
  if (bakingIsSupply(item)) return `${name} is a supply, not a recipe ingredient.`;
  const accounts = bakingItemAccount(item);
  if (!BAKING_ALLOWED_INGREDIENT_ACCOUNTS.includes(accounts.inventory)) return `${name} needs an inventory asset account (12xx) — it maps to ${accounts.inventory || "nothing"}.`;
  if (!BAKING_ALLOWED_INGREDIENT_COST_ACCOUNTS.includes(accounts.cost)) return `${name} needs a cost account (5xxx) — it maps to ${accounts.cost || "nothing"}.`;
  if (!(qty6(unitCost) > 0)) return `${name} has no cost yet. Receive a purchase for it before baking, or the batch would be worth ₱0.`;
  return "";
}
/* The authoritative cost basis: the item's own moving average in the inventory ledger, exactly what
   the movement engine will use (costBefore). Falls back to the item record for a brand-new item. */
async function bakingUnitCost(db, itemId, item) {
  const accounting = (await db.ref(`/inventoryAccounting/${itemId}`).get()).val() || {};
  const fromLedger = qty6(accounting.unitCost);
  return fromLedger > 0 ? fromLedger : qty6(item && item.cost);
}
async function bakingReadProduct(db, productId) {
  const product = (await db.ref(`/bakingProducts/${productId}`).get()).val();
  if (!product) throw new HttpsError("not-found", "That baking product was not found.");
  if (product.active === false) throw new HttpsError("failed-precondition", "That baking product is archived. Restore it before posting a bake.");
  return product;
}
/* Validate a product's pastry item and every template line, returning the resolved items so callers
   never read them twice. */
async function bakingValidateProduct(db, productId, product) {
  const pastryItemId = inventoryKey(product.pastryItemId, "Pastry stock item");
  const template = listFromFirebase(product.template);
  const pastryItem = (await db.ref(`/inventory/${pastryItemId}`).get()).val();
  const problems = [];
  const pastryProblem = bakingPastryProblem(pastryItem, pastryItemId);
  if (pastryProblem) problems.push(pastryProblem);
  const lines = await Promise.all(template.map(async (line) => {
    const itemId = String(line && line.itemId || "");
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(itemId)) return { itemId, item: null, unitCost: 0 };
    const item = (await db.ref(`/inventory/${itemId}`).get()).val();
    return { itemId, item, unitCost: await bakingUnitCost(db, itemId, item) };
  }));
  const seen = {};
  lines.forEach((line) => {
    const name = String(line.item && line.item.name || line.itemId);
    if (seen[line.itemId]) problems.push(`The same ingredient is listed twice (${name}).`);
    seen[line.itemId] = true;
    const problem = bakingLineProblem(line.item, line.itemId, pastryItemId, line.unitCost);
    if (problem) problems.push(problem);
  });
  return { pastryItemId, pastryItem, lines, problems };
}

exports.checkBakingMapping = onCall(
  { region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalUser(db, request);
    await requireBakingAccess(db, actor);
    const productId = inventoryKey(request.data && request.data.productId, "Baking product");
    const product = await bakingReadProduct(db, productId);
    const resolved = await bakingValidateProduct(db, productId, product);
    if (resolved.problems.length) throw new HttpsError("failed-precondition", resolved.problems.join(" "));
    const fingerprint = bakingMappingFingerprint(resolved.pastryItem, resolved.pastryItemId);
    const confirmedAt = Date.now();
    const confirmedBy = bakingText(actor.name || actor.role || actor.uid || "staff", 120);
    await db.ref().update({
      [`bakingProducts/${productId}/mapping`]: { confirmedAt, confirmedBy, confirmedByUid: actor.uid, fingerprint, schemaVersion: 1 },
      [`operationalAudit/${confirmedAt}_baking_mapping_${productId}`]: operationalAuditRecord("confirm_baking_mapping", "bakingProduct", productId, actor, { pastryItemId: resolved.pastryItemId, lines: resolved.lines.length, fingerprint }),
    });
    return { ok: true, fingerprint, confirmedAt, confirmedBy };
  },
);

exports.postBatchCard = onCall(
  { region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalUser(db, request);
    await requireBakingAccess(db, actor);
    const data = (request.data || {});
    const productId = inventoryKey(data.productId, "Baking product");
    const product = await bakingReadProduct(db, productId);

    const pieces = Math.floor(Number(data.pieces) || 0);
    if (!(pieces > 0)) throw new HttpsError("invalid-argument", "Enter the actual pieces produced (at least 1).");
    if (pieces > BAKING_MAX_PIECES) throw new HttpsError("invalid-argument", `A batch card cannot produce more than ${BAKING_MAX_PIECES} pieces.`);
    const rawLines = listFromFirebase(data.lines);
    if (!rawLines.length) throw new HttpsError("invalid-argument", "Add at least one ingredient used.");
    if (rawLines.length > BAKING_MAX_LINES) throw new HttpsError("invalid-argument", `A batch card holds at most ${BAKING_MAX_LINES} ingredient lines.`);

    const pastryItemId = inventoryKey(product.pastryItemId, "Pastry stock item");
    const pastryItem = (await db.ref(`/inventory/${pastryItemId}`).get()).val();
    const pastryProblem = bakingPastryProblem(pastryItem, pastryItemId);
    if (pastryProblem) throw new HttpsError("failed-precondition", pastryProblem);
    const pastryAccounts = bakingItemAccount(pastryItem);

    /* The confirmation is durable: it is only re-examined when the fact it covers actually changed. */
    const fingerprint = bakingMappingFingerprint(pastryItem, pastryItemId);
    const mapping = product.mapping || {};
    if (!mapping.confirmedAt) throw new HttpsError("failed-precondition", "This product's mapping has not been confirmed. Open Baking, press Check mapping, then post.");
    if (String(mapping.fingerprint || "") !== fingerprint) throw new HttpsError("failed-precondition", "The pastry item's mapping changed since it was confirmed. Press Check mapping, then post again.");

    /* A line left at zero is "not used", so it is skipped rather than failing the card: the engine
       refuses a zero-quantity movement anyway. */
    const used = [], seen = {};
    for (const line of rawLines) {
      const itemId = String(line && line.itemId || "");
      const qty = qty6(line && line.qty);
      if (!itemId || !qty) continue;
      if (seen[itemId]) throw new HttpsError("invalid-argument", "The same ingredient is listed twice on this card.");
      seen[itemId] = true;
      if (qty < 0) throw new HttpsError("invalid-argument", "An ingredient quantity cannot be negative.");
      used.push({ itemId, qty });
    }
    if (!used.length) throw new HttpsError("invalid-argument", "Every ingredient line is zero. Enter at least one quantity used.");

    const resolved = await Promise.all(used.map(async (line) => {
      const item = (await db.ref(`/inventory/${line.itemId}`).get()).val();
      return { itemId: line.itemId, qty: line.qty, item, unitCost: await bakingUnitCost(db, line.itemId, item) };
    }));
    resolved.forEach((line) => {
      const problem = bakingLineProblem(line.item, line.itemId, pastryItemId, line.unitCost);
      if (problem) throw new HttpsError("failed-precondition", problem);
    });
    /* Guard before anything is posted, so a card can never half-post. Stock may be short — that is
       allowed and flagged — but a missing cost is refused because it would make the batch wrong. */
    const plannedTotal = money(resolved.reduce((sum, line) => sum + money(line.qty * line.unitCost), 0));
    if (!(plannedTotal > 0)) throw new HttpsError("failed-precondition", "The batch value is zero. Check that every ingredient has a real cost.");

    const bakedBy = bakingText(data.bakedBy, 120) || bakingText(actor.name || actor.role || "staff", 120);
    const note = bakingText(data.note, 300);
    const requestId = inventoryKey(data.requestId || `bake_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, "Batch request");
    const occurredAt = Number(data.occurredAt) || Date.now();
    const claim = await db.ref(`/batchCardRequests/${requestId}`).transaction((current) => {
      if (current && current.batchId) return current;
      return { batchId: `BAKE-${financeDateFromTimestamp(occurredAt).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, state: "posting", claimedAt: Date.now(), actorUid: actor.uid, productId };
    }, undefined, false);
    const claimValue = claim.snapshot.val() || {};
    const batchId = inventoryKey(claimValue.batchId, "Batch ID");
    /* A retry after a completed post returns the same card instead of a duplicate. */
    if (claimValue.state === "done") {
      const existing = (await db.ref(`/batchCards/${batchId}`).get()).val();
      if (existing) return { batchId, card: existing, duplicate: true };
    }

    /* Ingredients first: every movement is idempotent by its own id, so a retry after a partial
       failure resumes the same batch instead of double-consuming. */
    const movements = [];
    for (const line of resolved) {
      const posted = await applyInventoryMovement(db, {
        movementId: `mv_${batchId}_${line.itemId}`.slice(0, 160),
        itemId: line.itemId,
        type: "production",
        qty: -line.qty,
        unitCost: line.unitCost,
        sourceType: "batch-card",
        sourceId: batchId,
        sourceLine: line.itemId,
        offsetAccount: pastryAccounts.inventory,
        adjustmentNature: "batch-card-production",
        note: `${batchId} · ${line.qty} ${String(line.item.unit || "")} used by ${String(product.name || productId)}`.slice(0, 500),
        actorName: bakedBy,
        occurredAt,
      }, actor);
      movements.push(posted.movement);
    }
    /* The value that actually left stock is the batch cost, never a figure typed by the browser. */
    const lines = resolved.map((line, index) => {
      const posted = movements[index] || {};
      const value = money(Math.abs(qty6(posted.totalCost)));
      const balanceAfter = qty6(posted.balanceAfter);
      return {
        itemId: line.itemId,
        itemName: String(line.item.name || line.itemId).slice(0, 160),
        unit: String(line.item.unit || "").slice(0, 40),
        qty: line.qty,
        unitCost: qty6(posted.unitCost) || line.unitCost,
        value,
        inventoryAccount: bakingItemAccount(line.item).inventory,
        balanceBefore: qty6(posted.balanceBefore),
        balanceAfter,
        wentNegative: balanceAfter < 0,
        movementId: String(posted.id || ""),
      };
    });
    const totalCost = money(lines.reduce((sum, line) => sum + line.value, 0));
    if (!(totalCost > 0)) throw new HttpsError("failed-precondition", "The batch value came out as zero. Receive a purchase for these ingredients, then post the card again.");
    const costPerPiece = money(totalCost / pieces);

    const pastryMovement = (await applyInventoryMovement(db, {
      movementId: `mv_${batchId}_out`.slice(0, 160),
      itemId: pastryItemId,
      type: "production",
      qty: pieces,
      unitCost: costPerPiece,
      setCost: true,
      sourceType: "batch-card",
      sourceId: batchId,
      sourceLine: pastryItemId,
      offsetAccount: pastryAccounts.inventory,
      adjustmentNature: "batch-card-production",
      note: `${batchId} · ${pieces} ${String(pastryItem.name || pastryItemId)} produced`.slice(0, 500),
      actorName: bakedBy,
      occurredAt,
    }, actor)).movement;

    const now = Date.now();
    const card = {
      id: batchId,
      productId,
      productName: String(product.name || productId).slice(0, 160),
      emoji: String(product.emoji || "🥐").slice(0, 8),
      pastryItemId,
      pastryItemName: String(pastryItem.name || pastryItemId).slice(0, 160),
      pastryUnit: String(pastryItem.unit || "").slice(0, 40),
      date: financeDateFromTimestamp(occurredAt),
      ts: now,
      bakedBy,
      note,
      postedBy: bakingText(actor.name || actor.role || "", 120),
      postedByUid: actor.uid,
      pieces,
      lines,
      totalCost,
      unitCost: costPerPiece,
      accounts: { inventory: pastryAccounts.inventory, cost: pastryAccounts.cost },
      movementIds: lines.map((line) => line.movementId).concat([String(pastryMovement && pastryMovement.id || "")]).filter(Boolean),
      pastryMovementId: String(pastryMovement && pastryMovement.id || ""),
      pastryBalanceAfter: qty6(pastryMovement && pastryMovement.balanceAfter),
      provisional: lines.some((line) => line.wentNegative),
      negativeLines: lines.filter((line) => line.wentNegative).map((line) => line.itemName),
      mappingFingerprint: fingerprint,
      reversed: false,
      schemaVersion: 1,
    };
    await db.ref().update({
      [`batchCards/${batchId}`]: card,
      [`batchCardRequests/${requestId}/state`]: "done",
      [`batchCardRequests/${requestId}/batchId`]: batchId,
      [`batchCardRequests/${requestId}/finishedAt`]: now,
      [`operationalAudit/${now}_baking_batch_${batchId}`]: operationalAuditRecord("post_baking_batch_card", "batchCard", batchId, actor, {
        productId, pastryItemId, pieces, totalCost, unitCost: costPerPiece, provisional: card.provisional,
        lines: lines.length, negativeLines: card.negativeLines.slice(0, 10),
      }),
    });
    logger.info("Baking batch card posted", { batchId, productId, pieces, totalCost, provisional: card.provisional, uid: actor.uid });
    return { batchId, card, duplicate: false };
  },
);

exports.reverseBatchCard = onCall(
  { region: ORDER_REGION, enforceAppCheck: false, timeoutSeconds: 120, memory: "256MiB" },
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalUser(db, request);
    await requireBakingAccess(db, actor);
    const data = (request.data || {});
    const batchId = inventoryKey(data.batchId, "Batch ID");
    const card = (await db.ref(`/batchCards/${batchId}`).get()).val();
    if (!card) throw new HttpsError("not-found", "That batch card was not found.");
    if (card.reversed === true) return { batchId, duplicate: true };
    const reason = bakingText(data.reason, 300) || "Reversed";
    const now = Date.now();
    const offset = String(card.accounts && card.accounts.inventory || BAKING_PASTRY_INVENTORY_ACCOUNT);
    const rows = listFromFirebase(card.lines).map((line) => ({
      movementId: `mv_${batchId}_rev_${line.itemId}`.slice(0, 160),
      itemId: line.itemId,
      type: "production_reversal",
      qty: qty6(line.qty),
      unitCost: qty6(line.unitCost),
      sourceType: "batch-card",
      sourceId: batchId,
      sourceLine: line.itemId,
      offsetAccount: offset,
      adjustmentNature: "batch-card-reversal",
      note: `${batchId} · reversal · ${reason}`.slice(0, 500),
      actorName: bakingText(actor.name || actor.role || "staff", 120),
      occurredAt: now,
    }));
    /* The pastries leave first, then the ingredients come back: the exact movements the card posted
       are inverted, and a pastry that has already been sold cannot be re-received here. */
    rows.push({
      movementId: `mv_${batchId}_out_rev`.slice(0, 160),
      itemId: card.pastryItemId,
      type: "production_reversal",
      qty: -qty6(card.pieces),
      unitCost: qty6(card.unitCost),
      sourceType: "batch-card",
      sourceId: batchId,
      sourceLine: card.pastryItemId,
      offsetAccount: offset,
      adjustmentNature: "batch-card-reversal",
      note: `${batchId} · reversal · ${reason}`.slice(0, 500),
      actorName: bakingText(actor.name || actor.role || "staff", 120),
      occurredAt: now,
    });
    const posted = [];
    for (const row of rows) posted.push((await applyInventoryMovement(db, row, actor)).movement);
    await db.ref().update({
      [`batchCards/${batchId}/reversed`]: true,
      [`batchCards/${batchId}/reversedAt`]: now,
      [`batchCards/${batchId}/reversedBy`]: bakingText(actor.name || actor.role || "", 120),
      [`batchCards/${batchId}/reversedByUid`]: actor.uid,
      [`batchCards/${batchId}/reversalReason`]: reason,
      [`batchCards/${batchId}/reversalMovementIds`]: posted.map((movement) => String(movement && movement.id || "")).filter(Boolean),
      [`operationalAudit/${now}_baking_batch_reverse_${batchId}`]: operationalAuditRecord("reverse_baking_batch_card", "batchCard", batchId, actor, { reason, lines: rows.length }),
    });
    return { batchId, duplicate: false, reversed: rows.length };
  },
);
