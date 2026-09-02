const REJECTED_ORDER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function operationalAuditRecord(action, sourceType, sourceId, actor, details = {}) {
  return Object.assign({
    action, sourceType, sourceId, actorUid: actor.uid, actorRole: actor.role,
    ts: Date.now(), schemaVersion: 1,
  }, details);
}

exports.manageOrderArchive = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const db = getDatabase();
    const actor = await requirePortalPermission(db, request, ["orders"]);
    const data = request.data || {};
    const action = financeText(data.action, 40);
    const orderId = financeKey(data.orderId, "Order ID");
    const now = Date.now();
    if (action === "archive") {
      if (!["owner", "superadmin", "admin", "manager"].includes(actor.role)) {
        throw new HttpsError("permission-denied", "Only managers may archive orders.");
      }
      const [orderSnap, archivedSnap] = await Promise.all([
        db.ref(`/orders/${orderId}`).get(), db.ref(`/archivedOrders/${orderId}`).get(),
      ]);
      if (!orderSnap.exists()) {
        if (archivedSnap.exists()) return {orderId, duplicate: true};
        throw new HttpsError("not-found", "Order not found.");
      }
      const order = Object.assign({id: orderId}, orderSnap.val() || {});
      if (order.shiftId) {
        const shift = (await db.ref(`/shifts/${financeKey(order.shiftId, "Shift ID")}`).get()).val() || null;
        if (shift && shift.status !== "closed") throw new HttpsError("failed-precondition", "Orders cannot be archived while their shift is open.");
      }
      if (!["Completed", "Received", "Rejected"].includes(String(order.status || "")) && order.voided !== true) {
        throw new HttpsError("failed-precondition", "Only completed, received, rejected, or voided orders can be archived.");
      }
      const archived = archivedOrderRecord(order, now, "manual-server");
      await db.ref().update({
        [`archivedOrders/${orderId}`]: archived,
        [`orders/${orderId}`]: null,
        [`activeOrders/${orderId}`]: null,
        [`operationalAudit/${now}_${orderId}`]: operationalAuditRecord("archive_order", "order", orderId, actor, {previousStatus: order.status || ""}),
      });
      return {orderId, archivedAt: now};
    }
    if (action === "delete") {
      const snap = await db.ref(`/archivedOrders/${orderId}`).get();
      if (!snap.exists()) throw new HttpsError("not-found", "Archived order not found.");
      const order = snap.val() || {};
      const archivedAt = Number(order.archivedAt || 0);
      if (String(order.prevStatus || "") !== "Rejected") {
        throw new HttpsError("failed-precondition", "Financial sales are retained and cannot be permanently deleted. Only rejected orders are eligible.");
      }
      if (!archivedAt || now - archivedAt < REJECTED_ORDER_RETENTION_MS) {
        throw new HttpsError("failed-precondition", "Rejected orders must remain archived for at least 90 days before deletion.");
      }
      const financialSnap = await db.ref(`/financialMovements/sale_${orderId}`).get();
      if (financialSnap.exists()) throw new HttpsError("failed-precondition", "This order has a financial posting and cannot be deleted.");
      const approval = await claimManagerApproval(db, data, "delete_archived_order", orderId, Financial.money(order.total), `delete_archived_order_${orderId}`);
      await db.ref().update(Object.assign({}, approval.usedWrites, {
        [`archivedOrders/${orderId}`]: null,
        [`deletionAudit/orders/${orderId}`]: {
          orderId, previousStatus: order.prevStatus || "Rejected", archivedAt,
          deletedAt: now, deletedBy: actor.uid, approvalId: approval.id,
          approvedBy: approval.record.approvedEmail || approval.record.approvedRole,
          policy: "rejected-order-90-days", schemaVersion: 1,
        },
        [`operationalAudit/${now}_${orderId}`]: operationalAuditRecord("delete_archived_order", "order", orderId, actor, {approvalId: approval.id}),
      }));
      return {orderId, deletedAt: now};
    }
    throw new HttpsError("invalid-argument", "Archive action is invalid.");
  },
);

exports.reviewDiscrepancy = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["discrepancy", "registerOps"]);
    const data = request.data || {}, id = financeKey(data.discrepancyId, "Discrepancy ID"), note = financeText(data.note, 500);
    if (!note) throw new HttpsError("invalid-argument", "A root-cause note is required.");
    const ref = db.ref(`/discrepancies/${id}`), snap = await ref.get();
    if (!snap.exists()) throw new HttpsError("not-found", "Discrepancy not found.");
    const row = snap.val() || {}; if (row.status === "reviewed") return {discrepancyId: id, duplicate: true};
    await assertAccountingPeriodOpen(db, financeText(row.date, 10) || financeDateFromTimestamp(Number(row.closedAt || row.ts || row.createdAt || Date.now())), "resolving this Admin cash discrepancy");
    const now = Date.now(); let approval, reviewedBy;
    if(row.kind==="cash"&&Number(data.caseVersion)===2){
      const short=Number(row.variance)<0,totalValue=Financial.money(Math.abs(Number(row.variance)||0)),shiftId=financeKey(row.shiftId,"Shift ID"),raw=Array.isArray(data.allocations)?data.allocations:[],prior=row.resolutionAllocations||{},priorTotal=Financial.money(Object.values(prior).reduce((sum,x)=>sum+Number(x&&x.amount||0),0)),remaining=Financial.money(totalValue-priorTotal),revision=Math.max(0,Math.floor(Number(row.resolutionRevision)||0))+1;
      if(!raw.length||raw.length>20)throw new HttpsError("invalid-argument","Add between one and twenty treatment allocations.");
      const allowed=short?new Set(["cash_recovered","business_expense","supplier_purchase","staff_receivable","owner_draw","counting_error","offset_prior_overage"]):new Set(["customer_refund","unrecorded_sale","capital_contribution","supplier_refund","unrecorded_cash_in","unexplained_overage","counting_error","offset_prior_shortage"]),allocations=[],seen=new Set();let batchTotal=0;
      raw.forEach((x,index)=>{const allocationId=financeKey(x&&x.id||`a${index+1}`,"Allocation ID"),treatment=financeText(x&&x.treatment,50),value=Financial.money(x&&x.amount);if(seen.has(allocationId)||prior[allocationId])throw new HttpsError("already-exists",`Allocation ${allocationId} has already been used.`);if(!allowed.has(treatment))throw new HttpsError("invalid-argument",`Allocation ${index+1} has an invalid treatment.`);if(!(value>0))throw new HttpsError("invalid-argument",`Allocation ${index+1} must be greater than zero.`);seen.add(allocationId);batchTotal=Financial.money(batchTotal+value);allocations.push({id:allocationId,treatment,amount:value,details:x.details||{}});});
      if(batchTotal>remaining+.009)throw new HttpsError("failed-precondition",`Allocations exceed the remaining difference of ${remaining.toFixed(2)}.`);
      const note=financeText(data.note,500);if(!note)throw new HttpsError("invalid-argument","A case explanation is required.");approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}_${revision}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
      const accounts=(await db.ref("/cfAccounts").get()).val()||{},booksChart=await ensureBooksChart(db),movements=(await db.ref("/financialMovements").get()).val()||{},shiftRow=(await db.ref(`/shifts/${shiftId}`).get()).val()||{},purchasePayouts=Array.isArray(shiftRow.payOuts)?shiftRow.payOuts.slice():[],pending=short?"asset:cash_shortage_pending":"liability:cash_overage_pending",legacyMovement=movements[`shift_variance_${shiftId}`]||{},source=legacyMovement.type==="shift_cash_variance"?(short?"expense:cash_shortage":"revenue:cash_overage"):pending,newLines=[],writes=Object.assign({},approval.usedWrites),allocationRecords={},offsetCases={};
      function text(v,n){return financeText(v,n||160);}function cashAccount(destination){if(destination==="undeposited")return"asset:cash_awaiting_deposit";if(destination==="register")return"asset:register_cash";const key=financeKey(destination,"Cash destination");if(!accounts[key]||accounts[key].active===false)throw new HttpsError("failed-precondition","The selected receiving cash account is inactive or missing.");return`asset:cash_account:${key}`;}
      for(const allocation of allocations){const d=allocation.details||{},v=allocation.amount,label=`${short?"Shortage":"Overage"} · ${allocation.treatment}`,record={id:allocation.id,treatment:allocation.treatment,amount:v,details:{},approvedAt:now,approvedBy:reviewedBy,approvalId:approval.id};
        if(allocation.treatment==="cash_recovered"){
          const destination=text(d.destination||"undeposited",160),asset=cashAccount(destination),requested=text(d.correctionMovementId,160),reference=text(d.reference,120);if(!reference)throw new HttpsError("invalid-argument","Recovered cash requires a return, acknowledgement, shift, or manager control reference.");let linked=requested&&movements[requested]?requested:"";
          if(!linked){const matches=Object.keys(movements).filter((mid)=>{const m=movements[mid]||{};if(m.discrepancyAllocationId||m.reversalOf)return false;const cashDelta=Financial.money((m.lines||[]).reduce((s,l)=>s+(l.account===asset?(Number(l.debit)||0)-(Number(l.credit)||0):0),0)),clear=Financial.money((m.lines||[]).reduce((s,l)=>s+([source,"coa:1190"].includes(l.account)?(Number(l.credit)||0)-(Number(l.debit)||0):0),0));return Math.abs(cashDelta-v)<.009&&Math.abs(clear-v)<.009;});if(matches.length===1)linked=matches[0];else if(matches.length>1)throw new HttpsError("failed-precondition","More than one matching recovery journal exists. Select the exact Finance movement.");}
          if(linked){const m=movements[linked],cashDelta=Financial.money((m.lines||[]).reduce((s,l)=>s+(l.account===asset?(Number(l.debit)||0)-(Number(l.credit)||0):0),0)),clear=Financial.money((m.lines||[]).reduce((s,l)=>s+([source,"coa:1190"].includes(l.account)?(Number(l.credit)||0)-(Number(l.debit)||0):0),0));if(Math.abs(cashDelta-v)>.009||Math.abs(clear-v)>.009)throw new HttpsError("failed-precondition","The selected journal does not match the recovery amount, cash destination, and shortage control account.");const linkRef=db.ref(`/financialControlLinks/correctionMovements/${financeKey(linked,"Correction movement ID")}`),claim=await linkRef.transaction((current)=>{if(current&&(current.discrepancyId!==id||current.allocationId!==allocation.id))return;return current||{discrepancyId:id,allocationId:allocation.id,amount:v,linkedAt:now,approvalId:approval.id};},undefined,false);if(!claim.committed)throw new HttpsError("already-exists","The selected journal is already linked to another resolution.");record.correctionMovementId=linked;}else newLines.push(Financial.line(asset,v,0,label),Financial.line(source,0,v,label));
          if(destination==="undeposited"){const custodyId=`cash_recovery_${id}_${allocation.id}`;writes[`cashCustody/${custodyId}`]={shiftId,staff:`Recovered cash · ${text(row.staff,80)||"Manager"}`,amount:v,depositedAmount:0,remaining:v,retainedFloat:0,status:"awaiting_deposit",closedAt:now,movementId:record.correctionMovementId||`cash_difference_${id}_${revision}`,source:"cash_shortage_recovery",reference,discrepancyId:id,allocationId:allocation.id,schemaVersion:3};record.recoveryCustodyId=custodyId;}record.details={destination,date:financeDate(d.date||financeDateFromTimestamp(now)),reference};
        }else if(allocation.treatment==="business_expense"){
          const code=text(d.expenseCode,4),account=booksChart[code];if(!account||account.active===false||account.type!=="Expense"||code==="6110")throw new HttpsError("failed-precondition","Select an active operating-expense account. Cash Short / Over cannot be used as the business-expense category.");const payee=text(d.payee,160),reference=text(d.reference,120),purpose=text(d.purpose,300);if(!payee||!reference||!purpose)throw new HttpsError("invalid-argument","Business expense requires payee, receipt/reference, and business purpose.");newLines.push(Financial.line(`coa:${code}`,v,0,account.name),Financial.line(source,0,v,label));record.details={expenseCode:code,expenseName:account.name,payee,reference,purpose,taxTreatment:text(d.taxTreatment||"none",40)};writes[`cashDifferenceExpenses/${id}/${allocation.id}`]=Object.assign({},record,{date:financeDate(d.date||financeDateFromTimestamp(now)),status:"recorded"});
        }else if(allocation.treatment==="supplier_purchase"){
          const supplier=text(d.supplier,160),purpose=text(d.purpose,300),reference=text(d.reference,120);if(!supplier||!purpose||!reference)throw new HttpsError("invalid-argument","Supplier purchase requires supplier, purchase purpose, and receipt reference.");const advanceId=`variance_purchase_${id}_${allocation.id}`;newLines.push(Financial.line(`asset:purchase_cash_advance:${advanceId}`,v,0,"Supplier payment pending inventory allocation"),Financial.line(source,0,v,label));record.details={supplier,purpose,reference};record.purchaseAdvanceId=advanceId;purchasePayouts.push({id:advanceId,type:"purchase_advance",status:"pending_details",amount:v,remainingAmount:v,recipient:supplier,purpose,reference,reason:`Cash difference purchase · ${purpose}`,approvalId:approval.id,discrepancyId:id,allocationId:allocation.id,ts:now});writes[`cashDifferencePurchaseAdvances/${advanceId}`]=Object.assign({},record,{shiftId,remainingAmount:v,status:"pending_inventory_allocation",createdAt:now});
        }else if(allocation.treatment==="staff_receivable"){
          const staffId=financeKey(d.staffId,"Staff ID");
          const staffRows=(await db.ref("/posStaff").get()).val()||{},staffRow=staffRows[staffId];if(!staffRow)throw new HttpsError("not-found","The selected staff member was not found.");const receivableId=`cash_shortage_${id}_${allocation.id}`;newLines.push(Financial.line(`asset:receivable:${receivableId}`,v,0,"Staff cash shortage receivable"),Financial.line(source,0,v,label));record.details={staffId,staffName:text(staffRow.name||staffRow.email,160),repaymentTerms:text(d.repaymentTerms,240),reference:text(d.reference,120)};record.receivableId=receivableId;writes[`receivables/${receivableId}`]={party:record.details.staffName,type:"staff_cash_shortage",amount:v,remainingAmount:v,date:financeDate(d.date||financeDateFromTimestamp(now)),due:d.due?financeDate(d.due,true):"",ref:record.details.reference||id,status:"open",movementId:`cash_difference_${id}_${revision}`,discrepancyId:id,allocationId:allocation.id,ts:now,createdBy:actor.uid,schemaVersion:2};
        }else if(allocation.treatment==="owner_draw"){
          const owner=text(d.owner,160),reference=text(d.reference,120);if(!owner||!reference)throw new HttpsError("invalid-argument","Owner withdrawal requires the owner and authorization reference.");newLines.push(Financial.line("equity:owner_draw",v,0,"Owner withdrawal"),Financial.line(source,0,v,label));record.details={owner,reference,reason:text(d.reason,300)};
        }else if(allocation.treatment==="customer_refund"){
          const customer=text(d.customer,160),reference=text(d.reference,120);if(!customer||!reference)throw new HttpsError("invalid-argument","Customer refund requires customer/payee and order or receipt reference.");const payableId=`cash_overage_refund_${id}_${allocation.id}`;newLines.push(Financial.line(source,v,0,label),Financial.line(`liability:customer_change_refund:${payableId}`,0,v,"Customer refund due"));record.details={customer,reference,reason:text(d.reason,300)};record.payableId=payableId;writes[`payables/${payableId}`]={party:customer,type:"customer_change_refund",amount:v,remainingAmount:v,paidAmount:0,date:financeDate(d.date||financeDateFromTimestamp(now)),due:"",ref:reference,status:"open",movementId:`cash_difference_${id}_${revision}`,liabilityAccount:`liability:customer_change_refund:${payableId}`,sourceType:"discrepancy",sourceId:id,discrepancyId:id,allocationId:allocation.id,shiftId,approvalId:approval.id,ts:now,createdBy:actor.uid,schemaVersion:2};
        }else if(allocation.treatment==="unrecorded_sale"){
          const orderId=financeKey(d.orderId,"Order ID"),sale=movements[`sale_${orderId}`];if(!sale)throw new HttpsError("failed-precondition","Post or restore the complete sale first so revenue, tax, COGS, and inventory are linked.");const saleCash=Financial.money((sale.lines||[]).reduce((s,l)=>s+(l.account==="asset:register_cash"?(Number(l.debit)||0)-(Number(l.credit)||0):0),0));if(Math.abs(saleCash-v)>.009)throw new HttpsError("failed-precondition","The linked sale cash amount does not match this allocation.");newLines.push(Financial.line(source,v,0,label),Financial.line("asset:register_cash",0,v,"Offset cash already recognized by shift overage"));record.details={orderId};record.sourceMovementId=`sale_${orderId}`;
        }else if(allocation.treatment==="capital_contribution"){
          const owner=text(d.owner,160),reference=text(d.reference,120);if(!owner||!reference)throw new HttpsError("invalid-argument","Capital contribution requires owner and source reference.");newLines.push(Financial.line(source,v,0,label),Financial.line("equity:capital_in",0,v,"Owner capital contribution"));record.details={owner,reference};
        }else if(allocation.treatment==="supplier_refund"){
          const purchaseId=financeKey(d.purchaseId,"Purchase ID"),reference=text(d.reference,120);if(!reference||(await db.ref(`/purchaseInvoices/${purchaseId}`).get()).exists()===false)throw new HttpsError("failed-precondition","Select the original purchase and supplier refund reference.");const code=text(d.offsetCode,4),account=booksChart[code];if(!account||account.active===false||!["Asset","Expense","COGS"].includes(account.type))throw new HttpsError("failed-precondition","Select the original purchase, inventory, or expense account being reduced.");newLines.push(Financial.line(source,v,0,label),Financial.line(`coa:${code}`,0,v,"Supplier refund"));record.details={purchaseId,reference,offsetCode:code};
        }else if(allocation.treatment==="unrecorded_cash_in"){
          const code=text(d.offsetCode,4),account=booksChart[code],reference=text(d.reference,120);if(!account||account.active===false||!["Liability","Equity","Income"].includes(account.type)||!reference)throw new HttpsError("failed-precondition","Select an active liability, equity, or income source account and reference.");newLines.push(Financial.line(source,v,0,label),Financial.line(`coa:${code}`,0,v,account.name));record.details={offsetCode:code,offsetName:account.name,sourceName:text(d.sourceName,160),reference};
        }else if(allocation.treatment==="unexplained_overage"){
          const investigation=text(d.investigation,400);if(!investigation)throw new HttpsError("invalid-argument","Document the investigation before recognizing unexplained overage income.");newLines.push(Financial.line(source,v,0,label),Financial.line("revenue:unexplained_cash_overage",0,v,"Unexplained cash overage"));record.details={investigation};
        }else if(allocation.treatment==="counting_error"){
          const evidence=text(d.evidence,300);if(!evidence)throw new HttpsError("invalid-argument","Counting correction requires recount evidence.");newLines.push(short?Financial.line("asset:register_cash",v,0,"Correct understated cash count"):Financial.line(source,v,0,label),short?Financial.line(source,0,v,label):Financial.line("asset:register_cash",0,v,"Correct overstated cash count"));record.details={evidence,correctedCount:Financial.money(d.correctedCount)};
        }else if(allocation.treatment==="offset_prior_overage"||allocation.treatment==="offset_prior_shortage"){
          if(legacyMovement.type==="shift_cash_variance")throw new HttpsError("failed-precondition","This legacy final variance cannot be offset automatically. Use a documented Finance correction so its original audit trail remains intact.");
          const otherId=financeKey(d.oppositeDiscrepancyId,"Opposite cash variance ID");if(otherId===id||offsetCases[otherId])throw new HttpsError("invalid-argument","Select one different opposite cash variance for each offset allocation.");const other=(await db.ref(`/discrepancies/${otherId}`).get()).val()||{};
          const otherShort=Number(other.variance)<0,expectedOtherShort=!short;if(other.kind!=="cash"||otherShort!==expectedOtherShort||other.status==="reviewed")throw new HttpsError("failed-precondition","The selected opposite cash variance is no longer open and eligible for offset.");
          const otherAllocations=other.resolutionAllocations||{},otherResolved=Financial.money(Object.values(otherAllocations).reduce((sum,x)=>sum+Number(x&&x.amount||0),0)),otherTotal=Financial.money(Math.abs(Number(other.variance)||0)),otherRemaining=Financial.money(otherTotal-otherResolved);if(v>otherRemaining+.009)throw new HttpsError("failed-precondition",`The selected opposite variance has only ${otherRemaining.toFixed(2)} remaining.`);
          newLines.push(short?Financial.line("liability:cash_overage_pending",v,0,"Offset verified cash overage"):Financial.line(source,v,0,"Offset verified cash overage"),short?Financial.line(source,0,v,"Offset verified cash shortage"):Financial.line("asset:cash_shortage_pending",0,v,"Offset verified cash shortage"));record.details={oppositeDiscrepancyId:otherId,oppositeShiftId:text(other.shiftId,160),evidence:text(d.evidence,300)};offsetCases[otherId]={row:other,total:otherTotal,resolved:otherResolved,remaining:otherRemaining,amount:v,allocationId:allocation.id};
        }
        allocationRecords[allocation.id]=record;
      }
      if(purchasePayouts.length!==(Array.isArray(shiftRow.payOuts)?shiftRow.payOuts.length:0))writes[`shifts/${shiftId}/payOuts`]=purchasePayouts;
      const resolvedTotal=Financial.money(priorTotal+batchTotal),caseRemaining=Financial.money(totalValue-resolvedTotal),status=caseRemaining>.009?"partially_resolved":"reviewed",movementId=`cash_difference_${id}_${revision}`;Object.keys(allocationRecords).forEach((key)=>{allocationRecords[key].resolutionMovementId=newLines.length?movementId:null;writes[`cashDifferenceCases/${id}/allocations/${key}`]=allocationRecords[key];writes[`discrepancies/${id}/resolutionAllocations/${key}`]=allocationRecords[key];});Object.assign(writes,{[`cashDifferenceCases/${id}/discrepancyId`]:id,[`cashDifferenceCases/${id}/shiftId`]:shiftId,[`cashDifferenceCases/${id}/kind`]:short?"shortage":"overage",[`cashDifferenceCases/${id}/originalAmount`]:totalValue,[`cashDifferenceCases/${id}/resolvedAmount`]:resolvedTotal,[`cashDifferenceCases/${id}/remainingAmount`]:caseRemaining,[`cashDifferenceCases/${id}/status`]:status,[`cashDifferenceCases/${id}/updatedAt`]:now,[`discrepancies/${id}/status`]:status,[`discrepancies/${id}/financialStatus`]:status,[`discrepancies/${id}/resolvedAmount`]:resolvedTotal,[`discrepancies/${id}/remainingAmount`]:caseRemaining,[`discrepancies/${id}/resolutionRevision`]:revision,[`discrepancies/${id}/reviewedAt`]:status==="reviewed"?now:null,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:status,[`operationalAudit/${now}_${id}_case_${revision}`]:operationalAuditRecord("resolve_cash_difference_case","discrepancy",id,actor,{shiftId,short,originalAmount:totalValue,batchAmount:batchTotal,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,allocationIds:Object.keys(allocationRecords),approvalId:approval.id,movementId:newLines.length?movementId:null,note})});
      Object.keys(offsetCases).forEach((otherId)=>{const other=offsetCases[otherId],nextResolved=Financial.money(other.resolved+other.amount),nextRemaining=Financial.money(other.total-nextResolved),nextStatus=nextRemaining>.009?"partially_resolved":"reviewed",offsetId=`offset_${id}_${other.allocationId}`,otherRecord={id:offsetId,treatment:short?"offset_later_shortage":"offset_later_overage",amount:other.amount,oppositeDiscrepancyId:id,oppositeShiftId:shiftId,approvedAt:now,approvedBy:reviewedBy,approvalId:approval.id,resolutionMovementId:movementId};writes[`cashDifferenceCases/${otherId}/allocations/${offsetId}`]=otherRecord;writes[`cashDifferenceCases/${otherId}/resolvedAmount`]=nextResolved;writes[`cashDifferenceCases/${otherId}/remainingAmount`]=nextRemaining;writes[`cashDifferenceCases/${otherId}/status`]=nextStatus;writes[`cashDifferenceCases/${otherId}/updatedAt`]=now;writes[`discrepancies/${otherId}/resolutionAllocations/${offsetId}`]=otherRecord;writes[`discrepancies/${otherId}/status`]=nextStatus;writes[`discrepancies/${otherId}/financialStatus`]=nextStatus;writes[`discrepancies/${otherId}/resolvedAmount`]=nextResolved;writes[`discrepancies/${otherId}/remainingAmount`]=nextRemaining;writes[`discrepancies/${otherId}/reviewedAt`]=nextStatus==="reviewed"?now:null;writes[`discrepancies/${otherId}/reviewedBy`]=reviewedBy;writes[`discrepancies/${otherId}/reviewApprovalId`]=approval.id;writes[`shifts/${financeKey(other.row.shiftId,"Opposite shift ID")}/varianceStatus`]=nextStatus;});
      if(!newLines.length){assertNoOverlappingUpdatePaths(writes,"cash-difference resolution");await db.ref().update(writes);return{discrepancyId:id,status,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,movementId:null,duplicate:false};}const movement=Financial.movement("cash_difference_case_resolution","discrepancy",id,newLines,{occurredAt:now,actorName:reviewedBy,approvalId:approval.id,shiftId,revision,note,allocationIds:Object.keys(allocationRecords)}),committed=await commitFinancial(db,movementId,movement,actor,writes);return{discrepancyId:id,status,resolvedAmount:resolvedTotal,remainingAmount:caseRemaining,movementId,duplicate:committed.duplicate};
    }
    if(row.kind==="cash"){
      const treatment=financeText(data.treatment,40),short=Number(row.variance)<0,value=Financial.money(Math.abs(Number(row.variance)||0)),shiftId=financeKey(row.shiftId,"Shift ID"),movementId=`shift_variance_resolution_${id}`,allowed=short?["cash_recovered_to_undeposited","supplier_payment_pending_allocation","documented_cash_correction","shortage_expense","staff_receivable","owner_draw"]:["customer_change_refund_payable","documented_cash_correction","overage_other_income"];
      if(!allowed.includes(treatment))throw new HttpsError("invalid-argument","Select a valid cash-variance treatment.");
      const pending=short?"asset:cash_shortage_pending":"liability:cash_overage_pending",correctionMovementId=financeText(data.correctionMovementId,160),recipient=financeText(data.recipient,160),purpose=financeText(data.purpose,300),reference=financeText(data.reference,120),originalMovement=(await db.ref(`/financialMovements/shift_variance_${shiftId}`).get()).val()||{},legacyFinal=originalMovement.type==="shift_cash_variance";let lines,target="",advanceId="",payableId="";
      if(treatment==="cash_recovered_to_undeposited"){
        if(!short)throw new HttpsError("failed-precondition","Only a cash shortage can be resolved as physically recovered cash.");
        if(!correctionMovementId)throw new HttpsError("invalid-argument","Select the posted Finance journal that recorded the recovered cash.");
        const correctionKey=financeKey(correctionMovementId,"Correction movement ID"),correction=(await db.ref(`/financialMovements/${correctionKey}`).get()).val();
        if(!correction)throw new HttpsError("not-found","The referenced Finance movement was not found.");
        const totals=Financial.totals(correction.lines||[]),undepositedDelta=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(line.account==="asset:cash_awaiting_deposit"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0)),shortageClearing=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(["asset:cash_shortage_pending","coa:1190"].includes(line.account)?(Number(line.credit)||0)-(Number(line.debit)||0):0),0));
        if(Math.abs(totals.debit-totals.credit)>0.009)throw new HttpsError("failed-precondition","The referenced Finance movement is not balanced.");
        if(Math.abs(undepositedDelta-value)>0.009||Math.abs(shortageClearing-value)>0.009)throw new HttpsError("failed-precondition",`The referenced movement must debit Undeposited Collection and credit Cash Shortage Under Review by exactly ${value.toFixed(2)}.`);
        approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
        const correctionLinkRef=db.ref(`/financialControlLinks/correctionMovements/${correctionKey}`),correctionLinkResult=await correctionLinkRef.transaction((current)=>{if(current&&current.discrepancyId!==id)return;return current||{discrepancyId:id,shiftId,amount:value,approvalId:approval.id,linkedAt:now,linkedBy:reviewedBy};},undefined,false);
        if(!correctionLinkResult.committed)throw new HttpsError("already-exists","That Finance movement is already linked to another discrepancy.");
        const custodyRows=(await db.ref("/cashCustody").get()).val()||{},existingCustodyKey=Object.prototype.hasOwnProperty.call(custodyRows,shiftId)?shiftId:Object.keys(custodyRows).find((key)=>custodyRows[key]&&(custodyRows[key].shiftId===shiftId||custodyRows[key].movementId===`shift_custody_${shiftId}`)),custodyKey=existingCustodyKey||`shortage_recovery_${id}`,custodyRef=db.ref(`/cashCustody/${custodyKey}`);let custodyDuplicate=false,custodyCreated=false;
        const custodyResult=await custodyRef.transaction((current)=>{
          if(!current){custodyCreated=true;current={shiftId,staff:`Recovered cash · ${financeText(row.staff,80)||"Manager"}`,amount:0,depositedAmount:0,remaining:0,retainedFloat:0,status:"awaiting_deposit",closedAt:now,movementId:correctionKey,source:"cash_shortage_recovery",discrepancyId:id,schemaVersion:3};}
          const recoveries=current.recoveries||{};
          if(recoveries[id]){custodyDuplicate=true;return current;}
          const next=Object.assign({},current),nextRecoveries=Object.assign({},recoveries);
          next.amount=Financial.money(Number(current.amount||0)+value);next.remaining=Financial.money(Number(current.remaining||0)+value);next.recoveredAmount=Financial.money(Number(current.recoveredAmount||0)+value);next.status=next.remaining>0?"awaiting_deposit":current.status;next.lastRecoveryAt=now;
          nextRecoveries[id]={amount:value,correctionMovementId:correctionKey,approvalId:approval.id,recoveredAt:now,recoveredBy:reviewedBy,note};next.recoveries=nextRecoveries;return next;
        },undefined,false);
        if(!custodyResult.committed)throw new HttpsError("aborted","The recovered-cash custody record changed during approval. Retry the resolution.");
        const recoveryWrites=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:"reviewed",[`discrepancies/${id}/financialStatus`]:"cash_recovered_to_undeposited",[`discrepancies/${id}/treatment`]:treatment,[`discrepancies/${id}/correctionMovementId`]:correctionKey,[`discrepancies/${id}/recoveryCustodyId`]:custodyKey,[`discrepancies/${id}/reviewedAt`]:now,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewedByUid`]:approval.record.approvedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/resolutionMovementId`]:correctionKey,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:"cash_recovered_to_undeposited",[`shifts/${shiftId}/varianceResolution`]:{treatment,note,correctionMovementId:correctionKey,recoveryCustodyId:custodyKey,approvalId:approval.id,approvedBy:reviewedBy,resolutionMovementId:correctionKey,resolvedAt:now},[`operationalAudit/${now}_${id}_cash_recovered`]:operationalAuditRecord("recover_shift_shortage_to_undeposited","discrepancy",id,actor,{shiftId,amount:value,correctionMovementId:correctionKey,recoveryCustodyId:custodyKey,custodyCreated,approvalId:approval.id,custodyAdjusted:!custodyDuplicate,newFinancialMovement:false,note})});
        await db.ref().update(recoveryWrites);
        return{discrepancyId:id,reviewedAt:now,treatment,movementId:correctionKey,recoveryCustodyId:custodyKey,custodyCreated,duplicate:custodyDuplicate,custodyAdjusted:!custodyDuplicate,financialMovementPosted:false};
      }else if(treatment==="supplier_payment_pending_allocation"){
        if(!recipient||!purpose||!reference)throw new HttpsError("invalid-argument","Supplier/payee, purchase purpose, and receipt reference are required.");advanceId=`variance_purchase_${shiftId}`;const source=legacyFinal?"expense:cash_shortage":pending;lines=[Financial.line(`asset:purchase_cash_advance:${advanceId}`,value,0,"Supplier payment pending inventory allocation"),Financial.line(source,0,value,"Clear supplier-funded cash shortage")];
      }else if(treatment==="customer_change_refund_payable"){
        if(!recipient||!reference)throw new HttpsError("invalid-argument","Customer/payee and order, receipt, or customer reference are required.");payableId=`change_refund_${shiftId}`;const source=legacyFinal?"revenue:cash_overage":pending;lines=[Financial.line(source,value,0,"Reclassify customer cash overage"),Financial.line(`liability:customer_change_refund:${payableId}`,0,value,"Customer change or refund due")];
      }else if(treatment==="documented_cash_correction"){
        if(!correctionMovementId)throw new HttpsError("invalid-argument","The posted purchase, sale, refund, or cash-movement reference is required.");const correction=(await db.ref(`/financialMovements/${financeKey(correctionMovementId,"Correction movement ID")}`).get()).val();if(!correction)throw new HttpsError("not-found","The referenced Finance movement was not found.");const registerDelta=Financial.money((correction.lines||[]).reduce((sum,line)=>sum+(line.account==="asset:register_cash"?(Number(line.debit)||0)-(Number(line.credit)||0):0),0)),required=short?-value:value;if(Math.abs(registerDelta-required)>0.009)throw new HttpsError("failed-precondition",`The referenced movement must ${short?"reduce":"increase"} Register Cash by exactly ${value.toFixed(2)}.`);const source=legacyFinal?(short?"expense:cash_shortage":"revenue:cash_overage"):pending;lines=short?[Financial.line("asset:register_cash",value,0,"Clear documented cash shortage"),Financial.line(source,0,value,"Clear documented cash shortage")]:[Financial.line(source,value,0,"Clear documented cash overage"),Financial.line("asset:register_cash",0,value,"Clear documented cash overage")];
      }else{target=treatment==="shortage_expense"?"expense:cash_shortage":treatment==="staff_receivable"?`asset:receivable:shift_${shiftId}`:treatment==="owner_draw"?"equity:owner_draw":"revenue:unexplained_cash_overage";const label=`Resolve ${short?"cash shortage":"cash overage"} · ${note}`;if(legacyFinal&&short&&treatment==="shortage_expense")lines=[];else{const source=legacyFinal?(short?"expense:cash_shortage":"revenue:cash_overage"):pending;lines=short?[Financial.line(target,value,0,label),Financial.line(source,0,value,label)]:[Financial.line(source,value,0,label),Financial.line(target,0,value,label)];}}
      approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;const financialStatus=treatment==="supplier_payment_pending_allocation"?"awaiting_inventory_allocation":treatment==="customer_change_refund_payable"?"awaiting_customer_refund":"resolved",writes=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:"reviewed",[`discrepancies/${id}/financialStatus`]:financialStatus,[`discrepancies/${id}/treatment`]:treatment,[`discrepancies/${id}/correctionMovementId`]:correctionMovementId||null,[`discrepancies/${id}/purchaseAdvanceId`]:advanceId||null,[`discrepancies/${id}/customerRefundPayableId`]:payableId||null,[`discrepancies/${id}/reviewedAt`]:now,[`discrepancies/${id}/reviewedBy`]:reviewedBy,[`discrepancies/${id}/reviewedByUid`]:approval.record.approvedBy,[`discrepancies/${id}/reviewApprovalId`]:approval.id,[`discrepancies/${id}/resolutionMovementId`]:movementId,[`discrepancies/${id}/note`]:note,[`shifts/${shiftId}/varianceStatus`]:financialStatus,[`shifts/${shiftId}/varianceResolution`]:{treatment,note,correctionMovementId:correctionMovementId||null,purchaseAdvanceId:advanceId||null,customerRefundPayableId:payableId||null,approvalId:approval.id,approvedBy:reviewedBy,resolutionMovementId:movementId,resolvedAt:now}});if(advanceId){const shift=(await db.ref(`/shifts/${shiftId}`).get()).val()||{},payOuts=Array.isArray(shift.payOuts)?shift.payOuts:[];writes[`shifts/${shiftId}/payOuts/${payOuts.length}`]={id:advanceId,type:"purchase_advance",status:"pending_details",amount:value,remainingAmount:value,recipient,purpose,reference,reason:`Emergency supplier payment — ${purpose}`,by:reviewedBy,approvalId:approval.id,ts:now,source:"closed_shift_variance"};}if(payableId){writes[`payables/${payableId}`]={party:recipient,type:"customer_change_refund",amount:value,remainingAmount:value,paidAmount:0,date:financeDate(row.date||new Date(now).toISOString().slice(0,10)),due:"",ref:reference,status:"open",movementId,liabilityAccount:`liability:customer_change_refund:${payableId}`,reversalOffsetAccount:pending,sourceType:"discrepancy",sourceId:id,discrepancyId:id,shiftId,approvalId:approval.id,ts:now,createdBy:actor.uid,schemaVersion:2};}
      if(!lines.length){writes[`discrepancies/${id}/resolutionMovementId`]=null;writes[`shifts/${shiftId}/varianceResolution/resolutionMovementId`]=null;await db.ref().update(writes);return{discrepancyId:id,reviewedAt:now,treatment,movementId:null,duplicate:false,legacyAlreadyPosted:true};}const committed=await commitFinancial(db,movementId,Financial.movement("shift_cash_variance_resolution","discrepancy",id,lines,{occurredAt:now,actorName:reviewedBy,approvalId:approval.id,treatment,shiftId,controlReason:note,legacyFinal}),actor,writes);return{discrepancyId:id,reviewedAt:now,treatment,movementId,duplicate:committed.duplicate};
    }
    approval=await claimManagerApproval(db,data,"review_discrepancy",id,null,`review_discrepancy_${id}`);reviewedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole;
    let duplicate = false; const transactionState = {seen: false};
    const result = await ref.transaction((current) => {
      current = transactionCurrent(current, row, transactionState);
      if (!current) return;
      if (current.status === "reviewed") {if (current.reviewApprovalId === approval.id) {duplicate = true; return current;} return;}
      return Object.assign({}, current, {status: "reviewed", reviewedAt: now, reviewedBy, reviewedByUid: approval.record.approvedBy, reviewApprovalId: approval.id, note});
    }, undefined, false);
    if (!result.committed) throw new HttpsError("aborted", "This discrepancy was reviewed by another manager. Refresh the list.");
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord("review_discrepancy", "discrepancy", id, actor, {approvalId: approval.id})}));
    return {discrepancyId: id, reviewedAt: now, duplicate};
  },
);

// Reviewed discrepancy records are never a dead end. They may be reopened
// only when nothing downstream has been posted; otherwise the caller is told
// to reverse the exact linked treatment first. The original event is retained.
exports.reopenDiscrepancy = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db=getDatabase(),actor=await requirePortalPermission(db,request,["discrepancy","registerOps"]),data=request.data||{},id=financeKey(data.discrepancyId,"Discrepancy ID"),reason=financeText(data.reason,500),ref=db.ref(`/discrepancies/${id}`),snap=await ref.get();
    if(!reason)throw new HttpsError("invalid-argument","Explain why this reviewed record must be corrected.");
    if(!snap.exists())throw new HttpsError("not-found","Discrepancy record not found.");
    const row=snap.val()||{};if(row.status!=="reviewed")throw new HttpsError("failed-precondition","Only a reviewed discrepancy can be corrected from this workflow.");
    const isCash=row.kind==="cash",shiftId=isCash?financeKey(row.shiftId,"Shift ID"):"",[caseSnap,linksSnap,originalSnap]=await Promise.all([isCash?db.ref(`/cashDifferenceCases/${id}`).get():Promise.resolve({val:()=>({})}),db.ref("/financialControlLinks/correctionMovements").get(),isCash?db.ref(`/financialMovements/shift_variance_${shiftId}`).get():Promise.resolve({exists:()=>true})]);
    if(isCash&&!originalSnap.exists())throw new HttpsError("failed-precondition","The original cash-variance posting is missing. Use the Finance correction workflow instead.");
    const caseRow=caseSnap.val()||{},allocations=Object.assign({},row.resolutionAllocations||{},caseRow.allocations||{}),controlLinks=linksSnap.val()||{},linkedEntries=Object.entries(controlLinks).filter(([,link])=>link&&link.discrepancyId===id),linked=linkedEntries.length>0,linkedIds=[row.resolutionMovementId,row.correctionMovementId,row.recoveryCustodyId,row.customerRefundPayableId,row.purchaseAdvanceId,...linkedEntries.map(([key,link])=>link.movementId||link.correctionMovementId||link.id||key)].filter(Boolean).map(String),hasTreatment=linked||linkedIds.length>0||Object.keys(allocations).length>0;
    if(hasTreatment){const labels=[...new Set(linkedIds)].slice(0,4);throw new HttpsError("failed-precondition",`This record has linked Finance treatment${labels.length?`: ${labels.join(", ")}`:" or settlement"}. Reverse that linked treatment first, then return here to correct the original record. Its audit trail remains intact.`);}
    const amount=isCash?Financial.money(Math.abs(Number(row.variance)||0)):null,approval=await claimManagerApproval(db,data,"reopen_discrepancy",id,amount,`reopen_discrepancy_${id}`),now=Date.now(),revision=Math.max(0,Math.floor(Number(row.reopenRevision)||0))+1,approvedBy=approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,history={revision,reopenedAt:now,reopenedBy:approvedBy,reopenedByUid:approval.record.approvedBy,approvalId:approval.id,reason,originalStatus:row.status,originalTreatment:row.treatment||"",originalNote:row.note||"",originalMovementId:isCash?`shift_variance_${shiftId}`:""};
    const status=isCash?"pending_manager_reconciliation":"open",writes=Object.assign({},approval.usedWrites,{[`discrepancies/${id}/status`]:status,[`discrepancies/${id}/financialStatus`]:isCash?status:(row.financialStatus||"pending_manager_review"),[`discrepancies/${id}/reviewedAt`]:null,[`discrepancies/${id}/reopenedAt`]:now,[`discrepancies/${id}/reopenedBy`]:approvedBy,[`discrepancies/${id}/reopenRevision`]:revision,[`discrepancies/${id}/reopenHistory/${revision}`]:history,[`operationalAudit/${now}_${id}_reopen_discrepancy`]:operationalAuditRecord("reopen_discrepancy","discrepancy",id,actor,{amount,approvalId:approval.id,reason,originalMovementId:history.originalMovementId,accounting:isCash?"No Finance entry is posted on reopen. The original variance stays in its control account until a new approved treatment is selected.":"No inventory or Finance entry is posted on reopen. The original discrepancy stays in the audit trail until it is reviewed again."})});
    if(isCash)Object.assign(writes,{[`cashDifferenceCases/${id}/status`]:status,[`cashDifferenceCases/${id}/resolvedAmount`]:0,[`cashDifferenceCases/${id}/remainingAmount`]:amount,[`cashDifferenceCases/${id}/updatedAt`]:now,[`cashDifferenceCases/${id}/reopenHistory/${revision}`]:history,[`shifts/${shiftId}/varianceStatus`]:status});
    await db.ref().update(writes);return{discrepancyId:id,status,amount,reopenRevision:revision,duplicate:false};
  },
);

exports.managePettyVoucher = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty"]);
    const data = request.data || {}, action = financeText(data.action, 20), id = financeKey(data.voucherId, "Voucher ID"), reason = financeText(data.reason, 500);
    const ref = db.ref(`/pettyCashVouchers/${id}`), snap = await ref.get(); if (!snap.exists()) throw new HttpsError("not-found", "Revolving Fund voucher not found.");
    const voucher = snap.val() || {}, value = Financial.money(voucher.amount), now = Date.now(); let approvalAction;
    // Editing a voucher changes the Admin subledger as well as its linked
    // Finance correction, so the voucher's own accounting month must be open.
    if (["correct", "approve"].includes(action)) await assertAccountingPeriodOpen(db, action === "correct" && voucher.status === "pending" ? financeDate(data.date) : (financeText(voucher.date, 10) || financeDateFromTimestamp(now)), "editing or approving this Admin cash payment");
    if (action === "correct") {
      if (!["pending", "approved"].includes(voucher.status) || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active pending or approved cash payment can be edited.");
      if (voucher.returnedAt) throw new HttpsError("failed-precondition", "A returned supplier payment cannot be edited. Record a new correcting payment instead.");
      const nextAmount = Financial.money(data.amount), nextPurpose = financeText(data.purpose, 300), nextApprover = financeText(data.approverName, 160), reason = financeText(data.reason, 500), type = financeText(voucher.transactionType, 40) || "expense", selectedSupplier=type==="purchase_advance"?await requireActiveSupplier(db,data.supplierId,data.payee):null,nextPayee=selectedSupplier?selectedSupplier.name:financeText(data.payee,160),nextSupplierId=selectedSupplier?selectedSupplier.id:"";
      if (!(nextAmount > 0)) throw new HttpsError("invalid-argument", "Amount must be greater than zero.");
      if (!nextPayee) throw new HttpsError("invalid-argument", "Requester or supplier payee is required.");
      if (type === "purchase_advance" && !voucher.receiptImg) throw new HttpsError("failed-precondition", "A supplier receipt is required for this payment.");
      if (!voucher.receiptImg && !nextPurpose) throw new HttpsError("invalid-argument", "A receipt or clear explanation is required.");
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
      const approval = await claimManagerApproval(db,data,"correct_petty_voucher",id,nextAmount,`correct_petty_voucher_${id}_${revision}`), approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole, oldPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:voucher.recipient||"Supplier payment pending allocation"} : revolvingFundPosting(voucher), nextVoucher = Object.assign({},voucher,{amount:nextAmount,category:nextCategory,recipient:nextPayee,requesterName:nextPayee,purpose:nextPurpose,approverName:nextApprover}), nextPosting = type === "purchase_advance" ? {account:`asset:purchase_cash_advance:${id}`,label:nextPayee} : revolvingFundPosting(nextVoucher), delta = Financial.money(nextAmount-value), correctionId = `petty_correct_${id}_${revision}`;
      let custodyWrites = {}; if (delta > 0) {const custodyOut=await poolCustodyOutflow(db,delta);if(custodyOut.shortfall>0.009)throw new HttpsError("failed-precondition",`The increase exceeds available Undeposited Collection by ${custodyOut.shortfall.toFixed(2)}.`);custodyWrites=custodyOut.writes;} else if (delta < 0) custodyWrites = poolCustodyInflowRecord(correctionId,-delta,"Cash payment correction returned",now,correctionId);
      const movement = Financial.movement("petty_cash_payment_correction","pettyVoucher",id,[Financial.line("asset:cash_awaiting_deposit",value,0,"Reverse previous cash payment"),Financial.line(oldPosting.account,0,value,"Reverse "+oldPosting.label),Financial.line(nextPosting.account,nextAmount,0,nextPosting.label),Financial.line("asset:cash_awaiting_deposit",0,nextAmount,"Corrected cash payment")],{occurredAt:now,actorName:approvedBy,approvalId:approval.id,voucherNo:financeText(voucher.voucherNo,60),category:nextCategory,payee:nextPayee,purpose:nextPurpose,correctionRevision:revision,correctionReason:reason});
      Object.assign(writes,approval.usedWrites,custodyWrites,{[`pettyCashVouchers/${id}/lastCorrectedBy`]:approvedBy,[`pettyCashVouchers/${id}/lastCorrectionApprovalId`]:approval.id,[`pettyCashVouchers/${id}/correctionMovementIds/${revision}`]:correctionId,[`operationalAudit/${now}_${id}_correct_${revision}`]:operationalAuditRecord("correct_approved_petty_voucher","pettyVoucher",id,actor,{before,after,reason,revision,approvalId:approval.id,movementId:correctionId})});
      const committed = await commitFinancial(db,correctionId,movement,actor,writes);return {voucherId:id,action,revision,movementId:correctionId,duplicate:committed.duplicate};
    }
    if (action === "return") {if(voucher.transactionType!=="purchase_advance"||voucher.status!=="approved"||voucher.voided===true)throw new HttpsError("failed-precondition","Only an active supplier payment can be returned.");const remaining=Financial.money(voucher.remainingAmount!=null?voucher.remainingAmount:value);if(!(remaining>0))throw new HttpsError("failed-precondition","This supplier payment has no unallocated balance to return.");if(!reason)throw new HttpsError("invalid-argument","A return reason is required.");const approval=await claimManagerApproval(db,data,"return_supplier_payment",id,remaining,`return_supplier_payment_${id}`),movementId=`petty_return_${id}`,movement=Financial.movement("revolving_fund_supplier_payment_return","pettyVoucher",id,[Financial.line("asset:cash_awaiting_deposit",remaining,0,"Returned to Undeposited Collection"),Financial.line(`asset:purchase_cash_advance:${id}`,0,remaining,"Clear unallocated supplier payment")],{occurredAt:now,actorName:approval.record.approvedName||approval.record.approvedEmail||approval.record.approvedRole,approvalId:approval.id}),writes=Object.assign({},approval.usedWrites,poolCustodyInflowRecord(`petty_return_${id}`,remaining,"Supplier payment returned",now,`petty_return_${id}`),{[`pettyCashVouchers/${id}/remainingAmount`]:0,[`pettyCashVouchers/${id}/allocationStatus`]:(Number(voucher.allocatedAmount)||0)>0?"partially_allocated_returned":"returned_unallocated",[`pettyCashVouchers/${id}/returnedAmount`]:remaining,[`pettyCashVouchers/${id}/returnedAt`]:now,[`pettyCashVouchers/${id}/returnReason`]:reason,[`pettyCashVouchers/${id}/returnApprovalId`]:approval.id,[`operationalAudit/${now}_${id}_return`]:operationalAuditRecord("return_supplier_payment","pettyVoucher",id,actor,{approvalId:approval.id,amount:remaining,reason})});const committed=await commitFinancial(db,movementId,movement,actor,writes);return {voucherId:id,action,amount:remaining,duplicate:committed.duplicate};}
    if (action === "approve") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be approved.");
      if (voucher.transactionType === "purchase_advance" && !voucher.receiptImg) throw new HttpsError("failed-precondition", "A supplier receipt is required before approval.");
      if (voucher.transactionType === "purchase_advance") await requireActiveSupplier(db,voucher.supplierId,voucher.supplierName||voucher.recipient);
      if (!voucher.receiptImg && !financeText(voucher.purpose, 300)) throw new HttpsError("failed-precondition", "A receipt or clear explanation is required before approval.");
      approvalAction = "approve_petty_voucher";
    } else if (action === "reject") {
      if (voucher.status !== "pending") throw new HttpsError("failed-precondition", "Only pending vouchers can be rejected.");
      if (!reason) throw new HttpsError("invalid-argument", "A rejection reason is required."); approvalAction = "reject_petty_voucher";
    } else if (action === "void") {
      if (voucher.status !== "approved" || voucher.voided === true) throw new HttpsError("failed-precondition", "Only an active approved voucher can be voided.");
      if (voucher.transactionType === "purchase_advance" && (Object.keys(voucher.allocations || {}).length || voucher.returnedAt)) throw new HttpsError("failed-precondition", "An allocated or returned supplier payment cannot be voided. Reverse its linked activity first.");
      if (!reason) throw new HttpsError("invalid-argument", "A void reason is required."); approvalAction = "void_petty_voucher";
    } else throw new HttpsError("invalid-argument", "Petty voucher action is invalid.");
    const approval = await claimManagerApproval(db, data, approvalAction, id, value, `${approvalAction}_${id}`);
    const approvedBy = approval.record.approvedName || approval.record.approvedEmail || approval.record.approvedRole;
    if (action === "approve") {
      const requesterName = financeText(voucher.requesterName, 160).toLowerCase();
      const managerNames = [approval.record.approvedName, String(approval.record.approvedEmail || "").split("@")[0]].map((x) => financeText(x, 160).toLowerCase()).filter(Boolean);
      if (requesterName && managerNames.includes(requesterName)) {await db.ref().update(approval.usedWrites); throw new HttpsError("failed-precondition", "The requester cannot approve their own voucher.");}
    }
    let baseFunds = 0;
    if (action === "approve") {
      const custodySnap = await db.ref("/cashCustody").get();
      baseFunds = Financial.money(Object.values(custodySnap.val() || {}).reduce((sum, row) => sum + Financial.money(row && row.remaining), 0));
    }
    let failure = "", duplicate = false; const vouchersRef = db.ref("/pettyCashVouchers"), vouchersInitial = (await vouchersRef.get()).val() || {}, transactionState = {seen: false};
    const result = await vouchersRef.transaction((all) => {
      all = transactionCurrent(all, vouchersInitial, transactionState); if (!all) return; all = Object.assign({}, all); const current = all[id]; failure = ""; duplicate = false;
      if (!current) {failure = "Revolving Fund voucher not found."; return;}
      if (action === "approve") {
        if (current.status === "approved" && current.approvalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be approved."; return;}
        if (current.transactionType === "purchase_advance" && !current.receiptImg) {failure = "A supplier receipt is required before approval."; return;}
        if (!current.receiptImg && !financeText(current.purpose, 300)) {failure = "A receipt or clear explanation is required before approval."; return;}
        const available = Financial.money(baseFunds);
        if (value > available + 0.009) {failure = `Voucher exceeds available Undeposited Collection (₱${available.toFixed(2)}).`; return;}
        all[id] = Object.assign({}, current, {status: "approved", approvedBy, approvedByUid: approval.record.approvedBy, approvedAt: now, approvalId: approval.id});
      } else if (action === "reject") {
        if (current.status === "rejected" && current.rejectionApprovalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "pending") {failure = "Only pending vouchers can be rejected."; return;}
        all[id] = Object.assign({}, current, {status: "rejected", rejectReason: reason, rejectedBy: approvedBy, rejectedByUid: approval.record.approvedBy, rejectedAt: now, rejectionApprovalId: approval.id});
      } else {
        if (current.voided === true && current.voidApprovalId === approval.id) {duplicate = true; return all;}
        if (current.status !== "approved" || current.voided === true) {failure = "Only an active approved voucher can be voided."; return;}
        all[id] = Object.assign({}, current, {voided: true, voidReason: reason, voidedBy: approvedBy, voidedByUid: approval.record.approvedBy, voidedAt: now, voidApprovalId: approval.id});
      }
      return all;
    }, undefined, false);
    if (!result.committed) throw new HttpsError("failed-precondition", failure || "Voucher changed while it was being reviewed. Refresh and try again.");
    await db.ref().update(Object.assign({}, approval.usedWrites, {[`operationalAudit/${now}_${id}`]: operationalAuditRecord(`${action}_petty_voucher`, "pettyVoucher", id, actor, {approvalId: approval.id, amount: value, evidenceType: voucher.receiptImg ? "receipt" : "manager_reviewed_explanation", explanation: financeText(voucher.purpose, 300)})}));
    return {voucherId: id, action, at: now, duplicate};
  },
);

exports.retireRevolvingFund = onCall(
  {region: ORDER_REGION, enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const db = getDatabase(); const actor = await requirePortalPermission(db, request, ["petty", "cashflow"]);
    const data = request.data || {}, now = Date.now();
    const movementsSnap = await db.ref("/financialMovements").get(); let bal = 0;
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

exports.getUndepositedControlSnapshot = onCall(
