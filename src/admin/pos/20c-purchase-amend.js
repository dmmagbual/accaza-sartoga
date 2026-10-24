/* Purchase Amend (Danilo, 22 Oct 2026): "Amend reopens the purchase details on the entry card and Save
   updates the same purchase in place, with no reversal" — like Xero / QuickBooks. Lines can be added,
   removed or changed; the server moves stock, the bill or bank payment and Finance Books by the
   difference only, dated on the purchase date, and keeps the PUR number. Super Admin only. */
function purchDraftHasContent(P){return !!(P&&(P.lines||[]).some(function(ln){return ln&&(ln.ing||ln.newName||ln.expenseDescription||ln.assetName||Number(ln.qty)>0);}));}
function startPurchaseAmend(id){
  var p=purchaseInvoicesMap[id]||{},authz=window.__accazaAuthz||{};
  if(p.reversed){alert('This purchase is voided. Enter a new purchase instead.');return;}
  if(String(authz.role||'').toLowerCase()!=='superadmin'){alert('Only a Super Admin can amend a posted purchase.');return;}
  if(p.pendingEdit&&p.pendingEdit.kind!=='amend'){alert('An earlier Edit of this purchase did not finish. Ask for a review before amending it.');return;}
  if(p.pendingEdit&&p.pendingEdit.kind==='amend'){resolveUnfinishedAmend(id,p);return;}
  var cur=window.__purch;if(cur&&cur.amendOf!==id&&purchDraftHasContent(cur)&&!confirm('Opening this purchase clears the unsaved entry on the purchase card. Continue?'))return;
  var d=correctedPurchaseDraft(Object.assign({id:id},p));
  d.lines.forEach(function(ln,i){ln.origIndex=i;});
  d.amendOf=id;d.amendRevision=Number(p.editRevision||0);d.amendTotal=Number(p.total)||0;d.amendRef=purchaseRefText(p,id);d.pay=p.payMode==='none'?'pending':(p.payMode||'pending');d.acct=p.accountId||'';d.advanceId=p.purchaseAdvanceId||'';
  window.__purch=d;renderPurchases();
  var r=document.getElementById('purchasesRoot');if(r&&r.scrollIntoView)r.scrollIntoView({behavior:'smooth',block:'start'});
}
function purchaseAmendPayBlock(P){
  var p=purchaseInvoicesMap[P.amendOf]||{};
  return '<div class="purchase-section purchase-payment"><div class="purchase-section-head"><span class="purchase-step">2</span><div><b>Payment</b><small>'+esc(purchaseStatusLabel(p))+(p.payableId?' · bill '+esc(p.payableId):'')+'</small></div></div><div class="az-note">The new total is applied to the same supplier bill, bank / e-wallet payment, or Undeposited Collection payment (a higher total draws the extra from Undeposited Collection; a lower total puts the difference back). A bill with any payment against it must have that payment reversed first (Finance Books → Payables → Show settled).</div></div>';
}
function purchaseAmendRows(P){
  var p=purchaseInvoicesMap[P.amendOf]||{},orig=Array.isArray(p.lines)?p.lines:[],rows=[],problem='';
  P.lines.forEach(function(ln,i){
    if(problem)return;
    var o=ln.origIndex!==undefined&&ln.origIndex!==null?orig[ln.origIndex]:null,c=purchCalc(ln),n=i+1;
    if(ln.mode==='asset'){
      if(!o||o.lineType!=='fixed_asset'){problem='Line '+n+': equipment can\'t be added by Amend. Enter it as a new purchase.';return;}
      if(!c||Number(ln.qty)!==Number(o.qty)||Math.round(c.lineTotal*100)/100!==Math.round((Number(o.total)||0)*100)/100){problem='Line '+n+': equipment is linked to fixed-asset cards and can\'t be changed. Void the purchase and enter it again.';return;}
      rows.push({origIndex:ln.origIndex,qty:Number(o.qty)||0,total:Math.round((Number(o.total)||0)*100)/100});return;
    }
    var blank=ln.mode==='expense'?!(ln.expenseDescription||'').trim():ln.mode==='new'?!(ln.newName||'').trim():!ln.ing;
    if(blank&&!(Number(ln.qty)>0))return;
    if(ln.mode==='new'){problem='Line '+n+': “'+((ln.newName||'').trim()||'new item')+'” is a new stock item. Create it under Stock Items first, then add it here.';return;}
    if(blank){problem='Line '+n+': choose the item, or remove the line with ✕.';return;}
    if(!c||!(Number(ln.qty)>0)){problem='Line '+n+': enter a quantity greater than zero, or remove the line with ✕.';return;}
    var total=Math.round(c.lineTotal*100)/100;if(!(total>0)){problem='Line '+n+': enter an amount greater than zero.';return;}
    if(ln.mode==='expense'){
      if(!purchaseExpenseAccount(ln.expenseAccount)){problem='Line '+n+': choose an active 6000-series expense account.';return;}
      rows.push({origIndex:o&&o.lineType==='expense'?ln.origIndex:null,lineType:'expense',itemName:(ln.expenseDescription||'').trim(),expenseAccount:String(ln.expenseAccount),qty:Number(ln.qty),total:total});return;
    }
    var same=!!(o&&o.lineType!=='expense'&&o.lineType!=='fixed_asset'&&o.itemId===ln.ing),sku=inventorySkuMap[ln.skuId],skuOk=!!(sku&&sku.masterId===ln.ing&&sku.active!==false);
    if(!same&&recipeUsesInventory(ln.ing)&&!skuOk){problem='Line '+n+': select an active approved brand for “'+((inventoryMap[ln.ing]||{}).name||ln.ing)+'”.';return;}
    var qty=Math.round(c.stockAdd*1000000)/1000000;
    if(same&&Number(ln.qty)===Number(o.qty)&&uNorm(c.recvUnit)===uNorm(o.unit))qty=Number(o.qty); /* untouched quantity: send it exactly as posted */
    rows.push({origIndex:same?ln.origIndex:null,lineType:'stock',itemId:ln.ing,skuId:skuOk?ln.skuId:(same?(o.skuId||''):''),skuBrand:skuOk?(sku.brand||''):(same?(o.skuBrand||''):(ln.brand||'').trim()),qty:qty,total:total,recvQty:Number(ln.qty)||0,recvUnit:c.recvUnit||''});
  });
  return {rows:rows,problem:problem};
}
function savePurchaseAmendment(){
  if(window.__purchPosting)return;var P=window.__purch;if(!P||!P.amendOf)return;
  var a=A();if(!a||!a.managePurchaseCorrection){alert('Purchase correction service is unavailable. Refresh the portal.');return;}
  var built=purchaseAmendRows(P);if(built.problem){alert(built.problem);return;}
  if(!built.rows.length){alert('A purchase needs at least one line. To cancel the whole purchase, use Void.');return;}
  var vat=Math.max(0,Math.round((Number(P.inputVat)||0)*100)/100),newTotal=Math.round((built.rows.reduce(function(s,r){return s+(Number(r.total)||0);},0)+vat)*100)/100;
  F().run({title:'Save amendment · '+P.amendRef,subtitle:(P.supplier||'Supplier')+' · total '+peso(P.amendTotal)+' → '+peso(newTotal)+'. The purchase keeps its number. Stock, the supplier bill or bank payment and Finance Books are updated for the difference, dated '+(P.date||'on the purchase date')+'.',submitLabel:'Save amendment',busyLabel:'Saving amendment…',fields:[{name:'reason',label:'Reason for the amendment',type:'textarea',required:true,maxLength:300}]},function(v){
    window.__purchPosting=true;
    return a.managePurchaseCorrection({action:'amend',invoiceId:P.amendOf,expectedRevision:P.amendRevision,expectedTotal:P.amendTotal,lines:built.rows,inputVat:vat,description:(P.description||'').trim(),reason:v.reason});
  }).then(function(res){
    window.__purchPosting=false;var d=(res&&res.data)||res||{},used=Number(d.usedValueToCost)||0;window.__purch=null;renderPurchases();
    alert('Purchase amended. Total '+peso(d.oldTotal)+' → '+peso(d.newTotal)+'.'+(used?' Part of the change was for stock already sold, so cost of sales was '+(used>0?'increased':'reduced')+' by '+peso(Math.abs(used))+'.':''));
  }).catch(function(e){window.__purchPosting=false;var s=String((e&&e.message)||(e&&e.code)||e);if(s.indexOf('cancelled')<0)alert('Could not save the amendment: '+s);});
}
/* Older voids never marked their stock receipts, so stock cards still showed the receipt with no Void
   row. One server call per such purchase labels its receipts (no stock or money moves). */
function repairVoidedPurchaseReceipts(btn){
  var a=A(),ids=Object.keys(purchaseInvoicesMap).filter(function(id){var p=purchaseInvoicesMap[id]||{};return p.reversed&&!p.receiptsVoidMarkedAt&&(p.receiptIds||[]).length;});
  if(!ids.length){alert('All voided purchases already show as voided on the stock cards.');return;}
  if(!confirm('Mark the stock receipts of '+ids.length+' voided purchase(s) as voided, so the stock cards show the void? No stock or Finance Books amounts change.'))return;
  btn.disabled=true;var done=0,failed=[];
  ids.reduce(function(chain,id){return chain.then(function(){return a.managePurchaseCorrection({action:'mark_void_receipts',invoiceId:id}).then(function(){done+=1;btn.textContent='Marking… '+done+'/'+ids.length;}).catch(function(e){failed.push(purchaseRefText(purchaseInvoicesMap[id]||{},id)+': '+((e&&e.message)||e));});});},Promise.resolve()).then(function(){btn.disabled=false;renderPurchases();alert(done+' voided purchase(s) now show as voided on the stock cards.'+(failed.length?'\nNot marked:\n'+failed.join('\n'):''));});
}
/* An amendment that stopped part-way (connection lost, a refusal after stock moved) is finished with the
   exact request the server staged, or discarded when no stock moved yet. */
function resolveUnfinishedAmend(id,p){
  var a=A(),ref=purchaseRefText(p,id);
  if(confirm('An earlier amendment of '+ref+' did not finish. Finish it now with the same changes?')){
    a.managePurchaseCorrection({action:'amend',resume:true,invoiceId:id,reason:'Finish unfinished amendment'}).then(function(res){var d=(res&&res.data)||res||{};renderPurchases();alert('Amendment finished. Total '+peso(d.oldTotal)+' → '+peso(d.newTotal)+'.');}).catch(function(e){alert('Could not finish the amendment: '+((e&&e.message)||e));});
    return;
  }
  if(!confirm('Discard the unfinished amendment of '+ref+' instead? This is only possible if no stock moved yet.'))return;
  a.managePurchaseCorrection({action:'discard_amend',invoiceId:id,reason:'Discard unfinished amendment'}).then(function(){renderPurchases();alert('Unfinished amendment discarded. You can amend the purchase again.');}).catch(function(e){alert('Could not discard it: '+((e&&e.message)||e));});
}

/* Purchase date in both detail dialogs (23 Oct 2026). Danilo changed a date in a details dialog and nothing
   happened: the date he typed went into the payment due date (Edit details) or the dialog had no purchase
   date at all (Correct purchase details). Both dialogs now show the purchase date first, labelled as the
   posting date, and save it through the server date correction before the other details. */
var PURCHASE_DUE_LABEL='Payment due date (when the supplier must be paid)';
function purchaseDateField(inv){return [{name:'date',label:'Purchase date (posting date in Finance Books)',type:'date',required:true,max:window.AccazaDate.key(),value:inv.date||''}];}
function savePurchaseDetails(inv,v,details){
  var moved=!!(v.date&&v.date!==inv.date);
  /* The date goes first: it is the step the server may refuse (closed month, paid bill, reconciled payment). */
  return (moved?A().managePurchaseCorrection({action:'correct_date',invoiceId:inv.id,date:v.date,expectedDateRevision:Math.max(0,Math.trunc(Number(inv.dateRevision)||0)),reason:v.reason}):Promise.resolve())
    .then(function(){return A().managePurchaseCorrection(details);}).then(function(){return moved?v.date:'';});
}
function purchaseDetailsSaved(inv,movedTo,unchanged){alert(movedTo?'Purchase date changed from '+inv.date+' to '+movedTo+'. Finance Books, the payment, the supplier bill and the stock receipts now use the new date. Amounts and stock did not change.':unchanged+' The purchase date was not changed.');}