(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaRef=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - one reference per document, shown the same way everywhere (3 Nov 2026).
     Every document has a business reference issued by the server: order POS-/OD-/GF-/FF-,
     shift SH-<NAME>-<token>, purchase PUR-YYYY-NNNN, cash payment PV-YYYYMM-NNNN, journal
     PV/RV/PI/FA/IR/IA/JE-YYYY-NNNN, bill documentNo, deposit and payout references. Database
     keys (pinv_..., sale_POS-..., SH-<6 digits>-<6 hex>, push IDs) are internal and are never
     shown. Cash discrepancies and cash custody are labelled by their shift's reference.
     A journal with no number of its own is labelled by its source document.
     Screens hand this helper the record they hold; lookups use only data already loaded on
     the page (provide()), so labelling adds no database reads. The server keeps a byte-identical
     copy at functions/lib/references.js for error messages, alerts and stored labels. */
  var PENDING='Reference pending';
  var SOURCE_LABELS={order:'Sale',qrOrderTicket:'Sale',historicalOrderArchive:'Sale',order_correction:'Sale correction',order_reversal:'Sale reversal',orderCostCorrection:'Cost correction',order_cost_correction:'Cost correction',order_cost_correction_reversal:'Cost correction reversal',
    shift:'Shift',cashCustody:'Cash awaiting deposit',discrepancy:'Cash discrepancy',registerFloat:'Register float',registerFloatChange:'Register float',
    purchaseInvoice:'Purchase',pettyVoucher:'Cash payment',pettyReplenishment:'Revolving fund top-up',revolvingFund:'Revolving fund',
    payable:'Bill',payables:'Bill',payableBatch:'Bill payment',receivable:'Receivable',platformPayout:'Platform payout',
    fixedAsset:'Fixed asset',booksManualJournal:'Manual journal',booksManualJournalPeriodRepair:'Manual journal',manual:'Manual journal',
    inventoryReconciliation:'Inventory reconciliation',inventoryMovement:'Inventory adjustment',transfer:'Cash transfer',cashAccount:'Cash account',
    personalFunding:'Owner funding',legacyCutover:'Opening balance',financialMovement:'Journal',
    'inventory-adjustment':'Stock adjustment','internal-usage':'Internal usage','inventory-xlsx':'Inventory import','new-inventory-item':'New item opening',migration:'Migration'};
  var providers={};
  function str(v){return v==null?'':String(v).trim();}
  // An internal key: a database key, push ID or server movement ID. Business references use an
  // upper-case prefix and a hyphen (POS-, SH-ALEX-, PUR-, PV-) or are typed by people.
  function isKey(v){
    var s=str(v);if(!s)return false;
    return /^SH-\d{6}-[0-9a-f]{6}$/i.test(s)||/^-[A-Za-z0-9_-]{15,}$/.test(s)||/^PENDING-/i.test(s)||/^[a-z][a-z0-9]*_/.test(s);
  }
  function text(v,fallback){var s=str(v);return s&&!isKey(s)?s:(fallback==null?'':fallback);}
  function first(){for(var i=0;i<arguments.length;i++){var s=text(arguments[i]);if(s)return s;}return '';}
  // Pages register the maps they already hold, e.g. provide('shift',function(){return shiftsMap;}).
  // Several modules may hold the same kind (admin and POS bundles are separate closures).
  function provide(kind,getter){if(kind&&typeof getter==='function')(providers[kind]=providers[kind]||[]).push(getter);}
  function lookup(kind,id){var key=str(id),list=providers[kind]||[];if(!key)return null;for(var i=0;i<list.length;i++){try{var map=list[i]();if(map&&map[key])return map[key];}catch(e){}}return null;}
  function shift(rec,id){
    rec=rec||lookup('shift',id)||{};
    // Pages without the shift list (Finance Books) still hold custody and discrepancy rows,
    // which carry the reference of the shift they came from.
    var held=id?(lookup('custody',id)||{}):{};
    return first(rec.shiftReference,rec.zReport&&rec.zReport.shiftReference,held.shiftReference)||PENDING;
  }
  function shiftById(id,rec){return shift(rec||lookup('shift',id),id);}
  function custody(c){c=c||{};return first(c.shiftReference,c.reference)||(c.shiftId&&isKey(c.shiftId)?shiftById(c.shiftId):text(c.shiftId))||PENDING;}
  function discrepancy(d){d=d||{};return first(d.shiftReference)||(d.shiftId?shiftById(d.shiftId):PENDING);}
  // A bill: its document number, plus the supplier's own reference when it is a different value.
  function bill(d){
    d=d||{};var no=text(d.documentNo),ref=first(d.ref,d.reference,d.supplierRef);
    if(no)return ref&&ref!==no?no+' · '+ref:no;
    return ref||PENDING;
  }
  function purchase(p){p=p||{};var no=text(p.documentNo),ref=first(p.ref,p.supplierRef);if(no)return ref&&ref!==no?no+' · '+ref:no;return ref||PENDING;}
  function voucher(v){v=v||{};return first(v.voucherNo,v.documentNo)||PENDING;}
  function payout(p){p=p||{};return first(p.reference,p.ref,p.payoutReference)||PENDING;}
  function sourceLabel(type){return SOURCE_LABELS[str(type)]||'Record';}
  // The business reference of the document a movement, log entry or exception points at.
  function forSource(type,id,rec){
    var t=str(type),key=str(id);rec=rec||{};
    if(/^order|^qrOrderTicket$|^historicalOrderArchive$/.test(t)){return key&&!/^pos_/i.test(key)?key:sourceLabel(t);}
    if(t==='shift'||t==='registerFloat'||t==='registerFloatChange')return key?shiftById(key):sourceLabel(t);
    if(t==='cashCustody'){var c=lookup('custody',key);return c?custody(c):shiftById(key);}
    if(t==='discrepancy'){var d=lookup('discrepancy',key);return d?discrepancy(d):first(rec.shiftReference)||sourceLabel(t);}
    if(t==='purchaseInvoice'){var p=lookup('purchase',key);return p?purchase(p):first(rec.purchaseNo)||sourceLabel(t);}
    if(t==='pettyVoucher'||t==='pettyReplenishment'){var v=lookup('voucher',key);return v?voucher(v):first(rec.voucherNo)||sourceLabel(t);}
    if(t==='payable'||t==='payables'){var b=lookup('payable',key);return b?bill(b):sourceLabel(t);}
    if(t==='receivable'){var r=lookup('receivable',key);return r?bill(r):sourceLabel(t);}
    if(t==='platformPayout'){var po=lookup('payout',key);return po?payout(po):sourceLabel(t);}
    return text(key)||sourceLabel(t);
  }
  // A financial movement / journal: its own document number; with none, its source document.
  function movement(m){m=m||{};return first(m.documentNo,m.voucherNo)||forSource(m.sourceType,m.sourceId,m);}
  function movementById(id){var m=lookup('movement',id);return m?movement(m):'';}
  // A Finance Books journal entry (daily POS summaries carry POS-YYYYMMDD-CHANNEL references).
  function journal(e){e=e||{};return first(e.ref,e.reference,e.documentNo)||movementById(e.id)||(e.sourceType?forSource(e.sourceType,e.sourceId,e):'')||'Journal entry';}
  // A Finance close-control exception names its source by ID only; the control says what it is.
  var EXCEPTION_SOURCES={cash_variance:'shift',shift_open:'shift',cogs_missing:'order',inventory_marker:'order',inventory_missing:'order',sales_amount:'order',sales_duplicate:'order',sales_missing:'order',sales_cutoff:'order',uncosted_sale:'order',payment_verification_negative:'order',payable_balance_out_of_range:'payable',purchase_posting:'purchaseInvoice',platform_settlement:'platformPayout',sales_orphan:'movement',unbalanced_movement:'movement'};
  function exception(x){
    x=x||{};var type=EXCEPTION_SOURCES[str(x.control)],id=str(x.sourceId),stored=text(x.sourceReference);
    if(stored)return stored;
    if(!id)return '';
    if(type==='movement')return movementById(id)||'Journal';
    if(type)return forSource(type,id,x);
    return text(id);
  }
  // Older memos and labels were built as "POS sale · sale_POS-..." or "Reverse · pinv_...":
  // drop any " · "-separated part that is an internal key, keep everything people wrote.
  function clean(value){var s=str(value);if(!s)return '';return s.split(/\s+·\s+/).filter(function(part){return !isKey(part);}).join(' · ');}
  return {PENDING:PENDING,isKey:isKey,clean:clean,exception:exception,text:text,first:first,provide:provide,lookup:lookup,shift:shift,shiftById:shiftById,custody:custody,discrepancy:discrepancy,bill:bill,purchase:purchase,voucher:voucher,payout:payout,sourceLabel:sourceLabel,forSource:forSource,movement:movement,movementById:movementById,journal:journal};
});
