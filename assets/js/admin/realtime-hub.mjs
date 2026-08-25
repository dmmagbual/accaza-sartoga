// One physical Realtime Database listener per path. POS-critical paths stay
// live; large back-office paths attach only for the active workspace.
const HISTORY_BOUNDS={
  orders:{field:'timestamp',limit:250,page:250},archivedOrders:{field:'archivedAt',limit:100,page:100},archivedReservations:{field:'archivedAt',limit:100,page:100},
  shifts:{field:'openAt',limit:100,page:100},activityLog:{field:'ts',limit:200,page:200},discrepancies:{field:'ts',limit:200,page:200},
  stockReceipts:{field:'ts',limit:250,page:250},purchaseInvoices:{field:'ts',limit:250,page:250},inventoryAdjustments:{field:'ts',limit:250,page:250},internalUsage:{field:'ts',limit:250,page:250},
  cfLedger:{field:'ts',limit:300,page:300},financialMovements:{field:'occurredAt',limit:300,page:300},platformPayouts:{field:'settledAt',limit:100,page:100},inventoryMovements:{field:'occurredAt',limit:300,page:300}
};
const HISTORY_TAB_PATHS={saleshistory:['orders','archivedOrders','financialMovements'],analytics:['orders','archivedOrders'],pnl:['orders','archivedOrders','internalUsage','inventoryAdjustments','platformPayouts'],payouts:['orders','archivedOrders','platformPayouts','financialMovements'],stockvalue:['orders','archivedOrders','stockReceipts','inventoryAdjustments','internalUsage','inventoryMovements','financialMovements'],dailyreport:['orders','archivedOrders'],cashflow:['orders','archivedOrders','cfLedger','financialMovements','platformPayouts'],receivables:['orders','archivedOrders','financialMovements'],purchases:['purchaseInvoices','stockReceipts','inventoryMovements'],usage:['internalUsage','inventoryMovements'],inventory:['inventoryMovements'],ops:['shifts','activityLog'],discrepancy:['discrepancies'],reservations:['archivedReservations']};

function createSubscriptionHub(database,ops){
  const {ref,onValue,query,orderByChild,limitToLast,endBefore,get}=ops;
  function liveTarget(path){var base=ref(database,path),spec=HISTORY_BOUNDS[path];return spec?query(base,orderByChild(spec.field),limitToLast(spec.limit)):base;}
  var entries={},authorized=false,activeScope='dashboard',nextId=1;
  var critical={categories:1,settings:1,posSettings:1,activeOrders:1,optionGroups:1,menuItems:1,availability:1,channelPrices:1,posStaff:1,posActiveShift:1,packages:1,'.info/connected':1};
  var scopes={
    orders:['saleshistory','analytics','pnl','payouts','stockvalue','dailyreport','cashflow','receivables'],staffAccounts:['staffaccounts'],adminAccounts:['adminaccounts'],admins:['staffaccess'],adminPerms:['staffaccess'],
    archivedOrders:['dashboard','archive','appcustomers','saleshistory','analytics','pnl','payouts','stockvalue','cashflow','receivables','dailyreport'],archivedReservations:['reservations','calendar'],reservations:['dashboard','reservations','calendar'],
    feedbacks:['comments','analytics'],reviews:['dashboard','reviews','analytics'],payment:['payment'],calBlocks:['reservations','calendar'],appCustomers:['appcustomers','analytics'],inventory:['inventory','purchases','recipes','usage','stockvalue'],inventoryMovements:['inventory','purchases','usage','stockvalue'],
    recipes:['recipes','usage','analytics','pnl'],optionRecipes:['recipes','usage'],internalUsage:['usage','pnl','stockvalue'],usageTypes:['usage'],expenseItems:['pnl'],monthlyExpenses:['pnl'],inventoryAdjustments:['pnl','stockvalue'],stockReceipts:['purchases','stockvalue'],purchaseInvoices:['purchases'],
    platformPayouts:['payouts','pnl','analytics','cashflow','receivables'],platformVarAccounts:['payouts','pnl'],shifts:['ops'],activityLog:['ops'],heldOrders:['pos','ops'],discrepancies:['discrepancy'],
    pettyCashVouchers:['petty'],pettyCashReplenishments:['petty'],pettyCashSettings:['petty'],cfAccounts:['purchases','cashflow','receivables','payables'],cfLedger:['cashflow'],'books/journal':['stockvalue'],financialMovements:['cashflow','receivables','payables','payouts','saleshistory'],chartOfAccounts:['cashflow'],cashCustody:['cashflow'],receivables:['receivables'],payables:['payables']
  };
  function policy(path,opts){opts=opts||{};return {critical:opts.critical===true||critical[path]===1,scopes:opts.scopes||scopes[path]||[]};}
  function consumerActive(c){return authorized&&(c.critical||c.scopes.indexOf(activeScope)>-1);}
  function reportError(path,error){console.error('ACCAZA LIVE DATA ERROR ['+path+']',error);try{(window.accazaToast||function(){})('Live data failed for '+path+'. Check connection or access.','err');}catch(_e){}}
  function facade(entry){var merged=Object.assign({},entry.older||{},entry.live||{});return {val:function(){return merged;},exists:function(){return Object.keys(merged).length>0;}};}
  function dispatch(entry,snapshot){entry.last=snapshot;Object.keys(entry.consumers).forEach(function(id){var c=entry.consumers[id];if(consumerActive(c)){try{c.callback(snapshot);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function attach(entry){entry.unsub=onValue(liveTarget(entry.path),function(snapshot){if(HISTORY_BOUNDS[entry.path]){entry.live=snapshot.val()||{};entry.hasOlder=Object.keys(entry.live).length>=HISTORY_BOUNDS[entry.path].limit;dispatch(entry,facade(entry));}else dispatch(entry,snapshot);},function(error){entry.unsub=null;reportError(entry.path,error);});}
  function reconcileEntry(entry){var ids=Object.keys(entry.consumers),needed=ids.some(function(id){return consumerActive(entry.consumers[id]);}),wasAttached=!!entry.unsub;if(needed&&!entry.unsub)attach(entry);if(!needed&&entry.unsub){entry.unsub();entry.unsub=null;entry.last=null;}ids.forEach(function(id){var c=entry.consumers[id],now=consumerActive(c),becameActive=now&&!c.wasActive;c.wasActive=now;if(becameActive&&wasAttached&&entry.last){try{c.callback(entry.last);}catch(e){console.error('ACCAZA RENDER ERROR ['+entry.path+']',e);}}});}
  function reconcile(){Object.keys(entries).forEach(function(path){reconcileEntry(entries[path]);});}
  return {
    subscribe:function(path,callback,opts){var p=policy(path,opts),entry=entries[path]||(entries[path]={path:path,consumers:{},unsub:null,last:null,live:{},older:{},hasOlder:true}),id=String(nextId++);entry.consumers[id]={callback:callback,critical:p.critical,scopes:p.scopes,wasActive:false};reconcileEntry(entry);return function(){delete entry.consumers[id];reconcileEntry(entry);};},
    authorize:function(){authorized=true;try{performance.mark('accaza-live-start');}catch(_e){}reconcile();},deauthorize:function(){authorized=false;reconcile();},activate:function(scope){activeScope=scope||'dashboard';reconcile();},
    loadOlder:async function(path){var spec=HISTORY_BOUNDS[path],entry=entries[path];if(!spec||!entry)throw new Error('No paginated subscription for '+path);var merged=Object.assign({},entry.older||{},entry.live||{}),keys=Object.keys(merged),oldest=null;keys.forEach(function(k){var v=merged[k]||{},sv=Number(v[spec.field])||0;if(!oldest||sv<oldest.value||(sv===oldest.value&&k<oldest.key))oldest={value:sv,key:k};});if(!oldest){entry.hasOlder=false;return {loaded:0,hasOlder:false};}var snap=await get(query(ref(database,path),orderByChild(spec.field),endBefore(oldest.value,oldest.key),limitToLast(spec.page+1))),rows=[];snap.forEach(function(ch){rows.push({key:ch.key,value:ch.val()||{}});});var hasOlder=rows.length>spec.page;if(hasOlder)rows.shift();rows.forEach(function(r){entry.older[r.key]=r.value;});entry.hasOlder=hasOlder;dispatch(entry,facade(entry));return {loaded:rows.length,hasOlder:hasOlder};},
    historyStatus:function(path){var e=entries[path],s=HISTORY_BOUNDS[path];return {bounded:!!s,loaded:e?Object.keys(Object.assign({},e.older||{},e.live||{})).length:0,hasOlder:e?e.hasOlder:false};},stats:function(){var attached=Object.keys(entries).filter(function(k){return !!entries[k].unsub;});return {authorized:authorized,activeScope:activeScope,attached:attached,attachedCount:attached.length,registeredPaths:Object.keys(entries).length};}
  };
}

export{HISTORY_BOUNDS,HISTORY_TAB_PATHS,createSubscriptionHub};
