
// ── CART ──
function updateCartDisplay(){
  const box=document.getElementById('cartItems'),tot=document.getElementById('cartTotal');
  const keys=Object.keys(cart);
  if(!keys.length){box.innerHTML='<p style="color:var(--tl);font-size:0.85rem;">No items added yet.</p>';tot.style.display='none';var _cb0=document.getElementById('cartCheckoutBtn');if(_cb0)_cb0.style.display='none';return;}
  let total=0;
  box.innerHTML=keys.map(function(k){
    const item=cart[k],line=item.qty*item.unitTotal;total+=line;
    return'<div style="border-bottom:1px solid var(--cd);padding:0.5rem 0;">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
      +'<div style="flex:1;"><div style="font-size:0.85rem;color:var(--bd);font-weight:500;">'+item.name+'</div>'
      +(item.details?'<div style="font-size:0.72rem;color:var(--tl);">'+item.details+'</div>':'')
      +'<div style="font-size:0.75rem;color:var(--tl);">₱'+item.unitTotal.toLocaleString()+' each</div></div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:0.5rem;">'
      +(item.pkgId?'<span style="font-size:0.8rem;color:var(--tl);">Qty '+item.qty+'</span><button data-removepkg="'+item.pkgId+'" title="Remove package" style="border:1px solid #c0392b;background:#fff;color:#c0392b;border-radius:6px;padding:0.2rem 0.4rem;cursor:pointer;">Remove</button>':'<button data-cartkey="'+k+'" data-delta="-1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">−</button><span style="font-size:0.85rem;font-weight:500;min-width:18px;text-align:center;">'+item.qty+'</span><button data-cartkey="'+k+'" data-delta="1" style="width:24px;height:24px;border-radius:50%;border:1px solid var(--cd);background:var(--cr);font-size:0.9rem;cursor:pointer;color:var(--bd);">+</button>')
      +'<span style="font-size:0.85rem;font-weight:500;color:var(--bl);min-width:50px;text-align:right;">₱'+line.toLocaleString()+'</span>'
      +'</div></div></div>';
  }).join('');
  var pkgExtra=(window.__custPkgs||[]).reduce(function(s,p){return s+(Number(p.extraCost)||0);},0);if(pkgExtra){total+=pkgExtra;box.innerHTML+='<div style="display:flex;justify-content:space-between;padding:0.55rem 0;color:var(--bd);font-size:0.82rem;"><span>Package extra charges</span><strong>₱'+pkgExtra.toLocaleString()+'</strong></div>';}
  // Wire cart qty buttons
  box.querySelectorAll('button[data-cartkey]').forEach(function(btn){
    btn.addEventListener('click',function(e){if(e&&e.stopPropagation)e.stopPropagation();
      const k=this.dataset.cartkey,d=parseInt(this.dataset.delta);
      if(!cart[k])return;cart[k].qty=Math.max(0,cart[k].qty+d);
      if(cart[k].qty===0)delete cart[k];
      updateCartDisplay();renderOrderSection();
    });
  });
  box.querySelectorAll('button[data-removepkg]').forEach(function(btn){btn.addEventListener('click',function(e){if(e&&e.stopPropagation)e.stopPropagation();var id=this.dataset.removepkg;Object.keys(cart).forEach(function(k){if(cart[k]&&cart[k].pkgId===id)delete cart[k];});window.__custPkgs=(window.__custPkgs||[]).filter(function(p){return p.id!==id;});updateCartDisplay();renderOrderSection();});});
  document.getElementById('totalAmt').textContent='₱'+total.toLocaleString();
  tot.style.display='flex';
  var _cb1=document.getElementById('cartCheckoutBtn');if(_cb1)_cb1.style.display='block';
}

window.goToCheckout=function(e){if(e&&e.stopPropagation)e.stopPropagation();if(!Object.keys(cart).length)return;var f=document.querySelector('.form-box');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});};
window.setType=function(t){orderType=t;document.getElementById('btnPickup').classList.toggle('active',t==='pickup');document.getElementById('btnDelivery').classList.toggle('active',t==='delivery');document.getElementById('deliveryField').style.display=t==='delivery'?'block':'none';};
window.showProof=function(src){var m=document.getElementById('proofModal');var im=document.getElementById('proofModalImg');if(im)im.src=src;if(m)m.style.display='flex';};
window.setPayment=function(p){paymentType=p;
  document.getElementById('btnGcash').classList.toggle('active',p==='gcash');
  document.getElementById('btnBank').classList.toggle('active',p==='bank');
  var mayaBtn=document.getElementById('btnMaya');
  if(mayaBtn)mayaBtn.classList.toggle('active',p==='maya');
  document.getElementById('gcashInfo').style.display=p==='gcash'?'block':'none';
  document.getElementById('mayaInfo').style.display=p==='maya'?'block':'none';
  document.getElementById('bankInfo').style.display=p==='bank'?'block':'none';
};
window.setContact=function(type){contactMethod=type;['Whatsapp','Viber','Sms','Call','Email'].forEach(function(t){const el=document.getElementById('btn'+t);if(el)el.classList.toggle('active',t.toLowerCase()===type);});const ph={whatsapp:'Enter your WhatsApp number',viber:'Enter your Viber number',sms:'Enter your phone number for SMS',call:'Enter your phone number',email:'Enter your email address'};document.getElementById('custContact').placeholder=ph[type]||'Enter your contact';};
var paymentProofData='',paymentProofBusy=false;
function compressPaymentProof(file){
  return new Promise(function(resolve,reject){
    if(!file||!/^image\//i.test(file.type||'')){reject(new Error('Please choose an image file.'));return;}
    if(file.size>15*1024*1024){reject(new Error('The original image is over 15 MB. Take a screenshot or choose a smaller image.'));return;}
    var url=URL.createObjectURL(file),img=new Image();
    img.onload=function(){
      try{
        var maxDim=1600,scale=Math.min(1,maxDim/Math.max(img.naturalWidth||1,img.naturalHeight||1));
        var canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        var ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        var q=0.84,data=canvas.toDataURL('image/jpeg',q);while(data.length>1750000&&q>0.46){q-=0.08;data=canvas.toDataURL('image/jpeg',q);}
        URL.revokeObjectURL(url);if(data.length>1750000){reject(new Error('The receipt is still too large after compression. Please crop it and try again.'));return;}resolve(data);
      }catch(e){URL.revokeObjectURL(url);reject(e);}
    };
    img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('This image format cannot be processed. Please use a JPG, PNG, or screenshot.'));};img.src=url;
  });
}
window.previewProof=async function(input){
  if(!input.files||!input.files[0])return;paymentProofBusy=true;paymentProofData='';
  var file=input.files[0],nm=document.getElementById('proofFileName');document.getElementById('uploadPlaceholder').style.display='none';document.getElementById('uploadPreview').style.display='block';nm.textContent='Optimizing receipt…';
  try{paymentProofData=await compressPaymentProof(file);document.getElementById('proofImg').src=paymentProofData;nm.textContent=file.name+' · optimized to '+Math.round(paymentProofData.length*0.75/1024)+' KB';document.getElementById('uploadBox').style.borderColor='#2d9e5f';}
  catch(e){window.removeProof({stopPropagation:function(){}});alert((e&&e.message)||'Could not process this receipt image.');}
  finally{paymentProofBusy=false;}
};
window.removeProof=function(e){if(e&&e.stopPropagation)e.stopPropagation();paymentProofData='';paymentProofBusy=false;document.getElementById('paymentProof').value='';document.getElementById('proofImg').src='';document.getElementById('uploadPlaceholder').style.display='block';document.getElementById('uploadPreview').style.display='none';document.getElementById('uploadBox').style.borderColor='var(--cd)';};
