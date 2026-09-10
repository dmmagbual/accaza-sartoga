
/* ══════════ INVENTORY ══════════ */
function renderInventory(){
  var root=document.getElementById('inventoryRoot'); if(!root)return;
  var list=ings();
  var low=list.filter(function(i){return Number(i.stock)<=Number(i.reorder||0)&&Number(i.stock)>=0;});
  var neg=list.filter(function(i){return Number(i.stock)<0;});
  var ozItems=list.filter(function(i){var u=uNorm(i.unit);return !i.ledgerVersion&&(u==='oz'||u==='ounce');});
  seedInvCats(); var catList=invCats(); var catFilter=window.__invCatFilter||'';
  var uncat=list.filter(function(i){return !(i.category&&invCatsMap()[i.category]);});
  var unmapped=list.filter(function(i){var m=invItemAccounts(i);return !m.inventoryAccount||!m.costAccount;});
  var missingBrand=list.filter(function(i){return recipeUsesInventory(i.id)&&!activeSkusFor(i.id).length;});
  var shown=!catFilter?list:(catFilter==='__none__'?uncat:(catFilter==='__brand_missing__'?missingBrand:list.filter(function(i){return (i.category||'')===catFilter;})));
  var unledgered=list.filter(function(i){return !i.ledgerVersion;});
  var movements=Object.keys(inventoryMovementsMap||{}).map(function(k){return Object.assign({id:k},inventoryMovementsMap[k]);}).sort(function(x,y){return (Number(y.occurredAt)||0)-(Number(x.occurredAt)||0);}).slice(0,100);
  var movementRows=movements.map(function(m){var q=Number(m.qty)||0;return '<tr><td>'+new Date(Number(m.occurredAt)||0).toLocaleString('en-PH')+'</td><td>'+esc(String(m.type||'').replace(/_/g,' '))+'</td><td>'+esc(m.itemName||m.itemId||'')+'</td><td class="r" style="color:'+(q<0?'#b44336':'#267354')+';">'+(q>0?'+':'')+num(q)+' '+esc(m.unit||'')+'</td><td class="r">'+num(m.balanceBefore)+' → <b>'+num(m.balanceAfter)+'</b></td><td class="r">'+peso(m.unitCost)+'</td><td>'+esc(m.sourceId||m.sourceType||'')+'</td><td>'+esc(m.actorName||'server')+'</td></tr>';}).join('');
  var rows=shown.map(function(i){
    var st=Number(i.stock)||0; var isLow=st<=Number(i.reorder||0)&&st>=0; var isNeg=st<0;
    var ty=ingType(i);
    var recipeLinked=recipeUsesInventory(i.id), brandCount=activeSkusFor(i.id).length;
    var linkBadge=recipeLinked?(brandCount?'<span class="inv-sku-link linked">✓ Recipe · '+brandCount+' approved brand'+(brandCount===1?'':'s')+'</span>':'<span class="inv-sku-link pending" title="This stock item is the SKU. Add an approved purchasing brand before receiving it.">✓ Recipe · SKU ready</span>'):'<span class="inv-sku-link neutral">Not in a recipe</span>';
    var tyBadge=inventoryTypeLabel(ty)+(ty==='consumable'&&i.serves&&i.serves!=='both'?' · '+esc(i.serves):'')+(ty==='consumable'&&i.size?' · '+esc(i.size):'');
    return '<tr>'
      +'<td>'+esc(i.name)+'</td>'
      +'<td style="font-size:0.78rem;color:var(--tl);">'+tyBadge+'</td>'
      +'<td style="font-size:0.78rem;">'+(i.category?esc(invCatName(i.category)):'<span style="color:var(--tl);">—</span>')+(function(){var m=invItemAccounts(i);return m.inventoryAccount&&m.costAccount?' <span style="color:#267354;font-size:0.66rem;">'+m.inventoryAccount+' / '+m.costAccount+'</span>':' <span style="color:#b44336;font-size:0.66rem;">unmapped</span>'})()+'</td>'
      +'<td class="'+((isNeg||isLow)?'pz-low':'')+'">'+num(st)+' '+esc(i.unit||'')+(isNeg?' 🔴 NEGATIVE':(isLow?' ⚠️':''))+'</td>'
      +'<td>'+num(i.reorder||0)+'</td>'
      +'<td>'+(i.cost?peso(i.cost):'—')+'</td>'
      +'<td>'+linkBadge+'</td>'
      +'<td class="inventory-actions-cell"><div class="inventory-actions">'
        +'<button class="pz-btn sec" style="'+(recipeLinked&&!brandCount?'border-color:#c98a2b;color:#8a5a00;':'border-color:#3a8a6a;color:#256b52;')+'" data-inv-skus="'+i.id+'">'+(recipeLinked&&!brandCount?'Add brand':'Brands ('+brandCount+')')+'</button>'
        +'<button class="pz-btn sec" data-inv-adjust="'+i.id+'">Adjust</button>'
        +'<button class="pz-btn sec" data-inv-edit="'+i.id+'">Edit</button>'
        +(i.ledgerVersion?'<span class="inventory-delete-slot inventory-lock" title="Ledger items cannot be deleted; preserve their audit trail.">🔒</span>':'<button class="pz-btn warn inventory-delete-slot" data-inv-del="'+i.id+'" aria-label="Delete '+esc(i.name)+'">✕</button>')
      +'</div></td></tr>';
  }).join('');
  root.innerHTML=
    '<div class="pz-h">📦 Stock Items</div>'
    +'<p class="pz-sub">Each inventory row is the common SKU used by recipes. Inventory Asset and Cost accounts belong to the individual item; Category is only an organizational label.'+(low.length?' <b class="pz-low">'+low.length+' low.</b>':'')+(neg.length?' <b class="pz-low">'+neg.length+' negative.</b>':'')+(uncat.length?' <b style="color:#8a5a00;">'+uncat.length+' uncategorized.</b>':'')+(unmapped.length?' <b style="color:#b44336;">'+unmapped.length+' without accounting mapping.</b>':'')+(missingBrand.length?' <b style="color:#8a5a00;">'+missingBrand.length+' recipe item'+(missingBrand.length===1?'':'s')+' without an approved purchasing brand.</b>':'')+'</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;border:1px solid #b8dfc4;background:#f3faf5;display:flex;gap:0.9rem;align-items:center;flex-wrap:wrap;">'
      +'<div style="flex:1;min-width:240px;"><div style="font-weight:700;color:#1c6b47;font-size:0.92rem;">📥 Receiving a delivery?</div><p style="font-size:0.79rem;color:var(--tm);margin:0.25rem 0 0;line-height:1.35;">Book stock in through the <b>Goods-Received Note</b> — capture supplier, invoice&nbsp;#, quantities and unit costs in one card. It updates the weighted-average cost and raises the payable automatically. <b>Adjust</b> and <b>Edit</b> below are only for count corrections, not for receiving purchases.</p></div>'
      +'<button class="pz-btn ok" id="invReceiveStock" style="white-space:nowrap;">📥 Receive stock →</button>'
    +'</div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
      +'<button class="pz-btn sec" id="invExport">⬇ Export Excel</button>'
      +'<button class="pz-btn sec" id="invTemplate">⬇ Import template</button>'
      +'<button class="pz-btn ok" id="invImportBtn">⬆ Import Excel</button>'
      +'<input type="file" id="invImportFile" accept=".xlsx,.xls,.csv" style="display:none;"/>'
      +(ozItems.length?'<button class="pz-btn sec" id="invFixOz" style="border-color:#e6a817;color:#8a5a00;">🔤 Convert '+ozItems.length+' oz → fl oz</button>':'')
      +'<button class="pz-btn sec" id="invCatMgr">🗂 Categories</button>'
      +'<button class="pz-btn sec" id="invSkuSetup" style="border-color:#3a8a6a;color:#256b52;">🔀 Brand &amp; Batch setup</button>'
      +'<button class="pz-btn sec" id="invExpiry" style="border-color:#c98a2b;color:#8a5a00;">📅 Expiry / batches</button>'
      +'<button class="pz-btn sec" id="invStdCost" style="border-color:#5a6fb0;color:#3a4a86;">📊 Standard costing</button>'
      +(unledgered.length?'<button class="pz-btn ok" id="invLedgerInit" style="border-color:#267354;">🧾 Initialize 3A ledger ('+unledgered.length+')</button>':'<span style="font-size:0.78rem;color:#267354;align-self:center;">✓ 3A ledger active</span>')
      +'<select class="pz-in" id="invCatFilter" style="width:auto;"><option value="">All categories</option><option value="__brand_missing__"'+(catFilter==='__brand_missing__'?' selected':'')+'>Recipe items without approved brand ('+missingBrand.length+')</option><option value="__none__"'+(catFilter==='__none__'?' selected':'')+'>— Uncategorized ('+uncat.length+') —</option>'+catList.map(function(c){return '<option value="'+esc(c.id)+'"'+(catFilter===c.id?' selected':'')+'>'+esc(c.name)+(c.kind==='overhead'?' (overhead)':'')+'</option>';}).join('')+'</select>'
    +'</div>'
    +'<details class="pz-card" style="margin-bottom:1rem;border:1px solid #d8bea0;background:#fffdf9;">'
      +'<summary class="pz-btn sec" style="display:inline-flex;cursor:pointer;list-style:none;">➕ Set up stock item / opening balance</summary>'
      +'<div style="margin-top:.75rem;">'
      +'<p style="font-size:0.79rem;color:var(--tm);line-height:1.45;margin:0 0 .65rem;"><b>Use this only for an item missing from the system.</b> Enter opening stock only when it is physically on hand but was not included in the system’s recorded physical count. Use <b>Purchases</b> for deliveries. Re-entering stock already counted or received will double both quantity and inventory value.</p>'
      +'<div style="display:grid;grid-template-columns:repeat(2,minmax(170px,1fr));gap:0.5rem;align-items:end;">'
        +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="invName" placeholder="e.g. Espresso beans"/></div>'
        +'<div><span class="pz-lbl">Unit</span><select class="pz-in" id="invUnit"><option>g</option><option>kg</option><option>ml</option><option>L</option><option>fl oz</option><option>pcs</option><option>shot</option><option>pump</option><option>ea</option></select></div>'
        +'<div><span class="pz-lbl">Type</span><select class="pz-in" id="invType">'+inventoryTypeOptions('base')+'</select></div>'
        +'<div><span class="pz-lbl">Category</span><select class="pz-in" id="invCat"><option value="">—</option>'+catList.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>';}).join('')+'</select></div>'
        +'<div><span class="pz-lbl">Inventory asset account</span><select class="pz-in" id="invAssetAccount">'+itemAccountOptions('', 'inventory')+'</select></div>'
        +'<div><span class="pz-lbl">Cost / COGS account</span><select class="pz-in" id="invCostAccount">'+itemAccountOptions('', 'cost')+'</select></div>'
        +'<div><span class="pz-lbl">Opening stock physically on hand</span><input class="pz-in" id="invStock" type="number" min="0" step="any" placeholder="0"/><div style="font-size:.7rem;color:var(--tl);margin-top:.2rem;">Leave 0 when setting up before the first purchase.</div></div>'
        +'<div><span class="pz-lbl">Reorder</span><input class="pz-in" id="invReorder" type="number" step="any" placeholder="0"/></div>'
        +'<div><span class="pz-lbl">Opening cost/unit ₱</span><input class="pz-in" id="invCost" type="number" min="0" step="any" placeholder="Required with opening stock"/></div>'
        +'<button class="pz-btn" id="invAddBtn">Create stock item</button>'
      +'</div>'
      +'<label style="display:flex;gap:.45rem;align-items:flex-start;margin-top:.65rem;padding:.55rem .65rem;border-radius:7px;background:#fff4df;font-size:.76rem;color:#6f4b20;"><input type="checkbox" id="invOpeningConfirmed" style="margin-top:.15rem;"/><span>If I enter opening stock, I confirm it is physically present, missing from the system’s recorded physical count, and has not already been received or counted elsewhere.</span></label>'
      +'<div id="invConsumRow" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-top:0.5rem;">'
        +'<div><span class="pz-lbl">Consumable serves</span><select class="pz-in" id="invServes"><option value="both">Both</option><option value="drink">Drinks only</option><option value="food">Food only</option></select></div>'
        +'<div><span class="pz-lbl">Cup size (blank = all)</span><select class="pz-in" id="invSize"><option value="">— all sizes —</option><option>S</option><option>M</option><option>L</option></select></div>'
        +'<div><span class="pz-lbl">Qty per order</span><input class="pz-in" id="invQPO" type="number" step="any" value="1"/></div>'
      +'</div>'
      +'</div>'
    +'</details>'
    +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl inventory-table"><thead><tr><th>SKU / stock item</th><th>Type</th><th>Category</th><th>In stock</th><th>Reorder</th><th>Cost</th><th>Recipe / brands</th><th>Actions</th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="8" style="color:var(--tl);padding:1rem;">No items in this view.</td></tr>')
    +'</tbody></table></div></div>'
    +'<div class="pz-card" style="margin-top:1rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">🧾 Inventory movement ledger</div><span style="font-size:0.74rem;color:var(--tl);">Latest '+movements.length+' loaded · immutable server record</span></div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Date/time</th><th>Movement</th><th>Item</th><th class="r">Quantity</th><th class="r">Balance</th><th class="r">Unit cost</th><th>Source</th><th>Posted by</th></tr></thead><tbody>'+(movementRows||'<tr><td colspan="8" style="padding:0.7rem;color:var(--tl);">No ledger movements loaded yet. Initialize once to capture today’s stock and cost as opening balances.</td></tr>')+'</tbody></table></div></div>';
  document.getElementById('invAddBtn').onclick=addIngredient;
  var _rs=document.getElementById('invReceiveStock'); if(_rs)_rs.onclick=function(){var b=document.getElementById('tabBtnPurchases'); if(b){b.click();} else if(window.posSwitchTab){window.posSwitchTab('purchases');}};
  var _cf=document.getElementById('invCatFilter'); if(_cf)_cf.onchange=function(){window.__invCatFilter=this.value||'';renderInventory();};
  var _cm=document.getElementById('invCatMgr'); if(_cm)_cm.onclick=openCatManager;
  var _ss=document.getElementById('invSkuSetup'); if(_ss)_ss.onclick=openSkuBatchSetup;
  var _xp=document.getElementById('invExpiry'); if(_xp)_xp.onclick=openExpiryView;
  var _sc=document.getElementById('invStdCost'); if(_sc)_sc.onclick=openStdCosting;
  var _li=document.getElementById('invLedgerInit'); if(_li)_li.onclick=function(){if(!confirm('Initialize the Release 3A inventory ledger now?\n\nThis records the CURRENT stock quantity and weighted-average cost of '+unledgered.length+' item(s) as opening balances. It does not change those amounts. Run this only after your Firebase backup is current.'))return;_li.disabled=true;_li.textContent='Initializing…';A().ensureInventoryLedger().then(function(r){r=r&&r.data?r.data:r||{};alert('Inventory ledger initialized.\nItems: '+(r.initialized||r.count||0)+'\nOpening balances are now locked and traceable.');}).catch(function(e){_li.disabled=false;_li.textContent='🧾 Initialize 3A ledger ('+unledgered.length+')';alert('Initialization FAILED: '+((e&&e.message)||e));});};
  var _ex=document.getElementById('invExport'); if(_ex)_ex.onclick=exportInventoryXlsx;
  var _fo=document.getElementById('invFixOz'); if(_fo)_fo.onclick=migrateOzToFloz;
  var _tp=document.getElementById('invTemplate'); if(_tp)_tp.onclick=downloadInventoryTemplate;
  var _ib=document.getElementById('invImportBtn'), _if=document.getElementById('invImportFile');
  if(_ib&&_if){ _ib.onclick=function(){_if.value='';_if.click();}; _if.onchange=function(){ if(_if.files&&_if.files[0])importInventoryXlsx(_if.files[0]); }; }
  var _it=document.getElementById('invType'); if(_it)_it.onchange=function(){document.getElementById('invConsumRow').style.display=(_it.value==='consumable')?'grid':'none';};
  root.querySelectorAll('[data-inv-skus]').forEach(function(b){b.onclick=function(){openSkuManager(b.getAttribute('data-inv-skus'));};});
  root.querySelectorAll('[data-inv-adjust]').forEach(function(b){b.onclick=function(){adjustStock(b.getAttribute('data-inv-adjust'));};});
  root.querySelectorAll('[data-inv-edit]').forEach(function(b){b.onclick=function(){editIngredient(b.getAttribute('data-inv-edit'));};});
  root.querySelectorAll('[data-inv-del]').forEach(function(b){b.onclick=function(){delIngredient(b.getAttribute('data-inv-del'));};});
}
/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 0 migration (DRY-RUN first) ══════════
   Promotes each inventory item to an Ingredient Master (KEEPS its ID — recipes untouched),
   seeds an Approved-SKU record per brand seen in stockReceipts, and creates ONE opening
   batch per item from current stock + weighted-average cost. Additive, idempotent, reversible.
   Actual COGS + deduction engine are NOT changed (WAC stays authoritative). */
function openSkuBatchSetup(){
  var a=A();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:900px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">🔀 Brand &amp; Batch setup</div><p class="pz-sub">Reading your inventory and purchase receipts…</p></div>';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  Promise.all([a.get(a.ref(a.db,'stockReceipts')),a.get(a.ref(a.db,'inventorySku')),a.get(a.ref(a.db,'inventoryBatch'))]).then(function(res){
    var receipts=res[0].val()||{}, existingSku=res[1].val()||{}, existingBatch=res[2].val()||{};
    // brands + last supplier seen per inventory item, from receipt history
    var brandsByItem={};
    Object.keys(receipts).forEach(function(rid){ var r=receipts[rid]||{}; var ing=r.ing; if(!ing)return; var b=(r.brand||'').trim(); if(!b)return; brandsByItem[ing]=brandsByItem[ing]||{}; if(!brandsByItem[ing][b])brandsByItem[ing][b]={supplier:(r.supplier||'').trim()}; else if(r.supplier)brandsByItem[ing][b].supplier=(r.supplier||'').trim(); });
    var list=ings();
    var plan=[]; var nSku=0,nBatch=0,nItems=0,nNeg=0;
    list.forEach(function(it){
      var done=!!it.skuMigrated;
      var brs=Object.keys(brandsByItem[it.id]||{});
      var stock=Number(it.stock)||0;
      var willBatch=(!done&&stock>0);
      if(willBatch)nBatch++; if(!done){nItems++; nSku+=brs.length;} if(stock<0)nNeg++;
      plan.push({it:it,done:done,brs:brs,stock:stock,willBatch:willBatch});
    });
    var rows=plan.map(function(p){
      var it=p.it; var wac=Number(it.cost)||0;
      var brandCell=p.brs.length?p.brs.map(esc).join(', '):'<span style="color:var(--tl);">— none in receipts —</span>';
      var status=p.done?'<span style="color:#2a7;">✓ already set up</span>':'<span style="color:#256b52;font-weight:600;">will set up</span>';
      var batchCell=p.done?'—':(p.stock>0?(num(p.stock)+' '+esc(it.unit||'')+' @ '+peso(wac)):(p.stock<0?'<span class="pz-low">negative — skipped</span>':'0 — skipped'));
      return '<tr><td>'+esc(it.name)+'</td><td style="font-size:0.78rem;color:var(--tl);">'+esc(it.unit||'')+'</td><td>'+(wac?peso(wac):'—')+'</td><td style="font-size:0.8rem;">'+brandCell+'</td><td style="font-size:0.8rem;">'+batchCell+'</td><td style="font-size:0.8rem;">'+status+'</td></tr>';
    }).join('');
    var allDone=(nItems===0);
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:900px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🔀 Brand &amp; Batch setup — preview</div><button class="pz-btn sec" id="skuClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Each inventory item remains the common SKU used by recipes. This creates an <b>approved brand option</b> from each brand found in purchase history and creates one <b>opening batch</b> from current stock at weighted-average cost. Recipes, deduction and COGS are unchanged. Nothing is written until you press Commit.</p>'
      +'<div style="background:var(--cd);border-radius:6px;padding:0.5rem 0.7rem;margin:0.5rem 0;font-size:0.85rem;"><b>Preview:</b> '+nItems+' item(s) to set up · '+nSku+' approved brand record(s) from purchase history · '+nBatch+' opening batch(es)'+(nNeg?' · <span class="pz-low">'+nNeg+' with negative stock (opening batch skipped)</span>':'')+(allDone?' · <b style="color:#2a7;">everything already set up</b>':'')+'</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>SKU / stock item</th><th>Base unit</th><th>WAC cost</th><th>Approved brands</th><th>Opening batch</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No inventory items yet.</td></tr>')+'</tbody></table></div>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.5rem;">Items with no brand in purchase history remain valid SKUs but need an approved brand before their next receipt. The opening batch is a blended-WAC balance, not tied to a brand. Re-running this is safe: items already set up are skipped.</div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="skuCommit"'+(allDone?' disabled style="opacity:0.5;"':'')+'>✅ Commit '+nItems+' item(s)</button><button class="pz-btn sec" id="skuCancel">Cancel</button></div>'
      +'</div>';
    document.getElementById('skuClose').onclick=close;
    document.getElementById('skuCancel').onclick=close;
    var commitBtn=document.getElementById('skuCommit');
    if(commitBtn&&!allDone)commitBtn.onclick=function(){
      commitBtn.disabled=true; commitBtn.textContent='Committing…';
      var now=Date.now(); var today=window.AccazaDate.key(); var updates={}; var c=0;
      plan.forEach(function(p){
        if(p.done)return; var it=p.it; var wac=Number(it.cost)||0;
        updates['inventory/'+it.id+'/masterUnit']=it.unit||'';
        updates['inventory/'+it.id+'/stdCost']=wac;
        updates['inventory/'+it.id+'/kind']=(invCatKind(it.category)||'cogs');
        updates['inventory/'+it.id+'/skuMigrated']=true;
        updates['inventory/'+it.id+'/skuMigratedAt']=now;
        p.brs.forEach(function(bName,ix){ var sid='sku_'+now.toString(36)+'_'+(c++); updates['inventorySku/'+sid]={masterId:it.id,brand:bName,supplier:(brandsByItem[it.id][bName]||{}).supplier||'',purchaseUnit:it.unit||'',packSize:null,purchaseCost:null,convToBase:1,costPerBase:wac,active:true,priority:ix,branchAvail:['main'],seededFrom:'receipts',createdAt:now}; });
        if(p.willBatch){ var bid='bat_'+now.toString(36)+'_'+(c++); updates['inventoryBatch/'+bid]={skuId:'',masterId:it.id,brand:'(opening balance — blended WAC)',qtyRecv:p.stock,qtyRemaining:p.stock,unitCost:wac,recvDate:today,expiry:'',lot:'OPENING',branch:'main',source:'opening',createdAt:now}; }
      });
      a.update(a.ref(a.db),updates).then(function(){ close(); alert('Done. Set up '+nItems+' item(s), '+nSku+' approved brand record(s), '+nBatch+' opening batch(es).\n\nRecipes, stock and costs are unchanged.'); if(isTab('inventory'))renderInventory(); }).catch(function(e){ commitBtn.disabled=false; commitBtn.textContent='✅ Commit '+nItems+' item(s)'; alert('Could not write: '+((e&&e.code)||e)+'.\n\nIf PERMISSION_DENIED — log in with your admin email and publish the updated database rules (inventorySku + inventoryBatch nodes).'); });
    };
  }).catch(function(e){ mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Could not load</div><p class="pz-sub">'+esc((e&&e.code)||String(e))+'</p><button class="pz-btn sec" id="skuErrClose">Close</button></div>'; var b=document.getElementById('skuErrClose'); if(b)b.onclick=close; });
}
