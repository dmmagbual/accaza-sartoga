
/* ══════════ DEDUCTION ENGINE ══════════ */
function computeUsage(lineItems){
  var result=Costing().costOrder(costingContext({lineItems:lineItems||[]}));
  if(!result.ok)throw new Error(costingIssues(result.errors));
  window.__lastCostingResult=result;
  return result.usage;
}
