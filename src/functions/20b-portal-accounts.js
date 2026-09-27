const PORTAL_ACCOUNT_ROLES = new Set(["superadmin", "admin", "manager", "staff", "cashier", "kitchen", "finance"]);
// Staff-level module access, one key per Admin nav tab a staff account can be granted.
// Settings is locked for staff-level roles except Channel Pricing (grantable) and Change
// Password (always available), so the other Settings keys (dedupe, possettings) are not grantable.
const PORTAL_PERMISSION_KEYS = ["dashboard", "liveoperations", "orders", "reservations", "pos", "inventory", "purchases", "recipes", "usage", "registerOps", "reviews", "appcustomers", "availability", "comments", "analytics", "saleshistory", "dailyreport", "discrepancy", "petty", "undeposited", "channelpricing", "cashflow", "stockvalue"];
// Tabs that were visible to every staff account before they had their own key. A stored
// record without the key keeps its old behaviour until a Super Admin saves the account.
const PORTAL_PERMISSION_LEGACY = {dashboard: true, saleshistory: ["orders"], undeposited: ["petty", "cashflow"]};

function canonicalPortalAccountRole(raw) {
  const role = portalRoleValue(raw);
  return role === "owner" ? "superadmin" : role;
}

function portalAccountText(value, limit, label) {
  const text = financeText(value, limit).trim();
  if (!text) throw new HttpsError("invalid-argument", `${label} is required.`);
  return text;
}

function portalAccountPermissions(value, legacy) {
  const source = value && typeof value === "object" ? value : {};
  return PORTAL_PERMISSION_KEYS.reduce((result, key) => {
    const inherited = legacy && source[key] === undefined && PORTAL_PERMISSION_LEGACY[key];
    result[key] = inherited ? (inherited === true || inherited.some((from) => source[from] === true)) : source[key] === true;
    return result;
  }, {});
}

async function requireSuperAdmin(db, request) {
  const actor = await requirePortalUser(db, request);
  if (canonicalPortalAccountRole(actor.role) !== "superadmin") throw new HttpsError("permission-denied", "Only a Super Admin can manage portal accounts.");
  return actor;
}

async function claimPortalAccountMutation(db, actor, action) {
  const lockRef = db.ref("/portalAccountMutationLock"), now = Date.now(), token = crypto.randomBytes(16).toString("hex");
  const claim = await lockRef.transaction((current) => {
    if (current && Number(current.expiresAt) > now) return;
    return {token, action, actorUid: actor.uid, claimedAt: now, expiresAt: now + 60 * 1000};
  }, undefined, false);
  if (!claim.committed) throw new HttpsError("aborted", "Another account change is in progress. Refresh and try again.");
  return async () => {
    try { await lockRef.transaction((current) => current && current.token === token ? null : current, undefined, false); }
    catch (error) { logger.warn("Portal account mutation lock cleanup failed", {token, error: String(error)}); }
  };
}

function portalAccountRecord(raw, fallback) {
  const source = raw && typeof raw === "object" ? raw : {};
  const role = canonicalPortalAccountRole(raw);
  return {
    role,
    name: financeText(source.name || source.displayName || fallback && fallback.displayName, 120),
    title: financeText(source.title || (role === "superadmin" ? "Systems Administrator" : ""), 120),
    email: financeText(source.email || fallback && fallback.email, 320).toLowerCase(),
    active: role !== "disabled" && source.disabled !== true,
    previousRole: financeText(source.previousRole, 30).toLowerCase(),
    createdAt: Number(source.createdAt) || 0,
    createdBy: financeText(source.createdBy, 128),
    updatedAt: Number(source.updatedAt) || 0,
    updatedBy: financeText(source.updatedBy, 128),
    disabledAt: Number(source.disabledAt) || 0,
    disabledBy: financeText(source.disabledBy, 128),
  };
}

async function activeSuperAdminCount(db, excludingUid) {
  const rows = (await db.ref("/admins").get()).val() || {};
  return Object.entries(rows).filter(([uid, raw]) => uid !== excludingUid && canonicalPortalAccountRole(raw) === "superadmin" && !(raw && typeof raw === "object" && raw.disabled === true)).length;
}

async function assertAccountNotOnOpenShift(db, uid) {
  const shift = (await db.ref("/posActiveShift").get()).val();
  if (!shift || shift.status === "closed") return;
  const crew = shift.crew && shift.crew[uid];
  if (shift.accountUid === uid || (crew && !crew.leftAt)) throw new HttpsError("failed-precondition", "This account belongs to the open POS shift. Close the shift or remove the person from its crew before disabling access.");
}

async function portalAccountList(db) {
  const [adminsSnap, permsSnap, staffSnap, shiftSnap] = await Promise.all([
    /* download-ok: bounded portal account list, loaded only in Super Admin account management */ db.ref("/admins").get(),
    /* download-ok: bounded portal permission list paired with the account list */ db.ref("/adminPerms").get(),
    /* download-ok: bounded POS staff master needed to show login linkage */ db.ref("/posStaff").get(),
    db.ref("/posActiveShift").get(),
  ]);
  const admins = adminsSnap.val() || {}, permissions = permsSnap.val() || {}, staff = staffSnap.val() || {}, shift = shiftSnap.val() || null;
  const auth = getAdminAuth();
  const accounts = await Promise.all(Object.entries(admins).map(async ([uid, raw]) => {
    let user = null;
    try { user = await auth.getUser(uid); } catch (error) { if (String(error && error.code || "") !== "auth/user-not-found") throw error; }
    const record = portalAccountRecord(raw, user || {}), linked = Object.entries(staff).find(([, row]) => row && row.accountUid === uid), crew = shift && shift.crew && shift.crew[uid];
    return {
      uid,
      name: record.name || (permissions[uid] && financeText(permissions[uid].name, 120)) || record.email || uid,
      title: record.title,
      email: record.email,
      role: record.role,
      active: record.active && !(user && user.disabled),
      authExists: !!user,
      emailVerified: !!(user && user.emailVerified),
      lastSignInAt: user && user.metadata && user.metadata.lastSignInTime || "",
      permissions: portalAccountPermissions(permissions[uid], true),
      linkedStaffId: linked ? linked[0] : "",
      linkedStaffName: linked ? financeText(linked[1].name, 120) : "",
      onOpenShift: !!(shift && shift.status !== "closed" && (shift.accountUid === uid || (crew && !crew.leftAt))),
      legacyRole: raw === true || String(raw || "").toLowerCase() === "owner" || (raw && typeof raw === "object" && String(raw.role || "").toLowerCase() === "owner"),
    };
  }));
  accounts.sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
  return {accounts, openShift: shift && shift.status !== "closed" ? {id: financeText(shift.id, 120), staff: financeText(shift.staff, 120)} : null};
}

exports.managePortalAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requireSuperAdmin(db, request), data = request.data || {}, action = financeText(data.action, 30).toLowerCase(), now = Date.now();
    if (action === "list") return portalAccountList(db);
    const releaseMutation = await claimPortalAccountMutation(db, actor, action);
    try {
    if (action === "create") {
      const email = portalAccountText(data.email, 320, "Email").toLowerCase(), name = portalAccountText(data.name, 120, "Name"), role = financeText(data.role, 30).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid email address.");
      if (!PORTAL_ACCOUNT_ROLES.has(role)) throw new HttpsError("invalid-argument", "Select a valid access level.");
      const title = financeText(data.title || (role === "superadmin" ? "Systems Administrator" : ""), 120), auth = getAdminAuth();
      let user, created = false;
      try { user = await auth.getUserByEmail(email); } catch (error) {
        if (String(error && error.code || "") !== "auth/user-not-found") throw error;
        user = await auth.createUser({email, displayName: name, disabled: false}); created = true;
      }
      const record = {role, name, title, email, active: true, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, schemaVersion: 2};
      const accountRef = db.ref(`/admins/${user.uid}`), accessClaim = await accountRef.transaction((current) => current ? undefined : record, undefined, false);
      if (!accessClaim.committed) { if (created) { try { await auth.deleteUser(user.uid); } catch (_rollbackError) {} } throw new HttpsError("already-exists", "That Firebase account already has Accaza access."); }
      try {
        if (!created) await auth.updateUser(user.uid, {displayName: name, disabled: false});
        await db.ref().update({[`adminPerms/${user.uid}`]: Object.assign({name}, portalAccountPermissions(data.permissions)), [`operationalAudit/${now}_portal_account_create_${user.uid}`]: operationalAuditRecord("portal_account_created", "portalAccount", user.uid, actor, {email, name, title, role})});
      } catch (error) { await accountRef.remove(); if (created) { try { await auth.deleteUser(user.uid); } catch (_rollbackError) {} } else { try { await auth.updateUser(user.uid, {displayName: user.displayName || null, disabled: user.disabled === true}); } catch (_rollbackError) {} } throw error; }
      return {uid: user.uid, email, created, sendPasswordSetup: true};
    }
    if (action === "update") {
      const uid = financeKey(data.uid, "Account"), currentRaw = (await db.ref(`/admins/${uid}`).get()).val();
      if (!currentRaw) throw new HttpsError("not-found", "Portal account not found.");
      const current = portalAccountRecord(currentRaw), role = financeText(data.role, 30).toLowerCase(), name = portalAccountText(data.name, 120, "Name");
      if (!PORTAL_ACCOUNT_ROLES.has(role)) throw new HttpsError("invalid-argument", "Select a valid access level.");
      if (current.role === "superadmin" && role !== "superadmin" && await activeSuperAdminCount(db, uid) < 1) throw new HttpsError("failed-precondition", "Accaza must keep at least one active Super Admin.");
      if (uid === actor.uid && role !== "superadmin") throw new HttpsError("failed-precondition", "You cannot remove your own Super Admin access. Another Super Admin must change it.");
      const title = financeText(data.title || (role === "superadmin" ? "Systems Administrator" : ""), 120), email = current.email;
      await getAdminAuth().updateUser(uid, {displayName: name});
      await db.ref().update({
        [`admins/${uid}`]: Object.assign({}, currentRaw && typeof currentRaw === "object" ? currentRaw : {}, {role, name, title, email, active: true, disabled: null, previousRole: null, updatedAt: now, updatedBy: actor.uid, schemaVersion: 2}),
        [`adminPerms/${uid}`]: Object.assign({name}, portalAccountPermissions(data.permissions)),
        [`operationalAudit/${now}_portal_account_update_${uid}`]: operationalAuditRecord("portal_account_updated", "portalAccount", uid, actor, {name, title, previousRole: current.role, role}),
      });
      return {uid, updated: true};
    }
    if (action === "disable") {
      const uid = financeKey(data.uid, "Account");
      if (uid === actor.uid) throw new HttpsError("failed-precondition", "You cannot disable the account you are currently using.");
      const ref = db.ref(`/admins/${uid}`), raw = (await ref.get()).val(), current = portalAccountRecord(raw);
      if (!raw) throw new HttpsError("not-found", "Portal account not found.");
      if (current.role === "superadmin" && await activeSuperAdminCount(db, uid) < 1) throw new HttpsError("failed-precondition", "Accaza must keep at least one active Super Admin.");
      await assertAccountNotOnOpenShift(db, uid);
      const disabled = Object.assign({}, raw && typeof raw === "object" ? raw : {}, {role: "disabled", previousRole: current.role, active: false, disabled: true, disabledAt: now, disabledBy: actor.uid, updatedAt: now, updatedBy: actor.uid, schemaVersion: 2});
      const auditPath = `operationalAudit/${now}_portal_account_disable_${uid}`;
      await db.ref().update({[`admins/${uid}`]: disabled, [auditPath]: operationalAuditRecord("portal_account_disabled", "portalAccount", uid, actor, {previousRole: current.role, reason: financeText(data.reason, 300)})});
      try { await getAdminAuth().updateUser(uid, {disabled: true}); } catch (error) { await db.ref().update({[`admins/${uid}`]: raw, [auditPath]: null}); throw new HttpsError("internal", "Firebase Authentication could not disable the account. The Accaza access record was restored."); }
      try { await getAdminAuth().revokeRefreshTokens(uid); } catch (error) { logger.warn("Portal account disabled but token revocation should be retried", {uid, error: String(error)}); }
      return {uid, disabled: true};
    }
    if (action === "reactivate") {
      const uid = financeKey(data.uid, "Account"), ref = db.ref(`/admins/${uid}`), raw = (await ref.get()).val(), current = portalAccountRecord(raw);
      if (!raw || current.role !== "disabled") throw new HttpsError("failed-precondition", "This account is not disabled.");
      const role = PORTAL_ACCOUNT_ROLES.has(current.previousRole) ? current.previousRole : "staff";
      await getAdminAuth().updateUser(uid, {disabled: false});
      try { await db.ref().update({[`admins/${uid}`]: Object.assign({}, raw, {role, previousRole: null, active: true, disabled: null, disabledAt: null, disabledBy: null, updatedAt: now, updatedBy: actor.uid}), [`operationalAudit/${now}_portal_account_reactivate_${uid}`]: operationalAuditRecord("portal_account_reactivated", "portalAccount", uid, actor, {role})}); } catch (error) { try { await getAdminAuth().updateUser(uid, {disabled: true}); } catch (_rollbackError) {} throw error; }
      return {uid, role, reactivated: true};
    }
    if (action === "normalize_legacy") {
      const shift = (await db.ref("/posActiveShift").get()).val();
      if (shift && shift.status !== "closed") throw new HttpsError("failed-precondition", "Close the active POS shift before normalizing legacy account roles.");
      const admins = (await db.ref("/admins").get()).val() || {}, writes = {}; let changed = 0;
      for (const [uid, raw] of Object.entries(admins)) {
        const legacy = raw === true || String(raw || "").toLowerCase() === "owner" || (raw && typeof raw === "object" && String(raw.role || "").toLowerCase() === "owner");
        if (!legacy) continue;
        let user = null; try { user = await getAdminAuth().getUser(uid); } catch (_error) {}
        const old = raw && typeof raw === "object" ? raw : {};
        writes[`admins/${uid}`] = Object.assign({}, old, {role: "superadmin", name: financeText(old.name || user && user.displayName || user && user.email, 120), title: financeText(old.title || "Systems Administrator", 120), email: financeText(old.email || user && user.email, 320).toLowerCase(), active: true, updatedAt: now, updatedBy: actor.uid, schemaVersion: 2}); changed++;
      }
      if (changed) { writes[`operationalAudit/${now}_portal_account_normalize`] = operationalAuditRecord("portal_account_roles_normalized", "portalAccount", "legacy_owner", actor, {changed, replacementRole: "superadmin"}); await db.ref().update(writes); }
      return {changed};
    }
      throw new HttpsError("invalid-argument", "Account action is invalid.");
    } finally {
      await releaseMutation();
    }
  },
);
