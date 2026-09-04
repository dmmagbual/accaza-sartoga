
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
  var engine=packStyleEngine(),menu=(A()&&A().menuItemsMap)||{},cats=packStyleCategories();
  var costs=optCostStore()||{};
  var seed=engine.applyPlan(recipesMap,inventoryMap,menu,cats,{optionCosts:costs});
  var draft=packDraftInit(seed);
  /* Rebuild against the styles actually on screen, so what is assigned, stripped and priced is
     what the user is looking at - never what was proposed before they edited it. */
  packStylePlan=engine.applyPlan(recipesMap,inventoryMap,menu,cats,{styles:draft,optionCosts:costs});
  packStylePlan.proposal=seed.proposal;
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
    rules=packDraftInit(plan);
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

/* ---- The serve styles are yours to edit -------------------------------------------------
   Add an item, take one out, change a quantity, rename a style, add a whole new one. What is
   here to begin with is only what your recipes already did - it is a starting point, not a rule. */
var packDraft=null, packDraftSeeded=false;

function packDraftClone(value){return JSON.parse(JSON.stringify(value||{}));}
function packDraftInit(plan,force){
  if(packDraft&&!force)return packDraft;
  var live=(typeof packagingRulesMap==='object'&&packagingRulesMap)||{};
  packDraft=Object.keys(live).length?packDraftClone(live):packDraftClone(plan.styles);
  packDraftSeeded=!Object.keys(live).length;
  Object.keys(packDraft).forEach(function(id){
    var style=packDraft[id];
    style.rows=(style.rows||[]).map(function(r){
      var inv=inventoryMap[r.ing]||{};
      return {ing:r.ing,unit:r.unit||inv.unit||'',stockUnit:r.stockUnit||inv.unit||'',
        qtyS:Number(r.qtyS)||0,qtyM:Number(r.qtyM)||0,qtyL:Number(r.qtyL)||0};
    });
  });
  return packDraft;
}
/* Read every input back out of the screen, so nothing typed is lost when the view redraws. */
function packDraftRead(){
  if(!packDraft)return packDraft;
  Object.keys(packDraft).forEach(function(id){
    var nameEl=document.querySelector('[data-pack-name="'+id+'"]');
    if(nameEl)packDraft[id].name=String(nameEl.value||'').trim()||id;
    var noteEl=document.querySelector('[data-pack-note="'+id+'"]');
    if(noteEl)packDraft[id].description=String(noteEl.value||'').trim();
    (packDraft[id].rows||[]).forEach(function(row,ix){
      var pick=document.querySelector('[data-pack-ing="'+id+'|'+ix+'"]');
      if(pick){var chosen=String(pick.value||'');if(chosen){row.ing=chosen;var inv=inventoryMap[chosen]||{};row.unit=inv.unit||'';row.stockUnit=inv.unit||'';}}
      ['S','M','L'].forEach(function(size){
        var box=document.querySelector('[data-pack-qty="'+id+'|'+ix+'|'+size+'"]');
        if(box)row['qty'+size]=Number(box.value)||0;
      });
    });
  });
  return packDraft;
}
function packIngredientOptions(selected){
  var list=Object.keys(inventoryMap).map(function(id){return {id:id,name:String((inventoryMap[id]||{}).name||id),unit:String((inventoryMap[id]||{}).unit||'')};});
  list.sort(function(a,b){return a.name.localeCompare(b.name);});
  return '<option value="">— choose an item —</option>'+list.map(function(x){
    return '<option value="'+esc(x.id)+'"'+(x.id===selected?' selected':'')+'>'+esc(x.name)+(x.unit?' ('+esc(x.unit)+')':'')+'</option>';
  }).join('');
}
function packRowCost(row){
  var cost=Number((inventoryMap[row.ing]||{}).cost)||0;
  return {S:cost*(Number(row.qtyS)||0),M:cost*(Number(row.qtyM)||0),L:cost*(Number(row.qtyL)||0)};
}
function packStyleEditorHtml(plan){
  var draft=packDraftInit(plan),ids=Object.keys(draft);
  var html='<div class="pz-card" style="margin-bottom:1rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.15rem;">Step 2 — The serve styles</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin-bottom:0.7rem;">'
    +(packDraftSeeded
      ? plan.proposal.styles.length+' different packaging sets are scattered through the recipes today. They start out collapsed into '+ids.length+', taken from what most of your drinks already do — <b>change anything below</b>. Add an item, take one out, fix a quantity, or add a whole new style.'
      : 'These are your saved serve styles. Add an item, take one out, fix a quantity, or add a new style.')
    +'</div>';
  if(!ids.length){
    html+='<div style="font-size:0.85rem;color:var(--tm);padding:0.6rem;background:#fff8ec;border:1px solid #e6cfa4;border-radius:6px;">No serve styles yet. Add one below and put the cup, lid and straw in it.</div>';
  }
  ids.forEach(function(id){
    var style=draft[id],totals={S:0,M:0,L:0};
    (style.rows||[]).forEach(function(r){var c=packRowCost(r);totals.S+=c.S;totals.M+=c.M;totals.L+=c.L;});
    html+='<div style="border:1px solid var(--ln,#e3d9c8);border-radius:8px;padding:0.7rem;margin-bottom:0.7rem;">'
      +'<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.4rem;">'
      +'<input class="pz-in" data-pack-name="'+esc(id)+'" value="'+esc(style.name||id)+'" style="max-width:180px;font-weight:600;"/>'
      +'<span style="font-size:0.75rem;color:var(--tl);">id: '+esc(id)+'</span>'
      +'<button class="pz-btn warn" data-pack-delstyle="'+esc(id)+'" style="padding:0.15rem 0.55rem;margin-left:auto;">Remove this style</button></div>'
      +'<input class="pz-in" data-pack-note="'+esc(id)+'" value="'+esc(style.description||'')+'" placeholder="What is it, in plain words" style="margin-bottom:0.5rem;font-size:0.82rem;"/>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th style="min-width:200px;">Item</th><th class="r">S</th><th class="r">M</th><th class="r">L</th><th class="r">Cost M</th><th></th></tr></thead><tbody>';
    (style.rows||[]).forEach(function(row,ix){
      var cost=packRowCost(row),key=id+'|'+ix;
      html+='<tr><td><select class="pz-in" data-pack-ing="'+esc(key)+'">'+packIngredientOptions(row.ing)+'</select></td>'
        +['S','M','L'].map(function(size){
          return '<td class="r"><input class="pz-in" type="number" step="any" min="0" style="width:70px;text-align:right;" data-pack-qty="'+esc(key+'|'+size)+'" value="'+esc(String(row['qty'+size]))+'"/></td>';
        }).join('')
        +'<td class="r" style="color:var(--tl);">'+peso(cost.M)+'</td>'
        +'<td class="r"><button class="pz-btn warn" data-pack-delrow="'+esc(key)+'" style="padding:0.15rem 0.5rem;">✕</button></td></tr>';
    });
    html+='</tbody><tfoot><tr><td style="font-weight:600;">Cost of this style</td>'
      +'<td class="r" style="font-weight:600;">'+peso(totals.S)+'</td><td class="r" style="font-weight:600;">'+peso(totals.M)+'</td><td class="r" style="font-weight:600;">'+peso(totals.L)+'</td><td></td><td></td></tr></tfoot></table></div>'
      +'<button class="pz-btn sec" data-pack-addrow="'+esc(id)+'" style="padding:0.2rem 0.7rem;margin-top:0.4rem;">+ Add an item</button>'
      +'</div>';
  });
  html+='<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-top:0.5rem;">'
    +'<input class="pz-in" id="packNewStyle" placeholder="New style name, e.g. Takeaway bag" style="max-width:240px;"/>'
    +'<button class="pz-btn sec" id="packAddStyle" style="padding:0.3rem 0.8rem;">+ Add a serve style</button>'
    +'<button class="pz-btn" id="packRecalc" style="padding:0.3rem 0.8rem;">↻ Update the costs below</button>'
    +'<button class="pz-btn ok" id="packSaveStyles" style="padding:0.3rem 0.8rem;">Save the styles</button>'
    +'<button class="pz-btn sec" id="packReseed" style="padding:0.3rem 0.8rem;">Start again from my recipes</button>'
    +'</div>'
    +'<div style="font-size:0.78rem;color:var(--tl);margin-top:0.4rem;">Saving the styles alone changes no recipe and no drink cost — a drink only picks one up once you apply in step 4.</div>'
    +'</div>';
  return html;
}
function packStyleBindEditor(plan){
  var host=document.getElementById('packagingRoot'); if(!host)return;
  host.querySelectorAll('[data-pack-delrow]').forEach(function(btn){
    btn.onclick=function(){
      packDraftRead();
      var parts=btn.getAttribute('data-pack-delrow').split('|'),style=packDraft[parts[0]];
      if(style)style.rows.splice(Number(parts[1]),1);
      renderServeStylePackaging();
    };
  });
  host.querySelectorAll('[data-pack-addrow]').forEach(function(btn){
    btn.onclick=function(){
      packDraftRead();
      var style=packDraft[btn.getAttribute('data-pack-addrow')];
      if(style)(style.rows=style.rows||[]).push({ing:'',unit:'',stockUnit:'',qtyS:0,qtyM:0,qtyL:0});
      renderServeStylePackaging();
    };
  });
  host.querySelectorAll('[data-pack-delstyle]').forEach(function(btn){
    btn.onclick=function(){
      var id=btn.getAttribute('data-pack-delstyle');
      if(!confirm('Remove the "'+((packDraft[id]||{}).name||id)+'" style?\n\nAny drink served this way will have no packaging until you give it another one.'))return;
      packDraftRead();delete packDraft[id];renderServeStylePackaging();
    };
  });
  var add=document.getElementById('packAddStyle');
  if(add)add.onclick=function(){
    packDraftRead();
    var box=document.getElementById('packNewStyle'),label=String((box&&box.value)||'').trim();
    if(!label){alert('Give the new style a name first.');return;}
    var id=String(label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
    if(!id){alert('That name cannot be used. Try letters and numbers.');return;}
    if(packDraft[id]){alert('A style called that already exists.');return;}
    packDraft[id]={name:label,description:'',rows:[{ing:'',unit:'',stockUnit:'',qtyS:0,qtyM:0,qtyL:0}]};
    renderServeStylePackaging();
  };
  var recalc=document.getElementById('packRecalc');
  if(recalc)recalc.onclick=function(){packDraftRead();renderServeStylePackaging();};
  var reseed=document.getElementById('packReseed');
  if(reseed)reseed.onclick=function(){
    if(!confirm('Throw away the styles on screen and work them out again from your recipes?'))return;
    packDraft=null;packStylePlan=null;renderServeStylePackaging();
  };
  var save=document.getElementById('packSaveStyles');
  if(save)save.onclick=packStyleSaveStyles;
}
function packStyleValidate(draft){
  var problems=[];
  Object.keys(draft||{}).forEach(function(id){
    var style=draft[id],rows=style.rows||[],seen={};
    if(!rows.length){problems.push('"'+(style.name||id)+'" has no items in it.');return;}
    rows.forEach(function(row,ix){
      if(!row.ing){problems.push('"'+(style.name||id)+'" row '+(ix+1)+' has no item chosen.');return;}
      if(!inventoryMap[row.ing]){problems.push('"'+(style.name||id)+'" points at an item that no longer exists.');return;}
      if(seen[row.ing])problems.push('"'+(style.name||id)+'" lists '+((inventoryMap[row.ing]||{}).name||row.ing)+' twice — the quantities will add up.');
      seen[row.ing]=1;
      ['S','M','L'].forEach(function(size){if(Number(row['qty'+size])<0)problems.push('"'+(style.name||id)+'" has a negative quantity for '+((inventoryMap[row.ing]||{}).name||row.ing)+'.');});
      if(!Number(row.qtyS)&&!Number(row.qtyM)&&!Number(row.qtyL))problems.push('"'+(style.name||id)+'" has '+((inventoryMap[row.ing]||{}).name||row.ing)+' at zero for every size.');
    });
  });
  return problems;
}
function packStyleSaveStyles(){
  var draft=packDraftRead();
  var problems=packStyleValidate(draft);
  if(problems.length){alert('Fix these first:\n\n• '+problems.join('\n• ')+'\n\nNothing was saved.');return;}
  var clean={};
  Object.keys(draft).forEach(function(id){
    clean[id]={name:String(draft[id].name||id),description:String(draft[id].description||''),
      rows:(draft[id].rows||[]).map(function(r){
        var inv=inventoryMap[r.ing]||{};
        return {ing:r.ing,unit:String(inv.unit||''),stockUnit:String(inv.unit||''),
          qtyS:Number(r.qtyS)||0,qtyM:Number(r.qtyM)||0,qtyL:Number(r.qtyL)||0};
      })};
  });
  var btn=document.getElementById('packSaveStyles'); if(btn){btn.disabled=true;btn.textContent='Saving…';}
  var a=A();
  a.set(a.ref(a.db,'packagingRules'),clean).then(function(){
    packDraft=null;packStylePlan=null;
    alert('Serve styles saved.\n\nNo drink cost has moved yet — a drink only picks its packaging up once you apply in step 4.');
    setTimeout(renderServeStylePackaging,300);
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='Save the styles';}
    alert('The styles were NOT saved: '+((e&&e.code)||(e&&e.message)||e)+'\n\nLog in with your admin email and try again.');
  });
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

  html+=packStyleEditorHtml(plan);

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
    +'<div style="font-size:0.85rem;margin-top:0.5rem;color:var(--tm);">'+plan.stripped.length+' recipes have their packaging rows removed, because the serve style supplies them now. Recipe ingredients are untouched.'
    +((plan.libraryStripped||[]).length?' The shared option library also holds packaging on '+plan.libraryStripped.map(function(x){return esc(x.label);}).join(', ')+' — removed too, or the cup would be charged twice.':'')
    +'</div>'
    +'</div>';

  html+='<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);">Step 4 — Apply</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">'+(packStyleSnapshotTaken?'Writes all '+Object.keys(plan.updates).length+' changes in one go — either every one lands or none does. Completed orders keep the cost they were posted with.':'Save the restore point above first.')+'</div>'
    +'<button class="pz-btn ok" id="packApply"'+(packStyleSnapshotTaken?'':' disabled')+'>✓ Move packaging to serve styles</button></div>';

  html+='<div class="pz-card" style="border-left:4px solid #b5651d;"><div style="font-weight:700;color:var(--bd);">Undo — restore from a saved file</div>'
    +'<div style="font-size:0.85rem;color:var(--tm);margin:0.35rem 0 0.6rem;">Puts recipes, menu items, option groups and packaging back to the moment that file was saved.</div>'
    +'<input type="file" accept="application/json,.json" id="packRestore" class="pz-in" style="max-width:420px;"/></div>';

  host.innerHTML=html;
  packStyleBindEditor(plan);
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
