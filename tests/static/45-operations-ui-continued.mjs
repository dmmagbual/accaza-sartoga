// POS, Admin operations, offline behavior, and UI controls (continued from 40-operations-ui.mjs, Sep 2026).
export function run(context){
const {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource}=context;
const {rulesRaw,functionsSource,booksBridgeSource,adminCoreItem,precache,swSource}=context;
const {offlineQueueSource,offlineServerSource,posSource,editItemSource,formDialogSource,registerSource,undepositedSource,telemetrySource,operationsSource,firebaseDeployWorkflow,swCacheVersion,analyticsSource,payoutAuditCheck,payoutQueueCheck,grabPosDeductionsCheck,platformReferenceCheck,orderAdminSource,orderStatusSource,catalogAdminSource,exceptionSource,workspaceShellSource,shiftRegisterSource}=context;
const backofficeCss=fs.readFileSync(path.join(root,'assets','css','admin-backoffice.css'),'utf8');
const adminOrdersSource=fs.readFileSync(path.join(root,'assets','js','admin','admin-orders.mjs'),'utf8');
const paymentVerificationSource=fs.readFileSync(path.join(root,'functions','lib','payment-verification.js'),'utf8');
if(!adminOrdersSource.includes("Use POS → Online Orders to accept into shift")||!orderStatusSource.includes('Cashier verification and POS shift acceptance are required'))fail('Uncaptured website orders can bypass cashier verification or POS shift capture');
const packagesSource=fs.readFileSync(path.join(root,'assets','js','admin','packages.js'),'utf8');
if(!adminHtml.includes('/assets/css/admin-backoffice.css')||!precache.includes('/assets/css/admin-backoffice.css'))fail('Phase 7F back-office visual system is not linked and precached');
for(const marker of ['--bo-walnut','#adminWorkspaceHeader:before','.pz-tbl th','.badge-pending','prefers-reduced-motion'])if(!backofficeCss.includes(marker))fail(`Phase 7F visual-system marker missing: ${marker}`);
for(const marker of ['.order-card-actions','.order-payment-summary','.order-payment-state.pending'])if(!backofficeCss.includes(marker))fail(`Release 7G order-card containment marker missing: ${marker}`);
if(!adminSource.includes("ordersList.style.removeProperty('display')")||adminSource.includes("ordersList').style.display=archivePanelOpen?'none':'block'"))fail('Returning from the order archive must restore the responsive active-order grid');
for(const marker of ['function orderItemsHtml(o)','order-item-list','order-item-qty','order-item-detail'])if(!adminOrdersSource.includes(marker)&&!backofficeCss.includes(marker))fail(`Active-order item-list marker missing: ${marker}`);
for(const marker of ['cashier_manager','manager_only','paymentVerificationPolicy'])if(!adminSource.includes(marker)||!(functionsSource+'\n'+paymentVerificationSource).includes(marker))fail(`Payment verification policy marker missing: ${marker}`);
for(const marker of ['CASHIER_MANAGER','MANAGER_ONLY','directPaymentRows','paymentPolicy'])if(!paymentVerificationSource.includes(marker))fail(`Server payment verification authority marker missing: ${marker}`);
if(adminSource.includes('Cashier Final Verification')||adminSource.includes('cashier_final'))fail('Unsafe cashier-final verification option must not be exposed');
if(!packagesSource.includes('class="pkg-recipe-list"')||!backofficeCss.includes('.pkg-recipe-list{display:flex;flex-wrap:wrap')||packagesSource.includes('max-height:120px;overflow:auto'))fail('Package recipe selector must show every recipe without a nested scrollbar');
for(const marker of ["subscribe('inventorySku'",'recipeUsesInventory','Recipe items without approved brand','purchase-sku-cell','Select an active approved brand','skuId:skuId','lines:invoiceLines'])if(!posSource.includes(marker))fail(`Release 7H SKU/brand integrity marker missing: ${marker}`);
for(const marker of ['function openSkuManager(id,onUse)','data-skuse','Use this brand','data-pmanage-line','selected for this purchase'])if(!posSource.includes(marker))fail(`Purchase approved-brand handoff marker missing: ${marker}`);
if(!posSource.includes("ln.ing?'<button type=\"button\" class=\"purchase-add-sku\"")||!posSource.includes('Add an approved brand'))fail('Purchase lines must always offer to add or manage an approved brand');
if(!posSource.includes("uNorm(sk.brand)===uNorm(brand)"))fail('Approved-brand manager does not prevent duplicate brand names');
for(const marker of ['reconcilePurchasePayable','Repair missing payable',"rid='rcpt_'+invoiceId+'_'+lineIndex","bid='bat_'+invoiceId+'_'+lineIndex","P.pay==='account'||P.pay==='pending'"])if(!posSource.includes(marker)&&!functionsSource.includes(marker))fail(`Purchase/payable reconciliation marker missing: ${marker}`);
const financeSource=fs.readFileSync(path.join(root,'assets','js','admin','finance.js'),'utf8');
for(const marker of ['function openPayableDetail(id)','data-apdetail','<th>Reference</th>','data-apreverse','Inventory liabilities are created only from Purchases'])if(!financeSource.includes(marker))fail(`Payables control/detail marker missing: ${marker}`);
if(!financeSource.includes('>Details</button>')||financeSource.includes('<tr data-apdetail=')||financeSource.includes('Click a row for details'))fail('Payable details must use a dedicated button instead of a clickable row');
if(financeSource.includes('background:var(--pw)'))fail('Payable details panel still uses an undefined transparent background token');
if(financeSource.includes('<option>inventory</option>'))fail('Manual Payables entry still offers inventory as a type');
if(!financeSource.includes("filter(function(x){return !x.status||x.status==='open';})"))fail('Reversed payables can still appear in Open Payables');
if(!functionsSource.includes('Inventory payables must be created from Purchases'))fail('Server does not block manually created inventory payables');
for(const marker of ['exports.managePurchaseCorrection = onCall','purchase_reversal','reverse_purchase','Not enough remaining stock to reverse'])if(!functionsSource.includes(marker))fail(`Purchase correction authority missing: ${marker}`);
for(const marker of ["value=\"expense\"","expenseDescription","expenseAccount:'6075'","lineType:'expense'","no inventory created","Stock, expense, and fixed-asset treatments were linked to the same Finance Books entry"])if(!posSource.includes(marker))fail(`One-time purchase expense control missing: ${marker}`);
for(const marker of ['line.lineType==="expense"','/^6\\d{3}$/.test(expenseCode)','Select an active 6000-series operating-expense account'])if(!functionsSource.includes(marker))fail(`One-time purchase expense posting safeguard missing: ${marker}`);
for(const marker of ['value="asset"','assetLifeMonths','assetSalvage','assetInServiceDate','assetLocation','assetCustodian',"lineType:'fixed_asset'","action:'register_purchase'"])if(!posSource.includes(marker))fail(`Purchasing fixed-asset card control missing: ${marker}`);
for(const marker of ['action==="register_purchase"','fixedAssetIds','fundingType:"purchase_invoice"','A linked fixed-asset card is missing','New fixed assets must be acquired through Purchasing','line.lineType==="fixed_asset"'])if(!functionsSource.includes(marker))fail(`Purchase-linked fixed-asset safeguard missing: ${marker}`);
const fixedAssetBooksHtml=booksSource;if(!fixedAssetBooksHtml.includes('Acquire through Purchasing')||fixedAssetBooksHtml.includes('onclick="App.faAcquire()">+ Acquire asset'))fail('Standalone fixed-asset acquisition is not disabled in favor of Purchasing');
for(const marker of ['Invoice pending — provisional obligation','purchaseHistoryHtml','data-purchase-details','data-purchase-finalize','data-purchase-link'])if(!posSource.includes(marker))fail(`Purchase review/GRNI UI marker missing: ${marker}`);
for(const marker of ['inventory_pending_invoice','grni_created','purchase_grni_finalize_','liability:grni:'])if(!functionsSource.includes(marker))fail(`Purchase GRNI authority missing: ${marker}`);
if(!functionsSource.includes('Finalize the supplier invoice before paying this provisional obligation')||!financeSource.includes('Finalize invoice first'))fail('Provisional purchase obligations can still be paid before invoice finalization');
for(const marker of ['data-purchase-link','data-purchase-repair','data-purchase-duplicate','Purchase ID:'])if(!posSource.includes(marker))fail(`Purchase record repair control missing: ${marker}`);
for(const marker of ['linkPayableId','link_existing_purchase_payable','Another purchase already claims this payable','orphanAccount'])if(!functionsSource.includes(marker))fail(`Server purchase-link/duplicate guard missing: ${marker}`);
for(const marker of ['keepInvoiceId','duplicateCleanup','reverse_duplicate_purchase','purchase_ap_repair'])if(!functionsSource.includes(marker))fail(`Shared-payable duplicate recovery missing: ${marker}`);
if(!posSource.includes('keepInvoiceId:keepId,duplicate:true')||!posSource.includes('If its shared payable had already been reversed'))fail('Duplicate-pair reversal does not preserve the selected surviving purchase');
if(!posSource.includes('showReversedPurchases||!p.reversed')||!posSource.includes('data-purchase-toggle-reversed'))fail('Reversed purchases are not hidden by default with an audit-history toggle');
for(const marker of ['Correct purchase details','Reverse &amp; re-enter',"managerApproval('reverse_purchase'",'correctedPurchaseDraft(inv)'])if(!posSource.includes(marker))fail(`Purchase correction interface missing: ${marker}`);
for(const marker of ['data-purchase-edit','Edit purchase details','supplier or accounting date was selected','Use Amend to reverse and re-enter','description:(P.description||\'\').trim()'])if(!posSource.includes(marker))fail(`Purchase history metadata/correction marker missing: ${marker}`);
for(const marker of ['supplierId:P.supplierId','Select an active supplier from the shared supplier database','createPurchaseSupplier','Changing a posted purchase supplier requires reversing and re-entering'])if(!posSource.includes(marker)&&!functionsSource.includes(marker))fail(`Supplier-master purchase safeguard missing: ${marker}`);
for(const marker of ['description:financeText(invoice.description,240)','purchaseInvoices/${invoiceId}/supplier','payables/${invoice.payableId}/party','correct_purchase_details'])if(!functionsSource.includes(marker))fail(`Purchase metadata correction authority missing: ${marker}`);
if(!posSource.includes("recipeItem:true")||!posSource.includes('Used in recipes')||!posSource.includes("seededFrom:'purchase'"))fail('Release 7H new recipe-item SKU creation is incomplete');
for(const marker of ['Set up stock item / opening balance','Use this only for an item missing from the system','invOpeningConfirmed','Confirm stock-item setup','Opening inventory value:','Maker: ','has not already been received or counted elsewhere','Future deliveries must go through Purchases'])if(!posSource.includes(marker))fail(`Stock-item opening-balance safeguard missing: ${marker}`);
if(!posSource.includes('<details class="pz-card"')||!posSource.includes('<summary class="pz-btn sec"'))fail('Stock-item opening-balance setup is not collapsed behind its action button');
if(!backofficeCss.includes('.inv-sku-link.linked')||!backofficeCss.includes('.purchase-sku-cell.required'))fail('Release 7H SKU linkage states are not visibly distinguished');
for(const marker of ['SKU / stock item','✓ Recipe · SKU ready','Add brand','Brands ('])if(!posSource.includes(marker))fail(`Inventory SKU/brand language is incomplete: ${marker}`);
if(posSource.includes('Recipe · no SKU')||posSource.includes('Recipe items without SKU'))fail('Inventory still incorrectly describes its common stock items as missing SKUs');
const inventoryRenderBlock=section(posSource,'function renderInventory()','/* ══════════ INVENTORY ARCHITECTURE v2');
if(inventoryRenderBlock.includes('data-inv-receive')||inventoryRenderBlock.includes('data-inv-brands')||inventoryRenderBlock.includes('>+ Stock</button>')||inventoryRenderBlock.includes('>History</button>'))fail('Inventory rows still expose retired Stock or History actions');
if(!posSource.includes('class="inventory-actions-cell"><div class="inventory-actions">')||!backofficeCss.includes('grid-template-columns:112px 72px 58px 68px 42px'))fail('Inventory actions do not use the compact fixed alignment grid');
var skuRule=rulesRaw.slice(rulesRaw.indexOf('"inventorySku"'),rulesRaw.indexOf('"inventoryBatch"')),batchRule=rulesRaw.slice(rulesRaw.indexOf('"inventoryBatch"'),rulesRaw.indexOf('"purchaseInvoices"'));
if((skuRule.match(/child\('purchases'\)/g)||[]).length<2||(batchRule.match(/child\('purchases'\)/g)||[]).length<2)fail('Release 7H purchasing permission is missing from inventorySku or inventoryBatch');
if(!workspaceShellSource.includes('dataset.adminWorkspace')||!workspaceShellSource.includes('dataset.adminArea')||!workspaceShellSource.includes('operations:System health'))fail('Phase 7F domain ledger rail or System Health shortcut missing');
const overviewCommandSource=fs.readFileSync(path.join(root,'assets','js','admin','overview-command.mjs'),'utf8');
const moduleLoaderSource=fs.readFileSync(path.join(root,'assets','js','admin','module-loader.js'),'utf8');
if(!moduleLoaderSource.includes("purchases:['finance','pos']"))fail('Purchases does not preload the finance module before accepting payment terms');
if(!adminHtml.includes('id="overviewCommandCenter"')||!adminHtml.includes('assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not mounted');
for(const marker of ['getOperationalExceptions','AccazaOfflineQueue.summary','__accazaLoadAdminModule','Service now','data-occ-route','MutationObserver'])if(!overviewCommandSource.includes(marker))fail(`Phase 7G command-center marker missing: ${marker}`);
for(const duplicate of ['Morning service','Immediate attention','Work queue','Open full health check'])if(overviewCommandSource.includes(duplicate))fail(`Overview duplicates Operations Center content: ${duplicate}`);
if(!moduleLoaderSource.includes('window.__accazaLoadAdminModule=load'))fail('Phase 7G offline-queue on-demand loader is missing');
for(const marker of ['.occ-brief','.occ-signal-grid','.occ-control-list'])if(!backofficeCss.includes(marker))fail(`Phase 7G command-center visual marker missing: ${marker}`);
if(!precache.includes('/assets/js/admin/overview-command.mjs'))fail('Phase 7G Overview Command Center is not precached');
if(adminHtml.includes('id="adminServiceUser"')||workspaceShellSource.includes("user.textContent='Role"))fail('Admin status strip still exposes the signed-in role');
for(const marker of ['adminServiceConnectionLabel','adminServiceCashier','adminServiceQueueNote','admin-status-dot'])if(!adminHtml.includes(marker))fail(`Compact admin status line is missing: ${marker}`);
if((adminHtml.match(/id="adminServiceStrip"/g)||[]).length!==1||!adminHtml.includes('class="awh-copy"'))fail('Admin status must appear once inside the workspace header');
if(!workspaceShellSource.includes("' · Cashier '")||!workspaceShellSource.includes("' · Push to sync '")||!workspaceShellSource.includes("' · Push to retry '"))fail('Compact admin status lacks cashier identity or actionable offline-queue guidance');
if(/\.admin-service-strip\{[^}]*grid-template-columns/.test(adminHtml)||/body\.admin-workspace-focused[^\n]*\.admin-service-strip\{[^}]*display:grid/.test(backofficeCss))fail('Retired full-width status-card banner styling remains');
const customerReservationSource=fs.readFileSync(path.join(root,'assets','js','customer','core.mjs'),'utf8');
const adminReservationSource=fs.readFileSync(path.join(root,'assets','js','admin','reservations.mjs'),'utf8');
for(const id of ['btnAddCat','btnAddItem','btnAddToCart']){
  if(customerReservationSource.includes(`document.getElementById('${id}').addEventListener`))fail(`Customer startup unsafely assumes #${id} exists on every page`);
}
for(const id of ['editGcashNum','editGcashName','editBdoNum','editUbNum']){
  if(customerReservationSource.includes(`document.getElementById('${id}').value=`))fail(`Customer payment sync unsafely assumes admin-only #${id} exists`);
}
for(const [name,source] of [['customer',customerReservationSource],['admin',adminReservationSource]]){
  if(!source.includes("<button type=\"button\" class=\"'+cls+'\"")||!source.includes('window.selectTimeSlot(this.dataset.slot)'))fail(`${name} reservation slots are not native buttons with an explicit selection handler`);
  if(!source.includes("fw.style.display='block'")||!source.includes("scrollIntoView({behavior:'smooth'"))fail(`${name} reservation selection does not reveal and focus the booking form`);
}
if(!customerReservationSource.includes('window.updateBookingType()')||/function\(\)\{selectTimeSlot\(/.test(customerReservationSource))fail('Customer reservation still relies on a fragile implicit module global');
for(const [name,html] of [['customer',customerHtml],['admin',adminHtml]])if(!html.includes('<button type="button" class="time-slot available" id="fullDaySlot"'))fail(`${name} full-day reservation control is not a native button`);

if(!financeSource.includes('!p.reversed&&!p.depositMovementId&&Number(p.actualPayout)>0'))fail('Cash Flow must hide reversed, deposited, zero, and negative platform payouts from the deposit queue');
if(financeSource.includes("e.source==='payout'&&e.linkId===p.id"))fail('Cash Flow still relies on the obsolete payout ledger-source check');
for(const marker of ["var value=r2(x.opening),d=x.openingDate||from","if(d<=from)beginBank[x.id]","type:'opening_balance',id:'opening_'+x.id"]){if(!financeSource.includes(marker))fail(`Cash Flow statement opening-balance projection is missing: ${marker}`);}
const cashflowBooksHtml=booksSource;
for(const marker of ['o.platformAdsMarketing','o.platformMarketingFee'])if(!analyticsSource.includes(marker)||!financeSource.includes(marker)||!cashflowBooksHtml.includes(marker)||!functionsSource.includes(marker))fail(`Platform deduction fallback is not aligned across Admin, settlement, and Finance Books: ${marker}`);
for(const marker of ['{id:"cashflow",label:"Cash Flow"}','Authoritative cash statement · moved from Admin','function cfStatement()','openingSources','manageCashAccount','payout_deposit','cash_deposit'])if(!cashflowBooksHtml.includes(marker)&&!functionsSource.includes(marker)&&!adminHtml.includes(marker))fail(`Books Cash Flow cutover marker missing: ${marker}`);
if(cashflowBooksHtml.includes('Banking actions · excluded from cash flow'))fail('Cash Flow still shows the Banking Actions card');
for(const marker of ["posSwitchTab('cashflow',this)",'href="books.html?tab=cashflow"','id="tab-cashflow"','id="cashflowRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin Cash Flow UI is still present: ${marker}`);
for(const marker of ["posSwitchTab('pnl',this)",'id="tab-pnl"','id="pnlRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin P&L UI is still present: ${marker}`);
for(const marker of ["posSwitchTab('receivables',this)",'id="tab-receivables"','id="receivablesRoot"',"posSwitchTab('payables',this)",'id="tab-payables"','id="payablesRoot"'])if(adminHtml.includes(marker))fail(`Retired Admin AR/AP UI is still present: ${marker}`);

Object.assign(context,{offlineQueueSource,offlineServerSource,posSource,editItemSource,formDialogSource,registerSource,undepositedSource,telemetrySource,operationsSource,firebaseDeployWorkflow,swCacheVersion,analyticsSource,payoutQueueCheck,grabPosDeductionsCheck,platformReferenceCheck,orderAdminSource,orderStatusSource,catalogAdminSource,exceptionSource,workspaceShellSource,shiftRegisterSource,backofficeCss,adminOrdersSource,paymentVerificationSource,packagesSource,financeSource,fixedAssetBooksHtml,inventoryRenderBlock,overviewCommandSource,moduleLoaderSource,customerReservationSource,adminReservationSource,cashflowBooksHtml});
}
