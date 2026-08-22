(function(){
'use strict';
var inventoryMap={}, inventorySkuMap={}, purchaseInvoicesMap={}, recipesMap={}, posMeta={vat:false,vatRate:12}, optRecipesMap={}, usageMap={}, channelPricesMap={}, posAvailMap={}, inventoryMovementsMap={};
// Order reference: PREFIX-XXXXXX (6 base36 chars from a monotonic timestamp).
// Prefix namespaces the channel so IDs never collide across channels; the
// monotonic counter guarantees uniqueness for rapid same-device sales offline.
var _lastRefN=0;
function _shortRef(){var n=Date.now();if(n<=_lastRefN)n=_lastRefN+1;_lastRefN=n;return (n%2176782336).toString(36).toUpperCase().padStart(6,'0');}
function _orderRefPrefix(isPlat,platform){if(isPlat&&platform){if(platform.channel==='grabfood')return 'GF';if(platform.channel==='foodpanda')return 'FP';}return 'POS';}
function posIsAvail(name){return posAvailMap[name]!==false;}
var POS_CHANNELS=[{k:'grabfood',lbl:'GrabFood',rate:0.25,wht:0,vat:0},{k:'foodpanda',lbl:'FoodPanda',rate:0.30,wht:0.005,vat:0.036}];
function channelsCfg(){var c=(window.__posSettings&&window.__posSettings.channels);var out={};POS_CHANNELS.forEach(function(d){var s=(c&&c[d.k])||{};out[d.k]={label:d.lbl,rate:(s.rate!=null?Number(s.rate):d.rate),wht:(s.wht!=null?Number(s.wht):d.wht),vat:(s.vat!=null?Number(s.vat):d.vat),active:s.active!==false};});return out;}
function channelRate(ch){var c=channelsCfg()[ch];return c?Number(c.rate)||0:0;}
function channelWht(ch){var c=channelsCfg()[ch];return c?Number(c.wht)||0:0;}
function channelVat(ch){var c=channelsCfg()[ch];return c?Number(c.vat)||0:0;}
function channelPriceOf(ch,itemKey,size){var cp=(channelPricesMap[ch]||{})[itemKey];return cp?(Number(cp[size])||0):0;}
function channelLabel(ch){var c=channelsCfg()[ch];return c?c.label:ch;}
function posIsPlatform(){return posChannel&&posChannel!=='instore';}
function posBasePrice(item,size){ size=size||'S'; if(posIsPlatform())return channelPriceOf(posChannel,item.key,size); return size==='L'?(Number(item.priceL)||0):size==='M'?(Number(item.priceM)||0):(Number(item.priceS)||0); }
function chOptKey(gid,label){return (String(gid)+'::'+String(label)).replace(/[.#$\[\]\/]/g,'_');}
function channelOptPrice(ch,gid,label){var o=(channelPricesMap[ch]||{}).__opt||{};return Number(o[chOptKey(gid,label)])||0;}
function optChoicePrice(gid,label,instorePrice){ return posIsPlatform()?channelOptPrice(posChannel,gid,label):(Number(instorePrice)||0); }
function allOptionChoices(){ var og=(A()&&A().optionGroupsMap)||{}; var out=[]; Object.keys(og).forEach(function(gid){var g=og[gid]||{};(g.choices||[]).forEach(function(c){out.push({gid:gid,gname:g.name||gid,label:c.label,price:Number(c.price)||0});});}); return out; }
window.__accazaChannelPricing={channels:POS_CHANNELS,getPrices:function(){return channelPricesMap;},setPrices:function(value){channelPricesMap=value||{};},channelsCfg:channelsCfg,channelPriceOf:channelPriceOf,channelOptPrice:channelOptPrice,chOptKey:chOptKey,allOptionChoices:allOptionChoices,menuList:function(){return menuList();}};
var usageKind='staff', usageAdhoc=false, usageTypesMap={}, usageManageOpen=false, usageRecipeName='', usageRows={menuaddon:[],base:[],addon:[],cons:[]};
var DEFAULT_USAGE_TYPES=[{id:'staff',name:'Staff consumption',reasons:['Staff Meal','Staff Drink','Management'],order:1},{id:'rnd',name:'R&D / Testing',reasons:['Testing','Training','Sampling','Quality Check'],order:2}];
function usageTypesList(){var keys=Object.keys(usageTypesMap);var list=keys.length?keys.map(function(k){return Object.assign({id:k},usageTypesMap[k]);}):DEFAULT_USAGE_TYPES.slice();return list.sort(function(a,b){return (a.order||0)-(b.order||0);});}
function usageTypeName(id){return (usageTypesMap[id]&&usageTypesMap[id].name)||(id==='staff'?'Staff consumption':id==='rnd'?'R&D / Testing':id);}
function usageTypeReasons(id){var t=usageTypesMap[id]||DEFAULT_USAGE_TYPES.filter(function(d){return d.id===id;})[0];return (t&&t.reasons)||[];}
var posCart={}, posCat='ALL', posSearch='', posBuilt=false, recipeEditing=false, curRecipeKey=null, recipeDraft=null, recSub='base', recSize='M', posScopedDisc=[], posChannel='instore', posView='counter', onlineOrdersMap={};
var posDraft={},posChargeBusy=false,posPaymentVerification=null;
function telemetry(){return window.AccazaTelemetry||{start:function(){},end:function(){},metric:function(){},error:function(){}};}
function capturePosDraft(root){if(!root)return;var active=document.activeElement,focusId=active&&root.contains(active)?active.id:'';root.querySelectorAll('input[id],textarea[id]').forEach(function(el){posDraft[el.id]={value:el.value,checked:!!el.checked,type:el.type};});posDraft.__focus=focusId;}
function restorePosDraft(root){if(!root)return;Object.keys(posDraft).forEach(function(id){if(id==='__focus')return;var el=document.getElementById(id),v=posDraft[id];if(!el||!root.contains(el)||el.tagName==='SELECT')return;if(v.type==='checkbox'||v.type==='radio')el.checked=v.checked;else el.value=v.value;});var f=posDraft.__focus&&document.getElementById(posDraft.__focus);if(f&&root.contains(f))setTimeout(function(){try{f.focus();}catch(e){}},0);}
var DISC_TYPES={senior:{label:'Senior Citizen',rate:0.20},pwd:{label:'PWD',rate:0.20},athlete:{label:'National Athlete',rate:0.20},promo5:{label:'5% Drink Promo',rate:0.05}};

function A(){return window.__accaza;}
function F(){if(!window.AccazaFormDialog)throw new Error('Form service unavailable. Refresh the portal.');return window.AccazaFormDialog;}
function Costing(){if(!window.AccazaCosting)throw new Error('The shared costing engine did not load. Refresh the portal and try again.');return window.AccazaCosting;}
function costingContext(extra){return Object.assign({inventory:inventoryMap,recipes:recipesMap,menuItems:(A()&&A().menuItemsMap)||{},optionCosts:optCostStore(),optionRecipes:optRecipesMap,optionGroups:(A()&&A().optionGroupsMap)||{}},extra||{});}
function movementId(prefix,source,item){return (String(prefix)+'_'+String(source)+'_'+String(item)).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,160);}
function postMovements(rows){var a=A();if(!a||!a.postInventoryMovements)return Promise.reject(new Error('Inventory movement service is not available. Refresh the portal.'));rows=(rows||[]).filter(function(x){return x&&x.itemId;});var chunks=[];while(rows.length)chunks.push(rows.splice(0,100));var out={count:0,duplicates:0,movements:[]};return chunks.reduce(function(p,chunk){return p.then(function(){return a.postInventoryMovements(chunk);}).then(function(r){r=r&&r.data?r.data:r||{};out.count+=Number(r.count)||0;out.duplicates+=Number(r.duplicates)||0;out.movements=out.movements.concat(r.movements||[]);});},Promise.resolve()).then(function(){return out;});}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function num(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function ings(){return Object.keys(inventoryMap).map(function(k){return Object.assign({id:k},inventoryMap[k]);}).sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});}
function activeSkusFor(masterId){return Object.keys(inventorySkuMap).map(function(k){return Object.assign({id:k},inventorySkuMap[k]);}).filter(function(s){return s.masterId===masterId&&s.active!==false;}).sort(function(a,b){return (Number(a.priority)||0)-(Number(b.priority)||0)||(a.brand||'').localeCompare(b.brand||'');});}
function treeUsesIngredient(value,id){if(!value||typeof value!=='object')return false;if(value.ing===id)return true;if(Array.isArray(value))return value.some(function(x){return treeUsesIngredient(x,id);});return Object.keys(value).some(function(k){return treeUsesIngredient(value[k],id);});}
function recipeUsesInventory(id){var item=inventoryMap[id]||{};return item.recipeItem===true||ingType(item)==='consumable'||treeUsesIngredient(recipesMap,id)||treeUsesIngredient(optRecipesMap,id)||treeUsesIngredient(optCostStore(),id);}
function skuDisplay(s){return ((s&&s.brand)||'Unnamed brand')+((s&&s.supplier)?' · '+s.supplier:'');}
function ingName(id){var i=inventoryMap[id];return i?i.name:'(deleted)';}
function ingUnit(id){var i=inventoryMap[id];return i?(i.unit||''):'';}
function ingCost(id){var i=inventoryMap[id];return i?(Number(i.cost)||0):0;}
/* P3: Standard cost (pricing lens) vs Actual COGS (weighted-average, unchanged).
   Method 'wac' → standard = live weighted-average; 'manual' → standard = the locked stdCost you set. */
function stdCostMethod(){return (window.__posSettings&&window.__posSettings.stdCostMethod)||'wac';}
function stdCostOf(item){ if(!item)return 0; if(stdCostMethod()==='manual'&&item.stdCost!=null&&item.stdCost!=='')return Number(item.stdCost)||0; return Number(item.cost)||0; }
function stdIngCost(id){return stdCostOf(inventoryMap[id]);}
function recipeStdCost(key,size){ var rec=recipesMap[key]; if(!rec||!rec.base)return {cost:0,covered:false,has:false};var stdInv={};Object.keys(inventoryMap).forEach(function(id){stdInv[id]=Object.assign({},inventoryMap[id],{cost:stdIngCost(id)});});var result=Costing().costRecipe({itemKey:key,recipe:rec,inventory:stdInv,item:((A()&&A().menuItemsMap)||{})[key]||{},size:size});return {cost:result.totalCost,covered:result.cogsCovered,has:true}; }
function ingType(i){return (i&&i.type)||'base';}
function ingsByType(t){return ings().filter(function(i){return ingType(i)===t;});}
/* Inventory categories (organization + product-cost vs overhead), stored in posSettings (no new rule). */
function invCatsMap(){return (window.__posSettings&&window.__posSettings.invCategories)||{};}
function invCats(){var m=invCatsMap();return Object.keys(m).map(function(id){return Object.assign({id:id},m[id]);}).sort(function(a,b){return ((a.order||0)-(b.order||0))||(a.name||'').localeCompare(b.name||'');});}
function invCatName(id){var c=invCatsMap()[id];return c?c.name:'';}
function invCatKind(id){var c=invCatsMap()[id];return (c&&c.kind)||'cogs';}
function seedInvCats(){ if(Object.keys(invCatsMap()).length)return; var a=A(); if(!a)return; var seed={}; [['Coffee','cogs'],['Milk','cogs'],['Syrup','cogs'],['Powder','cogs'],['Tea','cogs'],['Packaging','cogs'],['Cleaning','overhead'],['Office','overhead']].forEach(function(p,i){seed['cat_'+p[0].toLowerCase()]={name:p[0],kind:p[1],order:i};}); a.update(a.ref(a.db,'posSettings/invCategories'),seed).catch(function(){}); }
/* consumables applicable to a menu category+size */
function catType(cat){var m=(window.__posSettings&&window.__posSettings.catType)||{};return m[cat]||'';}
function consumablesFor(cat,size){
  var t=catType(cat); if(t!=='drink'&&t!=='food')return [];
  return ings().filter(function(i){
    if(ingType(i)!=='consumable')return false;
    var sv=i.serves||'both';
    if(t==='drink'&&sv==='food')return false;
    if(t==='food'&&sv==='drink')return false;
    if(i.size&&i.size!==size)return false;   /* size-specific (e.g. cups) only fire for their size */
    return true;
  });
}
/* per-size base quantity, with legacy (qty × sizeMult) fallback */
function baseQtyForSize(rec,b,size){
  var per=b['qty'+size];
  if(per!=null&&per!=='')return Number(per)||0;
  var mult=(rec&&rec.sizeMult&&rec.sizeMult[size]!=null)?rec.sizeMult[size]:1;
  return (Number(b.qty)||0)*mult;
}
/* ---- unit conversion (recipe unit → ingredient stock unit) ---- */
function uNorm(u){return Costing().normalizeUnit(u);}
function unitDim(u){var x=Costing().unitInfo(u);return x.error?null:x.dim;}
function itemDim(item){return unitDim(item&&item.unit);}
function compatUnits(item){var dim=itemDim(item),own=uNorm(item&&item.unit),out;if(dim==='volume')out=['ml','l','tsp','tbsp','cup','fl oz'];else if(dim==='weight')out=['mg','g','kg','lb','oz wt'];else if(dim==='count')out=['pc','pcs','ea','each','dozen'];else out=[own||'pcs'];if(own&&out.indexOf(own)<0)out.unshift(own);return out;}
function convertToStock(qty,fromUnit,item){var cv=Costing().convert(Number(qty),fromUnit,item&&item.unit);return cv.ok?cv.qty:NaN;}
/* option → {ing,qty}: prefer legacy per-recipe option, else global optionRecipes by label */
function optRecipeFor(rec,label){
  if(rec&&rec.options){var m=rec.options.filter(function(o){return o.label===label;})[0];if(m&&m.ing)return m;}
  var g=optRecipesMap[label]; if(g&&g.ing)return g;
  return null;
}
/* ── Choice-cost model (size-aware, multi-ingredient, group-scoped) ──
   Store: posSettings.optionCosts[groupId][optKey(label)] = {label, ings:[{ing,qtyS,qtyM,qtyL}]}
   Falls back to legacy optRecipeFor (single flat qty by label) when no entry exists,
   so existing add-on costs and historical (snapshotted) orders are unaffected. */
function optCostStore(){return (window.__posSettings&&window.__posSettings.optionCosts)||{};}
/* Which option groups may carry per-drink extra ingredients (choiceAdd). Default = Temperature only.
   Stored in posSettings.choiceAddGroups (no rule change). Empty array = none allowed. */
function caAllowGroups(){var s=(window.__posSettings&&window.__posSettings.choiceAddGroups);return Array.isArray(s)?s:['og_temp'];}
function groupIdForLabel(item,label){
  var groups=(item&&A()&&A().getItemOptionGroups)?A().getItemOptionGroups(item):[];
  for(var i=0;i<(groups||[]).length;i++){var cs=groups[i].choices||[];for(var j=0;j<cs.length;j++){if(cs[j].label===label)return groups[i].id;}}
  return null;
}
/* returns [{ing,qty}] for one selected choice label at a given size */
function choiceIngs(item,rec,label,size){
  size=size||'M';
  var gid=item?groupIdForLabel(item,label):null; var lk=optKey(label);
  var out=[],found=false;
  function push(arr){(arr||[]).forEach(function(r){if(!r||!r.ing)return;var q=r['qty'+size];if(q==null||q==='')q=0;out.push({ing:r.ing,qty:Number(q)||0});});}
  var store=optCostStore(); /* global: shared per-choice cost (cups, ice, milk) */
  if(gid&&store[gid]&&store[gid][lk]&&(store[gid][lk].ings||[]).length){push(store[gid][lk].ings);found=true;}
  /* per-recipe add: drink-specific delta (e.g. Hot → +extra coffee), STACKS on global */
  if(gid&&rec&&rec.choiceAdd&&rec.choiceAdd[gid]&&rec.choiceAdd[gid][lk]&&(rec.choiceAdd[gid][lk].ings||[]).length){push(rec.choiceAdd[gid][lk].ings);found=true;}
  if(found)return out;
  var lg=optRecipeFor(rec,label); /* legacy single-ingredient flat qty, only if nothing above */
  if(lg&&lg.ing)return [{ing:lg.ing,qty:Number(lg.qty)||0}];
  return [];
}
/* Shared read-only recipe-cost helper for isolated reporting modules. */
window.__accazaChoiceIngs=choiceIngs;

// ---- boot (wait for bridge) ----
var tries=0,iv=setInterval(function(){ if(window.__accaza){clearInterval(iv);init();} else if(++tries>150){clearInterval(iv);} },100);

var _offState={pending:0,syncing:0,failed:0,synced:0,total:0,rows:[]};
function offlineQueue(){if(!window.AccazaOfflineQueue)throw new Error('Durable offline storage is unavailable.');return window.AccazaOfflineQueue;}
function queueOfflineOrder(o){return offlineQueue().enqueue(o).then(function(){return refreshOfflineState();}).then(function(){return{mode:'queue'};});}
function persistPosSale(o){
  return queueOfflineOrder(o).catch(function(storageError){
    var q=offlineQueue();if(!q.isQuotaError||!q.isQuotaError(storageError)||window.__online===false)throw storageError;
    var a=A();if(!a||!a.syncOfflinePosSale)throw storageError;
    telemetry().metric('charge_quota_server_recovery',1,true);
    return a.syncOfflinePosSale({transactionId:o.clientTxnId,order:o,drawerDelta:q.drawerDelta(o)}).then(function(response){return{mode:'server',response:response,recoveredFrom:'QuotaExceededError'};}).catch(function(serverError){var combined=new Error('Browser storage is full and the server fallback also failed: '+String(serverError&&serverError.message||serverError));combined.storageError=storageError;combined.serverError=serverError;throw combined;});
  });
}
function refreshOfflineState(){return offlineQueue().summary().then(function(s){_offState=s;renderOfflineUI();return s;}).catch(function(e){_offState.error=String(e&&e.message||e);renderOfflineUI();return _offState;});}
function flushOfflineQueue(){if(window.__online===false){updateOfflineUI();return Promise.resolve({offline:true});}var t=performance.now();return offlineQueue().flush(function(command){return A().syncOfflinePosSale(command);},refreshOfflineState).then(function(r){telemetry().metric('offline_flush',performance.now()-t,true);refreshOfflineState();if(r&&r.synced&&window.__posLog)window.__posLog('offline-sync','batch',r.synced+' sale(s) synced');return r;}).catch(function(e){telemetry().metric('offline_flush',performance.now()-t,false);throw e;});}
function renderOfflineUI(){var el=document.getElementById('posOfflineBar');if(!el)return;var pend=(_offState.pending||0)+(_offState.syncing||0),failed=_offState.failed||0,click=' onclick="window.__showOfflineQueue()" title="View transaction sync queue"';if(_offState.error){el.innerHTML='<button'+click+' style="background:#fdecea;border:1px solid #f5c6c6;color:#c0392b;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">⛔ Offline storage error</button>';}else if(window.__online===false){el.innerHTML='<button'+click+' style="background:#fdecea;border:1px solid #f5c6c6;color:#c0392b;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">🔴 Offline · '+pend+' Pending Sync'+(failed?' · '+failed+' Failed':'')+'</button>';}else if(failed){el.innerHTML='<button'+click+' style="background:#fdecea;border:1px solid #f5c6c6;color:#c0392b;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">🔴 '+failed+' Failed · Retry</button>';}else if(pend){el.innerHTML='<button'+click+' style="background:#fff8e1;border:1px solid #ffe0a3;color:#8a6d1b;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">🟡 Syncing '+pend+' sale(s)…</button>';}else if(_offState.storageWarning){el.innerHTML='<button'+click+' style="background:#fff4e5;border:1px solid #f2c078;color:#8a5a00;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">🟠 '+esc(_offState.storageWarning)+'</button>';}else{el.innerHTML='<button'+click+' style="background:#e8f5ec;border:1px solid #b8dfc4;color:#155724;border-radius:6px;padding:0.45rem 0.6rem;font-size:0.76rem;font-weight:600;cursor:pointer;">🟢 Online · Synced</button>';}if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();}
function updateOfflineUI(){renderOfflineUI();refreshOfflineState();}
function checkPosStorageHealth(){var q;try{q=offlineQueue();}catch(e){_offState.error=String(e&&e.message||e);renderOfflineUI();return Promise.resolve(null);}if(!q.storageHealth)return Promise.resolve(null);return q.storageHealth().then(function(h){_offState.storageHealth=h;if(!h.writable){_offState.error='Browser storage is not writable. Online sales will use server recovery; offline sales are unavailable.';}else if(h.ratio!=null&&h.ratio>=.85){_offState.storageWarning='Browser storage is '+Math.round(h.ratio*100)+'% full. Synced POS records will be cleaned automatically.';}else{delete _offState.storageWarning;}renderOfflineUI();return h;}).catch(function(e){_offState.error=String(e&&e.message||e);renderOfflineUI();return null;});}
window.__showOfflineQueue=function(note){offlineQueue().all().then(function(rows){
  var old=document.getElementById('posSyncQueueMask');if(old)old.remove();
  var m=document.createElement('div');m.id='posSyncQueueMask';m.className='pz-mask show';
  var pending=rows.filter(function(r){return r.status==='pending'||r.status==='failed'||r.status==='syncing';}).length;
  var banner=note?'<div style="background:#e8f5ec;border:1px solid #b8dfc4;color:#155724;border-radius:6px;padding:0.5rem 0.7rem;font-size:0.78rem;line-height:1.4;margin-bottom:0.6rem;">'+esc(note)+'</div>':'';
  var label=pending?('Retry '+pending+' pending / failed now'):'Nothing to sync';
  var body=rows.length?rows.slice().reverse().map(function(r){var col=r.status==='synced'?'#155724':r.status==='failed'?'#c0392b':'#8a6d1b';return '<div style="border-bottom:1px solid #ddd;padding:0.55rem 0;"><div style="display:flex;justify-content:space-between;gap:1rem;"><b>'+esc((r.order&&r.order.id)||r.id)+'</b><b style="color:'+col+';">'+esc(r.status.toUpperCase())+'</b></div><div style="font-size:0.75rem;color:#666;">'+peso((r.order&&r.order.total)||0)+' · attempts '+(r.attempts||0)+'</div>'+(r.lastError?'<div style="font-size:0.72rem;color:#c0392b;margin-top:0.2rem;">'+esc(r.lastError)+'</div>':'')+(r.status==='failed'?'<button class="pz-btn sec" data-sync-retry="'+esc(r.id)+'" style="margin-top:0.35rem;">Retry this sale</button>':'')+'</div>';}).join(''):'<p>No queued transactions.</p>';
  m.innerHTML='<div class="pz-modal" style="max-width:560px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="pz-h">Transaction Sync Queue</div><button class="pz-btn sec" data-sync-close>✕</button></div><p style="font-size:0.78rem;color:#666;">Pending is stored on this device. Synced means Firebase confirmed it.</p>'+banner+'<div style="max-height:55vh;overflow:auto;">'+body+'</div><button class="pz-btn ok" data-sync-all style="width:100%;margin-top:0.8rem;">'+label+'</button></div>';
  document.body.appendChild(m);
  m.querySelector('[data-sync-close]').onclick=function(){m.remove();};
  var allBtn=m.querySelector('[data-sync-all]');
  allBtn.onclick=function(){
    if(!pending){alert('Nothing to sync.');return;}
    allBtn.disabled=true;allBtn.textContent='Working…';
    flushOfflineQueue().then(function(r){var q=offlineQueue();return(q.compactSynced?q.compactSynced().catch(function(){}):Promise.resolve()).then(function(){return r;});}).then(function(r){var msg;if(r&&r.offline){msg='Offline — sales stay queued on this device until the connection returns.';}else if(r&&r.busy){msg='A sync is already running — give it a moment, then reopen.';}else{var s=(r&&r.synced)||0,f=(r&&r.failed)||0;msg=(s?s+' sale(s) synced. ':'')+(f?f+' still failing — see the errors above. ':'')+((!s&&!f)?'All sales were already confirmed. ':'')+'Confirmed sales cleared from the queue.';}m.remove();window.__showOfflineQueue(msg);}).catch(function(e){m.remove();window.__showOfflineQueue('Could not complete sync: '+String((e&&e.message)||e));});
  };
  m.querySelectorAll('[data-sync-retry]').forEach(function(b){b.onclick=function(){offlineQueue().retry(this.getAttribute('data-sync-retry')).then(flushOfflineQueue).then(function(){m.remove();window.__showOfflineQueue('Retried sale.');});};});
});};
window.__flushOfflineQueue=flushOfflineQueue;
function posMethods(){
  var pm=(window.__posSettings&&window.__posSettings.payMethods);
  if(!pm||!pm.length)pm=[{name:'Cash',active:true,cash:true},{name:'GCash',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'Bank Transfer',active:true,cash:false,verificationPolicy:'manager_only'},{name:'Card / EFTPOS',active:false,cash:false,verificationPolicy:'manager_only'}];
  return pm;
}
function directPaymentRows(payments){return(payments||[]).filter(function(p){var m=String(p&&p.method||'').trim().toLowerCase();return m&&m!=='cash'&&m!=='grabfood'&&m!=='foodpanda';});}
function defaultPaymentVerificationPolicy(method){return /gcash|maya/i.test(String(method||''))?'cashier_manager':'manager_only';}
function paymentVerificationPolicy(payments){var direct=directPaymentRows(payments),methods=posMethods();if(!direct.length)return null;return direct.some(function(p){var row=methods.find(function(m){return String(m&&m.name||'').trim().toLowerCase()===String(p.method||'').trim().toLowerCase();}),policy=row&&row.verificationPolicy;return (policy==='cashier_manager'||policy==='manager_only'?policy:defaultPaymentVerificationPolicy(p.method))==='manager_only';})?'manager_only':'cashier_manager';}
function posActiveMethods(){return posMethods().filter(function(m){return m.active!==false;});}
function isCashMethod(name){var m=posMethods().filter(function(x){return x.name===name;})[0];return m?!!m.cash:(name==='Cash');}
window.__isCashMethod=isCashMethod;
function init(){
  var a=A();
  window.__online=(typeof navigator!=='undefined')?navigator.onLine:true;
  a.subscribe('posSettings', function(s){ window.__posSettings=s.val()||{}; if(document.getElementById('posPay'))renderPosCart(); if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); });
  a.subscribe('.info/connected', function(sn){ window.__online=(sn.val()===true); updateOfflineUI(); if(window.__online) flushOfflineQueue(); });
  try{ window.addEventListener('online', function(){ window.__online=true; updateOfflineUI(); flushOfflineQueue(); }); window.addEventListener('offline', function(){ window.__online=false; updateOfflineUI(); }); }catch(e){}
  checkPosStorageHealth();
  flushOfflineQueue();
  a.subscribe('availability', function(s){ posAvailMap=s.val()||{}; if(isTab('pos')&&document.getElementById('posItems'))drawPosItems(); });
  a.subscribe('inventory', function(s){ inventoryMap=s.val()||{}; if(isTab('inventory'))renderInventory(); if(isTab('recipes')&&!recipeEditing)renderRecipes(); updateLowStockBadge(); updateCostBadge(); });
  a.subscribe('inventorySku', function(s){ inventorySkuMap=s.val()||{}; if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); });
  a.subscribe('inventoryMovements', function(s){ inventoryMovementsMap=s.val()||{}; if(isTab('inventory'))renderInventory(); });
  a.subscribe('purchaseInvoices', function(s){ purchaseInvoicesMap=s.val()||{}; if(isTab('purchases'))renderPurchases(); });
  a.subscribe('recipes', function(s){ recipesMap=s.val()||{}; if(isTab('recipes')&&!recipeEditing)renderRecipes(); if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); updateCostBadge(); });
  a.subscribe('optionRecipes', function(s){ var raw=s.val()||{}; var m={}; Object.keys(raw).forEach(function(k){var v=raw[k]||{}; var lb=v.label||k; m[lb]=v;}); optRecipesMap=m; if(isTab('recipes')&&!recipeEditing)renderRecipes(); if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); });
  a.subscribe('internalUsage', function(s){ usageMap=s.val()||{}; if(isTab('usage'))renderUsage(); });
  a.subscribe('usageTypes', function(s){ usageTypesMap=s.val()||{}; if(isTab('usage'))renderUsage(); });
  a.subscribe('channelPrices', function(s){ channelPricesMap=s.val()||{}; if(isTab('channelpricing')&&window.__accazaRenderChannelPricing)window.__accazaRenderChannelPricing(); });
  a.subscribe('activeOrders', function(s){ onlineOrdersMap=s.val()||{}; if(isTab('pos')){updatePosOrderCounts();if(posView==='online')renderOnlineOrders();if(posView==='active')renderActiveOrders();} });
  a.subscribe('posSettings', function(s){ var v=s.val(); if(v)posMeta=Object.assign({vat:false,vatRate:12},v); });
  ensureModals();
}
function isTab(name){var el=document.getElementById('tab-'+name);return el&&el.style.display!=='none';}

window.__accazaRegisterModule('pos',function(name){ if(name==='pos'){buildPOS();} if(name==='inventory')renderInventory(); if(name==='purchases')renderPurchases(); if(name==='recipes'){recipeEditing=false;renderRecipes();} if(name==='usage')renderUsage(); if(name==='dedupe')renderDedupe(); });

/* ══════════ INVENTORY ══════════ */
function renderInventory(){
  var root=document.getElementById('inventoryRoot'); if(!root)return;
  var list=ings();
  var low=list.filter(function(i){return Number(i.stock)<=Number(i.reorder||0)&&Number(i.stock)>=0;});
  var neg=list.filter(function(i){return Number(i.stock)<0;});
  var ozItems=list.filter(function(i){var u=uNorm(i.unit);return !i.ledgerVersion&&(u==='oz'||u==='ounce');});
  seedInvCats(); var catList=invCats(); var catFilter=window.__invCatFilter||'';
  var uncat=list.filter(function(i){return !(i.category&&invCatsMap()[i.category]);});
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
    var tyBadge=ty==='consumable'?('🧻 Consumable'+(i.serves&&i.serves!=='both'?' · '+esc(i.serves):'')+(i.size?' · '+esc(i.size):'')):(ty==='option'?'➕ Option':(ty==='both'?'🔀 Both':'🧪 Base'));
    return '<tr>'
      +'<td>'+esc(i.name)+'</td>'
      +'<td style="font-size:0.78rem;color:var(--tl);">'+tyBadge+'</td>'
      +'<td style="font-size:0.78rem;">'+(i.category?(esc(invCatName(i.category))+(invCatKind(i.category)==='overhead'?' <span style="color:#8a5a00;font-size:0.66rem;">overhead</span>':'')):'<span style="color:var(--tl);">—</span>')+'</td>'
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
    +'<p class="pz-sub">Each inventory row is the common SKU used by recipes. Approved brands are interchangeable purchasing options beneath that SKU. Completed orders deduct the common SKU while receipts retain the selected brand.'+(low.length?' <b class="pz-low">'+low.length+' low.</b>':'')+(neg.length?' <b class="pz-low">'+neg.length+' negative.</b>':'')+(uncat.length?' <b style="color:#8a5a00;">'+uncat.length+' uncategorized.</b>':'')+(missingBrand.length?' <b style="color:#8a5a00;">'+missingBrand.length+' recipe item'+(missingBrand.length===1?'':'s')+' without an approved purchasing brand.</b>':'')+'</p>'
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
    +'<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="font-weight:600;color:var(--bd);margin-bottom:0.6rem;font-size:0.9rem;">➕ Add item</div>'
      +'<div style="display:grid;grid-template-columns:1.6fr 0.9fr 1.1fr 1.1fr 0.9fr 0.9fr 0.9fr auto;gap:0.5rem;align-items:end;">'
        +'<div><span class="pz-lbl">Name</span><input class="pz-in" id="invName" placeholder="e.g. Espresso beans"/></div>'
        +'<div><span class="pz-lbl">Unit</span><select class="pz-in" id="invUnit"><option>g</option><option>kg</option><option>ml</option><option>L</option><option>fl oz</option><option>pcs</option><option>shot</option><option>pump</option><option>ea</option></select></div>'
        +'<div><span class="pz-lbl">Type</span><select class="pz-in" id="invType"><option value="base">Base</option><option value="option">Option</option><option value="both">Both (base+option)</option><option value="consumable">Consumable</option></select></div>'
        +'<div><span class="pz-lbl">Category</span><select class="pz-in" id="invCat"><option value="">—</option>'+catList.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>';}).join('')+'</select></div>'
        +'<div><span class="pz-lbl">Stock</span><input class="pz-in" id="invStock" type="number" step="any" placeholder="0"/></div>'
        +'<div><span class="pz-lbl">Reorder</span><input class="pz-in" id="invReorder" type="number" step="any" placeholder="0"/></div>'
        +'<div><span class="pz-lbl">Cost/unit ₱</span><input class="pz-in" id="invCost" type="number" step="any" placeholder="opt."/></div>'
        +'<button class="pz-btn" id="invAddBtn">Add</button>'
      +'</div>'
      +'<div id="invConsumRow" style="display:none;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-top:0.5rem;">'
        +'<div><span class="pz-lbl">Consumable serves</span><select class="pz-in" id="invServes"><option value="both">Both</option><option value="drink">Drinks only</option><option value="food">Food only</option></select></div>'
        +'<div><span class="pz-lbl">Cup size (blank = all)</span><select class="pz-in" id="invSize"><option value="">— all sizes —</option><option>S</option><option>M</option><option>L</option></select></div>'
        +'<div><span class="pz-lbl">Qty per order</span><input class="pz-in" id="invQPO" type="number" step="any" value="1"/></div>'
      +'</div>'
    +'</div>'
    +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl inventory-table"><thead><tr><th>SKU / stock item</th><th>Type</th><th>Category</th><th>In stock</th><th>Reorder</th><th>Cost</th><th>Recipe / brands</th><th>Actions</th></tr></thead><tbody>'
      +(rows||'<tr><td colspan="8" style="color:var(--tl);padding:1rem;">No items in this view.</td></tr>')
    +'</tbody></table></div></div>'
    +'<div class="pz-card" style="margin-top:1rem;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div style="font-weight:600;color:var(--bd);">🧾 Inventory movement ledger</div><span style="font-size:0.74rem;color:var(--tl);">Latest '+movements.length+' loaded · immutable server record</span></div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Date/time</th><th>Movement</th><th>Item</th><th class="r">Quantity</th><th class="r">Balance</th><th class="r">Unit cost</th><th>Source</th><th>Posted by</th></tr></thead><tbody>'+(movementRows||'<tr><td colspan="8" style="padding:0.7rem;color:var(--tl);">No ledger movements loaded yet. Initialize once to capture today’s stock and cost as opening balances.</td></tr>')+'</tbody></table></div></div>';
  document.getElementById('invAddBtn').onclick=addIngredient;
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
/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 1: Approved-brand (SKU) manager ══════════
   Per Ingredient Master, manage the approved list of purchasable brands/SKUs. Add/edit/
   activate/deactivate/rank — NEVER touches a recipe. costPerBase auto-derives from pack size
   + purchase cost via the existing unit conversion. Reads/writes inventorySku/{sid}. */
function skuCostPerBase(item,packSize,purchaseUnit,purchaseCost){
  var baseUnits=convertToStock(Number(packSize)||0,purchaseUnit,item); // package size expressed in the item's base unit
  if(!baseUnits)return {base:0,per:0};
  return {base:baseUnits,per:(Number(purchaseCost)||0)/baseUnits};
}
function openSkuManager(id,onUse){
  var a=A(); var item=inventoryMap[id]; if(!item){alert('Item not found.');return;}
  var baseU=item.masterUnit||item.unit||''; var editId=null;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function load(){ a.get(a.ref(a.db,'inventorySku')).then(function(s){ var all=s.val()||{}; inventorySkuMap=all;var mine=Object.keys(all).map(function(k){return Object.assign({id:k},all[k]);}).filter(function(x){return x.masterId===id;}).sort(function(x,y){return (Number(x.priority)||0)-(Number(y.priority)||0);}); draw(mine); }).catch(function(e){ mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;padding:1.2rem;"><div style="font-weight:700;color:var(--bd);">Could not load approved brands</div><p class="pz-sub">'+esc((e&&e.code)||String(e))+'</p><button class="pz-btn sec" id="skErrX">Close</button></div>'; var b=document.getElementById('skErrX'); if(b)b.onclick=close; }); }
  var unitOpts=compatUnits(item).map(function(u){return '<option value="'+esc(u)+'"'+(uNorm(u)===uNorm(item.unit)?' selected':'')+'>'+esc(u)+'</option>';}).join('');
  function draw(mine){
    var rows=mine.map(function(sk,ix){
      var per=Number(sk.costPerBase)||0;
      var pack=(sk.packSize!=null&&sk.packSize!=='')?(num(sk.packSize)+' '+esc(sk.purchaseUnit||'')):'—';
      return '<tr'+(sk.active===false?' style="opacity:0.5;"':'')+'>'
        +'<td style="white-space:nowrap;"><button class="pz-btn sec" data-skup="'+sk.id+'" '+(ix===0?'disabled':'')+' style="padding:0.05rem 0.35rem;">▲</button> <button class="pz-btn sec" data-skdn="'+sk.id+'" '+(ix===mine.length-1?'disabled':'')+' style="padding:0.05rem 0.35rem;">▼</button></td>'
        +'<td><b>'+esc(sk.brand||'—')+'</b></td>'
        +'<td style="font-size:0.8rem;">'+esc(sk.supplier||'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+pack+'</td>'
        +'<td style="font-size:0.8rem;">'+(sk.purchaseCost?peso(sk.purchaseCost):'—')+'</td>'
        +'<td style="font-size:0.8rem;white-space:nowrap;">'+(per?('₱'+per.toFixed(4)+'/'+esc(baseU)):'—')+'</td>'
        +'<td style="font-size:0.8rem;">'+(sk.active===false?'<span style="color:#a55;">inactive</span>':'<span style="color:#2a7;">active</span>')+'</td>'
        +'<td style="white-space:nowrap;">'+(onUse&&sk.active!==false?'<button class="pz-btn ok" data-skuse="'+sk.id+'" style="padding:0.15rem 0.5rem;">Use this brand</button> ':'')+'<button class="pz-btn sec" data-sked="'+sk.id+'" style="padding:0.15rem 0.5rem;">Edit</button> <button class="pz-btn sec" data-sktog="'+sk.id+'" style="padding:0.15rem 0.5rem;">'+(sk.active===false?'Activate':'Deactivate')+'</button> <button class="pz-btn warn" data-skdel="'+sk.id+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
    }).join('');
    var e=editId?(mine.filter(function(x){return x.id===editId;})[0]||{}):{};
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:920px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">Approved brands — '+esc(item.name)+'</div><button class="pz-btn sec" id="skClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;"><b>'+esc(item.name)+'</b> is the common SKU used by recipes. These are the interchangeable brands allowed when purchasing it. Adding, deactivating, or reordering brands never changes a recipe. Cost per '+esc(baseU)+' is calculated from pack size and purchase cost.'+(item.skuMigrated?'':' <b style="color:#8a5a00;">Tip: run “Brand &amp; Batch setup” to seed brands from purchase history.</b>')+'</p>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Rank</th><th>Brand</th><th>Supplier</th><th>Pack</th><th>Purchase ₱</th><th>Cost/base</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" style="padding:0.8rem;color:var(--tl);">No approved brands yet — add one below.</td></tr>')+'</tbody></table></div>'
      +'<div class="pz-card" style="margin-top:0.8rem;">'
        +'<div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">'+(editId?'✏️ Edit brand':'➕ Add brand')+'</div>'
        +'<div style="display:grid;grid-template-columns:1.3fr 1.2fr 0.8fr 0.9fr 1fr auto;gap:0.5rem;align-items:end;">'
          +'<div><span class="pz-lbl">Brand</span><input class="pz-in" id="skBrand" value="'+esc(e.brand||'')+'" placeholder="e.g. Arla Full Cream"/></div>'
          +'<div><span class="pz-lbl">Supplier</span><input class="pz-in" id="skSup" value="'+esc(e.supplier||'')+'" placeholder="optional"/></div>'
          +'<div><span class="pz-lbl">Pack size</span><input class="pz-in" id="skPack" type="number" step="any" value="'+(e.packSize!=null?e.packSize:'')+'" placeholder="1"/></div>'
          +'<div><span class="pz-lbl">Purchase unit</span><select class="pz-in" id="skUnit">'+unitOpts+'</select></div>'
          +'<div><span class="pz-lbl">Purchase cost ₱</span><input class="pz-in" id="skCost" type="number" step="any" value="'+(e.purchaseCost!=null?e.purchaseCost:'')+'" placeholder="110"/></div>'
          +'<button class="pz-btn ok" id="skSave">'+(editId?'Save':'Add')+'</button>'
        +'</div>'
        +'<div id="skPrev" style="font-size:0.78rem;color:var(--tm);margin-top:0.4rem;"></div>'
        +(editId?'<button class="pz-btn sec" id="skCancelEdit" style="margin-top:0.5rem;padding:0.2rem 0.6rem;">Cancel edit</button>':'')
      +'</div></div>';
    if(e.purchaseUnit){var us=document.getElementById('skUnit');if(us)us.value=e.purchaseUnit;}
    document.getElementById('skClose').onclick=close;
    function prev(){var p=skuCostPerBase(item,document.getElementById('skPack').value,document.getElementById('skUnit').value,document.getElementById('skCost').value);document.getElementById('skPrev').innerHTML=p.per?('= <b>₱'+p.per.toFixed(4)+'/'+esc(baseU)+'</b> ('+num(p.base)+' '+esc(baseU)+' per pack)'):'Enter pack size + cost to see cost per '+esc(baseU)+'.';}
    ['skPack','skUnit','skCost'].forEach(function(idf){var el=document.getElementById(idf);if(el)el.oninput=prev,el.onchange=prev;}); prev();
    var ce=document.getElementById('skCancelEdit'); if(ce)ce.onclick=function(){editId=null;load();};
    document.getElementById('skSave').onclick=function(){
      var brand=(document.getElementById('skBrand').value||'').trim(); if(!brand){alert('Enter a brand name.');return;}
      var duplicate=mine.some(function(sk){return sk.id!==editId&&uNorm(sk.brand)===uNorm(brand);});if(duplicate){alert('This brand is already approved for '+(item.name||'this item')+'. Select the existing brand instead.');return;}
      var pack=document.getElementById('skPack').value, punit=document.getElementById('skUnit').value, pcost=document.getElementById('skCost').value;
      var p=skuCostPerBase(item,pack,punit,pcost);
      var rec={masterId:id,brand:brand,supplier:(document.getElementById('skSup').value||'').trim(),purchaseUnit:punit,packSize:(pack===''?null:Number(pack)||0),purchaseCost:(pcost===''?null:Number(pcost)||0),convToBase:p.base,costPerBase:p.per,branchAvail:['main'],updatedAt:Date.now()};
      if(editId){ a.update(a.ref(a.db,'inventorySku/'+editId),rec).then(function(){editId=null;load();}).catch(skErr); }
      else { rec.active=true; rec.priority=mine.length; rec.createdAt=Date.now(); rec.seededFrom='manual';var newSid=uid('sku_');a.set(a.ref(a.db,'inventorySku/'+newSid),rec).then(function(){inventorySkuMap[newSid]=rec;if(onUse){onUse(newSid,rec);close();}else load();}).catch(skErr); }
    };
    mask.querySelectorAll('[data-skuse]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-skuse'),selected=mine.filter(function(x){return x.id===sid&&x.active!==false;})[0];if(!selected)return;inventorySkuMap[sid]=selected;onUse(sid,selected);close();};});
    mask.querySelectorAll('[data-sked]').forEach(function(b){b.onclick=function(){editId=b.getAttribute('data-sked');draw(mine);};});
    mask.querySelectorAll('[data-sktog]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-sktog');var cur=mine.filter(function(x){return x.id===sid;})[0]||{};a.update(a.ref(a.db,'inventorySku/'+sid),{active:!(cur.active!==false)}).then(load).catch(skErr);};});
    mask.querySelectorAll('[data-skdel]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-skdel');var cur=mine.filter(function(x){return x.id===sid;})[0]||{};if(!confirm('Remove brand “'+((cur.brand)||'')+'”? Past purchase receipts and batches are unaffected.'))return;a.remove(a.ref(a.db,'inventorySku/'+sid)).then(load).catch(skErr);};});
    function reorder(sid,dir){var i=mine.map(function(x){return x.id;}).indexOf(sid);var j=i+dir;if(i<0||j<0||j>=mine.length)return;var upd={};upd['inventorySku/'+mine[i].id+'/priority']=j;upd['inventorySku/'+mine[j].id+'/priority']=i;a.update(a.ref(a.db),upd).then(load).catch(skErr);}
    mask.querySelectorAll('[data-skup]').forEach(function(b){b.onclick=function(){reorder(b.getAttribute('data-skup'),-1);};});
    mask.querySelectorAll('[data-skdn]').forEach(function(b){b.onclick=function(){reorder(b.getAttribute('data-skdn'),1);};});
  }
  function skErr(e){alert('Could not save: '+((e&&e.code)||e)+'.\n\nIf PERMISSION_DENIED — log in with your admin email and publish the rules (inventorySku node).');}
  load();
}
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
/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 3: Standard vs Actual costing ══════════
   Standard cost = pricing lens (menu margin, food-cost %). Actual COGS stays weighted-average
   (unchanged, already snapshotted per sale into cogsSnapshot). Method 'wac' (default) makes
   standard = live WAC; 'manual' lets you lock a standard that pricing uses independently. */
function openStdCosting(){
  var a=A(); var size=window.__stdSize||'M'; var method=stdCostMethod();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function pctCol(fc){ return fc<=35?'#2a7':(fc<=45?'#c98a2b':'#c0392b'); }
  function draw(){
    size=window.__stdSize||'M'; method=stdCostMethod();
    var items=(typeof menuList==='function'?menuList():[]).slice();
    var sizeBtns=['S','M','L'].map(function(s){return '<button class="pz-btn '+(s===size?'ok':'sec')+'" data-stdsize="'+s+'" style="padding:0.2rem 0.7rem;">'+s+'</button>';}).join(' ');
    var sumFc=0,nFc=0,nUncosted=0,nNoRec=0;
    var rows=items.map(function(it){
      var price=Number(it['price'+size])||0;
      var r=recipeStdCost(it.key,size);
      if(!r.has||it.noRecipe){ if(!it.noRecipe)nNoRec++; return '<tr><td>'+esc(it.name)+'</td><td class="r">'+(price?peso(price):'—')+'</td><td class="r" style="color:var(--tl);">'+(it.noRecipe?'resale':'no recipe')+'</td><td class="r">—</td><td class="r">—</td><td class="r">—</td></tr>'; }
      var cost=r.cost; var gp=price-cost; var gpp=price>0?(gp/price*100):0; var fc=price>0?(cost/price*100):0;
      if(price>0){sumFc+=fc;nFc++;}
      if(!r.covered)nUncosted++;
      return '<tr>'
        +'<td>'+esc(it.name)+(r.covered?'':' <span title="an ingredient has no cost" style="color:#c0392b;">⚠</span>')+'</td>'
        +'<td class="r">'+(price?peso(price):'—')+'</td>'
        +'<td class="r">'+peso(cost)+'</td>'
        +'<td class="r">'+peso(gp)+'</td>'
        +'<td class="r" style="font-weight:600;">'+(price?num(Math.round(gpp*10)/10)+'%':'—')+'</td>'
        +'<td class="r" style="font-weight:600;color:'+pctCol(fc)+';">'+(price?num(Math.round(fc*10)/10)+'%':'—')+'</td>'
      +'</tr>';
    }).join('');
    var avgFc=nFc?Math.round(sumFc/nFc*10)/10:0;
    // ingredient standard vs WAC drift (matters when method=manual or a standard was locked)
    var drift=ings().filter(function(x){return x.stdCost!=null&&x.stdCost!==''&&Math.abs((Number(x.stdCost)||0)-(Number(x.cost)||0))>0.00001;})
      .map(function(x){var d=(Number(x.cost)||0)-(Number(x.stdCost)||0);return '<tr><td>'+esc(x.name)+'</td><td class="r">'+peso(Number(x.stdCost)||0)+'</td><td class="r">'+peso(Number(x.cost)||0)+'</td><td class="r" style="color:'+(d>0?'#c0392b':'#2a7')+';">'+(d>0?'+':'')+peso(d)+'/'+esc(x.unit||'')+'</td></tr>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📊 Standard costing — pricing &amp; margin</div><button class="pz-btn sec" id="stClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Expected recipe cost per drink using <b>standard</b> cost, and the margin it implies. Actual COGS on sales stays weighted-average and is unchanged. Options/add-ons are excluded (they’re priced separately); this is the base drink.</p>'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:center;background:var(--cd);border-radius:6px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;font-size:0.82rem;">'
        +'<span>Standard cost method: <select class="pz-in" id="stMethod" style="width:auto;display:inline-block;"><option value="wac"'+(method==='wac'?' selected':'')+'>Weighted-average (auto)</option><option value="manual"'+(method==='manual'?' selected':'')+'>Manual / locked</option></select></span>'
        +'<span>Size: '+sizeBtns+'</span>'
        +'<button class="pz-btn sec" id="stSetWac" style="padding:0.2rem 0.6rem;">Set all standards = current WAC</button>'
        +'<button class="pz-btn sec" id="stXls" style="padding:0.2rem 0.6rem;">⬇ Excel</button>'
        +'<span style="margin-left:auto;">Avg food cost: <b style="color:'+pctCol(avgFc)+';">'+num(avgFc)+'%</b>'+(nUncosted?' · <b style="color:#c0392b;">'+nUncosted+' uncosted</b>':'')+'</span>'
      +'</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Menu item</th><th class="r">Price ('+size+')</th><th class="r">Std cost</th><th class="r">GP ₱</th><th class="r">GP %</th><th class="r">Food %</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No menu items with recipes yet.</td></tr>')+'</tbody></table></div>'
      +(method==='manual'?('<div style="margin-top:0.8rem;font-weight:600;color:var(--bd);font-size:0.9rem;">Standard vs actual (WAC) drift — ingredients</div><p class="pz-sub" style="margin-top:0.1rem;">Where your locked standard differs from the live weighted-average. Big gaps = time to refresh the standard.</p><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Ingredient</th><th class="r">Standard</th><th class="r">WAC (actual)</th><th class="r">Actual − Std</th></tr></thead><tbody>'+(drift||'<tr><td colspan="4" style="padding:0.6rem;color:var(--tl);">No locked standards differ from WAC.</td></tr>')+'</tbody></table></div>'):'<p class="pz-sub" style="margin-top:0.6rem;">Method is <b>Weighted-average</b>: standard tracks live WAC, so standard = actual. Switch to <b>Manual</b> to lock standards (e.g. a target or replacement cost) and see drift.</p>')
      +'</div>';
    document.getElementById('stClose').onclick=close;
    mask.querySelectorAll('[data-stdsize]').forEach(function(b){b.onclick=function(){window.__stdSize=b.getAttribute('data-stdsize');draw();};});
    document.getElementById('stMethod').onchange=function(){var v=this.value;window.__posSettings=window.__posSettings||{};window.__posSettings.stdCostMethod=v;a.update(a.ref(a.db,'posSettings'),{stdCostMethod:v}).catch(function(e){alert('Could not save method: '+((e&&e.code)||e));});draw();};
    document.getElementById('stSetWac').onclick=function(){ if(!confirm('Set every item’s standard cost to its current weighted-average? This snapshots today’s WAC as the standard (useful before switching to Manual).'))return; var upd={}; ings().forEach(function(x){upd['inventory/'+x.id+'/stdCost']=Number(x.cost)||0;}); a.update(a.ref(a.db),upd).then(function(){alert('Standards set to current WAC for '+Object.keys(upd).length+' item(s).');draw();}).catch(function(e){alert('Could not update: '+((e&&e.code)||e));}); };
    document.getElementById('stXls').onclick=function(){ if(!window.XLSX){alert('Excel library still loading — try again.');return;} var aoa=[['Menu item','Size','Price','Std cost','GP','GP%','Food%','Costed']]; (typeof menuList==='function'?menuList():[]).forEach(function(it){['S','M','L'].forEach(function(s){var price=Number(it['price'+s])||0;var r=recipeStdCost(it.key,s);if(!r.has)return;var gp=price-r.cost;aoa.push([it.name,s,price,r.cost,Math.round(gp*100)/100,price>0?Math.round(gp/price*1000)/10:'',price>0?Math.round(r.cost/price*1000)/10:'',r.covered?'yes':'MISSING']);});}); var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'StdCosting');XLSX.writeFile(wb,'accaza-standard-costing-'+window.AccazaDate.key()+'.xlsx'); };
  }
  draw();
}
function addIngredient(){
  var name=(document.getElementById('invName').value||'').trim(); if(!name){alert('Enter an ingredient name.');return;}
  var type=(document.getElementById('invType')||{}).value||'base';
  var openingStock=Number(document.getElementById('invStock').value)||0, openingCost=Number(document.getElementById('invCost').value)||0;
  var o={name:name,unit:document.getElementById('invUnit').value,type:type,category:(document.getElementById('invCat')||{}).value||'',stock:0,reorder:Number(document.getElementById('invReorder').value)||0,cost:0,updatedAt:Date.now()};
  if(type==='consumable'){ o.serves=(document.getElementById('invServes')||{}).value||'both'; o.size=(document.getElementById('invSize')||{}).value||''; o.qtyPerOrder=Number((document.getElementById('invQPO')||{}).value)||1; }
  var a=A(), id=uid('ing_'), sourceId=uid('new_');a.set(a.ref(a.db,'inventory/'+id),o).then(function(){
    return postMovements([{movementId:movementId('manual_edit',sourceId,id),itemId:id,type:'manual_edit',qty:openingStock,unitCost:openingCost,setCost:true,sourceType:'new-inventory-item',sourceId:sourceId,note:'Opening quantity entered when item was created',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()}]);
  }).then(function(){ document.getElementById('invName').value=''; }).catch(function(e){ alert('Could not add the item: '+((e&&e.message)||e)+'.'); });
}
function adjustStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var before=Number(i.stock)||0;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Adjust stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">Book stock now: <b>'+num(before)+' '+esc(i.unit||'')+'</b></p>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.35rem;cursor:pointer;"><input type="radio" name="adjmode" value="count" checked/> Enter physical count (system computes the variance)</label>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.6rem;cursor:pointer;"><input type="radio" name="adjmode" value="delta"/> Enter a +/- adjustment (e.g. -3 wastage)</label>'
    +'<div><span class="pz-lbl" id="adjLbl">Physical count ('+esc(i.unit||'units')+')</span><input class="pz-in" id="adjVal" type="number" step="any"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Reason</span><select class="pz-in" id="adjReason"><option>count-variance</option><option>wastage</option><option>staff-drink</option><option>extra-cup</option><option>comp</option><option>other</option></select></div>'
    +'<div id="adjPreview" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="adjSubmit">Apply adjustment</button><button class="pz-btn sec" id="adjCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function mode(){return (mask.querySelector('input[name=adjmode]:checked')||{}).value||'count';}
  function calcDelta(){var v=Number((mask.querySelector('#adjVal')||{}).value)||0;return mode()==='count'?(v-before):v;}
  function refresh(){var d=calcDelta();var after=before+d;var cost=Number(i.cost)||0;mask.querySelector('#adjLbl').textContent=(mode()==='count'?'Physical count':'Adjustment +/-')+' ('+(i.unit||'units')+')';mask.querySelector('#adjPreview').innerHTML=d?('New stock: <b>'+num(after)+' '+esc(i.unit||'')+'</b> · variance to COGS <b>'+peso(-d*cost)+'</b>'):'';}
  mask.querySelectorAll('input[name=adjmode]').forEach(function(r){r.onchange=refresh;});
  mask.querySelector('#adjVal').oninput=refresh;
  mask.querySelector('#adjCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#adjSubmit').onclick=function(){var d=calcDelta();if(!d){alert('No change entered.');return;}var reason=mask.querySelector('#adjReason').value||'other';document.body.removeChild(mask);finalizeAdjust(id,before,d,reason);};
  refresh();
}
function finalizeAdjust(id,before,delta,reason){
  var i=inventoryMap[id]; if(!i)return;
  var after=before+delta; var cost=Number(i.cost)||0; var varianceValue=-delta*cost;  /* stock down = +COGS */
  var a=A(), adjId=uid('adj_'), mid=movementId('adjustment',adjId,id), now=Date.now();
  postMovements([{movementId:mid,itemId:id,type:reason==='wastage'?'waste':'adjustment',qty:delta,unitCost:cost,sourceType:'inventory-adjustment',sourceId:adjId,note:reason,actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:now}]).then(function(){
    return a.set(a.ref(a.db,'inventoryAdjustments/'+adjId),{ing:id,name:i.name,unit:i.unit||'',delta:delta,before:before,after:after,reason:reason,unitCost:cost,varianceValue:varianceValue,movementId:mid,ts:now});
  }).then(function(){
  var _invPct=(window.__posSettings&&window.__posSettings.tolerances&&Number(window.__posSettings.tolerances.invPct))||5;
  var _pctMove=before>0?Math.abs(delta)/before*100:(delta!==0?100:0);
  if(_pctMove>_invPct){
    a.set(a.ref(a.db,'discrepancies/'+uid('disc_')),{kind:'inventory',item:i.name,ing:id,expectedQty:before,actualQty:after,variance:delta,value:varianceValue,type:delta<0?'shortage':'overage',staff:(window.__posShift&&window.__posShift.staff)||'Admin',reason:reason,status:'open',ts:Date.now()});
  }
  if(window.__posLog)window.__posLog('inv-adjust',i.name,(delta>0?'+':'')+num(delta)+' '+(i.unit||'')+' · '+reason+' · COGS '+peso(varianceValue));
  alert('Adjusted '+i.name+' to '+num(after)+' '+(i.unit||'')+'.\nVariance to COGS: '+peso(varianceValue)+' ('+reason+').');
  }).catch(function(e){alert('Adjustment FAILED — stock was not changed: '+((e&&e.message)||e));});
}
/* ---------- Recipe Excel export / import ---------- */
function recipesToAOA(){
  var aoa=[['itemKey','itemName','ingredient','unit','qtyS','qtyM','qtyL']];
  menuList().forEach(function(it){ var rec=recipesMap[it.key]; if(!rec||!rec.base||!rec.base.length)return;
    rec.base.forEach(function(b){ var inv=inventoryMap[b.ing]||{};
      aoa.push([it.key,it.name||'',inv.name||'',inv.unit||'',(b.qtyS!=null?b.qtyS:''),(b.qtyM!=null?b.qtyM:''),(b.qtyL!=null?b.qtyL:'')]);
    });
  });
  return aoa;
}
function optionsToAOA(){
  var aoa=[['option','ingredient','qty','unit']];
  Object.keys(optRecipesMap).sort().forEach(function(lb){ var o=optRecipesMap[lb]||{}; var inv=inventoryMap[o.ing]||{}; aoa.push([lb,inv.name||'',(o.qty!=null?o.qty:''),inv.unit||'']); });
  return aoa;
}
function exportRecipesXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(recipesToAOA()),'Recipes');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(optionsToAOA()),'Options');
  XLSX.writeFile(wb,'accaza-recipes-'+window.AccazaDate.key()+'.xlsx');
}
function downloadRecipeTemplate(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var aoa=[['itemKey','itemName','ingredient','unit','qtyS','qtyM','qtyL']];
  menuList().forEach(function(it){ aoa.push([it.key,it.name||'','','','','','']); aoa.push([it.key,it.name||'','','','','','']); });
  if(aoa.length===1){ aoa.push(['','Latte','Espresso beans','g',18,20,24]); aoa.push(['','Latte','Fresh milk','ml',150,200,250]); }
  var oaoa=[['option','ingredient','qty','unit']];
  allOptionLabels().forEach(function(o){ oaoa.push([o.label,'','','']); });
  if(oaoa.length===1){ oaoa.push(['Extra shot','Espresso beans',9,'g']); }
  var notes=[['Accaza — Recipe import template'],[''],
    ['SHEET "Recipes" = base ingredients per menu item (one row per ingredient).'],
    ['  itemKey  = leave as pre-filled (or blank to match by itemName).'],
    ['  itemName = the exact menu item name.'],
    ['  ingredient = the exact Inventory item name (add it in Inventory first).'],
    ['  qtyS / qtyM / qtyL = quantity used for each size, in that ingredient unit. Blank = none for that size.'],
    ['  Rows are pre-filled with all your menu items (2 blank ingredient rows each) — just type ingredient + quantities.'],
    ['  Importing REPLACES the base list of any item that has at least one filled row. Items with no filled row are left as-is.'],
    [''],
    ['SHEET "Options" = one costing per option, for all sizes.'],
    ['  option = the customer option label (pre-filled from your menu).'],
    ['  ingredient = the Inventory item it consumes ; qty = amount per order.'],
    ['  Blank ingredient/qty rows are ignored (they will NOT delete an existing option).'],
    [''],
    ['Consumables (cups, stirrers) are NOT here — they auto-apply by category. Manage them in Inventory + the Consumables sub-tab.']
  ];
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'Recipes');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(oaoa),'Options');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(notes),'Instructions');
  XLSX.writeFile(wb,'accaza-recipes-template.xlsx');
}
function importRecipesXlsx(file){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  var rd=new FileReader();
  rd.onload=function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'array'});
      var ingByName={}; ings().forEach(function(i){ingByName[(i.name||'').trim().toLowerCase()]=i.id;});
      var itemByName={}; menuList().forEach(function(it){itemByName[(it.name||'').trim().toLowerCase()]=it.key;});
      var mim=A().menuItemsMap||{}; var a=A();
      var recCount=0,recRows=0,optCount=0,missIng={},missItem={},jobs=[];
      var rsh=wb.Sheets['Recipes'];
      if(rsh){
        var grouped={};
        XLSX.utils.sheet_to_json(rsh,{defval:''}).forEach(function(r){
          var key=String(r.itemKey||'').trim();
          if(!key){ var nm=String(r.itemName||'').trim().toLowerCase(); key=nm?(itemByName[nm]||''):''; }
          if(!key||!mim[key]){ if(String(r.itemName||'').trim())missItem[String(r.itemName).trim()]=1; return; }
          var ingName=String(r.ingredient||'').trim(); if(!ingName)return;
          var ingId=ingByName[ingName.toLowerCase()]; if(!ingId){missIng[ingName]=1;return;}
          function q(v){return (v===''||v==null)?null:(Number(v)||0);}
          var inputUnit=String(r.unit||'').trim()||((inventoryMap[ingId]||{}).unit||'');
          (grouped[key]=grouped[key]||[]).push({ing:ingId,unit:inputUnit,dispS:q(r.qtyS),dispM:q(r.qtyM),dispL:q(r.qtyL)}); recRows++;
        });
        Object.keys(grouped).forEach(function(key){
          var rec={base:grouped[key],updatedAt:Date.now()};
          var saved=recipesMap[key]; if(saved&&saved.options)rec.options=saved.options;
          var local=Costing().normalizeRecipe(rec,inventoryMap);if(!local.ok)throw new Error('Recipe '+((mim[key]&&mim[key].name)||key)+': '+costingIssues(local.errors));
          if(!a.validateRecipeDefinition)throw new Error('The 3B recipe validator is not available. Refresh the portal.');
          jobs.push(a.validateRecipeDefinition(rec).then(function(res){var data=res&&res.data?res.data:res;if(!data||!data.recipe)throw new Error('No normalized recipe returned for '+key);return a.set(a.ref(a.db,'recipes/'+key),data.recipe);}));recCount++;
        });
      }
      var osh=wb.Sheets['Options'];
      if(osh){
        XLSX.utils.sheet_to_json(osh,{defval:''}).forEach(function(r){
          var label=String(r.option||'').trim(); if(!label)return;
          var ingName=String(r.ingredient||'').trim(); var qty=Number(r.qty)||0;
          if(!ingName||!qty)return;
          var ingId=ingByName[ingName.toLowerCase()]; if(!ingId){missIng[ingName]=1;return;}
          jobs.push(a.set(a.ref(a.db,'optionRecipes/'+optKey(label)),{label:label,ing:ingId,qty:qty,updatedAt:Date.now()})); optCount++;
        });
      }
      var msg='Recipes imported.\nMenu items updated: '+recCount+' ('+recRows+' ingredient rows)\nOptions set: '+optCount;
      var mi=Object.keys(missItem),mg=Object.keys(missIng);
      if(mi.length)msg+='\n\nUnknown menu items (skipped): '+mi.slice(0,8).join(', ')+(mi.length>8?' …':'');
      if(mg.length)msg+='\n\nUnknown ingredients — add in Inventory first: '+mg.slice(0,8).join(', ')+(mg.length>8?' …':'');
      Promise.all(jobs).then(function(){alert(msg+'\n\nAll recipes were normalized by costing engine '+Costing().VERSION+'.');}).catch(function(err){alert('Import stopped: '+(err&&err.message?err.message:err)+'\n\nSome earlier rows may already have been saved. Fix the error and import again.');});
    }catch(err){alert('Could not read that file: '+err);}
  };
  rd.readAsArrayBuffer(file);
}
/* ---------- Inventory Excel export / import ---------- */
function invColumns(){return ['id','name','type','unit','stock','reorder','cost','serves','size','qtyPerOrder'];}
function invToAOA(){
  var cols=invColumns(); var aoa=[cols];
  ings().forEach(function(i){ var c=ingType(i)==='consumable';
    aoa.push([i.id,i.name||'',ingType(i),i.unit||'',Number(i.stock)||0,Number(i.reorder)||0,(i.cost!=null&&i.cost!==''?Number(i.cost):''),(c?(i.serves||'both'):''),(c?(i.size||''):''),(c?(i.qtyPerOrder!=null?i.qtyPerOrder:1):'')]);
  });
  return aoa;
}
function exportInventoryXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ws=XLSX.utils.aoa_to_sheet(invToAOA());
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.writeFile(wb,'accaza-inventory-'+window.AccazaDate.key()+'.xlsx');
}
function downloadInventoryTemplate(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ex=[invColumns(),
    ['','Espresso beans','base','g','',0,0.9,'','',''],
    ['','Fresh milk','base','ml','',0,0.06,'','',''],
    ['','Vanilla syrup','option','pump','',0,3.5,'','',''],
    ['','Medium paper cup','consumable','pcs','',0,2.2,'drink','M',1],
    ['','Stirrer','consumable','pcs','',0,0.3,'drink','',1],
    ['','Pastry box','consumable','pcs','',0,4,'food','',1]
  ];
  var ws=XLSX.utils.aoa_to_sheet(ex);
  var notes=[['Accaza — Inventory import template'],[''],
    ['HOW TO USE'],
    ['1. One row per item. Leave the id column BLANK for new items (fill it only when re-importing an exported file to update exact rows).'],
    ['2. name = required. type = base / option / consumable.'],
    ['3. unit = g, ml, oz, pcs, shot, pump, ea — use the SAME unit for cost and for recipe quantities.'],
    ['4. cost = price per ONE unit (per g, per ml, per pc). Blank = 0.'],
    ['5. serves / size / qtyPerOrder apply to CONSUMABLES only:'],
    ['      serves = both / drink / food ;  size = S / M / L for cups (blank = all sizes) ;  qtyPerOrder default 1.'],
    ['6. Import matches by id first, else by name (case-insensitive). Blank cells on an EXISTING item are left unchanged (so you will not wipe live stock).'],
    ['7. Delete these example rows, fill your own, Save As .xlsx, then use "⬆ Import Excel" in the Inventory tab.']
  ];
  var wsN=XLSX.utils.aoa_to_sheet(notes);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.utils.book_append_sheet(wb,wsN,'Instructions');
  XLSX.writeFile(wb,'accaza-inventory-template.xlsx');
}
function importInventoryXlsx(file){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  var rd=new FileReader();
  rd.onload=function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'array'});
      var sh=wb.Sheets['Inventory']||wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(sh,{defval:''});
      if(!rows.length){alert('No rows found on the Inventory sheet.');return;}
      var byId={},byName={};
      ings().forEach(function(i){byId[i.id]=i;byName[(i.name||'').trim().toLowerCase()]=i;});
      var created=0,updated=0,skipped=0; var a=A(), writes={}, moves=[];
      var importId='xlsx_'+String(file.name||'inventory').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,70)+'_'+Number(file.lastModified||file.size||0);
      rows.forEach(function(r){
        var name=String(r.name||'').trim(); if(!name){skipped++;return;}
        var id=String(r.id||'').trim();
        var match=(id&&byId[id])||byName[name.toLowerCase()];
        function has(k){return r[k]!==''&&r[k]!=null;}
        var type=has('type')?String(r.type).trim().toLowerCase():(match?ingType(match):'base'); if(['base','option','consumable'].indexOf(type)<0)type='base';
        var desiredStock=has('stock')?(Number(r.stock)||0):(match?(Number(match.stock)||0):0);
        var desiredCost=has('cost')?(Number(r.cost)||0):(match?(Number(match.cost)||0):0);
        var o=match?{}:{reorder:0};
        o.name=name; o.type=type;
        if(has('unit')){var importedUnit=String(r.unit).trim();if(match&&match.ledgerVersion&&uNorm(importedUnit)!==uNorm(match.unit)){throw new Error('Cannot change the unit of ledger item "'+name+'" by import. Create a new item or correct it before ledger initialization.');}o.unit=importedUnit;}
        if(has('reorder'))o.reorder=Number(r.reorder)||0;
        if(type==='consumable'){
          o.serves=has('serves')?String(r.serves).trim().toLowerCase():((match&&match.serves)||'both'); if(['both','drink','food'].indexOf(o.serves)<0)o.serves='both';
          o.size=has('size')?String(r.size).trim().toUpperCase():((match&&match.size)||''); if(['S','M','L'].indexOf(o.size)<0)o.size='';
          o.qtyPerOrder=has('qtyPerOrder')?(Number(r.qtyPerOrder)||1):((match&&match.qtyPerOrder!=null)?match.qtyPerOrder:1);
        }
        o.updatedAt=Date.now();
        var targetId;
        if(match){ targetId=match.id; Object.keys(o).forEach(function(k){writes['inventory/'+targetId+'/'+k]=o[k];}); updated++; byId[targetId]=Object.assign({},match,o); byName[name.toLowerCase()]=byId[targetId]; }
        else { targetId=uid('ing_'); writes['inventory/'+targetId]=Object.assign({},o,{stock:0,cost:0}); created++; var no=Object.assign({id:targetId,stock:0,cost:0},o); byId[targetId]=no; byName[name.toLowerCase()]=no; }
        var oldStock=match?(Number(match.stock)||0):0, oldCost=match?(Number(match.cost)||0):0;
        if(!match||desiredStock!==oldStock||desiredCost!==oldCost){moves.push({movementId:movementId('manual_edit',importId,targetId),itemId:targetId,type:'manual_edit',qty:desiredStock-oldStock,unitCost:desiredCost,setCost:true,sourceType:'inventory-xlsx',sourceId:importId,sourceLine:String(r.id||name),note:'Inventory Excel import',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()});}
      });
      a.update(a.ref(a.db),writes).then(function(){return moves.length?postMovements(moves):null;}).then(function(){alert('Import complete.\nCreated: '+created+'\nUpdated: '+updated+'\nLedger movements: '+moves.length+(skipped?'\nSkipped (no name): '+skipped:''));}).catch(function(err){alert('Import FAILED: '+((err&&err.message)||err)+'. The same file is safe to retry.');});
    }catch(err){ alert('Could not read that file: '+err); }
  };
  rd.readAsArrayBuffer(file);
}
function receiveStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var recipeRequired=recipeUsesInventory(id), activeSkus=activeSkusFor(id);
  if(recipeRequired&&!activeSkus.length){alert('“'+i.name+'” is a recipe SKU with no active approved brand. Add a brand before receiving stock.');openSkuManager(id);return;}
  var before=Number(i.stock)||0, oldCost=Number(i.cost)||0, unit=i.unit||'';
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[];
  var accOpts=accs.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+' ('+peso(x.balance)+')</option>';}).join('');
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Receive stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">On hand: <b>'+num(before)+' '+esc(unit)+'</b> · current cost '+peso(oldCost)+' / '+esc(unit||'unit')+'</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;"><div><span class="pz-lbl">Quantity received ('+esc(unit||'units')+')</span><input class="pz-in" id="rcQty" type="number" step="any" style="width:120px;"/></div><div><span class="pz-lbl">Unit cost ₱ (per '+esc(unit||'unit')+')</span><input class="pz-in" id="rcCost" type="number" step="any" value="'+(oldCost||'')+'" style="width:120px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div style="flex:1;min-width:140px;"><span class="pz-lbl">Supplier</span><input class="pz-in" id="rcSup" placeholder="supplier name"/></div><div><span class="pz-lbl">Invoice / ref</span><input class="pz-in" id="rcRef" style="width:130px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div><span class="pz-lbl">Date</span><input class="pz-in" id="rcDate" type="date" value="'+window.AccazaDate.key()+'"/></div><div style="flex:1;min-width:140px;"><span class="pz-lbl">Received by</span><input class="pz-in" id="rcBy" value="'+esc((window.__posShift&&window.__posShift.staff)||'Admin')+'"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div class="purchase-sku-cell '+(recipeRequired?'required':'optional')+'" style="flex:1;min-width:180px;"><span class="pz-lbl">Approved brand '+(recipeRequired?'<b>required</b>':'(optional)')+'</span><select class="pz-in" id="rcSku"><option value="">— '+(recipeRequired?'select brand':'no approved brand / legacy receipt')+' —</option>'+activeSkus.map(function(s,ix){return '<option value="'+esc(s.id)+'"'+(recipeRequired&&activeSkus.length===1&&ix===0?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('')+'</select></div><div style="flex:1;min-width:120px;"><span class="pz-lbl">Brand</span><input class="pz-in" id="rcBrand" placeholder="e.g. Arla"'+(recipeRequired?' readonly':'')+'/></div><div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" id="rcExpiry" type="date"/></div><div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" id="rcLot" style="width:90px;"/></div></div>'
    +'<label style="display:block;font-size:0.85rem;margin-top:0.6rem;cursor:pointer;"><input type="checkbox" id="rcAvg" checked/> Update item cost to weighted average</label>'
    +'<div style="margin-top:0.6rem;border-top:1px solid var(--cd);padding-top:0.5rem;"><span class="pz-lbl">How was it paid?</span>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="pending" checked/> Invoice pending — records a provisional supplier obligation</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="paid"'+(accs.length?'':' disabled')+'/> Paid now from '+(accs.length?('<select class="pz-in" id="rcAcct" style="width:auto;display:inline-block;">'+accOpts+'</select>'):'<span style="color:var(--tl);">(add a bank/e-wallet account in Cash Flow first)</span>')+'</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="account"/> On account — creates a Payable, due <input class="pz-in" id="rcDue" type="date" style="width:auto;display:inline-block;"/></label>'
    +'</div>'
    +'<div id="rcPrev" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rcOk">Receive</button><button class="pz-btn sec" id="rcCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  function prev(){var q=Number(mask.querySelector('#rcQty').value)||0;var c=Number(mask.querySelector('#rcCost').value)||0;var tot=Math.round(q*c*100)/100;var navg=(before+q>0)?((before*oldCost+q*c)/(before+q)):c;mask.querySelector('#rcPrev').innerHTML=q?('New stock: <b>'+num(before+q)+' '+esc(unit)+'</b> · total '+peso(tot)+((mask.querySelector('#rcAvg').checked&&c>0)?(' · new avg cost '+peso(Math.round(navg*100)/100)+' / '+esc(unit||'unit')):'')):'';}
  mask.querySelector('#rcQty').oninput=prev; mask.querySelector('#rcCost').oninput=prev; mask.querySelector('#rcAvg').onchange=prev;
  function syncReceiptSku(){var sid=mask.querySelector('#rcSku').value,sk=inventorySkuMap[sid];if(sk)mask.querySelector('#rcBrand').value=sk.brand||'';else if(recipeRequired)mask.querySelector('#rcBrand').value='';}
  mask.querySelector('#rcSku').onchange=syncReceiptSku; syncReceiptSku();
  mask.querySelector('#rcCancel').onclick=close;
  var pendingReceiptId='';
  mask.querySelector('#rcOk').onclick=function(){
    var q=Number(mask.querySelector('#rcQty').value)||0; if(!(q>0)){alert('Enter the quantity received.');return;}
    var c=Number(mask.querySelector('#rcCost').value)||0; var tot=Math.round(q*c*100)/100;
    var sup=(mask.querySelector('#rcSup').value||'').trim(); var ref=(mask.querySelector('#rcRef').value||'').trim();
    var date=mask.querySelector('#rcDate').value||window.AccazaDate.key(); var by=(mask.querySelector('#rcBy').value||'').trim();
    var pay=(mask.querySelector('input[name=rcPay]:checked')||{}).value||'pending';
    var a=A(); var rid=pendingReceiptId||(pendingReceiptId=uid('rcpt_')); var payAcct='', payableId='';
    if(!sup){alert('Enter the supplier. Stock cannot be received without a payment or supplier obligation.');return;}
    if((pay==='account'||pay==='pending')&&!(window.__cf&&window.__cf.addPayable)){alert('Purchase liability service is not ready. Refresh the portal and try again.');return;}
    if(pay==='paid'){ var accEl=mask.querySelector('#rcAcct'); payAcct=accEl?accEl.value:''; if(!payAcct){alert('Pick an account.');return;} }
    var skuId=mask.querySelector('#rcSku').value||'', selectedSku=inventorySkuMap[skuId];
    if(recipeRequired&&(!selectedSku||selectedSku.masterId!==id||selectedSku.active===false)){alert('Select an active approved brand before receiving this recipe item.');return;}
    var brand=selectedSku?(selectedSku.brand||''):(mask.querySelector('#rcBrand').value||'').trim(); var expiry=mask.querySelector('#rcExpiry').value||''; var lot=(mask.querySelector('#rcLot').value||'').trim();
    var now=Date.now(), mid=movementId('purchase',rid,id);
    postMovements([{movementId:mid,itemId:id,type:'purchase',qty:q,unitCost:c,sourceType:'stock-receipt',sourceId:rid,note:(sup||'Supplier')+(ref?' · '+ref:''),actorName:by,occurredAt:now}]).then(function(){
      if(pay==='paid'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+rid,date:date,accountId:payAcct,amount:tot,party:sup||i.name,ref:ref||i.name,category:'Purchases',source:'purchase',linkId:rid,note:'Received '+num(q)+' '+unit+' '+i.name});
      if((pay==='account'||pay==='pending')&&window.__cf&&window.__cf.addPayable){var due=pay==='account'?(mask.querySelector('#rcDue').value||''):'';return window.__cf.addPayable({commandId:'purchase_ap_'+rid,documentId:'ap_'+rid,party:sup||'Supplier',type:pay==='pending'?'inventory_pending_invoice':'inventory',amount:tot,date:date,due:due,ref:ref||('PENDING-'+rid)}).then(function(pid){payableId=pid;});}
      return null;
    }).then(function(){
      var writes={};
      writes['stockReceipts/'+rid]={ing:id,skuId:skuId,skuBrand:brand,name:i.name,unit:unit,qty:q,unitCost:c,total:tot,supplier:sup,brand:brand,ref:ref,date:date,receivedBy:by,payMode:pay,accountId:payAcct,payableId:payableId,movementId:mid,ts:now};
      writes['inventoryBatch/'+('bat_'+now.toString(36)+'_r')]={skuId:skuId,masterId:id,brand:brand,supplier:sup,qtyRecv:q,qtyRemaining:q,unit:unit,unitCost:c,recvDate:date,expiry:expiry,lot:lot,branch:'main',source:'purchase',invoiceId:'',receiptId:rid,createdAt:now};
      return a.update(a.ref(a.db),writes);
    }).then(function(){if(window.__posLog)window.__posLog('stock-receive',i.name,num(q)+' '+unit+' · '+peso(tot)+(pay==='paid'?' · paid':pay==='account'?' · on account':''));close();}).catch(function(e){alert('Receipt did not finish: '+((e&&e.message)||e)+'. Stock or finance may already be posted; the same receipt is safe to retry and cannot double-post.');});
  };
}
/* ══════════ PURCHASES (Goods-Received Note) ══════════
   Function model: receive stock into existing generic items (blends weighted-avg cost)
   or create a new item. Measurement units only (dimension-guarded); converts to the
   item's stock unit; cost stored at higher precision. Brand rides on the receipt/stock card.
   Deduction + recipes untouched — recipes keep costing at the item's blended average. */
function purchBlank(){return {mode:'existing',ing:'',skuId:'',recipeItem:true,newName:'',newUnit:'ml',newType:'base',brand:'',recvUnit:'',qty:'',costMode:'unit',unitCost:'',lineTotal:'',expiry:'',lot:''};}
function purchInit(){ if(!window.__purch){ window.__purch={supplier:'',ref:'',date:window.AccazaDate.key(),by:((window.__posShift&&window.__posShift.staff)||'Admin'),pay:'pending',acct:'',due:'',lines:[purchBlank()]}; } }
function purchaseLookup(title){var a=A();if(!a||!a.managePurchaseCorrection)return Promise.reject(new Error('Purchase correction service is unavailable. Refresh the portal.'));return F().run({title:title,subtitle:'Enter the exact supplier invoice reference.',submitLabel:'Find purchase',busyLabel:'Finding purchase…',fields:[{name:'invoiceRef',label:'Invoice / reference',required:true,value:(window.__purch&&window.__purch.ref)||'',maxLength:120}]},function(v){return a.managePurchaseCorrection({action:'lookup',invoiceRef:v.invoiceRef});}).then(function(r){return ((r&&r.data)||r||{}).invoice;});}
function correctedPurchaseDraft(inv){return {supplier:inv.supplier||'',ref:inv.ref||'',date:window.AccazaDate.key(),by:inv.by||((window.__posShift&&window.__posShift.staff)||'Admin'),pay:inv.payMode==='none'?'pending':(inv.payMode||'pending'),acct:'',due:inv.due||'',lines:(inv.lines||[]).map(function(x){return {mode:'existing',ing:x.itemId||'',skuId:x.skuId||'',recipeItem:true,newName:'',newUnit:x.unit||'',newType:'base',brand:x.skuBrand||'',recvUnit:x.unit||'',qty:x.qty||'',costMode:'total',unitCost:'',lineTotal:x.total||'',expiry:'',lot:''};})};}
var PURCH_UNITS=['ml','l','g','kg','pcs'];
function purchCalc(ln){
  var inv=(ln.mode==='new')?{unit:ln.newUnit||'',stock:0,cost:0}:(inventoryMap[ln.ing]||null);
  if(!inv)return null;
  var recvUnit=(ln.mode==='new')?(ln.newUnit||''):(ln.recvUnit||inv.unit||'');
  if(ln.mode!=='new'&&compatUnits(inv).map(uNorm).indexOf(uNorm(recvUnit))<0)recvUnit=inv.unit||''; /* guard: never convert across dimensions */
  var qty=Number(ln.qty)||0;
  var stockAdd=convertToStock(qty,recvUnit,inv);
  var lineTotal=(ln.costMode==='total')?(Number(ln.lineTotal)||0):qty*(Number(ln.unitCost)||0);
  var before=Number(inv.stock)||0, oldCost=Number(inv.cost)||0;
  var denom=before+stockAdd;
  var newCost=denom>0?((before*oldCost+lineTotal)/denom):(stockAdd>0?lineTotal/stockAdd:0);
  return {inv:inv,stockUnit:inv.unit||'',recvUnit:recvUnit,qty:qty,stockAdd:Math.round(stockAdd*100000)/100000,lineTotal:Math.round(lineTotal*100)/100,before:before,oldCost:oldCost,newCost:Math.round(newCost*100000)/100000};
}
function purchaseStatusLabel(p){if(p.reversed)return 'Reversed';if(p.payMode==='paid')return 'Paid';if(p.payMode==='account')return 'On account';if(p.payMode==='pending')return 'Invoice pending';return 'Legacy — liability missing';}
var showReversedPurchases=false;
function purchaseHistoryHtml(){var allRows=Object.keys(purchaseInvoicesMap).map(function(id){return Object.assign({id:id},purchaseInvoicesMap[id]);}).sort(function(a,b){return (Number(b.ts)||0)-(Number(a.ts)||0);}),reversedCount=allRows.filter(function(p){return p.reversed;}).length,rows=allRows.filter(function(p){return showReversedPurchases||!p.reversed;}).slice(0,100),toggle=reversedCount?'<button class="pz-btn sec" data-purchase-toggle-reversed style="margin-left:auto;">'+(showReversedPurchases?'Hide reversed':'Show reversed ('+reversedCount+')')+'</button>':'';return '<div style="display:flex;align-items:center;gap:.6rem;margin-top:1.4rem;"><div class="pz-h">Purchase history</div>'+toggle+'</div><p class="pz-sub">Active purchase records are shown by default. Reversed records remain safely available in the audit trail.</p><div class="pz-card" style="overflow:auto;"><table class="pz-table" style="min-width:980px;width:100%;"><thead><tr><th>Date</th><th>Supplier</th><th>Reference</th><th>Status</th><th class="r">Amount</th><th>Actions</th></tr></thead><tbody>'+(rows.length?rows.map(function(p){var actions='<button class="pz-btn sec" data-purchase-details="'+esc(p.id)+'">Details</button>';if(!p.reversed&&p.payMode==='pending')actions+=' <button class="pz-btn ok" data-purchase-finalize="'+esc(p.id)+'">Finalize invoice</button>';if(!p.reversed&&p.payMode==='none')actions+=' <button class="pz-btn ok" data-purchase-link="'+esc(p.id)+'">Link existing payable</button>';if(!p.reversed&&p.payMode==='account'&&!p.payableId)actions+=' <button class="pz-btn ok" data-purchase-repair="'+esc(p.id)+'">Repair payable</button>';if(!p.reversed)actions+=' <button class="pz-btn warn" data-purchase-duplicate="'+esc(p.id)+'">Reverse duplicate</button>';return '<tr><td>'+esc(p.date||'—')+'</td><td>'+esc(p.supplier||'—')+'</td><td>'+esc(p.ref||p.id)+'</td><td>'+esc(purchaseStatusLabel(p))+'</td><td class="r">'+peso(p.total)+'</td><td style="white-space:nowrap;">'+actions+'</td></tr>';}).join(''):'<tr><td colspan="6">No active purchases recorded.</td></tr>')+'</tbody></table></div>';}
function showPurchaseDetails(id){var p=purchaseInvoicesMap[id];if(!p)return;var old=document.getElementById('purchaseDetailsMask');if(old)old.remove();var m=document.createElement('div');m.id='purchaseDetailsMask';m.className='pz-mask show';var lines=(p.lines||[]).map(function(x){return '<tr><td>'+esc(x.itemName||x.itemId||'')+'</td><td>'+esc(x.skuBrand||'—')+'</td><td class="r">'+num(x.qty)+' '+esc(x.unit||'')+'</td><td class="r">'+peso(x.total)+'</td></tr>';}).join('');m.innerHTML='<div class="pz-modal" style="max-width:720px;"><div style="display:flex;justify-content:space-between;gap:1rem;"><div><div class="pz-lbl">Purchase record</div><div class="pz-h">'+esc(p.supplier||'Supplier')+'</div><div>'+esc(p.ref||id)+'</div></div><button class="pz-btn sec" data-purchase-close>✕</button></div><div class="pz-card" style="margin-top:0.8rem;"><b>'+peso(p.total)+'</b> · '+esc(purchaseStatusLabel(p))+'<br><span class="pz-sub">Purchase ID: '+esc(id)+' · Created '+esc(p.ts?new Date(Number(p.ts)).toLocaleString('en-PH'):'—')+'<br>Received '+esc(p.date||'—')+' by '+esc(p.by||'—')+(p.due?' · Due '+esc(p.due):'')+(p.payableId?'<br>Linked payable: '+esc(p.payableId):'')+'</span></div><table class="pz-table" style="width:100%;"><thead><tr><th>Item</th><th>Brand</th><th class="r">Quantity</th><th class="r">Amount</th></tr></thead><tbody>'+lines+'</tbody></table><button class="pz-btn ok" data-purchase-close style="width:100%;margin-top:0.8rem;">Close</button></div>';document.body.appendChild(m);m.querySelectorAll('[data-purchase-close]').forEach(function(b){b.onclick=function(){m.remove();};});}
function renderPurchases(){
  var root=document.getElementById('purchasesRoot'); if(!root)return;
  purchInit(); var P=window.__purch;
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[];
  var accOpts=accs.map(function(x){return '<option value="'+esc(x.id)+'"'+(P.acct===x.id?' selected':'')+'>'+esc(x.name)+' ('+peso(x.balance)+')</option>';}).join('');
  var invList=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function itemOpts(sel){return '<option value="">— pick item —</option>'+invList.map(function(i){var required=recipeUsesInventory(i.id),n=activeSkusFor(i.id).length;return '<option value="'+esc(i.id)+'"'+(i.id===sel?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+(required?(n?' · '+n+' approved brand'+(n===1?'':'s'):' · BRAND REQUIRED'):'')+'</option>';}).join('');}
  function unitOpts(list,sel){return list.map(function(u){return '<option'+(uNorm(u)===uNorm(sel)?' selected':'')+'>'+esc(u)+'</option>';}).join('');}
  var invTotal=0;
  var lineHtml=P.lines.map(function(ln,i){
    var c=purchCalc(ln);
    if(c)invTotal+=c.lineTotal;
    var firstCell,typeCell='',unitCell,skuCell='',brandCell='';
    if(ln.mode==='new'){
      var newRecipeItem=ln.newType==='consumable'||ln.recipeItem!==false;
      firstCell='<div style="flex:1;min-width:160px;"><span class="pz-lbl">New item (generic name)</span><input class="pz-in" data-pf="newName" data-pi="'+i+'" placeholder="e.g. Condensed Milk" value="'+esc(ln.newName)+'"/></div>';
      typeCell='<div><span class="pz-lbl">Type</span><select class="pz-in" data-pf="newType" data-pi="'+i+'" style="width:110px;"><option value="base"'+(ln.newType==='base'?' selected':'')+'>base</option><option value="both"'+(ln.newType==='both'?' selected':'')+'>both</option><option value="option"'+(ln.newType==='option'?' selected':'')+'>option</option><option value="consumable"'+(ln.newType==='consumable'?' selected':'')+'>consumable</option></select></div>'
        +'<label class="purchase-recipe-toggle"><input type="checkbox" data-pf="recipeItem" data-pi="'+i+'"'+(newRecipeItem?' checked':'')+(ln.newType==='consumable'?' disabled title="Consumables are automatically used by recipes"':'')+'/> Used in recipes</label>';
      unitCell='<select class="pz-in" data-pf="newUnit" data-pi="'+i+'" style="width:74px;">'+unitOpts(PURCH_UNITS,ln.newUnit)+'</select>';
      skuCell='<div class="purchase-sku-cell '+(newRecipeItem?'required':'optional')+'"><span class="pz-lbl">First approved brand '+(newRecipeItem?'<b>required</b>':'(optional)')+'</span><input class="pz-in" data-pf="brand" data-pi="'+i+'" value="'+esc(ln.brand)+'" placeholder="e.g. Dabba"/></div>';
    } else {
      var inv=inventoryMap[ln.ing]||{};
      firstCell='<div style="flex:1;min-width:170px;"><span class="pz-lbl">Item</span><select class="pz-in" data-pf="ing" data-pi="'+i+'">'+itemOpts(ln.ing)+'</select></div>';
      var cu=ln.ing?compatUnits(inv):[inv.unit||''];
      unitCell=ln.ing?('<select class="pz-in" data-pf="recvUnit" data-pi="'+i+'" style="width:74px;">'+unitOpts(cu,ln.recvUnit||inv.unit)+'</select>'):'<span style="color:var(--tl);font-size:0.85rem;">—</span>';
      var required=ln.ing&&recipeUsesInventory(ln.ing), skus=ln.ing?activeSkusFor(ln.ing):[];
      if(ln.skuId&&!skus.some(function(s){return s.id===ln.skuId;}))ln.skuId='';
      if(required&&!ln.skuId&&skus.length===1)ln.skuId=skus[0].id;
      var selectedSku=ln.skuId&&inventorySkuMap[ln.skuId];
      var skuOpts='<option value="">'+(required?'— select required brand —':'— no approved brand / legacy receipt —')+'</option>'+skus.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===ln.skuId?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('');
      skuCell='<div class="purchase-sku-cell '+(required?'required':'optional')+'"><span class="pz-lbl">Approved brand '+(required?'<b>required</b>':'(optional)')+'</span><select class="pz-in" data-pf="skuId" data-pi="'+i+'"'+(!ln.ing?' disabled':'')+'>'+skuOpts+'</select>'+(ln.ing&&!skus.length?'<button type="button" class="purchase-add-sku" data-pmanage-sku="'+esc(ln.ing)+'" data-pmanage-line="'+i+'">Add an approved brand</button>':'')+'</div>';
      brandCell=selectedSku?'<div><span class="pz-lbl">Selected brand</span><div class="purchase-sku-brand">'+esc(selectedSku.brand||'—')+'</div></div>':'<div><span class="pz-lbl">Legacy brand note</span><input class="pz-in" data-pf="brand" data-pi="'+i+'" value="'+esc(ln.brand)+'" placeholder="optional" style="width:110px;"/></div>';
    }
    var costInput=(ln.costMode==='total'
      ?'<input class="pz-in" type="number" step="any" data-pf="lineTotal" data-pi="'+i+'" value="'+(ln.lineTotal!==''&&ln.lineTotal!=null?ln.lineTotal:'')+'" placeholder="line ₱" style="width:88px;text-align:right;"/>'
      :'<input class="pz-in" type="number" step="any" data-pf="unitCost" data-pi="'+i+'" value="'+(ln.unitCost!==''&&ln.unitCost!=null?ln.unitCost:'')+'" placeholder="₱ / unit" style="width:88px;text-align:right;"/>');
    var prev=c?('+'+num(c.stockAdd)+' '+esc(c.stockUnit)+' · new avg '+peso(c.newCost)+'/'+esc(c.stockUnit)+' · line '+peso(c.lineTotal)):'';
    return '<div class="purchase-line">'
      +'<div class="purchase-line-head"><div class="purchase-line-title"><span class="purchase-line-number">'+(i+1)+'</span><span>Stock item</span></div><div class="purchase-line-mode">'
        +'<label style="cursor:pointer;margin-right:0.6rem;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="existing"'+(ln.mode!=='new'?' checked':'')+'/> existing item</label>'
        +'<label style="cursor:pointer;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="new"'+(ln.mode==='new'?' checked':'')+'/> ＋ new item</label>'
      +'</div><button class="purchase-line-remove" data-prem="'+i+'" title="Remove this line" aria-label="Remove stock item '+(i+1)+'">✕</button></div>'
      +'<div class="purchase-line-fields">'
        +firstCell
        +typeCell
        +skuCell
        +(ln.mode==='new'?'':brandCell)
        +'<div><span class="pz-lbl">Qty</span><input class="pz-in" type="number" step="any" data-pf="qty" data-pi="'+i+'" value="'+(ln.qty!==''&&ln.qty!=null?ln.qty:'')+'" placeholder="0" style="width:78px;text-align:right;"/></div>'
        +'<div><span class="pz-lbl">Unit</span>'+unitCell+'</div>'
        +'<div><span class="pz-lbl">Cost</span><div style="display:flex;gap:0.25rem;"><select class="pz-in" data-pf="costMode" data-pi="'+i+'" style="width:84px;font-size:0.72rem;"><option value="unit"'+(ln.costMode!=='total'?' selected':'')+'>₱/unit</option><option value="total"'+(ln.costMode==='total'?' selected':'')+'>total ₱</option></select>'+costInput+'</div></div>'
        +'<div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" type="date" data-pf="expiry" data-pi="'+i+'" value="'+esc(ln.expiry||'')+'" style="width:140px;"/></div>'
        +'<div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" data-pf="lot" data-pi="'+i+'" value="'+esc(ln.lot||'')+'" placeholder="batch/lot" style="width:100px;"/></div>'
      +'</div>'
      +'<div class="purchase-line-preview" data-pprev="'+i+'">'+prev+'</div>'
      +'</div>';
  }).join('');
  var payBlock='<div class="purchase-section purchase-payment"><div class="purchase-section-head"><span class="purchase-step">2</span><div><b>Payment</b><small>Choose how this whole invoice will be settled.</small></div></div>'
    +'<div class="purchase-payment-options">'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="pending"'+(P.pay==='pending'||P.pay==='none'?' checked':'')+'/><span><b>Invoice pending — provisional obligation</b><small>Record the delivery now and complete the obligation later.</small></span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="paid"'+(P.pay==='paid'?' checked':'')+(accs.length?'':' disabled')+'/><span><b>Paid now</b><small>'+(accs.length?'Deduct from the selected cash-flow account.':'Add an account in Cash Flow first.')+'</small>'+(accs.length?('<select class="pz-in" id="purAcct">'+accOpts+'</select>'):'')+'</span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="account"'+(P.pay==='account'?' checked':'')+'/><span><b>On account</b><small>Create a payable with this due date.</small><input class="pz-in" id="purDue" type="date" value="'+esc(P.due||'')+'"/></span></label>'
    +'</div></div>';
  root.innerHTML='<div class="purchase-page-head"><div><div class="pz-h">Purchases <span>Goods received</span></div><p class="pz-sub">Record a supplier delivery and update stock in one clear receiving sheet.</p></div><div class="purchase-head-note">Approved brands keep receipts accurate while stock and costing stay pooled under the common item.</div></div>'
    +'<div class="pz-card purchase-sheet"><div class="purchase-sheet-banner"><div><span class="purchase-eyebrow">New delivery</span><h3>Supplier invoice</h3></div><span class="purchase-draft-status">Draft · not yet received</span></div>'
    +'<div class="purchase-section"><div class="purchase-section-head"><span class="purchase-step">1</span><div><b>Delivery details</b><small>Identify who supplied the stock and when it arrived.</small></div></div><div class="purchase-details-grid">'
      +'<div><span class="pz-lbl">Supplier</span><input class="pz-in" id="purSupplier" value="'+esc(P.supplier)+'" placeholder="Supplier name"/></div>'
      +'<div><span class="pz-lbl">Invoice / reference</span><input class="pz-in" id="purRef" value="'+esc(P.ref)+'" placeholder="Optional"/></div>'
      +'<div><span class="pz-lbl">Date</span><input class="pz-in" id="purDate" type="date" value="'+esc(P.date)+'"/></div>'
      +'<div><span class="pz-lbl">Received by</span><input class="pz-in" id="purBy" value="'+esc(P.by)+'" placeholder="Staff name"/></div>'
    +'</div></div>'+payBlock
    +'<div class="purchase-section purchase-items"><div class="purchase-section-head"><span class="purchase-step">3</span><div><b>Items received</b><small>Add each delivered stock item, quantity, and cost.</small></div><button class="pz-btn sec purchase-add-line" id="purAddLine">＋ Add item</button></div><div class="purchase-lines">'+lineHtml+'</div></div>'
    +'<div class="purchase-sheet-footer"><div class="purchase-total"><span>Invoice total</span><strong id="purTotal">'+peso(invTotal)+'</strong><small>'+P.lines.length+' item line'+(P.lines.length===1?'':'s')+'</small></div><div class="purchase-primary-actions"><button class="pz-btn sec" id="purReset">Clear draft</button><button class="pz-btn ok" id="purPost">Receive stock</button></div></div>'
    +'<div id="purMsg" class="purchase-message"></div><details class="purchase-record-tools"><summary>Purchase corrections and repair tools</summary><div><button class="pz-btn sec" id="purCorrectDetails">Correct purchase details</button><button class="pz-btn warn" id="purReversePurchase">Reverse &amp; re-enter</button><button class="pz-btn sec" id="purRepairPayable">Repair missing payable</button></div></details></div>'+purchaseHistoryHtml();
  function hb(id,f){var el=document.getElementById(id);if(el)el.oninput=function(){P[f]=el.value;};}
  hb('purSupplier','supplier');hb('purRef','ref');hb('purDate','date');hb('purBy','by');
  var da=document.getElementById('purAcct');if(da)da.onchange=function(){P.acct=da.value;};
  var du=document.getElementById('purDue');if(du)du.oninput=function(){P.due=du.value;};
  root.querySelectorAll('input[name=ppay]').forEach(function(r){r.onchange=function(){P.pay=r.value;renderPurchases();};});
  root.querySelectorAll('[data-pf]').forEach(function(el){
    var f=el.getAttribute('data-pf'); if(el.getAttribute('data-pi')==null)return; var i=Number(el.getAttribute('data-pi'));
    if(el.tagName==='SELECT'||el.type==='radio'||el.type==='checkbox'){
      el.onchange=function(){ P.lines[i][f]=(el.type==='checkbox'?el.checked:el.value); if(f==='ing'){var inv2=inventoryMap[el.value]||{};P.lines[i].recvUnit=inv2.unit||'';P.lines[i].skuId='';} if(f==='newUnit'){P.lines[i].recvUnit=el.value;} if(f==='mode'){P.lines[i].recvUnit='';P.lines[i].skuId='';} renderPurchases(); };
    } else if(f==='qty'||f==='unitCost'||f==='lineTotal'){
      el.oninput=function(){P.lines[i][f]=el.value;purchUpdatePrev();};
    } else {
      el.oninput=function(){P.lines[i][f]=el.value;};
    }
  });
  root.querySelectorAll('[data-prem]').forEach(function(b){b.onclick=function(){var i=Number(b.getAttribute('data-prem'));P.lines.splice(i,1);if(!P.lines.length)P.lines.push(purchBlank());renderPurchases();};});
  root.querySelectorAll('[data-pmanage-sku]').forEach(function(b){b.onclick=function(){var lineIndex=Number(b.getAttribute('data-pmanage-line')),masterId=b.getAttribute('data-pmanage-sku');openSkuManager(masterId,function(sid,sku){if(!P.lines[lineIndex]||P.lines[lineIndex].ing!==masterId)return;P.lines[lineIndex].skuId=sid;renderPurchases();(window.accazaToast||function(){})((sku.brand||'Brand')+' selected for this purchase','ok');});};});
  var al=document.getElementById('purAddLine');if(al)al.onclick=function(){P.lines.push(purchBlank());renderPurchases();};
  var rs=document.getElementById('purReset');if(rs)rs.onclick=function(){if(confirm('Clear this purchase entry?')){window.__purch=null;renderPurchases();}};
  var pc=document.getElementById('purCorrectDetails');if(pc)pc.onclick=function(){purchaseLookup('Correct purchase details').then(function(inv){return F().run({title:'Correct non-financial purchase details',subtitle:(inv.supplier||'Supplier')+' · '+peso(inv.total)+'. Amounts, items, quantities, costs, supplier and purchase date cannot be changed here.',submitLabel:'Save correction',busyLabel:'Saving correction…',fields:[{name:'ref',label:'Invoice / reference',required:true,value:inv.ref||'',maxLength:120},{name:'due',label:'Due date',type:'date',value:inv.due||''},{name:'by',label:'Received by',value:inv.by||'',maxLength:120},{name:'reason',label:'Correction reason',type:'textarea',required:true,maxLength:300}]},function(v){return A().managePurchaseCorrection({action:'correct_details',invoiceId:inv.id,ref:v.ref,due:v.due,by:v.by,reason:v.reason});});}).then(function(){alert('Purchase details corrected. Inventory quantities, costs and financial amounts were not changed.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not correct purchase: '+((e&&e.message)||e));});};
  var prv=document.getElementById('purReversePurchase');if(prv)prv.onclick=function(){purchaseLookup('Reverse a purchase').then(function(inv){return F().run({title:'Reverse purchase and prepare corrected entry',subtitle:(inv.supplier||'Supplier')+' · '+peso(inv.total)+'. This reverses stock and the linked financial entry. A manager approval is required.',submitLabel:'Request approval & reverse',busyLabel:'Reversing purchase…',fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300},{name:'confirmed',label:'I understand the original purchase will remain in the audit trail as reversed',type:'checkbox',required:true}]},function(v){return A().managerApproval('reverse_purchase',inv.id,inv.total,v.reason).then(function(ap){return A().managePurchaseCorrection({action:'reverse',invoiceId:inv.id,reason:v.reason,approvalId:ap.approvalId});}).then(function(){return inv;});});}).then(function(inv){window.__purch=correctedPurchaseDraft(inv);renderPurchases();alert('Original purchase reversed. Review the prepared corrected entry, choose its payment details, then Receive all.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not reverse purchase: '+((e&&e.message)||e));});};
  var rp=document.getElementById('purRepairPayable');if(rp)rp.onclick=function(){var a=A();if(!a.reconcilePurchasePayable){alert('Purchase reconciliation service is not available. Refresh the portal.');return;}F().run({title:'Repair missing purchase payable',subtitle:'The server checks for an existing payable before creating or linking one.',submitLabel:'Check and repair',busyLabel:'Checking purchase and payable…',fields:[{name:'invoiceRef',label:'Purchase invoice / reference',required:true,value:P.ref||'',maxLength:120},{name:'due',label:'Due date',type:'date',required:true,value:P.due||''}]},function(v){return a.reconcilePurchasePayable({invoiceRef:v.invoiceRef,due:v.due,recovery:true});}).then(function(res){var d=(res&&res.data)||res||{};alert('Payable control completed: '+(d.result==='linked_existing'?'an existing payable was linked.':'the missing payable was created.')+' Amount '+peso(d.amount)+'.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not repair payable: '+((e&&e.message)||e));});};
  var pp=document.getElementById('purPost');if(pp)pp.onclick=postPurchases;
  root.querySelectorAll('[data-purchase-details]').forEach(function(b){b.onclick=function(){showPurchaseDetails(b.getAttribute('data-purchase-details'));};});
  root.querySelectorAll('[data-purchase-toggle-reversed]').forEach(function(b){b.onclick=function(){showReversedPurchases=!showReversedPurchases;renderPurchases();};});
  root.querySelectorAll('[data-purchase-finalize]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-finalize'),p=purchaseInvoicesMap[id]||{};F().run({title:'Finalize supplier invoice',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+'. This replaces GRNI with the formal payable; inventory is unchanged.',submitLabel:'Finalize invoice',busyLabel:'Finalizing…',fields:[{name:'invoiceRef',label:'Final invoice / reference',required:true,maxLength:120},{name:'due',label:'Due date',type:'date',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,invoiceRef:v.invoiceRef,due:v.due,finalize:true});}).then(function(){alert('Invoice finalized. The provisional obligation is now a normal supplier payable.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not finalize invoice: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-link]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-link'),p=purchaseInvoicesMap[id]||{};A().reconcilePurchasePayable({invoiceId:id,recovery:true,preview:true}).then(function(res){var d=(res&&res.data)||res||{},cs=d.candidates||[];if(!cs.length)throw new Error('No open payable has the same supplier and amount. Use Repair payable only after confirming no payable exists.');if(cs.length>1)throw new Error('More than one matching payable was found. Management must review the payable references before linking.');var ap=cs[0];return F().run({title:'Link existing payable',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+' will link to payable '+(ap.ref||ap.id)+'. No new payable or inventory entry will be created.',submitLabel:'Link records',busyLabel:'Linking…',fields:[{name:'reason',label:'Linking reason',type:'textarea',required:true,maxLength:300,value:'Existing payable belongs to this purchase'},{name:'confirmed',label:'I verified the supplier and amount match',type:'checkbox',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,recovery:true,linkPayableId:ap.id,reason:v.reason});});}).then(function(){alert('Existing payable linked. The purchase remains in the audit trail and now shows On account.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not link payable: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-repair]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-repair'),p=purchaseInvoicesMap[id]||{};F().run({title:'Repair missing payable',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+'. The server first checks for an existing linked or matching payable.',submitLabel:'Check and repair',busyLabel:'Checking…',fields:[{name:'due',label:'Due date',type:'date',required:true,value:p.due||''},{name:'confirmed',label:'I confirmed this purchase has no payable in the Payables list',type:'checkbox',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,due:v.due,recovery:true});}).then(function(res){var d=(res&&res.data)||res||{};alert(d.result==='linked_existing'?'An existing payable was linked.':'One payable was created and linked to this purchase.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not repair payable: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-duplicate]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-duplicate'),p=purchaseInvoicesMap[id]||{},matches=Object.keys(purchaseInvoicesMap).filter(function(k){var x=purchaseInvoicesMap[k]||{};return k!==id&&!x.reversed&&String(x.ref||'').toLowerCase()===String(p.ref||'').toLowerCase()&&String(x.supplier||'').toLowerCase()===String(p.supplier||'').toLowerCase()&&Math.round(Number(x.total||0)*100)===Math.round(Number(p.total||0)*100);});if(matches.length!==1){alert('A single matching purchase could not be identified. Open Details and ask management to review the purchase IDs.');return;}var keepId=matches[0],keep=purchaseInvoicesMap[keepId]||{};F().run({title:'Reverse duplicate purchase',subtitle:'Reverse purchase '+id+' and keep '+keepId+'. The selected duplicate inventory will be removed; a shared payable will remain with the kept record or be detached if already reversed.',submitLabel:'Request approval & reverse',busyLabel:'Reversing…',fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300,value:'Duplicate purchase entry'},{name:'confirmed',label:'I reviewed Details and confirmed this record is the duplicate; the other matching record must remain',type:'checkbox',required:true}]},function(v){return A().managerApproval('reverse_purchase',id,p.total,v.reason).then(function(ap){return A().managePurchaseCorrection({action:'reverse',invoiceId:id,keepInvoiceId:keepId,duplicate:true,reason:v.reason,approvalId:ap.approvalId});});}).then(function(){alert('Duplicate purchase reversed. The kept purchase remains. If its shared payable had already been reversed, use Repair payable on the kept row.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not reverse duplicate: '+((e&&e.message)||e));});};});
}
function purchUpdatePrev(){
  var P=window.__purch; if(!P)return; var tot=0;
  P.lines.forEach(function(ln,i){var c=purchCalc(ln);if(c)tot+=c.lineTotal;var el=document.querySelector('[data-pprev="'+i+'"]');if(el)el.textContent=c?('+'+num(c.stockAdd)+' '+c.stockUnit+' · new avg '+peso(c.newCost)+'/'+c.stockUnit+' · line '+peso(c.lineTotal)):'';});
  var t=document.getElementById('purTotal');if(t)t.textContent=peso(Math.round(tot*100)/100);
}
function postPurchases(){
  if(window.__purchPosting)return; var P=window.__purch; if(!P)return;
  if(P.pay==='none')P.pay='pending';
  if(!(P.supplier||'').trim()){alert('Enter the supplier. Every inventory receipt must have a payment or supplier obligation.');return;}
  var lines=P.lines.filter(function(ln){return (ln.mode==='new'?(ln.newName||'').trim():ln.ing)&&(Number(ln.qty)||0)>0;});
  if(!lines.length){alert('Add at least one line with an item and a quantity.');return;}
  for(var i=0;i<lines.length;i++){
    var line=lines[i],c0=purchCalc(line);if(!c0||!(c0.stockAdd>0)){alert('A line has an invalid quantity/unit — check the measures.');return;}
    if(line.mode==='new'&&(line.newType==='consumable'||line.recipeItem!==false)&&!(line.brand||'').trim()){alert('Enter the first approved brand for new recipe item “'+((line.newName||'').trim()||'unnamed item')+'”.');return;}
    if(line.mode!=='new'&&recipeUsesInventory(line.ing)){var validSku=inventorySkuMap[line.skuId];if(!validSku||validSku.masterId!==line.ing||validSku.active===false){alert('Select an active approved brand for recipe item “'+((inventoryMap[line.ing]||{}).name||line.ing)+'” before receiving this purchase.');return;}}
  }
  if(P.pay==='paid'){ if(!(window.__cf&&window.__cf.accounts&&window.__cf.accounts().length)){alert('No bank/e-wallet account. Add one in Cash Flow or choose another payment option.');return;} if(!P.acct){var a0=window.__cf.accounts();P.acct=a0[0]&&a0[0].id;} }
  if((P.pay==='account'||P.pay==='pending')&&!(A()&&A().reconcilePurchasePayable)){ alert('Purchase liability service is not ready. Refresh the portal and try again.'); return; }
  /* a "new" line whose name already exists (or repeats within this invoice) blends into that item — no duplicate SKU */
  var byName={}; ings().forEach(function(x){byName[uNorm(x.name)]=x.id;});
  window.__purchPosting=true;
  var a=A(); var invoiceId=P.invoiceId||(P.invoiceId=uid('pinv_')); var date=P.date||window.AccazaDate.key(), effectiveRef=(P.ref||'').trim()||(P.pay==='pending'?('PENDING-'+invoiceId):invoiceId);
  var updates={}, seedUpdates={}, invTotal=0, receiptIds=[], invoiceLines=[], agg={}, newByName={}, newSkuByKey={};
  lines.forEach(function(ln,lineIndex){
    var requestedNew=ln.mode==='new';
    if(ln.mode==='new'){ var mt=byName[uNorm((ln.newName||'').trim())]; if(mt)ln=Object.assign({},ln,{mode:'existing',ing:mt}); }
    var c=purchCalc(ln); var ingId=ln.ing; var nm;
    if(ln.mode==='new'){
      var nk=uNorm((ln.newName||'').trim());
      if(newByName[nk]){ ingId=newByName[nk]; }
      else { ingId='ing_'+invoiceId+'_'+lineIndex; newByName[nk]=ingId; agg[ingId]={before:0,oldCost:0,stock:0,value:0,newItem:true,recipeItem:(ln.newType==='consumable'||ln.recipeItem!==false),name:(ln.newName||'').trim(),unit:ln.newUnit||'',type:ln.newType||'base'}; }
      agg[ingId].stock+=c.stockAdd; agg[ingId].value+=c.lineTotal; nm=(ln.newName||'').trim();
    } else {
      var inv=inventoryMap[ingId]||{}; nm=inv.name||'';
      if(!agg[ingId])agg[ingId]={before:Number(inv.stock)||0,oldCost:Number(inv.cost)||0,stock:0,value:0};
      agg[ingId].stock+=c.stockAdd; agg[ingId].value+=c.lineTotal;
    }
    var rid='rcpt_'+invoiceId+'_'+lineIndex; receiptIds.push(rid); invTotal+=c.lineTotal;
    var lineUnitCost=(c.stockAdd>0?Math.round((c.lineTotal/c.stockAdd)*100000)/100000:0);
    var selectedSku=inventorySkuMap[ln.skuId]&&inventorySkuMap[ln.skuId].masterId===ingId&&inventorySkuMap[ln.skuId].active!==false?inventorySkuMap[ln.skuId]:null;
    var skuId=selectedSku?ln.skuId:'', skuBrand=selectedSku?(selectedSku.brand||''):(ln.brand||'').trim();
    if(requestedNew&&!selectedSku&&skuBrand){selectedSku=activeSkusFor(ingId).filter(function(s){return uNorm(s.brand)===uNorm(skuBrand);})[0]||null;if(selectedSku)skuId=selectedSku.id;}
    var needsNewSku=requestedNew&&(ln.newType==='consumable'||ln.recipeItem!==false)&&!skuId;
    if(needsNewSku&&skuBrand){var skuKey=ingId+'::'+uNorm(skuBrand);skuId=newSkuByKey[skuKey]||('sku_'+invoiceId+'_'+lineIndex);newSkuByKey[skuKey]=skuId;updates['inventorySku/'+skuId]={masterId:ingId,brand:skuBrand,supplier:(P.supplier||'').trim(),purchaseUnit:c.recvUnit,packSize:null,purchaseCost:null,convToBase:1,costPerBase:lineUnitCost,active:true,priority:activeSkusFor(ingId).length,branchAvail:['main'],seededFrom:'purchase',createdAt:Date.now(),updatedAt:Date.now()};}
    if(requestedNew&&(ln.newType==='consumable'||ln.recipeItem!==false)&&inventoryMap[ingId])seedUpdates['inventory/'+ingId+'/recipeItem']=true;
    updates['stockReceipts/'+rid]={ing:ingId,skuId:skuId,skuBrand:skuBrand,name:nm,unit:c.stockUnit,qty:c.stockAdd,recvQty:c.qty,recvUnit:c.recvUnit,unitCost:lineUnitCost,total:c.lineTotal,supplier:(P.supplier||'').trim(),brand:skuBrand,ref:effectiveRef,date:date,receivedBy:(P.by||'').trim(),payMode:P.pay,invoiceId:invoiceId,ts:Date.now()};
    /* P2: a batch/lot per line for expiry + brand tracking (does NOT drive costing — WAC pool stays authoritative) */
    var bid='bat_'+invoiceId+'_'+lineIndex; updates['inventoryBatch/'+bid]={skuId:skuId,masterId:ingId,brand:skuBrand,supplier:(P.supplier||'').trim(),qtyRecv:c.stockAdd,qtyRemaining:c.stockAdd,unit:c.stockUnit,unitCost:lineUnitCost,recvDate:date,expiry:(ln.expiry||''),lot:(ln.lot||''),branch:'main',source:'purchase',invoiceId:invoiceId,receiptId:rid,createdAt:Date.now()};
    invoiceLines.push({receiptId:rid,itemId:ingId,itemName:nm,recipeItem:recipeUsesInventory(ingId)||(ln.newType==='consumable'||ln.recipeItem!==false),skuId:skuId,skuBrand:skuBrand,qty:c.stockAdd,unit:c.stockUnit,unitCost:lineUnitCost,total:c.lineTotal});
  });
  var movementRows=[];
  Object.keys(agg).forEach(function(id){ var g=agg[id];
    if(g.newItem){ var ni={name:g.name,unit:g.unit,type:g.type,recipeItem:g.recipeItem===true,stock:0,cost:0,reorder:0,updatedAt:Date.now()}; if(g.type==='consumable'){ni.serves='both';ni.size='';ni.qtyPerOrder=1;} seedUpdates['inventory/'+id]=ni; }
    movementRows.push({movementId:movementId('purchase',invoiceId,id),itemId:id,type:'purchase',qty:Math.round(g.stock*1000000)/1000000,unitCost:g.stock>0?Math.round((g.value/g.stock)*1000000)/1000000:0,sourceType:'purchase-invoice',sourceId:invoiceId,note:(P.supplier||'Supplier')+' · '+effectiveRef,actorName:(P.by||'').trim()||'Admin',occurredAt:Date.now()});
  });
  invTotal=Math.round(invTotal*100)/100;
  updates['purchaseInvoices/'+invoiceId]={supplier:(P.supplier||'').trim(),ref:effectiveRef,date:date,due:(P.pay==='account'?(P.due||''):''),by:(P.by||'').trim(),payMode:P.pay,accountId:(P.pay==='paid'?P.acct:''),payableId:'',total:invTotal,lineCount:lines.length,lines:invoiceLines,receiptIds:receiptIds,movementIds:movementRows.map(function(x){return x.movementId;}),ts:Date.now()};
  /* New item shells must exist before the server can post their first movement. Movement IDs make retries safe. */
  Promise.resolve(Object.keys(seedUpdates).length?a.update(a.ref(a.db),seedUpdates):null).then(function(){return postMovements(movementRows);}).then(function(){return a.update(a.ref(a.db),updates);}).then(function(){
    if(P.pay==='paid'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+invoiceId,date:date,accountId:P.acct,amount:invTotal,party:(P.supplier||'').trim()||'Supplier',ref:effectiveRef,category:'Purchases',source:'purchase',linkId:invoiceId,note:lines.length+' item(s) received'});
    if(P.pay==='account'||P.pay==='pending')return a.reconcilePurchasePayable({invoiceId:invoiceId,due:P.pay==='account'?(P.due||''):''});
    return null;
  }).then(function(){
    if(window.__posLog)window.__posLog('purchase',(P.supplier||'Supplier'),lines.length+' item(s) · '+peso(invTotal)+(P.pay==='paid'?' · paid':P.pay==='account'?' · on account':' · invoice pending'));
    window.__purchPosting=false; window.__purch=null; renderPurchases();
    var m=document.getElementById('purMsg'); if(m)m.textContent='✓ Received '+lines.length+' item(s), invoice total '+peso(invTotal)+' at '+new Date().toLocaleTimeString();
    alert('Purchase received. Stock and weighted-average costs updated. ✅');
  }).catch(function(e){ window.__purchPosting=false; alert('Purchase post FAILED: '+((e&&e.message)||e)+'. The same invoice is safe to retry; inventory movements cannot double-post.'); });
}
function editIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  var ty=ingType(i), manualStd=stdCostMethod()==='manual';
  var units=['g','kg','ml','L','fl oz','pcs','shot','pump','ea','box','pack'];
  var eCats=invCats();
  var uOpts=(units.indexOf(i.unit||'')<0&&(i.unit||'')?'<option selected>'+esc(i.unit)+'</option>':'')+units.map(function(u){return '<option'+(u===(i.unit||'')?' selected':'')+'>'+u+'</option>';}).join('');
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<style>.ei-dialog{background:#fff;border-radius:14px;max-width:720px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 22px 60px rgba(20,35,27,.28);border:1px solid #d9cbb9}.ei-head{padding:1.15rem 1.3rem 1rem;border-bottom:1px solid #e7ddd0;background:#fbfaf7}.ei-eyebrow{font-size:.67rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#8b6746}.ei-title{font-size:1.18rem;font-weight:750;color:var(--bd);margin:.15rem 0 0}.ei-body{padding:1rem 1.3rem 1.2rem}.ei-section{border:1px solid #e3d8ca;border-radius:10px;padding:.85rem;margin-bottom:.75rem;background:#fff}.ei-section-title{font-size:.73rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5f4b3d;margin-bottom:.65rem}.ei-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}.ei-wide{grid-column:1/-1}.ei-readout{border:1px solid #d9cbb9;border-radius:8px;padding:.65rem .75rem;background:#f7f4ee}.ei-readout strong{display:block;font-size:1.02rem;color:var(--bd);margin-top:.15rem}.ei-help{font-size:.72rem;line-height:1.42;color:var(--tl);margin-top:.3rem}.ei-actions{display:flex;justify-content:flex-end;gap:.55rem;padding-top:.25rem}.ei-close{border:0;background:transparent;color:#725d4b;font-size:1.15rem;cursor:pointer;padding:.25rem .4rem}.ei-close:focus-visible,.ei-dialog input:focus-visible,.ei-dialog select:focus-visible,.ei-dialog button:focus-visible{outline:3px solid rgba(38,115,84,.24);outline-offset:2px}@media(max-width:580px){.ei-grid{grid-template-columns:1fr}.ei-wide{grid-column:auto}.ei-body,.ei-head{padding-left:.9rem;padding-right:.9rem}}</style>'
    +'<div class="ei-dialog" role="dialog" aria-modal="true" aria-labelledby="eiTitle">'
      +'<div class="ei-head"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;"><div><div class="ei-eyebrow">Stock item master</div><h2 class="ei-title" id="eiTitle">Edit '+esc(i.name)+'</h2></div><button class="ei-close" id="eiClose" aria-label="Close">✕</button></div><p class="pz-sub" style="margin:.4rem 0 0;">Maintain the item definition here. Inventory balances and actual costs remain controlled by the stock ledger.</p></div>'
      +'<div class="ei-body">'
        +'<section class="ei-section"><div class="ei-section-title">Item details</div><div class="ei-grid">'
          +'<label class="ei-wide"><span class="pz-lbl">Item name</span><input class="pz-in" id="eiName" value="'+esc(i.name||'')+'"/></label>'
          +'<label><span class="pz-lbl">Type</span><select class="pz-in" id="eiType"><option value="base"'+(ty==='base'?' selected':'')+'>Base ingredient</option><option value="option"'+(ty==='option'?' selected':'')+'>Optional ingredient</option><option value="both"'+(ty==='both'?' selected':'')+'>Base and optional</option><option value="consumable"'+(ty==='consumable'?' selected':'')+'>Consumable</option></select></label>'
          +'<label><span class="pz-lbl">Category</span><select class="pz-in" id="eiCat"><option value="">Uncategorized</option>'+eCats.map(function(c){return '<option value="'+esc(c.id)+'"'+((i.category||'')===c.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'
          +'<label><span class="pz-lbl">Inventory unit'+(i.ledgerVersion?' · locked':'')+'</span><select class="pz-in" id="eiUnit"'+(i.ledgerVersion?' disabled title="The unit is locked after ledger initialization"':'')+'>'+uOpts+'</select><div class="ei-help">'+(i.ledgerVersion?'Locked to protect the movement history.':'The base unit used by purchases, recipes, and stock cards.')+'</div></label>'
          +'<label><span class="pz-lbl">Reorder point</span><input class="pz-in" id="eiReorder" type="number" min="0" step="any" value="'+(Number(i.reorder)||0)+'"/><div class="ei-help">Low-stock warning begins at this balance.</div></label>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Inventory control</div><div class="ei-grid">'
          +'<div class="ei-readout"><span class="pz-lbl">Current balance</span><strong>'+num(Number(i.stock)||0)+' '+esc(i.unit||'')+'</strong><div class="ei-help">Calculated from posted inventory movements.</div></div>'
          +'<div class="ei-readout"><span class="pz-lbl">Actual cost · weighted average</span><strong>'+peso(Number(i.cost)||0)+' / '+esc(i.unit||'unit')+'</strong><div class="ei-help">Calculated automatically from received purchases and used by actual COGS.</div></div>'
          +'<div class="ei-wide" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-top:.05rem;"><div class="ei-help" style="margin:0;max-width:430px;">Count corrections, wastage, and stock variances belong in the audited adjustment workflow.</div><button class="pz-btn sec" id="eiAdjust" type="button" style="white-space:nowrap;">Adjust stock</button></div>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Planning cost</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Standard cost per unit ₱</span><input class="pz-in" id="eiStd" type="number" min="0" step="any" value="'+(i.stdCost!=null&&i.stdCost!==''?i.stdCost:'')+'" placeholder="Uses actual WAC"'+(manualStd?'':' disabled')+'/><div class="ei-help">'+(manualStd?'Used for pricing and margin planning. Leave blank to fall back to actual WAC.':'Standard costing is set to Weighted-average, so it follows the actual WAC automatically.')+'</div></label>'
          +'<div class="ei-readout"><span class="pz-lbl">Costing method</span><strong>'+(manualStd?'Manual standard':'Weighted-average · automatic')+'</strong><div class="ei-help">Change this method from Standard Costing on the Stock Items page.</div></div>'
        +'</div></section>'
        +'<section class="ei-section" id="eiCons" style="display:'+(ty==='consumable'?'block':'none')+';"><div class="ei-section-title">Consumption rule</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Used for</span><select class="pz-in" id="eiServes"><option value="both"'+((i.serves||'both')==='both'?' selected':'')+'>Drinks and food</option><option value="drink"'+(i.serves==='drink'?' selected':'')+'>Drinks</option><option value="food"'+(i.serves==='food'?' selected':'')+'>Food</option></select></label>'
          +'<label><span class="pz-lbl">Applicable size</span><select class="pz-in" id="eiSize"><option value="">All sizes</option><option'+(i.size==='S'?' selected':'')+'>S</option><option'+(i.size==='M'?' selected':'')+'>M</option><option'+(i.size==='L'?' selected':'')+'>L</option></select></label>'
          +'<label><span class="pz-lbl">Quantity per order</span><input class="pz-in" id="eiQPO" type="number" min="0" step="any" value="'+(i.qtyPerOrder!=null?i.qtyPerOrder:1)+'"/></label>'
        +'</div></section>'
        +'<div class="ei-actions"><button class="pz-btn sec" id="eiCancel">Cancel</button><button class="pz-btn ok" id="eiSave">Save changes</button></div>'
      +'</div></div>';
  document.body.appendChild(mask);
  var keyClose;
  function close(){if(keyClose)document.removeEventListener('keydown',keyClose);if(mask.parentNode)document.body.removeChild(mask);}
  mask.querySelector('#eiType').onchange=function(){mask.querySelector('#eiCons').style.display=(this.value==='consumable')?'block':'none';};
  mask.querySelector('#eiClose').onclick=close;
  mask.querySelector('#eiCancel').onclick=close;
  mask.querySelector('#eiAdjust').onclick=function(){close();adjustStock(id);};
  mask.onclick=function(e){if(e.target===mask)close();};
  keyClose=function(e){if(e.key==='Escape')close();};document.addEventListener('keydown',keyClose);
  mask.querySelector('#eiSave').onclick=function(){
    var type=mask.querySelector('#eiType').value;
    var _stdRaw=(mask.querySelector('#eiStd')||{}).value;
    var upd={name:(mask.querySelector('#eiName').value||'').trim()||i.name,unit:mask.querySelector('#eiUnit').value,type:type,category:(mask.querySelector('#eiCat')||{}).value||'',reorder:Number(mask.querySelector('#eiReorder').value)||0,updatedAt:Date.now()};
    if(manualStd)upd.stdCost=(_stdRaw===''||_stdRaw==null)?null:(Number(_stdRaw)||0);
    if(type==='consumable'){upd.serves=mask.querySelector('#eiServes').value;upd.size=mask.querySelector('#eiSize').value;upd.qtyPerOrder=Number(mask.querySelector('#eiQPO').value)||1;}
    A().update(A().ref(A().db,'inventory/'+id),upd).then(close).catch(function(e){alert('Could not save: '+((e&&e.message)||e)+'.');});
  };
  return;
}
/* Brand breakdown for a pooled generic item: shows each brand received + the
   weighted-average cost recipes actually use. On-hand is pooled (one figure). */
function brandBreakdown(id){
  var i=inventoryMap[id]; if(!i)return; var a=A();
  a.get(a.ref(a.db,'stockReceipts')).then(function(s){
    var all=s.val()||{}; var byBrand={}; var totQ=0,totV=0;
    Object.keys(all).forEach(function(k){var r=all[k]; if(!r||r.ing!==id)return; var b=(r.brand||'').trim()||'(no brand noted)'; if(!byBrand[b])byBrand[b]={qty:0,value:0,n:0,last:''}; byBrand[b].qty+=Number(r.qty)||0; byBrand[b].value+=Number(r.total)||0; byBrand[b].n++; totQ+=Number(r.qty)||0; totV+=Number(r.total)||0; var d=r.date||''; if(d>byBrand[b].last)byBrand[b].last=d;});
    var brands=Object.keys(byBrand).sort();
    var rows=brands.length?brands.map(function(b){var x=byBrand[b];var avg=x.qty>0?x.value/x.qty:0;return '<tr><td>'+esc(b)+'</td><td class="r">'+num(Math.round(x.qty*1000)/1000)+' '+esc(i.unit||'')+'</td><td class="r">'+peso(x.value)+'</td><td class="r">'+peso(Math.round(avg*100000)/100000)+'</td><td class="r" style="color:var(--tl);">'+x.n+'</td><td class="r" style="color:var(--tl);">'+esc(x.last||'')+'</td></tr>';}).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No purchases recorded for this item yet. Receive stock via the Purchases tab and note the brand per line.</td></tr>';
    var histAvg=totQ>0?(totV/totQ):0;
    var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:620px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🏷 Brands — '+esc(i.name)+'</div><button class="pz-btn sec" id="bbClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Recipes reference <b>'+esc(i.name)+'</b> and cost at its <b>current weighted-average: '+peso(Number(i.cost)||0)+' / '+esc(i.unit||'')+'</b> · on hand (pooled) '+num(Number(i.stock)||0)+' '+esc(i.unit||'')+'.</p>'
      +'<table class="pz-tbl"><thead><tr><th>Brand</th><th class="r">Received</th><th class="r">Total ₱</th><th class="r">Avg ₱/unit</th><th class="r">Buys</th><th class="r">Last</th></tr></thead><tbody>'+rows+'</tbody></table>'
      +(brands.length?'<div style="text-align:right;font-size:0.8rem;color:var(--tl);margin-top:0.3rem;">Lifetime purchase avg across brands: <b>'+peso(Math.round(histAvg*100000)/100000)+' / '+esc(i.unit||'')+'</b></div>':'')
      +'<p class="pz-sub" style="margin-top:0.6rem;font-size:0.72rem;">This is purchase history <b>by brand</b>. On-hand stock is pooled into one figure — per-brand remaining isn’t tracked once pooled (that’s the trade-off of pooling). The recipe always uses the current weighted-average cost shown above.</p>'
      +'<div style="margin-top:0.8rem;"><button class="pz-btn sec" id="bbClose2">Close</button></div></div>';
    document.body.appendChild(mask);
    function close(){document.body.removeChild(mask);}
    var c1=mask.querySelector('#bbClose'); if(c1)c1.onclick=close; var c2=mask.querySelector('#bbClose2'); if(c2)c2.onclick=close;
    mask.addEventListener('click',function(e){if(e.target===mask)close();});
  }).catch(function(e){ alert('Could not load brand history: '+((e&&e.code)||e)+'. If PERMISSION_DENIED, log in with your admin email.'); });
}
/* Every place a recipe/option references an inventory id — for referential integrity. */
function ingredientRefs(id){
  var refs=[];
  menuList().forEach(function(it){ var rec=recipesMap[it.key]; if(!rec)return; var used=false;
    (rec.base||[]).forEach(function(b){if(b.ing===id)used=true;});
    if(rec.choiceAdd)Object.keys(rec.choiceAdd).forEach(function(g){Object.keys(rec.choiceAdd[g]||{}).forEach(function(lk){(((rec.choiceAdd[g]||{})[lk]||{}).ings||[]).forEach(function(r){if(r&&r.ing===id)used=true;});});});
    if(used)refs.push('Recipe: '+it.name);
  });
  var store=optCostStore();
  Object.keys(store).forEach(function(g){Object.keys(store[g]||{}).forEach(function(lk){var e=store[g][lk]||{};(e.ings||[]).forEach(function(r){if(r&&r.ing===id)refs.push('Shared option cost: '+(e.label||lk));});});});
  Object.keys(optRecipesMap||{}).forEach(function(lb){if((optRecipesMap[lb]||{}).ing===id)refs.push('Option (legacy): '+lb);});
  return refs;
}
function delIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  if(i.ledgerVersion){alert('Cannot delete "'+i.name+'" after ledger initialization. Its movement history must remain linked to a real item. Create a replacement item and stop using this one instead.');return;}
  var refs=ingredientRefs(id);
  if(refs.length){ alert('Cannot delete "'+i.name+'" — it is still used by '+refs.length+' recipe/option'+(refs.length===1?'':'s')+':\n\n'+refs.slice(0,25).join('\n')+(refs.length>25?'\n…and '+(refs.length-25)+' more':'')+'\n\nRemove it from these (or repoint them to the correct item) first. This keeps every recipe linked to a real inventory item.'); return; }
  if(!confirm('Delete "'+i.name+'"? It is not used by any recipe.'))return;
  var a=A();a.remove(a.ref(a.db,'inventory/'+id));
}
function openCatManager(){
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var cats=invCats();
    var rows=cats.map(function(c){return '<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;" data-catrow="'+esc(c.id)+'"><input class="pz-in" data-cf="name" value="'+esc(c.name)+'" style="flex:1;"/><select class="pz-in" data-cf="kind" style="width:170px;"><option value="cogs"'+(c.kind!=='overhead'?' selected':'')+'>Product cost (COGS)</option><option value="overhead"'+(c.kind==='overhead'?' selected':'')+'>Overhead</option></select><button class="pz-btn warn" data-catdel="'+esc(c.id)+'" style="padding:0.2rem 0.5rem;">✕</button></div>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:540px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🗂 Inventory categories</div><button class="pz-btn sec" id="cmClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Group inventory items. Mark a category <b>Overhead</b> for supplies that aren’t recipe ingredients — record their use in Internal Usage (Overhead type) and it posts to the Overhead P&amp;L line. Recipes still link to the pooled item; categories are organization.</p>'
      +'<div data-catrows>'+(rows||'<div style="color:var(--tl);font-size:0.8rem;">No categories yet.</div>')+'</div>'
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="cmNew" placeholder="new category name" style="flex:1;"/><select class="pz-in" id="cmNewKind" style="width:170px;"><option value="cogs">Product cost (COGS)</option><option value="overhead">Overhead</option></select><button class="pz-btn sec" id="cmAdd">+ Add</button></div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cmSave">💾 Save</button><button class="pz-btn sec" id="cmClose2">Close</button></div></div>';
    var a=A();
    mask.querySelector('#cmAdd').onclick=function(){var nm=(mask.querySelector('#cmNew').value||'').trim();if(!nm){alert('Type a category name.');return;}var k=mask.querySelector('#cmNewKind').value;var o={};o[uid('cat_')]={name:nm,kind:k,order:invCats().length};a.update(a.ref(a.db,'posSettings/invCategories'),o);setTimeout(draw,250);};
    mask.querySelectorAll('[data-catdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-catdel');var used=ings().filter(function(x){return (x.category||'')===id;}).length;if(used&&!confirm(used+' item(s) use this category. Delete it anyway? Those items just lose the label.'))return;a.remove(a.ref(a.db,'posSettings/invCategories/'+id));setTimeout(draw,250);};});
    mask.querySelector('#cmSave').onclick=function(){var ups={};mask.querySelectorAll('[data-catrow]').forEach(function(r,ix){var id=r.getAttribute('data-catrow');var nm=(r.querySelector('[data-cf="name"]').value||'').trim();var k=r.querySelector('[data-cf="kind"]').value;if(nm)ups[id]={name:nm,kind:k,order:ix};});a.update(a.ref(a.db,'posSettings/invCategories'),ups).then(function(){if(isTab('inventory'))renderInventory();alert('Categories saved.');}).catch(function(e){alert('Could not save: '+((e&&e.code)||e));});};
    var c1=mask.querySelector('#cmClose'),c2=mask.querySelector('#cmClose2');function close(){document.body.removeChild(mask);}if(c1)c1.onclick=close;if(c2)c2.onclick=close;
  }
  document.body.appendChild(mask); draw();
}
/* One-click: relabel any item stocked in ambiguous "oz"/"ounce" to "fl oz" (fluid ounce = volume),
   so ml/L conversion works in recipes. Quantity is unchanged; only the unit label changes.
   Use only for liquids — a weight-ounce item should be set to g/kg instead. */
function migrateOzToFloz(){
  var items=ings().filter(function(i){var u=uNorm(i.unit);return u==='oz'||u==='ounce';});
  if(!items.length){alert('No items are using oz / ounce.');return;}
  if(!confirm('Convert '+items.length+' item(s) from oz/ounce to "fl oz" (fluid ounce)?\n\n'+items.map(function(i){return '• '+i.name;}).join('\n')+'\n\nThe stock number stays the same — this only makes the unit a proper volume so ml/L conversion works. Use this only if these are liquids.'))return;
  var a=A();
  items.forEach(function(i){ a.update(a.ref(a.db,'inventory/'+i.id),{unit:'fl oz',updatedAt:Date.now()}); });
  if(window.__posLog)window.__posLog('unit-migrate','oz → fl oz',items.length+' item(s)');
  alert('Converted '+items.length+' item(s) to fl oz. ✅ You can now enter ml/L in their recipes.');
}
function updateLowStockBadge(){
  var n=ings().filter(function(i){return Number(i.stock)<=Number(i.reorder||0);}).length;
  var b=document.getElementById('lowStockBadge'); if(!b)return;
  if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';}
}

/* ══════════ RECIPES ══════════ */
function menuList(){ return (A().getMenuItems?A().getMenuItems():[]).slice().sort(function(a,b){return (a.cat||'').localeCompare(b.cat||'')||(a.name||'').localeCompare(b.name||'');}); }
function recipeCost(rec,size){var key='preview';var result=Costing().costRecipe({itemKey:key,recipe:rec,inventory:inventoryMap,item:{name:'Recipe'},size:size});return result.totalCost;}
function recipeDraftRaw(d){
  d=d||{};
  var base=(d.base||[]).filter(function(r){return r&&r.ing&&['S','M','L'].some(function(sz){return r['d'+sz]!=null&&r['d'+sz]!=='';});}).map(function(r){var inv=inventoryMap[r.ing]||{};return {ing:r.ing,unit:r.unit||inv.unit||'',dispS:r.dS===''?null:r.dS,dispM:r.dM===''?null:r.dM,dispL:r.dL===''?null:r.dL};});
  var rec={base:base,updatedAt:Date.now()},allow=caAllowGroups();
  Object.keys(d.choiceAdd||{}).forEach(function(g){if(allow.indexOf(g)<0)return;var group={};Object.keys(d.choiceAdd[g]||{}).forEach(function(lk){var e=d.choiceAdd[g][lk]||{};var rows=(e.ings||[]).filter(function(r){return r&&r.ing&&['S','M','L'].some(function(sz){return r['qty'+sz]!=null&&r['qty'+sz]!=='';});});if(rows.length)group[lk]={label:e.label||lk,ings:rows};});if(Object.keys(group).length){rec.choiceAdd=rec.choiceAdd||{};rec.choiceAdd[g]=group;}});
  return rec;
}
function costingIssues(list){return (list||[]).map(function(x){return '• '+(x.message||x.code||'Costing error');}).join('\n');}
/* Menu items with a costing gap: no recipe, ₱0 recipe cost, or a base ingredient with no cost. */
function markNoRecipe(key,val){ var a=A(); a.set(a.ref(a.db,'menuItems/'+key+'/noRecipe'),val?true:null).then(function(){ updateCostBadge(); }).catch(function(e){ alert('Could not update: '+((e&&e.code)||e)+'. Log in with your admin EMAIL.'); }); }
function menuCostGaps(){
  var out=[];
  menuList().forEach(function(it){
    if(it.noRecipe)return; /* resale / bought-in items opted out of costing */
    var rec=recipesMap[it.key];
    if(!rec||!(rec.base&&rec.base.length)){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'No recipe yet'}); return; }
    if((rec.base||[]).some(function(b){return b.ing&&!inventoryMap[b.ing];})){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'An ingredient was deleted (broken link)'}); return; }
    if(!(recipeCost(rec,'M')>0)){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'Recipe cost is ₱0'}); return; }
    if((rec.base||[]).some(function(b){return b.ing&&!(Number((inventoryMap[b.ing]||{}).cost)>0);})){ out.push({key:it.key,name:it.name,cat:it.cat,reason:'An ingredient has no cost'}); }
  });
  return out;
}
function updateCostBadge(){ var n=menuCostGaps().length; var b=document.getElementById('costGapBadge'); if(!b)return; if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';} }
function renderRecipes(){
  var root=document.getElementById('recipesRoot'); if(!root)return;
  var tabs=[['base','🧪 Recipe (base + consumables)'],['saved','📋 Saved Recipes'],['options','➕ Optional ingredients']];
  var nav='<div style="display:flex;gap:0.4rem;margin:0.4rem 0 1rem;flex-wrap:wrap;">'+tabs.map(function(t){return '<button class="pz-btn '+(recSub===t[0]?'ok':'sec')+'" data-recsub="'+t[0]+'" style="padding:0.4rem 0.9rem;">'+t[1]+'</button>';}).join('')+'</div>';
  if(recSub==='consumables')recSub='base';
  var body;
  if(recSub==='options'){ body='<div id="optMasterRoot"></div>'; }
  else if(recSub==='saved'){
    var sitems=menuList().filter(function(it){return !!recipesMap[it.key];});
    var savedRows=sitems.length?sitems.map(function(it){var rec=recipesMap[it.key];return '<tr style="cursor:pointer;" data-recopen="'+esc(it.key)+'"><td>'+esc(it.name)+'</td><td style="color:var(--tl);font-size:0.8rem;">'+esc(A().getCatLabel?A().getCatLabel(it.cat):(it.cat||''))+'</td><td class="r">'+((rec.base&&rec.base.length)||0)+'</td><td class="r">'+peso(recipeCost(rec,'S'))+'</td><td class="r">'+peso(recipeCost(rec,'M'))+'</td><td class="r">'+peso(recipeCost(rec,'L'))+'</td><td class="r"><button class="pz-btn ok" data-recopen="'+esc(it.key)+'" style="padding:0.15rem 0.6rem;">Open</button></td></tr>';}).join(''):'<tr><td colspan="7" style="color:var(--tl);padding:0.6rem;">No saved recipes yet. Build one in the Recipe tab.</td></tr>';
    body='<p class="pz-sub">All saved recipes ('+sitems.length+'). Click a row to open it in the Recipe tab — edit, add or remove ingredients, then save.</p>'
      +'<div class="pz-card"><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th>Category</th><th class="r">Ingredients</th><th class="r">Cost S</th><th class="r">Cost M</th><th class="r">Cost L</th><th></th></tr></thead><tbody>'+savedRows+'</tbody></table></div></div>';
  }
  else {
    var items=menuList();
    var opts=items.map(function(it){var has=!!recipesMap[it.key];return '<option value="'+esc(it.key)+'"'+(it.key===curRecipeKey?' selected':'')+'>'+(has?'✓ ':'○ ')+esc(it.name)+'</option>';}).join('');
    var covered=items.filter(function(it){return !!recipesMap[it.key];}).length;
    body='<p class="pz-sub">Build each drink from its ingredients — base + consumables (cups, lids, straws) — with the quantity per size. Cost per drink is the sum. Optional add-ons are costed separately in the Optional ingredients tab and only trigger when a customer picks them. Saved recipes are listed in the <b>Saved Recipes</b> tab. <b>'+covered+' of '+items.length+'</b> items have a recipe.</p>'
      +'<div class="pz-card" style="margin-bottom:1rem;"><span class="pz-lbl">Start / edit a recipe — pick a menu item</span>'
      +'<select class="pz-in" id="recPick" style="max-width:420px;"><option value="">— choose an item —</option>'+opts+'</select></div>'
      +'<div id="recEditor"></div>';
  }
  var tools='<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">'
    +'<button class="pz-btn sec" id="recCostSheet">📊 Cost sheet</button>'
    +'<button class="pz-btn sec" id="recExport">⬇ Export recipes</button>'
    +'<button class="pz-btn sec" id="recTemplate">⬇ Import template</button>'
    +'<button class="pz-btn ok" id="recImportBtn">⬆ Import recipes</button>'
    +'<input type="file" id="recImportFile" accept=".xlsx,.xls,.csv" style="display:none;"/>'
    +'</div>';
  var _gaps=menuCostGaps();
  var _editingNow=(recSub==='base'&&!!curRecipeKey);
  var gapPanel;
  if(!_gaps.length){ gapPanel='<div class="pz-card" style="border:1px solid #a8d5b5;background:#f0faf4;margin-bottom:0.8rem;color:#2d6a4f;font-weight:600;">✓ All menu items are costed.</div>'; }
  else if(_editingNow){ gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.6rem;padding:0.45rem 0.8rem;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;"><span style="color:#8a5a00;font-weight:600;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' still not costed — finish below, the list updates.</span><button class="pz-btn sec" id="recBackToList" style="padding:0.15rem 0.6rem;">◂ Back to list</button></div>'; }
  else { gapPanel='<div class="pz-card" style="border:1px solid #f0c36d;background:#fff8e8;margin-bottom:0.8rem;"><div style="font-weight:700;color:#8a5a00;">⚠ '+_gaps.length+' menu item'+(_gaps.length===1?'':'s')+' not costed yet</div><p class="pz-sub" style="margin:0.2rem 0 0.4rem;">These can be sold without a reliable COGS. Click “Cost it” to open its costing page.</p>'+_gaps.map(function(g){return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.25rem 0;border-top:1px solid #f0e0c0;"><span>'+esc(g.name)+' <span style="color:#a06a10;font-size:0.75rem;">· '+esc(g.reason)+'</span></span><span style="white-space:nowrap;"><button class="pz-btn sec" data-noneed="'+esc(g.key)+'" style="padding:0.12rem 0.5rem;font-size:0.72rem;">not a recipe item</button> <button class="pz-btn ok" data-recopen="'+esc(g.key)+'" style="padding:0.12rem 0.6rem;">Cost it</button></span></div>';}).join('')+'</div>'; }
  root.innerHTML='<div class="pz-h">🧪 Recipe &amp; Costing</div>'+gapPanel+nav+tools+body;
  updateCostBadge();
  var _btl=document.getElementById('recBackToList'); if(_btl)_btl.onclick=function(){ curRecipeKey=null; recipeEditing=false; renderRecipes(); };
  root.querySelectorAll('[data-recsub]').forEach(function(b){b.onclick=function(){recSub=b.getAttribute('data-recsub');recipeEditing=false;renderRecipes();};});
  root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');recSub='base';recipeEditing=false;renderRecipes();var e=document.getElementById('recEditor');if(e)e.scrollIntoView({behavior:'smooth',block:'start'});};});
  root.querySelectorAll('[data-noneed]').forEach(function(b){b.onclick=function(){ if(confirm('Mark this as a resale / bought-in item that needs no recipe? It will be hidden from the not-costed flag. Its COGS won\'t be tracked by recipe — record its cost via the purchase price instead.')) markNoRecipe(b.getAttribute('data-noneed'),true); renderRecipes(); };});
  var _cs=document.getElementById('recCostSheet'); if(_cs)_cs.onclick=exportCostSheet;
  var _re=document.getElementById('recExport'); if(_re)_re.onclick=exportRecipesXlsx;
  var _rt=document.getElementById('recTemplate'); if(_rt)_rt.onclick=downloadRecipeTemplate;
  var _rb=document.getElementById('recImportBtn'), _rf=document.getElementById('recImportFile');
  if(_rb&&_rf){ _rb.onclick=function(){_rf.value='';_rf.click();}; _rf.onchange=function(){ if(_rf.files&&_rf.files[0])importRecipesXlsx(_rf.files[0]); }; }
  if(recSub==='options'){ renderOptionsMaster(); }
  else if(recSub==='saved'){ root.querySelectorAll('[data-recopen]').forEach(function(b){b.onclick=function(){curRecipeKey=b.getAttribute('data-recopen');recSub='base';recipeEditing=false;renderRecipes();};}); }
  else { var rp=document.getElementById('recPick'); if(rp)rp.onchange=function(){ curRecipeKey=this.value||null; openRecipe(curRecipeKey); };
    if(curRecipeKey)openRecipe(curRecipeKey); }
}
function optLabelsForItem(item){
  var groups=A().getItemOptionGroups?A().getItemOptionGroups(item):[]; var out=[];
  (groups||[]).forEach(function(g){ (g.choices||[]).forEach(function(c){ out.push({group:g.name,label:c.label}); }); });
  return out;
}
function openRecipe(key){
  var ed=document.getElementById('recEditor'); if(!ed)return;
  if(!key){ed.innerHTML='';recipeEditing=false;return;}
  var _raw=A().menuItemsMap[key]; if(!_raw){ed.innerHTML='<p class="pz-sub">Item not found.</p>';return;}
  var item=Object.assign({key:key},_raw);
  recipeEditing=true;
  var saved=recipesMap[key]||{};
  var sm=saved.sizeMult||{S:1,M:1.3,L:1.6};
  recipeDraft={
    base:(saved.base?saved.base.map(function(b){
      var inv=inventoryMap[b.ing]||{}; var u=b.unit||inv.unit||'';
      if(uNorm(u)==='oz'){var dim=itemDim(inv);u=dim==='volume'?'fl oz':(dim==='weight'?'oz wt':u);}
      var qS,qM,qL;
      if(b.qtyS!=null||b.qtyM!=null||b.qtyL!=null){qS=b.qtyS;qM=b.qtyM;qL=b.qtyL;}
      else{var q=Number(b.qty)||0;qS=q*(sm.S!=null?sm.S:1);qM=q*(sm.M!=null?sm.M:1);qL=q*(sm.L!=null?sm.L:1);}
      function display(stored,shown){if(shown!=null)return shown;var cv=Costing().convert(Number(stored)||0,inv.unit||u,u);return cv.ok?cv.qty:stored;}
      return {ing:b.ing,unit:u,dS:display(qS,b.dispS),dM:display(qM,b.dispM),dL:display(qL,b.dispL)};
    }):[]),
    choiceAdd:ocClone(saved.choiceAdd),
    _optPreview:[]
  };
  var _sel={}; (A().getItemOptionGroups?A().getItemOptionGroups(item):[]).forEach(function(g){ if(g.required&&g.type!=='multi'&&(g.choices||[]).length)_sel[g.id]=g.choices[0].label; });
  window.__recCostSel=_sel;
  drawRecipeEditor(item);
}
function drawRecipeEditor(item){
  var ed=document.getElementById('recEditor'); if(!ed)return;
  var d=recipeDraft; var size=recSize||'M';
  var cat=item.cat||''; var ct=catType(cat);
  function ingSelect(val,attr){return '<select class="pz-in" '+attr+' style="min-width:150px;"><option value="">— ingredient —</option>'+ingsByType('base').concat(ingsByType('both')).concat(ingsByType('consumable')).map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var baseTotal=0;
  var baseRows=d.base.map(function(r,ix){
    var inv=inventoryMap[r.ing]||{};
    var stockQ=convertToStock((r['d'+size]===''||r['d'+size]==null)?0:Number(r['d'+size]),r.unit,inv);
    var amt=(Number.isFinite(stockQ)?stockQ:0)*ingCost(r.ing); baseTotal+=amt;
    var cu=compatUnits(inv); var uOpts=cu.map(function(u){return '<option'+(uNorm(u)===uNorm(r.unit)?' selected':'')+'>'+esc(u)+'</option>';}).join('');
    var stkNote=!Number.isFinite(stockQ)?'<div style="font-size:0.62rem;color:#b44336;">incompatible unit</div>':((inv.unit&&uNorm(inv.unit)!==uNorm(r.unit))?('<div style="font-size:0.62rem;color:var(--tl);">=&nbsp;'+num(Math.round(stockQ*1000)/1000)+' '+esc(inv.unit)+'</div>'):'');
    function qc(sz){return '<input class="pz-in" type="number" step="any" style="width:80px;text-align:right;" value="'+(r['d'+sz]!=null&&r['d'+sz]!==''?r['d'+sz]:'')+'" data-brow="'+ix+'" data-bfield="d'+sz+'" placeholder="0"/>';}
    return '<tr><td>'+ingSelect(r.ing,'data-brow="'+ix+'" data-bfield="ing"')+'</td>'
      +'<td style="white-space:nowrap;"><select class="pz-in" data-brow="'+ix+'" data-bfield="unit" style="width:70px;padding-left:0.3rem;padding-right:0.2rem;" title="Unit you are entering — converts to the item stock unit for costing">'+(uOpts||'<option></option>')+'</select>'+stkNote+'</td>'
      +'<td>'+qc('S')+'</td><td>'+qc('M')+'</td><td>'+qc('L')+'</td>'
      +'<td style="white-space:nowrap;font-weight:600;">'+peso(amt)+' <button class="pz-btn warn" style="padding:0.2rem 0.45rem;font-weight:400;" data-brem="'+ix+'">✕</button></td></tr>';
  }).join('');
  var sizeBtns=['S','M','L'].map(function(sz){return '<button class="pz-btn '+(sz===size?'ok':'sec')+'" data-recsize="'+sz+'" style="padding:0.25rem 0.8rem;">'+sz+'</button>';}).join(' ');
  var grand=baseTotal;
  var caGroupsAll=(A().getItemOptionGroups?A().getItemOptionGroups(item):[])||[];
  var caAllow=caAllowGroups();
  if(d.choiceAdd){Object.keys(d.choiceAdd).forEach(function(_g){if(caAllow.indexOf(_g)<0)delete d.choiceAdd[_g];});}
  var caGroups=caGroupsAll.filter(function(g){return caAllow.indexOf(g.id)>=0;});
  var caInv=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function caIngSel(val){return '<select class="pz-in" data-caf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+caInv.map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var caCards=caGroups.map(function(g){
    var choices=(g.choices||[]).map(function(c){
      var lk=optKey(c.label); var rows=(d.choiceAdd&&d.choiceAdd[g.id]&&d.choiceAdd[g.id][lk]&&d.choiceAdd[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        return '<tr data-carow data-ca-g="'+esc(g.id)+'" data-ca-l="'+esc(lk)+'" data-ca-label="'+esc(c.label)+'" data-ca-ix="'+ix+'">'
          +'<td>'+caIngSel(r.ing)+'</td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyS" value="'+(r.qtyS!=null&&r.qtyS!==''?r.qtyS:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyM" value="'+(r.qtyM!=null&&r.qtyM!==''?r.qtyM:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:60px;" data-caf="qtyL" value="'+(r.qtyL!=null&&r.qtyL!==''?r.qtyL:'')+'" placeholder="0"/></td>'
          +'<td><button class="pz-btn warn" data-carem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
      }).join('');
      return '<div style="border-top:1px solid var(--cd);padding:0.4rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.3rem;"><b>'+esc(c.label)+'</b>'
        +'<span data-cacost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">extra — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'))+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.3rem 0;"><thead><tr><th>Extra ingredient</th><th>S</th><th>M</th><th>L</th><th></th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-caadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.15rem 0.55rem;font-size:0.76rem;">+ extra ingredient</button>'
        +'</div>';
    }).join('');
    return '<div style="margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);font-size:0.85rem;">'+esc(g.name)+'</div>'+choices+'</div>';
  }).join('');
  var caManage=caGroupsAll.map(function(g){var on=caAllow.indexOf(g.id)>=0;return '<label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.72rem;margin:0 0.7rem 0.25rem 0;cursor:pointer;"><input type="checkbox" data-cagrp="'+esc(g.id)+'"'+(on?' checked':'')+'/>'+esc(g.name)+'</label>';}).join('');
  var caSection=caGroupsAll.length?('<div style="border-top:2px solid var(--cd);margin-top:0.8rem;padding-top:0.6rem;"><div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Extra ingredients per choice — this drink only</div><p class="pz-sub" style="margin-top:0;">Stacks on top of the base recipe and the shared Optional-ingredients cost (cups, ice, milk). Use for drink-specific deltas — e.g. Hot → extra coffee for this drink. Blank = 0 for that size.</p>'+'<div style="background:var(--cd);border-radius:6px;padding:0.4rem 0.55rem;margin-bottom:0.5rem;font-size:0.72rem;"><b>Which choices can carry per-drink extras</b> <span style="color:var(--tl);">(applies to all drinks — Temperature only by default):</span><div style="margin-top:0.3rem;">'+caManage+'</div></div>'+(caCards||'<p class="pz-sub" style="margin:0;">No choices enabled — tick one above to add a per-drink extra.</p>')+'</div>'):'';
  // ── COST PER DRINK calculator: base + selected choices (per-recipe extra + shared optional) ──
  var tempRec={choiceAdd:d.choiceAdd};
  var previewNorm=Costing().normalizeRecipe(recipeDraftRaw(d),inventoryMap);
  var previewRec=previewNorm.ok?previewNorm.recipe:null;
  if(previewRec){var _basePreview=Costing().costRecipe({itemKey:item.key,recipe:previewRec,inventory:inventoryMap,item:item,size:size});baseTotal=_basePreview.totalCost;grand=baseTotal;}
  function selLabelCost(lb){var c=0;choiceIngs(item,tempRec,lb,size).forEach(function(r){c+=(Number(r.qty)||0)*ingCost(r.ing);});return c;}
  var selState=window.__recCostSel||{};
  var selLines=[],extrasTotal=0,selectedLabels=[];
  caGroupsAll.forEach(function(g){var v=selState[g.id];var labels=Array.isArray(v)?v:(v?[v]:[]);labels.forEach(function(lb){var cc=selLabelCost(lb);extrasTotal+=cc;selLines.push('<div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">'+esc(g.name)+': '+esc(lb)+'</span><span>'+peso(cc)+'</span></div>');});});
  caGroupsAll.forEach(function(g){var v=selState[g.id];(Array.isArray(v)?v:(v?[v]:[])).forEach(function(lb){selectedLabels.push(lb);});});
  var drinkPreview=previewRec?Costing().costRecipe({itemKey:item.key,recipe:previewRec,inventory:inventoryMap,item:item,size:size,optLabels:selectedLabels,optionCosts:optCostStore(),optionRecipes:optRecipesMap,optionGroups:(A()&&A().optionGroupsMap)||{}}):{totalCost:0,lines:[],errors:previewNorm.errors||[],warnings:previewNorm.warnings||[]};
  var drinkTotal=previewRec?drinkPreview.totalCost:(baseTotal+extrasTotal);
  var traceRows=(drinkPreview.lines||[]).map(function(line){return '<tr><td>'+esc(line.source.replace(/_/g,' '))+'</td><td>'+esc(line.ingredientName)+'</td><td class="r">'+num(line.totalQuantity)+' '+esc(line.stockUnit)+'</td><td class="r">'+peso(line.unitCost)+'</td><td class="r">'+peso(line.totalCost)+'</td></tr>';}).join('');
  var previewIssues=(drinkPreview.errors||[]).concat(drinkPreview.warnings||[]);
  var tracePanel='<details style="margin-top:0.55rem;"><summary style="cursor:pointer;font-size:0.75rem;color:var(--bd);font-weight:600;">Cost trace · engine '+esc(Costing().VERSION)+'</summary>'+(previewIssues.length?'<div style="margin:0.4rem 0;padding:0.45rem;background:#fff8e8;color:#8a5a00;font-size:0.72rem;white-space:pre-line;">'+esc(costingIssues(previewIssues))+'</div>':'')+(traceRows?'<div style="overflow-x:auto;"><table class="pz-tbl" style="font-size:0.7rem;"><thead><tr><th>Source</th><th>Ingredient</th><th class="r">Usage</th><th class="r">Unit cost</th><th class="r">Cost</th></tr></thead><tbody>'+traceRows+'</tbody></table></div>':'<div style="font-size:0.72rem;color:var(--tl);padding:0.4rem 0;">Add a valid ingredient and quantity to see the trace.</div>')+'</details>';
  var calcGroups=caGroupsAll.map(function(g){var sv=selState[g.id];var isMulti=g.type==='multi';
    var chips=(g.choices||[]).map(function(c){var on=isMulti?(Array.isArray(sv)&&sv.indexOf(c.label)>-1):(sv===c.label);return '<button class="pz-btn '+(on?'ok':'sec')+'" data-rcsel="'+esc(g.id)+'" data-rcmulti="'+(isMulti?1:0)+'" data-rclabel="'+esc(c.label)+'" style="padding:0.18rem 0.55rem;font-size:0.74rem;margin:0 0.2rem 0.2rem 0;">'+esc(c.label)+'</button>';}).join('');
    return '<div style="margin-bottom:0.3rem;"><span style="font-size:0.7rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.03em;display:block;">'+esc(g.name)+(isMulti?' · pick any':' · pick one')+'</span>'+chips+'</div>';
  }).join('');
  var drinkCard=caGroupsAll.length?('<div class="pz-card" style="margin-bottom:1rem;border:2px solid var(--bd);">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem;"><span style="font-weight:700;color:var(--bd);">💰 Cost per drink — by selection</span><span><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Size</span>'+sizeBtns+'</span></div>'
    +'<p class="pz-sub" style="margin-top:0;">Pick the choices a customer would make; this stacks the base, this drink’s per-choice extras, and the shared Optional-ingredients cost, at the '+size+' size.</p>'
    +calcGroups
    +'<div style="border-top:1px solid var(--cd);margin-top:0.4rem;padding-top:0.4rem;font-size:0.8rem;"><div style="display:flex;justify-content:space-between;"><span style="color:var(--tl);">Base</span><span>'+peso(baseTotal)+'</span></div>'+selLines.join('')+'</div>'
    +'<div style="border-top:2px solid var(--bd);margin-top:0.4rem;padding-top:0.5rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">COST PER DRINK / '+size+'</span><span style="font-weight:700;font-size:1.2rem;color:var(--bd);">'+peso(drinkTotal)+'</span></div>'
    +'</div>'):'';
  ed.innerHTML=
    '<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;"><div style="font-weight:600;color:var(--bd);">Recipe for “'+esc(item.name)+'”'+(cat?' · <span style="color:var(--tl);font-size:0.82rem;">'+esc(A().getCatLabel?A().getCatLabel(cat):cat)+(ct?' ('+ct+')':'')+'</span>':'')+'</div><div><span class="pz-lbl" style="display:inline;margin-right:0.4rem;">Cost for size</span>'+sizeBtns+'</div></div>'
      +'<label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.76rem;color:var(--tl);margin-bottom:0.5rem;cursor:pointer;"><input type="checkbox" id="recNoNeed"'+(item.noRecipe?' checked':'')+'/> No recipe needed (resale / bought-in item — hide from the not-costed flag)</label>'
      +(ings().length?'':'<p class="pz-low" style="font-size:0.8rem;">Add items in the Inventory tab first.</p>')
      +'<span class="pz-lbl">Recipe ingredients — base &amp; consumables (cups, lids, straws…). Enter qty per size.</span>'
      +'<table class="pz-tbl" style="margin-bottom:0.4rem;"><thead><tr><th>Ingredient</th><th>Recipe unit</th><th>S</th><th>M</th><th>L</th><th>Amount ('+size+')</th></tr></thead><tbody>'+(baseRows||'<tr><td colspan="6" style="color:var(--tl);padding:0.5rem;">No ingredients yet.</td></tr>')+'</tbody></table>'
      +'<button class="pz-btn sec" id="recAddBase" style="padding:0.3rem 0.7rem;">+ ingredient</button>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Add cups / lids / straws / tissue here too — pick the inventory item (tagged consumable) and its qty. Optional add-ons are costed separately in the Optional ingredients tab and only trigger when a customer picks them.</div>'
      +'<div style="border-top:2px solid var(--bd);margin-top:0.8rem;padding-top:0.6rem;display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:var(--bd);">BASE COST / '+size+'</span><span style="font-weight:700;font-size:1.1rem;color:var(--bd);">'+peso(grand)+'</span></div>'
      +'<div style="font-size:0.68rem;color:var(--tl);margin-top:0.2rem;">Base ingredients only. The full cost per drink (base + extras + optional) is in the calculator below.</div>'
      +tracePanel
      +caSection
      +'<div style="margin-top:1rem;display:flex;gap:0.5rem;">'
        +'<button class="pz-btn ok" id="recSave">💾 Save recipe</button>'
        +'<button class="pz-btn sec" id="recClose">Close</button>'
        +(recipesMap[item.key]?'<button class="pz-btn warn" id="recDel" style="margin-left:auto;">Delete recipe</button>':'')
      +'</div>'
    +'</div>'
    +drinkCard;
  // sync DOM into draft
  function syncDraft(){
    var base=[]; d.base.forEach(function(_,ix){ var ing=ed.querySelector('[data-brow="'+ix+'"][data-bfield="ing"]'); if(!ing)return; var uEl=ed.querySelector('[data-brow="'+ix+'"][data-bfield="unit"]'); var inv=inventoryMap[ing.value]||{}; var u=uEl?uEl.value:(inv.unit||''); if(compatUnits(inv).map(uNorm).indexOf(uNorm(u))<0)u=inv.unit||u; var row={ing:ing.value,unit:u}; ['S','M','L'].forEach(function(sz){var q=ed.querySelector('[data-brow="'+ix+'"][data-bfield="d'+sz+'"]'); row['d'+sz]=q?(q.value===''?'':(Number(q.value)||0)):'';}); base[ix]=row;});
    d.base=base.filter(function(x){return x;});
  }
  function syncChoiceAdd(){
    var next={};
    ed.querySelectorAll('[data-carow]').forEach(function(tr){
      var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l'),lbl=tr.getAttribute('data-ca-label')||'';
      var ing=(tr.querySelector('[data-caf="ing"]')||{}).value||''; if(!ing)return;
      function v(f){var el=tr.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}
      next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
      next[g][lk].ings.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});
    });
    d.choiceAdd=next;
  }
  function syncAll(){syncDraft();syncChoiceAdd();}
  document.getElementById('recAddBase').onclick=function(){syncAll();d.base.push({ing:'',unit:'',dS:'',dM:'',dL:''});drawRecipeEditor(item);};
  ed.querySelectorAll('[data-recsize]').forEach(function(b){b.onclick=function(){syncAll();recSize=b.getAttribute('data-recsize');drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-brem]').forEach(function(b){b.onclick=function(){syncAll();d.base.splice(Number(b.getAttribute('data-brem')),1);drawRecipeEditor(item);};});
  ed.querySelectorAll('select[data-brow]').forEach(function(s){s.onchange=function(){syncAll();drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-caadd]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label');d.choiceAdd=d.choiceAdd||{};d.choiceAdd[g]=d.choiceAdd[g]||{};d.choiceAdd[g][lk]=d.choiceAdd[g][lk]||{label:lbl,ings:[]};d.choiceAdd[g][lk].ings.push({ing:'',qtyS:null,qtyM:null,qtyL:null});drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-carem]').forEach(function(b){b.onclick=function(){syncAll();var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix'));if(d.choiceAdd&&d.choiceAdd[g]&&d.choiceAdd[g][lk]&&d.choiceAdd[g][lk].ings)d.choiceAdd[g][lk].ings.splice(ix,1);drawRecipeEditor(item);};});
  ed.querySelectorAll('[data-cagrp]').forEach(function(cb){cb.onchange=function(){syncAll();var picked=[];ed.querySelectorAll('[data-cagrp]').forEach(function(x){if(x.checked)picked.push(x.getAttribute('data-cagrp'));});window.__posSettings=window.__posSettings||{};window.__posSettings.choiceAddGroups=picked;var a=A();a.update(a.ref(a.db,'posSettings'),{choiceAddGroups:picked}).catch(function(e){alert('Could not save the choice list: '+((e&&e.code)||e)+'. Log in with your admin email.');});drawRecipeEditor(item);};});
  ed.querySelectorAll('select[data-caf="ing"]').forEach(function(s){s.onchange=function(){syncAll();drawRecipeEditor(item);};});
  ed.querySelectorAll('input[data-caf]').forEach(function(inp){inp.oninput=function(){var tr=inp.closest('[data-carow]');if(!tr)return;var g=tr.getAttribute('data-ca-g'),lk=tr.getAttribute('data-ca-l');var rows=[];ed.querySelectorAll('[data-carow][data-ca-g="'+g+'"][data-ca-l="'+lk+'"]').forEach(function(r){var ing=(r.querySelector('[data-caf="ing"]')||{}).value||'';function v(f){var el=r.querySelector('[data-caf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}rows.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});});var lab=ed.querySelector('[data-cacost="'+g+'|'+lk+'"]');if(lab)lab.textContent='extra — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'));};});
  ed.querySelectorAll('[data-rcsel]').forEach(function(b){b.onclick=function(){syncAll();var gid=b.getAttribute('data-rcsel');var multi=b.getAttribute('data-rcmulti')==='1';var lb=b.getAttribute('data-rclabel');var sel=window.__recCostSel||{};if(multi){var arr=Array.isArray(sel[gid])?sel[gid].slice():[];var i=arr.indexOf(lb);if(i>-1)arr.splice(i,1);else arr.push(lb);sel[gid]=arr;}else{sel[gid]=(sel[gid]===lb)?null:lb;}window.__recCostSel=sel;drawRecipeEditor(item);};});
  var _nn=document.getElementById('recNoNeed'); if(_nn)_nn.onchange=function(){ markNoRecipe(item.key,this.checked); };
  document.getElementById('recSave').onclick=function(){ try{ syncAll(); saveRecipe(item.key); }catch(err){ alert('Recipe save hit an error: '+(err&&err.message?err.message:err)+'. Nothing was saved — tell support this message.'); } };
  document.getElementById('recClose').onclick=function(){ recipeEditing=false; curRecipeKey=null; renderRecipes(); };
  if(document.getElementById('recDel'))document.getElementById('recDel').onclick=function(){ if(!confirm('Delete this recipe? '+esc(item.name)+' will no longer deduct stock.'))return; var a=A();a.remove(a.ref(a.db,'recipes/'+item.key));recipeEditing=false;curRecipeKey=null;setTimeout(renderRecipes,200);};
}
function exportCostSheet(){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  function r4(n){return Math.round((Number(n)||0)*10000)/10000;}
  var aoa=[['Category','Item','Line','Type','Unit','S qty','S cost','M qty','M cost','L qty','L cost']];
  menuList().forEach(function(it){
    var rec=recipesMap[it.key]; if(!rec)return;
    var cat=it.cat||''; var catL=(A().getCatLabel?A().getCatLabel(cat):cat)||cat;
    var totS=0,totM=0,totL=0;
    (rec.base||[]).forEach(function(b){ if(!b.ing)return; var inv=inventoryMap[b.ing]||{}; var uc=Number(inv.cost)||0;
      var qs=baseQtyForSize(rec,b,'S'),qm=baseQtyForSize(rec,b,'M'),ql=baseQtyForSize(rec,b,'L');
      var cs=qs*uc,cm=qm*uc,cl=ql*uc; totS+=cs;totM+=cm;totL+=cl;
      var du=b.unit||inv.unit||''; var ds=(b.dispS!=null?b.dispS:qs),dm=(b.dispM!=null?b.dispM:qm),dl=(b.dispL!=null?b.dispL:ql);
      aoa.push([catL,it.name,inv.name||b.ing,'base',du,ds||'',r4(cs),dm||'',r4(cm),dl||'',r4(cl)]);
    });
    aoa.push(['',it.name,'COST PER DRINK','','','',r4(totS),'',r4(totM),'',r4(totL)]);
    aoa.push([]);
  });
  if(aoa.length<=1){alert('No recipes yet to build a cost sheet.');return;}
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'CostSheet');XLSX.writeFile(wb,'accaza-cost-sheet-'+window.AccazaDate.key()+'.xlsx');
}
function saveRecipe(key){
  var d=recipeDraft; if(!d){alert('Nothing to save — reopen the recipe and try again.');return;}
  var raw=recipeDraftRaw(d),local=Costing().normalizeRecipe(raw,inventoryMap);
  if(!local.ok){alert('Recipe was not saved. Fix these costing errors:\n\n'+costingIssues(local.errors));return;}
  var saved=recipesMap[key];if(saved&&saved.options)raw.options=saved.options;
  var a=A();if(!a.validateRecipeDefinition){alert('The 3B recipe validator is not available. Refresh the portal. Nothing was saved.');return;}
  a.validateRecipeDefinition(raw).then(function(res){var data=res&&res.data?res.data:res;var rec=data&&data.recipe;if(!rec)throw new Error('The server did not return a normalized recipe.');return a.set(a.ref(a.db,'recipes/'+key),rec).then(function(){return data;});}).then(function(data){recipeEditing=false;var note=(data.warnings&&data.warnings.length)?'\n\nWarnings:\n'+costingIssues(data.warnings):'';alert('Recipe saved for '+(A().menuItemsMap[key]?A().menuItemsMap[key].name:key)+'.\nCosting engine '+(data.engineVersion||Costing().VERSION)+'.'+note);curRecipeKey=key;setTimeout(function(){renderRecipes();},150);}).catch(function(e){var details=e&&e.details&&e.details.errors;alert('Could not save the recipe: '+((e&&e.message)||(e&&e.code)||e)+(details?'\n\n'+costingIssues(details):'')+'\n\nNothing was saved.');});
}
function optKey(label){return String(label).replace(/[.#$\[\]\/]/g,'_');}
function allOptionLabels(){
  var seen={},out=[];
  menuList().forEach(function(it){ (optLabelsForItem(it)||[]).forEach(function(o){ if(o.label&&!seen[o.label]){seen[o.label]=1;out.push(o);} }); });
  return out.sort(function(a,b){return (a.label||'').localeCompare(b.label||'');});
}
function ocClone(o){try{return JSON.parse(JSON.stringify(o||{}));}catch(e){return {};}}
function ocGroups(){var m=(A()&&A().optionGroupsMap)||{};return Object.keys(m).map(function(id){return Object.assign({id:id},m[id]);}).sort(function(a,b){return (a.order||0)-(b.order||0);});}
function ocChoiceCost(ings,size){var c=0;(ings||[]).forEach(function(r){if(!r||!r.ing)return;var q=r['qty'+size];if(q==null||q==='')q=0;c+=(Number(q)||0)*ingCost(r.ing);});return c;}
function renderOptionsMaster(){ window.__optCostDraft=ocClone(optCostStore()); ocDraw(); }
function ocSync(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var next={};
  root.querySelectorAll('[data-oc-row]').forEach(function(tr){
    var g=tr.getAttribute('data-oc-g'), lk=tr.getAttribute('data-oc-l'), lbl=tr.getAttribute('data-oc-label')||'';
    var ing=(tr.querySelector('[data-ocf="ing"]')||{}).value||'';
    if(!ing)return;
    function v(f){var el=tr.querySelector('[data-ocf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;}
    next[g]=next[g]||{}; next[g][lk]=next[g][lk]||{label:lbl,ings:[]};
    next[g][lk].ings.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')});
  });
  window.__optCostDraft=next;
}
function ocDraw(){
  var root=document.getElementById('optMasterRoot'); if(!root)return;
  var d=window.__optCostDraft||{};
  var invList=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function ingSel(val){return '<select class="pz-in" data-ocf="ing" style="min-width:150px;"><option value="">— ingredient —</option>'+invList.map(function(i){return '<option value="'+i.id+'"'+(i.id===val?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+'</option>';}).join('')+'</select>';}
  var cards=ocGroups().map(function(g){
    var badge=(g.required?'required':'optional')+' · '+(g.type==='multi'?'multi-select':'single');
    var choices=(g.choices||[]).map(function(c){
      var lk=optKey(c.label); var rows=(d[g.id]&&d[g.id][lk]&&d[g.id][lk].ings)||[];
      var ingRows=rows.map(function(r,ix){
        return '<tr data-oc-row data-oc-g="'+esc(g.id)+'" data-oc-l="'+esc(lk)+'" data-oc-label="'+esc(c.label)+'" data-oc-ix="'+ix+'">'
          +'<td>'+ingSel(r.ing)+'</td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyS" value="'+(r.qtyS!=null&&r.qtyS!==''?r.qtyS:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyM" value="'+(r.qtyM!=null&&r.qtyM!==''?r.qtyM:'')+'" placeholder="0"/></td>'
          +'<td><input class="pz-in" type="number" step="any" style="width:64px;" data-ocf="qtyL" value="'+(r.qtyL!=null&&r.qtyL!==''?r.qtyL:'')+'" placeholder="0"/></td>'
          +'<td><button class="pz-btn warn" data-ocrem data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-ix="'+ix+'" style="padding:0.15rem 0.45rem;">✕</button></td></tr>';
      }).join('');
      var priceTag=(c.price?'<span style="color:#8a5a00;">+'+peso(c.price)+' price</span>':'<span style="color:var(--tl);">free</span>');
      return '<div style="border-top:1px solid var(--cd);padding:0.5rem 0;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;"><b>'+esc(c.label)+'</b> <span style="font-size:0.72rem;">'+priceTag+'</span>'
        +'<span data-occost="'+esc(g.id)+'|'+esc(lk)+'" style="font-size:0.72rem;color:var(--tl);">cost/serving — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L'))+'</span></div>'
        +(ingRows?'<table class="pz-tbl" style="margin:0.35rem 0;"><thead><tr><th>Ingredient</th><th>S</th><th>M</th><th>L</th><th></th></tr></thead><tbody>'+ingRows+'</tbody></table>':'')
        +'<button class="pz-btn sec" data-ocadd data-g="'+esc(g.id)+'" data-l="'+esc(lk)+'" data-label="'+esc(c.label)+'" style="padding:0.2rem 0.6rem;font-size:0.78rem;">+ ingredient</button>'
        +'</div>';
    }).join('');
    return '<div class="pz-card" style="margin-bottom:0.9rem;"><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">'+esc(g.name)+'</div><span style="font-size:0.7rem;color:var(--tl);">'+badge+'</span></div>'+choices+'</div>';
  }).join('');
  root.innerHTML='<p class="pz-sub">Cost each customer choice by its ingredients, per size (S/M/L). A choice can pull several ingredients — e.g. <b>Hot</b> → hot cup + lid + extra coffee. Keep the base recipe to what every selection shares; put the choice-specific items here. Cost + stock deduct when that choice is picked. Add-ons with no rows here fall back to the legacy per-name cost.</p>'
    +cards
    +'<div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.3rem;"><button class="pz-btn ok" id="optCostSaveAll">💾 Save option costs</button><span id="optCostSaveMsg" style="font-size:0.78rem;color:var(--tl);"></span></div>';
  root.querySelectorAll('[data-ocadd]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),lbl=b.getAttribute('data-label'); d[g]=d[g]||{}; d[g][lk]=d[g][lk]||{label:lbl,ings:[]}; d[g][lk].ings.push({ing:'',qtyS:null,qtyM:null,qtyL:null}); ocDraw(); };});
  root.querySelectorAll('[data-ocrem]').forEach(function(b){b.onclick=function(){ ocSync(); var d=window.__optCostDraft; var g=b.getAttribute('data-g'),lk=b.getAttribute('data-l'),ix=Number(b.getAttribute('data-ix')); if(d[g]&&d[g][lk]&&d[g][lk].ings){d[g][lk].ings.splice(ix,1);} ocDraw(); };});
  root.querySelectorAll('select[data-ocf="ing"]').forEach(function(s){s.onchange=function(){ ocSync(); ocDraw(); };});
  root.querySelectorAll('input[data-ocf]').forEach(function(inp){inp.oninput=function(){ var tr=inp.closest('[data-oc-row]'); if(!tr)return; var g=tr.getAttribute('data-oc-g'),lk=tr.getAttribute('data-oc-l'); var rows=[]; root.querySelectorAll('[data-oc-row][data-oc-g="'+g+'"][data-oc-l="'+lk+'"]').forEach(function(r){ var ing=(r.querySelector('[data-ocf="ing"]')||{}).value||''; function v(f){var el=r.querySelector('[data-ocf="'+f+'"]');return (el&&el.value!=='')?(Number(el.value)||0):null;} rows.push({ing:ing,qtyS:v('qtyS'),qtyM:v('qtyM'),qtyL:v('qtyL')}); }); var lab=root.querySelector('[data-occost="'+g+'|'+lk+'"]'); if(lab)lab.textContent='cost/serving — S '+peso(ocChoiceCost(rows,'S'))+' · M '+peso(ocChoiceCost(rows,'M'))+' · L '+peso(ocChoiceCost(rows,'L')); };});
  var saveBtn=document.getElementById('optCostSaveAll'); if(saveBtn)saveBtn.onclick=function(){ ocSync(); var d=window.__optCostDraft||{}; var clean={};
    Object.keys(d).forEach(function(g){ var gc={}; Object.keys(d[g]).forEach(function(lk){ var e=d[g][lk]; var kept=(e.ings||[]).filter(function(r){return r&&r.ing&&(r.qtyS!=null||r.qtyM!=null||r.qtyL!=null);}); if(kept.length)gc[lk]={label:e.label||lk,ings:kept}; }); if(Object.keys(gc).length)clean[g]=gc; });
    var a=A(); a.update(a.ref(a.db,'posSettings'),{optionCosts:clean}).then(function(){ var m=document.getElementById('optCostSaveMsg'); if(m)m.textContent='✓ Saved '+new Date().toLocaleTimeString(); }).catch(function(e){ alert('Could not save option costs: '+((e&&e.code)||e)+'. If PERMISSION_DENIED, log in with your admin email and publish the DB rules.'); });
  };
}
function renderConsumables(){
  var root=document.getElementById('consumRoot'); if(!root)return;
  var cats=(A().getCats?A().getCats():[]).map(function(c){return c.id;});
  if(!cats.length){var catSet={};menuList().forEach(function(it){if(it.cat)catSet[it.cat]=1;});cats=Object.keys(catSet).sort();}
  var ctMap=(window.__posSettings&&window.__posSettings.catType)||{};
  var catRows=cats.length?cats.map(function(nm){var t=ctMap[nm]||'';var label=(A().getCatLabel?A().getCatLabel(nm):nm);
    return '<tr><td>'+esc(label)+'</td><td><select class="pz-in" data-cattype="'+esc(nm)+'"><option value=""'+(t===''?' selected':'')+'>— untagged —</option><option'+(t==='drink'?' selected':'')+'>drink</option><option'+(t==='food'?' selected':'')+'>food</option></select></td></tr>';
  }).join(''):'<tr><td colspan="2" style="color:var(--tl);padding:0.6rem;">No categories found.</td></tr>';
  var cons=ingsByType('consumable');
  var cRows=cons.length?cons.map(function(i){return '<tr><td>'+esc(i.name)+'</td><td>'+esc(i.serves||'both')+'</td><td>'+esc(i.size||'all')+'</td><td>'+num(i.qtyPerOrder||1)+' '+esc(i.unit||'')+'</td><td>'+(i.cost?peso(i.cost):'—')+'</td><td style="font-weight:600;">'+peso((Number(i.qtyPerOrder)||1)*(Number(i.cost)||0))+'</td></tr>';}).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No consumables yet — add them in the Inventory tab with Type = Consumable.</td></tr>';
  root.innerHTML=
    '<p class="pz-sub">Tag each category Drink or Food; items in it then auto-consume the matching consumables per order. Cups are size-aware (set a cup’s size = S/M/L); stirrers, sleeves, tissue stay size-independent. Extra water cups = an inventory Adjustment (variance), not a sale.</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Category types (drink / food)</div><table class="pz-tbl"><thead><tr><th>Category</th><th>Type</th></tr></thead><tbody>'+catRows+'</tbody></table></div>'
    +'<div class="pz-card"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Consumable items</div><table class="pz-tbl"><thead><tr><th>Item</th><th>Serves</th><th>Size</th><th>Per order</th><th>Cost</th><th>Cost/order</th></tr></thead><tbody>'+cRows+'</tbody></table><p class="pz-sub" style="margin-top:0.5rem;">Add or edit these in the Inventory tab (Type = Consumable). A drink order pulls its size-cup + all non-size drink/both consumables; food pulls food/both consumables (no stirrer).</p></div>';
  root.querySelectorAll('[data-cattype]').forEach(function(sel){sel.onchange=function(){
    var nm=sel.getAttribute('data-cattype'); var v=sel.value; var a=A();
    var cur=Object.assign({},(window.__posSettings&&window.__posSettings.catType)||{});
    if(v)cur[nm]=v; else delete cur[nm];
    a.update(a.ref(a.db,'posSettings'),{catType:cur});
  };});
}

/* ══════════ INTERNAL USAGE (Staff consumption + R&D) ══════════ */
function usageCost(usage){var c=0;Object.keys(usage||{}).forEach(function(ing){c+=usage[ing]*ingCost(ing);});return c;}
function usageMovements(usage,sign,type,sourceId,note){return Object.keys(usage||{}).map(function(ing){return {movementId:movementId(type,sourceId,ing),itemId:ing,type:type,qty:sign*(Number(usage[ing])||0),unitCost:ingCost(ing),sourceType:'internal-usage',sourceId:sourceId,note:note||'',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()};});}
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
  var rows=types.map(function(t){return '<tr><td><input class="pz-in" data-utname="'+esc(t.id)+'" value="'+esc(t.name)+'" style="min-width:150px;"/></td><td><input class="pz-in" data-utreasons="'+esc(t.id)+'" value="'+esc((t.reasons||[]).join(', '))+'" placeholder="comma-separated reasons" style="min-width:220px;"/></td><td><button class="pz-btn warn" data-utdel="'+esc(t.id)+'" style="padding:0.2rem 0.5rem;">✕</button></td></tr>';}).join('');
  return '<div class="pz-card" style="margin-bottom:0.8rem;background:#faf7f2;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.3rem;">Usage types</div><p class="pz-sub" style="margin-top:0;">Each type is its own P&amp;L line. The Reasons are that type’s dropdown options (comma-separated). Deleting a type keeps past records intact.</p><table class="pz-tbl"><thead><tr><th>Type name</th><th>Reasons</th><th></th></tr></thead><tbody>'+rows+'</tbody></table><div style="display:flex;gap:0.5rem;align-items:end;flex-wrap:wrap;margin-top:0.6rem;"><div><span class="pz-lbl">New type</span><input class="pz-in" id="utNewName" placeholder="e.g. Wastage" style="width:180px;"/></div><div style="flex:1;min-width:200px;"><span class="pz-lbl">Reasons (comma-separated)</span><input class="pz-in" id="utNewReasons" placeholder="e.g. Spoilage, Spillage, Expired"/></div><button class="pz-btn sec" id="utAdd">+ Add type</button><button class="pz-btn ok" id="utSave" style="margin-left:auto;">💾 Save types</button></div></div>';
}
function renderUsage(){
  var root=document.getElementById('usageRoot'); if(!root)return;
  var a0=A();
  if(a0&&!Object.keys(usageTypesMap).length){var seed={};DEFAULT_USAGE_TYPES.forEach(function(d){seed[d.id]={name:d.name,reasons:d.reasons,order:d.order};});a0.update(a0.ref(a0.db,'usageTypes'),seed).catch(function(){});}
  if(a0&&Object.keys(usageTypesMap).length&&!Object.keys(usageTypesMap).some(function(k){return (usageTypesMap[k]&&(usageTypesMap[k].name||'').toLowerCase()==='overhead');})){a0.update(a0.ref(a0.db,'usageTypes/ut_overhead'),{name:'Overhead',reasons:['supplies','cleaning','maintenance','office'],order:5}).catch(function(){});}
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
  var utAdd=document.getElementById('utAdd'); if(utAdd)utAdd.onclick=function(){var nm=((document.getElementById('utNewName')||{}).value||'').trim();if(!nm){alert('Type a name for the new usage type.');return;}var rs=((document.getElementById('utNewReasons')||{}).value||'').split(',').map(function(x){return x.trim();}).filter(Boolean);var a=A();a.set(a.ref(a.db,'usageTypes/'+uid('ut_')),{name:nm,reasons:rs,order:usageTypesList().length+1}).then(function(){}).catch(function(e){alert('Could not add: '+((e&&e.code)||e));});};
  var utSave=document.getElementById('utSave'); if(utSave)utSave.onclick=function(){var a=A();var ups={};root.querySelectorAll('[data-utname]').forEach(function(i){var id=i.getAttribute('data-utname');var nm=(i.value||'').trim();var rsEl=root.querySelector('[data-utreasons="'+id+'"]');var rs=((rsEl&&rsEl.value)||'').split(',').map(function(x){return x.trim();}).filter(Boolean);if(nm)ups[id]={name:nm,reasons:rs,order:(usageTypesMap[id]&&usageTypesMap[id].order)||0};});a.update(a.ref(a.db,'usageTypes'),ups).then(function(){alert('Usage types saved.');}).catch(function(e){alert('Could not save: '+((e&&e.code)||e));});};
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
  var movementType=kind==='rnd'?'rnd_testing':(kind==='waste'?'waste':'staff_use');
  var movementIds=usageMovements(usage,-1,movementType,id,label);
  postMovements(movementIds).then(function(){return a.set(a.ref(a.db,'internalUsage/'+id),{kind:kind,kindName:usageTypeName(kind),category:category,itemKey:itemKey,size:size,qty:qty,addonLines:addonLines,recipeName:recipeName,sections:sections,adhoc:!!usageAdhoc,label:label,recipient:recipient,reason:reason,note:note,recordingAccount:acct,ts:Date.now(),usage:usage,cost:cost,movementIds:movementIds.map(function(x){return x.movementId;}),reversed:false});}).then(function(){
  if(window.__posLog)window.__posLog('usage:'+kind,label,peso(cost));
  window.__usagePendingId=''; usageRows={menuaddon:[],base:[],addon:[],cons:[]}; usageRecipeName=''; renderUsage();
  alert('Recorded. Stock deducted; '+peso(cost)+' logged to '+usageTypeName(kind)+'.');
  }).catch(function(e){alert('Internal usage FAILED — stock was not changed: '+((e&&e.message)||e));});
}
function reverseUsage(id){
  var u=usageMap[id]; if(!u||u.reversed)return;
  if(!confirm('Reverse this entry? Ingredients will be returned to stock.'))return;
  var rows=usageMovements(u.usage||{},+1,'usage_reversal',id,u.label||id);
  rows.forEach(function(row,ix){row.reversalOf=(u.movementIds&&u.movementIds[ix])||'';});
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
/* ══════════ POS REGISTER ══════════ */
function buildPOS(){
  var _t=performance.now();
  var root=document.getElementById('posRoot'); if(!root)return;
  var cats=A().getCats?A().getCats():[];
  var chips='<button type="button" class="pz-chip '+(posCat==='ALL'?'on':'')+'" data-cat="ALL">All</button>'+cats.map(function(c){return '<button type="button" class="pz-chip '+(posCat===c.id?'on':'')+'" data-cat="'+esc(c.id)+'">'+esc(c.icon||'')+' '+esc(c.label)+'</button>';}).join('');
  var incoming=onlineOrderRows().filter(function(o){return !o.shiftId&&o.status!=='Rejected';}).length;
  var activeCount=shiftOrderRows().length;
  root.innerHTML='<div class="pos-channel-switch" role="tablist" aria-label="POS sales channels"><button type="button" class="pz-btn '+(posView==='counter'?'ok':'sec')+'" data-pos-view="counter" role="tab" aria-selected="'+(posView==='counter')+'">🏪 In-store</button><button type="button" class="pz-btn '+(posView==='online'?'ok':'sec')+'" data-pos-view="online" role="tab" aria-selected="'+(posView==='online')+'">🌐 Online Orders <span id="posOnlineCount" class="pos-online-count"'+(incoming?'':' hidden')+'>'+incoming+'</span></button><button type="button" class="pz-btn '+(posView==='active'?'ok':'sec')+'" data-pos-view="active" role="tab" aria-selected="'+(posView==='active')+'">🧾 Shift Orders <span id="posActiveCount" class="pos-active-count"'+(activeCount?'':' hidden')+'>'+activeCount+'</span></button></div>'
    +(posView==='online'?'<div id="posOnlineOrdersPanel"></div>':posView==='active'?'<div id="posActiveOrdersPanel"></div>':(
    '<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Counter service</div><p class="pz-sub" style="margin:.2rem 0 0;">Find an item, check the ticket, then take payment.</p></div></div>'
    +'<div class="pz-posgrid" style="display:grid;grid-template-columns:1.7fr 1fr;gap:1rem;align-items:start;">'
      +'<div class="pos-menu-deck"><label class="pos-menu-search"><span>Find an item</span><input class="pz-in" id="posMenuSearch" type="search" autocomplete="off" placeholder="Search coffee, pastry, package…" value="'+esc(posSearch)+'"/></label><div id="posChips" class="pos-category-rail">'+chips+'</div><div id="posItems" class="pos-item-grid"></div></div>'
      +'<div class="pz-card" id="posCartPanel" style="position:sticky;top:1rem;"></div>'
    +'</div>'));
  root.querySelectorAll('[data-pos-view]').forEach(function(button){button.onclick=function(){posView=button.getAttribute('data-pos-view');buildPOS();};});
  if(posView==='online'){renderOnlineOrders();posBuilt=true;return;}
  if(posView==='active'){renderActiveOrders();posBuilt=true;return;}
  root.querySelectorAll('[data-cat]').forEach(function(ch){ch.onclick=function(){posCat=ch.getAttribute('data-cat');buildPOS();};});
  var search=document.getElementById('posMenuSearch');if(search){search.oninput=function(){posSearch=this.value||'';drawPosItems();};}
  drawPosItems(); renderPosCart(); posBuilt=true;telemetry().metric('pos_build',performance.now()-_t,true);
}
function onlineOrderRows(){return Object.keys(onlineOrdersMap).map(function(id){return Object.assign({id:id},onlineOrdersMap[id]||{});}).filter(function(o){return o.source==='online'||o.channel==='online';}).filter(function(o){return o.status!=='Received'&&!o.voided;}).sort(function(a,b){return(Number(b.timestamp)||0)-(Number(a.timestamp)||0);});}
function updateOnlineOrderCount(){var badge=document.getElementById('posOnlineCount');if(!badge)return;var count=onlineOrderRows().filter(function(o){return !o.shiftId&&o.status!=='Rejected';}).length;badge.textContent=count;badge.hidden=!count;}
function shiftOrderRows(){var shift=window.__posShift||null;return Object.keys(onlineOrdersMap).map(function(id){return Object.assign({id:id},onlineOrdersMap[id]||{});}).filter(function(o){return o.shiftId&&shift&&o.shiftId===shift.id;}).sort(function(a,b){return(Number(b.timestamp)||0)-(Number(a.timestamp)||0);});}
function activeOrderRows(){return shiftOrderRows().filter(function(o){return o.channel==='online'&&!o.voided&&['Pending','Confirmed','Preparing','Ready'].indexOf(o.status)>=0;}).sort(function(a,b){var rank={Ready:0,Preparing:1,Confirmed:2,Pending:3};return(rank[a.status]-rank[b.status])||((Number(a.timestamp)||0)-(Number(b.timestamp)||0));});}
function updateActiveOrderCount(){var badge=document.getElementById('posActiveCount');if(!badge)return;var count=shiftOrderRows().length;badge.textContent=count;badge.hidden=!count;}
function updatePosOrderCounts(){updateOnlineOrderCount();updateActiveOrderCount();}
function activeChannelLabel(o){return o.channel==='online'?'Online':o.channel==='grabfood'?'GrabFood':o.channel==='foodpanda'?'FoodPanda':'In-store';}
function paymentVerificationSignature(payments,total){
  var cart=Object.keys(posCart).sort().map(function(k){var c=posCart[k]||{};return[k,Number(c.qty)||0,Number(c.unitTotal)||0];});
  var direct=directPaymentRows(payments).map(function(p){return[String(p.method||''),Math.round((Number(p.amount)||0)*100)/100,String(p.ref||'').trim()];});
  return JSON.stringify({cart:cart,total:Math.round((Number(total)||0)*100)/100,direct:direct});
}
function cashierVerificationGate(payments,total,context){
  var direct=directPaymentRows(payments),existing=direct.map(function(p){return p.ref||'';}).filter(Boolean).join(', ');
  if(!direct.length)return Promise.resolve({required:false});
  return F().run({title:'Cashier payment verification',subtitle:context+' · '+peso(total)+' · '+direct.map(function(p){return p.method;}).join(' + '),submitLabel:'Verify payment',busyLabel:'Recording verification…',fields:[{name:'reference',label:'Transaction reference',value:existing,required:true,maxLength:120,placeholder:'Enter the successful transaction reference',help:'Match this against the actual read-only GCash, Maya, or bank transaction history.'},{name:'confirmed',label:'I found this successful payment in the actual receiving account',type:'checkbox',required:true,help:'A customer screenshot by itself is not sufficient.'}]},function(v){if(direct.length===1)direct[0].ref=v.reference;return{required:true,reference:v.reference};});
}
function verifyOnlinePayment(oid,button){
  var o=onlineOrdersMap[oid],a=A();if(!o){alert('Order not found. Refresh the POS and try again.');return;}if(o.paymentStatus!=='pending'){alert('This payment is no longer awaiting cashier verification.');return;}if(!a||!a.processOrderAdjustment){alert('Payment verification is unavailable. Refresh the POS and try again.');return;}
  if(paymentVerificationPolicy((o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total}])==='manager_only'){managerVerifyOnlinePayment(oid,button);return;}
  var payments=(o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total,ref:''}],old=button&&button.textContent;
  cashierVerificationGate(payments,Number(o.total)||0,'Online order #'+oid).then(function(v){if(button){button.disabled=true;button.textContent='Verifying…';}return a.processOrderAdjustment({action:'cashier_verify_payment',orderId:oid,reference:v.reference});}).then(function(){if(window.__posLog)window.__posLog('cashier-verify-payment',oid,peso(o.total)+' · '+(o.payment||''));(window.accazaToast||function(){})('Payment verified · order confirmed','ok');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Payment confirmation failed: '+((e&&e.message)||e));}).finally(function(){if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});
}
function managerVerifyOnlinePayment(oid,button){var o=onlineOrdersMap[oid],a=A(),old=button&&button.textContent;if(!o||o.paymentStatus!=='pending'){alert('This payment is no longer awaiting manager verification.');return;}if(!a||!a.processOrderAdjustment||!a.managerApproval){alert('Manager verification is unavailable. Refresh the POS and try again.');return;}if(button){button.disabled=true;button.textContent='Approving…';}a.managerApproval('validate_payment',oid,Number(o.total)||0,'Manager-only payment verification').then(function(ap){return a.processOrderAdjustment({action:'manager_validate_payment',orderId:oid,approvalId:ap.approvalId});}).then(function(){if(window.__posLog)window.__posLog('manager-validate-payment',oid,peso(o.total));(window.accazaToast||function(){})('Payment manager validated · order confirmed','ok');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Manager verification failed: '+((e&&e.message)||e));}).finally(function(){if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});}
function posLegacyItemLines(text){var out=[],buf='',depth=0;String(text||'').split('').forEach(function(ch){if(ch==='(')depth++;if(ch===')'&&depth>0)depth--;if(ch===','&&depth===0){if(buf.trim())out.push(buf.trim());buf='';}else buf+=ch;});if(buf.trim())out.push(buf.trim());return out;}
function posOrderItemsHtml(o){
  var isOnline=(o.source==='online'||o.channel==='online');function sizeTag(li){if(!li.size)return '';var n=String(li.name||'').toLowerCase(),sz=String(li.size).toLowerCase();if(n.indexOf('('+sz+')')>=0)return '';if(!isOnline)return '';return ' <em>('+esc(li.size)+')</em>';}
  var lines=Array.isArray(o.lineItems)&&o.lineItems.length?o.lineItems.map(function(li){return{name:li.name||li.itemKey||'Item',size:li.size||'',options:Array.isArray(li.optLabels)?li.optLabels:[],qty:Math.max(1,Number(li.qty)||1)};}):posLegacyItemLines(o.items).map(function(text){var qm=text.match(/\s+x(\d+)\s*$/i);return{name:qm?text.slice(0,qm.index).trim():text,size:'',options:[],qty:qm?Math.max(1,Number(qm[1])||1):1};});
  if(!lines.length)return '<div class="pos-order-items-empty">No item details recorded</div>';
  return '<div class="pos-order-items" aria-label="Order items"><div class="pos-order-items-heading"><span>🛒 Order items</span><b>'+lines.length+' line'+(lines.length===1?'':'s')+'</b></div><ul>'+lines.map(function(li){return '<li><span class="pos-order-item-qty">'+esc(li.qty)+'×</span><span class="pos-order-item-detail"><strong>'+esc(li.name)+sizeTag(li)+'</strong>'+(li.options.length?'<small>'+li.options.map(esc).join(' · ')+'</small>':'')+'</span></li>';}).join('')+'</ul></div>';
}
function renderActiveOrders(){
  var root=document.getElementById('posActiveOrdersPanel');if(!root)return;var rows=shiftOrderRows(),shift=window.__posShift||null,needs=activeOrderRows(),completed=rows.filter(function(o){return !o.voided&&['Completed','Received'].indexOf(o.status)>=0;}),exceptions=rows.filter(function(o){return o.voided||o.status==='Rejected';}),stages=['Confirmed','Preparing','Ready'],salesTotal=completed.reduce(function(sum,o){return sum+(Number(o.total)||0)-(Number(o.refundAmount)||0);},0);
  function actionCard(o){var stage=o.status==='Pending'?'Confirmed':o.status,idx=stages.indexOf(stage),next=o.status==='Pending'?'Confirmed':o.status==='Confirmed'?'Preparing':o.status==='Preparing'?'Ready':o.status==='Ready'?'Completed':'',channel=activeChannelLabel(o);
    var rail='<div class="pos-stage-rail" aria-label="Order progress">'+stages.map(function(s,i){return '<span class="'+(i<idx?'done':i===idx?'now':'')+'">'+(i<idx?'✓ ':i===idx?'● ':'')+s+'</span>';}).join('')+'</div>';
    var action=next?'<button class="pz-btn ok pos-active-primary" data-active-status="'+esc(o.id)+'" data-next="'+next+'">'+(next==='Confirmed'?'Confirm order':next==='Preparing'?'Start preparing':next==='Ready'?'Mark ready':'Complete order')+'</button>':'';
    return '<article class="pos-active-card channel-'+esc(o.channel||'instore')+'"><div class="pos-active-head"><div><span class="pos-channel-tag">'+esc(channel)+'</span><b>#'+esc(o.id)+'</b><small>'+esc(o.name||o.staff||'Walk-in customer')+'</small></div><strong>'+peso(o.total)+'</strong></div>'+rail+posOrderItemsHtml(o)+'<div class="pos-active-foot"><span>'+esc(o.type||'Counter')+' · '+esc(o.payment||'Payment recorded')+'</span>'+action+'</div></article>';}
  function completedCard(o){var channel=activeChannelLabel(o);return '<article class="pos-shift-sale channel-'+esc(o.channel||'instore')+'"><div class="pos-shift-sale-head"><div><span class="pos-channel-tag">'+esc(channel)+'</span><b>#'+esc(o.id)+'</b><small>'+esc(o.name||o.staff||'Walk-in customer')+'</small></div><div><strong>'+peso((Number(o.total)||0)-(Number(o.refundAmount)||0))+'</strong><span>✓ '+esc(o.status)+'</span></div></div>'+posOrderItemsHtml(o)+'<div class="pos-active-foot"><span>'+esc(o.payment||'Payment recorded')+(Number(o.refundAmount)>0?' · Refunded '+peso(o.refundAmount):'')+'</span></div></article>';}
  function exceptionCard(o){return '<article class="pos-shift-exception"><div><b>#'+esc(o.id)+'</b><span>'+esc(activeChannelLabel(o))+' · '+esc(o.voided?'Voided':o.status)+'</span></div><strong>'+peso(o.total)+'</strong></article>';}
  root.innerHTML='<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Shift Orders</div><p class="pz-sub" style="margin:.2rem 0 0;">Every order assigned to the current shift, with online work separated from completed sales.</p></div><span class="pos-online-shift '+(shift?'open':'closed')+'">'+(shift?'Shift open · '+esc(shift.staff||'Cashier'):'No open shift')+'</span></div>'+(shift?'<div class="pos-shift-summary"><div><span>Orders in shift</span><b>'+rows.length+'</b></div><div><span>Needs action</span><b>'+needs.length+'</b></div><div><span>Completed sales</span><b>'+completed.length+'</b></div><div class="total"><span>Sales total</span><b>'+peso(salesTotal)+'</b></div></div>':'')+(needs.length?'<div class="az-sec pos-needs-title">Online orders needing action ('+needs.length+')</div><div class="pos-active-grid">'+needs.map(actionCard).join('')+'</div>':'<div class="pos-shift-clear">✓ No online orders need action</div>')+(completed.length?'<div class="az-sec pos-completed-title">Completed sales this shift ('+completed.length+')</div><div class="pos-shift-sales-grid">'+completed.map(completedCard).join('')+'</div>':(shift?'<div class="pos-menu-empty"><b>No completed sales yet</b><span>In-store, online, GrabFood, and FoodPanda sales will remain here until the shift closes.</span></div>':''))+(exceptions.length?'<div class="az-sec pos-exception-title">Not included in sales ('+exceptions.length+')</div><div class="pos-shift-exceptions">'+exceptions.map(exceptionCard).join('')+'</div>':'');
  root.querySelectorAll('[data-active-status]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-active-status'),next=b.getAttribute('data-next'),o=onlineOrdersMap[id]||{};b.disabled=true;b.textContent='Updating…';A().updateOrderStatus({orderId:id,status:next,expectedStatus:o.status||'',requestId:'pos_active_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).then(function(){(window.accazaToast||function(){})('Order moved to '+next,'ok');}).catch(function(e){alert('Could not update order: '+((e&&e.message)||e));b.disabled=false;renderActiveOrders();});};});
}
function onlineStatusAction(o){if(!o.shiftId)return'';var next=o.status==='Confirmed'?'Preparing':o.status==='Preparing'?'Ready':o.status==='Ready'?'Completed':'';if(!next)return'';return '<button class="pz-btn ok" data-online-status="'+esc(o.id)+'" data-next="'+next+'">'+(next==='Preparing'?'Start preparing':next==='Ready'?'Mark ready':'Complete order')+'</button>';}
function renderOnlineOrders(){
  var root=document.getElementById('posOnlineOrdersPanel');if(!root)return;var rows=onlineOrderRows(),shift=window.__posShift||null;
  var active=rows.filter(function(o){return o.shiftId&&shift&&o.shiftId===shift.id;}),incoming=rows.filter(function(o){return !o.shiftId;});
  function card(o){var verified=['cashier_verified','manager_validated','confirmed'].indexOf(o.paymentStatus)>=0,captured=!!o.shiftId,proof=o.proofPath?'<button class="pz-btn sec" data-online-proof="'+esc(o.id)+'">View payment proof</button>':'',action='';
    if(o.status==='Rejected')action='<span class="pos-online-state rejected">Rejected</span>';
    else if(!verified){var managerOnly=paymentVerificationPolicy((o.payments&&o.payments.length)?o.payments:[{method:o.payment,amount:o.total}])==='manager_only';action='<button class="pz-btn ok" data-online-verify="'+esc(o.id)+'">'+(managerOnly?'Manager verify':'Cashier verify')+'</button><button class="pz-btn warn" data-online-reject="'+esc(o.id)+'">Reject</button>';}
    else if(!captured)action='<button class="pz-btn ok" data-online-accept="'+esc(o.id)+'"'+(shift?'':' disabled')+'>'+(shift?'Accept into shift':'Open a shift first')+'</button><button class="pz-btn warn" data-online-reject="'+esc(o.id)+'">Reject</button>';
    else action='<span class="pos-online-state captured">'+(o.paymentStatus==='cashier_verified'?'Cashier verified · manager review pending':'Payment validated')+' · '+esc(o.status)+'</span>'+onlineStatusAction(o);
    return '<article class="pos-online-card"><div class="pos-online-card-head"><div><b>'+esc(o.name||'Customer')+'</b><span>#'+esc(o.id)+'</span></div><strong>'+peso(o.total)+'</strong></div><div class="pos-online-meta">'+esc(o.type||'Pick-up')+' · '+esc(o.payment||'Online payment')+' · '+esc(o.time||'')+'</div>'+posOrderItemsHtml(o)+(o.address?'<div class="pos-online-meta">📍 '+esc(o.address)+'</div>':'')+'<div class="pos-online-actions">'+proof+action+'</div></article>';}
  root.innerHTML='<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">Online Orders</div><p class="pz-sub" style="margin:.2rem 0 0;">Verify payment, accept into the open shift, then move the order through preparation.</p></div><span class="pos-online-shift '+(shift?'open':'closed')+'">'+(shift?'Shift open · '+esc(shift.staff||'Cashier'):'No open shift')+'</span></div>'
    +(incoming.length?'<div class="az-sec">Incoming ('+incoming.length+')</div><div class="pos-online-grid">'+incoming.map(card).join('')+'</div>':'<div class="pos-menu-empty"><b>No incoming online orders</b><span>New website orders will appear here automatically.</span></div>')
    +(active.length?'<div class="az-sec" style="margin-top:1rem;">Captured in this shift ('+active.length+')</div><div class="pos-online-grid">'+active.map(card).join('')+'</div>':'');
  root.querySelectorAll('[data-online-proof]').forEach(function(b){b.onclick=function(){if(window.showStoredProof)window.showStoredProof(b.getAttribute('data-online-proof'),b);};});
  root.querySelectorAll('[data-online-verify]').forEach(function(b){b.onclick=function(){verifyOnlinePayment(b.getAttribute('data-online-verify'),b);};});
  root.querySelectorAll('[data-online-accept]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-accept');b.disabled=true;b.textContent='Accepting…';A().acceptOnlineOrder({orderId:id}).then(function(){(window.accazaToast||function(){})('Online order captured in POS','ok');}).catch(function(e){alert('Could not accept order: '+((e&&e.message)||e));b.disabled=false;b.textContent='Accept into shift';});};});
  root.querySelectorAll('[data-online-reject]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-reject'),o=onlineOrdersMap[id]||{};if(!confirm('Reject online order '+id+'?'))return;A().updateOrderStatus({orderId:id,status:'Rejected',expectedStatus:o.status||'Pending',requestId:'online_reject_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).catch(function(e){alert('Could not reject order: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-online-status]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-online-status'),next=b.getAttribute('data-next'),o=onlineOrdersMap[id]||{};b.disabled=true;A().updateOrderStatus({orderId:id,status:next,expectedStatus:o.status||'',requestId:'online_status_'+Date.now()+'_'+Math.random().toString(36).slice(2)}).catch(function(e){alert('Could not update order: '+((e&&e.message)||e));b.disabled=false;});};});
}
window.__openPosOnlineOrders=function(){posView='online';var button=document.getElementById('tabBtnPos');if(button)button.click();else buildPOS();};
function drawPosItems(){
  var wrap=document.getElementById('posItems'); if(!wrap)return;
  var q=String(posSearch||'').trim().toLowerCase();
  var items=menuList().filter(function(it){return (posCat==='ALL'||it.cat===posCat)&&(!q||String(it.name||'').toLowerCase().indexOf(q)>-1);});
  if(!items.length){wrap.innerHTML='<div class="pos-menu-empty"><b>No matching items</b><span>Try another name or choose All.</span></div>';return;}
  var plat=posIsPlatform();
  var tileBg=posChannel==='grabfood'?'#e8f5ec':posChannel==='foodpanda'?'#fde8e8':'';
  var tileBd=posChannel==='grabfood'?'#b8dfc4':posChannel==='foodpanda'?'#f5c6c6':'';
  var st=tileBg?(' style="background:'+tileBg+';border-color:'+tileBd+';"'):'';
  wrap.innerHTML=items.map(function(it){
    var pr;
    if(plat){ var s=channelPriceOf(posChannel,it.key,'S'),m=channelPriceOf(posChannel,it.key,'M'),l=channelPriceOf(posChannel,it.key,'L'); pr=(it.priceM||it.priceL)?('S '+(s||'–')+' · M '+(m||'–')+' · L '+(l||'–')):(s?('₱'+s):'no price'); }
    else { pr=it.priceM?('S '+it.priceS+' · M '+it.priceM+' · L '+it.priceL):('₱'+(it.priceS||0)); }
    var cat=(A().getCatLabel?A().getCatLabel(it.cat):'')||it.cat||'Menu';
    if(!posIsAvail(it.name)){ return '<button class="pz-item" disabled style="opacity:0.45;cursor:not-allowed;'+(tileBg?'background:'+tileBg+';border-color:'+tileBd+';':'')+'"><span class="pos-item-cat">'+esc(cat)+'</span><div class="n">'+esc(it.name)+'</div><div class="p" style="color:#c0392b;">Unavailable</div></button>'; }
    return '<button class="pz-item"'+st+' data-item="'+esc(it.key)+'"><span class="pos-item-cat">'+esc(cat)+'</span><div class="n">'+esc(it.name)+'</div><div class="p">'+esc(pr)+'</div><span class="pos-item-add" aria-hidden="true">＋</span></button>';}).join('');
  wrap.querySelectorAll('[data-item]').forEach(function(b){b.onclick=function(){openPosItem(b.getAttribute('data-item'));};});
}
// ---- item customize modal ----
var mSel={};
function openPosItem(key){
  var _raw=A().menuItemsMap[key]; if(!_raw)return;
  var item=Object.assign({key:key},_raw);
  if(!posIsAvail(item.name)){alert(item.name+' is marked unavailable — it can’t be sold. Toggle it back on in Availability first.');return;}
  var body=document.getElementById('pzItemBody'); var titleEl=document.getElementById('pzItemTitle');
  titleEl.textContent=item.name;
  var plat=posIsPlatform();
  mSel={item:Object.assign({key:key},item), size:null, price:posBasePrice(item,'S'), opts:{}, qty:1};
  var html='';
  if(plat)html+='<div style="font-size:0.72rem;color:var(--tl);margin-bottom:0.4rem;">'+esc(channelLabel(posChannel))+' pricing — item &amp; add-on prices from Channel Pricing.</div>';
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if(hasAB){ html+=sizeBlock([['S',item.labelS||'Option 1',posBasePrice(item,'S')],['L',item.labelL||'Option 2',posBasePrice(item,'L')]]); }
  else if(hasM){ html+=sizeBlock([['S','Small',posBasePrice(item,'S')],['M','Medium',posBasePrice(item,'M')],['L','Large',posBasePrice(item,'L')]]); }
  else { mSel.size='S'; mSel.price=posBasePrice(item,'S'); }
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  groups.forEach(function(g){
    html+='<div style="margin-top:0.8rem;"><span class="pz-lbl">'+esc(g.name)+(g.type!=='multi'&&g.required!==false?' (required)':'')+'</span>';
    html+=(g.choices||[]).map(function(c,ci){var pp=optChoicePrice(g.id,c.label,c.price);return '<div class="pz-opt" data-g="'+esc(g.id)+'" data-multi="'+(g.type==='multi'?1:0)+'" data-label="'+esc(c.label)+'" data-price="'+pp+'"><span>'+esc(c.label)+'</span><span>'+(pp>0?'+₱'+pp:'Free')+'</span></div>';}).join('');
    html+='</div>';
  });
  html+='<div style="margin-top:0.9rem;display:flex;align-items:center;gap:0.8rem;"><span class="pz-lbl" style="margin:0;">Qty</span><button class="pz-btn sec" id="pzQtyM" style="padding:0.2rem 0.7rem;">−</button><span id="pzQtyN" style="font-weight:600;">1</span><button class="pz-btn sec" id="pzQtyP" style="padding:0.2rem 0.7rem;">+</button></div>';
  body.innerHTML=html;
  body.querySelectorAll('.pz-opt').forEach(function(o){o.onclick=function(){toggleOpt(o);};});
  document.getElementById('pzQtyM').onclick=function(){mSel.qty=Math.max(1,mSel.qty-1);document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  document.getElementById('pzQtyP').onclick=function(){mSel.qty++;document.getElementById('pzQtyN').textContent=mSel.qty;updatePzTotal();};
  updatePzTotal();
  var _pzm=document.getElementById('pzItemMask'); _pzm.classList.remove('ch-grabfood','ch-foodpanda'); if(posChannel==='grabfood')_pzm.classList.add('ch-grabfood'); else if(posChannel==='foodpanda')_pzm.classList.add('ch-foodpanda'); _pzm.classList.add('show');
}
function sizeBlock(arr){ return '<div><span class="pz-lbl">Serving size (required)</span>'+arr.map(function(a){return '<div class="pz-opt" data-size="'+a[0]+'" data-price="'+a[2]+'"><span>'+esc(a[1])+'</span><span>₱'+a[2]+'</span></div>';}).join('')+'</div>'; }
function toggleOpt(el){
  if(el.hasAttribute('data-size')){ document.querySelectorAll('#pzItemBody .pz-opt[data-size]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.size=el.getAttribute('data-size'); mSel.price=Number(el.getAttribute('data-price'))||0; updatePzTotal(); return; }
  var g=el.getAttribute('data-g'), multi=el.getAttribute('data-multi')==='1', label=el.getAttribute('data-label'), price=Number(el.getAttribute('data-price'))||0;
  mSel.opts[g]=mSel.opts[g]||[];
  if(multi){ var ix=mSel.opts[g].findIndex(function(x){return x.label===label;}); if(ix>-1){mSel.opts[g].splice(ix,1);el.classList.remove('on');} else {mSel.opts[g].push({label:label,price:price});el.classList.add('on');} }
  else { document.querySelectorAll('#pzItemBody .pz-opt[data-g="'+g+'"]').forEach(function(o){o.classList.remove('on');}); el.classList.add('on'); mSel.opts[g]=[{label:label,price:price}]; }
  updatePzTotal();
}
function pzUnit(){ var t=mSel.price||0; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){t+=c.price||0;});}); return t; }
function updatePzTotal(){ document.getElementById('pzItemTotal').textContent=peso(pzUnit()*mSel.qty); }
function pzAddToCart(){
  var item=mSel.item; var plat=posIsPlatform();
  var hasM=item.priceM&&item.priceL, hasAB=item.labelS&&item.labelL&&item.priceL;
  if((hasM||hasAB)&&!mSel.size){alert('Please select a size.');return;}
  if(plat&&!(posBasePrice(item,mSel.size||'S')>0)){alert('No '+channelLabel(posChannel)+' price set for this item/size — set it in Channel Pricing first.');return;}
  var groups=(A().getItemOptionGroups?A().getItemOptionGroups(item):[]);
  for(var i=0;i<groups.length;i++){var g=groups[i];if(g.type!=='multi'&&g.required!==false&&!(mSel.opts[g.id]&&mSel.opts[g.id].length)){alert('Please select: '+g.name);return;}}
  var optLabels=[],details=[]; Object.keys(mSel.opts).forEach(function(g){(mSel.opts[g]||[]).forEach(function(c){optLabels.push(c.label);details.push(c.label);});});
  var key=uid('pc_');
  posCart[key]={itemKey:item.key,name:item.name+(mSel.size&&(hasM||hasAB)?' ('+mSel.size+')':''),size:mSel.size||'S',optLabels:optLabels,details:details.join(', '),qty:mSel.qty,unitTotal:pzUnit()};
  document.getElementById('pzItemMask').classList.remove('show');
  renderPosCart();
}
/* ---------- cash denomination tracking (checkout) ---------- */
var POS_DENOMS=[
  {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
  {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
];
function denomTrackingOn(){return !!(window.__posSettings&&window.__posSettings.denomTracking);}
function shiftDrawer(){var sh=window.__posShift;return (sh&&sh.drawer)?Object.assign({},sh.drawer):{};}
function posRcvRead(){var counts={},total=0;document.querySelectorAll('[data-prd]').forEach(function(inp){var q=Number(inp.value)||0;if(q>0){counts[inp.getAttribute('data-prd')]=q;total+=q*(Number(inp.getAttribute('data-prv'))||0);}});return {counts:counts,total:Math.round(total*100)/100};}
function mergeDenoms(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)+(Number(b[k])||0);});return o;}
function posKeepTip(change){var k=document.getElementById('posKeep');if(!k||!k.checked)return 0;change=Math.round((Number(change)||0)*100)/100;var amt=Number((document.getElementById('posKeepAmt')||{}).value);if(!(amt>0))amt=change;return Math.min(Math.max(0,Math.round(amt*100)/100),change);}
function makeChange(amount,avail){var rem=Math.round(amount*100);var give={};POS_DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
function changeStr(denoms){var m={};POS_DENOMS.forEach(function(d){m[d.k]=d.lbl;});return Object.keys(denoms||{}).map(function(k){return denoms[k]+'×'+m[k];}).join(', ')||'—';}
function changeRows(denoms){return POS_DENOMS.filter(function(d){return denoms&&denoms[d.k];}).map(function(d){return '<div style="color:#155724;">'+denoms[d.k]+' × '+d.lbl+'</div>';}).join('');}
function posDenomPadHtml(){
  return '<span class="pz-lbl">Cash received — enter note/coin counts</span>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:0.3rem;margin-top:0.3rem;">'
    +POS_DENOMS.map(function(d){return '<label style="font-size:0.68rem;color:var(--tm);display:flex;flex-direction:column;gap:0.1rem;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-prd="'+d.k+'" data-prv="'+d.v+'" placeholder="0" style="padding:0.2rem 0.3rem;"/></label>';}).join('')
    +'</div><div id="posDenomInfo" style="font-size:0.8rem;font-weight:600;margin-top:0.45rem;"></div>';
}
/* ---------- scoped line-item discounts (Feature A) ---------- */
function lineCat(key){var c=posCart[key];if(!c)return '';var it=(A().menuItemsMap||{})[c.itemKey];return it?catType(it.cat):'';}
function discountedUnits(key){return posScopedDisc.filter(function(d){return d.key===key;}).length;}
function scopedDiscTotal(){return posScopedDisc.reduce(function(s,d){return s+(Number(d.value)||0);},0);}
function idSlotUsed(idNum,cat){return posScopedDisc.some(function(d){return d.type!=='promo5'&&d.idNumber===idNum&&d.cat===cat;});}
function applyScoped(key,type,idNum,name){
  var c=posCart[key]; if(!c){return false;}
  var cat=lineCat(key);
  if(discountedUnits(key)>=c.qty){alert('Every unit of this line is already discounted (no stacking).');return false;}
  if(type==='promo5'){
    if(cat!=='drink'){alert('The 5% promo applies to a drink only.');return false;}
  } else {
    if(!idNum){alert('Enter the ID number for a Senior/PWD/Athlete discount.');return false;}
    if(cat!=='drink'&&cat!=='food'){alert('Tag this item’s category as drink or food first (Recipe → Consumables tab).');return false;}
    if(idSlotUsed(idNum,cat)){alert('ID '+idNum+' already used its '+cat+' discount (max 1 drink + 1 food per ID).');return false;}
  }
  var rate=(DISC_TYPES[type]||{}).rate||0;
  var value=Math.round(c.unitTotal*rate*100)/100;
  posScopedDisc.push({type:type,rate:rate,idNumber:idNum||'',holderName:name||'',key:key,itemKey:c.itemKey,name:c.name,size:c.size||'',cat:cat,unitPrice:c.unitTotal,value:value});
  return true;
}
function openDiscountModal(){
  if(!Object.keys(posCart).length){alert('Add items to the cart first.');return;}
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var type=(mask.querySelector('#dscType')||{}).value||'senior';
    var idNum=(mask.querySelector('#dscId')||{}).value||'';
    var nm=(mask.querySelector('#dscName')||{}).value||'';
    var isPromo=type==='promo5';
    var rows=Object.keys(posCart).map(function(k){var c=posCart[k];var cat=lineCat(k);var left=c.qty-discountedUnits(k);
      var eligible = left>0 && (isPromo?cat==='drink':(cat==='drink'||cat==='food'));
      return '<tr><td>'+esc(c.name)+(c.size?' ('+esc(c.size)+')':'')+'<div style="font-size:0.7rem;color:var(--tl);">'+(cat||'untagged')+' · '+peso(c.unitTotal)+'/unit · '+left+' of '+c.qty+' left</div></td><td style="text-align:right;">'+(eligible?'<button class="pz-btn ok" data-dscapply="'+k+'" style="padding:0.2rem 0.55rem;">Discount 1</button>':'<span style="font-size:0.72rem;color:var(--tl);">—</span>')+'</td></tr>';
    }).join('');
    var applied=posScopedDisc.length?posScopedDisc.map(function(d,ix){return '<tr><td>'+esc((DISC_TYPES[d.type]||{}).label||d.type)+' · '+esc(d.name)+(d.idNumber?' · ID '+esc(d.idNumber):'')+'</td><td style="text-align:right;">−'+peso(d.value)+' <button class="pz-btn warn" data-dscrm="'+ix+'" style="padding:0.1rem 0.4rem;">✕</button></td></tr>';}).join(''):'<tr><td colspan="2" style="color:var(--tl);padding:0.4rem;">None applied yet.</td></tr>';
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Scoped discount</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Statutory Senior/PWD/Athlete = 20% on the eligible person’s own items (max 1 drink + 1 food per ID). 5% promo = 1 drink. No stacking on the same unit.</p>'
      +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;margin-bottom:0.6rem;"><div><span class="pz-lbl">Type</span><select class="pz-in" id="dscType">'+Object.keys(DISC_TYPES).map(function(t){return '<option value="'+t+'"'+(t===type?' selected':'')+'>'+esc(DISC_TYPES[t].label)+' ('+Math.round(DISC_TYPES[t].rate*100)+'%)</option>';}).join('')+'</select></div>'
      +(isPromo?'':'<div><span class="pz-lbl">ID number</span><input class="pz-in" id="dscId" value="'+esc(idNum)+'" placeholder="OSCA/PWD/athlete ID"/></div><div><span class="pz-lbl">Holder name</span><input class="pz-in" id="dscName" value="'+esc(nm)+'"/></div>')+'</div>'
      +'<table class="pz-tbl"><thead><tr><th>Cart item</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
      +'<div style="font-weight:600;color:var(--bd);margin-top:0.8rem;margin-bottom:0.3rem;">Applied</div><table class="pz-tbl"><tbody>'+applied+'</tbody></table>'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.8rem;"><span style="font-weight:700;">Total discount: '+peso(scopedDiscTotal())+'</span><button class="pz-btn ok" id="dscDone">Done</button></div>'
      +'</div>';
    var ts=mask.querySelector('#dscType'); if(ts)ts.onchange=draw;
    mask.querySelectorAll('[data-dscapply]').forEach(function(b){b.onclick=function(){ var liveId=((mask.querySelector('#dscId')||{}).value||'').trim(); var liveNm=((mask.querySelector('#dscName')||{}).value||'').trim(); if(applyScoped(b.getAttribute('data-dscapply'),type,liveId,liveNm))draw(); };});
    mask.querySelectorAll('[data-dscrm]').forEach(function(b){b.onclick=function(){posScopedDisc.splice(+b.getAttribute('data-dscrm'),1);draw();};});
    mask.querySelector('#dscDone').onclick=function(){document.body.removeChild(mask);renderPosCart();};
  }
  document.body.appendChild(mask); draw();
}
function renderPosCart(options){
  var p=document.getElementById('posCartPanel'); if(!p)return;
  var _rt=performance.now();if(!(options&&options.fresh))capturePosDraft(p);
  var shift=window.__posShift||null;
  var keys=Object.keys(posCart);
  posScopedDisc=posScopedDisc.filter(function(d){return posCart[d.key];});
  (function(){var seen={};posScopedDisc=posScopedDisc.filter(function(d){seen[d.key]=(seen[d.key]||0)+1;return seen[d.key]<=(Number(posCart[d.key].qty)||0);});})();
  var sub=keys.reduce(function(s,k){return s+posCart[k].qty*posCart[k].unitTotal;},0);
  var lines=keys.map(function(k){var c=posCart[k];return '<div style="display:flex;justify-content:space-between;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--cd);font-size:0.82rem;">'
      +'<div style="flex:1;"><b>'+esc(c.name)+'</b> ×'+c.qty+(c.details?'<div style="font-size:0.7rem;color:var(--tl);">'+esc(c.details)+'</div>':'')+'</div>'
      +'<div style="text-align:right;white-space:nowrap;">'+peso(c.qty*c.unitTotal)+'<br><button class="pz-btn warn" style="padding:0.1rem 0.4rem;font-size:0.7rem;" data-rm="'+k+'">remove</button></div></div>';}).join('');
  var shiftBar=shift
    ? '<div style="background:#e8f5ec;border:1px solid #b8dfc4;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.76rem;color:#155724;">🟢 Shift open · Cashier <b>'+esc(shift.staff)+'</b></div>'
    : '<div style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.76rem;color:#721c24;">🔴 No open shift — open one in <b>Register Ops</b> to start selling.</div>';
  var isPlat=posIsPlatform();
  var _ccfg=channelsCfg();
  var chanOpts=[{k:'instore',lbl:'🏪 In-store'}].concat(POS_CHANNELS.filter(function(d){return _ccfg[d.k].active!==false;}).map(function(d){return {k:d.k,lbl:(d.k==='grabfood'?'🟢 ':'🩷 ')+_ccfg[d.k].label};}));
  var chLabel=isPlat?channelLabel(posChannel):'';
  var grabDiscountRows='<div style="margin-top:0.55rem;padding:0.55rem;background:#f7f3ec;border:1px solid var(--cd);border-radius:7px;"><div class="pz-lbl" style="margin-bottom:0.35rem;">GrabFood discounts</div>'
    +[['posPlatDiscType1','posPlatDiscPct1','Delivery / Pickup','Percentage discount 1','%'],['posPlatDiscType2','posPlatDiscPct2','','Percentage discount 2','%'],['posPlatDiscType3','posPlatDiscAmt1','','Amount discount 1','₱'],['posPlatDiscType4','posPlatDiscAmt2','','Amount discount 2','₱']].map(function(r){return '<div style="display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:0.45rem;align-items:end;margin-top:0.35rem;"><label><span class="pz-lbl">Discount type</span><input class="pz-in" data-plat-discount id="'+r[0]+'" placeholder="'+r[3]+'" value="'+r[2]+'"/></label><label><span class="pz-lbl">Discount '+r[4]+'</span><input class="pz-in" data-plat-discount id="'+r[1]+'" type="number" min="0" step="any" placeholder="0" style="text-align:right;"/></label></div>';}).join('')
    +'<div style="font-size:0.7rem;color:var(--tl);margin-top:0.45rem;">The 25% commission is calculated after all GrabFood discounts.</div></div>';
  var chanSel='<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Channel</span><select class="pz-in" id="posChannelSel">'+chanOpts.map(function(o){return '<option value="'+o.k+'"'+(posChannel===o.k?' selected':'')+'>'+o.lbl+'</option>';}).join('')+'</select>'+(isPlat?'<div style="font-size:0.72rem;color:#8a5a00;background:#fff6e5;border:1px solid #f0dcae;border-radius:5px;padding:0.3rem 0.45rem;margin-top:0.25rem;">'+esc(chLabel)+' — platform prices apply, sale is a <b>receivable</b> (not cash drawer), commission trued up at weekly payout.</div>':'')+'</div>';
  p.innerHTML=
    chanSel
    +'<div style="margin-bottom:0.6rem;"><span class="pz-lbl">Customer\'s name</span><input class="pz-in" id="posCust" placeholder="Walk-in"/></div>'
    +(shift&&!isPlat?'<button class="pz-btn sec" id="posPkgBtn" style="width:100%;margin-bottom:0.6rem;">🎁 Add Package / Promo</button>':'')+'<div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">🛒 Current sale</div>'
    +(keys.length?lines:'<p class="pz-sub" style="margin:0.5rem 0;">Tap items to add them.</p>')
    +'<div style="margin-top:0.6rem;">'
      +'<div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:0.3rem;"><span>Subtotal</span><span>'+peso(sub)+'</span></div>'
      +(isPlat?'':'<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.82rem;margin-bottom:0.3rem;"><span>Discount ₱</span><input class="pz-in" id="posDisc" type="number" step="any" style="width:100px;text-align:right;" value="0"/></div>'
      +'<button class="pz-btn sec" id="posDiscBtn" style="width:100%;margin-bottom:0.4rem;font-size:0.8rem;">🧾 PWD / Senior / Athlete / Promo</button>'
      +(posScopedDisc.length?('<div style="font-size:0.76rem;margin-bottom:0.4rem;">'+posScopedDisc.map(function(d,ix){return '<div style="display:flex;justify-content:space-between;align-items:center;color:#155724;margin-bottom:0.15rem;"><span>'+esc((DISC_TYPES[d.type]||{}).label||d.type)+' · '+esc(d.name)+(d.idNumber?' ('+esc(d.idNumber)+')':'')+'</span><span style="white-space:nowrap;">−'+peso(d.value)+' <button class="pz-btn warn" data-sdrm="'+ix+'" style="padding:0 0.35rem;">✕</button></span></div>';}).join('')+'</div>'):'')
      +(posMeta.cashRounding?'<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--tl);margin-bottom:0.3rem;"><span>Cash rounding</span><span id="posRound">₱0.00</span></div>':''))
      +'<div style="display:flex;justify-content:space-between;font-weight:700;color:var(--bd);font-size:1rem;border-top:1px solid var(--cd);padding-top:0.4rem;"><span>'+(isPlat?'Gross':'Total')+'</span><span id="posTotal">'+peso(sub)+'</span></div>'
    +'</div>'
    +(isPlat
      ? '<div style="margin-top:0.7rem;border-top:1px solid var(--cd);padding-top:0.6rem;"><span class="pz-lbl">'+(posChannel==='grabfood'?'GrabFood order # (GF- is added automatically)':'FoodPanda order code (FP- is added automatically)')+'</span>'+(posChannel==='grabfood'?'<div style="display:flex;align-items:center;gap:0.3rem;"><span style="font-weight:700;color:var(--bd);">GF-</span><input class="pz-in" id="posPlatRef" placeholder="e.g. 123456" style="flex:1;"/></div>'+grabDiscountRows:'<div style="display:flex;align-items:center;gap:0.3rem;"><span style="font-weight:700;color:var(--bd);">FP-</span><input class="pz-in" id="posPlatRef" placeholder="e.g. o7km-49a7" style="flex:1;"/></div><div style="margin-top:0.5rem;"><span class="pz-lbl">Discount off (Delivery / Pickup) %</span><input class="pz-in" data-plat-discount id="posPlatDisc" type="number" min="0" step="any" placeholder="0" style="width:110px;text-align:right;"/></div>')+'<div id="posPlatCalc" style="font-size:0.82rem;margin-top:0.5rem;"></div></div>'
      : '<div style="margin-top:0.7rem;display:flex;justify-content:space-between;align-items:center;"><span class="pz-lbl" style="margin:0;">Payment</span><label style="font-size:0.74rem;color:var(--tl);cursor:pointer;"><input type="checkbox" id="posSplitChk"/> Split</label></div>'
        +'<div id="posPaySingle"><select class="pz-in" id="posPay" style="margin-top:0.3rem;">'+posActiveMethods().map(function(m){return '<option value="'+m.name+'">'+m.name+'</option>';}).join('')+'</select>'
          +'<div id="posCashWrap" style="margin-top:0.5rem;">'+(denomTrackingOn()?posDenomPadHtml():'<span class="pz-lbl">Cash tendered ₱</span><input class="pz-in" id="posTender" type="number" step="any" placeholder="0"/><div id="posChange" style="font-size:0.82rem;color:var(--bd);font-weight:600;margin-top:0.3rem;"></div>')+'</div>'
          +'<div id="posKeepWrap" style="display:none;margin-top:0.4rem;padding:0.4rem 0.55rem;background:#fff6e5;border:1px solid #f0dcae;border-radius:6px;"><label style="font-size:0.8rem;display:flex;align-items:center;gap:0.4rem;cursor:pointer;"><input type="checkbox" id="posKeep"/> Customer kept the change (tip / no small change)</label><div id="posKeepAmtWrap" style="display:none;margin-top:0.3rem;font-size:0.8rem;">Amount kept ₱ <input class="pz-in" id="posKeepAmt" type="number" step="any" style="width:90px;text-align:right;"/> <span style="color:var(--tl);">→ Other Income (Tips)</span></div></div>'
          +'<div id="posRefWrap" style="display:none;margin-top:0.5rem;"><span class="pz-lbl">Ref no. (GCash / bank) — required</span><input class="pz-in" id="posPayRef" placeholder="e.g. GCash ref / bank txn ref"/><div style="font-size:0.72rem;color:var(--tl);margin-top:0.2rem;">The cashier must find this payment in the actual receiving account before completing the sale.</div></div></div>'
        +'<div id="posPaySplit" style="display:none;margin-top:0.4rem;"><div id="posSplitRows"></div><button class="pz-btn sec" id="posAddPay" style="padding:0.25rem 0.6rem;">+ payment</button><div id="posSplitInfo" style="font-size:0.76rem;color:var(--tl);margin-top:0.3rem;"></div></div>')
    +'<div id="posVerifyState" style="display:none;margin-top:0.7rem;padding:0.45rem 0.6rem;border-radius:6px;font-size:0.76rem;"></div>'
    +'<button class="pz-btn ok" id="posCharge" style="width:100%;margin-top:0.8rem;padding:0.7rem;font-size:0.95rem;"'+((keys.length&&shift)?'':' disabled')+'>'+(isPlat?'Record '+esc(chLabel)+' sale':'Charge &amp; Complete')+'</button>'
    +'<div style="display:flex;gap:0.4rem;margin-top:0.4rem;">'
      +(isPlat?'':'<button class="pz-btn sec" id="posHold" style="flex:1;"'+(keys.length?'':' disabled')+'>Hold</button>')
      +'<button class="pz-btn sec" id="posClear" style="flex:1;"'+(keys.length?'':' disabled')+'>Clear</button>'
    +'</div>';
  restorePosDraft(p);telemetry().metric('cart_render',performance.now()-_rt,true);if(window.__refreshWorkspaceStatus)window.__refreshWorkspaceStatus();
  var _chsel=document.getElementById('posChannelSel'); if(_chsel)_chsel.onchange=function(){ var v=this.value; if(v===posChannel)return; if(Object.keys(posCart).length&&!confirm('Switching channel clears the current sale — prices differ between in-store and platform. Continue?')){ this.value=posChannel; return; } posChannel=v; posCart={}; window.__posPkgs=[]; posScopedDisc=[]; setTimeout(buildPOS,0); };
  p.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=function(){delete posCart[b.getAttribute('data-rm')];renderPosCart();};});
  var disc=document.getElementById('posDisc');
  var splitRows=[];
  var pay=null, splitChk=null;
  function grandTotal(){ var d=isPlat?0:((Number(disc&&disc.value)||0)+scopedDiscTotal()); var tot=Math.max(0,sub-d); if(!isPlat&&posMeta.cashRounding){var r=Math.round(tot); var pr=document.getElementById('posRound'); if(pr)pr.textContent=peso(r-tot); tot=r;} var tEl=document.getElementById('posTotal'); if(tEl)tEl.textContent=peso(tot); return tot; }
  function draftElectronicPayments(){
    if(isPlat)return[];
    var tot=grandTotal();
    if(splitChk&&splitChk.checked)return splitRows.filter(function(r){return !isCashMethod(r.method);}).map(function(r){return{method:r.method,amount:Number(r.amount)||0,ref:String(r.ref||'').trim()};});
    var method=pay?pay.value:'Cash';return isCashMethod(method)?[]:[{method:method,amount:tot,ref:String((document.getElementById('posPayRef')||{}).value||'').trim()}];
  }
  function refreshChargeAction(){
    var button=document.getElementById('posCharge'),state=document.getElementById('posVerifyState');if(!button)return;
    var direct=draftElectronicPayments(),policy=paymentVerificationPolicy(direct),signature=paymentVerificationSignature(direct,grandTotal()),verified=policy==='cashier_manager'&&direct.length&&posPaymentVerification&&posPaymentVerification.signature===signature;
    if(isPlat){button.textContent='Record '+chLabel+' sale';button.style.background='';}
    else if(direct.length&&policy==='manager_only'){button.textContent='Record Sale · Manager Verification Required';button.style.background='#8a6d1b';}
    else if(direct.length&&!verified){button.textContent='Cashier Verify Payment';button.style.background='#2f80ed';}
    else{button.textContent='Charge & Complete';button.style.background='';}
    if(state){if(verified){var refs=direct.map(function(r){return r.ref;}).filter(Boolean).join(', ');state.style.display='block';state.style.background='#e8f5ec';state.style.border='1px solid #b8dfc4';state.style.color='#155724';state.innerHTML='✓ Cashier verified'+(refs?' · Ref: '+esc(refs):'')+' · Complete the sale below.';}else{state.style.display='none';state.innerHTML='';}}
    button.disabled=posChargeBusy||!keys.length||!shift;
  }
  function invalidatePaymentVerification(){posPaymentVerification=null;refreshChargeAction();}
  function platformDiscountData(gross){
    function val(id){return Math.max(0,Number((document.getElementById(id)||{}).value)||0);}
    function typ(id,fallback){return String((document.getElementById(id)||{}).value||'').trim()||fallback;}
    if(posChannel!=='grabfood'){var pct=val('posPlatDisc'),amt=Math.round(gross*pct)/100;return {pct:pct,amount:amt,lines:pct?[{type:'Delivery / Pickup',mode:'percent',value:pct,amount:amt}]:[]};}
    var defs=[['posPlatDiscType1','posPlatDiscPct1','Percentage discount 1','percent'],['posPlatDiscType2','posPlatDiscPct2','Percentage discount 2','percent'],['posPlatDiscType3','posPlatDiscAmt1','Amount discount 1','amount'],['posPlatDiscType4','posPlatDiscAmt2','Amount discount 2','amount']];
    var lines=defs.map(function(d){var v=val(d[1]),amt=d[3]==='percent'?Math.round(gross*v)/100:Math.round(v*100)/100;return {type:typ(d[0],d[2]),mode:d[3],value:v,amount:amt};}).filter(function(d){return d.value>0;});
    return {pct:lines.filter(function(d){return d.mode==='percent';}).reduce(function(s,d){return s+d.value;},0),amount:Math.round(lines.reduce(function(s,d){return s+d.amount;},0)*100)/100,lines:lines};
  }
  function refreshPlat(){ var el=document.getElementById('posPlatCalc'); if(!el)return; function r2(n){return Math.round((Number(n)||0)*100)/100;}
    var gross=grandTotal(); var rate=channelRate(posChannel); var whtR=channelWht(posChannel); var vatR=channelVat(posChannel);
    var discounts=platformDiscountData(gross),dPct=discounts.pct,dAmt=discounts.amount;
    var commBase=(posChannel==='grabfood')?r2(gross-dAmt):gross;
    commBase=Math.max(0,commBase);var comm=r2(commBase*rate); var wht=r2(gross*whtR); var vat=r2(gross*vatR);
    var net=r2(gross-comm-dAmt-wht-vat);
    function ln(l,v,c){return '<div style="display:flex;justify-content:space-between;'+(c?'color:'+c+';':'')+'"><span>'+l+'</span><span>'+(v<0?'-'+peso(-v):peso(v))+'</span></div>';}
    el.innerHTML=ln('Gross',gross)
      +discounts.lines.map(function(d){return ln(esc(d.type)+' ('+(d.mode==='percent'?d.value+'%':'amount')+')',-d.amount,'#c0392b');}).join('')
      +ln('Commission ('+(Math.round(rate*1000)/10)+'%'+((posChannel==='grabfood'&&dAmt)?' after discounts':'')+')',-comm,'#c0392b')
      +(whtR?ln('Withholding tax ('+(Math.round(whtR*10000)/100)+'%)',-wht,'#c0392b'):'')
      +(vatR?ln('VAT on services ('+(Math.round(vatR*1000)/10)+'%)',-vat,'#c0392b'):'')
      +'<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--cd);padding-top:0.2rem;margin-top:0.2rem;"><span>Net receivable</span><span>'+peso(net)+'</span></div>'
      +'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.25rem;">'+((posChannel==='grabfood'&&dAmt)?'Commission is on gross less all discounts; WHT/VAT on gross. ':'All deducted from gross. ')+'Estimate — trued up at the weekly payout reconciliation.</div>';
  }
  if(isPlat){ var _plr=document.getElementById('posPlatRef'); if(_plr)_plr.oninput=refreshPlat; p.querySelectorAll('[data-plat-discount]').forEach(function(inp){inp.oninput=refreshPlat;}); refreshPlat(); }
  else {
  var curChange=0;
  function updateKeep(){ var w=document.getElementById('posKeepWrap'); if(!w)return; var isc=isCashMethod(pay?pay.value:'Cash'); var show=isc&&curChange>0.001; w.style.display=show?'block':'none'; var k=document.getElementById('posKeep'); var kw=document.getElementById('posKeepAmtWrap'); var amt=document.getElementById('posKeepAmt'); if(!show){ if(k)k.checked=false; if(kw)kw.style.display='none'; return; } if(amt){amt.max=curChange;amt.placeholder=String(curChange);} if(k&&k.checked){ if(kw)kw.style.display='block'; if(amt&&!amt.value)amt.value=curChange; } }
  function refreshSingle(){ var tot=grandTotal(); var tender=document.getElementById('posTender'); var t=Number(tender&&tender.value)||0; curChange=t?Math.max(0,Math.round((t-tot)*100)/100):0; var ch=document.getElementById('posChange'); if(ch)ch.textContent=t?('Change: '+peso(curChange)):''; updateKeep(); }
  pay=document.getElementById('posPay');
  pay.onchange=function(){var isc=isCashMethod(pay.value);document.getElementById('posCashWrap').style.display=isc?'block':'none';var rw=document.getElementById('posRefWrap');if(rw)rw.style.display=isc?'none':'block';updateKeep();invalidatePaymentVerification();};
  pay.onchange();
  var tender0=document.getElementById('posTender'); if(tender0)tender0.oninput=refreshSingle;
  var pk=document.getElementById('posKeep'); if(pk)pk.onchange=function(){var kw=document.getElementById('posKeepAmtWrap'); if(kw)kw.style.display=this.checked?'block':'none'; var amt=document.getElementById('posKeepAmt'); if(this.checked&&amt&&!amt.value)amt.value=curChange;};
  function refreshDenom(){ var tot=grandTotal(); var r=posRcvRead(); var el=document.getElementById('posDenomInfo'); if(!el)return;
    function ln(l,v,bold){return '<div style="display:flex;justify-content:space-between;'+(bold?'font-weight:700;':'')+'"><span>'+l+'</span><span>'+v+'</span></div>';}
    if(r.total<tot-0.001){ el.innerHTML=ln('Amount tendered',peso(r.total))+'<div style="color:var(--tl);margin-top:0.15rem;">'+peso(tot-r.total)+' more needed for the '+peso(tot)+' sale.</div>'; window.__posChange=null; curChange=0; updateKeep(); return; }
    var change=Math.round((r.total-tot)*100)/100; curChange=change; updateKeep();
    var html=ln('Amount tendered',peso(r.total)); var balanced=true;
    if(change<=0.001){ html+=ln('Change','—'); window.__posChange={amount:0,denoms:{},short:0}; }
    else{
      var mc=makeChange(change, mergeDenoms(shiftDrawer(), r.counts));
      html+='<div style="margin-top:0.15rem;">Change:</div>'
        +POS_DENOMS.filter(function(d){return mc.denoms[d.k];}).map(function(d){return '<div style="display:flex;justify-content:space-between;padding-left:0.9rem;"><span>'+mc.denoms[d.k]+' × '+d.lbl+'</span><span>'+peso(mc.denoms[d.k]*d.v)+'</span></div>';}).join('')
        +ln('Change total',peso(change-mc.short));
      window.__posChange={amount:change,denoms:mc.denoms,short:mc.short};
      if(!mc.ok){ balanced=false; html+='<div style="color:#c0392b;font-weight:600;margin-top:0.15rem;">⚠ No exact change — short '+peso(mc.short)+'. Ask for the exact amount &amp; edit the counts.</div>'; }
    }
    html+='<div style="border-top:1px solid var(--cd);margin-top:0.3rem;padding-top:0.2rem;">'+ln('Current sale',peso(tot),true)+'</div>'
      +'<div style="text-align:right;font-size:0.75rem;font-weight:600;margin-top:0.15rem;color:'+(balanced?'#155724':'#c0392b')+';">'+(balanced?'✓ balanced':'⚠ not balanced')+'</div>';
    el.innerHTML=html;
  }
  if(denomTrackingOn()){ document.querySelectorAll('[data-prd]').forEach(function(inp){inp.oninput=refreshDenom;}); refreshDenom(); }
  splitChk=document.getElementById('posSplitChk');
  function renderSplit(){
    var tot=grandTotal(); if(!splitRows.length)splitRows=[{method:'Cash',amount:tot}];
    var cont=document.getElementById('posSplitRows');
    cont.innerHTML=splitRows.map(function(r,i){var opts=posActiveMethods().map(function(m){return '<option'+(r.method===m.name?' selected':'')+'>'+m.name+'</option>';}).join('');var row='<div style="display:flex;gap:0.3rem;margin-bottom:0.3rem;"><select class="pz-in" data-pm="'+i+'" style="flex:1;">'+opts+'</select><input class="pz-in" data-pa="'+i+'" type="number" step="any" style="width:100px;" value="'+r.amount+'"/>'+(splitRows.length>1?'<button class="pz-btn warn" data-pd="'+i+'" style="padding:0.2rem 0.45rem;">✕</button>':'')+'</div>';
      if(!isCashMethod(r.method)){row+='<input class="pz-in" data-pr="'+i+'" placeholder="Ref no. for '+r.method+' — required" value="'+(r.ref||'')+'" style="margin-bottom:0.5rem;font-size:0.78rem;"/>';}
      else if(denomTrackingOn()){row+='<div style="margin:0 0 0.5rem 0;padding:0.35rem 0.45rem;background:#f7f3ec;border-radius:6px;"><div style="font-size:0.7rem;color:var(--tl);margin-bottom:0.2rem;">Cash received for this portion — enter notes/coins</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:0.25rem;">'+POS_DENOMS.map(function(d){return '<label style="font-size:0.6rem;color:var(--tm);display:flex;flex-direction:column;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-sdrow="'+i+'" data-sdk="'+d.k+'" data-sdv="'+d.v+'" placeholder="0" style="padding:0.08rem 0.2rem;"/></label>';}).join('')+'</div><div data-sdinfo="'+i+'" style="font-size:0.72rem;font-weight:600;margin-top:0.2rem;"></div></div>';}
      return row;}).join('');
    var assigned=splitRows.reduce(function(s,r){return s+(Number(r.amount)||0);},0);
    document.getElementById('posSplitInfo').innerHTML='Assigned '+peso(assigned)+' / Total '+peso(tot)+' · '+(Math.abs(assigned-tot)<0.01?'<span style="color:#2a9d5c;">balanced</span>':'<span style="color:#e63946;">off by '+peso(tot-assigned)+'</span>');
    function sdRecalc(i){var received=0;cont.querySelectorAll('[data-sdrow="'+i+'"]').forEach(function(inp){received+=(Number(inp.value)||0)*(Number(inp.getAttribute('data-sdv'))||0);});received=Math.round(received*100)/100;var amt=Number(splitRows[i].amount)||0;var info=cont.querySelector('[data-sdinfo="'+i+'"]');if(!info)return;if(received<amt-0.001){info.innerHTML='<span style="color:#c0392b;">Received '+peso(received)+' · short '+peso(amt-received)+'</span>';}else{info.innerHTML='Received '+peso(received)+' · change '+peso(Math.round((received-amt)*100)/100);}}
    cont.querySelectorAll('[data-pm]').forEach(function(s){s.onchange=function(){splitRows[+s.getAttribute('data-pm')].method=s.value;posPaymentVerification=null;renderSplit();refreshChargeAction();};});
    cont.querySelectorAll('[data-pa]').forEach(function(inp){inp.oninput=function(){splitRows[+inp.getAttribute('data-pa')].amount=Number(inp.value)||0;posPaymentVerification=null;renderSplit();refreshChargeAction();};});
    cont.querySelectorAll('[data-pr]').forEach(function(inp){inp.oninput=function(){splitRows[+inp.getAttribute('data-pr')].ref=inp.value;invalidatePaymentVerification();};});
    cont.querySelectorAll('[data-sdrow]').forEach(function(inp){inp.oninput=function(){sdRecalc(+inp.getAttribute('data-sdrow'));};});
    cont.querySelectorAll('[data-pd]').forEach(function(b){b.onclick=function(){splitRows.splice(+b.getAttribute('data-pd'),1);posPaymentVerification=null;renderSplit();refreshChargeAction();};});
  }
  if(disc)disc.oninput=function(){ posPaymentVerification=null;if(splitChk.checked)renderSplit(); else refreshSingle();refreshChargeAction(); };
  splitChk.onchange=function(){ posPaymentVerification=null;document.getElementById('posPaySingle').style.display=this.checked?'none':'block'; document.getElementById('posPaySplit').style.display=this.checked?'block':'none'; if(this.checked){splitRows=[];renderSplit();} else refreshSingle();refreshChargeAction(); };
  document.getElementById('posAddPay').onclick=function(){posPaymentVerification=null;splitRows.push({method:'GCash',amount:0});renderSplit();refreshChargeAction();};
  refreshSingle();
  var payRef=document.getElementById('posPayRef');if(payRef)payRef.oninput=invalidatePaymentVerification;
  }
  refreshChargeAction();
  updateOfflineUI();
  var _sb=document.getElementById('posShiftBar'); if(_sb)_sb.innerHTML=shiftBar;
  var _db=document.getElementById('posDiscBtn'); if(_db)_db.onclick=openDiscountModal;
  p.querySelectorAll('[data-sdrm]').forEach(function(b){b.onclick=function(){posScopedDisc.splice(+b.getAttribute('data-sdrm'),1);renderPosCart();};});
  var _pb=document.getElementById('posPkgBtn');if(_pb)_pb.onclick=function(){ if(window.__openPackagePicker)window.__openPackagePicker(); else alert('Packages module still loading \u2014 try again.'); };
  document.getElementById('posClear').onclick=function(){if(Object.keys(posCart).length&&confirm('Clear this sale?')){posCart={};posDraft={};posPaymentVerification=null;window.__posPkgs=[];posScopedDisc=[];renderPosCart({fresh:true});}};
  var _hold=document.getElementById('posHold'); if(_hold)_hold.onclick=function(){ if(!Object.keys(posCart).length)return; var a=A(); a.set(a.ref(a.db,'heldOrders/'+uid('hold_')),{cart:posCart,ts:Date.now(),staff:(window.__posShift&&window.__posShift.staff)||'—',note:(document.getElementById('posCust').value||'').trim()}); posCart={};posDraft={};posPaymentVerification=null;window.__posPkgs=[]; renderPosCart({fresh:true}); alert('Order held. Recall it from Register Ops.'); };
  document.getElementById('posCharge').onclick=async function(){
    var chargeButton=this;if(posChargeBusy)return;posChargeBusy=true;chargeButton.disabled=true;chargeButton.textContent='Processing…';
    try{return await (async function(){
    if(!window.__posShift){alert('Open a shift first (Register Ops tab).');return;}
    var tot=grandTotal();
    if(isPlat){
      if(tot<=0){alert('Add items to the sale first.');return;}
      var pref=(document.getElementById('posPlatRef').value||'').trim();
      if(!pref){alert(chLabel+' order # is required — key in the platform order number.');return;}
      if(posChannel==='grabfood'&&!/^gf-/i.test(pref)){pref='GF-'+pref;}
      if(posChannel==='foodpanda'&&!/^fp-/i.test(pref)){pref='FP-'+pref;}
      var _r2=function(n){return Math.round((Number(n)||0)*100)/100;};
      var prate=channelRate(posChannel),pwhtR=channelWht(posChannel),pvatR=channelVat(posChannel);
      var pdiscounts=platformDiscountData(tot),pdPct=pdiscounts.pct,pdAmt=pdiscounts.amount;
      if(pdAmt>tot){alert('Total platform discounts cannot be greater than the gross sale.');return;}
      var pcommBase=(posChannel==='grabfood')?_r2(tot-pdAmt):tot;
      var pcomm=_r2(pcommBase*prate), pwht=_r2(tot*pwhtR), pvat=_r2(tot*pvatR);
      var pNetSales=_r2(tot-pdAmt); var pnet=_r2(tot-pcomm-pdAmt-pwht-pvat);
      await chargeSale(sub,pNetSales,null,{channel:posChannel,platformRef:pref,gross:tot,discountPct:pdPct,discountAmt:pdAmt,discountLines:pdiscounts.lines,netSales:pNetSales,commission:pcomm,commissionRate:prate,wht:pwht,whtRate:pwhtR,vat:pvat,vatRate:pvatR,net:pnet});
      return;
    }
    var d=Number(disc&&disc.value)||0,discountApproval=null;
    var payments;
    if(splitChk.checked){ var assigned=splitRows.reduce(function(s,r){return s+(Number(r.amount)||0);},0); if(Math.abs(assigned-tot)>0.01){alert('Split payments must add up to the total.');return;} if(splitRows.some(function(r){return !isCashMethod(r.method)&&!String(r.ref||'').trim();})){alert('Enter a reference number for every GCash/bank payment before charging.');return;}
      var _splitBad=false;
      payments=splitRows.map(function(r,i){
        if(isCashMethod(r.method)){ var amt=Number(r.amount)||0;
          if(denomTrackingOn()){ var rc={},rt=0; document.querySelectorAll('[data-sdrow="'+i+'"]').forEach(function(inp){var q=Number(inp.value)||0;if(q>0){rc[inp.getAttribute('data-sdk')]=(rc[inp.getAttribute('data-sdk')]||0)+q;rt+=q*(Number(inp.getAttribute('data-sdv'))||0);}}); rt=Math.round(rt*100)/100; if(rt<amt-0.001)_splitBad=true; var chg=Math.round((rt-amt)*100)/100; var mc=makeChange(chg, mergeDenoms(shiftDrawer(),rc)); return {method:r.method,amount:amt,tendered:rt,change:chg,ref:'',cashReceived:rc,cashChange:mc.denoms,changeShort:mc.ok?0:mc.short}; }
          return {method:r.method,amount:amt,tendered:0,change:0,ref:''};
        }
        return {method:r.method,amount:Number(r.amount)||0,ref:String(r.ref||'').trim()};
      });
      if(_splitBad){alert('The cash received for a cash portion is less than that portion — enter the notes/coins received.');return;}
    }
    else { var m=pay.value; var isc=isCashMethod(m);
      if(!isc){ var ref1=(document.getElementById('posPayRef').value||'').trim(); if(!ref1){alert('Enter the '+m+' reference number before charging.');return;} payments=[{method:m,amount:tot,tendered:0,change:0,ref:ref1}]; }
      else if(denomTrackingOn()){ var r=posRcvRead(); if(r.total<tot-0.001){alert('Cash received ('+peso(r.total)+') is less than the total ('+peso(tot)+').');return;} var chg=Math.round((r.total-tot)*100)/100; var tip=posKeepTip(chg); var giveChg=Math.round((chg-tip)*100)/100; var mc=makeChange(giveChg, mergeDenoms(shiftDrawer(),r.counts)); payments=[{method:m,amount:tot,tendered:r.total,change:giveChg,ref:'',cashReceived:r.counts,cashChange:mc.denoms,changeShort:mc.ok?0:mc.short,tipRounding:tip}]; }
      else { var tv=Number((document.getElementById('posTender')||{}).value)||0; if(tv&&tv<tot){alert('Cash tendered is less than the total.');return;} var chg2=tv?Math.max(0,Math.round((tv-tot)*100)/100):0; var tip2=posKeepTip(chg2); payments=[{method:m,amount:tot,tendered:tv,change:Math.round((chg2-tip2)*100)/100,ref:'',tipRounding:tip2}]; }
    }
    var verificationSignature=paymentVerificationSignature(payments,tot),direct=directPaymentRows(payments),verificationPolicy=paymentVerificationPolicy(payments),cashierVerification=null;
    if(direct.length&&verificationPolicy==='cashier_manager'&&(!posPaymentVerification||posPaymentVerification.signature!==verificationSignature)){
      try{cashierVerification=await cashierVerificationGate(payments,tot,'In-store sale');}catch(e){return;}
      posPaymentVerification={required:true,reference:cashierVerification.reference||'',signature:paymentVerificationSignature(payments,tot)};
      (window.accazaToast||function(){})('Payment verified · complete the sale when ready','ok');return;
    }
    cashierVerification=direct.length&&verificationPolicy==='cashier_manager'?posPaymentVerification:{required:false};
    if(d>0){var a0=A();if(!a0.managerApproval||!a0.consumeManagerApproval){alert('Privileged discount approval is unavailable. Refresh the portal.');return;}var discountSource='manual_discount_'+shift.id+'_'+Date.now();try{var dap=await a0.managerApproval('manual_discount',discountSource,d,'Approve manual POS discount');var dcr=await a0.consumeManagerApproval({action:'manual_discount',sourceId:discountSource,amount:d,operationKey:discountSource,approvalId:dap.approvalId}),dcd=(dcr&&dcr.data)||dcr||{};discountApproval={approvalId:dap.approvalId,approvedBy:dcd.approvedBy||'',approvedByUid:dcd.approvedByUid||'',approvedRole:dcd.approvedRole||'',sourceId:discountSource};}catch(e){if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Discount approval failed: '+((e&&e.message)||e));return;} }
    await chargeSale(sub,tot,payments,null,discountApproval,cashierVerification);
    })();}finally{posChargeBusy=false;if(document.body.contains(chargeButton))refreshChargeAction();}
  };
}
function chargeSale(sub,total,payments,platform,discountApproval,cashierVerification){
  var keys=Object.keys(posCart); if(!keys.length)return;
  var shift=window.__posShift; if(!shift){alert('Open a shift first.');return;}
  var isPlat=!!platform;
  var cust=(document.getElementById('posCust').value||'').trim()||'Walk-in';
  var _scoped=isPlat?[]:posScopedDisc.slice();
  var _discEl=document.getElementById('posDisc');
  var disc=isPlat?(Number(platform.discountAmt)||0):((Number(_discEl&&_discEl.value)||0)+_scoped.reduce(function(s,d){return s+(Number(d.value)||0);},0));
  var staff=shift.staff||'Staff';
  var txnId='pos_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
  var oid=_orderRefPrefix(isPlat,platform)+'-'+_shortRef();
  var lineItems=keys.map(function(k){var c=posCart[k];return {itemKey:c.itemKey,name:c.name,size:c.size,optLabels:c.optLabels,qty:c.qty,unitTotal:c.unitTotal,stream:c.stream||null,pkg:c.pkgId||null};});
  var _pkgs=isPlat?[]:(window.__posPkgs||[]);var _extra=_pkgs.reduce(function(s,pp){return s+(Number(pp.extraCost)||0);},0);
  var itemsStr=keys.map(function(k){var c=posCart[k];return c.name+(c.details?' ('+c.details+')':'')+' x'+c.qty;}).join(', ');
  if(isPlat){ payments=[{method:channelLabel(platform.channel),amount:total,tendered:0,change:0,ref:platform.platformRef}]; }
  var cash=(payments||[]).filter(function(x){return x.method==='Cash';});
  var tendered=cash.reduce(function(s,x){return s+(Number(x.tendered)||0);},0);
  var change=cash.reduce(function(s,x){return s+(Number(x.change)||0);},0);
  var tipTotal=(payments||[]).reduce(function(s,x){return s+(Number(x.tipRounding)||0);},0);
  var payLabel=isPlat?channelLabel(platform.channel):(payments.length>1?'Split':payments[0].method);
  var _pendingPay=(!isPlat)&&directPaymentRows(payments).length>0,_verificationPolicy=_pendingPay?paymentVerificationPolicy(payments):null;
  var now=new Date();
  var order={id:oid,clientTxnId:txnId,schemaVersion:2,syncState:'pending',name:cust,phone:'',type:(isPlat?channelLabel(platform.channel):'Walk-in'),address:'',payment:payLabel,payments:payments,contact:'',contactMethod:'',items:itemsStr,lineItems:lineItems,subtotal:sub,discount:disc,discountLines:_scoped,total:total,tendered:tendered,change:change,notes:'',status:'Completed',source:'pos',channel:(isPlat?platform.channel:'instore'),staff:staff,shiftId:shift.id,packages:_pkgs,extraCost:_extra,paymentStatus:(_pendingPay?(_verificationPolicy==='manager_only'?'pending':'cashier_verified'):'confirmed'),paymentVerificationPolicy:_verificationPolicy,cashierVerificationIntent:!!(_pendingPay&&_verificationPolicy==='cashier_manager'&&cashierVerification&&cashierVerification.required),receivedByCustomer:true,tipRounding:tipTotal,time:now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),date:now.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()};
  if(discountApproval){order.discountApprovalId=discountApproval.approvalId;order.discountApprovedBy=discountApproval.approvedBy;order.discountApprovedByUid=discountApproval.approvedByUid;order.discountApprovedRole=discountApproval.approvedRole;order.discountApprovalSource=discountApproval.sourceId;}
  if(isPlat){ order.platformRef=platform.platformRef; order.grossPlatform=platform.gross; order.platformDiscountPct=Number(platform.discountPct)||0; order.platformDiscount=Number(platform.discountAmt)||0; order.platformDiscountLines=platform.discountLines||[]; order.netSalesPlatform=Number(platform.netSales!=null?platform.netSales:total)||0; order.commission=platform.commission; order.commissionRate=platform.commissionRate; order.platformWht=Number(platform.wht)||0; order.platformWhtRate=Number(platform.whtRate)||0; order.platformVat=Number(platform.vat)||0; order.platformVatRate=Number(platform.vatRate)||0; order.netPlatform=platform.net; order.settlementStatus='unsettled'; order.payoutId=''; }
  var _cps=(payments||[]).filter(function(p){return p.cashReceived;});
  if(_cps.length){ var rcv={},chgD={},shrt=0; _cps.forEach(function(p){ rcv=mergeDenoms(rcv,p.cashReceived); chgD=mergeDenoms(chgD,p.cashChange||{}); shrt+=Number(p.changeShort)||0; });
    order.cashReceived=rcv; order.cashChange=chgD; order.changeShort=shrt;
    var _sh=window.__posShift;
    if(_sh){ var nd=mergeDenoms(shiftDrawer(), rcv); Object.keys(chgD).forEach(function(k){ nd[k]=(Number(nd[k])||0)-(Number(chgD[k])||0); }); _sh.drawer=nd; }
  }
  if(!isPlat && window.__online===false && (payments||[]).some(function(pp){return pp.method!=='Cash';})){
    alert("You're offline. Only CASH sales can be rung until the Wi-Fi/connection returns. Take this as cash, or wait to reconnect for G-Cash/bank.");
    return;
  }
  order.offlineRung=(window.__online===false);
  var _chargeStarted=performance.now();return persistPosSale(order).then(function(saved){
    telemetry().metric('charge_to_durable',performance.now()-_chargeStarted,saved.mode!=='server');
    if(window.__posLog)window.__posLog(saved.mode==='server'?'sale-server-recovered':'sale-queued',oid,'₱'+total+' · '+payLabel+(order.offlineRung?' · OFFLINE':'')+' · '+txnId);
    var receipt=Object.assign({},order); posCart={};posDraft={};posPaymentVerification=null; window.__posPkgs=[]; posScopedDisc=[]; renderPosCart({fresh:true}); showReceipt(receipt); if(saved.mode==='server'){(window.accazaToast||function(){})('Sale saved to the server. Browser storage was recovered safely.','ok');checkPosStorageHealth();}else flushOfflineQueue();
  }).catch(function(error){telemetry().metric('charge_to_durable',performance.now()-_chargeStarted,false);alert('Sale was NOT saved. Durable storage failed: '+String(error&&error.message||error));return {failed:true};});
}
window.__pos={render:function(){if(document.getElementById('posCartPanel'))renderPosCart();},loadCart:function(c){posCart=c||{};if(window.switchTab)window.switchTab('pos',document.querySelector('.admin-tab'));buildPOS();},hasItems:function(){return Object.keys(posCart).length>0;},addPackage:function(components,meta){(components||[]).forEach(function(c){var key=uid('pc_');posCart[key]={itemKey:c.itemKey,name:c.name,size:c.size||null,optLabels:c.optLabels||[],details:c.details||('pkg: '+meta.name),qty:c.qty,unitTotal:c.unitTotal,stream:(meta.type==='promo'?'promo':'events'),pkgId:meta.id};});window.__posPkgs=window.__posPkgs||[];window.__posPkgs.push(meta);renderPosCart();}};

/* ══════════ DEDUCTION ENGINE ══════════ */
function computeUsage(lineItems){
  var result=Costing().costOrder(costingContext({lineItems:lineItems||[]}));
  if(!result.ok)throw new Error(costingIssues(result.errors));
  window.__lastCostingResult=result;
  return result.usage;
}
/* ══════════ MODALS / RECEIPT ══════════ */
function ensureModals(){
  if(document.getElementById('pzItemMask'))return;
  var m=document.createElement('div'); m.className='pz-mask'; m.id='pzItemMask';
  m.innerHTML='<div class="pz-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div class="pz-h" id="pzItemTitle" style="margin:0;"></div><button class="pz-btn sec" id="pzItemClose" style="padding:0.2rem 0.6rem;">✕</button></div><div id="pzItemBody"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;border-top:1px solid var(--cd);padding-top:0.7rem;"><span style="font-weight:700;font-size:1.05rem;" id="pzItemTotal">₱0.00</span><button class="pz-btn ok" id="pzItemAdd" style="padding:0.55rem 1.4rem;">Add to sale</button></div></div>';
  document.body.appendChild(m);
  document.getElementById('pzItemClose').onclick=function(){m.classList.remove('show');};
  document.getElementById('pzItemAdd').onclick=pzAddToCart;
  m.onclick=function(e){if(e.target===m)m.classList.remove('show');};
}
function showReceipt(o){
  var addr='Saratoga Ave, La Mediterranea Subd., Governor\'s Drive, Dasmariñas';
  var dispRef=o.platformRef||o.id;
  var rows=(o.lineItems||[]).map(function(li){return '<tr><td>'+esc(li.name)+' ×'+li.qty+'</td><td style="text-align:right;">'+peso(li.qty*li.unitTotal)+'</td></tr>'+(li.optLabels&&li.optLabels.length?'<tr><td colspan="2" style="font-size:0.7rem;color:#777;padding-top:0;">'+esc(li.optLabels.join(', '))+'</td></tr>':'');}).join('');
  var w=window.open('','_blank','width=360,height=640');
  if(!w){alert('Allow pop-ups to print the receipt. Sale was saved.');return;}
  w.document.write('<html><head><title>Receipt '+esc(dispRef)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2{text-align:center;margin:0 0 2px;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;">'+esc(addr)+'</div><hr>'
    +'<div>Order: '+esc(dispRef)+'</div><div>'+esc(o.date)+' '+esc(o.time)+'</div><div>On Duty: '+esc(o.onDuty||o.staff||'-')+'</div><div>Customer: '+esc(o.name||'Walk-in')+'</div>'
    +'<hr>'
    +'<table>'+rows+'</table><hr>'
    +'<table><tr><td>Subtotal</td><td style="text-align:right;">'+peso(o.subtotal||o.total)+'</td></tr>'
    +((o.discountLines&&o.discountLines.length)?o.discountLines.map(function(d){var lbl={senior:'Senior 20%',pwd:'PWD 20%',athlete:'Athlete 20%',promo5:'Promo 5%'}[d.type]||d.type;return '<tr><td>'+esc(lbl)+(d.idNumber?' · '+esc(d.idNumber):'')+'</td><td style="text-align:right;">-'+peso(d.value)+'</td></tr>';}).join(''):'')
    +(function(){var sc=(o.discountLines||[]).reduce(function(s,d){return s+(Number(d.value)||0);},0);var man=(Number(o.discount)||0)-sc;return man>0.005?'<tr><td>Discount</td><td style="text-align:right;">-'+peso(man)+'</td></tr>':'';})()
    +'<tr><td><b>TOTAL</b></td><td style="text-align:right;"><b>'+peso(o.total)+'</b></td></tr>'
    +'<tr><td>Payment</td><td style="text-align:right;">'+esc(o.payment)+'</td></tr>'
    +(o.platformRef?'<tr><td>Net (after comm.)</td><td style="text-align:right;">'+peso(o.netPlatform||0)+'</td></tr>':'')
    +(o.tendered?'<tr><td>Cash</td><td style="text-align:right;">'+peso(o.tendered)+'</td></tr><tr><td>Change</td><td style="text-align:right;">'+peso(o.change)+'</td></tr>':'')
    +(o.tipRounding?'<tr><td>Tip / kept change</td><td style="text-align:right;">'+peso(o.tipRounding)+'</td></tr>':'')
    +'</table><hr><div style="text-align:center;">Salamat! Please come again.</div>'
    +'<div style="text-align:center;font-size:9px;margin-top:4px;">This is not an official BIR receipt.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div>'
    +'</body></html>');
  w.document.close();
}
})();
