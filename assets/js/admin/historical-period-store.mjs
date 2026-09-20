import {salesStamp, periodKey} from './sales-period-data.mjs?v=560';

// Session-only archive cache. A bounded server change journal lets every open
// report share exact-record refreshes. Missing journal history forces reconciliation.
export function createHistoricalPeriodStore(ops) {
  const ranges = new Map();
  let stopMarker = null, sequence = null, generation = 0, chain = Promise.resolve(), seenMarker = false;
  function inside(row, period) { const stamp = salesStamp(row); return stamp >= period.startAt && stamp <= period.endAt; }
  function emit(entry) { for (const listener of entry.listeners) listener.data({...entry.rows}); }
  function fail(error) { for (const entry of ranges.values()) for (const listener of entry.listeners) listener.error(error); }
  async function load(entry, refresh = false) {
    if (entry.pending) return entry.pending;
    const epoch = generation;
    entry.pending = (async () => {
      let cursor = null, rows = {}, pages = 0, more = true;
      const covering = [...ranges.values()].find(other => other !== entry && other.period.startAt <= entry.period.startAt && other.period.endAt >= entry.period.endAt && (other.period.startAt < entry.period.startAt || other.period.endAt > entry.period.endAt));
      if (covering) {
        const coveredRows = !refresh && covering.rows ? covering.rows : await load(covering,refresh);
        rows = Object.fromEntries(Object.entries(coveredRows).filter(([,row]) => inside(row,entry.period)));
        more = false;
      }
      while (more) {
        const result = await ops.read({mode:'period', purpose:'admin_period_report', ...entry.period, cursor, limit:100});
        Object.assign(rows, result.orders || {}); cursor = result.cursor; more = result.hasMore === true;
        pages++;
        if (pages >= 50 && more) throw new Error('Historical period exceeded the safe 5,000-order limit. Narrow the selected dates.');
      }
      if (epoch !== generation) return rows;
      entry.rows = rows; emit(entry); return rows;
    })().finally(() => { entry.pending = null; });
    return entry.pending;
  }
  function start() {
    if (stopMarker) return;
    const epoch = generation;
    stopMarker = ops.watch(marker => {
      chain = chain.then(async () => {
        if (epoch !== generation) return;
        seenMarker = true;
        const next = Number(marker && marker.sequence), previous = sequence;
        sequence = Number.isSafeInteger(next) && next > 0 ? next : null;
        if (previous === sequence && sequence !== null) return;
        // Initial loads and in-flight pages must finish before exact patches.
        await Promise.all([...ranges.values()].map(entry => entry.pending));
        if (epoch !== generation) return;
        const changes = Object.values(marker && marker.changes || {}).filter(change => change && change.sequence > previous && change.sequence <= next).sort((a,b) => a.sequence-b.sequence);
        const contiguous = previous !== null && sequence !== null && next > previous && changes.length === next-previous && changes.every((change,index) => change.sequence === previous+index+1);
        if (!contiguous) {
          await Promise.all([...ranges.values()].map(entry => load(entry,true)));
          return;
        }
        const ids = [...new Set(changes.map(change => change.orderId))];
        if (ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid archive change journal');
        let result;
        try { result = await ops.read({mode:'ids', ids}); }
        catch (error) {
          // Mixed frontend/backend rollout: old readers still support periods.
          if (String(error.code || '').endsWith('invalid-argument')) {
            await Promise.all([...ranges.values()].map(entry => load(entry,true))); return;
          }
          throw error;
        }
        if (epoch !== generation) return;
        for (const entry of ranges.values()) {
          if (!entry.rows) continue; // A report opened during this request loads next.
          for (const id of ids) {
            const row = (result.orders || {})[id];
            if (row && inside(row, entry.period)) entry.rows[id] = row;
            else delete entry.rows[id];
          }
          emit(entry);
        }
      }).catch(error => { if(epoch !== generation)return;sequence = null; fail(error); });
    }, error => {if(epoch === generation)fail(error);});
  }
  function entryFor(period) {
    const key = periodKey(period);
    if (!ranges.has(key) && ranges.size >= 6) for (const [oldKey,cached] of ranges) {
      if (!cached.listeners.size && !cached.pending) { ranges.delete(oldKey); break; }
    }
    if (!ranges.has(key)) ranges.set(key, {period:{startAt:Number(period.startAt),endAt:Number(period.endAt)},rows:null,listeners:new Set(),pending:null});
    return ranges.get(key);
  }
  return {
    watch(period, data, error) {
      const entry = entryFor(period), listener = {data,error}; entry.listeners.add(listener);
      const alreadyStarted = !!stopMarker;
      start();
      // The first marker establishes the baseline and loads all registered ranges.
      if (entry.rows) data({...entry.rows});
      else if (alreadyStarted && seenMarker) chain = chain.then(() => entry.rows || load(entry)).catch(fail);
      return () => { entry.listeners.delete(listener); };
    },
    async read(period) {
      const epoch = generation;
      await chain;
      if (epoch !== generation) throw new Error('The reporting session changed. Reopen the report.');
      const covering = [...ranges.values()].find(entry => entry.rows && entry.period.startAt <= period.startAt && entry.period.endAt >= period.endAt);
      if (covering) return Object.fromEntries(Object.entries(covering.rows).filter(([,row]) => inside(row,period)));
      const entry = entryFor(period);
      const rows = {...await load(entry)};
      if (epoch !== generation) throw new Error('The reporting session changed. Reopen the report.');
      if (!stopMarker) ranges.delete(periodKey(period));
      // Keep bounded session memory for repeated ranking/date-range requests.
      if (ranges.size > 6) for (const [key,cached] of ranges) {
        if (ranges.size <= 6) break;
        if (!cached.listeners.size && !cached.pending) ranges.delete(key);
      }
      return rows;
    },
    clear() {
      generation++; if (stopMarker) stopMarker(); stopMarker = null; sequence = null; seenMarker = false; ranges.clear(); chain = Promise.resolve();
    }
  };
}
