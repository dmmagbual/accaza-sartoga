const {createOverviewHistoryLoader}=await import('../assets/js/admin/overview-insights.mjs');

let rejectFirst,reads=0,delivered=null;
const first=new Promise(function(_resolve,reject){rejectFirst=reject;});
const loader=createOverviewHistoryLoader({
  read(){reads++;return reads===1?first:Promise.resolve({orders:{recent:{id:'recent'}},archived:{older:{id:'older'}}});},
  onData(data){delivered=data;},
  onError(){}
});

const initial=loader.load();
loader.load(); // bounded feeds refreshed while the pre-auth read was still pending
rejectFirst(new Error('PERMISSION_DENIED before auth'));await initial;
for(let i=0;i<10&&!delivered;i++)await new Promise(function(resolve){setTimeout(resolve,0);});
if(reads!==2)throw new Error('Overview discarded the authenticated retry queued during its failed startup read.');
if(!delivered||!delivered.orders.recent||!delivered.archived.older)throw new Error('Overview retry did not deliver complete orders and archived orders.');
if(!loader.snapshot().complete)throw new Error('Overview marked the retried complete history as incomplete.');
console.log('PASS: Overview retries a pre-auth history failure after bounded feeds refresh during the pending read.');
