/* Firebase Cloud Messaging — optional background push handler. Push CDN failures
   must not prevent the offline app shell from installing. */
try{
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
  if(typeof firebase!=='undefined'&&firebase.messaging){
    firebase.initializeApp({apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"});
    firebase.messaging().onBackgroundMessage(function(payload){
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
  }
}catch(e){
  /* Continue with the installable/offline shell when push scripts are unavailable. */
}
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  const link=(e.notification.data&&e.notification.data.link)||'/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cl){
    for(const c of cl){if('focus' in c)return c.focus();}
    if(clients.openWindow)return clients.openWindow(link);
  }));
});

/* Versioned customer + POS app shells. Transactions remain online-only. */
const CACHE='accaza-v343';
const ASSETS=[
  '/','/index.html','/admin.html','/books.html','/manifest.json','/manifest-admin.json',
  '/favicon.ico','/favicon_32x32.png','/favicon_180x180.png','/favicon_192x192.png','/favicon_512x512.png',
  '/assets/js/pwa-register.js','/assets/css/admin-backoffice.css','/assets/css/customer/app-shell.css','/assets/css/customer/retired-admin.css','/assets/css/customer/site.css','/assets/css/customer/packages.css','/assets/css/admin/app-shell.css','/assets/css/admin/portal.css','/assets/css/admin/site.css','/assets/css/admin/navigation.css','/assets/css/admin/touch-targets.css','/assets/css/admin/pos-workflow.css','/assets/css/admin/pos-inventory-recipes.css','/assets/css/admin/analytics.css','/assets/js/shared/text-encoding.js','/assets/js/shared/business-date.js','/assets/js/shared/sales-authority.js',
  '/assets/img/payment/gcash-qr.jpg','/assets/img/payment/bdo-qr.jpg',
  '/assets/js/customer/core.mjs','/assets/js/customer/navigation.js','/assets/js/customer/ui.js','/assets/js/customer/order-tracker.js','/assets/js/customer/packages.js',
  '/assets/js/admin/core.mjs','/assets/js/admin/archive-order-sort.mjs','/assets/js/admin/inventory-books-reconciliation.mjs','/assets/js/admin/workspace-shell.mjs','/assets/js/admin/overview-command.mjs','/assets/js/admin/overview-insights.mjs','/assets/js/admin/firebase-client.mjs','/assets/js/admin/realtime-hub.mjs','/assets/js/admin/history-pager.mjs','/assets/js/admin/manager-approval.mjs','/assets/js/admin/portal-auth.mjs','/assets/js/admin/admin-orders.mjs','/assets/js/admin/customer-registry.mjs','/assets/js/admin/reservations.mjs','/assets/js/admin/catalog-admin.mjs','/assets/js/admin/app-customer-session.mjs','/assets/js/admin/customer-order-tracker.mjs','/assets/js/admin/shared-ui.mjs','/assets/js/admin/telemetry.js','/assets/js/admin/operations-dashboard.js','/assets/js/admin/form-dialog.js','/assets/js/admin/module-loader.js','/assets/js/admin/offline-queue.js','/assets/js/admin/portal-boot.js',
  '/assets/js/shared/costing.js','/assets/js/admin/pos.js','/assets/js/admin/channel-pricing.js','/assets/js/admin/analytics.js','/assets/js/admin/sales-history.js','/assets/js/admin/register.js','/assets/js/admin/staff-access.js','/assets/js/admin/packages.js','/assets/js/admin/finance.js','/assets/js/admin/staff-inbox.js',
  '/assets/css/books.css','/assets/js/books/app.js','/assets/js/books/live-pos.mjs','/assets/js/books/accounting-periods.mjs'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(ASSETS.map(asset=>c.add(asset).catch(()=>null)))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return; /* Firebase & CDNs go straight to network */
  e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));}return r;}).catch(()=>caches.match(e.request).then(m=>{
    if(m)return m;
    if(e.request.mode==='navigate'){
      const defaultShell=url.pathname.indexOf('/admin')===0?'/admin.html':'/index.html';
      return caches.match(url.pathname.indexOf('/books')===0?'/books.html':defaultShell);
    }
    return new Response('Offline asset unavailable',{status:503,statusText:'Offline'});
  })));
});
