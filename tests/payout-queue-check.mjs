import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const source=fs.readFileSync(path.join(root,'assets','js','admin','analytics.js'),'utf8');
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
console.log('PASS: settled payout links override stale archived flags, while reversed payouts return orders to settlement.');
