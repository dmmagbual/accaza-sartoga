import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.join(process.cwd(),'functions','index.js'),'utf8');
const start=source.indexOf('function transactionCurrent');
const end=source.indexOf('\nexports.createManagerApproval',start);
if(start<0||end<0)throw new Error('Privileged approval claim function not found');

const actions=[
  'validate_payment','refund','void','settle_platform_payout','reopen_cash_count',
  'delete_archived_order','review_discrepancy','approve_petty_voucher','correct_petty_voucher','correct_platform_presettlement','set_undeposited_opening_balance','retire_revolving_fund','repair_closed_shift_turnover',
  'reject_petty_voucher','void_petty_voucher','return_supplier_payment','manual_discount','cash_in','fixed_float_exception',
];
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const sandbox={HttpsError,Financial:{money(value){return Math.round((Number(value)||0)*100)/100;}},financeKey(value){const key=String(value||'').trim();if(!/^[A-Za-z0-9_-]{1,160}$/.test(key))throw new HttpsError('invalid-argument','Invalid approval');return key;},result:null};
vm.createContext(sandbox);
vm.runInContext(`${source.slice(start,end)}\nresult=claimManagerApproval;`,sandbox);

function harness(approval){
  let row={...approval},transactionCalls=0,callbackCalls=0;
  const ref={
    async get(){return{val(){return row;}};},
    async transaction(update){transactionCalls++;callbackCalls++;const coldProposal=update(null);if(coldProposal===undefined)return{committed:false,snapshot:{val(){return row;}}};callbackCalls++;const next=update(row);if(next===undefined)return{committed:false,snapshot:{val(){return row;}}};row=next;return{committed:true,snapshot:{val(){return row;}}};},
  };
  return{db:{ref(){return ref;}},row(){return row;},replace(next){row=next;},transactionCalls(){return transactionCalls;},callbackCalls(){return callbackCalls;}};
}
async function expectRejected(work,label){let rejected=false;try{await work();}catch(error){rejected=error.code==='failed-precondition';}if(!rejected)throw new Error(label);}

for(const action of actions){
  const sourceId=`source_${action}`,operationKey=`operation_${action}`,amount=action==='review_discrepancy'||action==='reopen_cash_count'?null:25;
  const h=harness({action,sourceId,amount,approvedBy:'admin_uid',approvedRole:'admin',expiresAt:Date.now()+60000});
  const claimed=await sandbox.result(h.db,{approvalId:`approval_${action}`},action,sourceId,amount,operationKey);
  if(claimed.id!==`approval_${action}`||h.row().claimKey!==operationKey||h.transactionCalls()!==1||h.callbackCalls()!==2)throw new Error(`${action}: valid cold-cache Admin approval was not claimed atomically after the initial null callback`);
  if(!claimed.usedWrites[`financialApprovals/approval_${action}/usedAt`]||claimed.usedWrites[`financialApprovals/approval_${action}/usedBy`]!==operationKey)throw new Error(`${action}: claim does not produce one-time-use writes`);
  h.replace({...h.row(),usedAt:Date.now(),usedBy:operationKey});
  await expectRejected(()=>sandbox.result(h.db,{approvalId:`approval_${action}`},action,sourceId,amount,operationKey),`${action}: used approval was accepted`);
}

const mismatch=harness({action:'review_discrepancy',sourceId:'disc_test',amount:null,approvedBy:'admin_uid',approvedRole:'admin',expiresAt:Date.now()+60000});
await expectRejected(()=>sandbox.result(mismatch.db,{approvalId:'approval_mismatch'},'confirm_payment','disc_test',null,'confirm_disc_test'),'Mismatched approval action was accepted');

const competing=harness({action:'cash_in',sourceId:'cash_in_test',amount:50,approvedBy:'admin_uid',approvedRole:'admin',expiresAt:Date.now()+60000,claimKey:'another_operation'});
await expectRejected(()=>sandbox.result(competing.db,{approvalId:'approval_competing'},'cash_in','cash_in_test',50,'cash_in_operation'),'Approval claimed by another operation was accepted');

const expired=harness({action:'manual_discount',sourceId:'discount_test',amount:10,approvedBy:'admin_uid',approvedRole:'admin',expiresAt:Date.now()-1});
await expectRejected(()=>sandbox.result(expired.db,{approvalId:'approval_expired'},'manual_discount','discount_test',10,'discount_operation'),'Expired approval was accepted');

console.log(`PASS: all ${actions.length} privileged approval actions are cold-cache safe, matched, atomic, and one-time use.`);
