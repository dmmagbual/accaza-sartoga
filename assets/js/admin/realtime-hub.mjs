import{watchSalesPeriod,periodKey}from'./sales-period-data.mjs?v=427';
// One managed subscription per path. Sales reports combine indexed date queries;
// POS-critical paths stay live and back-office paths attach only when needed.
const HISTORY_BOUNDS={
  orders:{field:'timestamp',limit:250,page:250},archivedOrders:{field:'timestamp',limit:100,page:100},archivedReservations:{field:'archivedAt',limit:100,page:100},
  shifts:{field:'openAt',limit:100,page:100},activityLog:{field:'ts',limit:200,page:200},discrepancies:{field:'ts',limit:200,page:200},
  stockReceipts:{field:'ts',limit:250,page:250},purchaseInvoices:{field:'ts',limit:250,page:250},inventoryAdjustments:{field:'ts',limit:250,page:250},internalUsage:{field:'ts',limit:250,page:250},
  cfLedger:{field:'ts',limit:300,page:300},financialMovements:{field:'occurredAt',limit:300,page:300},platformPayouts:{field:'settledAt',limit:100,page:100},inventoryMovements:{field:'occurredAt',limit:300,page:300}
};
const HISTORY_TAB_PATHS={saleshistory:['orders','archivedOrders','financialMovements'],analytics:['orders','archivedOrders'],pnl:['orders','archivedOrders','internalUsage','inventoryAdjustments','platformPayouts'],payouts:['orders','archivedOrders','platformPayouts','financialMovements'],stockvalue:['orders','archivedOrders','stockReceipts','inventoryAdjustments','internalUsage','inventoryMovements','financialMovements'],dailyreport:['orders','archivedOrders'],cashflow:['orders','archivedOrders','cfLedger','financialMovements','platformPayouts'],receivables:['orders','archivedOrders','financialMovements'],purchases:['purchaseInvoices','stockReceipts','inventoryMovements'],usage:['internalUsage','inventoryMovements'],inventory:['inventoryMovements'],ops:['shifts','activityLog'],discrepancy:['discrepancies'],reservations:['archivedReservations']};

function createSubscriptionHub(database,ops){
  const {ref,onValue,query,orderByChild,limitToLast,startAt,endAt,endBefore,get}=ops;
  function reportPeriod(){return typeof window!=='undefined'&&window.AccazaAdminPeriods&&window.AccazaAdminPeriods.get&&['dashboard','saleshistory','analytics'].indexOf(activeScope)>-1?window.AccazaAdminPeriods.get('sales'):null;}
  function salesPath(path){return path==='orders'||path==='archivedOrders';}
  function selectedPeriod(){var p=reportPeriod();if(p&&activeScope==='analytics')return Object.assign({},p,{startAt:p.startAt-(p.endAt-p.startAt+1)});return p;}
  function liveTarget(path){var base=ref(database,path),spec=HISTORY_BOUNDS[path],period=reportPeriod();if(!spec)return base;if(period&&path==='financialMovements'&&Number(period.startAt)&&Number(period.endAt))return query(base,orderByChild(spec.field),startAt(Number(period.startAt)),endAt(Number(period.endAt)));return query(base,orderByChild(spec.field),limitToLast(spec.limit));}
  var entries={},authorized=false,activeScope='dashboard',nextId=1,liveStartedAt=0,liveReadyRecorded=false;
  var critical={categories:1,settings:1,posSettings:1,activeOrders:1,optionGroups:1,menuItems:1,availability:1,channelPrices:1,posStaff:1,posActiveShift:1,packages:1,'.info/connected':1};
  var scopes={
    orders:['dashboard','saleshistory','analytics','pnl','payouts','stockvalue','dailyreport','cashflow','receivables'],staffAccounts:['staffaccounts'],adminAccounts:['adminaccounts'],admins:['staffaccess'],adminPerms:['staffaccess'],
    archivedOrders:['dashboard','archive','appcustomers','saleshistory','analytics','pnl','payouts','stockvalue','cashflow','receivables','dailyreport'],archivedReservations:['reservations','calendar'],reservations:['dashboard','reservations','calendar'],
    feedbacks:['comments','analytics'],reviews:['dashboard','reviews','analytics'],payment:['payment'],calBlocks:['reservations','calendar'],appCustomers:['appcustomers','analytics'],inventory:['inventory','purchases','recipes','usage','stockvalue'],inventoryMovements:['inventory','purchases','usage','stockvalue'],
    recipes:['recipes','usage','analytics','pnl'],optionRecipes:['recipes','usage'],internalUsage:['usage','pnl','stockvalue'],usageTypes:['usage'],expenseItems:['pnl'],monthlyExpenses:['pnl'],inventoryAdjustments:['pnl','stockvalue'],stockReceipts:['purchases','stockvalue'],purchaseInvoices:['purchases'],
    suppliers:['purchases','petty','undeposited'],inventorySku:['inventory','purchases'],booksChart:['discrepancy'],
    platformPayouts:['payouts','pnl','analytics','cashflow','receivables'],platformVarAccounts:['payouts','pnl'],shifts:['ops'],activityLog:['ops'],heldOrders:['pos','ops'],discrepancies:['discrepancy'],
    pettyCashVouchers:['petty','purchases','undeposited'],pettyCashReplenishments:['petty'],pettyCashSettings:['petty'],cfAccounts:['pos','purchases','cashflow','receivables','payables','payouts','undeposited','possettings'],cfLedger:['cashflow'],'books/journal':['stockvalue'],financialMovements:['purchases','cashflow','receivables','payables','payouts','saleshistory','undeposited','discrepancy'],chartOfAccounts:['cashflow'],cashCustody:['cashflow','undeposited'],receivables:['receivables'],payables:['payables'],accountingPeriods:['accountingperiods']
  };
  function policy(path,opts){opts=opts||{};return {critical:opts.critical===true||critical[path]===1,scopes:opts.scopes||scopes[path]||[]};}
  function consumerActive(c){return authorized&&(c.critical||c.scopes.indexOf(activeScope)>-1);}
  function reportError(path,error){console.error('ACCAZA LIVE DATA ERROR ['+path+']',error);try{(window.accazaToast||function(){})('Live data failed for '+path+'. Check connection or access.','err');}catch(_e){}}
  function facade(entry){var merged=Object.assign({},entry.older||{},entry.live||{});return {val:function(){return merged;},exists:function(){return Object.keys(merged).length>0;}};}
  function dispatch(entry,snapshot){entry.last=snapshot;Object.keys(entry.consumers).forEach(function(id){var c=entry.consumers[id];if(consumerActive(c)){try{c.callback(snapshot);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function resetEntry(entry){if(entry.unsub)entry.unsub();entry.unsub=null;entry.generation=(entry.generation||0)+1;entry.live={};entry.older={};entry.last=null;entry.loading=true;entry.error=null;entry.hasOlder=true;}
  function attach(entry){
    entry.loading=true;entry.error=null;var generation=entry.generation||0,p=selectedPeriod(),failure=null;
    entry.periodKey=p?periodKey(p):'';
    function failed(error){if(generation!==(entry.generation||0))return;failure=error;entry.error=error;entry.loading=false;reportError(entry.path,error);if(p&&(salesPath(entry.path)||entry.path==='financialMovements'))dispatch(entry,facade(entry));}
    function receive(snapshot){
      if(failure||generation!==(entry.generation||0))return;
      if(!liveReadyRecorded&&entry.path==='activeOrders'){liveReadyRecorded=true;try{if(typeof window!=='undefined'&&window.AccazaTelemetry)window.AccazaTelemetry.metric('live_ready',Math.max(0,performance.now()-liveStartedAt),true);}catch(_e){}}
      entry.loading=false;entry.error=null;
      if(HISTORY_BOUNDS[entry.path]){entry.live=snapshot.val()||{};entry.hasOlder=!(p&&(salesPath(entry.path)||entry.path==='financialMovements'))&&Object.keys(entry.live).length>=HISTORY_BOUNDS[entry.path].limit;dispatch(entry,facade(entry));}
      else dispatch(entry,snapshot);
      if(salesPath(entry.path)&&entries.financialMovements&&entries.financialMovements.refreshSources)entries.financialMovements.refreshSources();
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
    entry.unsub=onValue(liveTarget(entry.path),receive,failed);
  }
  function reconcileEntry(entry){var ids=Object.keys(entry.consumers),needed=ids.some(function(id){return consumerActive(entry.consumers[id]);}),wasAttached=!!entry.unsub;if(needed&&!entry.unsub)attach(entry);if(!needed&&entry.unsub){resetEntry(entry);}ids.forEach(function(id){var c=entry.consumers[id],now=consumerActive(c),becameActive=now&&!c.wasActive;c.wasActive=now;if(becameActive&&wasAttached&&entry.last){try{c.callback(entry.last);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function reconcile(){Object.keys(entries).forEach(function(path){reconcileEntry(entries[path]);});}
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('accaza-admin-period',function(event){if(!event.detail||event.detail.scope!=='sales'||['dashboard','saleshistory','analytics'].indexOf(activeScope)<0)return;var affected=Object.keys(entries).filter(function(path){return HISTORY_BOUNDS[path]&&entries[path].unsub;}).map(function(path){return entries[path];});affected.forEach(resetEntry);affected.forEach(attach);});
  return {
    subscribe:function(path,callback,opts){var p=policy(path,opts),entry=entries[path]||(entries[path]={path:path,consumers:{},unsub:null,last:null,live:{},older:{},hasOlder:true}),id=String(nextId++);entry.consumers[id]={callback:callback,critical:p.critical,scopes:p.scopes,wasActive:false};reconcileEntry(entry);return function(){delete entry.consumers[id];reconcileEntry(entry);};},
    authorize:function(){authorized=true;liveStartedAt=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();liveReadyRecorded=false;try{performance.mark('accaza-live-start');}catch(_e){}reconcile();},deauthorize:function(){authorized=false;reconcile();},activate:function(scope){var nextScope=scope||'dashboard',changed=nextScope!==activeScope;activeScope=nextScope;if(changed){Object.keys(entries).forEach(function(path){var entry=entries[path];if(!HISTORY_BOUNDS[path]||!entry.unsub)return;resetEntry(entry);});}reconcile();},
    loadOlder:async function(path){var spec=HISTORY_BOUNDS[path],entry=entries[path];if(reportPeriod()&&(salesPath(path)||path==='financialMovements'))return {loaded:0,hasOlder:entry?entry.loading:false};if(!spec||!entry)throw new Error('No paginated subscription for '+path);var merged=Object.assign({},entry.older||{},entry.live||{}),keys=Object.keys(merged),oldest=null;keys.forEach(function(k){var v=merged[k]||{},sv=Number(v[spec.field])||0;if(!oldest||sv<oldest.value||(sv===oldest.value&&k<oldest.key))oldest={value:sv,key:k};});if(!oldest){entry.hasOlder=false;return {loaded:0,hasOlder:false};}var snap=await get(query(ref(database,path),orderByChild(spec.field),endBefore(oldest.value,oldest.key),limitToLast(spec.page+1))),rows=[];snap.forEach(function(ch){rows.push({key:ch.key,value:ch.val()||{}});});var hasOlder=rows.length>spec.page;if(hasOlder)rows.shift();rows.forEach(function(r){entry.older[r.key]=r.value;});entry.hasOlder=hasOlder;dispatch(entry,facade(entry));return {loaded:rows.length,hasOlder:hasOlder};},
    whenReady:function(paths){var key=reportPeriod()&&periodKey(reportPeriod()),scope=activeScope;return new Promise(function(resolve,reject){var started=Date.now();function check(){if(activeScope!==scope||key!==(reportPeriod()&&periodKey(reportPeriod())))return reject(new Error('The reporting period changed. Apply the current selection again.'));var list=paths.map(function(path){return entries[path];}),bad=list.find(function(e){return e&&e.error;});if(bad)return reject(bad.error);if(list.every(function(e){return e&&!e.loading&&e.last;}))return resolve(true);if(Date.now()-started>30000)return reject(new Error('The selected report is still loading. Check your connection and retry.'));setTimeout(check,80);}check();});},
    historyStatus:function(path){var e=entries[path],s=HISTORY_BOUNDS[path];return {bounded:!!s,ready:!!(e&&e.last&&!e.loading&&!e.error),loading:!!(e&&e.loading),error:e&&e.error,periodKey:e&&e.periodKey,loaded:e?Object.keys(Object.assign({},e.older||{},e.live||{})).length:0,hasOlder:e?e.hasOlder:false};},stats:function(){var attached=Object.keys(entries).filter(function(k){return !!entries[k].unsub;});return {authorized:authorized,activeScope:activeScope,attached:attached,attachedCount:attached.length,registeredPaths:Object.keys(entries).length};}
  };
}

export{HISTORY_BOUNDS,HISTORY_TAB_PATHS,createSubscriptionHub};
