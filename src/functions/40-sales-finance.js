
// Release 3B recipe normalization, unit conversion, usage, and COGS all come
// from the shared pure engine mirrored from assets/js/shared/costing.js.

exports.validateRecipeDefinition = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["recipes"]);
    const inventory = (await db.ref("/inventory").get()).val() || {};
    const result = Costing.normalizeRecipe(request.data && request.data.recipe, inventory);
    if (!result.ok) throw new HttpsError("invalid-argument", "Recipe is invalid: " + result.errors.slice(0, 5).map((x) => x.message).join(" | "), {errors: result.errors});
    logger.info("Recipe definition validated", {uid: actor.uid, engineVersion: Costing.VERSION, warnings: result.warnings.length});
    return {recipe: result.recipe, engineVersion: Costing.VERSION, warnings: result.warnings};
  },
);

// ---------------------------------------------------------------------------
// Release 3C: immutable, idempotent financial movements and server projections.
// ---------------------------------------------------------------------------
function financeKey(value, label = "ID") {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(key)) throw new HttpsError("invalid-argument", `${label} is invalid.`);
  return key;
}
function financeText(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }
function financeDate(value, allowFuture) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "Date must use YYYY-MM-DD.");
  if (allowFuture !== true) {
    const maxDate = financeDateFromTimestamp((Date.parse(`${financeDateFromTimestamp(Date.now())}T00:00:00+08:00`) || Date.now()) + 86400000);
    if (date > maxDate) throw new HttpsError("invalid-argument", `That date (${date}) is in the future. Postings can\u2019t be future-dated \u2014 use today\u2019s date or the date it actually happened.`);
  }
  return date;
}
function financeDateFromTimestamp(value) {const parts = new Intl.DateTimeFormat("en-US", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(Number(value) || Date.now())); const map = {}; parts.forEach((part) => {map[part.type] = part.value;}); return `${map.year}-${map.month}-${map.day}`;}
async function assertAccountingPeriodOpen(db, effectiveDate, postingLabel) {
  let period;
  try { period = AccountingPeriods.periodForDate(effectiveDate); } catch (error) { throw new HttpsError("invalid-argument", error.message); }
  const record = (await db.ref(`/accountingPeriods/${period}`).get()).val();
  if (AccountingPeriods.isClosed(record)) throw new HttpsError("failed-precondition", `${period} is closed. Reopen it in Admin Settings before ${postingLabel || "posting or changing this financial record"}. Existing history remains unchanged.`);
  return period;
}
const DEFAULT_CHART_ACCOUNTS = {
  sales_revenue:{code:"4000", name:"Sales revenue", type:"revenue", active:true, system:true}, platform_commission:{code:"5100", name:"Platform commission", type:"expense", active:true, system:true}, purchases:{code:"5200", name:"Purchases / inventory", type:"expense", active:true, system:true}, rent:{code:"5300", name:"Rent", type:"expense", active:true, system:true}, utilities:{code:"5310", name:"Utilities", type:"expense", active:true, system:true}, salaries:{code:"5320", name:"Salaries", type:"expense", active:true, system:true}, bank_charges:{code:"5330", name:"Bank charges", type:"expense", active:true, system:true}, supplies:{code:"5340", name:"Supplies", type:"expense", active:true, system:true}, owner_draw:{code:"3100", name:"Owner draw", type:"equity", active:true, system:true}, capital_in:{code:"3000", name:"Owner capital", type:"equity", active:true, system:true}, other_income:{code:"4900", name:"Other income", type:"revenue", active:true, system:true}, other_expense:{code:"5900", name:"Other expense", type:"expense", active:true, system:true}
};
async function ensureChartAccounts(db) {const snap = await db.ref("/chartOfAccounts").get(), current = snap.val() || {}, writes = {}; Object.keys(DEFAULT_CHART_ACCOUNTS).forEach((id) => {if (!current[id]) writes[`chartOfAccounts/${id}`] = Object.assign({}, DEFAULT_CHART_ACCOUNTS[id], {createdAt: Date.now(), schemaVersion: 1});}); if (Object.keys(writes).length) await db.ref().update(writes); return Object.assign({}, DEFAULT_CHART_ACCOUNTS, current);}
function chartAccountFor(chart, id) {const key = financeKey(id, "Accounting category"), row = chart[key]; if (!row || row.active === false) throw new HttpsError("failed-precondition", "The selected accounting category is inactive or missing."); return {id:key, row};}
function chartAccountFromLegacy(chart, category, dir) {const text=financeText(category,80).toLowerCase(), map={"purchases":"purchases","supplier payment":"purchases","rent":"rent","utilities":"utilities","salaries":"salaries","bank charges":"bank_charges","owner draw":"owner_draw","capital in":"capital_in","sales deposit":"sales_revenue","platform payout":"sales_revenue"}, id=map[text]||(dir==="out"?"other_expense":"other_income");return chartAccountFor(chart,id);}
function financeRecord(id, movement, actor) {
  const now = Date.now();
  return Object.assign({}, movement, {id, schemaVersion: 1, occurredAt: Number(movement.occurredAt || now), postedAt: now, actorUid: actor.uid, actorRole: actor.role, actorName: financeText(movement.actorName || actor.role, 100)});
}
function cashLedgerRecord(entry, movementId, movement, actor) {
  return {date: entry.date, accountId: entry.accountId, dir: entry.dir, category: entry.category, amount: Financial.money(entry.amount), party: financeText(entry.party || "", 120), ref: financeText(entry.ref || movement.sourceId || "", 120), source: movement.sourceType, linkId: movement.sourceId, movementId, method: financeText(entry.method || "", 60), auto: entry.auto === true, immutable: true, ts: Number(movement.occurredAt || Date.now()), by: actor.role};
}
function accountingTimestamp(date, fallback) {
  const value = financeDate(date);
  return Date.parse(`${value}T12:00:00+08:00`) || Number(fallback) || Date.now();
}
// ---------------------------------------------------------------------------
// Server-authoritative Books chart of accounts (replaces the hardcoded whitelist).
// ---------------------------------------------------------------------------
const BOOKS_TYPES = ["Asset","Liability","Equity","Income","COGS","Expense"];
const SENSITIVE_BOOKS_CODES = new Set("1000 1005 1010 1011 1012 1013 1014 1020 1021 1030 1040 1100 1110 1200 1210 1220 1230 1240 1260 1270 1280 1290 1900 2000 2020 2050 2090 3000 3100 3900 4000 4010 4020 4030 4900 4910".split(" "));
const BOOKS_CHART_SEED_ROWS = [
  ["1000","Cash on Hand","Asset"],["1005","Register Cash Float","Asset","Fixed imprest tied to POS Settings"],["1010","Other Bank Accounts","Asset"],["1011","Union Bank","Asset"],["1012","BDO","Asset"],["1013","Security Bank - 4538","Asset"],["1014","Security Bank - 4389","Asset"],["1020","GCash / Maya Wallet","Asset"],["1021","FoodPanda GCash Wallet","Asset","Dedicated FoodPanda payout destination"],["1030","Undeposited Collection","Asset","Cash awaiting bank deposit"],["1040","Revolving Fund","Asset"],["1050","Platform Payouts in Transit","Asset","Settled platform payouts awaiting bank deposit"],["1100","Accounts Receivable - Platforms","Asset","Grab/Panda settlements owed to us"],["1110","Other Receivables","Asset"],["1190","Cash Shortage Under Review","Asset","Pending manager reconciliation"],["1200","Inventory - Coffee & Beans","Asset"],["1210","Inventory - Milk & Dairy","Asset"],["1220","Inventory - Syrups & Flavors","Asset"],["1230","Inventory - Cups & Packaging","Asset"],["1240","Inventory - Food & Pastries","Asset"],["1250","Input VAT (creditable)","Asset","Used when VAT-registered"],["1260","Creditable Withholding Tax","Asset","CWT withheld by platforms/customers"],["1270","Inventory - Operating & Cleaning Supplies","Asset"],["1280","Inventory - Office Supplies","Asset"],["1290","Inventory Receiving Clearing","Asset","Received inventory awaiting complete posting"],["1500","Equipment","Asset","Espresso machine, grinders"],["1510","Furniture & Fixtures","Asset"],["1590","Accumulated Depreciation","Asset","Contra-asset (credit balance)"],["1900","Suspense","Asset","Unmapped POS accounts land here for review"],
  ["2000","Accounts Payable - Suppliers","Liability"],["2020","Due to Platforms","Liability","Negative Grab/FoodPanda settlements owed to the platform"],["2030","Customer Change / Refund Payable","Liability","Customer-related cash overages awaiting refund"],["2050","Due to Owner / Partners","Liability","Personally funded business costs awaiting reimbursement"],["2090","Unrecorded Payables Clearing","Liability","Supplier obligations awaiting complete posting"],["2100","Cash Overage Under Review","Liability","Pending manager reconciliation"],["2120","Accrued Salaries","Liability"],["2200","Taxes Payable","Liability"],["2210","Output VAT Payable","Liability","Used when VAT-registered"],["2220","Percentage Tax Payable","Liability","Non-VAT percentage tax on gross receipts"],["2230","Withholding Tax Payable","Liability","EWT withheld from payments"],["2300","Loans Payable","Liability"],["2310","Loan 2","Liability"],["2320","Loan 3","Liability"],
  ["3000","Owner's Capital","Equity"],["3050","Cash Float Clearing","Equity","POS shift float source"],["3100","Owner's Drawings","Equity","Contra-equity (debit balance)"],["3900","Retained Earnings","Equity"],
  ["4000","Sales - In-store","Income"],["4010","Sales - Online (own)","Income"],["4020","Sales - GrabFood","Income"],["4030","Sales - FoodPanda","Income"],["4900","Discounts & Comps","Income","Contra-income (debit balance)"],["4910","Sales Returns & Refunds","Income","Existing void and refund adjustments"],["4990","Other Income","Income"],
  ["5000","COGS - Coffee & Beans","COGS"],["5010","COGS - Milk & Dairy","COGS"],["5020","COGS - Syrups & Flavors","COGS"],["5030","COGS - Food & Pastries","COGS"],["5040","COGS - Cups & Packaging","COGS"],["5090","Unposted COGS Clearing","COGS","Costs awaiting complete item-level posting"],["5900","Wastage & Spoilage","COGS","Physical spoilage, expiry, spillage, or discard only"],["5905","Inventory Reconciliation Gain / (Loss)","COGS","Count or valuation variance only: debit is loss, credit is gain"],
  ["6000","Salaries & Wages","Expense"],["6010","Rent","Expense"],["6020","Utilities","Expense","Electricity, water"],["6030","Internet & Phone","Expense"],["6040","Platform Commissions","Expense","Grab/Panda fees"],["6045","Platform Discounts","Expense","Grab/Panda-funded or shared discounts"],["6046","Platform Service VAT","Expense"],["6050","Marketing & Promotions","Expense"],["6060","Repairs & Maintenance","Expense"],["6070","Cleaning & Operating Supplies","Expense"],["6075","Office & Administrative Supplies","Expense"],["6076","Transportation & Delivery","Expense"],["6077","Staff Consumption & Welfare","Expense","Inventory consumed by staff; never sales COGS or inventory variance"],["6078","Product R&D & Testing","Expense","Inventory consumed for product development, testing, training, or sampling"],["6080","Bank & Payment Fees","Expense"],["6085","Platform Penalties & Adjustments","Expense"],["6090","Depreciation","Expense"],["6100","Miscellaneous","Expense"],["6110","Cash Short / Over","Expense","Register variance"]
];
function booksChartSeed(){const out={};BOOKS_CHART_SEED_ROWS.forEach(function(r){out[r[0]]={code:r[0],name:r[1],type:r[2],note:r[3]||"",active:true,system:true,sensitive:SENSITIVE_BOOKS_CODES.has(r[0])};});return out;}
async function ensureBooksChart(db) {
  const seed = booksChartSeed();
  const snap = await db.ref("/booksChart").get();
  const current = snap.val() || {}, writes = {}, resolved = Object.assign({}, current), now = Date.now();
  // A Firebase multi-location update cannot contain both /booksChart/CODE and
  // /booksChart/CODE/field. Missing or malformed accounts therefore use one
  // complete-record write; only existing object records receive child updates.
  Object.keys(seed).forEach(function(code) {
    const existing = current[code];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      resolved[code] = Object.assign({}, seed[code], {createdAt: now, schemaVersion: 1});
      writes[`booksChart/${code}`] = resolved[code];
    } else {
      resolved[code] = existing;
    }
  });
  ["2100", "5900", "5905", "6077", "6078"].forEach(function(code) {
    const canonical = seed[code], existing = current[code];
    if (!canonical || !existing || typeof existing !== "object" || Array.isArray(existing)) return;
    resolved[code] = Object.assign({}, existing, canonical);
    Object.keys(canonical).forEach(function(key) {
      if (existing[key] !== canonical[key]) writes[`booksChart/${code}/${key}`] = canonical[key];
    });
  });
  if (current["4995"]) {
    const retired = {active: false, system: true, note: "Retired legacy inventory reconciliation gain account; consolidated into 5905", consolidatedInto: "5905"};
    resolved["4995"] = Object.assign({}, current["4995"], retired);
    Object.keys(retired).forEach(function(key) {
      if (current["4995"][key] !== retired[key]) writes[`booksChart/4995/${key}`] = retired[key];
    });
  }
  if (Object.keys(writes).length) await db.ref().update(writes);
  return Object.assign({}, seed, resolved);
}
const DEFAULT_BOOKS_CHART_MANAGERS=["danilomagbual@gmail.com","contact.mariadaniela@gmail.com"];
function booksManagerKey(email){return String(email||"").toLowerCase().replace(/[^a-z0-9]+/g,"_");}
async function ensureBooksChartManagers(db){const ref=db.ref("/config/booksChartManagers");const snap=await ref.get();let current=snap.val();if(!current||typeof current!=="object"||!Object.keys(current).length){const seed={};DEFAULT_BOOKS_CHART_MANAGERS.forEach(function(email){seed[booksManagerKey(email)]={email:String(email).toLowerCase(),active:true,seededAt:Date.now()};});await ref.set(seed);current=seed;}const allow=new Set();Object.keys(current).forEach(function(k){const row=current[k];if(row&&row.active!==false&&row.email)allow.add(String(row.email).toLowerCase());});return allow;}
async function requireBooksChartManager(db,request){const portal=await requirePortalUser(db,request);const email=String(request.auth&&request.auth.token&&request.auth.token.email||"").toLowerCase();const allow=await ensureBooksChartManagers(db);if(!email||!allow.has(email))throw new HttpsError("permission-denied","Only the finance owners can manage the chart of accounts.");return Object.assign({},portal,{email:email});}
function booksCodeAccount(code, accounts, booksChart) {
  code = financeText(code, 4);
  if (!/^\d{4}$/.test(code)) throw new HttpsError("invalid-argument", "Every journal line requires a valid four-digit account code.");
  const chartRow = booksChart && booksChart[code];
  if (chartRow) {
    if (chartRow.active === false) throw new HttpsError("failed-precondition", `Books account ${code} is inactive. Reactivate it in the chart of accounts before posting.`);
  } else {
    const allowed = new Set("1000 1005 1010 1011 1012 1013 1014 1020 1021 1030 1040 1100 1110 1200 1210 1220 1230 1240 1250 1260 1270 1280 1290 1500 1510 1590 1900 2000 2020 2030 2050 2090 2100 2120 2200 2210 2220 2230 2300 2310 2320 3000 3050 3100 3900 4000 4010 4020 4030 4900 4910 4990 4995 5000 5010 5020 5030 5040 5090 5900 5905 6000 6010 6020 6030 6040 6045 6046 6050 6060 6070 6075 6076 6077 6078 6080 6085 6090 6100 6110".split(" "));
    if (!allowed.has(code)) throw new HttpsError("failed-precondition", `Books account ${code} is not in the approved chart of accounts.`);
  }
  if (code === "1000") return {account:"asset:register_cash", cashKey:"register"};
  if (code === "1005") return {account:"asset:register_float", cashKey:"float"};
  if (code === "1030") return {account:"asset:cash_awaiting_deposit", cashKey:"undeposited"};
  if (code === "1040") return {account:"asset:petty_cash", cashKey:"petty"};
  const matches = Object.keys(accounts || {}).filter((id) => BooksBridge.cashCodeForAccount(accounts[id]) === code);
  if (matches.length > 1) throw new HttpsError("failed-precondition", `Cash account code ${code} is assigned to more than one cash account.`);
  if (matches.length === 1) return {account:`asset:cash_account:${matches[0]}`, cashKey:matches[0]};
  if (/^(1010|1011|1012|1013|1014|1020|1021)$/.test(code)) throw new HttpsError("failed-precondition", `Cash account code ${code} is not linked to a live cash account.`);
  return {account:`coa:${code}`, cashKey:""};
}
async function prepareManualBooksJournal(db, data, accounts, actor, allowedLinkedPayable) {
  const memo=financeText(data.memo,240),reference=financeText(data.ref,120),date=financeDate(data.date),rawLines=Array.isArray(data.lines)?data.lines:[];
  await assertAccountingPeriodOpen(db, date, "posting or correcting a manual journal");
  if(!memo)throw new HttpsError("invalid-argument","Memo / description is required.");
  if(rawLines.length<2||rawLines.length>20)throw new HttpsError("invalid-argument","A journal requires between two and twenty lines.");
  const lines=[],cashLines=[];let debit=0,credit=0;const booksChart=await ensureBooksChart(db);
  rawLines.forEach((row,index)=>{const dr=Financial.money(row&&row.debit),cr=Financial.money(row&&row.credit);if((dr>0&&cr>0)||(!(dr>0)&&!(cr>0)))throw new HttpsError("invalid-argument",`Journal line ${index+1} must contain either a debit or a credit.`);const mapped=booksCodeAccount(row.code,accounts,booksChart);debit=Financial.money(debit+dr);credit=Financial.money(credit+cr);lines.push(Financial.line(mapped.account,dr,cr,memo));if(mapped.cashKey)cashLines.push({mapped,dr,cr,index});});
  if(Math.abs(debit-credit)>0.009||!(debit>0))throw new HttpsError("invalid-argument","Journal debits and credits must balance.");
  const payableLines=rawLines.filter((row)=>String(row&&row.code||"")==="2000"),linkedPayableId=payableLines.length?financeKey(data.linkedPayableId,"Linked payable ID"):"";let linkedPayable=null;
  if(payableLines.length>1)throw new HttpsError("invalid-argument","A manual journal may contain only one Accounts Payable control line.");
  if(payableLines.length){const row=payableLines[0],value=Financial.money(row.debit);if(Financial.money(row.credit)>0)throw new HttpsError("failed-precondition","Create supplier liabilities with New bill or Purchases so the payable subledger stays linked.");linkedPayable=(await db.ref(`/payables/${linkedPayableId}`).get()).val();if(!linkedPayable)throw new HttpsError("not-found","The selected payable was not found.");const allowed=allowedLinkedPayable&&linkedPayableId===allowedLinkedPayable.id&&linkedPayable.reversalMovementId===allowedLinkedPayable.movementId;if(linkedPayable.status!=="open"&&!allowed)throw new HttpsError("failed-precondition","The selected payable is no longer open.");if(linkedPayable.purchaseInvoiceId)throw new HttpsError("failed-precondition","Inventory payables must be corrected from Purchases so stock and valuation remain linked.");const remaining=Financial.money(linkedPayable.remainingAmount!=null?linkedPayable.remainingAmount:linkedPayable.amount);if(Math.abs(value-remaining)>0.009)throw new HttpsError("failed-precondition",`Accounts Payable must debit the selected payable's full remaining balance of ${remaining.toFixed(2)}.`);}
  const sensitive=rawLines.some((row)=>{const c=String(row&&row.code||""),entry=booksChart&&booksChart[c];return entry?entry.sensitive===true:SENSITIVE_BOOKS_CODES.has(c);});
  if(sensitive&&!reference)throw new HttpsError("invalid-argument","A source reference is required for cash, sales, platform, inventory, receivable, payable, suspense, or equity journals.");
  if(sensitive&&!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError("permission-denied","A privileged Finance role must post journals affecting cash, sales, platforms, inventory, receivables, payables, suspense, or equity.");
  return {memo,reference,date,lines,cashLines,debit,sensitive,linkedPayableId,linkedPayable};
}
function assertNoOverlappingUpdatePaths(writes, context) {
  const paths = Object.keys(writes);
  for (const parentPath of paths) for (const childPath of paths) if (childPath !== parentPath && childPath.startsWith(`${parentPath}/`)) throw new HttpsError("internal", `The ${context || "financial"} update contains conflicting record paths. Nothing was posted.`);
}
async function commitFinancial(db, movementId, movement, actor, extraWrites = {}) {
  movementId = financeKey(movementId, "Movement ID");
  const ref = db.ref(`/financialMovements/${movementId}`);
  const existing = await ref.get();
  if (existing.exists()) return {duplicate: true, movement: existing.val()};
  await assertAccountingPeriodOpen(db, Number(movement && movement.occurredAt || Date.now()), "creating this financial posting");
  const record = financeRecord(movementId, movement, actor);
  const claimRef = db.ref(`/financialCommandClaims/${movementId}`), claimToken = crypto.randomBytes(12).toString("hex"), claimedAt = Date.now();
  const claim = await claimRef.transaction((current) => {
    // The longest financial maintenance callable can run for nine minutes.
    // A 15-minute lease prevents a live invocation from being taken over.
    const stale = current && current.status === "processing" && Number(current.claimedAt || 0) < claimedAt - 900000;
    return !current || stale ? {status:"processing",token:claimToken,claimedAt,actorUid:actor.uid,movementId,operationType:financeText(movement && movement.type,80),schemaVersion:2} : current;
  });
  if (!claim.committed || !claim.snapshot.exists() || claim.snapshot.val().token !== claimToken) {
    const posted = await ref.get();
    if (posted.exists()) return {duplicate: true, movement: posted.val()};
    throw new HttpsError("aborted", "This financial command is already being processed. Wait a moment, then refresh before trying again.");
  }
  try {
    // While this claim is processing, guarded cash-journal edits cannot run.
    // Detect edits completed after a custody calculation but before this claim.
    if(Object.keys(extraWrites).some(path=>path.startsWith('cashCustody/'))){
      try{CashJournalEdit.assertCustodyDelta((await db.ref('/cashCustody').get()).val()||{},extraWrites,record.lines);}catch(error){throw new HttpsError('failed-precondition',error.message);}
    }
    if(record.reversalOf){const source=(await db.ref(`/financialMovements/${financeKey(record.reversalOf,'Reversal source')}`).get()).val();if(source&&Number(source.revision)>0&&CashJournalEdit.eligible(source))throw new HttpsError('failed-precondition','This cash journal has an audited revision. Refresh and use Edit / correct; journal-only reversal would break its custody link.');}
    const writes = Object.assign({}, extraWrites, {[`financialMovements/${movementId}`]: record,[`financialCommandClaims/${movementId}`]:{status:"posted",token:claimToken,claimedAt,postedAt:Date.now(),actorUid:actor.uid,movementId,operationType:financeText(movement && movement.type,80),schemaVersion:2}});
    await safeFinancialUpdate(db, writes, "financial");
    return {duplicate: false, movement: record};
  } catch (error) {
    await claimRef.transaction((current) => current && current.token === claimToken && current.status === "processing" ? null : current);
    throw error;
  }
}
async function poolCustodyOutflow(db, value) {
  const need0 = Financial.money(value); if (!(need0 > 0)) return {writes: {}, fromCustody: 0, shortfall: 0, allocations: {}};
  const custody = (await db.ref("/cashCustody").get()).val() || {};
  const rows = Object.keys(custody).map((cid) => Object.assign({id: cid}, custody[cid])).filter((x) => Financial.money(x.remaining) > 0).sort((a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0));
  const writes = {}, allocations = {}; let need = need0, fromCustody = 0;
  for (const row of rows) { if (need <= 0) break; const available = Financial.money(row.remaining), use = Financial.money(Math.min(need, available)); if (!(use > 0)) continue; allocations[row.id] = use; fromCustody = Financial.money(fromCustody + use); need = Financial.money(need - use); const next = Financial.money(available - use); writes[`cashCustody/${row.id}/remaining`] = next; writes[`cashCustody/${row.id}/status`] = next > 0 ? "partially_paid_out" : "paid_out"; writes[`cashCustody/${row.id}/paidOutAmount`] = Financial.money(Number(row.paidOutAmount || 0) + use); writes[`cashCustody/${row.id}/lastPaymentAt`] = Date.now(); }
  return {writes, fromCustody, shortfall: Financial.money(need), allocations};
}

async function availableCashOnHandAboveFloat(db) {
  const [movementsSnap, settingsSnap, activeShiftSnap] = await Promise.all([db.ref("/financialMovements").get(), db.ref("/posSettings").get(), db.ref("/posActiveShift").get()]);
  let gross = 0;
  Object.values(movementsSnap.val() || {}).forEach((movement) => ((movement && movement.lines) || []).forEach((line) => {
    if (line && line.account === "asset:register_cash") gross = Financial.money(gross + Financial.money(line.debit) - Financial.money(line.credit));
  }));
  const float = resolveRegisterFloat(settingsSnap.val(), activeShiftSnap.val()).amount;
  return {gross: Financial.money(gross), float, available: Financial.money(Math.max(0, gross - float))};
}
function poolCustodyInflowRecord(cid, value, label, occurredAt, movementId) {
  return {[`cashCustody/${cid}`]: {shiftId: cid, staff: financeText(label, 100), amount: Financial.money(value), depositedAmount: 0, remaining: Financial.money(value), retainedFloat: 0, status: "awaiting_deposit", closedAt: Number(occurredAt || Date.now()), movementId, source: "pool_inflow", schemaVersion: 2}};
}

function accountIdFor(dbAccounts, id) {
  const key = financeKey(id, "Cash account");
  if (!dbAccounts[key]) throw new HttpsError("failed-precondition", "The selected cash-flow account no longer exists.");
  return key;
}
async function findOrder(db, orderId) {
  const id = financeKey(orderId, "Order ID");
  let node = "orders", snap = await db.ref(`/orders/${id}`).get();
  if (!snap.exists()) { node = "archivedOrders"; snap = await db.ref(`/archivedOrders/${id}`).get(); }
  if (!snap.exists()) throw new HttpsError("not-found", "Order not found.");
  return {id, node, order: Object.assign({id}, snap.val() || {})};
}
async function postOrderFinancial(db, order, accounts, actor) {
  const effectiveStatus = order && order.status === "Archived" ? order.prevStatus : order && order.status;
  if (!order || !order.id || order.paymentStatus === "pending" || !["Completed", "Received"].includes(String(effectiveStatus || ""))) return {skipped: true};
  const movement = Financial.orderPosting(order, accounts || {});
  if (order.paymentApprovalId) {movement.approvalId = order.paymentApprovalId; movement.approvedBy = financeText(order.paymentApprovedBy, 160);}
  movement.occurredAt = Number(order.completedAt || order.receivedAt || order.timestamp || Date.now());
  movement.actorName = order.onDuty || order.staff || "POS";
  const date = financeDateFromTimestamp(movement.occurredAt);
  const writes = {};
  (movement.cashEntries || []).forEach((entry) => { entry.date = date; entry.party = order.name || "Walk-in"; entry.ref = order.id; entry.auto = true; writes[`cfLedger/${entry.id}`] = cashLedgerRecord(entry, `sale_${order.id}`, movement, actor); });
  return commitFinancial(db, `sale_${order.id}`, movement, actor, writes);
}
function addOrderCashWrites(writes, movement, movementId, order, actor) {
  const occurredAt = Number(movement.occurredAt || Date.now());
  const date = financeDateFromTimestamp(occurredAt);
  (movement.cashEntries || []).forEach((entry, index) => {entry.date = date; entry.party = order.name || "Walk-in"; entry.ref = order.id; entry.auto = true; const id = `cf_${movementId}_${index}`; writes[`cfLedger/${id}`] = cashLedgerRecord(entry, movementId, movement, actor);});
}

async function fullOrderVoidMovement(db, order, accounts, settlementPayments) {
  const movementSnap = await db.ref("/financialMovements").get();
  const movement = Financial.netMovementCorrection(Object.values(movementSnap.val() || {}), order.id, "order_void", "Fully reverse voided order");
  if (!movement) return null;
  const remaining = Financial.money(Math.max(0, Financial.money(order.total) - Financial.money(order.refundAmount)));
  const settlement = Financial.reversalPosting(order, remaining, "void", accounts || {}, settlementPayments);
  movement.cashEntries = settlement.cashEntries || [];
  movement.settlementPayments = settlement.settlementPayments || [];
  movement.warnings = settlement.warnings || [];
  return movement;
}

exports.onOrderFinancialPosting = onValueWritten(
  {ref: "/orders/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const before = event.data.before.val() || {}, afterRaw = event.data.after.val();
    if (!afterRaw) return;
    const order = Object.assign({id: event.params.orderId}, afterRaw);
    const db = getDatabase(); const accounts = (await db.ref("/cfAccounts").get()).val() || {}; const actor = {uid: "server", role: "server"};
    await postOrderFinancial(db, order, accounts, actor);
    const beforeRefund = Financial.money(before.refundAmount), afterRefund = Financial.money(order.refundAmount);
    if (afterRefund > beforeRefund) {
      const delta = Financial.money(afterRefund - beforeRefund), movement = Financial.reversalPosting(order, delta, "refund", accounts);
      movement.occurredAt = Number(order.refundedAt || Date.now()); movement.actorName = order.refundedBy || order.staff || "Refund";
      const movementId = `refund_${order.id}_${Math.round(afterRefund * 100)}`, writes = {}; addOrderCashWrites(writes, movement, movementId, order, actor); await commitFinancial(db, movementId, movement, actor, writes);
    }
    if (order.voided === true && before.voided !== true) {
      const remaining = Financial.money(Math.max(0, Financial.money(order.total) - afterRefund));
      if (remaining > 0) { const movement = await fullOrderVoidMovement(db, order, accounts); if (movement) { movement.occurredAt = Number(order.voidedAt || Date.now()); movement.actorName = order.voidedBy || order.staff || "Void"; const movementId = `void_${order.id}`, writes = {}; addOrderCashWrites(writes, movement, movementId, order, actor); await commitFinancial(db, movementId, movement, actor, writes); } }
    }
  },
);

// Revenue-completeness control. Controlled archiving writes archivedOrders
// before removing the active record. If a posted sale is hard-deleted by any
// other path, preserve the evidence automatically and record the exception.
exports.preservePostedOrderOnDelete = onValueDeleted(
  {ref: "/orders/{orderId}", region: ORDER_REGION, retry: true},
  async (event) => {
    const id = event.params.orderId, order = event.data.val() || {};
    if (!id) return;
    const db = getDatabase(), archivedRef = db.ref(`/archivedOrders/${id}`);
    if ((await archivedRef.get()).exists() || !(await db.ref(`/financialMovements/sale_${id}`).get()).exists()) return;
    const now = Date.now(), effectiveStatus = order.status === "Archived" ? order.prevStatus : order.status;
    const retained = Object.assign({}, order, {id, status: "Archived", prevStatus: effectiveStatus || "Completed", archivedAt: now, archiveReason: "Automatically preserved after unexpected deletion", recoveredFromDeletion: true, schemaVersion: Math.max(2, Number(order.schemaVersion) || 0)});
    const result = await archivedRef.transaction((current) => current || retained);
    if (result.committed) await db.ref(`/deletionAudit/${now}_order_${id}`).set({action: "posted_order_auto_preserved", sourceType: "order", sourceId: id, reason: "Posted sale had no archived order after deletion", ts: now, actorUid: "server", schemaVersion: 1});
  },
);

async function postShiftCashEntries(db, shiftId, entries, kind) {
  const actor = {uid: "server", role: "server"}, shift=(await db.ref(`/shifts/${shiftId}`).get()).val()||{}, shiftReference=durableShiftReference(shift,shiftId);
  for (let index = 0; index < (entries || []).length; index++) { const entry = entries[index] || {}, value = Financial.money(entry.amount); if (!(value > 0)) continue; const token = `${Number(entry.ts || 0)}_${index}`, movementId = `${kind}_${shiftId}_${token}`, isIn = kind === "shift_payin"; if (!isIn && (entry.type === "revolving_fund_replenishment" || /^petty cash replenish/i.test(String(entry.reason || "")))) continue; const isPurchaseAdvance = !isIn && entry.type === "purchase_advance" && entry.id; const lines = isIn ? [Financial.line("asset:register_cash", value, 0, entry.reason || "Cash in"), Financial.line(`offset:cash_in:${financeText(entry.reason || "other", 60)}`, 0, value, entry.reason || "Cash in")] : isPurchaseAdvance ? [Financial.line(`asset:purchase_cash_advance:${financeKey(entry.id, "Purchase advance ID")}`, value, 0, entry.reason || "Purchase cash advance"), Financial.line("asset:register_cash", 0, value, entry.reason || "Purchase cash advance")] : [Financial.line(`expense:cash_out:${financeText(entry.reason || "other", 60)}`, value, 0, entry.reason || "Cash out"), Financial.line("asset:register_cash", 0, value, entry.reason || "Cash out")]; const movement = Financial.movement(isPurchaseAdvance ? "purchase_cash_advance" : kind, "shift", shiftId, lines, {occurredAt: Number(entry.ts || Date.now()), actorName: entry.by || "Register", shiftReference, reference:financeText(entry.reference,120)||shiftReference, advanceId: entry.id || "", recipient: financeText(entry.recipient || "", 120)}); await commitFinancial(db, movementId, movement, actor); }
}
exports.onShiftPayInsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payIns", region: ORDER_REGION, retry: true}, async (event) => {if (!event.data.after.exists()) return; await postShiftCashEntries(getDatabase(), event.params.shiftId, event.data.after.val() || [], "shift_payin");});
exports.onShiftPayOutsFinancial = onValueWritten({ref: "/shifts/{shiftId}/payOuts", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the register drawer never funds payments — cash out is drawn from Undeposited Collection via approved vouchers. Historical drawer pay-outs already posted (idempotent) and are unaffected. */ return; });
exports.onShiftOpenFinancial = onValueWritten({ref: "/shifts/{shiftId}", region: ORDER_REGION, retry: true}, async (event) => { /* Undeposited Collection pool model: the opening float stays in the drawer between shifts — no financial entry, no custody draw. */ return; });
function durableShiftReference(shift,id) { const existing=financeText(shift&&shift.shiftReference,80); if(existing)return existing; const day=financeDateFromTimestamp(Number(shift&&shift.openAt)||Date.now()).replace(/-/g,""); return `SHIFT-${day}-LEGACY-${financeKey(id,"Shift ID").slice(-8).toUpperCase()}`; }
async function ensureShiftReferenceRecord(db,id,shift) { const shiftReference=durableShiftReference(shift,id),refKey=financeKey(shiftReference,"Shift reference"),indexRef=db.ref(`/shiftReferenceIndex/${refKey}`),claim=await indexRef.transaction((current)=>{if(current&&current.shiftId!==id)return;return current||{shiftId:id,shiftReference,openedAt:Number(shift.openAt||0),closedAt:Number(shift.closeAt||0)||null};},undefined,false);if(!claim.committed)throw new HttpsError("already-exists",`Shift reference ${shiftReference} is already linked to another shift.`);const custody=(await db.ref(`/cashCustody/${id}`).get()).val()||null,writes={[`shifts/${id}/shiftReference`]:shiftReference,[`shifts/${id}/zReport/shiftReference`]:shiftReference};if(custody)Object.assign(writes,{[`cashCustody/${id}/shiftReference`]:shiftReference,[`cashCustody/${id}/reference`]:shiftReference});await db.ref().update(writes);return shiftReference; }
exports.ensureShiftReference = onCall({region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"}, async (request) => {const db=getDatabase(),actor=await requirePortalPermission(db,request,["registerOps"]),id=financeKey((request.data||{}).shiftId,"Shift ID"),shift=(await db.ref(`/shifts/${id}`).get()).val();if(!shift)throw new HttpsError("not-found","Shift not found.");const shiftReference=await ensureShiftReferenceRecord(db,id,shift);return{shiftId:id,shiftReference,updatedBy:actor.uid};});
exports.onShiftCloseFinancial = onValueWritten({ref: "/shifts/{shiftId}/status", region: ORDER_REGION, retry: true}, async (event) => {if (event.data.after.val() !== "closed" || event.data.before.val() === "closed") return; const db = getDatabase(), id=event.params.shiftId, shift = (await db.ref(`/shifts/${id}`).get()).val() || {}, actor={uid:"server",role:"server"}, occurredAt=Number(shift.closeAt||Date.now()), shiftReference=await ensureShiftReferenceRecord(db,id,shift); const remittable=Financial.money(Math.max(0,Number(shift.cashToSettle)||0)); if (remittable>0) {const label=`${shiftReference} · closed shift cash to settle`,custody=Financial.movement("shift_cash_to_custody","shift",id,[Financial.line("asset:cash_awaiting_deposit",remittable,0,label),Financial.line("asset:register_cash",0,remittable,label)],{occurredAt,actorName:shift.staff||"Register",shiftReference,retainedFloat:Financial.money(shift.actualFloatRetained!=null?shift.actualFloatRetained:shift.retainedFloat)}); await commitFinancial(db,`shift_custody_${id}`,custody,actor,{[`cashCustody/${id}`]:{shiftId:id,shiftReference,staff:financeText(shift.staff,100),amount:remittable,depositedAmount:0,remaining:remittable,retainedFloat:Financial.money(shift.actualFloatRetained!=null?shift.actualFloatRetained:shift.retainedFloat),floatShortfall:Financial.money(shift.floatShortfall),status:"awaiting_deposit",closedAt:occurredAt,movementId:`shift_custody_${id}`,reference:shiftReference,schemaVersion:4}});} const value = Financial.money(Math.abs(Number(shift.variance) || 0)); if (!(value > 0)) return; const short = Number(shift.variance) < 0, label=`${shiftReference} · ${short?"Cash shortage pending manager reconciliation":"Cash overage pending manager reconciliation"}`, lines = short ? [Financial.line("asset:cash_shortage_pending", value, 0, label), Financial.line("asset:register_cash", 0, value, label)] : [Financial.line("asset:register_cash", value, 0, label), Financial.line("liability:cash_overage_pending", 0, value, label)]; const movement = Financial.movement("shift_cash_variance_pending", "shift", id, lines, {occurredAt,actorName:shift.staff||"Register",shiftReference,status:"pending_manager_reconciliation"}); await commitFinancial(db,`shift_variance_${id}`,movement,actor);});
