
function posStaffText(value, label, max) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text.length > max) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return text;
}
function posPinHash(pin, salt) { return crypto.scryptSync(pin, salt, 32).toString("hex"); }
function posPinValid(pin, row) {
  const value = String(pin || "").trim();
  return /^[0-9]{4,6}$/.test(value) && row && row.pinSalt && row.pinHash && crypto.timingSafeEqual(Buffer.from(posPinHash(value, row.pinSalt), "hex"), Buffer.from(row.pinHash, "hex"));
}

// Owns the identity bridge between Firebase Authentication and the POS staff master.
// A staff member may never choose another profile or send a client-selected owner ID.
exports.managePosStaffIdentity = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request), data = request.data || {};
    if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) throw new HttpsError("permission-denied", "Only a manager can link a POS staff profile.");
    const staffId = posStaffText(data.staffId, "Staff profile", 160), accountUid = posStaffText(data.accountUid, "Firebase account UID", 160), pin = String(data.pin || "").trim();
    if (!/^[0-9]{4,6}$/.test(pin)) throw new HttpsError("invalid-argument", "PIN must be 4 to 6 digits.");
    const [staffSnap, accountSnap, allStaffSnap] = await Promise.all([db.ref(`/posStaff/${staffId}`).get(), db.ref(`/admins/${accountUid}`).get(), db.ref("/posStaff").get()]);
    if (!staffSnap.exists()) throw new HttpsError("not-found", "POS staff profile was not found.");
    if (!accountSnap.exists() || !["staff", "cashier", "manager", "admin", "owner", "superadmin"].includes(portalRoleValue(accountSnap.val()))) throw new HttpsError("failed-precondition", "That Firebase account is not an authorised staff login.");
    Object.entries(allStaffSnap.val() || {}).forEach(([id, row]) => { if (id !== staffId && row && row.accountUid === accountUid) throw new HttpsError("already-exists", "That Firebase account is already linked to another staff profile."); });
    const now = Date.now(), salt = crypto.randomBytes(16).toString("hex"), staff = staffSnap.val() || {};
    await db.ref().update({
      [`posStaff/${staffId}/accountUid`]: accountUid, [`posStaff/${staffId}/pinSalt`]: salt, [`posStaff/${staffId}/pinHash`]: posPinHash(pin, salt), [`posStaff/${staffId}/pin`]: null,
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
    const [staffId, staff] = matches[0]; if (!posPinValid(data.pin, staff)) throw new HttpsError("permission-denied", "Your POS PIN is incorrect.");
    const counts = data.openCount && typeof data.openCount === "object" ? data.openCount : {}, openingFloat = Number(data.openingFloat);
    if (!Number.isFinite(openingFloat) || openingFloat < 0 || openingFloat > 1000000) throw new HttpsError("invalid-argument", "Opening cash count is invalid.");
    const settings=(/* download-ok: bounded one POS settings document is required to enforce the configured register float */await db.ref("/posSettings").get()).val()||{},fixed=settings.fixedFloat==null?null:Number(settings.fixedFloat),now = Date.now(), id = `SH-${now.toString().slice(-6)}-${crypto.randomBytes(3).toString("hex")}`, rec = {id,staff:posStaffText(staff.name,"Staff name",120),staffId,accountUid:actor.uid,openingFloat:Math.round(openingFloat*100)/100,openCount:counts,drawer:counts,openAt:now,status:"open",floatMode:fixed==null?"opening-count":"fixed",configuredFloat:fixed,openedByUid:actor.uid,schemaVersion:2};
    let approval=null;if(fixed!=null&&Math.abs(openingFloat-fixed)>.009){approval=await claimManagerApproval(db,data,"fixed_float_exception","pending",Math.abs(openingFloat-fixed),`open_${id}`);rec.floatException={required:fixed,actual:rec.openingFloat,variance:Math.round((openingFloat-fixed)*100)/100,reason:posStaffText(data.reason,"Fixed-float exception reason",300),approvalId:approval.id,approvedBy:approval.record.approvedName||approval.record.approvedRole,approvedByUid:approval.record.approvedBy,approvedRole:approval.record.approvedRole,at:now};}
    const claim = await db.ref("/posActiveShift").transaction(current => { if (current && current.status !== "closed") return; return rec; }, undefined, false);
    if (!claim.committed) throw new HttpsError("failed-precondition", "Another shift is already open. It remains assigned to its original staff member.");
    const writes={[`shifts/${id}`]:rec,[`operationalAudit/${now}_pos_shift_open_${id}`]:{action:"open_linked_pos_shift",sourceType:"shift",sourceId:id,staffId,accountUid:actor.uid,actorUid:actor.uid,actorRole:actor.role,ts:now,schemaVersion:1}};if(approval)Object.assign(writes,approval.usedWrites);await db.ref().update(writes);
    return {shift:rec};
  }
);
