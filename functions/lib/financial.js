"use strict";

// Single source of truth for the double-entry balance tolerance (centavo precision).
// A balanced movement of r2 peso amounts always differs by exactly 0; any real
// imbalance is >= 0.01, so this rejects nothing a 0.009 check accepted.
const BALANCE_EPSILON = 0.005;

function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function safe(value) { return String(value == null ? "" : value).trim().slice(0, 160); }
function line(account, debit, credit, label) {
  return {account: safe(account), debit: money(debit), credit: money(credit), label: safe(label)};
}
function totals(lines) {
  return (lines || []).reduce((out, item) => {
    out.debit = money(out.debit + money(item.debit));
    out.credit = money(out.credit + money(item.credit));
    return out;
  }, {debit: 0, credit: 0});
}
function assertBalanced(lines) {
  const sum = totals(lines);
  if (Math.abs(sum.debit - sum.credit) > BALANCE_EPSILON) throw new Error(`Unbalanced financial movement: debit ${sum.debit}, credit ${sum.credit}`);
  return sum;
}
function paymentRows(order) {
  const rows = Array.isArray(order && order.payments) && order.payments.length ? order.payments : [{method: order && order.payment, amount: order && order.total}];
  return rows.map((row) => ({method: safe(row.method || "Unknown"), paymentMethod:safe(row.paymentMethod||row.method||"Unknown"),receivingAccountId:safe(row.receivingAccountId),receivingAccountName:safe(row.receivingAccountName), amount: money(row.amount)})).filter((row) => row.amount > 0);
}
function accountForMethod(method, accounts) {
  const wanted = safe(method).toLowerCase(); let match = "";
  Object.keys(accounts || {}).forEach((id) => {
    const methods = Array.isArray(accounts[id] && accounts[id].feedMethods) ? accounts[id].feedMethods : [];
    const accountName=safe(accounts[id]&&accounts[id].name).toLowerCase();
    if (methods.some((name) => safe(name).toLowerCase() === wanted)||(accountName&&wanted.endsWith(` · ${accountName}`))) match = id;
  });
  return match;
}
function accountForPayment(payment,accounts){
  payment=payment||{};const selected=safe(payment.receivingAccountId);
  if(selected&&accounts&&accounts[selected])return selected;
  return accountForMethod(payment.paymentMethod||payment.method,accounts);
}

function unmappedOrderPayments(order, accounts) {
  order = order || {};
  const status = order.status === "Archived" ? order.prevStatus : order.status;
  const channel = safe(order.channel).toLowerCase();
  if (order.voided || !["Completed", "Received"].includes(status) || order.paymentStatus === "pending" || ["grabfood", "foodpanda"].includes(channel)) return [];
  return paymentRows(order).filter((payment) => payment.method.toLowerCase() !== "cash" && !accountForPayment(payment, accounts || {}));
}
// BIR tax split. The server derives the effective tax from /taxSettings with an
// effective-date wall (sales completed before effectiveAt keep their original
// treatment). Inclusive (default): prices contain the tax — VAT revenue is credited
// net with the VAT portion to liability:output_vat, percentage tax books a balanced
// expense/liability pair. Exclusive: tax is added on top — the menu subtotal is the
// net sale and the collected add-on goes straight to the payable. Refunds reverse the
// same split so the orderNetSales === sourceNetSales audit identity holds on both legs.
function effectiveTaxFor(taxSettings, occurredAt) {
  taxSettings = taxSettings || {};
  if (taxSettings.mode !== "vat" && taxSettings.mode !== "percentage") return null;
  if (Number(taxSettings.effectiveAt || 0) > Number(occurredAt) || Number(occurredAt || 0) <= 0) return null;
  const fallback = taxSettings.mode === "vat" ? 12 : 3;
  const rate = Number(taxSettings.mode === "vat" ? taxSettings.vatRate : taxSettings.percentageRate);
  return {mode: taxSettings.mode, rate: Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : fallback, inclusive: taxSettings.inclusive !== false};
}
function taxSplit(base, tax) {
  base = money(base);
  const mode = tax && tax.mode;
  if ((mode !== "vat" && mode !== "percentage") || !(base > 0)) return {mode: "", base, rate: 0, taxAmount: 0, net: base, inclusive: true};
  const rate = Number(tax.rate) > 0 ? Number(tax.rate) : (mode === "vat" ? 12 : 3);
  // base is always the amount actually charged. VAT extraction is the same formula
  // whether the tax sat inside the price or was added on top. Percentage tax differs:
  // inclusive carves rate% of the charged amount (the shelf price is the gross sale);
  // exclusive takes rate/(100+rate) because the add-on inflated the collection.
  if (mode === "vat") {const taxAmount = money(base - base / (1 + rate / 100)); return {mode, base, rate, taxAmount, net: money(base - taxAmount), inclusive: tax.inclusive !== false};}
  const inclusive = tax.inclusive !== false;
  const taxAmount = inclusive ? money(base * rate / 100) : money(base * rate / (100 + rate));
  return {mode, base, rate, taxAmount, net: inclusive ? base : money(base - taxAmount), inclusive};
}
// Tax base = the amount actually collected for the sale: customer payment total
// in-store, gross platform sale online (platforms report and remit on gross).
function orderTaxBase(order) {
  order = order || {};
  const channel = safe(order.channel).toLowerCase(), platform = channel === "grabfood" || channel === "foodpanda";
  return money(platform ? (order.grossPlatform != null ? order.grossPlatform : (order.subtotal != null ? order.subtotal : order.total)) : order.total);
}
// Output VAT currently attributable to the order after refunds: full VAT less
// the VAT already reversed on refunds. Mirrors the movement math exactly
// (same money() rounding steps) so close/reconciliation never drifts a cent.
function orderOutputVat(order, tax) {
  if (!tax || tax.mode !== "vat") return 0;
  const base = orderTaxBase(order), refund = money(order && order.refundAmount);
  return money(Math.max(0, money(taxSplit(base, tax).taxAmount - taxSplit(refund, tax).taxAmount)));
}
function orderPosting(order, accounts, tax) {
  order = order || {}; const id = safe(order.id); if (!id) throw new Error("Order ID is required.");
  const channel = safe(order.channel || "instore").toLowerCase();
  const platform = channel === "grabfood" || channel === "foodpanda";
  const lines = [], cashEntries = [], warnings = [];
  let taxStamp = null;
  if (platform) {
    const gross = money(order.grossPlatform != null ? order.grossPlatform : (order.subtotal != null ? order.subtotal : order.total));
    const commission = money(order.commission), discount = money(order.platformDiscount), wht = money(order.platformWht), vat = money(order.platformVat), adsMarketing=money(order.platformAdsMarketing), marketingFee=money(order.platformMarketingFee);
    const hasMappedDiscounts = order.platformMerchantPromo != null || order.platformDeliveryFeeDiscount != null;
    const merchantPromo = hasMappedDiscounts ? money(order.platformMerchantPromo) : 0;
    const deliveryFeeDiscount = hasMappedDiscounts ? money(order.platformDeliveryFeeDiscount) : 0;
    const unmappedDiscount = money(discount - merchantPromo - deliveryFeeDiscount);
    const net = money(order.netPlatform != null ? order.netPlatform : gross - commission - discount - wht - vat - adsMarketing - marketingFee);
    lines.push(line(`asset:platform_receivable:${channel}`, net, 0, "Platform receivable"));
    if (commission) lines.push(line("expense:platform_commission", commission, 0, "Platform commission"));
    if (merchantPromo) lines.push(line("revenue:platform_discount", merchantPromo, 0, "Merchant-funded promo"));
    if (deliveryFeeDiscount) lines.push(line("revenue:platform_discount", deliveryFeeDiscount, 0, "Delivery fee discount"));
    if (unmappedDiscount) lines.push(line("expense:platform_discount", unmappedDiscount, 0, "Legacy/unclassified platform discount"));
    if (adsMarketing) lines.push(line("expense:platform_variance:va_ads", adsMarketing, 0, "Platform marketing / advertisements"));
    if (marketingFee) lines.push(line("expense:platform_variance:va_marketing_success", marketingFee, 0, "Platform marketing fee"));
    if (wht) lines.push(line("asset:withholding_tax", wht, 0, "Withholding tax receivable"));
    if (vat) lines.push(line("expense:platform_service_vat", vat, 0, "Platform service VAT"));
    const debits = totals(lines).debit;
    if (Math.abs(debits - gross) > 0.009) lines.push(line(debits < gross ? "expense:platform_estimate_variance" : "revenue:platform_estimate_variance", debits < gross ? money(gross - debits) : 0, debits > gross ? money(debits - gross) : 0, "Platform estimate rounding/variance"));
    // Platforms set the final price, so platform sales are always tax-inclusive:
    // the reported gross already contains the tax — an exclusive add-on never happens there.
    const split = taxSplit(gross, Object.assign({}, tax, {inclusive: true}));
    if (split.mode === "vat" && split.taxAmount > 0) {
      lines.push(line("revenue:sales", 0, split.net, "Platform net sales (VAT-exclusive)"));
      lines.push(line("liability:output_vat", 0, split.taxAmount, "Output VAT"));
      taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: true};
    } else {
      lines.push(line("revenue:sales", 0, gross, "Platform gross sales"));
      if (split.mode === "percentage" && split.taxAmount > 0) {
        lines.push(line("expense:percentage_tax", split.taxAmount, 0, "Percentage tax"));
        lines.push(line("liability:percentage_tax", 0, split.taxAmount, "Percentage tax payable"));
        taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: true};
      }
    }
  } else {
    const payments = paymentRows(order), total = money(order.total), discount = money(order.discount), loyaltyDiscount = money(order.loyaltyDiscount), prepaidRefund = money(order.preCompletionCashRefund && order.preCompletionCashRefund.amount);
    const gross = money(order.subtotal != null ? order.subtotal : total + discount + loyaltyDiscount);
    payments.forEach((payment, index) => {
      const isCash = payment.method.toLowerCase() === "cash";
      const accountId = isCash ? "" : accountForPayment(payment, accounts);
      const asset = isCash ? "asset:register_cash" : (accountId ? `asset:cash_account:${accountId}` : `asset:unmapped_payment:${payment.method.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
      lines.push(line(asset, payment.amount, 0, payment.method));
      if (!isCash && accountId) {const slug = payment.method.replace(/[^A-Za-z0-9]/g, "") || String(index); cashEntries.push({id: `cfauto_${id}_${slug}`, accountId, dir: "in", amount: payment.amount, category: `Sale · ${payment.method}`, method: payment.method});}
      if (!isCash && !accountId) warnings.push(`No cash-flow account mapping for ${payment.method}.`);
    });
    const paid = totals(lines).debit;
    if (prepaidRefund > 0) {
      if (Math.abs(paid - total - prepaidRefund) > 0.009) throw new Error("Confirmed payment, corrected sale, and pre-completion cash refund do not reconcile.");
      lines.push(line(`liability:customer_change_refund:${id}`, 0, prepaidRefund, "Confirmed overpayment due back to customer"));
    } else if (Math.abs(paid - total) > 0.009) lines.push(line(paid < total ? "asset:unmapped_payment:balance" : "revenue:payment_overage", paid < total ? money(total - paid) : 0, paid > total ? money(paid - total) : 0, "Payment allocation difference"));
    if (discount) lines.push(line("expense:customer_discount", discount, 0, "Customer discount"));
    if (loyaltyDiscount) lines.push(line("expense:loyalty_discount", loyaltyDiscount, 0, order.loyaltyRewardId ? `Loyalty reward · ${safe(order.loyaltyRewardId)}` : "Loyalty reward discount"));
    const split = taxSplit(total, tax);
    if (split.mode === "vat" && split.taxAmount > 0) {
      // Exclusive: the menu subtotal is already the net sale, so revenue is credited
      // in full and only the collected add-on goes to output VAT.
      lines.push(line("revenue:sales", 0, split.inclusive === false ? gross : money(gross - split.taxAmount), channel === "online" ? "Online net sales (VAT-exclusive)" : "In-store net sales (VAT-exclusive)"));
      lines.push(line("liability:output_vat", 0, split.taxAmount, split.inclusive === false ? "Output VAT (added on top)" : "Output VAT"));
      taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: split.inclusive};
    } else {
      lines.push(line("revenue:sales", 0, gross, channel === "online" ? "Online order gross sales" : "In-store gross sales"));
      if (split.mode === "percentage" && split.taxAmount > 0) {
        if (split.inclusive === false) {
          // Exclusive: the customer paid this tax on top, so it is a pure payable —
          // no expense pair; revenue stays at the menu subtotal.
          lines.push(line("liability:percentage_tax", 0, split.taxAmount, "Percentage tax payable (added on top)"));
        } else {
          lines.push(line("expense:percentage_tax", split.taxAmount, 0, "Percentage tax"));
          lines.push(line("liability:percentage_tax", 0, split.taxAmount, "Percentage tax payable"));
        }
        taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: split.inclusive};
      }
    }
  }
  const sum = assertBalanced(lines);
  return {type: "order_sale", sourceType: "order", sourceId: id, channel, amount: sum.credit, lines, cashEntries, warnings, tax: taxStamp};
}
function reversalPosting(order, amount, kind, accounts, settlementPayments, tax) {
  order = order || {}; const value = money(amount); if (!(value > 0)) throw new Error("Reversal amount must be positive.");
  const channel = safe(order.channel || "instore").toLowerCase(); const platform = channel === "grabfood" || channel === "foodpanda"; const lines = [], cashEntries = [], warnings = [];
  // Refunds reverse the same tax split as the original sale: the VAT portion
  // comes off output VAT payable (not sales reversal) so sourceNetSales still
  // equals orderNetSales; percentage tax reverses its own pair. Platform sales
  // are always tax-inclusive (the platform set the final price), and exclusive
  // percentage tax reverses only the payable because no expense was ever booked.
  const split = taxSplit(value, platform ? Object.assign({}, tax, {inclusive: true}) : tax);
  let taxStamp = null;
  if (split.mode === "vat" && split.taxAmount > 0) {
    lines.push(line("revenue:sales_reversal", split.net, 0, kind === "void" ? "Voided sale (net of VAT)" : "Sales refund (net of VAT)"));
    lines.push(line("liability:output_vat", split.taxAmount, 0, "Reverse output VAT"));
    taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: split.inclusive};
  } else if (split.mode === "percentage" && split.inclusive === false && split.taxAmount > 0) {
    lines.push(line("revenue:sales_reversal", split.net, 0, kind === "void" ? "Voided sale (net of added tax)" : "Sales refund (net of added tax)"));
    lines.push(line("liability:percentage_tax", split.taxAmount, 0, "Reverse percentage tax"));
    taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: split.inclusive};
  } else {
    lines.push(line("revenue:sales_reversal", value, 0, kind === "void" ? "Voided sale" : "Sales refund"));
    if (split.mode === "percentage" && split.taxAmount > 0) {
      lines.push(line("liability:percentage_tax", split.taxAmount, 0, "Reverse percentage tax"));
      lines.push(line("expense:percentage_tax", 0, split.taxAmount, "Reverse percentage tax"));
      taxStamp = {mode: split.mode, rate: split.rate, base: split.base, amount: split.taxAmount, inclusive: split.inclusive};
    }
  }
  if (platform) lines.push(line(`asset:platform_receivable:${channel}`, 0, value, "Reduce platform receivable"));
  else {
    let settlements = Array.isArray(settlementPayments) ? settlementPayments.map((row) => ({method: safe(row.method), amount: money(row.amount)})).filter((row) => row.method && row.amount > 0) : [];
    if (!settlements.length) {const payments = paymentRows(order), cash = payments.find((row) => row.method.toLowerCase() === "cash"), chosen = cash || payments[0] || {method: "Cash"}; settlements = [{method: chosen.method,paymentMethod:chosen.paymentMethod,receivingAccountId:chosen.receivingAccountId,receivingAccountName:chosen.receivingAccountName, amount: value}];}
    if (Math.abs(settlements.reduce((sum, row) => money(sum + row.amount), 0) - value) > 0.009) throw new Error("Refund/void tender allocations must equal the reversal amount.");
    settlements.forEach((chosen) => {if (chosen.method.toLowerCase() === "cash") lines.push(line("asset:register_cash", 0, chosen.amount, "Refund/void settlement")); else { const accountId = accountForPayment(chosen, accounts || {}); lines.push(line(accountId ? `asset:cash_account:${accountId}` : `asset:unmapped_payment:${chosen.method.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, 0, chosen.amount, "Refund/void settlement")); if (accountId) cashEntries.push({id: "", accountId, dir: "out", amount: chosen.amount, category: kind === "void" ? "Void reversal" : "Refund", method: chosen.method}); else warnings.push(`No cash-flow account mapping for ${chosen.method}.`); }});
  }
  assertBalanced(lines);
  return {type: kind === "void" ? "order_void" : "order_refund", sourceType: "order", sourceId: safe(order.id), channel, amount: value, lines, cashEntries, warnings, tax: taxStamp, settlementPayments: Array.isArray(settlementPayments) ? settlementPayments : []};
}
function movement(type, sourceType, sourceId, lines, extra) {
  assertBalanced(lines); return Object.assign({type: safe(type), sourceType: safe(sourceType), sourceId: safe(sourceId), amount: totals(lines).debit, lines, warnings: []}, extra || {});
}

function reverseMovement(original, type, label) {
  original = original || {};
  const lines = (original.lines || []).map((item) => line(item.account, item.credit, item.debit, `${safe(label || "Reverse")} · ${safe(item.label || original.sourceId)}`));
  return movement(type || "movement_reversal", original.sourceType || "unknown", original.sourceId || "", lines, {occurredAt: Number(original.occurredAt || original.postedAt || Date.now()), channel: original.channel || "", reversesMovementId: original.id || ""});
}

function netMovementCorrection(movements, sourceId, type, label) {
  const balances = {};
  (movements || []).filter((item) => item && String(item.sourceId || "") === String(sourceId || "")).forEach((item) => {
    (item.lines || []).forEach((entry) => {const account = safe(entry.account);if (!account) return;balances[account] = money((balances[account] || 0) + money(entry.debit) - money(entry.credit));});
  });
  const lines = Object.keys(balances).sort().filter((account) => Math.abs(balances[account]) > 0.009).map((account) => {
    const balance = balances[account];
    return line(account, balance < 0 ? Math.abs(balance) : 0, balance > 0 ? balance : 0, `${safe(label || "Correct net balance")} · ${account}`);
  });
  if (!lines.length) return null;
  return movement(type || "net_balance_correction", "order", sourceId, lines, {occurredAt: Date.now(), controlReason: "Reverse only the remaining net balance across all source movements"});
}

function postingDifference(before, after, type, sourceId, label) {
  const balances = {};
  [{movement: before, sign: -1}, {movement: after, sign: 1}].forEach((part) => {
    (part.movement && part.movement.lines || []).forEach((entry) => {
      const account = safe(entry.account); if (!account) return;
      balances[account] = money((balances[account] || 0) + part.sign * (money(entry.debit) - money(entry.credit)));
    });
  });
  const lines = Object.keys(balances).sort().filter((account) => Math.abs(balances[account]) > 0.009).map((account) => {
    const delta = balances[account];
    return line(account, delta > 0 ? delta : 0, delta < 0 ? Math.abs(delta) : 0, `${safe(label || "Correct posting")} · ${account}`);
  });
  if (!lines.length) return null;
  return movement(type || "posting_correction", "order", sourceId, lines, {channel: after && after.channel || before && before.channel || ""});
}

function orderNetSales(order, tax) {
  order = order || {};
  const channel=safe(order.channel).toLowerCase(),platform=channel==="grabfood"||channel==="foodpanda";
  const gross = money(platform&&order.grossPlatform!=null?order.grossPlatform:(order.subtotal != null ? order.subtotal : order.total));
  const discount=platform?(order.netSalesPlatform!=null?money(Math.max(0,gross-money(order.netSalesPlatform))):money(order.platformDiscount)):money(money(order.discount)+money(order.loyaltyDiscount));
  const refund = money(order.refundAmount);
  let net = money(gross - discount - refund);
  if (tax && tax.mode === "vat") {
    // Inclusive: revenue is credited net of VAT, so net sales exclude the remaining
    // output VAT. Exclusive: the menu subtotal is already net, and only the VAT
    // inside a refund left the payable (not revenue), so that VAT is added back.
    net = money(tax.inclusive === false ? net + money(taxSplit(refund, tax).taxAmount) : net - orderOutputVat(order, tax));
  } else if (tax && tax.mode === "percentage" && tax.inclusive === false) {
    // Exclusive percentage tax books revenue at the menu subtotal and refunds
    // reverse it net of the collected add-on, so the tax inside a refund is
    // added back exactly like exclusive VAT.
    net = money(net + money(taxSplit(refund, tax).taxAmount));
  }
  return money(Math.max(0, net));
}

function sourceNetSales(movements, sourceId) {
  let gross = 0, discounts = 0, reversals = 0;
  (movements || []).filter((item) => item && String(item.sourceId || "") === String(sourceId || "")).forEach((item) => {
    (item.lines || []).forEach((entry) => {
      const account = safe(entry.account), debit = money(entry.debit), credit = money(entry.credit);
      if (account === "revenue:sales") gross = money(gross + credit - debit);
      else if (["expense:customer_discount", "expense:platform_discount", "revenue:platform_discount", "expense:loyalty_discount"].includes(account)) discounts = money(discounts + debit - credit);
      else if (account === "revenue:sales_reversal") reversals = money(reversals + debit - credit);
    });
  });
  return money(gross - discounts - reversals);
}

function platformDiscountReclassification(order, originalMovement) {
  order = order || {}; originalMovement = originalMovement || {};
  const legacyAccounts = new Set(["expense:platform_merchant_funded_promo", "expense:platform_delivery_fee_discount"]), credits = [], labels = [];
  (originalMovement.lines || []).forEach((entry) => {
    const account = safe(entry.account), amount = money(money(entry.debit) - money(entry.credit));
    if (!legacyAccounts.has(account) || !(amount > 0)) return;
    credits.push(line(account, 0, amount, `Reclassify ${safe(entry.label || account)} to contra-revenue`));
    labels.push(safe(entry.label || account));
  });
  const total = money(credits.reduce((sum, entry) => sum + entry.credit, 0));
  if (!(total > 0)) return null;
  return movement("sales_discount_reclassification", "order", safe(order.id || originalMovement.sourceId), [line("revenue:platform_discount", total, 0, `Platform sales discounts · ${labels.join(" + ")}`), ...credits], {channel: safe(order.channel || originalMovement.channel), occurredAt: Number(originalMovement.occurredAt || order.timestamp || Date.now()), originalMovementId: safe(originalMovement.id || `sale_${order.id}`), controlReason: "Align platform discounts with Admin net sales without changing cash, receivables, or profit"});
}

/* Rebuild a stored platform payout from its durable payout record. The same
   deterministic payout_<id> movement is used by live settlement and repair. */
function platformPayoutPosting(payout, definitions) {
  payout = payout || {}; definitions = definitions || {};
  const channel = safe(payout.channel).toLowerCase();
  if (channel !== "grabfood" && channel !== "foodpanda") throw new Error("Platform payout channel is invalid.");
  const expected = money(payout.expectedNet), actual = money(payout.actualPayout), allocations = payout.allocations || {}, meta = payout.allocationMeta || {}, refs = payout.allocationRefs || {};
  const owingApplied = money(payout.owingApplied), owingCreated = money(payout.owing != null ? payout.owing : (actual < 0 ? -actual : 0));
  const lines = [];
  if (actual < 0) lines.push(line(`liability:platform_owing:${channel}`, 0, owingCreated, "Owing to platform (penalties exceeded payout)"));
  else {lines.push(line(`asset:platform_clearing:${channel}`, actual, 0, "Actual payout clearing"));if (owingApplied > 0) lines.push(line(`liability:platform_owing:${channel}`, owingApplied, 0, "Recover prior owing to platform"));}
  Object.keys(allocations).sort().forEach((id) => {const value=money(allocations[id]);if (!(value>0)) return;const def=meta[id]||definitions[id]||{},sourceRef=safe(def.sourceRef||refs[id]),name=safe(def.name||id),label=`${name}${sourceRef?` · ${sourceRef}`:""}`;if(def.type==="revenue")lines.push(line(`revenue:platform_variance:${id}`,0,value,label));else lines.push(line(`expense:platform_variance:${id}`,value,0,label));});
  lines.push(line(`asset:platform_receivable:${channel}`, 0, expected, "Settle platform receivable"));
  return movement("platform_payout_settlement", "platformPayout", safe(payout.id), lines, {occurredAt:Number(payout.accountingOccurredAt||payout.settledAt||Date.now()),approvalId:safe(payout.approvalId),approvedBy:safe(payout.approvedBy),reconstructedFromPayoutRecord:payout.reconstructedFromPayoutRecord===true});
}

module.exports = {BALANCE_EPSILON, money, safe, line, totals, assertBalanced, accountForMethod,accountForPayment,unmappedOrderPayments, effectiveTaxFor, taxSplit, orderTaxBase, orderOutputVat, orderPosting, reversalPosting, movement, reverseMovement, netMovementCorrection, postingDifference, orderNetSales, sourceNetSales, platformDiscountReclassification, platformPayoutPosting};
