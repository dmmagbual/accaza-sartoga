// Staff web-push registration. When a real staff/admin (email-password, i.e.
// NON-anonymous) is signed into the portal, register this device's FCM token at
// /staffPushTokens/{uid} so the server can alert them on new online orders and
// reservations even when the admin app is closed. Uses the shared service
// worker (sw.js) already handling background push.
import{app,db,auth,ref,update,getMessaging,getToken,isSupported,onAuthStateChanged}from"./firebase-client.mjs";

const VAPID_KEY="BIIVf-1RYIQger0yqeYlyV6-tQpH8YfytIgQK6-7IJg87HVITcNkYv4RYcKjyCmJBJKR1EXjJqRuiHzkFJjSvlE";
let _registered=false;

async function registerStaffPushToken(){
  try{
    var au=auth.currentUser;
    if(!au||au.isAnonymous)return;                 // staff only (customers are anonymous)
    if(!('serviceWorker' in navigator)||!('Notification' in window))return;
    if(!(await isSupported()))return;
    if(Notification.permission==='default'){try{await Notification.requestPermission();}catch(e){}}
    if(Notification.permission!=='granted')return;
    var reg=await navigator.serviceWorker.ready;
    var messaging=getMessaging(app);
    var token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    au=auth.currentUser;
    if(token&&au&&!au.isAnonymous){
      await update(ref(db,'staffPushTokens/'+au.uid),{token:token,updatedAt:Date.now()});
      _registered=true;
      if(!window.__staffPushToasted){window.__staffPushToasted=true;try{(window.accazaToast||function(){})('🔔 Staff alerts on for this device','ok');}catch(e){}}
    }
  }catch(e){}
}

// Expose so an "Enable alerts" button can trigger it from a user gesture too.
window.__registerStaffPush=registerStaffPushToken;

onAuthStateChanged(auth,function(u){
  if(u&&!u.isAnonymous){ _registered=false; setTimeout(registerStaffPushToken,1500); }
});
