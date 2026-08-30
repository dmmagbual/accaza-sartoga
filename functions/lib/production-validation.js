"use strict";

function row(id, label, status, detail, kind = "automated") { return {id, label, status, detail, kind}; }
function values(value) { return Object.values(value || {}).filter(Boolean); }
function evaluate(input, now = Date.now()) {
  input = input || {};
  const catalog = values(input.menuItems), categories = values(input.categories), availability = input.publicOrderStatus || {};
  const activeItems = catalog.filter(item => item.active !== false && item.available !== false).length;
  const projectionAge = now - Number(availability.updatedAt || 0), projectionCurrent = typeof availability.acceptingOrders === "boolean" && projectionAge >= 0 && projectionAge < 36 * 3600000;
  const recentOrders = values(input.orders), trackedOrders = recentOrders.filter(order => typeof order.status === "string" && order.status.trim());
  const checks = [
    row("customer_catalog", "Customer menu catalog", activeItems > 0 && categories.length > 0 ? "passed" : "blocked", `${activeItems} active menu item(s); ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`),
    row("order_availability", "Online-order availability projection", projectionCurrent ? "passed" : "blocked", projectionCurrent ? `Current public state: ${availability.acceptingOrders ? "accepting orders" : "not accepting orders"}` : "The public cashier/shift projection is missing or stale"),
    row("reservation_calendar", "Reservation calendar data path", input.calendarReadable ? "passed" : "blocked", input.calendarReadable ? `${Number(input.calendarBlockCount || 0)} configured blocked date(s); an empty block list is valid` : "Reservation calendar data could not be read"),
    row("customer_reviews", "Customer review data path", input.reviewsReadable ? "passed" : "blocked", input.reviewsReadable ? `${Number(input.reviewCount || 0)} review record(s); an empty review list is valid` : "Review data could not be read"),
    row("payment_configuration", "Checkout payment configuration", values(input.payment).length || Object.keys(input.payment || {}).length ? "passed" : "blocked", Object.keys(input.payment || {}).length ? "Payment configuration is present; secrets and account values are not returned" : "Checkout payment configuration is missing"),
    row("order_tracker_projection", "Online-order tracker projection", recentOrders.length === 0 || trackedOrders.length > 0 ? "passed" : "pending", recentOrders.length === 0 ? "No recent orders require projection evidence" : `${trackedOrders.length} bounded public tracker projection(s) available for ${recentOrders.length} recent order(s)`),
    row("phase16_gate", "Phase 16 release gate", input.certification && input.certification.readyForOperatorReview === true ? "passed" : "blocked", `Phase 16 status: ${String(input.certification && input.certification.status || "missing").replace(/_/g, " ")}`),
    row("customer_journey", "Witnessed customer journey", "operator_required", "Menu → checkout → POS acceptance → tracker → completion must be witnessed without fictitious financial activity"),
    row("pwa_offline", "PWA update and offline recovery", "operator_required", "Install/update, cache migration, offline sale recovery, and reconnect idempotency require device evidence"),
    row("finance_reconciliation", "Post-validation financial reconciliation", "operator_required", "Inventory, cash custody, AR, AP, Finance movements, and Books must remain reconciled at the same cut-off"),
    row("correction_reversal", "Correction, return, and reversal controls", "operator_required", "Use controlled non-production or genuine business cases; confirm source links, reversal trails, and duplicate protection"),
    row("qualified_review", "Independent financial sign-off", "operator_required", "A qualified reviewer must approve the reconciliation evidence")
  ];
  const blocked = checks.filter(item => item.status === "blocked").length, pending = checks.filter(item => item.status === "pending").length, operatorRequired = checks.filter(item => item.status === "operator_required").length;
  return {schemaVersion: 1, generatedAt: now, status: blocked ? "blocked" : "operator_validation_required", counts: {passed: checks.filter(item => item.status === "passed").length, blocked, pending, operatorRequired}, scope: {activeMenuItems: activeItems, categories: categories.length, recentOrders: recentOrders.length, trackerProjections: trackedOrders.length}, checks, safeMode: "read_only", productionValidated: false};
}

module.exports = {evaluate};
