import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const subscriptions=read('src/customer/core/04-realtime-subscriptions.mjs');
const reservations=read('src/customer/core/11-reservations.mjs');
const reviews=read('src/customer/core/14-public-reviews.mjs');
const startup=read('src/customer/core/16-startup-ui.mjs');
const customer=read('assets/js/customer/core.mjs');

const visibilityFunction=reservations.match(/function visibleReservations[^\r\n]+/)?.[0];
assert.ok(visibilityFunction,'Customer reservations must define the active owner visibility policy');
const visibilityContext={};
vm.runInNewContext(`${visibilityFunction};this.visibleReservations=visibleReservations;`,visibilityContext);
const visibleReservationRows=visibilityContext.visibleReservations(
  ['mine-pending','mine-completed','other-accepted','mine-archived','mine-declined','legacy'],
  {
    'mine-pending':{id:'mine-pending',ownerUid:'customer-a',status:'Pending',timestamp:100},
    'mine-completed':{id:'mine-completed',ownerUid:'customer-a',status:'Completed',timestamp:600},
    'other-accepted':{id:'other-accepted',ownerUid:'customer-b',status:'Accepted',timestamp:500},
    'mine-archived':{id:'mine-archived',ownerUid:'customer-a',status:'Archived',timestamp:400},
    'mine-declined':{id:'mine-declined',ownerUid:'customer-a',status:'Declined',timestamp:300},
    legacy:{id:'legacy',status:'Pending',timestamp:200}
  },
  'customer-a'
);
assert.deepEqual(
  Array.from(visibleReservationRows,function(reservation){return reservation.id;}),
  ['mine-declined','mine-pending'],
  'Customer cards must keep active owner records only, while hiding completed, archived, legacy, and other-owner records'
);

if(subscriptions.includes('onValue(reviewsRef'))throw new Error('Public reviews must not keep a whole-node realtime listener');
if(subscriptions.includes('onValue(calBlocksRef'))throw new Error('Customer calendar must not keep an unbounded realtime listener');
for(const source of [subscriptions])for(const marker of ['function applyCategoriesSnapshot(snap)','function applyOptionGroupsSnapshot(snap)','function applyMenuSnapshot(snap)'])if(!source.includes(marker))throw new Error(`Catalog snapshot adapter missing: ${marker}`);
if(subscriptions.includes('onValue(categoriesRef')||subscriptions.includes('onValue(optionGroupsRef')||subscriptions.includes('onValue(menuRef'))throw new Error('Public catalog must not keep whole-node realtime listeners');
for(const marker of [
  'var _publicCatalogVersionKey=\'bootstrap\'',
  'var PUBLIC_CATALOG_CACHE_KEY=\'accaza_public_catalog_v1\'',
  'get(categoriesRef),get(optionGroupsRef),get(menuRef),get(packagesRef)',
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
  '_publicReviewsLoaded||_publicReviewsLoading'
])if(!reviews.includes(marker))throw new Error(`Bounded public review read safeguard missing: ${marker}`);
if(reviews.includes('set(reviewsRef,DEFAULT_PUBLIC_REVIEWS)'))throw new Error('Anonymous public review fallback must remain display-only');
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
for(const marker of ['exports.updatePublicCatalogVersionOnCategories = onValueWritten','exports.updatePublicCatalogVersionOnMenuItems = onValueWritten','exports.updatePublicCatalogVersionOnOptionGroups = onValueWritten','exports.updatePublicCatalogVersionOnPackages = onValueWritten','/publicCatalogVersion'])if(!functions.includes(marker))throw new Error(`Catalog version trigger safeguard missing: ${marker}`);

console.log('PASS: customer calendar/reviews reads are deferred and bounded, and catalog payloads are version-gated and locally cached.');
