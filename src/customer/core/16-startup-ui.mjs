
// ── INIT ──
renderCustomerCalendar();
renderCustomerOrders();
const nm=new Date();
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=new Date(nm.getFullYear(),nm.getMonth(),1).toISOString().slice(0,10);
if(archTo)archTo.value=nm.toISOString().slice(0,10);
// Trigger initial menu render after short delay for Firebase
setTimeout(function(){if(Object.keys(menuItemsMap).length)renderMenuSection();},1000);
// ── Pricing Type Toggle ─────────────────────────────────────────────────────
window.setPricingType = function(type) {
  var sized = document.getElementById('priceSizedFields');
  var two   = document.getElementById('priceTwoFields');
  var flat  = document.getElementById('priceFlatField');
  // hide all first
  sized.style.display = 'none';
  two.style.display   = 'none';
  flat.style.display  = 'none';
  // clear all fields
  ['newItemPriceS','newItemPriceM','newItemPriceL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  ['newItemPriceTwoS','newItemPriceTwoL','newItemLabelS','newItemLabelL'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  var flatEl = document.getElementById('newItemPriceFlat'); if(flatEl) flatEl.value='';
  // show correct section
  if (type === 'two')  { two.style.display  = 'grid'; }
  else if (type === 'flat') { flat.style.display = 'block'; }
  else { sized.style.display = 'grid'; }
};
// ── Gallery Lightbox ────────────────────────────────────────────────────────
(function(){
  var GALLERY = ["https://i.postimg.cc/g0qrJsnX/6.jpg", "https://i.postimg.cc/TwtsR8Gd/image.png", "https://i.postimg.cc/5yPsM8BH/image.png", "https://i.postimg.cc/wMbQrgz3/image.png", "https://i.postimg.cc/BvGckmr5/image.png", "https://i.postimg.cc/sXJJz5YV/image.png", "https://i.postimg.cc/B6mT84jW/image.png", "https://i.postimg.cc/yxJZk9qq/image.png", "https://i.postimg.cc/CxpqxzcB/image.png", "https://i.postimg.cc/Pq2pyKTr/image.png", "https://i.postimg.cc/sxZMVrSZ/image.png"];
  var current = 0;
  function show(idx) {
    current = (idx + GALLERY.length) % GALLERY.length;
    var img = document.getElementById('lightbox-img');
    img.src = GALLERY[current];
    document.getElementById('lightbox-counter').textContent = (current + 1) + ' / ' + GALLERY.length;
  }
  window.openLightbox = function(idx) {
    show(idx);
    var lb = document.getElementById('lightbox');
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window.closeLightbox = function() {
    document.getElementById('lightbox').classList.remove('open');
    document.body.style.overflow = '';
  };
  window.shiftLightbox = function(dir) { show(current + dir); };
  document.addEventListener('keydown', function(e) {
    var lb = document.getElementById('lightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  shiftLightbox(-1);
    if (e.key === 'ArrowRight') shiftLightbox(1);
  });
})();
// ── Hamburger menu ──────────────────────────────────────────────────────────
window.toggleNav = function() {
  var nl = document.querySelector('.nav-links');
  var hb = document.getElementById('hamburgerBtn');
  if (nl) { nl.classList.toggle('nav-open'); }
  if (hb) { hb.classList.toggle('open'); var open = nl && nl.classList.contains('nav-open'); hb.setAttribute('aria-expanded', open); }
};
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-links a').forEach(function(a) {
    a.addEventListener('click', function() {
      var nl = document.querySelector('.nav-links');
      var hb = document.getElementById('hamburgerBtn');
      if (nl) nl.classList.remove('nav-open');
      if (hb) { hb.classList.remove('open'); hb.setAttribute('aria-expanded','false'); }
    });
  });
});
// ── Print Order as Kitchen Ticket ──────────────────────────────────────────
window.printOrder = function(orderId) {
  var o = adminOrdersMap[orderId];
  if (!o) return;
  var isDelivery = o.type === 'Delivery';
  var now = new Date();
  var printTime = now.toLocaleString('en-PH', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
  var itemsHtml = (o.items || '').split(',').map(function(s){ return '<div>' + s.trim() + '</div>'; }).join('');
  var addrRow = (isDelivery && o.address) ? '<div class="row"><span class="lbl">Address</span><span>' + o.address + '</span></div>' : '';
  var schedRow = (o.date || o.time) ? '<div class="row"><span class="lbl">Schedule</span><span>' + (o.date||'') + ' ' + (o.time||'') + '</span></div>' : '';
  var notesRow = o.notes ? '<div class="row"><span class="lbl">Notes</span><span>' + o.notes + '</span></div><hr/>' : '';
  var ticketHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Order #' + o.id + ' — Kitchen Ticket</title>'
    + '<style>'
    + '* { box-sizing:border-box; margin:0; padding:0; }'
    + 'body { font-family:"Courier New",Courier,monospace; font-size:13px; color:#000; background:#fff; padding:12px 16px; max-width:380px; }'
    + '.logo { font-size:18px; font-weight:bold; text-align:center; letter-spacing:2px; margin-bottom:2px; }'
    + '.sub  { text-align:center; font-size:10px; margin-bottom:10px; color:#555; }'
    + 'hr    { border:none; border-top:1px dashed #000; margin:8px 0; }'
    + '.row  { display:flex; justify-content:space-between; margin:3px 0; font-size:12px; }'
    + '.lbl  { font-weight:bold; }'
    + '.items { margin:4px 0; line-height:1.6; font-size:12px; }'
    + '.total { font-size:16px; font-weight:bold; text-align:right; margin-top:6px; }'
    + '.badge { display:inline-block; padding:2px 8px; border:1px solid #000; border-radius:3px; font-weight:bold; font-size:12px; margin-bottom:4px; }'
    + '.footer { text-align:center; font-size:10px; margin-top:14px; color:#555; }'
    + '@media print { body { max-width:none; } @page { margin:6mm; } }'
    + '</style></head><body>'
    + '<div class="logo">☕ ACCAZA</div>'
    + '<div class="sub">Coffee House — Kitchen Ticket</div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Order #</span><span>' + o.id + '</span></div>'
    + '<div class="row"><span class="lbl">Printed</span><span>' + printTime + '</span></div>'
    + '<hr/>'
    + '<div class="row"><span class="lbl">Customer</span><span>' + (o.name||'—') + '</span></div>'
    + '<div class="row"><span class="lbl">Contact</span><span>' + (o.phone||'—') + (o.contact?' / '+o.contact:'') + '</span></div>'
    + '<div class="badge">' + (isDelivery ? '🛵 DELIVERY' : '🏠 PICK-UP') + '</div>'
    + addrRow + schedRow
    + '<hr/>'
    + '<div class="lbl">Items:</div>'
    + '<div class="items">' + itemsHtml + '</div>'
    + '<hr/>'
    + notesRow
    + '<div class="row"><span class="lbl">Payment</span><span>' + (o.payment||'—') + '</span></div>'
    + '<div class="total">TOTAL: ₱' + (o.total||0).toLocaleString() + '</div>'
    + '<hr/>'
    + '<div class="footer">— Thank you! Pass this to the kitchen. —</div>'
    + '</body></html>';
  var win = window.open('', '_blank', 'width=440,height=640');
  win.document.write(ticketHtml);
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 400);
};
