(function(){
'use strict';
var movements={},custody={},rangeFrom='',rangeTo='';
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function fv(id){var el=document.getElementById(id);return el?el.value:'';}
var POOL='asset:cash_awaiting_deposit',PETTY='asset:petty_cash';
var TYPE_LABELS={
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
function labelFor(t){return TYPE_LABELS[t]||String(t||'Movement').replace(/_/g,' ');}
var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){
  var a=A();
  a.subscribe('financialMovements',function(s){movements=s.val()||{};if(isTab('undeposited'))renderUndeposited();});
  a.subscribe('cashCustody',function(s){custody=s.val()||{};if(isTab('undeposited'))renderUndeposited();});
}
function accountDelta(m,account){var dr=0,cr=0;(m&&m.lines||[]).forEach(function(l){if(l&&l.account===account){dr+=Number(l.debit)||0;cr+=Number(l.credit)||0;}});return {dr:dr,cr:cr};}
function poolRows(){
  var rows=[];
  Object.keys(movements).forEach(function(id){
    var m=movements[id];if(!m||!m.lines)return;
    var d=accountDelta(m,POOL);if(!d.dr&&!d.cr)return;
    rows.push({id:id,ts:Number(m.occurredAt||m.postedAt||0),type:m.type||'',ref:m.sourceId||'',src:m.sourceType||'',inAmt:d.dr,outAmt:d.cr,actor:m.actorName||''});
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
  var fromTs=rangeFrom?Date.parse(rangeFrom+'T00:00:00+08:00'):null,toTs=rangeTo?Date.parse(rangeTo+'T23:59:59+08:00'):null;
  var shown=rows.filter(function(r){return (!fromTs||r.ts>=fromTs)&&(!toTs||r.ts<=toTs);}).slice().reverse();
  var inTot=shown.reduce(function(s,r){return s+r.inAmt;},0),outTot=shown.reduce(function(s,r){return s+r.outAmt;},0);
  var body=shown.length?shown.map(function(r){
    return '<tr><td style="white-space:nowrap;">'+esc(fmtDate(r.ts))+'</td><td>'+esc(labelFor(r.type))+'</td><td style="font-size:.72rem;color:var(--tl);">'+esc(r.ref||r.src||'')+'</td><td style="text-align:right;color:#155724;">'+(r.inAmt?peso(r.inAmt):'')+'</td><td style="text-align:right;color:#8a1e1e;">'+(r.outAmt?('−'+peso(r.outAmt)):'')+'</td><td style="text-align:right;font-weight:600;">'+peso(r.run)+'</td></tr>';
  }).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No cash movements in this range.</td></tr>';
  root.innerHTML='<div class="pz-h">💰 Undeposited Collection</div>'
    +'<p class="pz-sub">The single cash-on-hand pool. Shift turnovers flow in; every cash payment (expenses and supplier payments) is drawn out with a receipt and approval; bank deposits clear it. This is the general-ledger truth for cash awaiting deposit.</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<div class="pz-card" style="flex:1;min-width:200px;background:#f5faf6;"><div style="font-size:0.75rem;color:var(--tl);">Balance on hand (all-time)</div><div style="font-weight:700;font-size:1.35rem;color:var(--bd);">'+peso(poolBal)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:200px;"><div style="font-size:0.75rem;color:var(--tl);">Cash custody remaining (subledger)</div><div style="font-weight:700;font-size:1.15rem;">'+peso(custodyRemaining)+'</div><div style="font-size:0.72rem;margin-top:2px;color:'+(tie?'#155724':'#8a1e1e')+';">'+(tie?'✓ ties to the ledger':'⚠ differs by '+peso(Math.round((poolBal-custodyRemaining)*100)/100))+'</div></div>'
    +'</div>'
    +(petty>0.01?('<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;"><div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;justify-content:space-between;"><div><b style="color:#8a6d1b;">Revolving Fund still holds '+peso(petty)+'</b><div style="font-size:.75rem;color:var(--tl);">Fold it into Undeposited Collection with one approved, audited entry to complete the retirement.</div></div><button class="pz-btn ok" id="ucRetire">Retire &amp; fold in '+peso(petty)+'</button></div></div>'):'')
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
}
function doRetire(){
  var a=A();if(!a.retireRevolvingFund||!a.managerApproval){alert('Retirement service is unavailable. Refresh the portal.');return;}
  a.retireRevolvingFund({preview:true}).then(function(r){
    var bal=Number(r&&r.balance)||0;
    if(!(bal>0.01)){alert('The Revolving Fund balance is already zero — nothing to retire.');return;}
    if(!confirm('Fold the Revolving Fund balance of '+peso(bal)+' into Undeposited Collection?\n\nThis posts one approved, audited journal entry and cannot be undone without a reversing entry.'))return;
    a.managerApproval('retire_revolving_fund','revolvingFund',bal,'Retire Revolving Fund — fold into Undeposited Collection').then(function(ap){
      return a.retireRevolvingFund({approvalId:ap.approvalId});
    }).then(function(res){
      if(res&&res.retired){alert('Revolving Fund retired. '+peso(res.amount)+' folded into Undeposited Collection.');if(window.__posLog)window.__posLog('revolving-fund-retire','',peso(res.amount));}
      else alert('No change: '+((res&&res.reason)||'the fund was already retired.'));
    }).catch(function(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Retirement failed: '+((e&&e.message)||e));});
  }).catch(function(e){alert('Could not read the Revolving Fund balance: '+((e&&e.message)||e));});
}
window.__accazaRegisterModule('undeposited',function(name){if(name==='undeposited')renderUndeposited();});
})();
