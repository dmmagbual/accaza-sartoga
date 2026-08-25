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
console.log('PASS: Overview dashboard attaches live orders before another Finance tab is opened.');
