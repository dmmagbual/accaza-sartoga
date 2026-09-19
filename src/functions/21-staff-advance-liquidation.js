exports.managePettyVoucher = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty"]);
    const data = request.data || {}, action = financeText(data.action, 20), id = financeKey(data.voucherId, "Voucher ID"), reason = financeText(data.reason, 500);
    const ref = db.ref(`/pettyCashVouchers/${id}`), snap = await ref.get(); if (!snap.exists()) throw new HttpsError("not-found", "Revolving Fund voucher not found.");
    const voucher = snap.val() || {}, value = Financial.money(voucher.amount), now = Date.now(), hasReceipt = await voucherHasReceipt(db, id, voucher); let approvalAction;
    // Editing a voucher changes the Admin subledger as well as its linked
    // Finance correction, so the voucher's own accounting month must be open.
    if (["correct", "approve"].includes(action)) await assertAccountingPeriodOpen(db, action === "correct" && voucher.status === "pending" ? financeDate(data.date) : (financeText(voucher.date, 10) || financeDateFromTimestamp(now)), "editing or approving this Admin cash payment");
    if (action === "correct") {
      if (!["pending", "approved"].includes(voucher.status) || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active pending or approved cash payment can be edited.");
      if (voucher.returnedAt) throw new HttpsError("failed-precondition", "A returned supplier payment cannot be edited. Record a new correcting payment instead.");
      const nextAmount = Financial.money(data.amount), nextPurpose = financeText(data.purpose, 300), nextApprover = financeText(data.approverName, 160), reason = financeText(data.reason, 500), type = financeText(voucher.transactionType, 40) || "expense", selectedSupplier=type==="purchase_advance"?await requireActiveSupplier(db,data.supplierId,data.payee):null,nextPayee=selectedSupplier?selectedSupplier.name:financeText(data.payee,160),nextSupplierId=selectedSupplier?selectedSupplier.id:"";
      if (!(nextAmount > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero.");
      if (!nextPayee) throw new HttpsError("invalid-argument", "Requester or supplier payee is required.");
      if (!hasReceipt && !nextPurpose) throw new HttpsError("invalid-argument", "A receipt or clear explanation is required.");
      if (!reason) throw new HttpsError("invalid-argument", "A correction reason is required.");
      const expenseCategories = new Set(["operating_supplies","office_supplies","utilities","internet_phone","marketing","repairs","bank_fees","rent","salaries","transport","staff_meals","miscellaneous","other_expense"]), nextCategory = type === "purchase_advance" ? "Supplier payment pending inventory allocation" : type === "owner_withdrawal" ? "owner_draw" : financeText(data.category, 80);
      if (type === "expense" && !expenseCategories.has(nextCategory)) throw new HttpsError("invalid-argument", "Expense category is invalid.");
      const allocated = Financial.money(Object.values(voucher.allocations || {}).reduce((sum, row) => sum + Number(row && row.amount || 0), 0));
      if (type === "purchase_advance" && allocated > 0 && financeText(voucher.supplierId,160) !== nextSupplierId) throw new HttpsError("failed-precondition", "Reverse every linked inventory purchase before changing the supplier on this payment.");
      if (type === "purchase_advance" && nextAmount + 0.009 < allocated) throw new HttpsError("failed-precondition", `Amount cannot be below the ${allocated.toFixed(2)} already allocated to inventory purchases.`);
      const nextDate = voucher.status === "pending" ? financeDate(data.date) : financeText(voucher.date, 10), before = {date:financeText(voucher.date,10),amount:value,category:financeText(voucher.category,80),payee:financeText(voucher.recipient||voucher.requesterName,160),purpose:financeText(voucher.purpose,300),approverName:financeText(voucher.approverName,160)}, after = {date:nextDate,amount:nextAmount,category:nextCategory,payee:nextPayee,purpose:nextPurpose,approverName:nextApprover};
      const revision = Math.max(0, Math.floor(Number(voucher.correctionRevision)||0)) + 1, writes = {[`pettyCashVouchers/${id}/date`]:nextDate,[`pettyCashVouchers/${id}/amount`]:nextAmount,[`pettyCashVouchers/${id}/category`]:nextCategory,[`pettyCashVouchers/${id}/supplierId`]:nextSupplierId,[`pettyCashVouchers/${id}/supplierName`]:type==="purchase_advance"?nextPayee:"",[`pettyCashVouchers/${id}/requesterName`]:nextPayee,[`pettyCashVouchers/${id}/recipient`]:nextPayee,[`pettyCashVouchers/${id}/purpose`]:nextPurpose,[`pettyCashVouchers/${id}/approverName`]:nextApprover,[`pettyCashVouchers/${id}/correctionRevision`]:revision,[`pettyCashVouchers/${id}/lastCorrectedAt`]:now,[`pettyCashVouchers/${id}/lastCorrectionReason`]:reason};
      if (type === "purchase_advance") {writes[`pettyCashVouchers/${id}/allocatedAmount`]=allocated;writes[`pettyCashVouchers/${id}/remainingAmount`]=Financial.money(nextAmount-allocated);writes[`pettyCashVouchers/${id}/allocationStatus`]=allocated>0?(nextAmount-allocated>0?"partially_allocated":"fully_allocated"):"unallocated";}
      if (voucher.status === "pending") {writes[`operationalAudit/${now}_${id}_correct_${revision}`]=operationalAuditRecord("correct_pending_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision});await db.ref().update(writes);return {voucherId:id,action,revision,pending:true};}
      const approval = await claimManagerApproval(db,data,"correct_petty_voucher",id,nextAmount,`correct_petty_voucher_${id}_${revision}`), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, oldPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:voucher.recipient||"Supplier payment pending allocation"} : revolvingFundPosting(voucher), nextVoucher = Object.assign({},voucher,{amount:nextAmount,category:nextCategory,recipient:nextPayee,requesterName:nextPayee,purpose:nextPurpose,approverName:nextApprover}), nextPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:nextPayee} : revolvingFundPosting(nextVoucher), delta = Financial.money(nextAmount-value), correctionId = `petty_correct_${id}_${revision}`, funding = type === "purchase_advance" ? advanceFundingAccount(voucher) : {kind:"undeposited",account:"asset:cash_awaiting_deposit"};
      let custodyWrites = {}; if (funding.kind === "undeposited") { if (delta > 0) {const custodyOut=await poolCustodyOutflow(db,delta);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`The increase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);custodyWrites=custodyOut.writes;} else if (delta < 0) custodyWrites = poolCustodyInflowRecord(correctionId,-delta,"Cash payment correction returned",now,correctionId); }
      const movement = Financial.movement("petty_cash_payment_correction","pettyVoucher",id,[Financial.line(funding.account,value,0,"Reverse previous cash payment"),Financial.line(oldPosting.account,0,value,"Reverse "+oldPosting.label),Financial.line(nextPosting.account,nextAmount,0,nextPosting.label),Financial.line(funding.account,0,nextAmount,"Corrected cash payment")],{occurredAt:now,actorName:approvedBy,approvalId:approval.id,voucherNo:financeText(voucher.voucherNo,60),category:nextCategory,payee:nextPayee,purpose:nextPurpose,correctionRevision:revision,correctionReason:reason});
      Object.assign(writes,approval.usedWrites,custodyWrites,{[`pettyCashVouchers/${id}/lastCorrectedBy`]:approvedBy,[`pettyCashVouchers/${id}/lastCorrectionApprovalId`]:approval.id,[`pettyCashVouchers/${id}/correctionMovementIds/${revision}`]:correctionId,[`operationalAudit/${now}_${id}_correct_${revision}`]:operationalAuditRecord("correct_approved_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision,approvalId:approval.id,movementId:correctionId})});
      const committed = await commitFinancial(db,correctionId,movement,actor,writes);return {voucherId:id,action,revision,movementId:correctionId,duplicate:committed.duplicate};
    }
    if (action === "return") {if(voucher.transactionType!=="purchase_advance"||voucher.status!=="approved"||voucher.voided===true)throw new HttpsError("failed-precondition","Only an active supplier payment can be returned.");const remaining=Financial.money(voucher.remainingAmount!=null?voucher.remainingAmount:value);if(!(remaining>0))throw new HttpsError("failed-precondition","This supplier payment has no unallocated balance to return.");if(!reason)throw new HttpsError("invalid-argument","A return reason is required.");const funding=advanceFundingAccount(voucher),approval=await claimManagerApproval(db,data,"return_supplier_payment",id,remaining,`return_supplier_payment_${id}`),movementId=`petty_return_${id}`,movement=Financial.movement("revolving_fund_supplier_payment_return","pettyVoucher",id,[Financial.line(funding.account,remaining,0,funding.kind==="undeposited"?"Returned to Undeposited Collection":"Returned to selected cash account"),Financial.line(`asset:purchase_cash_advance:${id}`,0,remaining,"Clear unallocated supplier payment")],{occurredAt:now,actorName:approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,approvalId:approval.id}),writes=Object.assign({},approval.usedWrites,funding.kind==="undeposited"?poolCustodyInflowRecord(`petty_return_${id}`,remaining,"Supplier payment returned",now,`petty_return_${id}`):{},{[`pettyCashVouchers/${id}/remainingAmount`]:0,[`pettyCashVouchers/${id}/allocationStatus`]:(Number(voucher.allocatedAmount)||0)>0?"partially_allocated_returned":"returned_unallocated",[`pettyCashVouchers/${id}/returnedAmount`]:remaining,[`pettyCashVouchers/${id}/returnedAt`]:now,[`pettyCashVouchers/${id}/returnReason`]:reason,[`pettyCashVouchers/${id}/returnApprovalId`]:approval.id,[`operationalAudit/${now}_${id}_return`]:operationalAuditRecord("return_supplier_payment","pettyVoucher",id,actor,{approvalId:approval.id,amount:remaining,reason})});const committed=await commitFinancial(db,movementId,movement,actor,writes);return {voucherId:id,action,amount:remaining,duplicate:committed.duplicate};}
    if (action === "liquidate") {
      if (voucher.transactionType !== "staff_advance" || voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active staff advance can be liquidated.");
      const remaining = Financial.money(voucher.remainingAmount != null ? voucher.remainingAmount : value);
      if (!(remaining > 0)) throw new HttpsError("failed-precondition", "This staff advance has no outstanding balance.");
      const settlementType = financeText(data.settlementType, 30);
      if (!["cash", "payroll_deduction", "write_off"].includes(settlementType)) throw new HttpsError("invalid-argument", "Settlement type must be cash, payroll deduction, or write-off.");
      const settlementAmount = Financial.money(data.amount);
      if (!(settlementAmount > 0)) throw new HttpsError("invalid-argument", "Settlement amount must be greater than zero.");
      if (settlementAmount > remaining + 0.009) throw new HttpsError("failed-precondition", `Settlement exceeds the outstanding balance of ${remaining.toFixed(2)}.`);
      if (!reason) throw new HttpsError("invalid-argument", "A settlement reference or explanation is required.");
      if (settlementType === "write_off" && !["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner or superadmin can write off a staff advance.");
      const settlementId = financeKey(data.commandId, "Command ID"), date = financeDate(data.date);
      if ((await db.ref(`/financialMovements/${settlementId}`).get()).exists()) return {voucherId: id, action, settlementId, duplicate: true};
      await assertAccountingPeriodOpen(db, date, "liquidating this staff advance");
      let debitAccount = "", debitLabel = "", custodyWrites = {}, settlementAccountId = "";
      if (settlementType === "cash") {
        settlementAccountId = financeText(data.accountId, 120) || "undeposited";
        if (["register", "cash_float"].includes(settlementAccountId)) throw new HttpsError("failed-precondition", "Register Cash is retired and Cash Float is controlled. Select Undeposited Collection, Cash on Hand, or an active bank/cash account.");
        const destination = advanceFundingAccount({fundingAccountId: settlementAccountId});
        debitAccount = destination.account;
        if (destination.kind === "undeposited") custodyWrites = poolCustodyInflowRecord(settlementId, settlementAmount, "Staff advance repaid", now, settlementId);
        debitLabel = "Staff advance cash repayment";
      } else if (settlementType === "payroll_deduction") {
        debitAccount = "coa:6000"; debitLabel = "Staff advance recovered through payroll";
      } else {
        debitAccount = "coa:6079"; debitLabel = "Staff advance written off";
      }
      const approval = await claimManagerApproval(db, data, "liquidate_staff_advance", id, settlementAmount, `liquidate_staff_advance_${settlementId}`);
      const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
      const movement = Financial.movement(`staff_advance_${settlementType}`, "pettyVoucher", id, [Financial.line(debitAccount, settlementAmount, 0, debitLabel), Financial.line("coa:1120", 0, settlementAmount, "Staff advance liquidated")], {occurredAt: cashPaymentOccurredAt({date}), actorName: approvedBy, approvalId: approval.id, voucherNo: financeText(voucher.voucherNo, 60), payee: financeText(voucher.recipient || voucher.staffName, 160), settlementType, reference: reason});
      const nextRemaining = Financial.money(remaining - settlementAmount), nextLiquidated = Financial.money(Financial.money(voucher.liquidatedAmount || 0) + settlementAmount);
      const writes = Object.assign({}, approval.usedWrites, custodyWrites, {
        [`pettyCashVouchers/${id}/remainingAmount`]: nextRemaining,
        [`pettyCashVouchers/${id}/liquidatedAmount`]: nextLiquidated,
        [`pettyCashVouchers/${id}/liquidationStatus`]: nextRemaining > 0.009 ? "partially_liquidated" : "liquidated",
        [`pettyCashVouchers/${id}/settlements/${settlementId}`]: {type: settlementType, amount: settlementAmount, date, reference: reason, accountId: settlementAccountId, movementId: settlementId, ts: now, createdBy: actor.uid, createdByRole: actor.role, approvalId: approval.id},
        [`operationalAudit/${now}_${settlementId}`]: operationalAuditRecord("liquidate_staff_advance", "pettyVoucher", id, actor, {settlementId, settlementType, amount: settlementAmount, remainingAmount: nextRemaining, approvalId: approval.id, reason, accounting: settlementType === "cash" ? "Debit the selected cash account; credit Staff Advances." : settlementType === "payroll_deduction" ? "Debit Salaries & Wages; credit Staff Advances." : "Debit Staff Advance Write-offs; credit Staff Advances."}),
      });
      const committed = await commitFinancial(db, settlementId, movement, actor, writes);
      return {voucherId: id, action, settlementId, amount: settlementAmount, remainingAmount: nextRemaining, duplicate: committed.duplicate};
    }
    if (action === "reverse_settlement") {
      if (!["owner", "superadmin"].includes(actor.role)) throw new HttpsError("permission-denied", "Only the owner or superadmin can reverse a staff advance settlement.");
      const settlementId = financeKey(data.settlementId, "Settlement ID"), settlement = (voucher.settlements || {})[settlementId];
      if (!settlement) throw new HttpsError("not-found", "Settlement not found on this staff advance.");
      if (settlement.reversedAt) throw new HttpsError("failed-precondition", "This settlement has already been reversed.");
      if (!reason) throw new HttpsError("invalid-argument", "A reversal reason is required.");
      const original = (await db.ref(`/financialMovements/${settlementId}`).get()).val();
      if (!original || !Array.isArray(original.lines) || !original.lines.length) throw new HttpsError("failed-precondition", "The original settlement movement is missing. Repair the ledger before reversing it.");
      if (original.reversedByMovementId) throw new HttpsError("failed-precondition", "This settlement movement has already been reversed.");
      const reverseId = `staff_advance_settle_reverse_${settlementId}`;
      if ((await db.ref(`/financialMovements/${reverseId}`).get()).exists()) return {voucherId: id, action, settlementId, duplicate: true};
      const date = financeDate(data.date);
      await assertAccountingPeriodOpen(db, date, "reversing this staff advance settlement");
      const settlementValue = Financial.money(settlement.amount);
      const approval = await claimManagerApproval(db, data, "reverse_staff_advance_settlement", id, settlementValue, `reverse_staff_advance_settlement_${settlementId}`);
      const reversal = Financial.reverseMovement(Object.assign({}, original, {id: settlementId}), `staff_advance_${settlement.type}_reversed`, reason);
      if (!BooksBridge.linesBalanced(reversal.lines)) throw new HttpsError("failed-precondition", "The calculated settlement reversal is unbalanced. Review the original movement before correcting.");
      const movement = Object.assign(reversal, {occurredAt: cashPaymentOccurredAt({date}), actorName: approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, reason, reversalOf: settlementId});
      const nextRemaining = Financial.money(Financial.money(voucher.remainingAmount || 0) + settlementValue), nextLiquidated = Financial.money(Math.max(0, Financial.money(voucher.liquidatedAmount || 0) - settlementValue));
      let custodyWrites = {}; if (settlement.type === "cash" && (settlement.accountId === "undeposited" || !settlement.accountId)) { const custodyOut = await poolCustodyOutflow(db, settlementValue); if (custodyOut.shortfall > 0.009) throw new HttpsError("failed-precondition", `Reversing this repayment exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`); custodyWrites = custodyOut.writes; }
      const writes = Object.assign({}, approval.usedWrites, custodyWrites, {
        [`pettyCashVouchers/${id}/remainingAmount`]: nextRemaining,
        [`pettyCashVouchers/${id}/liquidatedAmount`]: nextLiquidated,
        [`pettyCashVouchers/${id}/liquidationStatus`]: nextLiquidated > 0.009 ? "partially_liquidated" : "unliquidated",
        [`pettyCashVouchers/${id}/settlements/${settlementId}/reversedAt`]: now,
        [`pettyCashVouchers/${id}/settlements/${settlementId}/reversalMovementId`]: reverseId,
        [`pettyCashVouchers/${id}/settlements/${settlementId}/reversalReason`]: reason,
        [`financialMovements/${settlementId}/reversedByMovementId`]: reverseId,
        [`operationalAudit/${now}_${reverseId}`]: operationalAuditRecord("reverse_staff_advance_settlement", "pettyVoucher", id, actor, {settlementId, reverseId, amount: settlementValue, remainingAmount: nextRemaining, reason, approvalId: approval.id}),
      });
      const committed = await commitFinancial(db, reverseId, movement, actor, writes);
      return {voucherId: id, action, settlementId, reverseId, amount: settlementValue, remainingAmount: nextRemaining, duplicate: committed.duplicate};
    }
    if (action === "approve") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be approved.");
      if (voucher.transactionType === "purchase_advance") await requireActiveSupplier(db,voucher.supplierId,voucher.supplierName||voucher.recipient);
      if (voucher.transactionType === "loan_repayment") {
        const code=financeText(voucher.debitAccountCode,4),booksChart=await ensureBooksChart(db),loan=booksChart[code],interest=Financial.money(voucher.interestAmount||0),interestCode=financeText(voucher.interestAccountCode,4),interestRow=interestCode&&booksChart[interestCode];
        if(!/^23\d{2}$/.test(code)||!loan||loan.active===false||loan.type!=="Liability")throw new HttpsError("failed-precondition","Select an active loan-liability account (2300-2399).");
        if(interest<0||interest>value)throw new HttpsError("invalid-argument","Loan interest cannot be negative or exceed the payment amount.");
        if(interest>0&&(!interestRow||interestRow.active===false||interestRow.type!=="Expense"))throw new HttpsError("failed-precondition","Select an active expense account for the interest portion.");
      }
      if (voucher.transactionType === "staff_advance") {
        const staffId=financeKey(voucher.staffId,"Staff member ID"),staffSnap=await db.ref(`/posStaff/${staffId}`).get(),staff=staffSnap.val();
        if(!staffSnap.exists()||!staff||staff.active===false)throw new HttpsError("failed-precondition","The selected staff member is missing or inactive.");
      }
      if (voucher.transactionType === "customer_refund") {
        const payableId=financeKey(voucher.payableId,"Customer refund payable ID"),payable=(await db.ref(`/payables/${payableId}`).get()).val(),remaining=Financial.money(payable&&payable.remainingAmount!=null?payable.remainingAmount:payable&&payable.amount);
        if(!payable||payable.type!=="customer_change_refund"||payable.status!=="open")throw new HttpsError("failed-precondition","Select an open customer refund payable.");
        if(value>remaining+0.009)throw new HttpsError("failed-precondition","The refund payment exceeds the payable's remaining balance.");
      }
      {
        const fundingAccountId = financeText(voucher.fundingAccountId, 120) || "undeposited", fundingValue = Financial.money(voucher.amount);
        if (["register", "cash_float"].includes(fundingAccountId)) throw new HttpsError("failed-precondition", "Register Cash is retired and Cash Float is controlled. Select Undeposited Collection, Cash on Hand, or an active bank/cash account.");
        if (fundingAccountId === "cash_on_hand") {
          const cash = await availableCashOnHandAboveFloat(db);
          if (fundingValue > cash.available + 0.009) throw new HttpsError("failed-precondition", `This payment exceeds available Cash on Hand by ${Financial.money(fundingValue - cash.available).toFixed(2)}. The protected Register Cash Float of ${cash.float.toFixed(2)} cannot be used.`);
        } else if (fundingAccountId === "undeposited") {
          const custodyPreview = await poolCustodyOutflow(db, fundingValue);
          if (custodyPreview.shortfall > 0.009) throw new HttpsError("failed-precondition", `This payment exceeds available Undeposited Collection by ${custodyPreview.shortfall.toFixed(2)}.`);
        } else {
          const fundingAccounts = (await db.ref("/cfAccounts").get()).val() || {};
          accountIdFor(fundingAccounts, fundingAccountId);
        }
      }
      if (!hasReceipt && !financeText(voucher.purpose, 300)) throw new HttpsError("failed-precondition", "A receipt or clear explanation is required before approval.");
      approvalAction = "approve_petty_voucher";
    } else if (action === "reject") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be rejected.");
      if (!reason) throw new HttpsError("invalid-argument", "A rejection reason is required."); approvalAction = "reject_petty_voucher";
    } else if (action === "void") {
      if (voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved voucher can be voided.");
      if (voucher.transactionType === "purchase_advance" && (Object.keys(voucher.allocations || {}).length || voucher.returnedAt)) throw new HttpsError("failed-precondition", "An allocated or returned supplier payment cannot be voided. Reverse its linked activity first.");
      if (voucher.transactionType === "staff_advance" && Object.values(voucher.settlements || {}).some((row) => row && !row.reversedAt)) throw new HttpsError("failed-precondition", "A liquidated staff advance cannot be voided. Reverse its settlements first.");
      if (!reason) throw new HttpsError("invalid-argument", "A void reason is required."); approvalAction = "void_petty_voucher";
    } else throw new HttpsError("invalid-argument", "Petty voucher action is invalid.");
    const approval = await claimManagerApproval(db, data, approvalAction, id, value, `${approvalAction}_${id}`);
    const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    if (action === "approve") {
      const requesterName = financeText(voucher.requesterName, 160).toLowerCase();
      const managerNames = [approval.record.approvedName, String(approval.record.approvedEmail || "").split("@")[0]].map((x) => financeText(x, 160).toLowerCase()).filter(Boolean);
      if (requesterName && managerNames.includes(requesterName)) {await db.ref().update(approval.usedWrites); throw new HttpsError("failed-precondition", "The requester cannot approve their own voucher.");}
    }
    const approvalFunding = action === "approve" ? advanceFundingAccount(voucher) : {kind:"undeposited"};
    let baseFunds = 0;
    if (action === "approve" && approvalFunding.kind === "undeposited") {
      // Custody rows that still hold cash, read through the remaining index (fresh, server-side).
      const custodySnap = await openCustodyRows(db);
      baseFunds = Financial.money(Object.values(custodySnap).reduce((sum, row) => sum + Financial.money(row && row.remaining), 0));
    }
    // Transact on this voucher only: the whole node (with legacy receipt images) was downloaded
    // and re-uploaded on every approval before Sep 2026.
    let failure = "", duplicate = false; const transactionState = {seen: false};
    const result = await ref.transaction((row) => {
      const current = transactionCurrent(row, voucher, transactionState), all = {}; failure = ""; duplicate = false;
      if (!current) {failure = "Revolving Fund voucher not found."; return;}
      if (action === "approve") {
        if (current.status === "approved" && current.approvalId === approval.id) {duplicate = true; return current;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be approved."; return;}
        if (!(current.receiptImg || (current.hasReceipt === true && hasReceipt)) && !financeText(current.purpose, 300)) {failure = "A receipt or clear explanation is required before approval."; return;}
        if (approvalFunding.kind === "undeposited") {const available = Financial.money(baseFunds);if (value > available + 0.009) {failure = `Voucher exceeds available Undeposited Collection (₱${available.toFixed(2)}).`; return;}}
        all[id] = Object.assign({}, current, {status: "approved", approvedBy, approvedByUid: approval.record.approvedBy, approvedAt: now, approvalId: approval.id, conversionMovementId: ["loan_repayment","staff_advance","customer_refund"].includes(current.transactionType) ? (current.conversionMovementId || "controlled_pending") : current.conversionMovementId});
      } else if (action === "reject") {
        if (current.status === "rejected" && current.rejectionApprovalId === approval.id) {duplicate = true; return current;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be rejected."; return;}
        all[id] = Object.assign({}, current, {status: "rejected", rejectReason: reason, rejectedBy: approvedBy, rejectedByUid: approval.record.approvedBy, rejectedAt: now, rejectionApprovalId: approval.id});
      } else {
        if (current.voided === true && current.voidApprovalId === approval.id) {duplicate = true; return current;}
        if (current.status !== "approved" || current.voided === true) {failure = "Only an active approved voucher can be voided."; return;}
        all[id] = Object.assign({}, current, {voided: true, status: ["loan_repayment","staff_advance","customer_refund"].includes(current.transactionType) ? "reversed" : "approved", voidReason: reason, voidedBy: approvedBy, voidedByUid: approval.record.approvedBy, voidedAt: now, voidApprovalId: approval.id});
      }
      return all[id];
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", failure || "Voucher changed while it was being reviewed. Refresh and try again.");
    const controlledType=["loan_repayment","staff_advance","customer_refund"].includes(voucher.transactionType);if(controlledType&&(action==="approve"||action==="void")){const controlledAfter=Object.assign({},result.snapshot.val()||voucher,{status:action==="void"?"reversed":"approved",approvedBy:action==="approve"?approvedBy:voucher.approvedBy,approvedAt:action==="approve"?now:voucher.approvedAt});await postControlledPettyVoucher(db,id,voucher,controlledAfter,{uid:actor.uid,role:actor.role});}
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord(`${action}_petty_voucher`, "pettyVoucher", id, actor, {approvalId: approval.id, amount: value, evidenceType: hasReceipt ? "receipt" : "manager_reviewed_explanation", explanation: financeText(voucher.purpose, 300)})}));
    return {voucherId: id, action, at: now, duplicate};
  },
);

exports.retireRevolvingFund = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty", "cashflow"]);
    const data = request.data || {}, now = Date.now();
    const movementsSnap = /* download-ok: manual one-time revolving fund retirement */await db.ref("/financialMovements").get(); let bal = 0;
    Object.values(movementsSnap.val() || {}).forEach((m) => ((m && m.lines) || []).forEach((l) => { if (l && l.account === "asset:petty_cash") bal = Financial.money(bal + Financial.money(l.debit) - Financial.money(l.credit)); }));
    bal = Financial.money(bal);
    if (data.preview === true) return {balance: bal, retired: false, preview: true};
    if (!(bal > 0)) return {balance: bal, retired: false, reason: "The Revolving Fund balance is already zero — nothing to retire."};
    const approval = await claimManagerApproval(db, data, "retire_revolving_fund", "revolvingFund", bal, "retire_revolving_fund");
    const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    const movementId = "revolving_fund_retirement", custodyId = "revfund_retirement";
    const movement = Financial.movement("revolving_fund_retirement", "revolvingFund", "retirement", [Financial.line("asset:cash_awaiting_deposit", bal, 0, "Revolving Fund folded into Undeposited Collection"), Financial.line("asset:petty_cash", 0, bal, "Retire Revolving Fund")], {occurredAt: now, actorName: approvedBy, approvalId: approval.id});
    const writes = Object.assign({}, approval.usedWrites, {[`cashCustody/${custodyId}`]: {shiftId: custodyId, staff: "Revolving Fund retirement", amount: bal, depositedAmount: 0, remaining: bal, retainedFloat: 0, status: "awaiting_deposit", closedAt: now, movementId, source: "revolving_fund_retirement", schemaVersion: 2}, [`operationalAudit/${now}_revolving_fund_retirement`]: operationalAuditRecord("retire_revolving_fund", "revolvingFund", "retirement", actor, {approvalId: approval.id, amount: bal})});
    const committed = await commitFinancial(db, movementId, movement, actor, writes);
    if (committed.duplicate) { await db.ref().update(approval.usedWrites); return {balance: bal, retired: false, duplicate: true}; }
    return {balance: bal, retired: true, amount: bal, approvalId: approval.id};
  },
);
