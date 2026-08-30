
// ── WIRE BUTTONS VIA addEventListener (avoids ES module scope issues) ──
const btnAddCat=document.getElementById('btnAddCat');
if(btnAddCat)btnAddCat.addEventListener('click',async function(){
  const iconEl=document.getElementById('newCatIcon');
  const labelEl=document.getElementById('newCatLabel');
  const icon=(iconEl.value||'').trim()||'🍽️';
  const label=(labelEl.value||'').trim();
  if(!label){alert('Please enter a category name.');return;}
  const id='cat_'+Date.now();
  try{
    await set(ref(db,'categories/'+id),{id,label,icon,order:Object.keys(categoriesMap).length});
    iconEl.value='';labelEl.value='';
    const c=document.getElementById('catAddConfirm');c.style.display='block';setTimeout(()=>c.style.display='none',2000);
  }catch(e){alert('Error: '+e.message);}
});

const btnAddItem=document.getElementById('btnAddItem');
if(btnAddItem)btnAddItem.addEventListener('click',async function(){
  const name=document.getElementById('newItemName').value.trim();
  const cat=document.getElementById('newItemCat').value;
  const desc=document.getElementById('newItemDesc').value.trim();
  const img=document.getElementById('newItemImg').value.trim();
  const isFlat=document.getElementById('pricingTypeFlat')&&document.getElementById('pricingTypeFlat').checked;
  const isTwo=document.getElementById('pricingTypeTwo')&&document.getElementById('pricingTypeTwo').checked;
  const priceFlat=parseInt(document.getElementById('newItemPriceFlat').value)||0;
  const labelS=(document.getElementById('newItemLabelS').value||'').trim();
  const labelL=(document.getElementById('newItemLabelL').value||'').trim();
  const priceTwoS=parseInt(document.getElementById('newItemPriceTwoS').value)||0;
  const priceTwoL=parseInt(document.getElementById('newItemPriceTwoL').value)||0;
  const priceS=isFlat?priceFlat:isTwo?priceTwoS:(parseInt(document.getElementById('newItemPriceS').value)||0);
  const priceM=isTwo?0:isFlat?0:(parseInt(document.getElementById('newItemPriceM').value)||0);
  const priceL=isTwo?priceTwoL:isFlat?0:(parseInt(document.getElementById('newItemPriceL').value)||0);
  if(isTwo&&(!labelS||!labelL)){alert('Please enter both option labels.');return;}
  if(isTwo&&(!priceTwoS||!priceTwoL)){alert('Please enter both option prices.');return;}
  if(!name||!priceS){alert('Please enter item name and price.');return;}
  const catItems=getMenuItems().filter(i=>i.cat===cat);
  const newItem={cat,name,desc,priceS,order:catItems.length,optionsSet:true};
  var selOgs=[];document.querySelectorAll('#newItemOptions input[data-ogid]:checked').forEach(function(c){selOgs.push(c.dataset.ogid);});
  if(selOgs.length)newItem.options=selOgs;
  if(priceM)newItem.priceM=priceM;
  if(priceL)newItem.priceL=priceL;
  if(isTwo&&labelS)newItem.labelS=labelS;
  if(isTwo&&labelL)newItem.labelL=labelL;
  if(img)newItem.img=img;
  try{
    await set(ref(db,'menuItems/item_'+Date.now()),newItem);
    document.getElementById('newItemName').value='';document.getElementById('newItemDesc').value='';
    document.getElementById('newItemImg').value='';document.getElementById('newItemPriceS').value='';
    document.getElementById('newItemPriceM').value='';document.getElementById('newItemPriceL').value='';
    document.getElementById('newItemPriceFlat').value='';
    ['newItemPriceTwoS','newItemPriceTwoL','newItemLabelS','newItemLabelL'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
    document.querySelectorAll('#newItemOptions input[data-ogid]').forEach(function(c){c.checked=false;c.parentElement.style.background='#fff';});
    document.getElementById('pricingTypeSized').checked=true;setPricingType('sized');
    const c=document.getElementById('addItemConfirm');c.style.display='block';setTimeout(()=>c.style.display='none',2500);
  }catch(e){alert('Error: '+e.message);}
});

const btnAddToCart=document.getElementById('btnAddToCart');
if(btnAddToCart)btnAddToCart.addEventListener('click',function(){addCustomizedToCart();});
