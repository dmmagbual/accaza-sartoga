import {salesStamp, periodKey} from './sales-period-data.mjs?v=562';

// Saved Sales History has two tiers:
//  1. sessionStorage — synchronous, so a tab switch renders instantly;
//  2. IndexedDB — survives reloads, new tabs and browser restarts.
// Both hold a display copy only. RTDB and Finance Books stay authoritative, and
// selected-period totals still come from the server's compact summaries.
// A saved range records the change-journal sequence it is current to. On open
// it is shown immediately and caught up from the durable change log by exact
// order ID, so an unchanged period costs zero Firestore reads.
const CACHE_PREFIX = 'accaza_historical_period_v1:';
const CACHE_INDEX = `${CACHE_PREFIX}index`;
const CACHE_MAX_RANGES = 6;
const PERSIST_MAX_RANGES = 12;
// Catching up more changes than this costs more RTDB download than one
// bounded page reload, so larger gaps reload instead.
const CATCH_UP_MAX_CHANGES = 2000;
const IDS_PER_READ = 32;

function storage() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; }
  catch (_) { return null; }
}
function cacheKey(period) { return CACHE_PREFIX + periodKey(period); }
function validSaved(value) {
  return !!(value && (value.version === 1 || value.version === 2) && value.rows && typeof value.rows === 'object');
}
function readCache(period) {
  try {
    const raw = storage()?.getItem(cacheKey(period)), value = raw ? JSON.parse(raw) : null;
    return validSaved(value) ? value : null;
  } catch (_) { return null; }
}
function savedValue(entry, scope) {
  return {version:2,scope:scope||'',period:entry.period,rows:entry.rows,cursor:entry.cursor||null,hasMore:entry.hasMore===true,
    sequence:Number.isSafeInteger(entry.syncedSequence)?entry.syncedSequence:null,epoch:Number(entry.epoch)||0,updatedAt:Number(entry.updatedAt)||Date.now()};
}
function writeCache(value) {
  const target = storage(); if (!target || !value.rows) return;
  const key = cacheKey(value.period);
  try {
    target.setItem(key, JSON.stringify(value));
    const prior = JSON.parse(target.getItem(CACHE_INDEX) || '[]').filter(item => item && item.key !== key);
    prior.unshift({key,updatedAt:value.updatedAt});
    prior.slice(CACHE_MAX_RANGES).forEach(item => target.removeItem(item.key));
    target.setItem(CACHE_INDEX, JSON.stringify(prior.slice(0,CACHE_MAX_RANGES)));
  } catch (_) {}
}
function clearCache() {
  const target = storage(); if (!target) return;
  try {
    const index = JSON.parse(target.getItem(CACHE_INDEX) || '[]');
    const keys = index.map(item => item&&item.key).filter(Boolean);
    if (typeof target.length === 'number' && typeof target.key === 'function') for (let i=0;i<target.length;i++) {
      const key=target.key(i); if (key&&key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    [...new Set(keys.concat(CACHE_INDEX))].forEach(key => target.removeItem(key));
  } catch (_) {}
}

// IndexedDB tier. Every failure (private window, blocked storage, quota)
// degrades to "nothing saved" and the report loads normally.
export function createIndexedDbPeriodCache(name = 'accaza-historical-sales') {
  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('ranges')) db.createObjectStore('ranges'); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return opening;
  }
  function run(mode, work) {
    return open().then(db => db ? new Promise((resolve) => {
      try {
        const tx = db.transaction('ranges', mode), store = tx.objectStore('ranges');
        let result;
        Promise.resolve(work(store, value => { result = value; })).catch(() => {});
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch (_) { resolve(undefined); }
    }) : undefined).catch(() => undefined);
  }
  return {
    get(key) { return run('readonly', (store, done) => { const r = store.get(key); r.onsuccess = () => done(r.result); }); },
    put(key, value) {
      return run('readwrite', (store) => {
        store.put(value, key);
        // Keep the newest PERSIST_MAX_RANGES ranges for this account only.
        const all = store.getAll(), keys = store.getAllKeys();
        all.onsuccess = () => { keys.onsuccess = () => {
          const rows = (all.result || []).map((v, i) => ({key: keys.result[i], v})).filter(item => item.v);
          rows.filter(item => item.v.scope !== value.scope).forEach(item => store.delete(item.key));
          rows.filter(item => item.v.scope === value.scope).sort((a, b) => (b.v.updatedAt || 0) - (a.v.updatedAt || 0)).slice(PERSIST_MAX_RANGES).forEach(item => store.delete(item.key));
        }; };
      });
    },
    clear() { return run('readwrite', (store) => { store.clear(); }); },
  };
}

// A bounded server change journal lets every open report share exact-record
// refreshes; a durable change log lets saved copies catch up after any gap.
export function createHistoricalPeriodStore(ops) {
  const ranges = new Map();
  const persistent = ops.persist === undefined ? createIndexedDbPeriodCache() : ops.persist;
  let stopMarker = null, sequence = null, epoch = null, generation = 0, chain = Promise.resolve(), seenMarker = false;
  function scope() { try { return typeof ops.scope === 'function' ? String(ops.scope() || '') : ''; } catch (_) { return ''; } }
  function persistKey(period) { return scope() + '|' + periodKey(period); }
  function inside(row, period) { const stamp = salesStamp(row); return stamp >= period.startAt && stamp <= period.endAt; }
  function emit(entry) { for (const listener of entry.listeners) listener.data({...entry.rows},{hasMore:entry.hasMore===true,cached:entry.cached===true,stale:entry.stale===true,updatedAt:Number(entry.updatedAt)||0}); }
  function fail(error) { for (const entry of ranges.values()) for (const listener of entry.listeners) listener.error(error); }
  function save(entry) {
    if (!entry.rows) return;
    const owner = scope(), value = savedValue(entry, owner);
    writeCache(value);
    // Without a signed-in owner the copy stays tab-only: a shared device must
    // never reopen another account's detailed sales.
    if (owner && persistent && typeof persistent.put === 'function') Promise.resolve(persistent.put(persistKey(entry.period), value)).catch(() => {});
  }
  function adopt(entry, saved) {
    entry.rows = saved.rows; entry.cursor = saved.cursor || null; entry.hasMore = saved.hasMore === true;
    entry.syncedSequence = Number.isSafeInteger(Number(saved.sequence)) && Number(saved.sequence) > 0 ? Number(saved.sequence) : null;
    entry.epoch = Number(saved.epoch) || 0; entry.cached = true; entry.stale = true; entry.updatedAt = Number(saved.updatedAt) || 0;
  }
  async function load(entry, refresh = false) {
    if (entry.pending) return entry.pending;
    const epochAtStart = generation, sequenceAtStart = sequence, cacheEpochAtStart = epoch;
    entry.pending = (async () => {
      let cursor = refresh ? null : entry.cursor || null, rows = refresh ? {} : Object.assign({},entry.rows||{});
      const covering = [...ranges.values()].find(other => other !== entry && other.hasMore !== true && other.period.startAt <= entry.period.startAt && other.period.endAt >= entry.period.endAt && (other.period.startAt < entry.period.startAt || other.period.endAt > entry.period.endAt));
      if (covering) {
        const coveredRows = !refresh && covering.rows && !covering.stale ? covering.rows : await load(covering,refresh);
        // A partially paged covering range cannot stand in for this range:
        // obtain this range's own first page instead of mislabelling it complete.
        if (covering.hasMore === true) {
          const result = await ops.read({mode:'period', purpose:'admin_period_report', ...entry.period, cursor, limit:100});
          Object.assign(rows, result.orders || {}); entry.cursor = result.cursor || cursor; entry.hasMore = result.hasMore === true;
        } else {
          rows = Object.fromEntries(Object.entries(coveredRows).filter(([,row]) => inside(row,entry.period)));
          entry.hasMore = false; entry.cursor = null;
        }
      } else {
        const result = await ops.read({mode:'period', purpose:'admin_period_report', ...entry.period, cursor, limit:100});
        Object.assign(rows, result.orders || {}); entry.cursor = result.cursor || cursor; entry.hasMore = result.hasMore === true;
      }
      if (epochAtStart !== generation) return rows;
      // Changes published while this page was in flight are re-applied by the
      // next catch-up, because the range is marked current only to the
      // sequence observed when the request started. Re-applying is idempotent.
      entry.rows = rows; entry.cached = false; entry.stale = false; entry.updatedAt = Date.now();
      if (refresh || !Number.isSafeInteger(entry.syncedSequence)) entry.syncedSequence = Number.isSafeInteger(sequenceAtStart) ? sequenceAtStart : null;
      // An unknown epoch (loaded before the first marker) adopts the marker's.
      entry.epoch = cacheEpochAtStart === null ? null : Number(cacheEpochAtStart) || 0;
      save(entry); emit(entry); return rows;
    })().finally(() => { entry.pending = null; });
    return entry.pending;
  }
  // A range nobody is looking at is dropped, never reloaded in the background.
  async function reconcile(entry) {
    if (entry.listeners.size) return load(entry, true);
    for (const [key, value] of ranges) if (value === entry) ranges.delete(key);
  }
  async function readIds(ids) {
    const orders = {};
    for (let i = 0; i < ids.length; i += IDS_PER_READ) {
      const result = await ops.read({mode:'ids', ids:ids.slice(i, i + IDS_PER_READ)});
      Object.assign(orders, result.orders || {});
    }
    return orders;
  }
  function applyRows(entry, ids, orders, target) {
    for (const id of ids) {
      const row = orders[id];
      if (row && inside(row, entry.period)) entry.rows[id] = row;
      else delete entry.rows[id];
    }
    entry.syncedSequence = target; entry.cached = false; entry.stale = false; entry.updatedAt = Date.now();
    save(entry); emit(entry);
  }
  // Bring saved ranges from their own sequence up to `target` using the
  // durable change log: only orders that were in the range, or whose sales
  // time now falls inside it, are fetched by exact ID.
  async function catchUp(entries, target) {
    const behind = entries.filter(entry => entry.rows && entry.syncedSequence !== target);
    const confirmed = entries.filter(entry => entry.rows && entry.syncedSequence === target && entry.stale);
    confirmed.forEach(entry => { entry.stale = false; save(entry); emit(entry); });
    if (!behind.length) return;
    const usable = behind.filter(entry => Number.isSafeInteger(entry.syncedSequence) && entry.syncedSequence < target && target - entry.syncedSequence <= CATCH_UP_MAX_CHANGES);
    const reload = behind.filter(entry => !usable.includes(entry));
    let log = null;
    if (usable.length && typeof ops.changes === 'function') {
      const from = Math.min(...usable.map(entry => entry.syncedSequence));
      const rows = (await ops.changes(from, target) || []).filter(change => change && Number.isSafeInteger(Number(change.sequence))).map(change => ({...change, sequence:Number(change.sequence)}));
      const bySequence = new Map(rows.map(change => [change.sequence, change]));
      // Every sequence must be present; a pruned or unwritten row is a gap.
      let complete = true;
      for (let s = from + 1; s <= target; s++) if (!bySequence.has(s)) { complete = false; break; }
      if (complete) log = bySequence;
    }
    if (!log) { await Promise.all(behind.map(reconcile)); return; }
    const plans = usable.map(entry => {
      const ids = new Set();
      for (let s = entry.syncedSequence + 1; s <= target; s++) {
        const change = log.get(s), id = change && change.orderId;
        if (typeof id !== 'string' || !id) continue;
        const stamp = Number(change.salesAt) || 0;
        if (id in entry.rows || (!change.deleted && (!stamp || (stamp >= entry.period.startAt && stamp <= entry.period.endAt)))) ids.add(id);
      }
      return {entry, ids:[...ids]};
    });
    const wanted = [...new Set(plans.flatMap(plan => plan.ids))];
    const orders = wanted.length ? await readIds(wanted) : {};
    for (const plan of plans) applyRows(plan.entry, plan.ids, orders, target);
    await Promise.all(reload.map(reconcile));
  }
  function start() {
    if (stopMarker) return;
    const epochAtStart = generation;
    stopMarker = ops.watch(marker => {
      chain = chain.then(async () => {
        if (epochAtStart !== generation) return;
        seenMarker = true;
        const next = Number(marker && marker.sequence), previous = sequence;
        sequence = Number.isSafeInteger(next) && next > 0 ? next : null;
        const markerEpoch = Number(marker && marker.cacheEpoch) || 0;
        epoch = markerEpoch;
        // Initial loads and in-flight pages must finish before exact patches.
        await Promise.all([...ranges.values()].map(entry => entry.hydrating));
        await Promise.all([...ranges.values()].map(entry => entry.pending));
        if (epochAtStart !== generation) return;
        // Bulk maintenance rewrote replica fields: saved copies are retired.
        for (const entry of ranges.values()) if (entry.rows && entry.epoch === null) entry.epoch = markerEpoch;
        const retired = [...ranges.values()].filter(entry => entry.rows && (Number(entry.epoch) || 0) !== markerEpoch);
        if (retired.length) await Promise.all(retired.map(reconcile));
        const empty = [...ranges.values()].filter(entry => !entry.rows && entry.listeners.size);
        if (sequence === null) {
          // Legacy marker without a sequence: only watched ranges reconcile.
          await Promise.all([...ranges.values()].filter(entry => entry.listeners.size).map(entry => load(entry, true)));
          return;
        }
        const changes = Object.values(marker && marker.changes || {}).filter(change => change && change.sequence > previous && change.sequence <= next).sort((a,b) => a.sequence-b.sequence);
        const contiguous = previous !== null && next > previous && changes.length === next-previous && changes.every((change,index) => change.sequence === previous+index+1);
        const loaded = [...ranges.values()].filter(entry => entry.rows && !retired.includes(entry));
        const current = loaded.filter(entry => entry.syncedSequence === sequence);
        current.filter(entry => entry.stale).forEach(entry => { entry.stale = false; save(entry); emit(entry); });
        const pending = loaded.filter(entry => entry.syncedSequence !== sequence);
        if (!pending.length) { /* every saved range is already current */ }
        else if (contiguous && pending.every(entry => entry.syncedSequence === previous)) {
          const ids = [...new Set(changes.map(change => change.orderId))];
          if (ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid archive change journal');
          let orders;
          try { orders = await readIds(ids); }
          catch (error) {
            // Mixed frontend/backend rollout: old readers still support periods.
            if (String(error.code || '').endsWith('invalid-argument')) { await Promise.all(pending.map(reconcile)); return; }
            throw error;
          }
          if (epochAtStart !== generation) return;
          for (const entry of pending) applyRows(entry, ids, orders, sequence);
        } else {
          await catchUp(pending, sequence);
        }
        await Promise.all(empty.map(entry => entry.rows || load(entry)));
      }).catch(error => { if(epochAtStart !== generation)return;sequence = null; fail(error); });
    }, error => {if(epochAtStart === generation)fail(error);});
  }
  function entryFor(period) {
    const key = periodKey(period);
    if (!ranges.has(key) && ranges.size >= 6) for (const [oldKey,cached] of ranges) {
      if (!cached.listeners.size && !cached.pending) { ranges.delete(oldKey); break; }
    }
    if (!ranges.has(key)) {
      const normalized={startAt:Number(period.startAt),endAt:Number(period.endAt)}, entry={period:normalized,rows:null,cursor:null,hasMore:false,listeners:new Set(),pending:null,hydrating:null,cached:false,stale:false,updatedAt:0,syncedSequence:null,epoch:0};
      const saved = readCache(normalized);
      if (saved && (!saved.scope || saved.scope === scope())) adopt(entry, saved);
      else if (scope() && persistent && typeof persistent.get === 'function') {
        const epochAtStart = generation, owner = scope();
        entry.hydrating = Promise.resolve(persistent.get(persistKey(normalized))).then(value => {
          if (epochAtStart !== generation || entry.rows || !validSaved(value) || value.scope !== owner) return;
          adopt(entry, value); emit(entry);
        }).catch(() => {}).finally(() => { entry.hydrating = null; });
      }
      ranges.set(key, entry);
    }
    return ranges.get(key);
  }
  return {
    watch(period, data, error) {
      const entry = entryFor(period), listener = {data,error}; entry.listeners.add(listener);
      const alreadyStarted = !!stopMarker;
      start();
      // Saved rows render at once; the marker then confirms or patches them.
      if (entry.rows) data({...entry.rows},{hasMore:entry.hasMore===true,cached:entry.cached===true,stale:entry.stale===true,updatedAt:Number(entry.updatedAt)||0});
      if (alreadyStarted && seenMarker) chain = chain.then(async () => {
        await entry.hydrating;
        if (entry.rows) { if (sequence !== null) await catchUp([entry], sequence); }
        else await load(entry);
      }).catch(fail);
      return () => { entry.listeners.delete(listener); };
    },
    async read(period) {
      const epochAtStart = generation;
      await chain;
      if (epochAtStart !== generation) throw new Error('The reporting session changed. Reopen the report.');
      const covering = [...ranges.values()].find(entry => entry.rows && !entry.stale && entry.hasMore !== true && entry.period.startAt <= period.startAt && entry.period.endAt >= period.endAt);
      if (covering) return Object.fromEntries(Object.entries(covering.rows).filter(([,row]) => inside(row,period)));
      const entry = entryFor(period);
      const rows = {...await load(entry)};
      if (epochAtStart !== generation) throw new Error('The reporting session changed. Reopen the report.');
      if (!stopMarker) ranges.delete(periodKey(period));
      // Keep bounded session memory for repeated ranking/date-range requests.
      if (ranges.size > 6) for (const [key,cached] of ranges) {
        if (ranges.size <= 6) break;
        if (!cached.listeners.size && !cached.pending) ranges.delete(key);
      }
      return rows;
    },
    async loadOlder(period) {
      const entry = entryFor(period); await entry.hydrating; if (!entry.rows) return load(entry); if (!entry.hasMore) return {...entry.rows}; return load(entry);
    },
    clear(removeSaved = false) {
      generation++; if (stopMarker) stopMarker(); stopMarker = null; sequence = null; epoch = null; seenMarker = false; ranges.clear(); chain = Promise.resolve();
      if (removeSaved) { clearCache(); if (persistent && typeof persistent.clear === 'function') Promise.resolve(persistent.clear()).catch(() => {}); }
    }
  };
}
