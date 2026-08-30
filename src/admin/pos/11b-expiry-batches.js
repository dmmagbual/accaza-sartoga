/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 2: Expiry / batch dashboard ══════════
   Batches are tracked for EXPIRY + brand audit only; the WAC pool (inventory.stock) stays
   authoritative for cost/deduction. Remaining per lot is DERIVED from current stock, consumed
   first-expiry-first-out (FEFO) — always consistent with the pool, no stored depletion to drift. */
function batchExpiryStatus(expiry,today){ if(!expiry)return {k:'none',lbl:'no expiry',col:'var(--tl)'}; if(expiry<today)return {k:'exp',lbl:'EXPIRED',col:'#c0392b'}; var d=new Date(expiry)-new Date(today); var days=Math.round(d/86400000); if(days<=7)return {k:'soon',lbl:days+'d left',col:'#c98a2b'}; return {k:'ok',lbl:days+'d left',col:'#2a7'}; }
function deriveBatchRemaining(batches,stock){ /* batches: non-closed lots for ONE item */
  var order=batches.slice().sort(function(a,b){ var ea=a.expiry||'9999-99-99', eb=b.expiry||'9999-99-99'; if(ea!==eb)return ea<eb?-1:1; return (a.recvDate||'')<(b.recvDate||'')?-1:1; });
  var R=0; order.forEach(function(b){R+=Number(b.qtyRecv)||0;});
  var consumed=Math.max(0,R-(Number(stock)||0)); var rem={};
  order.forEach(function(b){ var q=Number(b.qtyRecv)||0; var take=Math.min(q,consumed); consumed-=take; rem[b.id]=Math.round((q-take)*100000)/100000; });
  return {rem:rem,untracked:Math.max(0,Math.round(((Number(stock)||0)-R)*100000)/100000)};
}
function openExpiryView(){
  var a=A(); var today=window.AccazaDate.key();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">📅 Expiry / batches</div><p class="pz-sub">Loading batches…</p></div>';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function load(){ a.get(a.ref(a.db,'inventoryBatch')).then(function(s){ draw(s.val()||{}); }).catch(function(e){ mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Could not load</div><p class="pz-sub">'+esc((e&&e.code)||String(e))+'</p><button class="pz-btn sec" id="xpErrX">Close</button></div>'; var b=document.getElementById('xpErrX'); if(b)b.onclick=close; }); }
  function draw(allB){
    var byItem={}; Object.keys(allB).forEach(function(k){ var b=Object.assign({id:k},allB[k]); if(b.closed)return; (byItem[b.masterId]=byItem[b.masterId]||[]).push(b); });
    var flat=[]; var untrackedNotes=[];
    Object.keys(byItem).forEach(function(mid){ var it=inventoryMap[mid]||{name:'(deleted item)',unit:''}; var d=deriveBatchRemaining(byItem[mid],it.stock); if(d.untracked>0)untrackedNotes.push({name:it.name,unit:it.unit,qty:d.untracked}); byItem[mid].forEach(function(b){ var rem=d.rem[b.id]||0; if(rem<=0)return; flat.push({b:b,it:it,rem:rem,st:batchExpiryStatus(b.expiry,today)}); }); });
    flat.sort(function(x,y){ var ex=x.b.expiry||'9999-99-99', ey=y.b.expiry||'9999-99-99'; return ex<ey?-1:(ex>ey?1:0); });
    var nExp=flat.filter(function(r){return r.st.k==='exp';}).length, nSoon=flat.filter(function(r){return r.st.k==='soon';}).length;
    var rows=flat.map(function(r){ var b=r.b, it=r.it;
      return '<tr>'
        +'<td><b>'+esc(it.name||'')+'</b>'+(b.brand?'<div style="font-size:0.7rem;color:var(--tl);">'+esc(b.brand)+'</div>':'')+'</td>'
        +'<td style="font-size:0.8rem;">'+esc(b.lot||'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+num(r.rem)+' '+esc(it.unit||b.unit||'')+'</td>'
        +'<td style="white-space:nowrap;"><input class="pz-in" type="date" data-xpd="'+b.id+'" value="'+esc(b.expiry||'')+'" style="width:140px;"/></td>'
        +'<td style="font-size:0.8rem;font-weight:600;color:'+r.st.col+';">'+r.st.lbl+'</td>'
        +'<td style="white-space:nowrap;"><button class="pz-btn sec" data-xpsave="'+b.id+'" style="padding:0.15rem 0.5rem;">Save</button> <button class="pz-btn warn" data-xpdisc="'+b.id+'" data-xpmid="'+esc(b.masterId)+'" data-xprem="'+r.rem+'" style="padding:0.15rem 0.5rem;">Discard</button></td>'
      +'</tr>';
    }).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📅 Expiry / batches</div><button class="pz-btn sec" id="xpClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Lots sorted soonest-expiry first. Remaining is derived from current stock assuming oldest is used first — no separate count to drift. '+(nExp?'<b style="color:#c0392b;">'+nExp+' expired.</b> ':'')+(nSoon?'<b style="color:#c98a2b;">'+nSoon+' expiring ≤7 days.</b>':'')+'</p>'
      +(untrackedNotes.length?'<div style="background:#fff7e6;border:1px solid #e6c07a;border-radius:6px;padding:0.4rem 0.6rem;margin-bottom:0.5rem;font-size:0.76rem;color:#8a5a00;">Stock not yet tied to a dated batch (received before batch tracking, or via opening balance): '+untrackedNotes.map(function(u){return esc(u.name)+' '+num(u.qty)+' '+esc(u.unit||'');}).join(' · ')+'. Add expiry when you next receive these.</div>':'')
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item / brand</th><th>Lot #</th><th>Remaining</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No open batches with expiry to track. Batches are created when you receive stock (Purchases or + Stock).</td></tr>')+'</tbody></table></div>'
      +'<div style="font-size:0.7rem;color:var(--tl);margin-top:0.5rem;">“Discard” posts a wastage adjustment for that lot’s remaining (reduces stock + COGS variance) and closes the lot. Editing expiry only updates the batch record — it doesn’t change stock or cost.</div>'
      +'</div>';
    document.getElementById('xpClose').onclick=close;
    mask.querySelectorAll('[data-xpsave]').forEach(function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-xpsave'); var inp=mask.querySelector('[data-xpd="'+bid+'"]'); a.update(a.ref(a.db,'inventoryBatch/'+bid),{expiry:inp?inp.value:'',updatedAt:Date.now()}).then(load).catch(function(e){alert('Could not save expiry: '+((e&&e.code)||e));}); }; });
    mask.querySelectorAll('[data-xpdisc]').forEach(function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-xpdisc'); var mid=btn.getAttribute('data-xpmid'); var rem=Number(btn.getAttribute('data-xprem'))||0; var it=inventoryMap[mid]||{}; if(!confirm('Discard '+num(rem)+' '+(it.unit||'')+' of '+(it.name||'this item')+' as wastage? This reduces stock and posts a COGS variance.'))return; a.update(a.ref(a.db,'inventoryBatch/'+bid),{closed:true,qtyRemaining:0,closedAt:Date.now(),closedReason:'wastage'}).then(function(){ if(typeof finalizeAdjust==='function')finalizeAdjust(mid,Number(it.stock)||0,-rem,'wastage'); setTimeout(load,300); }).catch(function(e){alert('Could not discard: '+((e&&e.code)||e));}); }; });
  }
  load();
}
