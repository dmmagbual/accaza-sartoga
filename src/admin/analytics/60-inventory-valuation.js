
/* ══════════ STOCK VALUE / STOCK CARD ══════════ */
function svRange(){var f=svFrom,t=svTo;if(!f&&!t){var d=new Date();f=new Date(d.getFullYear(),d.getMonth(),1);f=f.getFullYear()+'-'+pad(f.getMonth()+1)+'-'+pad(f.getDate());t=new Date();t=t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate());}return {f:f||'',t:t||''};}
function fq(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function invItems(){return Object.keys(invMap).map(function(k){return Object.assign({id:k},invMap[k]);}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});}
function tsToDate(ts){var d=new Date(ts||0);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function inRng(d,rng){return (!rng.f||d>=rng.f)&&(!rng.t||d<=rng.t);}
function itemPeriod(id,cost,rng){var pQ=0,pV=0,uQ=0;
  Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r||r.ing!==id)return;var d=r.date||tsToDate(r.ts);if(inRng(d,rng)){pQ+=Number(r.qty)||0;pV+=Number(r.total)||0;}});
  [ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o)||!o.inventoryUsage||!o.inventoryUsage[id])return;var d=tsToDate(o.timestamp||Date.parse(o.date)||0);if(inRng(d,rng))uQ+=Number(o.inventoryUsage[id])||0;});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed||!u.usage||!u.usage[id])return;var d=tsToDate(u.ts);if(inRng(d,rng))uQ+=Number(u.usage[id])||0;});
  return {pQ:pQ,pV:pV,uQ:uQ,uV:uQ*(Number(cost)||0)};
}
function itemMovements(id){
  var cost=Number((invMap[id]||{}).cost)||0;var out=[];
  Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r||r.ing!==id)return;out.push({ts:r.ts||Date.parse(r.date)||0,date:r.date||tsToDate(r.ts),type:'Purchase'+(r.supplier?' · '+r.supplier:'')+(r.brand?' · '+r.brand:''),in:Number(r.qty)||0,out:0});});
  Object.keys(adjMap).forEach(function(k){var x=adjMap[k];if(!x||x.ing!==id)return;var dl=Number(x.delta)||0;out.push({ts:x.ts||0,date:tsToDate(x.ts),type:'Adjust · '+(x.reason||''),in:dl>0?dl:0,out:dl<0?-dl:0});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed||!u.usage||!u.usage[id])return;out.push({ts:u.ts||0,date:tsToDate(u.ts),type:'Usage · '+(u.kindName||u.kind||''),in:0,out:Number(u.usage[id])||0});});
  var byDay={};[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o)||!o.inventoryUsage||!o.inventoryUsage[id])return;var day=tsToDate(o.timestamp||Date.parse(o.date)||0);byDay[day]=(byDay[day]||0)+(Number(o.inventoryUsage[id])||0);});});
  Object.keys(byDay).forEach(function(day){out.push({ts:new Date(day+'T12:00:00').getTime(),date:day,type:'Sales usage',in:0,out:byDay[day]});});
  out.sort(function(a,b){return (a.ts||0)-(b.ts||0);});return out;
}
function roundQty(n){return Math.round((Number(n)||0)*1000)/1000;}
function isWasteMovement(m){return /waste|wastage|spoil|expired|damage|variance|shrink|adjust/i.test(String(m.type||''));}
function itemReconciliation(id,rng){
  var movements=itemMovements(id);var current=Number((invMap[id]||{}).stock)||0;
  var fromTs=rng.f?localDateValue(rng.f):-Infinity;var toTs=rng.t?addDays(localDateValue(rng.t),1):Infinity;
  var ending=current;
  movements.forEach(function(m){if((Number(m.ts)||0)>=toTs)ending-=((Number(m.in)||0)-(Number(m.out)||0));});
  var received=0,issued=0,adjustment=0;
  movements.forEach(function(m){var ts=Number(m.ts)||0;if(ts<fromTs||ts>=toTs)return;
    if(/^Purchase/i.test(m.type||''))received+=Number(m.in)||0;
    else if(isWasteMovement(m))adjustment+=(Number(m.in)||0)-(Number(m.out)||0);
    else issued+=Number(m.out)||0;
  });
  ending=roundQty(ending);received=roundQty(received);issued=roundQty(issued);adjustment=roundQty(adjustment);
  return {beginning:roundQty(ending-received+issued-adjustment),received:received,issued:issued,adjustment:adjustment,ending:ending};
}
function signedQty(n){n=roundQty(n);return n?(n>0?'+':'')+fq(n):'—';}
function inventoryBooksReconciliation(summaries,rng){
  var itemRows=summaries.map(function(x){return{id:x.item.id,name:x.item.name,inventoryAccount:x.item.inventoryAccount,quantity:x.flow.ending,unitCost:Number(x.item.cost)||0};});
  var journal=Object.keys(inventoryBooksJournal).map(function(k){return Object.assign({id:k},inventoryBooksJournal[k]||{});});
  return reconcileInventoryBooks(itemRows,journal,rng.t||'9999-12-31');
}
function inventoryReconciliationHtml(recon,ready,history){
  if(!ready)return '<div class="pz-card" style="margin-bottom:0.8rem;border-left:4px solid #b08d57;"><b>Inventory-to-Books reconciliation</b><div class="az-note" style="margin-top:0.35rem;">Preparing the authoritative Finance Books journal… No partial balance is presented as final.</div></div>';
  var roundingOnly=recon.balanced&&Math.abs(recon.totals.difference)>=0.005,status=recon.balanced?'<span style="color:#267354;">✓ Reconciled'+(roundingOnly?' · within ₱0.01 rounding tolerance':'')+'</span>':'<span style="color:#b44336;">⚠ Not reconciled</span>';
  var rows=recon.rows.map(function(r){var diff=r.difference,within=r.withinTolerance===true,meaning=Math.abs(diff)<0.005?'Balanced':(within?'Within rounding tolerance':(diff>0?'Stock valuation is higher':'Books balance is higher'));return '<tr><td><b>'+esc(r.code)+'</b> · '+esc(r.name)+'</td><td class="r">'+r.itemCount+'</td><td class="r">'+peso(r.stockValue)+'</td><td class="r">'+peso(r.booksValue)+'</td><td class="r" style="font-weight:700;color:'+(within?'#267354':'#b44336')+';">'+peso(diff)+'</td><td>'+meaning+'</td></tr>';}).join('');
  var action=!recon.balanced&&recon.unmappedCount===0&&Math.abs(recon.clearingBalance)<.005?'<div style="margin-top:.75rem;"><button class="pz-btn" id="inventoryAutoAdjustBtn">Auto-adjust inventory variance</button><div class="az-note" style="margin-top:.35rem;">One controlled action aligns Finance Books to the verified Admin stock value by account. It never changes quantities or opening balance, and creates one dated, traceable gain/loss adjustment.</div></div>':'';
  return '<div class="pz-card" style="margin-bottom:0.8rem;"><div style="display:flex;justify-content:space-between;gap:0.6rem;flex-wrap:wrap;"><div><b>Inventory-to-Books reconciliation</b><div class="az-note">As of the selected To date · Difference = stock-item valuation − Finance Books balance.</div></div><div style="font-weight:700;">'+status+'</div></div><div style="overflow-x:auto;margin-top:0.7rem;"><table class="pz-tbl"><thead><tr><th>Inventory account</th><th class="r">Items</th><th class="r">Stock valuation</th><th class="r">Books balance</th><th class="r">Difference</th><th>Meaning</th></tr></thead><tbody>'+rows+'<tr style="font-weight:700;"><td>TOTAL</td><td></td><td class="r">'+peso(recon.totals.stockValue)+'</td><td class="r">'+peso(recon.totals.booksValue)+'</td><td class="r">'+peso(recon.totals.difference)+'</td><td>'+(recon.balanced?'Balanced':'Requires reconciliation')+'</td></tr></tbody></table></div><div class="az-note" style="margin-top:0.65rem;">Positive difference means stock valuation exceeds Books and needs an inventory debit or source repair. Negative difference means Books exceeds physical stock. Unmapped items: '+recon.unmappedCount+' · Receiving clearing 1290: '+peso(recon.clearingBalance)+'.</div>'+action+'</div>';
}
function postInventoryOpeningBalance(rng,btn){
  if(rng.t!==tsToDate(Date.now())){alert('Set the To date to today before posting the current opening inventory balance.');return;}
  var commandId=uid('invopen_');btn.disabled=true;btn.textContent='Preparing server preview\u2026';
  A().postFinancialCommand({action:'inventory_opening_balance',commandId:commandId,preview:true,date:rng.t}).then(function(r){r=r&&r.data?r.data:r||{};
    var reposting=!!r.alreadyPosted;
    var active=(r.rows||[]).filter(function(x){return Math.abs(Number(x.difference)||0)>=.005;}),
        detail=active.map(function(x){return x.code+' '+(x.difference>0?'Debit ':'Credit ')+peso(Math.abs(x.difference));}).join('\n'),
        offset=(r.totalDifference>=0?'Credit ':'Debit ')+peso(Math.abs(r.totalDifference));
    var message=(reposting?'RE-POST opening inventory balance? This reverses the prior opening and posts a clean one so Books match physical stock.':'Post the ONE-TIME opening inventory balance?')
      +'\n\nStock value: '+peso(r.totalStock)+'\nBooks before: '+peso(r.totalBooks)+'\nNet adjustment: '+peso(r.totalDifference)+'\n\n'+detail+'\n3900/Opening equity '+offset;
    if(!confirm(message)){btn.disabled=false;btn.textContent='Post / re-post opening inventory balance';return null;}
    btn.textContent=reposting?'Re-posting\u2026':'Posting\u2026';
    var payload=reposting?{action:'inventory_opening_balance_repost',commandId:commandId,date:rng.t}:{action:'inventory_opening_balance',commandId:commandId,date:rng.t,expectedDifference:r.totalDifference};
    return A().postFinancialCommand(payload);
  }).then(function(r){if(!r)return;r=r&&r.data?r.data:r||{};alert('Opening inventory balance '+(r.reposted?'re-posted':'posted')+'.\nAdjustment: '+peso(r.adjustment)+'\nMovement: '+r.movementId+'\n\nFinance Books will refresh automatically.');}).catch(function(e){alert('Opening inventory balance was not posted: '+((e&&e.message)||(e&&e.code)||e));btn.disabled=false;btn.textContent='Post / re-post opening inventory balance';});
}
function autoAdjustInventoryReconciliation(rng,btn){
  if(rng.t!==tsToDate(Date.now())){alert('Set the To date to today before auto-adjusting the current inventory reconciliation.');return;}
  var commandId=uid('invrecon_');btn.disabled=true;btn.textContent='Checking current variance…';
  A().postFinancialCommand({action:'inventory_reconciliation_adjustment',commandId:commandId,preview:true,date:rng.t}).then(function(r){r=r&&r.data?r.data:r||{};
    var active=(r.adjustmentRows||[]).filter(function(x){return Math.abs(Number(x.difference)||0)>=.005;}),legacyGain=Math.abs(Number(r.legacyGainBalance)||0);
    if(!active.length&&legacyGain<.005){alert('Inventory and Finance Books are already reconciled.');return null;}
    var detail=active.map(function(x){return x.code+' '+(x.difference>0?'increase ':'decrease ')+peso(Math.abs(x.difference));}).join('\n');
    if(legacyGain>=.005)detail+=(detail?'\n':'')+'Consolidate legacy 4995 into 5905 '+peso(legacyGain);
    if(!confirm('Auto-adjust this inventory variance?\n\n'+detail+'\n\nThis does not change stock quantity or opening balance. It posts one dated Finance adjustment with a permanent audit reference.'))return null;
    btn.textContent='Auto-adjusting…';return A().postFinancialCommand({action:'inventory_reconciliation_adjustment',commandId:commandId,date:rng.t,expectedFingerprint:r.fingerprint});
  }).then(function(r){if(!r){btn.disabled=false;btn.textContent='Auto-adjust inventory variance';return;}r=r&&r.data?r.data:r||{};alert((r.duplicate?'Existing':'New')+' inventory reconciliation adjustment recorded.\nMovement: '+r.movementId+'\n\nFinance Books will refresh automatically.');}).catch(function(e){alert('Inventory variance was not auto-adjusted: '+((e&&e.message)||(e&&e.code)||e));btn.disabled=false;btn.textContent='Auto-adjust inventory variance';});
}
function renderStockValue(){
  var root=document.getElementById('stockValueRoot');if(!root)return;
  var rng=svRange();var items=invItems();
  var summaries=items.map(function(i){return {item:i,flow:itemReconciliation(i.id,rng)};});
  var history={loaded:Object.keys(inventoryBooksJournal).length,hasOlder:false};
  var reconReady=inventoryBooksLoaded;
  var recon=reconReady?inventoryBooksReconciliation(summaries,rng):null;
  var totalValue=summaries.reduce(function(s,x){return s+x.flow.ending*(Number(x.item.cost)||0);},0);
  var periodPurch=0;Object.keys(receiptsMap).forEach(function(k){var r=receiptsMap[k];if(!r)return;var d=r.date||tsToDate(r.ts);if(inRng(d,rng))periodPurch+=Number(r.total)||0;});
  var periodUse=0;[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(!isSale(o))return;var d=tsToDate(o.timestamp||Date.parse(o.date)||0);if(inRng(d,rng))periodUse+=Number(o.cogsSnapshot)||0;});});
  Object.keys(usageMap).forEach(function(k){var u=usageMap[k];if(!u||u.reversed)return;var d=tsToDate(u.ts);if(inRng(d,rng))periodUse+=Number(u.cost)||0;});
  var rows=summaries.map(function(x){var i=x.item,f=x.flow,cost=Number(i.cost)||0,val=f.ending*cost,unit=esc(i.unit||'');
    return '<tr><td><b>'+esc(i.name)+'</b><div class="az-note">'+unit+'</div></td><td class="r">'+fq(f.beginning)+'</td><td class="r" style="color:#267354;font-weight:600;">'+(f.received?fq(f.received):'—')+'</td><td class="r" style="color:#b44336;font-weight:600;">'+(f.issued?fq(f.issued):'—')+'</td><td class="r" style="color:#9a6700;font-weight:600;">'+signedQty(f.adjustment)+'</td><td class="r" style="font-weight:700;">'+fq(f.ending)+'</td><td class="r">'+peso(val)+'</td><td class="r">'+peso(cost)+'</td><td class="r"><button class="pz-btn sec" data-svcard="'+esc(i.id)+'" style="padding:0.2rem 0.55rem;white-space:nowrap;">Stock card</button></td></tr>';
  }).join('');
  var html='<div class="pz-h">📊 Inventory</div><p class="pz-sub">Financial inventory reconciliation for the selected period. Beginning balance + stock received − stock issued or consumed ± adjustment and wastage = ending balance. Ending value uses the current cost per unit.</p>'
    +'<div style="display:flex;gap:0.7rem;flex-wrap:wrap;margin-bottom:0.8rem;">'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Ending inventory value</div><div style="font-size:1.25rem;font-weight:700;color:var(--bd);">'+peso(totalValue)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Purchases (period)</div><div style="font-size:1.25rem;font-weight:700;color:#2a9d5c;">'+peso(periodPurch)+'</div></div>'
      +'<div class="pz-card" style="flex:1;min-width:170px;"><div style="font-size:0.72rem;color:var(--tl);">Usage / COGS (period)</div><div style="font-size:1.25rem;font-weight:700;color:#c0392b;">'+peso(periodUse)+'</div></div>'
    +'</div>'+inventoryReconciliationHtml(recon,reconReady,history)
    +'<div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-bottom:0.8rem;"><div><span class="pz-lbl">From</span><input class="pz-in" id="svFrom" type="date" value="'+rng.f+'"/></div><div><span class="pz-lbl">To</span><input class="pz-in" id="svTo" type="date" value="'+rng.t+'"/></div><button class="pz-btn sec" id="svExport" style="padding:0.3rem 0.7rem;">⬇ Excel</button></div>'
    +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th class="r" title="Balance immediately before the selected period">Beginning balance</th><th class="r">Stock received</th><th class="r">Stock issued or consumed</th><th class="r">Adjustment and wastage</th><th class="r">Ending balance</th><th class="r">Ending value</th><th class="r">Cost per unit</th><th class="r">Stock cards</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="az-note" style="padding:0.6rem;">No inventory items.</td></tr>')+'</tbody></table></div></div>';
  root.innerHTML=html;
  var ff=document.getElementById('svFrom');if(ff)ff.onchange=function(){svFrom=this.value||null;renderStockValue();};
  var ft=document.getElementById('svTo');if(ft)ft.onchange=function(){svTo=this.value||null;renderStockValue();};
  var ex=document.getElementById('svExport');if(ex)ex.onclick=exportStockValue;
  var autoAdjustBtn=document.getElementById('inventoryAutoAdjustBtn');if(autoAdjustBtn)autoAdjustBtn.onclick=function(){autoAdjustInventoryReconciliation(rng,autoAdjustBtn);};
  root.querySelectorAll('[data-svcard]').forEach(function(b){b.onclick=function(){openStockCard(b.getAttribute('data-svcard'));};});
}
function openStockCard(id){
  var inv=invMap[id]||{};var cost=Number(inv.cost)||0;var cur=Number(inv.stock)||0;
  var mv=itemMovements(id);var net=mv.reduce(function(s,m){return s+(Number(m.in)||0)-(Number(m.out)||0);},0);var opening=Math.round((cur-net)*1000)/1000;var run=opening;
  var rows=mv.map(function(m){run=Math.round((run+(Number(m.in)||0)-(Number(m.out)||0))*1000)/1000;return '<tr><td>'+esc(m.date)+'</td><td>'+esc(m.type)+'</td><td class="r" style="color:#2a9d5c;">'+(m.in?fq(m.in):'')+'</td><td class="r" style="color:#c0392b;">'+(m.out?fq(m.out):'')+'</td><td class="r">'+fq(run)+'</td><td class="r">'+peso(run*cost)+'</td></tr>';}).join('');
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:660px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">Stock card — '+esc(inv.name)+'</div><button class="pz-btn sec" id="scClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
    +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Cost/unit '+peso(cost)+' · current stock '+fq(cur)+' '+esc(inv.unit||'')+' · value '+peso(cur*cost)+'</p>'
    +'<table class="pz-tbl"><thead><tr><th>Date</th><th>Movement</th><th class="r">In</th><th class="r">Out</th><th class="r">Balance</th><th class="r">Value</th></tr></thead><tbody>'
    +'<tr style="font-style:italic;color:var(--tl);"><td>—</td><td>Implied opening (before tracked movements)</td><td></td><td></td><td class="r">'+fq(opening)+'</td><td class="r">'+peso(opening*cost)+'</td></tr>'
    +(rows||'<tr><td colspan="6" class="az-note" style="padding:0.5rem;">No tracked movements yet.</td></tr>')
    +'</tbody></table></div>';
  document.body.appendChild(mask);
  mask.querySelector('#scClose').onclick=function(){document.body.removeChild(mask);};
  mask.onclick=function(e){if(e.target===mask)document.body.removeChild(mask);};
}
function exportStockValue(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var rng=svRange();var aoa=[['Item','Unit','Beginning balance','Stock received','Stock issued or consumed','Adjustment and wastage','Ending balance','Ending value','Cost per unit']];
  invItems().forEach(function(i){var cost=Number(i.cost)||0;var f=itemReconciliation(i.id,rng);aoa.push([i.name,i.unit||'',f.beginning,f.received,f.issued,f.adjustment,f.ending,f.ending*cost,cost]);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Inventory');XLSX.writeFile(wb,'accaza-inventory-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
})();
