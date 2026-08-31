const assert=require('node:assert/strict');
const E=require('../functions/lib/cash-journal-edit');
const B=require('../functions/lib/books-bridge');
const pool='asset:cash_awaiting_deposit',bank='asset:cash_account:bank';
const stamp=d=>Date.parse(d+'T00:00:00+08:00');
const line=(account,debit,credit)=>({account,debit,credit});
const original={id:'deposit',type:'manual_books_journal',sourceType:'booksManualJournal',sourceId:'deposit',occurredAt:stamp('2026-08-31'),postedAt:stamp('2026-08-31'),amount:6717,lines:[line(bank,6717,0),line(pool,0,6717)]};
const base={cfAccounts:{bank:{name:'Bank',code:'1011',type:'bank'}},financialMovements:{deposit:original,receipt:{id:'receipt',occurredAt:stamp('2026-08-30'),lines:[line(pool,10000,0),line('revenue:sales',0,10000)]}},cashCustody:{one:{amount:2000,remaining:1000,paidOutAmount:1000,closedAt:1},two:{amount:8000,remaining:2283,depositedAmount:5717,closedAt:2}},cfLedger:{depositcash:{movementId:'deposit',accountId:'bank',amount:6717,dir:'in'}},books:{journal:{deposit:B.buildSingle(original,{bank:'1011'}).entry}},accountingPeriods:{},financialCloseIndex:{'2026-08-31':{daily:{status:'CERTIFIED'}}},financialCloses:{daily:{current:{status:'CERTIFIED'}}}};
const input={id:'deposit',commandId:'edit1',expectedRevision:0,prepared:{date:'2026-09-01',memo:'Actual deposit after holiday',reference:'SLIP1',lines:[line(bank,6907,0),line(pool,0,6907)]},reason:'Correct actual amount/date',actor:{uid:'manager1',role:'manager'},now:stamp('2026-09-01'),floatFloor:4000};
const untouched=structuredClone(base),out=E.revise(base,input);
assert.deepEqual(base,untouched,'reducer must not mutate the input snapshot');
assert.equal(Object.keys(out.financialMovements).length,2,'must not add reversal or replacement movements');
assert.equal(out.financialMovements.deposit.amount,6907);
assert.equal(out.financialMovements.deposit.revision,1);
assert.equal(out.books.journal.deposit.date,'2026-09-01');
assert.equal(out.books.journal.deposit.revision,1);
assert.equal(out.books.journal.deposit.memo,input.prepared.memo);
assert.equal(out.books.journal.deposit.ref,input.prepared.reference);
assert.equal(Object.values(out.cashCustody).reduce((s,r)=>s+r.remaining,0),3093);
assert.equal(out.cashJournalRevisions.deposit['1'].before.amount,6717);
assert.equal(out.cashJournalRevisions.deposit['1'].poolAfter,3093);
assert.equal(out.financialCloses.daily.current.status,'REOPENED');
assert.deepEqual(out.financialMovements.receipt,base.financialMovements.receipt,'revenue is untouched');
assert.deepEqual(E.revise(out,input),out,'exact retry must not post twice');
assert.throws(()=>E.revise(out,{...input,reason:'different'}),/submission ID/);
assert.throws(()=>E.revise(out,{...input,commandId:'edit2'}),/changed since/);
const editedAgain=E.revise(out,{...input,commandId:'edit2',expectedRevision:1,prepared:{...input.prepared,lines:[line(bank,6500,0),line(pool,0,6500)]}});
assert.equal(Object.values(editedAgain.cashCustody).reduce((s,r)=>s+r.remaining,0),3500);
assert.equal(Object.keys(editedAgain.cashJournalRevisions.deposit).length,2);
assert.equal(Object.keys(editedAgain.books.journal).length,1);
assert.equal(Object.keys(editedAgain.cfLedger).length,2);
function blocked(mutate,pattern){const state=structuredClone(base),args=structuredClone(input);mutate(state,args);const before=structuredClone(state);assert.throws(()=>E.revise(state,args),pattern);assert.deepEqual(state,before);}
blocked((s)=>s.accountingPeriods['2026-08']={status:'closed'},/both be open/);
blocked((s)=>s.accountingPeriods['2026-09']={status:'closed'},/both be open/);
blocked((s)=>s.books.journal.deposit.bankReconciled=true,/Bank-reconciled/);
blocked((s)=>s.cfLedger.depositcash.statementId='statement',/bank-reconciled/);
blocked((s)=>s.cfAccounts.bank.reconciledThrough='2026-08-31',/Bank-reconciled/);
blocked((s,a)=>a.actor.role='cashier',/privileged Finance/);
blocked((s,a)=>a.reason='',/reason/);
blocked((s,a)=>a.prepared.date='2026-09-02',/future/);
blocked((s,a)=>a.prepared.date='2026-02-30',/valid Philippine/);
blocked((s,a)=>a.prepared.lines=[line(bank,0,0),line(pool,0,0)],/direction/);
blocked((s,a)=>a.prepared.lines=[line(bank,11000,0),line(pool,0,11000)],/whole Undeposited/);
blocked((s,a)=>a.prepared.lines=[line(bank,0,6907),line(pool,6907,0)],/direction/);
blocked((s,a)=>a.prepared.lines=[line('revenue:sales',6907,0),line(pool,0,6907)],/matching account/);
blocked((s)=>s.cashCustody.one.remaining+=10,/already differs/);
blocked((s)=>s.financialMovements.deposit.reversedByMovementId='reversed',/reversed/);
blocked((s)=>s.financialCommandClaims={other:{status:'processing',claimedAt:input.now}},/in progress/);
blocked((s)=>s.financialMovements.deposit.linkedPayableId='payable',/linked-control/);
blocked((s,a)=>a.prepared.date='2026-08-29',/negative historical/);
const dep=structuredClone(base);dep.financialMovements.deposit.type='register_cash_deposit';dep.financialMovements.deposit.reference='SLIP1';
assert.equal(E.revise(dep,input).financialMovements.deposit.revision,1);
const clash=structuredClone(dep);const key=require('node:crypto').createHash('sha256').update('bank|slip1').digest('hex');clash.cashDepositReferences={bank:{[key]:{movementId:'different'}}};assert.throws(()=>E.revise(clash,input),/another deposit/);
assert.equal(B.buildSingle(out.financialMovements.deposit,{bank:'1011'}).entry.revision,1,'a rebuild retains the revision pointer');
const pendingLines=[line(bank,500,0),line(pool,0,500)],pendingWrites={'cashCustody/one/remaining':500};
assert.doesNotThrow(()=>E.assertCustodyDelta(base.cashCustody,pendingWrites,pendingLines));
assert.throws(()=>E.assertCustodyDelta(out.cashCustody,pendingWrites,pendingLines),/balance changed/);
assert.equal(out.cashCustody.one.paidOutAmount,1000,'deposit correction is not a cash payment');
assert.equal(out.cashCustody.one.depositedAmount,190);
const noId=structuredClone(base);delete noId.financialMovements.deposit.id;
assert.equal(E.revise(noId,input).books.journal.deposit.id,'deposit');
const registerState=structuredClone(base);registerState.financialMovements.deposit.lines[0].account='asset:register_cash';
registerState.financialMovements.opening={id:'opening',occurredAt:stamp('2026-08-01'),lines:[line('asset:register_cash',4000,0),line('equity:capital_in',0,4000)]};
registerState.books.journal.deposit=B.buildSingle(registerState.financialMovements.deposit,{}).entry;
const registerInput={...input,prepared:{...input.prepared,lines:[line('asset:register_cash',6907,0),line(pool,0,6907)]}};
assert.equal(E.revise(registerState,registerInput).financialMovements.deposit.amount,6907);
registerState.financialMovements.payment={id:'payment',occurredAt:stamp('2026-09-01'),lines:[line('expense:rent',6717,0),line('asset:register_cash',0,6717)]};
assert.throws(()=>E.revise(registerState,{...registerInput,prepared:{...registerInput.prepared,lines:[line('asset:register_cash',6500,0),line(pool,0,6500)]}}),/protected register float/);
// An open-period two-line manual cash journal may change only its amount when
// its counterpart has no Admin subledger. Its cash-ledger record must change
// in the same revision; inventory/AP/AR remain ineligible.
const capitalState={financialMovements:{opening:{id:'opening',occurredAt:stamp('2026-08-01'),lines:[line('asset:register_cash',5000,0),line('equity:owner_capital',0,5000)]},draw:{id:'draw',type:'manual_books_journal',sourceType:'booksManualJournal',sourceId:'draw',occurredAt:stamp('2026-08-28'),postedAt:stamp('2026-08-28'),amount:504,lines:[line('equity:owner_capital',504,0),line('asset:register_cash',0,504)]}},cfLedger:{drawcash:{movementId:'draw',accountId:'register',amount:504,dir:'out'}},books:{journal:{}},accountingPeriods:{},financialCloseIndex:{},financialCloses:{},cashCustody:{}};
capitalState.books.journal.draw=B.buildSingle(capitalState.financialMovements.draw,{}).entry;
const capitalOut=E.revise(capitalState,{id:'draw',commandId:'capital-edit',expectedRevision:0,prepared:{date:'2026-08-28',memo:'Correct owner withdrawal',reference:'VOUCHER-1',lines:[line('equity:owner_capital',494,0),line('asset:register_cash',0,494)]},reason:'Correct posting amount',actor:{uid:'manager1',role:'manager'},now:stamp('2026-09-01'),floatFloor:4000});
assert.equal(capitalOut.financialMovements.draw.amount,494,'Finance Books journal changes in place');
assert.equal(capitalOut.cfLedger.fm_draw_1.amount,494,'Cash on Hand ledger changes in the same revision');
assert.equal(capitalOut.cashJournalRevisions.draw['1'].before.amount,504,'the original remains in the audit history');
assert.equal(Object.keys(capitalOut.financialMovements).length,2,'no void or replacement journal is created');
assert.equal(E.eligible({type:'manual_books_journal',lines:[line('coa:6100',504,0),line('asset:register_cash',0,504)]}),true,'ordinary expense counterpart is also eligible');
assert.equal(E.eligible({type:'manual_books_journal',lines:[line('liability:accounts_payable',504,0),line('asset:register_cash',0,504)]}),false,'payables remain on their dedicated subledger workflow');
assert.equal(E.eligible({type:'manual_books_journal',lines:[line('asset:inventory',504,0),line('asset:register_cash',0,504)]}),false,'inventory remains on its dedicated workflow');
console.log('PASS: in-place cash journals preserve one ID, revenue, pooled custody, history and replay/period/concurrency safeguards.');

// Exercise the real callable routing, account mapping and browser submission.
async function integration(){
  const fs=require('node:fs'),vm=require('node:vm'),Financial=require('../functions/lib/financial');
  let state=structuredClone(base),role='manager';
  state.cfAccounts.bank.name='UnionBank';
  const read=(value,path)=>path.split('/').filter(Boolean).reduce((r,k)=>r&&r[k],value)??null;
  const write=(path,value)=>{const parts=path.split('/').filter(Boolean);let node=state;while(parts.length>1){const key=parts.shift();node=node[key]||(node[key]={});}const key=parts[0];if(value===null)delete node[key];else node[key]=structuredClone(value);};
  const snapshot=value=>({val:()=>value,exists:()=>value!=null,child:path=>snapshot(read(value,path))});
  const db={ref(path=''){return{
    get:async()=>snapshot(structuredClone(read(state,path))),
    orderByChild(){return this;},equalTo(){return this;},
    transaction:async reducer=>{
      assert.notEqual(path,'','cash edit must never transact over the database root');
      const current=structuredClone(read(state,path)),next=reducer(current);
      if(next===undefined)return{committed:false,snapshot:snapshot(current)};
      write(path,next);return{committed:true,snapshot:snapshot(next)};
    }
  };}};
  class Clock extends Date{static now(){return input.now;}}
  class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
  const ctx={exports:{},Date:Clock,crypto:require('node:crypto'),logger:{error(){}},ORDER_REGION:'test',ENFORCE_APP_CHECK:false,HttpsError,Financial,BooksBridge:B,CashJournalEdit:E,
    getDatabase:()=>db,onCall:(_,fn)=>fn,observeFinancialOperation:(_,__,fn)=>fn(),
    requirePortalPermission:async()=>({uid:'manager1',role}),financeText:(s,n)=>String(s||'').trim().slice(0,n),
    financeKey:s=>{assert.match(s,/^[A-Za-z0-9_-]+$/);return s;},financeDate:s=>s,
    ensureChartAccounts:async()=>({}),ensureBooksChart:async()=>({}),SENSITIVE_BOOKS_CODES:new Set(['1011','1030']),
    assertAccountingPeriodOpen:async(_,date)=>{if((state.accountingPeriods[date.slice(0,7)]||{}).status==='closed')throw new HttpsError('failed-precondition','closed period');},
    resolveRegisterFloat:()=>({amount:4000}),safeFinancialUpdate:async(_,writes)=>{Object.keys(writes).forEach(path=>write(path,writes[path]));}};
  vm.createContext(ctx);
  const finance=fs.readFileSync('src/functions/40-sales-finance.js','utf8');
  vm.runInContext(finance.slice(finance.indexOf('function booksCodeAccount('),finance.indexOf('function assertNoOverlappingUpdatePaths(')),ctx);
  vm.runInContext(['42a-financial-command-entry.js','42b-financial-command-transactions.js','42c-financial-command-controls.js','42d-financial-command-close.js'].map(f=>fs.readFileSync('src/functions/'+f,'utf8')).join('\n'),ctx);
  const data={action:'correct_manual_journal',commandId:'ui_edit',originalMovementId:'deposit',expectedRevision:0,date:'2026-09-01',memo:'Actual holiday deposit',ref:'SLIP1',reason:'Correct amount',lines:[{code:'1011',debit:6907,credit:0},{code:'1030',debit:0,credit:6907}]};
  const result=await ctx.exports.postFinancialCommand({data});
  assert.equal(result.editedInPlace,true);assert.equal(result.movementId,'deposit');assert.equal(result.revision,1);
  assert.equal(state.books.journal.deposit.lines[0].code,'1011');
  assert.equal((await ctx.exports.postFinancialCommand({data})).revision,1,'same callable retry is idempotent');
  await assert.rejects(ctx.exports.postFinancialCommand({data:{...data,memo:'Different payload'}}),/submission ID/);
  const status=await ctx.exports.postFinancialCommand({data:{action:'cash_journal_edit_status',commandId:'status',editCommandId:'ui_edit',originalMovementId:'deposit'}});
  assert.equal(status.committed,true);assert.equal(status.revision,1);
  await assert.rejects(ctx.exports.postFinancialCommand({data:{...data,commandId:'stale_edit'}}),/changed since/);
  const historyData={action:'cash_journal_history',commandId:'history',originalMovementId:'deposit'};
  assert.equal((await ctx.exports.postFinancialCommand({data:historyData})).revisions['1'].before.amount,6717);
  role='cashier';await assert.rejects(ctx.exports.postFinancialCommand({data:historyData}),/privileged Finance role/);
  await assert.rejects(ctx.exports.postFinancialCommand({data:{...data,commandId:'cashier_edit',expectedRevision:1}}),/privileged Finance role/);
  const elements={postBtn:{},e_payable:{value:''},e_purpose:{value:''}},sent=[];
  const ui={window:{__financeCmd:payload=>{sent.push(payload);return{then:()=>({catch:()=>{}})};}},document:{getElementById:id=>elements[id]||null},crypto:require('node:crypto'),r2:Financial.money,isMainAccount:()=>false,todayStr:()=>data.date,alert:message=>{throw new Error(message);}};
  vm.createContext(ui);vm.runInContext(fs.readFileSync('src/books/app/10-application-shell.js','utf8')+'\nglobalThis.app=App;',ui);
  ui.app._draft={date:data.date,memo:data.memo,ref:data.ref,lines:data.lines};ui.app._edit={originalMovementId:'deposit',expectedRevision:1,reason:'Correction'};
  ui.app.postEntry();ui.app.postEntry();assert.equal(sent.length,2);assert.equal(sent[0].expectedRevision,1);assert.equal(sent[0].commandId,sent[1].commandId,'uncertain retries retain the submission ID');
  const controls=fs.readFileSync('src/functions/42c-financial-command-controls.js','utf8');
  assert.doesNotMatch(controls,/db\.ref\(\)\.transaction/,'cash correction must not load the whole database into a transaction');
  assert.match(controls,/financialControlLocks\/cashJournalEdit/);
  console.log('PASS: real callable/account mapping, scoped lock/update, history permissions and browser revision/retry payload.');
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
