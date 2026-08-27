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
if(!core.includes("subscriptionHub.subscribe('orders',snap=>{overviewOrdersMap="))throw new Error('Admin Overview does not retain the authoritative orders feed.');
if(!core.includes("get(ref(db,'orders'))")||!core.includes("get(ref(db,'archivedOrders'))"))throw new Error('Admin Overview does not independently fetch the complete order and archive collections.');
if(!core.includes('_mergedMap(fullHistory.orders,overviewOrdersMap)')||!core.includes('_mergedMap(fullHistory.archived,archivedOrdersMap)'))throw new Error('Admin Overview does not preserve newer live records while reconciling its complete snapshot.');
if(!core.includes('orders:historyOrders')||!core.includes('mergeOverviewOrders([],historyOrders,archived)')||!core.includes('const sales=reconciledSales.filter(_isSale)'))throw new Error('Admin Overview is not calculating sales from the same orders plus archived-orders universe as Sales History.');
console.log('PASS: Overview attaches, retains, and calculates from live order history before another Finance tab is opened.');
