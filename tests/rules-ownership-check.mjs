import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {get,ref,set,update,query,orderByChild,limitToLast,runTransaction} from 'firebase/database';

const projectId='accaza-sartoga';
const rules=fs.readFileSync('database.rules.json','utf8');
// val() on a node with children fails the whole rule (3 Nov 2026: every bill break on a counted shift was
// refused). These fields hold collections; no rule may compare them with val().
for(const field of ['openCount','drawer','inventoryUsage','refundPayments','refundHistory','voidPayments','costCorrections','payOuts','lineItems','correctedLineItems','byMethod','byChannel','floatException']){
  // The field's own rule may not compare the whole node either.
  if(new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*newData\\.val\\(\\)`).test(rules))throw new Error(`database.rules.json compares the collection ${field} with newData.val() in its own rule`);
  // Allowed only behind a guard that proves the stored value is not a collection.
  for(const m of rules.matchAll(new RegExp(`child\\('${field}'\\)\\.val\\(\\)`,'g'))){
    const before=rules.slice(Math.max(0,m.index-120),m.index);
    if(!before.includes(`data.child('${field}').hasChildren() || `))throw new Error(`database.rules.json compares the collection ${field} with val(); compare its leaves or freeze it instead`);
  }
}
const env=await initializeTestEnvironment({projectId,database:{rules}});

try{
  await env.withSecurityRulesDisabled(async(context)=>{
    await set(ref(context.database()),{
      admins:{owner:true,manager:'manager',staff:'staff',cashier:'staff',kitchen:'kitchen',disabled:{role:'disabled',active:false,disabled:true}},
      adminPerms:{staff:{orders:true,pos:true,possettings:true,discrepancy:true,petty:true,availability:true},cashier:{pos:true},kitchen:{orders:true},disabled:{pos:true,registerOps:true}},
      menuItems:{latte:{name:'Latte',cat:'coffee',priceS:100}},
      channelPrices:{grabfood:{latte:{S:130}}},
      availability:{Latte:true},
      orders:{
        own:{id:'own',ownerUid:'customer-a',status:'Pending',total:100,source:'online'},
        other:{id:'other',ownerUid:'customer-b',status:'Pending',total:120,source:'online'},
        legacy:{id:'legacy',status:'Ready',total:80,source:'online',receivedByCustomer:false},
      },
      activeOrders:{own:{id:'own',ownerUid:'customer-a',status:'Pending',total:100,source:'online',timestamp:1}},
      customerOrders:{'customer-a':{own:{createdAt:1,status:'Pending'}},'customer-b':{other:{createdAt:1,status:'Pending'}}},
      appCustomers:{'customer-a':{name:'Customer A',phone:'09123456789',orders:1}},
      orderLocks:{'customer-a':{hash:{t:1}}},
      inventory:{milk:{name:'Milk',unit:'ml',stock:1000,cost:0.2,ledgerVersion:2,ledgerUpdatedAt:10}},
      inventoryAccounting:{milk:{balance:1000,unitCost:0.2,version:2}},
      inventoryBalances:{milk:{itemId:'milk',qty:1000,unitCost:0.2,version:2}},
      inventoryMovements:{opening_milk:{id:'opening_milk',itemId:'milk',type:'opening_balance',occurredAt:1}},
      financialMovements:{sale_own:{id:'sale_own',type:'order_sale',occurredAt:1,amount:100}},
      cfLedger:{cfauto_own:{movementId:'sale_own',accountId:'bank',dir:'in',amount:100,ts:1}},
      cfAccounts:{bank:{name:'BDO',type:'bank',opening:0}},
      receivables:{ar_one:{party:'Test',amount:10,status:'open'}},
      payables:{ap_one:{party:'Supplier',amount:20,status:'open'}},
      platformPayouts:{po_one:{channel:'grabfood',actualPayout:50,settledAt:1}},
      financialApprovals:{approval_one:{action:'refund',sourceId:'own',approvedAt:1}},
      chartOfAccounts:{rent:{code:'5300',name:'Rent',type:'expense',active:true}},
      cashCustody:{shift_one:{shiftId:'shift_one',amount:100,remaining:100,status:'awaiting_deposit'}},
      archivedOrders:{old_rejected:{id:'old_rejected',prevStatus:'Rejected',archivedAt:1,total:0}},
      discrepancies:{disc_one:{kind:'cash',status:'open',ts:1}},
      pettyCashVouchers:{pv_one:{voucherNo:'PV-1',amount:10,status:'pending',createdAt:1}},
      activityLogArchive:{log_old:{action:'test',ts:1}},
      operationalAudit:{audit_one:{action:'archive_order',ts:1}},
      incidents:{incident_one:{severity:'SEV2',status:'investigating',createdAt:1}},
      deletionAudit:{orders:{old_deleted:{orderId:'old_deleted',deletedAt:1}}},
      clientTelemetryDaily:{'2026-08-09':{metrics:{pos_boot:{count:1,totalMs:500,maxMs:500,failed:0}}}},
      staffMessages:{msg_one:{title:'Shift',body:'Close the till',audience:'all',createdAt:1,expiresAt:2}},
      staffMessageReceipts:{msg_one:{owner:{userUid:'owner',readAt:2}}},
      staffReceiptIndex:{owner:{msg_one:{messageId:'msg_one',readAt:2}}},
    });
  });

  const a=env.authenticatedContext('customer-a').database();
  const b=env.authenticatedContext('customer-b').database();
  const owner=env.authenticatedContext('owner').database();
  const manager=env.authenticatedContext('manager').database();
  const staff=env.authenticatedContext('staff').database();
  const cashier=env.authenticatedContext('cashier').database();
  const kitchen=env.authenticatedContext('kitchen').database();
  const disabled=env.authenticatedContext('disabled').database();
  const guest=env.unauthenticatedContext().database();
  await env.withSecurityRulesDisabled(async c=>{
    await set(ref(c.database(),'shifts/rule-open'),{id:'rule-open',status:'open',accountUid:'cashier'});
    await set(ref(c.database(),'shiftHandovers/rule-open'),{state:'pending'});
  });
  await assertFails(set(ref(cashier,'shifts/browser-created'),{id:'browser-created',status:'open',accountUid:'cashier'}));
  await assertFails(set(ref(cashier,'posActiveShift'),{id:'browser-created',status:'open',accountUid:'cashier'}));
  await assertFails(set(ref(cashier,'shifts/rule-open'),null));
  await assertFails(update(ref(owner,'shifts/rule-open'),{status:'closed'}));
  await assertFails(set(ref(owner,'shifts'),null));
  await assertFails(set(ref(cashier,'shiftHandovers/rule-open'),null));
  await assertFails(set(ref(owner,'pendingShiftHandovers/rule-open'),{at:1}));
  // Shift crew (Sep 2026): the shift owner is fixed once set, and crew membership plus
  // refused-sale evidence are server-only, so a browser cannot grant itself till access.
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database()),{'shifts/rule-crew':{id:'rule-crew',status:'open',accountUid:'cashier',staff:'Cashier'},posActiveShift:{id:'rule-crew',status:'open',accountUid:'cashier',staff:'Cashier'}});});
  await assertSucceeds(update(ref(cashier,'shifts/rule-crew'),{drawer:{b100:1}}));
  await assertSucceeds(update(ref(staff,'shifts/rule-crew'),{drawer:{b100:1,b50:1}}));
  await assertSucceeds(update(ref(staff,'posActiveShift'),{drawer:{b100:1,b50:1}}));
  await assertFails(update(ref(staff,'shifts/rule-crew'),{openCount:{b100:9}}));
  await assertFails(update(ref(staff,'posActiveShift'),{openCount:{b100:9}}));
  await assertFails(update(ref(owner,'shifts/rule-crew'),{status:'closed'}));
  await assertFails(update(ref(owner,'shifts/rule-crew'),{status:'handover_pending'}));
  await assertFails(set(ref(owner,'shifts/rule-crew'),null));
  await assertFails(update(ref(owner,'posActiveShift'),{status:'closed'}));
  await assertFails(update(ref(owner,'posActiveShift'),{id:'rule-taken'}));
  await assertFails(update(ref(owner,'posActiveShift'),{accountUid:'owner'}));
  await assertFails(set(ref(owner,'posActiveShift'),null));
  await assertFails(update(ref(disabled,'shifts/rule-crew'),{drawer:{b100:9}}));
  // A shift opened with a counted drawer stores openCount as a map of denominations, as the server
  // writes it. Rules once called val() on that map, which fails the whole rule and refused every
  // bill break and recount on a counted shift (3 Nov 2026). Any cashier with POS access, owner of the
  // shift or not, must be able to change the drawer; nobody may change the opening count.
  const counted={id:'rule-counted',status:'open',accountUid:'owner',staff:'Owner',staffId:'st_owner',openAt:1,openingFloat:4000,floatMode:'fixed',configuredFloat:4000,openCount:{b1000:3,b100:4,b50:12},drawer:{b1000:3,b100:4,b50:12},schemaVersion:2};
  let crewActive=null;
  await env.withSecurityRulesDisabled(async c=>{crewActive=(await get(ref(c.database(),'posActiveShift'))).val();await update(ref(c.database()),{'shifts/rule-counted':counted,posActiveShift:counted});});
  for(const db of [cashier,staff,owner]){
    await assertSucceeds(runTransaction(ref(db,'shifts/rule-counted/drawer'),cur=>Object.assign({},cur||{},{b1000:2,b500:2})));
    await assertSucceeds(runTransaction(ref(db,'posActiveShift/drawer'),cur=>Object.assign({},cur||{},{b1000:2,b500:2})));
  }
  await assertSucceeds(update(ref(cashier,'shifts/rule-counted/cashSwaps/1'),{out:{b1000:1},in:{b500:2},amount:1000,ts:1,by:'Cashier'}));
  await assertSucceeds(update(ref(cashier,'shifts/rule-counted/drawerRecounts/1'),{before:{b1000:2},after:{b1000:2},beforeTotal:2000,afterTotal:2000,difference:0,ts:1,by:'Cashier',byUid:'cashier'}));
  await assertFails(update(ref(kitchen,'shifts/rule-counted/drawer'),{b100:1}));
  await assertFails(update(ref(kitchen,'posActiveShift/drawer'),{b100:1}));
  for(const path of ['shifts/rule-counted','posActiveShift']){
    for(const db of [cashier,owner]){
      await assertFails(update(ref(db,path),{openCount:{b1000:3,b100:5,b50:12}}));
      await assertFails(update(ref(db,path),{'openCount/b100':5}));
      await assertFails(update(ref(db,path),{'openCount/b50':null}));
      await assertFails(update(ref(db,path),{'openCount/b500':1}));
      await assertFails(update(ref(db,path),{'openCount/x1':1}));
      await assertFails(update(ref(db,path),{openCount:null}));
    }
  }
  // A plain-value opening count stays frozen too, and the drawer can still change.
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database()),{'shifts/rule-counted/openCount':500,'posActiveShift/openCount':500});});
  for(const path of ['shifts/rule-counted','posActiveShift']){
    await assertFails(update(ref(owner,path),{openCount:600}));
    await assertFails(update(ref(owner,path),{openCount:{b500:1}}));
    await assertFails(update(ref(owner,path),{openCount:null}));
    await assertSucceeds(update(ref(cashier,path+'/drawer'),{b100:1}));
  }
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database()),{'shifts/rule-counted':null,posActiveShift:crewActive});});
  await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'sessionControl/users/staff'),{at:Date.now()+60000});});
  await assertFails(update(ref(staff,'shifts/rule-crew'),{drawer:{b100:9}}));
  await assertSucceeds(set(ref(cashier,'shifts/rule-crew'),{id:'rule-crew',status:'open',accountUid:'cashier',staff:'Cashier',drawer:{b100:2}}));
  await assertSucceeds(update(ref(cashier),{'shifts/rule-crew/status':'closed',posActiveShift:null}));
  await assertFails(update(ref(cashier,'shifts/rule-crew'),{status:'open'}));
  await assertFails(update(ref(cashier,'shifts/rule-crew'),{accountUid:'staff'}));
  await assertFails(update(ref(owner,'shifts/rule-crew'),{accountUid:null}));
  await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'shifts/rule-legacy-ownerless'),{id:'rule-legacy-ownerless',status:'open',openAt:1,openingFloat:100});});
  await assertFails(update(ref(owner,'shifts/rule-legacy-ownerless'),{accountUid:'owner'}));
  await assertFails(update(ref(owner,'shifts/rule-legacy-ownerless'),{status:'closed'}));
  await assertFails(set(ref(staff,'shifts/rule-crew'),{id:'rule-crew',status:'open',staff:'Cashier'}));
  for(const db of [owner,manager,staff,cashier]){
    await assertFails(set(ref(db,'shiftCrews/rule-crew/staff'),{uid:'staff',sessions:{1:{joinedAt:1}}}));
    await assertFails(get(ref(db,'shiftCrews/rule-crew')));
    await assertFails(set(ref(db,'posSyncAlerts/pos_rule_alert'),{state:'dismissed'}));
    await assertFails(get(ref(db,'posSyncAlerts')));
    // Sales without a recipe (24 Sep 2026): the flags and cost corrections are server-only.
    await assertFails(get(ref(db,'uncostedSales')));
    await assertFails(set(ref(db,'uncostedSales/POS-X__sale_0'),{status:'resolved'}));
  }
  await assertFails(update(ref(owner,'orders/own'),{costCorrections:{forged:{amount:1}}}));
  // Stock usage (3 Nov 2026): a map written only by the server. Staff with orders/pos access may update
  // an order that has none, may not add one, and may not update an order once stock was deducted.
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database()),{
    'orders/rule-usage-none':{id:'rule-usage-none',status:'Completed',total:100,timestamp:1},
    'orders/rule-usage-set':{id:'rule-usage-set',status:'Completed',total:100,timestamp:1,inventoryDeducted:true,inventoryUsage:{inv_milk:0.2,inv_cup:1},costCorrections:{c1:{amount:1}},refundPayments:{r1:{amount:5}}}});});
  await assertSucceeds(update(ref(cashier,'orders/rule-usage-none'),{staffNote:'table 4'}));
  await assertFails(update(ref(cashier,'orders/rule-usage-none'),{inventoryUsage:{inv_milk:1}}));
  await assertFails(update(ref(cashier,'orders/rule-usage-set'),{staffNote:'table 4'}));
  await assertFails(update(ref(cashier,'orders/rule-usage-set'),{'inventoryUsage/inv_milk':null}));
  await assertFails(update(ref(cashier,'orders/rule-usage-set'),{inventoryUsage:null}));
  await assertSucceeds(update(ref(owner,'orders/rule-usage-set'),{staffNote:'table 4'}));
  // Staff may not remove a server-only collection from an order that holds one.
  await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'orders/rule-refunded'),{id:'rule-refunded',status:'Completed',total:100,timestamp:1,refundHistory:{h1:{amount:5}}});});
  await assertFails(update(ref(cashier,'orders/rule-refunded'),{refundHistory:null}));
  await assertFails(update(ref(cashier,'orders/rule-refunded'),{'refundHistory/h1':null}));
  await assertFails(update(ref(cashier,'orders/rule-refunded'),{staffNote:'x'}));
  await assertSucceeds(update(ref(owner,'orders/rule-refunded'),{staffNote:'x'}));
  await env.withSecurityRulesDisabled(async c=>{await set(ref(c.database(),'orders/rule-refunded'),null);});
  for(const db of [owner,cashier]){
    await assertFails(update(ref(db,'orders/rule-usage-set'),{'costCorrections/c2':{amount:1}}));
    await assertFails(update(ref(db,'orders/rule-usage-set'),{'refundPayments/r1/amount':6}));
    await assertFails(update(ref(db,'orders/rule-usage-set'),{voidPayments:{v1:{amount:1}}}));
    await assertFails(update(ref(db,'orders/rule-usage-set'),{refundHistory:{h1:{amount:1}}}));
  }
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database()),{'orders/rule-usage-none':null,'orders/rule-usage-set':null});});
  await assertFails(update(ref(owner,'orders/own'),{costCorrectionTotal:1}));
  // The rejection outcome and refund record are server-only: staff cannot create or alter them.
  await assertFails(update(ref(owner,'orders/own'),{rejection:{outcome:'payment_not_found'}}));
  await assertFails(update(ref(owner,'orders/own/rejection'),{refundStatus:'paid'}));
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database(),'orders/own'),{rejection:{outcome:'refund_due',refundStatus:'owed',refundAmount:1}});});
  await assertFails(update(ref(owner,'orders/own'),{rejection:null}));
  await assertFails(update(ref(owner,'orders/own'),{'rejection/refundStatus':'paid'}));
  await assertSucceeds(update(ref(owner,'orders/own'),{notes:'still editable'}));
  await env.withSecurityRulesDisabled(async c=>{await update(ref(c.database(),'orders/own'),{rejection:null,notes:null});});

  await assertSucceeds(get(ref(a,'orders/own')));
  await assertFails(get(ref(b,'orders/own')));
  await assertFails(get(ref(guest,'orders/own')));
  await assertSucceeds(get(ref(staff,'orders/own')));
  await assertFails(get(ref(a,'activeOrders/own')));
  await assertFails(get(ref(guest,'activeOrders/own')));
  await assertSucceeds(get(ref(staff,'activeOrders/own')));
  await assertFails(update(ref(staff,'activeOrders/own'),{status:'Preparing'}));
  await assertFails(update(ref(kitchen,'orders/own'),{status:'Preparing'}));
  await assertFails(set(ref(a,'activeOrders/fake'),{id:'fake',status:'Pending'}));
  await assertFails(get(ref(owner,'systemMaintenance')));
  await assertSucceeds(update(ref(owner,'menuItems/latte'),{priceS:110}));
  await assertSucceeds(update(ref(manager,'menuItems/latte'),{priceS:120}));
  await assertFails(update(ref(staff,'menuItems/latte'),{priceS:130}));
  await assertSucceeds(update(ref(staff,'availability'),{Latte:false}));
  await assertFails(get(ref(owner,'inventoryAccounting/milk')));
  await assertSucceeds(get(ref(owner,'inventoryBalances/milk')));
  await assertSucceeds(get(ref(owner,'inventoryMovements/opening_milk')));
  await assertFails(update(ref(owner,'inventory/milk'),{stock:999}));
  await assertFails(update(ref(owner,'inventory/milk'),{cost:0.3}));
  await assertFails(update(ref(owner,'inventory/milk'),{unit:'L'}));
  await assertSucceeds(update(ref(owner,'inventory/milk'),{reorder:100}));
  await assertFails(set(ref(owner,'inventoryMovements/forged'),{itemId:'milk',qty:999,occurredAt:2}));
  await assertSucceeds(get(ref(owner,'financialMovements/sale_own')));
  await assertFails(set(ref(owner,'financialMovements/forged'),{id:'forged',amount:999,occurredAt:2}));
  await assertFails(set(ref(owner,'cfLedger/forged'),{amount:999,ts:2}));
  await assertSucceeds(get(ref(staff,'cfAccounts/bank')));
  await assertSucceeds(get(ref(cashier,'cfAccounts/bank')));
  // Channel prices: POS users must READ them to ring GrabFood/FoodPanda sales, but only managers or
  // staff granted Channel Pricing may CHANGE them. Read and write are deliberately separate authorities.
  await assertSucceeds(get(ref(cashier,'channelPrices/grabfood/latte')));
  await assertSucceeds(get(ref(manager,'channelPrices/grabfood/latte')));
  await assertFails(get(ref(kitchen,'channelPrices/grabfood/latte')));
  await assertFails(get(ref(guest,'channelPrices/grabfood/latte')));
  await assertFails(get(ref(a,'channelPrices/grabfood/latte')));
  await assertFails(set(ref(cashier,'channelPrices/grabfood/latte/S'),1));
  await assertFails(set(ref(staff,'channelPrices/grabfood/latte/S'),1));
  await assertFails(set(ref(kitchen,'channelPrices/grabfood/latte/S'),1));
  await assertSucceeds(set(ref(manager,'channelPrices/grabfood/latte/S'),135));
  await assertFails(update(ref(cashier,'cfAccounts/bank'),{name:'Cashier edit'}));
  await assertFails(get(ref(kitchen,'cfAccounts/bank')));
  await assertFails(update(ref(staff,'cfAccounts/bank'),{name:'Forged bank'}));
  await assertFails(update(ref(owner,'receivables/ar_one'),{amount:999}));
  await assertFails(update(ref(owner,'payables/ap_one'),{amount:999}));
  await assertFails(update(ref(owner,'platformPayouts/po_one'),{actualPayout:999}));
  await assertFails(get(ref(owner,'financialApprovals/approval_one')));
  await assertSucceeds(get(ref(owner,'chartOfAccounts/rent')));
  await assertFails(update(ref(owner,'chartOfAccounts/rent'),{name:'Forged'}));
  await assertSucceeds(get(ref(owner,'cashCustody/shift_one')));
  await assertFails(update(ref(owner,'cashCustody/shift_one'),{remaining:0}));
  await assertSucceeds(get(ref(owner,'archivedOrders/old_rejected')));
  await assertFails(update(ref(owner,'archivedOrders/old_rejected'),{name:'Forged'}));
  await assertFails(set(ref(owner,'archivedOrders/forged'),{id:'forged',archivedAt:2}));
  await assertFails(update(ref(owner,'discrepancies/disc_one'),{status:'reviewed'}));
  await assertSucceeds(set(ref(staff,'discrepancies/disc_new'),{kind:'cash',status:'open',ts:2}));
  await assertFails(update(ref(owner,'pettyCashVouchers/pv_one'),{status:'approved'}));
  await assertSucceeds(set(ref(staff,'pettyCashVouchers/pv_new'),{voucherNo:'PV-2',amount:5,status:'pending',createdAt:2}));
  // Receipt images are stored beside a new pending voucher, atomically, and never replaced.
  await assertSucceeds(update(ref(staff),{'pettyCashVouchers/pv_img':{voucherNo:'PV-3',amount:5,status:'pending',createdAt:3,hasReceipt:true},'pettyCashReceipts/pv_img':{meta:{createdAt:3,bytes:27},image:'data:image/jpeg;base64,AAAA'}}));
  await assertSucceeds(get(ref(staff,'pettyCashReceipts/pv_img/meta')));
  await assertFails(set(ref(owner,'pettyCashReceipts/pv_img'),{meta:{createdAt:4,bytes:27},image:'data:image/jpeg;base64,AAAA'}));
  await assertFails(set(ref(staff,'pettyCashReceipts/pv_one'),{meta:{createdAt:4,bytes:27},image:'data:image/jpeg;base64,AAAA'}));
  await assertFails(update(ref(staff),{'pettyCashVouchers/pv_bad':{voucherNo:'PV-4',amount:5,status:'pending',createdAt:4,hasReceipt:true},'pettyCashReceipts/pv_bad':{meta:{createdAt:4,bytes:9},image:'javascript:alert(1)'}}));
  await assertFails(get(ref(cashier,'pettyCashReceipts/pv_img')));
  await assertFails(update(ref(owner,'activityLogArchive/log_old'),{action:'forged'}));
  await assertSucceeds(get(ref(owner,'operationalAudit/audit_one')));
  await assertFails(set(ref(owner,'operationalAudit/forged'),{action:'forged',ts:2}));
  await assertSucceeds(get(ref(owner,'incidents/incident_one')));
  await assertFails(get(ref(staff,'incidents/incident_one')));
  await assertFails(set(ref(owner,'incidents/forged'),{severity:'SEV1',status:'resolved'}));
  await assertFails(get(ref(owner,'incidentCommandClaims/claim_one')));
  await assertSucceeds(get(ref(owner,'deletionAudit/orders/old_deleted')));
  await assertFails(set(ref(owner,'deletionAudit/orders/forged'),{deletedAt:2}));
  await assertSucceeds(get(ref(owner,'clientTelemetryDaily/2026-08-09')));
  await assertSucceeds(get(ref(manager,'clientTelemetryDaily/2026-08-09')));
  await assertFails(get(ref(staff,'clientTelemetryDaily/2026-08-09')));
  await assertFails(set(ref(owner,'clientTelemetryDaily/2026-08-10'),{metrics:{forged:{count:1}}}));
  // Staff Inbox (Sep 2026 download audit): each reader reads and seeds only their own index,
  // and nobody can write the shared message or receipt records from a browser.
  await assertSucceeds(get(ref(owner,'staffMessages/msg_one')));
  await assertFails(get(ref(guest,'staffMessages/msg_one')));
  await assertFails(set(ref(owner,'staffMessages/forged'),{title:'x',body:'y',createdAt:3}));
  await assertSucceeds(get(ref(owner,'staffReceiptIndex/owner')));
  await assertFails(get(ref(owner,'staffReceiptIndex/manager')));
  await assertFails(get(ref(staff,'staffReceiptIndex/owner')));
  await assertFails(get(ref(guest,'staffReceiptIndex/owner')));
  await assertSucceeds(set(ref(owner,'staffReceiptIndex/owner/msg_one'),{messageId:'msg_one',readAt:2}));
  await assertFails(set(ref(owner,'staffReceiptIndex/manager/msg_one'),{messageId:'msg_one',readAt:2}));
  await assertFails(set(ref(owner,'staffMessageReceipts/forged/owner'),{userUid:'owner',readAt:3}));

  await assertFails(set(ref(a,'orders/forged'),{id:'forged',ownerUid:'customer-a',source:'online',status:'Pending',total:1}));
  await assertFails(update(ref(a,'orders/own'),{status:'Received',receivedByCustomer:true}));
  await assertFails(update(ref(owner,'orders/own'),{status:'Confirmed'}));

  await assertFails(get(ref(a,'orders/legacy')));
  await assertFails(update(ref(a,'orders/legacy'),{status:'Received',receivedByCustomer:true}));

  await assertSucceeds(get(ref(a,'customerOrders/customer-a')));
  await assertSucceeds(get(query(ref(a,'customerOrders/customer-a'),orderByChild('createdAt'),limitToLast(20))));
  await assertFails(get(ref(a,'customerOrders/customer-b')));
  await assertFails(get(query(ref(a,'customerOrders/customer-b'),orderByChild('createdAt'),limitToLast(20))));
  await assertFails(set(ref(a,'customerOrders/customer-a/fake'),{createdAt:2,status:'Pending'}));

  await assertSucceeds(update(ref(a,'appCustomers/customer-a'),{name:'Customer A Updated',phone:'09123456789',lastSeen:2}));
  await assertFails(update(ref(a,'appCustomers/customer-a'),{orders:999}));
  await assertFails(get(ref(b,'appCustomers/customer-a')));
  await assertFails(get(ref(a,'orderLocks/customer-a/hash')));
  await assertFails(set(ref(a,'orderLocks/customer-a/new'),{t:2}));

  console.log('PASS: customer UID ownership, private locks, server-only creation, and staff/admin access rules behave correctly.');
}finally{
  await env.cleanup();
}
