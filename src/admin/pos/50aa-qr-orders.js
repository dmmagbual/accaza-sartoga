function qrTicketChime(){
  try{
    var Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
    var context=window.__accazaQrAudio||(window.__accazaQrAudio=new Context());if(context.state==='suspended')context.resume();
    [0,0.16].forEach(function(delay,index){var osc=context.createOscillator(),gain=context.createGain(),start=context.currentTime+delay;osc.type='sine';osc.frequency.value=index?880:660;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.16,start+.02);gain.gain.exponentialRampToValueAtTime(.0001,start+.13);osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.14);});
  }catch(e){}
}
function notifyNewQrTickets(){
  var pending=Object.keys(qrTicketsMap).filter(function(id){var o=qrTicketsMap[id]||{};return o.status==='pending'&&Number(o.expiresAt||0)>Date.now();}),next={};pending.forEach(function(id){next[id]=true;});
  var added=pending.filter(function(id){return !knownQrTicketIds||!knownQrTicketIds[id];});knownQrTicketIds=next;
  if(!added.length)return;var newest=qrTicketsMap[added[added.length-1]]||{};
  qrTicketChime();try{if(navigator.vibrate)navigator.vibrate([250,120,250]);}catch(e){}
  (window.accazaToast||function(){})('New QR order · '+(newest.queueNumber||newest.id)+' · '+(newest.name||'Customer'),'ok');
}
function loadQrTicketIntoCheckout(id,button){
  if(Object.keys(posCart).length||posCompletedCorrection){alert('Finish, hold, or clear the current in-store sale before opening a QR order. The existing cart was not changed.');return;}
  var a=A();if(!a||!a.manageQrOrderTicket){alert('QR order service is unavailable. Refresh the POS.');return;}
  var old=button&&button.textContent;if(button){button.disabled=true;button.textContent='Opening…';}
  a.manageQrOrderTicket({action:'claim',ticketId:id}).then(function(response){
    var result=(response&&response.data)||response||{},ticket=result.ticket||{},lines=ticket.checkoutLineItems||ticket.lineItems||[];if(!ticket.id||!lines.length)throw new Error('The server returned an incomplete QR ticket.');
    posCart={};lines.forEach(function(line,index){var key='qr_'+index+'_'+Date.now().toString(36);posCart[key]={itemKey:line.itemKey,name:line.name,cat:line.cat||'',size:line.size||null,optLabels:(line.optLabels||[]).slice(),details:(line.size?line.size+' · ':'')+((line.optLabels||[]).join(' · ')),qty:Number(line.qty)||1,unitTotal:Number(line.unitTotal)||0,stream:line.stream||null,pkgId:line.pkg||null,packageRole:line.packageRole||null};});
    posQrTicket={id:ticket.id,queueNumber:ticket.queueNumber,name:ticket.name,claimToken:result.claimToken||ticket.claimToken,total:Number(ticket.total)||0};
    posChannel='instore';posView='counter';posDraft={posCust:{value:ticket.name||'',checked:false,type:'text'}};posPaymentVerification=null;posScopedDisc=[];window.__posPkgs=(ticket.packages||[]).slice();if(window.posLoyaltyReset)posLoyaltyReset();buildPOS();
    (window.accazaToast||function(){})(ticket.priceChanged?'QR order opened · current menu price was refreshed':'QR order '+ticket.queueNumber+' opened for checkout','ok');
  }).catch(function(error){alert('Could not open QR order: '+((error&&error.message)||error));if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});
}
function rejectQrTicket(id,button){
  var ticket=qrTicketsMap[id]||{};if(!confirm('Reject QR order '+(ticket.queueNumber||id)+' for '+(ticket.name||'this customer')+'?'))return;
  var a=A(),old=button&&button.textContent;if(!a||!a.manageQrOrderTicket)return alert('QR order service is unavailable.');if(button){button.disabled=true;button.textContent='Rejecting…';}
  a.manageQrOrderTicket({action:'reject',ticketId:id}).then(function(){if(posQrTicket&&posQrTicket.id===id){posQrTicket=null;posCart={};posDraft={};window.__posPkgs=[];}(window.accazaToast||function(){})('QR order rejected','ok');}).catch(function(error){alert('Could not reject QR order: '+((error&&error.message)||error));if(button&&document.body.contains(button)){button.disabled=false;button.textContent=old;}});
}
function renderQrOrders(){
  var root=document.getElementById('posQrOrdersPanel');if(!root)return;var shift=window.__posShift||null,rows=qrOrderRows();
  function card(o){var claimed=o.status==='claimed',mine=posQrTicket&&posQrTicket.id===o.id,action='<button class="pz-btn ok" data-qr-open="'+esc(o.id)+'">'+(claimed?'Resume Checkout':'Open for Checkout')+'</button>'+(mine?'':'<button class="pz-btn warn" data-qr-reject="'+esc(o.id)+'">Reject</button>');return '<article class="pos-online-card pos-qr-card"><div class="pos-online-card-head"><div><b class="pos-qr-queue">'+esc(o.queueNumber||'QR')+'</b><span>'+esc(o.name||'Customer')+'</span></div><strong>'+peso(o.total)+'</strong></div><div class="pos-online-meta">Dine-in · Unpaid · '+(claimed?'Opened at POS':'Waiting for cashier')+'</div>'+posOrderItemsHtml(o)+'<div class="pos-online-actions">'+action+'</div></article>';}
  root.innerHTML='<div class="pos-counter-head"><div><div class="pz-h" style="margin:0;">QR Orders</div><p class="pz-sub" style="margin:.2rem 0 0;">Unpaid dine-in requests. Open the customer ticket, collect payment, then complete the normal POS checkout.</p></div><span class="pos-online-shift '+(shift?'open':'closed')+'">'+(shift?'Shift open · '+esc(shift.staff||'Cashier'):'Open a shift first')+'</span></div>'+(rows.length?'<div class="pos-online-grid">'+rows.map(card).join('')+'</div>':'<div class="pos-menu-empty"><b>No pending QR orders</b><span>New customer QR orders will appear here automatically with a sound and badge.</span></div>');
  root.querySelectorAll('[data-qr-open]').forEach(function(button){button.onclick=function(){loadQrTicketIntoCheckout(button.getAttribute('data-qr-open'),button);};});
  root.querySelectorAll('[data-qr-reject]').forEach(function(button){button.onclick=function(){rejectQrTicket(button.getAttribute('data-qr-reject'),button);};});
}
