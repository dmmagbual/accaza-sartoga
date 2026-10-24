// Pure presentation helpers shared by active and archived Admin order screens.
const ORDER_CHANNEL_LABELS={instore:'In-store',online:'Online',grabfood:'GrabFood',foodpanda:'FoodPanda'};
export function orderChannel(o){var c=String((o&&o.channel)||'').toLowerCase();if(ORDER_CHANNEL_LABELS[c])return c;return o&&o.source==='pos'?'instore':'online';}
export function orderChannelLabel(o){return ORDER_CHANNEL_LABELS[orderChannel(o)];}
export function archiveOutcome(o){
  var total=Number(o&&o.total)||0,refunded=Number(o&&o.refundAmount)||0,status=String((o&&o.prevStatus)||(o&&o.status)||'Archived');
  if(o&&o.voided)return{label:'Voided',icon:'⛔',style:'background:#f8d7da;color:#721c24;'};
  if(refunded>0&&total>0&&refunded>=total-0.009)return{label:'Refunded',icon:'↩️',style:'background:#fff3cd;color:#856404;'};
  if(refunded>0)return{label:'Partially refunded · ₱'+refunded.toLocaleString(),icon:'↩️',style:'background:#fff3cd;color:#856404;'};
  if(['Rejected','Cancelled','Canceled','Declined'].indexOf(status)>-1)return{label:status==='Rejected'?'Rejected / Cancelled':status,icon:'🔴',style:'background:#f8d7da;color:#721c24;'};
  if(status==='Completed'||status==='Received')return{label:status,icon:'✅',style:'background:#d4edda;color:#155724;'};
  return{label:status,icon:'📦',style:'background:#e2e3e5;color:#41464b;'};
}
