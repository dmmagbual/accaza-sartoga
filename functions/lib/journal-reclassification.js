"use strict";
const B=require('./books-bridge');
const crypto=require('node:crypto');
function allowed(original,prepared){
  if(!original||!['manual_books_journal','inventory_reconciliation_adjustment','inventory_opening_balance','inventory_adjustment','inventory_manual_edit'].includes(original.type))return false;
  if(!['booksManualJournal','inventoryReconciliation','inventoryMovement'].includes(original.sourceType))return false;
  if(original.linkedPayableId||original.linkedDiscrepancyId||original.reversalOf||original.reversedByMovementId)return false;
  if(original.bankReconciled||original.reconciled||original.reconciledAt||original.bankReconciliationId||original.statementId)return false;
  if(B.businessDate(original.occurredAt||original.postedAt)!==prepared.date)return false;
  const totals=lines=>{const out={};for(const l of lines||[]){const a=String(l.account||'');out[a]=B.r2((out[a]||0)+(Number(l.debit)||0)-(Number(l.credit)||0));}return out;};
  const before=totals(original.lines),after=totals(prepared.lines);
  const changeable=a=>{const m=B.mapAccount(a);return !m.unmapped&&(/^(3000|3050|3100|3900)$/.test(m.code)||Number(m.code)>=4990&&Number(m.code)<7000&&m.code!=='6110');};
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(a=>Math.abs((before[a]||0)-(after[a]||0))>.009);
  return changed.length>0&&changed.every(changeable)&&Math.abs(Object.values(after).reduce((s,v)=>s+v,0))<.009;
}
function signature(id,data,actor){return crypto.createHash('sha256').update(JSON.stringify({id,revision:data.expectedRevision,date:data.date,lines:data.lines,memo:data.memo,ref:data.ref,reason:data.reason,uid:actor.uid})).digest('hex');}
module.exports={allowed,signature};
