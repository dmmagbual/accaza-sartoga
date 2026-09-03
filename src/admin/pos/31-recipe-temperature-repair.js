
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

  html+='<div class="pz-card" style="border-left:4px solid #b5651d;">'
    +'<div style="font-weight:700;color:var(--bd);">Undo — restore from a saved file</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Puts every recipe back to the moment that file was saved. Use it any time, not just today.</div>'
    +'<input type="file" accept="application/json,.json" id="recTempRestore" class="pz-in" style="max-width:420px;"/>'
    +'</div>';
  host.innerHTML=html;
  var snap=document.getElementById('recTempSnapshot'); if(snap&&!recTempSnapshotTaken)snap.onclick=recTempDownloadRestorePoint;
  var apply=document.getElementById('recTempApply'); if(apply)apply.onclick=recTempApplyRepair;
  var restore=document.getElementById('recTempRestore'); if(restore)restore.onchange=function(){recTempRestoreFromFile(restore.files&&restore.files[0]);};
}
