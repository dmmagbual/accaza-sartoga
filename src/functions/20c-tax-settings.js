const TAX_MODES = ["none", "vat", "percentage"];
const TAX_STRUCTURES = ["sole", "opc", "corporation"];
// Server-side canonical BIR requirement checklist. The client renders its own labels for
// these ids; activation is refused unless every id is confirmed true, so a tampered
// client cannot activate a tax category by sending an empty or partial list.
// Shared items register the POS system itself (BIR Form 1905 / RR 7-2024): once a tax
// category is on, Accaza receipts become the official invoices, so system registration,
// on-demand reports and 10-year record retention apply under BOTH VAT and percentage tax.
const TAX_SHARED_REQUIREMENT_IDS = ["cas_1905_filed", "pos_reports_audit", "pos_data_retention"];
const TAX_REQUIREMENT_IDS = {
  vat: [...TAX_SHARED_REQUIREMENT_IDS, "cor_2303", "tin_branch", "books_registered", "vat_invoices", "sequential_numbering", "form_2550q"],
  percentage: [...TAX_SHARED_REQUIREMENT_IDS, "cor_2303", "tin_branch", "books_registered", "nonvat_invoices", "sequential_numbering", "form_2551q"]
};

function taxTin(value) {
  const digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (!/^\d{9}$/.test(digits)) throw new HttpsError("invalid-argument", "TIN must be 9 digits (example: 123-456-789).");
  return digits.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1-$2-$3");
}
function taxBranchCode(value) {
  const digits = String(value == null || value === "" ? "00000" : value).replace(/\D/g, "");
  if (!/^\d{5}$/.test(digits)) throw new HttpsError("invalid-argument", "Branch code must be 5 digits (use 00000 for the head office).");
  return digits;
}
function taxRate(value, fallback) {
  const rate = Number(value == null || value === "" ? fallback : value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new HttpsError("invalid-argument", "Tax rate must be between 0.01 and 100 percent.");
  return Math.round(rate * 100) / 100;
}
function taxRequirements(value) {
  const out = {};
  Object.entries(value || {}).forEach(([mode, ticks]) => {
    if (mode === "none" || !TAX_REQUIREMENT_IDS[mode]) return;
    const clean = {};
    Object.entries(ticks || {}).forEach(([id, flag]) => { if (TAX_REQUIREMENT_IDS[mode].includes(id) && flag === true) clean[id] = true; });
    if (Object.keys(clean).length) out[mode] = clean;
  });
  return out;
}

// Tax regime is owner-controlled and effective-dated: sales completed before effectiveAt keep
// their original treatment and are never recomputed. Only the owner (or superadmin) may change it.
exports.setTaxSettings = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalUser(db, request), data = request.data || {};
    if (!["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can change tax settings.");
    const current = (await db.ref("/taxSettings").get()).val() || {};
    // The registered identity (TIN, branch code, structure) has one home: /companyInfo.
    // A TIN saved in the old tax card before that tab existed still counts — seed the
    // company record from taxSettings once so the owner never retypes identity facts.
    let company = (await db.ref("/companyInfo").get()).val() || {};
    let companySeeded = false;
    if (!company.tin && current.tin) {
      company = Object.assign({}, company, {tin: current.tin, branchCode: company.branchCode || current.branchCode || "00000", structure: TAX_STRUCTURES.includes(company.structure) ? company.structure : (current.structure || "sole")});
      companySeeded = true;
    }
    const mode = TAX_MODES.includes(data.mode) ? data.mode : (current.mode || "none");
    const structure = TAX_STRUCTURES.includes(company.structure) ? company.structure : (current.structure || "sole");
    const requirements = Object.assign({}, current.requirements, taxRequirements(data.requirements));
    if (mode !== "none") {
      const missing = TAX_REQUIREMENT_IDS[mode].filter((id) => !(requirements[mode] || {})[id]);
      if (missing.length) throw new HttpsError("failed-precondition", "Complete first the BIR requirement before tax is activated.");
    }
    if (mode !== "none" && (!company.tin || !company.registeredName || !company.address))
      throw new HttpsError("invalid-argument", "Enter your BIR TIN and branch code before activating a tax category. Finish your registered business name, address and TIN in the Company Information tab (Settings → Company Information) first.");
    const tin = mode !== "none" ? taxTin(company.tin) : (current.tin || "");
    const branchCode = mode !== "none" ? taxBranchCode(company.branchCode) : (current.branchCode || "00000");
    const vatRate = taxRate(data.vatRate != null ? data.vatRate : (current.vatRate != null ? current.vatRate : 12), 12);
    const percentageRate = taxRate(data.percentageRate != null ? data.percentageRate : (current.percentageRate != null ? current.percentageRate : 3), 3);
    // Inclusive = listed prices already contain the tax (default, matches pre-flag sales).
    // Exclusive = tax is added on top at checkout, so customers pay more than the shelf price.
    const inclusive = data.inclusive != null ? data.inclusive === true : (current.inclusive !== false);
    const now = Date.now(), modeChanged = mode !== (current.mode || "none");
    let effectiveAt;
    if (data.effectiveAt != null) {
      effectiveAt = Number(data.effectiveAt);
      if (!Number.isFinite(effectiveAt) || effectiveAt < now - 86400000) throw new HttpsError("invalid-argument", "Effective date must be today or later so completed sales keep their original tax treatment.");
    } else if (modeChanged || current.effectiveAt == null) effectiveAt = now;
    else effectiveAt = Number(current.effectiveAt);
    const next = {mode, structure, vatRate, percentageRate, inclusive, effectiveAt, tin, branchCode, requirements, updatedAt: now, updatedBy: actor.uid, updatedByRole: actor.role, schemaVersion: 1};
    const updates = {
      taxSettings: next,
      // Public mirror for the customer app checkout: only whether tax is added on top.
      // TIN, checklist and structure stay admin-only in /taxSettings.
      publicTaxInfo: {mode, rate: mode === "vat" ? vatRate : mode === "percentage" ? percentageRate : 0, inclusive, effectiveAt},
      [`operationalAudit/${now}_set_tax_settings`]: {action: "set_tax_settings", sourceType: "taxSettings", sourceId: "tax", before: {mode: current.mode || "none", structure: current.structure || "sole", vatRate: current.vatRate, percentageRate: current.percentageRate, inclusive: current.inclusive !== false, effectiveAt: current.effectiveAt}, after: {mode, structure, vatRate, percentageRate, inclusive, effectiveAt, tin, branchCode}, actorUid: actor.uid, actorRole: actor.role, ts: now, schemaVersion: 1}
    };
    if (companySeeded) updates.companyInfo = Object.assign({}, company, {updatedAt: now, updatedBy: actor.uid, updatedByRole: actor.role});
    await db.ref().update(updates);
    return {tax: next};
  }
);
