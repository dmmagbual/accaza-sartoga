(function(global){
  'use strict';
  function number(value){return Number(value)||0;}
  function status(order){return order&&order.status==='Archived'?(order.prevStatus||''):String(order&&order.status||'');}
  function qualifies(order){return !!order&&!order.voided&&order.paymentStatus!=='pending'&&(status(order)==='Completed'||status(order)==='Received');}
  function amounts(order){order=order||{};var channel=String(order.channel||'').toLowerCase(),platform=channel==='grabfood'||channel==='foodpanda',gross=number(platform&&order.grossPlatform!=null?order.grossPlatform:(order.subtotal!=null?order.subtotal:order.total)),platformDiscount=order.netSalesPlatform!=null?Math.max(0,gross-number(order.netSalesPlatform)):number(order.platformDiscount),discount=platform?platformDiscount:number(order.discount),refund=number(order.refundAmount);return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};}
  function stamp(order){return number(order&&order.completedAt)||number(order&&order.receivedAt)||number(order&&order.timestamp)||Date.parse(order&&order.date)||number(order&&order.archivedAt)||0;}
  global.AccazaSales=Object.freeze({status:status,qualifies:qualifies,amounts:amounts,stamp:stamp});
})(window);
