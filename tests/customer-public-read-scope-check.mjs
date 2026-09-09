import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const subscriptions=read('src/customer/core/04-realtime-subscriptions.mjs');
const reservations=read('src/customer/core/11-reservations.mjs');
const reviews=read('src/customer/core/14-public-reviews.mjs');
const startup=read('src/customer/core/16-startup-ui.mjs');
const customer=read('assets/js/customer/core.mjs');

if(subscriptions.includes('onValue(reviewsRef'))throw new Error('Public reviews must not keep a whole-node realtime listener');
if(subscriptions.includes('onValue(calBlocksRef'))throw new Error('Customer calendar must not keep an unbounded realtime listener');
for(const source of [subscriptions])for(const marker of ['function applyCategoriesSnapshot(snap)','function applyOptionGroupsSnapshot(snap)','function applyMenuSnapshot(snap)'])if(!source.includes(marker))throw new Error(`Catalog snapshot adapter missing: ${marker}`);
if(subscriptions.includes('onValue(categoriesRef')||subscriptions.includes('onValue(optionGroupsRef')||subscriptions.includes('onValue(menuRef'))throw new Error('Public catalog must not keep whole-node realtime listeners');
for(const marker of [
  'var _publicCatalogVersionKey=\'bootstrap\'',
  'var PUBLIC_CATALOG_CACHE_KEY=\'accaza_public_catalog_v1\'',
  'get(categoriesRef),get(optionGroupsRef),get(menuRef)',
  'onValue(publicCatalogVersionRef',
  'localStorage.setItem(PUBLIC_CATALOG_CACHE_KEY'
])if(!subscriptions.includes(marker))throw new Error(`Version-gated public catalog safeguard missing: ${marker}`);
for(const marker of [
  "window.__loadCustomerCalendarBlocks",
  "query(calBlocksRef,orderByKey(),startAt(monthPrefix+'01'),endAt(monthPrefix+String(lastDay).padStart(2,'0')))",
  'window.__customerCalendarBlocksLoading=true',
  'if(requestId!==_customerCalendarBlocksRequest)return'
])if(!subscriptions.includes(marker))throw new Error(`Bounded customer calendar read safeguard missing: ${marker}`);
for(const marker of [
  'if(window.__customerCalendarBlocksLoading)return\'loading\'',
  'status!==\'loading\'',
  'window.__loadCustomerCalendarBlocks(calYear,calMonth)'
])if(!reservations.includes(marker))throw new Error(`Calendar loading-state safeguard missing: ${marker}`);
for(const marker of [
  'window.__loadPublicReviews=async function()',
  'get(query(reviewsRef,orderByKey(),limitToLast(20)))',
  '_publicReviewsLoaded||_publicReviewsLoading',
  'set(reviewsRef,DEFAULT_PUBLIC_REVIEWS).catch(function(){})'
])if(!reviews.includes(marker))throw new Error(`Bounded public review read safeguard missing: ${marker}`);
for(const marker of [
  "defer('reserve',function(){renderCustomerCalendar();})",
  "defer('reviews',function(){if(window.__loadPublicReviews)window.__loadPublicReviews();})",
  'IntersectionObserver'
])if(!startup.includes(marker))throw new Error(`Deferred public read trigger missing: ${marker}`);
for(const marker of [
  "query(calBlocksRef,orderByKey(),startAt(monthPrefix+'01'),endAt(monthPrefix+String(lastDay).padStart(2,'0')))",
  'get(query(reviewsRef,orderByKey(),limitToLast(20))',
  "defer('reviews'",
  'publicCatalogVersionRef'
])if(!customer.includes(marker))throw new Error(`Generated customer runtime is missing scoped public read behavior: ${marker}`);

const rules=read('database.rules.json');
if(!rules.includes('"publicCatalogVersion": { ".read": true, ".write": false }'))throw new Error('Public catalog version must be readable but immutable to clients');
const functions=read('functions/index.js');
for(const marker of ['exports.updatePublicCatalogVersionOnCategories = onValueWritten','exports.updatePublicCatalogVersionOnMenuItems = onValueWritten','exports.updatePublicCatalogVersionOnOptionGroups = onValueWritten','/publicCatalogVersion'])if(!functions.includes(marker))throw new Error(`Catalog version trigger safeguard missing: ${marker}`);

console.log('PASS: customer calendar/reviews reads are deferred and bounded, and catalog payloads are version-gated and locally cached.');
