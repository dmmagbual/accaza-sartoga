(function(){
'use strict';
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
function pad(n){return(n<10?'0':'')+n;}
function todayStr(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function chLbl(c){return c==='grabfood'?'GrabFood':c==='foodpanda'?'FoodPanda':c;}
var accountsMap={},ledgerMap={},financialMovementsMap={},chartMap={},custodyMap={},arMap={},apMap={},payoutsMapCF={},ordersMapCF={},archMapCF={},financialAudit=null,registerFloatAmount=4000;
var cashBalanceRefresh=null;
var cfFrom=null,cfTo=null,cfAcctFilter='all';
var CF_CATS=['Sales deposit','Platform payout','Purchases','Supplier payment','Rent','Utilities','Salaries','Owner draw','Capital in','Bank charges','AR collection','AP payment','Transfer','Other'];
var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){var a=A();
  a.subscribe('cfAccounts',function(s){accountsMap=s.val()||{};if(isTab('cashflow'))renderCashflow();if(isTab('receivables'))renderReceivables();if(isTab('payables'))renderPayables();});
  a.subscribe('cfLedger',function(s){ledgerMap=s.val()||{};if(isTab('cashflow'))renderCashflow();});
  a.subscribe('financialMovements',function(s){financialMovementsMap=Object.assign({},financialMovementsMap,s.val()||{});if(isTab('cashflow'))renderCashflow();if(isTab('purchases'))window.dispatchEvent(new CustomEvent('accaza:cash-balances-updated'));});
  a.subscribe('chartOfAccounts',function(s){chartMap=s.val()||{};if(isTab('cashflow'))renderCashflow();});
  a.subscribe('cashCustody',function(s){custodyMap=s.val()||{};if(isTab('cashflow'))renderCashflow();});
  a.subscribe('receivables',function(s){arMap=s.val()||{};if(isTab('receivables'))renderReceivables();});
  a.subscribe('payables',function(s){apMap=s.val()||{};if(isTab('payables'))renderPayables();});
  a.subscribe('platformPayouts',function(s){payoutsMapCF=s.val()||{};if(isTab('cashflow'))renderCashflow();});
  a.subscribe('orders',function(s){ordersMapCF=s.val()||{};if(isTab('receivables'))renderReceivables();if(isTab('cashflow'))renderCashflow();});
  a.subscribe('archivedOrders',function(s){archMapCF=s.val()||{};if(isTab('receivables'))renderReceivables();});
  refreshCashBalances();
}
function refreshCashBalances(forceAfterCurrent){var a=A();if(cashBalanceRefresh)return forceAfterCurrent?cashBalanceRefresh.then(function(){return refreshCashBalances(false);}):cashBalanceRefresh;if(!a||!a.get||!a.ref||!a.db)return Promise.resolve(false);cashBalanceRefresh=Promise.all([a.get(a.ref(a.db,'financialMovements')),a.get(a.ref(a.db,'posSettings/fixedFloat')),a.get(a.ref(a.db,'posActiveShift'))]).then(function(rows){financialMovementsMap=rows[0].val()||{};var configured=Number(rows[1].val()),shift=rows[2].val()||{},retained=shift.retainedFloat!=null?Number(shift.retainedFloat):Number(shift.openingFloat);registerFloatAmount=Math.round(((configured>0?configured:retained>0?retained:4000))*100)/100;window.dispatchEvent(new CustomEvent('accaza:cash-balances-updated'));return true;}).catch(function(e){console.error('Could not refresh current Finance Books cash balances',e);return false;}).finally(function(){cashBalanceRefresh=null;});return cashBalanceRefresh;}
window.__accazaRegisterModule('finance',function(tab){if(tab==='purchases')refreshCashBalances();});
function accList(){return Object.keys(accountsMap).map(function(k){return Object.assign({id:k},accountsMap[k]);}).sort(function(a,b){return (a.order||0)-(b.order||0)||(a.name||'').localeCompare(b.name||'');});}
function acctName(id){return (accountsMap[id]&&accountsMap[id].name)||'—';}
function ledgerArr(){return Object.keys(ledgerMap).map(function(k){return Object.assign({id:k},ledgerMap[k]);});}
function financialMovementArr(){return Object.keys(financialMovementsMap).map(function(k){return Object.assign({id:k},financialMovementsMap[k]);}).sort(function(a,b){return (b.occurredAt||0)-(a.occurredAt||0);});}
function chartList(){return Object.keys(chartMap).map(function(k){return Object.assign({id:k},chartMap[k]);}).sort(function(a,b){return String(a.code||'').localeCompare(String(b.code||''));});}
function custodyList(){return Object.keys(custodyMap).map(function(k){return Object.assign({id:k},custodyMap[k]);}).filter(function(x){return Number(x.remaining)>0;}).sort(function(a,b){return (a.closedAt||0)-(b.closedAt||0);});}
function acctBalance(id){var b=Number((accountsMap[id]||{}).opening)||0;ledgerArr().forEach(function(e){if(e.accountId!==id)return;b+=(e.dir==='in'?1:-1)*(Number(e.amount)||0);});return Math.round(b*100)/100;}
function currentCashBalance(id){if(id==='cash_float')return registerFloatAmount;var account=id==='cash_on_hand'?'asset:register_cash':id==='undeposited'?'asset:cash_awaiting_deposit':id==='revolving'?'asset:petty_cash':'asset:cash_account:'+id,b=0;financialMovementArr().forEach(function(m){(m.lines||[]).forEach(function(l){if(l.account===account)b+=(Number(l.debit)||0)-(Number(l.credit)||0);});});if(id==='cash_on_hand')b=Math.max(0,b-registerFloatAmount);return Math.round(b*100)/100;}
function financeCommand(action,data,cb){var a=A();if(!a||!a.postFinancialCommand){alert('3C financial service is not available. Refresh the portal.');return null;}var id=(data&&data.commandId)||uid('fm_');var payload=Object.assign({},data||{},{action:action,commandId:id,actorName:(window.__posShift&&window.__posShift.staff)||'Admin'});a.postFinancialCommand(payload).then(function(r){return refreshCashBalances(true).then(function(){if(cb)cb((r&&r.data)||r||{});});}).catch(function(e){alert('Could not post: '+((e&&e.message)||(e&&e.code)||e)+'. Nothing was posted.');});return id;}
function postLedger(o,cb){return financeCommand('manual',{date:o.date,accountId:o.accountId,dir:o.dir,offsetAccountId:o.offsetAccountId,amount:o.amount,party:o.party||'',ref:o.ref||'',source:o.source||'manual',linkId:o.linkId||'',note:o.note||''},cb);}
function isCashM(m){return String(m||'').toLowerCase()==='cash';}
function methodAcct(m){var mm=String(m||'').toLowerCase();var found=null;accList().forEach(function(x){(x.feedMethods||[]).forEach(function(z){if(String(z).toLowerCase()===mm)found=x.id;});});return found;}
function orderPays(o){return (o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total}];}
function unmappedMethods(){var seen={};[ordersMapCF,archMapCF].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!o||['pos','online'].indexOf(o.source)<0||['grabfood','foodpanda'].indexOf(o.channel)>=0)return;orderPays(o).forEach(function(p){if(!isCashM(p.method)&&!methodAcct(p.method))seen[p.method]=1;});});});return Object.keys(seen);}
function dateFromTs(ts){var d=new Date(ts||Date.now());return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function cfPick(opts,cb){
  if(!accList().length&&!opts.includeCashSources){alert('Add a bank / e-wallet account first in the Cash Flow tab.');return;}
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  var cashOpts=opts.includeCashSources?'<option value="cash_on_hand">Cash on Hand ('+peso(currentCashBalance('cash_on_hand'))+')</option><option value="undeposited">Undeposited Collection ('+peso(currentCashBalance('undeposited'))+')</option>':'',accOpts=cashOpts+accList().map(function(x){return '<option value="'+x.id+'">'+esc(x.name)+' ('+peso(acctBalance(x.id))+')</option>';}).join('');
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.4rem;">'+esc(opts.title||'Post to account')+'</div>'
    +'<div style="margin-bottom:0.5rem;"><span class="pz-lbl">Account</span><select class="pz-in" id="cfpAcct">'+accOpts+'</select></div>'
    +'<div style="display:flex;gap:0.5rem;"><div style="flex:1;"><span class="pz-lbl">Date</span><input class="pz-in" id="cfpDate" type="date" value="'+todayStr()+'"/></div><div style="flex:1;"><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="cfpAmt" type="number" step="any" value="'+(opts.amount!=null?opts.amount:'')+'"/></div></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">'+esc(opts.noteLabel||'Note (optional)')+'</span><input class="pz-in" id="cfpNote" value="'+esc(opts.note||'')+'"/></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cfpOk">Confirm</button><button class="pz-btn sec" id="cfpCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  mask.querySelector('#cfpCancel').onclick=close;
  mask.querySelector('#cfpOk').onclick=function(){var acct=mask.querySelector('#cfpAcct').value;var date=mask.querySelector('#cfpDate').value||todayStr();var amt=Math.round((Number(mask.querySelector('#cfpAmt').value)||0)*100)/100;var note=mask.querySelector('#cfpNote').value||'';if(!acct){alert('Pick an account.');return;}if(!(amt>0)){alert('Enter an amount.');return;}close();cb({accountId:acct,date:date,amount:amt,note:note});};
}
function agingBucket(due){if(!due)return 'no due';var days=Math.floor((Date.now()-new Date(due+'T23:59:59').getTime())/86400000);if(days<=0)return 'current';if(days<=30)return '1–30';if(days<=60)return '31–60';return '60+';}
function platRecv(){var out={grabfood:0,foodpanda:0};[ordersMapCF,archMapCF].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!o||o.source!=='pos'||['grabfood','foodpanda'].indexOf(o.channel)<0||o.voided)return;if((o.settlementStatus||'unsettled')==='settled')return;var net=(o.netPlatform!=null)?(Number(o.netPlatform)||0):((Number(o.grossPlatform||o.subtotal||o.total)||0)-(Number(o.commission)||0)-(Number(o.platformDiscount)||0)-(Number(o.platformWht)||0)-(Number(o.platformVat)||0)-(Number(o.platformAdsMarketing)||0)-(Number(o.platformMarketingFee)||0));out[o.channel]=(out[o.channel]||0)+net;});});return out;}
function cfExport(){if(!window.XLSX){alert('Excel library still loading — try again.');return;}var led=ledgerArr().filter(function(e){var d=e.date||'';return (cfAcctFilter==='all'||e.accountId===cfAcctFilter)&&(!cfFrom||d>=cfFrom)&&(!cfTo||d<=cfTo);}).sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});var aoa=[['date','account','type','category','party','ref','in','out']];led.forEach(function(e){aoa.push([e.date||'',acctName(e.accountId),(accountsMap[e.accountId]||{}).type||'',e.category||'',e.party||'',e.ref||'',e.dir==='in'?(Number(e.amount)||0):'',e.dir==='out'?(Number(e.amount)||0):'']);});var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'CashFlow');XLSX.writeFile(wb,'accaza-cashflow-'+todayStr()+'.xlsx');}