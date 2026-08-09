import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.join(process.cwd(),'functions','index.js'),'utf8');
const start=source.indexOf('async function claimManagerApproval');
const end=source.indexOf('\nexports.createManagerApproval',start);
if(start<0||end<0)throw new Error('Manager approval claim function not found');

class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const sandbox={HttpsError,Financial:{money(value){return Math.round((Number(value)||0)*100)/100;}},financeKey(value){const key=String(value||'').trim();if(!/^[A-Za-z0-9_-]{1,160}$/.test(key))throw new HttpsError('invalid-argument','Invalid approval');return key;},result:null};
vm.createContext(sandbox);
vm.runInContext(`${source.slice(start,end)}\nresult=claimManagerApproval;`,sandbox);

const approval={action:'review_discrepancy',sourceId:'disc_test',amount:null,approvedBy:'admin_uid',approvedRole:'admin',expiresAt:Date.now()+60000};
let row={...approval},warmed=false,transactionCalls=0;
const ref={
  async get(){warmed=true;return{val(){return row;}};},
  async transaction(update){transactionCalls++;const current=warmed?row:null,next=update(current);if(next===undefined)return{committed:false,snapshot:{val(){return row;}}};row=next;return{committed:true,snapshot:{val(){return row;}}};}
};
const db={ref(){return ref;}};
const claimed=await sandbox.result(db,{approvalId:'approval_test'},'review_discrepancy','disc_test',null,'review_discrepancy_disc_test');
if(claimed.id!=='approval_test'||row.claimKey!=='review_discrepancy_disc_test'||transactionCalls!==1)throw new Error('Valid cold-cache Admin approval was not claimed atomically');
if(!claimed.usedWrites['financialApprovals/approval_test/usedAt'])throw new Error('Claim does not produce one-time-use writes');

let rejected=false;
try{await sandbox.result(db,{approvalId:'approval_test'},'confirm_payment','disc_test',null,'confirm_disc_test');}catch(error){rejected=error.code==='failed-precondition';}
if(!rejected)throw new Error('Mismatched approval action was accepted');

console.log('PASS: valid cold-cache privileged approvals are loaded, matched, and claimed atomically.');
