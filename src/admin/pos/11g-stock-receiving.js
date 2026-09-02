/* ══════════ RECEIVE STOCK (single item) ══════════
   A delivery of one item, received from the Inventory list without opening the full
   Purchases sheet. It does NOT post anything itself: it builds a one-line purchase
   draft and hands it to postPurchases(), the same function the Purchases workspace
   uses. That is deliberate — this dialog previously posted the stock movement first
   and then called payment/payable services that could never succeed from here
   (a stock-receipt id where the server expects a purchase invoice id, and an inventory
   payable type the server refuses outside Purchases), so a receipt raised stock and
   weighted-average cost with no liability, no receipt record and nothing in Books.
   Everything now goes through one path: one supplier master, one invoice, one set of
   guards, one Finance Books treatment, and the same safe-to-retry semantics. */
function receiveStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var recipeRequired=recipeUsesInventory(id), activeSkus=activeSkusFor(id);
  if(recipeRequired&&!activeSkus.length){alert('“'+i.name+'” is a recipe SKU with no active approved brand. Add a brand before receiving stock.');openSkuManager(id);return;}
  var before=Number(i.stock)||0, oldCost=Number(i.cost)||0, unit=i.unit||'';
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[],payAccs=accs.filter(function(x){return !x.disabled;});
  var accOpts='<option value="">— choose cash / bank / e-wallet —</option>'+accs.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.disabled?' disabled':'')+'>'+esc(x.name)+' · '+peso(x.balance)+(x.disabled?' · unavailable for purchases':'')+'</option>';}).join('');
  function supplierOptions(selected){return '<option value="">— select supplier —</option>'+purchaseSuppliers().map(function(x){return '<option value="'+esc(x.id)+'"'+(selected===x.id?' selected':'')+'>'+esc(x.name)+'</option>';}).join('');}
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Receive stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">On hand: <b>'+num(before)+' '+esc(unit)+'</b> · current cost '+peso(oldCost)+' / '+esc(unit||'unit')+'</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;"><div><span class="pz-lbl">Quantity received ('+esc(unit||'units')+')</span><input class="pz-in" id="rcQty" type="number" step="any" style="width:120px;"/></div><div><span class="pz-lbl">Unit cost ₱ (per '+esc(unit||'unit')+')</span><input class="pz-in" id="rcCost" type="number" step="any" value="'+(oldCost||'')+'" style="width:120px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div style="flex:1;min-width:190px;"><span class="pz-lbl">Supplier</span><div style="display:flex;gap:.3rem;"><select class="pz-in" id="rcSup">'+supplierOptions('')+'</select><button type="button" class="pz-btn sec" id="rcNewSup">＋</button></div></div><div><span class="pz-lbl">Invoice / ref</span><input class="pz-in" id="rcRef" style="width:130px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div><span class="pz-lbl">Date</span><input class="pz-in" id="rcDate" type="date" value="'+window.AccazaDate.key()+'"/></div><div style="flex:1;min-width:140px;"><span class="pz-lbl">Received by</span><input class="pz-in" id="rcBy" value="'+esc((window.__posShift&&window.__posShift.staff)||'Admin')+'"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div class="purchase-sku-cell '+(recipeRequired?'required':'optional')+'" style="flex:1;min-width:180px;"><span class="pz-lbl">Approved brand '+(recipeRequired?'<b>required</b>':'(optional)')+'</span><select class="pz-in" id="rcSku"><option value="">— '+(recipeRequired?'select brand':'no approved brand / legacy receipt')+' —</option>'+activeSkus.map(function(s,ix){return '<option value="'+esc(s.id)+'"'+(recipeRequired&&activeSkus.length===1&&ix===0?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('')+'</select></div><div style="flex:1;min-width:120px;"><span class="pz-lbl">Brand</span><input class="pz-in" id="rcBrand" placeholder="e.g. Arla"'+(recipeRequired?' readonly':'')+'/></div><div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" id="rcExpiry" type="date"/></div><div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" id="rcLot" style="width:90px;"/></div></div>'
    +'<div style="margin-top:0.6rem;border-top:1px solid var(--cd);padding-top:0.5rem;"><span class="pz-lbl">How was it paid?</span>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="pending" checked/> Invoice pending — records a provisional supplier obligation</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="paid"'+(payAccs.length?'':' disabled')+'/> Paid now'+(payAccs.length?'':' <span style="color:var(--tl);">(no available Balance Sheet cash account)</span>')+'</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="account"/> On account — creates a Payable</label>'
      +'<div id="rcPayDetail" style="margin-top:0.35rem;"></div>'
    +'</div>'
    +'<div id="rcPrev" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rcOk">Receive</button><button class="pz-btn sec" id="rcCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function close(){if(mask.parentNode)document.body.removeChild(mask);}
  function prev(){var q=Number(mask.querySelector('#rcQty').value)||0;var c=Number(mask.querySelector('#rcCost').value)||0;var tot=Math.round(q*c*100)/100;var navg=(before+q>0)?((before*oldCost+q*c)/(before+q)):c;mask.querySelector('#rcPrev').innerHTML=q?('New stock: <b>'+num(before+q)+' '+esc(unit)+'</b> · total '+peso(tot)+(c>0?(' · new avg cost '+peso(Math.round(navg*100)/100)+' / '+esc(unit||'unit')):'')):'';}
  mask.querySelector('#rcQty').oninput=prev; mask.querySelector('#rcCost').oninput=prev;
  function syncReceiptSku(){var sid=mask.querySelector('#rcSku').value,sk=inventorySkuMap[sid];if(sk)mask.querySelector('#rcBrand').value=sk.brand||'';else if(recipeRequired)mask.querySelector('#rcBrand').value='';}
  mask.querySelector('#rcSku').onchange=syncReceiptSku; syncReceiptSku();
  /* The cash account and the due date each belong to one settlement option, so each is
     rendered only while that option is selected. Nesting them inside another option's
     label is what let an operator pick a bank account while "Invoice pending" stayed on. */
  var payDetail=mask.querySelector('#rcPayDetail');
  function renderPayDetail(){
    var pay=(mask.querySelector('input[name=rcPay]:checked')||{}).value||'pending';
    if(pay==='paid'&&payAccs.length)payDetail.innerHTML='<span class="pz-lbl">Paid from</span><select class="pz-in" id="rcAcct">'+accOpts+'</select>';
    else if(pay==='account')payDetail.innerHTML='<span class="pz-lbl">Due date</span><input class="pz-in" id="rcDue" type="date"/>';
    else payDetail.innerHTML='';
  }
  mask.querySelectorAll('input[name=rcPay]').forEach(function(r){r.onchange=renderPayDetail;});
  renderPayDetail();
  mask.querySelector('#rcNewSup').onclick=function(){createPurchaseSupplier('').then(function(x){supplierMap[x.supplierId]=Object.assign({},supplierMap[x.supplierId]||{},{name:x.name,active:true});var sel=mask.querySelector('#rcSup');sel.innerHTML=supplierOptions(x.supplierId);sel.value=x.supplierId;}).catch(function(e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not create supplier: '+((e&&e.message)||e));});};
  mask.querySelector('#rcCancel').onclick=close;
  mask.querySelector('#rcOk').onclick=function(){
    var q=Number(mask.querySelector('#rcQty').value)||0; if(!(q>0)){alert('Enter the quantity received.');return;}
    var c=Number(mask.querySelector('#rcCost').value)||0;
    var supplierId=mask.querySelector('#rcSup').value||'', master=purchaseSupplierById(supplierId);
    if(!master){alert('Select an active supplier from the shared supplier database, or create one with ＋. Stock cannot be received without a supplier.');return;}
    var ref=(mask.querySelector('#rcRef').value||'').trim();
    var date=mask.querySelector('#rcDate').value||window.AccazaDate.key(); var by=(mask.querySelector('#rcBy').value||'').trim();
    var pay=(mask.querySelector('input[name=rcPay]:checked')||{}).value||'pending';
    var acctEl=mask.querySelector('#rcAcct'), dueEl=mask.querySelector('#rcDue');
    if(pay==='paid'&&!(acctEl&&acctEl.value)){alert('Choose the cash, bank or e-wallet account the money came from.');return;}
    var skuId=mask.querySelector('#rcSku').value||'', selectedSku=inventorySkuMap[skuId];
    if(recipeRequired&&(!selectedSku||selectedSku.masterId!==id||selectedSku.active===false)){alert('Select an active approved brand before receiving this recipe item.');return;}
    var brand=selectedSku?(selectedSku.brand||''):(mask.querySelector('#rcBrand').value||'').trim();
    if(window.__purchPosting){alert('A purchase is still posting. Wait for it to finish before receiving this delivery.');return;}
    /* Hand the delivery to the Purchases workspace as a one-line draft. Whatever draft the
       user already had open there is put back afterwards, posted or not. */
    var keptDraft=window.__purch||null;
    window.__purch={supplierId:master.id,supplier:master.name,ref:ref,date:date,by:by||'Admin',description:'Received from the inventory list',
      pay:pay,acct:pay==='paid'?acctEl.value:'',advanceId:'',due:pay==='account'?((dueEl&&dueEl.value)||''):'',ownerName:'',ownerTreatment:'capital',
      lines:[Object.assign(purchBlank(),{mode:'existing',ing:id,skuId:selectedSku?skuId:'',brand:brand,recvUnit:unit,qty:q,costMode:'unit',unitCost:c,expiry:mask.querySelector('#rcExpiry').value||'',lot:(mask.querySelector('#rcLot').value||'').trim()})]};
    postPurchases();
    var settle=setInterval(function(){
      if(window.__purchPosting)return;
      clearInterval(settle);
      var posted=window.__purch===null;   /* postPurchases clears the draft only after a successful post */
      window.__purch=keptDraft;
      if(posted){if(window.__posLog)window.__posLog('stock-receive',i.name,num(q)+' '+unit+' · '+peso(Math.round(q*c*100)/100)+' · '+pay);close();}
    },120);
  };
}
