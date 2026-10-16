// Void posting dates (owner decision 16 Oct 2026): a void removes its sale from the month it was made,
// exactly as Admin net sales does, so its reversal belongs on the original sale date. Voids posted on a
// later date (before the void dialog was locked to the sale date) are listed here and re-dated through
// the same net-zero reversal + repost as cash-date repairs. Rows that cannot be moved safely are listed
// but locked for manual review: a closed month (either date), a void that returned money (drawer, bank
// or e-wallet - that money moved on the void date), an order already paid out by the platform, VAT lines
// that would cross a tax quarter, and stock already returned on the void date (its cost reversal is
// posted in the void month). A void whose order no longer exists is skipped: there is no sale date.
const VOID_MONEY_ACCOUNT = /^asset:(register_cash|cash)/;
const VOID_TAX_ACCOUNT = /vat|tax/i;
const VOID_SCAN_BATCH = 20, VOID_SCAN_ROW_LIMIT = 500;
async function accountingPeriodClosedFor(db, date, cache) {
  const period = AccountingPeriods.periodForDate(date);
  if (!Object.prototype.hasOwnProperty.call(cache, period)) cache[period] = AccountingPeriods.isClosed((await db.ref(`/accountingPeriods/${period}`).get()).val());
  return cache[period] ? period : "";
}
function voidTaxQuarter(date) { const [y, m] = String(date).split("-").map(Number); return `${y}-Q${Math.ceil(m / 3)}`; }
async function voidOrderFor(db, orderId) {
  const live = (await db.ref(`/orders/${orderId}`).get()).val();
  if (OrderRecords.isAuthoritativeOrder(live)) return {order: live, node: "orders"};
  const archived = (await db.ref(`/archivedOrders/${orderId}`).get()).val();
  return OrderRecords.isAuthoritativeOrder(archived) ? {order: archived, node: "archivedOrders"} : null;
}
// One definition of "a void that is not on its sale date", shared by the repair preview and the control
// audit, so the audit never flags a row the repair cannot see (or misses one it can).
function voidSaleDateCandidate(mv) { mv = mv || {}; return String(mv.type || "") === "order_void" && !mv.dateRepairSupersededBy && !mv.redatedFromMovementId && /^[A-Za-z0-9_-]{1,80}$/.test(String(mv.sourceId || "")); }
function voidSaleDates(mv, order) {
  const currentDate = BooksBridge.businessDate(mv.occurredAt);
  const targetDate = financeDateFromTimestamp(Number(order.completedAt || order.receivedAt || order.timestamp) || Number(mv.occurredAt));
  return targetDate && targetDate !== currentDate ? {currentDate, targetDate} : null;
}
async function voidSaleDateRow(db, movements, mid, periods) {
  const mv = movements[mid], orderId = String(mv.sourceId);
  const found = await voidOrderFor(db, orderId);
  if (!found) return null;
  const order = found.order, dates = voidSaleDates(mv, order);
  if (!dates) return null;
  const {currentDate, targetDate} = dates;
  const lines = Array.isArray(mv.lines) ? mv.lines : [], account = (line) => String(line && line.account || "");
  const closed = (await accountingPeriodClosedFor(db, currentDate, periods)) || (await accountingPeriodClosedFor(db, targetDate, periods));
  let locked = "";
  if (closed) locked = `${closed} is closed`;
  else if (lines.some((line) => VOID_MONEY_ACCOUNT.test(account(line)))) locked = "returned money: review manually";
  else if (order.payoutId || String(order.settlementStatus || "").toLowerCase() === "settled") locked = "already in a platform payout: review manually";
  else if (lines.some((line) => VOID_TAX_ACCOUNT.test(account(line))) && voidTaxQuarter(currentDate) !== voidTaxQuarter(targetDate)) locked = "VAT would move to another tax quarter: review manually";
  else if (order.inventoryReversed === true) locked = "stock already returned on the void date: review its cost manually";
  else if (order.inventoryReversalRequested === true) locked = "stock return already pending: review after it completes";
  const restockable = !locked && order.inventoryDeducted === true && order.inventoryReversed !== true && order.voided === true;
  const amount = Financial.money(Number(mv.amount) || Financial.totals(lines).debit);
  return {movementId: mid, orderId, orderNode: found.node, amount, currentDate, targetDate, type: "order_void", basis: "void_sale_date", channel: String(order.channel || ""), voidReason: String(order.voidReason || "").slice(0, 120), locked, restockable};
}
async function voidSaleDateMismatches(db, movements) {
  const rows = [], periods = {};
  const voids = Object.keys(movements).filter((id) => voidSaleDateCandidate(movements[id]));
  // Read in small parallel batches; the row cap applies to real mismatches, not to voids already on their date.
  for (let i = 0; i < voids.length && rows.length < VOID_SCAN_ROW_LIMIT; i += VOID_SCAN_BATCH) {
    const batch = await Promise.all(voids.slice(i, i + VOID_SCAN_BATCH).map((mid) => voidSaleDateRow(db, movements, mid, periods)));
    batch.forEach((row) => { if (row && rows.length < VOID_SCAN_ROW_LIMIT) rows.push(row); });
  }
  return rows;
}
// The order side of a void re-date, committed in the SAME multi-path update as the repost (so the
// ledger and the order can never disagree): the corrected void accounting date (its COGS reversal
// follows it) and, only when the owner ticked it, the stock-return request.
function voidSaleDateMetadata(m, approvedRestock, reason, now) {
  const metadata = {voidAccountingDate: m.targetDate, voidDateRepairedAt: now};
  if (m.restockable && approvedRestock.has(m.orderId)) Object.assign(metadata, {inventoryReversalRequested: true, inventoryReversalReason: String(`${reason} (void re-dated to sale date)`).slice(0, 500)});
  return metadata;
}
function voidSaleDateOrderWrites(m, approvedRestock, reason, now) {
  const metadata = voidSaleDateMetadata(m, approvedRestock, reason, now), writes = {};
  Object.keys(metadata).forEach((key) => { writes[`${m.orderNode}/${m.orderId}/${key}`] = metadata[key]; });
  return writes;
}
// Re-run after a repost that already committed (duplicate): re-apply the same order fields safely.
async function completeVoidSaleDateRepair(db, m, approvedRestock, reason) {
  await OrderRecords.mergeMetadataIntoAuthoritativeOrder(db, m.orderId, voidSaleDateMetadata(m, approvedRestock, reason, Date.now()));
}
