globalThis.window={AccazaDate:{key(){return'2026-09-02';}},AccazaSales:{
  status(order){return order.status==='Archived'?(order.prevStatus||''):order.status;},
  qualifies(order){var status=this.status(order);return !!order&&!order.voided&&order.paymentStatus!=='pending'&&(status==='Completed'||status==='Received');},
  amounts(order){var gross=Number(order.subtotal!=null?order.subtotal:order.total)||0,discount=Number(order.discount)||0,refund=Number(order.refundAmount)||0;return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};},
  stamp(order){return Number(order.completedAt)||Number(order.receivedAt)||Number(order.timestamp)||0;}
}};

const {buildDrinkRanking,overviewDayRange,overviewRankingRange}=await import('../assets/js/admin/overview-insights.mjs');
const day=overviewDayRange('2026-09-02'),inside=Date.parse('2026-09-02T12:00:00+08:00'),outside=Date.parse('2026-09-03T00:00:00+08:00');
const data={
  menuItems:{espresso:{name:'Espresso',cat:'coffee'},croissant:{name:'Croissant',cat:'pastry'},latte:{name:'Latte',cat:'coffee'},mocha:{name:'Mocha',cat:'coffee'}},
  catType:{coffee:'drink',pastry:'food'},drinkCategories:['coffee']
};
const sales=[
  {id:'completed',status:'Completed',paymentStatus:'confirmed',completedAt:inside,subtotal:350,total:350,lineItems:[{itemKey:'espresso',name:'Espresso',qty:2,unitTotal:100},{itemKey:'croissant',name:'Croissant',qty:3,unitTotal:50}]},
  {id:'received-archived',status:'Archived',prevStatus:'Received',paymentStatus:'confirmed',receivedAt:inside,subtotal:150,total:100,refundAmount:50,lineItems:[{itemKey:'latte',name:'Latte',qty:1,unitTotal:150}]},
  {id:'fully-refunded',status:'Completed',paymentStatus:'confirmed',completedAt:inside,subtotal:180,total:0,refundAmount:180,lineItems:[{itemKey:'mocha',name:'Mocha',qty:1,unitTotal:180}]},
  {id:'pending',status:'Completed',paymentStatus:'pending',completedAt:inside,subtotal:500,total:500,lineItems:[{itemKey:'espresso',name:'Espresso',qty:5,unitTotal:100}]},
  {id:'voided',status:'Completed',paymentStatus:'confirmed',voided:true,completedAt:inside,subtotal:400,total:400,lineItems:[{itemKey:'espresso',name:'Espresso',qty:4,unitTotal:100}]},
  {id:'outside',status:'Completed',paymentStatus:'confirmed',completedAt:outside,subtotal:700,total:700,lineItems:[{itemKey:'espresso',name:'Espresso',qty:7,unitTotal:100}]}
];
const ranking=buildDrinkRanking(sales,data,day);
if(ranking.totalUnits!==4)throw new Error('Full ranking total does not equal the completed Sales History drink quantities for the date.');
if(ranking.orderCount!==3)throw new Error('Full ranking did not count the exact completed Sales History orders containing drinks.');
if(ranking.items.length!==3)throw new Error('Full ranking included food, zero-sale menu items, pending/voided sales, or the wrong date.');
const byKey=Object.fromEntries(ranking.items.map((item)=>[item.key,item]));
if(byKey.espresso.units!==2||Math.round(byKey.espresso.revenue)!==200)throw new Error('Completed drink quantity or revenue was calculated incorrectly.');
if(byKey.latte.units!==1||Math.round(byKey.latte.revenue)!==100)throw new Error('Partial refunds were not allocated to net revenue correctly.');
if(byKey.mocha.units!==1||Math.round(byKey.mocha.revenue)!==0)throw new Error('A completed fully refunded sale changed item units even though the refund has no item-level quantity.');
const period=overviewRankingRange('2026-08-01','2026-08-31');
if(period.from!=='2026-08-01'||period.to!=='2026-08-31'||period.start!==Date.parse('2026-08-01T00:00:00+08:00')||period.end!==Date.parse('2026-08-31T23:59:59.999+08:00'))throw new Error('Full ranking custom date range does not use Philippine calendar boundaries.');
const fs=await import('node:fs/promises');
const [html,source,styles]=await Promise.all([fs.readFile(new URL('../src/html/admin/60-overlays.html',import.meta.url),'utf8'),fs.readFile(new URL('../assets/js/admin/overview-insights.mjs',import.meta.url),'utf8'),fs.readFile(new URL('../assets/css/admin-backoffice.css',import.meta.url),'utf8')]);
if(!html.includes('id="printDrinkRankingBtn"')||!source.includes("document.title='Accaza Drink Ranking - '")||!source.includes('window.print()')||!styles.includes('body.overview-ranking-print #drinkRankingModal'))throw new Error('Full ranking PDF print action or complete-list print layout is missing.');
for(const marker of ['id="drinkRankingFrom"','id="drinkRankingTo"','id="drinkRankingMonth"','id="drinkRankingApply"'])if(!html.includes(marker))throw new Error('Full ranking date range or monthly filter is missing: '+marker);
console.log('PASS: Full drink ranking uses the Sales History sale authority, Manila date, drink-only lines, and exact completed unit total.');
