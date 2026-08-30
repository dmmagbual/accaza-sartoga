
// Reconciles the one-to-one link between an on-account purchase invoice and
// its payable. Safe to retry: the invoice, payable and financial movement use
// deterministic IDs, while legacy/manual matches are linked instead of copied.
async function purchaseInventoryLines(db, invoice, credit) {
  const inventorySnap = await db.ref("/inventory").get(), inventory = inventorySnap.val() || {}, totals = {};
  (Array.isArray(invoice && invoice.lines) ? invoice.lines : []).forEach((line) => {const expense=line&&line.lineType==="expense",fixedAsset=line&&line.lineType==="fixed_asset",expenseCode=String(line&&line.expenseAccount||""),item=inventory[line.itemId]||{},mapping=BooksBridge.itemAccounts(item),code=fixedAsset?(line.assetCategory==="furniture"?"1510":"1500"):expense?(["6070","6075"].includes(expenseCode)?expenseCode:""):mapping.inventory||"1290",value=Financial.money(line.total);if(expense&&!code)throw new HttpsError("failed-precondition", "A one-time purchase expense has an invalid Finance Books account.");if(value>0)totals[code]=Financial.money((totals[code]||0)+value);});
  const expected=Financial.money(invoice&&invoice.total),found=Financial.money(Object.values(totals).reduce((sum,value)=>sum+value,0)),gap=Financial.money(expected-found);if(gap)totals["1290"]=Financial.money((totals["1290"]||0)+gap);
  return Object.keys(totals).filter((code)=>totals[code]>0).sort().map((code)=>Financial.line(`coa:${code}`,credit?0:totals[code],credit?totals[code]:0,invoice.supplier||"Purchase"));
}
