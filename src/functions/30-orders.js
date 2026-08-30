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
