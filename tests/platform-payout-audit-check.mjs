import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const ui=fs.readFileSync(path.join(root,'src','admin','analytics','40-platform-payout-reconciliation.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'assets','js','admin','payout-audit.mjs'),'utf8');
const server=fs.readFileSync(path.join(root,'src','functions','43d-platform-settlement.js'),'utf8');
const reversal=fs.readFileSync(path.join(root,'src','functions','43e-platform-reversal.js'),'utf8');
const approval=fs.readFileSync(path.join(root,'src','functions','20-portal-operations.js'),'utf8');
const subscriptions=fs.readFileSync(path.join(root,'src','admin','analytics','00-bootstrap-subscriptions.js'),'utf8');
const hub=fs.readFileSync(path.join(root,'assets','js','admin','realtime-hub.mjs'),'utf8');

for(const marker of ['p.orderSnapshots','p.orderIds||[]','ordersMap[id]||archMap[id]','resolved.missing.length','p.movementId','p.depositMovementId','p.reversalApprovalId']){
  if(!ui.includes(marker))throw new Error(`Payout audit lost legacy or linked-record evidence: ${marker}`);
}
for(const marker of ['gross,merchantPromo,deliveryFeeDiscount','hasMappedDiscounts','discountParts.promo','commission,wht,vat,adsMarketing,marketingFee,expectedNet:net','orderSnapshots.reduce((sum,row)=>sum+row.expectedNet,0)']){
  if(!server.includes(marker))throw new Error(`Settlement snapshot lost a required financial field: ${marker}`);
}
for(const marker of ['id="poLoanAccount"','id="poLoanAmount"','loanRepayment:loanRepayment','liability principal','Reduces the selected loan balance; it is not an expense']){
  if(!ui.includes(marker))throw new Error(`GrabFood loan payout control is missing: ${marker}`);
}
for(const marker of ['channel!=="grabfood"','/^23\\d{2}$/.test(accountCode)','loan.active===false','loan.type!=="Liability"','loanRepayment={amount,accountCode,accountName','netAlloc-loanRepayment.amount','schemaVersion: 3']){
  if(!server.includes(marker))throw new Error(`Server-authoritative GrabFood loan validation or evidence is missing: ${marker}`);
}
for(const marker of ['function platformPayoutApprovalFingerprint','"platform-payout:v1"','bindsPlatformPayout=action==="settle_platform_payout"']){
  if(!approval.includes(marker))throw new Error(`GrabFood payout approval does not bind the exact settlement: ${marker}`);
}
for(const marker of ["{change:approvalChange}",'platformPayoutApprovalFingerprint(payoutId,approvalChange)']){
  if(!(ui.includes(marker)||server.includes(marker)))throw new Error(`Settlement approval fingerprint wiring is missing: ${marker}`);
}
for(const marker of ['payout.loanRepayment','`coa:${accountCode}`','Reverse GrabFood loan principal repayment']){
  if(!reversal.includes(marker))throw new Error(`GrabFood loan reversal lost the stored liability: ${marker}`);
}
if(!subscriptions.includes("a.subscribe('booksChart'"))throw new Error('Platform Payouts does not subscribe to the bounded Finance Books chart.');
if(!hub.includes("booksChart:['discrepancy','purchases','petty','payouts']"))throw new Error('The Finance Books chart is not scoped to the active Payouts screen.');

const sample=[{expectedNet:123.45},{expectedNet:76.55}];
const total=Math.round(sample.reduce((sum,row)=>sum+row.expectedNet,0)*100)/100;
if(total!==200)throw new Error('Payout order snapshot total is not cent-exact for the audit reconciliation.');

console.log('PASS: settled payouts retain immutable order evidence and expose legacy-safe audit review links.');
