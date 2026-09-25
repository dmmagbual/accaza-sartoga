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
  'notifyOnComplete','notifyStaffOnOrder','notifyStaffOnReservation','notifyOnContactMessage','mirrorPosMovementToBooks','mirrorPosCogsToBooks','ensureBooksJournal','syncRegisterCashFloat','syncActiveRegisterCashFloat','manageCashAccount','indexPlatformOrderRef','manageAccountingPeriod','manageStaffMessage','recordClientTelemetry','getOperationalExceptions','repairOrderInventoryMarker','updateOrderStatus','acceptOnlineOrder','createManagerApproval','consumeManagerApproval','manageOrderArchive','reviewDiscrepancy','reopenDiscrepancy','managePettyVoucher','retireRevolvingFund','getUndepositedControlSnapshot','repairClosedShiftTurnover','reconcileUndepositedCustody','legacyOwnerCapitalReset','runFinancialClose','reopenFinancialCloseOnMovement','reopenFinancialCloseOnOrderChange','repairReversedPayoutDeposit','setUndepositedOpeningBalance','repairPettyVoucherFinancial','archiveActivityLog','syncOfflinePosSale','createOnlineOrder','getPaymentProof','confirmOrderReceived','ensureActiveOrders','syncActiveOrderProjection','pruneClosedShiftOrders','syncPublicOrderStatus','validateRecipeDefinition','saveSharedChoiceIngredients','onOrderFinancialPosting','preservePostedOrderOnDelete','onShiftPayInsFinancial','onShiftPayOutsFinancial','onShiftOpenFinancial','ensureShiftReference','onShiftCloseFinancial','repairPettyExpenseClassifications','onPettyVoucherFinancial','onPettyReplenishmentFinancial','manageFixedAsset','postFinancialCommand','reconcilePurchasePayable','managePurchaseCorrection','correctPlatformPresettlement','settlePlatformPayout','reversePlatformPayout','setPlatformPayoutDate','processOrderAdjustment','recordPlatformCatchup','ensureFinancialLedger','manageBooksAccount','manageChartAccount','autoRepairFinanceDateOnCashLedgerCreate','repairFinanceDates','auditFinancialControls','postInventoryMovements','ensureInventoryLedger','onOrderFinalize','onOrderInventoryReversal','pruneEphemeralNodes','autoCompleteReadyOnlineOrders','backupDatabaseDaily','runDatabaseBackupNow','evaluateProductionHealth','replicateArchivedOrderToFirestore','readHistoricalOrders','readHistoricalSalesRollup','refreshHistoricalOrderAfterJournal','refreshHistoricalOrderAfterInventoryPlan','manageHistoricalOrderArchive'
];
expectedFunctionExports.splice(expectedFunctionExports.indexOf('manageStaffMessage')+1,0,'manageIncident');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('notifyOnContactMessage')+1,0,'updateBooksMonthlyNet');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('manageAccountingPeriod'),0,'manageSupplier');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('manageOrderArchive'),0,'managePosStaffIdentity','openLinkedPosShift');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('getOperationalExceptions')+1,0,'getProductionCertification');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('getProductionCertification')+1,0,'getProductionValidation');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('syncOfflinePosSale'),0,'getCurrentCashBalances','updateCashBalanceSummary','updatePublicCatalogVersionOnCategories','updatePublicCatalogVersionOnMenuItems','updatePublicCatalogVersionOnOptionGroups','updatePublicCatalogVersionOnPackages');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('syncOfflinePosSale'),0,'reportPosDeviceHealth','verifyShiftCloseReadiness','onShiftCloseAssurance','manageShiftHandover');
// Sep 2026 shift crew: crew membership and management recovery of refused POS sales.
expectedFunctionExports.splice(expectedFunctionExports.indexOf('manageShiftHandover')+1,0,'managePosShiftCrew','managePosSaleRecovery');
// 24 Sep 2026: every close ends with a Z report; pending handovers are resolved by the server.
expectedFunctionExports.splice(expectedFunctionExports.indexOf('managePosShiftCrew'),0,'resolvePendingShiftHandovers','onShiftEndResolveEarlierHandovers');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('syncOfflinePosSale')+1,0,'getSupplierAdvanceDetails');
// Sep 2026: owner emergency sign-out of every portal session.
expectedFunctionExports.splice(expectedFunctionExports.indexOf('onShiftCloseAssurance'),0,'signOutAllPortalSessions');
expectedFunctionExports.splice(expectedFunctionExports.indexOf('getUndepositedControlSnapshot')+1,0,'syncUndepositedLedgerPageIndex','syncPettyVoucherAttentionIndex','syncCashCustodyPageIndex','getUndepositedPage');
// Sep 2026: incremental-backup dirty markers for the large history nodes.
expectedFunctionExports.splice(expectedFunctionExports.indexOf('backupDatabaseDaily'),0,'markBackupDirtyArchivedOrders','markBackupDirtyInventoryMovements','markBackupDirtyOrderInventoryPlans','markBackupDirtyFinancialMovements','markBackupDirtyCashBalanceApplied','markBackupDirtyBooksJournal','markBackupDirtyShifts','markBackupDirtyOperationalAudit','markBackupDirtyFinancialCommandClaims','markBackupDirtyInventoryAccounting','markBackupDirtyFinancialApprovals','markBackupDirtyActivityLog','markBackupDirtyCfLedger','markBackupDirtyPettyCashReceipts','markBackupDirtyStockReceipts','markBackupDirtyPurchaseInvoices','markBackupDirtyPlatformPayouts','markBackupDirtyInternalUsage','markBackupDirtyInventoryAdjustments','markBackupDirtyPettyCashVouchers','markBackupDirtyPettyCashReplenishments','markBackupDirtyReceivables','markBackupDirtyPayables','markBackupDirtySuppliers','markBackupDirtyInventorySku','markBackupDirtyAppCustomers','markBackupDirtyReviews','markBackupDirtyFeedbacks','markBackupDirtyPackages');
// 24 Sep 2026: sales without a usable recipe are flagged and costed later by a manager.
expectedFunctionExports.splice(expectedFunctionExports.indexOf('recordPlatformCatchup')+1,0,'manageUncostedSales');
expectedFunctionExports.push('askAccazaAI');
expectedFunctionExports.push('manageAccazaAiKnowledge');
expectedFunctionExports.push('manageAccazaAiIssue');
// Sep 2026: separate installable Accaza AI app (general chat only, no cap) — independent
// callable, admin's askAccazaAI/manageAccazaAiKnowledge/manageAccazaAiIssue untouched.
// Sep 2026: management business profile + campaign log (own Firestore collections only).
expectedFunctionExports.push('manageAccazaAiBusiness');
expectedFunctionExports.push('askAccazaAIStandalone');
const functionsSource=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
if(!functionsSource.includes('"x-goog-api-key":key')||functionsSource.includes('generateContent?key='))throw new Error('Accaza AI must authenticate Gemini requests with the current x-goog-api-key header, not a URL query key.');
if(!functionsSource.includes('const ACCAZA_AI_QUERY_ROLES = ["owner","superadmin","admin","manager","cashier"]')||!functionsSource.includes('ACCAZA_AI_QUERY_ROLES.includes(actor.role)'))throw new Error('Accaza AI must authorize cashiers through the server-side query-role allowlist.');
if(functionsSource.includes('tools:[{google_search:{}}]')||!functionsSource.includes('const ACCAZA_AI_GENERAL_CHAT_INSTRUCTION=')||/ACCAZA_AI_GENERAL_CHAT_INSTRUCTION="[^"]*Accaza/.test(functionsSource)||!functionsSource.includes('accazaAiProseAnswer(')||!functionsSource.includes('Web chat never receives Accaza data')||!functionsSource.includes('accazaAiWebQuestionBlocked(question)'))throw new Error('Accaza AI general chat must avoid billable search grounding and keep Accaza business questions out of public requests.');
if(!functionsSource.includes('const ACCAZA_AI_RELEASE_VERSION = "1.8"')||!functionsSource.includes('releaseVersion:ACCAZA_AI_RELEASE_VERSION')||!functionsSource.includes('DEEPSEEK_API_KEY')||!functionsSource.includes('OLLAMA_ACCESS_CLIENT_SECRET')||!functionsSource.includes('CF-Access-Client-Secret')||!functionsSource.includes('https://ollama.accazacoffee.com/api/chat')||!functionsSource.includes('accazaAiWithFallback'))throw new Error('Accaza AI must expose its release and keep server-side DeepSeek and secured Ollama fallback providers.');
// Sep 2026: staff Accaza AI has no message cap; general chat replies never name Accaza and
// the admin General chat view carries no Accaza helper text; Enter sends like Ask.
if(/claimAccazaAiAllowance|ACCAZA_AI_HOURLY_LIMIT|ACCAZA_AI_DAILY_LIMIT/.test(functionsSource))throw new Error('Accaza AI must not cap authorized staff messages.');
{const aiClient=fs.readFileSync(path.join(root,'assets/js/admin/accaza-ai.js'),'utf8');if(aiClient.includes('General Gemini chat')||aiClient.includes('General chat is ready')||!aiClient.includes("hint.style.display=isWeb?'none':''")||!aiClient.includes('accazaAiMessagesWeb')||!/ev\.key==='Enter'&&!ev\.shiftKey/.test(aiClient)||aiClient.includes('hourRemaining'))throw new Error('Admin Accaza AI General chat must stay free of Accaza helper text, keep its own conversation, send on Enter, and show no message allowance.');}
// Sep 2026 fallback reliability: every provider call is individually timed and any timeout,
// network error or empty answer moves on to the next provider; Ashna is the last resort in both modes.
{const aiFallback=functionsSource.slice(functionsSource.indexOf('async function accazaAiFetchJson('));
if(!functionsSource.includes('controller.abort()')||(functionsSource.match(/await accazaAiFetchJson\(/g)||[]).length<6||/await fetch\("https:\/\/(api\.deepseek|ollama\.accazacoffee|api\.ashna)/.test(functionsSource)||/await fetch\(`https:\/\/generativelanguage/.test(functionsSource))throw new Error('Every Accaza AI provider call must go through the timed accazaAiFetchJson wrapper.');
if(!functionsSource.includes('throw accazaAiProviderFailure("The provider returned an empty answer.")'))throw new Error('An empty AI answer must fall through to the next provider.');
if(!/exports\.askAccazaAI=onCall\(\{[^}]*timeoutSeconds:120[^}]*ASHNA_API_KEY\]\}/.test(functionsSource)||!/exports\.askAccazaAIStandalone=onCall\(\{[^}]*timeoutSeconds:120[^}]*ASHNA_API_KEY\]\}/.test(functionsSource))throw new Error('Both Accaza AI callables need the 120 s limit and the Ashna secret.');
const analysis=functionsSource.slice(functionsSource.indexOf('function accazaAiAnalysisProviders('),functionsSource.indexOf('function accazaAiGeneralChatProviders('));
const general=functionsSource.slice(functionsSource.indexOf('function accazaAiGeneralChatProviders('),functionsSource.indexOf('async function accazaAiRecordProviderHealth('));
for(const [label,list] of [['analysis',analysis],['general chat',general]]){const order=[...list.matchAll(/\{name:"([a-z]+)"/g)].map(m=>m[1]).join('>');if(order!=='gemini>deepseek>ollama>ashna')throw new Error(`Accaza AI ${label} provider order must be Gemini > DeepSeek > Qwen > Ashna (got ${order}).`);}
if(!aiFallback.includes('accazaAiProviderHealth'))throw new Error('Backup answers and total failures must be recorded for the Exception Center.');}
// Sep 2026 record-reading AI: tools are read-only, capped and management-only.
{const tools=fs.readFileSync(path.join(root,'src/functions/62a-accaza-ai-records.js'),'utf8');
if(/\.(set|update|remove|transaction|setWithPriority|setPriority)\(/.test(tools)||/\.ref\([^)]*\)\.push\(/.test(tools))throw new Error('Accaza AI record tools must be read-only (get() only).');
if(!tools.includes('const ACCAZA_AI_TOOL_ROLES = ["owner","superadmin","admin","manager"]')||!functionsSource.includes('ACCAZA_AI_TOOL_ROLES.includes(actor.role)?accazaAiToolContext(db):null'))throw new Error('Record tools must stay limited to management roles.');
const reads=[...tools.matchAll(/db\.ref\([^)]*\)((?:\.[a-zA-Z]+\([^)]*\))*)\.get\(\)/g)];if(!reads.length||reads.some(m=>!/limitTo(First|Last)\(/.test(m[1])&&!/\$\{/.test(m[0])&&!/booksChart|posStaff/.test(m[0])))throw new Error('Every collection read in the Accaza AI record tools must be bounded by limitToFirst/limitToLast.');
if(!tools.includes('ACCAZA_AI_TOOL_RECORD_BUDGET')||!tools.includes('ACCAZA_AI_TOOL_SKIP_KEY'))throw new Error('Record tools need the per-question record budget and the sensitive-field filter.');}
// Sep 2026 analytics tools: read the existing reporting rollup; the only write allowed is the
// AI's own Firestore read-allowance counter. No Realtime Database writes, no POS/admin paths.
{const analytics=fs.readFileSync(path.join(root,'src/functions/62b-accaza-ai-analytics.js'),'utf8');
if(/\.ref\([^)]*\)\.(set|update|push|remove|transaction)\(/.test(analytics)||/\.(update|delete|add|batch|bulkWriter|create)\(/.test(analytics))throw new Error('Accaza AI analytics must not write to the database or delete anything.');
const firestoreWrites=analytics.match(/transaction\.set\(/g)||[];if(firestoreWrites.length!==1||!analytics.includes('collection("aiAnalyticsUsage")'))throw new Error('The only write in Accaza AI analytics is the aiAnalyticsUsage read-allowance counter.');
if(!analytics.includes('ACCAZA_AI_FIRESTORE_DAILY_READ_CAP')||!analytics.includes('.limit(ACCAZA_AI_PAIRS_MAX_ORDERS)'))throw new Error('Accaza AI analytics needs its daily Firestore read cap and bounded order query.');}
// Business profile / campaign log: writes only its own Firestore collections, never deletes,
// never writes the Realtime Database, and is management-only.
{const business=fs.readFileSync(path.join(root,'src/functions/62c-accaza-ai-business.js'),'utf8');
if(/\.ref\([^)]*\)\.(set|update|push|remove|transaction)\(/.test(business)||/\.(delete|update|add|batch|bulkWriter|create)\(/.test(business))throw new Error('The Accaza AI campaign log must not write the Realtime Database or delete anything.');
const writes=[...business.matchAll(/(firestore\.collection\("([a-zA-Z]+)"\)\.doc\([^)]*\)\.set\(|transaction\.set\(ref)/g)];if(!writes.length||writes.some(m=>m[2]&&m[2]!=='aiBusiness'))throw new Error('The Accaza AI campaign log may only write aiBusiness/aiCampaigns.');
if(!/firestore\.collection\("aiCampaigns"\)\.doc\(/.test(business)||!business.includes('if(!ACCAZA_AI_TOOL_ROLES.includes(actor.role))throw new HttpsError("permission-denied"'))throw new Error('The campaign log must stay management-only and use the aiCampaigns collection.');}
const actualFunctionExports=[...functionsSource.matchAll(/^exports\.([A-Za-z0-9_]+)\s*=/gm)].map(match=>match[1]);
if(JSON.stringify(actualFunctionExports)!==JSON.stringify(expectedFunctionExports))throw new Error('The public Firebase Functions export contract changed. Review deployment, trigger, callable, and removal consequences explicitly.');
if(new Set(actualFunctionExports).size!==actualFunctionExports.length)throw new Error('A Firebase Function export is registered more than once.');
console.log(`PASS: all ${actualFunctionExports.length} Firebase Function exports retain their names and registration order.`);
