
function posStaffText(value, label, max) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text.length > max) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return text;
}
function posPinHash(pin, salt) { return crypto.scryptSync(pin, salt, 32).toString("hex"); }
// POS PIN secrets (audit SEC-03, 4 Nov 2026). /posStaff is readable by every till login, so a
// 4-6 digit PIN hash stored there could be brute-forced offline. The salt and hash live in the
// server-only /posStaffSecrets/{staffId}; a profile not yet moved still checks against its own row.
async function posStaffPinRow(db, staffId, row) {
  const secret = (await db.ref(`/posStaffSecrets/${staffId}`).get()).val();
  return secret && secret.pinHash ? secret : row;
}
function posPinSecret(pin) { const salt = crypto.randomBytes(16).toString("hex"); return {pinSalt: salt, pinHash: posPinHash(pin, salt)}; }
// The PIN fields a profile row must no longer carry once its secret is stored server-side.
function posPinRowClears(staffId) { return {[`posStaff/${staffId}/pin`]: null, [`posStaff/${staffId}/pinSalt`]: null, [`posStaff/${staffId}/pinHash`]: null}; }
function posPinValid(pin, row) {
  const value = String(pin || "").trim();
  return /^[0-9]{4,6}$/.test(value) && row && row.pinSalt && row.pinHash && crypto.timingSafeEqual(Buffer.from(posPinHash(value, row.pinSalt), "hex"), Buffer.from(row.pinHash, "hex"));
}
// Opening drawer count (3 Nov 2026): only the till's denominations, as whole counts. The database
// rules freeze an open shift's openCount one denomination at a time, so a key outside this list
// could otherwise be changed or deleted from a browser. Zero counts are left out.
const POS_DRAWER_DENOMS = ["b1000", "b500", "b200", "b100", "b50", "p20", "c10", "c5", "c1", "c25", "c10s", "c5s"];
function posOpenCountMap(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}, out = {};
  for (const [key, value] of Object.entries(source)) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new HttpsError("invalid-argument", "Opening cash count is invalid.");
    if (!count) continue;
    if (!POS_DRAWER_DENOMS.includes(key)) throw new HttpsError("invalid-argument", "Opening cash count has a note or coin the till does not use.");
    out[key] = count;
  }
  return out;
}
// The bundle loads this section before the one that owns durableShiftReference, but every
// function declaration is hoisted to module scope, so the format stays defined in one place.
function shiftReferenceFor(shift) { return durableShiftReference(shift, shift && shift.id); }

// Staff PINs are set and changed only here (audit SEC-03): the browser never writes or reads a PIN.
//  create      add a staff profile with its PIN stored as a server-only salted hash
//  remove      delete a staff profile together with its stored PIN
//  A PIN only works with its owner's own login, so PINs need not be unique: no uniqueness check
//  (which would tell a manager that some profile uses a PIN, and could race).
//  change_pin  change a profile's PIN (manager only; the current PIN is checked when one is set)
//  secure_all  move every remaining plain PIN or row-stored hash into /posStaffSecrets (idempotent)
async function managePosStaffPins(db, actor, action, data) {
  const now = Date.now(), pinOf = (value, label) => {const pin = String(value || "").trim(); if (!/^[0-9]{4,6}$/.test(pin)) throw new HttpsError("invalid-argument", `${label} must be 4 to 6 digits.`); return pin;};
  const rows = (/* download-ok: bounded staff roster (one row per staff member) for PIN uniqueness and migration */await db.ref("/posStaff").get()).val() || {}, secretsSnap = /* download-ok: bounded PIN secrets (one row per staff member), server-only */await db.ref("/posStaffSecrets").get(), secrets = secretsSnap.val() || {};
  const pinFor = (id) => secrets[id] && secrets[id].pinHash ? secrets[id] : rows[id];
  if (action === "secure_all") {
    const writes = {}; let moved = 0;
    for (const [id, row] of Object.entries(rows)) {
      if (!row || typeof row !== "object") continue;
      const plain = String(row.pin == null ? "" : row.pin).trim();
      if (secrets[id] && secrets[id].pinHash) { if (row.pin != null || row.pinHash != null || row.pinSalt != null) {Object.assign(writes, posPinRowClears(id)); moved++;} continue; }
      if (row.pinHash && row.pinSalt) { writes[`posStaffSecrets/${id}`] = {pinSalt: row.pinSalt, pinHash: row.pinHash, updatedAt: now, updatedBy: actor.uid, migrated: true}; Object.assign(writes, posPinRowClears(id)); moved++; continue; }
      if (/^[0-9]{4,6}$/.test(plain)) { writes[`posStaffSecrets/${id}`] = Object.assign(posPinSecret(plain), {updatedAt: now, updatedBy: actor.uid, migrated: true}); Object.assign(writes, posPinRowClears(id)); moved++; }
      // An unusable leftover (a malformed plain PIN, or a hash with no salt) cannot sign anyone in;
      // clear it so the readable row holds nothing and this does not re-run on every page load.
      else if (row.pin != null || row.pinHash != null || row.pinSalt != null) { Object.assign(writes, posPinRowClears(id)); moved++; }
    }
    if (moved) { writes[`operationalAudit/${now}_pos_pins_secured`] = {action: "secure_pos_staff_pins", sourceType: "posStaff", sourceId: "all", count: moved, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}; await db.ref().update(writes); }
    return {secured: moved};
  }
  if (action === "create") {
    const name = posStaffText(data.name, "Staff name", 120), role = ["cashier", "barista", "manager", "staff", "supervisor"].includes(String(data.role || "")) ? String(data.role) : "cashier", pin = pinOf(data.pin, "PIN");
    const id = `st_${now.toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    await db.ref().update({[`posStaff/${id}`]: {name, role, ts: now}, [`posStaffSecrets/${id}`]: Object.assign(posPinSecret(pin), {updatedAt: now, updatedBy: actor.uid}),
      [`operationalAudit/${now}_pos_staff_create_${id}`]: {action: "create_pos_staff", sourceType: "posStaff", sourceId: id, staffName: name, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}});
    return {staffId: id, created: true};
  }
  const staffId = posStaffText(data.staffId, "Staff profile", 160), row = rows[staffId];
  if (!row) throw new HttpsError("not-found", "POS staff profile was not found.");
  if (action === "remove") {
    await db.ref().update({[`posStaff/${staffId}`]: null, [`posStaffSecrets/${staffId}`]: null,
      [`operationalAudit/${now}_pos_staff_remove_${staffId}`]: {action: "remove_pos_staff", sourceType: "posStaff", sourceId: staffId, staffName: String(row.name || ""), accountUid: String(row.accountUid || ""), actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}});
    return {staffId, removed: true};
  }
  const current = pinFor(staffId), hasPin = !!((current && current.pinHash) || String(row.pin || ""));
  if (hasPin) { const given = String(data.currentPin || "").trim(); if (!(posPinValid(given, current) || (row.pin != null && String(row.pin) === given))) throw new HttpsError("permission-denied", "Current PIN is incorrect."); }
  const pin = pinOf(data.newPin, "New PIN");
  await db.ref().update(Object.assign({[`posStaffSecrets/${staffId}`]: Object.assign(posPinSecret(pin), {updatedAt: now, updatedBy: actor.uid})}, posPinRowClears(staffId), {
    [`operationalAudit/${now}_pos_pin_change_${staffId}`]: {action: "change_pos_staff_pin", sourceType: "posStaff", sourceId: staffId, staffName: String(row.name || ""), actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}}));
  return {staffId, changed: true};
}

// Owns the identity bridge between Firebase Authentication and the POS staff master.
// A staff member may never choose another profile or send a client-selected owner ID.
exports.managePosStaffIdentity = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request), data = request.data || {};
    if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only a manager can link a POS staff profile.");
    const action = String(data.action || "link");
    if (action === "create" || action === "change_pin" || action === "secure_all" || action === "remove") return managePosStaffPins(db, actor, action, data);
    const staffId = posStaffText(data.staffId, "Staff profile", 160), email = posStaffText(data.email, "Firebase account email", 320).toLowerCase(), pin = String(data.pin || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter the registered Firebase account email.");
    if (!/^[0-9]{4,6}$/.test(pin)) throw new HttpsError("invalid-argument", "PIN must be 4 to 6 digits.");
    let accountUid; try { accountUid = (await getAdminAuth().getUserByEmail(email)).uid; } catch (_error) { throw new HttpsError("not-found", "No Firebase account exists for that email."); }
    const [staffSnap, accountSnap, allStaffSnap] = await Promise.all([db.ref(`/posStaff/${staffId}`).get(), db.ref(`/admins/${accountUid}`).get(), db.ref("/posStaff").get()]);
    if (!staffSnap.exists()) throw new HttpsError("not-found", "POS staff profile was not found.");
    if (!accountSnap.exists() || !["staff", "cashier", "manager", "admin", "owner", "superadmin"].includes(portalRoleValue(accountSnap.val()))) throw new HttpsError("failed-precondition", "That Firebase account is not an authorised staff login.");
    Object.entries(allStaffSnap.val() || {}).forEach(([id, row]) => { if (id !== staffId && row && row.accountUid === accountUid) throw new HttpsError("already-exists", "That Firebase account is already linked to another staff profile."); });
    const now = Date.now(), secret = posPinSecret(pin), staff = staffSnap.val() || {};
    await db.ref().update({
      [`posStaff/${staffId}/accountUid`]: accountUid, ...posPinRowClears(staffId), [`posStaffSecrets/${staffId}`]: Object.assign({}, secret, {updatedAt: now, updatedBy: actor.uid}),
      [`posStaff/${staffId}/identityLinkedAt`]: now, [`posStaff/${staffId}/identityLinkedBy`]: actor.uid,
      [`operationalAudit/${now}_pos_staff_link_${staffId}`]: {action:"link_pos_staff_identity",sourceType:"posStaff",sourceId:staffId,staffName:staff.name||"",accountUid,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}
    });
    return {staffId, accountUid, linked: true};
  }
);

exports.openLinkedPosShift = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["pos", "registerOps"]), data = request.data || {};
    const rows = (await db.ref("/posStaff").get()).val() || {}, matches = Object.entries(rows).filter(([, row]) => row && row.accountUid === actor.uid);
    if (matches.length !== 1) throw new HttpsError("failed-precondition", "Your Firebase login is not linked to one active POS staff profile. Ask a manager to complete the link in POS Settings.");
    const [staffId, staff] = matches[0]; if (!posPinValid(data.pin, await posStaffPinRow(db, staffId, staff))) throw new HttpsError("permission-denied", "Your POS PIN is incorrect.");
    const counts = posOpenCountMap(data.openCount), openingFloat = Number(data.openingFloat);
    if (!Number.isFinite(openingFloat) || openingFloat < 0 || openingFloat > 1000000) throw new HttpsError("invalid-argument", "Opening cash count is invalid.");
    const settings=(/* download-ok: bounded one POS settings document is required to enforce the configured register float */await db.ref("/posSettings").get()).val()||{},fixed=settings.fixedFloat==null?null:Number(settings.fixedFloat),now = Date.now(), id = `SH-${now.toString().slice(-6)}-${crypto.randomBytes(3).toString("hex")}`, rec = {id,staff:posStaffText(staff.name,"Staff name",120),staffId,accountUid:actor.uid,openingFloat:Math.round(openingFloat*100)/100,openCount:counts,drawer:counts,openAt:now,status:"open",floatMode:fixed==null?"opening-count":"fixed",configuredFloat:fixed,openedByUid:actor.uid,schemaVersion:2};
    // Issue the durable reference when the shift opens, so a new shift is never stamped with
    // the historical -LEGACY- form that the on-demand backfill would otherwise assign it.
    rec.shiftReference = shiftReferenceFor(rec);
    let approval=null;if(fixed!=null&&Math.abs(openingFloat-fixed)>.009){approval=await claimManagerApproval(db,data,"fixed_float_exception","pending",Math.abs(openingFloat-fixed),`open_${id}`);rec.floatException={required:fixed,actual:rec.openingFloat,variance:Math.round((openingFloat-fixed)*100)/100,reason:posStaffText(data.reason,"Fixed-float exception reason",300),approvalId:approval.id,approvedBy:approval.record.approvedName||approval.record.approvedRole,approvedByUid:approval.record.approvedBy,approvedRole:approval.record.approvedRole,at:now};}
    const claim = await db.ref("/posActiveShift").transaction(current => { if (current && current.status !== "closed") return; return rec; }, undefined, false);
    if (!claim.committed) throw new HttpsError("failed-precondition", "Another shift is already open. It remains assigned to its original staff member.");
    const writes={[`shifts/${id}`]:rec,[`operationalAudit/${now}_pos_shift_open_${id}`]:{action:"open_linked_pos_shift",sourceType:"shift",sourceId:id,staffId,accountUid:actor.uid,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};if(approval)Object.assign(writes,approval.usedWrites);await db.ref().update(writes);
    return {shift:rec};
  }
);
