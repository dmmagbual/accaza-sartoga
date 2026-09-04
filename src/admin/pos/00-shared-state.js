(function(){
'use strict';
var inventoryMap={}, inventorySkuMap={}, purchaseInvoicesMap={}, purchaseShiftMap={}, purchaseFundAdvanceMap={}, supplierMap={}, recipesMap={}, posMeta={vat:false,vatRate:12}, optRecipesMap={}, usageMap={}, channelPricesMap={}, posAvailMap={}, inventoryMovementsMap={},paymentAccountsMap={},packagingRulesMap={};
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
var USAGE_ACCOUNT_OPTIONS=[{code:'6077',name:'Staff Consumption & Welfare'},{code:'6078',name:'Product R&D & Testing'},{code:'5900',name:'Wastage & Spoilage'},{code:'6070',name:'Cleaning & Operating Supplies'},{code:'6075',name:'Office & Administrative Supplies'},{code:'6050',name:'Marketing & Promotions'}];
var DEFAULT_USAGE_TYPES=[{id:'staff',name:'Staff consumption',expenseAccount:'6077',reasons:['Staff Meal','Staff Drink','Management'],order:1},{id:'rnd',name:'R&D / Testing',expenseAccount:'6078',reasons:['Testing','Training','Sampling','Quality Check'],order:2}];
function usageTypesList(){var keys=Object.keys(usageTypesMap);var list=keys.length?keys.map(function(k){return Object.assign({id:k},usageTypesMap[k]);}):DEFAULT_USAGE_TYPES.slice();return list.sort(function(a,b){return (a.order||0)-(b.order||0);});}
function usageTypeName(id){return (usageTypesMap[id]&&usageTypesMap[id].name)||(id==='staff'?'Staff consumption':id==='rnd'?'R&D / Testing':id);}
function usageTypeReasons(id){var t=usageTypesMap[id]||DEFAULT_USAGE_TYPES.filter(function(d){return d.id===id;})[0];return (t&&t.reasons)||[];}
function usageTypeAccount(id){var t=usageTypesMap[id]||DEFAULT_USAGE_TYPES.filter(function(d){return d.id===id;})[0]||{};return String(t.expenseAccount||(id==='rnd'?'6078':id==='waste'?'5900':'6077'));}
function usageAccountOptions(selected){return USAGE_ACCOUNT_OPTIONS.map(function(a){return '<option value="'+a.code+'"'+(a.code===String(selected)?' selected':'')+'>'+a.code+' · '+esc(a.name)+'</option>';}).join('');}
var posCart={}, posCat='ALL', posSearch='', posBuilt=false, recipeEditing=false, curRecipeKey=null, recipeDraft=null, recSub='base', recSize='M', posScopedDisc=[], posChannel='instore', posView='counter', onlineOrdersMap={};
var posDraft={},posChargeBusy=false,posPaymentVerification=null;
function telemetry(){return window.AccazaTelemetry||{start:function(){},end:function(){},metric:function(){},error:function(){}};}
function capturePosDraft(root){if(!root)return;var active=document.activeElement,focusId=active&&root.contains(active)?active.id:'';root.querySelectorAll('input[id],textarea[id]').forEach(function(el){posDraft[el.id]={value:el.value,checked:!!el.checked,type:el.type};});posDraft.__focus=focusId;}
function restorePosDraft(root){if(!root)return;Object.keys(posDraft).forEach(function(id){if(id==='__focus')return;var el=document.getElementById(id),v=posDraft[id];if(!el||!root.contains(el)||el.tagName==='SELECT')return;if(v.type==='checkbox'||v.type==='radio')el.checked=v.checked;else el.value=v.value;});var f=posDraft.__focus&&document.getElementById(posDraft.__focus);if(f&&root.contains(f))setTimeout(function(){try{f.focus();}catch(e){}},0);}
var DISC_TYPES={senior:{label:'Senior Citizen',rate:0.20},pwd:{label:'PWD',rate:0.20},athlete:{label:'National Athlete',rate:0.20},promo5:{label:'5% Drink Promo',rate:0.05}};

function A(){return window.__accaza;}
/* Platform (Grab/FoodPanda) order-number key — MUST match functions/index.js platformRefKey. */
function platformRefKey(r){return String(r||'').trim().toUpperCase().replace(/[.#$/\[\]\u0000-\u001f\u007f]/g,'_');}
function F(){if(!window.AccazaFormDialog)throw new Error('Form service unavailable. Refresh the portal.');return window.AccazaFormDialog;}
function Costing(){if(!window.AccazaCosting)throw new Error('The shared costing engine did not load. Refresh the portal and try again.');return window.AccazaCosting;}
function costingContext(extra){return Object.assign({inventory:inventoryMap,recipes:recipesMap,menuItems:(A()&&A().menuItemsMap)||{},optionCosts:optCostStore(),optionRecipes:optRecipesMap,optionGroups:(A()&&A().optionGroupsMap)||{},packagingRules:packagingRulesMap},extra||{});}
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
function isSupplyType(type){return type==='operating_supply'||type==='office_supply';}
function inventoryTypeLabel(type){return type==='consumable'?'🧻 Consumable':type==='option'?'➕ Optional ingredient':type==='both'?'🔀 Base and optional':type==='operating_supply'?'🧹 Operating / Cleaning Supply':type==='office_supply'?'🗂 Office / Administrative Supply':'🧪 Base ingredient';}
function inventoryTypeOptions(selected){return [['base','Base ingredient'],['option','Optional ingredient'],['both','Base and optional'],['consumable','Consumable — automatic per-order use'],['operating_supply','Operating / Cleaning Supply'],['office_supply','Office / Administrative Supply']].map(function(p){return '<option value="'+p[0]+'"'+(selected===p[0]?' selected':'')+'>'+p[1]+'</option>';}).join('');}
/* Inventory categories (organization + product-cost vs overhead), stored in posSettings (no new rule). */
function invCatsMap(){return (window.__posSettings&&window.__posSettings.invCategories)||{};}
function invCats(){var m=invCatsMap();return Object.keys(m).map(function(id){return Object.assign({id:id},m[id]);}).sort(function(a,b){return ((a.order||0)-(b.order||0))||(a.name||'').localeCompare(b.name||'');});}
function invCatName(id){var c=invCatsMap()[id];return c?c.name:'';}
function invCatKind(id){var c=invCatsMap()[id];return (c&&c.kind)||'cogs';}
var ITEM_INVENTORY_ACCOUNTS=[['1200','Coffee & Beans'],['1210','Milk & Dairy'],['1220','Syrups & Flavors'],['1230','Cups & Packaging'],['1240','Food & Pastries'],['1270','Operating & Cleaning Supplies'],['1280','Office Supplies']];
var ITEM_COST_ACCOUNTS=[['5000','COGS — Coffee & Beans'],['5010','COGS — Milk & Dairy'],['5020','COGS — Syrups & Flavors'],['5030','COGS — Food & Pastries'],['5040','COGS — Cups & Packaging'],['6070','Expense — Cleaning & Operating Supplies'],['6075','Expense — Office & Administrative Supplies']];
function itemAccountOptions(selected,kind){var rows=kind==='inventory'?ITEM_INVENTORY_ACCOUNTS:ITEM_COST_ACCOUNTS;return '<option value="">— Unmapped —</option>'+rows.map(function(p){return '<option value="'+p[0]+'"'+(selected===p[0]?' selected':'')+'>'+p[0]+' · '+esc((kind==='inventory'?'Inventory — ':'')+p[1])+'</option>';}).join('');}
function invItemAccounts(i){return{inventoryAccount:String(i&&i.inventoryAccount||''),costAccount:String(i&&(i.costAccount||i.cogsAccount)||'')};}
function seedInvCats(){ if(Object.keys(invCatsMap()).length)return; var a=A(); if(!a)return; var seed={}; [['Coffee','cogs'],['Milk','cogs'],['Syrup','cogs'],['Powder','cogs'],['Tea','cogs'],['Packaging','cogs'],['Food & Pastries','cogs'],['Cleaning','overhead'],['Office','overhead']].forEach(function(p,i){seed['cat_'+p[0].toLowerCase().replace(/[^a-z0-9]+/g,'_')]={name:p[0],kind:p[1],order:i};}); a.update(a.ref(a.db,'posSettings/invCategories'),seed).catch(function(){}); }
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
  if(!pm||!pm.length)pm=[{name:'Cash',active:true,cash:true},{name:'Bank Transfer',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'GCash',active:true,cash:false,verificationPolicy:'cashier_manager'},{name:'PayMaya',active:true,cash:false,verificationPolicy:'cashier_manager'}];
  return pm;
}
function posMethod(name){return posMethods().find(function(m){return String(m&&m.name||'').toLowerCase()===String(name||'').toLowerCase();})||{};}
function defaultPaymentAccountIds(method){var key=String(method&&method.name||'').toLowerCase(),ids=[];Object.keys(paymentAccountsMap).forEach(function(id){var a=paymentAccountsMap[id]||{},name=String(a.name||'').toLowerCase(),feeds=Array.isArray(a.feedMethods)?a.feedMethods:[];if(feeds.some(function(x){return String(x).toLowerCase()===key;}))ids.push(id);else if(key==='bank transfer'&&(name==='bdo'||name==='union bank'))ids.push(id);else if(key==='gcash'&&(name==='g-cash'||name==='gcash'))ids.push(id);else if(key==='paymaya'&&/paymaya|maya/.test(name))ids.push(id);});return ids;}
function paymentAccountIds(method){var m=posMethod(method),ids=Array.isArray(m.accountIds)?m.accountIds.filter(function(id){return paymentAccountsMap[id]&&paymentAccountsMap[id].active!==false;}):defaultPaymentAccountIds(m);return ids.filter(function(id,i){return ids.indexOf(id)===i;});}
function paymentAccountOptions(method){return paymentAccountIds(method).map(function(id){return{id:id,name:(paymentAccountsMap[id]&&paymentAccountsMap[id].name)||id};});}
function resolvedPayment(method,accountId,amount,ref){var opts=paymentAccountOptions(method),chosen=opts.find(function(a){return a.id===accountId;})||(opts.length===1?opts[0]:null);if(!chosen)return null;return{method:method+' · '+chosen.name,paymentMethod:method,receivingAccountId:chosen.id,receivingAccountName:chosen.name,amount:Number(amount)||0,tendered:0,change:0,ref:String(ref||'').trim()};}
function directPaymentRows(payments){return(payments||[]).filter(function(p){var m=String(p&&p.method||'').trim().toLowerCase();return m&&m!=='cash'&&m!=='grabfood'&&m!=='foodpanda';});}
function defaultPaymentVerificationPolicy(method){return /gcash|maya/i.test(String(method||''))?'cashier_manager':'manager_only';}
function paymentVerificationPolicy(payments){var direct=directPaymentRows(payments),methods=posMethods();if(!direct.length)return null;return direct.some(function(p){var base=p.paymentMethod||p.method,row=methods.find(function(m){return String(m&&m.name||'').trim().toLowerCase()===String(base||'').trim().toLowerCase();}),policy=row&&row.verificationPolicy;return (policy==='cashier_manager'||policy==='manager_only'?policy:defaultPaymentVerificationPolicy(base))==='manager_only';})?'manager_only':'cashier_manager';}
function posActiveMethods(){return posMethods().filter(function(m){return m.active!==false;});}
function isCashMethod(name){var m=posMethods().filter(function(x){return x.name===name;})[0];return m?!!m.cash:(name==='Cash');}
window.__isCashMethod=isCashMethod;
function init(){
  var a=A();
  window.__online=(typeof navigator!=='undefined')?navigator.onLine:true;
  a.subscribe('posSettings', function(s){ window.__posSettings=s.val()||{}; if(document.getElementById('posPay'))renderPosCart(); if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); });
  a.subscribe('cfAccounts',function(s){paymentAccountsMap=s.val()||{};if(document.getElementById('posPay'))renderPosCart();});
  a.subscribe('.info/connected', function(sn){ window.__online=(sn.val()===true); updateOfflineUI(); if(window.__online) flushOfflineQueue(); });
  try{ window.addEventListener('online', function(){ window.__online=true; updateOfflineUI(); flushOfflineQueue(); }); window.addEventListener('offline', function(){ window.__online=false; updateOfflineUI(); }); }catch(e){}
  checkPosStorageHealth();
  flushOfflineQueue();
  a.subscribe('availability', function(s){ posAvailMap=s.val()||{}; if(isTab('pos')&&document.getElementById('posItems'))drawPosItems(); });
  a.subscribe('inventory', function(s){ inventoryMap=s.val()||{}; if(isTab('inventory'))renderInventory(); if(isTab('recipes')&&!recipeEditing)renderRecipes(); updateLowStockBadge(); updateCostBadge(); });
  a.subscribe('inventorySku', function(s){ inventorySkuMap=s.val()||{}; if(isTab('inventory'))renderInventory(); if(isTab('purchases'))renderPurchases(); });
  a.subscribe('inventoryMovements', function(s){ inventoryMovementsMap=s.val()||{}; if(isTab('inventory'))renderInventory(); });
  a.subscribe('purchaseInvoices', function(s){ purchaseInvoicesMap=s.val()||{}; if(isTab('purchases'))renderPurchases(); });
  a.subscribe('shifts', function(s){ purchaseShiftMap=s.val()||{}; if(isTab('purchases'))renderPurchases(); });
  a.subscribe('pettyCashVouchers', function(s){ purchaseFundAdvanceMap=s.val()||{}; if(isTab('purchases'))renderPurchases(); });
  a.subscribe('suppliers', function(s){ supplierMap=s.val()||{}; window.__accazaSuppliers=supplierMap;if(!window.__supplierLegacyInitRequested&&a.manageSupplier){window.__supplierLegacyInitRequested=true;a.manageSupplier({action:'initialize_legacy'}).catch(function(){window.__supplierLegacyInitRequested=false;});} if(isTab('purchases'))renderPurchases(); });
  a.subscribe('packagingRules', function(s){ packagingRulesMap=s.val()||{}; if(isTab('recipes')&&!recipeEditing)renderRecipes(); updateCostBadge(); });
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
