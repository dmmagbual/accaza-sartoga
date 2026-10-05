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
const reservationsHtml=fs.readFileSync(path.join(root,'reservations.html'),'utf8');
const contactHtml=fs.readFileSync(path.join(root,'contact.html'),'utf8');
const rewardsHtml=fs.readFileSync(path.join(root,'rewards.html'),'utf8');
const customerNavigationSource=fs.readFileSync(path.join(root,'src','html','customer','00-document-navigation.html'),'utf8');
const legacyMenuHtml=fs.readFileSync(path.join(root,'menu.html'),'utf8');
const staticStyles=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const customerStyles=fs.readFileSync(path.join(root,'assets','css','customer','site.css'),'utf8');
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
for(const marker of [
  "navigator.onLine&&publicOrdersOpen",
  "var offline=!navigator.onLine",
  "headline.textContent=offline?'CLOSED'",
  'window.onoffline=',
  'customerLiveConnected=false',
  "syncOrderNowButtons(open?'open':checking?'checking':'closed'",
  "b.textContent=st=='open'?'Order Now':st=='closed'?'CLOSED':'Checking'",
  "document.querySelectorAll('[data-order-availability]')"
])if(!source.includes(marker))throw new Error(`Customer offline order-status safeguard missing: ${marker}`);
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
for(const [page,html] of [['Home page',customerHtml],['About page',aboutHtml],['Reservations page',reservationsHtml],['Contact page',contactHtml],['Rewards page',rewardsHtml]]){
  assert.ok(/href="rewards\.html"/.test(html),`${page} must expose the standalone Rewards page`);
  assert.ok(/<div class="footer-links">[\s\S]*?href="rewards\.html"/.test(html),`${page} footer must expose the standalone Rewards page`);
}
assert.ok(/<li><a href="rewards\.html">Rewards<\/a><\/li>\s*<li class="nav-has-sub"><a href="about\.html">About/.test(customerNavigationSource),'Home navigation must place Rewards before, not inside, About');
assert.ok(!/<ul class="nav-sub">[\s\S]*?href="rewards\.html"/.test(customerNavigationSource),'Rewards must never be nested under the About menu');
assert.ok(/@media\(max-width:1180px\)\{\.hamburger\{display:flex;\}\.nav-links\{display:none;\}\}/.test(customerStyles),'Customer navigation must switch to the mobile menu before Rewards causes a wrapped desktop header');
for(const marker of ['.nav-has-sub{position:relative;}','.nav-has-sub:focus-within .nav-sub','.nav-links.nav-open .nav-sub'])if(!staticStyles.includes(marker))throw new Error(`About navigation submenu style missing: ${marker}`);
for(const marker of ['Our Mission','Our Vision','6:00 AM – 12:00 Midnight','href="index.html#menu">View Live Menu'])if(!aboutHtml.includes(marker))throw new Error(`About purpose, hours, or live-menu link missing: ${marker}`);
if(aboutHtml.includes('3–12')||aboutHtml.includes('href="menu.html"'))throw new Error('About page must not advertise stale hours or link to the retired static menu');
if(!legacyMenuHtml.includes('location.replace(\'index.html?qr=1#order\')'))throw new Error('General menu QR URL must redirect to the live menu-only dine-in ordering mode');
for(const marker of ["ref(getDatabase(app),'publicOrderStatus')","button.textContent=state==='open'?'Order Now':state==='closed'?'CLOSED':'Checking'","showState(!navigator.onLine?'closed'","window.addEventListener('offline',renderState)"])if(!orderAvailability.includes(marker))throw new Error(`Static-page Order Now availability binding missing: ${marker}`);
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
for(const marker of ['To create a place where every person feels genuinely welcomed, valued, and at home.','one of the Philippines’ most trusted homegrown coffee-house brands','Genuine Hospitality','Craft with Purpose','Consistency Builds Trust','Community and Belonging','Integrity and Accountability','Growing People Together'])if(!aboutHtml.includes(marker))throw new Error(`About purpose content missing: ${marker}`);
if(aboutHtml.includes('Responsible Stewardship')||(aboutHtml.match(/class="core-value-item"/g)||[]).length!==6)throw new Error('About page must show exactly the six approved core values');
for(const marker of ['.purpose-pair{','.values-section{','.values-list{','.core-value-item{','@media(min-width:721px) and (max-width:980px)'])if(!staticStyles.includes(marker))throw new Error(`About responsive design missing: ${marker}`);
if(!/\.fb-sync\{[^}]*left:18px;[^}]*bottom:18px;/.test(customerStyles)||/\.fb-sync\{[^}]*(?:top:|right:)/.test(customerStyles))throw new Error('Customer Firebase status must stay at the bottom-left');
const socialRow=customerHtml.match(/<div class="hero-social-icons">([\s\S]*?)<div class="hero-amenities">/)?.[1]||'';
for(const marker of ['class="hero-install-divider"','id="heroInstallWrap" class="hero-install-wrap"','class="hero-install-btn"','Install App'])if(!socialRow.includes(marker))throw new Error(`Hero install action must stay inline with the social icons: ${marker}`);
if(customerHtml.includes('Install app on your phone'))throw new Error('Hero must use the compact Install App label');
const amenitiesRule=customerStyles.match(/\.hero-amenities\{([^}]*)\}/)?.[1]||'';
if(!amenitiesRule||/(?:^|;)\s*(?:padding|background|border|border-radius|box-shadow):/.test(amenitiesRule))throw new Error('Hero amenities must remain an unwrapped text row');
if(!customerHtml.includes('<div class="chat-avatar"><img src="/favicon_192x192.png" alt="Accaza Coffee logo"/></div>'))throw new Error('Customer chat header must use the Accaza logo');
if((customerHtml.match(/>Click for QR code<\/button>/g)||[]).length!==4)throw new Error('GCash and BDO QR controls must require an explicit click in both payment views');
if(/<img[^>]+src="assets\/img\/payment\/(?:gcash|bdo)-qr\.jpg"/i.test(customerHtml))throw new Error('Payment QR images must not have an eager browser src');
for(const marker of ["closest('[data-payment-qr]')","button.textContent='Loading QR code…'","image.src=src","button.replaceWith(image)","button.textContent='Click for QR code'"])if(!source.includes(marker))throw new Error(`On-demand payment QR behavior missing: ${marker}`);

console.log('PASS: customer startup, owned order tracking, and versioned PWA/offline-shell contracts are complete.');
