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
console.log('Active order channel check passed');
