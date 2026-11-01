
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
function makeChangeD(amount,avail){if(window.AccazaCashChange)return window.AccazaCashChange.plan(amount,avail||{});var rem=Math.round(amount*100);var give={};DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
// A drawer change is written inside a transaction, the same way the server applies a sale, so a sale
// syncing at the same moment is added to, never overwritten. Shift record first, then the live copy
// the till reads. A change that would take any count below zero is refused: the server rejects every
// later sale touching a negative count. Recount (abs) replaces the count outright. Nothing local
// changes until the shift record has committed.
function saveDrawer(nd,abs){if(!activeShift)return Promise.resolve(false);var a=A(),id=activeShift.id,delta=subD(nd,drawerNow()),keys=Object.keys(delta).filter(function(k){return delta[k];});
  function fail(m){alert('The drawer count was not saved: '+m+' Nothing was changed.');return false;}
  if(window.__online===false)return Promise.resolve(fail('this device is offline. Reconnect and try again.'));
  if(!abs&&!keys.length)return Promise.resolve(true);
  function next(cur){var o=Object.assign({},cur||{});if(abs){DENOMS.forEach(function(d){o[d.k]=Math.max(0,Math.floor(Number(nd[d.k])||0));});return o;}for(var i=0;i<keys.length;i++){var v=(Number(o[keys[i]])||0)+delta[keys[i]];if(v<0)return;o[keys[i]]=v;}return o;}
  return a.runTransaction(a.ref(a.db,'shifts/'+id+'/drawer'),next).then(function(r){if(!r||!r.committed)return fail('the POS count no longer holds those notes or coins. Recount the drawer.');var saved=r.snapshot.val()||{};
    // Live copy: rules refuse it unless that shift is still the open one; if it disagrees so badly the
    // change cannot apply, it is brought in line with the shift record instead.
    if(!window.__posShift||window.__posShift.id!==id)return true;
    return a.runTransaction(a.ref(a.db,'posActiveShift/drawer'),function(cur){var n=next(cur);return n===undefined?saved:n;}).then(function(m){if(activeShift&&activeShift.id===id&&m&&m.committed)activeShift.drawer=Object.assign({},m.snapshot.val()||{});return true;});
  }).catch(function(e){return fail(((e&&e.message)||String(e))+'.');});}
function drawerShortOf(out){var have=drawerNow();return DENOMS.filter(function(d){return (Number(out[d.k])||0)>(Number(have[d.k])||0);}).map(function(d){return (Number(have[d.k])||0)+' × '+d.lbl;});}
function cashSwap(done){
  if(!activeShift)return alert('There is no open shift.');
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
  mask.querySelector('#swOk').onclick=function(){var btn=this;if(btn.disabled)return;var o=denomRead('swOut'),i=denomRead('swIn');if(o.total<=0){alert('Enter what you took out of the drawer.');return;}if(Math.abs(i.total-o.total)>0.001){alert('The swap must be net-zero — total OUT must equal total IN.');return;}
    var lack=drawerShortOf(o.counts);if(lack.length){alert('The POS count shows only '+lack.join(', ')+' in the drawer. If the drawer really holds more, close this and use 🧮 Recount drawer instead.');return;}
    var shiftId=activeShift.id,ts=Date.now(),nd=mergeD(subD(drawerNow(),o.counts),i.counts);btn.disabled=true;
    saveDrawer(nd).then(function(ok){if(!ok){btn.disabled=false;return;}var a=A();Promise.resolve(a.update(a.ref(a.db,'shifts/'+shiftId+'/cashSwaps/'+ts),{out:o.counts,in:i.counts,amount:o.total,ts:ts,by:activeShift?activeShift.staff||'':''})).catch(function(){alert('The drawer mix was updated, but the swap record was not saved. Tell the manager.');});
      if(window.__posLog)window.__posLog('cash-swap',shiftId,peso(o.total)+' broken');
      close(); alert('Swap recorded — drawer mix updated, total unchanged.'); if(done)done();});
  };
}
/* Recount drawer (1 Nov 2026, Danilo): when the POS note/coin count no longer matches the drawer
   (a bill broken without recording it, change handed over differently), the cashier counts every
   note and coin and that count replaces the POS count. Only the mix the POS uses to suggest change
   is corrected: expected cash is still worked out from sales and any variance is still settled at
   the Z count. Sales waiting to sync are blocked first, because their notes are already in the
   drawer and would otherwise be added a second time when they arrive. */
function drawerRecount(done,held){
  if(!activeShift)return alert('There is no open shift.');
  if(window.__online===false)return alert('Reconnect before recounting the drawer.');
  var q=window.__posOfflineState&&window.__posOfflineState(),wait=q?(Number(q.pending)||0)+(Number(q.syncing)||0):0,failed=q?Number(q.failed)||0:0;
  if(wait)return alert(wait+' sale(s) on this device are still waiting to sync. Recount after they sync, so their cash is not counted twice.');
  if(failed&&!confirm(failed+' sale(s) on this device failed to sync. Their cash is in the drawer; if a manager recovers them later it will be added again. Recount anyway?'))return;
  held=held||{};var heldTotal=Math.round(DENOMS.reduce(function(t,d){return t+(Number(held[d.k])||0)*d.v;},0)*100)/100;
  var before=drawerNow(),beforeTotal=Math.round(DENOMS.reduce(function(t,d){return t+(Number(before[d.k])||0)*d.v;},0)*100)/100;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){if(mask.parentNode)document.body.removeChild(mask);}
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">🧮 Recount drawer</div>'
    +'<p class="pz-sub" style="margin-top:0.2rem;">Count every note and coin in the drawer now. Your count replaces the POS count used to suggest change. It does not post anything; any cash difference is settled at the Z count as usual. Make sure no other till has sales waiting to sync.</p>'
    +(heldTotal>0?'<div style="font-size:0.8rem;margin:0.3rem 0;padding:0.4rem 0.55rem;background:#fff6e5;border:1px solid #f0dcae;border-radius:6px;">Leave out the customer\'s '+peso(heldTotal)+' for the sale you are charging — it is added when you charge. <label style="display:block;margin-top:0.25rem;"><input type="checkbox" id="rcDrHeld"/> It is already in the drawer and in my count</label></div>':'')
    +'<div style="font-size:0.8rem;margin:0.3rem 0 0.5rem;">POS count now: <b>'+peso(beforeTotal)+'</b></div>'
    +denomGridHtml('rcDr')+'<div id="rcDrDiff" style="font-weight:700;margin-top:0.4rem;text-align:right;"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rcDrOk">Save count</button><button class="pz-btn sec" id="rcDrC">Cancel</button></div></div>';
  wireDenom('rcDr');
  function counted(){var c=denomRead('rcDr'),hc=document.getElementById('rcDrHeld'),out={},bad=[];DENOMS.forEach(function(d){var v=Number(c.counts[d.k])||0;if(hc&&hc.checked)v-=Number(held[d.k])||0;if(v<0)bad.push(d.lbl);out[d.k]=v;});return {counts:out,total:Math.round(DENOMS.reduce(function(t,d){return t+out[d.k]*d.v;},0)*100)/100,raw:c.counts,bad:bad};}
  function diff(){var c=counted(),d=Math.round((c.total-beforeTotal)*100)/100,el=document.getElementById('rcDrDiff');if(el)el.innerHTML=Math.abs(d)<0.001?'<span style="color:#155724;">Same total as the POS count</span>':'<span style="color:#b9770e;">'+(d>0?'+':'')+peso(d)+' against the POS count</span>';}
  mask.querySelectorAll('[data-dp="rcDr"],#rcDrHeld').forEach(function(inp){inp.addEventListener('input',diff);inp.addEventListener('change',diff);});diff();
  mask.querySelector('#rcDrC').onclick=close;
  mask.querySelector('#rcDrOk').onclick=function(){var btn=this;if(btn.disabled)return;var c=counted();
    if(Object.keys(c.raw).some(function(k){return !(c.raw[k]>0)||Math.floor(c.raw[k])!==c.raw[k];}))return alert('Counts must be whole numbers of notes or coins.');
    if(c.bad.length)return alert('Your count has fewer '+c.bad.join(', ')+' than the customer\'s cash you said is in the drawer. Check the count.');
    if(!(c.total>0)&&!confirm('Save the drawer as empty?'))return;
    var now=drawerNow(),nowTotal=Math.round(DENOMS.reduce(function(t,d){return t+(Number(now[d.k])||0)*d.v;},0)*100)/100,d=Math.round((c.total-nowTotal)*100)/100,shiftId=activeShift.id;
    if(Math.abs(d)>=0.01&&!confirm('Your count is '+peso(c.total)+', '+(d>0?'more':'less')+' than the POS count by '+peso(Math.abs(d))+'. Save it? The difference is not posted; it shows at the Z count.'))return;
    btn.disabled=true;var a=A(),ts=Date.now();
    saveDrawer(c.counts,true).then(function(ok){if(!ok){btn.disabled=false;return;}
      Promise.resolve(a.update(a.ref(a.db,'shifts/'+shiftId+'/drawerRecounts/'+ts),{before:now,after:c.counts,beforeTotal:nowTotal,afterTotal:c.total,difference:d,heldExcluded:heldTotal>0&&!!(document.getElementById('rcDrHeld')||{}).checked,ts:ts,by:activeShift?activeShift.staff||'':'',byUid:(a.currentUser&&a.currentUser.uid)||''})).catch(function(){alert('The drawer count was saved, but its audit record was not. Tell the manager.');});
      if(window.__posLog)window.__posLog('drawer-recount',shiftId,peso(c.total)+' counted · '+(d>0?'+':'')+peso(d)+' vs POS count');
      close();alert('Drawer count saved.');if(done)done();});
  };
}
window.__posCashSwap=function(done){if(!denomTrackingOnR())return;cashSwap(done);};
window.__posDrawerRecount=function(done,held){if(!denomTrackingOnR())return;drawerRecount(done,held);};

