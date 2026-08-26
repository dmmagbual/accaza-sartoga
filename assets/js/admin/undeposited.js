(function(){
'use strict';
var movements={},custody={},vouchers={},rangeFrom='',rangeTo='';
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function receiptSrc(s){s=String(s||'');return /^data:image\/(?:jpeg|png|webp);base64,/i.test(s)||/^https:\/\//i.test(s)?s:'';}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function fv(id){var el=document.getElementById(id);return el?el.value:'';}
var POOL='asset:cash_awaiting_deposit',PETTY='asset:petty_cash';
var TYPE_LABELS={
  undeposited_opening_balance:'Beginning balance',
  shift_cash_to_custody:'Shift turnover in',
  register_cash_deposit:'Bank deposit',
  revolving_fund_purchase_advance:'Supplier payment',
  revolving_fund_purchase_advance_void:'Supplier payment voided',
  petty_cash_expense:'Cash expense',
  petty_cash_expense_void:'Cash expense voided',
  revolving_fund_owner_withdrawal:'Owner withdrawal',
  revolving_fund_owner_withdrawal_void:'Owner withdrawal voided',
  revolving_fund_supplier_payment_return:'Supplier payment returned',
  revolving_fund_retirement:'Revolving Fund folded in'
};
var CATEGORY_LABELS={operating_supplies:'Cleaning & operating supplies',office_supplies:'Office & administrative supplies',utilities:'Utilities',internet_phone:'Internet & phone',marketing:'Marketing & promotions',repairs:'Repairs & maintenance',bank_fees:'Bank & payment fees',rent:'Rent',salaries:'Salaries & wages',transport:'Transportation / delivery',staff_meals:'Staff meals / welfare',miscellaneous:'Other operating expense',other_expense:'Other operating expense',owner_draw:"Owner's Drawings",'Supplier payment pending inventory allocation':'Supplier payment pending inventory allocation'};
function categoryLabel(v){return CATEGORY_LABELS[String(v&&v.category||'')]||String(v&&v.category||'').replace(/_/g,' ')||'Uncategorized';}
function labelFor(t){return TYPE_LABELS[t]||String(t||'Movement').replace(/_/g,' ');}
var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){
  var a=A();
  a.subscribe('financialMovements',function(s){movements=s.val()||{};if(isTab('undeposited'))renderUndeposited();});
  a.subscribe('cashCustody',function(s){custody=s.val()||{};if(isTab('undeposited'))renderUndeposited();});
  a.subscribe('pettyCashVouchers',function(s){vouchers=s.val()||{};if(isTab('undeposited'))renderUndeposited();});
}
function accountDelta(m,account){var dr=0,cr=0;(m&&m.lines||[]).forEach(function(l){if(l&&l.account===account){dr+=Number(l.debit)||0;cr+=Number(l.credit)||0;}});return {dr:dr,cr:cr};}
function poolRows(){
  var rows=[];
  Object.keys(movements).forEach(function(id){
    var m=movements[id];if(!m||!m.lines)return;
    var d=accountDelta(m,POOL);if(!d.dr&&!d.cr)return;
    rows.push({id:id,ts:Number(m.occurredAt||m.postedAt||0),type:m.type||'',ref:m.sourceId||'',src:m.sourceType||'',inAmt:d.dr,outAmt:d.cr,actor:m.actorName||'',movement:m,voucher:m.sourceType==='pettyVoucher'?vouchers[m.sourceId]||null:null});
  });
  rows.sort(function(a,b){return (a.ts-b.ts)||String(a.id).localeCompare(String(b.id));});
  return rows;
}
function pettyBalance(){var b=0;Object.keys(movements).forEach(function(id){var d=accountDelta(movements[id],PETTY);b+=d.dr-d.cr;});return Math.round(b*100)/100;}
function fmtDate(ts){if(!ts)return '—';var d=new Date(ts);return d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'});}
function renderUndeposited(){
  var root=document.getElementById('undepositedRoot');if(!root)return;
  var rows=poolRows(),bal=0;rows.forEach(function(r){bal+=r.inAmt-r.outAmt;r.run=Math.round(bal*100)/100;});
  var poolBal=Math.round(bal*100)/100;
  var custodyRemaining=Object.keys(custody).reduce(function(s,k){return s+(Number(custody[k]&&custody[k].remaining)||0);},0);
  custodyRemaining=Math.round(custodyRemaining*100)/100;
  var tie=Math.abs(poolBal-custodyRemaining)<0.01;
  var petty=pettyBalance();
  var pending=Object.keys(vouchers).map(function(id){return Object.assign({id:id},vouchers[id]);}).filter(function(v){return v.status==='pending'&&!v.voided;}).sort(function(a,b){return (b.createdAt||0)-(a.createdAt||0);});
  var missingApproved=Object.keys(vouchers).map(function(id){return Object.assign({id:id},vouchers[id]);}).filter(function(v){return v.status==='approved'&&!v.voided&&!movements['petty_'+v.id];});
  var openingPosted=!!movements.undeposited_opening_balance;
  var fromTs=rangeFrom?Date.parse(rangeFrom+'T00:00:00+08:00'):null,toTs=rangeTo?Date.parse(rangeTo+'T23:59:59+08:00'):null;
  var shown=rows.filter(function(r){return (!fromTs||r.ts>=fromTs)&&(!toTs||r.ts<=toTs);}).slice().reverse();
  var inTot=shown.reduce(function(s,r){return s+r.inAmt;},0),outTot=shown.reduce(function(s,r){return s+r.outAmt;},0);
  var expenseTotals={};shown.forEach(function(r){if(r.type!=='petty_cash_expense'&&r.type!=='petty_cash_expense_void')return;var k=categoryLabel(r.voucher||r.movement),delta=r.type==='petty_cash_expense'?r.outAmt:-r.inAmt;expenseTotals[k]=Math.round(((expenseTotals[k]||0)+delta)*100)/100;});
  var expenseSummary=Object.keys(expenseTotals).sort().map(function(k){return '<div style="display:flex;justify-content:space-between;gap:1rem;"><span>'+esc(k)+'</span><b>'+peso(expenseTotals[k])+'</b></div>';}).join('')||'<div style="color:var(--tl);">No operating expenses in this range.</div>';
  var body=shown.length?shown.map(function(r){var v=r.voucher,ref=v&&v.voucherNo?v.voucherNo:(r.movement.voucherNo||r.ref||r.src||''),receipt=v&&receiptSrc(v.receiptImg),detail=v?('<tr data-ucdetail="'+esc(r.id)+'" style="display:none;background:#faf7f1;"><td colspan="6" style="padding:.65rem .8rem;font-size:.76rem;"><b>'+esc(categoryLabel(v))+'</b> · Payee '+esc(v.recipient||v.requesterName||'—')+' · Purpose '+esc(v.purpose||'—')+' · Approved by '+esc(v.approvedBy||v.approverName||'—')+' · Status '+esc(v.voided?'voided':v.status||'—')+(receipt?' · <a href="'+esc(receipt)+'" target="_blank" rel="noopener">View receipt</a>':' · No receipt attached')+'</td></tr>'):'';
    return '<tr><td style="white-space:nowrap;">'+esc(fmtDate(r.ts))+'</td><td>'+esc(labelFor(r.type))+(v?' <button type="button" class="pz-btn sec" data-ucvoucher="'+esc(r.id)+'" style="padding:.1rem .35rem;font-size:.65rem;">View</button>':'')+'</td><td style="font-size:.72rem;color:var(--tl);">'+esc(ref)+'</td><td style="text-align:right;color:#155724;">'+(r.inAmt?peso(r.inAmt):'')+'</td><td style="text-align:right;color:#8a1e1e;">'+(r.outAmt?('−'+peso(r.outAmt)):'')+'</td><td style="text-align:right;font-weight:600;">'+peso(r.run)+'</td></tr>'+detail;
  }).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No cash movements in this range.</td></tr>';
  root.innerHTML='<div class="pz-h">💰 Undeposited Collection</div>'
    +'<p class="pz-sub">The single cash-on-hand pool. Shift turnovers flow in; every cash payment (expenses and supplier payments) is drawn out with a receipt and approval; bank deposits clear it. This is the general-ledger truth for cash awaiting deposit.</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:1;min-width:200px;background:#f5faf6;"><div style="font-size:0.75rem;color:var(--tl);">Balance on hand (all-time)</div><div style="font-weight:700;font-size:1.35rem;color:var(--bd);">'+peso(poolBal)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:200px;"><div style="font-size:0.75rem;color:var(--tl);">Cash custody remaining (subledger)</div><div style="font-weight:700;font-size:1.15rem;">'+peso(custodyRemaining)+'</div><div style="font-size:0.72rem;margin-top:2px;color:'+(tie?'#155724':'#8a1e1e')+';">'+(tie?'✓ ties to the ledger':'⚠ differs by '+peso(Math.round((poolBal-custodyRemaining)*100)/100))+'</div></div>'
    +'</div>'
    +(pending.length?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;"><b style="color:#8a6d1b;">Awaiting approval — not yet deducted from cash</b><div style="overflow-x:auto;margin-top:.45rem;"><table class="pz-tbl"><thead><tr><th>Voucher</th><th>Date</th><th>Payee</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead><tbody>'+pending.map(function(v){return '<tr><td>'+esc(v.voucherNo||v.id)+'</td><td>'+esc(v.date||'')+'</td><td>'+esc(v.recipient||v.requesterName||'—')+'</td><td style="text-align:right;">'+peso(v.amount)+'</td><td style="color:#8a6d1b;">pending approval</td></tr>';}).join('')+'</tbody></table></div></div>'):'')
    +(missingApproved.length?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #efb7b2;background:#fff0ef;"><div style="display:flex;gap:.7rem;align-items:center;justify-content:space-between;flex-wrap:wrap;"><div><b style="color:#8b1e1e;">'+missingApproved.length+' approved cash payment(s) missing from the ledger</b><div style="font-size:.75rem;color:#6d5d4d;">Repair posts each approved voucher once and updates cash custody. Beginning cash must be available first.</div></div><button class="pz-btn warn" id="ucRepairPayments">Repair missing payments</button></div></div>'):'')
    +(petty>0.01?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;"><div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;justify-content:space-between;"><div><b style="color:#8a6d1b;">Revolving Fund still holds '+peso(petty)+'</b><div style="font-size:.75rem;color:var(--tl);">Fold it into Undeposited Collection with one approved, audited entry to complete the retirement.</div></div><button class="pz-btn ok" id="ucRetire">Retire &amp; fold in '+peso(petty)+'</button></div></div>'):'')
    +'<div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem;"><button class="pz-btn ok" id="ucRecordPayment">Record cash payment</button><button class="pz-btn sec" id="ucRepairShift">Repair closed-shift turnover</button>'+(!openingPosted?'<button class="pz-btn sec" id="ucOpeningBalance">Set beginning balance</button>':'<span class="az-note" style="align-self:center;">Beginning balance recorded</span>')+'<div class="pz-card" style="flex:1;min-width:260px;padding:.65rem .8rem;"><b style="display:block;margin-bottom:.35rem;">Net operating expenses in range</b>'+expenseSummary+'</div></div>'
    +'<div class="pz-card">'
      +'<div style="display:flex;gap:.6rem;align-items:end;flex-wrap:wrap;margin-bottom:0.6rem;">'
        +'<div><span class="pz-lbl">From</span><input class="pz-in" id="ucFrom" type="date" value="'+esc(rangeFrom)+'"/></div>'
        +'<div><span class="pz-lbl">To</span><input class="pz-in" id="ucTo" type="date" value="'+esc(rangeTo)+'"/></div>'
        +'<button class="pz-btn sec" id="ucClear">Clear</button>'
        +'<div style="flex:1;"></div>'
        +'<div style="text-align:right;font-size:.8rem;color:var(--tl);">In '+peso(inTot)+' · Out '+peso(outTot)+' · '+shown.length+' movements</div>'
      +'</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th style="text-align:right;">In</th><th style="text-align:right;">Out</th><th style="text-align:right;">Balance</th></tr></thead><tbody>'+body+'</tbody></table></div>'
    +'</div>';
  var f=document.getElementById('ucFrom');if(f)f.onchange=function(){rangeFrom=f.value;renderUndeposited();};
  var t=document.getElementById('ucTo');if(t)t.onchange=function(){rangeTo=t.value;renderUndeposited();};
  var cl=document.getElementById('ucClear');if(cl)cl.onclick=function(){rangeFrom='';rangeTo='';renderUndeposited();};
  var rb=document.getElementById('ucRetire');if(rb)rb.onclick=doRetire;
  var rp=document.getElementById('ucRecordPayment');if(rp)rp.onclick=function(){var btn=document.querySelector('.admin-tab[onclick*="\'petty\'"]');if(window.posSwitchTab)window.posSwitchTab('petty',btn);};
  var rs=document.getElementById('ucRepairShift');if(rs)rs.onclick=repairClosedShift;
  var ob=document.getElementById('ucOpeningBalance');if(ob)ob.onclick=setOpeningBalance;
  var repair=document.getElementById('ucRepairPayments');if(repair)repair.onclick=function(){repairMissingPayments(missingApproved);};
  root.querySelectorAll('[data-ucvoucher]').forEach(function(b){b.onclick=function(){var row=root.querySelector('[data-ucdetail="'+b.getAttribute('data-ucvoucher')+'"]');if(row)row.style.display=row.style.display==='none'?'table-row':'none';};});
}
function repairClosedShift(){
  var a=A(),form=window.AccazaFormDialog;if(!a.repairClosedShiftTurnover||!a.managerApproval||!form){alert('Closed-shift repair service is unavailable. Refresh the portal.');return;}
  form.run({title:'Repair closed-shift turnover',subtitle:'Enter the shift ID from the Z-report. The server will calculate the omitted cash from its saved payment lines.',submitLabel:'Review cash turnover',busyLabel:'Checking…',fields:[{name:'shiftId',label:'Closed shift ID',required:true,maxLength:80,placeholder:'e.g. SH-700410'}]},function(v){var id=String(v.shiftId||'').trim();return a.repairClosedShiftTurnover({shiftId:id,preview:true}).then(function(r){var d=(r&&r.data)||r||{};if(d.duplicate){alert('This shift turnover is already in Undeposited Collection. No duplicate was posted.');return {duplicate:true,shiftId:id,amount:d.amount};}if(!confirm('Confirm '+peso(d.amount)+' from '+id+' was physically received into Undeposited Collection?\n\nA manager approval will post the custody, Finance Books, and audit entries exactly once.'))throw new Error('cancelled');return a.managerApproval('repair_closed_shift_turnover',id,d.amount,'Confirmed omitted closed-shift cash was physically received').then(function(ap){return a.repairClosedShiftTurnover({shiftId:id,approvalId:ap.approvalId});});});}).then(function(res){var x=(res&&res.data)||res||{};if(!x||x.duplicate)return;alert('Posted '+peso(x.amount)+' from '+x.shiftId+' to Undeposited Collection and Finance Books.');}).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not repair shift turnover: '+((e&&e.message)||e));});
}
function repairMissingPayments(rows){
  var a=A();if(!a.repairPettyVoucherFinancial){alert('Cash-payment repair service is unavailable. Refresh the portal.');return;}if(!rows.length)return;if(!confirm('Repair '+rows.length+' approved cash payment(s) missing from Undeposited Collection and Finance Books?\n\nEach voucher uses a duplicate-safe movement ID.'))return;
  var repaired=0,chain=Promise.resolve();rows.forEach(function(v){chain=chain.then(function(){return a.repairPettyVoucherFinancial({voucherId:v.id});}).then(function(r){var d=(r&&r.data)||r||{};if(!d.duplicate)repaired++;});});chain.then(function(){alert('Repair complete. '+repaired+' missing payment(s) posted; existing entries were not duplicated.');if(window.__posLog)window.__posLog('petty-financial-repair','',String(repaired));}).catch(function(e){alert('Repair stopped: '+((e&&e.message)||e)+' It is safe to retry after resolving the stated issue.');});
}
function setOpeningBalance(){
  var a=A(),form=window.AccazaFormDialog;if(!a.setUndepositedOpeningBalance||!a.managerApproval||!form){alert('Beginning-balance service is unavailable. Refresh the portal.');return;}
  form.run({title:'Set Undeposited Collection beginning balance',subtitle:'Enter physical cash on hand before the first recorded movement. This is not today’s current balance and can be posted only once.',submitLabel:'Request approval & post',busyLabel:'Posting…',fields:[{name:'date',label:'Opening date',type:'date',required:true,value:window.AccazaDate.key()},{name:'amount',label:'Beginning cash on hand ₱',type:'number',required:true,min:.01,step:.01},{name:'reference',label:'Cash count / source reference',required:true,maxLength:120,placeholder:'e.g. Opening cash count 2026-08-01'},{name:'reason',label:'Basis and supporting note',type:'textarea',required:true,maxLength:300,placeholder:'Explain how the beginning cash was counted and supported'}]},function(v){return a.managerApproval('set_undeposited_opening_balance','undepositedCollection',v.amount,v.reason).then(function(ap){return a.setUndepositedOpeningBalance({date:v.date,amount:v.amount,reference:v.reference,reason:v.reason,approvalId:ap.approvalId});});}).then(function(r){var d=(r&&r.data)||r||{};alert('Beginning balance posted: '+peso(d.amount)+'. Undeposited Collection and Finance Books now include the opening entry.');if(window.__posLog)window.__posLog('undeposited-opening-balance',d.reference,peso(d.amount));}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not post beginning balance: '+((e&&e.message)||e));});
}
function doRetire(){
  var a=A();if(!a.retireRevolvingFund||!a.managerApproval){alert('Retirement service is unavailable. Refresh the portal.');return;}
  a.retireRevolvingFund({preview:true}).then(function(r){
    var d=(r&&r.data)||r||{},bal=Number(d.balance)||0;
    if(!(bal>0.01)){alert('The Revolving Fund balance is already zero — nothing to retire.');return;}
    if(!confirm('Fold the Revolving Fund balance of '+peso(bal)+' into Undeposited Collection?\n\nThis posts one approved, audited journal entry and cannot be undone without a reversing entry.'))return;
    a.managerApproval('retire_revolving_fund','revolvingFund',bal,'Retire Revolving Fund — fold into Undeposited Collection').then(function(ap){
      return a.retireRevolvingFund({approvalId:ap.approvalId});
    }).then(function(res){
      var d=(res&&res.data)||res||{};
      if(d.retired){alert('Revolving Fund retired. '+peso(d.amount)+' folded into Undeposited Collection.');if(window.__posLog)window.__posLog('revolving-fund-retire','',peso(d.amount));}
      else alert('No change: '+(d.reason||'the fund was already retired.'));
    }).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Retirement failed: '+((e&&e.message)||e));});
  }).catch(function(e){alert('Could not read the Revolving Fund balance: '+((e&&e.message)||e));});
}
window.__accazaRegisterModule('undeposited',function(name){if(name==='undeposited')renderUndeposited();});
})();
