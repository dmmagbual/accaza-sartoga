// Read-only report queries. Do not substitute creation time for the sales authority.
export function salesStamp(o){return Number(o.completedAt)||Number(o.receivedAt)||Number(o.timestamp)||Date.parse(o.date)||Number(o.archivedAt)||0;}
export function periodKey(p){return String(p.startAt)+':'+String(p.endAt);}
export function salesTargets(db,ops,path,p){
  if(!Number.isFinite(p.startAt)||!Number.isFinite(p.endAt)||p.startAt>p.endAt)throw new Error('Invalid sales period');
  const base=ops.ref(db,path),targets=[];
  // Production orders use numeric event timestamps. Query the three possible
  // sales-authority fields and merge them client-side; archivedAt is a storage
  // lifecycle date, not a sale date. Do not restore string/null compatibility
  // queries here: they re-download overlapping archived orders on every report.
  for(const field of ['completedAt','receivedAt','timestamp']){
    targets.push(ops.query(base,ops.orderByChild(field),ops.startAt(p.startAt),ops.endAt(p.endAt)));
  }
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
