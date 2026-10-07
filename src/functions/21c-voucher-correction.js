// ---------------------------------------------------------------------------
// Approved Cash Voucher correction (7 Oct 2026, Danilo's request).
// An approved voucher can be edited - date, amount, category, payee, purpose - while the
// months involved are open, the way Xero / MYOB / NetSuite allow an open-period edit. The
// ledger stays immutable: the voucher's current effective posting is reversed ON ITS OWN DATE
// and the corrected posting is made on the voucher's (new) date, both in one atomic write,
// always against the voucher's real funding account (bank / e-wallet register rows included,
// Undeposited Collection custody moved only by the amount difference).
// Cash vouchers can never be future-dated: creation, approval and correction all refuse a
// date after today's Manila business date.
// ---------------------------------------------------------------------------
const VOUCHER_CONTROLLED_TYPES = ["loan_repayment", "staff_advance", "customer_refund"];
const VOUCHER_EXPENSE_CATEGORIES = ["operating_supplies","office_supplies","utilities","internet_phone","marketing","repairs","bank_fees","rent","salaries","transport","staff_meals","miscellaneous","other_expense"];
const PETTY_VOUCHER_MUTATION_LEASE_MS = 120000;

async function claimPettyVoucherMutation(db, voucherId, ownerId, actor, registry) {
  const id = financeKey(voucherId, "Voucher ID"), ref = db.ref(`/financialControlLocks/pettyVoucher/${id}`), token = crypto.randomBytes(12).toString("hex"), claimedAt = Date.now();
  const result = await ref.transaction((current) => (!current || Number(current.claimedAt || 0) < claimedAt - PETTY_VOUCHER_MUTATION_LEASE_MS ? {token, ownerId: financeText(ownerId, 200), actorUid: actor && actor.uid || "", claimedAt} : undefined), undefined, false);
  if (!result.committed || !result.snapshot.exists() || result.snapshot.val().token !== token) throw new HttpsError("aborted", "This cash voucher is being updated by another action. Refresh it and try again.");
  const claim = {pettyVoucher: true, id, token, released: false, release: async () => {
    if (claim.released) return; claim.released = true;
    await ref.transaction((current) => (current && current.token === token ? null : current), undefined, false);
  }};
  if (Array.isArray(registry)) registry.push(claim);
  return claim;
}
async function releasePettyVoucherClaims(held) { for (const claim of held || []) if (claim && claim.pettyVoucher === true) await claim.release(); }

function voucherBusinessToday(now) { return financeDateFromTimestamp(Number(now) || Date.now()); }
function assertVoucherDateNotFuture(value, now) {
  const date = financeDate(value, true), today = voucherBusinessToday(now);
  if (date > today) throw new HttpsError("invalid-argument", `Cash voucher date ${date} is in the future. Use the date the money actually left (${today} or earlier).`);
  return date;
}
// The exact change a manager approves. The server rebuilds it from the command, so an approval
// granted for one change can never be spent on another (date, amount, category, payee ...).
function voucherChangeFingerprint(voucherId, change, action = "correct_petty_voucher") {
  const c = change || {};
  const canonicalFields = [
    `${financeText(action, 60) || "correct_petty_voucher"}:v1`, financeText(voucherId, 160), Math.max(0, Math.floor(Number(c.expectedRev) || 0)),
    financeText(c.date, 10), Financial.money(c.amount).toFixed(2), financeText(c.category, 80), financeText(c.payee, 160),
    financeText(c.supplierId, 160), financeText(c.purpose, 300), financeText(c.approverName, 160), financeText(c.reason, 500),
  ];
  if (action === "void_replace_legacy_petty_voucher") canonicalFields.push(financeText(c.fundingAccountId, 120));
  const canonical = JSON.stringify(canonicalFields);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
function voucherLedgerRowLocked(row) {
  return !!row && (row.bankReconciled === true || row.reconciled === true || !!row.reconciledAt || !!row.bankReconciliationId);
}

// Commits several financial movements in ONE multi-path update: all are posted or none is.
// Same guarantees as commitFinancial (period lock, document numbers, per-movement claims,
// custody-delta check, unsafe-update guard) for a correction that spans two dates.
async function commitFinancialSet(db, entries, actor, extraWrites = {}) {
  const ids = entries.map((entry) => financeKey(entry.id, "Movement ID"));
  const existing = await Promise.all(ids.map((id) => db.ref(`/financialMovements/${id}`).get()));
  if (existing.every((snap) => snap.exists())) throw new HttpsError("aborted", "This voucher correction was already posted. Refresh the voucher before trying another change.");
  if (existing.some((snap) => snap.exists())) throw new HttpsError("failed-precondition", "Part of this correction is already posted. Refresh the voucher; nothing new was posted.");
  for (const entry of entries) await assertAccountingPeriodOpen(db, Number(entry.movement && entry.movement.occurredAt || Date.now()), "posting this cash voucher correction");
  const records = [];
  for (let i = 0; i < entries.length; i += 1) {
    const record = financeRecord(ids[i], entries[i].movement, actor);
    const prefix = documentPrefix(record);
    if (prefix && !financeText(record.documentNo, 40)) {
      const year = financeDateFromTimestamp(Number(record.occurredAt) || Date.now()).slice(0, 4);
      try { record.documentNo = await nextDocumentNumber(db, prefix, year); } catch (error) { record.documentNo = ""; }
    }
    records.push(record);
  }
  const claimedAt = Date.now(), token = crypto.randomBytes(12).toString("hex"), held = [];
  try {
    for (const id of ids) {
      const claim = await db.ref(`/financialCommandClaims/${id}`).transaction((current) => (!current || (current.status === "processing" && Number(current.claimedAt || 0) < claimedAt - 900000)) ? {status: "processing", token, claimedAt, actorUid: actor.uid, movementId: id, operationType: "petty_cash_payment_correction", schemaVersion: 2} : undefined);
      if (!claim.committed || !claim.snapshot.exists() || claim.snapshot.val().token !== token) throw new HttpsError("aborted", "This correction is already being processed. Wait a moment, then refresh.");
      held.push(id);
    }
    let custodyIndex = {};
    if (Object.keys(extraWrites).some((path) => path.startsWith("cashCustody/"))) {
      const lines = records.reduce((all, record) => all.concat(record.lines || []), []), touched = await touchedCustodyRows(db, extraWrites);
      try { CashJournalEdit.assertCustodyDelta(touched, extraWrites, lines); } catch (error) { throw new HttpsError("failed-precondition", error.message); }
      custodyIndex = custodyIndexWrites(touched, extraWrites);
    }
    const writes = Object.assign({}, extraWrites, custodyIndex);
    records.forEach((record, i) => {
      writes[`financialMovements/${ids[i]}`] = record;
      const queueKey = CashBalances.pendingKey(`voucher_correction_${ids[i]}`, ids[i]);
      writes[`cashBalanceSummaryPending/${queueKey}`] = CashBalances.pendingRecord(ids[i], claimedAt);
      writes[`financialCommandClaims/${ids[i]}`] = {status: "posted", token, claimedAt, postedAt: Date.now(), actorUid: actor.uid, movementId: ids[i], operationType: financeText(record.type, 80), schemaVersion: 2};
    });
    await safeFinancialUpdate(db, writes, "financial");
    return {duplicate: false, movements: records};
  } catch (error) {
    for (const id of held) await db.ref(`/financialCommandClaims/${id}`).transaction((current) => (current && current.token === token && current.status === "processing" ? null : current));
    throw error;
  }
}

// The posting this voucher currently stands on: the latest correction's posting, else the
// original approval posting. Vouchers corrected under the pre-Oct-2026 single-movement method
// cannot be split back to their two dates, so they are refused (void and re-enter instead).
async function voucherEffectivePosting(db, id, voucher) {
  const effective = voucher.effectivePosting || null;
  if (!effective && voucher.correctionMovementIds && Object.keys(voucher.correctionMovementIds).length) throw new HttpsError("failed-precondition", "This cash voucher was corrected under the earlier method. Void it with approval and record a new voucher.");
  const movementId = effective && effective.movementId ? financeKey(effective.movementId, "Movement ID") : `petty_${id}`;
  const movement = (await db.ref(`/financialMovements/${movementId}`).get()).val();
  if (!movement || !Array.isArray(movement.lines) || !movement.lines.length) throw new HttpsError("failed-precondition", "The voucher's Finance Books posting is missing. Use Repair missing payments in Undeposited Collection first.");
  return {movementId, movement: Object.assign({id: movementId}, movement)};
}

function legacyMovementAccountNets(movement) {
  const nets = {};
  for (const line of movement && movement.lines || []) {
    const account = financeText(line && line.account, 180);
    if (!account) continue;
    nets[account] = Financial.money(Number(nets[account] || 0) + Number(line.debit || 0) - Number(line.credit || 0));
  }
  return nets;
}

// Repairs the narrow pre-7-Oct failure safely: an approved bank-paid voucher whose earlier
// correction attempts were balanced, per-account no-ops. The original is reversed on its own
// accounting date and a new linked voucher is posted on the requested date against the SAME bank.
// The no-op journals remain immutable in Finance Books, but are removed from the operational
// Undeposited Collection projection because they never changed that account's balance.
async function voidReplaceLegacyPettyVoucher(db, actor, data, id, voucher, next) {
  const now = Date.now(), legacyIds = Object.values(voucher.correctionMovementIds || {}).filter(Boolean).map((value) => financeKey(value, "Legacy correction movement"));
  const replacementId = financeKey(`legacy_replace_${id}`, "Replacement voucher ID"), reverseId = `petty_void_${id}`, postId = `petty_${replacementId}`;
  const existing = await Promise.all([db.ref(`/financialMovements/${reverseId}`).get(), db.ref(`/financialMovements/${postId}`).get(), db.ref(`/pettyCashVouchers/${replacementId}`).get()]);
  const existingReplacement = existing[2].val() || {};
  if (existing[0].exists() && existing[1].exists() && existingReplacement.status === "approved" && voucher.replacedByVoucherId === replacementId) return {voucherId:id,replacementVoucherId:replacementId,replacementVoucherNo:financeText(existingReplacement.voucherNo,60),action:"void_replace_legacy",duplicate:true};
  if (existing[0].exists() || existing[1].exists() || existingReplacement.status || voucher.voided === true) throw new HttpsError("failed-precondition", "This legacy replacement is incomplete or the voucher changed. Stop and review the linked Finance Books entries before retrying.");
  if (voucher.status !== "approved" || !legacyIds.length || voucher.effectivePosting) throw new HttpsError("failed-precondition", "Only an active voucher corrected under the earlier method can use guided void and replace.");
  if (legacyIds.length > 20) throw new HttpsError("failed-precondition", "This voucher has too many legacy corrections for automatic repair. Review it in Finance Books.");
  const type = financeText(voucher.transactionType, 40) || "expense";
  if (!["expense", "owner_withdrawal"].includes(type) || voucher.returnedAt || Object.keys(voucher.allocations || {}).length) throw new HttpsError("failed-precondition", "This legacy voucher has linked activity and needs a manual Finance Books review before replacement.");
  const funding = advanceFundingAccount(voucher);
  if (funding.kind !== "account") throw new HttpsError("failed-precondition", "Guided legacy replacement currently requires the original bank or e-wallet funding account. Other funding sources need manual review.");
  const originalId = `petty_${id}`, movementSnaps = await Promise.all([db.ref(`/financialMovements/${originalId}`).get()].concat(legacyIds.map((movementId) => db.ref(`/financialMovements/${movementId}`).get()))), original = movementSnaps[0].val();
  if (!original || !Array.isArray(original.lines) || !BooksBridge.linesBalanced(original.lines) || original.sourceType !== "pettyVoucher" || financeText(original.sourceId,160) !== id || original.reversedByMovementId) throw new HttpsError("failed-precondition", "The original cash-payment posting is missing, changed, unbalanced, or already reversed.");
  const originalFundingNet = Financial.money((original.lines || []).reduce((sum, line) => sum + (line.account === funding.account ? Number(line.debit || 0) - Number(line.credit || 0) : 0), 0)), originalPaid = Financial.money(-originalFundingNet);
  if (!(originalPaid > 0)) throw new HttpsError("failed-precondition", "The original posting does not show an outflow from the voucher's bank account.");
  for (let index = 0; index < legacyIds.length; index += 1) {
    const movement = movementSnaps[index + 1].val(), movementId = legacyIds[index];
    if (!movement || !Array.isArray(movement.lines) || !BooksBridge.linesBalanced(movement.lines) || movement.sourceType !== "pettyVoucher" || financeText(movement.sourceId,160) !== id) throw new HttpsError("failed-precondition", `Legacy correction ${movementId} is missing, unbalanced, or belongs to another voucher.`);
    const nets = legacyMovementAccountNets(movement);
    if (Object.values(nets).some((value) => Math.abs(Financial.money(value)) > 0.009)) throw new HttpsError("failed-precondition", "A legacy correction changed an account balance. Automatic replacement stopped so Finance Books, bank and custody can be reconciled manually.");
  }
  const expectedOriginalPosting = revolvingFundPosting(voucher), originalNets = legacyMovementAccountNets(original), nonZeroOriginalAccounts = Object.keys(originalNets).filter((account) => Math.abs(Financial.money(originalNets[account])) > 0.009);
  if (Math.abs(originalPaid - Financial.money(voucher.amount)) > 0.009 || Math.abs(Financial.money(originalNets[expectedOriginalPosting.account]) - originalPaid) > 0.009 || nonZeroOriginalAccounts.length !== 2 || !nonZeroOriginalAccounts.includes(expectedOriginalPosting.account) || !nonZeroOriginalAccounts.includes(funding.account)) throw new HttpsError("failed-precondition", "The original journal does not exactly match this voucher's expense and BDO payment. Automatic replacement stopped for manual Finance Books review.");
  const ledgerSnap = await db.ref("/cfLedger").orderByChild("linkId").equalTo(id).limitToLast(100).get(), ledgerRows = Object.values(ledgerSnap.val() || {}), originalDate = financeDateFromTimestamp(Number(original.occurredAt) || now);
  if (ledgerRows.length >= 100) throw new HttpsError("failed-precondition", "This voucher has too many bank-register entries for automatic replacement.");
  if (ledgerRows.some(voucherLedgerRowLocked)) throw new HttpsError("failed-precondition", "This BDO payment is already reconciled. Un-reconcile it before guided void and replace.");
  const originalRows = ledgerRows.filter((row) => financeText(row && row.movementId,160) === originalId);
  if (originalRows.length !== 1 || originalRows[0].accountId !== funding.id || originalRows[0].dir !== "out" || Math.abs(Financial.money(originalRows[0].amount) - originalPaid) > 0.009 || financeText(originalRows[0].date,10) !== originalDate) throw new HttpsError("failed-precondition", "The original BDO register entry does not match Finance Books. Repair that link before replacement.");
  const replacementDate = assertVoucherDateNotFuture(data.date, now);
  await assertAccountingPeriodOpen(db, originalDate, "reversing the legacy cash voucher");
  await assertAccountingPeriodOpen(db, replacementDate, "posting the replacement cash voucher");
  const changeHash = voucherChangeFingerprint(id, {expectedRev:Math.max(0,Math.floor(Number(voucher.correctionRevision)||0)),date:replacementDate,amount:next.amount,category:next.category,payee:next.payee,supplierId:"",purpose:next.purpose,approverName:financeText(voucher.approverName,160),reason:next.reason,fundingAccountId:funding.id}, "void_replace_legacy_petty_voucher");
  const approval = await claimManagerApproval(db, data, "void_replace_legacy_petty_voucher", id, next.amount, `void_replace_legacy_${id}`, null, changeHash), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, approvedRole = financeText(approval.record.approvedRole,20), selfApproved = approval.record.approvedBy === actor.uid;
  if (selfApproved && approvedRole !== "superadmin") {await db.ref().update(approval.usedWrites);throw new HttpsError("permission-denied", "A legacy replacement must be approved by a different manager account; only a Super Admin may self-approve.");}
  if (replacementDate.slice(0,7) !== originalDate.slice(0,7) && !["superadmin","admin"].includes(approvedRole)) {await db.ref().update(approval.usedWrites);throw new HttpsError("permission-denied", "Moving a legacy voucher to another month needs Admin or Super Admin approval.");}
  const replacementSeed = Object.assign({}, existingReplacement, {voucherNo:financeText(existingReplacement.voucherNo,60)}), replacementVoucherNo = await cashVoucherNumber(db, replacementSeed, replacementId);
  const posting = revolvingFundPosting({transactionType:type,category:next.category,recipient:next.payee,requesterName:next.payee,purpose:next.purpose}), reversal = Financial.reverseMovement(Object.assign({id:originalId},original), `${posting.movementType}_void`, "Guided legacy voucher replacement");
  Object.assign(reversal,{occurredAt:Number(original.occurredAt)||cashPaymentOccurredAt(voucher),actorName:approvedBy,approvalId:approval.id,voucherNo:financeText(voucher.voucherNo,60),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),fundingAccountId:funding.id,reversesMovementId:originalId,legacyReplacementId:replacementId});
  const replacementHasReceipt = !!(voucher.receiptImg || voucher.hasReceipt), replacement = {voucherNo:replacementVoucherNo,date:replacementDate,amount:next.amount,transactionType:type,category:next.category,supplierId:"",supplierName:"",requesterName:next.payee,recipient:next.payee,purpose:next.purpose,approverName:financeText(voucher.approverName,160),fundingAccountId:funding.id,status:"approved",createdAt:now,createdBy:actor.uid,approvedAt:now,approvedBy,approvedByUid:approval.record.approvedBy,approvalId:approval.id,replacesVoucherId:id,replacesVoucherNo:financeText(voucher.voucherNo,60),hasReceipt:replacementHasReceipt,receiptSourceVoucherId:replacementHasReceipt?id:"",cashCustodyStatus:"not_applicable",legacyReplacement:{sourceVoucherId:id,sourceVoucherNo:financeText(voucher.voucherNo,60),reason:next.reason,repairedAt:now,schemaVersion:1}};
  const corrected = Financial.movement(posting.movementType,"pettyVoucher",replacementId,[Financial.line(posting.account,next.amount,0,posting.label),Financial.line(funding.account,0,next.amount,"Paid from selected cash account")],{occurredAt:cashPaymentOccurredAt(replacement),approvedAt:now,actorName:approvedBy,approvalId:approval.id,voucherNo:replacementVoucherNo,category:next.category,payee:next.payee,purpose:next.purpose,fundingAccountId:funding.id,replacesMovementId:originalId,legacyReplacement:true});
  const writes = Object.assign({}, approval.usedWrites, {
    [`pettyCashVouchers/${id}/voided`]:true,[`pettyCashVouchers/${id}/voidedAt`]:now,[`pettyCashVouchers/${id}/voidReason`]:next.reason,[`pettyCashVouchers/${id}/voidedBy`]:approvedBy,[`pettyCashVouchers/${id}/voidedByUid`]:approval.record.approvedBy,[`pettyCashVouchers/${id}/voidApprovalId`]:approval.id,[`pettyCashVouchers/${id}/replacedByVoucherId`]:replacementId,[`pettyCashVouchers/${id}/replacedByVoucherNo`]:replacementVoucherNo,[`pettyCashVouchers/${id}/legacyReplacement`]:{replacementVoucherId:replacementId,replacementVoucherNo,reverseMovementId:reverseId,replacementMovementId:postId,reason:next.reason,repairedAt:now,legacyCorrectionMovementIds:legacyIds,schemaVersion:1},
    [`pettyCashVouchers/${replacementId}`]:replacement,
    [`financialMovements/${originalId}/reversedByMovementId`]:reverseId,
    [`books/journal/${originalId}/reversedByMovementId`]:reverseId,[`books/journal/${originalId}/correctionReplacementId`]:postId,
    [`cfLedger/fm_${reverseId}`]:cashLedgerRecord({date:originalDate,accountId:funding.id,dir:"in",category:"Legacy cash voucher void",amount:originalPaid,party:financeText(voucher.recipient||voucher.requesterName,160),ref:financeText(voucher.voucherNo,60)},reverseId,reversal,actor),
    [`cfLedger/fm_${postId}`]:cashLedgerRecord({date:replacementDate,accountId:funding.id,dir:"out",category:posting.label,amount:next.amount,party:next.payee,ref:replacementVoucherNo},postId,corrected,actor),
    [`operationalAudit/${now}_${id}_legacy_replace`]:operationalAuditRecord("void_replace_legacy_petty_voucher","pettyVoucher",id,actor,{approvalId:approval.id,approvedBy,approvedRole,selfApproved,originalVoucherNo:financeText(voucher.voucherNo,60),replacementVoucherId:replacementId,replacementVoucherNo,originalMovementId:originalId,reverseMovementId:reverseId,replacementMovementId:postId,legacyCorrectionMovementIds:legacyIds,originalDate,replacementDate,originalAmount:originalPaid,replacementAmount:next.amount,fundingAccountId:funding.id,reason:next.reason,accounting:"Reverse the proven original bank posting on its own date; retain neutral legacy journals as audit evidence; post one linked replacement against the same bank."}),
  });
  legacyIds.forEach((movementId) => {writes[`undepositedLedgerPageIndex/${movementId}`] = null;});
  const committed = await commitFinancialSet(db,[{id:reverseId,movement:reversal},{id:postId,movement:corrected}],actor,writes);
  return {voucherId:id,replacementVoucherId:replacementId,replacementVoucherNo,action:"void_replace_legacy",date:replacementDate,amount:next.amount,fundingAccountId:funding.id,duplicate:committed.duplicate};
}

async function correctApprovedPettyVoucher(db, actor, data, id, voucher, next, custodyClaims) {
  const now = Date.now(), type = financeText(voucher.transactionType, 40) || "expense";
  if (VOUCHER_CONTROLLED_TYPES.includes(type) || voucher.conversionMovementId) throw new HttpsError("failed-precondition", "Loan repayments, staff advances and customer refunds cannot be edited in place. Void with approval and record a correcting entry.");
  const funding = advanceFundingAccount(voucher);
  const before = {date: financeText(voucher.date, 10), amount: Financial.money(voucher.amount), category: financeText(voucher.category, 80), payee: financeText(voucher.recipient || voucher.requesterName, 160), supplierId: financeText(voucher.supplierId, 160), purpose: financeText(voucher.purpose, 300), approverName: financeText(voucher.approverName, 160)};
  const after = {date: assertVoucherDateNotFuture(data.date || before.date, now), amount: next.amount, category: next.category, payee: next.payee, supplierId: next.supplierId, purpose: next.purpose, approverName: next.approverName};
  const financialChange = after.date !== before.date || Math.abs(after.amount - before.amount) > 0.009 || after.category !== before.category || after.payee !== before.payee || after.purpose !== before.purpose || after.approverName !== before.approverName || (type === "purchase_advance" && after.supplierId !== before.supplierId);
  const anyChange = financialChange || after.payee !== before.payee || after.purpose !== before.purpose || after.approverName !== before.approverName;
  if (!anyChange) throw new HttpsError("invalid-argument", "Nothing was changed on this cash voucher.");
  if (financialChange && !["undeposited", "account"].includes(funding.kind)) throw new HttpsError("failed-precondition", "Cash in Register and Cash on Hand cannot be corrected in place. Void with approval and record a new voucher against Undeposited Collection or the actual bank / e-wallet account.");
  if (type === "purchase_advance" && after.date !== before.date && Object.keys(voucher.allocations || {}).length) throw new HttpsError("failed-precondition", "This supplier payment is already allocated to purchases. Reverse the linked purchases before changing its date.");
  await assertAccountingPeriodOpen(db, before.date || financeDateFromTimestamp(now), "correcting this cash voucher");
  await assertAccountingPeriodOpen(db, after.date, "correcting this cash voucher");
  const expectedRev = Math.max(0, Math.floor(Number(voucher.correctionRevision) || 0)), rev = expectedRev + 1;
  const changeHash = voucherChangeFingerprint(id, {expectedRev, date: after.date, amount: after.amount, category: after.category, payee: after.payee, supplierId: after.supplierId, purpose: after.purpose, approverName: after.approverName, reason: next.reason});
  const approval = await claimManagerApproval(db, data, "correct_petty_voucher", id, after.amount, `correct_petty_voucher_${id}_${rev}`, null, changeHash);
  const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, approvedRole = financeText(approval.record.approvedRole, 20);
  const selfApproved = approval.record.approvedBy === actor.uid;
  if (selfApproved && approvedRole !== "superadmin") {await db.ref().update(approval.usedWrites); throw new HttpsError("permission-denied", "A cash voucher correction must be approved by a different manager account (only a Super Admin may approve their own correction).");}
  if (after.date.slice(0, 7) !== before.date.slice(0, 7) && !["superadmin", "admin"].includes(approvedRole)) {await db.ref().update(approval.usedWrites); throw new HttpsError("permission-denied", "Moving a cash voucher to another month needs Admin or Super Admin approval.");}
  const writes = Object.assign({}, approval.usedWrites), base = `pettyCashVouchers/${id}`;
  Object.assign(writes, {[`${base}/date`]: after.date, [`${base}/amount`]: after.amount, [`${base}/category`]: after.category, [`${base}/supplierId`]: after.supplierId, [`${base}/supplierName`]: type === "purchase_advance" ? after.payee : "", [`${base}/requesterName`]: after.payee, [`${base}/recipient`]: after.payee, [`${base}/purpose`]: after.purpose, [`${base}/approverName`]: after.approverName, [`${base}/correctionRevision`]: rev, [`${base}/lastCorrectedAt`]: now, [`${base}/lastCorrectionReason`]: next.reason, [`${base}/lastCorrectedBy`]: approvedBy, [`${base}/lastCorrectedByUid`]: actor.uid, [`${base}/lastCorrectionApprovalId`]: approval.id});
  if (type === "purchase_advance") {writes[`${base}/allocatedAmount`] = next.allocated; writes[`${base}/remainingAmount`] = Financial.money(after.amount - next.allocated); writes[`${base}/allocationStatus`] = next.allocated > 0 ? (after.amount - next.allocated > 0 ? "partially_allocated" : "fully_allocated") : "unallocated";}
  const record = {rev, before, after, reason: next.reason, approvalId: approval.id, approvedBy, approvedRole, selfApproved, requestedBy: actor.uid, at: now, financial: financialChange};
  if (!financialChange) {
    writes[`${base}/corrections/${rev}`] = record;
    writes[`operationalAudit/${now}_${id}_correct_${rev}`] = operationalAuditRecord("correct_approved_petty_voucher", "pettyVoucher", id, actor, {before, after, reason: next.reason, revision: rev, approvalId: approval.id, selfApproved, financial: false});
    await db.ref().update(writes);
    return {voucherId: id, action: "correct", revision: rev, financial: false, selfApproved};
  }
  const effective = await voucherEffectivePosting(db, id, voucher);
  const reverseId = `petty_corr_${id}_r${rev}_rev`, postId = `petty_corr_${id}_r${rev}_post`;
  const detail = {actorName: approvedBy, approvalId: approval.id, voucherNo: financeText(voucher.voucherNo, 60), payee: after.payee, purpose: after.purpose, correctionRevision: rev, correctionReason: next.reason, fundingAccountId: funding.id || "undeposited"};
  const reversal = Financial.reverseMovement(effective.movement, "petty_cash_payment_correction_reversal", `Correction ${rev} reverses`);
  Object.assign(reversal, detail, {category: before.category, reversesMovementId: effective.movementId});
  const nextVoucher = Object.assign({}, voucher, {amount: after.amount, category: after.category, recipient: after.payee, requesterName: after.payee, purpose: after.purpose});
  const posting = type === "purchase_advance" ? {account: `asset:purchase_cash_advance:${id}`, label: after.payee || "Supplier payment pending allocation"} : revolvingFundPosting(nextVoucher);
  const correctedAt = cashPaymentOccurredAt({date: after.date});
  const corrected = Financial.movement("petty_cash_payment_correction", "pettyVoucher", id, [Financial.line(posting.account, after.amount, 0, posting.label), Financial.line(funding.account, 0, after.amount, funding.kind === "undeposited" ? "Paid from Undeposited Collection" : "Paid from selected cash account")], Object.assign({}, detail, {occurredAt: correctedAt, category: after.category, correctsMovementId: effective.movementId}));
  const fundingNet = (lines) => Financial.money((lines || []).reduce((sum, line) => sum + (line.account === funding.account ? Number(line.debit || 0) - Number(line.credit || 0) : 0), 0));
  const paidBefore = Financial.money(-fundingNet(effective.movement.lines));
  if (!(paidBefore > 0)) throw new HttpsError("failed-precondition", "The voucher's current posting does not pay from its funding account. Void with approval and record a new voucher.");
  if (funding.kind === "account") {
    const accountId = funding.id;
    const ledger = (await db.ref("/cfLedger").orderByChild("linkId").equalTo(id).limitToLast(100).get()).val() || {}, rows = Object.values(ledger), effectiveRows = rows.filter((row) => financeText(row && row.movementId, 160) === effective.movementId);
    if (rows.length >= 100) throw new HttpsError("failed-precondition", "This voucher has too many bank-register amendments to correct safely. Review it in Finance Books and use a controlled void.");
    if (rows.some(voucherLedgerRowLocked)) throw new HttpsError("failed-precondition", `This payment or an earlier correction is already reconciled to the ${funding.kind === "cash_on_hand" ? "cash-register control" : "bank statement"}. Un-reconcile it first, or void with approval and record a new voucher.`);
    const oldDate = financeDateFromTimestamp(Number(effective.movement.occurredAt) || now);
    if (effectiveRows.length !== 1 || effectiveRows[0].accountId !== accountId || effectiveRows[0].dir !== "out" || Math.abs(Financial.money(effectiveRows[0].amount) - paidBefore) > 0.009 || financeText(effectiveRows[0].date, 10) !== oldDate) throw new HttpsError("failed-precondition", `The voucher's ${funding.kind === "cash_on_hand" ? "cash-register" : "bank-register"} entry is missing or does not match Finance Books. Repair the original cash-payment register link before correcting this voucher.`);
    writes[`cfLedger/fm_${reverseId}`] = cashLedgerRecord({date: oldDate, accountId, dir: "in", category: "Cash voucher correction (reversal)", amount: paidBefore, party: before.payee, ref: financeText(voucher.voucherNo, 60)}, reverseId, Object.assign({}, reversal, {sourceType: "pettyVoucher", sourceId: id}), actor);
    writes[`cfLedger/fm_${postId}`] = cashLedgerRecord({date: after.date, accountId, dir: "out", category: posting.label, amount: after.amount, party: after.payee, ref: financeText(voucher.voucherNo, 60)}, postId, corrected, actor);
  }
  let custodyAllocations = {};
  if (funding.kind === "undeposited") {
    await claimCustodyPool(db, postId, custodyClaims);
    const [cashControl, openRows] = await Promise.all([currentCashBalances(db, now), openCustodyRows(db)]), custodyTotal = Financial.money(Object.values(openRows).reduce((sum, row) => sum + Number(row && row.remaining || 0), 0)), booksTotal = Financial.money(Number(cashControl.balances && cashControl.balances.undepositedCents || 0) / 100);
    if (Math.abs(custodyTotal - booksTotal) > 0.009) throw new HttpsError("failed-precondition", `Undeposited Collection must be reconciled before correcting this voucher. Custody is ${custodyTotal.toFixed(2)} and Finance Books is ${booksTotal.toFixed(2)}.`);
    const delta = Financial.money(after.amount - paidBefore);
    if (delta > 0) {
      const out = await poolCustodyOutflow(db, delta);
      if (out.shortfall > 0.009) throw new HttpsError("failed-precondition", `The increase exceeds available Undeposited Collection by ${out.shortfall.toFixed(2)}.`);
      Object.assign(writes, out.writes); custodyAllocations = out.allocations;
    } else if (delta < 0) Object.assign(writes, poolCustodyInflowRecord(`corr_${id}_r${rev}`, -delta, "Cash voucher correction returned", now, postId));
    corrected.custodyAllocations = custodyAllocations;
  }
  writes[`${base}/effectivePosting`] = {movementId: postId, reversedMovementId: effective.movementId, reversalMovementId: reverseId, date: after.date, amount: after.amount, account: funding.account, rev};
  writes[`${base}/corrections/${rev}`] = Object.assign(record, {reversalMovementId: reverseId, postingMovementId: postId, reversedMovementId: effective.movementId});
  writes[`operationalAudit/${now}_${id}_correct_${rev}`] = operationalAuditRecord("correct_approved_petty_voucher", "pettyVoucher", id, actor, {before, after, reason: next.reason, revision: rev, approvalId: approval.id, selfApproved, financial: true, reversalMovementId: reverseId, postingMovementId: postId, fundingAccount: funding.account});
  const committed = await commitFinancialSet(db, [{id: reverseId, movement: reversal}, {id: postId, movement: corrected}], actor, writes);
  return {voucherId: id, action: "correct", revision: rev, financial: true, reversalMovementId: reverseId, movementId: postId, selfApproved, duplicate: committed.duplicate};
}
// End of approved Cash Voucher correction.
