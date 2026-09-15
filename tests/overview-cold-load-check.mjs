const attached=[];
const ops={
  ref(_db,path){return{path};},
  onValue(target,callback){attached.push(target.path);callback({val(){return{};}});return function(){};},
  query(target){return target;},orderByChild(){return{};},limitToLast(){return{};},endBefore(){return{};},
  async get(){return{forEach(){}};}
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
if(overview.includes('setInterval(()=>loadExceptions(true),60000)')||overview.includes('setInterval(loadExceptions'))throw new Error('System-health browser polling must not run every minute.');
for(const marker of ['SYSTEM_HEALTH_AUTO_RUN_KEY','SYSTEM_HEALTH_INTERVAL_MS','recordAutoRun','window.__accazaSystemHealth','ensureDaily:function','run:function'])if(!overview.includes(marker))throw new Error(`24-hour system-health safeguard is missing: ${marker}`);
for(const marker of ['Run health check now','Last checked:','getOperationalExceptions(force)','sharedExceptionData()'])if(!operations.includes(marker))throw new Error(`Manual system-health control is missing: ${marker}`);
if(!core.includes("subscriptionHub.subscribe('orders',snap=>{overviewOrdersMap="))throw new Error('Admin Overview does not retain the authoritative orders feed.');
if(!core.includes("readSalesPeriod(db,")||!core.includes("subscriptionHub.readHistoricalPeriod(p)"))throw new Error('Admin Overview must read complete order history and the Firestore archived-order replica for the selected dates.');
if(!core.includes('const historyOrders=_rows(overviewOrdersMap)')||!core.includes('const archived=_rows(archivedOrdersMap)'))throw new Error('Overview must prefer complete live maps over stale snapshots, including removals.');
if(!core.includes('orders:historyOrders')||!core.includes('mergeOverviewOrders([],historyOrders,archived)')||!core.includes('const sales=reconciledSales.filter(_isSale)'))throw new Error('Admin Overview is not calculating sales from the same orders plus archived-orders universe as Sales History.');
console.log('PASS: Overview attaches, retains, and calculates from live order history before another Finance tab is opened.');
