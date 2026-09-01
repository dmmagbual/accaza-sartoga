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
// M-3: clearing/suspense residual alarm — flag must-be-zero accounts above PHP 50, from the Books GL.
const clearing=buildOperationalExceptions({booksJournal:{
  d1:{net:{'1900':1200.50,'4000':-1200.50}},
  e1:{lines:[{code:'5090',debit:0,credit:75},{code:'1200',debit:75,credit:0}]},
  e2:{lines:[{code:'1290',debit:40,credit:0},{code:'2000',debit:0,credit:40}]},
  e3:{lines:[{code:'6000',debit:500,credit:0},{code:'1010',debit:0,credit:500}]},
}},now);
const cr=clearing.exceptions.filter(x=>x.category==='clearing_residual');
if(cr.length!==2)throw new Error('clearing residual alarm should flag exactly two accounts above PHP 50, got '+cr.length);
if(!clearing.exceptions.find(x=>x.id==='clearing_1900'&&x.severity==='warning'))throw new Error('Suspense 1900 residual not flagged as warning');
if(!clearing.exceptions.find(x=>x.id==='clearing_5090'))throw new Error('Unposted COGS Clearing 5090 residual not flagged');
if(clearing.exceptions.some(x=>x.id==='clearing_1290'))throw new Error('a residual at or below PHP 50 must not flag');
if(clearing.exceptions.find(x=>x.id==='clearing_1900').tab!=='cashflow')throw new Error('clearing residual must route to Finance Books (cashflow)');
if(buildOperationalExceptions({},now).exceptions.some(x=>x.category==='clearing_residual'))throw new Error('no booksJournal must yield no clearing residuals');
console.log('PASS: clearing/suspense residual alarm flags must-be-zero accounts above threshold and ignores non-clearing codes.');

