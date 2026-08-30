
/* ---------- Revolving Fund (legacy petty-cash storage keys retained) ---------- */
var PETTY_CATS=[
  {id:'operating_supplies',label:'Cleaning & operating supplies'},
  {id:'office_supplies',label:'Office & administrative supplies'},
  {id:'utilities',label:'Utilities'},
  {id:'internet_phone',label:'Internet & phone'},
  {id:'marketing',label:'Marketing & promotions'},
  {id:'repairs',label:'Repairs & maintenance'},
  {id:'bank_fees',label:'Bank & payment fees'},
  {id:'rent',label:'Rent'},
  {id:'salaries',label:'Salaries & wages'},
  {id:'transport',label:'Transportation / delivery'},
  {id:'staff_meals',label:'Staff meals / welfare'},
  {id:'other_expense',label:'Other operating expense'}
];
function pettyCategoryLabel(v){if(v.transactionType==='owner_withdrawal')return 'Owner withdrawal — Owner\'s Drawings (3100)';var found=PETTY_CATS.find(function(c){return c.id===v.category;});return found?found.label:(v.category||'Expense');}
function fv(id){var el=document.getElementById(id);return el?el.value:'';}
function pettyBalance(){
  var open=Number((pettySettings&&pettySettings.openingBalance)||0);
  var rep=Object.keys(pettyRepl).reduce(function(s,k){return s+(Number(pettyRepl[k].amount)||0);},0);
  var dis=Object.keys(pettyVouchers).reduce(function(s,k){var v=pettyVouchers[k];return s+((v.status==='approved'&&!v.voided)?(Number(v.amount)||0):0);},0);
  var advances=Object.keys(pettyVouchers).reduce(function(s,k){var v=pettyVouchers[k];return s+((v.status==='approved'&&!v.voided&&v.transactionType==='purchase_advance')?Math.max(0,Number(v.remainingAmount!=null?v.remainingAmount:v.amount)||0):0);},0);
  return {opening:open,replen:rep,disb:dis,remaining:open+rep-dis,advances:advances,accountability:open+rep-dis+advances};
}
function compressImage(file,cb){
  if(!file){cb('');return;}
  var rd=new FileReader();
  rd.onload=function(e){var img=new Image();img.onload=function(){var max=900,w=img.width,h=img.height,sc=Math.min(1,max/Math.max(w,h));w=Math.round(w*sc);h=Math.round(h*sc);var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);try{cb(c.toDataURL('image/jpeg',0.6));}catch(err){cb('');}};img.onerror=function(){cb('');};img.src=e.target.result;};
  rd.onerror=function(){cb('');};
  rd.readAsDataURL(file);
}
function nextVoucherNo(cb){
  var d=new Date();var key=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0');var a=A();
  a.runTransaction(a.ref(a.db,'pettyCashCounter/'+key),function(cur){return (Number(cur)||0)+1;}).then(function(res){var n=(res.snapshot&&res.snapshot.val())||1;cb('PV-'+key+'-'+String(n).padStart(4,'0'));}).catch(function(){cb('PV-'+key+'-'+Date.now().toString().slice(-4));});
}
function renderPetty(){
  var root=document.getElementById('pettyRoot'); if(!root)return;
  var bal=pettyBalance();
  var vs=Object.keys(pettyVouchers).map(function(k){return Object.assign({id:k},pettyVouchers[k]);}).sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);});
  var pend=vs.filter(function(v){return v.status==='pending';});
  var catOpts=PETTY_CATS.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.label)+'</option>';}).join('');
  var today=window.AccazaDate.key();
  function vrowHtml(v){
    var st=v.voided?'<span style="color:#c0392b;">VOID</span>':(v.status==='approved'?'<span style="color:#155724;">approved</span>':(v.status==='rejected'?'<span style="color:#c0392b;">rejected</span>':'<span style="color:#8a6d1b;">pending</span>'));
    var remaining=Number(v.remainingAmount!=null?v.remainingAmount:v.amount)||0;
    var edit=(['pending','approved'].indexOf(v.status)>=0&&!v.voided&&!v.returnedAt)?'<button class="pz-btn sec" data-pved="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Edit</button> ':'';
    var act=v.status==='pending'?(edit+'<button class="pz-btn ok" data-pvap="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Approve</button> <button class="pz-btn warn" data-pvrj="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Reject</button>'):(edit+'<button class="pz-btn sec" data-pvpr="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Print</button>'+((v.status==='approved'&&!v.voided&&v.transactionType==='purchase_advance'&&remaining>0)?' <button class="pz-btn sec" data-pvrt="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Return balance</button>':'')+((v.status==='approved'&&!v.voided&&!(v.transactionType==='purchase_advance'&&(Object.keys(v.allocations||{}).length||v.returnedAt)))?' <button class="pz-btn warn" data-pvvd="'+esc(v.id)+'" style="padding:0.2rem 0.5rem;">Void</button>':''));
    var rc=v.receiptImg?'<a href="'+v.receiptImg+'" target="_blank" style="color:var(--bd);">Receipt</a>':(v.purpose?'<span title="'+esc(v.purpose)+'" style="color:#155724;">Manager explanation</span>':'<span style="color:#c0392b;">Missing</span>');
    var kind=v.transactionType==='purchase_advance'?'Supplier payment — pending inventory allocation':pettyCategoryLabel(v),alloc=v.transactionType==='purchase_advance'?('<div style="font-size:.7rem;color:var(--tl);">'+peso(v.remainingAmount!=null?v.remainingAmount:v.amount)+' awaiting allocation</div>'):'';
    return '<tr'+(v.voided?' style="opacity:0.55;"':'')+'><td>'+esc(v.voucherNo||'')+'</td><td>'+esc(v.date||'')+'</td><td style="text-align:right;">'+peso(v.amount)+'</td><td>'+esc(kind)+alloc+'</td><td>'+esc(v.recipient||v.requesterName||'')+'</td><td>'+esc(v.approvedBy||v.approverName||'')+'</td><td>'+rc+'</td><td>'+st+'</td><td style="white-space:nowrap;">'+act+'</td></tr>';
  }
  var repl=Object.keys(pettyRepl).map(function(k){return pettyRepl[k];}).sort(function(a,b){return (b.ts||0)-(a.ts||0);});
  var custodian=(pettySettings&&pettySettings.custodian)||'';
  root.innerHTML='<div class="pz-h">💵 Cash Payments</div>'
    +'<p class="pz-sub">Approved cash payments drawn from <b>Undeposited Collection</b> — operating expenses, owner withdrawals, and supplier payments. A receipt or clear manager-reviewed explanation is required, and only an approved voucher is posted to cash and Finance Books. Supplier and inventory payments still require a receipt, must be itemized in <b>Purchases</b>, and allocated to stock.</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;background:#f8f6f1;"><div style="display:flex;gap:.6rem;align-items:end;flex-wrap:wrap;"><div style="flex:1;min-width:220px;"><span class="pz-lbl">Current cash custodian</span><input class="pz-in" id="rfCustodian" value="'+esc(custodian)+'" placeholder="Manager responsible for the physical cash"/></div><button class="pz-btn sec" id="rfCustodianSave">Save custodian</button><button class="pz-btn ok" id="rfOpenPurchases">Open detailed Purchases</button></div><div class="az-note">Undeposited Collection has one accountable custodian. A handover should include a physical cash count.</div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:2;min-width:220px;background:#f5faf6;"><div style="font-size:0.75rem;color:var(--tl);">Funding source</div><div style="font-weight:700;color:var(--bd);">Undeposited Collection</div><div style="font-size:.72rem;color:var(--tl);margin-top:2px;">Live cash-on-hand balance is on the Undeposited Collection tab.</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:180px;"><div style="font-size:0.75rem;color:var(--tl);">Payments awaiting inventory allocation</div><div style="font-weight:700;color:#8a5a00;">'+peso(bal.advances)+'</div></div>'
    +'</div>'
    +'<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:2;min-width:280px;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Record a cash payment</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">'
          +'<div><span class="pz-lbl">Transaction type</span><select class="pz-in" id="pvType"><option value="expense">Operating expense</option><option value="owner_withdrawal">Owner withdrawal — not an expense</option><option value="purchase_advance">Payment to supplier — allocate to inventories</option></select></div>'
          +'<div><span class="pz-lbl">Date</span><input class="pz-in" id="pvDate" type="date" value="'+today+'"/></div>'
          +'<div><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="pvAmount" type="number" step="any"/></div>'
          +'<div><span class="pz-lbl">Category</span><select class="pz-in" id="pvCat">'+catOpts+'</select></div>'
          +'<div><span class="pz-lbl">Requester / supplier payee</span><input class="pz-in" id="pvRequester"/></div>'
          +'<div><span class="pz-lbl">Explanation / purpose</span><input class="pz-in" id="pvPurpose" placeholder="Required when no receipt is attached"/></div>'
          +'<div><span class="pz-lbl">Approver (intended)</span><input class="pz-in" id="pvApprover"/></div>'
          +'<div><span class="pz-lbl">Receipt photo</span><input class="pz-in" id="pvReceipt" type="file" accept="image/*"/><div class="az-note" id="pvEvidenceNote">No receipt? Enter a clear explanation above for manager approval.</div></div>'
        +'</div><div style="margin-top:0.7rem;"><button class="pz-btn ok" id="pvCreate">Create voucher</button></div></div>'
    +'</div>'
    +(pend.length?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;"><div style="font-weight:700;color:#8a6d1b;margin-bottom:0.5rem;">⏳ Pending approval ('+pend.length+')</div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Voucher</th><th>Date</th><th style="text-align:right;">Amount</th><th>Category</th><th>Requester</th><th>Approver</th><th>Evidence</th><th>Status</th><th></th></tr></thead><tbody>'+pend.map(vrowHtml).join('')+'</tbody></table></div></div>'):'')
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">Voucher register</div><button class="pz-btn sec" id="pettyExport" style="padding:0.25rem 0.7rem;">⬇ Export Excel</button></div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Voucher</th><th>Date</th><th style="text-align:right;">Amount</th><th>Category</th><th>Requester</th><th>Approver</th><th>Evidence</th><th>Status</th><th></th></tr></thead><tbody>'+(vs.length?vs.map(vrowHtml).join(''):'<tr><td colspan="9" style="color:var(--tl);padding:0.6rem;">No vouchers yet.</td></tr>')+'</tbody></table></div></div>'
  ;
  var cs=document.getElementById('rfCustodianSave');if(cs)cs.onclick=function(){var name=(fv('rfCustodian')||'').trim();if(!name){alert('Enter the manager responsible for the physical cash.');return;}A().update(A().ref(A().db,'pettyCashSettings'),{custodian:name,custodianUpdatedAt:Date.now()}).then(function(){alert('Cash custodian saved.');});};
  var op=document.getElementById('rfOpenPurchases');if(op)op.onclick=function(){var btn=document.getElementById('tabBtnPurchases');if(btn)posSwitchTab('purchases',btn);};
  var c=document.getElementById('pvCreate'); if(c)c.onclick=createVoucher;
  var pt=document.getElementById('pvType'),pc=document.getElementById('pvCat'),lastExpenseCat='operating_supplies';
  function syncPettyCategory(){if(!pt||!pc)return;var note=document.getElementById('pvEvidenceNote');if(pt.value==='expense'){pc.disabled=false;pc.innerHTML=catOpts;pc.value=lastExpenseCat;pc.title='Select the Finance Books expense category.';}else{lastExpenseCat=PETTY_CATS.some(function(x){return x.id===pc.value;})?pc.value:lastExpenseCat;pc.disabled=true;if(pt.value==='owner_withdrawal'){pc.innerHTML='<option value="owner_draw">Owner\'s Drawings (3100) — not an expense</option>';pc.title="Posts automatically to Owner's Drawings (3100).";}else{pc.innerHTML='<option value="purchase_allocation">Purchases — pending inventory allocation</option>';pc.title='Itemize and allocate this payment later in Purchases.';}}if(note)note.textContent=pt.value==='purchase_advance'?'Supplier and inventory payments require a receipt before approval.':'No receipt? Enter a clear explanation above for manager approval.';}
  if(pt&&pc){pc.onchange=function(){if(pt.value==='expense')lastExpenseCat=pc.value;};pt.onchange=syncPettyCategory;syncPettyCategory();}
  var ra=document.getElementById('prAdd'); if(ra)ra.onclick=addReplenishment;
  var os=document.getElementById('pvOpenSave'); if(os)os.onclick=function(){var a=A();a.update(a.ref(a.db,'pettyCashSettings'),{openingBalance:Number(fv('pvOpening'))||0}).then(function(){alert('Opening balance saved.');});};
  var ex=document.getElementById('pettyExport'); if(ex)ex.onclick=exportPetty;
  root.querySelectorAll('[data-pvap]').forEach(function(b){b.onclick=function(){approveVoucher(b.getAttribute('data-pvap'));};});
  root.querySelectorAll('[data-pved]').forEach(function(b){b.onclick=function(){editVoucher(b.getAttribute('data-pved'));};});
  root.querySelectorAll('[data-pvrj]').forEach(function(b){b.onclick=function(){rejectVoucher(b.getAttribute('data-pvrj'));};});
  root.querySelectorAll('[data-pvvd]').forEach(function(b){b.onclick=function(){voidVoucher(b.getAttribute('data-pvvd'));};});
  root.querySelectorAll('[data-pvrt]').forEach(function(b){b.onclick=function(){returnSupplierPayment(b.getAttribute('data-pvrt'));};});
  root.querySelectorAll('[data-pvpr]').forEach(function(b){b.onclick=function(){printVoucher(b.getAttribute('data-pvpr'));};});
}
function editVoucher(id){
  var v=pettyVouchers[id];if(!v||['pending','approved'].indexOf(v.status)<0||v.voided||v.returnedAt)return;var approved=v.status==='approved',isExpense=(v.transactionType||'expense')==='expense',allocated=Object.keys(v.allocations||{}).reduce(function(sum,k){return sum+(Number(v.allocations[k]&&v.allocations[k].amount)||0);},0),fields=[];
  if(!approved)fields.push({name:'date',label:'Payment date',type:'date',required:true,value:v.date||window.AccazaDate.key()});
  fields.push({name:'amount',label:'Amount ₱',type:'number',required:true,min:allocated>0?allocated:0.01,step:0.01,value:Number(v.amount)||0,help:allocated>0?peso(allocated)+' is already allocated to inventory and cannot be reduced.':'Approved amount changes create a linked Finance Books correction.'});
  if(isExpense)fields.push({name:'category',label:'Expense category',type:'select',required:true,value:v.category||'other_expense',options:PETTY_CATS.map(function(c){return {value:c.id,label:c.label};})});
  fields.push({name:'payee',label:'Requester / supplier payee',required:true,maxLength:160,value:v.recipient||v.requesterName||''},{name:'purpose',label:'Purpose',maxLength:300,value:v.purpose||''},{name:'approverName',label:'Intended approver',maxLength:160,value:v.approverName||''},{name:'reason',label:'Correction reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this cash payment record is being corrected'});
  F().run({title:'Edit cash payment',subtitle:(v.voucherNo||id)+(approved?' · Approved entry — manager approval and Finance Books correction required':' · Pending entry — no financial posting yet'),submitLabel:approved?'Request approval & correct':'Save correction',busyLabel:'Correcting…',fields:fields},function(x){var command={action:'correct',voucherId:id,date:approved?v.date:x.date,amount:x.amount,category:isExpense?x.category:v.category,payee:x.payee,purpose:x.purpose,approverName:x.approverName,reason:x.reason};if(!approved)return A().managePettyVoucher(command);return A().managerApproval('correct_petty_voucher',id,x.amount,x.reason).then(function(ap){command.approvalId=ap.approvalId;return A().managePettyVoucher(command);});}).then(function(){window.__posLog('petty-correct',v.voucherNo,'from '+peso(v.amount));alert(approved?'Cash payment corrected. The linked Finance Books correction and audit trail were recorded.':'Pending cash payment updated.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not edit cash payment: '+((e&&e.message)||e));});
}
function createVoucher(){
  var amount=Number(fv('pvAmount'))||0; if(!amount){alert('Enter an amount.');return;}
  var requester=(fv('pvRequester')||'').trim(); if(!requester){alert('Enter the requester name.');return;}
  var date=fv('pvDate')||window.AccazaDate.key(); var category=fv('pvCat'); var approver=(fv('pvApprover')||'').trim(),transactionType=fv('pvType')||'expense',purpose=(fv('pvPurpose')||'').trim();
  if(transactionType==='owner_withdrawal')category='owner_draw';
  if(transactionType==='purchase_advance'&&!purpose){alert('Enter what inventory will be purchased or allocated.');return;}
  var fileEl=document.getElementById('pvReceipt'); var file=fileEl&&fileEl.files&&fileEl.files[0];
  if(transactionType==='purchase_advance'&&!file){alert('Attach the supplier receipt before creating this payment voucher.');return;}
  if(!file&&!purpose){alert('Attach a receipt or enter a clear explanation for the manager to review.');return;}
  var btn=document.getElementById('pvCreate'); if(btn)btn.disabled=true;
  compressImage(file,function(img){
    nextVoucherNo(function(no){
      var a=A();var id=uid('pv_');
      a.set(a.ref(a.db,'pettyCashVouchers/'+id),{voucherNo:no,date:date,amount:amount,transactionType:transactionType,category:transactionType==='purchase_advance'?'Supplier payment pending inventory allocation':category,requesterName:requester,recipient:requester,purpose:purpose,remainingAmount:transactionType==='purchase_advance'?amount:null,approverName:approver,receiptImg:img||'',status:'pending',createdBy:(activeShift&&activeShift.staff)||'Admin',createdAt:Date.now()}).then(function(){window.__posLog('petty-create',no,peso(amount));renderPetty();}).catch(function(e){alert('Could not save voucher: '+e);if(btn)btn.disabled=false;});
    });
  });
}
function approveVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='pending')return;
  if(v.transactionType==='purchase_advance'&&!v.receiptImg){alert('A supplier receipt is required before this voucher can be approved.');return;}
  if(!v.receiptImg&&!(v.purpose||'').trim()){alert('Add a clear explanation or attach a receipt before approval.');return;}
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('Cash-payment approval service is not available. Refresh the portal.');return;}
  a.managerApproval('approve_petty_voucher',id,Number(v.amount)||0,'Approve '+v.voucherNo).then(function(ap){return a.managePettyVoucher({action:'approve',voucherId:id,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-approve',v.voucherNo,peso(v.amount));alert('Voucher approved.');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Approval failed: '+((e&&e.message)||e));});
}
function rejectVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='pending')return;
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('Cash-payment approval service is not available. Refresh the portal.');return;}
  F().run({title:'Reject cash-payment voucher',subtitle:v.voucherNo+' · '+peso(v.amount),submitLabel:'Request rejection approval',busyLabel:'Processing…',fields:[{name:'reason',label:'Rejection reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this voucher is being rejected'}]},function(x){return a.managerApproval('reject_petty_voucher',id,Number(v.amount)||0,x.reason).then(function(ap){return a.managePettyVoucher({action:'reject',voucherId:id,reason:x.reason,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-reject',v.voucherNo,x.reason);});}).then(function(){alert('Voucher rejected.');}).catch(function(){});
}
function voidVoucher(id){
  var v=pettyVouchers[id]; if(!v||v.status!=='approved'||v.voided)return;
  var a=A();if(!a.managePettyVoucher||!a.managerApproval){alert('Cash-payment approval service is not available. Refresh the portal.');return;}
  F().run({title:'Void cash-payment voucher',subtitle:v.voucherNo+' · '+peso(v.amount),submitLabel:'Request void approval',busyLabel:'Processing…',fields:[{name:'reason',label:'Void reason',type:'textarea',required:true,maxLength:300,placeholder:'Explain why this approved voucher must be voided'}]},function(x){return a.managerApproval('void_petty_voucher',id,Number(v.amount)||0,x.reason).then(function(ap){return a.managePettyVoucher({action:'void',voucherId:id,reason:x.reason,approvalId:ap.approvalId});}).then(function(){window.__posLog('petty-void',v.voucherNo,x.reason);});}).then(function(){alert('Voucher voided and Undeposited Collection cash restored.');}).catch(function(){});
}
function returnSupplierPayment(id){
  var v=pettyVouchers[id];if(!v||v.transactionType!=='purchase_advance'||v.status!=='approved'||v.voided)return;var remaining=Number(v.remainingAmount!=null?v.remainingAmount:v.amount)||0;if(!(remaining>0)){alert('No unallocated balance remains.');return;}var a=A();F().run({title:'Return unallocated supplier payment',subtitle:(v.recipient||'Supplier')+' · '+peso(remaining)+' will return to Undeposited Collection.',submitLabel:'Request approval & record return',busyLabel:'Recording return…',fields:[{name:'reason',label:'Return reason / reference',type:'textarea',required:true,maxLength:300}]},function(x){return a.managerApproval('return_supplier_payment',id,remaining,x.reason).then(function(ap){return a.managePettyVoucher({action:'return',voucherId:id,reason:x.reason,approvalId:ap.approvalId});});}).then(function(){alert('Unallocated payment returned to Undeposited Collection and Finance Books.');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not record return: '+((e&&e.message)||e));});
}
function addReplenishment(){
  var amt=Number(fv('prAmount'))||0; if(!amt){alert('Enter an amount.');return;}
  var source=fv('prSource'); var note=(fv('prNote')||'').trim(); var a=A();
  a.set(a.ref(a.db,'pettyCashReplenishments/'+uid('pr_')),{amount:amt,source:source,note:note,by:(activeShift&&activeShift.staff)||'Admin',ts:Date.now(),date:window.AccazaDate.key()});
  if(source==='register'){
    if(!activeShift){alert('Recorded to the Revolving Fund. No shift is open, so no register drawer pay-out was posted.');}
    else{ var po=(activeShift.payOuts||[]).slice(); var poEntry={amount:amt,reason:'Revolving Fund replenish',type:'revolving_fund_replenishment',ts:Date.now()};
      if(denomTrackingOnR()){ var mc=makeChangeD(amt,drawerNow()); poEntry.denoms=mc.denoms; saveDrawer(subD(drawerNow(),mc.denoms)); if(!mc.ok)alert('Note: the drawer can’t provide exactly '+peso(amt)+' (short '+peso(mc.short)+'). Recorded the closest notes removed — reconcile at count.'); }
      po.push(poEntry); a.update(a.ref(a.db,'shifts/'+activeShift.id),{payOuts:po}); a.update(a.ref(a.db,'posActiveShift'),{payOuts:po}); }
  }
  window.__posLog('petty-replenish',source,peso(amt));
}
function printVoucher(id){
  var v=pettyVouchers[id]; if(!v)return;
  var w=window.open('','_blank','width=420,height=640'); if(!w){alert('Allow pop-ups to print the voucher.');return;}
  w.document.write('<html><head><title>'+esc(v.voucherNo)+'</title><style>*{font-family:Arial,sans-serif;color:#000;}body{padding:18px;}h2{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;margin-top:8px;}td{padding:4px 2px;vertical-align:top;}hr{border:none;border-top:1px dashed #000;}img{max-width:100%;margin-top:8px;border:1px solid #ccc;}.sig{margin-top:34px;display:flex;justify-content:space-between;}.sig div{width:45%;border-top:1px solid #000;text-align:center;font-size:11px;padding-top:3px;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;font-weight:bold;">REVOLVING FUND VOUCHER</div><hr>'
    +'<table><tr><td>Voucher No.</td><td style="text-align:right;font-weight:bold;">'+esc(v.voucherNo)+'</td></tr>'
    +'<tr><td>Date</td><td style="text-align:right;">'+esc(v.date||'')+'</td></tr>'
    +'<tr><td>Amount</td><td style="text-align:right;font-weight:bold;">'+peso(v.amount)+'</td></tr>'
    +'<tr><td>Category</td><td style="text-align:right;">'+esc(v.category||'')+'</td></tr>'
    +'<tr><td>Requested by</td><td style="text-align:right;">'+esc(v.requesterName||'')+'</td></tr>'
    +'<tr><td>Approved by</td><td style="text-align:right;">'+esc(v.approvedBy||v.approverName||'')+'</td></tr>'
    +'<tr><td>Status</td><td style="text-align:right;">'+(v.voided?'VOID':esc(v.status||''))+'</td></tr></table>'
    +(v.receiptImg?'<div style="font-size:11px;margin-top:8px;">Receipt:</div><img src="'+v.receiptImg+'"/>':'')
    +'<div class="sig"><div>Received by</div><div>Approved by</div></div>'
    +'<div style="text-align:center;margin-top:16px;"><button onclick="window.print()">Print</button></div>'
    +'</body></html>'); w.document.close();
}
function exportPetty(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var bal=pettyBalance();
  var aoa=[['voucherNo','date','amount','category','requester','approvedBy','status','voided','createdBy']];
  Object.keys(pettyVouchers).map(function(k){return pettyVouchers[k];}).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}).forEach(function(v){aoa.push([v.voucherNo||'',v.date||'',Number(v.amount)||0,v.category||'',v.requesterName||'',v.approvedBy||v.approverName||'',v.status||'',v.voided?'yes':'',v.createdBy||'']);});
  aoa.push([]);aoa.push(['Opening',bal.opening]);aoa.push(['Replenishments',bal.replen]);aoa.push(['Disbursements',bal.disb]);aoa.push(['Remaining',bal.remaining]);
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'PettyCash');
  XLSX.writeFile(wb,'accaza-revolving-fund-'+window.AccazaDate.key()+'.xlsx');
}
function archiveOldActivity(){
  if(!confirm('Move activity-log entries older than 60 days to the server-owned archive? Up to 500 entries are processed per click.'))return;
  var a=A();if(!a.archiveActivityLog){alert('3E retention service is not available. Refresh the portal.');return;}
  a.archiveActivityLog().then(function(res){var d=(res&&res.data)||res||{};alert(d.archived?('Archived '+d.archived+' entries.'+(d.hasMore?' Click again to archive the next batch.':'')):'No activity-log entries older than 60 days.');}).catch(function(e){alert('Could not archive activity log: '+((e&&e.message)||e));});
}
function purchaseCashAdvance(){ alert('Supplier payments now come from Undeposited Collection. Open the Cash Payments tab, choose "Payment to supplier — allocate to inventories", then itemize it in Purchases.'); return;
  if(!activeShift){alert('Open a shift first.');return;}var shiftId=activeShift.id;
  F().run({title:'Release cash for a purchase',subtitle:'This reduces the expected drawer immediately. Management will itemize and link the purchase later.',submitLabel:'Request approval & release',busyLabel:'Recording cash release…',fields:[{name:'amount',label:'Amount released ₱',type:'number',required:true},{name:'recipient',label:'Person receiving the cash',required:true,maxLength:120},{name:'purpose',label:'What will be purchased?',type:'textarea',required:true,maxLength:300},{name:'reference',label:'Receipt / request reference',maxLength:120}]},async function(v){var amount=Math.round((Number(v.amount)||0)*100)/100;if(!(amount>0))throw new Error('Enter an amount greater than zero.');if(!activeShift||activeShift.id!==shiftId)throw new Error('The active shift changed. Try again.');var a=A(),advanceId=uid('padv_'),ap=await a.managerApproval('purchase_cash_advance',advanceId,amount,v.purpose),cr=await a.consumeManagerApproval({action:'purchase_cash_advance',sourceId:advanceId,amount:amount,operationKey:advanceId,approvalId:ap.approvalId}),cd=(cr&&cr.data)||cr||{},rows=(activeShift.payOuts||[]).slice();rows.push({id:advanceId,type:'purchase_advance',status:'pending_details',amount:amount,recipient:v.recipient,purpose:v.purpose,reference:v.reference||'',reason:'Purchase advance — '+v.purpose,by:cd.approvedBy||'Manager',approvedByUid:cd.approvedByUid||'',approvedRole:cd.approvedRole||'',approvalId:ap.approvalId,ts:Date.now()});await Promise.all([a.update(a.ref(a.db,'shifts/'+shiftId),{payOuts:rows}),a.update(a.ref(a.db,'posActiveShift'),{payOuts:rows})]);window.__posLog('purchase-cash-advance',advanceId,peso(amount)+' · '+v.recipient+' · '+v.purpose);return amount;}).then(function(amount){alert('Purchase cash advance recorded. Expected drawer reduced by '+peso(amount)+'.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not release purchase cash: '+((e&&e.message)||e));});
}