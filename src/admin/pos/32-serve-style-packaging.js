
/* Packaging by serve style.
   A cup, lid and straw depend on how a drink is served, not on which drink it is. This screen
   collapses the packaging scattered through the recipes into three serve styles, shows what
   every drink costs before and after, and only then writes. A restore point is required first. */
var packStyleSnapshotTaken=false, packStylePlan=null, packStyleBusy=false, packStyleRules=null;

function packStyleEngine(){
  if(!window.AccazaServeStylePlan)throw new Error('The packaging planner did not load. Refresh the portal and try again.');
  return window.AccazaServeStylePlan;
}
function packStyleCategories(){return (posMeta&&posMeta.invCategories)||(A()&&A().invCategories)||{};}
function packStyleBuild(){
  packStylePlan=packStyleEngine().applyPlan(recipesMap,inventoryMap,(A()&&A().menuItemsMap)||{},packStyleCategories());
  return packStylePlan;
}
function packStyleSnapshot(){
  var btn=document.getElementById('packSnapshot'); if(btn){btn.disabled=true;btn.textContent='Preparing…';}
  var a=A();
  Promise.all([
    a.get(a.ref(a.db,'recipes')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'menuItems')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'optionGroups')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'packagingRules')).then(function(s){return s.val()||{};}).catch(function(){return {};})
  ]).then(function(parts){
    var payload={recipes:parts[0],menuItems:parts[1],optionGroups:parts[2],packagingRules:parts[3]};
    return recTempSeal(payload).then(function(hash){
      var takenAt=Date.now();
      var envelope={version:'accaza-packaging-restore-v1',kind:'accaza-packaging-restore-point',takenAt:takenAt,
        takenAtISO:new Date(takenAt).toISOString(),
        counts:{recipes:Object.keys(payload.recipes).length,menuItems:Object.keys(payload.menuItems).length,optionGroups:Object.keys(payload.optionGroups).length},
        integrity:{algorithm:'sha256',canonical:'sorted-json-v1',dataSha256:hash},
        note:'Recipes, menu items, option groups and packaging rules exactly as they stood before packaging moved to serve styles. Load this back on the same screen to undo it completely.',
        data:payload};
      var blob=new Blob([JSON.stringify(envelope)],{type:'application/json'}),url=URL.createObjectURL(blob);
      var stamp=new Date(takenAt).toISOString().slice(0,19).replace(/[:T]/g,'-');
      var link=document.createElement('a');link.href=url;link.download='accaza-packaging-before-'+stamp+'.json';
      document.body.appendChild(link);link.click();document.body.removeChild(link);
      setTimeout(function(){URL.revokeObjectURL(url);},4000);
      packStyleSnapshotTaken=true;renderServeStylePackaging();
      alert('Restore point saved. Keep that file until you are happy with the packaging.');
    });
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='⬇ Save a restore point';}
    alert('Could not build the restore point: '+((e&&e.message)||e)+'\n\nNothing was changed.');
  });
}
function packStyleRestore(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(){
    var envelope;
    try{envelope=JSON.parse(String(reader.result));}catch(e){alert('That file is not a restore point. Nothing was changed.');return;}
    if(!envelope||envelope.version!=='accaza-packaging-restore-v1'||!envelope.data){alert('That file is not an Accaza packaging restore point. Nothing was changed.');return;}
    recTempSeal(envelope.data).then(function(hash){
      var sealed=envelope.integrity&&envelope.integrity.dataSha256;
      if(sealed&&sealed!==hash){alert('That restore point has been altered since it was saved. Nothing was changed.');return;}
      if(!confirm('Put recipes, menu items, option groups and packaging back to '+new Date(envelope.takenAt||0).toLocaleString()+'?\n\nAnything changed since then is lost.'))return;
      var a=A(),d=envelope.data;
      a.update(a.ref(a.db,'/'),{recipes:d.recipes,menuItems:d.menuItems,optionGroups:d.optionGroups,packagingRules:d.packagingRules||null}).then(function(){
        packStylePlan=null;
        alert('Restored to '+new Date(envelope.takenAt||0).toLocaleString()+'.');
        setTimeout(renderRecipes,300);
      }).catch(function(e){
        alert('The restore did NOT go through: '+((e&&e.code)||(e&&e.message)||e)+'\n\nNothing was changed.');
      });
    });
  };
  reader.readAsText(file);
}
function packStyleCost(plan,key,size,labels,useStyles){
  var recipes=recipesMap,menu=(A()&&A().menuItemsMap)||{},groups=(A()&&A().optionGroupsMap)||{},rules={};
  if(useStyles){
    recipes=JSON.parse(JSON.stringify(recipesMap));menu=JSON.parse(JSON.stringify(menu));groups=JSON.parse(JSON.stringify(groups));
    rules=plan.styles;
    Object.keys(plan.updates).forEach(function(path){
      var parts=path.split('/'),value=plan.updates[path];
      if(parts[0]==='recipes'){
        var recipe=recipes[parts[1]];if(!recipe)return;
        if(parts[2]==='base')recipe.base=value;
        else{var group=(recipe.choiceAdd||{})[parts[3]];if(!group)return;if(value)group[parts[4]]=value;else delete group[parts[4]];}
      }else if(parts[0]==='menuItems'){(menu[parts[1]]=menu[parts[1]]||{}).serveStyle=value;}
    });
    Object.keys(plan.choiceUpdates).forEach(function(gid){
      var group=groups[gid];if(!group||!Array.isArray(group.choices))return;
      group.choices.forEach(function(choice){var s=plan.choiceUpdates[gid][choice.label];if(s)choice.serveStyle=s;});
    });
  }
  var out=Costing().costOrder(costingContext({recipes:recipes,menuItems:menu,optionGroups:groups,packagingRules:rules,
    lineItems:[{itemKey:key,size:size,qty:1,optLabels:labels||[]}]}));
  return out.totalCost;
}
function renderServeStylePackaging(){
  var host=document.getElementById('packagingRoot'); if(!host)return;
  var plan;
  try{plan=packStyleBuild();}
  catch(e){host.innerHTML='<div class="pz-card" style="border-color:#f1b7b7;background:#fff5f5;color:#8b1e1e;">'+esc((e&&e.message)||e)+'</div>';return;}
  var menu=(A()&&A().menuItemsMap)||{},styleIds=Object.keys(plan.styles);
  var html='';
  html+='<p class="pz-sub">A cup, a lid and a straw depend on <b>how</b> a drink is served, not on which drink it is. Today the packaging is typed into each recipe by hand, so most drinks have none. This puts it in one place — change a cup once, every drink follows.</p>';

  html+='<div class="pz-card" style="margin-bottom:1rem;border-left:4px solid #1C6B54;">'
    +'<div style="font-weight:700;color:var(--bd);">Step 1 — Save a restore point</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Recipes, menu items, option groups and packaging as they stand now. Loading it back below undoes everything on this screen.</div>'
    +'<button class="pz-btn" id="packSnapshot"'+(packStyleSnapshotTaken?' disabled':'')+'>'+(packStyleSnapshotTaken?'✓ Restore point saved':'⬇ Save a restore point')+'</button></div>';

  if(!styleIds.length){
    html+='<div class="pz-card"><div style="font-weight:700;color:#8a6d3b;">No packaging found in any recipe</div>'
      +'<div style="font-size:0.85rem;color:var(--tm);margin-top:0.35rem;">There is nothing to collapse into serve styles yet. Add the cup, lid and straw to one drink of each kind first, then come back.</div></div>';
    host.innerHTML=html;
    var s0=document.getElementById('packSnapshot'); if(s0&&!packStyleSnapshotTaken)s0.onclick=packStyleSnapshot;
    return;
  }

  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.15rem;">Step 2 — The serve styles</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.6rem;">'+plan.proposal.styles.length+' different packaging sets are scattered through the recipes today. They collapse into '+styleIds.length+'. Each one is taken from what most of your drinks already do.</div>';
  styleIds.forEach(function(id){
    var style=plan.styles[id];
    html+='<div style="margin-bottom:0.7rem;"><div style="font-weight:600;color:var(--bd);">'+esc(style.name)+'</div>'
      +'<div style="font-size:0.8rem;color:var(--tl);margin-bottom:0.25rem;">'+esc(style.description)+'</div>'
      +'<table class="pz-tbl" style="max-width:520px;"><thead><tr><th>Item</th><th class="r">S</th><th class="r">M</th><th class="r">L</th></tr></thead><tbody>'
      +style.rows.map(function(r){var inv=inventoryMap[r.ing]||{};
        return '<tr><td>'+esc(inv.name||r.ing)+'</td><td class="r">'+esc(String(r.qtyS))+'</td><td class="r">'+esc(String(r.qtyM))+'</td><td class="r">'+esc(String(r.qtyL))+'</td></tr>';}).join('')
      +'</tbody></table></div>';
  });
  html+='</div>';

  var rows=[],added=0,covered=0,total=0;
  Object.keys(recipesMap).forEach(function(key){
    var item=menu[key];if(!item)return;
    var temp=Array.isArray(item.options)&&item.options.indexOf('og_temp')>=0;
    (temp?[['Hot'],['Iced']]:[[]]).forEach(function(labels){
      var before=packStyleCost(plan,key,'M',labels,false),after=packStyleCost(plan,key,'M',labels,true);
      total++;if(after>before+0.005)added+=(after-before);if(Math.abs(after-before)>0.005||before>0)covered++;
      rows.push({name:String(item.name||key),serve:labels[0]||'—',before:before,after:after});
    });
  });
  rows.sort(function(a,b){return (b.after-b.before)-(a.after-a.before);});
  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.15rem;">Step 3 — What it costs</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.6rem;">Every drink at size M. A drink that already carried its packaging does not move — that is the proof this only fills gaps.</div>'
    +'<div style="max-height:22rem;overflow:auto;"><table class="pz-tbl"><thead><tr><th>Drink</th><th>Served</th><th class="r">Now</th><th class="r">After</th><th class="r">Change</th></tr></thead><tbody>'
    +rows.map(function(r){var d=r.after-r.before;
      return '<tr><td>'+esc(r.name)+'</td><td style="color:var(--tl);">'+esc(r.serve)+'</td><td class="r">'+peso(r.before)+'</td><td class="r" style="font-weight:600;">'+peso(r.after)+'</td>'
        +'<td class="r" style="color:'+(d>0.005?'#8b1e1e':'var(--tl)')+';">'+(Math.abs(d)>0.005?peso(d):'—')+'</td></tr>';}).join('')
    +'</tbody></table></div>'
    +'<div style="font-size:0.85rem;margin-top:0.6rem;padding:0.55rem 0.7rem;background:#f6f8f6;border-radius:6px;">'
    +'True cost that was missing: <b>'+peso(added)+'</b> across '+total+' drink and serve combinations — about <b>'+peso(added/(total||1))+'</b> a cup on the drinks that had none. '
    +'This does not change a single price. It stops the margin on those drinks reading better than it is.</div>'
    +'<div style="font-size:0.85rem;margin-top:0.5rem;color:var(--tm);">'+plan.stripped.length+' recipes have their packaging rows removed, because the serve style supplies them now. Recipe ingredients are untouched.</div>'
    +'</div>';

  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);">Step 4 — Apply</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">'+(packStyleSnapshotTaken?'Writes all '+Object.keys(plan.updates).length+' changes in one go — either every one lands or none does. Completed orders keep the cost they were posted with.':'Save the restore point above first.')+'</div>'
    +'<button class="pz-btn ok" id="packApply"'+(packStyleSnapshotTaken?'':' disabled')+'>✓ Move packaging to serve styles</button></div>';

  html+='<div class="pz-card" style="border-left:4px solid #b5651d;"><div style="font-weight:700;color:var(--bd);">Undo — restore from a saved file</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Puts recipes, menu items, option groups and packaging back to the moment that file was saved.</div>'
    +'<input type="file" accept="application/json,.json" id="packRestore" class="pz-in" style="max-width:420px;"/></div>';

  host.innerHTML=html;
  var snap=document.getElementById('packSnapshot'); if(snap&&!packStyleSnapshotTaken)snap.onclick=packStyleSnapshot;
  var apply=document.getElementById('packApply'); if(apply)apply.onclick=packStyleApply;
  var restore=document.getElementById('packRestore'); if(restore)restore.onchange=function(){packStyleRestore(restore.files&&restore.files[0]);};
}
function packStyleApply(){
  if(packStyleBusy)return;
  var plan=packStylePlan||packStyleBuild();
  if(!packStyleSnapshotTaken){alert('Save a restore point first. That file is how you undo this.');return;}
  if(!confirm('Move packaging to serve styles?\n\n'
    +Object.keys(plan.styles).length+' serve styles created\n'
    +plan.stripped.length+' recipes have their packaging rows removed\n'
    +'Every drink is told how it is served\n\n'
    +'Completed orders keep the cost they were posted with. Future orders carry the true packaging cost.'))return;
  packStyleBusy=true;
  var btn=document.getElementById('packApply'); if(btn){btn.disabled=true;btn.textContent='Applying…';}
  var a=A(),groups=(A()&&A().optionGroupsMap)||{},updates={};
  Object.keys(plan.updates).forEach(function(path){updates[path]=plan.updates[path];});
  Object.keys(plan.choiceUpdates).forEach(function(gid){
    var group=groups[gid];if(!group||!Array.isArray(group.choices))return;
    var choices=JSON.parse(JSON.stringify(group.choices));
    choices.forEach(function(choice){var style=plan.choiceUpdates[gid][choice.label];if(style)choice.serveStyle=style;});
    updates['optionGroups/'+gid+'/choices']=choices;
  });
  a.update(a.ref(a.db,'/'),updates).then(function(){
    packStyleBusy=false;packStylePlan=null;
    alert('Done. Packaging now comes from '+Object.keys(plan.styles).length+' serve styles.\n\nRing up one hot drink and one iced drink and check the cup shows in the cost.');
    setTimeout(renderRecipes,400);
  }).catch(function(e){
    packStyleBusy=false;
    if(btn){btn.disabled=false;btn.textContent='✓ Move packaging to serve styles';}
    alert('Nothing was changed: '+((e&&e.code)||(e&&e.message)||e)+'\n\nLog in with your admin email and try again.');
  });
}
