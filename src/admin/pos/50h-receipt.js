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
  if(window.printOrder)return window.printOrder(o);
  alert('Receipt printing is unavailable. Refresh the Admin portal and try again.');
}
