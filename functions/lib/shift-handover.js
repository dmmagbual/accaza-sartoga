"use strict";
const crypto = require('node:crypto');
const DENOMS = {b1000:100000,b500:50000,b200:20000,b100:10000,b50:5000,p20:2000,c10:1000,c5:500,c1:100,c25:25,c10s:10,c5s:5};
function cents(value) {
  const n=Number(value);
  if(!Number.isFinite(n)||Math.abs(n)>100000000)throw new Error('Invalid cash amount.');
  return Math.round(n*100);
}
function countCash(counts) {
  if(!counts||typeof counts!=='object'||Array.isArray(counts))throw new Error('Enter a cash count.');
  let total=0;
  for(const [key,qty] of Object.entries(counts)){
    if(!Object.hasOwn(DENOMS,key)||!Number.isInteger(qty)||qty<0||qty>10000)throw new Error('Cash quantities must be whole, non-negative denomination counts.');
    total+=DENOMS[key]*qty;
  }
  if(total>100000000)throw new Error('Cash count exceeds the supported limit.');
  return total;
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function digest(command){return crypto.createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');}
// Realtime Database does not store null, undefined, empty objects or empty arrays. A command
// retained at handover and read back therefore differs byte-for-byte from what the device
// sends (for example paymentVerificationPolicy:null, discountLines:[], drawerDelta:{}).
// Commands are compared in that stored form, so a manager replay of the retained copy and a
// later device flush of the original both match the same sale.
function storedForm(value){
  if(value===null||value===undefined||(typeof value==='number'&&!Number.isFinite(value)))return undefined;
  if(Array.isArray(value)){const items=value.map(storedForm).filter(x=>x!==undefined);return items.length?items:undefined;}
  if(typeof value==='object'){const out={};for(const key of Object.keys(value)){const item=storedForm(value[key]);if(item!==undefined)out[key]=item;}return Object.keys(out).length?out:undefined;}
  return value;
}
function commandDigest(command){return digest(storedForm(command)||{});}
function sameCommand(a,b){return !!a&&!!b&&commandDigest(a)===commandDigest(b);}
function commandOf(row){return {transactionId:row.id,order:row.order,drawerDelta:row.drawerDelta||{}};}
function sealCommands(rows,shift,cutoff){
  if(!Array.isArray(rows)||rows.length>500)throw new Error('Invalid handover sale list.');
  const commands={};
  for(const row of rows){
    if(row&&row.status==='synced'||row&&row.order&&row.order.shiftId&&row.order.shiftId!==shift.id)continue;
    if(!row||!row.order){const key='quarantine_'+digest(row);commands[key]={quarantined:true,raw:row||null,orderId:key,lastError:'Unreadable local sale: management must recover the original evidence.'};continue;}
    const command=commandOf(row),o=command.order;
    if(!/^[A-Za-z0-9_-]{12,120}$/.test(row.id)||o.clientTxnId!==row.id||!/^((POS)|(GF)|(FP))-[A-Za-z0-9_-]+$/.test(o.id)||o.source!=='pos'||o.status!=='Completed'||!Number.isFinite(Number(o.timestamp))||Number(o.timestamp)<Number(shift.openAt)||Number(o.timestamp)>cutoff){const key='quarantine_'+digest(row);commands[key]={quarantined:true,raw:row,orderId:String(o.id||key),lastError:'Invalid sale identity or date. Evidence retained for management recovery.'};continue;}
    commands[row.id]={command,hash:commandDigest(command),orderId:o.id,lastError:String(row.lastError||'').slice(0,500)};
  }
  if(Buffer.byteLength(JSON.stringify(commands),'utf8')>4000000)throw new Error('Export this large queue for recovery before handover.');
  return commands;
}
function cashSnapshot(shift,counts,fixedFloat){
  const counted=countCash(counts),target=cents(fixedFloat==null?shift.openingFloat||0:fixedFloat);
  if(target<0)throw new Error('Invalid configured float.');
  return {countedCash:counted/100,closeCount:counts,retainedFloat:target/100,actualFloatRetained:Math.min(counted,target)/100,floatShortfall:Math.max(0,target-counted)/100,cashToSettle:Math.max(0,counted-target)/100};
}
// Report labels become Realtime Database keys, which cannot be empty or contain
// . # $ / [ ]. Cash and platform rows have no receiving account, so an empty key
// would reject the whole reconciliation write; unassigned accounts are not split.
function reportKey(value){return String(value==null?'':value).replace(/[.#$/\[\]\u0000-\u001f\u007f]/g,'_').trim().slice(0,120);}
// Only recognized server orders enter the final report. The original handover count
// and time remain immutable; delayed sales change the final reconciliation only.
function report(shift,orders,handover){
  const z={tx:0,gross:0,discounts:0,refunds:0,cashRefunds:0,net:0,cashSales:0,tips:0,voidCount:0,voidAmt:0,pending:0,pendingCount:0,managerPending:0,managerPendingCount:0,byMethod:{},byMethodAccount:{},byChannel:{instore:0,online:0,grabfood:0,foodpanda:0},bySeller:{},sales:[]};
  for(const [id,o] of Object.entries(orders)){
    if(!o||o.shiftId!==shift.id)continue;
    if(o.voided){z.voidCount++;z.voidAmt+=cents(o.total||0);continue;}
    if(!['Completed','Received'].includes(o.status==='Archived'?o.prevStatus:o.status))continue;
    const platform=['grabfood','foodpanda'].includes(o.channel);
    const gross=cents(platform&&o.grossPlatform!=null?o.grossPlatform:o.subtotal==null?o.total:o.subtotal),discount=platform?(o.netSalesPlatform!=null?Math.max(0,gross-cents(o.netSalesPlatform)):cents(o.platformDiscount||0)):cents(o.discount||0),refund=cents(o.refundAmount||0),rows=Array.isArray(o.payments)&&o.payments.length?o.payments:[{method:o.payment,amount:o.total}];
    z.tx++;z.gross+=gross;z.discounts+=discount;z.refunds+=refund;z.net+=gross-discount-refund;z.tips+=cents(o.tipRounding||0);
    z.byChannel[Object.hasOwn(z.byChannel,o.channel)?o.channel:'instore']+=gross-discount-refund;
    // Shift crew: who rang each sale (informational; the drawer stays the owner's).
    const seller=reportKey(o.soldByStaffId||o.soldByUid||shift.staffId||'owner')||'owner';z.bySeller[seller]||={name:String(o.soldBy||shift.staff||'').slice(0,120),role:String(o.soldByRole||'owner'),tx:0,net:0};z.bySeller[seller].tx++;z.bySeller[seller].net+=gross-discount-refund;
    for(const p of rows){let method=reportKey(platform?(o.channel==='grabfood'?'GrabFood':'FoodPanda'):String(p.paymentMethod||p.method||'Unknown').split(' · ')[0])||'Unknown';if(method.toLowerCase()==='cash')method='Cash';const value=cents(p.amount||0),account=reportKey(p.receivingAccountName||p.receivingAccountId||'');z.byMethod[method]=(z.byMethod[method]||0)+value;z.byMethodAccount[method]||={};if(account)z.byMethodAccount[method][account]=(z.byMethodAccount[method][account]||0)+value;if(!platform&&method==='Cash')z.cashSales+=value;}
    z.cashRefunds+=cents(o.refundPayments?(o.refundPayments.Cash||o.refundPayments.cash||0):rows.some(p=>String(p.method).toLowerCase()==='cash')?o.refundAmount||0:0);
    if(o.paymentStatus==='pending'){z.pending+=cents(o.total||0);z.pendingCount++;}
    if(o.paymentStatus==='cashier_verified'){z.managerPending+=cents(o.total||0);z.managerPendingCount++;}
    z.uncostedCount=(z.uncostedCount||0)+Math.max(0,Number(o.costPendingLines)||0);
    z.sales.push({id,total:o.total||0,payments:o.payments||null,payment:o.payment||'',refundAmount:o.refundAmount||0,refundPayments:o.refundPayments||null,channel:o.channel||'instore',timestamp:o.timestamp||0,occurredAt:o.completedAt||o.receivedAt||o.timestamp||0});
  }
  z.payIns=(shift.payIns||[]).reduce((s,r)=>s+cents(r.amount||0),0);z.payOuts=(shift.payOuts||[]).reduce((s,r)=>s+cents(r.amount||0),0);
  z.expectedCash=cents(shift.openingFloat||0)+z.cashSales+z.tips-z.cashRefunds+z.payIns-z.payOuts;
  z.variance=cents(handover.cash.countedCash)-z.expectedCash;
  for(const k of ['gross','discounts','refunds','cashRefunds','net','cashSales','tips','voidAmt','pending','managerPending','payIns','payOuts','expectedCash','variance'])z[k]/=100;
  for(const map of [z.byMethod,z.byChannel])for(const k of Object.keys(map))map[k]/=100;
  for(const row of Object.values(z.bySeller))row.net/=100;
  for(const map of Object.values(z.byMethodAccount))for(const k of Object.keys(map))map[k]/=100;
  return {...z,...handover.cash,capturedAt:handover.at,openingFloat:shift.openingFloat||0,openCount:shift.openCount||{},expectedDrawer:shift.drawer||{},payInEntries:shift.payIns||[],payOutEntries:shift.payOuts||[],varianceStatus:z.variance?'pending_manager_reconciliation':'reconciled',schemaVersion:5};
}
module.exports={cents,countCash,digest,storedForm,commandDigest,sameCommand,commandOf,sealCommands,cashSnapshot,report,reportKey};
