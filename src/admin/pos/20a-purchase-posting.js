function purchUpdatePrev(){
  var P=window.__purch; if(!P)return; var tot=0;
  P.lines.forEach(function(ln,i){var c=purchCalc(ln);if(c)tot+=c.lineTotal;var el=document.querySelector('[data-pprev="'+i+'"]');if(el)el.textContent=c?('+'+num(c.stockAdd)+' '+c.stockUnit+' · new avg '+peso(c.newCost)+'/'+c.stockUnit+' · line '+peso(c.lineTotal)):'';});
  var t=document.getElementById('purTotal');if(t)t.textContent=peso(Math.round((tot+Math.max(0,Number(P.inputVat)||0))*100)/100);
}
function postPurchases(){
  if(window.__purchPosting)return; var P=window.__purch; if(!P)return;
  if(P.pay==='none')P.pay='pending';
  var masterSupplier=purchaseSupplierById(P.supplierId);if(!masterSupplier){alert('Select an active supplier from the shared supplier database.');return;}P.supplier=masterSupplier.name;
  var lines=P.lines.filter(function(ln){return (ln.mode==='asset'?(ln.assetName||'').trim():ln.mode==='expense'?(ln.expenseDescription||'').trim():(ln.mode==='new'?(ln.newName||'').trim():ln.ing))&&(Number(ln.qty)||0)>0;});
  if(!lines.length){alert('Add at least one line with an item and a quantity.');return;}
  var purchaseByName={};ings().forEach(function(x){purchaseByName[uNorm(x.name)]=x;});
  var missingMapping=null;
  for(var mi=0;mi<lines.length;mi++)if(lines[mi].mode==='new'){
    var pendingLine=lines[mi],matchedItem=purchaseByName[uNorm((pendingLine.newName||'').trim())]||null,accounts=matchedItem?invItemAccounts(matchedItem):{inventoryAccount:pendingLine.newInventoryAccount||'',costAccount:pendingLine.newCostAccount||''};
    if(!validPurchaseAccounts(accounts.inventoryAccount,accounts.costAccount)){missingMapping={line:pendingLine,item:matchedItem};break;}
  }
  if(missingMapping){promptPurchaseItemMapping(missingMapping.line,missingMapping.item).then(function(){renderPurchases();postPurchases();}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not save the item mapping: '+((e&&e.message)||e));});return;}
  for(var i=0;i<lines.length;i++){
    var line=lines[i],c0=purchCalc(line);if(line.mode==='asset'){var aq=Number(line.qty)||0,unitAssetCost=c0&&aq>0?c0.lineTotal/aq:0;if(!Number.isInteger(aq)||aq<1||aq>100){alert('Equipment quantity must be a whole number from 1 to 100.');return;}if(!c0||!(c0.lineTotal>0)){alert('Equipment needs a cost greater than zero.');return;}if(!(Number(line.assetLifeMonths)>=1)){alert('Enter the equipment useful life in months.');return;}if((Number(line.assetSalvage)||0)<0||(Number(line.assetSalvage)||0)>=unitAssetCost){alert('Salvage value per asset must be zero or less than its unit cost.');return;}if(!(line.assetInServiceDate||P.date)){alert('Enter the in-service date.');return;}if(!(line.assetLocation||'').trim()||!(line.assetCustodian||'').trim()){alert('Enter the equipment location and custodian.');return;}continue;}if(line.mode==='expense'){if(!purchaseExpenseAccount(line.expenseAccount)){alert('Choose an active 6000-series operating-expense account for every one-time expense. Cash Short / Over is controlled separately.');return;}if(!c0||!(c0.lineTotal>0)){alert('A one-time expense needs a quantity and cost greater than zero.');return;}continue;}if(!c0||!(c0.stockAdd>0)){alert('A stock line has an invalid quantity/unit — check the measures.');return;}
    if(line.mode==='new'&&!isSupplyType(line.newType)&&(line.newType==='consumable'||line.recipeItem!==false)&&!(line.brand||'').trim()){alert('Enter the first approved brand for new recipe item “'+((line.newName||'').trim()||'unnamed item')+'”.');return;}
    if(line.mode!=='new'&&recipeUsesInventory(line.ing)){var validSku=inventorySkuMap[line.skuId];if(!validSku||validSku.masterId!==line.ing||validSku.active===false){alert('Select an active approved brand for recipe item “'+((inventoryMap[line.ing]||{}).name||line.ing)+'” before receiving this purchase.');return;}}
  }
  if(P.pay==='paid'){ var availableAccounts=(window.__cf&&window.__cf.accounts?window.__cf.accounts():[]).filter(function(x){return !x.disabled;});if(!availableAccounts.length){alert('No available Balance Sheet cash account. Choose another payment option.');return;} if(!P.acct||!availableAccounts.some(function(x){return x.id===P.acct;}))P.acct=availableAccounts[0].id; }
  if(P.pay==='advance'&&!P.advanceId){alert('Select an approved advance payment for this supplier.');return;}
  if(P.pay==='advance'&&!openPurchaseAdvances(P.supplierId,P.supplier).some(function(x){return x.id===P.advanceId;})){alert('The selected advance is unavailable or belongs to another supplier. Refresh and select the correct supplier advance.');return;}
  if(P.pay==='owner_funded'&&!(P.ownerName||'').trim()){alert('Enter the owner or partner who paid personally.');return;}
  if(P.pay==='owner_funded'&&!(A()&&A().postFinancialCommand)){alert('Owner/partner funding service is not ready. Refresh the portal and try again.');return;}
  if((P.pay==='account'||P.pay==='pending')&&!(A()&&A().reconcilePurchasePayable)){ alert('Purchase liability service is not ready. Refresh the portal and try again.'); return; }
  /* a "new" line whose name already exists (or repeats within this invoice) blends into that item — no duplicate SKU */
  var byName={}; ings().forEach(function(x){byName[uNorm(x.name)]=x.id;});
  window.__purchPosting=true;
  var a=A(); var invoiceId=P.invoiceId||(P.invoiceId=uid('pinv_')); var date=P.date||window.AccazaDate.key(), effectiveRef=(P.ref||'').trim()||(P.pay==='pending'?('PENDING-'+invoiceId):invoiceId);
  var updates={}, seedUpdates={}, invTotal=0, receiptIds=[], invoiceLines=[], agg={}, newByName={}, newSkuByKey={};
  lines.forEach(function(ln,lineIndex){
    if(ln.mode==='asset'){var ac=purchCalc(ln),assetQty=Number(ln.qty)||0;invTotal+=ac.lineTotal;invoiceLines.push({lineType:'fixed_asset',itemName:(ln.assetName||'').trim(),assetCategory:ln.assetCategory==='furniture'?'furniture':'equipment',qty:assetQty,unit:'asset',unitCost:Math.round((ac.lineTotal/assetQty)*100)/100,total:ac.lineTotal,usefulLifeMonths:Math.round(Number(ln.assetLifeMonths)||0),depreciationMethod:'straight-line',salvagePerUnit:Math.round((Number(ln.assetSalvage)||0)*100)/100,inServiceDate:ln.assetInServiceDate||date,location:(ln.assetLocation||'').trim(),custodian:(ln.assetCustodian||'').trim()});return;}
    if(ln.mode==='expense'){var ec=purchCalc(ln),expenseQty=Number(ln.qty)||0,expenseName=(ln.expenseDescription||'').trim();invTotal+=ec.lineTotal;invoiceLines.push({lineType:'expense',itemName:expenseName,expenseAccount:ln.expenseAccount,qty:expenseQty,unit:'use',unitCost:expenseQty>0?Math.round((ec.lineTotal/expenseQty)*100000)/100000:0,total:ec.lineTotal});return;}
    var requestedNew=ln.mode==='new';
    if(ln.mode==='new'){ var mt=byName[uNorm((ln.newName||'').trim())]; if(mt)ln=Object.assign({},ln,{mode:'existing',ing:mt}); }
    var c=purchCalc(ln); var ingId=ln.ing; var nm;
    if(ln.mode==='new'){
      var nk=uNorm((ln.newName||'').trim());
      if(newByName[nk]){ ingId=newByName[nk]; }
      else { ingId='ing_'+invoiceId+'_'+lineIndex; newByName[nk]=ingId; agg[ingId]={before:0,oldCost:0,stock:0,value:0,newItem:true,recipeItem:!isSupplyType(ln.newType)&&(ln.newType==='consumable'||ln.recipeItem!==false),name:(ln.newName||'').trim(),unit:ln.newUnit||'',type:ln.newType||'base',inventoryAccount:ln.newInventoryAccount||'',costAccount:ln.newCostAccount||''}; }
      agg[ingId].stock+=c.stockAdd; agg[ingId].value+=c.lineTotal; nm=(ln.newName||'').trim();
    } else {
      var inv=inventoryMap[ingId]||{}; nm=inv.name||'';
      if(!agg[ingId])agg[ingId]={before:Number(inv.stock)||0,oldCost:Number(inv.cost)||0,stock:0,value:0};
      agg[ingId].stock+=c.stockAdd; agg[ingId].value+=c.lineTotal;
    }
    var rid='rcpt_'+invoiceId+'_'+lineIndex; receiptIds.push(rid); invTotal+=c.lineTotal;
    var lineUnitCost=(c.stockAdd>0?Math.round((c.lineTotal/c.stockAdd)*100000)/100000:0);
    var selectedSku=inventorySkuMap[ln.skuId]&&inventorySkuMap[ln.skuId].masterId===ingId&&inventorySkuMap[ln.skuId].active!==false?inventorySkuMap[ln.skuId]:null;
    var skuId=selectedSku?ln.skuId:'', skuBrand=selectedSku?(selectedSku.brand||''):(ln.brand||'').trim();
    if(requestedNew&&!selectedSku&&skuBrand){selectedSku=activeSkusFor(ingId).filter(function(s){return uNorm(s.brand)===uNorm(skuBrand);})[0]||null;if(selectedSku)skuId=selectedSku.id;}
    var needsNewSku=requestedNew&&!isSupplyType(ln.newType)&&(ln.newType==='consumable'||ln.recipeItem!==false)&&!skuId;
    if(needsNewSku&&skuBrand){var skuKey=ingId+'::'+uNorm(skuBrand);skuId=newSkuByKey[skuKey]||('sku_'+invoiceId+'_'+lineIndex);newSkuByKey[skuKey]=skuId;updates['inventorySku/'+skuId]={masterId:ingId,brand:skuBrand,supplierId:P.supplierId,supplier:(P.supplier||'').trim(),purchaseUnit:c.recvUnit,packSize:null,purchaseCost:null,convToBase:1,costPerBase:lineUnitCost,active:true,priority:activeSkusFor(ingId).length,branchAvail:['main'],seededFrom:'purchase',createdAt:Date.now(),updatedAt:Date.now()};}
    if(requestedNew&&inventoryMap[ingId])seedUpdates['inventory/'+ingId+'/recipeItem']=!isSupplyType(ln.newType)&&(ln.newType==='consumable'||ln.recipeItem!==false);
    updates['stockReceipts/'+rid]={ing:ingId,skuId:skuId,skuBrand:skuBrand,name:nm,unit:c.stockUnit,qty:c.stockAdd,recvQty:c.qty,recvUnit:c.recvUnit,unitCost:lineUnitCost,total:c.lineTotal,supplierId:P.supplierId,supplier:(P.supplier||'').trim(),brand:skuBrand,ref:effectiveRef,date:date,receivedBy:(P.by||'').trim(),payMode:P.pay,invoiceId:invoiceId,ts:Date.now()};
    /* P2: a batch/lot per line for expiry + brand tracking (does NOT drive costing — WAC pool stays authoritative) */
    var bid='bat_'+invoiceId+'_'+lineIndex; updates['inventoryBatch/'+bid]={skuId:skuId,masterId:ingId,brand:skuBrand,supplierId:P.supplierId,supplier:(P.supplier||'').trim(),qtyRecv:c.stockAdd,qtyRemaining:c.stockAdd,unit:c.stockUnit,unitCost:lineUnitCost,recvDate:date,expiry:(ln.expiry||''),lot:(ln.lot||''),branch:'main',source:'purchase',invoiceId:invoiceId,receiptId:rid,createdAt:Date.now()};
    invoiceLines.push({receiptId:rid,itemId:ingId,itemName:nm,recipeItem:!isSupplyType(ln.newType)&&(recipeUsesInventory(ingId)||ln.newType==='consumable'||ln.recipeItem!==false),skuId:skuId,skuBrand:skuBrand,qty:c.stockAdd,unit:c.stockUnit,unitCost:lineUnitCost,total:c.lineTotal});
  });
  var movementRows=[];
  Object.keys(agg).forEach(function(id){ var g=agg[id];
    if(g.newItem){ var ni={name:g.name,unit:g.unit,type:g.type,recipeItem:g.recipeItem===true,inventoryAccount:g.inventoryAccount,costAccount:g.costAccount,stock:0,cost:0,reorder:0,updatedAt:Date.now()}; if(g.type==='consumable'){ni.serves='both';ni.size='';ni.qtyPerOrder=1;} seedUpdates['inventory/'+id]=ni; }
    movementRows.push({movementId:movementId('purchase',invoiceId,id),itemId:id,type:'purchase',qty:Math.round(g.stock*1000000)/1000000,unitCost:g.stock>0?Math.round((g.value/g.stock)*1000000)/1000000:0,sourceType:'purchase-invoice',sourceId:invoiceId,note:(P.supplier||'Supplier')+' · '+effectiveRef,actorName:(P.by||'').trim()||'Admin',occurredAt:Date.now()});
  });
  invTotal=Math.round(invTotal*100)/100;
  var inputVat=Math.max(0,Math.round((Number(P.inputVat)||0)*100)/100);if(inputVat>0){if(inputVat>=invTotal){window.__purchPosting=false;alert('Input VAT must be less than the line amounts. Enter the line costs net of VAT and the VAT shown on the supplier invoice.');return;}invTotal=Math.round((invTotal+inputVat)*100)/100;}
  if(P.pay==='paid'){var selectedCash=((window.__cf&&window.__cf.accounts&&window.__cf.accounts())||[]).find(function(x){return x.id===P.acct;});if(!selectedCash||selectedCash.disabled){window.__purchPosting=false;alert('Choose an available cash account. Register Cash Float cannot be used for purchases.');return;}if(invTotal>(Number(selectedCash.balance)||0)+0.009){window.__purchPosting=false;alert('Purchase total '+peso(invTotal)+' exceeds available '+selectedCash.name+' of '+peso(selectedCash.balance)+'. The protected cash float cannot cover the difference.');return;}}
  updates['purchaseInvoices/'+invoiceId]={supplierId:P.supplierId,supplier:(P.supplier||'').trim(),ref:effectiveRef,date:date,due:(P.pay==='account'?(P.due||''):''),by:(P.by||'').trim(),description:(P.description||'').trim(),payMode:P.pay,ownerName:(P.pay==='owner_funded'?(P.ownerName||'').trim():''),ownerTreatment:(P.pay==='owner_funded'?(P.ownerTreatment==='reimburse'?'reimburse':'capital'):''),accountId:(P.pay==='paid'?P.acct:''),purchaseAdvanceId:(P.pay==='advance'?P.advanceId:''),payableId:'',total:invTotal,inputVat:inputVat,lineCount:lines.length,expenseLineCount:invoiceLines.filter(function(x){return x.lineType==='expense';}).length,lines:invoiceLines,receiptIds:receiptIds,movementIds:movementRows.map(function(x){return x.movementId;}),ts:Date.now(),schemaVersion:2};
  /* New item shells must exist before the server can post their first movement. Movement IDs make retries safe. */
  a.manageSupplier({action:'validate',supplierId:P.supplierId,name:P.supplier}).then(function(){return Object.keys(seedUpdates).length?a.update(a.ref(a.db),seedUpdates):null;}).then(function(){return postMovements(movementRows);}).then(function(){return a.update(a.ref(a.db),updates);}).then(function(){
    if(P.pay==='paid'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+invoiceId,date:date,accountId:P.acct,amount:invTotal,party:(P.supplier||'').trim()||'Supplier',ref:effectiveRef,category:'Purchases',source:'purchase',linkId:invoiceId,note:lines.length+' item(s) received'});
    if(P.pay==='owner_funded'&&a.postFinancialCommand)return a.postFinancialCommand({action:'purchase_owner_funded',commandId:'purchase_owner_'+invoiceId,invoiceId:invoiceId,date:date,ownerName:(P.ownerName||'').trim(),ownerTreatment:P.ownerTreatment==='reimburse'?'reimburse':'capital'});
    if(P.pay==='advance'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+invoiceId,date:date,accountId:'',advanceId:P.advanceId,amount:invTotal,party:(P.supplier||'').trim()||'Supplier',ref:effectiveRef,category:'Purchases',source:'purchase',linkId:invoiceId,note:lines.length+' item(s) received from purchase cash advance'});
    if(P.pay==='account'||P.pay==='pending')return a.reconcilePurchasePayable({invoiceId:invoiceId,due:P.pay==='account'?(P.due||''):''});
    return null;
  }).then(function(){
    if(invoiceLines.some(function(x){return x.lineType==='fixed_asset';})){if(!a.manageFixedAsset)throw new Error('Fixed Asset registration service is unavailable. Refresh and retry this purchase.');return a.manageFixedAsset({action:'register_purchase',commandId:'fa_purchase_'+invoiceId,invoiceId:invoiceId});}
    return null;
  }).then(function(){
    if(window.__posLog)window.__posLog('purchase',(P.supplier||'Supplier'),lines.length+' line(s) · '+peso(invTotal)+(P.pay==='paid'?' · paid':P.pay==='owner_funded'?' · paid personally by '+(P.ownerName||'owner/partner')+' · '+(P.ownerTreatment==='reimburse'?'reimburse later':'capital contribution'):P.pay==='account'?' · on account':' · invoice pending'));
    window.__purchPosting=false; window.__purch=null; renderPurchases();
    var m=document.getElementById('purMsg'); if(m)m.textContent='✓ Posted '+lines.length+' purchase line(s), invoice total '+peso(invTotal)+' at '+new Date().toLocaleTimeString();
    alert('Purchase posted. Stock, expense, and fixed-asset treatments were linked to the same Finance Books entry. ✅');
  }).catch(function(e){ window.__purchPosting=false; alert('Purchase post FAILED: '+((e&&e.message)||e)+'. The same invoice is safe to retry; inventory movements cannot double-post.'); });
}
