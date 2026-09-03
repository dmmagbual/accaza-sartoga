
/* Recipe repair & restore.
   A "Hot" choice written as the complete hot recipe was ADDED to the base, so every hot
   drink was costed and drawn from stock twice. This screen takes a restore point first,
   shows exactly what moves, then rewrites those choices as differences from the base. */
var recTempSnapshotTaken=false, recTempPlanCache=null, recTempBusy=false;

function recTempEngine(){
  if(!window.AccazaRecipeTempPlan)throw new Error('The recipe repair planner did not load. Refresh the portal and try again.');
  return window.AccazaRecipeTempPlan;
}
function recTempBuildPlan(){
  recTempPlanCache=recTempEngine().plan(recipesMap,inventoryMap,(A()&&A().menuItemsMap)||{});
  return recTempPlanCache;
}
function recTempCost(map,key,size,labels){
  var result=Costing().costOrder(costingContext({recipes:map,lineItems:[{itemKey:key,size:size,qty:1,optLabels:labels||[]}]}));
  return result.totalCost;
}
function recTempName(key){var m=(A()&&A().menuItemsMap)||{};return (m[key]&&m[key].name)||key;}
function recTempSeal(value){
  function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.keys(v).sort().reduce(function(o,k){o[k]=stable(v[k]);return o;},{});}
  return crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value)))).then(function(buf){
    return Array.prototype.map.call(new Uint8Array(buf),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  });
}
function recTempDownloadRestorePoint(){
  var btn=document.getElementById('recTempSnapshot'); if(btn){btn.disabled=true;btn.textContent='Preparing…';}
  var a=A();
  a.get(a.ref(a.db,'recipes')).then(function(snap){
    var recipes=snap.val()||{};
    return recTempSeal(recipes).then(function(hash){
      var takenAt=Date.now();
      var envelope={version:'accaza-recipes-restore-v1',kind:'accaza-recipe-restore-point',takenAt:takenAt,
        takenAtISO:new Date(takenAt).toISOString(),recipeCount:Object.keys(recipes).length,
        integrity:{algorithm:'sha256',canonical:'sorted-json-v1',dataSha256:hash},
        note:'Every recipe exactly as it stood before the temperature repair. Load this file back on the same screen to undo the repair completely.',
        recipes:recipes};
      var blob=new Blob([JSON.stringify(envelope)],{type:'application/json'}),url=URL.createObjectURL(blob);
      var stamp=new Date(takenAt).toISOString().slice(0,19).replace(/[:T]/g,'-');
      var link=document.createElement('a');link.href=url;link.download='accaza-recipes-before-repair-'+stamp+'.json';
      document.body.appendChild(link);link.click();document.body.removeChild(link);
      setTimeout(function(){URL.revokeObjectURL(url);},4000);
      recTempSnapshotTaken=true;
      renderRecipeRepair();
      alert('Restore point saved ('+Object.keys(recipes).length+' recipes).\n\nKeep that file until you are happy with the repair. Loading it back on this screen puts every recipe back exactly as it is right now.');
    });
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='⬇ Save a restore point';}
    alert('Could not build the restore point: '+((e&&e.message)||e)+'\n\nNothing was changed.');
  });
}
function recTempRestoreFromFile(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(){
    var envelope;
    try{envelope=JSON.parse(String(reader.result));}catch(e){alert('That file is not a restore point. Nothing was changed.');return;}
    if(!envelope||envelope.version!=='accaza-recipes-restore-v1'||!envelope.recipes){alert('That file is not an Accaza recipe restore point. Nothing was changed.');return;}
    recTempSeal(envelope.recipes).then(function(hash){
      var sealed=envelope.integrity&&envelope.integrity.dataSha256;
      if(sealed&&sealed!==hash){alert('That restore point has been altered since it was saved (its fingerprint does not match). Nothing was changed.');return;}
      var count=Object.keys(envelope.recipes).length;
      if(!confirm('Put every recipe back to '+new Date(envelope.takenAt||0).toLocaleString()+'?\n\n'+count+' recipes will replace what is in the system now. Anything you changed since then is lost.'))return;
      var a=A();
      a.set(a.ref(a.db,'recipes'),envelope.recipes).then(function(){
        recTempPlanCache=null;
        alert('Restored. '+count+' recipes are back exactly as they were at '+new Date(envelope.takenAt||0).toLocaleString()+'.');
        setTimeout(renderRecipes,300);
      }).catch(function(e){
        alert('The restore did NOT go through: '+((e&&e.code)||(e&&e.message)||e)+'\n\nNothing was changed. Log in with your admin email and try again.');
      });
    });
  };
  reader.onerror=function(){alert('That file could not be read. Nothing was changed.');};
  reader.readAsText(file);
}
function recTempApplyRepair(){
  if(recTempBusy)return;
  var plan=recTempPlanCache||recTempBuildPlan();
  var paths=Object.keys(plan.updates||{});
  if(!paths.length){alert('There is nothing to repair.');return;}
  if(!recTempSnapshotTaken){alert('Save a restore point first. That file is how you undo this.');return;}
  if(!confirm('Repair '+plan.drinks.length+' drink'+(plan.drinks.length===1?'':'s')+'?\n\n'
    +'Their Hot and Iced choices are rewritten as the difference from the base recipe. Base recipes are not touched.\n\n'
    +'Orders already rung up keep the cost they were posted with — this changes future orders only.'))return;
  recTempBusy=true;
  var btn=document.getElementById('recTempApply'); if(btn){btn.disabled=true;btn.textContent='Repairing…';}
  var a=A();
  a.update(a.ref(a.db,'/'),plan.updates).then(function(){
    recTempBusy=false;recTempPlanCache=null;
    alert('Repaired '+plan.drinks.length+' drink'+(plan.drinks.length===1?'':'s')+'.\n\nA hot drink now costs the hot recipe once, and draws its ingredients once. Ring up one hot drink and check the cost before you close for the day.');
    setTimeout(renderRecipes,400);
  }).catch(function(e){
    recTempBusy=false;
    if(btn){btn.disabled=false;btn.textContent='✓ Repair these recipes';}
    alert('The repair was NOT applied: '+((e&&e.code)||(e&&e.message)||e)+'\n\nEvery recipe is unchanged. Log in with your admin email and try again.');
  });
}
function recTempRow(d){
  var before=recipesMap,after=recTempEngine().applyToRecipes(recipesMap,{drinks:[d]});
  var hotBefore=recTempCost(before,d.key,'M',['Hot']),hotAfter=recTempCost(after,d.key,'M',['Hot']);
  var icedBefore=recTempCost(before,d.key,'M',['Iced']),icedAfter=recTempCost(after,d.key,'M',['Iced']);
  var why=d.kind==='full-copy'?'Hot repeated the whole recipe':'';
  if(d.duplicateIce)why=why?why+'; ice counted twice on Iced':'Ice counted twice on Iced';
  return '<tr><td>'+esc(recTempName(d.key))+'</td><td style="color:var(--tl);font-size:0.8rem;">'+esc(why)+'</td>'
    +'<td class="r">'+peso(hotBefore)+'</td><td class="r" style="font-weight:600;">'+peso(hotAfter)+'</td>'
    +'<td class="r" style="color:'+(hotAfter<hotBefore?'#1C6B54':'var(--tl)')+';">'+peso(hotAfter-hotBefore)+'</td>'
    +'<td class="r">'+peso(icedBefore)+'</td><td class="r" style="font-weight:600;">'+peso(icedAfter)+'</td></tr>';
}
function renderRecipeRepair(){
  var host=document.getElementById('recRepairRoot'); if(!host)return;
  var plan;
  try{plan=recTempBuildPlan();}
  catch(e){host.innerHTML='<div class="pz-card" style="border-color:#f1b7b7;background:#fff5f5;color:#8b1e1e;">'+esc((e&&e.message)||e)+'</div>';return;}
  var drinks=plan.drinks||[];
  var swing=drinks.reduce(function(sum,d){
    var after=recTempEngine().applyToRecipes(recipesMap,{drinks:[d]});
    return sum+(recTempCost(recipesMap,d.key,'M',['Hot'])-recTempCost(after,d.key,'M',['Hot']));
  },0);
  var html='';
  html+='<p class="pz-sub">A drink’s Hot or Iced choice is meant to say what is <b>different</b> about it. On some drinks the whole recipe was typed into the Hot choice instead, and the system adds that on top of the base — so a hot drink was costed twice and pulled its ingredients from stock twice. This screen fixes that, and only that.</p>';

  html+='<div class="pz-card" style="margin-bottom:1rem;border-left:4px solid #1C6B54;">'
    +'<div style="font-weight:700;color:var(--bd);">Step 1 — Save a restore point</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Downloads every recipe exactly as it stands right now. If anything looks wrong afterwards, load that file back below and you are where you started. The repair stays locked until you do this.</div>'
    +'<button class="pz-btn" id="recTempSnapshot"'+(recTempSnapshotTaken?' disabled':'')+'>'+(recTempSnapshotTaken?'✓ Restore point saved':'⬇ Save a restore point')+'</button>'
    +'</div>';

  if(!drinks.length){
    html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:#1C6B54;">✓ Nothing to repair</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin-top:0.35rem;">Every temperature choice already reads as a difference from its base recipe.</div></div>';
  }else{
    html+='<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.15rem;">Step 2 — What changes</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.6rem;">'+drinks.length+' drink'+(drinks.length===1?'':'s')+'. Costs shown at size M. Base recipes are not touched, so a drink’s plain cost cannot move.</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Drink</th><th>What was wrong</th><th class="r">Hot now</th><th class="r">Hot after</th><th class="r">Change</th><th class="r">Iced now</th><th class="r">Iced after</th></tr></thead><tbody>'
      +drinks.map(recTempRow).join('')+'</tbody></table></div>'
      +'<div style="font-size:0.85rem;margin-top:0.6rem;padding:0.5rem 0.7rem;background:#f6f8f6;border-radius:6px;">Overcharge removed from one size-M hot order of each drink: <b>'+peso(swing)+'</b>. Orders already rung up keep the cost they were posted with — the books are not rewritten.</div>'
      +'</div>';
    html+='<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="font-weight:700;color:var(--bd);">Step 3 — Repair</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">'+(recTempSnapshotTaken?'Writes all '+Object.keys(plan.updates).length+' changes in one go — either every one lands or none does.':'Save the restore point above first.')+'</div>'
      +'<button class="pz-btn ok" id="recTempApply"'+(recTempSnapshotTaken?'':' disabled')+'>✓ Repair these recipes</button>'
      +'</div>';
  }

  html+='<div class="pz-card" style="margin-bottom:1rem;border-left:4px solid #8a6d3b;">'
    +'<div style="font-weight:700;color:var(--bd);">Cost of sales already posted twice</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Repairing the recipes fixes tomorrow. This looks at what is already in the books and puts the stock back.</div>'
    +'<div id="cogsFixRoot"></div>'
    +'</div>';
  html+='<div class="pz-card" style="border-left:4px solid #b5651d;">'
    +'<div style="font-weight:700;color:var(--bd);">Undo — restore from a saved file</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Puts every recipe back to the moment that file was saved. Use it any time, not just today.</div>'
    +'<input type="file" accept="application/json,.json" id="recTempRestore" class="pz-in" style="max-width:420px;"/>'
    +'</div>';
  host.innerHTML=html;
  var snap=document.getElementById('recTempSnapshot'); if(snap&&!recTempSnapshotTaken)snap.onclick=recTempDownloadRestorePoint;
  var apply=document.getElementById('recTempApply'); if(apply)apply.onclick=recTempApplyRepair;
  var restore=document.getElementById('recTempRestore'); if(restore)restore.onchange=function(){recTempRestoreFromFile(restore.files&&restore.files[0]);};
  cogsFixRun();
}

/* ---- Correcting the COGS that was already posted twice ---------------------------------- */
var cogsFixOrders=null, cogsFixResult=null, cogsFixBusy=false;

function cogsFixEngine(){
  if(!window.AccazaCogsDuplicationAudit)throw new Error('The COGS audit did not load. Refresh the portal and try again.');
  return window.AccazaCogsDuplicationAudit;
}
function cogsFixLoadOrders(){
  if(cogsFixOrders)return Promise.resolve(cogsFixOrders);
  var a=A();
  return Promise.all([
    a.get(a.ref(a.db,'archivedOrders')).then(function(s){return s.val()||{};}).catch(function(){return {};}),
    a.get(a.ref(a.db,'orders')).then(function(s){return s.val()||{};}).catch(function(){return {};})
  ]).then(function(parts){
    var all={};
    parts.forEach(function(set){Object.keys(set).forEach(function(id){all[id]=set[id];});});
    cogsFixOrders=all;return all;
  });
}
function cogsFixRun(){
  var host=document.getElementById('cogsFixRoot'); if(!host)return;
  host.innerHTML='<div style="color:var(--tl);font-size:0.85rem;">Reading every posted order…</div>';
  cogsFixLoadOrders().then(function(orders){
    var engine=cogsFixEngine();
    var audit=engine.audit(orders);
    cogsFixResult=engine.movements(audit,inventoryMap,{actorName:(window.__posShift&&window.__posShift.staff)||'Admin'});
    cogsFixResult.audit=audit;
    cogsFixRender();
  }).catch(function(e){
    host.innerHTML='<div style="color:#8b1e1e;font-size:0.85rem;">Could not read the posted orders: '+esc((e&&e.message)||e)+'</div>';
  });
}
function cogsFixRender(){
  var host=document.getElementById('cogsFixRoot'); if(!host||!cogsFixResult)return;
  var r=cogsFixResult,a=r.audit;
  if(!r.schedule.length){
    host.innerHTML='<div style="font-weight:700;color:#1C6B54;">✓ Nothing to correct</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin-top:0.35rem;">'+a.ordersRead+' posted orders read. No order was charged for the same ingredient twice.</div>';
    return;
  }
  var months={};r.schedule.forEach(function(s){months[s.month]=(months[s.month]||0)+s.expensed;});
  var html='';
  html+='<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.6rem;">Read '+a.ordersRead+' posted orders. '+a.linesCorrected+' drink line'+(a.linesCorrected===1?'':'s')+' paid for the same ingredient twice — once from the base recipe and again from the Hot choice. The stock never left the shelf, so it goes back and the cost of sales comes down.</div>';
  html+='<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Month</th><th>Ingredient</th><th class="r">Put back</th><th class="r">Charged</th><th class="r">Value today</th><th class="r">Cost drift</th></tr></thead><tbody>';
  r.schedule.forEach(function(s){
    html+='<tr><td>'+esc(s.month)+'</td><td>'+esc(s.name)+'</td>'
      +'<td class="r">'+esc(String(Math.round(s.qty*1000)/1000)+' '+s.unit)+'</td>'
      +'<td class="r">'+peso(s.expensed)+'</td><td class="r" style="font-weight:600;">'+peso(s.restored)+'</td>'
      +'<td class="r" style="color:var(--tl);">'+peso(s.residual)+'</td></tr>';
  });
  html+='</tbody></table></div>';
  html+='<div style="font-size:0.85rem;margin-top:0.7rem;padding:0.6rem 0.75rem;background:#f6f8f6;border-radius:6px;line-height:1.7;">'
    +'<b>What gets posted</b><br/>'
    +'Debit 1200 Inventory <b>'+peso(r.restoredValue)+'</b> · Credit 5000 Cost of Sales <b>'+peso(r.restoredValue)+'</b>'
    +'<br/><span style="color:var(--tm);">One stock adjustment per ingredient per month, dated into that month, so each period carries its own correction.</span>'
    +'<br/><br/><b>Left over: '+peso(r.residualValue)+'</b><br/>'
    +'<span style="color:var(--tm);">Charged at '+peso(r.historicCost)+' when it was rung up, worth '+peso(r.restoredValue)+' at today’s weighted average. That gap is real — the stock lost value while it sat wrongly expensed. It is <b>not</b> posted here. Post it in Books as a manual entry: debit 5905 Inventory Reconciliation, credit 5000 Cost of Sales, '+peso(r.residualValue)+'.</span>'
    +'</div>';
  if(a.skipped.length){
    html+='<div style="font-size:0.82rem;margin-top:0.6rem;padding:0.55rem 0.7rem;background:#fff8ec;border:1px solid #e6cfa4;border-radius:6px;">'
      +'<b>'+a.skipped.length+' line'+(a.skipped.length===1?'':'s')+' left alone.</b> The customer also chose an extra, so the second helping of that ingredient may have been genuine. Worth '+peso(a.skipped.reduce(function(s,x){return s+x.cost;},0))+' — check by hand: '
      +esc(a.skipped.slice(0,4).map(function(x){return x.drink+' ('+x.labels+')';}).join('; '))+(a.skipped.length>4?' …':'')+'</div>';
  }
  html+='<div style="margin-top:0.8rem;"><button class="pz-btn ok" id="cogsFixPost">✓ Post the correction — '+peso(r.restoredValue)+'</button>'
    +'<span style="font-size:0.78rem;color:var(--tl);margin-left:0.6rem;">Safe to press twice; a correction already posted is never posted again.</span></div>';
  host.innerHTML=html;
  var btn=document.getElementById('cogsFixPost'); if(btn)btn.onclick=cogsFixPost;
}
function cogsFixPost(){
  if(cogsFixBusy||!cogsFixResult)return;
  var r=cogsFixResult;
  if(!confirm('Post '+r.movements.length+' stock corrections?\n\n'
    +'Debit 1200 Inventory '+peso(r.restoredValue)+'\nCredit 5000 Cost of Sales '+peso(r.restoredValue)+'\n\n'
    +'Each one is dated into the month it belongs to. The '+peso(r.residualValue)+' cost drift is NOT included — post that in Books yourself.'))return;
  cogsFixBusy=true;
  var btn=document.getElementById('cogsFixPost'); if(btn){btn.disabled=true;btn.textContent='Posting…';}
  postMovements(r.movements.slice()).then(function(out){
    cogsFixBusy=false;cogsFixOrders=null;
    alert('Posted '+out.count+' correction'+(out.count===1?'':'s')+'.'
      +(out.duplicates?'\n'+out.duplicates+' were already posted earlier and were skipped.':'')
      +'\n\nInventory is up '+peso(r.restoredValue)+' and cost of sales is down the same. Check Books → Journal for the entries.'
      +'\n\nStill to do by hand: debit 5905, credit 5000, '+peso(r.residualValue)+' for the cost drift.');
    cogsFixRun();
  }).catch(function(e){
    cogsFixBusy=false;
    if(btn){btn.disabled=false;btn.textContent='✓ Post the correction — '+peso(r.restoredValue);}
    alert('Nothing was posted: '+((e&&e.message)||(e&&e.code)||e)+'\n\nThe books are unchanged.');
  });
}
