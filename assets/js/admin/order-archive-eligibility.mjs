// Client-side explanation of the server's manual archive policy. The server remains authoritative
// and re-checks final status, role, shift, serving queue, payment review and shift linkage.
export function orderArchiveBlock(o,ctx){
  if(!o)return{ok:false,reason:'not_found',message:'Order not found.'};
  var role=String(ctx&&ctx.role||'').toLowerCase(),shift=ctx&&ctx.shift||null,status=String(o.status||'Pending'),online=o.source==='online'||o.channel==='online',st=String(o.service&&o.service.state||'');
  if(['Completed','Received','Rejected'].indexOf(status)<0&&o.voided!==true)return{ok:false,reason:'not_final',message:online&&!o.shiftId?'Not finished yet ('+status+'). Accept it into a shift in POS → Online Orders, then complete or reject it.':'Not finished yet ('+status+'). Mark it completed or rejected first.'};
  if(['owner','superadmin','admin','manager'].indexOf(role)<0)return{ok:false,reason:'role',message:'Archiving needs a manager, admin or owner login.'};
  if(o.shiftId&&shift&&shift.id===o.shiftId&&shift.status!=='closed'){var opened=Number(shift.openAt)||0;return{ok:false,reason:'current_shift',message:'Sold in the POS shift that is still open'+(opened?' (opened '+new Date(opened).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+')':'')+'. Close that shift with its Z report, then archive.'};}
  // Same rule as keepsOrderLive()/needsService() in functions/lib/order-service.js.
  var total=Math.round((Number(o.total)||0)*100)/100,refund=Math.round((Number(o.refundAmount)||0)*100)/100,queued=false;
  if(o.voided!==true&&!(refund>0&&refund>=total-.009))queued=online?(st!=='not_collected'&&o.posCaptured===true&&!!o.shiftId&&['Confirmed','Preparing','Ready'].indexOf(status)>=0):(o.source==='pos'&&['instore','grabfood','foodpanda'].indexOf(String(o.channel||'instore').toLowerCase())>=0&&['queued','preparing','ready'].indexOf(st)>=0);
  if(queued)return{ok:false,reason:'serving_queue',message:'Still in the serving queue ('+(st||'queued')+'). Mark it served or not collected in POS first.'};
  if(o.voided!==true&&st==='not_collected'&&!(o.service&&o.service.reviewedAt))return{ok:false,reason:'serving_queue',message:'Marked not collected and waiting for a manager review. Review it in POS, then archive.'};
  if(o.paymentStatus==='pending')return{ok:false,reason:'payment_review',message:'Payment not verified yet. Verify the e-payment (check the reference in the actual GCash, Maya or bank account) or record it as not received before archiving.'};
  if(o.paymentStatus==='cashier_verified')return{ok:false,reason:'payment_review',message:'The cashier verified this payment; a manager must validate it before it can be archived.'};
  if(!o.shiftId&&o.source==='pos'&&!(o.enteredVia==='payout-rekey'&&o.catchup===true))return{ok:false,reason:'shift_missing',message:'This till order is not linked to a POS shift, so it cannot be archived. Report it to the owner for review.'};
  return{ok:true,reason:'',message:''};
}
