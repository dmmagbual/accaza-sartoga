/* Minimal, standalone service worker for the Accaza AI app only. Deliberately
   separate from /sw.js (admin+customer shell) so this app's install/offline shell
   never depends on, or has to track, the admin/customer version-bump discipline. */
const CACHE='accaza-ai-v1';
const ASSETS=[
  '/ai.html','/manifest-ai.json',
  '/favicon.ico','/favicon_32x32.png','/favicon_180x180.png','/favicon_192x192.png','/favicon_512x512.png'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(ASSETS.map(asset=>c.add(asset).catch(()=>null)))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(
    fetch(e.request).then(response=>{
      if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}
      return response;
    }).catch(()=>caches.match(e.request).then(cached=>cached||(e.request.mode==='navigate'?caches.match('/ai.html'):undefined)))
  );
});
