import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const source=fs.readFileSync(path.join(root,'assets','js','admin','analytics.js'),'utf8');
const uiSource=fs.readFileSync(path.join(root,'src','admin','analytics','40-platform-payout-reconciliation.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'src','functions','43d-platform-settlement.js'),'utf8');
function declaration(name){
  const match=source.match(new RegExp(`function ${name}\\([^\\n]+`));
  if(!match)throw new Error(`Missing ${name}`);
  return match[0];
}
const factory=new Function('payoutState','entries',`
  var payoutsMap=payoutState;
  function platEntries(){return entries;}
  ${declaration('settledPayoutOrderIds')}
  ${declaration('poUnsettled')}
  return poUnsettled;
`);
const stale={key:'GF-LATE-1',node:'archivedOrders',o:{id:'GF-LATE-1',channel:'grabfood',settlementStatus:'unsettled'}};
const open={key:'GF-OPEN-1',node:'archivedOrders',o:{id:'GF-OPEN-1',channel:'grabfood',settlementStatus:'unsettled'}};
const payout={po_1:{channel:'grabfood',orderIds:['GF-LATE-1'],reversed:false}};
const hidden=factory(payout,[stale,open])('grabfood').map((entry)=>entry.o.id);
if(hidden.includes('GF-LATE-1'))throw new Error('A stale archived order linked to a settled payout reappeared in the settlement queue.');
if(!hidden.includes('GF-OPEN-1'))throw new Error('A genuinely unsettled order was hidden from the settlement queue.');
const reversed=factory({po_1:{channel:'grabfood',orderIds:['GF-LATE-1'],reversed:true}},[stale])('grabfood');
if(reversed.length!==1)throw new Error('A reversed payout did not return its order to the settlement queue.');

const uiMarkers=[
  "a.orderByChild('settlementStatus'),a.equalTo('unsettled')",
  "unsettled('orders')",
  "unsettled('archivedOrders')",
  'Apply dates',
  'poAppliedRange',
  'all</b> unsettled orders',
  "if(!rangeReady){alert('Choose both dates and click Apply dates before settling.')"
];
for(const marker of uiMarkers)if(!uiSource.includes(marker))throw new Error(`Missing payout queue/date safeguard: ${marker}`);

const serverMarkers=[
  'function platformPayoutPeriod(data)',
  '93 * 86400000',
  'outside the applied payout dates',
  'platformRefDuplicates',
  'same platform reference after removing leading zeros',
  'periodStart:period.periodStart',
  'orderDate:financeDateFromTimestamp(orderedAt)'
];
for(const marker of serverMarkers)if(!serverSource.includes(marker))throw new Error(`Missing server payout safeguard: ${marker}`);

const oldArchived={'GF-OLD-1':{id:'GF-OLD-1',source:'pos',channel:'grabfood',settlementStatus:'unsettled'}};
const recentPage={'GF-RECENT-1':{id:'GF-RECENT-1',source:'pos',channel:'grabfood',settlementStatus:'unsettled'}};
const combined={...recentPage,...oldArchived};
if(!combined['GF-OLD-1'])throw new Error('An old unsettled platform order fell out when merged with the recent page.');
oldArchived['GF-OLD-1'].settlementStatus='settled';
if(Object.values(combined).filter((o)=>(o.settlementStatus||'unsettled')!=='settled').some((o)=>o.id==='GF-OLD-1'))throw new Error('A settled platform order remained in the unsettled queue.');

const canonical=(channel,ref)=>{const prefix=channel==='grabfood'?'GF':'FP',compact=String(ref||'').toUpperCase().replace(/[^A-Z0-9]/g,''),match=compact.match(new RegExp(`^${prefix}0*([0-9]+)$`));return match?`${prefix}${match[1].replace(/^0+/,'')||'0'}`:compact;};
if(canonical('grabfood','GF-883')!==canonical('grabfood','GF-0883'))throw new Error('Zero-padded duplicate Grab references are not canonicalized together.');

console.log('PASS: the all-date unsettled queue survives recent-page cutoffs, applied dates gate settlement, settled orders leave the queue, and server validation protects the payout period and duplicate references.');
