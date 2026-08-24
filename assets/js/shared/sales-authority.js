(function(global){
  'use strict';
  function number(value){return Number(value)||0;}
  function status(order){return order&&order.status==='Archived'?(order.prevStatus||''):String(order&&order.status||'');}
  function qualifies(order){return !!order&&!order.voided&&order.paymentStatus!=='pending'&&(status(order)==='Completed'||status(order)==='Received');}
  function amounts(order){var gross=number(order&&order.subtotal!=null?order.subtotal:order&&order.total),discount=number(order&&order.discount),refund=number(order&&order.refundAmount);return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};}
  function stamp(order){return number(order&&order.completedAt)||number(order&&order.receivedAt)||number(order&&order.timestamp)||Date.parse(order&&order.date)||number(order&&order.archivedAt)||0;}
  global.AccazaSales=Object.freeze({status:status,qualifies:qualifies,amounts:amounts,stamp:stamp});
})(window);
