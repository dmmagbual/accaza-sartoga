
// ── CUSTOMIZE POPUP ──
window.openCustomize=function(itemKey){
  const itemData=menuItemsMap[itemKey];if(!itemData)return;
  custItem={...itemData,key:itemKey};
  custSize=null;custSel={};custQty=1;
  document.getElementById('custItemName').textContent=custItem.name;
  const imgWrap=document.getElementById('custItemImgWrap');
  imgWrap.innerHTML=custItem.img?'<img src="'+custItem.img+'" alt="" style="width:100%;height:160px;object-fit:cover;" onerror="this.style.display=\'none\'"/>'
    :'<div class="customize-img-placeholder">'+getCatIcon(custItem.cat)+'</div>';
  let html='';
  if(custItem.labelS&&custItem.labelL&&custItem.priceL){
    html+='<div class="cust-section"><div class="cust-section-title">Serving Size <span class="cust-badge cust-badge-required">Required</span></div><div class="cust-options">'
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelS||'Option 1')+'</span><span class="cust-option-price">₱'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">'+(custItem.labelL||'Option 2')+'</span><span class="cust-option-price">₱'+custItem.priceL+'</span></label>'
      +'</div></div>';
  } else if(custItem.priceM&&custItem.priceL){
    html+='<div class="cust-section"><div class="cust-section-title">Serving Size <span class="cust-badge cust-badge-required">Required</span></div><div class="cust-options">'
      +'<label class="cust-option" data-action="size" data-val="S" data-price="'+custItem.priceS+'"><input type="radio" name="custSize"/><span class="cust-option-label">Small</span><span class="cust-option-price">₱'+custItem.priceS+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="M" data-price="'+custItem.priceM+'"><input type="radio" name="custSize"/><span class="cust-option-label">Medium</span><span class="cust-option-price">₱'+custItem.priceM+'</span></label>'
      +'<label class="cust-option" data-action="size" data-val="L" data-price="'+custItem.priceL+'"><input type="radio" name="custSize"/><span class="cust-option-label">Large</span><span class="cust-option-price">₱'+custItem.priceL+'</span></label>'
      +'</div></div>';
  }
  var itemGroups=getItemOptionGroups(custItem);
  itemGroups.forEach(function(g){
    var isMulti=g.type==='multi';
    var req=!isMulti&&g.required!==false;
    html+='<div class="cust-section"><div class="cust-section-title">'+escHtml(g.name)+' <span class="cust-badge '+(req?'cust-badge-required':'cust-badge-optional')+'">'+(req?'Required':'Optional')+'</span></div><div class="cust-options">'
      +(g.choices||[]).map(function(c,ci){
        var pp=parseInt(c.price)||0;
        return '<label class="cust-option" data-action="'+(isMulti?'optcheck':'optradio')+'" data-group="'+g.id+'" data-idx="'+ci+'"><input type="'+(isMulti?'checkbox':'radio')+'" name="og_'+g.id+'"/><span class="cust-option-label">'+escHtml(c.label)+'</span><span class="cust-option-price">'+(pp>0?'+₱'+pp:'Free')+'</span></label>';
      }).join('')
      +'</div></div>';
  });
  html+='<div class="cust-section"><div class="cust-section-title">Quantity</div><div class="cust-qty"><button class="cust-qty-btn" id="custQtyMinus">−</button><span class="cust-qty-num" id="custQtyNum">1</span><button class="cust-qty-btn" id="custQtyPlus">+</button></div></div>';
  const body=document.getElementById('custBody');
  body.innerHTML=html;
  // Wire option clicks via event delegation (onclick = no stacked listeners)
  body.onclick=function(e){
    const opt=e.target.closest('.cust-option');if(!opt)return;
    const action=opt.dataset.action;
    if(action==='size'){custSize=opt.dataset.val;custItem._selectedPrice=parseInt(opt.dataset.price);opt.closest('.cust-options').querySelectorAll('.cust-option').forEach(o=>o.classList.remove('selected'));opt.classList.add('selected');opt.querySelector('input').checked=true;}
    else if(action==='optradio'){
      var g=optionGroupsMap[opt.dataset.group];if(!g)return;
      var c=(g.choices||[])[parseInt(opt.dataset.idx)];if(!c)return;
      custSel[opt.dataset.group]={label:c.label,price:parseInt(c.price)||0};
      opt.closest('.cust-options').querySelectorAll('.cust-option').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');opt.querySelector('input').checked=true;
    }
    else if(action==='optcheck'){
      var g2=optionGroupsMap[opt.dataset.group];if(!g2)return;
      var c2=(g2.choices||[])[parseInt(opt.dataset.idx)];if(!c2)return;
      var chk=opt.querySelector('input');
      var arr=custSel[opt.dataset.group]||[];
      var ix=arr.findIndex(function(x){return x.label===c2.label;});
      if(chk.checked){if(ix===-1)arr.push({label:c2.label,price:parseInt(c2.price)||0});}
      else{if(ix>-1)arr.splice(ix,1);}
      custSel[opt.dataset.group]=arr;
      opt.classList.toggle('selected',chk.checked);
    }
    updateCustTotal();
  };
    document.getElementById('custQtyMinus').addEventListener('click',function(){custQty=Math.max(1,custQty-1);document.getElementById('custQtyNum').textContent=custQty;updateCustTotal();});
  document.getElementById('custQtyPlus').addEventListener('click',function(){custQty++;document.getElementById('custQtyNum').textContent=custQty;updateCustTotal();});
  updateCustTotal();
  document.getElementById('customizePopup').classList.add('show');
};

function calcCustUnitTotal(){
  var t=custItem._selectedPrice||custItem.priceS||0;
  Object.keys(custSel).forEach(function(gid){
    var v=custSel[gid];if(!v)return;
    if(Array.isArray(v)){v.forEach(function(c){t+=c.price||0;});}
    else{t+=v.price||0;}
  });
  return t;
}
function updateCustTotal(){document.getElementById('custTotalDisplay').textContent='₱'+(calcCustUnitTotal()*custQty).toLocaleString();}

function addCustomizedToCart(){
  const item=custItem;if(!item)return;
  if(item.priceM&&item.priceL&&!custSize){alert('Please select a size.');return;}
  if(item.labelS&&item.labelL&&item.priceL&&!custSize){alert('Please select a serving option.');return;}
  var itemGroups=getItemOptionGroups(item);
  for(var gi=0;gi<itemGroups.length;gi++){
    var gg=itemGroups[gi];
    if(gg.type!=='multi'&&gg.required!==false&&!custSel[gg.id]){alert('Please select: '+gg.name);return;}
  }
  const unit=calcCustUnitTotal();
  const sizeLabel=custSize?' ('+custSize+')':'';
  const details=[];
  itemGroups.forEach(function(gg){
    var v=custSel[gg.id];if(!v)return;
    if(Array.isArray(v)){v.forEach(function(c){details.push('+'+c.label);});}
    else{details.push(v.label);}
  });
  var _optLabels=[];itemGroups.forEach(function(gg){var v=custSel[gg.id];if(!v)return;if(Array.isArray(v)){v.forEach(function(c){_optLabels.push(c.label);});}else{_optLabels.push(v.label);}});
  const cartKey=Date.now()+'_'+Math.random().toString(36).substr(2,5);
  cart[cartKey]={name:item.name+sizeLabel,details:details.join(', '),qty:custQty,unitTotal:unit,cat:item.cat,itemKey:item.key,size:custSize||null,optLabels:_optLabels};
  closeCustomize();updateCartDisplay();renderOrderSection();
  setTimeout(function(){const cb=document.querySelector('.cart-box');if(cb){cb.style.transition='box-shadow 0.3s';cb.style.boxShadow='0 0 0 3px rgba(176,141,87,0.5)';setTimeout(()=>cb.style.boxShadow='none',1000);}},400);
}
window.closeCustomize=function(){document.getElementById('customizePopup').classList.remove('show');custItem=null;};
