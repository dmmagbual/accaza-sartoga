import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {buildOperationalExceptions}=require('../functions/lib/operational-exceptions.js');
const now=Date.UTC(2026,7,9,12),hour=3600000,day=24*hour;
const result=buildOperationalExceptions({
  activeOrders:{stuck:{status:'Preparing',updatedAt:now-3*hour},fresh:{status:'Pending',timestamp:now-1000}},
  offlinePosSync:{partial:{state:'order-written',updatedAt:now-hour},done:{state:'synced',updatedAt:now-hour}},
  orders:{bad:{status:'Completed',timestamp:now-hour,paymentStatus:'confirmed'},marker:{status:'Completed',timestamp:now-hour,paymentStatus:'pending'},good:{status:'Received',timestamp:now-hour,paymentStatus:'confirmed',inventoryDeducted:true,inventoryLedgerVersion:1}},
  inventoryMovementEvidence:{marker:true},
  financialMovements:{sale_good:{id:'sale_good'}},
  cashCustody:{old:{remaining:1250,closedAt:now-4*day},new:{remaining:100,closedAt:now-hour}},
  telemetry:{today:{errors:{proof_access:2,js_core:1}}},
},now);
const cats=result.exceptions.map(x=>x.category);
for(const expected of ['stuck_order','offline_sync','inventory_gap','inventory_marker_gap','financial_gap','cash_custody','payment_proof','client_error'])if(!cats.includes(expected))throw new Error('missing exception '+expected);
if(result.counts.critical!==5||result.counts.warning!==3)throw new Error('severity counts are incorrect');
if(result.exceptions.find(x=>x.id==='marker').severity!=='warning')throw new Error('existing inventory movement evidence was still classified as a critical stock gap');
if(result.exceptions.find(x=>x.id==='old').tab!=='undeposited')throw new Error('cash custody exception does not open Undeposited Collection');
if(cats.includes('fresh')||result.exceptions.some(x=>x.id==='done'||x.id==='new'||x.id==='good'))throw new Error('healthy records produced false exceptions');
if(result.exceptions.some(x=>JSON.stringify(x).includes('customer')))throw new Error('exception response leaked customer content');
console.log('PASS: Release 7B bounded exception classification, severity, and healthy-record suppression passed.');
