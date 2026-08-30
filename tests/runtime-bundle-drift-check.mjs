import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const bundles=[
  {source:'src/admin/pos',target:'assets/js/admin/pos.js'},
  {source:'src/admin/register',target:'assets/js/admin/register.js'},
  {source:'src/admin/analytics',target:'assets/js/admin/analytics.js'},
  {source:'src/admin/finance',target:'assets/js/admin/finance.js'},
  {source:'src/customer/core',target:'assets/js/customer/core.mjs'},
  {source:'src/books/app',target:'assets/js/books/app.js'},
  {source:'src/functions',target:'functions/index.js'}
];

for(const bundle of bundles){
  const sourceDir=path.join(root,bundle.source);
  const files=fs.readdirSync(sourceDir).filter(name=>/\.m?js$/.test(name)).sort();
  const expected=files.map(name=>fs.readFileSync(path.join(sourceDir,name),'utf8')).join('');
  const actual=fs.readFileSync(path.join(root,bundle.target),'utf8');
  if(actual!==expected)throw new Error(`${bundle.target} has drifted from ${bundle.source}. Run npm run build:runtime.`);
}
console.log('PASS: POS, Admin operations, customer core, Finance Books, and Functions runtime bundles exactly match their ordered source sections.');

const retiredLargeSections=[
  'src/admin/pos/11-inventory-skus.js',
  'src/admin/pos/50-register-checkout.js',
  'src/functions/42-financial-commands.js',
  'src/functions/43-purchases-platform.js'
];
for(const file of retiredLargeSections)if(fs.existsSync(path.join(root,file)))throw new Error(`Retired large source section returned: ${file}`);
for(const folder of ['src/admin/pos','src/functions'])for(const name of fs.readdirSync(path.join(root,folder)).filter(name=>/\.m?js$/.test(name))){
  const bytes=fs.statSync(path.join(root,folder,name)).size;
  if(bytes>70000)throw new Error(`Financially sensitive source section exceeds the 70 KB Phase 9 ceiling: ${folder}/${name}`);
}
console.log('PASS: retired checkout/inventory/financial monoliths remain decomposed and no guarded source section exceeds 70 KB.');

const expectedFunctionExports=[
  'notifyOnComplete','notifyStaffOnOrder','notifyStaffOnReservation','notifyOnContactMessage','mirrorPosMovementToBooks','mirrorPosCogsToBooks','ensureBooksJournal','syncRegisterCashFloat','syncActiveRegisterCashFloat','manageCashAccount','indexPlatformOrderRef','manageAccountingPeriod','manageStaffMessage','recordClientTelemetry','getOperationalExceptions','repairOrderInventoryMarker','updateOrderStatus','acceptOnlineOrder','createManagerApproval','consumeManagerApproval','manageOrderArchive','reviewDiscrepancy','reopenDiscrepancy','managePettyVoucher','retireRevolvingFund','getUndepositedControlSnapshot','repairClosedShiftTurnover','reconcileUndepositedCustody','legacyOwnerCapitalReset','runFinancialClose','reopenFinancialCloseOnMovement','reopenFinancialCloseOnOrderChange','repairReversedPayoutDeposit','setUndepositedOpeningBalance','repairPettyVoucherFinancial','archiveActivityLog','syncOfflinePosSale','createOnlineOrder','getPaymentProof','confirmOrderReceived','ensureActiveOrders','syncActiveOrderProjection','pruneClosedShiftOrders','syncPublicOrderStatus','validateRecipeDefinition','onOrderFinancialPosting','preservePostedOrderOnDelete','onShiftPayInsFinancial','onShiftPayOutsFinancial','onShiftOpenFinancial','ensureShiftReference','onShiftCloseFinancial','repairPettyExpenseClassifications','onPettyVoucherFinancial','onPettyReplenishmentFinancial','manageFixedAsset','postFinancialCommand','reconcilePurchasePayable','managePurchaseCorrection','correctPlatformPresettlement','settlePlatformPayout','reversePlatformPayout','setPlatformPayoutDate','processOrderAdjustment','recordPlatformCatchup','ensureFinancialLedger','manageBooksAccount','manageChartAccount','autoRepairFinanceDateOnCashLedgerCreate','repairFinanceDates','auditFinancialControls','postInventoryMovements','ensureInventoryLedger','onOrderFinalize','onOrderInventoryReversal','pruneEphemeralNodes','autoCompleteReadyOnlineOrders','backupDatabaseDaily','evaluateProductionHealth'
];
const functionsSource=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
const actualFunctionExports=[...functionsSource.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match=>match[1]);
if(JSON.stringify(actualFunctionExports)!==JSON.stringify(expectedFunctionExports))throw new Error('The public Firebase Functions export contract changed. Review deployment, trigger, callable, and removal consequences explicitly.');
if(new Set(actualFunctionExports).size!==actualFunctionExports.length)throw new Error('A Firebase Function export is registered more than once.');
console.log(`PASS: all ${actualFunctionExports.length} Firebase Function exports retain their names and registration order.`);
