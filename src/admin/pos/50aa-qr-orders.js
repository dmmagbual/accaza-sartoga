var posQrOrders=window.AccazaPosQrOrders.create({
  tickets:function(){return qrTicketsMap;},rows:qrOrderRows,current:function(){return posQrTicket;},shift:function(){return window.__posShift||null;},api:A,esc:esc,peso:peso,itemsHtml:posOrderItemsHtml,
  hasActiveSale:function(){return Object.keys(posCart).length>0||!!posCompletedCorrection;},
  open:function(ticket,result){
    var lines=ticket.checkoutLineItems||ticket.lineItems||[];posCart={};lines.forEach(function(line,index){var key='qr_'+index+'_'+Date.now().toString(36);posCart[key]={itemKey:line.itemKey,name:line.name,cat:line.cat||'',size:line.size||null,optLabels:(line.optLabels||[]).slice(),details:(line.size?line.size+' · ':'')+((line.optLabels||[]).join(' · ')),qty:Number(line.qty)||1,unitTotal:Number(line.unitTotal)||0,stream:line.stream||null,pkgId:line.pkg||null,packageRole:line.packageRole||null};});
    posQrTicket={id:ticket.id,queueNumber:ticket.queueNumber,name:ticket.name,claimToken:result.claimToken||ticket.claimToken,total:Number(ticket.total)||0};posChannel='instore';posView='counter';posDraft={posCust:{value:ticket.name||'',checked:false,type:'text'}};posPaymentVerification=null;posScopedDisc=[];window.__posPkgs=(ticket.packages||[]).slice();if(window.posLoyaltyReset)posLoyaltyReset();buildPOS();
  },
  reject:function(id){if(posQrTicket&&posQrTicket.id===id){posQrTicket=null;posCart={};posDraft={};window.__posPkgs=[];}}
});
function notifyNewQrTickets(){posQrOrders.notify();}
function renderQrOrders(){posQrOrders.render();}
