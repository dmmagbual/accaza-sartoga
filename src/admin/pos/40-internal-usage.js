function usageCost(usage){var c=0;Object.keys(usage||{}).forEach(function(ing){c+=usage[ing]*ingCost(ing);});return c;}
function usageMovements(usage,sign,type,sourceId,note,usageAccount,usageKind){return Object.keys(usage||{}).map(function(ing){return {movementId:movementId(type,sourceId,ing),itemId:ing,type:type,qty:sign*(Number(usage[ing])||0),unitCost:ingCost(ing),sourceType:'internal-usage',sourceId:sourceId,note:note||'',usageAccount:usageAccount||'',usageKind:usageKind||'',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()};});}
function usageEntries(){return Object.keys(usageMap).map(function(k){return Object.assign({id:k},usageMap[k]);}).sort(function(a,b){return (b.ts||0)-(a.ts||0);});}
function usageThisMonth(){var now=new Date(),y=now.getFullYear(),m=now.getMonth();return usageEntries().filter(function(u){var d=new Date(u.ts);return d.getFullYear()===y&&d.getMonth()===m;});}
function ingRowsHtml(tag){
  var rows=usageRows[tag]||[]; var allIng=ings();
  var body=rows.map(function(r,ix){
    var sel='<select class="pz-in" data-rg="'+tag+'" data-rgi="'+ix+'" data-rgf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+allIng.map(function(i){return '<option value="'+i.id+'"'+(i.id===r.ing?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+')</option>';}).join('')+'</select>';
    return '<tr><td>'+sel+'</td><td><input class="pz-in" type="number" step="any" style="width:90px;" data-rg="'+tag+'" data-rgi="'+ix+'" data-rgf="qty" value="'+(r.qty!=null?r.qty:'')+'" placeholder="qty"/></td><td style="color:var(--tl);">'+esc(r.ing?ingUnit(r.ing):'')+'</td><td><button class="pz-btn warn" style="padding:0.2rem 0.45rem;" data-rgdel="'+tag+'" data-rgdeli="'+ix+'">✕</button></td></tr>';
  }).join('');
  return '<table class="pz-tbl"><thead><tr><th>Ingredient</th><th style="width:90px;">Qty</th><th style="width:70px;">Unit</th><th></th></tr></thead><tbody id="urows_'+tag+'">'+(body||'<tr><td colspan="4" style="color:var(--tl);padding:0.4rem;">None.</td></tr>')+'</tbody></table><button class="pz-btn sec" data-rgadd="'+tag+'" style="padding:0.25rem 0.7rem;margin-top:0.3rem;">+ ingredient</button>';
}
function usageManageHtml(types){
  var rows=types.map(function(t){return '<tr><td><input class="pz-in" data-utname="'+esc(t.id)+'" value="'+esc(t.name)+'" style="min-width:150px;"/></td><td><select class="pz-in" data-utaccount="'+esc(t.id)+'">'+usageAccountOptions(usageTypeAccount(t.id))+'</select></td><td><input class="pz-in" data-utreasons="'+esc(t.id)+'" value="'+esc((t.reasons||[]).join(', '))+'" placeholder="comma-separated reasons" style="min-width:220px;"/></td><td><button class="pz-btn warn" data-utdel="'+esc(t.id)+'" style="padding:0.2rem 0.5rem;">✕</button></td></tr>';}).join('');
  return '<div class="pz-card" style="margin-bottom:0.8rem;background:#faf7f2;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.3rem;">Usage types and Finance mapping</div><p class="pz-sub" style="margin-top:0;">Every type must map to its proper P&amp;L account. Inventory reconciliation 5905 is intentionally unavailable. Deleting a type keeps past records and their original account intact.</p><table class="pz-tbl"><thead><tr><th>Type name</th><th>Finance account</th><th>Reasons</th><th></th></tr></thead><tbody>'+rows+'</tbody></table><div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-top:0.6rem;"><div><span class="pz-lbl">New type</span><input class="pz-in" id="utNewName" placeholder="e.g. Sampling" style="width:180px;"/></div><div><span class="pz-lbl">Finance account</span><select class="pz-in" id="utNewAccount">'+usageAccountOptions('6077')+'</select></div><div style="flex:1;min-width:200px;"><span class="pz-lbl">Reasons (comma-separated)</span><input class="pz-in" id="utNewReasons" placeholder="e.g. Event sampling, Training"/></div><button class="pz-btn sec" id="utAdd">+ Add type</button><button class="pz-btn ok" id="utSave" style="margin-left:auto;">💾 Save types</button></div></div>';
}
function renderUsage(){
  var root=document.getElementById('usageRoot'); if(!root)return;
  var a0=A();
  if(a0&&!Object.keys(usageTypesMap).length){var seed={};DEFAULT_USAGE_TYPES.forEach(function(d){seed[d.id]={name:d.name,reasons:d.reasons,expenseAccount:d.expenseAccount,order:d.order};});a0.update(a0.ref(a0.db,'usageTypes'),seed).catch(function(){});}
  if(a0&&Object.keys(usageTypesMap).length){var mappingRepair={};if(usageTypesMap.staff&&!usageTypesMap.staff.expenseAccount)mappingRepair['usageTypes/staff/expenseAccount']='6077';if(usageTypesMap.rnd&&!usageTypesMap.rnd.expenseAccount)mappingRepair['usageTypes/rnd/expenseAccount']='6078';if(Object.keys(mappingRepair).length)a0.update(a0.ref(a0.db),mappingRepair).catch(function(){});}
  var types=usageTypesList();
  if(!types.some(function(t){return t.id===usageKind;}))usageKind=(types[0]?types[0].id:'staff');
  var kind=usageKind;
  var kindBtns=types.map(function(t){return '<button class="pz-btn '+(kind===t.id?'ok':'sec')+'" data-ukind="'+esc(t.id)+'" style="padding:0.35rem 0.9rem;">'+esc(t.name)+'</button>';}).join(' ')+' <button class="pz-btn '+(usageManageOpen?'ok':'sec')+'" id="usageManageBtn" style="padding:0.35rem 0.7rem;">⚙️ Manage types</button>';
  var manageBlock=usageManageOpen?usageManageHtml(types):'';
  var srcBtns='<button class="pz-btn '+(!usageAdhoc?'ok':'sec')+'" data-usrc="menu" style="padding:0.25rem 0.7rem;">Menu item</button> <button class="pz-btn '+(usageAdhoc?'ok':'sec')+'" data-usrc="adhoc" style="padding:0.25rem 0.7rem;">Ad-hoc ingredients</button>';
  var itemOpts=menuList().map(function(it){return '<option value="'+esc(it.key)+'">'+esc(it.name)+'</option>';}).join('');
  var reasons=usageTypeReasons(kind);
  var reasonField='<div><span class="pz-lbl">Reason</span><select class="pz-in" id="usageReason">'+(reasons.length?reasons.map(function(r){return '<option>'+esc(r)+'</option>';}).join(''):'<option value="">(add reasons in Manage types)</option>')+'</select></div>';
  var sourceBlock;
  if(usageAdhoc){
    sourceBlock='<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Experimental recipe name</span><input class="pz-in" id="usageRecipeName" value="'+esc(usageRecipeName)+'" placeholder="e.g. Salted Caramel Cold Foam v2"/></div>'
      +'<div style="font-size:0.75rem;color:var(--tl);margin-bottom:0.5rem;">Build the trial recipe in three parts. If it tastes good, you can print it and add it to the menu.</div>'
      +'<span class="pz-lbl">1 · Base / main ingredients</span><div id="ugrp_base">'+ingRowsHtml('base')+'</div>'
      +'<div style="margin-top:0.7rem;"></div><span class="pz-lbl">2 · Add-on ingredients</span><div id="ugrp_addon">'+ingRowsHtml('addon')+'</div>'
      +'<div style="margin-top:0.7rem;"></div><span class="pz-lbl">3 · Consumables used (cup, lid, straw…)</span><div id="ugrp_cons">'+ingRowsHtml('cons')+'</div>';
  } else {
    sourceBlock='<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;"><div style="flex:1;min-width:180px;"><span class="pz-lbl">Menu item</span><select class="pz-in" id="usageItem">'+itemOpts+'</select></div><div><span class="pz-lbl">Size</span><select class="pz-in" id="usageSize"><option>S</option><option selected>M</option><option>L</option></select></div><div><span class="pz-lbl">Qty</span><input class="pz-in" id="usageQty" type="number" step="any" value="1" style="width:80px;"/></div></div>'
      +'<div style="margin-top:0.7rem;"><span class="pz-lbl">Add-on ingredients (optional — extra beyond the recipe, e.g. Whipped cream 60 ml)</span><div id="ugrp_menuaddon">'+ingRowsHtml('menuaddon')+'</div></div>';
  }
  var tm=usageThisMonth();
  var byTypeTot={}; tm.forEach(function(u){if(u.reversed)return;var t=u.kind||'staff';byTypeTot[t]=(byTypeTot[t]||0)+(Number(u.cost)||0);});
  var typeIdsForCards={}; types.forEach(function(t){typeIdsForCards[t.id]=1;}); Object.keys(byTypeTot).forEach(function(i){typeIdsForCards[i]=1;});
  var usageCards=Object.keys(typeIdsForCards).map(function(i){return '<div class="pz-card" style="flex:1;min-width:150px;"><div style="font-size:0.78rem;color:var(--tl);">'+esc(usageTypeName(i))+' (this month)</div><div style="font-weight:700;font-size:1.15rem;color:var(--bd);">'+peso(byTypeTot[i]||0)+'</div></div>';}).join('');
  var logRows=tm.length?tm.map(function(u){
    var when=new Date(u.ts).toLocaleDateString('en-PH',{month:'short',day:'numeric'});
    var tag=esc(usageTypeName(u.kind||'staff'))+((u.reason||u.category)?' · '+esc(u.reason||u.category):'');
    return '<tr'+(u.reversed?' style="opacity:0.5;text-decoration:line-through;"':'')+'><td>'+when+'</td><td>'+tag+'</td><td>'+esc(u.label||u.itemKey||'')+'</td><td>'+esc(u.recipient||'')+'</td><td style="text-align:right;">'+peso(u.cost)+'</td><td style="white-space:nowrap;"><button class="pz-btn sec" style="padding:0.2rem 0.5rem;" data-uprint="'+esc(u.id)+'">🖨 View</button> '+(u.reversed?'<span style="color:var(--tl);font-size:0.75rem;">reversed</span>':'<button class="pz-btn warn" style="padding:0.2rem 0.5rem;" data-urev="'+esc(u.id)+'">Reverse</button>')+'</td></tr>';
  }).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No entries this month.</td></tr>';
  root.innerHTML='<div class="pz-h">🍽️ Internal Usage</div>'
    +'<p class="pz-sub">Record drinks/food consumed internally — never a sale. Stock deducts by recipe (incl. cups &amp; consumables); cost posts to that usage type’s own P&amp;L line. Types &amp; reasons are customizable. Log-only, no PIN.</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="margin-bottom:0.7rem;">'+kindBtns+'</div>'
      +manageBlock
      +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.7rem;">'+reasonField+'<div><span class="pz-lbl">Recipient</span><input class="pz-in" id="usageRecipient" placeholder="name / who"/></div><div style="flex:1;min-width:160px;"><span class="pz-lbl">Note (optional)</span><input class="pz-in" id="usageRnote" placeholder="e.g. new latte v2 trial"/></div></div>'
      +'<div style="margin-bottom:0.5rem;">'+srcBtns+'</div>'
      +sourceBlock
      +'<div style="margin-top:1rem;"><button class="pz-btn ok" id="usageRecord">Record &amp; deduct stock</button></div>'
    +'</div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.8rem;">'+usageCards+'</div>'
    +'<div class="pz-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">This month’s log</div><button class="pz-btn sec" id="usageExport" style="padding:0.25rem 0.7rem;">⬇ Export Excel</button></div>'
      +'<table class="pz-tbl"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Recipient</th><th style="text-align:right;">Cost</th><th></th></tr></thead><tbody>'+logRows+'</tbody></table></div>';
  root.querySelectorAll('[data-ukind]').forEach(function(b){b.onclick=function(){usageKind=b.getAttribute('data-ukind');renderUsage();};});
  root.querySelectorAll('[data-usrc]').forEach(function(b){b.onclick=function(){usageAdhoc=(b.getAttribute('data-usrc')==='adhoc');if(usageAdhoc&&!(usageRows.base.length||usageRows.addon.length||usageRows.cons.length))usageRows.base=[{ing:'',qty:''}];if(!usageAdhoc&&!usageRows.menuaddon.length){}renderUsage();};});
  function captureRow(tag){var arr=usageRows[tag]||[];root.querySelectorAll('[data-rg="'+tag+'"]').forEach(function(el){var ix=+el.getAttribute('data-rgi');var f=el.getAttribute('data-rgf');arr[ix]=arr[ix]||{ing:'',qty:''};if(f==='ing')arr[ix].ing=el.value;else arr[ix].qty=el.value;});usageRows[tag]=arr;}
  function captureRecipeName(){var el=document.getElementById('usageRecipeName');if(el)usageRecipeName=el.value;}
  function wireGroup(tag){var c=document.getElementById('ugrp_'+tag);if(!c)return;
    c.querySelectorAll('select[data-rg="'+tag+'"][data-rgf="ing"]').forEach(function(s){s.onchange=function(){refreshGroup(tag);};});
    c.querySelectorAll('input[data-rg="'+tag+'"][data-rgf="qty"]').forEach(function(i){i.oninput=function(){captureRow(tag);};});
    var add=c.querySelector('[data-rgadd="'+tag+'"]');if(add)add.onclick=function(){captureRow(tag);(usageRows[tag]=usageRows[tag]||[]).push({ing:'',qty:''});refreshGroup(tag);};
    c.querySelectorAll('[data-rgdel="'+tag+'"]').forEach(function(b){b.onclick=function(){captureRow(tag);usageRows[tag].splice(+b.getAttribute('data-rgdeli'),1);refreshGroup(tag);};});
  }
  function refreshGroup(tag){captureRow(tag);var c=document.getElementById('ugrp_'+tag);if(c){c.innerHTML=ingRowsHtml(tag);wireGroup(tag);}}
  ['menuaddon','base','addon','cons'].forEach(function(tag){if(document.getElementById('ugrp_'+tag))wireGroup(tag);});
  var rn=document.getElementById('usageRecipeName'); if(rn)rn.oninput=function(){usageRecipeName=this.value;};
  var mgB=document.getElementById('usageManageBtn'); if(mgB)mgB.onclick=function(){usageManageOpen=!usageManageOpen;renderUsage();};
  var utAdd=document.getElementById('utAdd'); if(utAdd)utAdd.onclick=function(){var nm=((document.getElementById('utNewName')||{}).value||'').trim();if(!nm){alert('Type a name for the new usage type.');return;}var rs=((document.getElementById('utNewReasons')||{}).value||'').split(',').map(function(x){return x.trim();}).filter(Boolean),expenseAccount=((document.getElementById('utNewAccount')||{}).value||'');if(!expenseAccount){alert('Select a Finance account.');return;}var a=A();a.set(a.ref(a.db,'usageTypes/'+uid('ut_')),{name:nm,reasons:rs,expenseAccount:expenseAccount,order:usageTypesList().length+1}).then(function(){}).catch(function(e){alert('Could not add: '+((e&&e.code)||e));});};
  var utSave=document.getElementById('utSave'); if(utSave)utSave.onclick=function(){var a=A();var ups={};root.querySelectorAll('[data-utname]').forEach(function(i){var id=i.getAttribute('data-utname');var nm=(i.value||'').trim();var rsEl=root.querySelector('[data-utreasons="'+id+'"]'),acctEl=root.querySelector('[data-utaccount="'+id+'"]');var rs=((rsEl&&rsEl.value)||'').split(',').map(function(x){return x.trim();}).filter(Boolean),expenseAccount=(acctEl&&acctEl.value)||'';if(nm&&expenseAccount)ups[id]={name:nm,reasons:rs,expenseAccount:expenseAccount,order:(usageTypesMap[id]&&usageTypesMap[id].order)||0};});a.update(a.ref(a.db,'usageTypes'),ups).then(function(){alert('Usage types and Finance mappings saved.');}).catch(function(e){alert('Could not save: '+((e&&e.message)||e));});};
  root.querySelectorAll('[data-utdel]').forEach(function(b){b.onclick=function(){if(usageTypesList().length<=1){alert('Keep at least one usage type.');return;}var id=b.getAttribute('data-utdel');if(!confirm('Delete this usage type? Past records keep their figures on the P&L.'))return;var a=A();a.remove(a.ref(a.db,'usageTypes/'+id));};});
  var rec=document.getElementById('usageRecord'); if(rec)rec.onclick=function(){['menuaddon','base','addon','cons'].forEach(function(tag){captureRow(tag);});captureRecipeName();recordUsage();};
  root.querySelectorAll('[data-urev]').forEach(function(b){b.onclick=function(){reverseUsage(b.getAttribute('data-urev'));};});
  root.querySelectorAll('[data-uprint]').forEach(function(b){b.onclick=function(){printUsageRecipe(b.getAttribute('data-uprint'));};});
  var exb=document.getElementById('usageExport'); if(exb)exb.onclick=exportUsageXlsx;
}
function recordUsage(){
  var kind=usageKind; var a=A();
  var recipient=((document.getElementById('usageRecipient')||{}).value||'').trim();
  var reason = ((document.getElementById('usageReason')||{}).value||'');
  var note = ((document.getElementById('usageRnote')||{}).value||'').trim();
  var category = '';
  function mkLines(tag){return (usageRows[tag]||[]).filter(function(r){return r.ing&&Number(r.qty);}).map(function(r){var q=Number(r.qty)||0;var nm=(inventoryMap[r.ing]&&inventoryMap[r.ing].name)||r.ing;return {ing:r.ing,name:nm,qty:q,unit:ingUnit(r.ing),cost:Math.round(q*ingCost(r.ing)*100)/100};});}
  var usage={},itemKey=null,size=null,qty=1,adhocLines=null,label='',addonLines=null,sections=null,recipeName=null;
  if(usageAdhoc){
    recipeName=(usageRecipeName||'').trim();
    if(!recipeName){alert('Give the experimental recipe a name first.');return;}
    var baseL=mkLines('base'),addL=mkLines('addon'),consL=mkLines('cons');
    var all=baseL.concat(addL).concat(consL);
    if(!all.length){alert('Add at least one ingredient (base, add-on, or consumable) with a quantity.');return;}
    all.forEach(function(r){usage[r.ing]=(usage[r.ing]||0)+r.qty;});
    sections={base:baseL,addon:addL,cons:consL};
    label=recipeName;
  } else {
    itemKey=(document.getElementById('usageItem')||{}).value; size=(document.getElementById('usageSize')||{}).value||'M'; qty=Number((document.getElementById('usageQty')||{}).value)||1;
    if(!itemKey){alert('Choose a menu item.');return;}
    try{usage=computeUsage([{itemKey:itemKey,size:size,qty:qty}]);}catch(err){alert('Cannot record usage because the recipe has an error:\n\n'+(err&&err.message?err.message:err));return;}
    addonLines=mkLines('menuaddon');
    addonLines.forEach(function(r){usage[r.ing]=(usage[r.ing]||0)+r.qty;});
    if(!Object.keys(usage).length){alert('That item has no recipe yet and no add-ons — add a recipe in Recipes or add an add-on ingredient.');return;}
    label=(A().menuItemsMap[itemKey]?A().menuItemsMap[itemKey].name:itemKey)+' ('+size+') ×'+qty+(addonLines.length?' + '+addonLines.map(function(l){return l.name+' '+l.qty+l.unit;}).join(', '):'');
  }
  var cost=usageCost(usage);
  var acct=(window.__posShift&&window.__posShift.staff)||'Admin';
  var id=window.__usagePendingId||(window.__usagePendingId=uid('use_'));
  var expenseAccount=usageTypeAccount(kind);if(!expenseAccount){alert('This usage type has no Finance account. Open Manage types and map it before recording.');return;}
  var movementType=expenseAccount==='5900'?'waste':(kind==='rnd'?'rnd_testing':'staff_use');
  var movementIds=usageMovements(usage,-1,movementType,id,label,expenseAccount,kind);
  var movementByItem={};movementIds.forEach(function(row){movementByItem[row.itemId]=row.movementId;});
  postMovements(movementIds).then(function(){return a.set(a.ref(a.db,'internalUsage/'+id),{kind:kind,kindName:usageTypeName(kind),expenseAccount:expenseAccount,category:category,itemKey:itemKey,size:size,qty:qty,addonLines:addonLines,recipeName:recipeName,sections:sections,adhoc:!!usageAdhoc,label:label,recipient:recipient,reason:reason,note:note,recordingAccount:acct,ts:Date.now(),usage:usage,cost:cost,movementIds:movementIds.map(function(x){return x.movementId;}),movementByItem:movementByItem,reversed:false});}).then(function(){
  if(window.__posLog)window.__posLog('usage:'+kind,label,peso(cost));
  window.__usagePendingId=''; usageRows={menuaddon:[],base:[],addon:[],cons:[]}; usageRecipeName=''; renderUsage();
  alert('Recorded. Stock deducted; '+peso(cost)+' logged to '+usageTypeName(kind)+'.');
  }).catch(function(e){alert('Internal usage FAILED — stock was not changed: '+((e&&e.message)||e));});
}
function reverseUsage(id){
  var u=usageMap[id]; if(!u||u.reversed)return;
  if(!confirm('Reverse this entry? Ingredients will be returned to stock.'))return;
  var rows=usageMovements(u.usage||{},+1,'usage_reversal',id,u.label||id);
  rows.forEach(function(row,ix){var suffix='_'+String(row.itemId||'').replace(/[^A-Za-z0-9_-]/g,'_');row.reversalOf=(u.movementByItem&&u.movementByItem[row.itemId])||((u.movementIds||[]).filter(function(mid){return String(mid).slice(-suffix.length)===suffix;})[0])||(u.movementIds&&u.movementIds[ix])||'';});
  postMovements(rows).then(function(){var a=A();return a.update(a.ref(a.db,'internalUsage/'+id),{reversed:true,reversedAt:Date.now(),reversalMovementIds:rows.map(function(x){return x.movementId;})});}).then(function(){if(window.__posLog)window.__posLog('usage-reverse',u.label||id,peso(u.cost));}).catch(function(e){alert('Reverse FAILED — stock was not changed: '+((e&&e.message)||e));});
}
function exportUsageXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var aoa=[['date','kind','category','item','qty','recipient','reason','cost','account','reversed']];
  usageEntries().forEach(function(u){ aoa.push([new Date(u.ts).toLocaleString('en-PH'),u.kind,u.category||'',u.label||u.itemKey||'',u.qty||'',u.recipient||'',u.reason||'',Number(u.cost)||0,u.recordingAccount||'',u.reversed?'yes':'']); });
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'InternalUsage');
  XLSX.writeFile(wb,'accaza-internal-usage-'+window.AccazaDate.key()+'.xlsx');
}
function printUsageRecipe(id){
  var u=usageMap[id]; if(!u){alert('Entry not found.');return;}
  var w=window.open('','_blank','width=380,height=680'); if(!w){alert('Allow pop-ups to view/print the recipe.');return;}
  function secTbl(title,lines){ if(!lines||!lines.length)return ''; return '<div style="font-weight:bold;margin-top:6px;">'+esc(title)+'</div><table>'+lines.map(function(l){return '<tr><td>'+esc(l.name||l.ing)+'</td><td style="text-align:right;">'+l.qty+' '+esc(l.unit||'')+'</td><td style="text-align:right;">'+peso(l.cost||0)+'</td></tr>';}).join('')+'</table>'; }
  var title=esc(u.recipeName||u.label||'Internal usage');
  var body='';
  if(u.adhoc&&u.sections){ body=secTbl('Base / main ingredients',u.sections.base)+secTbl('Add-on ingredients',u.sections.addon)+secTbl('Consumables',u.sections.cons); }
  else { body='<div>'+esc(u.label||'')+'</div>'+secTbl('Add-on ingredients',u.addonLines); }
  // full per-ingredient costing from exactly what was deducted
  var costRows=Object.keys(u.usage||{}).map(function(ing){var q=Number(u.usage[ing])||0;var inv=inventoryMap[ing]||{};var uc=Number(inv.cost)||0;return {name:inv.name||ing,qty:Math.round(q*1000)/1000,unit:inv.unit||'',unitCost:uc,cost:Math.round(q*uc*100)/100};}).sort(function(a,b){return b.cost-a.cost;});
  var costTbl=costRows.length?('<div style="font-weight:bold;margin-top:6px;">Ingredient costing (deducted)</div><table><tr style="border-bottom:1px solid #000;"><td>Ingredient</td><td style="text-align:right;">Used</td><td style="text-align:right;">Unit ₱</td><td style="text-align:right;">Cost</td></tr>'+costRows.map(function(l){return '<tr><td>'+esc(l.name)+'</td><td style="text-align:right;">'+l.qty+' '+esc(l.unit)+'</td><td style="text-align:right;">'+peso(l.unitCost)+'</td><td style="text-align:right;">'+peso(l.cost)+'</td></tr>';}).join('')+'</table>'):'';
  w.document.write('<html><head><title>'+title+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2,h3{text-align:center;margin:2px 0;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza — Internal Usage</h2><h3>'+title+'</h3><hr>'
    +'<div>Date: '+new Date(u.ts).toLocaleString('en-PH')+'</div>'
    +'<div>Type: '+esc(u.kindName||u.kind||'')+(u.reason?' · '+esc(u.reason):'')+'</div>'
    +(u.recipient?'<div>Recipient: '+esc(u.recipient)+'</div>':'')
    +(u.note?'<div>Note: '+esc(u.note)+'</div>':'')
    +'<hr>'+(body||'<div style="color:#777;">No itemized ingredients recorded.</div>')
    +(costTbl?('<hr>'+costTbl):'')+'<hr>'
    +'<table><tr><td><b>Total cost</b></td><td style="text-align:right;"><b>'+peso(u.cost||0)+'</b></td></tr></table>'
    +'<div style="font-size:9px;text-align:center;margin-top:6px;">Internal usage — not a sale. Management record.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
/* ══════════ DE-DUPE MENU ITEMS ══════════ */
function renderDedupe(){
  var root=document.getElementById('dedupeRoot'); if(!root)return;
  var items=(A().getMenuItems?A().getMenuItems():[]);
  function hasRecipe(key){var r=recipesMap[key];return !!(r&&((r.base&&r.base.length)||(r.options&&r.options.length)||(r.consumables&&r.consumables.length)));}
  function hasChan(key){return !!((channelPricesMap.grabfood||{})[key]||(channelPricesMap.foodpanda||{})[key]);}
  function priceStr(it){return it.priceM?('S'+(it.priceS||0)+'/M'+it.priceM+'/L'+it.priceL):('₱'+(it.priceS||0));}
  function catLbl(c){return (A().getCatLabel?A().getCatLabel(c):'')||c||'—';}
  var groups={};
  items.forEach(function(it){var k=(it.name||'').trim().toLowerCase();(groups[k]=groups[k]||[]).push(it);});
  var dupKeys=Object.keys(groups).filter(function(k){return groups[k].length>1;});
  var html='<div class="pz-h">🧹 De-dupe Menu Items</div><p class="pz-sub">Items saved more than once (same name + category). Keep the copy that has a recipe / channel price; delete the empty twin. Deleting a menu item does NOT change past orders — they keep their own price snapshot.</p>';
  if(!dupKeys.length){ html+='<div class="pz-card"><p class="az-note" style="padding:0.7rem;">✓ No duplicate menu items found. Your menu is clean.</p></div>'; root.innerHTML=html; return; }
  html+='<div class="pz-card" style="margin-bottom:1rem;"><b style="color:var(--bd);">'+dupKeys.length+' duplicated item(s) found.</b><div style="font-size:0.78rem;color:var(--tl);margin-top:0.2rem;">The green row is the recommended keep (it has the recipe/channel price). Delete the others.</div></div>';
  dupKeys.sort(function(a,b){return groups[a][0].name.localeCompare(groups[b][0].name);}).forEach(function(k){
    var arr=groups[k].slice();
    var scored=arr.map(function(it){return {it:it,rec:hasRecipe(it.key)?1:0,chan:hasChan(it.key)?1:0};});
    var keep=scored.slice().sort(function(a,b){return (b.rec-a.rec)||(b.chan-a.chan);})[0];
    var rows=scored.map(function(s){
      var isKeep=s.it.key===keep.it.key;
      var flags=[]; if(s.rec)flags.push('recipe'); if(s.chan)flags.push('channel price');
      return '<tr'+(isKeep?' style="background:#eaf6ee;"':'')+'><td>'+esc(s.it.name)+'<div style="font-size:0.7rem;color:var(--tl);">'+esc(catLbl(s.it.cat))+' · '+esc(s.it.key)+' · '+esc(priceStr(s.it))+'</div></td>'
        +'<td style="font-size:0.76rem;">'+(flags.length?flags.join(', '):'<span style="color:var(--tl);">empty</span>')+'</td>'
        +'<td style="white-space:nowrap;text-align:right;">'+(isKeep?'<span style="color:#2a9d5c;font-weight:700;">✓ keep</span>':'<button class="pz-btn warn" style="padding:0.2rem 0.6rem;" data-deldup="'+esc(s.it.key)+'">Delete</button>')+'</td></tr>';
    }).join('');
    var catset={};arr.forEach(function(it){catset[it.cat||'']=1;});var crossCat=Object.keys(catset).length>1;
    html+='<div class="az-sec">'+esc(groups[k][0].name)+' <span style="font-size:0.75rem;color:var(--tl);font-weight:400;">· '+arr.length+' copies'+(crossCat?' · <span style="color:#c0392b;">in different categories — check these are not two real products</span>':'')+'</span></div>'
      +'<div class="pz-card" style="margin-bottom:0.8rem;"><table class="pz-tbl"><thead><tr><th>Copy</th><th>Has</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  });
  root.innerHTML=html;
  root.querySelectorAll('[data-deldup]').forEach(function(b){b.onclick=function(){
    var key=b.getAttribute('data-deldup');var it=(A().menuItemsMap||{})[key];var nm=it?it.name:key;
    var risky=hasRecipe(key)||hasChan(key);
    if(risky){ if(!confirm('⚠ This copy HAS a recipe or channel price attached. Deleting it will lose that link. Delete "'+nm+'" ('+key+') anyway?'))return; }
    else if(!confirm('Delete duplicate "'+nm+'" ('+key+')?\nPast orders are unaffected.'))return;
    var a=A();a.remove(a.ref(a.db,'menuItems/'+key)).then(function(){ if(window.__posLog)window.__posLog('menu-dedupe',key,'deleted duplicate '+nm); renderDedupe(); }).catch(function(e){alert('Could not delete: '+((e&&e.code)||e)+'. If PERMISSION_DENIED, log in with your EMAIL.');});
  };});
}
