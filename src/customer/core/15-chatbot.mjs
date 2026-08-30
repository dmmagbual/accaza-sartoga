
// ── CHATBOT ──
const botReplies=[
  {keys:['hour','open','close','time','schedule'],reply:'🕐 We are open every day — <strong>Monday to Sunday, 3:00 PM to 12:00 Midnight</strong>. ☕'},
  {keys:['location','address','where','find'],reply:"📍 <strong>Saratoga Avenue, La Mediterranea Subdivision, Governor's Drive, Dasmariñas, Cavite</strong>. Near SM Dasmariñas! 😊"},
  {keys:['gcash','pay','payment','bank','bdo'],reply:'💳 We accept <strong>GCash, BDO, and UnionBank</strong>. GCash: <strong>0927 692 4831</strong> (ACCAZA).'},
  {keys:['delivery','deliver'],reply:'🛵 We deliver within <strong>Dasmariñas, Cavite</strong> only. Outside? Try <strong>🟠 foodpanda</strong> or <strong>🟢 GrabFood</strong>.'},
  {keys:['menu','food','drink','coffee','frappe','pastry'],reply:'🍽️ We serve <strong>Coffee, Non-Coffee, Iced Blended, Soda Refreshers, and Pastries</strong>. Check our menu above! ☕'},
  {keys:['reserve','reservation','book','table'],reply:'📅 Use our <strong>Reservations section</strong> — pick a date, time slot, and fill in your details. Our staff will confirm! 😊'},
  {keys:['wifi','internet'],reply:'📶 Yes, we have free WiFi! Ask our staff for the password. 😊'},
  {keys:['price','cost','how much'],reply:'💰 Prices start from <strong>₱95 for pastries</strong> and <strong>₱155 for coffee</strong>. Check our menu! ☕'},
  {keys:['parking','park'],reply:'🚗 Yes, we have parking available! 😊'},
  {keys:['hello','hi','hey','kumusta'],reply:'Hello! 👋 Welcome to <strong>Accaza Coffee House</strong>! How can I help you today? ☕'},
  {keys:['thank','thanks','salamat'],reply:"You're very welcome! 😊 See you at Accaza! ☕🐻"},
  {keys:['sms','text'],reply:'📩 You can reach us via SMS at <strong>0927 692 4831</strong>. 😊'},
];
function getBotReply(msg){const l=msg.toLowerCase();for(const r of botReplies){if(r.keys.some(k=>l.includes(k)))return r.reply;}return null;}
function addBotMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg bot';d.innerHTML=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function addUserMsg(text){const m=document.getElementById('chatMessages'),d=document.createElement('div');d.className='chat-msg user';d.textContent=text;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function showContactOptions(msg){
  const encoded=encodeURIComponent('Hi Accaza Coffee! I have a question: '+msg);
  const d=document.createElement('div');d.className='chat-msg bot';
  d.innerHTML='<p style="margin-bottom:0.6rem;">🤔 Sorry, I\'m not sure about that! Reach us directly:</p>'
    +'<div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.75rem;">'
    +'<a href="https://wa.me/'+CAFE_PHONE+'?text='+encoded+'" target="_blank" rel="noopener noreferrer" style="background:#25D366;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">💬 WhatsApp</a>'
    +'<a href="viber://chat?number=%2B'+CAFE_PHONE+'&text='+encoded+'" style="background:#7360f2;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📱 Viber</a>'
    +'<a href="sms:+'+CAFE_PHONE+'?body='+encoded+'" style="background:#44523f;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📩 SMS</a>'
    +'<a href="mailto:'+CAFE_EMAIL+'?subject=Customer Inquiry&body='+encoded+'" style="background:#b08d57;color:#fff;border:none;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.78rem;text-decoration:none;display:block;">📧 Email</a>'
    +'</div><p style="font-size:0.72rem;color:#79806f;border-top:1px solid #cdbda7;padding-top:0.5rem;">📱 WhatsApp, Viber & SMS work best on mobile. On desktop? Use Email.</p>';
  document.getElementById('chatMessages').appendChild(d);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;
}
window.toggleChat=function(){chatOpen=!chatOpen;document.getElementById('chatWindow').classList.toggle('open',chatOpen);document.getElementById('chatNotif').style.display='none';if(chatOpen&&!chatStarted){chatStarted=true;setTimeout(function(){addBotMsg("👋 Hi! Welcome to <strong>Accaza Coffee House</strong>! Ask me about our hours, menu, delivery, reservations, and more! ☕");},400);}};
window.sendChat=function(){const input=document.getElementById('chatInput'),msg=input.value.trim();if(!msg)return;input.value='';addUserMsg(msg);const typing=document.createElement('div');typing.className='chat-msg bot';typing.id='typing';typing.innerHTML='<span style="letter-spacing:2px;">•••</span>';document.getElementById('chatMessages').appendChild(typing);document.getElementById('chatMessages').scrollTop=document.getElementById('chatMessages').scrollHeight;setTimeout(function(){const t=document.getElementById('typing');if(t)t.remove();const reply=getBotReply(msg);if(reply)addBotMsg(reply);else showContactOptions(msg);},900);};
window.quickMsg=function(msg){document.getElementById('chatInput').value=msg;sendChat();};
setTimeout(function(){if(!chatOpen)document.getElementById('chatNotif').style.display='block';},3000);
