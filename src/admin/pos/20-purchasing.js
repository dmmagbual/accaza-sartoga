  var accOpts='<option value="">\u2014 choose cash / bank / e-wallet \u2014</option>'+accs.map(function(x){return '<option value="'+esc(x.id)+'"'+(P.acct===x.id?' selected':'')+(x.disabled?' disabled':'')+'>'+esc(x.name)+' · '+peso(x.balance)+(x.disabled?' · unavailable for purchases':'')+'</option>';}).join('');
  var supplierOpts='<option value="">— select supplier —</option>'+purchaseSuppliers().map(function(x){return '<option value="'+esc(x.id)+'"'+(P.supplierId===x.id?' selected':'')+'>'+esc(x.name)+'</option>';}).join('');
  var invList=ings().slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});
  function itemOpts(sel){return '<option value="">— pick item —</option>'+invList.map(function(i){var required=recipeUsesInventory(i.id),n=activeSkusFor(i.id).length;return '<option value="'+esc(i.id)+'"'+(i.id===sel?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit||'')+') · '+ingType(i)+(required?(n?' · '+n+' approved brand'+(n===1?'':'s'):' · BRAND REQUIRED'):'')+'</option>';}).join('');}
  function unitOpts(list,sel){return list.map(function(u){return '<option'+(uNorm(u)===uNorm(sel)?' selected':'')+'>'+esc(u)+'</option>';}).join('');}
  var invTotal=0;
  var lineHtml=P.lines.map(function(ln,i){
    var c=purchCalc(ln);
    if(c)invTotal+=c.lineTotal;
    var firstCell,typeCell='',unitCell,skuCell='',brandCell='',expenseLine=ln.mode==='expense',assetLine=ln.mode==='asset',directLine=expenseLine||assetLine;
    if(assetLine){
      firstCell='<div style="flex:1;min-width:220px;"><span class="pz-lbl">Asset name</span><input class="pz-in" data-pf="assetName" data-pi="'+i+'" placeholder="e.g. Espresso grinder" value="'+esc(ln.assetName||'')+'"/></div>';
      typeCell='<div><span class="pz-lbl">Asset category</span><select class="pz-in" data-pf="assetCategory" data-pi="'+i+'"><option value="equipment"'+(ln.assetCategory!=='furniture'?' selected':'')+'>1500 · Equipment</option><option value="furniture"'+(ln.assetCategory==='furniture'?' selected':'')+'>1510 · Furniture &amp; Fixtures</option></select></div><div><span class="pz-lbl">Useful life</span><input class="pz-in" type="number" min="1" step="1" data-pf="assetLifeMonths" data-pi="'+i+'" value="'+esc(ln.assetLifeMonths||'')+'" style="width:90px"/><small class="tiny">months</small></div><div><span class="pz-lbl">Depreciation</span><select class="pz-in" data-pf="assetMethod" data-pi="'+i+'"><option value="straight-line">Straight-line</option></select></div><div><span class="pz-lbl">Salvage / unit</span><input class="pz-in" type="number" min="0" step=".01" data-pf="assetSalvage" data-pi="'+i+'" value="'+esc(ln.assetSalvage||'0')+'" style="width:105px"/></div><div><span class="pz-lbl">In service</span><input class="pz-in" type="date" data-pf="assetInServiceDate" data-pi="'+i+'" value="'+esc(ln.assetInServiceDate||P.date||'')+'"/></div><div><span class="pz-lbl">Location</span><input class="pz-in" data-pf="assetLocation" data-pi="'+i+'" value="'+esc(ln.assetLocation||'')+'" placeholder="Required" style="width:120px"/></div><div><span class="pz-lbl">Custodian</span><input class="pz-in" data-pf="assetCustodian" data-pi="'+i+'" value="'+esc(ln.assetCustodian||'')+'" placeholder="Required" style="width:120px"/></div>';
      unitCell='<span style="color:var(--tl);font-size:.82rem;">asset(s)</span>';
    } else if(expenseLine){
      firstCell='<div style="flex:1;min-width:220px;"><span class="pz-lbl">Expense description</span><input class="pz-in" data-pf="expenseDescription" data-pi="'+i+'" placeholder="e.g. printer ink used immediately" value="'+esc(ln.expenseDescription||'')+'"/></div>';
      typeCell='<div style="min-width:250px;"><span class="pz-lbl">Charge to Finance Books</span><select class="pz-in" data-pf="expenseAccount" data-pi="'+i+'"><option value="6075"'+(ln.expenseAccount!=='6070'?' selected':'')+'>6075 · Office &amp; Administrative Supplies</option><option value="6070"'+(ln.expenseAccount==='6070'?' selected':'')+'>6070 · Cleaning &amp; Operating Supplies</option></select></div>';
      unitCell='<span style="color:var(--tl);font-size:.82rem;">use</span>';
    } else if(ln.mode==='new'){
      var newRecipeItem=!isSupplyType(ln.newType)&&(ln.newType==='consumable'||ln.recipeItem!==false);
      firstCell='<div style="flex:1;min-width:160px;"><span class="pz-lbl">New item (generic name)</span><input class="pz-in" data-pf="newName" data-pi="'+i+'" placeholder="e.g. Condensed Milk" value="'+esc(ln.newName)+'"/></div>';
      typeCell='<div><span class="pz-lbl">Type</span><select class="pz-in" data-pf="newType" data-pi="'+i+'" style="width:180px;">'+inventoryTypeOptions(ln.newType)+'</select></div>'
        +'<label class="purchase-recipe-toggle"><input type="checkbox" data-pf="recipeItem" data-pi="'+i+'"'+(newRecipeItem?' checked':'')+((ln.newType==='consumable'||isSupplyType(ln.newType))?' disabled title="This item type controls recipe use automatically"':'')+'/> Used in recipes</label>';
      unitCell='<select class="pz-in" data-pf="newUnit" data-pi="'+i+'" style="width:74px;">'+unitOpts(PURCH_UNITS,ln.newUnit)+'</select>';
      skuCell='<div class="purchase-sku-cell '+(newRecipeItem?'required':'optional')+'"><span class="pz-lbl">First approved brand '+(newRecipeItem?'<b>required</b>':'(optional)')+'</span><input class="pz-in" data-pf="brand" data-pi="'+i+'" value="'+esc(ln.brand)+'" placeholder="e.g. Dabba"/></div>';
    } else {
      var inv=inventoryMap[ln.ing]||{};
      firstCell='<div style="flex:1;min-width:170px;"><span class="pz-lbl">Item</span><select class="pz-in" data-pf="ing" data-pi="'+i+'">'+itemOpts(ln.ing)+'</select></div>';
      var cu=ln.ing?compatUnits(inv):[inv.unit||''];
      unitCell=ln.ing?('<select class="pz-in" data-pf="recvUnit" data-pi="'+i+'" style="width:74px;">'+unitOpts(cu,ln.recvUnit||inv.unit)+'</select>'):'<span style="color:var(--tl);font-size:0.85rem;">—</span>';
      var required=ln.ing&&recipeUsesInventory(ln.ing), skus=ln.ing?activeSkusFor(ln.ing):[];
      if(ln.skuId&&!skus.some(function(s){return s.id===ln.skuId;}))ln.skuId='';
      if(required&&!ln.skuId&&skus.length===1)ln.skuId=skus[0].id;
      var selectedSku=ln.skuId&&inventorySkuMap[ln.skuId];
      var skuOpts='<option value="">'+(required?'— select required brand —':'— no approved brand / legacy receipt —')+'</option>'+skus.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===ln.skuId?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('');
      skuCell='<div class="purchase-sku-cell '+(required?'required':'optional')+'"><span class="pz-lbl">Approved brand '+(required?'<b>required</b>':'(optional)')+'</span><select class="pz-in" data-pf="skuId" data-pi="'+i+'"'+(!ln.ing?' disabled':'')+'>'+skuOpts+'</select>'+(ln.ing?'<button type="button" class="purchase-add-sku" data-pmanage-sku="'+esc(ln.ing)+'" data-pmanage-line="'+i+'">'+(skus.length?'+ Add another brand':'Add an approved brand')+'</button>':'')+'</div>';
      brandCell=selectedSku?'<div><span class="pz-lbl">Selected brand</span><div class="purchase-sku-brand">'+esc(selectedSku.brand||'—')+'</div></div>':'<div><span class="pz-lbl">Legacy brand note</span><input class="pz-in" data-pf="brand" data-pi="'+i+'" value="'+esc(ln.brand)+'" placeholder="optional" style="width:110px;"/></div>';
    }
    var costInput=(ln.costMode==='total'
      ?'<input class="pz-in" type="number" step="any" data-pf="lineTotal" data-pi="'+i+'" value="'+(ln.lineTotal!==''&&ln.lineTotal!=null?ln.lineTotal:'')+'" placeholder="line ₱" style="width:88px;text-align:right;"/>'
      :'<input class="pz-in" type="number" step="any" data-pf="unitCost" data-pi="'+i+'" value="'+(ln.unitCost!==''&&ln.unitCost!=null?ln.unitCost:'')+'" placeholder="₱ / unit" style="width:88px;text-align:right;"/>');
    var prev=c?(assetLine?('Fixed asset · '+peso(c.lineTotal)+' · '+num(Number(ln.qty)||0)+' card(s) created after posting'):expenseLine?('Expense · '+peso(c.lineTotal)+' · no inventory created'):('+'+num(c.stockAdd)+' '+esc(c.stockUnit)+' · new avg '+peso(c.newCost)+'/'+esc(c.stockUnit)+' · line '+peso(c.lineTotal))):'';
    return '<div class="purchase-line">'
      +'<div class="purchase-line-head"><div class="purchase-line-title"><span class="purchase-line-number">'+(i+1)+'</span><span>'+(assetLine?'Equipment / fixed asset':expenseLine?'One-time expense':'Stock item')+'</span></div><div class="purchase-line-mode">'
        +'<label style="cursor:pointer;margin-right:0.6rem;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="existing"'+(ln.mode==='existing'?' checked':'')+'/> existing item</label>'
        +'<label style="cursor:pointer;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="new"'+(ln.mode==='new'?' checked':'')+'/> ＋ new item</label>'
        +'<label style="cursor:pointer;margin-left:.6rem;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="expense"'+(expenseLine?' checked':'')+'/> one-time expense</label>'
        +'<label style="cursor:pointer;margin-left:.6rem;"><input type="radio" name="pmode'+i+'" data-pf="mode" data-pi="'+i+'" value="asset"'+(assetLine?' checked':'')+'/> equipment / asset</label>'
      +'</div><button class="purchase-line-remove" data-prem="'+i+'" title="Remove this line" aria-label="Remove stock item '+(i+1)+'">✕</button></div>'
      +'<div class="purchase-line-fields">'
        +firstCell
        +typeCell
        +(directLine?'':skuCell)
        +(directLine||ln.mode==='new'?'':brandCell)
        +'<div><span class="pz-lbl">Qty</span><input class="pz-in" type="number" step="any" data-pf="qty" data-pi="'+i+'" value="'+(ln.qty!==''&&ln.qty!=null?ln.qty:'')+'" placeholder="0" style="width:78px;text-align:right;"/></div>'
        +'<div><span class="pz-lbl">Unit</span>'+unitCell+'</div>'
        +'<div><span class="pz-lbl">Cost</span><div style="display:flex;gap:0.25rem;"><select class="pz-in" data-pf="costMode" data-pi="'+i+'" style="width:84px;font-size:0.72rem;"><option value="unit"'+(ln.costMode!=='total'?' selected':'')+'>₱/unit</option><option value="total"'+(ln.costMode==='total'?' selected':'')+'>total ₱</option></select>'+costInput+'</div></div>'
        +(directLine?'':'<div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" type="date" data-pf="expiry" data-pi="'+i+'" value="'+esc(ln.expiry||'')+'" style="width:140px;"/></div><div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" data-pf="lot" data-pi="'+i+'" value="'+esc(ln.lot||'')+'" placeholder="batch/lot" style="width:100px;"/></div>')
      +'</div>'
      +'<div class="purchase-line-preview" data-pprev="'+i+'">'+prev+'</div>'
      +'</div>';
  }).join('');
  var payBlock='<div class="purchase-section purchase-payment"><div class="purchase-section-head"><span class="purchase-step">2</span><div><b>Payment</b><small>Choose how this whole invoice will be settled.</small></div></div>'
    +'<div class="purchase-payment-options">'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="pending"'+(P.pay==='pending'||P.pay==='none'?' checked':'')+'/><span><b>Invoice pending — provisional obligation</b><small>Record the delivery now and complete the obligation later.</small></span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="paid"'+(P.pay==='paid'?' checked':'')+(payAccs.length?'':' disabled')+'/><span><b>Paid now</b><small>'+(payAccs.length?'Cash on Hand excludes the protected Register Cash Float. Undeposited Collection posts a controlled disbursement; Cash Float is view-only.':'No available Balance Sheet cash account.')+'</small>'+(payAccs.length&&P.pay==='paid'?('<select class="pz-in" id="purAcct">'+accOpts+'</select>'):'')+'</span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="owner_funded"'+(P.pay==='owner_funded'?' checked':'')+'/><span><b>PAID PERSONALLY BY OWNER/PARTNER</b><small>No business cash movement.</small>'+(P.pay==='owner_funded'?'<input class="pz-in" id="purOwnerName" value="'+esc(P.ownerName||'')+'" placeholder="Owner / partner name"/><select class="pz-in" id="purOwnerTreatment"><option value="capital"'+(P.ownerTreatment!=='reimburse'?' selected':'')+'>Capital contribution</option><option value="reimburse"'+(P.ownerTreatment==='reimburse'?' selected':'')+'>Reimburse later</option></select>':'')+'</span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="advance"'+(P.pay==='advance'?' checked':'')+(advances.length?'':' disabled')+'/><span><b>Apply supplier advance payment</b><small>'+(advances.length?'Only approved, unallocated payments for this supplier are shown. This clears the advance asset and allocates the delivered items without paying twice.':(P.supplier?'No approved advance remains for this supplier.':'Enter the supplier first to find its approved advances.'))+'</small>'+(advances.length&&P.pay==='advance'?('<select class="pz-in" id="purAdvance">'+advanceOpts+'</select>'):'')+'<button type="button" class="pz-btn sec" id="purCreateAdvance" style="margin-top:.45rem;">Record a new supplier advance</button></span></label>'
      +'<label class="purchase-payment-option"><input type="radio" name="ppay" data-pf="pay" value="account"'+(P.pay==='account'?' checked':'')+'/><span><b>On account</b><small>Create a payable with this due date.</small>'+(P.pay==='account'?'<input class="pz-in" id="purDue" type="date" value="'+esc(P.due||'')+'"/>':'')+'</span></label>'
    +'</div></div>';
  root.innerHTML='<div class="purchase-page-head"><div><div class="pz-h">Purchases <span>Goods received</span></div><p class="pz-sub">Record a supplier delivery and update stock in one clear receiving sheet.</p></div><div class="purchase-head-note">Approved brands keep receipts accurate while stock and costing stay pooled under the common item.</div></div>'
    +'<div class="pz-card purchase-sheet"><div class="purchase-sheet-banner"><div><span class="purchase-eyebrow">New delivery</span><h3>Supplier invoice</h3></div><span class="purchase-draft-status">Draft · not yet received</span></div>'
    +'<div class="purchase-section"><div class="purchase-section-head"><span class="purchase-step">1</span><div><b>Delivery details</b><small>Identify who supplied the stock and when it arrived.</small></div></div><div class="purchase-details-grid">'
      +'<div><span class="pz-lbl">Supplier</span><div style="display:flex;gap:.35rem;"><select class="pz-in" id="purSupplier">'+supplierOpts+'</select><button type="button" class="pz-btn sec" id="purNewSupplier">＋ New</button><button type="button" class="pz-btn sec" id="purSupplierList">Suppliers</button></div><small class="tiny">One shared supplier record is used by Purchases, Cash Payments, Payables and Finance Books.</small></div>'
      +'<div><span class="pz-lbl">Invoice / reference</span><input class="pz-in" id="purRef" value="'+esc(P.ref)+'" placeholder="Optional"/></div>'
      +'<div><span class="pz-lbl">Date</span><input class="pz-in" id="purDate" type="date" value="'+esc(P.date)+'"/></div>'
      +'<div><span class="pz-lbl">Received by</span><input class="pz-in" id="purBy" value="'+esc(P.by)+'" placeholder="Staff name"/></div>'
      +'<div style="grid-column:1/-1;"><span class="pz-lbl">Description / notes</span><input class="pz-in" id="purDescription" value="'+esc(P.description||'')+'" placeholder="Optional non-financial description"/></div>'
    +'</div></div>'+payBlock
    +'<div class="purchase-section purchase-items"><div class="purchase-section-head"><span class="purchase-step">3</span><div><b>Items purchased</b><small>Add stock, immediate expenses, or equipment. Equipment creates linked fixed-asset cards after the purchase posts.</small></div><button class="pz-btn sec purchase-add-line" id="purAddLine">＋ Add item</button></div><div class="purchase-lines">'+lineHtml+'</div></div>'
    +'<div class="purchase-sheet-footer"><div class="purchase-total"><span>Invoice total</span><strong id="purTotal">'+peso(invTotal)+'</strong><small>'+P.lines.length+' item line'+(P.lines.length===1?'':'s')+'</small></div><div class="purchase-primary-actions"><button class="pz-btn sec" id="purReset">Clear draft</button><button class="pz-btn ok" id="purPost">Receive stock</button></div></div>'
    +'<div id="purMsg" class="purchase-message"></div><details class="purchase-record-tools"><summary>Purchase corrections and repair tools</summary><div><button class="pz-btn sec" id="purCorrectDetails">Correct purchase details</button><button class="pz-btn warn" id="purReversePurchase">Reverse &amp; re-enter</button><button class="pz-btn sec" id="purRepairPayable">Repair missing payable</button></div></details></div>'+purchaseHistoryHtml()+purchaseAdvanceRegisterHtml();
  function hb(id,f){var el=document.getElementById(id);if(el)el.oninput=function(){P[f]=el.value;};}
  hb('purRef','ref');hb('purDate','date');hb('purBy','by');hb('purDescription','description');
  var ps=document.getElementById('purSupplier');if(ps)ps.onchange=function(){var row=purchaseSupplierById(ps.value);P.supplierId=row?row.id:'';P.supplier=row?row.name:'';P.advanceId='';renderPurchases();};
  var pns=document.getElementById('purNewSupplier');if(pns)pns.onclick=function(){createPurchaseSupplier('').then(function(x){supplierMap[x.supplierId]=Object.assign({},supplierMap[x.supplierId]||{},{name:x.name,active:true});P.supplierId=x.supplierId;P.supplier=x.name;renderPurchases();}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not create supplier: '+((e&&e.message)||e));});};
  var psl=document.getElementById('purSupplierList');if(psl)psl.onclick=function(){showSupplierList();};
  var pca=document.getElementById('purCreateAdvance');if(pca)pca.onclick=function(e){e.preventDefault();var supplier=(P.supplier||'').trim();if(!supplier){alert('Enter the supplier first so the advance stays tied to the correct supplier.');return;}var tab=Array.prototype.find.call(document.querySelectorAll('.admin-tab'),function(x){return String(x.getAttribute('onclick')||'').indexOf("'petty'")>=0;});if(!tab){alert('Cash Payments is unavailable. Refresh the portal.');return;}posSwitchTab('petty',tab);setTimeout(function(){var type=document.getElementById('pvType'),payee=document.getElementById('pvRequester'),purpose=document.getElementById('pvPurpose');if(type){type.value='purchase_advance';type.dispatchEvent(new Event('change'));}if(payee)payee.value=supplier;if(purpose&&!purpose.value)purpose.value='Advance payment to '+supplier;},0);};
  var da=document.getElementById('purAcct');if(da)da.onchange=function(){P.acct=da.value;};
  var pa=document.getElementById('purAdvance');if(pa){if(!P.advanceId)P.advanceId=pa.value;pa.onchange=function(){P.advanceId=pa.value;};}
  var du=document.getElementById('purDue');if(du)du.oninput=function(){P.due=du.value;};
  var pon=document.getElementById('purOwnerName');if(pon)pon.oninput=function(){P.ownerName=pon.value;};var pot=document.getElementById('purOwnerTreatment');if(pot)pot.onchange=function(){P.ownerTreatment=pot.value;};
  root.querySelectorAll('input[name=ppay]').forEach(function(r){r.onchange=function(){P.pay=r.value;if(P.pay!=='paid')P.acct='';if(P.pay!=='advance')P.advanceId='';if(P.pay!=='account')P.due='';renderPurchases();};});
  root.querySelectorAll('[data-pf]').forEach(function(el){
    var f=el.getAttribute('data-pf'); if(el.getAttribute('data-pi')==null)return; var i=Number(el.getAttribute('data-pi'));
    if(el.tagName==='SELECT'||el.type==='radio'||el.type==='checkbox'){
      el.onchange=function(){ P.lines[i][f]=(el.type==='checkbox'?el.checked:el.value); if(f==='ing'){var inv2=inventoryMap[el.value]||{};P.lines[i].recvUnit=inv2.unit||'';P.lines[i].skuId='';} if(f==='newUnit'){P.lines[i].recvUnit=el.value;} if(f==='mode'){P.lines[i].recvUnit='';P.lines[i].skuId='';} renderPurchases(); };
    } else if(f==='qty'||f==='unitCost'||f==='lineTotal'){
      el.oninput=function(){P.lines[i][f]=el.value;purchUpdatePrev();};
    } else {
      el.oninput=function(){P.lines[i][f]=el.value;};
    }
  });
  root.querySelectorAll('[data-prem]').forEach(function(b){b.onclick=function(){var i=Number(b.getAttribute('data-prem'));P.lines.splice(i,1);if(!P.lines.length)P.lines.push(purchBlank());renderPurchases();};});
  root.querySelectorAll('[data-pmanage-sku]').forEach(function(b){b.onclick=function(){var lineIndex=Number(b.getAttribute('data-pmanage-line')),masterId=b.getAttribute('data-pmanage-sku');openSkuManager(masterId,function(sid,sku){if(!P.lines[lineIndex]||P.lines[lineIndex].ing!==masterId)return;P.lines[lineIndex].skuId=sid;renderPurchases();(window.accazaToast||function(){})((sku.brand||'Brand')+' selected for this purchase','ok');});};});
  var al=document.getElementById('purAddLine');if(al)al.onclick=function(){P.lines.push(purchBlank());renderPurchases();};
  var rs=document.getElementById('purReset');if(rs)rs.onclick=function(){if(confirm('Clear this purchase entry?')){window.__purch=null;renderPurchases();}};
  var pc=document.getElementById('purCorrectDetails');if(pc)pc.onclick=function(){purchaseLookup('Correct purchase details').then(function(inv){return F().run({title:'Correct non-financial purchase details',subtitle:(inv.supplier||'Supplier')+' · '+peso(inv.total)+'. Amounts, items, quantities, costs and purchase date cannot be changed here. Use Edit details in Purchase history to correct the accounting date.',submitLabel:'Save correction',busyLabel:'Saving correction…',fields:[{name:'supplier',label:'Supplier',required:true,value:inv.supplier||'',maxLength:120},{name:'ref',label:'Invoice / reference',required:true,value:inv.ref||'',maxLength:120},{name:'due',label:'Due date',type:'date',value:inv.due||''},{name:'by',label:'Received by',value:inv.by||'',maxLength:120},{name:'description',label:'Description / notes',type:'textarea',value:inv.description||'',maxLength:240},{name:'reason',label:'Correction reason',type:'textarea',required:true,maxLength:300}]},function(v){return A().managePurchaseCorrection({action:'correct_details',invoiceId:inv.id,supplier:v.supplier,ref:v.ref,due:v.due,by:v.by,description:v.description,reason:v.reason});});}).then(function(){alert('Purchase details corrected. Inventory quantities, costs and financial amounts were not changed.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not correct purchase: '+((e&&e.message)||e));});};
  var prv=document.getElementById('purReversePurchase');if(prv)prv.onclick=function(){purchaseLookup('Reverse a purchase').then(function(inv){return F().run({title:'Reverse purchase and prepare corrected entry',subtitle:(inv.supplier||'Supplier')+' · '+peso(inv.total)+'. This reverses stock and the linked financial entry. A manager approval is required.',submitLabel:'Request approval & reverse',busyLabel:'Reversing purchase…',fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300},{name:'confirmed',label:'I understand the original purchase will remain in the audit trail as reversed',type:'checkbox',required:true}]},function(v){return A().managerApproval('reverse_purchase',inv.id,inv.total,v.reason).then(function(ap){return A().managePurchaseCorrection({action:'reverse',invoiceId:inv.id,reason:v.reason,approvalId:ap.approvalId});}).then(function(){return inv;});});}).then(function(inv){window.__purch=correctedPurchaseDraft(inv);renderPurchases();alert('Original purchase reversed. Review the prepared corrected entry, choose its payment details, then Receive all.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not reverse purchase: '+((e&&e.message)||e));});};
  var rp=document.getElementById('purRepairPayable');if(rp)rp.onclick=function(){var a=A();if(!a.reconcilePurchasePayable){alert('Purchase reconciliation service is not available. Refresh the portal.');return;}F().run({title:'Repair missing purchase payable',subtitle:'The server checks for an existing payable before creating or linking one.',submitLabel:'Check and repair',busyLabel:'Checking purchase and payable…',fields:[{name:'invoiceRef',label:'Purchase invoice / reference',required:true,value:P.ref||'',maxLength:120},{name:'due',label:'Due date',type:'date',required:true,value:P.due||''}]},function(v){return a.reconcilePurchasePayable({invoiceRef:v.invoiceRef,due:v.due,recovery:true});}).then(function(res){var d=(res&&res.data)||res||{};alert('Payable control completed: '+(d.result==='linked_existing'?'an existing payable was linked.':'the missing payable was created.')+' Amount '+peso(d.amount)+'.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0&&String((e&&e.message)||e).indexOf('cancelled')<0)alert('Could not repair payable: '+((e&&e.message)||e));});};
  var pp=document.getElementById('purPost');if(pp)pp.onclick=postPurchases;
  root.querySelectorAll('[data-purchase-details]').forEach(function(b){b.onclick=function(){showPurchaseDetails(b.getAttribute('data-purchase-details'));};});
  root.querySelectorAll('[data-purchase-edit]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-edit'),p=Object.assign({id:id},purchaseInvoicesMap[id]||{});if(p.reversed){alert('This purchase is already reversed.');return;}F().run({title:'Edit purchase details',subtitle:(p.supplier||'Supplier')+' is locked to its master record. Use Amend to reverse and re-enter if the wrong supplier or accounting date was selected.',submitLabel:'Save changes',busyLabel:'Saving…',fields:[{name:'ref',label:'Invoice / reference',required:true,value:p.ref||'',maxLength:120},{name:'due',label:'Due date',type:'date',value:p.due||''},{name:'by',label:'Received by',value:p.by||'',maxLength:120},{name:'description',label:'Description / notes',type:'textarea',value:p.description||'',maxLength:240},{name:'reason',label:'Reason for change',type:'textarea',required:true,maxLength:300}]},function(v){return A().managePurchaseCorrection({action:'correct_details',invoiceId:id,supplierId:p.supplierId,ref:v.ref,due:v.due,by:v.by,description:v.description,reason:v.reason});}).then(function(){alert('Purchase details updated. Supplier, amounts, stock, inventory valuation and Finance Books postings were unchanged.');renderPurchases();}).catch(function(e){var s=String((e&&e.message)||(e&&e.code)||e);if(s.indexOf('cancelled')<0)alert('Could not edit purchase: '+s);});};});
  root.querySelectorAll('[data-purchase-amend]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-amend'),p=purchaseInvoicesMap[id]||{};if(p.reversed){alert('This purchase is already reversed.');return;}F().run({title:'Amend purchase',subtitle:(p.supplier||'Supplier')+' \u00b7 '+peso(p.total)+'. This reverses the original and prepares a corrected entry for you to review and Receive. The original stays in the audit trail as reversed.',submitLabel:'Reverse & prepare correction',busyLabel:'Reversing\u2026',fields:[{name:'reason',label:'Reason for amendment',type:'textarea',required:true,maxLength:300},{name:'confirmed',label:'I understand the original is reversed and I will Receive the corrected entry',type:'checkbox',required:true}]},function(v){return A().managePurchaseCorrection({action:'reverse',invoiceId:id,reason:v.reason,ownerAmend:true}).then(function(){return Object.assign({id:id},p);});}).then(function(inv){window.__purch=correctedPurchaseDraft(inv);renderPurchases();alert('Original reversed. A corrected entry is prepared above \u2014 check the items, amounts and payment details, then Receive all to post it.');}).catch(function(e){var s=String((e&&e.message)||(e&&e.code)||e);if(s.indexOf('cancelled')<0)alert('Could not amend: '+s);});};});
  root.querySelectorAll('[data-purchase-toggle-reversed]').forEach(function(b){b.onclick=function(){showReversedPurchases=!showReversedPurchases;renderPurchases();};});
  root.querySelectorAll('[data-purchase-finalize]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-finalize'),p=purchaseInvoicesMap[id]||{};F().run({title:'Finalize supplier invoice',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+'. This replaces GRNI with the formal payable; inventory is unchanged.',submitLabel:'Finalize invoice',busyLabel:'Finalizing…',fields:[{name:'invoiceRef',label:'Final invoice / reference',required:true,maxLength:120},{name:'due',label:'Due date',type:'date',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,invoiceRef:v.invoiceRef,due:v.due,finalize:true});}).then(function(){alert('Invoice finalized. The provisional obligation is now a normal supplier payable.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not finalize invoice: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-link]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-link'),p=purchaseInvoicesMap[id]||{};A().reconcilePurchasePayable({invoiceId:id,recovery:true,preview:true}).then(function(res){var d=(res&&res.data)||res||{},cs=d.candidates||[];if(!cs.length)throw new Error('No open payable has the same supplier and amount. Use Repair payable only after confirming no payable exists.');if(cs.length>1)throw new Error('More than one matching payable was found. Management must review the payable references before linking.');var ap=cs[0];return F().run({title:'Link existing payable',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+' will link to payable '+(ap.ref||ap.id)+'. No new payable or inventory entry will be created.',submitLabel:'Link records',busyLabel:'Linking…',fields:[{name:'reason',label:'Linking reason',type:'textarea',required:true,maxLength:300,value:'Existing payable belongs to this purchase'},{name:'confirmed',label:'I verified the supplier and amount match',type:'checkbox',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,recovery:true,linkPayableId:ap.id,reason:v.reason});});}).then(function(){alert('Existing payable linked. The purchase remains in the audit trail and now shows On account.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not link payable: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-repair]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-repair'),p=purchaseInvoicesMap[id]||{};F().run({title:'Repair missing payable',subtitle:(p.supplier||'Supplier')+' · '+peso(p.total)+'. The server first checks for an existing linked or matching payable.',submitLabel:'Check and repair',busyLabel:'Checking…',fields:[{name:'due',label:'Due date',type:'date',required:true,value:p.due||''},{name:'confirmed',label:'I confirmed this purchase has no payable in the Payables list',type:'checkbox',required:true}]},function(v){return A().reconcilePurchasePayable({invoiceId:id,due:v.due,recovery:true});}).then(function(res){var d=(res&&res.data)||res||{};alert(d.result==='linked_existing'?'An existing payable was linked.':'One payable was created and linked to this purchase.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not repair payable: '+((e&&e.message)||e));});};});
  root.querySelectorAll('[data-purchase-duplicate]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-purchase-duplicate'),p=purchaseInvoicesMap[id]||{},matches=Object.keys(purchaseInvoicesMap).filter(function(k){var x=purchaseInvoicesMap[k]||{};return k!==id&&!x.reversed&&String(x.ref||'').toLowerCase()===String(p.ref||'').toLowerCase()&&String(x.supplier||'').toLowerCase()===String(p.supplier||'').toLowerCase()&&Math.round(Number(x.total||0)*100)===Math.round(Number(p.total||0)*100);});if(matches.length!==1){alert('A single matching purchase could not be identified. Open Details and ask management to review the purchase IDs.');return;}var keepId=matches[0],keep=purchaseInvoicesMap[keepId]||{};F().run({title:'Reverse duplicate purchase',subtitle:'Reverse purchase '+id+' and keep '+keepId+'. The selected duplicate inventory will be removed; a shared payable will remain with the kept record or be detached if already reversed.',submitLabel:'Request approval & reverse',busyLabel:'Reversing…',fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300,value:'Duplicate purchase entry'},{name:'confirmed',label:'I reviewed Details and confirmed this record is the duplicate; the other matching record must remain',type:'checkbox',required:true}]},function(v){return A().managerApproval('reverse_purchase',id,p.total,v.reason).then(function(ap){return A().managePurchaseCorrection({action:'reverse',invoiceId:id,keepInvoiceId:keepId,duplicate:true,reason:v.reason,approvalId:ap.approvalId});});}).then(function(){alert('Duplicate purchase reversed. The kept purchase remains. If its shared payable had already been reversed, use Repair payable on the kept row.');}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not reverse duplicate: '+((e&&e.message)||e));});};});
}
if(!window.__purchaseCashBalanceListener){window.__purchaseCashBalanceListener=true;window.addEventListener('accaza:cash-balances-updated',function(){if(document.getElementById('tab-purchases')&&document.getElementById('tab-purchases').style.display!=='none')renderPurchases();});}
function purchUpdatePrev(){
  var P=window.__purch; if(!P)return; var tot=0;
  P.lines.forEach(function(ln,i){var c=purchCalc(ln);if(c)tot+=c.lineTotal;var el=document.querySelector('[data-pprev="'+i+'"]');if(el)el.textContent=c?('+'+num(c.stockAdd)+' '+c.stockUnit+' · new avg '+peso(c.newCost)+'/'+c.stockUnit+' · line '+peso(c.lineTotal)):'';});
  var t=document.getElementById('purTotal');if(t)t.textContent=peso(Math.round(tot*100)/100);
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
    var line=lines[i],c0=purchCalc(line);if(line.mode==='asset'){var aq=Number(line.qty)||0,unitAssetCost=c0&&aq>0?c0.lineTotal/aq:0;if(!Number.isInteger(aq)||aq<1||aq>100){alert('Equipment quantity must be a whole number from 1 to 100.');return;}if(!c0||!(c0.lineTotal>0)){alert('Equipment needs a cost greater than zero.');return;}if(!(Number(line.assetLifeMonths)>=1)){alert('Enter the equipment useful life in months.');return;}if((Number(line.assetSalvage)||0)<0||(Number(line.assetSalvage)||0)>=unitAssetCost){alert('Salvage value per asset must be zero or less than its unit cost.');return;}if(!(line.assetInServiceDate||P.date)){alert('Enter the in-service date.');return;}if(!(line.assetLocation||'').trim()||!(line.assetCustodian||'').trim()){alert('Enter the equipment location and custodian.');return;}continue;}if(line.mode==='expense'){if(!['6070','6075'].includes(line.expenseAccount)){alert('Choose Office Supplies or Operating Supplies for every one-time expense.');return;}if(!c0||!(c0.lineTotal>0)){alert('A one-time expense needs a quantity and cost greater than zero.');return;}continue;}if(!c0||!(c0.stockAdd>0)){alert('A stock line has an invalid quantity/unit — check the measures.');return;}
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
  if(P.pay==='paid'){var selectedCash=((window.__cf&&window.__cf.accounts&&window.__cf.accounts())||[]).find(function(x){return x.id===P.acct;});if(!selectedCash||selectedCash.disabled){window.__purchPosting=false;alert('Choose an available cash account. Register Cash Float cannot be used for purchases.');return;}if(invTotal>(Number(selectedCash.balance)||0)+0.009){window.__purchPosting=false;alert('Purchase total '+peso(invTotal)+' exceeds available '+selectedCash.name+' of '+peso(selectedCash.balance)+'. The protected cash float cannot cover the difference.');return;}}
  updates['purchaseInvoices/'+invoiceId]={supplierId:P.supplierId,supplier:(P.supplier||'').trim(),ref:effectiveRef,date:date,due:(P.pay==='account'?(P.due||''):''),by:(P.by||'').trim(),description:(P.description||'').trim(),payMode:P.pay,ownerName:(P.pay==='owner_funded'?(P.ownerName||'').trim():''),ownerTreatment:(P.pay==='owner_funded'?(P.ownerTreatment==='reimburse'?'reimburse':'capital'):''),accountId:(P.pay==='paid'?P.acct:''),purchaseAdvanceId:(P.pay==='advance'?P.advanceId:''),payableId:'',total:invTotal,lineCount:lines.length,expenseLineCount:invoiceLines.filter(function(x){return x.lineType==='expense';}).length,lines:invoiceLines,receiptIds:receiptIds,movementIds:movementRows.map(function(x){return x.movementId;}),ts:Date.now(),schemaVersion:2};
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
function editIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  var ty=ingType(i), manualStd=stdCostMethod()==='manual';
  var units=['g','kg','ml','L','fl oz','pcs','shot','pump','ea','box','pack'];
  var eCats=invCats();
  var uOpts=(units.indexOf(i.unit||'')<0&&(i.unit||'')?'<option selected>'+esc(i.unit)+'</option>':'')+units.map(function(u){return '<option'+(u===(i.unit||'')?' selected':'')+'>'+u+'</option>';}).join('');
  var mask=document.createElement('div');mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<style>.ei-dialog{background:#fff;border-radius:14px;max-width:720px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 22px 60px rgba(20,35,27,.28);border:1px solid #d9cbb9}.ei-head{padding:1.15rem 1.3rem 1rem;border-bottom:1px solid #e7ddd0;background:#fbfaf7}.ei-eyebrow{font-size:.67rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#8b6746}.ei-title{font-size:1.18rem;font-weight:750;color:var(--bd);margin:.15rem 0 0}.ei-body{padding:1rem 1.3rem 1.2rem}.ei-section{border:1px solid #e3d8ca;border-radius:10px;padding:.85rem;margin-bottom:.75rem;background:#fff}.ei-section-title{font-size:.73rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5f4b3d;margin-bottom:.65rem}.ei-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem}.ei-wide{grid-column:1/-1}.ei-readout{border:1px solid #d9cbb9;border-radius:8px;padding:.65rem .75rem;background:#f7f4ee}.ei-readout strong{display:block;font-size:1.02rem;color:var(--bd);margin-top:.15rem}.ei-help{font-size:.72rem;line-height:1.42;color:var(--tl);margin-top:.3rem}.ei-actions{display:flex;justify-content:flex-end;gap:.55rem;padding-top:.25rem}.ei-close{border:0;background:transparent;color:#725d4b;font-size:1.15rem;cursor:pointer;padding:.25rem .4rem}.ei-close:focus-visible,.ei-dialog input:focus-visible,.ei-dialog select:focus-visible,.ei-dialog button:focus-visible{outline:3px solid rgba(38,115,84,.24);outline-offset:2px}@media(max-width:580px){.ei-grid{grid-template-columns:1fr}.ei-wide{grid-column:auto}.ei-body,.ei-head{padding-left:.9rem;padding-right:.9rem}}</style>'
    +'<div class="ei-dialog" role="dialog" aria-modal="true" aria-labelledby="eiTitle">'
      +'<div class="ei-head"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;"><div><div class="ei-eyebrow">Stock item master</div><h2 class="ei-title" id="eiTitle">Edit '+esc(i.name)+'</h2></div><button class="ei-close" id="eiClose" aria-label="Close">✕</button></div><p class="pz-sub" style="margin:.4rem 0 0;">Maintain the item definition here. Inventory balances and actual costs remain controlled by the stock ledger.</p></div>'
      +'<div class="ei-body">'
        +'<section class="ei-section"><div class="ei-section-title">Item details</div><div class="ei-grid">'
          +'<label class="ei-wide"><span class="pz-lbl">Item name</span><input class="pz-in" id="eiName" value="'+esc(i.name||'')+'"/></label>'
          +'<label><span class="pz-lbl">Type</span><select class="pz-in" id="eiType">'+inventoryTypeOptions(ty)+'</select></label>'
          +'<label><span class="pz-lbl">Category</span><select class="pz-in" id="eiCat"><option value="">Uncategorized</option>'+eCats.map(function(c){return '<option value="'+esc(c.id)+'"'+((i.category||'')===c.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'
          +'<label><span class="pz-lbl">Inventory unit'+(i.ledgerVersion?' · locked':'')+'</span><select class="pz-in" id="eiUnit"'+(i.ledgerVersion?' disabled title="The unit is locked after ledger initialization"':'')+'>'+uOpts+'</select><div class="ei-help">'+(i.ledgerVersion?'Locked to protect the movement history.':'The base unit used by purchases, recipes, and stock cards.')+'</div></label>'
          +'<label><span class="pz-lbl">Reorder point</span><input class="pz-in" id="eiReorder" type="number" min="0" step="any" value="'+(Number(i.reorder)||0)+'"/><div class="ei-help">Low-stock warning begins at this balance.</div></label>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Accounting assignment</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Inventory asset account</span><select class="pz-in" id="eiAssetAccount">'+itemAccountOptions(invItemAccounts(i).inventoryAccount,'inventory')+'</select><div class="ei-help">Where this individual item’s on-hand value appears in Books.</div></label>'
          +'<label><span class="pz-lbl">Cost / COGS account</span><select class="pz-in" id="eiCostAccount">'+itemAccountOptions(invItemAccounts(i).costAccount,'cost')+'</select><div class="ei-help">Recipe items use COGS; cleaning and office stock may use an overhead expense.</div></label>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Inventory control</div><div class="ei-grid">'
          +'<div class="ei-readout"><span class="pz-lbl">Current balance</span><strong>'+num(Number(i.stock)||0)+' '+esc(i.unit||'')+'</strong><div class="ei-help">Calculated from posted inventory movements.</div></div>'
          +'<div class="ei-readout"><span class="pz-lbl">Actual cost · weighted average</span><strong>'+peso(Number(i.cost)||0)+' / '+esc(i.unit||'unit')+'</strong><div class="ei-help">Calculated automatically from received purchases and used by actual COGS.</div></div>'
          +'<div class="ei-wide" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding-top:.05rem;"><div class="ei-help" style="margin:0;max-width:430px;">Count corrections, wastage, and stock variances belong in the audited adjustment workflow.</div><button class="pz-btn sec" id="eiAdjust" type="button" style="white-space:nowrap;">Adjust stock</button></div>'
        +'</div></section>'
        +'<section class="ei-section"><div class="ei-section-title">Planning cost</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Standard cost per unit ₱</span><input class="pz-in" id="eiStd" type="number" min="0" step="any" value="'+(i.stdCost!=null&&i.stdCost!==''?i.stdCost:'')+'" placeholder="Uses actual WAC"'+(manualStd?'':' disabled')+'/><div class="ei-help">'+(manualStd?'Used for pricing and margin planning. Leave blank to fall back to actual WAC.':'Standard costing is set to Weighted-average, so it follows the actual WAC automatically.')+'</div></label>'
          +'<div class="ei-readout"><span class="pz-lbl">Costing method</span><strong>'+(manualStd?'Manual standard':'Weighted-average · automatic')+'</strong><div class="ei-help">Change this method from Standard Costing on the Stock Items page.</div></div>'
        +'</div></section>'
        +'<section class="ei-section" id="eiCons" style="display:'+(ty==='consumable'?'block':'none')+';"><div class="ei-section-title">Consumption rule</div><div class="ei-grid">'
          +'<label><span class="pz-lbl">Used for</span><select class="pz-in" id="eiServes"><option value="both"'+((i.serves||'both')==='both'?' selected':'')+'>Drinks and food</option><option value="drink"'+(i.serves==='drink'?' selected':'')+'>Drinks</option><option value="food"'+(i.serves==='food'?' selected':'')+'>Food</option></select></label>'
          +'<label><span class="pz-lbl">Applicable size</span><select class="pz-in" id="eiSize"><option value="">All sizes</option><option'+(i.size==='S'?' selected':'')+'>S</option><option'+(i.size==='M'?' selected':'')+'>M</option><option'+(i.size==='L'?' selected':'')+'>L</option></select></label>'
          +'<label><span class="pz-lbl">Quantity per order</span><input class="pz-in" id="eiQPO" type="number" min="0" step="any" value="'+(i.qtyPerOrder!=null?i.qtyPerOrder:1)+'"/></label>'
        +'</div></section>'
        +'<div class="ei-actions"><button class="pz-btn sec" id="eiCancel">Cancel</button><button class="pz-btn ok" id="eiSave">Save changes</button></div>'
      +'</div></div>';
  document.body.appendChild(mask);
  var keyClose;
  function close(){if(keyClose)document.removeEventListener('keydown',keyClose);if(mask.parentNode)document.body.removeChild(mask);}
  mask.querySelector('#eiType').onchange=function(){mask.querySelector('#eiCons').style.display=(this.value==='consumable')?'block':'none';};
  mask.querySelector('#eiClose').onclick=close;
  mask.querySelector('#eiCancel').onclick=close;
  mask.querySelector('#eiAdjust').onclick=function(){close();adjustStock(id);};
  mask.onclick=function(e){if(e.target===mask)close();};
  keyClose=function(e){if(e.key==='Escape')close();};document.addEventListener('keydown',keyClose);
  mask.querySelector('#eiSave').onclick=function(){
    var type=mask.querySelector('#eiType').value;
    var _stdRaw=(mask.querySelector('#eiStd')||{}).value;
    var inventoryAccount=mask.querySelector('#eiAssetAccount').value,costAccount=mask.querySelector('#eiCostAccount').value;if(!inventoryAccount||!costAccount){alert('Choose both the Inventory Asset and Cost account.');return;}
    var upd={name:(mask.querySelector('#eiName').value||'').trim()||i.name,unit:mask.querySelector('#eiUnit').value,type:type,recipeItem:isSupplyType(type)?false:(i.recipeItem===true),category:(mask.querySelector('#eiCat')||{}).value||'',inventoryAccount:inventoryAccount,costAccount:costAccount,cogsAccount:null,reorder:Number(mask.querySelector('#eiReorder').value)||0,updatedAt:Date.now()};
    if(manualStd)upd.stdCost=(_stdRaw===''||_stdRaw==null)?null:(Number(_stdRaw)||0);
    if(type==='consumable'){upd.recipeItem=true;upd.serves=mask.querySelector('#eiServes').value;upd.size=mask.querySelector('#eiSize').value;upd.qtyPerOrder=Number(mask.querySelector('#eiQPO').value)||1;}else if(isSupplyType(type)){upd.serves=null;upd.size=null;upd.qtyPerOrder=null;}
    A().update(A().ref(A().db,'inventory/'+id),upd).then(close).catch(function(e){alert('Could not save: '+((e&&e.message)||e)+'.');});
  };
  return;
}
/* Brand breakdown for a pooled generic item: shows each brand received + the
   weighted-average cost recipes actually use. On-hand is pooled (one figure). */
function brandBreakdown(id){
  var i=inventoryMap[id]; if(!i)return; var a=A();
  a.get(a.ref(a.db,'stockReceipts')).then(function(s){
    var all=s.val()||{}; var byBrand={}; var totQ=0,totV=0;
    Object.keys(all).forEach(function(k){var r=all[k]; if(!r||r.ing!==id)return; var b=(r.brand||'').trim()||'(no brand noted)'; if(!byBrand[b])byBrand[b]={qty:0,value:0,n:0,last:''}; byBrand[b].qty+=Number(r.qty)||0; byBrand[b].value+=Number(r.total)||0; byBrand[b].n++; totQ+=Number(r.qty)||0; totV+=Number(r.total)||0; var d=r.date||''; if(d>byBrand[b].last)byBrand[b].last=d;});
    var brands=Object.keys(byBrand).sort();
    var rows=brands.length?brands.map(function(b){var x=byBrand[b];var avg=x.qty>0?x.value/x.qty:0;return '<tr><td>'+esc(b)+'</td><td class="r">'+num(Math.round(x.qty*1000)/1000)+' '+esc(i.unit||'')+'</td><td class="r">'+peso(x.value)+'</td><td class="r">'+peso(Math.round(avg*100000)/100000)+'</td><td class="r" style="color:var(--tl);">'+x.n+'</td><td class="r" style="color:var(--tl);">'+esc(x.last||'')+'</td></tr>';}).join(''):'<tr><td colspan="6" style="color:var(--tl);padding:0.6rem;">No purchases recorded for this item yet. Receive stock via the Purchases tab and note the brand per line.</td></tr>';
    var histAvg=totQ>0?(totV/totQ):0;
    var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:620px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🏷 Brands — '+esc(i.name)+'</div><button class="pz-btn sec" id="bbClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Recipes reference <b>'+esc(i.name)+'</b> and cost at its <b>current weighted-average: '+peso(Number(i.cost)||0)+' / '+esc(i.unit||'')+'</b> · on hand (pooled) '+num(Number(i.stock)||0)+' '+esc(i.unit||'')+'.</p>'
      +'<table class="pz-tbl"><thead><tr><th>Brand</th><th class="r">Received</th><th class="r">Total ₱</th><th class="r">Avg ₱/unit</th><th class="r">Buys</th><th class="r">Last</th></tr></thead><tbody>'+rows+'</tbody></table>'
      +(brands.length?'<div style="text-align:right;font-size:0.8rem;color:var(--tl);margin-top:0.3rem;">Lifetime purchase avg across brands: <b>'+peso(Math.round(histAvg*100000)/100000)+' / '+esc(i.unit||'')+'</b></div>':'')
      +'<p class="pz-sub" style="margin-top:0.6rem;font-size:0.72rem;">This is purchase history <b>by brand</b>. On-hand stock is pooled into one figure — per-brand remaining isn’t tracked once pooled (that’s the trade-off of pooling). The recipe always uses the current weighted-average cost shown above.</p>'
      +'<div style="margin-top:0.8rem;"><button class="pz-btn sec" id="bbClose2">Close</button></div></div>';
    document.body.appendChild(mask);
    function close(){document.body.removeChild(mask);}
    var c1=mask.querySelector('#bbClose'); if(c1)c1.onclick=close; var c2=mask.querySelector('#bbClose2'); if(c2)c2.onclick=close;
    mask.addEventListener('click',function(e){if(e.target===mask)close();});
  }).catch(function(e){ alert('Could not load brand history: '+((e&&e.code)||e)+'. If PERMISSION_DENIED, log in with your admin email.'); });
}
/* Every place a recipe/option references an inventory id — for referential integrity. */
function ingredientRefs(id){
  var refs=[];
  menuList().forEach(function(it){ var rec=recipesMap[it.key]; if(!rec)return; var used=false;
    (rec.base||[]).forEach(function(b){if(b.ing===id)used=true;});
    if(rec.choiceAdd)Object.keys(rec.choiceAdd).forEach(function(g){Object.keys(rec.choiceAdd[g]||{}).forEach(function(lk){(((rec.choiceAdd[g]||{})[lk]||{}).ings||[]).forEach(function(r){if(r&&r.ing===id)used=true;});});});
    if(used)refs.push('Recipe: '+it.name);
  });
  var store=optCostStore();
  Object.keys(store).forEach(function(g){Object.keys(store[g]||{}).forEach(function(lk){var e=store[g][lk]||{};(e.ings||[]).forEach(function(r){if(r&&r.ing===id)refs.push('Shared option cost: '+(e.label||lk));});});});
  Object.keys(optRecipesMap||{}).forEach(function(lb){if((optRecipesMap[lb]||{}).ing===id)refs.push('Option (legacy): '+lb);});
  return refs;
}
function delIngredient(id){
  var i=inventoryMap[id]; if(!i)return;
  if(i.ledgerVersion){alert('Cannot delete "'+i.name+'" after ledger initialization. Its movement history must remain linked to a real item. Create a replacement item and stop using this one instead.');return;}
  var refs=ingredientRefs(id);
  if(refs.length){ alert('Cannot delete "'+i.name+'" — it is still used by '+refs.length+' recipe/option'+(refs.length===1?'':'s')+':\n\n'+refs.slice(0,25).join('\n')+(refs.length>25?'\n…and '+(refs.length-25)+' more':'')+'\n\nRemove it from these (or repoint them to the correct item) first. This keeps every recipe linked to a real inventory item.'); return; }
  if(!confirm('Delete "'+i.name+'"? It is not used by any recipe.'))return;
  var a=A();a.remove(a.ref(a.db,'inventory/'+id));
}
function openCatManager(){
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  function draw(){
    var cats=invCats();
    var rows=cats.map(function(c){return '<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;" data-catrow="'+esc(c.id)+'"><input class="pz-in" data-cf="name" value="'+esc(c.name)+'" style="flex:1;"/><select class="pz-in" data-cf="kind" style="width:190px;"><option value="cogs"'+(c.kind!=='overhead'?' selected':'')+'>Recipe / product</option><option value="overhead"'+(c.kind==='overhead'?' selected':'')+'>Overhead supply</option></select><button class="pz-btn warn" data-catdel="'+esc(c.id)+'" style="padding:0.2rem 0.5rem;">✕</button></div>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">🗂 Inventory categories</div><button class="pz-btn sec" id="cmClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">Categories are only organizational labels for filtering and usage treatment. Assign Inventory Asset and Cost accounts on each individual stock item.</p>'
      +'<div data-catrows>'+(rows||'<div style="color:var(--tl);font-size:0.8rem;">No categories yet.</div>')+'</div>'
      +'<div style="display:flex;gap:0.4rem;margin-top:0.5rem;"><input class="pz-in" id="cmNew" placeholder="new category name" style="flex:1;"/><select class="pz-in" id="cmNewKind" style="width:170px;"><option value="cogs">Product cost (COGS)</option><option value="overhead">Overhead</option></select><button class="pz-btn sec" id="cmAdd">+ Add</button></div>'
      +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cmSave">💾 Save</button><button class="pz-btn sec" id="cmClose2">Close</button></div></div>';
    var a=A();
    mask.querySelector('#cmAdd').onclick=function(){var nm=(mask.querySelector('#cmNew').value||'').trim();if(!nm){alert('Type a category name.');return;}var k=mask.querySelector('#cmNewKind').value;var o={};o[uid('cat_')]={name:nm,kind:k,order:invCats().length};a.update(a.ref(a.db,'posSettings/invCategories'),o);setTimeout(draw,250);};
    mask.querySelectorAll('[data-catdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-catdel');var used=ings().filter(function(x){return (x.category||'')===id;}).length;if(used&&!confirm(used+' item(s) use this category. Delete it anyway? Those items just lose the label.'))return;a.remove(a.ref(a.db,'posSettings/invCategories/'+id));setTimeout(draw,250);};});
    mask.querySelector('#cmSave').onclick=function(){var ups={};mask.querySelectorAll('[data-catrow]').forEach(function(r,ix){var id=r.getAttribute('data-catrow'),nm=(r.querySelector('[data-cf="name"]').value||'').trim(),k=r.querySelector('[data-cf="kind"]').value;if(nm)ups[id]={name:nm,kind:k,inventoryAccount:null,cogsAccount:null,order:ix};});a.update(a.ref(a.db,'posSettings/invCategories'),ups).then(function(){if(isTab('inventory'))renderInventory();alert('Categories saved. Accounting assignments remain on each stock item.');}).catch(function(e){alert('Could not save: '+((e&&e.code)||e));});};
    var c1=mask.querySelector('#cmClose'),c2=mask.querySelector('#cmClose2');function close(){document.body.removeChild(mask);}if(c1)c1.onclick=close;if(c2)c2.onclick=close;
  }
  document.body.appendChild(mask); draw();
}
/* One-click: relabel any item stocked in ambiguous "oz"/"ounce" to "fl oz" (fluid ounce = volume),
   so ml/L conversion works in recipes. Quantity is unchanged; only the unit label changes.
   Use only for liquids — a weight-ounce item should be set to g/kg instead. */
function migrateOzToFloz(){
  var items=ings().filter(function(i){var u=uNorm(i.unit);return u==='oz'||u==='ounce';});
  if(!items.length){alert('No items are using oz / ounce.');return;}
  if(!confirm('Convert '+items.length+' item(s) from oz/ounce to "fl oz" (fluid ounce)?\n\n'+items.map(function(i){return '• '+i.name;}).join('\n')+'\n\nThe stock number stays the same — this only makes the unit a proper volume so ml/L conversion works. Use this only if these are liquids.'))return;
  var a=A();
  items.forEach(function(i){ a.update(a.ref(a.db,'inventory/'+i.id),{unit:'fl oz',updatedAt:Date.now()}); });
  if(window.__posLog)window.__posLog('unit-migrate','oz → fl oz',items.length+' item(s)');
  alert('Converted '+items.length+' item(s) to fl oz. ✅ You can now enter ml/L in their recipes.');
}
function updateLowStockBadge(){
  var n=ings().filter(function(i){return Number(i.stock)<=Number(i.reorder||0);}).length;
  var b=document.getElementById('lowStockBadge'); if(!b)return;
  if(n>0){b.textContent=n;b.style.display='inline-block';}else{b.style.display='none';}
}

/* ══════════ RECIPES ══════════ */
