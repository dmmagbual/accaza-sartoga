import fs from 'node:fs';
import {archiveOutcome} from '../assets/js/admin/order-display.mjs';
// Active Orders cards must identify their sales channel (In-store / Online / GrabFood / FoodPanda),
// matching the POS Shift Orders tags, so staff can tell platform orders apart at a glance.
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('assets/js/admin/admin-orders.mjs'),display=read('assets/js/admin/order-display.mjs'),css=read('assets/css/admin-backoffice.css'),posCss=read('assets/css/admin/pos-workflow.css');
const fail=m=>{throw new Error(m);};
const labels=display.match(/const ORDER_CHANNEL_LABELS=\{[^}]*\};/),fn=display.match(/export function orderChannel\(o\)\{[^\n]*\}/);
if(!labels||!fn)fail('Active Orders channel resolver is missing');
const orderChannel=new Function(labels[0]+fn[0].replace('export ','')+';return orderChannel;')();
const cases=[
  [{channel:'grabfood',source:'pos'},'grabfood'],[{channel:'foodpanda',source:'pos'},'foodpanda'],
  [{channel:'instore',source:'pos'},'instore'],[{channel:'online',source:'online'},'online'],
  [{channel:'GrabFood',source:'pos'},'grabfood'],[{source:'pos'},'instore'],[{source:'online'},'online'],
  [{},'online'],[{channel:'mystery',source:'pos'},'instore'],[null,'online']
];
for(const [o,want] of cases){const got=orderChannel(o);if(got!==want)fail(`orderChannel(${JSON.stringify(o)}) = ${got}, expected ${want}`);}
for(const m of ['order-channel-tag','data-order-channel=','order-channel-\'+channel','orderChannelLabel(o)'])if(!src.includes(m))fail(`Active Orders card marker missing: ${m}`);
for(const m of ['.order-admin-card.order-channel-online{','.order-admin-card.order-channel-grabfood{','.order-admin-card.order-channel-foodpanda{','.order-channel-tag{','.order-admin-card[data-order-channel]{border-left-color:var(--order-channel)'])if(!css.includes(m))fail(`Active Orders channel style missing: ${m}`);
const color=(sheet,re)=>(sheet.match(re)||[])[1];
const pairs=[['online',/order-channel-online\{--order-channel:(#[0-9a-f]{6})/i,/pos-active-card\.channel-online\{--channel:(#[0-9a-f]{6})/i],['grabfood',/order-channel-grabfood\{--order-channel:(#[0-9a-f]{6})/i,/pos-active-card\.channel-grabfood\{--channel:(#[0-9a-f]{6})/i],['foodpanda',/order-channel-foodpanda\{--order-channel:(#[0-9a-f]{6})/i,/pos-active-card\.channel-foodpanda\{--channel:(#[0-9a-f]{6})/i]];
for(const [ch,a,b] of pairs){if(!color(css,a)||color(css,a)!==color(posCss,b))fail(`Active Orders ${ch} colour drifted from POS Shift Orders`);}
if(color(css,pairs[0][1])===color(css,pairs[1][1]))fail('Online and GrabFood must not share a channel colour');
// Walk-in / GrabFood / FoodPanda are not website pick-ups; the Pick-up/Delivery badge is website-only.
if(!src.includes("modeBadge=orderChannel(o)!=='online'?'':"))fail('Pick-up/Delivery badge must be limited to website orders');
if(archiveOutcome({voided:true}).label!=='Voided'||archiveOutcome({total:100,refundAmount:100}).label!=='Refunded'||archiveOutcome({status:'Completed'}).label!=='Completed')fail('Archived order outcomes changed while moving display helpers');
// 28 Oct 2026: payment badge, verification policy and item list moved unchanged to order-card-parts.mjs.
globalThis.window={__posSettings:{payMethods:[{name:'BDO',verificationPolicy:'cashier_manager'}]}};
const parts=await import('../assets/js/admin/order-card-parts.mjs'),esc=v=>String(v).replace(/</g,'&lt;'),policy=parts.verificationPolicy,badge=parts.paymentState;
if(policy({payment:'Cash'})!==null||policy({payment:'GCash'})!=='cashier_manager'||policy({payment:'Bank Transfer'})!=='manager_only'||policy({payment:'BDO'})!=='cashier_manager'||policy({payments:[{method:'GrabFood'}]})!==null)fail('Payment verification policy changed while moving card parts');
if(!badge({voided:true}).includes('Voided sale')||!badge({paymentStatus:'pending',payment:'Bank Transfer'}).includes('Awaiting manager verification')||!badge({paymentStatus:'pending',payment:'GCash'}).includes('Awaiting cashier verification')||!badge({paymentStatus:'confirmed',payment:'GCash'}).includes('Manager validated')||!badge({paymentStatus:'confirmed',payment:'Cash',status:'Completed'}).includes('Sale locked'))fail('Order payment badge changed while moving card parts');
const items=parts.orderItemsHtml({source:'online',items:'Latte (Hot, Large) x2, <b>Muffin'},esc);
if((items.match(/order-item-row/g)||[]).length!==2||!items.includes('2×')||items.includes('<b>')||!src.includes('orderItemsHtml(o,escHtml)'))fail('Active order item list changed while moving card parts');
// 29 Oct 2026: an order that cannot be archived must say why when Archive is pressed (cards stay
// clean), and the reason must follow the server's archive and serving-queue rules.
{
  const {createRequire}=await import('node:module'),Service=createRequire(import.meta.url)('../functions/lib/order-service.js');
  const m=src.match(/export function orderArchiveBlock\(o,ctx\)\{[\s\S]*?\n\}\n/);if(!m)fail('orderArchiveBlock is missing from admin-orders.mjs');
  const block=new Function(m[0].replace('export ','')+';return orderArchiveBlock;')();
  const mgr={role:'manager',shift:{id:'S9',status:'open',openAt:Date.UTC(2026,9,26,0,0)}},closedPos={id:'A1',source:'pos',channel:'instore',status:'Completed',shiftId:'S1',total:100,service:{state:'served'}};
  const reason=(o,ctx=mgr)=>block(o,ctx).reason;
  if(!block(closedPos,mgr).ok)fail('A served closed-shift sale must be archivable');
  if(reason(Object.assign({},closedPos,{shiftId:'S9'}))!=='current_shift'||!block(Object.assign({},closedPos,{shiftId:'S9'}),mgr).message.includes('Close that shift'))fail('An open-shift order must explain that the shift has to be closed');
  if(!block(Object.assign({},closedPos,{shiftId:'S9'}),{role:'admin',shift:{id:'S9',status:'closed'}}).ok)fail('A closed current shift no longer blocks archiving');
  if(reason(closedPos,{role:'staff',shift:null})!=='role'||reason(closedPos,{shift:null})!=='role')fail('Non-manager or unverified roles must be told archiving needs a manager');
  if(reason({source:'online',status:'Ready'})!=='not_final'||!block({source:'online',status:'Pending'},mgr).message.includes('POS → Online Orders'))fail('Unfinished orders must be told to complete or reject first');
  if(!block({source:'pos',channel:'instore',status:'Pending',voided:true,shiftId:'S1'},mgr).ok)fail('Voided sales are final and archivable, as on the server');
  if(reason(Object.assign({},closedPos,{service:{state:'preparing'}}))!=='serving_queue')fail('Serving-queue orders must say they still need serving');
  if(reason(Object.assign({},closedPos,{service:{state:'not_collected'}}))!=='serving_queue'||!block(Object.assign({},closedPos,{service:{state:'not_collected',reviewedAt:1}}),mgr).ok)fail('Unreviewed not-collected orders wait for a manager review');
  if(reason({source:'pos',channel:'grabfood',status:'Completed',total:50})!=='shift_missing'||!block({source:'pos',channel:'grabfood',status:'Completed',enteredVia:'payout-rekey',catchup:true},mgr).ok)fail('Shift-less till orders are blocked unless they are payout re-keys');
  const fixtures=[closedPos,Object.assign({},closedPos,{service:{state:'queued'}}),Object.assign({},closedPos,{service:{state:'ready'},refundAmount:100}),Object.assign({},closedPos,{service:{state:'not_collected'}}),Object.assign({},closedPos,{service:{state:'not_collected',reviewedAt:5}}),Object.assign({},closedPos,{channel:'foodpanda',service:{state:'preparing'}}),Object.assign({},closedPos,{voided:true,service:{state:'queued'}}),{source:'online',status:'Completed',shiftId:'S1',posCaptured:true,service:{state:'ready'}},{source:'online',status:'Completed',service:{state:'not_collected'}},{source:'pos',status:'Rejected',shiftId:'S1',service:{state:'queued'}}];
  for(const o of fixtures)if((reason(o)==='serving_queue')!==Service.keepsOrderLive(o))fail('Archive reason and server serving-queue rule disagree on '+JSON.stringify(o));
  if(src.includes('order-archive-note')||!src.includes('var block=o.archivePending?{ok:true}:orderArchiveBlock(o,deps.archiveContext());if(!block.ok||!(o.archivePending||deps.canArchiveOrder(o))){alert(')||!src.includes('res.removedStaleCopy')||!src.includes('if(res.changed)alert('))fail('Order cards stay clean; pressing Archive must explain a block and report already-archived or changed results');
  for(const k of ['current_shift','shift_open','shift_missing','not_final','serving_queue','posting_incomplete','too_recent'])if(!src.includes("add('"+k+"',"))fail('Bulk archive result must explain skipped reason '+k);
}
console.log('Active order channel check passed');
