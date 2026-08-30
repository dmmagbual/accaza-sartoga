import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/books/business-intelligence.js','utf8');
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
if(!/src\/books\/business-intelligence\.js/.test(books)||!/src\/books\/business-intelligence\.js/.test(sw))throw new Error('Key Metrics engine is not loaded and cached');
if(!/accaza-books-build" content="78"/.test(books)||!/build v78/.test(books))throw new Error('Books build 78 markers are not synchronized');
if(manifest.builds.books!==78||manifest.builds.serviceWorkerCache!==351)throw new Error('Release manifest build markers are not synchronized');
if(!/const CACHE='accaza-v351'/.test(sw))throw new Error('Service worker cache 351 is not synchronized');
if(!manifest.authoritativeFiles.includes('src/books/business-intelligence.js')||!manifest.authoritativeFiles.includes('src/books/app/35-business-intelligence.js'))throw new Error('Business intelligence sources are missing from authoritative files');
if(!/\.bi-confidence\.verified/.test(css)||!/\.bi-hero/.test(css))throw new Error('Key Metrics visual states are missing');

const context={window:{},console};
vm.createContext(context);
vm.runInContext(source,context,{filename:'35-business-intelligence.js'});
const helpers=context.window.AccazaBusinessIntelligenceTest;
if(helpers.shift('2026-03-01',-1)!=='2026-02-28')throw new Error('Prior-period date shift is incorrect');
if(helpers.shiftYear('2024-02-29',-1)!=='2023-02-28')throw new Error('Leap-year comparison is incorrect');
if(helpers.delta(120,100)!==20)throw new Error('Variance calculation is incorrect');
if(helpers.delta(10,0)!==null)throw new Error('Zero-base variance must be unavailable');

console.log('Business intelligence checks passed.');
