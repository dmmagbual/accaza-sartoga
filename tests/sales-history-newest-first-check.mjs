import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHistoricalPeriodStore} from '../assets/js/admin/historical-period-store.mjs';

// Sales History lists newest first, so the first archived page must hold the
// newest sales. Ascending pages showed Oct 30 followed by Oct 4 with Oct 5-29
// missing until "Load older" had been pressed several times.
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const period = {startAt: 1000, endAt: 9999};
const source = {};
for (let i = 0; i < 250; i++) source['o' + String(i).padStart(3, '0')] = {id: 'o' + String(i).padStart(3, '0'), completedAt: 1000 + i * 10, total: 100};
source.tie = {id: 'tie', completedAt: 1000 + 150 * 10, total: 5}; // shares o150's stamp and straddles the page-1/page-2 boundary
const memory = () => { const map = new Map(); return {map, async get(k) { return map.has(k) ? structuredClone(map.get(k)) : undefined; }, async put(k, v) { map.set(k, structuredClone(v)); }, async clear() { map.clear(); }}; };

// Mirrors historicalPeriodPage: orderBy(stamp, direction), orderBy(id, direction), startAfter(cursor), limit+1.
let serverKnowsDirection = true;
function serverPage(payload) {
  const dir = serverKnowsDirection && payload.direction === 'desc' ? -1 : 1;
  let rows = Object.values(source).filter(o => o.completedAt >= payload.startAt && o.completedAt <= payload.endAt)
    .sort((a, b) => dir * (a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  if (payload.cursor) rows = rows.filter(o => dir * (o.completedAt - payload.cursor.value || (o.id < payload.cursor.id ? -1 : o.id > payload.cursor.id ? 1 : 0)) > 0);
  const page = rows.slice(0, payload.limit), last = page[page.length - 1];
  return {orders: Object.fromEntries(page.map(o => [o.id, o])), cursor: last ? {value: last.completedAt, id: last.id} : payload.cursor, hasMore: rows.length > payload.limit, ...(serverKnowsDirection ? {direction: dir < 0 ? 'desc' : 'asc'} : {})};
}
function harness(cache) {
  const calls = []; let rows = null, meta = null;
  const store = createHistoricalPeriodStore({
    persist: cache, scope: () => 'owner-1',
    watch(cb) { queueMicrotask(() => cb({sequence: 3, changes: {}})); return () => {}; },
    async changes() { return []; },
    async read(payload) { calls.push(payload); return serverPage(payload); },
  });
  store.watch(period, (data, m) => { rows = data; meta = m; }, error => { throw error; });
  return {store, calls, get rows() { return rows; }, get meta() { return meta; }};
}

// 1. The first page is the newest 100 sales, requested newest first.
const cache = memory(), first = harness(cache);
await tick();
assert.equal(first.calls.length, 1);
assert.equal(first.calls[0].direction, 'desc', 'period pages must be requested newest first');
const firstStamps = Object.values(first.rows).map(o => o.completedAt);
assert.equal(firstStamps.length, 100);
assert.equal(Math.max(...firstStamps), 1000 + 249 * 10, 'the newest archived sale is on the first page');
assert.ok(Math.min(...firstStamps) > 1000 + 140 * 10, 'the first page is the newest 100, not the oldest');

// 2. "Load older" continues backwards with no gap or duplicate, tie included.
await first.store.loadOlder(period); await tick();
await first.store.loadOlder(period); await tick();
assert.equal(Object.keys(first.rows).length, 251, 'every sale in the period loads exactly once');
assert.ok(first.rows.tie && first.rows.o150, 'rows sharing a stamp across a page boundary are both kept');
assert.equal(first.calls[1].cursor.id, 'tie', 'page 1 ends on the tied row, so page 2 must resume inside the tie');
assert.ok(first.calls.slice(1).every(c => c.direction === 'desc' && c.cursor), 'older pages resume from the newest-first cursor');
first.store.clear();

// 3. Ranges saved before newest-first paging hold ascending cursors and must be refetched.
const legacy = memory();
await legacy.put('owner-1|' + period.startAt + ':' + period.endAt, {version: 2, scope: 'owner-1', period, rows: {o000: source.o000}, cursor: {value: 1000, id: 'o000'}, hasMore: true, sequence: 3, epoch: 0, updatedAt: 1});
const reopened = harness(legacy);
await tick();
assert.equal(reopened.calls.length, 1, 'a pre-newest-first saved range is not resumed');
assert.equal(reopened.calls[0].cursor, null, 'the refetch starts from the newest page');
reopened.store.clear();

// 4. Deploy order: hosting before Functions. The old server ignores direction and
// answers ascending; that cursor must never be saved, and once the server turns
// newest-first the range restarts instead of resuming with the ascending cursor.
serverKnowsDirection = false;
const mixedCache = memory(), mixed = harness(mixedCache);
await tick();
assert.equal(Math.min(...Object.values(mixed.rows).map(o => o.completedAt)), 1000, 'old server returns the oldest page');
assert.equal(mixedCache.map.size, 0, 'an ascending incomplete range is not saved');
serverKnowsDirection = true;
await mixed.store.loadOlder(period); await tick();
assert.equal(mixed.calls.length, 3, 'a direction change restarts from the first newest-first page');
assert.equal(mixed.calls[2].cursor, null);
await mixed.store.loadOlder(period); await tick();
await mixed.store.loadOlder(period); await tick();
assert.equal(Object.keys(mixed.rows).length, 251, 'no gap after the server switches order');
assert.equal(mixedCache.map.size, 1, 'newest-first ranges are saved again');
mixed.store.clear();

// 5. Server: newest-first is opt-in on both query paths; old clients keep ascending.
const server = fs.readFileSync(new URL('../src/functions/61-historical-archive.js', import.meta.url), 'utf8');
const body = server.slice(server.indexOf('async function historicalPeriodPage'), server.indexOf('async function historicalLatestPage'));
assert.ok(body.includes('const direction = data.direction === "desc" ? "desc" : "asc";'));
assert.ok(body.includes('.orderBy("salesAt", direction).orderBy(FieldPath.documentId(), direction)'));
assert.ok(body.includes('.orderBy(`order.${field}`, direction).orderBy(FieldPath.documentId(), direction)'));
assert.ok(!/"asc"\)\.orderBy/.test(body), 'no period query may stay hard-coded ascending');
assert.ok(body.includes('return {documents, direction, cursor:') && body.includes('return {documents, direction, cursor: nextCursor'), 'both paths report their order');
assert.ok(server.includes('...(page.direction ? {direction: page.direction} : {})'), 'the callable echoes the order it used');

// 6. Sales History never reuses a period summary saved before this page load.
const history = fs.readFileSync(new URL('../assets/js/admin/sales-history.js', import.meta.url), 'utf8');
assert.ok(!/sessionStorage\.(getItem|setItem)/.test(history), 'the period summary must not be read from or saved to session storage');
assert.ok(history.includes("periodSummary={key:key,months:null,data:null,loading:true,error:'',request:periodSummary.request+1};var request"), 'each page load fetches the summary fresh');
assert.ok(history.includes('clearLegacySummaries();'), 'summaries saved by earlier builds are removed');
assert.ok(!/cachePeriodSummary|cachedPeriodSummary|summaryStorageKey/.test(history), 'no reference to the removed summary cache remains');
console.log('sales-history-newest-first-check: OK');
