"use strict";

const CASHIER_MANAGER = "cashier_manager";
const MANAGER_ONLY = "manager_only";

function normalizedMethod(value) {return String(value || "").trim().toLowerCase();}
function isCashMethod(value) {return normalizedMethod(value) === "cash";}
function isPlatformMethod(value) {return ["grabfood", "foodpanda"].includes(normalizedMethod(value));}
function directPaymentRows(payments) {
  return (Array.isArray(payments) ? payments : []).filter((row) => row && !isCashMethod(row.method) && !isPlatformMethod(row.method));
}
function defaultPolicy(method) {return /gcash|maya/i.test(String(method || "")) ? CASHIER_MANAGER : MANAGER_ONLY;}
function methodPolicy(method, payMethods) {
  const key = normalizedMethod(method), configured = (Array.isArray(payMethods) ? payMethods : []).find((row) => normalizedMethod(row && row.name) === key), value = configured && configured.verificationPolicy;
  return value === CASHIER_MANAGER || value === MANAGER_ONLY ? value : defaultPolicy(method);
}
function paymentPolicy(payments, payMethods) {
  const direct = directPaymentRows(payments);
  if (!direct.length) return null;
  return direct.some((row) => methodPolicy(row.method, payMethods) === MANAGER_ONLY) ? MANAGER_ONLY : CASHIER_MANAGER;
}

module.exports={CASHIER_MANAGER,MANAGER_ONLY,directPaymentRows,defaultPolicy,methodPolicy,paymentPolicy};
