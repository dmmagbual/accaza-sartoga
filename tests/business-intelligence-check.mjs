import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/books/business-intelligence.js','utf8');
const salesAuthority=fs.readFileSync('assets/js/shared/sales-authority.js','utf8');
const registration=fs.readFileSync('src/books/app/35-business-intelligence.js','utf8');
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const books=fs.readFileSync('books.html','utf8');
const css=fs.readFileSync('assets/css/books.css','utf8');
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
if(!/accaza-books-build" content="79"/.test(books)||!/build v79/.test(books))throw new Error('Books build 79 markers are not synchronized');
if(manifest.builds.books!==79||manifest.builds.serviceWorkerCache!==352)throw new Error('Release manifest build markers are not synchronized');
if(!/const CACHE='accaza-v352'/.test(sw))throw new Error('Service worker cache 352 is not synchronized');
if(!manifest.authoritativeFiles.includes('src/books/business-intelligence.js')||!manifest.authoritativeFiles.includes('src/books/app/35-business-intelligence.js'))throw new Error('Business intelligence sources are missing from authoritative files');
if(!/\.bi-confidence\.verified/.test(css)||!/\.bi-hero/.test(css))throw new Error('Key Metrics visual states are missing');

const context={window:{},console};
vm.createContext(context);
vm.runInContext(salesAuthority,context,{filename:'sales-authority.js'});
vm.runInContext(source,context,{filename:'35-business-intelligence.js'});
const helpers=context.window.AccazaBusinessIntelligenceTest;
if(helpers.shift('2026-03-01',-1)!=='2026-02-28')throw new Error('Prior-period date shift is incorrect');
if(helpers.shiftYear('2024-02-29',-1)!=='2023-02-28')throw new Error('Leap-year comparison is incorrect');
if(helpers.delta(120,100)!==20)throw new Error('Variance calculation is incorrect');
if(helpers.delta(10,0)!==null)throw new Error('Zero-base variance must be unavailable');
context.window.__booksActiveOrders={open:{source:'pos',status:'Preparing',paymentStatus:'confirmed',timestamp:1,total:7080.80},pending:{source:'pos',status:'Completed',paymentStatus:'pending',timestamp:2,total:50},paid:{source:'pos',status:'Completed',paymentStatus:'confirmed',completedAt:3,subtotal:120,discount:10,refundAmount:5},voided:{source:'pos',status:'Completed',paymentStatus:'confirmed',voided:true,total:90}};
context.window.__booksArchivedOrders={archived:{source:'pos',status:'Archived',prevStatus:'Received',paymentStatus:'confirmed',completedAt:4,subtotal:200,refundAmount:20}};
const recognized=helpers.orders();
if(recognized.length!==2||!recognized.some(x=>x.id==='paid')||!recognized.some(x=>x.id==='archived'))throw new Error('Order snapshots must include only completed paid sales, including archived sales');
if(helpers.orderAmount(recognized.find(x=>x.id==='paid'))!==105||helpers.orderAmount(recognized.find(x=>x.id==='archived'))!==180)throw new Error('Order snapshot amounts must use the shared Admin net-sales treatment');
if(helpers.orderDate(recognized.find(x=>x.id==='archived'))!=='1970-01-01')throw new Error('Order snapshot dates must use the shared completed-sale timestamp authority');

console.log('Business intelligence checks passed.');
