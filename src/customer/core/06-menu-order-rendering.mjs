
// ── MENU & ORDER RENDERING ──
window.filterMenu=function(cat,btn){
  menuFilter=cat;
  document.querySelectorAll('#menuTabsRow .tab-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderMenuSection();
};
window.filterOrder=function(cat,btn){
  orderFilter=cat;
  document.querySelectorAll('#orderTabsRow .otab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderOrderSection();
};

window.goToOrderItem=function(cat,key){
  const btn=document.querySelector('#orderTabsRow .otab[data-cat="'+cat+'"]');
  filterOrder(cat,btn);
  const row=document.querySelector('#orderItemList .item-row[data-itemkey="'+key+'"]');
  if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('item-glow');setTimeout(function(){row.classList.remove('item-glow');},2400);}
  else{const sec=document.getElementById('order');if(sec)sec.scrollIntoView({behavior:'smooth'});}
};

function renderMenuSection(){
  const el=document.getElementById('menuGrid');if(!el)return;
  if(!menuFilter){el.innerHTML='';return;}
  const items=getMenuItems().filter(i=>i.cat===menuFilter).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!items.length){el.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:rgba(224,212,198,0.5);"><p style="font-size:2rem;">'+getCatIcon(menuFilter)+'</p><p style="margin-top:0.5rem;">No items yet.</p></div>';return;}
  el.innerHTML=items.map(function(i){
    const ok=isAvail(i.name);
    const imgHtml=i.img?'<img src="'+i.img+'" alt="" class="menu-card-img" style="'+(ok?'':'opacity:0.5;')+'" onerror="this.style.display=\'none\'"/>'
      :'<div class="menu-card-img-placeholder">'+getCatIcon(i.cat)+'</div>';
    const priceHtml=i.priceM&&i.priceL
      ?'<span class="price-badge">S ₱'+i.priceS+'</span><span class="price-badge">M ₱'+i.priceM+'</span><span class="price-badge">L ₱'+i.priceL+'</span>'
      :i.priceL&&i.labelS&&i.labelL
      ?'<span class="price-badge">'+(i.labelS||'Opt 1')+' ₱'+i.priceS+'</span><span class="price-badge">'+(i.labelL||'Opt 2')+' ₱'+i.priceL+'</span>'
      :'<span class="price-single">₱'+i.priceS+'</span>';
    return'<div class="menu-card'+(ok?' clickable':'')+'"'+(ok?' data-goorder="'+i.key+'" data-gocat="'+i.cat+'"':'')+'>'+imgHtml+'<div class="menu-card-body"><span class="cat-tag">'+getCatLabel(i.cat)+'</span><h4 style="'+(ok?'':'text-decoration:line-through;opacity:0.6;')+'">'+i.name+'</h4><p class="desc">'+(i.desc||'')+'</p><div class="price-row">'+priceHtml+'</div><span class="avail-badge '+(ok?'avail-yes':'avail-no')+'">'+(ok?'✅ Available':'❌ Unavailable')+'</span>'+(ok?'<span class="tap-hint">🛒 Tap to order</span>':'')+'</div></div>';
  }).join('');
  el.querySelectorAll('.menu-card[data-goorder]').forEach(function(card){card.addEventListener('click',function(){goToOrderItem(this.dataset.gocat,this.dataset.goorder);});});
}

function renderOrderSection(){
  const el=document.getElementById('orderItemList');if(!el)return;
  if(!orderFilter){el.innerHTML='<div class="order-empty-state"><span class="big-icon">☕</span><h3>What are you craving today?</h3><p>Choose a category above to explore our handcrafted drinks and pastries.</p></div>';return;}
  const items=getMenuItems().filter(i=>i.cat===orderFilter).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!items.length){el.innerHTML='<div class="order-empty-state"><span class="big-icon">'+getCatIcon(orderFilter)+'</span><h3>No items yet.</h3></div>';return;}
  el.innerHTML=items.map(function(i){
    const ok=isAvail(i.name);
    const cartQty=Object.values(cart).filter(c=>c.name===i.name||c.name.startsWith(i.name+' (')).reduce((s,c)=>s+c.qty,0);
    const imgHtml=i.img?'<img src="'+i.img+'" alt="" class="item-row-img" onerror="this.style.display=\'none\'"/>'
      :'<div class="item-row-img-placeholder">'+getCatIcon(i.cat)+'</div>';
    return'<div class="item-row" data-itemkey="'+i.key+'" style="'+(ok?'':'opacity:0.45;pointer-events:none;')+'">'
      +imgHtml
      +'<div class="item-row-info"><h5 style="'+(ok?'':'text-decoration:line-through;')+'">'+i.name+'</h5>'
      +'<span class="item-cat">'+(ok?getCatLabel(i.cat):'Not Available')+'</span>'
      +'<span class="item-prices">'+formatPrice(i)+'</span></div>'
      +'<div class="item-row-right">'
      +(cartQty>0?'<span style="font-size:0.78rem;font-weight:600;color:var(--bl);background:rgba(176,141,87,0.1);padding:0.2rem 0.5rem;border-radius:999px;">'+cartQty+' in cart</span>':'')
      +'<button class="qty-btn" style="background:var(--bd);color:#fff;border-color:var(--bd);" data-key="'+i.key+'">+</button>'
      +'</div></div>';
  }).join('');
  // Wire + buttons via event listeners
  el.querySelectorAll('.qty-btn[data-key]').forEach(function(btn){
    btn.addEventListener('click',function(){openCustomize(this.dataset.key);});
  });
}
