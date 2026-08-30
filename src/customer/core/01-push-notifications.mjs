
// ===================== WEB PUSH (FCM) =====================
// Paste your Web Push certificate key here (Firebase Console > Project settings > Cloud Messaging > Web Push certificates).
const VAPID_KEY="BIIVf-1RYIQger0yqeYlyV6-tQpH8YfytIgQK6-7IJg87HVITcNkYv4RYcKjyCmJBJKR1EXjJqRuiHzkFJjSvlE";
function _pushToastWire(messaging){onMessage(messaging,function(payload){var d=(payload&&(payload.data||payload.notification))||{};try{if(navigator.vibrate)navigator.vibrate([400,150,400,150,400,150,400]);}catch(e){}try{playReadyChime();}catch(e){}try{navigator.serviceWorker.ready.then(function(reg){reg.showNotification(d.title||'Accaza Coffee House',{body:d.body||'',icon:'/favicon_192x192.png',badge:'/favicon_192x192.png',vibrate:[400,150,400,150,400,150,400],requireInteraction:true,renotify:true,tag:'accaza-order',data:{link:(d.link||'/')}});});}catch(e){}try{(window.accazaToast||function(){})((d.title?d.title+': ':'')+(d.body||'New notification'),'ok');}catch(e){}});}
async function registerPushToken(){
  try{
    if(!VAPID_KEY||VAPID_KEY.indexOf('PASTE_')===0)return;
    if(!('serviceWorker' in navigator)||!('Notification' in window))return;
    if(Notification.permission!=='granted')return;
    if(!(await isSupported()))return;
    var reg=await navigator.serviceWorker.ready;
    var messaging=getMessaging(app);
    var token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    if(token){var u=getAppUser();var au=auth.currentUser;if(u&&au){try{await update(ref(db,'appCustomers/'+au.uid),{pushToken:token,pushTokenAt:Date.now()});if(!window.__pushToasted){window.__pushToasted=true;(window.accazaToast||function(){})('🔔 Notifications on for this device','ok');}}catch(e){}}}
    _pushToastWire(messaging);
  }catch(e){}
}
async function setupPush(){
  try{
    if(!('Notification' in window))return;
    if(Notification.permission==='default'){try{await Notification.requestPermission();}catch(e){}}
    if(Notification.permission==='granted'){await registerPushToken();}
  }catch(e){}
  refreshNotifyPrompt();
}
function refreshNotifyPrompt(){
  var b=document.getElementById('enableNotifyBtn');if(!b)return;
  if(!isAppMode()||!('Notification' in window)){b.style.display='none';return;}
  if(Notification.permission==='granted'){b.style.display='none';return;}
  b.style.display='block';
  b.textContent=(Notification.permission==='denied')?'🔔 Notifications blocked — tap for help':'🔔 Enable order-ready notifications';
}
window.enableNotifications=async function(){
  if(!('Notification' in window))return;
  if(Notification.permission==='denied'){(window.accazaToast||window.alert)('Notifications are turned off for Accaza. Please enable them in your browser/app settings (Site settings → Notifications), then reopen the app.');return;}
  await setupPush();
  refreshNotifyPrompt();
};
window.__setupPush=setupPush;
