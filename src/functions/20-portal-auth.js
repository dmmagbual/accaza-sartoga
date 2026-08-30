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
    const [activeSnap, ordersSnap, offlineSnap, custodySnap, inventoryMovementSnap, ...telemetrySnaps] = await Promise.all([db.ref("/activeOrders").limitToLast(250).get(),db.ref("/orders").limitToLast(100).get(),db.ref("/offlinePosSync").orderByChild("updatedAt").limitToLast(100).get(),db.ref("/cashCustody").orderByChild("closedAt").limitToLast(100).get(),db.ref("/inventoryMovements").orderByChild("occurredAt").limitToLast(500).get(),...days.map((day) => db.ref(`/clientTelemetryDaily/${day}`).get())]);
    const orders = ordersSnap.val() || {},orderIds=Object.keys(orders).slice(0,100),financialPairs=await Promise.all(orderIds.map(async(id)=>{const snap=await db.ref(`/financialMovements/sale_${id}`).get();return[id,snap.exists()?snap.val():null];}));
    const financialMovements = {},inventoryMovementEvidence={};financialPairs.forEach(([id, value]) => {if (value) financialMovements[`sale_${id}`] = value;});Object.values(inventoryMovementSnap.val()||{}).forEach(m=>{if(m&&m.sourceType==="order"&&m.sourceId)inventoryMovementEvidence[m.sourceId]=true;});const telemetry = {};days.forEach((day, i) => {telemetry[day] = telemetrySnaps[i].val() || {};});
    return OperationalExceptions.buildOperationalExceptions({activeOrders: activeSnap.val() || {}, orders, offlinePosSync: offlineSnap.val() || {}, cashCustody: custodySnap.val() || {}, financialMovements,inventoryMovementEvidence, telemetry}, now);
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
