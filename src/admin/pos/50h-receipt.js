/* ══════════ MODALS / RECEIPT ══════════ */
function ensureModals(){
  if(document.getElementById('pzItemMask'))return;
  var m=document.createElement('div'); m.className='pz-mask'; m.id='pzItemMask';
  m.innerHTML='<div class="pz-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><div class="pz-h" id="pzItemTitle" style="margin:0;"></div><button class="pz-btn sec" id="pzItemClose" style="padding:0.2rem 0.6rem;">✕</button></div><div id="pzItemBody"></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;border-top:1px solid var(--cd);padding-top:0.7rem;"><span style="font-weight:700;font-size:1.05rem;" id="pzItemTotal">₱0.00</span><button class="pz-btn ok" id="pzItemAdd" style="padding:0.55rem 1.4rem;">Add to sale</button></div></div>';
  document.body.appendChild(m);
  document.getElementById('pzItemClose').onclick=function(){m.classList.remove('show');};
  document.getElementById('pzItemAdd').onclick=pzAddToCart;
  m.onclick=function(e){if(e.target===m)m.classList.remove('show');};
}
function showReceipt(o){
  var addr='Saratoga Ave, La Mediterranea Subd., Governor\'s Drive, Dasmariñas';
  var dispRef=o.platformRef||o.id;
  var rows=(o.lineItems||[]).map(function(li){return '<tr><td>'+esc(li.name)+' ×'+li.qty+'</td><td style="text-align:right;">'+peso(li.qty*li.unitTotal)+'</td></tr>'+(li.optLabels&&li.optLabels.length?'<tr><td colspan="2" style="font-size:0.7rem;color:#777;padding-top:0;">'+esc(li.optLabels.join(', '))+'</td></tr>':'');}).join('');
  var w=window.open('','_blank','width=360,height=640');
  if(!w){alert('Allow pop-ups to print the receipt. Sale was saved.');return;}
  w.document.write('<html><head><title>Receipt '+esc(dispRef)+'</title><style>*{font-family:monospace;font-size:12px;color:#000;}body{padding:10px;}h2{text-align:center;margin:0 0 2px;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}hr{border:none;border-top:1px dashed #000;}@media print{button{display:none;}}</style></head><body>'
    +'<h2>Accaza Coffee House</h2><div style="text-align:center;">'+esc(addr)+'</div><hr>'
    +'<div>Order: '+esc(dispRef)+'</div><div>'+esc(o.date)+' '+esc(o.time)+'</div><div>On Duty: '+esc(o.onDuty||o.staff||'-')+'</div><div>Customer: '+esc(o.name||'Walk-in')+'</div>'
    +'<hr>'
    +'<table>'+rows+'</table><hr>'
    +'<table><tr><td>Subtotal</td><td style="text-align:right;">'+peso(o.subtotal||o.total)+'</td></tr>'
    +((o.discountLines&&o.discountLines.length)?o.discountLines.map(function(d){var lbl={senior:'Senior 20%',pwd:'PWD 20%',athlete:'Athlete 20%',promo5:'Promo 5%'}[d.type]||d.type;return '<tr><td>'+esc(lbl)+(d.idNumber?' · '+esc(d.idNumber):'')+'</td><td style="text-align:right;">-'+peso(d.value)+'</td></tr>';}).join(''):'')
    +(function(){var sc=(o.discountLines||[]).reduce(function(s,d){return s+(Number(d.value)||0);},0);var man=(Number(o.discount)||0)-sc;return man>0.005?'<tr><td>Discount</td><td style="text-align:right;">-'+peso(man)+'</td></tr>':'';})()
    +'<tr><td><b>TOTAL</b></td><td style="text-align:right;"><b>'+peso(o.total)+'</b></td></tr>'
    +'<tr><td>Payment</td><td style="text-align:right;">'+esc(o.payment)+'</td></tr>'
    +(o.platformRef?'<tr><td>Net (after comm.)</td><td style="text-align:right;">'+peso(o.netPlatform||0)+'</td></tr>':'')
    +(o.tendered?'<tr><td>Cash</td><td style="text-align:right;">'+peso(o.tendered)+'</td></tr><tr><td>Change</td><td style="text-align:right;">'+peso(o.change)+'</td></tr>':'')
    +(o.tipRounding?'<tr><td>Tip / kept change</td><td style="text-align:right;">'+peso(o.tipRounding)+'</td></tr>':'')
    +'</table><hr><div style="text-align:center;">Salamat! Please come again.</div>'
    +'<div style="text-align:center;font-size:9px;margin-top:4px;">This is not an official BIR receipt.</div>'
    +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div>'
    +'</body></html>');
  w.document.close();
}
})();
