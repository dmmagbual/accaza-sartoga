import{db,ref,update}from"./firebase-client.mjs";

export function createCustomerOrderTracker(deps={}){
  const getOrders=deps.getOrders||function(){return{};};
  const esc=deps.escHtml||function(v){return String(v==null?'':v);};
  let orderIds=[];
  try{orderIds=JSON.parse(localStorage.getItem('accaza_my_orders')||'[]');if(!Array.isArray(orderIds))orderIds=[];}catch(e){orderIds=[];}
  let alerted;try{alerted=new Set(JSON.parse(localStorage.getItem('accaza_ready_alerted')||'[]'));}catch(e){alerted=new Set();}
  let seeded=false,timer=null,stopTimer=null,audioCtx=null;

  function saveIds(){try{localStorage.setItem('accaza_my_orders',JSON.stringify(orderIds));}catch(e){}}
  function saveAlerted(){try{localStorage.setItem('accaza_ready_alerted',JSON.stringify(Array.from(alerted)));}catch(e){}}
  function addOrderId(id){if(id&&orderIds.indexOf(id)<0){orderIds.push(id);saveIds();}}
  function getOrderIds(){return orderIds.slice();}
  function stopAlert(){if(timer){clearInterval(timer);timer=null;}if(stopTimer){clearTimeout(stopTimer);stopTimer=null;}}
  function dismissAlert(){stopAlert();const el=document.getElementById('orderReadyAlert');if(el)el.style.display='none';}
  function chime(){
    try{
      if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume();
      const t=audioCtx.currentTime,notes=[523.25,659.25,783.99,1046.5];
      notes.forEach(function(f,i){const o=audioCtx.createOscillator(),g=audioCtx.createGain(),st=t+i*0.17;o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(0.6,st+0.02);g.gain.setValueAtTime(0.6,st+0.13);g.gain.exponentialRampToValueAtTime(0.0001,st+0.33);o.connect(g);g.connect(audioCtx.destination);o.start(st);o.stop(st+0.36);});
    }catch(e){}
  }
  function trigger(o){
    const el=document.getElementById('orderReadyAlert');if(!el)return;
    const sub=document.getElementById('orderReadySub');if(sub)sub.textContent='Order #'+(o.id||'')+' — '+(o.type==='Delivery'?'ready for delivery':'ready for pick-up');
    el.style.display='flex';chime();stopAlert();
    timer=setInterval(function(){chime();try{if(navigator.vibrate)navigator.vibrate([500,200,500]);}catch(e){}},3800);
    try{if(navigator.vibrate)navigator.vibrate([500,200,500,200,500]);}catch(e){}
    stopTimer=setTimeout(stopAlert,45000);
  }
  function checkReady(){
    try{
      const orders=getOrders();
      orderIds.forEach(function(id){const o=orders[id];if(!o)return;if(o.status==='Completed'){if(!seeded)alerted.add(id);else if(!alerted.has(id)){alerted.add(id);saveAlerted();trigger(o);}}else if(alerted.has(id)){alerted.delete(id);saveAlerted();}});
      if(!seeded){seeded=true;saveAlerted();}
    }catch(e){}
  }
  const status={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your order has been received and is awaiting confirmation from our staff.'},Confirmed:{icon:'🔵',color:'#0c5460',bg:'#d1ecf1',msg:'Your order has been confirmed. We will start preparing it soon!'},Preparing:{icon:'🟠',color:'#664d03',bg:'#fff3cd',msg:'Your order is currently being prepared. ☕'},Completed:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your order is ready! Please confirm once you have received it below.'},Received:{icon:'✅',color:'#1b5e20',bg:'#c8e6c9',msg:'You have confirmed receipt. Thank you! ☕🐻'},Rejected:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately, we could not verify your payment in our account, so this order has been rejected. If you believe this is a mistake, please contact us at 0927 692 4831 with your payment reference.'}};
  function render(){
    const el=document.getElementById('activeOrdersList');if(!el)return;
    const active=orderIds.map(id=>getOrders()[id]).filter(Boolean).filter(o=>o.status!=='Received'&&!o.receivedByCustomer);
    if(!active.length){el.innerHTML='<div style="text-align:center;padding:3rem;color:var(--tl);"><p style="font-size:2.5rem;margin-bottom:0.75rem;">☕</p><p style="font-size:0.95rem;font-weight:500;color:var(--bd);margin-bottom:0.3rem;">No active orders yet</p><p style="font-size:0.85rem;">Place an order above and it will appear here!</p></div>';return;}
    el.innerHTML=active.map(function(o){const s=status[o.status]||status.Pending,isDelivery=o.type==='Delivery';return'<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1.25rem;"><div style="background:var(--bd);padding:1rem 1.25rem;text-align:center;"><p style="font-size:.72rem;color:rgba(224,212,198,.6);text-transform:uppercase;letter-spacing:.15em;margin-bottom:.25rem;">Order ID</p><p style="font-family:Playfair Display,serif;font-size:1.8rem;color:#fff;font-weight:600;">'+esc(o.id)+'</p><p style="font-size:.72rem;color:rgba(224,212,198,.5);margin-top:.25rem;">🛒 '+esc(o.items)+'</p><p style="font-size:.75rem;color:#c9a36a;">💰 ₱'+(Number(o.total)||0).toLocaleString()+' · '+esc(o.payment)+'</p><p style="font-size:.75rem;margin-top:.3rem;padding:.25rem .75rem;display:inline-block;border-radius:999px;background:'+(isDelivery?'rgba(13,110,253,.2)':'rgba(45,158,95,.2)')+';color:'+(isDelivery?'#90caf9':'#a5d6a7')+';">'+(isDelivery?'🛵 For Delivery':'🏠 For Pick-up')+'</p></div><div style="padding:1rem 1.25rem;background:'+s.bg+';"><p style="font-size:.7rem;text-transform:uppercase;letter-spacing:.15em;color:'+s.color+';margin-bottom:.4rem;font-weight:600;">Order Status</p><div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem;"><span style="font-size:1.3rem;">'+s.icon+'</span><span style="font-size:1rem;font-weight:700;color:'+s.color+';">'+esc(o.status)+'</span></div><p style="font-size:.82rem;color:'+s.color+';line-height:1.5;">'+s.msg+'</p></div><div style="padding:1rem 1.25rem;background:#ece4d8;text-align:center;">'+(o.status==='Completed'?'<button data-orderid="'+esc(o.id)+'" class="confirm-recv-btn" style="background:#2d9e5f;color:#fff;border:none;border-radius:8px;padding:.65rem 1.5rem;font-size:.88rem;cursor:pointer;width:100%;">✅ Yes, I Received My Order</button>':'<p style="font-size:.82rem;color:var(--tl);">This button will be enabled once your order is marked <strong>Completed</strong>.</p><button disabled style="background:#ccc;color:#fff;border:none;border-radius:8px;padding:.65rem 1.5rem;font-size:.88rem;cursor:not-allowed;width:100%;margin-top:.5rem;opacity:.6;">Waiting for Completion...</button>')+'</div></div>';}).join('')+'<p style="font-size:.72rem;color:var(--tl);text-align:center;margin-top:.25rem;">🔥 Your order status updates automatically — no refresh needed!</p>';
    el.querySelectorAll('.confirm-recv-btn').forEach(function(btn){btn.addEventListener('click',function(){const oid=this.dataset.orderid;document.getElementById('receivedOrderId').textContent=oid;document.getElementById('confirmReceivedPopup').classList.add('show');document.getElementById('confirmReceivedBtn').onclick=async function(){await update(ref(db,'orders/'+oid),{receivedByCustomer:true,status:'Received'});document.getElementById('confirmReceivedPopup').classList.remove('show');dismissAlert();};});});
  }
  window.dismissReadyAlert=dismissAlert;
  return{addOrderId,getOrderIds,render,checkReady,dismissAlert,playChime:chime};
}
