import fs from 'node:fs';

function fail(message){
  console.error('FAIL:',message);
  process.exitCode=1;
}

function assertEvidenceFieldsOutsideSupplierWrapper(file){
  const source=fs.readFileSync(file,'utf8');
  const supplierId=source.indexOf('id="pvSupplierWrap"');
  const supplierStart=source.lastIndexOf('<div',supplierId);
  const purposeId=source.indexOf('id="pvPurpose"',supplierId);
  const purposeStart=source.lastIndexOf('<div',purposeId);
  if(supplierStart<0||purposeId<0){fail(file+': cash-payment evidence controls are missing');return;}
  const beforePurpose=source.slice(supplierStart,purposeStart);
  const opens=(beforePurpose.match(/<div\b/g)||[]).length;
  const closes=(beforePurpose.match(/<\/div>/g)||[]).length;
  if(opens!==closes)fail(file+': explanation and receipt controls are nested inside the hidden supplier-only section');
  if(!source.includes('id="pvReceipt" type="file" accept="image/*"'))fail(file+': receipt image input is missing');
  if(!source.includes("if(!file&&!purpose){alert('Attach a receipt or enter a clear explanation"))fail(file+': voucher evidence validation is missing');
  if(!source.includes('purpose:purpose')||!source.includes("receiptImg:img||''"))fail(file+': voucher evidence is not retained on the operational record');
}

assertEvidenceFieldsOutsideSupplierWrapper('src/admin/register/40-revolving-fund.js');
assertEvidenceFieldsOutsideSupplierWrapper('assets/js/admin/register.js');

const controls=fs.readFileSync('src/functions/21-operational-controls.js','utf8');
if(!controls.includes('voucher.receiptImg ? "receipt" : "manager_reviewed_explanation"'))fail('Approval audit does not identify the evidence used');
const financePosting=fs.readFileSync('src/functions/41-expense-assets.js','utf8');
if(!financePosting.includes('Financial.movement(isAdvance?"revolving_fund_purchase_advance":posting.movementType, "pettyVoucher", id'))fail('Approved cash payments are not linked to their Finance Books source');
if(!financePosting.includes('`petty_void_${id}`'))fail('Approved cash-payment reversals are not linked to their original voucher');

if(!process.exitCode)console.log('Cash-payment evidence form checks passed.');
