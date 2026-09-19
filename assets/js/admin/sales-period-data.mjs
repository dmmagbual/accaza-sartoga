// Read-only report queries. Do not substitute creation time for the sales authority.
export function salesStamp(o){return Number(o.completedAt)||Number(o.receivedAt)||Number(o.timestamp)||Date.parse(o.date)||Number(o.archivedAt)||0;}
export function periodKey(p){return String(p.startAt)+':'+String(p.endAt);}
const SALES_FIELDS=['completedAt','receivedAt','timestamp'];
// /orders holds only live (not yet archived) orders. One timestamp-bounded listener with a
// generous look-back returns a superset of the three sales-authority queries; the same
// numeric-field rule is then applied locally. This replaces three overlapping listeners per
// view (six with the rolling year chart) that each re-sent every live order update.
const LIVE_ORDER_LOOKBACK_MS=45*86400000;
export function salesTargets(db,ops,path,p){
  if(!Number.isFinite(p.startAt)||!Number.isFinite(p.endAt)||p.startAt>p.endAt)throw new Error('Invalid sales period');
  const base=ops.ref(db,path);
  if(path==='orders')return [ops.query(base,ops.orderByChild('timestamp'),ops.startAt(p.startAt-LIVE_ORDER_LOOKBACK_MS))];
  // Archived history: query the three numeric sales-authority fields and merge them.
  // archivedAt is a storage lifecycle date, not a sale date. Do not restore string/null
  // compatibility queries here: they re-download overlapping archived orders on every report.
  return SALES_FIELDS.map(field=>ops.query(base,ops.orderByChild(field),ops.startAt(p.startAt),ops.endAt(p.endAt)));
}
function numericSalesFieldInRange(row,p){return SALES_FIELDS.some(field=>typeof(row&&row[field])==='number'&&row[field]>=p.startAt&&row[field]<=p.endAt);}
export function mergePeriodMaps(maps,p){
  const merged=Object.assign({},...maps),out={};
  for(const [key,row] of Object.entries(merged)){const ts=salesStamp(row);if(numericSalesFieldInRange(row,p)&&ts>=p.startAt&&ts<=p.endAt)out[key]=row;}
  return out;
}
export async function readSalesPeriod(db,ops,path,p){
  const snaps=await Promise.all(salesTargets(db,ops,path,p).map(target=>ops.get(target)));
  return mergePeriodMaps(snaps.map(s=>s.val()||{}),p);
}
export function watchSalesPeriod(db,ops,path,p,onData,onError){
  const targets=salesTargets(db,ops,path,p),maps=targets.map(()=>null),stops=[];
  let stopped=false;
  targets.forEach((target,index)=>stops.push(ops.onValue(target,snap=>{
    if(stopped)return;maps[index]=snap.val()||{};
    if(maps.every(Boolean))onData(mergePeriodMaps(maps,p));
  },error=>{if(!stopped)onError(error);})));
  return ()=>{stopped=true;stops.forEach(stop=>stop());};
}
