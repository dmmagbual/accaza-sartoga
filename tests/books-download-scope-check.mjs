import fs from 'node:fs';
import './firebase-bandwidth-guard-check.mjs';

const live=fs.readFileSync('assets/js/books/live-pos.mjs','utf8');
const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');

for(const marker of [
  'OPTIONAL_FEEDS',
  "window.__booksCurrentTab=CURRENT",
  "CustomEvent('accaza-books-tab'",
  "window.addEventListener('accaza-books-tab'",
  'function syncOptionalFeeds()',
  'else stopOptionalFeed(name)',
  'startAt(monthStart)',
  'openingCarry(month)',
  'ref(db,"/books/monthlyNet")',
  "financialMovements:{tabs:['cashflow']",
  "platformPayouts:{tabs:['cashflow']",
  "cashCustody:{tabs:['cashflow']",
  "purchaseInvoices:{tabs:['purchases']",
  "fixedAssets:{tabs:['fixedassets']",
  "menuItems:{tabs:['insights']",
  "menuCategories:{tabs:['insights']",
  "personalFundings:{tabs:['transactions']"
]){
  if(!live.includes(marker)&&!shell.includes(marker))throw new Error(`Books lazy-feed safeguard missing: ${marker}`);
}

for(const broad of [
  'booksStops.push(watchMap(ref(db,"/financialMovements")',
  'booksStops.push(watchMap(ref(db,"/platformPayouts")',
  'booksStops.push(watchMap(ref(db,"/cashCustody")',
  'booksStops.push(watchMap(ref(db,"/suppliers")',
  'booksStops.push(watchMap(ref(db,"/purchaseInvoices")',
  'booksStops.push(watchMap(ref(db,"/fixedAssets")',
  'booksStops.push(watchMap(ref(db,"/personalFundings")'
]){
  if(live.includes(broad))throw new Error(`Optional Books feed still attaches at sign-in: ${broad}`);
}

console.log('Finance Books download-scope checks passed.');
