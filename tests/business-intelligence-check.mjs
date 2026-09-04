import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/books/business-intelligence.js','utf8');
const salesAuthority=fs.readFileSync('assets/js/shared/sales-authority.js','utf8');
const registration=fs.readFileSync('src/books/app/35-business-intelligence.js','utf8');
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const books=fs.readFileSync('books.html','utf8');
const css=fs.readFileSync('assets/css/books.css','utf8');
const livePos=fs.readFileSync('assets/js/books/live-pos.mjs','utf8');
const salePersistence=fs.readFileSync('src/admin/pos/50f-sale-persistence.js','utf8');
const manifest=JSON.parse(fs.readFileSync('release-manifest.json','utf8'));
const sw=fs.readFileSync('sw.js','utf8');

const required=[
  ['read-only safeguard',/performs no writes/],
  ['equal-period comparison',/immediately preceding equal-length period|previous equal-length period/],
  ['confidence labels',/Ledger verified/],
  ['source reconciliation',/Sales-source review required/],
  ['break-even disclosure',/planning estimate/],
  ['retention guard',/Stable consented customer identity/],
  ['inventory estimate disclosure',/average inventory history not yet available/]
];
for(const [name,pattern] of required)if(!pattern.test(source))throw new Error(`Business intelligence missing ${name}`);
if(!/id:"insights",label:"Key Metrics"/.test(shell))throw new Error('Key Metrics tab is not registered');
if(!/PAGES\.insights=function/.test(registration))throw new Error('Key Metrics page is not registered');
if(!/assets\/js\/shared\/sales-authority\.js/.test(books)||!/src\/books\/business-intelligence\.js/.test(books)||!/src\/books\/business-intelligence\.js/.test(sw))throw new Error('Key Metrics engine and shared sales authority are not loaded and cached');
if(!/accaza-books-build" content="97"/.test(books)||!/build v97/.test(books))throw new Error('Books build 97 markers are not synchronized');
if(manifest.builds.admin!==445||manifest.builds.books!==97||manifest.builds.serviceWorkerCache!==408)throw new Error('Release manifest build markers are not synchronized');
if(!/const CACHE='accaza-v408'/.test(sw))throw new Error('Service worker cache 408 is not synchronized');
if(!manifest.authoritativeFiles.includes('src/books/business-intelligence.js')||!manifest.authoritativeFiles.includes('src/books/app/35-business-intelligence.js'))throw new Error('Business intelligence sources are missing from authoritative files');
if(!/\.bi-confidence\.verified/.test(css)||!/\.bi-hero/.test(css))throw new Error('Key Metrics visual states are missing');
if(!/__booksMenuItems/.test(livePos)||!/__booksMenuCategories/.test(livePos))throw new Error('Books must load the menu catalog needed to classify legacy order lines');
if(!/categoryId:categoryId,categoryName:category\.label/.test(salePersistence))throw new Error('New POS order lines must preserve their menu-category snapshot');

const context={window:{},console,r2:value=>Math.round((Number(value)||0)*100)/100};
vm.createContext(context);
vm.runInContext(fs.readFileSync('assets/js/shared/business-date.js','utf8'),context);
vm.runInContext(salesAuthority,context,{filename:'sales-authority.js'});
vm.runInContext(source,context,{filename:'35-business-intelligence.js'});
const helpers=context.window.AccazaBusinessIntelligenceTest;
if(helpers.shift('2026-03-01',-1)!=='2026-02-28')throw new Error('Prior-period date shift is incorrect');
if(helpers.shiftYear('2024-02-29',-1)!=='2023-02-28')throw new Error('Leap-year comparison is incorrect');
if(helpers.delta(120,100)!==20)throw new Error('Variance calculation is incorrect');
if(helpers.delta(10,0)!==null)throw new Error('Zero-base variance must be unavailable');
context.window.__booksActiveOrders={open:{source:'pos',status:'Preparing',paymentStatus:'confirmed',timestamp:1,total:7080.80},pending:{source:'pos',status:'Completed',paymentStatus:'pending',timestamp:2,total:50},paid:{source:'pos',status:'Completed',paymentStatus:'confirmed',completedAt:3,subtotal:120,discount:10,refundAmount:5},online:{source:'online',channel:'online',status:'Completed',paymentStatus:'confirmed',completedAt:5,total:260},voided:{source:'pos',status:'Completed',paymentStatus:'confirmed',voided:true,total:90}};
context.window.__booksArchivedOrders={archived:{source:'pos',status:'Archived',prevStatus:'Received',paymentStatus:'confirmed',completedAt:4,subtotal:200,refundAmount:20}};
const recognized=helpers.orders();
if(recognized.length!==3||!recognized.some(x=>x.id==='paid')||!recognized.some(x=>x.id==='archived')||!recognized.some(x=>x.id==='online'))throw new Error('Order snapshots must include all completed paid sales, including archived POS and online/PWA orders');
if(helpers.orderAmount(recognized.find(x=>x.id==='online'))!==260)throw new Error('Completed online/PWA order snapshots must reconcile to their ledger sale');
if(helpers.orderAmount(recognized.find(x=>x.id==='paid'))!==105||helpers.orderAmount(recognized.find(x=>x.id==='archived'))!==180)throw new Error('Order snapshot amounts must use the shared Admin net-sales treatment');
if(helpers.orderDate(recognized.find(x=>x.id==='archived'))!=='1970-01-01')throw new Error('Order snapshot dates must use the shared completed-sale timestamp authority');
context.window.__booksMenuCategories={coffee:{id:'coffee',label:'Coffee Based',order:0},noncaf:{id:'noncaf',label:'Non-Coffee Based',order:1}};
context.window.__booksMenuItems={latte:{name:'Cafe Latte',cat:'coffee'},matcha:{name:'Matcha Latte',cat:'noncaf'}};
const categoryRows=helpers.categories([{total:500,subtotal:500,lineItems:[{itemKey:'latte',name:'Cafe Latte (M)',categoryId:'coffee',categoryName:'Coffee Based',qty:2,unitTotal:100},{itemKey:'americano',name:'Americano',categoryId:'coffee',categoryName:'Coffee Based',qty:3,unitTotal:50},{itemKey:'matcha',name:'Old Matcha Name',qty:1,unitTotal:150}]}]);
if(categoryRows.length!==2||categoryRows[0].name!=='Coffee Based'||categoryRows[0].top.name!=='Americano'||categoryRows[0].top.qty!==3)throw new Error('Menu categories must identify their best-selling item by units');
if(categoryRows[1].name!=='Non-Coffee Based'||categoryRows[1].top.name!=='Matcha Latte'||categoryRows[1].usesCatalog!==true)throw new Error('Legacy order lines must map through the current menu catalog by item key');

const discounted=helpers.categories([{subtotal:200,total:180,discount:20,refundAmount:20,lineItems:[{itemKey:'latte',qty:2,unitTotal:100}]}]);
if(discounted[0].sales!==160||discounted[0].top.sales!==160)throw new Error('Category allocations must preserve net sales after discounts and refunds');
const unmapped=helpers.categories([{subtotal:100,total:100,lineItems:[{itemKey:'deleted',name:'Historical item',qty:1,unitTotal:100}]}]);
if(unmapped[0].name!=='Uncategorized'||!unmapped[0].unavailable)throw new Error('Unmatched legacy items must remain explicitly unclassified');
console.log('Business intelligence checks passed.');
