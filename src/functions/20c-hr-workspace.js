exports.manageHrWorkspace = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 20, memory: "256MiB"},
  async (request) => {
    if (request.auth?.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("unauthenticated", "An individual staff login is required.");
    }
    const db = getDatabase();
    let actor;
    try {
      actor = await requirePortalUser(db, request);
    } catch (error) {
      if (error.code === "permission-denied") {
        throw new HttpsError(error.code, error.message, {hrAccess: "inactive"});
      }
      throw error;
    }
    const {createHrWorkspace} = require("./lib/hr-workspace");
    const workspace = createHrWorkspace({
      firestore: getFirestore(),
      HttpsError,
      async findPortalAccount(email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new HttpsError("invalid-argument", "Enter a valid staff login email.");
        }
        let user;
        try {
          user = await getAdminAuth().getUserByEmail(email);
        } catch (error) {
          if (error.code !== "auth/user-not-found") throw error;
          throw new HttpsError("not-found", "No Accaza staff login has that email.");
        }
        const raw = (await db.ref("/admins").child(user.uid).get()).val();
        if (user.disabled || raw?.disabled === true || raw?.active === false || !PORTAL_ACCOUNT_ROLES.has(portalRoleValue(raw))) {
          throw new HttpsError("failed-precondition", "This login must have an active Accaza staff account.");
        }
        return user.uid;
      },
    });
    return workspace(actor, request.data);
  },
);
