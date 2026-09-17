import{watchSalesPeriod,periodKey}from'./sales-period-data.mjs?v=542';
import{createHistoricalPeriodStore}from'./historical-period-store.mjs?v=542';
// One managed subscription per path. Sales reports combine indexed date queries;
// POS-critical paths stay live and back-office paths attach only when needed.
const HISTORY_BOUNDS={
  orders:{field:'timestamp',limit:250,page:250},archivedOrders:{field:'timestamp',limit:100,page:100},archivedReservations:{field:'archivedAt',limit:100,page:100},
  shifts:{field:'openAt',limit:100,page:100},activityLog:{field:'ts',limit:200,page:200},discrepancies:{field:'ts',limit:200,page:200},
  stockReceipts:{field:'ts',limit:250,page:250},purchaseInvoices:{field:'ts',limit:250,page:250},inventoryAdjustments:{field:'ts',limit:250,page:250},internalUsage:{field:'ts',limit:250,page:250},
  cfLedger:{field:'ts',limit:200,page:200},financialMovements:{field:'occurredAt',limit:200,page:200},platformPayouts:{field:'settledAt',limit:100,page:100},inventoryMovements:{field:'occurredAt',limit:200,page:200}
};
const HISTORY_TAB_PATHS={saleshistory:['orders','archivedOrders','financialMovements'],analytics:['orders','archivedOrders'],pnl:['orders','archivedOrders','internalUsage','inventoryAdjustments','platformPayouts'],payouts:['orders','archivedOrders','platformPayouts','financialMovements'],stockvalue:['orders','archivedOrders','stockReceipts','inventoryAdjustments','internalUsage','inventoryMovements','financialMovements'],dailyreport:['orders','archivedOrders'],cashflow:['orders','archivedOrders','cfLedger','financialMovements','platformPayouts'],receivables:['orders','archivedOrders','financialMovements'],purchases:['purchaseInvoices','stockReceipts','inventoryMovements'],usage:['internalUsage','inventoryMovements'],inventory:['inventoryMovements'],ops:['shifts','activityLog'],discrepancy:['discrepancies'],reservations:['archivedReservations']};
// activeOrders and inventory are unbounded (every currently-open order / every SKU must be
// present, so they cannot use HISTORY_BOUNDS' limitToLast the way reporting paths do) but are
// held live for the whole session by every admin/POS/books connection. A plain onValue there
// retransmits the ENTIRE node on every single write inside it (one sale, one status change).
// These attach via per-child listeners instead, so one write no longer forces every consumer
// to rebuild the whole node and each record is counted once as it arrives. The initial
// download is unchanged, and the SDK may already send only the changed subtree over the wire;
// see the note on GROWING_PATHS below and DOWNLOAD_AUDIT_2026-09-16.md before claiming a
// wire-byte saving here.
// posActiveShift is the same shape of problem on a single record: syncOfflinePosSale writes
// it via .transaction() on every POS sale (online sales are queued through the same offline
// -sync pipeline, not just literal offline ones) and every drawer-affecting refund, and it is
// in the always-live `critical` set below -- including offlineSyncApplied, which only grows
// across the shift. Per-child listeners here fire per top-level field (drawer,
// offlineSyncApplied, ...) instead, so an unrelated field on the record no longer rides along.
const INCREMENTAL_PATHS={activeOrders:1,inventory:1,posActiveShift:1};
// Bounded paths that were attached with onValue on their limitToLast query. Converting them
// to per-child listeners on the same bounded query keeps the initial download identical and
// makes each subsequent change a single record, instead of the client rebuilding up to N
// records (200 for financialMovements) for every consumer on every write. Whether the wire
// cost of a write changes depends on whether the SDK was already sending only the changed
// subtree; treat the client-work saving as certain and the byte saving as unconfirmed, and
// check the console Usage tab. See DOWNLOAD_AUDIT_2026-09-16.md.
// These paths attach onChildAdded/Changed/Removed plus a one-time value event, all on the
// same liveTarget query, so the result is downloaded once (17 Sep 2026: the earlier get()
// bootstrap downloaded it twice). Period-scoped variants (sales history, financialMovements
// in saleshistory scope) keep their existing onValue handlers because they use startAt/endAt
// range queries that need the full result on period change.
const BOOTSTRAPPED_INCREMENTAL_BOUNDS={financialMovements:1,cfLedger:1,inventoryMovements:1,platformPayouts:1,'books/journal':1,orders:1,internalUsage:1,inventoryAdjustments:1,stockReceipts:1,purchaseInvoices:1,shifts:1,activityLog:1,discrepancies:1,archivedReservations:1,staffMessages:1};
const VERSIONED_MASTER_PATHS={categories:1,optionGroups:1,menuItems:1};
// Nodes that grow with trading volume and are read in full (no natural "recent only" window:
// reviews, feedback, installed-app customers, voucher ledgers, supplier/SKU masters, the
// per-shift assurance feeds). A whole-node onValue on one of these makes the client hold the
// entire node and rebuild it (snapshot.val()) for every consumer on every single write
// anywhere inside it -- a review from a customer on the shop dashboard, a voucher approved on
// the register, a device health ping every 60 seconds, one shift close. Attaching per child
// gives the same value for the same initial cost and then touches one record per write.
//
// Be precise about what this does and does not buy: the initial download is the same, and the
// SDK may already send only the changed subtree over the wire, so this is not claimed as a
// wire-byte saving until the console Usage tab confirms it (see DOWNLOAD_AUDIT_2026-09-16.md).
// What it does buy is bounded per-write client work: it is the difference between re-reading
// and re-allocating a whole node on a POS tablet and touching one key, and it is what lets the
// windowed and own-index paths below exist at all.
// A dynamic child under one of these (posDeviceHealth/<shiftId>, ownerDailySummaries/<day>,
// shiftCloseReceipts/<shiftId>, staffReceiptIndex/<uid>) is matched by its first path segment,
// so the scoped per-shift reads the Live Operations page already makes are incremental too.
// /reservations is deliberately NOT here. It holds only still-open bookings (archived ones
// move to archivedReservations), so it is not a growth problem, and its page decides that a
// booking is new by diffing the previous key list against the new one. Per-child delivery
// hands it one key at a time, so the second and every later key of the first batch would look
// new and the register would chime for bookings that were already open. It stays whole-node.
const GROWING_PATHS={reviews:1,feedbacks:1,appCustomers:1,pettyCashVouchers:1,pettyCashReplenishments:1,suppliers:1,inventorySku:1,posDeviceHealth:1,shiftCloseReceipts:1,ownerDailySummaries:1,staffReceiptIndex:1};
function isGrowing(path){if(GROWING_PATHS[path])return true;const head=String(path).split('/')[0];return !!GROWING_PATHS[head];}
// Only rows that are still open are needed: custody that still holds cash (Sep 2026 audit).
const OPEN_ROW_PATHS={cashCustody:{field:'remaining',start:0.005}};
// Time-windowed rows: the node keeps history, but only the recent window is ever shown. The
// Staff Inbox hides messages after their 30-day expiry, so only that window is read (the
// server stamps every message with expiresAt = createdAt + 30 days).
const WINDOWED_PATHS={staffMessages:{field:'createdAt',windowMs:30*86400000}};
// Journal history is summarised server-side in books/monthlyNet; the live listener only
// carries the current Manila month (Stock Value reads earlier months from the totals).
const CURRENT_MONTH_PATHS={'books/journal':'date'};
function manilaMonthStart(){var day=typeof window!=='undefined'&&window.AccazaDate&&window.AccazaDate.key?window.AccazaDate.key():new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return String(day).slice(0,7)+'-01';}
const MASTER_CACHE_KEY='accaza_admin_master_v2';
const DEFAULT_LINGER_MS=5*60000;

function createSubscriptionHub(database,ops){
  const {ref,onValue,onChildAdded,onChildChanged,onChildRemoved,query,orderByChild,limitToLast,startAt,endAt,endBefore,get}=ops;
  const LINGER_MS=ops.lingerMs!=null?Number(ops.lingerMs):DEFAULT_LINGER_MS;
  // archivedOrders is served by the Firestore replica and its period cache; sales period
  // queries change with the selected dates. Neither is worth keeping when unused.
  function LINGER_OK(path){return path!=='archivedOrders'&&!(salesPath(path)&&reportPeriod());}
  function reportPeriod(scope){scope=scope||activeScope;return typeof window!=='undefined'&&window.AccazaAdminPeriods&&window.AccazaAdminPeriods.get&&['dashboard','saleshistory','analytics'].indexOf(scope)>-1?window.AccazaAdminPeriods.get('sales'):null;}
  function salesPath(path){return path==='orders'||path==='archivedOrders';}
  function selectedPeriod(scope){scope=scope||activeScope;var p=reportPeriod(scope);if(p&&scope==='analytics')return Object.assign({},p,{startAt:p.startAt-(p.endAt-p.startAt+1)});return p;}
  // The query a bounded path uses for a scope. Switching between tabs that need the same
  // query keeps the live listener instead of detaching and re-downloading the whole page.
  function targetKey(path,scope){if(!HISTORY_BOUNDS[path])return 'static';var p=selectedPeriod(scope),rp=reportPeriod(scope);if(path==='archivedOrders'||salesPath(path))return p?'period:'+periodKey(p):'latest';if(path==='financialMovements'){if(p&&scope==='saleshistory')return 'saleshistory:'+periodKey(rp);return rp&&Number(rp.startAt)&&Number(rp.endAt)?'period:'+periodKey(rp):'latest';}return 'latest';}
  function liveTarget(path){var base=ref(database,path),spec=HISTORY_BOUNDS[path],period=reportPeriod();if(WINDOWED_PATHS[path]){var win=WINDOWED_PATHS[path];return query(base,orderByChild(win.field),startAt(Date.now()-win.windowMs));}if(CURRENT_MONTH_PATHS[path])return query(base,orderByChild(CURRENT_MONTH_PATHS[path]),startAt(manilaMonthStart()));if(OPEN_ROW_PATHS[path])return query(base,orderByChild(OPEN_ROW_PATHS[path].field),startAt(OPEN_ROW_PATHS[path].start));if(!spec)return base;if(period&&path==='financialMovements'&&Number(period.startAt)&&Number(period.endAt))return query(base,orderByChild(spec.field),startAt(Number(period.startAt)),endAt(Number(period.endAt)));return query(base,orderByChild(spec.field),limitToLast(spec.limit));}
  var entries={},authorized=false,activeScope='dashboard',nextId=1,liveStartedAt=0,liveReadyRecorded=false;
  var rollingStops=new Set();
  const historicalPeriods=createHistoricalPeriodStore({read:payload=>ops.readHistoricalOrders(payload),watch:(data,error)=>onValue(ref(database,'historicalArchiveSync'),snapshot=>data(snapshot.val()||{}),error)});
  async function readHistoricalPeriod(period){
    if(!ops.readHistoricalOrders)throw new Error('Historical Firestore reader is unavailable. Refresh the portal.');
    return historicalPeriods.read(period);
  }
  var critical={settings:1,activeOrders:1,posActiveShift:1,'.info/connected':1};
  var scopes={
    categories:['dashboard','pos','menu','availability','recipes','analytics'],menuItems:['dashboard','pos','menu','availability','recipes','analytics'],optionGroups:['pos','menu','availability','recipes'],packages:['pos','menu','recipes','inventory'],availability:['dashboard','pos','menu','availability'],channelPrices:['pos','menu'],posStaff:['pos','ops','possettings'],posSettings:['pos','ops','possettings'],
    orders:['dashboard','saleshistory','analytics','pnl','payouts','stockvalue','dailyreport','cashflow','receivables'],staffAccounts:['staffaccounts'],adminAccounts:['adminaccounts'],admins:['staffaccess'],adminPerms:['staffaccess'],
    archivedOrders:['dashboard','archive','appcustomers','saleshistory','analytics','pnl','payouts','stockvalue','cashflow','receivables','dailyreport'],archivedReservations:['reservations','calendar'],reservations:['dashboard','reservations','calendar'],
    feedbacks:['comments','analytics'],reviews:['dashboard','reviews','analytics'],payment:['payment'],calBlocks:['reservations','calendar'],appCustomers:['appcustomers','analytics'],inventory:['inventory','purchases','recipes','usage','stockvalue'],inventoryMovements:['inventory','purchases','usage','stockvalue'],
    recipes:['recipes','usage','analytics','pnl'],packagingRules:['recipes','usage','analytics','pnl','inventory'],optionRecipes:['recipes','usage'],internalUsage:['usage','pnl','stockvalue'],usageTypes:['usage'],expenseItems:['pnl'],monthlyExpenses:['pnl'],inventoryAdjustments:['pnl','stockvalue'],stockReceipts:['purchases','stockvalue'],purchaseInvoices:['purchases'],
    suppliers:['purchases','petty'],inventorySku:['inventory','purchases'],booksChart:['discrepancy','purchases'],posDeviceHealth:['liveoperations'],shiftCloseReceipts:['liveoperations'],ownerDailySummaries:['liveoperations'],
    platformPayouts:['payouts','pnl','analytics','cashflow','receivables'],platformVarAccounts:['payouts','pnl'],shifts:['ops'],activityLog:['ops'],heldOrders:['pos','ops'],discrepancies:['discrepancy'],
    pettyCashVouchers:['petty','purchases'],pettyCashReplenishments:['petty'],pettyCashSettings:['petty'],cfAccounts:['dashboard','pos','purchases','petty','cashflow','receivables','payables','payouts','undeposited','possettings'],cfLedger:['cashflow'],'books/journal':['stockvalue'],'books/monthlyNet':['stockvalue'],financialMovements:['purchases','cashflow','receivables','payables','payouts','saleshistory','discrepancy'],chartOfAccounts:['cashflow'],cashCustody:['cashflow'],receivables:['receivables'],payables:['payables'],accountingPeriods:['accountingperiods']
  };
  function policy(path,opts){opts=opts||{};return {critical:opts.critical===true||critical[path]===1,scopes:opts.scopes||scopes[path]||[]};}
  function consumerActive(c){return authorized&&(c.critical||c.scopes.indexOf(activeScope)>-1);}
  function reportError(path,error){console.error('ACCAZA LIVE DATA ERROR ['+path+']',error);try{(window.accazaToast||function(){})('Live data failed for '+path+'. Check connection or access.','err');}catch(_e){}}
  // Bounded report paths always handed consumers an object. Whole nodes attached per child
  // (activeOrders, inventory, posActiveShift, growing nodes) behave like a real snapshot: an
  // empty node reads as null, so "no open shift" is null, never an empty-but-truthy object.
  function facade(entry){var merged=Object.assign({},entry.older||{},entry.live||{}),empty=!Object.keys(merged).length,asNull=empty&&!HISTORY_BOUNDS[entry.path];return {val:function(){return asNull?null:merged;},exists:function(){return !empty;}};}
  function dispatch(entry,snapshot){entry.last=snapshot;Object.keys(entry.consumers).forEach(function(id){var c=entry.consumers[id];if(consumerActive(c)){try{c.callback(snapshot);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function resetEntry(entry){clearLinger(entry);if(entry.unsub)entry.unsub();entry.unsub=null;entry.generation=(entry.generation||0)+1;entry.live={};entry.older={};entry.archiveCursor=null;entry.last=null;entry.loading=true;entry.error=null;entry.hasOlder=true;}
  function readMasterCache(){try{return JSON.parse(localStorage.getItem(MASTER_CACHE_KEY)||'null');}catch(_e){return null;}}
  function writeMasterCache(value){try{localStorage.setItem(MASTER_CACHE_KEY,JSON.stringify(value));}catch(_e){}}
  function invalidateMasterCache(){try{localStorage.removeItem(MASTER_CACHE_KEY);}catch(_e){}}
  function attach(entry){
    entry.loading=true;entry.error=null;var generation=entry.generation||0,p=selectedPeriod(),failure=null;
    entry.periodKey=p?periodKey(p):'';entry.targetKey=targetKey(entry.path,activeScope);
    function failed(error){if(generation!==(entry.generation||0))return;failure=error;entry.error=error;entry.loading=false;reportError(entry.path,error);dispatch(entry,entry.last||facade(entry));}
    function receive(snapshot){
      if(generation!==(entry.generation||0))return;
      if(!liveReadyRecorded&&entry.path==='activeOrders'){liveReadyRecorded=true;try{if(typeof window!=='undefined'&&window.AccazaTelemetry)window.AccazaTelemetry.metric('live_ready',Math.max(0,performance.now()-liveStartedAt),true);}catch(_e){}}
      entry.loading=false;entry.error=null;
      if(HISTORY_BOUNDS[entry.path]){entry.live=snapshot.val()||{};entry.hasOlder=!(p&&(salesPath(entry.path)||entry.path==='financialMovements'))&&Object.keys(entry.live).length>=HISTORY_BOUNDS[entry.path].limit;dispatch(entry,facade(entry));}
      else dispatch(entry,snapshot);
      if(salesPath(entry.path)&&entries.financialMovements&&entries.financialMovements.refreshSources)entries.financialMovements.refreshSources();
    }
    if(entry.path==='archivedOrders'&&ops.readHistoricalOrders){
      if(p){entry.unsub=historicalPeriods.watch(p,rows=>receive({val:()=>rows}),failed);return;}
      var stopped=false,refreshing=false,queued=false,loadedOnce=false,sequence=null,pendingMarker=null;
      // First load reads the latest page once. Later archive changes arrive through the
      // bounded change journal and are patched by exact order ID, so one archived sale no
      // longer re-reads the whole latest page in every open tab.
      function changedIds(marker,previous){var next=Number(marker&&marker.sequence);if(!loadedOnce||previous===null||!Number.isSafeInteger(next)||next<=previous)return null;var changes=Object.values(marker&&marker.changes||{}).filter(function(c){return c&&c.sequence>previous&&c.sequence<=next;}).sort(function(a,b){return a.sequence-b.sequence;});if(changes.length!==next-previous||!changes.every(function(c,i){return c.sequence===previous+i+1&&typeof c.orderId==='string'&&c.orderId;}))return null;return Array.from(new Set(changes.map(function(c){return c.orderId;})));}
      async function refreshArchive(marker){
        if(stopped||generation!==(entry.generation||0))return;if(refreshing){queued=true;pendingMarker=marker;return;}refreshing=true;
        var previous=sequence,next=Number(marker&&marker.sequence);sequence=Number.isSafeInteger(next)&&next>0?next:null;
        try{
          if(loadedOnce&&previous!==null&&sequence===previous)return;
          var ids=changedIds(marker,previous);
          if(ids&&ids.length){var patch=await ops.readHistoricalOrders({mode:'ids',ids:ids});if(stopped||generation!==(entry.generation||0))return;var rows=patch.orders||{};ids.forEach(function(id){if(rows[id]){if(entry.older[id]&&!entry.live[id])entry.older[id]=rows[id];else entry.live[id]=rows[id];}else{delete entry.live[id];delete entry.older[id];}});}
          else{entry.loading=true;var result=await ops.readHistoricalOrders({mode:'latest',limit:HISTORY_BOUNDS.archivedOrders.limit});if(stopped||generation!==(entry.generation||0))return;entry.live=result.orders||{};entry.archiveCursor=result.cursor||null;entry.hasOlder=result.hasMore===true;loadedOnce=true;}
          entry.loading=false;entry.error=null;dispatch(entry,facade(entry));
          if(entries.financialMovements&&entries.financialMovements.refreshSources)entries.financialMovements.refreshSources();
        }catch(error){sequence=null;failed(error);}finally{refreshing=false;if(queued&&!stopped){queued=false;var m=pendingMarker;pendingMarker=null;refreshArchive(m);}}
      }
      var stopMarker=onValue(ref(database,'historicalArchiveSync'),function(snapshot){
        var marker=snapshot.val()||{};
        if(marker.deleted&&marker.orderId){delete entry.live[marker.orderId];delete entry.older[marker.orderId];}
        refreshArchive(marker);
      },failed);
      entry.unsub=function(){stopped=true;stopMarker();};return;
    }
    if(p&&salesPath(entry.path)){entry.unsub=watchSalesPeriod(database,ops,entry.path,p,function(rows){receive({val:function(){return rows;}});},failed);return;}
    if(p&&entry.path==='financialMovements'&&activeScope==='saleshistory'){
      var base=null,sources={},stopped=false;
      function publish(){if(stopped||!base)return;var o=entries.orders,a=entries.archivedOrders;if(!o||!a||o.loading||a.loading||o.error||a.error)return;
        var ids={};[o.live,a.live].forEach(function(map){Object.keys(map||{}).forEach(function(k){ids[String(map[k].id||k)]=true;});});
        Object.values(base).forEach(function(m){if(m.sourceId&&(m.sourceType==='order'||['order_sale','order_void','order_refund'].indexOf(m.type)>-1))ids[String(m.sourceId)]=true;});
        Object.keys(sources).forEach(function(id){if(!ids[id]){sources[id].stop();delete sources[id];}});
        Object.keys(ids).forEach(function(id){if(sources[id])return;var source=sources[id]={rows:null,stop:function(){}};source.stop=onValue(query(ref(database,'financialMovements'),orderByChild('sourceId'),startAt(id),endAt(id)),function(snap){if(stopped)return;source.rows=snap.val()||{};publish();},failed);});
        if(Object.values(sources).some(function(v){return v.rows===null;})){entry.loading=true;return;}
        receive({val:function(){return Object.assign({},base,...Object.values(sources).map(function(v){return v.rows;}));}});
      }
      entry.refreshSources=publish;
      var stopBase=onValue(liveTarget(entry.path),function(snapshot){base=snapshot.val()||{};publish();},failed);
      entry.unsub=function(){stopped=true;entry.refreshSources=null;stopBase();Object.values(sources).forEach(function(v){v.stop();});};return;
    }
    if(VERSIONED_MASTER_PATHS[entry.path]){
      var masterStopped=false,masterRequest=0;
      var stopVersion=onValue(ref(database,'publicCatalogVersion'),async function(versionSnapshot){
        var marker=versionSnapshot.val(),version=String(marker&&typeof marker==='object'?marker.version:marker||'bootstrap'),request=++masterRequest,cache=readMasterCache();
        if(cache&&String(cache.version)===version&&cache[entry.path]&&(entry.path!=='optionGroups'||Object.keys(cache[entry.path]).length)){receive({val:function(){return cache[entry.path];}});return;}
        try{var snapshot=await get(ref(database,entry.path));if(masterStopped||request!==masterRequest)return;var value=snapshot.val()||{};if(entry.path==='optionGroups'&&!Object.keys(value).length&&cache&&cache.optionGroups&&Object.keys(cache.optionGroups).length){reportError(entry.path,new Error('Live option groups are empty; using the last known safe catalog.'));receive({val:function(){return cache.optionGroups;}});return;}var fresh=readMasterCache();cache=fresh&&String(fresh.version)===version?fresh:{version:version};cache[entry.path]=value;writeMasterCache(cache);receive(snapshot);}catch(error){if(cache&&cache[entry.path])receive({val:function(){return cache[entry.path];}});else failed(error);}
      },failed);
      entry.unsub=function(){masterStopped=true;stopVersion();};return;
    }
    // Per-child attach (whole growing nodes, unbounded live nodes, and bounded report queries).
    // The first complete snapshot comes from a one-time value event on the SAME query, so it
    // shares the child listeners' single server listen and the data is downloaded once. The
    // Sep 16 version bootstrapped with get() and attached the child listeners afterwards: the
    // SDK keeps no cache once a get() completes, so the listen downloaded the whole result a
    // second time on every attach (see repoGetValue in @firebase/database). The one-time value
    // event also fires for an empty node, so an empty node no longer stays "loading".
    // After the first snapshot each change is applied one child at a time.
    if(INCREMENTAL_PATHS[entry.path]||isGrowing(entry.path)||BOOTSTRAPPED_INCREMENTAL_BOUNDS[entry.path]){
      var cSpec=HISTORY_BOUNDS[entry.path],cTarget=BOOTSTRAPPED_INCREMENTAL_BOUNDS[entry.path]?liveTarget(entry.path):ref(database,entry.path),cStopped=false,cReady=false,cUnsubs=[];
      function cCurrent(){return !cStopped&&generation===(entry.generation||0);}
      function cPublish(){
        entry.loading=false;entry.error=null;
        if(cSpec)entry.hasOlder=Object.keys(entry.live).length>=cSpec.limit;
        dispatch(entry,facade(entry));
        if(salesPath(entry.path)&&entries.financialMovements&&entries.financialMovements.refreshSources)entries.financialMovements.refreshSources();
      }
      function cApply(key,value){if(!cCurrent())return;if(value===null)delete entry.live[key];else entry.live[key]=value;if(cReady)cPublish();}
      cUnsubs.push(onChildAdded(cTarget,function(s){cApply(s.key,s.val());},failed));
      cUnsubs.push(onChildChanged(cTarget,function(s){cApply(s.key,s.val());},failed));
      cUnsubs.push(onChildRemoved(cTarget,function(s){cApply(s.key,null);},failed));
      cUnsubs.push(onValue(cTarget,function(s){if(!cCurrent()||cReady)return;cReady=true;entry.live=s.val()||{};cPublish();},failed,{onlyOnce:true}));
      entry.unsub=function(){cStopped=true;cUnsubs.forEach(function(u){try{u();}catch(e){}});};
      return;
    }
    entry.unsub=onValue(liveTarget(entry.path),receive,failed);
  }
  // A listener that no open tab needs is kept for LINGER_MS before it is detached. Moving
  // between tabs (POS -> Cash Flow -> POS) then costs only the changes made meanwhile instead
  // of downloading the whole query again on every switch; an attached listener receives
  // deltas only. Sign-out and a changed query still detach at once.
  function clearLinger(entry){if(entry.lingerTimer){clearTimeout(entry.lingerTimer);entry.lingerTimer=null;}}
  function entryNeeded(entry){return Object.keys(entry.consumers).some(function(id){return consumerActive(entry.consumers[id]);});}
  function release(entry){
    if(!entry.unsub||entry.lingerTimer)return;
    if(!authorized||!(LINGER_MS>0)||!LINGER_OK(entry.path)){resetEntry(entry);return;}
    entry.lingerTimer=setTimeout(function(){entry.lingerTimer=null;if(!entryNeeded(entry))resetEntry(entry);},LINGER_MS);
    if(entry.lingerTimer&&entry.lingerTimer.unref)entry.lingerTimer.unref();
  }
  function reconcileEntry(entry){var ids=Object.keys(entry.consumers),needed=entryNeeded(entry);if(needed){clearLinger(entry);if(entry.unsub&&HISTORY_BOUNDS[entry.path]&&(entry.error||entry.targetKey!==targetKey(entry.path,activeScope)))resetEntry(entry);}var wasAttached=!!entry.unsub;if(needed&&!entry.unsub)attach(entry);if(!needed&&entry.unsub)release(entry);ids.forEach(function(id){var c=entry.consumers[id],now=consumerActive(c),becameActive=now&&!c.wasActive;c.wasActive=now;if(becameActive&&wasAttached&&entry.last){try{c.callback(entry.last);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function reconcile(){Object.keys(entries).forEach(function(path){reconcileEntry(entries[path]);});}
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('accaza-admin-period',function(event){if(!event.detail||event.detail.scope!=='sales'||['dashboard','saleshistory','analytics'].indexOf(activeScope)<0)return;var affected=Object.keys(entries).filter(function(path){return HISTORY_BOUNDS[path]&&entries[path].unsub;}).map(function(path){return entries[path];});affected.forEach(resetEntry);affected.filter(entryNeeded).forEach(attach);});
  return {
    invalidateMasterCache:invalidateMasterCache,
    subscribe:function(path,callback,opts){var p=policy(path,opts),entry=entries[path]||(entries[path]={path:path,consumers:{},unsub:null,last:null,live:{},older:{},hasOlder:true}),id=String(nextId++);entry.consumers[id]={callback:callback,critical:p.critical,scopes:p.scopes,wasActive:false};reconcileEntry(entry);return function(){delete entry.consumers[id];reconcileEntry(entry);};},
    authorize:function(){authorized=true;liveStartedAt=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();liveReadyRecorded=false;try{performance.mark('accaza-live-start');}catch(_e){}reconcile();},deauthorize:function(){authorized=false;rollingStops.forEach(stop=>stop());Object.keys(entries).forEach(function(path){if(entries[path].unsub)resetEntry(entries[path]);});reconcile();historicalPeriods.clear();},activate:function(scope){var nextScope=scope||'dashboard',changed=nextScope!==activeScope;activeScope=nextScope;if(changed){rollingStops.forEach(stop=>stop());var kept={};Object.keys(entries).forEach(function(path){var entry=entries[path];if(!HISTORY_BOUNDS[path]||!entry.unsub)return;var stillNeeded=Object.keys(entry.consumers).some(function(id){return consumerActive(entry.consumers[id]);});if(stillNeeded&&entry.targetKey===targetKey(path,nextScope)&&!entry.error){kept[path]=true;return;}if(!stillNeeded&&LINGER_OK(path)&&LINGER_MS>0&&!entry.error)return;resetEntry(entry);});if(!(kept.archivedOrders&&String(entries.archivedOrders.targetKey).indexOf('period:')===0))historicalPeriods.clear();}reconcile();},
    loadOlder:async function(path){var spec=HISTORY_BOUNDS[path],entry=entries[path];if(reportPeriod()&&(salesPath(path)||path==='financialMovements'))return {loaded:0,hasOlder:entry?entry.loading:false};if(!spec||!entry)throw new Error('No paginated subscription for '+path);var merged=Object.assign({},entry.older||{},entry.live||{}),keys=Object.keys(merged),oldest=null;keys.forEach(function(k){var v=merged[k]||{},sv=Number(v[spec.field])||0;if(!oldest||sv<oldest.value||(sv===oldest.value&&k<oldest.key))oldest={value:sv,key:k};});if(!oldest){entry.hasOlder=false;return {loaded:0,hasOlder:false};}if(path==='archivedOrders'&&ops.readHistoricalOrders){var page=await ops.readHistoricalOrders({mode:'before',cursor:entry.archiveCursor||{value:oldest.value,id:oldest.key},limit:spec.page}),archiveRows=page.orders||{};Object.assign(entry.older,archiveRows);entry.archiveCursor=page.cursor||entry.archiveCursor;entry.hasOlder=page.hasMore===true;dispatch(entry,facade(entry));return {loaded:Object.keys(archiveRows).length,hasOlder:entry.hasOlder};}var snap=await get(query(ref(database,path),orderByChild(spec.field),endBefore(oldest.value,oldest.key),limitToLast(spec.page+1))),rows=[];snap.forEach(function(ch){rows.push({key:ch.key,value:ch.val()||{}});});var hasOlder=rows.length>spec.page;if(hasOlder)rows.shift();rows.forEach(function(r){entry.older[r.key]=r.value;});entry.hasOlder=hasOlder;dispatch(entry,facade(entry));return {loaded:rows.length,hasOlder:hasOlder};},
    readHistoricalPeriod:readHistoricalPeriod,
    watchRollingSales:function(period,data,error){
      var live=null,archived=null,stopped=false;
      function publish(){if(!stopped&&live&&archived)data(Object.assign({},live,archived));}
      var stopArchive=historicalPeriods.watch(period,rows=>{archived=rows;publish();},error);
      var stopLive=watchSalesPeriod(database,ops,'orders',period,rows=>{live=rows;publish();},error);
      var stop=function(){if(stopped)return;stopped=true;stop.active=false;stopArchive();stopLive();rollingStops.delete(stop);};
      stop.active=true;
      rollingStops.add(stop);return stop;
    },
    whenReady:function(paths){var key=reportPeriod()&&periodKey(reportPeriod()),scope=activeScope;return new Promise(function(resolve,reject){var started=Date.now();function check(){if(activeScope!==scope||key!==(reportPeriod()&&periodKey(reportPeriod())))return reject(new Error('The reporting period changed. Apply the current selection again.'));var list=paths.map(function(path){return entries[path];}),bad=list.find(function(e){return e&&e.error;});if(bad)return reject(bad.error);if(list.every(function(e){return e&&!e.loading&&e.last;}))return resolve(true);if(Date.now()-started>30000)return reject(new Error('The selected report is still loading. Check your connection and retry.'));setTimeout(check,80);}check();});},
    historyStatus:function(path){var e=entries[path],s=HISTORY_BOUNDS[path];return {bounded:!!s,ready:!!(e&&e.last&&!e.loading&&!e.error),loading:!!(e&&e.loading),error:e&&e.error,periodKey:e&&e.periodKey,loaded:e?Object.keys(Object.assign({},e.older||{},e.live||{})).length:0,hasOlder:e?e.hasOlder:false};},stats:function(){var attached=Object.keys(entries).filter(function(k){return !!entries[k].unsub;});return {authorized:authorized,activeScope:activeScope,attached:attached,attachedCount:attached.length,registeredPaths:Object.keys(entries).length};}
  };
}

export{DEFAULT_LINGER_MS,HISTORY_BOUNDS,HISTORY_TAB_PATHS,BOOTSTRAPPED_INCREMENTAL_BOUNDS,GROWING_PATHS,WINDOWED_PATHS,isGrowing,createSubscriptionHub};
