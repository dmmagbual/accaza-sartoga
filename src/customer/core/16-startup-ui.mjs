
// ── INIT ──
renderCustomerCalendar();
renderCustomerOrders();
document.addEventListener('click',function(event){
  var button=event.target&&event.target.closest&&event.target.closest('[data-payment-qr]');if(!button)return;
  var src=button.getAttribute('data-payment-qr'),alt=button.getAttribute('data-payment-qr-alt')||'Payment QR code',style=button.getAttribute('data-payment-qr-style')||'';
  if(!src||button.disabled)return;
  button.disabled=true;button.textContent='Loading QR code…';
  var image=new Image();image.alt=alt;image.decoding='async';image.style.cssText=style;
  image.onload=function(){button.replaceWith(image);};
  image.onerror=function(){button.disabled=false;button.textContent='Click for QR code';(window.accazaToast||function(){})('QR code could not be loaded. Check your connection and try again.','error');};
  image.src=src;
});
const nm=new Date();
const archFrom=document.getElementById('archiveFrom'),archTo=document.getElementById('archiveTo');
if(archFrom)archFrom.value=new Date(nm.getFullYear(),nm.getMonth(),1).toISOString().slice(0,10);
if(archTo)archTo.value=nm.toISOString().slice(0,10);
// Trigger initial menu render after short delay for Firebase
setTimeout(function(){if(Object.keys(menuItemsMap).length)renderMenuSection();},1000);
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
