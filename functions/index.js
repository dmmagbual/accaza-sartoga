/**
 * Accaza Coffee House — Auto Web-Push (FCM) on order completion
 * Firebase Cloud Functions (2nd gen). FREE: no per-message cost.
 *
 * Trigger: when an order's status changes to "Completed", send a Web Push
 * notification to the customer's installed app (pick-up or delivery message).
 */
const {onValueUpdated, onValueWritten} = require("firebase-functions/v2/database");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");
const {getStorage} = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const crypto = require("node:crypto");

initializeApp();

const SHOP_NAME = "Accaza Coffee House";
const PICKUP_ADDR = "Saratoga Ave, La Mediterranea Subd., Governor's Drive, Dasmarinas";

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
  if (!["owner", "superadmin", "admin", "manager", "staff", "cashier", "finance"].includes(role)) {
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
    throw new HttpsError("permission-denied", "This account cannot post inventory movements.");
  }
  return portal;
}

// ---------------------------------------------------------------------------
// Release 2C: bounded operational order projection.
// /orders remains authoritative. /activeOrders contains only orders needed by
// the live register/admin workflow and never carries legacy embedded proofs.
// ---------------------------------------------------------------------------
const ACTIVE_ONLINE_TTL_MS = 48 * 60 * 60 * 1000;
const ACTIVE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  if (order.paymentStatus === "pending") return true;
  if (order.channel && order.channel !== "instore" && (order.settlementStatus || "unsettled") === "unsettled") return true;
  if (activeShift && order.shiftId && order.shiftId === activeShift.id) return true;
  const age = now - Number(order.timestamp || 0);
  if (order.source === "online" && age >= 0 && age <= ACTIVE_ONLINE_TTL_MS) return true;
  return false;
}

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
    const orderId = `ORD-${now.toString(36).toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const nowDate = new Date(now);
    const itemText = priced.lines.map((line) => `${line.name}${line.size ? ` (${line.size})` : ""}${line.optLabels.length ? ` [${line.optLabels.join(", ")}]` : ""} x${line.qty}`).join(", ");
    const order = {
      id: orderId, ownerUid: uid, name, phone, type: orderType, address, payment, contact, contactMethod,
      items: itemText, total: priced.total, notes, status: "Pending", receivedByCustomer: false,
      time: new Intl.DateTimeFormat("en-PH", {timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit"}).format(nowDate),
      date: new Intl.DateTimeFormat("en-PH", {timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric"}).format(nowDate),
      timestamp: now, lineItems: priced.lines.map(({cat, ...line}) => line), packages: priced.packages,
      extraCost: priced.extraCost, source: "online", pricingVersion: "server-v1", pricedAt: now,
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

/**
 * Server-authoritative inventory deduction + COGS snapshot.
 * Fires when an order reaches Completed or Received. Idempotent via a
 * transaction claim on /orders/{id}/inventoryDeducted, so it never
 * double-deducts alongside the client (whoever claims first wins).
 * This removes the "an admin browser must be open" dependency.
 */
function baseQtyForSize(rec, b, size) {
  const per = b["qty" + size];
  if (per != null && per !== "") return Number(per) || 0;
  const sm = (rec && rec.sizeMult) ? rec.sizeMult : {S: 1, M: 1.3, L: 1.6};
  const mult = (sm[size] != null) ? sm[size] : 1;
  return (Number(b.qty) || 0) * mult;
}
function consumablesForServer(cat, size, invArr, catType) {
  const t = catType[cat] || "";
  if (t !== "drink" && t !== "food") return [];
  return invArr.filter((i) => {
    if ((i.type || "") !== "consumable") return false;
    const sv = i.serves || "both";
    if (t === "drink" && sv === "food") return false;
    if (t === "food" && sv === "drink") return false;
    if (i.size && i.size !== size) return false;
    return true;
  });
}
/* Mirrors the client choiceIngs (admin.html): a selected choice stacks the
   shared global cost (posSettings.optionCosts[gid][optKey(label)]) PLUS the
   per-recipe delta (recipes/{item}.choiceAdd[gid][optKey(label)]), size-aware.
   Falls back to the legacy single-qty optionRecipes only if neither exists,
   so client and server never diverge. Keep in sync with admin.html choiceIngs. */
function optKeyServer(label) {
  return String(label == null ? "" : label).replace(/[.#$[\]/]/g, "_");
}
function groupIdForLabelServer(item, label, optionGroups) {
  const ids = Array.isArray(item && item.options) ? item.options : Object.keys(optionGroups || {});
  for (const gid of ids) {
    const g = optionGroups[gid];
    if (g && Array.isArray(g.choices)) {
      for (const c of g.choices) {
        if (c && c.label === label) return gid;
      }
    }
  }
  return null;
}
function choiceIngsServer(item, rec, label, size, optionCosts, optionGroups) {
  size = size || "M";
  const gid = groupIdForLabelServer(item, label, optionGroups);
  const lk = optKeyServer(label);
  const out = [];
  let found = false;
  const push = (arr) => (arr || []).forEach((r) => {
    if (!r || !r.ing) return;
    let q = r["qty" + size];
    if (q == null || q === "") q = 0;
    out.push({ing: r.ing, qty: Number(q) || 0});
  });
  if (gid && optionCosts[gid] && optionCosts[gid][lk] && (optionCosts[gid][lk].ings || []).length) {
    push(optionCosts[gid][lk].ings); found = true;
  }
  if (gid && rec && rec.choiceAdd && rec.choiceAdd[gid] && rec.choiceAdd[gid][lk] &&
      (rec.choiceAdd[gid][lk].ings || []).length) {
    push(rec.choiceAdd[gid][lk].ings); found = true;
  }
  return {ings: out, found};
}
function computeUsageServer(lineItems, recipes, optMap, inv, menuItems, catType, optionCosts, optionGroups) {
  const usage = {};
  (lineItems || []).forEach((li) => {
    if (!li || !li.itemKey) return;
    const qty = Number(li.qty) || 1;
    const size = li.size || "M";
    const rec = recipes[li.itemKey];
    const item = Object.assign({key: li.itemKey}, menuItems[li.itemKey] || {});
    if (rec && rec.base) {
      rec.base.forEach((b) => {
        if (!b.ing) return;
        usage[b.ing] = (usage[b.ing] || 0) + baseQtyForSize(rec, b, size) * qty;
      });
    }
    (li.optLabels || []).forEach((lb) => {
      const res = choiceIngsServer(item, rec, lb, size, optionCosts, optionGroups);
      if (res.found) {
        res.ings.forEach((r) => {
          if (r.ing) usage[r.ing] = (usage[r.ing] || 0) + r.qty * qty;
        });
      } else {
        let o = null; /* legacy single-ingredient flat qty */
        if (rec && rec.options) o = rec.options.find((x) => x.label === lb) || null;
        if (!o || !o.ing) o = optMap[lb] || null;
        if (o && o.ing) usage[o.ing] = (usage[o.ing] || 0) + (Number(o.qty) || 0) * qty;
      }
    });
    /* consumables are now explicit recipe rows (rec.base) — no auto-by-category deduction */
  });
  return usage;
}

// ---------------------------------------------------------------------------
// Release 3A: immutable, retry-safe inventory movement ledger.
// /inventoryAccounting/{itemId} is the authoritative per-item transaction
// boundary. The public inventory stock and /inventoryBalances are projections.
// ---------------------------------------------------------------------------
const INVENTORY_MOVEMENT_TYPES = new Set([
  "opening_balance", "purchase", "sale_usage", "staff_use", "rnd_testing",
  "waste", "adjustment", "manual_edit", "usage_reversal",
  "void_reversal", "refund_reversal",
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
  const setCost = raw.setCost === true || type === "purchase";
  if (!Number.isFinite(qty) || Math.abs(qty) > 100000000) throw new HttpsError("invalid-argument", "Inventory quantity is invalid.");
  if (qty === 0 && !setCost) throw new HttpsError("invalid-argument", "Inventory movement quantity cannot be zero.");
  if (requestedCost < 0 || requestedCost > 100000000) throw new HttpsError("invalid-argument", "Inventory unit cost is invalid.");
  const itemRef = db.ref(`/inventory/${itemId}`);
  const item = (await itemRef.get()).val();
  if (!item) throw new HttpsError("not-found", "Inventory item no longer exists.");
  const now = Date.now();
  let duplicate = false;
  const accountingRef = db.ref(`/inventoryAccounting/${itemId}`);
  const result = await accountingRef.transaction((current) => {
    const state = current || seedInventoryAccounting(itemId, item, now);
    state.applied = state.applied || {};
    if (state.applied[movementId]) { duplicate = true; return state; }
    const before = qty6(state.balance);
    const costBefore = qty6(state.unitCost || item.cost);
    const after = qty6(before + qty);
    let costAfter = costBefore;
    if (type === "purchase" && qty > 0 && requestedCost >= 0) {
      const denominator = before + qty;
      // A negative/zero opening balance represents prior uncosted consumption.
      // Blending it can create a nonsensical negative WAC, so the first receipt
      // that recovers such a balance establishes the new purchase cost.
      costAfter = before > 0 && denominator > 0 ? qty6(((before * costBefore) + (qty * requestedCost)) / denominator) : requestedCost;
    } else if (setCost) {
      costAfter = requestedCost;
    }
    const version = Number(state.version || 0) + 1;
    const movement = {
      id: movementId, itemId,
      itemName: String(item.name || itemId).slice(0, 160), unit: String(item.unit || "").slice(0, 40),
      type, qty, unitCost: type === "purchase" ? requestedCost : costBefore,
      totalCost: money(qty * (type === "purchase" ? requestedCost : costBefore)),
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
  if (!result.committed) throw new Error(`Inventory transaction was not committed for ${itemId}`);
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
    const serverOnly = new Set(["opening_balance", "sale_usage", "void_reversal", "refund_reversal"]);
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
      const catType = ps.catType || {};
      const optionCosts = ps.optionCosts || {};
      const optionGroups = ogSnap.val() || {};

      const usage = computeUsageServer(o.lineItems, recipes, optMap, inv, mi, catType, optionCosts, optionGroups);
      const ids = Object.keys(usage);
      let cogs = 0;
      let missing = false;
      ids.forEach((ing) => {
        const c = Number(inv[ing] && inv[ing].cost) || 0;
        if (!c) missing = true;
        cogs += usage[ing] * c;
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
        cogsCovered: !missing,
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
