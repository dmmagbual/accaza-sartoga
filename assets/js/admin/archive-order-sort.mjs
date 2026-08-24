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

export function summarizeArchivedOrders(orders){
  const summary={totalCount:0,completedCount:0,completedRevenue:0,refundedCount:0,refundedAmount:0,voidedCount:0,voidedAmount:0,excludedCount:0,excludedAmount:0};
  (orders||[]).forEach(function(order){
    const o=order||{},total=Math.max(0,Number(o.total)||0),refund=Math.max(0,Number(o.refundAmount)||0);
    const status=String(o.prevStatus||o.status||'');
    summary.totalCount++;
    if(o.voided){summary.voidedCount++;summary.voidedAmount+=total;return;}
    if(refund>0){summary.refundedCount++;summary.refundedAmount+=Math.min(total||refund,refund);return;}
    if(status==='Completed'||status==='Received'){summary.completedCount++;summary.completedRevenue+=total;return;}
    summary.excludedCount++;summary.excludedAmount+=total;
  });
  return summary;
}
