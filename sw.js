/* Firebase Cloud Messaging — background push handler */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"});
const fcm=firebase.messaging();
fcm.onBackgroundMessage(function(payload){
  const d=(payload&&payload.data)||{};
  self.registration.showNotification(d.title||'Accaza Coffee House',{
    body:d.body||'',
    icon:'/favicon_192x192.png',
    badge:'/favicon_192x192.png',
    vibrate:[400,150,400,150,400,150,400],
    silent:false,
    requireInteraction:true,
    renotify:true,
    tag:'accaza-order',
    data:{link:(d.link||'/')},
    actions:[{action:'view',title:'View order'}]
  });
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  const link=(e.notification.data&&e.notification.data.link)||'/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cl){
    for(const c of cl){if('focus' in c)return c.focus();}
    if(clients.openWindow)return clients.openWindow(link);
  }));
});

/* App shell cache (network-first) */
const CACHE='accaza-v6';
const ASSETS=['/','/index.html','/favicon_192x192.png','/favicon_512x512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return; /* Firebase & CDNs go straight to network */
  e.respondWith(
    fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r;})
    .catch(()=>caches.match(e.request).then(m=>m||caches.match('/index.html')))
  );
});
