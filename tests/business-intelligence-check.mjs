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
if(!/accaza-books-build" content="137"/.test(books)||!/build v137/.test(books))throw new Error('Books build markers are not synchronized');
if(manifest.builds.admin!==627||manifest.builds.books!==137||manifest.builds.serviceWorkerCache!==614)throw new Error('Release manifest build markers are not synchronized');
