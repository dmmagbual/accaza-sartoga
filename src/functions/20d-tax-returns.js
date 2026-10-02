// BIR quarterly tax returns — 2550Q (VAT) and 2551Q (percentage tax) — plus the
// annual accountant export (1701 sole proprietorship / 1702 OPC or corporation).
// Figures come only from stored financial-close summaries and purchase invoices:
// one ranged read on the close index, one small read per close, one indexed
// purchaseInvoices date query. No order re-reads and no new triggers.

const QUARTER_MONTHS = {1: ["01", "03"], 2: ["04", "06"], 3: ["07", "09"], 4: ["10", "12"]};
const QUARTER_END_DAY = {1: "31", 2: "30", 3: "30", 4: "31"};

function quarterRange(year, quarter) {
  return {
    periodStart: `${year}-${QUARTER_MONTHS[quarter][0]}-01`,
    periodEnd: `${year}-${QUARTER_MONTHS[quarter][1]}-${QUARTER_END_DAY[quarter]}`,
  };
}

// One close per business date: the daily close already covers every shift of
// that day, so summing it together with its shift closes would double count
// sales. Shift closes are only used for dates that have no daily close.
async function quarterCloseRows(db, periodStart, periodEnd) {
  const index = (await db.ref("/financialCloseIndex").orderByKey().startAt(periodStart).endAt(periodEnd).get()).val() || {};
  const selected = [];
  Object.keys(index).sort().forEach((date) => {
    const day = index[date] || {};
    let daily = null;
    const shifts = [];
    Object.keys(day).sort().forEach((id) => {
      const row = day[id] || {}, closeId = String(row.closeId || id);
      if (!closeId) return;
      if (row.closeType === "DAILY_CLOSE" || closeId.indexOf("daily_") === 0) daily = {closeId, status: String(row.status || "")};
      else shifts.push({closeId, status: String(row.status || "")});
    });
    (daily ? [daily] : shifts).forEach((row) => selected.push(row));
  });
  const seen = new Set();
  const unique = selected.filter((row) => (seen.has(row.closeId) ? false : (seen.add(row.closeId), true)));
  return Promise.all(unique.map(async (row) => {
    const current = (await db.ref(`/financialCloses/${row.closeId}/current`).get()).val() || {};
    const admin = current.admin || {};
    return {
      closeId: row.closeId,
      status: String(current.status || row.status || ""),
      grossSales: Number(admin.grossSales || 0),
      vatExemptSales: Number(admin.vatExemptSales || 0),
      outputVat: Number(admin.outputVat || 0),
      percentageTax: Number(admin.percentageTax || 0),
      netSales: Number(admin.netSales || 0),
      expectedCogs: Number(admin.expectedCogs || 0),
      discounts: Number(admin.discounts || 0),
      refunds: Number(admin.refunds || 0),
    };
  }));
}

async function quarterInputVat(db, periodStart, periodEnd) {
  const invoices = (await db.ref("/purchaseInvoices").orderByChild("date").startAt(periodStart).endAt(periodEnd).get()).val() || {};
  return Financial.money(Object.keys(invoices).reduce((sum, id) => {
    const row = invoices[id] || {};
    return sum + (row.reversed === true ? 0 : Number(row.inputVat || 0));
  }, 0));
}

// Gross-margin P&L from the same close summaries the tax figures come from — the
// accountant's 1701/1702 filing needs cost of sales and net sales, not only tax.
function quarterPnl(closes) {
  const rows = Array.isArray(closes) ? closes : [];
  const sum = (field) => Financial.money(rows.reduce((acc, row) => acc + Number(row[field] || 0), 0));
  return {netSales: sum("netSales"), discounts: sum("discounts"), refunds: sum("refunds"), expectedCogs: sum("expectedCogs")};
}

function returnFingerprint(record) {
  const core = record.mode === "annual"
    ? JSON.stringify(record.annual.quarters.map((q) => [q.quarter, q.figures, q.gate]))
    : JSON.stringify([record.returnType, record.periodStart, record.periodEnd, record.figures, record.closes]);
  return crypto.createHash("sha256").update(core).digest("hex");
}

exports.prepareQuarterlyTaxReturn = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(), actor = await requirePortalPermission(db, request, ["dailyreport", "pnl"]), data = request.data || {};
    const mode = data.mode === "annual" ? "annual" : "quarterly", today = financeDateFromTimestamp(Date.now());
    if (!/^\d{4}$/.test(String(data.year || ""))) throw new HttpsError("invalid-argument", "Year must use YYYY.");
    const year = Number(data.year);
    if (year < 2020 || year > Number(today.slice(0, 4))) throw new HttpsError("invalid-argument", "Year is outside the supported range.");
    let quarter = 0, periodStart = `${year}-01-01`, periodEnd = `${year}-12-31`;
    if (mode === "quarterly") {
      quarter = Number(data.quarter);
      if (![1, 2, 3, 4].includes(quarter)) throw new HttpsError("invalid-argument", "Quarter must be 1, 2, 3 or 4.");
      const range = quarterRange(year, quarter);
      periodStart = range.periodStart; periodEnd = range.periodEnd;
      if (today <= periodEnd) throw new HttpsError("failed-precondition", "That quarter has not ended yet. Prepare the return after the quarter closes.");
    }
    const returnId = mode === "annual" ? `annual_${year}` : `q${year}Q${quarter}`;
    const node = (await db.ref(`/taxReturns/${returnId}`).get()).val() || {}, existing = node.current || null;
    if (data.action === "get") return {returnId, current: existing, latestRevision: Number(node.latestRevision || 0)};

    const [taxSnap, companySnap] = await Promise.all([db.ref("/taxSettings").get(), db.ref("/companyInfo").get()]);
    const tax = taxSnap.val() || {}, company = companySnap.val() || {};
    const companyIdentity = {tin: tax.tin || company.tin || "", branchCode: tax.branchCode || company.branchCode || "00000", registeredName: company.registeredName || "", structure: company.structure || "sole"};
    const accounts = {outputVatPayable: "2210", percentageTaxPayable: "2220", inputVatCredit: "1250"};

    let record;
    if (mode === "quarterly") {
      if (tax.mode !== "vat" && tax.mode !== "percentage") throw new HttpsError("failed-precondition", "Activate VAT or percentage tax in Tax Compliance before preparing a quarterly return.");
      const closes = await quarterCloseRows(db, periodStart, periodEnd);
      const gate = Financial.quarterCloseGate(closes);
      if (!gate.ok) throw new HttpsError("failed-precondition", gate.reason === "NO_RECONCILED_CLOSES"
        ? "No reconciled Financial Close exists for this quarter. Run and reconcile the daily or shift close first."
        : "Every Financial Close in the quarter must be RECONCILED before the BIR return can be prepared. Outstanding: " + gate.blocked.join(", "));
      const figures = Financial.quarterlyTaxFigures(closes, await quarterInputVat(db, periodStart, periodEnd));
      record = {
        schemaVersion: 1, mode, returnType: tax.mode === "vat" ? "2550Q" : "2551Q",
        year, quarter, periodStart, periodEnd, status: "READY",
        amountDue: tax.mode === "vat" ? figures.vatPayable : figures.percentageTax,
        figures, pnl: quarterPnl(closes), accounts,
        tax: {mode: tax.mode, vatRate: tax.vatRate, percentageRate: tax.percentageRate, inclusive: tax.inclusive !== false},
        company: companyIdentity,
        closes: closes.map((row) => ({closeId: row.closeId, status: row.status})),
        preparedBy: actor.uid, preparedRole: actor.role, requestId: financeText(data.requestId, 80),
      };
    } else {
      const quarters = [];
      const pnlTotals = {netSales: 0, discounts: 0, refunds: 0, expectedCogs: 0};
      for (let q = 1; q <= 4; q++) {
        const range = quarterRange(year, q);
        const closes = await quarterCloseRows(db, range.periodStart, range.periodEnd);
        const pnl = quarterPnl(closes);
        Object.keys(pnlTotals).forEach((field) => {pnlTotals[field] = Financial.money(pnlTotals[field] + pnl[field]);});
        quarters.push({
          quarter: q, periodStart: range.periodStart, periodEnd: range.periodEnd,
          gate: Financial.quarterCloseGate(closes),
          figures: Financial.quarterlyTaxFigures(closes, await quarterInputVat(db, range.periodStart, range.periodEnd)),
          pnl,
        });
      }
      const sumOf = (field) => Financial.money(quarters.reduce((sum, q) => sum + Number(q.figures[field] || 0), 0));
      const totals = {grossSales: sumOf("grossSales"), vatExemptSales: sumOf("vatExemptSales"), outputVat: sumOf("outputVat"), percentageTax: sumOf("percentageTax"), inputVat: sumOf("inputVat"), pnl: pnlTotals};
      totals.vatPayable = Financial.money(Math.max(0, totals.outputVat - totals.inputVat));
      // Annual 1701/1702 support: the accountant files the return, so the export
      // reports every quarter with its own gate status instead of blocking.
      const annualForm = companyIdentity.structure === "opc" || companyIdentity.structure === "corporation" ? "1702" : "1701";
      record = {
        schemaVersion: 1, mode, returnType: `ANNUAL_${annualForm}`,
        year, periodStart, periodEnd, status: "READY",
        amountDue: totals.vatPayable,
        annual: {form: annualForm, quarters, totals},
        accounts,
        tax: {mode: tax.mode || "none", vatRate: tax.vatRate, percentageRate: tax.percentageRate, inclusive: tax.inclusive !== false},
        company: companyIdentity,
        preparedBy: actor.uid, preparedRole: actor.role, requestId: financeText(data.requestId, 80),
      };
    }

    record.fingerprint = returnFingerprint(record);
    if (existing && (existing.fingerprint === record.fingerprint || (record.requestId && existing.requestId === record.requestId))) {
      return Object.assign({returnId, duplicate: true}, existing);
    }
    const now = Date.now(), revision = Math.max(0, Math.floor(Number(node.latestRevision || 0))) + 1;
    record.preparedAt = now;
    const writes = {
      [`taxReturns/${returnId}/returnId`]: returnId,
      [`taxReturns/${returnId}/mode`]: mode,
      [`taxReturns/${returnId}/year`]: year,
      [`taxReturns/${returnId}/quarter`]: mode === "quarterly" ? quarter : null,
      [`taxReturns/${returnId}/latestRevision`]: revision,
      [`taxReturns/${returnId}/current`]: record,
      [`taxReturns/${returnId}/revisions/${revision}`]: record,
      [`operationalAudit/${now}_${returnId}_prepare_tax_return`]: operationalAuditRecord("prepare_tax_return", "taxReturn", returnId, actor, {mode, revision, returnType: record.returnType, fingerprint: record.fingerprint, amountDue: record.amountDue}),
    };
    await db.ref().update(writes);
    return Object.assign({returnId, revision, duplicate: false}, record);
  },
);
