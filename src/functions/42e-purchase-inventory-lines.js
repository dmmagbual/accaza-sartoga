
// Reconciles the one-to-one link between an on-account purchase invoice and
// its payable. Safe to retry: the invoice, payable and financial movement use
// deterministic IDs, while legacy/manual matches are linked instead of copied.
async function purchaseInventoryLines(db, invoice, credit) {
  // Only the inventory items on the invoice lines are read.
  const lines = Array.isArray(invoice && invoice.lines) ? invoice.lines : [], inventory = {}, totals = {};
  const [chart] = await Promise.all([ensureBooksChart(db), ...[...new Set(lines.map((line) => String(line && line.itemId || "")).filter((id) => TrackedRead.trackable(id)))].map(async (id) => { const item = (await db.ref(`/inventory/${id}`).get()).val(); if (item !== null && item !== undefined) inventory[id] = item; })]);
  lines.forEach((line) => {const expense=line&&line.lineType==="expense",fixedAsset=line&&line.lineType==="fixed_asset",expenseCode=String(line&&line.expenseAccount||""),item=inventory[line.itemId]||{},mapping=BooksBridge.itemAccounts(item),account=chart[expenseCode],validExpense=account&&account.active!==false&&account.type==="Expense"&&/^6\d{3}$/.test(expenseCode)&&expenseCode!=="6110",code=fixedAsset?(line.assetCategory==="furniture"?"1510":"1500"):expense?(validExpense?expenseCode:""):mapping.inventory||"1290",value=Financial.money(line.total);if(expense&&!code)throw new HttpsError("failed-precondition", "Select an active 6000-series operating-expense account for every one-time purchase expense. Cash Short / Over is controlled separately.");if(value>0)totals[code]=Financial.money((totals[code]||0)+value);});
  const expected=Financial.money(invoice&&invoice.total),found=Financial.money(Object.values(totals).reduce((sum,value)=>sum+value,0)),gap=Financial.money(expected-found);if(gap)totals["1290"]=Financial.money((totals["1290"]||0)+gap);
  return Object.keys(totals).filter((code)=>totals[code]>0).sort().map((code)=>Financial.line(`coa:${code}`,credit?0:totals[code],credit?totals[code]:0,invoice.supplier||"Purchase"));
}
