"use strict";

// Order flow. A paid order is not the same as a served order: every POS sale (walk-in,
// GrabFood, FoodPanda) enters the order queue when the server accepts it and progresses
// through queued -> preparing -> ready -> served. GrabFood/FoodPanda use the same terminal
// state but the POS labels it "Picked up". It leaves only when staff complete that handover,
// record it as not collected, or it is voided or fully refunded.
// fully refunded. Website orders use their own status flow (Confirmed -> Completed) and only
// borrow the "not collected" outcome from here.
//
// Serving state is operational only. It never changes the sale status, revenue, tender,
// inventory, COGS or any Finance Books posting; those still post when the sale is paid.

const SERVICE_VERSION = 2;
const MANAGER_ROLES = new Set(["owner", "superadmin", "admin", "manager"]);
const SERVICE_CHANNELS = new Set(["instore", "grabfood", "foodpanda"]);
const ONLINE_OPEN = new Set(["Confirmed", "Preparing", "Ready"]);
const OUTCOMES = new Set(["served", "handover", "not_collected"]);
const MAX_REVIEW_ITEMS = 100;

function fail(options, code, message) {
  if (options && typeof options.error === "function") throw options.error(code, message);
  throw Object.assign(new Error(message), {code});
}
function cleanKey(options, value, label, pattern = /^[A-Za-z0-9_-]{1,160}$/) {
  const key = String(value == null ? "" : value).trim();
  if (!pattern.test(key)) fail(options, "invalid-argument", `${label} is invalid.`);
  return key;
}
function cleanText(value, max) {return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);}
function money(value) {return Math.round((Number(value) || 0) * 100) / 100;}

function isOnlineOrder(order) {return !!order && (order.source === "online" || order.channel === "online");}
function isServiceChannelOrder(order) {return !!order && order.source === "pos" && SERVICE_CHANNELS.has(String(order.channel || "instore").toLowerCase());}
function fullyRefunded(order) {const refund = money(order && order.refundAmount);return refund > 0 && refund >= money(order.total) - 0.009;}
function serviceState(order) {return String((order && order.service && order.service.state) || "");}

// The service record the server stamps on a newly accepted POS sale. Anything the device
// sent under "service" is ignored.
function initialService(order, now) {
  const at = Number(order && order.timestamp) || Number(now) || Date.now();
  return {state: "queued", queuedAt: at, version: SERVICE_VERSION};
}

// Does this order still require operational fulfilment? Shared rule for the server
// projection, the Exception Center and the single POS order-flow rail.
function needsService(order) {
  if (!order || order.voided === true || fullyRefunded(order)) return false;
  const state = serviceState(order);
  if (isOnlineOrder(order)) return state !== "not_collected" && order.posCaptured === true && !!order.shiftId && ONLINE_OPEN.has(String(order.status || ""));
  return isServiceChannelOrder(order) && ["queued", "preparing", "ready"].includes(state);
}

// Keep an order in /orders and /activeOrders while it is waiting to be served or while a
// "not collected" outcome still waits for a manager, whichever shift it came from.
function keepsOrderLive(order) {
  if (!order || order.voided === true) return false;
  if (needsService(order)) return true;
  return serviceState(order) === "not_collected" && !order.service.reviewedAt;
}

function actorStamp(actor) {return {uid: String(actor && actor.uid || ""), role: String(actor && actor.role || ""), name: cleanText(actor && actor.name, 120)};}

function withHistory(service, requestId, entry) {
  const history = Object.assign({}, service.history || {});
  history[requestId] = entry;
  const keys = Object.keys(history).sort((a, b) => Number(history[a].at || 0) - Number(history[b].at || 0));
  while (keys.length > 20) delete history[keys.shift()];
  return Object.assign({}, service, {history});
}

// Pure transition. Returns {service, extra, duplicate} or throws.
function transition(options, order, action, requestId, actor, now, detail = {}) {
  const current = Object.assign({}, order.service || {});
  if (current.history && current.history[requestId]) {
    if (current.history[requestId].action !== action) fail(options, "already-exists", "That request ID was already used for another serving action.");
    return {service: current, extra: {}, duplicate: true};
  }
  if (order.voided === true) fail(options, "failed-precondition", `Order ${order.id} was voided and is no longer in the serving queue.`);
  const state = current.state || "";
  const who = actorStamp(actor), online = isOnlineOrder(order);
  const entry = {action, at: now, byUid: who.uid, byRole: who.role, byName: who.name};
  let next, extra = {};
  if (action === "start_preparing") {
    if (online) fail(options, "failed-precondition", "Use the website order status flow for online orders.");
    if (!isServiceChannelOrder(order)) fail(options, "failed-precondition", "Only POS sales use the order flow.");
    if (state === "preparing") return {service: current, extra: {}, duplicate: true};
    if (state !== "queued") fail(options, "failed-precondition", `Order ${order.id} is not waiting in the order queue.`);
    next = Object.assign({}, current, {state: "preparing", preparingAt: now, preparingByUid: who.uid, preparingByRole: who.role, preparingByName: who.name});
    // Preparation is now a real staff action, so it is also the controlled point at which a
    // completed in-store sale can no longer be rewritten through the correction workflow.
    if (!order.preparationStartedAt) extra.preparationStartedAt = now;
    if (order.preparationStatus === "not_prepared") extra.preparationStatus = "preparing";
  } else if (action === "mark_ready") {
    if (online) fail(options, "failed-precondition", "Use the website order status flow for online orders.");
    if (!isServiceChannelOrder(order)) fail(options, "failed-precondition", "Only POS sales use the order flow.");
    if (state === "ready") return {service: current, extra: {}, duplicate: true};
    if (state !== "preparing") fail(options, "failed-precondition", `Order ${order.id} is not being prepared.`);
    next = Object.assign({}, current, {state: "ready", readyAt: now, readyByUid: who.uid, readyByRole: who.role, readyByName: who.name});
    if (order.preparationStatus === "preparing") extra.preparationStatus = "ready";
  } else if (action === "serve") {
    if (online) fail(options, "failed-precondition", "Complete website orders through the order status (Served completes the order).");
    if (!isServiceChannelOrder(order)) fail(options, "failed-precondition", "Only POS sales use the serving queue.");
    if (state === "served") return {service: current, extra: {}, duplicate: true};
    if (state !== "ready" && detail.closeReview !== true) fail(options, "failed-precondition", `Order ${order.id} must be marked ready before it is handed over.`);
    next = Object.assign({}, current, {state: "served", servedAt: now, servedByUid: who.uid, servedByRole: who.role, servedByName: who.name});
    // Serving is the latest point preparation can have started: lock completed-order corrections.
    if (!order.preparationStartedAt) extra.preparationStartedAt = now;
    if (order.preparationStatus === "not_prepared" || order.preparationStatus === "preparing" || order.preparationStatus === "ready") extra.preparationStatus = "served";
  } else if (action === "return_to_queue") {
    if (!isServiceChannelOrder(order)) fail(options, "failed-precondition", "Only POS sales can be returned to the order queue.");
    if (state === "queued") return {service: current, extra: {}, duplicate: true};
    if (state !== "served") fail(options, "failed-precondition", `Order ${order.id} was not marked served.`);
    const reason = cleanText(detail.reason, 300);
    next = Object.assign({}, current, {state: "queued", returnedAt: now, returnedByUid: who.uid, returnedByName: who.name, returnReason: reason});
    delete next.servedAt; delete next.servedByUid; delete next.servedByRole; delete next.servedByName;
    entry.reason = reason;
  } else if (action === "not_collected") {
    const reason = cleanText(detail.reason, 300);
    if (reason.length < 3) fail(options, "invalid-argument", "Say why the order was not collected.");
    if (state === "not_collected") return {service: current, extra: {}, duplicate: true};
    if (!needsService(order)) fail(options, "failed-precondition", `Order ${order.id} is not waiting to be served.`);
    next = Object.assign({}, current, {state: "not_collected", queuedAt: current.queuedAt || Number(order.timestamp) || now, notCollectedAt: now, notCollectedByUid: who.uid, notCollectedByName: who.name, notCollectedReason: reason, version: SERVICE_VERSION});
    entry.reason = reason;
  } else if (action === "review_not_collected") {
    if (!MANAGER_ROLES.has(who.role)) fail(options, "permission-denied", "A manager must review orders that were not collected.");
    if (state !== "not_collected") fail(options, "failed-precondition", `Order ${order.id} is not recorded as not collected.`);
    if (current.reviewedAt) return {service: current, extra: {}, duplicate: true};
    const note = cleanText(detail.note, 300);
    if (note.length < 3) fail(options, "invalid-argument", "Record what was decided (for example refunded, remade, or kept as waste).");
    next = Object.assign({}, current, {reviewedAt: now, reviewedByUid: who.uid, reviewedByName: who.name, reviewNote: note});
    entry.note = note;
  } else {
    fail(options, "invalid-argument", "Unknown serving action.");
  }
  return {service: withHistory(next, requestId, entry), extra, duplicate: false};
}

async function readLiveOrder(options, orderId) {
  const {db} = options;
  const snap = await db.ref(`/orders/${orderId}`).get();
  if (!snap.exists()) {
    const archived = await db.ref(`/archivedOrders/${orderId}`).get();
    fail(options, archived.exists() ? "failed-precondition" : "not-found", archived.exists() ? `Order ${orderId} is already closed and archived.` : "Order not found.");
  }
  return Object.assign({}, snap.val() || {}, {id: orderId});
}

async function applyAction(options, order, action, requestId, detail, now) {
  const {db, actor, activeOrderProjection, shouldProjectOrder} = options;
  const result = transition(options, order, action, requestId, actor, now, detail);
  if (result.duplicate) return {orderId: order.id, action, state: serviceState(order), duplicate: true};
  const updated = Object.assign({}, order, result.extra, {service: result.service});
  const writes = {[`orders/${order.id}/service`]: result.service};
  Object.keys(result.extra).forEach((key) => {writes[`orders/${order.id}/${key}`] = result.extra[key];});
  if (typeof shouldProjectOrder === "function" && typeof activeOrderProjection === "function") {
    const activeShift = (await db.ref("/posActiveShift").get()).val() || null;
    writes[`activeOrders/${order.id}`] = shouldProjectOrder(updated, activeShift, now) ? activeOrderProjection(updated) : null;
  }
  writes[`operationalAudit/${now}_service_${requestId}`] = {action: `order_service_${action}`, sourceType: "order", sourceId: order.id, shiftId: order.shiftId || "", channel: order.channel || "", actorUid: actor.uid, actorRole: actor.role, reason: cleanText(detail.reason || detail.note, 300), requestId, ts: now, schemaVersion: 1};
  await db.ref().update(writes);
  return {orderId: order.id, action, state: result.service.state, duplicate: false};
}

// Close-of-shift review: every unserved order gets an explicit outcome, recorded on the shift
// and printed on its Z report. Per-order failures are reported, never thrown, so the review can
// never stop a shift from closing.
async function closeReview(options, data, now) {
  const {db, actor} = options;
  const shiftId = cleanKey(options, data.shiftId, "Shift ID");
  const requestId = cleanKey(options, data.requestId, "Request ID", /^[A-Za-z0-9_-]{8,120}$/);
  const shift = (await db.ref(`/shifts/${shiftId}`).get()).val();
  if (!shift) fail(options, "not-found", "Shift not found.");
  const existing = shift.serviceReview;
  if (existing && existing.requestId === requestId) return Object.assign({duplicate: true}, existing);
  const raw = Array.isArray(data.items) ? data.items : [];
  if (raw.length > MAX_REVIEW_ITEMS) fail(options, "invalid-argument", "Too many orders in one review.");
  const items = [], seen = {};
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {}, outcome = String(row.outcome || "");
    let orderId;
    try {orderId = cleanKey(options, row.orderId, "Order ID");} catch (_e) {continue;}
    if (seen[orderId] || !OUTCOMES.has(outcome)) continue;
    seen[orderId] = true;
    const reason = cleanText(row.reason, 300), out = {orderId, outcome, reason, name: cleanText(row.name, 80), channel: cleanText(row.channel, 20), queuedAt: Number(row.queuedAt) || 0, applied: false, error: ""};
    try {
      if (row.unsynced === true) {out.error = "Not yet synchronized; the till applies it after sync."; items.push(out); continue;}
      const order = await readLiveOrder(options, orderId);
      out.channel = out.channel || String(order.channel || (isOnlineOrder(order) ? "online" : "instore"));
      out.name = out.name || cleanText(order.name, 80);
      out.queuedAt = out.queuedAt || Number(order.service && order.service.queuedAt) || Number(order.timestamp) || 0;
      // Closing review records a staff-confirmed handover even if the earlier preparation
      // taps were missed. The normal live POS button still requires Ready first.
      if (outcome === "served" && !isOnlineOrder(order)) await applyAction(options, order, "serve", `${requestId}_${i}`, {closeReview: true}, now);
      else if (outcome === "not_collected") await applyAction(options, order, "not_collected", `${requestId}_${i}`, {reason}, now);
      out.applied = true;
    } catch (error) {out.error = cleanText(error && error.message || error, 200);}
    items.push(out);
  }
  const who = actorStamp(actor);
  const review = {requestId, at: now, byUid: who.uid, byName: who.name, byRole: who.role, version: SERVICE_VERSION,
    counts: {served: items.filter((x) => x.outcome === "served").length, handover: items.filter((x) => x.outcome === "handover").length, notCollected: items.filter((x) => x.outcome === "not_collected").length},
    items};
  await db.ref().update({[`shifts/${shiftId}/serviceReview`]: review, [`operationalAudit/${now}_service_review_${requestId}`]: {action: "order_service_close_review", sourceType: "shift", sourceId: shiftId, actorUid: who.uid, actorRole: who.role, counts: review.counts, requestId, ts: now, schemaVersion: 1}});
  return Object.assign({duplicate: false}, review);
}

async function manageOrderServiceCommand(options) {
  const data = options.data || {}, now = Number(options.now) || Date.now(), action = String(data.action || "");
  if (action === "close_review") return closeReview(options, data, now);
  if (!["start_preparing", "mark_ready", "serve", "return_to_queue", "not_collected", "review_not_collected"].includes(action)) fail(options, "invalid-argument", "Unknown order-flow action.");
  const orderId = cleanKey(options, data.orderId, "Order ID");
  const requestId = cleanKey(options, data.requestId, "Request ID", /^[A-Za-z0-9_-]{8,120}$/);
  const order = await readLiveOrder(options, orderId);
  return applyAction(options, order, action, requestId, {reason: data.reason, note: data.note}, now);
}

module.exports = {SERVICE_VERSION, MANAGER_ROLES, initialService, needsService, keepsOrderLive, isOnlineOrder, isServiceChannelOrder, fullyRefunded, transition, manageOrderServiceCommand};
