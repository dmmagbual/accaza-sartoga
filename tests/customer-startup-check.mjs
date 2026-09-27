import assert from 'node:assert/strict';
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
const aboutHtml=fs.readFileSync(path.join(root,'about.html'),'utf8');
const legacyMenuHtml=fs.readFileSync(path.join(root,'menu.html'),'utf8');
const staticStyles=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const orderAvailability=fs.readFileSync(path.join(root,'assets','js','customer','order-availability.mjs'),'utf8');
const customerHelpers=fs.readFileSync(path.join(root,'src','customer','core','03-state-helpers.mjs'),'utf8');
const catalogAdmin=fs.readFileSync(path.join(root,'assets','js','admin','catalog-admin.mjs'),'utf8');
const posState=fs.readFileSync(path.join(root,'src','admin','pos','00-shared-state.js'),'utf8');
const posRegister=fs.readFileSync(path.join(root,'src','admin','pos','50a-register-shell.js'),'utf8');
const databaseImport=source.split(/\r?\n/).find(line=>line.includes('firebase-database.js'))||'';
if(!/\bget\b/.test(databaseImport))throw new Error('Customer runtime uses Firebase get() without importing it');

const availabilityState=source.indexOf('let publicOrdersOpen=null,customerLiveConnected=null;');
const authObserver=source.indexOf('onAuthStateChanged(auth,function(u){');
const publicStatusObserver=source.indexOf('onValue(publicOrderStatusRef');
if(availabilityState<0||authObserver<0||availabilityState>authObserver)throw new Error('Customer availability state must initialize before Firebase authentication can call its renderer');
if(publicStatusObserver<0||availabilityState>publicStatusObserver)throw new Error('Customer availability state must initialize before its realtime subscription');
if((source.match(/let publicOrdersOpen=/g)||[]).length!==1)throw new Error('Customer availability state must have exactly one owner');
for(const marker of ['function customerMenuCats(){return getCats().filter(c=>c.showInMenu!==false);}','const cats=customerMenuCats();','if(!cats.some(c=>c.id===menuFilter))','if(orderFilter&&!cats.some(c=>c.id===orderFilter))'])if(!customerHelpers.includes(marker))throw new Error(`Customer category visibility safeguard missing: ${marker}`);
for(const marker of ['.order-service-status.is-open~.nav-links .nav-cta','.order-service-status.is-closed~.nav-links .nav-cta'])if(!fs.readFileSync(path.join(root,'assets','css','customer','site.css'),'utf8').includes(marker))throw new Error(`Home Order Now availability binding missing: ${marker}`);
for(const marker of ['showInMenu:true','catShowInMenu_','Show in customer Menu, Online Ordering &amp; POS','{icon,label,showInMenu}','invalidateCatalogCache()','Saving…','✓ Saved'])if(!catalogAdmin.includes(marker))throw new Error(`Menu Availability category visibility control missing: ${marker}`);
for(const marker of [".filter(function(c){return c.showInMenu!==false;})","if(posCat!=='ALL'&&!cats.some(function(c){return c.id===posCat;}))posCat='ALL';",'visibleCatIds[it.cat]'])if(!posRegister.includes(marker))throw new Error(`POS category visibility safeguard missing: ${marker}`);
if(!posState.includes("posCat='coffee'"))throw new Error('POS must open on the Coffee Based category by default');

function navigationHrefs(html,page){
  const nav=html.match(/<ul class="nav-links">([\s\S]*?)<\/ul>\s*<button class="hamburger"/);
  if(!nav)throw new Error(`${page} customer navigation is missing`);
  return [...nav[1].matchAll(/href="([^"]+)"/g)].map(match=>match[1].startsWith('#')?`index.html${match[1]}`:match[1]);
}
assert.deepEqual(navigationHrefs(aboutHtml,'About page'),navigationHrefs(customerHtml,'Home page'),'About navigation must stay synchronized with Home navigation');
for(const marker of ['.nav-has-sub{position:relative;}','.nav-has-sub:focus-within .nav-sub','.nav-links.nav-open .nav-sub'])if(!staticStyles.includes(marker))throw new Error(`About navigation submenu style missing: ${marker}`);
for(const marker of ['Our Mission','Our Vision','6:00 AM – 12:00 Midnight','href="index.html#menu">View Live Menu'])if(!aboutHtml.includes(marker))throw new Error(`About purpose, hours, or live-menu link missing: ${marker}`);
if(aboutHtml.includes('3–12')||aboutHtml.includes('href="menu.html"'))throw new Error('About page must not advertise stale hours or link to the retired static menu');
if(!legacyMenuHtml.includes('location.replace(\'index.html#menu\')'))throw new Error('Legacy menu URL must redirect to the live Firebase-backed menu');
for(const marker of ["ref(getDatabase(app),'publicOrderStatus')","showState(snapshot.val()&&snapshot.val().acceptingOrders===true?'open':'closed')"])if(!orderAvailability.includes(marker))throw new Error(`Static-page Order Now availability binding missing: ${marker}`);
for(const marker of ['order-availability-open','order-availability-closed','orderAvailabilityOpen','orderAvailabilityClosed'])if(!staticStyles.includes(marker))throw new Error(`Order Now availability presentation missing: ${marker}`);
for(const page of [aboutHtml,fs.readFileSync(path.join(root,'contact.html'),'utf8'),fs.readFileSync(path.join(root,'reservations.html'),'utf8')])if(!page.includes('data-order-availability')||!page.includes('assets/js/customer/order-availability.mjs'))throw new Error('Customer landing page is missing the cashier-linked Order Now status');

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
