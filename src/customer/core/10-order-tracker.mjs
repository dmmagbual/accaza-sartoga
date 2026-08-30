
// ── ORDER TRACKER ──
const statusConfig={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your order has been received and is awaiting confirmation from our staff.'},Confirmed:{icon:'🔵',color:'#0c5460',bg:'#d1ecf1',msg:'Your order has been confirmed. We will start preparing it soon!'},Preparing:{icon:'🟠',color:'#664d03',bg:'#fff3cd',msg:'Your order is currently being prepared. ☕'},Ready:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your order is now ready!'},Completed:{icon:'✅',color:'#155724',bg:'#d4edda',msg:'Your order is complete — thank you! ☕'},Received:{icon:'✅',color:'#1b5e20',bg:'#c8e6c9',msg:'You have confirmed receipt. Thank you! ☕🐻'},Rejected:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately, we could not verify your payment in our account, so this order has been rejected. If you believe this is a mistake, please contact us at 0927 692 4831 with your payment reference.'}};
function renderCustomerOrders(){
  const myOrders=myOrderIds.map(id=>myOrdersMap[id]).filter(Boolean);
  const active=myOrders.filter(o=>o.status!=='Completed'&&o.status!=='Received'&&!o.receivedByCustomer);
  const el=document.getElementById('activeOrdersList');
  if(!active.length){el.innerHTML='<div style="text-align:center;padding:3rem;color:var(--tl);"><p style="font-size:2.5rem;margin-bottom:0.75rem;">☕</p><p style="font-size:0.95rem;font-weight:500;color:var(--bd);margin-bottom:0.3rem;">No active orders yet</p><p style="font-size:0.85rem;">Place an order above and it will appear here!</p></div>';return;}
  el.innerHTML=active.map(function(o){const s=statusConfig[o.status]||statusConfig.Pending;const isDelivery=o.type==='Delivery';
    var _msg=(o.status==='Ready')?(isDelivery?'Your order is now ready for delivery! 🎉':'Your order is now ready for pick-up! Please proceed to the counter. 🎉'):s.msg;
    return'<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1.25rem;">'
      +'<div style="background:var(--bd);padding:1rem 1.25rem;text-align:center;">'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.6);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:0.25rem;">Order ID</p>'
      +'<p style="font-family:\'Playfair Display\',serif;font-size:1.8rem;color:#fff;font-weight:600;">'+escHtml(o.id)+'</p>'
      +'<p style="font-size:0.72rem;color:rgba(224,212,198,0.5);margin-top:0.25rem;">🛒 '+escHtml(o.items)+'</p>'
      +'<p style="font-size:0.75rem;color:#c9a36a;">💰 ₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+'</p>'
      +'<p style="font-size:0.75rem;margin-top:0.3rem;padding:0.25rem 0.75rem;display:inline-block;border-radius:999px;background:'+(isDelivery?'rgba(13,110,253,0.2)':'rgba(45,158,95,0.2)')+';color:'+(isDelivery?'#90caf9':'#a5d6a7')+';">'+(isDelivery?'🛵 For Delivery':'🏠 For Pick-up')+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:'+s.bg+';"><p style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.15em;color:'+s.color+';margin-bottom:0.4rem;font-weight:600;">Order Status</p>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;"><span style="font-size:1.3rem;">'+s.icon+'</span><span style="font-size:1rem;font-weight:700;color:'+s.color+';">'+escHtml(o.status)+'</span></div>'
      +'<p style="font-size:0.82rem;color:'+s.color+';line-height:1.5;">'+_msg+'</p></div>'
      +'<div style="padding:1rem 1.25rem;background:#ece4d8;text-align:center;">'
      +(o.status==='Ready'?'<p style="font-size:0.95rem;font-weight:700;color:#155724;margin-bottom:.55rem;">'+(isDelivery?'🛵 Your delivery is on the way!':'🏠 Your order is ready — for pick-up!')+'</p><button data-orderid="'+escHtml(o.id)+'" class="confirm-recv-btn" style="background:#2d9e5f;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:pointer;width:100%;">✅ Yes, I Received My Order</button>'
        :'<p style="font-size:0.82rem;color:var(--tl);">This button will be enabled once your order is marked <strong>Completed</strong>.</p><button disabled style="background:#ccc;color:#fff;border:none;border-radius:8px;padding:0.65rem 1.5rem;font-size:0.88rem;cursor:not-allowed;width:100%;margin-top:0.5rem;opacity:0.6;">Waiting for Completion...</button>')
      +'</div></div>';
  }).join('')+'<p style="font-size:0.72rem;color:var(--tl);text-align:center;margin-top:0.25rem;">🔥 Your order status updates automatically — no refresh needed!</p>';
  el.querySelectorAll('.confirm-recv-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      const oid=this.dataset.orderid;var b=this;
      if(!confirm('Confirm that you have received your order?'))return;
      b.disabled=true;b.textContent='Confirming…';b.style.opacity='0.6';b.style.cursor='default';
      (async function(){try{await ensureCustomerAuth();await confirmOrderReceivedCall({orderId:oid});if(window.dismissReadyAlert)window.dismissReadyAlert();/* order flips to Received -> renderCustomerOrders drops the card */}catch(e){b.disabled=false;b.textContent='✅ Yes, I Received My Order';b.style.opacity='1';b.style.cursor='pointer';alert('Could not confirm receipt: '+((e&&e.message)||e));}})();
    });
  });
}
