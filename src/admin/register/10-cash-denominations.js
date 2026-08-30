
/* ---------- denomination cash counting ---------- */
var DENOMS=[
  {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
  {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
];
function denomGridHtml(prefix){
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.4rem;">'
    +DENOMS.map(function(d){return '<label style="font-size:0.75rem;color:var(--tm);display:flex;flex-direction:column;gap:0.15rem;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-dp="'+prefix+'" data-dv="'+d.v+'" data-dk="'+d.k+'" placeholder="0"/></label>';}).join('')
    +'</div><div style="text-align:right;font-weight:700;margin-top:0.5rem;">Counted total: <span id="'+prefix+'_total">₱0.00</span></div>';
}
function wireDenom(prefix){
  function recalc(){var t=0;document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){t+=(Number(inp.value)||0)*(Number(inp.getAttribute('data-dv'))||0);});var el=document.getElementById(prefix+'_total');if(el)el.textContent=peso(t);}
  document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){inp.oninput=recalc;});
  recalc();
}
function denomRead(prefix){
  var counts={},total=0;
  document.querySelectorAll('[data-dp="'+prefix+'"]').forEach(function(inp){var q=Number(inp.value)||0;if(q){counts[inp.getAttribute('data-dk')]=q;total+=q*(Number(inp.getAttribute('data-dv'))||0);}});
  return {counts:counts,total:total};
}
function denomBreakdownRows(counts){
  if(!counts)return '';
  return DENOMS.filter(function(d){return counts[d.k];}).map(function(d){return '<tr><td>'+d.lbl+' × '+counts[d.k]+'</td><td style="text-align:right;">'+peso(d.v*counts[d.k])+'</td></tr>';}).join('');
}
function denomTrackingOnR(){return !!(window.__posSettings&&window.__posSettings.denomTracking);}
function reconcileTotalOnlyR(){return !!(window.__posSettings&&window.__posSettings.reconcileTotalOnly);}
function drawerNow(){return (activeShift&&activeShift.drawer)?Object.assign({},activeShift.drawer):{};}
function mergeD(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)+(Number(b[k])||0);});return o;}
function subD(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)-(Number(b[k])||0);});return o;}
function makeChangeD(amount,avail){var rem=Math.round(amount*100);var give={};DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
function saveDrawer(nd){if(!activeShift)return;var a=A();a.update(a.ref(a.db,'shifts/'+activeShift.id),{drawer:nd});a.update(a.ref(a.db,'posActiveShift'),{drawer:nd});}
function cashSwap(){
  if(!activeShift)return;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">🔁 Break a bill / cash swap</div>'
    +'<p class="pz-sub" style="margin-top:0.2rem;">A net-zero exchange — the total taken OUT must equal the total put IN. This only changes the mix of notes/coins in the drawer, not the total.</p>'
    +'<div style="font-weight:600;color:var(--bd);margin:0.4rem 0 0.3rem;">Take OUT of drawer</div>'+denomGridHtml('swOut')
    +'<div style="font-weight:600;color:var(--bd);margin:0.8rem 0 0.3rem;">Put IN to drawer</div>'+denomGridHtml('swIn')
    +'<div id="swBal" style="font-weight:700;margin-top:0.6rem;"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="swOk">Confirm swap</button><button class="pz-btn sec" id="swC">Cancel</button></div></div>';
  function recalcBal(){var o=denomRead('swOut'),i=denomRead('swIn');var bal=Math.round((i.total-o.total)*100)/100;var el=document.getElementById('swBal');if(!el)return;el.innerHTML='Out '+peso(o.total)+' · In '+peso(i.total)+' — '+(Math.abs(bal)<0.001?(o.total>0?'<span style="color:#155724;">✓ balanced</span>':'<span style="color:var(--tl);">enter the swap</span>'):'<span style="color:#c0392b;">off by '+peso(bal)+'</span>');}
  wireDenom('swOut'); wireDenom('swIn');
  mask.querySelectorAll('[data-dp="swOut"],[data-dp="swIn"]').forEach(function(inp){inp.addEventListener('input',recalcBal);});
  recalcBal();
  mask.querySelector('#swC').onclick=close;
  mask.querySelector('#swOk').onclick=function(){var o=denomRead('swOut'),i=denomRead('swIn');if(o.total<=0){alert('Enter what you took out of the drawer.');return;}if(Math.abs(i.total-o.total)>0.001){alert('The swap must be net-zero — total OUT must equal total IN.');return;}
    var nd=mergeD(subD(drawerNow(),o.counts),i.counts); saveDrawer(nd);
    var a=A();var swaps=(activeShift.cashSwaps||[]).slice();swaps.push({out:o.counts,in:i.counts,amount:o.total,ts:Date.now(),by:activeShift.staff||''});a.update(a.ref(a.db,'shifts/'+activeShift.id),{cashSwaps:swaps});
    if(window.__posLog)window.__posLog('cash-swap',activeShift.id,peso(o.total)+' broken');
    close(); alert('Swap recorded — drawer mix updated, total unchanged.');
  };
}