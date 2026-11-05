import{callables}from"./firebase-client.mjs";

// Website order rejection dialog (split from admin-orders.mjs, 5 Nov 2026). Rejecting a website order
// records what happens to the customer's money (Danilo, Nov 2026): payment not found, or refund due.
// Resolves null when staff cancel; the server refuses a website rejection without an outcome.
export function installWebsiteOrderRejection(deps){
  window.__rejectWebsiteOrder=function(oid,order){
    order=order||deps.getOrders()[oid]||{};
    if(!window.AccazaFormDialog)return Promise.reject(new Error('Form service unavailable. Refresh the portal.'));
    var total=(Math.round((Number(order.total)||0)*100)/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}),verified=['cashier_verified','manager_validated','confirmed'].indexOf(order.paymentStatus)>-1,options=[{value:'',label:'Choose…'}];
    // A payment already verified as received can only be refunded (the server enforces this too).
    if(!verified)options.push({value:'payment_not_found',label:'Payment not found in our account'});
    options.push({value:'refund_due',label:'Customer paid: refund due (₱'+total+')'});
    return window.AccazaFormDialog.run({title:'Reject order '+oid,subtitle:(verified?'This payment was verified as received, so the customer must be refunded. ':'')+'The customer sees this on their order tracker.',submitLabel:'Reject order',busyLabel:'Rejecting…',fields:[{name:'outcome',label:'Customer payment',type:'select',required:true,value:'',options:options,help:'Refund due keeps the order in Register Ops until a manager records the refund as paid.'}]},function(v){
      return callables.updateOrderStatus({orderId:oid,status:'Rejected',expectedStatus:String(order.status||'Pending'),requestId:deps.commandId(),rejectionOutcome:v.outcome});
    }).then(function(result){(window.accazaToast||function(){})('Order rejected','ok');return result||true;},function(error){if(String((error&&error.message)||error).indexOf('cancelled')>-1)return null;throw error;});
  };
}
