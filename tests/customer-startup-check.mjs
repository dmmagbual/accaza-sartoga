import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const source=fs.readFileSync(path.join(root,'assets','js','customer','core.mjs'),'utf8');
const tracker=fs.readFileSync(path.join(root,'assets','js','customer','order-tracker.js'),'utf8');
const pwa=fs.readFileSync(path.join(root,'assets','js','pwa-register.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const release=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
const customerHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const databaseImport=source.split(/\r?\n/).find(line=>line.includes('firebase-database.js'))||'';
if(!/\bget\b/.test(databaseImport))throw new Error('Customer runtime uses Firebase get() without importing it');

const availabilityState=source.indexOf('let publicOrdersOpen=null,customerLiveConnected=null;');
const authObserver=source.indexOf('onAuthStateChanged(auth,function(u){');
const publicStatusObserver=source.indexOf('onValue(publicOrderStatusRef');
if(availabilityState<0||authObserver<0||availabilityState>authObserver)throw new Error('Customer availability state must initialize before Firebase authentication can call its renderer');
if(publicStatusObserver<0||availabilityState>publicStatusObserver)throw new Error('Customer availability state must initialize before its realtime subscription');
if((source.match(/let publicOrdersOpen=/g)||[]).length!==1)throw new Error('Customer availability state must have exactly one owner');

for(const marker of [
  "ref(db,'customerOrders/'+uid)",
  "ref(db,'orders/'+id)",
  'confirmOrderReceivedCall({orderId:oid})',
  "localStorage.setItem('accaza_my_orders'",
  'renderCustomerOrders()'
])if(!source.includes(marker))throw new Error(`Customer-owned order tracker binding missing: ${marker}`);
if(source.includes('onValue(ordersRef'))throw new Error('Customer tracker must never subscribe to the complete orders node');
for(const marker of ['MutationObserver','sessionStatus','acz-steps','alertChange(id,status)'])if(!tracker.includes(marker))throw new Error(`Live tracker enhancement missing: ${marker}`);

if(manifest.start_url!=='/'||manifest.scope!=='/'||manifest.display!=='standalone')throw new Error('Customer PWA manifest start URL, scope, or display mode is invalid');
for(const icon of manifest.icons||[])if(!fs.existsSync(path.join(root,icon.src.replace(/^\//,''))))throw new Error(`Customer PWA icon is missing: ${icon.src}`);
for(const marker of ["serviceWorker.register('/sw.js',{scope:'/'})",'beforeinstallprompt','appinstalled','accaza:update-ready'])if(!pwa.includes(marker))throw new Error(`Customer PWA lifecycle marker missing: ${marker}`);
for(const asset of ['/index.html','/manifest.json','/assets/js/customer/core.mjs','/assets/js/customer/order-tracker.js','/assets/js/customer/navigation.js','/assets/js/customer/ui.js','/assets/js/customer/packages.js'])if(!sw.includes(`'${asset}'`))throw new Error(`Customer offline shell asset missing: ${asset}`);
if(!sw.includes(`const CACHE='accaza-v${release.builds.serviceWorkerCache}'`))throw new Error('Customer PWA cache version differs from the release manifest');
if((customerHtml.match(/>Click for QR code<\/button>/g)||[]).length!==4)throw new Error('GCash and BDO QR controls must require an explicit click in both payment views');
if(/<img[^>]+src="assets\/img\/payment\/(?:gcash|bdo)-qr\.jpg"/i.test(customerHtml))throw new Error('Payment QR images must not have an eager browser src');
for(const marker of ["closest('[data-payment-qr]')","button.textContent='Loading QR code…'","image.src=src","button.replaceWith(image)","button.textContent='Click for QR code'"])if(!source.includes(marker))throw new Error(`On-demand payment QR behavior missing: ${marker}`);

console.log('PASS: customer startup, owned order tracking, and versioned PWA/offline-shell contracts are complete.');
