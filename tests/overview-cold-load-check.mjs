const attached=[];
const ops={
  ref(_db,path){return{path};},
  onValue(target,callback){attached.push(target.path);callback({val(){return{};}});return function(){};},
  onChildAdded(){return function(){};},onChildChanged(){return function(){};},onChildRemoved(){return function(){};},
  query(target){return target;},orderByChild(){return{};},limitToLast(){return{};},endBefore(){return{};},
  // Bootstrapped incremental paths (orders included) attach via a one-shot get() followed
  // by child listeners, so a get() on a live target counts as attaching the feed.
  async get(target){if(target&&target.path)attached.push(target.path);return{val(){return{};},forEach(){}};}
};
const {createSubscriptionHub}=await import('../assets/js/admin/realtime-hub.mjs');
const hub=createSubscriptionHub({},ops);
hub.subscribe('orders',function(){});
hub.authorize();
if(!attached.includes('orders'))throw new Error('Overview dashboard did not attach the live orders feed on cold load.');
const fs=await import('node:fs/promises');
const core=await fs.readFile(new URL('../assets/js/admin/core.mjs',import.meta.url),'utf8');
const overview=await fs.readFile(new URL('../assets/js/admin/overview-command.mjs',import.meta.url),'utf8');
const operations=await fs.readFile(new URL('../assets/js/admin/operations-dashboard.js',import.meta.url),'utf8');
const functions=await fs.readFile(new URL('../functions/index.js',import.meta.url),'utf8');
if(overview.includes('setInterval(()=>loadExceptions(true),60000)')||overview.includes('setInterval(loadExceptions'))throw new Error('System-health browser polling must not run every minute.');
for(const marker of ['window.__accazaSystemHealth','getCached:function','run:function'])if(!overview.includes(marker))throw new Error(`Manual-only system-health safeguard is missing: ${marker}`);
for(const marker of ['SYSTEM_HEALTH_AUTO_RUN_KEY','SYSTEM_HEALTH_INTERVAL_MS','recordAutoRun','ensureDaily:function'])if(overview.includes(marker))throw new Error(`System Health must not retain an automatic scan path: ${marker}`);
if(!overview.includes('api.getOperationalExceptions(force)')||!core.includes('getOperationalExceptions:function(force)')||!core.includes('{force:force===true}'))throw new Error('Manual System Health must be the only client path that requests a forced server scan.');
if(!overview.includes('Number(exceptionData&&exceptionData.generatedAt)||0'))throw new Error('System Health must display the shared manual scan time instead of the browser request time.');
for(const marker of ['if (!force) return cachedOperationalResult(cached) || emptyOperationalResult()','getCachedOperationalExceptions','OPERATIONAL_EXCEPTION_LOCK_PATH','limitToLast(500)','request.data && request.data.force === true'])if(!functions.includes(marker))throw new Error(`Shared server-side manual-only System Health safeguard is missing: ${marker}`);
if((functions.match(/scanOperationalExceptions\(db,\s*now\)/g)||[]).length!==2)throw new Error('Certification, validation, and scheduled health must reuse the shared scan cache instead of starting independent scans.');
for(const marker of ['Run health check now','Last checked:','getOperationalExceptions(force)','sharedExceptionData()'])if(!operations.includes(marker))throw new Error(`Manual system-health control is missing: ${marker}`);
if(!core.includes("subscriptionHub.subscribe('orders',snap=>{overviewOrdersMap="))throw new Error('Admin Overview does not retain the authoritative orders feed.');
if(!core.includes("readSalesPeriod(db,")||!core.includes("subscriptionHub.readHistoricalPeriod(p)"))throw new Error('Admin Overview must read complete order history and the Firestore archived-order replica for the selected dates.');
if(!core.includes('const historyOrders=_rows(overviewOrdersMap)')||!core.includes('const archived=_rows(archivedOrdersMap)'))throw new Error('Overview must prefer complete live maps over stale snapshots, including removals.');
if(!core.includes('orders:historyOrders')||!core.includes('mergeOverviewOrders([],historyOrders,archived)')||!core.includes('const sales=reconciledSales.filter(_isSale)'))throw new Error('Admin Overview is not calculating sales from the same orders plus archived-orders universe as Sales History.');
console.log('PASS: Overview attaches, retains, and calculates from live order history before another Finance tab is opened.');
