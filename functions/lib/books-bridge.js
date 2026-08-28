"use strict";
/* ============================================================
   Accaza Books — POS → journal bridge (server side)
   Maps POS financialMovements (see ./financial.js) into Accaza
   Books journal entries under /books/journal.

   Sale movements (order_sale / order_void / order_refund) are
   rolled up into ONE daily-summary-per-channel entry keyed
   `${businessDate}_${channel}`. All other movements (purchases,
   payroll, transfers, capital, payouts) post as their own
   discrete entry keyed by the movement id.

   Pure + idempotent: every accumulation is guarded by
   sources[movementId] so a re-fired trigger never double-counts.
   No amount is re-derived — only account-string → COA mapping.
   ============================================================ */

const CHANNEL_SALES = {instore: "4000", online: "4010", grabfood: "4020", foodpanda: "4030"};
const SALES_CODES = new Set([...Object.values(CHANNEL_SALES), "4900", "4910"]);
// Finance chart-account id -> Accaza Books COA (bills, manual expenses, owner capital/draw, etc.)
const CHART_COA = {
  rent: "6010", utilities: "6020", salaries: "6000", "bank charges": "6080", bank_charges: "6080",
  repairs: "6060", "repairs & maintenance": "6060", marketing: "6050", supplies: "6070",
  office_supplies: "6075", "office supplies": "6075",
  internet: "6030", "internet & phone": "6030", depreciation: "6090",
  purchases: "6100", other_expense: "6100", other: "6100", "fixed asset": "1500",
  capital_in: "3000", "capital in": "3000", owner_draw: "3100", "owner draw": "3100",
  sales_revenue: "4000", other_income: "4990"
};
const MANILA = new Intl.DateTimeFormat("en-US", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"});

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const INVENTORY_CODES = new Set(["1200", "1210", "1220", "1230", "1240", "1270", "1280"]);
const COST_CODES = new Set(["5000", "5010", "5020", "5030", "5040", "6070", "6075"]);
const DIRECT_CODES = new Set([...INVENTORY_CODES, ...COST_CODES, "1290", "5090"]);

function itemAccounts(item) {
  item = item || {}; const inventory = String(item.inventoryAccount || ""), cost = String(item.costAccount || item.cogsAccount || "");
  return {inventory: INVENTORY_CODES.has(inventory) ? inventory : "", cost: COST_CODES.has(cost) ? cost : ""};
}

function cogsAccountSnapshot(order, inventory, categories) {
  if (order && order.cogsAccountSnapshot && typeof order.cogsAccountSnapshot === "object") return order.cogsAccountSnapshot;
  const lines = order && order.cogsDetail && order.cogsDetail.lines; if (!Array.isArray(lines)) return {};
  const out = {};
  lines.forEach((line) => { const item = (inventory || {})[line.ingredientId] || {}, mapping = itemAccounts(item); const key = mapping.inventory && mapping.cost ? `${mapping.inventory}|${mapping.cost}` : "1290|5090"; out[key] = r2((out[key] || 0) + Number(line.totalCost || 0)); });
  return out;
}

function businessDate(ms) {
  const parts = MANILA.formatToParts(new Date(Number(ms) || Date.now())), map = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

/* POS account string → {code, unmapped}. cashAccountMap: POS cash-flow accountId → COA code. */
function mapAccount(posAccount, channel, cashAccountMap) {
  const a = String(posAccount || "");
  cashAccountMap = cashAccountMap || {};
  const exact = {
    "asset:register_cash": "1000", "asset:register_float": "1005", "asset:cash_awaiting_deposit": "1030", "asset:petty_cash": "1040",
    "asset:withholding_tax": "1260", "asset:cash_shortage_pending": "1190", "liability:cash_overage_pending": "2100", "revenue:sales_reversal": "4910",
    "revenue:cash_overage": "4990", "revenue:payment_overage": "4990",
    "expense:cash_shortage": "6110", "equity:owner_draw": "3100", "expense:platform_commission": "6040",
    "expense:platform_variance:va_ads": "6050", "expense:platform_variance:va_marketing_success": "6050",
    "expense:platform_variance:va_promo": "6045", "expense:platform_variance:va_fees": "6080",
    "expense:platform_variance:va_penalty": "6085", "expense:platform_variance:va_refund": "6085",
    "revenue:platform_variance:va_incentive": "4990", "revenue:platform_variance:va_refund_recovery": "4990",
    "expense:customer_discount": "4900", "expense:platform_discount": "4900", "revenue:platform_discount": "4900", "expense:platform_merchant_funded_promo": "6045", "expense:platform_delivery_fee_discount": "6045", "expense:platform_service_vat": "6046",
    "expense:platform_estimate_variance": "6100", "revenue:platform_estimate_variance": "4990",
    "equity:owner_capital": "3000", "equity:opening_balance": "3000", "equity:cash_float_source": "3000",
    "cogs:beverage": "5000", "cogs:food": "5030", "cogs:packaging": "5040", "cogs:other": "5000", "inventory:control": "1200",
    "asset:accumulated_depreciation": "1590", "expense:depreciation": "6090", "revenue:asset_disposal_gain": "4990", "expense:asset_disposal_loss": "6100",
  };
  if (exact[a]) return {code: exact[a], unmapped: false};
  if (a.indexOf("liability:customer_change_refund:") === 0) return {code: "2030", unmapped: false};
  // Server-authorized manual journals already carry a validated Books code.
  // Preserve it exactly so a journal never falls through to Suspense merely
  // because the account is outside the inventory/cost subset.
  if (/^coa:\d{4}$/.test(a)) return {code: a.slice(4), unmapped: false};
  if (a === "revenue:sales") return {code: CHANNEL_SALES[String(channel || "instore").toLowerCase()] || "4000", unmapped: false};
  if (a.indexOf("asset:cash_account:") === 0) { const id = a.split(":")[2] || ""; return {code: cashAccountMap[id] || "1010", unmapped: false}; }
  if (a.indexOf("asset:platform_receivable:") === 0) return {code: "1100", unmapped: false};
  if (a.indexOf("asset:platform_clearing:") === 0) return {code: "1050", unmapped: false};
  if (a.indexOf("asset:receivable:") === 0) return {code: "1110", unmapped: false};
  if (a.indexOf("asset:fixed_asset:") === 0) return {code: a.split(":")[2] === "furniture" ? "1510" : "1500", unmapped: false};
  if (a.indexOf("inventory:") === 0) return {code: "1290", unmapped: true};
  if (a.indexOf("liability:grni:") === 0) return {code: "2090", unmapped: true};
  if (a.indexOf("liability:payable:") === 0) return {code: "2000", unmapped: false};
  if (a.indexOf("liability:due_to_owner:") === 0) return {code: "2050", unmapped: false};
  if (a.indexOf("liability:platform_owing:") === 0) return {code: "2020", unmapped: false};
  var seg = a.indexOf(":") >= 0 ? a.slice(a.indexOf(":") + 1).toLowerCase() : "";
  if (a.indexOf("expense_or_inventory:") === 0) return CHART_COA[seg] ? {code: CHART_COA[seg], unmapped: false} : {code: "6100", unmapped: true};
  if (CHART_COA[seg]) return {code: CHART_COA[seg], unmapped: false};
  if (a.indexOf("revenue:") === 0) return {code: "4990", unmapped: true};
  if (a.indexOf("expense:") === 0) return {code: "6100", unmapped: true};
  if (a.indexOf("cogs:") === 0) return {code: "5090", unmapped: true};
  return {code: "1900", unmapped: true};
}

/* Stable Books code for each live cash-flow account. Explicit config still wins. */
function cashCodeForAccount(account) {
  const name = String(account && account.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.includes("foodpanda") && name.includes("gcash")) return "1021";
  if (name.includes("gcash") || name.includes("maya")) return "1020";
  if (name.includes("unionbank")) return "1011";
  if (name === "bdo" || name.startsWith("bdo")) return "1012";
  if (name.includes("securitybank4538")) return "1013";
  if (name.includes("securitybank4389")) return "1014";
  return String(account && account.type || "").toLowerCase() === "ewallet" ? "1020" : "1010";
}

function isSaleMovement(mv) {
  const t = String(mv && mv.type || "");
  return mv && (mv.sourceType === "order" || t === "order_sale" || t === "order_void" || t === "order_refund");
}

function fullyVoidedSourceIds(movements) {
  const ids = new Set();
  Object.keys(movements || {}).forEach((id) => {
    const mv = movements[id] || {};
    if (String(mv.type || "") === "order_void" && mv.sourceId) ids.add(String(mv.sourceId));
  });
  return ids;
}

function includeInRecognizedBooks(mv, voidedSourceIds) {
  const sourceId = String(mv && mv.sourceId || "");
  return !(sourceId && voidedSourceIds && voidedSourceIds.has(sourceId) && isSaleMovement(mv));
}

/* Admin Sales History is the sales authority. Finance keeps every immutable
   movement, but Books may recognize an order-sourced movement only when its
   Admin order still exists and is a recognized sale. Fully voided chains are
   excluded as a whole so the original and reversal net to zero in the report. */
function includeInAuthoritativeBooks(mv, voidedSourceIds, orders) {
  if (!isSaleMovement(mv)) return true;
  const sourceId = String(mv && mv.sourceId || "");
  if (!sourceId || !orders || !orders[sourceId]) return false;
  if (voidedSourceIds && voidedSourceIds.has(sourceId)) return false;
  return recognizedOrderForCogs(orders[sourceId]);
}

/* Key + channel for a movement. */
function bucketFor(mv) {
  const date = businessDate(mv && (mv.occurredAt || mv.postedAt));
  if (isSaleMovement(mv)) {
    const channel = String(mv.channel || "instore").toLowerCase();
    return {mode: "daily", key: `${date}_${channel}`, date, channel};
  }
  return {mode: "single", key: String(mv.id || mv.sourceId || ""), date, channel: String(mv.channel || "").toLowerCase()};
}

function mappedLines(mv, cashMap, context) {
  const channel = String(mv.channel || "instore").toLowerCase(), unmapped = [];
  const purchaseType=["payable_created","payable_reversed","grni_created","purchase_payable_reversed"].includes(String(mv.type||"")),legacySource=String(mv.sourceId||"").indexOf("ap_pinv_")===0||String(mv.sourceId||"").indexOf("pinv_")===0;
  const legacyLines=(mv.lines||[]).filter((l)=>purchaseType&&legacySource&&String(l.account||"").indexOf("expense_or_inventory:")===0),out=[];
  (mv.lines || []).filter((l)=>!legacyLines.includes(l)).forEach((l) => {
    const account=String(l.account||""),m=mapAccount(account, channel, cashMap);
    if (m.unmapped) unmapped.push({account: l.account, code: m.code});
    out.push({code: m.code, debit: r2(l.debit), credit: r2(l.credit), posAccount: account});
  });
  if(legacyLines.length){
    const debit=r2(legacyLines.reduce((s,l)=>s+Number(l.debit||0),0)),credit=r2(legacyLines.reduce((s,l)=>s+Number(l.credit||0),0)),target=r2(Math.max(debit,credit)),invoice=context&&context.purchaseInvoice,inventory=context&&context.inventory||{},totals={};
    (Array.isArray(invoice&&invoice.lines)?invoice.lines:[]).forEach((line)=>{const mapping=itemAccounts(inventory[line.itemId]||{}),code=mapping.inventory||"1290",value=r2(line.total);if(value>0)totals[code]=r2((totals[code]||0)+value);});
    const found=r2(Object.values(totals).reduce((s,v)=>s+v,0)),gap=r2(target-found);if(found>target+0.009){Object.keys(totals).forEach((code)=>delete totals[code]);totals["1290"]=target;}else if(gap>0)totals["1290"]=r2((totals["1290"]||0)+gap);
    if(!Object.keys(totals).length)totals["1290"]=target;
    Object.keys(totals).sort().forEach((code)=>{const value=totals[code];if(!(value>0))return;out.push({code,debit:debit>0?value:0,credit:credit>0?value:0,posAccount:"legacy_purchase_rebuild"});if(code==="1290")unmapped.push({account:"legacy_purchase_item_mapping",code});});
  }
  return {lines: out, unmapped};
}

/* Idempotently fold a sale movement into a daily-summary node (RTDB transaction body).
   Returns the new node, or undefined to abort (already applied / not a sale). */
function applyDaily(current, mv, cashMap) {
  const b = bucketFor(mv);
  if (b.mode !== "daily") return undefined;
  const node = current || {date: b.date, channel: b.channel, ref: `POS-${b.date.replace(/-/g, "")}-${b.channel.toUpperCase()}`,
    net: {}, sources: {}, sourceCount: 0, source: "pos-bridge", memo: `POS daily summary — ${b.channel}`};
  if (node.sources && node.sources[mv.id]) return undefined; // already applied → abort, no double count
  const {lines} = mappedLines(mv, cashMap);
  node.net = node.net || {};
  lines.forEach((l) => { node.net[l.code] = r2((node.net[l.code] || 0) + l.debit - l.credit); });
  node.sources = node.sources || {}; node.sources[mv.id] = true;
  node.sourceCount = Object.keys(node.sources).length;
  return node;
}

/* Build a discrete journal entry for a non-sale movement. */
function purchaseJournalText(mv, context) {
  const invoice=context&&context.purchaseInvoice;if(!invoice)return null;
  const rows=Array.isArray(invoice.lines)?invoice.lines:[],items=rows.slice(0,3).map((line)=>{const qty=Number(line.qty)||0,unit=String(line.unit||""),name=String(line.itemName||line.itemId||"Item");return `${qty} ${unit} ${name}`.replace(/\s+/g," ").trim();}),more=rows.length>3?` +${rows.length-3} more`:"",supplier=String(invoice.supplier||"Supplier"),reference=String(invoice.ref||mv.sourceId||""),reversal=String(mv.type||"").indexOf("revers")>=0;
  return {ref:`${reversal?"Purchase reversal":"Purchase"} — ${supplier}`,memo:`${items.join(" · ")}${more}${reference?` · Invoice ${reference}`:""}`||`Purchase from ${supplier}`};
}
function buildSingle(mv, cashMap, context) {
  const b = bucketFor(mv);
  const {lines, unmapped} = mappedLines(mv, cashMap, context);
  const purchaseText=purchaseJournalText(mv,context);
  return {
    entry: {
      id: b.key, date: b.date, ref: purchaseText?purchaseText.ref:String(mv.sourceId || mv.id || ""),
      memo: purchaseText?purchaseText.memo:`POS ${String(mv.type || "movement").replace(/_/g, " ")}${mv.sourceId ? " · " + mv.sourceId : ""}`,
      lines: lines.map((l) => ({code: l.code, debit: l.debit, credit: l.credit})),
      sources: {[mv.id]: true}, source: "pos-bridge", sourceType: String(mv.sourceType || ""), sourceId: String(mv.sourceId || ""),
      reversalOf: String(mv.reversalOf || ""), reversedByMovementId: String(mv.reversedByMovementId || ""),
      correctsMovementId: String(mv.correctsMovementId || ""), correctionReplacementId: String(mv.correctionReplacementId || ""),
      linkedPayableId: String(mv.linkedPayableId || ""), voided: mv.voided === true, reason: String(mv.reason || mv.correctionReason || ""),
    },
    unmapped,
  };
}

/* Convert a stored daily node's net map into balanced debit/credit lines (for the reader/tests). */
function netToLines(net) {
  return Object.keys(net || {}).filter((c) => Math.abs(net[c]) >= 0.005).sort().map((code) => {
    const v = net[code]; return {code, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0};
  });
}
function linesBalanced(lines) {
  let dr = 0, cr = 0; (lines || []).forEach((l) => { dr += Number(l.debit) || 0; cr += Number(l.credit) || 0; });
  return Math.abs(r2(dr) - r2(cr)) < 0.005;
}

/* Net completed sales represented by a Books net map: sales credits less
   refund/void debits in contra-income 4900. Other income is intentionally excluded. */
function netSales(net) {
  return r2(-Object.keys(net || {}).filter((code) => SALES_CODES.has(code)).reduce((sum, code) => sum + Number(net[code] || 0), 0));
}

/* Build Dr COGS (by category) / Cr Inventory lines from an order's cogs snapshot. */
function cogsLines(order, inventory, categories){
  var total = r2(order && order.cogsSnapshot);
  if(!(total>0)) return [];
  var accountSnapshot=cogsAccountSnapshot(order,inventory,categories),accountKeys=Object.keys(accountSnapshot||{}),mappedTotal=r2(accountKeys.reduce(function(sum,key){return sum+Number(accountSnapshot[key]||0);},0));
  if(accountKeys.length){
    var accountGap=r2(total-mappedTotal);if(Math.abs(accountGap)>=0.005){var adjustKey=accountKeys.slice().sort(function(a,b){return Number(accountSnapshot[b]||0)-Number(accountSnapshot[a]||0);})[0];accountSnapshot=Object.assign({},accountSnapshot);accountSnapshot[adjustKey]=r2(Number(accountSnapshot[adjustKey]||0)+accountGap);}
    var detailed=[];accountKeys.sort().forEach(function(key){var parts=key.split('|'),amount=r2(accountSnapshot[key]);if(!(amount>0))return;detailed.push({account:'coa:'+(COST_CODES.has(parts[1])?parts[1]:'5090'),debit:amount,credit:0});detailed.push({account:'coa:'+(INVENTORY_CODES.has(parts[0])?parts[0]:'1290'),debit:0,credit:amount});});
    return detailed;
  }
  var cat = (order && order.cogsCategorySnapshot) || {};
  var bev = r2((Number(cat.beverage)||0) + (Number(cat.directLabor)||0) + (Number(cat.unallocated)||0));
  var food = r2(Number(cat.food)||0);
  var pack = r2(Number(cat.packaging)||0);
  var catSum = r2(bev+food+pack);
  if(Math.abs(catSum-total) >= 0.005){ bev = r2(bev + (total-catSum)); } // reconcile buckets to the authoritative total
  var lines=[];
  if(bev>0) lines.push({account:"cogs:beverage", debit:bev, credit:0});
  if(food>0) lines.push({account:"cogs:food", debit:food, credit:0});
  if(pack>0) lines.push({account:"cogs:packaging", debit:pack, credit:0});
  var creditTotal = r2(bev+food+pack);
  if(creditTotal>0) lines.push({account:"inventory:control", debit:0, credit:creditTotal});
  return lines;
}

/* Pseudo-movement so COGS folds into the same daily-summary-per-channel entry as the sale. */
function cogsMovement(order, orderId, inventory, categories){
  return {
    id: "cogs_" + orderId, type: "order_cogs", sourceType: "order",
    channel: String((order && order.channel) || "instore").toLowerCase(),
    occurredAt: Number(order && (order.completedAt || order.receivedAt || order.occurredAt)) || Date.now(),
    lines: cogsLines(order, inventory, categories)
  };
}

function recognizedOrderForCogs(order){
  order=order||{};var status=order.status==='Archived'?order.prevStatus:order.status;
  return order.voided!==true&&order.paymentStatus!=='pending'&&(status==='Completed'||status==='Received');
}

/* Straight-line monthly depreciation and net book value (shared by server + register UI). */
function monthlyStraightLine(cost, salvage, usefulLifeMonths){
  var dep = r2((Number(cost)||0) - Math.max(0, Number(salvage)||0));
  var life = Math.max(1, Math.round(Number(usefulLifeMonths)||0));
  return r2(dep / life);
}
function netBookValue(asset){
  if(!asset) return 0;
  return r2((Number(asset.cost)||0) - (Number(asset.accumulatedDepreciation)||0));
}

function openingRebalanceLines(rows,oldRows){
  oldRows=oldRows||{};var lines=[];
  (rows||[]).forEach(function(row){
    var target=r2(row.stockValue);
    var booksAfterReversal=r2((Number(row.booksValue)||0)-(Number(oldRows[row.code])||0));
    var diff=r2(target-booksAfterReversal);
    if(Math.abs(diff)<0.005)return;
    lines.push({account:"coa:"+row.code,debit:diff>0?diff:0,credit:diff<0?-diff:0,label:"Opening inventory reconciliation "+row.code});
  });
  var net=r2(lines.reduce(function(s,l){return s+(Number(l.debit)||0)-(Number(l.credit)||0);},0));
  if(net>0)lines.push({account:"equity:opening_balance",debit:0,credit:net,label:"Opening inventory balance"});
  else if(net<0)lines.push({account:"equity:opening_balance",debit:-net,credit:0,label:"Opening inventory balance"});
  return lines;
}

function inventoryReconciliationSnapshot(inventory,journal){
  var stock={},books={},unmapped=[];INVENTORY_CODES.forEach(function(code){stock[code]=0;books[code]=0;});books["1290"]=0;
  Object.keys(inventory||{}).forEach(function(id){var item=inventory[id]||{},value=r2((Number(item.stock)||0)*(Number(item.cost)||0)),mapping=itemAccounts(item);if(Math.abs(value)<0.005)return;if(!mapping.inventory){unmapped.push({id:id,name:String(item.name||id),value:value});return;}stock[mapping.inventory]=r2(stock[mapping.inventory]+value);});
  Object.keys(journal||{}).forEach(function(id){var entry=journal[id]||{};if(entry.reversed===true)return;Object.keys(entry.net||{}).forEach(function(code){if(Object.prototype.hasOwnProperty.call(books,code))books[code]=r2(books[code]+Number(entry.net[code]||0));});(Array.isArray(entry.lines)?entry.lines:[]).forEach(function(line){var code=String(line&&line.code||'');if(Object.prototype.hasOwnProperty.call(books,code))books[code]=r2(books[code]+(Number(line.debit)||0)-(Number(line.credit)||0));});});
  var rows=Array.from(INVENTORY_CODES).sort().map(function(code){return{code:code,stockValue:r2(stock[code]),booksValue:r2(books[code]),difference:r2(stock[code]-books[code])};}),totalDifference=r2(rows.reduce(function(sum,row){return sum+row.difference;},0));
  return{rows:rows,totalStock:r2(rows.reduce(function(sum,row){return sum+row.stockValue;},0)),totalBooks:r2(rows.reduce(function(sum,row){return sum+row.booksValue;},0)),totalDifference:totalDifference,clearingBalance:r2(books["1290"]),unmapped:unmapped};
}

module.exports = {CHANNEL_SALES, r2, businessDate, mapAccount, cashCodeForAccount, itemAccounts, cogsAccountSnapshot, isSaleMovement, fullyVoidedSourceIds, includeInRecognizedBooks, includeInAuthoritativeBooks, bucketFor, mappedLines, applyDaily, buildSingle, netToLines, linesBalanced, netSales, cogsLines, cogsMovement, recognizedOrderForCogs, monthlyStraightLine, netBookValue, inventoryReconciliationSnapshot, openingRebalanceLines};
