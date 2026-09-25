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
for(const expected of ['stuck_order','offline_sync','inventory_gap','inventory_marker_gap','financial_gap','payment_proof'])if(!cats.includes(expected))throw new Error('missing exception '+expected);
if(cats.includes('client_error'))throw new Error('generic client telemetry must stay in technical diagnostics');
if(result.counts.critical!==4||result.counts.warning!==2)throw new Error('severity counts are incorrect');
if(result.exceptions.find(x=>x.id==='marker').severity!=='warning')throw new Error('existing inventory movement evidence was still classified as a critical stock gap');
if(result.exceptions.some(x=>x.category==='cash_custody'))throw new Error('normal undeposited cash was incorrectly classified as an operational exception');
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
// Accaza AI provider health: a question nothing answered is critical; a backup answer is a warning.
{const ai=buildOperationalExceptions({aiProviderHealth:{'2026-09-25':{failedQuestions:2,backupAnswers:{ollama:3,deepseek:1},providerFailures:{gemini:6},lastEvent:{at:now,answeredBy:'none',failures:[{provider:'gemini',reason:'quota exceeded'}]}},'2026-09-24':null}},now).exceptions.filter(x=>x.category==='ai_provider');
const failed=ai.find(x=>x.id==='ai_failed_2026-09-25'),backup=ai.find(x=>x.id==='ai_backup_2026-09-25');
if(ai.length!==2||!failed||failed.severity!=='critical'||!/2 questions/.test(failed.title)||!/quota exceeded/.test(failed.detail))throw new Error('all-provider AI failures must raise one critical exception with the last reason');
if(!backup||backup.severity!=='warning'||!/4 times/.test(backup.title)||!/ollama 3/.test(backup.detail))throw new Error('backup AI answers must raise one warning with per-provider counts');
if(buildOperationalExceptions({aiProviderHealth:{'2026-09-25':{failedQuestions:0,backupAnswers:{}}}},now).exceptions.some(x=>x.category==='ai_provider'))throw new Error('a clean AI day must raise nothing');
console.log('PASS: Accaza AI provider failures and backup answers surface in the Exception Center.');}
