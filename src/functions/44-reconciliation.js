
exports.ensureFinancialLedger = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["cashflow", "receivables"]);
    const [ordersSnap, archiveSnap, accountsSnap, ledgerSnap, shiftsSnap, vouchersSnap, replenishmentsSnap, pettySettingsSnap, receivablesSnap, payablesSnap, movementsSnap, payoutsSnap, varianceDefsSnap] = await Promise.all([db.ref("/orders").get(), db.ref("/archivedOrders").get(), db.ref("/cfAccounts").get(), db.ref("/cfLedger").get(), db.ref("/shifts").get(), db.ref("/pettyCashVouchers").get(), db.ref("/pettyCashReplenishments").get(), db.ref("/pettyCashSettings").get(), db.ref("/receivables").get(), db.ref("/payables").get(), db.ref("/financialMovements").get(), db.ref("/platformPayouts").get(), db.ref("/platformVarAccounts").get()]);
    const accounts = accountsSnap.val() || {}, legacyLedger = ledgerSnap.val() || {}, all = Object.assign({}, archiveSnap.val() || {}, ordersSnap.val() || {}), originalMovements = movementsSnap.val() || {}; let posted = 0, duplicates = 0, skipped = 0, salesDiscountsReclassified = 0; const serverActor = {uid: "server", role: "server"};
    for (const id of Object.keys(all)) { try {const order = Object.assign({id}, all[id]), result = await postOrderFinancial(db, order, accounts, serverActor); if (result.skipped) skipped++; else if (result.duplicate) duplicates++; else posted++; const orderStatus=order.status==="Archived"?order.prevStatus:order.status,discountReclass=!order.voided&&["Completed","Received"].includes(orderStatus)&&order.paymentStatus!=="pending"?Financial.platformDiscountReclassification(order,originalMovements[`sale_${id}`]):null;if(discountReclass){const movementId=`sales_discount_reclass_${id}`,now=Date.now(),rr=await commitFinancial(db,movementId,discountReclass,serverActor,{[`operationalAudit/${now}_sales_discount_reclass_${id}`]:{action:"platform_sales_discount_reclassified",sourceType:"order",sourceId:id,movementId,originalMovementId:`sale_${id}`,amount:Financial.money(discountReclass.amount),actorUid:actor.uid,ts:now,schemaVersion:1,accounting:"Reclassify platform-funded discounts from selling expense to contra-revenue; no cash, receivable, inventory, or profit change."}});if(rr.duplicate)duplicates++;else{posted++;salesDiscountsReclassified++;}}const refund = Financial.money(order.refundAmount); if (refund > 0) {const movementId = `refund_${id}_${Math.round(refund * 100)}`, movement = Financial.reversalPosting(order, refund, "refund", accounts), writes = {}; movement.occurredAt = Number(order.refundedAt || order.timestamp || Date.now()); if (!legacyLedger[`cfrefund_${id}`]) addOrderCashWrites(writes, movement, movementId, order, serverActor); const rr = await commitFinancial(db, movementId, movement, serverActor, writes); rr.duplicate ? duplicates++ : posted++;} if (order.voided) {const remaining = Financial.money(Math.max(0, Financial.money(order.total) - refund)); if (remaining > 0) {const movementId = `void_${id}`, movement = Financial.reversalPosting(order, remaining, "void", accounts), writes = {}; movement.occurredAt = Number(order.voidedAt || order.timestamp || Date.now()); addOrderCashWrites(writes, movement, movementId, order, serverActor); const vr = await commitFinancial(db, movementId, movement, serverActor, writes); vr.duplicate ? duplicates++ : posted++;}}} catch (error) {logger.error("3C backfill order failed", {id, error: String(error)}); throw new HttpsError("internal", `Backfill stopped at order ${id}. It is safe to retry.`);} }
      let orphanReversed = 0;
      for (const movementId of Object.keys(originalMovements)) {
        const original = originalMovements[movementId] || {}, sourceId = String(original.sourceId || "");
        if (original.type !== "order_sale" || !sourceId || all[sourceId]) continue;
        if (!(original.lines || []).length) continue;
        const reversalId = `orphan_balance_correction_${sourceId}`, reversal = Financial.netMovementCorrection(Object.values(originalMovements), sourceId, "orphan_order_reversal", "Correct orphaned sale balance");
        if (!reversal) continue;
        reversal.actorName = "Automated sales reconciliation"; reversal.controlReason = "Admin order record is authoritative; correct only the remaining source balance";
      const result = await commitFinancial(db, reversalId, reversal, serverActor, {[`operationalAudit/${Date.now()}_orphan_sale_${sourceId}`]: {action: "orphan_sale_reversed", sourceType: "order", sourceId, movementId, reversalId, amount: Financial.money(original.amount), actorUid: actor.uid, ts: Date.now(), schemaVersion: 1}});
      if (result.duplicate) duplicates++; else {posted++; orphanReversed++;}
    }
    const shifts = shiftsSnap.val() || {}; for (const id of Object.keys(shifts)) {await postShiftCashEntries(db, id, shifts[id].payIns || [], "shift_payin"); await postShiftCashEntries(db, id, shifts[id].payOuts || [], "shift_payout"); await backfillShiftVariance(db, id, shifts[id]);}
    const vouchers = vouchersSnap.val() || {}; for (const id of Object.keys(vouchers)) await backfillPettyVoucher(db, id, vouchers[id]);
    const replenishments = replenishmentsSnap.val() || {}; for (const id of Object.keys(replenishments)) await backfillPettyReplenishment(db, id, replenishments[id]);
    for (const id of Object.keys(accounts)) {const account = accounts[id] || {}, occurredAt = Date.parse(`${account.openingDate || ""}T00:00:00+08:00`) || account.ts || Date.now(); await backfillOpeningBalance(db, `opening_cash_${id}`, "cashAccount", id, `asset:cash_account:${id}`, account.opening, occurredAt, `Opening balance — ${financeText(account.name || id, 80)}`);}
    const pettySettings = pettySettingsSnap.val() || {}; await backfillOpeningBalance(db, "opening_petty_cash", "pettyCash", "pettyCash", "asset:petty_cash", pettySettings.openingBalance, pettySettings.updatedAt || Date.now(), "Revolving Fund opening balance");
    const receivables = receivablesSnap.val() || {}; for (const id of Object.keys(receivables)) await backfillFinancialDocument(db, id, receivables[id], true, accounts);
    const payables = payablesSnap.val() || {}; for (const id of Object.keys(payables)) await backfillFinancialDocument(db, id, payables[id], false, accounts);
    const payouts = payoutsSnap.val() || {}, varianceDefs = varianceDefsSnap.val() || {}; let payoutsPosted = 0, payoutDuplicates = 0, settledOrdersLinked = 0; const payoutIssues = [];
    for (const id of Object.keys(payouts).sort()) {
      const payout = Object.assign({id}, payouts[id] || {}), movementId = `payout_${id}`;
      if (!["grabfood", "foodpanda"].includes(String(payout.channel || "").toLowerCase()) || payout.expectedNet == null) {payoutIssues.push({kind:"payout_record_incomplete", payoutId:id});continue;}
      const linkWrites = {};
      if (!payout.reversed) for (const orderId of (Array.isArray(payout.orderIds) ? payout.orderIds : [])) {try {const entry=await findOrder(db,orderId);if ((entry.order.settlementStatus||"unsettled")!=="settled"||entry.order.payoutId!==id){linkWrites[`${entry.node}/${entry.id}/settlementStatus`]="settled";linkWrites[`${entry.node}/${entry.id}/payoutId`]=id;settledOrdersLinked++;}} catch (_) {payoutIssues.push({kind:"payout_order_missing",payoutId:id,orderId});}}
      try {const rebuilt=Financial.platformPayoutPosting(Object.assign({},payout,{reconstructedFromPayoutRecord:true}),varianceDefs), now=Date.now(), auditKey=`operationalAudit/${now}_payout_rebuild_${id}`, result=await commitFinancial(db,movementId,rebuilt,serverActor,Object.assign({},linkWrites,{[auditKey]:{action:"platform_payout_movement_rebuilt",sourceType:"platformPayout",sourceId:id,movementId,channel:payout.channel,expectedNet:Financial.money(payout.expectedNet),actualPayout:Financial.money(payout.actualPayout),orderCount:(payout.orderIds||[]).length,actorUid:actor.uid,ts:now,schemaVersion:1}}));if(result.duplicate){payoutDuplicates++;if(Object.keys(linkWrites).length)await db.ref().update(linkWrites);}else{posted++;payoutsPosted++;}} catch(error){payoutIssues.push({kind:"payout_rebuild_failed",payoutId:id,detail:String(error)});}
    }
    const beforeVoidCorrections=(await db.ref("/financialMovements").get()).val()||{}; let voidBalancesCorrected=0;
    for (const id of Object.keys(all).sort()) {
      const order=all[id]||{}; if(!order.voided||!["grabfood","foodpanda"].includes(String(order.channel||"").toLowerCase()))continue;
      const correction=Financial.netMovementCorrection(Object.values(beforeVoidCorrections),id,"void_balance_correction","Bring voided platform order posting chain to zero");if(!correction)continue;
      correction.occurredAt=Number(order.voidedAt||order.timestamp||Date.now());correction.actorName="Automated platform AR reconciliation";correction.controlReason="Admin Sales marks this order void; correct only the remaining source-specific posting balance";
      const movementId=`void_balance_correction_${id}`,now=Date.now(),result=await commitFinancial(db,movementId,correction,serverActor,{[`operationalAudit/${now}_void_balance_${id}`]:{action:"voided_platform_order_balance_corrected",sourceType:"order",sourceId:id,movementId,channel:order.channel,actorUid:actor.uid,ts:now,schemaVersion:1}});if(result.duplicate)duplicates++;else{posted++;voidBalancesCorrected++;}
    }
    const repairedMovements=(await db.ref("/financialMovements").get()).val()||{}, adminByChannel={grabfood:0,foodpanda:0}, ledgerByChannel={grabfood:0,foodpanda:0};
    Object.values(all).forEach((o)=>{const channel=String(o&&o.channel||"").toLowerCase();if(!["grabfood","foodpanda"].includes(channel)||o.voided||(o.settlementStatus||"unsettled")==="settled")return;adminByChannel[channel]=Financial.money(adminByChannel[channel]+Financial.money(o.netPlatform!=null?o.netPlatform:Financial.money(o.grossPlatform||o.total)-Financial.money(o.commission)));});
    Object.values(repairedMovements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerByChannel[channel]=Financial.money(ledgerByChannel[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));
    const adminTotal=Financial.money(adminByChannel.grabfood+adminByChannel.foodpanda),ledgerTotal=Financial.money(ledgerByChannel.grabfood+ledgerByChannel.foodpanda),platformAr={adminByChannel,ledgerByChannel,adminTotal,ledgerTotal,difference:Financial.money(ledgerTotal-adminTotal),reconciled:Math.abs(ledgerTotal-adminTotal)<0.01,payoutsChecked:Object.keys(payouts).length,payoutsPosted,payoutDuplicates,settledOrdersLinked,voidBalancesCorrected,issues:payoutIssues.slice(0,200)};
    const scanned = Object.keys(all).length + Object.keys(shifts).length + Object.keys(vouchers).length + Object.keys(replenishments).length + Object.keys(accounts).length + Object.keys(receivables).length + Object.keys(payables).length + Object.keys(payouts).length + 1; await db.ref("/systemMaintenance/financialLedgerInitialized").set({at: Date.now(), by: actor.uid, scanned, posted, duplicates, skipped, orphanReversed, salesDiscountsReclassified, platformAr}); return {scanned, posted, duplicates, skipped, orphanReversed, salesDiscountsReclassified, platformAr};
  },
);

exports.manageBooksAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requireBooksChartManager(db, request);
    const data = request.data || {};
    const action = financeText(data.action, 20);
    const chart = await ensureBooksChart(db);
    if (action === "initialize" || action === "list" || !action) return {chart: chart, managerEmail: actor.email};
    const now = Date.now();
    function cleanAccount(input){const code=financeText(input&&input.code,4);if(!/^\d{4}$/.test(code))throw new HttpsError("invalid-argument","Account code must be exactly four digits.");const name=financeText(input&&input.name,100);const type=financeText(input&&input.type,12);if(!name)throw new HttpsError("invalid-argument","Account name is required.");if(!BOOKS_TYPES.includes(type))throw new HttpsError("invalid-argument","Account type must be one of: "+BOOKS_TYPES.join(", ")+".");return {code:code,name:name,type:type,note:financeText(input&&input.note,160)};}
    if (action === "upsert") {
      const clean = cleanAccount(data);
      const ref = db.ref(`/booksChart/${clean.code}`);
      const old = (await ref.get()).val();
      const isSystem = !!(old && old.system === true);
      const type = isSystem ? old.type : clean.type;
      const record = {code: clean.code, name: clean.name, type: type, note: clean.note, active: data.active === false ? false : (old ? old.active !== false : true), system: isSystem, sensitive: !!(old && old.sensitive === true), createdAt: (old && old.createdAt) || now, createdBy: (old && old.createdBy) || actor.uid, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email, schemaVersion: 1};
      await ref.set(record);
      await db.ref(`/operationalAudit/${now}_booksacct_${old ? "edit" : "add"}_${clean.code}`).set(operationalAuditRecord(old ? "edit_books_account" : "add_books_account", "booksChart", clean.code, actor, {name: record.name, type: record.type, email: actor.email}));
      return {account: record, created: !old};
    }
    if (action === "deactivate" || action === "reactivate") {
      const code = financeText(data && data.code, 4);
      if(!/^\d{4}$/.test(code))throw new HttpsError("invalid-argument","A four-digit account code is required.");
      const ref = db.ref(`/booksChart/${code}`);
      const old = (await ref.get()).val();
      if (!old) throw new HttpsError("not-found", `Books account ${code} was not found.`);
      if (action === "deactivate" && old.system === true) throw new HttpsError("failed-precondition", "System accounts are required by the ledger and can\u2019t be deactivated. Rename it instead if needed.");
      const active = action === "reactivate";
      await ref.update({active: active, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email});
      await db.ref(`/operationalAudit/${now}_booksacct_${action}_${code}`).set(operationalAuditRecord(action + "_books_account", "booksChart", code, actor, {email: actor.email}));
      return {account: Object.assign({}, old, {active: active})};
    }
    if (action === "import") {
      const rows = Array.isArray(data.accounts) ? data.accounts.slice(0, 300) : [];
      const results = {added: [], skipped: [], conflicts: []};
      for (const row of rows) {
        let clean;
        try { clean = cleanAccount(row); } catch (e) { results.skipped.push({code: row && row.code, reason: e.message}); continue; }
        const existing = (await db.ref(`/booksChart/${clean.code}`).get()).val();
        if (existing) {
          if (existing.name !== clean.name || existing.type !== clean.type) results.conflicts.push({code: clean.code, server: {name: existing.name, type: existing.type}, local: {name: clean.name, type: clean.type}});
          else results.skipped.push({code: clean.code, reason: "already present"});
          continue;
        }
        await db.ref(`/booksChart/${clean.code}`).set({code: clean.code, name: clean.name, type: clean.type, note: clean.note, active: true, system: false, sensitive: false, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, updatedByEmail: actor.email, schemaVersion: 1});
        results.added.push(clean.code);
      }
      if (results.added.length) await db.ref(`/operationalAudit/${now}_booksacct_import`).set(operationalAuditRecord("import_books_accounts", "booksChart", "import", actor, {added: results.added, email: actor.email}));
      return results;
    }
    throw new HttpsError("invalid-argument", "Unknown chart action.");
  },
);

exports.manageChartAccount = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {const db=getDatabase(), actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Privileged access is required.");const data=request.data||{}, action=financeText(data.action,30);await ensureChartAccounts(db);if(action==="initialize")return{initialized:true};const id=financeKey(data.accountId,"Chart account"), ref=db.ref(`/chartOfAccounts/${id}`), old=(await ref.get()).val();if(action==="upsert"){const name=financeText(data.name,100),code=financeText(data.code,20),type=financeText(data.type,20);if(!name||!code||!["asset","liability","equity","revenue","expense"].includes(type))throw new HttpsError("invalid-argument","Code, name, and valid account type are required.");await ref.set({code,name,type,active:data.active!==false,system:old&&old.system===true,createdAt:old&&old.createdAt||Date.now(),updatedAt:Date.now(),updatedBy:actor.uid,schemaVersion:1});return{accountId:id};}if(action==="deactivate"){if(!old)throw new HttpsError("not-found","Chart account not found.");await ref.update({active:false,updatedAt:Date.now(),updatedBy:actor.uid});return{accountId:id};}throw new HttpsError("invalid-argument","Chart action is invalid.");},
);

function cashFinanceDateMismatches(cash, movements) {
  const byMovement = {};
  Object.keys(cash || {}).forEach((id) => {
    const row = cash[id] || {}, mid = row.movementId, mv = mid && movements[mid];
    if (!mv || !row.date || mv.dateRepairSupersededBy) return;
    const currentDate = BooksBridge.businessDate(mv.occurredAt);
    if (currentDate === row.date) return;
    const previous = byMovement[mid];
    if (previous && previous.targetDate !== row.date) { previous.ambiguous = true; return; }
    if (!previous) byMovement[mid] = {movementId: mid, amount: Financial.money(row.amount), currentDate, targetDate: row.date, type: String(mv.type || ""), cfLedgerId: id, ambiguous: false};
  });
  return Object.keys(byMovement).map((id) => byMovement[id]);
}
async function automaticallyRepairFinanceDates(db, cash, movements, trigger) {
  const candidates = cashFinanceDateMismatches(cash, movements), now = Date.now(), actor = {uid:"system", role:"system"}; let repaired = 0, skipped = 0;
  for (const candidate of candidates) {
    const mid = candidate.movementId, mv = Object.assign({id: mid}, movements[mid] || {});
    if (candidate.ambiguous || !Array.isArray(mv.lines) || !mv.lines.length || Math.abs(Financial.totals(mv.lines).debit - Financial.totals(mv.lines).credit) > 0.009 || mv.reversalOf || mv.reversedByMovementId) { skipped++; continue; }
    const reversalId = `finance_datefix_rev_${mid}`, repostId = `finance_datefix_new_${mid}`, reason = "System maintenance: align Finance posting date with its single linked cash-ledger date.";
    try {
      const reversal = Financial.reverseMovement(mv, "finance_date_repair_reversal", "System date alignment"); reversal.occurredAt = Number(mv.occurredAt) || now; reversal.controlReason = reason; reversal.redatedFromMovementId = mid;
      const repost = Financial.movement(mv.type || "finance_date_repair", mv.sourceType || "financeDateRepair", mv.sourceId || mid, mv.lines.map((line) => Financial.line(line.account, line.debit, line.credit, line.label || "Re-dated posting")), {occurredAt: accountingTimestamp(candidate.targetDate, now), actorName:"system", controlReason:reason, redatedFromMovementId:mid, redatedFrom:candidate.currentDate, redatedTo:candidate.targetDate, systemMaintenance:true});
      const reversalResult = await commitFinancial(db, reversalId, reversal, actor, {[`operationalAudit/${now}_automatic_datefix_${mid}`]:operationalAuditRecord("automatic_repair_finance_date", "financeDateRepair", mid, actor, {trigger, from:candidate.currentDate, to:candidate.targetDate, amount:candidate.amount, reversalId, repostId, reason})});
      const repostResult = await commitFinancial(db, repostId, repost, actor);
      await db.ref(`/financialMovements/${mid}`).update({dateRepairSupersededBy:repostId, dateRepairedAt:now, dateRepairType:"automatic_cash_date_alignment", dateRepairTrigger:trigger});
      if (!reversalResult.duplicate || !repostResult.duplicate) repaired++;
    } catch (error) { skipped++; logger.error("automatic finance-date repair skipped", {movementId:mid, error:String(error)}); }
  }
  return {repaired, skipped, examined:candidates.length};
}

exports.autoRepairFinanceDateOnCashLedgerCreate = onValueCreated(
  {ref:"/cfLedger/{ledgerId}", region: ORDER_REGION},
  async (event) => {
    const row = event.data.val() || {}, movementId = String(row.movementId || ""); if (!movementId || !row.date) return;
    const db = getDatabase(), movement = (await db.ref(`/financialMovements/${movementId}`).get()).val(); if (!movement) return;
    await automaticallyRepairFinanceDates(db, {[event.params.ledgerId]:row}, {[movementId]:movement}, "cash_ledger_created");
  },
);

exports.repairFinanceDates = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const data = request.data || {}; const action = financeText(data.action, 20);
    const actor = await requirePortalPermission(db, request, ["cashflow", "receivables", "payables"]);
    const [cashSnap, mvSnap] = await Promise.all([db.ref("/cfLedger").get(), db.ref("/financialMovements").get()]);
    const cash = cashSnap.val() || {}, movements = mvSnap.val() || {};
    const byMovement = {};
    Object.keys(cash).forEach((id) => {
      const row = cash[id] || {}, mid = row.movementId, mv = mid && movements[mid];
      if (!mv || !row.date) return;
      if (mv.dateRepairSupersededBy) return;
      const cur = BooksBridge.businessDate(mv.occurredAt);
      if (cur === row.date) return;
      const prev = byMovement[mid];
      if (prev && prev.targetDate !== row.date) { prev.ambiguous = true; return; }
      if (!prev) byMovement[mid] = {movementId: mid, amount: Financial.money(row.amount), currentDate: cur, targetDate: row.date, type: String(mv.type || ""), cfLedgerId: id};
    });
    const mismatches = Object.keys(byMovement).map((k) => byMovement[k]);
    if (action === "preview" || !action) return {mismatches: mismatches.slice(0, 500), count: mismatches.length, ambiguous: mismatches.filter((m) => m.ambiguous).length};
    if (action !== "apply") throw new HttpsError("invalid-argument", "Unknown action.");
    if (!["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner can apply date corrections.");
    const reason = financeText(data.reason, 300); if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
    const approved = Array.isArray(data.movementIds) ? new Set(data.movementIds.map(String)) : null;
    const now = Date.now(); let repaired = 0, skipped = 0; const done = [];
    for (const m of mismatches) {
      if (m.ambiguous) { skipped++; continue; }
      if (approved && !approved.has(m.movementId)) { skipped++; continue; }
      const mid = m.movementId, mv = Object.assign({id: mid}, movements[mid] || {});
      if (!Array.isArray(mv.lines) || !mv.lines.length) { skipped++; continue; }
      const revId = `finance_datefix_rev_${mid}`, newId = `finance_datefix_new_${mid}`, targetTs = accountingTimestamp(m.targetDate, now);
      const reversal = Financial.reverseMovement(mv, "finance_date_repair_reversal", "Re-date correction"); reversal.occurredAt = Number(mv.occurredAt) || now; reversal.controlReason = reason; reversal.redatedFromMovementId = mid;
      const repost = Financial.movement(mv.type || "finance_date_repair", mv.sourceType || "financeDateRepair", mv.sourceId || mid, mv.lines.map((l) => Financial.line(l.account, l.debit, l.credit, l.label || "Re-dated posting")), {occurredAt: targetTs, actorName: actor.role, controlReason: reason, redatedFromMovementId: mid, redatedFrom: m.currentDate, redatedTo: m.targetDate});
      const rr = await commitFinancial(db, revId, reversal, actor, {[`operationalAudit/${now}_datefix_${mid}`]: operationalAuditRecord("repair_finance_date", "financeDateRepair", mid, actor, {from: m.currentDate, to: m.targetDate, amount: m.amount, reversalId: revId, repostId: newId, reason})});
      const pr = await commitFinancial(db, newId, repost, actor, {[`financialMovements/${mid}/dateRepairSupersededBy`]: newId, [`financialMovements/${mid}/dateRepairedAt`]: now});
      if (rr.duplicate && pr.duplicate) skipped++; else { repaired++; done.push({movementId: mid, from: m.currentDate, to: m.targetDate, amount: m.amount}); }
    }
    return {repaired, skipped, done: done.slice(0, 500)};
  },
);

function financialControlResolution(issue) {
  const resolutions = {
    unbalanced:["Open the source Finance posting and correct it through its original workflow. Do not create an offsetting journal just to force it to balance.","books_transactions","Open Finance Books"],
    movement_warning:["Open the linked payment method in Cash Accounts and assign its receiving account. The system will preserve the original sale and post the supported reclassification.","admin_finance","Open Cash Accounts"],
    sale_amount_mismatch:["Open the Admin sale, verify its completion, discount and refund status, then run the Daily Financial Close again. The close identifies the exact missing or duplicated posting.","admin_sales","Open Sales History"],
    legacy_cash_without_movement:["Review the original cash record and create its missing Finance movement through the controlled Cash Flow workflow. Do not manually edit the ledger row.","books_cashflow","Open Cash Flow"],
    cash_finance_date_mismatch:["Automatic repair was skipped because this movement has conflicting or unsafe date evidence. Verify the original cash date and linked Finance entry before a Finance owner corrects the period.","books_cashflow","Review Cash Flow"],
    sale_not_posted:["Open the completed order in Admin and run the Daily Financial Close. The system will identify the specific order posting that must be restored.","admin_sales","Open Sales History"],
    payout_movement_missing:["Open the platform payout and verify its linked settled orders. Re-run the controlled payout settlement; never journal Platform Payouts in Transit manually.","admin_finance","Open Platform Payouts"],
    reversed_payout_cash_not_reversed:["Use the controlled payout-deposit repair. It restores the clearing account and reverses the orphaned bank receipt while retaining the audit trail.","repair_reversed_payout","Repair deposit"],
    payout_deposit_missing_reference:["Open this exact platform payout and add the platform statement or bank transaction reference. This updates only evidence metadata; its amount, linked orders, receiving account, and Finance posting remain unchanged.","edit_payout_reference","Add payout reference"],
    payout_order_link_mismatch:["Open the platform payout and its listed orders. Correct the payout/order assignment from Platform Payouts, then run Daily Financial Close.","admin_finance","Open Platform Payouts"],
    platform_ar_control_mismatch:["Open Platform Receivables and compare unsettled orders with payout settlements. Correct the affected payout or order from its source workflow, then rerun Daily Financial Close.","admin_finance","Open Platform Receivables"],
    duplicate_cash_account_code:["Open Cash Accounts and give each bank or wallet a unique Finance Books account mapping before recording more deposits.","books_cashflow","Open Cash Accounts"],
    register_float_differs_from_control:["Open POS Settings and verify the approved register float. Use the controlled float adjustment; do not record it as a receipt or expense.","admin_finance","Open POS Settings"],
    undeposited_subledger_mismatch:["Open Undeposited Collection, reconcile the custody rows to the Finance balance, and use the controlled custody correction shown there.","admin_finance","Open Undeposited Collection"],
    cash_payment_missing_custody:["Open the exact approved cash payment. Record or restore enough physical cash custody first, then use the controlled repair so the payment and its custody allocation post together. Do not deposit the original shift amount.","admin_petty","Open Cash Payments"],
    holding_account_balance:["Open the original operational workflow named in the account description and finish its allocation, settlement, or variance resolution. Do not clear control accounts with a free-form journal.","books_transactions","Open Finance Books"],
    balance_off_chart:["Open Chart of Accounts, restore the account definition, and then review the linked posting before changing its account mapping.","books_transactions","Open Chart of Accounts"],
    balance_on_inactive_account:["Open Chart of Accounts and either reactivate the account while its balance is resolved, or complete the controlled transfer from its original source workflow.","books_transactions","Open Chart of Accounts"],
    unreviewed_discrepancies:["Open Admin Discrepancies, select the actual cause, and complete the linked Finance treatment. Each option records the operational and accounting resolution together.","admin_discrepancies","Open Discrepancies"],
  };
  const resolution = resolutions[issue.kind] || ["Open the linked source record, verify the supporting evidence, and use its controlled correction workflow. The audit trail must remain intact.","books_cashflow","Review source"];
  const titles = {payout_deposit_missing_reference:"Platform payout needs a reference",payout_movement_missing:"Platform payout posting is missing",payout_order_link_mismatch:"Platform payout order links need review",reversed_payout_cash_not_reversed:"Reversed platform payout still has a bank receipt"};
  return Object.assign(issue, {title:titles[issue.kind] || String(issue.kind || "Control exception").replace(/_/g, " "), solution:resolution[0], actionTarget:resolution[1], actionLabel:resolution[2]});
}

exports.auditFinancialControls = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    const db=getDatabase();await requirePortalPermission(db,request,["cashflow","receivables","payables"]);
    const snaps=await Promise.all([db.ref("/orders").get(),db.ref("/archivedOrders").get(),db.ref("/financialMovements").get(),db.ref("/cfLedger").get(),db.ref("/receivables").get(),db.ref("/payables").get(),db.ref("/platformPayouts").get(),db.ref("/cashCustody").get(),db.ref("/cfAccounts").get(),db.ref("/posSettings").get(),db.ref("/posActiveShift").get()]);
    const orders=Object.assign({},snaps[1].val()||{},snaps[0].val()||{}),cash=snaps[3].val()||{},ars=snaps[4].val()||{},aps=snaps[5].val()||{},payouts=snaps[6].val()||{},custody=snaps[7].val()||{},accounts=snaps[8].val()||{},issues=[];let movements=snaps[2].val()||{};
    const dateMaintenance=await automaticallyRepairFinanceDates(db,cash,movements,"financial_control_audit");if(dateMaintenance.repaired)movements=(await db.ref("/financialMovements").get()).val()||{};
    const resolvedPaymentMappings=new Set();Object.values(movements).forEach((m)=>{if(m&&m.type==="payment_account_reclassification"&&m.originalMovementId&&m.method)resolvedPaymentMappings.add(`${m.originalMovementId}|${financeText(m.method,60).toLowerCase()}`);});
    Object.keys(movements).forEach((id)=>{const m=movements[id],sum=Financial.totals(m.lines||[]);if(Math.abs(sum.debit-sum.credit)>0.009)issues.push({severity:"critical",kind:"unbalanced",source:id,amount:Financial.money(sum.debit-sum.credit)});(m.warnings||[]).forEach((w)=>{const match=/^No cash-flow account mapping for (.+)\.$/.exec(String(w||"")),resolved=match&&resolvedPaymentMappings.has(`${id}|${financeText(match[1],60).toLowerCase()}`);if(!resolved)issues.push({severity:"warning",kind:"movement_warning",source:id,detail:w});});});
    const saleMovementRows=Object.values(movements);Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status;if(o.voided||!["Completed","Received"].includes(status)||o.paymentStatus==="pending"||!movements[`sale_${id}`])return;const expected=Financial.orderNetSales(o),actual=Financial.sourceNetSales(saleMovementRows,id),difference=Financial.money(actual-expected);if(Math.abs(difference)>0.009)issues.push({severity:"critical",kind:"sale_amount_mismatch",source:id,detail:`Admin net sales ${expected.toFixed(2)}; Finance Books ${actual.toFixed(2)}`,amount:difference,expected,actual});});
    Object.keys(cash).forEach((id)=>{if(!cash[id].movementId)issues.push({severity:"warning",kind:"legacy_cash_without_movement",source:id,amount:Financial.money(cash[id].amount)});});
    Object.keys(cash).forEach((id)=>{const row=cash[id]||{},mv=movements[row.movementId];if(mv&&row.date&&!mv.dateRepairSupersededBy&&BooksBridge.businessDate(mv.occurredAt)!==row.date)issues.push({severity:"critical",kind:"cash_finance_date_mismatch",source:id,detail:`Cash ${row.date}; Finance ${BooksBridge.businessDate(mv.occurredAt)}`,amount:Financial.money(row.amount)});});
    let unsettledValue=0,unsettledCount=0;Object.keys(orders).forEach((id)=>{const o=orders[id]||{},status=o.status==="Archived"?o.prevStatus:o.status,platform=["grabfood","foodpanda"].includes(o.channel);if(!o.voided&&["Completed","Received"].includes(status)&&o.paymentStatus!=="pending"&&!movements[`sale_${id}`])issues.push({severity:"critical",kind:"sale_not_posted",source:id,amount:Financial.money(o.total)});if(platform&&!o.voided&&(o.settlementStatus||"unsettled")!=="settled"){unsettledCount++;unsettledValue=Financial.money(unsettledValue+Financial.money(o.netPlatform));}if(!platform){const rows=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}];rows.forEach((p)=>{if(String(p.method||"").toLowerCase()==="cash")return;if(!Financial.accountForMethod(p.method,accounts))issues.push({severity:"warning",kind:"unmapped_payment_method",source:id,detail:financeText(p.method,60),amount:Financial.money(p.amount)});});}});
    Object.keys(payouts).forEach((id)=>{const p=payouts[id]||{},movementId=p.movementId||`payout_${id}`,channel=financeText(p.channel,40)||"Platform",payoutDate=financeText(p.payoutDate,10)||financeDateFromTimestamp(Number(p.settledAt)||Date.now()),account=accounts[p.accountId]||{},accountName=financeText(account.name,80)||"the selected receiving account",sourceLabel=`${channel} payout · ${payoutDate} · ${Financial.money(p.actualPayout).toFixed(2)}`;if(!movements[movementId])issues.push({severity:"critical",kind:"payout_movement_missing",source:id,sourceLabel,amount:Financial.money(p.expectedNet)});if(p.reversed&&p.depositMovementId&&!p.depositReversalMovementId)issues.push({severity:"critical",kind:"reversed_payout_cash_not_reversed",source:id,sourceLabel,amount:Financial.money(p.actualPayout)});if(p.depositMovementId&&!p.depositReference)issues.push({severity:"warning",kind:"payout_deposit_missing_reference",source:id,sourceLabel,detail:`Missing bank or platform reference for the ${channel} payout dated ${payoutDate} to ${accountName}.`,amount:Financial.money(p.actualPayout)});if(!p.reversed)(p.orderIds||[]).forEach((orderId)=>{const o=orders[orderId];if(!o||o.payoutId!==id||(o.settlementStatus||"unsettled")!=="settled")issues.push({severity:"critical",kind:"payout_order_link_mismatch",source:id,sourceLabel,detail:String(orderId)});});});
    const ledgerPlatform={grabfood:0,foodpanda:0};Object.values(movements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{for(const channel of ["grabfood","foodpanda"])if(line.account===`asset:platform_receivable:${channel}`)ledgerPlatform[channel]=Financial.money(ledgerPlatform[channel]+Financial.money(line.debit)-Financial.money(line.credit));}));const ledgerPlatformTotal=Financial.money(ledgerPlatform.grabfood+ledgerPlatform.foodpanda),platformDifference=Financial.money(ledgerPlatformTotal-unsettledValue);if(Math.abs(platformDifference)>0.009)issues.push({severity:"critical",kind:"platform_ar_control_mismatch",source:"platform_receivables",amount:platformDifference,expected:unsettledValue,actual:ledgerPlatformTotal});
    const codes={};Object.keys(accounts).forEach((id)=>{const code=BooksBridge.cashCodeForAccount(accounts[id]);(codes[code]||(codes[code]=[])).push(id);});Object.keys(codes).forEach((code)=>{if(codes[code].length>1)issues.push({severity:"critical",kind:"duplicate_cash_account_code",source:code,detail:codes[code].join(", ")});});
    const floatControl=resolveRegisterFloat(snaps[9].val()||{},snaps[10].val()||{});if(Math.abs(floatControl.amount-4000)>.009)issues.push({severity:"warning",kind:"register_float_differs_from_control",source:floatControl.source,amount:floatControl.amount,expected:4000});
    let custodyValue=0,custodyCount=0;Object.keys(custody).forEach((id)=>{const rem=Financial.money(custody[id].remaining);if(rem>0){custodyCount++;custodyValue=Financial.money(custodyValue+rem);}});let undepositedLedgerValue=0;Object.values(movements).forEach((m)=>(m&&m.lines||[]).forEach((line)=>{if(line.account==="asset:cash_awaiting_deposit")undepositedLedgerValue=Financial.money(undepositedLedgerValue+(Number(line.debit)||0)-(Number(line.credit)||0));}));const undepositedDifference=Financial.money(undepositedLedgerValue-custodyValue);if(Math.abs(undepositedDifference)>0.009)issues.push({severity:"critical",kind:"undeposited_subledger_mismatch",source:"cashCustody",detail:`Finance Books ${undepositedLedgerValue.toFixed(2)}; custody subledger ${custodyValue.toFixed(2)}`,amount:undepositedDifference,expected:custodyValue,actual:undepositedLedgerValue});const openAr=Object.values(ars).filter((x)=>x&&x.status==="open"),openAp=Object.values(aps).filter((x)=>x&&x.status==="open"),undepositedPayouts=Object.values(payouts).filter((x)=>x&&!x.reversed&&!x.depositMovementId&&Financial.money(x.actualPayout)>0);
    // --- Additive control checks (read-only; each guarded so a failure degrades, never breaks the audit) ---
    try {
      const [journalControlSnap,chartControlSnap,reconciliationConfigSnap]=await Promise.all([db.ref("/books/journal").get(),db.ref("/booksChart").get(),db.ref("/books/reconciliationConfig").get()]),journal=journalControlSnap.val()||{},bChart=chartControlSnap.val()||{},reconciliationConfig=ReconciliationControls.accountRules(reconciliationConfigSnap.val()||{}),bal=ReconciliationControls.journalBalances(journal);
      ReconciliationControls.controlAccountIssues(journal,reconciliationConfig).forEach((item)=>{const period=item.oldestDate&&item.newestDate?(item.oldestDate===item.newestDate?item.oldestDate:`${item.oldestDate} to ${item.newestDate}`):"undated";issues.push({severity:Math.abs(item.balance)>=1000?"critical":"warning",kind:"holding_account_balance",source:item.code,detail:`${item.rule.name||item.code}: ${item.count} post-cutover source entr${item.count===1?"y":"ies"} (${period}) remain uncleared`,amount:item.balance,sourceCount:item.count,oldestDate:item.oldestDate,newestDate:item.newestDate});});
      Object.keys(bal).forEach((code)=>{if(Math.abs(bal[code])<0.5)return;const row=bChart[code];if(!row)issues.push({severity:"critical",kind:"balance_off_chart",source:code,detail:"Account carries a balance but is not in the chart of accounts",amount:Financial.money(bal[code])});else if(row.active===false)issues.push({severity:"warning",kind:"balance_on_inactive_account",source:code,detail:financeText(row.name,60)+" is deactivated but still carries a balance",amount:Financial.money(bal[code])});});
    } catch(e){logger.warn("auditFinancialControls: holding/chart check skipped",{error:String(e)});}
    try {
      const discrepancies=(await db.ref("/discrepancies").get()).val()||{}, open=Object.keys(discrepancies).map((k)=>discrepancies[k]||{}).filter(ReconciliationControls.operationalDiscrepancy);
      if(open.length)issues.push({severity:"warning",kind:"unreviewed_discrepancies",source:"discrepancies",detail:open.length+" cash discrepancy(ies) awaiting manager review in Discrepancies",amount:Financial.money(open.reduce((s,d)=>s+Math.abs(Number(d.value!=null?d.value:d.variance||0)),0))});
    } catch(e){logger.warn("auditFinancialControls: discrepancy check skipped",{error:String(e)});}
    try {
      const petty=(await db.ref("/pettyCashVouchers").get()).val()||{};Object.keys(petty).forEach((id)=>{const voucher=petty[id]||{};if(voucher.status==="approved"&&!voucher.voided&&!movements[`petty_${id}`])issues.push({severity:"critical",kind:"cash_payment_missing_custody",source:id,detail:`Approved cash payment ${financeText(voucher.voucherNo||id,80)} has not reduced Undeposited Collection.`,amount:Financial.money(voucher.amount)});});
    } catch(e){logger.warn("auditFinancialControls: cash-payment custody check skipped",{error:String(e)});}
    // Never expose an internal key as the business-facing reference. Keep the
    // raw source for controlled actions, but present the actual transaction
    // context a manager can recognise from Admin or Finance Books.
    function businessReference(issue) {
      if (issue.sourceLabel) return issue;
      const source = String(issue.source || ""), order = orders[source] || {}, movement = movements[source] || {}, cashRow = cash[source] || {}, custodyRow = custody[source] || {}, receivable = ars[source] || {}, payable = aps[source] || {}, account = accounts[source] || {};
      const dated = (value) => financeDateFromTimestamp(Number(value) || Date.now());
      const amount = (value) => Financial.money(Number(value) || 0).toFixed(2);
      let label = "Related Finance control";
      if (Object.keys(order).length) { const reference = financeText(order.platformRef || order.orderNo || order.receiptNo,80); label = `${financeText(order.channel,40)||"POS"} sale${reference ? ` · ${reference}` : ""} · ${financeText(order.date,10)||dated(order.timestamp)} · ${amount(order.total)}`; }
      else if (Object.keys(cashRow).length) { label = `Cash entry · ${financeText(cashRow.category || cashRow.ref || cashRow.party,80)||"cash movement"} · ${financeText(cashRow.date,10)||dated(cashRow.ts)} · ${amount(cashRow.amount)}`; }
      else if (Object.keys(movement).length) { label = `Finance posting · ${financeText(movement.type,80).replace(/_/g," ")||"transaction"} · ${dated(movement.occurredAt)}`; }
      else if (Object.keys(custodyRow).length) { label = `Undeposited Collection · ${financeText(custodyRow.staff || custodyRow.shiftId,80)||"cash custody"} · ${amount(custodyRow.remaining)}`; }
      else if (Object.keys(receivable).length) { label = `Receivable · ${financeText(receivable.party || receivable.ref,80)||"customer balance"} · ${amount(receivable.amount)}`; }
      else if (Object.keys(payable).length) { label = `Payable · ${financeText(payable.party || payable.ref,80)||"supplier bill"} · ${amount(payable.amount)}`; }
      else if (Object.keys(account).length) { label = `Cash account · ${financeText(account.name,80)||"account"}`; }
      else if (source === "cashCustody") label = "Undeposited Collection control account";
      else if (source === "platform_receivables") label = "Platform receivables control account";
      else if (source === "discrepancies") label = "Cash differences awaiting manager review";
      else if (/^\d{4}$/.test(source)) label = `Finance Books account ${source}`;
      return Object.assign(issue, {sourceLabel: label});
    }
    const resolvedIssues=issues.map(businessReference).map(financialControlResolution);return{generatedAt:Date.now(),issues:resolvedIssues.slice(0,200),issueCount:resolvedIssues.length,systemDateMaintenance:dateMaintenance,registerFloat:{amount:floatControl.amount,expected:4000,source:floatControl.source},unsettledPlatform:{count:unsettledCount,amount:unsettledValue},cashAwaitingDeposit:{count:custodyCount,amount:custodyValue},openReceivables:{count:openAr.length,amount:Financial.money(openAr.reduce((s,x)=>s+Number(x.amount||0),0))},openPayables:{count:openAp.length,amount:Financial.money(openAp.reduce((s,x)=>s+Number(x.amount||0),0))},undepositedPayouts:undepositedPayouts.length};
  },
);

// ---------------------------------------------------------------------------
// Release 3A: immutable, retry-safe inventory movement ledger.
// /inventoryAccounting/{itemId} is the authoritative per-item transaction
// boundary. The public inventory stock and /inventoryBalances are projections.
// ---------------------------------------------------------------------------
