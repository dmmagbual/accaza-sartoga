// Company Information: the single home for the registered business identity —
// registered name, trade name, address, TIN, branch code, business structure, RDO,
// Form 2303 and VAT registration dates. Owner-only and audited. setTaxSettings reads
// this record and stamps the identity into taxSettings at activation so receipts
// print it unchanged; nothing here is ever mirrored publicly.
exports.setCompanyInfo = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request), data = request.data || {};
    if (!["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can change company information.");
    const current = (await db.ref("/companyInfo").get()).val() || {};
    const text = (value, max) => String(value == null ? "" : value).trim().slice(0, max);
    const registeredName = text(data.registeredName, 160);
    if (!registeredName) throw new HttpsError("invalid-argument", "Registered business name is required.");
    const address = text(data.address, 300);
    if (!address) throw new HttpsError("invalid-argument", "Registered address is required.");
    const tinDigits = String(data.tin == null ? "" : data.tin).replace(/\D/g, "");
    if (!/^\d{9}$/.test(tinDigits)) throw new HttpsError("invalid-argument", "TIN must be 9 digits (example: 123-456-789).");
    const tin = tinDigits.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1-$2-$3");
    const branchCode = String(data.branchCode == null || data.branchCode === "" ? "00000" : data.branchCode).replace(/\D/g, "");
    if (!/^\d{5}$/.test(branchCode)) throw new HttpsError("invalid-argument", "Branch code must be 5 digits (use 00000 for the head office).");
    if (!TAX_STRUCTURES.includes(data.structure)) throw new HttpsError("invalid-argument", "Choose the business structure: sole proprietorship, OPC, or corporation.");
    const dateMs = (value, label) => {
      if (value == null || value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) throw new HttpsError("invalid-argument", `${label} is not a valid date.`);
      return n;
    };
    const now = Date.now();
    const next = {
      registeredName,
      tradeName: text(data.tradeName, 160),
      address,
      tin,
      branchCode,
      structure: data.structure,
      rdo: text(data.rdo, 60),
      cor2303IssuedAt: dateMs(data.cor2303IssuedAt, "Form 2303 date"),
      vatRegisteredAt: dateMs(data.vatRegisteredAt, "VAT registration date"),
      updatedAt: now, updatedBy: actor.uid, updatedByRole: actor.role, schemaVersion: 1
    };
    await db.ref().update({
      companyInfo: next,
      [`operationalAudit/${now}_set_company_info`]: {action: "set_company_info", sourceType: "companyInfo", sourceId: "company", before: {registeredName: current.registeredName || "", tin: current.tin || "", branchCode: current.branchCode || "", structure: current.structure || ""}, after: {registeredName, tin, branchCode, structure: data.structure}, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}
    });
    return {company: next};
  }
);
