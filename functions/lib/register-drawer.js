"use strict";

// Register Cash (Books 1000) must mirror the physical drawer. Under the Undeposited Collection
// pool model every closed shift leaves only the float behind: its cash sales, declared tips,
// cash-ins and variance are all handed over (shift_custody_<id>) or explained. So the Register
// Cash postings attributable to a closed shift must net to exactly zero, and the register's
// ledger balance must equal the float plus whatever the open shift has taken in so far.

const REGISTER_ACCOUNT = "asset:register_cash";
// Shifts closed before this Manila date ran on the old drawer-pool model (float draws, drawer
// pay-outs, legacy resets). Their register postings do not net per shift, so per-shift checks
// start here. The whole-register residual below still covers every date.
const PER_SHIFT_CONTROL_FROM = Date.parse("2026-09-01T00:00:00+08:00");

function cents(value) { return Math.round((Number(value) || 0) * 100); }
function pesos(c) { return Math.round(Number(c) || 0) / 100; }

function registerCents(movement) {
  return (movement && Array.isArray(movement.lines) ? movement.lines : []).reduce((sum, line) => sum + (String(line && line.account || "") === REGISTER_ACCOUNT ? cents(line.debit) - cents(line.credit) : 0), 0);
}

function shiftOrderIds(shift) {
  const out = new Set();
  [shift && shift.zReport, shift && shift.provisionalZReport].forEach((report) => {
    (report && Array.isArray(report.sales) ? report.sales : []).forEach((sale) => { const id = String(sale && (sale.id || sale.orderId) || ""); if (id) out.add(id); });
  });
  return out;
}

// Which shift a register posting belongs to: shift-sourced postings (custody, variance, cash-in,
// tips, turnover repair), case resolutions that carry shiftId, and order postings (sale, refund,
// void) through the order's shift.
function movementShiftId(movement, orderShiftOf) {
  if (!movement) return "";
  if (movement.shiftId) return String(movement.shiftId);
  if (String(movement.sourceType || "") === "shift") return String(movement.sourceId || "");
  if (String(movement.sourceType || "") === "order" && typeof orderShiftOf === "function") return String(orderShiftOf(String(movement.sourceId || "")) || "");
  return "";
}

// Register Cash net of every posting that belongs to one shift.
function shiftRegisterNet(shiftId, shift, movements) {
  const orders = shiftOrderIds(shift), rows = [];
  let net = 0;
  Object.keys(movements || {}).forEach((id) => {
    const movement = movements[id] || {}, value = registerCents(movement);
    if (!value) return;
    const owner = movementShiftId(movement, (orderId) => (orders.has(orderId) ? shiftId : ""));
    if (owner !== shiftId) return;
    net += value;
    rows.push({movementId: id, type: String(movement.type || ""), amount: pesos(value)});
  });
  return {shiftId, net: pesos(net), rows};
}

// Whole-register control. movements: every financial movement; orderShiftOf(orderId) -> shiftId;
// floatAmount: the protected float; activeShift: /posActiveShift; shifts: {id: shift} for the
// per-shift detail (optional).
function registerDrawerControl(input) {
  input = input || {};
  const movements = input.movements || {}, activeShift = input.activeShift || {}, openId = activeShift && activeShift.status !== "closed" ? String(activeShift.id || "") : "";
  const shifts = input.shifts || {}, byShift = {};
  let gross = 0, openNet = 0, handoverNet = 0;
  Object.keys(movements).forEach((id) => {
    const movement = movements[id] || {}, value = registerCents(movement);
    if (!value) return;
    gross += value;
    const owner = movementShiftId(movement, input.orderShiftOf);
    if (owner && owner === openId) openNet += value;
    // A handed-over shift waits for its final Z report before its variance and tips post.
    else if (owner && shifts[owner] && shifts[owner].status === "handover_pending") handoverNet += value;
    if (owner) byShift[owner] = (byShift[owner] || 0) + value;
  });
  const residual = gross - cents(input.floatAmount) - openNet - handoverNet;
  const shiftsOff = Object.keys(byShift).filter((id) => {
    if (id === openId || !byShift[id]) return false;
    const shift = shifts[id];
    return Boolean(shift && shift.status === "closed" && Number(shift.closeAt || 0) >= PER_SHIFT_CONTROL_FROM);
  }).map((id) => ({shiftId: id, staff: String(shifts[id].staff || ""), closedAt: Number(shifts[id].closeAt || 0), net: pesos(byShift[id]), tips: Number(shifts[id].tips || 0) || 0}))
    .sort((a, b) => b.closedAt - a.closedAt);
  return {registerGross: pesos(gross), floatAmount: pesos(cents(input.floatAmount)), openShiftId: openId, openShiftNet: pesos(openNet), awaitingFinalZNet: pesos(handoverNet), residual: pesos(residual), shiftsOff};
}

module.exports = {REGISTER_ACCOUNT, PER_SHIFT_CONTROL_FROM, registerCents, shiftOrderIds, movementShiftId, shiftRegisterNet, registerDrawerControl};
