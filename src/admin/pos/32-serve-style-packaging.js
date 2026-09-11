
/* Packaging by serve style.
   A cup, lid and straw depend on how a drink is served, not on which drink it is. This screen
   collapses the packaging scattered through the recipes into three serve styles, shows what
   every drink costs before and after, and only then writes. A restore point is required first. */
var packStyleSnapshotTaken=false, packStylePlan=null, packStyleBusy=false, packStyleRules=null;
/* Per-item packaging overrides. An item can be customized to add/remove packaging just for
   itself; that customization is stored as its own private packagingRules entry (id "item_<key>")
   and is never merged into, or read from, a shared serve style. packItemDrafts holds unsaved
   edits while an item's editor panel is open (presence of the key = panel open). */
var packItemDrafts={};
function isItemStyleId(id){return /^item_/.test(String(id||''));}
/* Menu item keys are already "item_<id>" throughout this catalog, so prefixing again would
   double it ("item_item_..."). Use the item's own key as its private style id when it already
   carries that prefix; only synthesize one for the rare key that doesn't. */
function itemStyleId(key){key=String(key||'');return isItemStyleId(key)?key:('item_'+key);}

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
function packStyleSnapshot(options){
  options=options||{};
  var btn=document.getElementById('packSnapshot'); if(btn){btn.disabled=true;btn.textContent='Preparing…';}
  var a=A();
  return Promise.all([
    a.get(a.ref(a.db,'recipes')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'menuItems')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'optionGroups')).then(function(s){return s.val()||{};}),
    a.get(a.ref(a.db,'packagingRules')).then(function(s){return s.val()||{};}).catch(function(){return {};}),
    a.get(a.ref(a.db,'posSettings/packagingAssignments')).then(function(s){return s.val()||{};}).catch(function(){return {};})
  ]).then(function(parts){
    var payload={recipes:parts[0],menuItems:parts[1],optionGroups:parts[2],packagingRules:parts[3],packagingAssignments:parts[4]};
    return recTempSeal(payload).then(function(hash){
      var takenAt=Date.now();
      var envelope={version:'accaza-packaging-restore-v2',kind:'accaza-packaging-restore-point',takenAt:takenAt,
        takenAtISO:new Date(takenAt).toISOString(),
        counts:{recipes:Object.keys(payload.recipes).length,menuItems:Object.keys(payload.menuItems).length,optionGroups:Object.keys(payload.optionGroups).length},
        integrity:{algorithm:'sha256',canonical:'sorted-json-v1',dataSha256:hash},
        note:'Recipes, menu items, option groups, packaging rules and packaging assignments exactly as they stood before changes. Load this back on the same screen to undo them completely.',
        data:payload};
      var blob=new Blob([JSON.stringify(envelope)],{type:'application/json'}),url=URL.createObjectURL(blob);
      var stamp=new Date(takenAt).toISOString().slice(0,19).replace(/[:T]/g,'-');
      var link=document.createElement('a');link.href=url;link.download='accaza-packaging-before-'+stamp+'.json';
      document.body.appendChild(link);link.click();document.body.removeChild(link);
      setTimeout(function(){URL.revokeObjectURL(url);},4000);
      packStyleSnapshotTaken=true;
      if(!options.keepView)renderServeStylePackaging();
      if(!options.silent)alert('Restore point saved. Keep that file until you are happy with the packaging.');
      return envelope;
    });
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='⬇ Save a restore point';}
    if(!options.silent)alert('Could not build the restore point: '+((e&&e.message)||e)+'\n\nNothing was changed.');
    if(options.silent)throw e;
    return null;
  });
}
function packStyleRestore(file){
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(){
    var envelope;
    try{envelope=JSON.parse(String(reader.result));}catch(e){alert('That file is not a restore point. Nothing was changed.');return;}
    if(!envelope||['accaza-packaging-restore-v1','accaza-packaging-restore-v2'].indexOf(envelope.version)<0||!envelope.data){alert('That file is not an Accaza packaging restore point. Nothing was changed.');return;}
    recTempSeal(envelope.data).then(function(hash){
      var sealed=envelope.integrity&&envelope.integrity.dataSha256;
      if(sealed&&sealed!==hash){alert('That restore point has been altered since it was saved. Nothing was changed.');return;}
      if(!confirm('Put recipes, menu items, option groups and packaging back to '+new Date(envelope.takenAt||0).toLocaleString()+'?\n\nAnything changed since then is lost.'))return;
      var a=A(),d=envelope.data;
      var restore={recipes:d.recipes,menuItems:d.menuItems,optionGroups:d.optionGroups,packagingRules:d.packagingRules||null};if(envelope.version==='accaza-packaging-restore-v2')restore['posSettings/packagingAssignments']=d.packagingAssignments||null;
      a.update(a.ref(a.db,'/'),restore).then(function(){
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
  var draft=packDraftInit(plan),ids=Object.keys(draft).filter(function(id){return !isItemStyleId(id);});
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

function packStyleOptions(selected){
  var rules=packDraft||packagingRulesMap||{},ids=Object.keys(rules).filter(function(id){return !isItemStyleId(id);});
  return '<option value="">— packaging not set —</option>'+ids.map(function(id){return '<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc((rules[id]&&rules[id].name)||id)+'</option>';}).join('');
}
/* ---- Per-item packaging override ------------------------------------------------------
   An item's packaging normally comes straight from the shared category style. "Customize"
   copies whatever it currently inherits into a private style (packagingRules/item_<key>) that
   only this item ever points at, then lets rows be added or removed there. The shared style it
   was copied from — and every other item using it — is never written to. */
function packItemActiveRows(styleId){
  var rule=styleId?(packagingRulesMap||{})[styleId]:null;
  return rule&&Array.isArray(rule.rows)?rule.rows:[];
}
function packItemCost(rows){
  var t={S:0,M:0,L:0};(rows||[]).forEach(function(r){var c=packRowCost(r);t.S+=c.S;t.M+=c.M;t.L+=c.L;});
  return t;
}
function packItemEnsureDraft(item,seedStyleId){
  if(packItemDrafts[item.key])return packItemDrafts[item.key];
  var existing=(packagingRulesMap||{})[itemStyleId(item.key)];
  var seedRows=existing&&Array.isArray(existing.rows)?existing.rows:packItemActiveRows(seedStyleId);
  packItemDrafts[item.key]={rows:packDraftClone(seedRows).map(function(r){
    var inv=inventoryMap[r.ing]||{};
    return {ing:r.ing,unit:r.unit||inv.unit||'',stockUnit:r.stockUnit||inv.unit||'',
      qtyS:Number(r.qtyS)||0,qtyM:Number(r.qtyM)||0,qtyL:Number(r.qtyL)||0};
  })};
  return packItemDrafts[item.key];
}
function packItemEditorHtml(item,catId,seedStyleId){
  var draft=packItemEnsureDraft(item,seedStyleId),cost=packItemCost(draft.rows);
  var rowsHtml=(draft.rows||[]).map(function(row,ix){
    var rc=packRowCost(row),key=item.key+'|'+ix;
    return '<tr><td><select class="pz-in" data-packitemrow-ing="'+esc(key)+'">'+packIngredientOptions(row.ing)+'</select></td>'
      +['S','M','L'].map(function(size){return '<td class="r"><input class="pz-in" type="number" step="any" min="0" style="width:65px;text-align:right;" data-packitemrow-qty="'+esc(key+'|'+size)+'" value="'+esc(String(row['qty'+size]))+'"/></td>';}).join('')
      +'<td class="r" style="color:var(--tl);">'+peso(rc.M)+'</td>'
      +'<td class="r"><button class="pz-btn warn" data-packitemrow-del="'+esc(key)+'" style="padding:0.15rem 0.5rem;">✕</button></td></tr>';
  }).join('');
  return '<div class="pz-card" style="margin-top:0.5rem;background:#fbfaf6;">'
    +'<div style="font-size:0.78rem;color:var(--tl);margin-bottom:0.4rem;">Starts from what this item currently inherits. Saving here only changes packaging for <b>'+esc(item.name)+'</b> — the shared serve style it was copied from is untouched.</div>'
    +(rowsHtml?'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th style="min-width:180px;">Item</th><th class="r">S</th><th class="r">M</th><th class="r">L</th><th class="r">Cost M</th><th></th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>':'<div style="font-size:0.8rem;color:var(--tl);padding:0.4rem 0;">No packaging items. Add one below.</div>')
    +'<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.4rem;font-weight:600;font-size:0.82rem;margin:0.4rem 0;"><span>Cost of this item’s packaging</span><span>S '+peso(cost.S)+' · M '+peso(cost.M)+' · L '+peso(cost.L)+'</span></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">'
    +'<button class="pz-btn sec" data-packitemrow-add="'+esc(item.key)+'" style="padding:0.2rem 0.7rem;">+ Add an item</button>'
    +'<button class="pz-btn ok" data-packitemsave="'+esc(catId)+'|'+esc(item.key)+'" style="padding:0.2rem 0.7rem;">💾 Save packaging for this item</button>'
    +'<button class="pz-btn sec" data-packitemcancel="'+esc(item.key)+'" style="padding:0.2rem 0.7rem;">Cancel</button>'
    +'</div></div>';
}
function packItemReadDraft(itemKey){
  var d=packItemDrafts[itemKey]; if(!d)return d;
  (d.rows||[]).forEach(function(row,ix){
    var pick=document.querySelector('[data-packitemrow-ing="'+itemKey+'|'+ix+'"]');
    if(pick){var chosen=String(pick.value||'');if(chosen){row.ing=chosen;var inv=inventoryMap[chosen]||{};row.unit=inv.unit||'';row.stockUnit=inv.unit||'';}}
    ['S','M','L'].forEach(function(size){
      var box=document.querySelector('[data-packitemrow-qty="'+itemKey+'|'+ix+'|'+size+'"]');
      if(box)row['qty'+size]=Number(box.value)||0;
    });
  });
  return d;
}
function packItemBindEditors(){
  var host=document.getElementById('packagingRoot'); if(!host)return;
  host.querySelectorAll('[data-packcustomize]').forEach(function(btn){
    btn.onclick=function(){
      var p=btn.getAttribute('data-packcustomize').split('|'),catId=p[0],key=p[1];
      if(packItemDrafts.hasOwnProperty(key)){delete packItemDrafts[key];}
      else{
        var it=(A().menuItemsMap||{})[key]; if(!it){alert('Item not found.');return;}
        var assignment=((window.__posSettings&&window.__posSettings.packagingAssignments)||{})[catId]||{};
        var seed=(assignment.items||{})[key]||assignment.defaultStyle||'';
        packItemEnsureDraft(Object.assign({key:key},it),seed);
      }
      renderServeStylePackaging();
    };
  });
  host.querySelectorAll('[data-packitemcancel]').forEach(function(btn){
    btn.onclick=function(){delete packItemDrafts[btn.getAttribute('data-packitemcancel')];renderServeStylePackaging();};
  });
  host.querySelectorAll('[data-packitemrow-add]').forEach(function(btn){
    btn.onclick=function(){var key=btn.getAttribute('data-packitemrow-add');packItemReadDraft(key);var d=packItemDrafts[key];if(d)d.rows.push({ing:'',unit:'',stockUnit:'',qtyS:0,qtyM:0,qtyL:0});renderServeStylePackaging();};
  });
  host.querySelectorAll('[data-packitemrow-del]').forEach(function(btn){
    btn.onclick=function(){
      var parts=btn.getAttribute('data-packitemrow-del').split('|'),key=parts[0],ix=Number(parts[1]);
      packItemReadDraft(key);var d=packItemDrafts[key];if(d)d.rows.splice(ix,1);renderServeStylePackaging();
    };
  });
  host.querySelectorAll('[data-packitemsave]').forEach(function(btn){
    btn.onclick=function(){
      var p=btn.getAttribute('data-packitemsave').split('|'),catId=p[0],key=p[1];
      packItemReadDraft(key);
      var draft=packItemDrafts[key]; if(!draft)return;
      var it=(A().menuItemsMap||{})[key]; if(!it){alert('Item not found. Nothing was saved.');return;}
      var probs=packStyleValidate({tmp:{name:it.name,rows:draft.rows}});
      if(probs.length){alert('Fix these first:\n\n• '+probs.join('\n• ')+'\n\nNothing was saved.');return;}
      /* Re-editing an already-customized item writes back to the SAME private record it already
         has, whatever id that record carries — never a freshly recomputed id, which would orphan
         the existing one. Only a brand-new customization gets a freshly synthesized id. */
      var paExisting=(window.__posSettings&&window.__posSettings.packagingAssignments)||{};
      var existingStyle=paExisting[catId]&&paExisting[catId].items&&paExisting[catId].items[key];
      var custId=(existingStyle&&isItemStyleId(existingStyle))?existingStyle:itemStyleId(key);
      var clean={name:it.name+' (custom)',description:'Packaging customized for '+it.name+' only — does not affect any shared serve style.',
        rows:draft.rows.map(function(r){var inv=inventoryMap[r.ing]||{};return {ing:r.ing,unit:String(inv.unit||''),stockUnit:String(inv.unit||''),
          qtyS:Number(r.qtyS)||0,qtyM:Number(r.qtyM)||0,qtyL:Number(r.qtyL)||0};})};
      var updates={};updates['packagingRules/'+custId]=clean;updates['posSettings/packagingAssignments/'+catId+'/items/'+key]=custId;
      btn.disabled=true;btn.textContent='Saving…';
      var a=A();
      a.update(a.ref(a.db,'/'),updates).then(function(){
        delete packItemDrafts[key];
        packagingRulesMap[custId]=clean;
        window.__posSettings=window.__posSettings||{};window.__posSettings.packagingAssignments=window.__posSettings.packagingAssignments||{};
        window.__posSettings.packagingAssignments[catId]=window.__posSettings.packagingAssignments[catId]||{};
        window.__posSettings.packagingAssignments[catId].items=window.__posSettings.packagingAssignments[catId].items||{};
        window.__posSettings.packagingAssignments[catId].items[key]=custId;
        updateCostBadge();
        setTimeout(renderServeStylePackaging,150);
      }).catch(function(e){
        btn.disabled=false;btn.textContent='💾 Save packaging for this item';
        alert('Could not save this item’s packaging: '+((e&&e.code)||(e&&e.message)||e)+'\n\nNothing was changed. Log in with your admin email and try again.');
      });
    };
  });
  host.querySelectorAll('[data-packrevert]').forEach(function(btn){
    btn.onclick=function(){
      var p=btn.getAttribute('data-packrevert').split('|'),catId=p[0],key=p[1];
      var it=(A().menuItemsMap||{})[key];
      if(!confirm('Remove the custom packaging for "'+((it&&it.name)||key)+'" and go back to the shared serve style?\n\nThis only affects future orders; nothing already sold changes.'))return;
      /* Delete whichever private record the assignment actually points at right now - never a
         freshly recomputed id, which could miss an older record and leave it orphaned. */
      var paRevert=(window.__posSettings&&window.__posSettings.packagingAssignments)||{};
      var assignedNow=paRevert[catId]&&paRevert[catId].items&&paRevert[catId].items[key];
      var custId=(assignedNow&&isItemStyleId(assignedNow))?assignedNow:itemStyleId(key),updates={};
      updates['posSettings/packagingAssignments/'+catId+'/items/'+key]=null;
      updates['packagingRules/'+custId]=null;
      var a=A();
      a.update(a.ref(a.db,'/'),updates).then(function(){
        delete packItemDrafts[key];
        if(packagingRulesMap)delete packagingRulesMap[custId];
        var pa=window.__posSettings&&window.__posSettings.packagingAssignments;
        if(pa&&pa[catId]&&pa[catId].items)delete pa[catId].items[key];
        updateCostBadge();
        setTimeout(renderServeStylePackaging,150);
      }).catch(function(e){alert('Could not revert: '+((e&&e.code)||(e&&e.message)||e)+'\n\nNothing was changed.');});
    };
  });
}
function packagingAssignmentHtml(){
  var cats=(A().getCats?A().getCats():[]),menu=menuList(),saved=(window.__posSettings&&window.__posSettings.packagingAssignments)||{};
  return '<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Menu applicability</div><p class="pz-sub" style="margin-top:0;">Drinks can vary by Temperature. Pastries share one packaging set by default — but any pastry can be <b>Customized</b> to add or remove packaging just for itself, starting from what it currently inherits; saving it never changes the shared style or any other item. Saving automatically downloads a restore point before anything changes.</p>'+cats.map(function(cat){
    var items=menu.filter(function(it){return it.cat===cat.id;}),groups={},assignment=saved[cat.id]||{},mapped=assignment.choices||{};
    items.forEach(function(it){(A().getItemOptionGroups?A().getItemOptionGroups(it):[]).forEach(function(g){if(/temperature/i.test(String(g.name||'')))groups[g.id]=g;});});
    var groupIds=Object.keys(groups),controls='';
    groupIds.forEach(function(gid){var g=groups[gid],gm=mapped[gid]||{};controls+=(g.choices||[]).map(function(c){var key=Costing().optKey(c.label);return '<label style="min-width:190px;flex:1 1 210px;"><span class="pz-lbl">'+esc(c.label)+'</span><select class="pz-in" data-packassign="'+esc(cat.id)+'|'+esc(gid)+'|'+esc(key)+'">'+packStyleOptions(gm[key]||'')+'</select></label>';}).join('');});
    if(!groupIds.length)controls='<label style="min-width:240px;"><span class="pz-lbl">Default packaging</span><select class="pz-in" data-packdefault="'+esc(cat.id)+'">'+packStyleOptions(assignment.defaultStyle||'')+'</select></label>';
    else controls+='<label style="min-width:190px;flex:1 1 210px;"><span class="pz-lbl">Fallback for items without Temperature</span><select class="pz-in" data-packdefault="'+esc(cat.id)+'">'+packStyleOptions(assignment.defaultStyle||'')+'</select></label>';
    var itemControls=cat.id==='pastry'?'<div style="margin-top:0.55rem;">'+items.map(function(it){
      /* isCustom is decided from what the assignment actually points at - not a freshly
         recomputed id - so an item customized before an itemStyleId scheme change (or under any
         future one) is still correctly recognized as customized instead of silently reading as
         "uses the shared style" while a private record still exists for it. */
      var assignedItems=assignment.items||{},assignedStyle=assignedItems[it.key]||'',isCustom=isItemStyleId(assignedStyle)&&!!packagingRulesMap[assignedStyle];
      var effectiveStyle=assignedStyle||assignment.defaultStyle||'';
      var cost=packItemCost(packItemActiveRows(effectiveStyle));
      var open=packItemDrafts.hasOwnProperty(it.key);
      return '<div style="border-top:1px solid var(--cd);padding:0.5rem 0;">'
        +'<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">'
        +(isCustom
          ? '<span style="flex:1 1 220px;"><span class="pz-lbl" style="display:block;">'+esc(it.name)+'</span><span style="font-size:0.78rem;color:var(--bd);font-weight:600;">🔧 Custom packaging for this item</span></span>'
          : '<span style="flex:1 1 220px;"><span class="pz-lbl" style="display:block;">'+esc(it.name)+'</span><span style="font-size:0.78rem;color:var(--tl);">Uses the shared '+esc((packagingRulesMap[effectiveStyle]&&packagingRulesMap[effectiveStyle].name)||effectiveStyle||'—')+' packaging</span></span>')
        +'<span style="font-size:0.72rem;color:var(--tl);">M cost '+peso(cost.M)+'</span>'
        +'<button class="pz-btn sec" data-packcustomize="'+esc(cat.id)+'|'+esc(it.key)+'" style="padding:0.2rem 0.6rem;">'+(open?'▾ Close':(isCustom?'✎ Edit':'✎ Customize for this item'))+'</button>'
        +(isCustom?'<button class="pz-btn warn" data-packrevert="'+esc(cat.id)+'|'+esc(it.key)+'" style="padding:0.2rem 0.6rem;">Revert to shared style</button>':'')
        +'</div>'
        +(open?packItemEditorHtml(it,cat.id,effectiveStyle):'')
        +'</div>';
    }).join('')+'</div>':'';
    return '<div style="border-top:1px solid var(--cd);padding:0.65rem 0;"><div style="font-weight:600;">'+esc((cat.icon||'')+' '+cat.label)+'</div><div style="font-size:0.72rem;color:var(--tl);margin:0.15rem 0 0.45rem;">'+(cat.id==='pastry'?'Shared by default across all '+items.length+' pastries — edit the packaging-set editor above to change everyone, or Customize a single item below.':'Applies to '+items.length+' item'+(items.length===1?'':'s')+(items.length?' — '+esc(items.map(function(i){return i.name;}).join(', ')) : ''))+'</div><div style="display:flex;gap:0.55rem;flex-wrap:wrap;">'+controls+'</div>'+itemControls+'</div>';
  }).join('')+'<button class="pz-btn ok" id="packSaveAssignments">Save category assignments</button><span id="packAssignmentMsg" role="status" aria-live="polite" style="font-size:0.78rem;color:var(--tl);margin-left:0.5rem;"></span></div>';
}
function savePackagingAssignments(){
  var root=document.getElementById('packagingRoot');
  /* Seed from what is already saved, not a blank object, so a per-item Customize/Revert made
     through its own dedicated save path is never wiped out by this unrelated category-level save. */
  var prior=(window.__posSettings&&window.__posSettings.packagingAssignments)||{},next=packDraftClone(prior);
  root.querySelectorAll('[data-packdefault]').forEach(function(el){var cat=el.getAttribute('data-packdefault'),value=String(el.value||'');next[cat]=next[cat]||{};if(value)next[cat].defaultStyle=value;else delete next[cat].defaultStyle;});
  root.querySelectorAll('[data-packassign]').forEach(function(el){var p=el.getAttribute('data-packassign').split('|'),value=String(el.value||'');next[p[0]]=next[p[0]]||{};next[p[0]].choices=next[p[0]].choices||{};next[p[0]].choices[p[1]]=next[p[0]].choices[p[1]]||{};if(value)next[p[0]].choices[p[1]][p[2]]=value;else delete next[p[0]].choices[p[1]][p[2]];});
  Object.keys(next).forEach(function(cat){if(!next[cat].defaultStyle&&!(next[cat].choices&&Object.keys(next[cat].choices).length)&&!(next[cat].items&&Object.keys(next[cat].items).length))delete next[cat];});
  var btn=document.getElementById('packSaveAssignments'),m=document.getElementById('packAssignmentMsg');
  if(btn){btn.disabled=true;btn.textContent='Backing up…';}if(m)m.textContent='Downloading a restore point before saving…';
  packStyleSnapshot({silent:true,keepView:true}).then(function(){
    if(btn)btn.textContent='Saving…';if(m)m.textContent='Restore point downloaded. Saving assignments…';
    return A().update(A().ref(A().db,'posSettings'),{packagingAssignments:next});
  }).then(function(){
    window.__posSettings=window.__posSettings||{};window.__posSettings.packagingAssignments=next;
    if(btn){btn.disabled=false;btn.textContent='Save category assignments';}if(m)m.textContent='✓ Restore point downloaded and assignments saved '+new Date().toLocaleTimeString();updateCostBadge();
  }).catch(function(e){
    if(btn){btn.disabled=false;btn.textContent='Save category assignments';}if(m)m.textContent='✗ Nothing was changed: '+((e&&e.code)||(e&&e.message)||e);
  });
}
function renderServeStylePackaging(){
  var host=document.getElementById('packagingRoot'); if(!host)return;
  var plan;try{plan=packStyleBuild();}catch(e){host.innerHTML='<div class="pz-card" style="border-color:#f1b7b7;background:#fff5f5;color:#8b1e1e;">'+esc((e&&e.message)||e)+'</div>';return;}
  host.innerHTML='<p class="pz-sub">Define the physical packaging first, then confirm exactly which menu category and serving choice uses it. Packaging items are Inventory records and flow into inventory usage, Packaging COGS and Finance Books when a sale is completed.</p>'+packStyleEditorHtml(plan)+packagingAssignmentHtml()
    +'<details class="pz-card"><summary style="cursor:pointer;font-weight:700;color:var(--bd);">Maintenance and recovery tools</summary><p class="pz-sub">The former migration and restore workflow is retained here for controlled recovery, not normal costing.</p><button class="pz-btn" id="packSnapshot">⬇ Save restore point</button> <input type="file" accept="application/json,.json" id="packRestore" class="pz-in" style="max-width:320px;display:inline-block;"/></details>';
  packStyleBindEditor(plan);
  packItemBindEditors();
  var save=document.getElementById('packSaveAssignments');if(save)save.onclick=savePackagingAssignments;
  var snap=document.getElementById('packSnapshot');if(snap)snap.onclick=packStyleSnapshot;
  var restore=document.getElementById('packRestore');if(restore)restore.onchange=function(){packStyleRestore(restore.files&&restore.files[0]);};
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
