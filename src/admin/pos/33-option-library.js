
/* Moving customer choices into the shared library.
   A syrup is the same syrup whichever drink it goes in, yet each drink spells it out for itself.
   This lifts the definition most drinks agree on into one shared entry and removes the copies
   that match it. It is NOT free of consequence: a shared definition applies to every drink that
   offers the choice, including drinks that never had one. So it is chosen one choice at a time,
   with what each one costs shown, and nothing is written until a restore point has been saved. */
var optLibPlan=null, optLibPicked=null, optLibSnapshotTaken=false, optLibBusy=false, optLibImpact=null;

function optLibEngine(){
  if(!window.AccazaOptionLibraryPlan)throw new Error('The option library planner did not load. Refresh the portal and try again.');
  return window.AccazaOptionLibraryPlan;
}
function optLibBuild(){
  optLibPlan=optLibEngine().plan(recipesMap,inventoryMap,(A()&&A().menuItemsMap)||{},{optionCosts:optCostStore()||{}});
  if(!optLibPicked){optLibPicked={};}
  return optLibPlan;
}
function optLibSnapshot(){
  var btn=document.getElementById('optLibSnap'); if(btn){btn.disabled=true;btn.textContent='Preparing…';}
  var a=A();
  Promise.all([
    a.get(a.ref(a.db,'recipes')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'posSettings/optionCosts')).then(function(s){return s.val()||{};}).catch(function(){return {};})
  ]).then(function(parts){
    var payload={recipes:parts[0],optionCosts:parts[1]};
    return recTempSeal(payload).then(function(hash){
      var takenAt=Date.now();
      var envelope={version:'accaza-option-library-restore-v1',kind:'accaza-option-library-restore-point',
        takenAt:takenAt,takenAtISO:new Date(takenAt).toISOString(),
        counts:{recipes:Object.keys(payload.recipes).length},
        integrity:{algorithm:'sha256',canonical:'sorted-json-v1',dataSha256:hash},
        note:'Recipes and the shared option library exactly as they stood before choices were moved into the library. Load this back on the same screen to undo it.',
        data:payload};
      var blob=new Blob([JSON.stringify(envelope)],{type:'application/json'}),url=URL.createObjectURL(blob);
      var stamp=new Date(takenAt).toISOString().slice(0,19).replace(/[:T]/g,'-');
      var link=document.createElement('a');link.href=url;link.download='accaza-options-before-'+stamp+'.json';
      document.body.appendChild(link);link.click();document.body.removeChild(link);
      setTimeout(function(){URL.revokeObjectURL(url);},4000);
      optLibSnapshotTaken=true;renderOptionLibrary();
      alert('Restore point saved. Keep that file until you are happy with the result.');
    });
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='⬇ Save a restore point';}
    alert('Could not build the restore point: '+((e&&e.message)||e)+'\n\nNothing was changed.');
  });
}
function optLibRestore(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(){
    var envelope;
    try{envelope=JSON.parse(String(reader.result));}catch(e){alert('That file is not a restore point. Nothing was changed.');return;}
    if(!envelope||envelope.version!=='accaza-option-library-restore-v1'||!envelope.data){alert('That file is not an Accaza option restore point. Nothing was changed.');return;}
    recTempSeal(envelope.data).then(function(hash){
      var sealed=envelope.integrity&&envelope.integrity.dataSha256;
      if(sealed&&sealed!==hash){alert('That restore point has been altered since it was saved. Nothing was changed.');return;}
      if(!confirm('Put the recipes and the option library back to '+new Date(envelope.takenAt||0).toLocaleString()+'?\n\nAnything changed since then is lost.'))return;
      var a=A();
      a.update(a.ref(a.db,'/'),{recipes:envelope.data.recipes,'posSettings/optionCosts':envelope.data.optionCosts||null}).then(function(){
        optLibPlan=null;optLibPicked=null;optLibImpact=null;
        alert('Restored to '+new Date(envelope.takenAt||0).toLocaleString()+'.');
        setTimeout(renderRecipes,300);
      }).catch(function(e){alert('The restore did NOT go through: '+((e&&e.code)||(e&&e.message)||e)+'\n\nNothing was changed.');});
    });
  };
  reader.readAsText(file);
}
/* What one choice would do to the menu if it moved into the library, on its own. */
function optLibMeasure(entry){
  var menu=(A()&&A().menuItemsMap)||{},groups=(A()&&A().optionGroupsMap)||{},costs=optCostStore()||{};
  var after=optLibEngine().applyTo(recipesMap,{updates:entry.updates});
  var library={};library[entry.gid]={};library[entry.gid][entry.key]={label:entry.label,ings:entry.rows};
  var newlyCosted=0,newlyValue=0,moved=0,movedValue=0,refused=0,drinks=[];
  Object.keys(recipesMap).forEach(function(key){
    var item=menu[key];if(!item)return;
    if(!Array.isArray(item.options)||item.options.indexOf(entry.gid)<0)return;
    var group=groups[entry.gid]||{},choices=Array.isArray(group.choices)?group.choices:[];
    var label=null;
    choices.forEach(function(c){if(Costing().optKey(c.label)===entry.key)label=c.label;});
    if(!label)return;
    ['S','M','L'].forEach(function(size){
      var before=Costing().costOrder(costingContext({recipes:recipesMap,optionCosts:costs,packagingRules:{},lineItems:[{itemKey:key,size:size,qty:1,optLabels:[label]}]}));
      var now=Costing().costOrder(costingContext({recipes:after,optionCosts:library,packagingRules:{},lineItems:[{itemKey:key,size:size,qty:1,optLabels:[label]}]}));
      var plain=Costing().costOrder(costingContext({recipes:recipesMap,optionCosts:costs,packagingRules:{},lineItems:[{itemKey:key,size:size,qty:1,optLabels:[]}]}));
      if(now.errors.length&&!before.errors.length){refused++;return;}
      var delta=now.totalCost-before.totalCost;
      if(Math.abs(delta)<0.011)return;
      var wasFree=Math.abs(before.totalCost-plain.totalCost)<0.011;
      if(wasFree){newlyCosted++;newlyValue+=delta;}else{moved++;movedValue+=delta;}
      if(size==='M'&&drinks.length<6)drinks.push(String(item.name||key)+' '+peso(before.totalCost)+' → '+peso(now.totalCost));
    });
  });
  return {newlyCosted:newlyCosted,newlyValue:newlyValue,moved:moved,movedValue:movedValue,refused:refused,drinks:drinks};
}
function optLibMeasureAll(plan){
  optLibImpact={};
  plan.entries.forEach(function(entry){
    try{optLibImpact[entry.id]=optLibMeasure(entry);}
    catch(e){optLibImpact[entry.id]={error:String((e&&e.message)||e)};}
  });
  return optLibImpact;
}
function renderOptionLibrary(){
  var host=document.getElementById('optLibraryRoot'); if(!host)return;
  var plan;
  try{plan=optLibBuild();}
  catch(e){host.innerHTML='<div class="pz-card" style="border-color:#f1b7b7;background:#fff5f5;color:#8b1e1e;">'+esc((e&&e.message)||e)+'</div>';return;}
  var html='';
  html+='<p class="pz-sub">A syrup is the same syrup whichever drink it goes in — yet each drink spells it out for itself. <b>'+plan.summary.definitions+'</b> choices are stored <b>'+plan.summary.copies+'</b> times, and <b>'+plan.summary.disagreeing+'</b> of them disagree with themselves from one drink to the next. Move a choice into the shared library and there is one definition to keep right instead of twenty.</p>';
  html+='<div class="pz-card" style="margin-bottom:1rem;border-left:4px solid #8a6d3b;font-size:0.85rem;color:var(--tm);">'
    +'<b>Read this before ticking anything.</b> A shared definition applies to <i>every</i> drink that offers the choice — including drinks that never had that choice costed. For some that is the whole point: a syrup should cost the syrup. For others it is wrong: adding sweetener to a drink whose recipe already includes it counts it twice. Each row below shows exactly what it would do.</div>';
  html+='<div class="pz-card" style="margin-bottom:1rem;border-left:4px solid #1C6B54;">'
    +'<div style="font-weight:700;color:var(--bd);">Step 1 — Save a restore point</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">The recipes and the option library as they stand. Loading it back below undoes everything on this screen.</div>'
    +'<button class="pz-btn" id="optLibSnap"'+(optLibSnapshotTaken?' disabled':'')+'>'+(optLibSnapshotTaken?'✓ Restore point saved':'⬇ Save a restore point')+'</button></div>';

  if(!optLibImpact){
    html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);">Step 2 — Work out what each choice would do</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Prices every drink that offers each choice, at all three sizes, before and after. Takes a moment.</div>'
      +'<button class="pz-btn" id="optLibMeasure">Work it out</button></div>';
    host.innerHTML=html;
    var s1=document.getElementById('optLibSnap'); if(s1&&!optLibSnapshotTaken)s1.onclick=optLibSnapshot;
    var m1=document.getElementById('optLibMeasure');
    if(m1)m1.onclick=function(){m1.disabled=true;m1.textContent='Working…';setTimeout(function(){optLibMeasureAll(plan);renderOptionLibrary();},50);};
    return;
  }

  var pickedCount=0;
  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.15rem;">Step 2 — Choose which ones move</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.6rem;">Nothing is ticked to begin with. Tick only the ones you are happy with.</div>'
    +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th></th><th>Choice</th><th class="r">Copies</th><th class="r">Agree</th><th class="r">Keep own</th><th>Shared definition</th><th>What it would do</th></tr></thead><tbody>';
  plan.entries.slice().sort(function(a,b){return b.copies-a.copies;}).forEach(function(entry){
    var impact=optLibImpact[entry.id]||{},picked=!!optLibPicked[entry.id];
    if(picked)pickedCount++;
    var note;
    if(impact.error)note='<span style="color:#8b1e1e;">could not be worked out: '+esc(impact.error)+'</span>';
    else if(impact.refused)note='<span style="color:#8b1e1e;font-weight:600;">'+impact.refused+' combinations would be refused — do not move this one</span>';
    else if(!impact.newlyCosted&&!impact.moved)note='<span style="color:#1C6B54;">nothing changes — safe</span>';
    else{
      note='';
      if(impact.newlyCosted)note+='<span style="color:#8a5a00;">'+impact.newlyCosted+' combinations start costing '+peso(impact.newlyValue)+' in total</span>';
      if(impact.moved)note+=(note?'<br/>':'')+'<span style="color:var(--tm);">'+impact.moved+' already costed and move '+peso(impact.movedValue)+'</span>';
      if(impact.drinks&&impact.drinks.length)note+='<br/><span style="font-size:0.72rem;color:var(--tl);">'+esc(impact.drinks.join(' · '))+'</span>';
    }
    html+='<tr><td><input type="checkbox" data-optlib="'+esc(entry.id)+'"'+(picked?' checked':'')+(impact.refused?' disabled':'')+'/></td>'
      +'<td><b>'+esc(entry.label)+'</b><br/><span style="font-size:0.72rem;color:var(--tl);">'+esc(entry.gid)+'</span></td>'
      +'<td class="r">'+entry.copies+'</td><td class="r">'+entry.agreed+'</td>'
      +'<td class="r">'+(entry.overrides.length?'<span title="'+esc(entry.overrides.map(function(d){return d.name;}).join(', '))+'">'+entry.overrides.length+'</span>':'—')+'</td>'
      +'<td style="font-size:0.78rem;">'+esc(entry.rows.map(function(r){var inv=inventoryMap[r.ing]||{};return (r.op==='reduce'?'less ':'')+(inv.name||r.ing)+' '+r.qtyM;}).join(', '))+'</td>'
      +'<td style="font-size:0.78rem;">'+note+'</td></tr>';
  });
  html+='</tbody></table></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.6rem;">'
    +'<button class="pz-btn sec" id="optLibPickSafe" style="padding:0.25rem 0.7rem;">Tick only the ones that change nothing</button>'
    +'<button class="pz-btn sec" id="optLibPickNone" style="padding:0.25rem 0.7rem;">Untick everything</button>'
    +'<button class="pz-btn sec" id="optLibRemeasure" style="padding:0.25rem 0.7rem;">↻ Work it out again</button></div>'
    +'</div>';

  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);">Step 3 — Move them</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">'
    +(optLibSnapshotTaken?(pickedCount?pickedCount+' choice'+(pickedCount===1?'':'s')+' ticked. Their shared definition is written and the matching copies are removed from the recipes. A drink that spells the choice out differently keeps its own — it overrides the library.':'Tick at least one choice above.'):'Save the restore point above first.')
    +'</div>'
    +'<button class="pz-btn ok" id="optLibApply"'+(optLibSnapshotTaken&&pickedCount?'':' disabled')+'>✓ Move '+(pickedCount||'')+' into the library</button></div>';

  html+='<div class="pz-card" style="border-left:4px solid #b5651d;"><div style="font-weight:700;color:var(--bd);">Undo — restore from a saved file</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Puts the recipes and the option library back to the moment that file was saved.</div>'
    +'<input type="file" accept="application/json,.json" id="optLibRestoreFile" class="pz-in" style="max-width:420px;"/></div>';

  host.innerHTML=html;
  var snap=document.getElementById('optLibSnap'); if(snap&&!optLibSnapshotTaken)snap.onclick=optLibSnapshot;
  host.querySelectorAll('[data-optlib]').forEach(function(box){
    box.onchange=function(){optLibPicked[box.getAttribute('data-optlib')]=box.checked;renderOptionLibrary();};
  });
  var safe=document.getElementById('optLibPickSafe');
  if(safe)safe.onclick=function(){
    optLibPicked={};
    plan.entries.forEach(function(e){var i=optLibImpact[e.id]||{};if(!i.error&&!i.refused&&!i.newlyCosted&&!i.moved)optLibPicked[e.id]=true;});
    renderOptionLibrary();
  };
  var none=document.getElementById('optLibPickNone');
  if(none)none.onclick=function(){optLibPicked={};renderOptionLibrary();};
  var again=document.getElementById('optLibRemeasure');
  if(again)again.onclick=function(){optLibImpact=null;optLibPlan=null;renderOptionLibrary();};
  var apply=document.getElementById('optLibApply'); if(apply)apply.onclick=optLibApply;
  var restore=document.getElementById('optLibRestoreFile'); if(restore)restore.onchange=function(){optLibRestore(restore.files&&restore.files[0]);};
}
function optLibApply(){
  if(optLibBusy)return;
  var plan=optLibPlan||optLibBuild();
  var picked=Object.keys(optLibPicked||{}).filter(function(id){return optLibPicked[id];});
  if(!picked.length){alert('Tick at least one choice first.');return;}
  if(!optLibSnapshotTaken){alert('Save a restore point first. That file is how you undo this.');return;}
  var composed=optLibEngine().updatesFor(plan,picked);
  var names=plan.entries.filter(function(e){return optLibPicked[e.id];}).map(function(e){return e.label;});
  if(!confirm('Move '+picked.length+' choice'+(picked.length===1?'':'s')+' into the shared library?\n\n'
    +names.join(', ')+'\n\n'
    +'Their definition is written once and the matching copies come out of the recipes. A drink that spells a choice out differently keeps its own.\n\n'
    +'Completed orders keep the cost they were posted with.'))return;
  optLibBusy=true;
  var btn=document.getElementById('optLibApply'); if(btn){btn.disabled=true;btn.textContent='Moving…';}
  var a=A();
  a.update(a.ref(a.db,'/'),composed.updates).then(function(){
    optLibBusy=false;optLibPlan=null;optLibPicked=null;optLibImpact=null;
    alert('Moved '+picked.length+' choice'+(picked.length===1?'':'s')+' into the shared library.\n\nEdit them from now on in this tab — one place, not one per drink.');
    setTimeout(renderRecipes,400);
  }).catch(function(e){
    optLibBusy=false;
    if(btn){btn.disabled=false;btn.textContent='✓ Move '+picked.length+' into the library';}
    alert('Nothing was changed: '+((e&&e.code)||(e&&e.message)||e)+'\n\nLog in with your admin email and try again.');
  });
}
