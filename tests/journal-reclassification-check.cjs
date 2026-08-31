const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const R=require('../functions/lib/journal-reclassification');
const B=require('../functions/lib/books-bridge');
const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8').replace(/^\s*\/\/.*$/gm,'')).rules;
const claimRules=rules.financialCommandClaims;
assert.ok([].concat(rules.cfLedger['.indexOn']||[]).includes('movementId'),'Cash edit movement lookups require their movementId index');
assert.ok([].concat(claimRules['.indexOn']||[]).includes('status'),'Pending journal-operation queries require a deployed status index');
assert.equal(claimRules['.read'],false,'The index must not grant client access');
assert.equal(claimRules['.write'],false,'The index must not grant client writes');
const original={type:'inventory_reconciliation_adjustment',sourceType:'inventoryReconciliation',occurredAt:Date.parse('2026-08-01T00:00:00+08:00'),lines:[{account:'coa:1220',debit:4950,credit:0},{account:'coa:5905',debit:0,credit:4950}]};
const prepared={date:'2026-08-01',memo:'Opening inventory',reference:'OPEN',debit:4950,lines:[{account:'coa:1220',debit:4950,credit:0},{account:'coa:3000',debit:0,credit:4950}]};
assert.ok(R.allowed(original,prepared));
assert.ok(R.allowed({...original,type:'inventory_manual_edit',sourceType:'inventoryMovement'},prepared));
assert.ok(R.allowed({...original,type:'inventory_adjustment',sourceType:'inventoryMovement'},prepared));
assert.ok(!R.allowed(original,{...prepared,date:'2026-08-02'}));
assert.ok(!R.allowed(original,{...prepared,lines:prepared.lines.map(l=>({...l,debit:l.debit?5000:0,credit:l.credit?5000:0}))}));
for(const key of ['linkedPayableId','linkedDiscrepancyId','reversedByMovementId','reversalOf'])assert.ok(!R.allowed({...original,[key]:'linked'},prepared));
assert.ok(!R.allowed({...original,sourceType:'order'},prepared));
assert.ok(!R.allowed({...original,type:'personal_business_cost',sourceType:'personalFunding'},prepared));
const source=fs.readFileSync('src/functions/40-sales-finance.js','utf8');
const body=source.slice(source.indexOf('async function reviseJournalClassification'),source.indexOf('function assertNoOverlappingUpdatePaths'));
async function run(){
  let state={financialMovements:{one:structuredClone(original)},books:{journal:{one:B.buildSingle({...original,id:'one'},{}).entry}},financialCloseIndex:{'2026-08-01':{daily:{status:'CERTIFIED'}}},financialCloses:{daily:{current:{status:'CERTIFIED'}}}},closed=false;
  const read=path=>path.split('/').filter(Boolean).reduce((s,k)=>s?.[k],state)??null;
  const write=(path,value)=>{const keys=path.split('/').filter(Boolean);let s=state;while(keys.length>1){const k=keys.shift();s=s[k]??(s[k]={});}if(value===null)delete s[keys[0]];else s[keys[0]]=structuredClone(value);};
  const snap=v=>({val:()=>structuredClone(v),exists:()=>v!=null});
  let foreignLock=false;
  const db={ref:(path='')=>({get:async()=>snap(read(path)),orderByChild(){return this;},equalTo(){return this;},transaction:async fn=>{
    // Firebase can first invoke the updater with stale local data. A release
    // must not abort at null before the SDK retries against the owned lock.
    const stale=fn(null);if(stale===undefined)return{committed:false,snapshot:snap(read(path))};
    if(foreignLock)write(path,{token:'another-editor',claimedAt:123456});
    const value=fn(read(path));if(value===undefined)return{committed:false,snapshot:snap(read(path))};
    write(path,value);return{committed:true,snapshot:snap(value)};
  }})};
  const ctx=vm.createContext({JournalReclassification:R,BooksBridge:B,crypto:require('node:crypto'),HttpsError:class extends Error{constructor(code,msg){super(msg);}},financeText:s=>String(s||''),assertAccountingPeriodOpen:async()=>{if(closed)throw Error('closed');},safeFinancialUpdate:async(_,writes)=>{assert.ok(Object.keys(writes).every(k=>!/^inventory\/|^cashCustody\/|^cfLedger\/|^payables\//.test(k)));for(const [p,v]of Object.entries(writes))write(p,v);}});
  vm.runInContext(body,ctx);
  const data={expectedRevision:0,reason:'Opening reclassification',date:prepared.date,lines:prepared.lines},actor={uid:'owner',role:'owner'};
  const result=await ctx.reviseJournalClassification(db,'one',data,prepared,actor,'edit1',123456);
  assert.equal(result.revision,1);assert.equal(Object.keys(state.financialMovements).length,1);
  assert.equal(state.books.journal.one.lines.find(l=>l.code==='1220').debit,4950);
  assert.equal(state.books.journal.one.lines.find(l=>l.code==='3000').credit,4950);
  assert.equal(state.cashJournalRevisions.one['1'].before.lines[1].account,'coa:5905');
  assert.equal(state.financialCloses.daily.current.status,'REOPENED');
  assert.equal(read('/financialControlLocks/cashJournalEdit'),null,'release must reach server despite initially empty cache');
  assert.equal((await ctx.reviseJournalClassification(db,'one',data,prepared,actor,'edit1',123456)).duplicate,true);
  const second={...prepared,lines:original.lines};
  await assert.rejects(()=>ctx.reviseJournalClassification(db,'one',data,second,actor,'stale',123456),/changed/);
  closed=true;await assert.rejects(()=>ctx.reviseJournalClassification(db,'one',{...data,expectedRevision:1},second,actor,'closed',123456),/closed/);
  assert.equal(read('/financialControlLocks/cashJournalEdit'),null,'failed edits must release the lock');
  foreignLock=true;await assert.rejects(()=>ctx.reviseJournalClassification(db,'one',data,second,actor,'busy',123456),/Another journal correction/);
  assert.equal(read('/financialControlLocks/cashJournalEdit').token,'another-editor','never steal or release another editor lock');
  console.log('PASS: reclassification stays in place, preserves inventory, audit history, source ID, replay, revision, period and close safeguards.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
