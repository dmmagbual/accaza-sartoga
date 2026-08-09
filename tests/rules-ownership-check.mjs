import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {get,ref,set,update} from 'firebase/database';

const projectId='accaza-sartoga';
const rules=fs.readFileSync('database.rules.json','utf8');
const env=await initializeTestEnvironment({projectId,database:{rules}});

try{
  await env.withSecurityRulesDisabled(async(context)=>{
    await set(ref(context.database()),{
      admins:{owner:true,manager:'manager',staff:'staff'},
      adminPerms:{staff:{orders:true,pos:true,discrepancy:true,petty:true}},
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
      deletionAudit:{orders:{old_deleted:{orderId:'old_deleted',deletedAt:1}}},
      clientTelemetryDaily:{'2026-08-09':{metrics:{pos_boot:{count:1,totalMs:500,maxMs:500,failed:0}}}},
    });
  });

  const a=env.authenticatedContext('customer-a').database();
  const b=env.authenticatedContext('customer-b').database();
  const owner=env.authenticatedContext('owner').database();
  const manager=env.authenticatedContext('manager').database();
  const staff=env.authenticatedContext('staff').database();
  const guest=env.unauthenticatedContext().database();

  await assertSucceeds(get(ref(a,'orders/own')));
  await assertFails(get(ref(b,'orders/own')));
  await assertFails(get(ref(guest,'orders/own')));
  await assertSucceeds(get(ref(staff,'orders/own')));
  await assertFails(get(ref(a,'activeOrders/own')));
  await assertFails(get(ref(guest,'activeOrders/own')));
  await assertSucceeds(get(ref(staff,'activeOrders/own')));
  await assertSucceeds(update(ref(staff,'activeOrders/own'),{status:'Preparing'}));
  await assertFails(set(ref(a,'activeOrders/fake'),{id:'fake',status:'Pending'}));
  await assertFails(get(ref(owner,'systemMaintenance')));
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
  await assertFails(update(ref(owner,'activityLogArchive/log_old'),{action:'forged'}));
  await assertSucceeds(get(ref(owner,'operationalAudit/audit_one')));
  await assertFails(set(ref(owner,'operationalAudit/forged'),{action:'forged',ts:2}));
  await assertSucceeds(get(ref(owner,'deletionAudit/orders/old_deleted')));
  await assertFails(set(ref(owner,'deletionAudit/orders/forged'),{deletedAt:2}));
  await assertSucceeds(get(ref(owner,'clientTelemetryDaily/2026-08-09')));
  await assertSucceeds(get(ref(manager,'clientTelemetryDaily/2026-08-09')));
  await assertFails(get(ref(staff,'clientTelemetryDaily/2026-08-09')));
  await assertFails(set(ref(owner,'clientTelemetryDaily/2026-08-10'),{metrics:{forged:{count:1}}}));

  await assertFails(set(ref(a,'orders/forged'),{id:'forged',ownerUid:'customer-a',source:'online',status:'Pending',total:1}));
  await assertFails(update(ref(a,'orders/own'),{status:'Received',receivedByCustomer:true}));
  await assertSucceeds(update(ref(owner,'orders/own'),{status:'Confirmed'}));

  await assertSucceeds(get(ref(a,'orders/legacy')));
  await assertSucceeds(update(ref(a,'orders/legacy'),{status:'Received',receivedByCustomer:true}));

  await assertSucceeds(get(ref(a,'customerOrders/customer-a')));
  await assertFails(get(ref(a,'customerOrders/customer-b')));
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
