export function archiveOrderStamp(order){
  const o=order||{};
  const timestamp=Number(o.timestamp)||0;
  if(timestamp>0)return timestamp;
  const displayed=Date.parse([o.date,o.time].filter(Boolean).join(' '));
  if(Number.isFinite(displayed))return displayed;
  return Number(o.archivedAt)||0;
}

export function sortArchivedOrders(orders){
  return (orders||[]).slice().sort(function(a,b){
    const difference=archiveOrderStamp(b)-archiveOrderStamp(a);
    if(difference)return difference;
    return String(b&&b.id||'').localeCompare(String(a&&a.id||''));
  });
}
