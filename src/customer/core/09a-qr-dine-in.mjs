
function qrOrderLineItems(){
  return Object.values(cart).map(function(c){return {itemKey:c.itemKey||null,size:c.size||null,optLabels:c.optLabels||[],qty:c.qty,stream:c.stream||null,pkg:c.pkgId||null,packageRole:c.packageRole||null};});
}
function qrOrderExpectedTotal(){
  var net=Object.values(cart).reduce(function(sum,item){return sum+Number(item.qty||0)*Number(item.unitTotal||0);},0)+(window.__custPkgs||[]).reduce(function(sum,pkg){return sum+(Number(pkg.extraCost)||0);},0);
  var taxLine=window.__custTaxLine?window.__custTaxLine(net):null;
  return taxLine?taxLine.total:Math.round(net*100)/100;
}
window.dismissQrOrderConfirmation=function(){var modal=document.getElementById('qrOrderConfirmModal');if(modal)modal.hidden=true;};
window.sendQrOrderTicket=async function(){
  if(!window.__accazaQrOrderMode||window._sendingQrOrder)return;
  if(!canOrder()){alert('Dine-in ordering is currently closed. Please order directly at the cashier.');return;}
  var name=((document.getElementById('qrCustomerName')||{}).value||'').trim();
  if(name.length<2){alert('Please enter your name so the cashier can find your ticket.');return;}
  if(!Object.keys(cart).length){alert('Please add at least one item.');return;}
  var lineItems=qrOrderLineItems(),expectedTotal=qrOrderExpectedTotal();
  window._sendingQrOrder=true;var button=document.getElementById('qrSendOrderBtn');if(button){button.disabled=true;button.textContent='Sending to cashier…';}
  try{
    await ensureCustomerAuth(true);
    var response;
    try{response=await createQrOrderTicketCall({name:name,lineItems:lineItems,expectedTotal:expectedTotal});}
    catch(firstError){if(String(firstError&&firstError.code).indexOf('unauthenticated')<0)throw firstError;await ensureCustomerAuth(true);response=await createQrOrderTicketCall({name:name,lineItems:lineItems,expectedTotal:expectedTotal});}
    var result=response&&response.data;if(!result||!result.ticketId||!result.queueNumber)throw new Error('The cashier ticket was not created.');
    var queue=document.getElementById('qrOrderQueueNumber'),confirmName=document.getElementById('qrOrderConfirmName'),modal=document.getElementById('qrOrderConfirmModal');
    if(queue)queue.textContent=result.queueNumber;if(confirmName)confirmName.textContent=name;if(modal)modal.hidden=false;
    cart={};window.__custPkgs=[];updateCartDisplay();renderOrderSection();
    var input=document.getElementById('qrCustomerName');if(input)input.value='';
  }catch(e){
    var msg=(e&&e.message)||'Unknown error';if(String(e&&e.code).indexOf('already-exists')>-1)msg='This exact order was already sent. Please proceed to the cashier.';alert('Could not send the order: '+msg);
  }finally{window._sendingQrOrder=false;syncQrOrderButton();}
};
function initQrDineInOrder(){
  if(!window.__accazaQrOrderMode)return;
  var name=document.getElementById('qrCustomerName');if(name)name.addEventListener('input',syncQrOrderButton);
  var checkout=document.getElementById('cartCheckoutBtn');if(checkout)checkout.textContent='Continue to cashier details ↓';
  syncQrOrderButton();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initQrDineInOrder);else initQrDineInOrder();
