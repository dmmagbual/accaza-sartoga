
exports.postFinancialCommand = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => observeFinancialOperation(request, "postFinancialCommand", async () => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 40);
    const perms = action.indexOf("inventory_opening_balance") === 0 ? ["purchases", "cashflow"] : action.includes("payable") ? ["payables", "purchases"] : action.includes("receivable") ? ["receivables"] : ["cashflow", "receivables", "payables", "purchases"];
    const actor = await requirePortalPermission(db, request, perms); const commandId = financeKey(data.commandId, "Command ID");
    if(action==='cash_journal_edit_status'){
      if(!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError('permission-denied','A privileged Finance role is required to verify a cash-journal edit.');
      const editCommandId=financeKey(data.editCommandId,'Edit submission ID'),movementId=financeKey(data.originalMovementId,'Journal ID'),receipt=(await db.ref(`/cashJournalEditCommands/${editCommandId}`).get()).val();
      return{committed:!!(receipt&&receipt.movementId===movementId&&receipt.actorUid===actor.uid),movementId:receipt&&receipt.movementId||'',revision:Number(receipt&&receipt.revision||0)};
    }
    if(action==='cash_journal_history'){
      if(!['owner','superadmin','admin','manager'].includes(actor.role))throw new HttpsError('permission-denied','A privileged Finance role is required to view cash-journal revisions.');
      const id=financeKey(data.originalMovementId,'Journal ID');return{revisions:(await db.ref(`/cashJournalRevisions/${id}`).get()).val()||{}};
    }
    const accounts = (await db.ref("/cfAccounts").get()).val() || {}, chart = await ensureChartAccounts(db); const now = Date.now(); let movement, writes = {}, result = {}, depositReferenceClaim = null, movementIdOverride = null;
    function amount(v) { const x = Financial.money(v); if (!(x > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero."); return x; }
    function addCash(id, entry) { writes[`cfLedger/${id}`] = cashLedgerRecord(entry, movementIdOverride || commandId, movement, actor); }
    function manualCashWrites(target,movementId,mv,date,cashLines,category,party,reference){(cashLines||[]).forEach(({mapped,dr,cr,index})=>{if(mapped.cashKey==="float")return;const value=Financial.money(dr-cr);if(!value)return;const accountId=mapped.cashKey==="register"?"register":mapped.cashKey==="undeposited"?"undeposited":mapped.cashKey==="petty"?"petty":mapped.cashKey;target[`cfLedger/fm_${movementId}_${index}`]=cashLedgerRecord({date,accountId,dir:value>0?"in":"out",category,amount:Math.abs(value),party,ref:reference,auto:category!=="Manual journal"},movementId,mv,actor);});}
    if (action === "inventory_opening_balance") {
      const inventory = (await db.ref("/inventory").get()).val() || {}, journal = (await db.ref("/books/journal").get()).val() || {}, reconciliation = BooksBridge.inventoryReconciliationSnapshot(inventory, journal);
      if (reconciliation.unmapped.length) throw new HttpsError("failed-precondition", `${reconciliation.unmapped.length} stock item(s) with value are missing an inventory account. Map them before posting.`);
      if (Math.abs(reconciliation.clearingBalance) >= 0.005) throw new HttpsError("failed-precondition", `Inventory Receiving Clearing 1290 must be zero before posting. Current balance: ${reconciliation.clearingBalance}.`);
      const existing = (await db.ref("/inventoryReconciliations/openingBalance").get()).val();
      if (data.preview === true) return Object.assign({alreadyPosted:!!existing}, reconciliation);
      if (existing) throw new HttpsError("already-exists", "The inventory opening balance has already been posted.");
      const expected = Financial.money(data.expectedDifference);
      if (Math.abs(expected - reconciliation.totalDifference) >= 0.005) throw new HttpsError("failed-precondition", "Inventory or Books changed after preview. Refresh and review the new reconciliation before posting.");
      const lines=[];reconciliation.rows.forEach((row)=>{if(Math.abs(row.difference)<0.005)return;lines.push(Financial.line(`coa:${row.code}`,row.difference>0?row.difference:0,row.difference<0?-row.difference:0,`Opening inventory reconciliation ${row.code}`));});
      if (reconciliation.totalDifference>0) lines.push(Financial.line("equity:opening_balance",0,reconciliation.totalDifference,"Opening inventory balance"));
      else if (reconciliation.totalDifference<0) lines.push(Financial.line("equity:opening_balance",-reconciliation.totalDifference,0,"Opening inventory balance"));
      if (!lines.length || !BooksBridge.linesBalanced(lines)) throw new HttpsError("failed-precondition", "The calculated opening inventory entry is empty or unbalanced.");
      const date=financeDate(data.date),occurredAt=Date.parse(`${date}T00:00:00+08:00`)||now,movementId="inventory_opening_balance";
      movement=Financial.movement("inventory_opening_balance","inventoryReconciliation","openingBalance",lines,{occurredAt,actorName:actor.role});
      writes["inventoryReconciliations/openingBalance"]={movementId,date,stockValue:reconciliation.totalStock,booksValueBefore:reconciliation.totalBooks,adjustment:reconciliation.totalDifference,rows:reconciliation.rows,postedAt:now,postedBy:actor.uid,postedRole:actor.role,schemaVersion:1};
      result={stockValue:reconciliation.totalStock,booksValueBefore:reconciliation.totalBooks,adjustment:reconciliation.totalDifference,rows:reconciliation.rows};
      const committed = await commitFinancial(db,movementId,movement,actor,writes);return Object.assign(result,{movementId,duplicate:committed.duplicate});
    } else if (action === "inventory_opening_balance_repost") {
      const inventory = (await db.ref("/inventory").get()).val() || {}, journal = (await db.ref("/books/journal").get()).val() || {}, reconciliation = BooksBridge.inventoryReconciliationSnapshot(inventory, journal);
      const existing = (await db.ref("/inventoryReconciliations/openingBalance").get()).val();
      if (data.preview === true) return Object.assign({canRepost: !!(existing && existing.movementId)}, reconciliation);
      if (!existing || !existing.movementId) throw new HttpsError("failed-precondition", "There is no posted opening inventory balance to re-post.");
      if (reconciliation.unmapped.length) throw new HttpsError("failed-precondition", `${reconciliation.unmapped.length} stock item(s) with value are missing an inventory account. Map them before re-posting.`);
      const original = (await db.ref(`/financialMovements/${financeKey(existing.movementId, "Opening movement ID")}`).get()).val();
      if (!original || !Array.isArray(original.lines)) throw new HttpsError("failed-precondition", "The prior opening balance movement is missing; cannot reverse it cleanly.");
      const seq = Number(existing.repostSeq || 0) + 1, date = financeDate(data.date), occurredAt = Date.parse(`${date}T00:00:00+08:00`) || now;
      const oldRows = {};
      original.lines.forEach((l) => { const m = /^coa:(\d{4})$/.exec(String(l.account || "")); if (m) oldRows[m[1]] = Financial.money((oldRows[m[1]] || 0) + Number(l.debit || 0) - Number(l.credit || 0)); });
      const reversal = Financial.reverseMovement(original, "inventory_opening_balance_reversal", "Reverse prior opening inventory");
      reversal.occurredAt = occurredAt; reversal.reversesMovementId = existing.movementId;
      const reversalId = `inventory_opening_balance_reversal_${seq}`;
      // Include 1290 clearing (physical stock 0) so the re-post also zeroes any parked
      // COGS/receiving balance in one action - no separate Books rebuild required.
      const rebalanceRows = reconciliation.rows.concat([{code: "1290", stockValue: 0, booksValue: reconciliation.clearingBalance}]);
      const freshLines = BooksBridge.openingRebalanceLines(rebalanceRows, oldRows).map((l) => Financial.line(l.account, l.debit, l.credit, l.label));
      if (!freshLines.length || !BooksBridge.linesBalanced(freshLines)) throw new HttpsError("failed-precondition", "The recomputed opening inventory entry is empty or unbalanced.");
      const freshId = `inventory_opening_balance_v${seq}`, fresh = Financial.movement("inventory_opening_balance", "inventoryReconciliation", "openingBalance", freshLines, {occurredAt, actorName: actor.role, repostSeq: seq});
      const extra = {};
      extra[`inventoryReconciliations/history/${now}_${financeKey(existing.movementId, "Opening movement ID")}`] = Object.assign({}, existing, {archivedAt: now, archivedBy: actor.uid});
      extra["inventoryReconciliations/openingBalance"] = {movementId: freshId, repostSeq: seq, reversedMovementId: existing.movementId, reversalMovementId: reversalId, date, stockValue: reconciliation.totalStock, booksValueBefore: reconciliation.totalBooks, adjustment: reconciliation.totalDifference, rows: reconciliation.rows, postedAt: now, postedBy: actor.uid, postedRole: actor.role, schemaVersion: 1};
      await commitFinancial(db, reversalId, reversal, actor);
      const committed = await commitFinancial(db, freshId, fresh, actor, extra);
