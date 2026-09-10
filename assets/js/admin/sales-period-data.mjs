// Read-only report queries. Do not substitute creation time for the sales authority.
export function salesStamp(o){return Number(o.completedAt)||Number(o.receivedAt)||Number(o.timestamp)||Date.parse(o.date)||Number(o.archivedAt)||0;}
export function periodKey(p){return String(p.startAt)+':'+String(p.endAt);}
export function salesTargets(db,ops,path,p){
  if(!Number.isFinite(p.startAt)||!Number.isFinite(p.endAt)||p.startAt>p.endAt)throw new Error('Invalid sales period');
  const base=ops.ref(db,path),targets=[];
  for(const field of ['completedAt','receivedAt','timestamp','archivedAt']){
    targets.push(ops.query(base,ops.orderByChild(field),ops.startAt(p.startAt),ops.endAt(p.endAt)));
    if(field!=='timestamp')targets.push(ops.query(base,ops.orderByChild(field),ops.startAt(String(p.startAt)),ops.endAt(String(p.endAt))));
  }
  // Older records can have a formatted date instead of an epoch timestamp.
  // Keep these legacy-only buckets; silently dropping them would change totals.
  targets.push(ops.query(base,ops.orderByChild('timestamp'),ops.endAt(0)));
  targets.push(ops.query(base,ops.orderByChild('timestamp'),ops.startAt('')));
  return targets;
}
export function mergePeriodMaps(maps,p){
  const merged=Object.assign({},...maps),out={};
  for(const [key,row] of Object.entries(merged)){const ts=salesStamp(row);if(ts>=p.startAt&&ts<=p.endAt)out[key]=row;}
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
