"use strict";
const crypto=require('node:crypto');
const B=require('./books-bridge');
const P=require('./accounting-periods');
const money=n=>Math.round((Number(n)||0)*100)/100;
const pool='asset:cash_awaiting_deposit';
function fail(message){throw new Error(message);}
function locked(row){return !!row&&(row.bankReconciled===true||row.reconciled===true||!!row.reconciledAt||!!row.bankReconciliationId||!!row.statementId);}
// These are ordinary General Ledger counterparts: they do not carry a separate
// Admin subledger. Control accounts stay on their dedicated workflows.
function editableCounterparty(account){
  const value=String(account||'');
  if(['equity:owner_capital','equity:opening_balance','coa:3000'].includes(value))return true;
  const code=/^coa:(\d{4})$/.exec(value);
  if(!code)return false;
  const number=Number(code[1]);
  return number>=4000&&number<7000&&number!==6110;
}
function shape(lines){
  if(!Array.isArray(lines)||lines.length!==2)return null;
  if(lines.some(l=>!Number.isFinite(Number(l.debit))||!Number.isFinite(Number(l.credit))||Number(l.debit)<0||Number(l.credit)<0||(Number(l.debit)>0)===(Number(l.credit)>0)))return null;
  const p=lines.find(l=>l.account===pool),cash=lines.find(l=>l.account==='asset:register_cash'||/^asset:cash_account:[A-Za-z0-9_-]+$/.test(l.account||''));
  if(p&&cash&&Math.abs(money(p.debit-cash.credit))<.009&&Math.abs(money(p.credit-cash.debit))<.009)return {kind:'pooled_transfer',account:cash.account,poolNet:money(p.debit-p.credit),cashNet:money(cash.debit-cash.credit),value:money(p.debit+p.credit)};
  const counterparty=lines.find(l=>l!==cash&&editableCounterparty(l.account));
  if(counterparty&&cash&&Math.abs(money(cash.debit-counterparty.credit))<.009&&Math.abs(money(cash.credit-counterparty.debit))<.009)return {kind:'cash_manual',account:cash.account,counterparty:counterparty.account,cashNet:money(cash.debit-cash.credit),value:money(cash.debit+cash.credit)};
  return null;
}
function eligible(m){return !!m&&['manual_books_journal','register_cash_deposit'].includes(m.type)&&!!shape(m.lines);}
function fingerprint(payload){return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');}
function editSignature(input){const {id,expectedRevision,prepared,reason,actor}=input;return fingerprint({id,expectedRevision,prepared,reason,actorUid:actor.uid});}
// Existing posting workflows calculate custody changes before claiming their
// movement. Recheck the proposed delta after the claim: a journal edit that
// finished between those steps must not be overwritten by a stale calculation.
function assertCustodyDelta(custody,writes,lines){
  const paths=Object.keys(writes).filter(p=>p.startsWith('cashCustody/'));
  if(!paths.length)return;
  const next=structuredClone(custody||{});
  for(const path of paths){const [,key,field]=path.split('/');if(!field){if(writes[path]===null)delete next[key];else next[key]=structuredClone(writes[path]);}else if(field==='remaining'){next[key]=next[key]||{};next[key].remaining=writes[path];}}
  const sum=rows=>money(Object.values(rows||{}).reduce((s,r)=>s+Number(r.remaining||0),0));
  const expected=money((lines||[]).reduce((s,l)=>s+(l.account===pool?Number(l.debit||0)-Number(l.credit||0):0),0));
  if(Math.abs(money(sum(next)-sum(custody))-expected)>.009)fail('The custody balance changed while this posting was prepared. Refresh and retry; nothing was posted.');
}
function revisionWrites(before,next,id,commandId){
  const receipt=next.cashJournalEditCommands&&next.cashJournalEditCommands[commandId];
  if(!receipt)fail('The revised journal receipt is missing.');
  const revision=String(receipt.revision),history=next.cashJournalRevisions[id][revision],writes={
    [`financialMovements/${id}`]:next.financialMovements[id],
    [`books/journal/${id}`]:next.books.journal[id],
    [`cashJournalRevisions/${id}/${revision}`]:history,
    [`cashJournalEditCommands/${commandId}`]:receipt,
    [`operationalAudit/${commandId}`]:next.operationalAudit[commandId]
  };
  Object.keys(history.custodyChanges||{}).forEach(key=>{writes[`cashCustody/${key}`]=next.cashCustody[key]||null;});
  Object.keys(before.cfLedger||{}).forEach(key=>{if(!next.cfLedger||!next.cfLedger[key])writes[`cfLedger/${key}`]=null;});
  Object.keys(next.cfLedger||{}).forEach(key=>{if(!before.cfLedger||JSON.stringify(before.cfLedger[key])!==JSON.stringify(next.cfLedger[key]))writes[`cfLedger/${key}`]=next.cfLedger[key];});
  Object.keys(next.financialCloses||{}).forEach(key=>{if(JSON.stringify((before.financialCloses||{})[key])!==JSON.stringify(next.financialCloses[key]))writes[`financialCloses/${key}/current`]=next.financialCloses[key].current;});
  Object.keys(next.financialCloseIndex||{}).forEach(date=>Object.keys(next.financialCloseIndex[date]||{}).forEach(key=>{if(JSON.stringify(((before.financialCloseIndex||{})[date]||{})[key])!==JSON.stringify(next.financialCloseIndex[date][key]))writes[`financialCloseIndex/${date}/${key}`]=next.financialCloseIndex[date][key];}));
  Object.keys(next.cashDepositReferences||{}).forEach(account=>Object.keys(next.cashDepositReferences[account]||{}).forEach(key=>{if(JSON.stringify((((before.cashDepositReferences||{})[account]||{})[key]))!==JSON.stringify(next.cashDepositReferences[account][key]))writes[`cashDepositReferences/${account}/${key}`]=next.cashDepositReferences[account][key];}));
  return writes;
}
// Pure transaction reducer. No network calls or side effects: every retry checks
// the latest source, period locks, cash balances, and complete custody pool.
function revise(root,input){
  if(!root)return root;
  const {id,commandId,expectedRevision,prepared,actor,reason,now,floatFloor}=input;
  const signature=editSignature(input);
  const prior=root.cashJournalEditCommands&&root.cashJournalEditCommands[commandId];
  if(prior){if(prior.signature!==signature)fail('This submission ID was already used for a different edit.');return root;}
  if(!['owner','superadmin','admin','manager'].includes(actor.role))fail('A privileged Finance role must approve this cash-journal edit.');
  if(!String(reason||'').trim())fail('A correction reason is required.');
  const original=root.financialMovements&&root.financialMovements[id],journal=root.books&&root.books.journal&&root.books.journal[id];
  if(!eligible(original)||!journal)fail('Only a posted two-account cash transfer or cash journal with an ordinary income, expense, or equity counterpart can use this edit.');
  if(!Number.isInteger(expectedRevision)||expectedRevision!==Number(original.revision||0))fail('This journal changed since you opened it. Refresh and review it again.');
  if(original.voided||original.reversalOf||original.reversedByMovementId||original.correctionReplacementId||original.linkedPayableId||original.linkedDiscrepancyId)fail('A reversed, voided, or linked-control journal cannot use this edit.');
  if(root.financialControlLinks&&root.financialControlLinks.correctionMovements&&root.financialControlLinks.correctionMovements[id])fail('Use the linked variance workflow for this journal.');
  const before=shape(original.lines),after=shape(prepared.lines);
  if(!after||before.kind!==after.kind||before.account!==after.account||before.counterparty!==after.counterparty||Math.sign(before.cashNet)!==Math.sign(after.cashNet))fail('Keep the same cash account, matching account, and direction. Inventory, receivables, payables, and other controlled accounts cannot be changed here.');
  const oldDate=B.businessDate(original.occurredAt||original.postedAt),date=prepared.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00+08:00'))||B.businessDate(Date.parse(date+'T00:00:00+08:00'))!==date)fail('A valid Philippine accounting date is required.');
  if(date>B.businessDate(now))fail('A future planned deposit cannot be posted as completed.');
  for(const d of [oldDate,date])if(P.isClosed((root.accountingPeriods||{})[P.periodForDate(d)]))fail('The original and revised accounting periods must both be open.');
  const cashId=before.account.startsWith('asset:cash_account:')?before.account.slice(19):'register',account=(root.cfAccounts||{})[cashId];
  if(cashId!=='register'&&(!account||account.active===false))fail('The receiving cash account is missing or inactive.');
  if(locked(original)||locked(journal)||locked(account)||(account&&account.reconciledThrough&&[oldDate,date].some(d=>d<=account.reconciledThrough)))fail('Bank-reconciled cash journals cannot be edited directly.');
  const ledgerRows=Object.entries(root.cfLedger||{}).filter(([,r])=>r.movementId===id);
  if(ledgerRows.some(([,r])=>locked(r)))fail('The cash ledger record is already bank-reconciled.');
  if(Object.values(root.financialCommandClaims||{}).some(c=>c.status==='processing'&&Number(c.claimedAt)>now-900000))fail('Another financial posting is in progress. Retry after it completes.');
  const movements=Object.entries(root.financialMovements||{}).map(([id,m])=>({...m,id})),balance=(acct)=>money(movements.reduce((s,m)=>s+(m.lines||[]).reduce((n,l)=>n+(l.account===acct?Number(l.debit||0)-Number(l.credit||0):0),0),0));
  const poolBefore=balance(pool),custodyBefore=money(Object.values(root.cashCustody||{}).reduce((s,r)=>s+Number(r.remaining||0),0));
  let delta=money(after.cashNet-before.cashNet),poolAfter=poolBefore,cashAfter=money(balance(before.account)+delta);
  if(before.kind==='pooled_transfer'){
    if(Math.abs(poolBefore-custodyBefore)>.009)fail('Undeposited Collection already differs from cash custody. Reconcile that existing difference before editing; no automatic balancing entry was created.');
    delta=money(after.poolNet-before.poolNet);poolAfter=money(poolBefore+delta);cashAfter=money(balance(before.account)-delta);
    if(poolAfter<-.009)fail('The revised transfer exceeds the whole Undeposited Collection pool.');
  }
  if(cashAfter<(cashId==='register'?floatFloor:0)-.009)fail('The revised transfer would overdraw cash or use the protected register float.');
  // Reject backdating that creates a negative closing daily balance in either account.
  for(const acct of (before.kind==='pooled_transfer'?[pool,before.account]:[before.account])){
    const daily={};for(const m of movements){const d=B.businessDate(m.occurredAt||m.postedAt),value=(m.id===id?prepared.lines:m.lines||[]).reduce((s,l)=>s+(l.account===acct?Number(l.debit||0)-Number(l.credit||0):0),0),key=m.id===id?date:d;daily[key]=money((daily[key]||0)+value);}
    let running=0;for(const d of Object.keys(daily).sort()){running=money(running+daily[d]);if(d>= (oldDate<date?oldDate:date)&&running<-.009)fail('This date/amount would leave a negative historical cash balance. Check the actual transfer date.');}
  }
  const next=structuredClone(root),custody=next.cashCustody||(next.cashCustody={}),revision=expectedRevision+1,changedCustody={};
  // The user edits one pooled amount. Existing positive custody rows remain
  // supporting evidence; no individual remittance selection or amount limit.
  if(before.kind==='pooled_transfer'&&delta<0){
    let left=-delta;const deposit=before.account.startsWith('asset:cash_account:');
    for(const key of Object.keys(custody).sort((a,b)=>Number(custody[a].closedAt||0)-Number(custody[b].closedAt||0)||a.localeCompare(b))){
      const row=custody[key],use=money(Math.min(left,Math.max(0,Number(row.remaining)||0)));if(!use)continue;
      changedCustody[key]={before:structuredClone(row)};row.remaining=money(row.remaining-use);
      const counter=deposit?'depositedAmount':'paidOutAmount';row[counter]=money(Number(row[counter]||0)+use);
      row.status=deposit?(row.remaining>0?'partially_deposited':'deposited'):(row.remaining>0?'partially_paid_out':'paid_out');
      row.lastJournalEditId=commandId;changedCustody[key].after=structuredClone(row);left=money(left-use);if(left<.009)break;
    }
    if(left>.009)fail('The available custody pool changed. Refresh and retry.');
  }
  if(before.kind==='pooled_transfer'&&delta>0){const key='journal_edit_'+commandId;custody[key]={amount:delta,remaining:delta,depositedAmount:0,paidOutAmount:0,status:'awaiting_deposit',closedAt:Date.parse(date+'T00:00:00+08:00'),movementId:id,source:'journal_edit_pool_return',staff:'Pooled journal correction',reference:prepared.reference,revision,schemaVersion:1};changedCustody[key]={before:null,after:structuredClone(custody[key])};}
  const edited={...original,lines:prepared.lines,amount:after.value,occurredAt:Date.parse(date+'T00:00:00+08:00'),memo:prepared.memo,reference:prepared.reference,revision,updatedAt:now,updatedBy:actor.uid,lastCorrectionReason:reason};
  // Legacy allocations describe the original receipt evidence, not a limit on
  // the corrected pooled journal. Retain them explicitly as historical data.
  if(original.custodyAllocations){edited.originalCustodyAllocations=original.originalCustodyAllocations||original.custodyAllocations;delete edited.custodyAllocations;}
  edited.custodyAllocationMode='pooled_journal_revision';
  if(original.type==='register_cash_deposit'){
    if(after.poolNet>=0)fail('A deposit must credit Undeposited Collection.');
    // Use the same hashing contract as the deposit command.
    const referenceKey=crypto.createHash('sha256').update(cashId+'|'+prepared.reference.trim().toLowerCase()).digest('hex');
    const references=(next.cashDepositReferences||(next.cashDepositReferences={})),entries=references[cashId]||(references[cashId]={}),found=entries[referenceKey];
    if(found&&found.movementId!==id)fail('That deposit reference belongs to another deposit.');
    for(const row of Object.values(entries))if(row.movementId===id){row.amount=after.value;row.date=date;row.revision=revision;}
    entries[referenceKey]={status:'posted',movementId:id,amount:after.value,date,reference:prepared.reference,revision,postedAt:original.postedAt||now};
  }
  next.financialMovements[id]=edited;
  const cashMap={...((next.books.config||{}).cashAccountMap||{})};for(const [key,row]of Object.entries(next.cfAccounts||{}))if(!cashMap[key])cashMap[key]=B.cashCodeForAccount(row);
  next.books.journal[id]={...journal,...B.buildSingle(edited,cashMap).entry,revision,updatedAt:now,updatedBy:actor.uid};
  const cashBefore=Object.fromEntries(ledgerRows);
  for(const [key]of ledgerRows)delete next.cfLedger[key];
  next.cfLedger=next.cfLedger||{};
  prepared.lines.forEach((l,index)=>{if(before.kind==='cash_manual'&&l.account!==before.account)return;const value=money(l.debit-l.credit);next.cfLedger['fm_'+id+'_'+index]={date,accountId:l.account===pool?'undeposited':cashId,dir:value>0?'in':'out',category:'Cash journal',amount:Math.abs(value),party:prepared.memo,ref:prepared.reference,source:original.sourceType,linkId:original.sourceId||id,movementId:id,auto:true,immutable:true,ts:edited.occurredAt,by:actor.role,revision};});
  const history=next.cashJournalRevisions||(next.cashJournalRevisions={});(history[id]||(history[id]={}))[String(revision)]={revision,commandId,reason,changedAt:now,changedBy:actor.uid,changedByRole:actor.role,before:original,after:edited,journalBefore:journal,cashLedgerBefore:cashBefore,custodyChanges:changedCustody,poolBefore,poolAfter};
  // Created-only close triggers do not fire on edits; reopen affected close snapshots atomically.
  for(const d of new Set([oldDate,date]))for(const [closeId,index]of Object.entries((next.financialCloseIndex||{})[d]||{})){const close=next.financialCloses&&next.financialCloses[closeId];if(close&&close.current){close.current.status='REOPENED';close.current.reopenedAt=now;close.current.reopenedByActivityId=commandId;index.status='REOPENED';index.reopenedAt=now;}}
  (next.operationalAudit||(next.operationalAudit={}))[commandId]={action:before.kind==='cash_manual'?'edit_open_manual_cash_journal':'edit_open_cash_journal',sourceId:id,revision,reason,actorUid:actor.uid,actorRole:actor.role,ts:now,originalDate:oldDate,date,amount:after.value,poolBefore:before.kind==='pooled_transfer'?poolBefore:null,poolAfter:before.kind==='pooled_transfer'?poolAfter:null};
  (next.cashJournalEditCommands||(next.cashJournalEditCommands={}))[commandId]={signature,movementId:id,revision,postedAt:now,actorUid:actor.uid};
  return next;
}
module.exports={eligible,shape,revise,assertCustodyDelta,revisionWrites,editSignature};
