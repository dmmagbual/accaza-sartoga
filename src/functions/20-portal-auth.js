const ORDER_REGION = "asia-southeast1";
// CallableOptions requires a real Boolean. Passing a defineBoolean parameter
// object is truthy at runtime and accidentally enforces App Check even when
// ENFORCE_APP_CHECK=false.
const ENFORCE_APP_CHECK = String(process.env.ENFORCE_APP_CHECK || "false").toLowerCase() === "true";
// Staged enforcement: the public, bot-targeted order path can be enforced before the
// staff surface. ENFORCE_APP_CHECK=true always implies the order path as well.
const ENFORCE_APP_CHECK_ORDERS = ENFORCE_APP_CHECK || String(process.env.ENFORCE_APP_CHECK_ORDERS || "false").toLowerCase() === "true";
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
  const normalized = String(role || "").toLowerCase();
  return normalized === "owner" ? "superadmin" : normalized;
}

// Emergency sign-out (17 Sep 2026): /sessionControl/cutoff/at is the moment a Super Admin signed
// every portal session out. A session that signed in before it is refused by every portal
// service, so a forgotten tab stops calling the server even before its ID token expires.
// Cached for a minute per instance so the check adds no read to most calls.
const SESSION_CUTOFF_CACHE_MS = 60 * 1000;
let sessionCutoffCache = {at: 0, loadedAt: 0};
async function portalSessionCutoff(db) {
  if (Date.now() - sessionCutoffCache.loadedAt < SESSION_CUTOFF_CACHE_MS) return sessionCutoffCache.at;
  try {
    const at = Number((await db.ref("/sessionControl/cutoff/at").get()).val()) || 0;
    sessionCutoffCache = {at, loadedAt: Date.now()};
  } catch (_error) { /* keep the last known cutoff; never block sign-in on a read failure */ }
  return sessionCutoffCache.at;
}
// Super Admin "Sign out this user": /sessionControl/users/<uid>/at, cached per account like the
// everyone cutoff so a callable costs at most one small read per account per minute.
const userCutoffCache = new Map();
async function portalUserSessionCutoff(db, uid) {
  const cached = userCutoffCache.get(uid);
  if (cached && Date.now() - cached.loadedAt < SESSION_CUTOFF_CACHE_MS) return cached.at;
  let at = cached ? cached.at : 0;
  try { at = Number((await db.ref(`/sessionControl/users/${uid}/at`).get()).val()) || 0; } catch (_error) { /* keep the last known cutoff */ }
  userCutoffCache.set(uid, {at, loadedAt: Date.now()});
  return at;
}
function sessionSignedInAt(request) { return (Number(request && request.auth && request.auth.token && request.auth.token.auth_time) || 0) * 1000; }
async function requirePortalUser(db, request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "Staff login is required.");
  const signedInAt = sessionSignedInAt(request), cutoff = signedInAt ? await portalSessionCutoff(db) : 0;
  if (cutoff && signedInAt < cutoff) throw new HttpsError("unauthenticated", "A Super Admin signed every device out. Sign in again.");
  const userCutoff = signedInAt ? await portalUserSessionCutoff(db, request.auth.uid) : 0;
  if (userCutoff && signedInAt < userCutoff) throw new HttpsError("unauthenticated", "A Super Admin signed this account out. Sign in again.");
  const snap = await db.ref(`/admins/${request.auth.uid}`).get();
  const raw=snap.val(),role = portalRoleValue(raw);
  if (raw && typeof raw === "object" && (raw.disabled === true || raw.active === false)) throw new HttpsError("permission-denied", "This Accaza account is disabled.");
  if (!["superadmin", "admin", "manager", "staff", "cashier", "kitchen", "finance"].includes(role)) {
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
    if(!["create","update","deactivate","reactivate","initialize_legacy","validate","merge","delete","references"].includes(action))throw new HttpsError("invalid-argument","Supplier action is invalid.");
    /* Merging and deleting a master record rewrite or remove links that purchases, payables,
       advances, stock receipts and brands depend on, so they are Super Admin operations. */
    if(["merge","delete"].includes(action)&&actor.role!=="superadmin")throw new HttpsError("permission-denied","Only a Super Admin can merge or delete a supplier master record.");
    if(action==="validate"){const supplier=await requireActiveSupplier(db,data.supplierId,data.name);return{supplierId:supplier.id,name:supplier.name,active:true};}
    if(action==="initialize_legacy"){
      // Finance Books calls this on every sign-in. The legacy link sweep reads six whole
      // nodes (including petty vouchers with receipt images), so it runs at most once a day.
      const sweepRef=db.ref("/supplierMigrations/legacySweepCheckedAt"),lastSweep=Number((await sweepRef.get()).val()||0);
      if(data.force!==true&&now-lastSweep<86400000)return{initialized:true,skipped:true,linkedWrites:0};
      await sweepRef.set(now);
      // Only records that still have no supplier id are read (indexed supplierId equal to null
      // or ""); the supplier list is read only when one of them needs a link.
      const unlinkedSnaps=await Promise.all([
        db.ref("/purchaseInvoices").orderByChild("supplierId").equalTo(null).get(),db.ref("/purchaseInvoices").orderByChild("supplierId").equalTo("").get(),
        db.ref("/pettyCashVouchers").orderByChild("supplierId").equalTo(null).get(),db.ref("/pettyCashVouchers").orderByChild("supplierId").equalTo("").get(),
        db.ref("/payables").orderByChild("supplierId").equalTo(null).get(),db.ref("/payables").orderByChild("supplierId").equalTo("").get(),
        db.ref("/stockReceipts").orderByChild("supplierId").equalTo(null).get(),db.ref("/stockReceipts").orderByChild("supplierId").equalTo("").get(),
        db.ref("/inventoryBatch").orderByChild("supplierId").equalTo(null).get(),db.ref("/inventoryBatch").orderByChild("supplierId").equalTo("").get(),
      ]),pair=(i)=>Object.assign({},unlinkedSnaps[i].val()||{},unlinkedSnaps[i+1].val()||{});
      const purchases=pair(0),vouchers=pair(2),payables=pair(4),receipts=pair(6),batches=pair(8),byKey={},writes={};
      const needsLink=[purchases,vouchers,payables,receipts,batches].some((rows)=>Object.keys(rows).length);
      const suppliers=needsLink?((/* download-ok: bounded supplier master list, read only when a legacy record still needs a link */await db.ref("/suppliers").get()).val()||{}):{};
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
    /* SupplierMaster owns the list of places a supplier id is stored and still drives
       behaviour, and the write plan that repoints them. See functions/lib/supplier-master.js
       for why posted Finance movements are deliberately excluded. */
    const supplierReferences=async(id)=>{
      // Indexed on supplierId: only the records that point at this supplier are read. Register
      // advances come from the shifts that hold one (supplierAdvanceShiftPayOuts).
      const snaps=await Promise.all([
        db.ref("/purchaseInvoices").orderByChild("supplierId").equalTo(id).get(),db.ref("/payables").orderByChild("supplierId").equalTo(id).get(),
        db.ref("/pettyCashVouchers").orderByChild("supplierId").equalTo(id).get(),db.ref("/stockReceipts").orderByChild("supplierId").equalTo(id).get(),
        db.ref("/inventoryBatch").orderByChild("supplierId").equalTo(id).get(),db.ref("/inventorySku").orderByChild("supplierId").equalTo(id).get(),
      ]);
      const names=["purchaseInvoices","payables","pettyCashVouchers","stockReceipts","inventoryBatch","inventorySku"];
      if(names.join()!==SupplierMaster.REFERENCE_COLLECTIONS.join())throw new HttpsError("internal","Supplier reference collections changed; update the indexed lookup.");
      const collections={shifts:{}};names.forEach((name,ix)=>{collections[name]=snaps[ix].val()||{};});
      const shiftPayOuts=await supplierAdvanceShiftPayOuts(db);Object.keys(shiftPayOuts).forEach((shiftId)=>{collections.shifts[shiftId]={payOuts:shiftPayOuts[shiftId]};});
      return SupplierMaster.collectReferences(collections,id);
    };
    if(action==="references"){const hits=await supplierReferences(supplierId);return{supplierId,name:financeText(supplier.name,120),references:hits,total:hits.total};}
    if(action==="merge"){
      /* Fold a duplicate into the record that survives. Live links are repointed so future
         lookups, advance matching and brand mapping follow the survivor; the point-in-time
         supplier NAME already written on each historical document is left exactly as posted,
         and no cash, inventory quantity, subledger balance or Books journal amount moves. */
      const targetId=financeKey(data.targetId,"Surviving supplier ID"),reason=financeText(data.reason,300);
      if(!reason)throw new HttpsError("invalid-argument","A merge reason is required.");
      if(targetId===supplierId)throw new HttpsError("invalid-argument","Choose a different surviving supplier.");
      if(supplier.mergedInto)throw new HttpsError("failed-precondition",`This supplier was already merged into ${supplier.mergedInto}.`);
      const target=(await db.ref(`/suppliers/${targetId}`).get()).val();
      if(!target)throw new HttpsError("not-found","The surviving supplier was not found.");
      if(target.mergedInto)throw new HttpsError("failed-precondition","The surviving supplier has itself been merged. Choose the final record.");
      if(target.active===false)throw new HttpsError("failed-precondition","The surviving supplier is inactive. Reactivate it first.");
      const hits=await supplierReferences(supplierId),targetName=financeText(target.name,120),writes=SupplierMaster.planMergeWrites(hits,targetId);
      const mergedKey=supplierNameKey(supplier.name),mergedIndexId=crypto.createHash("sha256").update(mergedKey).digest("hex").slice(0,32);
      /* The duplicate's spelling now resolves to the survivor instead of blocking reuse. */
      if(mergedKey)writes[`supplierNameIndex/${mergedIndexId}`]={supplierId:targetId,normalizedName:mergedKey,claimedAt:now,redirectedFrom:supplierId};
      Object.assign(writes,{[`suppliers/${supplierId}/mergedInto`]:targetId,[`suppliers/${supplierId}/mergedAt`]:now,[`suppliers/${supplierId}/mergedBy`]:actor.uid,[`suppliers/${supplierId}/active`]:false,
        [`operationalAudit/${now}_supplier_merge_${supplierId}`]:operationalAuditRecord("merge_supplier","supplier",supplierId,actor,{mergedInto:targetId,mergedName:financeText(supplier.name,120),survivingName:targetName,reason,repointed:{purchaseInvoices:hits.purchaseInvoices.length,payables:hits.payables.length,pettyCashVouchers:hits.pettyCashVouchers.length,stockReceipts:hits.stockReceipts.length,inventoryBatch:hits.inventoryBatch.length,inventorySku:hits.inventorySku.length,shiftAdvances:hits.shiftAdvances.length},accounting:"No cash, inventory quantity, subledger balance, Finance movement or Books journal amount changed. Historical supplier name snapshots and posted financial movements are untouched; only the live supplier link moved to the surviving master."})});
      await db.ref().update(writes);
      return{supplierId,mergedInto:targetId,survivingName:targetName,repointed:hits.total};
    }
    if(action==="delete"){
      /* Only a record that nothing points at can be removed. Anything with history is merged
         or deactivated instead, so no document is ever left pointing at a missing master. */
      const reason=financeText(data.reason,300);if(!reason)throw new HttpsError("invalid-argument","A deletion reason is required.");
      if(supplier.mergedInto)throw new HttpsError("failed-precondition","A merged supplier is part of the audit trail and cannot be deleted.");
      const hits=await supplierReferences(supplierId);
      if(hits.total>0)throw new HttpsError("failed-precondition",`This supplier is used by ${SupplierMaster.referenceSummary(hits)}. Merge it into the correct supplier instead of deleting it.`);
      const key=supplierNameKey(supplier.name),indexId=crypto.createHash("sha256").update(key).digest("hex").slice(0,32),writes={[`suppliers/${supplierId}`]:null};
      const index=(await db.ref(`/supplierNameIndex/${indexId}`).get()).val();
      if(index&&financeText(index.supplierId,160)===supplierId)writes[`supplierNameIndex/${indexId}`]=null;
      writes[`operationalAudit/${now}_supplier_delete_${supplierId}`]=operationalAuditRecord("delete_supplier","supplier",supplierId,actor,{name:financeText(supplier.name,120),reason,accounting:"The record had no purchases, payables, advances, stock receipts, batches or brands linked to it, so nothing financial or operational referenced it."});
      await db.ref().update(writes);
      return{supplierId,deleted:true};
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
    const receiptRef=db.ref(`/staffMessageReceipts/${messageId}/${actor.uid}`);const receipt=(await receiptRef.transaction((current)=>{current=current||{userUid:actor.uid,userName:financeText(actor.name||actor.email||actor.role,120),role:actor.role};if(!current.readAt)current.readAt=now;if(action==="acknowledge"&&!current.acknowledgedAt)current.acknowledgedAt=now;current.updatedAt=now;return current;})).snapshot.val()||{};
    // staffReceiptIndex/<uid>/<messageId> is the reader's own bounded read/acknowledge index.
    // The inbox reads this one small node per user instead of downloading every staff member's
    // receipt for every message ever sent, and re-downloading all of it whenever anybody read
    // anything (2026-09-16 download audit). The per-message receipt above remains the audit
    // record and the source this index is derived from.
    await db.ref(`/staffReceiptIndex/${actor.uid}/${messageId}`).set({messageId,readAt:Number(receipt.readAt)||now,acknowledgedAt:Number(receipt.acknowledgedAt)||0,updatedAt:Number(receipt.updatedAt)||now,schemaVersion:1});
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

