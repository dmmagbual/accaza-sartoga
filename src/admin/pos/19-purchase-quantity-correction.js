function bindPurchaseQuantityCorrection(root){
  root.querySelectorAll('[data-purchase-quantity]').forEach(function(b){b.onclick=function(){
    var id=b.getAttribute('data-purchase-quantity'),p=purchaseInvoicesMap[id]||{},lines=(p.lines||[]).map(function(x,i){return{x:x,i:i};}).filter(function(row){var x=row.x||{};return x.itemId&&x.receiptId&&x.lineType!=='expense'&&x.lineType!=='fixed_asset';});
    if(p.reversed||!lines.length){alert('This purchase has no active inventory receipt to correct.');return;}
    F().run({title:'Correct purchase quantity',subtitle:(p.supplier||'Supplier')+' · invoice total '+peso(p.total)+'. This changes stock units and recalculates unit cost only. The purchase total, cash/payment, payable, and Finance Books remain unchanged.',submitLabel:'Correct quantity',busyLabel:'Correcting…',fields:[
      {name:'lineIndex',label:'Purchase stock line',type:'select',required:true,options:lines.map(function(row){var x=row.x;return{value:String(row.i),label:(x.itemName||x.itemId)+' — recorded '+num(x.qty)+' '+(x.unit||'units')+' — '+peso(x.total)};})},
      {name:'newQty',label:'Correct quantity in stock units',type:'number',required:true,min:0.000001,step:0.000001,help:'For the reported error, enter 1000 when 100 pieces were recorded.'},
      {name:'reason',label:'Correction reason and source evidence',type:'textarea',required:true,maxLength:300,placeholder:'Example: Supplier delivery and physical count confirm 1,000 pcs; 100 pcs was a data-entry error.'},
      {name:'confirmed',label:'I verified the original line amount is correct and only the quantity was recorded incorrectly',type:'checkbox',required:true}
    ]},function(v){var i=Number(v.lineIndex),line=(p.lines||[])[i]||{};return A().managePurchaseCorrection({action:'correct_quantity',invoiceId:id,lineIndex:i,expectedQty:Number(line.qty),newQty:Number(v.newQty),reason:v.reason});})
      .then(function(res){var d=(res&&res.data)||res||{};alert('Quantity corrected: '+num(d.oldQty)+' → '+num(d.newQty)+' '+(d.unit||'units')+'. Line and invoice value remain '+peso(d.lineTotal)+'; Finance Books impact is ₱0.00. Current stock is '+num(d.balanceAfter)+' at '+peso(d.costAfter)+' per '+(d.unit||'unit')+'.');renderPurchases();})
      .catch(function(e){var s=String((e&&e.message)||(e&&e.code)||e);if(s.indexOf('cancelled')<0)alert('Could not correct quantity: '+s);});
  };});
}
