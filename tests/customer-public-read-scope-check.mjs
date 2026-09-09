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
  "defer('reviews'"
])if(!customer.includes(marker))throw new Error(`Generated customer runtime is missing scoped public read behavior: ${marker}`);

console.log('PASS: customer calendar reads are month-bounded and public reviews are deferred and capped at 20 records.');
