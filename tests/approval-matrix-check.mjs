import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const functionsSource=read('functions','index.js');
const managerSource=read('assets','js','admin','manager-approval.mjs');
const coreSource=read('assets','js','admin','core.mjs');
const registerSource=read('assets','js','admin','register.js');
const posSource=read('assets','js','admin','pos.js');
const analyticsSource=read('assets','js','admin','analytics.js');
const clientSource=[coreSource,registerSource,posSource,analyticsSource].join('\n');
const expected=[
  'validate_payment','refund','void','settle_platform_payout','reopen_cash_count',
  'delete_archived_order','review_discrepancy','approve_petty_voucher',
  'reject_petty_voucher','void_petty_voucher','manual_discount','cash_in','purchase_cash_advance','fixed_float_exception','reverse_purchase',
  'rekey_platform_order','reverse_platform_payout',
];
const fail=(message)=>{throw new Error(message);};
const setStart=functionsSource.indexOf('const MANAGER_APPROVAL_ACTIONS = new Set([');
const setEnd=functionsSource.indexOf(']);',setStart);
if(setStart<0||setEnd<0)fail('Server approval action registry is missing');
const actionBlock=functionsSource.slice(setStart,setEnd);

for(const action of expected){
  if(!actionBlock.includes(`"${action}"`))fail(`Server does not allow approval action: ${action}`);
  if(!clientSource.includes(`managerApproval('${action}'`)&&!clientSource.includes(`requestManagerApproval('${action}'`))fail(`No interface uses approval action: ${action}`);
}
const declared=[...actionBlock.matchAll(/"([a-z_]+)"/g)].map(match=>match[1]);
const extras=declared.filter(action=>!expected.includes(action));
if(extras.length)fail(`Unreviewed server approval actions: ${extras.join(', ')}`);
if(!functionsSource.includes('["owner", "superadmin", "admin", "manager"].includes(managerRole)'))fail('Server privileged-role list does not explicitly include Admin');
if(!managerSource.includes('authz&&authz.isPrivileged&&current')||!managerSource.includes('current.getIdToken(true)'))fail('Signed-in Admin cannot approve directly with the current Firebase session');
if(!functionsSource.includes('requirePortalPermission(db, request, ["registerOps", "pos"])'))fail('POS and Register Ops cannot consume privileged approvals');
if((functionsSource.match(/transactionCurrent\(/g)||[]).length<4)fail('Approval workflows do not consistently recover from Firebase initial-null transaction callbacks');
if(/Manager PIN|__posIsManagerPin|managerByPin/.test(registerSource+'\n'+posSource))fail('A privileged action still relies on the legacy shared Manager PIN');
if(!posSource.includes('discountApprovedByUid')||!posSource.includes('discountApprovedRole'))fail('Manual discount approval identity is not attached to the sale audit record');
if(!registerSource.includes('approvedByUid:cd.approvedByUid')||!registerSource.includes('approvedRole:cd.approvedRole'))fail('Cash-in approval identity is not attached to the shift audit record');

console.log(`PASS: interface and server agree on all ${expected.length} privileged actions, with Admin direct approval and approver audit identity.`);
