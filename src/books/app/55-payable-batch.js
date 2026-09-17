/*
 * Multi-bill supplier settlement.
 * Uses the already-loaded __apMap snapshot; no additional Firebase listener or
 * unbounded client read is introduced by this transaction.
 */
(function(){
  function batchSupplierOptions(){
    var groups={};
    Object.keys(window.__apMap||{}).forEach(function(id){
      var d=(window.__apMap||{})[id]||{};
      if(d.type==='customer_change_refund'||d.provisional===true||d.status!=='open')return;
      var key=String(d.supplierId||d.party||'');
      if(!key)return;
      groups[key]=groups[key]||{id:d.supplierId||key,name:d.party||'Supplier'};
    });
    return '<option value="">— select supplier —</option>'+Object.keys(groups).sort(function(a,b){return groups[a].name.localeCompare(groups[b].name);}).map(function(k){var g=groups[k];return '<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>';}).join('');
  }
  function drawBills(){
    var root=document.getElementById('tpb_bills'),supplier=fval('tpb_supplier');
    if(!root)return;
    var rows=Object.keys(window.__apMap||{}).map(function(id){var d=(window.__apMap||{})[id]||{};return {id:id,d:d};}).filter(function(x){var d=x.d;return d.type!=='customer_change_refund'&&d.provisional!==true&&d.status==='open'&&String(d.supplierId||d.party||'')===supplier;}).sort(function(a,b){return String(a.d.due||'9999-99-99').localeCompare(String(b.d.due||'9999-99-99'));});
    root.innerHTML=rows.length?'<div class="tiny muted">Choose at least two bills and allocate the payment total. Each amount is capped at that bill\'s outstanding balance.</div><div class="tbl-wrap"><table><thead><tr><th></th><th>Bill</th><th class="num">Remaining</th><th class="num">Allocate</th></tr></thead><tbody>'+rows.map(function(x){var d=x.d,left=r2(Number(d.remainingAmount!=null?d.remainingAmount:d.amount)||0);return '<tr><td><input type="checkbox" class="tpb_pick" data-id="'+esc(x.id)+'" onchange="App._txnPayBatchToggle(this)"/></td><td>'+esc(d.ref||x.id)+'<div class="tiny muted">'+esc(d.due||d.date||'')+'</div></td><td class="num">'+peso(left)+'</td><td class="num"><input class="tpb_amount" data-id="'+esc(x.id)+'" type="number" min="0" max="'+left.toFixed(2)+'" step="0.01" value="" disabled/></td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty">No open finalized bills for this supplier.</div>';
  }
  App._txnPayBatchToggle=function(box){var input=document.querySelector('.tpb_amount[data-id="'+box.getAttribute('data-id')+'"]');if(input){input.disabled=!box.checked;if(box.checked&&!input.value)input.value=input.max;}};
  App.txnPayBatch=function(){
    var suppliers=batchSupplierOptions();
    if(suppliers.indexOf('<option value=""')===-1||Object.keys(window.__apMap||{}).length<2)return alert('At least two open supplier bills are required.');
    App._txnModal('Pay multiple supplier bills','<div class="field"><label>Supplier</label><select id="tpb_supplier" onchange="App._txnPayBatchDraw()">'+suppliers+'</select></div><div id="tpb_bills"><div class="tiny muted">Select a supplier to see its open bills.</div></div><div class="grid2"><div class="field"><label>Pay from</label><select id="tpb_source">'+billPaymentSourceOptions()+'</select></div><div class="field"><label>Date</label><input id="tpb_date" type="date" value="'+todayStr()+'"/></div></div><div class="grid2"><div class="field"><label>Payment reference</label><input id="tpb_ref" required placeholder="Required · receipt, transfer, cheque or voucher ID"/></div><div class="field"><label>Owner / partner (if personally paid)</label><input id="tpb_owner" placeholder="Required for Owner’s Capital"/></div></div><div class="hint">This creates one atomic payment and allocates it across the selected bills. A bill remains open until its own balance reaches zero.</div>','Pay selected bills',function(btn){
      var supplierId=fval('tpb_supplier'),source=fval('tpb_source'),reference=fval('tpb_ref'),allocations=[];
      document.querySelectorAll('.tpb_pick:checked').forEach(function(box){var id=box.getAttribute('data-id'),amount=r2(Number((document.querySelector('.tpb_amount[data-id="'+id+'"]')||{}).value)||0);if(amount>0)allocations.push({documentId:id,amount:amount});});
      if(!supplierId)return alert('Select the supplier first.');
      if(allocations.length<2)return alert('Select at least two bills.');
      if(source==='cash_float'||source==='register')return alert('Register Cash Float is protected and cannot pay supplier bills.');
      if(source==='owner_capital'&&!fval('tpb_owner'))return alert('Enter the owner or partner who paid.');
      if(!reference)return alert('Payment reference is required.');
      App._txnRun(btn,{action:'pay_payable_batch',commandId:uid(),supplierId:supplierId,allocations:allocations,paymentSource:source,accountId:source,date:fval('tpb_date'),ref:reference,ownerName:fval('tpb_owner')});
    });
  };
  App._txnPayBatchDraw=function(){drawBills();};
  var oldPayables=PAGES.payables;
  PAGES.payables=function(){var html=oldPayables();return html.replace('<div class="btn-row">','<div class="btn-row"><button class="btn primary" onclick="App.txnPayBatch()">Pay supplier bills</button>');};
})();
