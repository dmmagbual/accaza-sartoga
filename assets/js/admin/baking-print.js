/* Printable baking batch card (Oct 2026 split from baking.js). Writes into the pop-up that baking.js has
   already opened inside the click; formatting helpers come from baking.js so both screens agree. */
(function(){
'use strict';
window.__accazaBakingPrint=function(w,c,h){
  var esc=h.esc,peso=h.peso,r3=h.r3,st=h.st,acc=h.acc;
  var a=acc(c),d1=st(c.ts),d2=st(c.postedAt),d3=st(c.reversedAt);
  var ls=(c.lines||[]).map(function(l){return '<tr><td>'+esc(l.itemName||l.itemId)+'</td><td class="r">'+esc(r3(l.qty))+' '+esc(l.unit||'')+'</td><td class="r">'+peso(l.unitCost)+'</td><td class="r">'+peso(l.value)+'</td></tr>';}).join('');
  w.document.write('<html><head><title>'+esc(c.id||'')+'</title><style>*{font:12px monospace}body{padding:10px}h2,h3{text-align:center;margin:2px 0}table{width:100%;border-collapse:collapse}.r{text-align:right}hr{border:0;border-top:1px dashed #000}@media print{button{display:none}}</style></head><body>'
  +'<h2>Accaza — Baking Batch Card</h2><h3>'+esc(c.productName||'')+'</h3><hr>'
  +'<div>Batch: '+esc(c.id||'')+'</div><div>Date: '+esc(c.date||d1)+(c.date&&d1?' · '+esc(d1):'')+'</div>'
  +'<div>Baked by: '+esc(c.bakedBy||'')+'</div><div>Posted by: '+esc(c.postedBy||'')+(d2?' · '+esc(d2):'')+'</div><hr>'
  +'<table><tr><td><b>Ingredient</b></td><td class="r"><b>Qty</b></td><td class="r"><b>Unit ₱</b></td><td class="r"><b>Value</b></td></tr>'+ls+'</table><hr>'
  +'<table><tr><td><b>Total batch cost</b></td><td class="r"><b>'+peso(c.totalCost)+'</b></td></tr>'
  +'<tr><td><b>Actual pieces produced</b></td><td class="r"><b>'+esc(c.pieces)+'</b></td></tr>'
  +'<tr><td><b>Cost per piece</b></td><td class="r"><b>'+peso(c.unitCost)+'</b></td></tr></table><hr>'
  +'<div>Debit '+esc(a[0])+' '+esc(c.pastryItemName||'finished pieces')+' — '+esc(c.pieces)+' pc at '+peso(c.unitCost)+'</div>'
  +'<div>Credit '+esc(a[0])+' ingredients used — '+peso(c.totalCost)+'</div>'
  +'<div>Checked by: ______</div>'
  +(c.reversed?'<div><b>REVERSED</b> by '+esc(c.reversedBy||'')+(d3?' on '+esc(d3):'')+'</div>':'')
  +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
};
})();
