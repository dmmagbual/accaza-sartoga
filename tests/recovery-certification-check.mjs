import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const Recovery=require('../functions/lib/recovery-validation.js');

const source={maintenance:fs.readFileSync(new URL('../src/functions/60-maintenance.js',import.meta.url),'utf8'),rules:fs.readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')};
const snapshot={
  inventory:{milk:{name:'Milk',stock:10,cost:5}}, inventoryBalances:{milk:{qty:10,value:50}},
  financialMovements:{purchase_one:{id:'purchase_one',sourceType:'purchase',sourceId:'invoice_one',lines:[{account:'inventory:milk',debit:50,credit:0},{account:'liability:payable:invoice_one',debit:0,credit:50}]}},
  books:{journal:{purchase_one:{id:'purchase_one',sourceType:'purchase',sourceId:'invoice_one',lines:[{code:'1210',debit:50,credit:0},{code:'2010',debit:0,credit:50}]}}},
  purchaseInvoices:{invoice_one:{id:'invoice_one',payableId:'payable_one',total:50}}, payables:{payable_one:{id:'payable_one',purchaseInvoiceId:'invoice_one',amount:50,remaining:50}},
};

const envelope=Recovery.createEnvelope(snapshot,1788105600000,new Set(['activeOrders','orderLocks']));
assert.equal(Recovery.validateEnvelope(envelope).ok,true);
const restored=JSON.parse(JSON.stringify(envelope));
assert.equal(Recovery.fingerprint(restored.data),Recovery.fingerprint(snapshot),'isolated restore changed the durable snapshot');
assert.deepEqual(restored.data,snapshot,'isolated restore did not reproduce every durable value');
const legacy={takenAt:1788105600000,version:'backup-v1',excluded:[],data:snapshot};
assert.equal(Recovery.validateEnvelope(legacy).ok,true,'historical backup-v1 files must remain recoverable');

const corrupt=JSON.parse(JSON.stringify(envelope)); corrupt.data.inventory.milk.stock=999;
assert.equal(Recovery.validateEnvelope(corrupt).ok,false,'corrupt backup was not rejected');
const unbalanced=Recovery.createEnvelope({...snapshot,financialMovements:{bad:{lines:[{debit:10,credit:0}]}}},1788105600000,[]);
assert.match(Recovery.validateEnvelope(unbalanced).issues.join(' '),/debits and credits differ/);

for(const node of ['financialMovements','books','inventoryBalances','systemHealth']){
  assert.match(source.rules,new RegExp(`"${node}"`),`permission review: ${node} has no explicit rule`);
}
for(const marker of ['RecoveryValidation.createEnvelope','RecoveryValidation.validateEnvelope','dataSha256','validation: "passed"']) assert.ok(source.maintenance.includes(marker),`backup safeguard missing: ${marker}`);

console.log('PASS: Phase 12 backup integrity, isolated restore fidelity, balanced Finance data, and protected recovery nodes are verified.');
