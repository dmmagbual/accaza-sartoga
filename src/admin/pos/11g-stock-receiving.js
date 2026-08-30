function receiveStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var recipeRequired=recipeUsesInventory(id), activeSkus=activeSkusFor(id);
  if(recipeRequired&&!activeSkus.length){alert('“'+i.name+'” is a recipe SKU with no active approved brand. Add a brand before receiving stock.');openSkuManager(id);return;}
  var before=Number(i.stock)||0, oldCost=Number(i.cost)||0, unit=i.unit||'';
  var cf=window.__cf; var accs=(cf&&cf.accounts&&cf.accounts())||[],payAccs=accs.filter(function(x){return !x.disabled;});
  var accOpts=accs.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.disabled?' disabled':'')+'>'+esc(x.name)+' · '+peso(x.balance)+(x.disabled?' · unavailable for purchases':'')+'</option>';}).join('');
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:460px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Receive stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">On hand: <b>'+num(before)+' '+esc(unit)+'</b> · current cost '+peso(oldCost)+' / '+esc(unit||'unit')+'</p>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;"><div><span class="pz-lbl">Quantity received ('+esc(unit||'units')+')</span><input class="pz-in" id="rcQty" type="number" step="any" style="width:120px;"/></div><div><span class="pz-lbl">Unit cost ₱ (per '+esc(unit||'unit')+')</span><input class="pz-in" id="rcCost" type="number" step="any" value="'+(oldCost||'')+'" style="width:120px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div style="flex:1;min-width:140px;"><span class="pz-lbl">Supplier</span><input class="pz-in" id="rcSup" placeholder="supplier name"/></div><div><span class="pz-lbl">Invoice / ref</span><input class="pz-in" id="rcRef" style="width:130px;"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div><span class="pz-lbl">Date</span><input class="pz-in" id="rcDate" type="date" value="'+window.AccazaDate.key()+'"/></div><div style="flex:1;min-width:140px;"><span class="pz-lbl">Received by</span><input class="pz-in" id="rcBy" value="'+esc((window.__posShift&&window.__posShift.staff)||'Admin')+'"/></div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.4rem;"><div class="purchase-sku-cell '+(recipeRequired?'required':'optional')+'" style="flex:1;min-width:180px;"><span class="pz-lbl">Approved brand '+(recipeRequired?'<b>required</b>':'(optional)')+'</span><select class="pz-in" id="rcSku"><option value="">— '+(recipeRequired?'select brand':'no approved brand / legacy receipt')+' —</option>'+activeSkus.map(function(s,ix){return '<option value="'+esc(s.id)+'"'+(recipeRequired&&activeSkus.length===1&&ix===0?' selected':'')+'>'+esc(skuDisplay(s))+'</option>';}).join('')+'</select></div><div style="flex:1;min-width:120px;"><span class="pz-lbl">Brand</span><input class="pz-in" id="rcBrand" placeholder="e.g. Arla"'+(recipeRequired?' readonly':'')+'/></div><div><span class="pz-lbl">Expiry (opt.)</span><input class="pz-in" id="rcExpiry" type="date"/></div><div><span class="pz-lbl">Lot # (opt.)</span><input class="pz-in" id="rcLot" style="width:90px;"/></div></div>'
    +'<label style="display:block;font-size:0.85rem;margin-top:0.6rem;cursor:pointer;"><input type="checkbox" id="rcAvg" checked/> Update item cost to weighted average</label>'
    +'<div style="margin-top:0.6rem;border-top:1px solid var(--cd);padding-top:0.5rem;"><span class="pz-lbl">How was it paid?</span>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="pending" checked/> Invoice pending — records a provisional supplier obligation</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="paid"'+(payAccs.length?'':' disabled')+'/> Paid now from '+(payAccs.length?('<select class="pz-in" id="rcAcct" style="width:auto;display:inline-block;">'+accOpts+'</select>'):'<span style="color:var(--tl);">(no available Balance Sheet cash account)</span>')+'</label>'
      +'<label style="display:block;font-size:0.85rem;cursor:pointer;"><input type="radio" name="rcPay" value="account"/> On account — creates a Payable, due <input class="pz-in" id="rcDue" type="date" style="width:auto;display:inline-block;"/></label>'
    +'</div>'
    +'<div id="rcPrev" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="rcOk">Receive</button><button class="pz-btn sec" id="rcCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function close(){document.body.removeChild(mask);}
  function prev(){var q=Number(mask.querySelector('#rcQty').value)||0;var c=Number(mask.querySelector('#rcCost').value)||0;var tot=Math.round(q*c*100)/100;var navg=(before+q>0)?((before*oldCost+q*c)/(before+q)):c;mask.querySelector('#rcPrev').innerHTML=q?('New stock: <b>'+num(before+q)+' '+esc(unit)+'</b> · total '+peso(tot)+((mask.querySelector('#rcAvg').checked&&c>0)?(' · new avg cost '+peso(Math.round(navg*100)/100)+' / '+esc(unit||'unit')):'')):'';}
  mask.querySelector('#rcQty').oninput=prev; mask.querySelector('#rcCost').oninput=prev; mask.querySelector('#rcAvg').onchange=prev;
  function syncReceiptSku(){var sid=mask.querySelector('#rcSku').value,sk=inventorySkuMap[sid];if(sk)mask.querySelector('#rcBrand').value=sk.brand||'';else if(recipeRequired)mask.querySelector('#rcBrand').value='';}
  mask.querySelector('#rcSku').onchange=syncReceiptSku; syncReceiptSku();
  mask.querySelector('#rcCancel').onclick=close;
  var pendingReceiptId='';
  mask.querySelector('#rcOk').onclick=function(){
    var q=Number(mask.querySelector('#rcQty').value)||0; if(!(q>0)){alert('Enter the quantity received.');return;}
    var c=Number(mask.querySelector('#rcCost').value)||0; var tot=Math.round(q*c*100)/100;
    var sup=(mask.querySelector('#rcSup').value||'').trim(); var ref=(mask.querySelector('#rcRef').value||'').trim();
    var date=mask.querySelector('#rcDate').value||window.AccazaDate.key(); var by=(mask.querySelector('#rcBy').value||'').trim();
    var pay=(mask.querySelector('input[name=rcPay]:checked')||{}).value||'pending';
    var a=A(); var rid=pendingReceiptId||(pendingReceiptId=uid('rcpt_')); var payAcct='', payableId='';
    if(!sup){alert('Enter the supplier. Stock cannot be received without a payment or supplier obligation.');return;}
    if((pay==='account'||pay==='pending')&&!(window.__cf&&window.__cf.addPayable)){alert('Purchase liability service is not ready. Refresh the portal and try again.');return;}
    if(pay==='paid'){ var accEl=mask.querySelector('#rcAcct'); payAcct=accEl?accEl.value:''; if(!payAcct){alert('Pick an account.');return;} }
    var skuId=mask.querySelector('#rcSku').value||'', selectedSku=inventorySkuMap[skuId];
    if(recipeRequired&&(!selectedSku||selectedSku.masterId!==id||selectedSku.active===false)){alert('Select an active approved brand before receiving this recipe item.');return;}
    var brand=selectedSku?(selectedSku.brand||''):(mask.querySelector('#rcBrand').value||'').trim(); var expiry=mask.querySelector('#rcExpiry').value||''; var lot=(mask.querySelector('#rcLot').value||'').trim();
    var now=Date.now(), mid=movementId('purchase',rid,id);
    postMovements([{movementId:mid,itemId:id,type:'purchase',qty:q,unitCost:c,sourceType:'stock-receipt',sourceId:rid,note:(sup||'Supplier')+(ref?' · '+ref:''),actorName:by,occurredAt:now}]).then(function(){
      if(pay==='paid'&&window.__cf&&window.__cf.postOut)return window.__cf.postOut({commandId:'purchase_cash_'+rid,date:date,accountId:payAcct,amount:tot,party:sup||i.name,ref:ref||i.name,category:'Purchases',source:'purchase',linkId:rid,note:'Received '+num(q)+' '+unit+' '+i.name});
      if((pay==='account'||pay==='pending')&&window.__cf&&window.__cf.addPayable){var due=pay==='account'?(mask.querySelector('#rcDue').value||''):'';return window.__cf.addPayable({commandId:'purchase_ap_'+rid,documentId:'ap_'+rid,party:sup||'Supplier',type:pay==='pending'?'inventory_pending_invoice':'inventory',amount:tot,date:date,due:due,ref:ref||('PENDING-'+rid)}).then(function(pid){payableId=pid;});}
      return null;
    }).then(function(){
      var writes={};
      writes['stockReceipts/'+rid]={ing:id,skuId:skuId,skuBrand:brand,name:i.name,unit:unit,qty:q,unitCost:c,total:tot,supplier:sup,brand:brand,ref:ref,date:date,receivedBy:by,payMode:pay,accountId:payAcct,payableId:payableId,movementId:mid,ts:now};
      writes['inventoryBatch/'+('bat_'+now.toString(36)+'_r')]={skuId:skuId,masterId:id,brand:brand,supplier:sup,qtyRecv:q,qtyRemaining:q,unit:unit,unitCost:c,recvDate:date,expiry:expiry,lot:lot,branch:'main',source:'purchase',invoiceId:'',receiptId:rid,createdAt:now};
      return a.update(a.ref(a.db),writes);
    }).then(function(){if(window.__posLog)window.__posLog('stock-receive',i.name,num(q)+' '+unit+' · '+peso(tot)+(pay==='paid'?' · paid':pay==='account'?' · on account':''));close();}).catch(function(e){alert('Receipt did not finish: '+((e&&e.message)||e)+'. Stock or finance may already be posted; the same receipt is safe to retry and cannot double-post.');});
  };
}
