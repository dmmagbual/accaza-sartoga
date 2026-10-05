import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const menu=read('menu.html'),manifest=JSON.parse(read('manifest-menu.json'));
const customerHtml=read('src','html','customer','20-commerce.html');
const customerNav=read('src','html','customer','00-document-navigation.html');
const customerQr=read('src','customer','core','09a-qr-dine-in.mjs');
const customerAuth=read('src','customer','core','00-firebase-auth.mjs');
const functions=read('src','functions','30-orders.js');
const posState=read('src','admin','pos','00-shared-state.js');
const posShell=read('src','admin','pos','50a-register-shell.js');
const posQr=read('src','admin','pos','50aa-qr-orders.js');
const posSale=read('src','admin','pos','50f-sale-persistence.js');
const offlineSync=read('functions','lib','offline-sync.js');
const rules=read('database.rules.json');
const pwa=read('assets','js','pwa-register.js');

check(menu.includes("location.replace('index.html?qr=1#order')"),'The general QR URL must open menu-only ordering mode.');
check(manifest.name==='Accaza Menu'&&manifest.start_url==='/menu.html','The dedicated menu PWA must reopen the general QR menu.');
check(customerNav.includes("window.__accazaQrOrderMode=true")&&customerNav.includes("manifest.href='/manifest-menu.json'"),'QR mode must select the dedicated menu shell before install.');
for(const marker of ['qrCustomerName','qrSendOrderBtn','Proceed immediately to the cashier','queue number','data-install-copy="Add Accaza Menu to Home Screen"'])check(customerHtml.includes(marker),`Customer QR UI is missing: ${marker}`);
check(pwa.includes("button.getAttribute('data-install-copy')"),'The exact Accaza Menu install-button wording must be preserved.');
check(customerAuth.includes("httpsCallable(functions,'createQrOrderTicket')")&&customerQr.includes('createQrOrderTicketCall'),'Customer checkout must use the protected QR-ticket callable.');
for(const marker of ['exports.createQrOrderTicket','exports.manageQrOrderTicket','QR_TICKET_TTL_MS','qrOrderCounters','qrOrderLocks','currentQrPrice','paymentStatus: "unpaid"','createdShiftId: shift.id'])check(functions.includes(marker),`Server QR workflow is missing: ${marker}`);
const createSegment=functions.slice(functions.indexOf('exports.createQrOrderTicket'),functions.indexOf('exports.manageQrOrderTicket'));
check(!createSegment.includes('orders/${'),'Creating an unpaid QR ticket must not create a sale or Finance Books posting.');
check(posState.includes("subscribe('activeQrTickets'")&&posState.includes('notifyNewQrTickets'),'POS must listen only to the active QR-ticket node.');
const inStore=posShell.indexOf('🏪 In-store'),qr=posShell.indexOf('📱 QR Orders'),online=posShell.indexOf('🌐 Online Orders'),shift=posShell.indexOf('🧾 Shift Orders');
check(inStore>=0&&inStore<qr&&qr<online&&online<shift,'QR Orders must sit between In-store and Online Orders, before Shift Orders.');
for(const marker of ['posQrCount','renderQrOrders','updateQrOrderCount'])check(posShell.includes(marker),`POS QR tab is missing: ${marker}`);
for(const marker of ['qrTicketChime','New QR order ·','navigator.vibrate','Open for Checkout','Finish, hold, or clear the current in-store sale','manageQrOrderTicket'])check(posQr.includes(marker),`Cashier QR alert/open workflow is missing: ${marker}`);
for(const marker of ["order.orderEntryMethod='customer_qr'","order.qrTicketId=posQrTicket.id","order.qrQueueNumber=posQrTicket.queueNumber","order.qrTicketClaimToken=posQrTicket.claimToken"] )check(posSale.includes(marker),`Final POS sale is missing QR source linkage: ${marker}`);
for(const marker of ['row.status==="converting"','qrTicketClaimToken','delete order.qrTicketClaimToken','archivedQrTickets','activeQrTickets/${qrTicket.id}`]=null','convert_qr_order_to_pos_sale'])check(offlineSync.includes(marker),`Single-use QR sale conversion is missing: ${marker}`);
check(rules.includes('"activeQrTickets"')&&rules.includes('"qrOrderCounters"')&&rules.includes('"archivedQrTickets"'),'Database rules must expose active QR tickets only to authorized POS users and keep server nodes private.');

console.log('QR dine-in menu, cashier alert, POS handoff, and single-posting checks passed.');
