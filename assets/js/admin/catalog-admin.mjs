import{db,ref,set,update,remove}from"./firebase-client.mjs";
import{escHtml,safeImageSrc}from"./shared-ui.mjs";

const categoriesRef=ref(db,'categories'),menuRef=ref(db,'menuItems'),availRef=ref(db,'availability');

function createCatalogAdmin(deps){
  // ── WIRE BUTTONS VIA addEventListener (avoids ES module scope issues) ──
  document.getElementById('btnAddCat').addEventListener('click',async function(){
    const iconEl=document.getElementById('newCatIcon');
    const labelEl=document.getElementById('newCatLabel');
    const icon=(iconEl.value||'').trim()||'🍽️';
    const label=(labelEl.value||'').trim();
    if(!label){alert('Please enter a category name.');return;}
    const id='cat_'+Date.now();
    try{
      await set(ref(db,'categories/'+id),{id,label,icon,order:Object.keys(deps.getCategoriesMap()).length});
      iconEl.value='';labelEl.value='';
      const c=document.getElementById('catAddConfirm');c.style.display='block';setTimeout(()=>c.style.display='none',2000);
    }catch(e){alert('Error: '+e.message);}
  });
  
  document.getElementById('btnAddItem').addEventListener('click',async function(){
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
    const catItems=deps.getMenuItems().filter(i=>i.cat===cat);
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
  
  
  
  function renderCategoryManager(){
    const el=document.getElementById('categoryList');if(!el)return;
    const cats=deps.getCats();
    if(!cats.length){el.innerHTML='<p style="color:var(--tl);font-size:0.85rem;">No categories yet.</p>';return;}
    el.innerHTML=cats.map(function(c){
      return'<div style="display:flex;align-items:center;gap:0.6rem;background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:0.6rem 0.85rem;" draggable="true" data-catid="'+c.id+'">'
        +'<span style="cursor:grab;color:var(--tl);font-size:1rem;user-select:none;">⠿</span>'
        +'<input type="text" id="catIcon_'+c.id+'" value="'+(c.icon||'☕')+'" style="width:50px;font-size:0.9rem;text-align:center;padding:0.3rem;border:1px solid var(--cd);border-radius:4px;background:#fff;font-family:\'Inter\',sans-serif;"/>'
        +'<input type="text" id="catLabel_'+c.id+'" value="'+(c.label||'')+'" style="flex:1;font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--cd);border-radius:4px;background:#fff;font-family:\'Inter\',sans-serif;"/>'
        +'<button data-savecatid="'+c.id+'" style="background:#d4edda;border:1px solid #a8d5b5;border-radius:4px;padding:0.25rem 0.6rem;font-size:0.72rem;color:#155724;cursor:pointer;font-family:\'Inter\',sans-serif;white-space:nowrap;">💾 Save</button>'
        +'<button data-delcatid="'+c.id+'" style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:4px;padding:0.25rem 0.6rem;font-size:0.72rem;color:#721c24;cursor:pointer;font-family:\'Inter\',sans-serif;">🗑️</button>'
        +'</div>';
    }).join('');
    // Wire save/delete
    el.querySelectorAll('button[data-savecatid]').forEach(function(btn){
      btn.addEventListener('click',async function(){
        const id=this.dataset.savecatid;
        const icon=document.getElementById('catIcon_'+id).value.trim()||'☕';
        const label=document.getElementById('catLabel_'+id).value.trim();
        if(!label)return;
        await update(ref(db,'categories/'+id),{icon,label});
      });
    });
    el.querySelectorAll('button[data-delcatid]').forEach(function(btn){
      btn.addEventListener('click',function(){
        const id=this.dataset.delcatid;
        const items=deps.getMenuItems().filter(i=>i.cat===id);
        if(items.length>0){alert('Cannot delete — this category has '+items.length+' item(s). Remove the items first.');return;}
        deps.showDeletePopup(deps.getCategoriesMap()[id]?.label||id,async function(){await remove(ref(db,'categories/'+id));});
      });
    });
    // Drag reorder
    let dragId=null;
    el.querySelectorAll('[data-catid]').forEach(function(row){
      row.addEventListener('dragstart',function(){dragId=this.dataset.catid;});
      row.addEventListener('dragover',function(e){e.preventDefault();});
      row.addEventListener('drop',async function(e){
        e.preventDefault();if(!dragId||dragId===this.dataset.catid)return;
        const cats2=deps.getCats();const from=cats2.findIndex(c=>c.id===dragId),to=cats2.findIndex(c=>c.id===this.dataset.catid);
        const reordered=[...cats2];reordered.splice(to,0,reordered.splice(from,1)[0]);
        const updates={};reordered.forEach((c,i)=>{updates[c.id+'/order']=i;});
        await update(categoriesRef,updates);dragId=null;
      });
    });
  }
  
  
  
  function buildOptionChecklistHtml(selectedIds){
    var ids=Object.keys(deps.getOptionGroupsMap());
    if(!ids.length)return '<span style="font-size:0.78rem;color:var(--tl);">No option groups yet — create them in the 🧩 Item Options panel.</span>';
    return ids.sort(function(a,b){return(deps.getOptionGroupsMap()[a].order||0)-(deps.getOptionGroupsMap()[b].order||0);}).map(function(id){
      var g=deps.getOptionGroupsMap()[id];
      var on=selectedIds.indexOf(id)!==-1;
      return '<label style="display:inline-flex;align-items:center;gap:0.35rem;background:'+(on?'#f5ead9':'#fff')+';border:1px solid var(--cd);border-radius:999px;padding:0.3rem 0.8rem;font-size:0.78rem;color:var(--td);cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;"><input type="checkbox" data-ogid="'+id+'"'+(on?' checked':'')+' style="width:auto;accent-color:var(--bl);margin:0;" onchange="this.parentElement.style.background=this.checked?\'#f5ead9\':\'#fff\'"/>'+escHtml(g.name)+'</label>';
    }).join('');
  }
  function renderNewItemOptionChecklist(){
    var el=document.getElementById('newItemOptions');if(!el)return;
    var checked=[];el.querySelectorAll('input[data-ogid]:checked').forEach(function(c){checked.push(c.dataset.ogid);});
    el.innerHTML=buildOptionChecklistHtml(checked);
  }
  var OG_INP='background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.35rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;';
  function ogChoiceRowHtml(label,price){
    return '<div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem;" data-ogchoicerow>'
      +'<input type="text" value="'+escHtml(label)+'" data-choicelabel placeholder="Choice label (e.g. Hot, 1 Sugar)" style="flex:1;min-width:0;'+OG_INP+'"/>'
      +'<span style="font-size:0.78rem;color:var(--tl);">₱</span>'
      +'<input type="number" value="'+(parseInt(price)||0)+'" data-choiceprice min="0" title="Extra price — 0 shows as Free" style="width:84px;'+OG_INP+'"/>'
      +'<button data-removechoice title="Remove choice" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.55rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">✖</button>'
      +'</div>';
  }
  function wireOgChoiceRow(row){
    row.querySelector('[data-removechoice]').addEventListener('click',function(){row.remove();});
  }
  function renderOptionManager(){
    var el=document.getElementById('optGroupList');if(!el)return;
    var ids=Object.keys(deps.getOptionGroupsMap()).sort(function(a,b){return(deps.getOptionGroupsMap()[a].order||0)-(deps.getOptionGroupsMap()[b].order||0);});
    if(!ids.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No option groups yet. Add your first one below.</p>';return;}
    var items=deps.getMenuItems();
    el.innerHTML=ids.map(function(id){
      var g=deps.getOptionGroupsMap()[id];
      var used=items.filter(function(i){return deps.getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
      var choiceRows=(g.choices||[]).map(function(c){return ogChoiceRowHtml(c.label,c.price);}).join('');
      return '<div data-ogcard="'+id+'" style="background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:1rem;margin-bottom:0.75rem;">'
        +'<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:0.6rem;">'
        +'<div style="flex:1;min-width:150px;"><label style="font-size:0.7rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option Name</label>'
        +'<input type="text" value="'+escHtml(g.name)+'" data-ogname style="width:100%;'+OG_INP+'"/></div>'
        +'<div><label style="font-size:0.7rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Selection</label>'
        +'<select data-ogtype style="'+OG_INP+'">'
        +'<option value="single"'+(g.type!=='multi'?' selected':'')+'>Choose one</option>'
        +'<option value="multi"'+(g.type==='multi'?' selected':'')+'>Choose many</option>'
        +'</select></div>'
        +'<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.78rem;color:var(--td);cursor:pointer;padding-bottom:0.45rem;text-transform:none;letter-spacing:0;font-weight:400;"><input type="checkbox" data-ogreq'+(g.required!==false?' checked':'')+' style="width:auto;accent-color:var(--bl);"/> Required</label>'
        +'</div>'
        +'<div style="font-size:0.7rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.35rem;">Choices — price 0 = Free</div>'
        +'<div data-ogchoices>'+choiceRows+'</div>'
        +'<button data-addchoice style="background:#fff;border:1px dashed var(--cd);border-radius:6px;padding:0.35rem 0.8rem;font-size:0.78rem;color:var(--tm);cursor:pointer;margin-top:0.2rem;">➕ Add Choice</button>'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;flex-wrap:wrap;gap:0.5rem;">'
        +'<span style="font-size:0.72rem;color:var(--tl);">Used by '+used+' item'+(used===1?'':'s')+'</span>'
        +'<div style="display:flex;gap:0.5rem;">'
        +'<button data-delog="'+id+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.35rem 0.8rem;font-size:0.78rem;color:#c0392b;cursor:pointer;">🗑️ Delete</button>'
        +'<button data-saveog="'+id+'" style="background:var(--bd);color:#fff;border:none;border-radius:6px;padding:0.35rem 1rem;font-size:0.78rem;cursor:pointer;font-weight:500;">💾 Save</button>'
        +'</div></div></div>';
    }).join('');
    el.querySelectorAll('[data-ogchoicerow]').forEach(wireOgChoiceRow);
    el.querySelectorAll('[data-addchoice]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var wrap=this.closest('[data-ogcard]').querySelector('[data-ogchoices]');
        var tmp=document.createElement('div');
        tmp.innerHTML=ogChoiceRowHtml('',0);
        var row=tmp.firstChild;
        wrap.appendChild(row);
        wireOgChoiceRow(row);
        row.querySelector('[data-choicelabel]').focus();
      });
    });
    el.querySelectorAll('[data-saveog]').forEach(function(btn){
      btn.addEventListener('click',async function(){
        var id=this.dataset.saveog,card=el.querySelector('[data-ogcard="'+id+'"]'),self=this;
        var name=(card.querySelector('[data-ogname]').value||'').trim();
        if(!name){alert('Please enter the option name.');return;}
        var type=card.querySelector('[data-ogtype]').value;
        var required=card.querySelector('[data-ogreq]').checked;
        var choices=[];
        card.querySelectorAll('[data-ogchoicerow]').forEach(function(r){
          var lbl=(r.querySelector('[data-choicelabel]').value||'').trim();
          var pr=parseInt(r.querySelector('[data-choiceprice]').value)||0;
          if(lbl)choices.push({label:lbl,price:pr});
        });
        if(!choices.length){alert('Please add at least one choice.');return;}
        try{
          await update(ref(db,'optionGroups/'+id),{name:name,type:type,required:required,choices:choices});
          self.textContent='✅ Saved';setTimeout(function(){self.textContent='💾 Save';},1500);
        }catch(e){alert('Error: '+e.message);}
      });
    });
    el.querySelectorAll('[data-delog]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var id=this.dataset.delog;
        var g=deps.getOptionGroupsMap()[id];if(!g)return;
        var used=deps.getMenuItems().filter(function(i){return deps.getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
        deps.showDeletePopup('option "'+g.name+'"'+(used?' (used by '+used+' item'+(used===1?'':'s')+')':''),async function(){
          await remove(ref(db,'optionGroups/'+id));
        });
      });
    });
  }
  window.addOptionGroup=async function(){
    var name=(document.getElementById('newOgName').value||'').trim();
    if(!name){alert('Please enter an option name (e.g. Temperature).');return;}
    var type=document.getElementById('newOgType').value;
    var required=document.getElementById('newOgReq').checked;
    var id='og_'+Date.now();
    try{
      await set(ref(db,'optionGroups/'+id),{name:name,type:type,required:required,order:Object.keys(deps.getOptionGroupsMap()).length,choices:[{label:'Option 1',price:0}]});
      document.getElementById('newOgName').value='';
      var c=document.getElementById('ogAddConfirm');c.style.display='block';setTimeout(function(){c.style.display='none';},2500);
    }catch(e){alert('Error: '+e.message);}
  };
  
  // ── STAFF MENU (read-only view) ─────────────────────────────
  function renderStaffMenu(){
    var el=document.getElementById('staffMenuContainer');if(!el)return;
    var cats=deps.getCats();var items=deps.getMenuItems();
    if(!cats.length){el.innerHTML='<p style="color:var(--tl);">No menu items yet.</p>';return;}
    el.innerHTML=cats.map(function(cat){
      var catItems=items.filter(function(i){return i.cat===cat.id;}).sort(function(a,b){return(a.order||0)-(b.order||0);});
      if(!catItems.length)return'';
      return'<div style="margin-bottom:1.5rem;">'
        +'<div style="font-family:\'Playfair Display\',serif;font-size:1rem;color:var(--bd);margin-bottom:0.6rem;padding-bottom:0.3rem;border-bottom:1px solid var(--cd);">'+cat.icon+' '+cat.label+'</div>'
        +catItems.map(function(item){
          var priceStr=item.priceM&&item.priceL?'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL
            :item.priceL&&item.labelS&&item.labelL?item.labelS+' ₱'+item.priceS+' · '+item.labelL+' ₱'+item.priceL
            :'₱'+item.priceS;
        var safeImg=safeImageSrc(item.img);
        return'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0;border-bottom:1px solid rgba(0,0,0,0.04);">'
            +(safeImg?'<img src="'+safeImg+'" style="width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
              :'<div style="width:38px;height:38px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">'+cat.icon+'</div>')
            +'<div style="flex:1;min-width:0;"><div style="font-size:0.88rem;font-weight:500;color:var(--bd);">'+escHtml(item.name)+'</div>'
            +(item.desc?'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.1rem;">'+escHtml(item.desc)+'</div>':'')
            +'<div style="font-size:0.78rem;color:#c9a36a;margin-top:0.15rem;">'+priceStr+'</div></div>'
            +'<span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:999px;flex-shrink:0;background:'+(deps.isAvail(item.name)?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)')+';color:'+(deps.isAvail(item.name)?'#2d9e5f':'#c0392b')+';">'+(deps.isAvail(item.name)?'✅':'❌')+'</span>'
            +'</div>';
        }).join('')
        +'</div>';
    }).join('');
  }
  
  
  
  window.toggleEditPanel=function(key){
    var p=document.getElementById('ep_'+key);if(!p)return;
    p.style.display=(p.style.display==='none'||p.style.display==='')?'block':'none';
  };
  window.setEditPricingType=function(key,type){
    var s=document.getElementById('ep_'+key+'_sized');
    var t=document.getElementById('ep_'+key+'_two');
    var f=document.getElementById('ep_'+key+'_flat');
    if(s)s.style.display=(type==='sized')?'grid':'none';
    if(t)t.style.display=(type==='two')?'grid':'none';
    if(f)f.style.display=(type==='flat')?'block':'none';
  };
  window.saveEditItem=async function(key){
    var item=deps.getMenuItemsMap()[key];if(!item){alert('Item not found.');return;}
    var catEl=document.getElementById('ep_'+key+'_cat');
    var nameEl=document.getElementById('ep_'+key+'_name');
    var descEl=document.getElementById('ep_'+key+'_desc');
    var imgEl=document.getElementById('ep_'+key+'_img');
    var ptRadio=document.querySelector('input[name="ep_pt_'+key+'"]:checked');
    if(!catEl||!nameEl||!ptRadio){alert('Could not read form fields.');return;}
    var newCat=catEl.value;
    var newName=nameEl.value.trim();
    var newDesc=descEl?descEl.value.trim():'';
    var newImg=imgEl?(imgEl.value.trim()||null):null;
    var pType=ptRadio.value;
    if(!newName){alert('Name is required.');return;}
    var updates={cat:newCat,name:newName,desc:newDesc||null,img:newImg,optionsSet:true};
    var selOg=[];var epnl=document.getElementById('ep_'+key);
    if(epnl)epnl.querySelectorAll('input[data-ogid]:checked').forEach(function(c){selOg.push(c.dataset.ogid);});
    updates.options=selOg.length?selOg:null;
    if(pType==='sized'){
      var pS=parseInt(document.getElementById('ep_'+key+'_priceS').value)||0;
      var pM=parseInt(document.getElementById('ep_'+key+'_priceM').value)||0;
      var pL=parseInt(document.getElementById('ep_'+key+'_priceL').value)||0;
      if(!pS||!pM||!pL){alert('Please fill in Small, Medium, and Large prices.');return;}
      updates.priceS=pS;updates.priceM=pM;updates.priceL=pL;
      updates.labelS=null;updates.labelL=null;
    } else if(pType==='two'){
      var lS=(document.getElementById('ep_'+key+'_labelS').value||'').trim();
      var lL=(document.getElementById('ep_'+key+'_labelL').value||'').trim();
      var tS=parseInt(document.getElementById('ep_'+key+'_priceTwoS').value)||0;
      var tL=parseInt(document.getElementById('ep_'+key+'_priceTwoL').value)||0;
      if(!lS||!lL){alert('Please enter both option labels.');return;}
      if(!tS||!tL){alert('Please enter both option prices.');return;}
      updates.priceS=tS;updates.priceM=null;updates.priceL=tL;
      updates.labelS=lS;updates.labelL=lL;
    } else {
      var pF=parseInt(document.getElementById('ep_'+key+'_priceFlat').value)||0;
      if(!pF){alert('Please enter a price.');return;}
      updates.priceS=pF;updates.priceM=null;updates.priceL=null;
      updates.labelS=null;updates.labelL=null;
    }
    var oldName=item.name;
    try{
      await update(ref(db,'menuItems/'+key),updates);
      if(newName!==oldName&&deps.getAvailability()[oldName]!==undefined){
        var wasAvail=deps.getAvailability()[oldName];
        await update(availRef,{[newName]:wasAvail,[oldName]:null});
      }
      window.toggleEditPanel(key);
      buildAvail();deps.renderMenuSection();deps.renderOrderSection();
    }catch(e){alert('Error saving: '+e.message);}
  };
  
  
  function buildAvail(){
    const el=document.getElementById('availList');if(!el)return;
    const items=deps.getMenuItems();
    if(!Object.keys(deps.getMenuItemsMap()).length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:2rem;">Loading...</p>';return;}
    const cats=deps.getCats();let html='';
    cats.forEach(function(cat){
      const catItems=items.filter(i=>i.cat===cat.id).sort((a,b)=>(a.order||0)-(b.order||0));
      html+='<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:var(--bd);margin:1.5rem 0 0.75rem;padding-bottom:0.4rem;border-bottom:2px solid var(--cd);">'+cat.icon+' '+cat.label+'</div>';
      if(!catItems.length){html+='<p style="font-size:0.82rem;color:var(--tl);padding:0.5rem 0 1rem;">No items in this category yet.</p>';return;}
      catItems.forEach(function(item){
        const ok=deps.isAvail(item.name),sid='av_'+item.key;
        const priceStr=item.priceM&&item.priceL?'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL:item.priceL&&item.labelS&&item.labelL?''+item.labelS+' ₱'+item.priceS+' · '+item.labelL+' ₱'+item.priceL:'₱'+item.priceS;
        const imgSrc=safeImageSrc(item.img);
        const imgBlock=imgSrc?'<img src="'+imgSrc+'" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
          :'<div style="width:44px;height:44px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">'+cat.icon+'</div>';
        html+='<div style="background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.85rem 1rem;margin-bottom:0.6rem;" draggable="true" data-itemkey="'+item.key+'" data-itemcat="'+cat.id+'">'
          +'<div style="display:flex;align-items:center;gap:0.75rem;">'
          +'<span style="cursor:grab;color:var(--tl);font-size:1.1rem;flex-shrink:0;user-select:none;">⠿</span>'
          +imgBlock
          +'<div style="flex:1;min-width:0;"><div style="font-size:0.9rem;font-weight:500;color:var(--bd);'+(ok?'':'text-decoration:line-through;opacity:0.5;')+'" id="'+sid+'_n">'+escHtml(item.name)+'</div><div style="font-size:0.75rem;color:var(--tl);">'+priceStr+'</div></div>'
          +'<div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0;">'
          +'<span id="'+sid+'_l" style="font-size:0.75rem;font-weight:600;padding:0.2rem 0.65rem;border-radius:999px;background:'+(ok?'#d4edda':'#fde8e8')+';color:'+(ok?'#155724':'#721c24')+';white-space:nowrap;">'+(ok?'✅ Available':'❌ Unavailable')+'</span>'
          +'<input type="checkbox" class="avail-toggle" '+(ok?'checked':'')+' data-name="'+escHtml(item.name)+'" data-sid="'+sid+'"/>'
          +'<button onclick="toggleEditPanel(\''+item.key+'\')" style="background:#fff8e1;border:1px solid #f0d080;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#7a5c00;cursor:pointer;">✏️</button>'
          +'<button data-delitem="'+item.key+'" data-delname="'+escHtml(item.name)+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️</button>'
          +'</div></div>'
          +'<div style="margin-top:0.6rem;display:flex;align-items:center;gap:0.5rem;background:#ece4d8;border:1px solid var(--cd);border-radius:6px;padding:0.45rem 0.7rem;">'
          +'<span style="font-size:0.72rem;color:var(--tl);white-space:nowrap;flex-shrink:0;">🖼️ Image URL:</span>'
          +'<input type="text" id="'+sid+'_img" value="'+imgSrc+'" placeholder="https://i.postimg.cc/..." style="flex:1;font-size:0.75rem;padding:0.25rem 0.5rem;border:1px solid var(--cd);border-radius:4px;background:#fff;color:var(--td);font-family:\'Inter\',sans-serif;"/>'
          +'<button data-saveimg="'+item.key+'" data-sid="'+sid+'" style="background:var(--bd);color:#fff;border:none;border-radius:4px;padding:0.28rem 0.7rem;font-size:0.72rem;cursor:pointer;font-family:\'Inter\',sans-serif;white-space:nowrap;flex-shrink:0;">💾 Save</button>'
          +'</div></div>';
      });
    });
    el.innerHTML=html||'<p style="color:var(--tl);text-align:center;padding:2rem;">No menu items yet. Add one above!</p>';
  
    // ── Inject edit panels ──
    el.querySelectorAll('[data-itemkey]').forEach(function(row){
      var key=row.dataset.itemkey;
      var item=deps.getMenuItemsMap()[key];if(!item)return;
      var cats=deps.getCats();
      var pType=(item.priceM&&item.priceL)?'sized':(item.priceL&&item.labelS&&item.labelL)?'two':'flat';
      var panel=document.createElement('div');
      panel.id='ep_'+key;
      panel.style.cssText='display:none;margin-top:0.75rem;padding:0.9rem;background:#f5f0ea;border:1px solid var(--cd);border-radius:8px;';
      var catOpts=cats.map(function(c){return'<option value="'+c.id+'"'+(item.cat===c.id?' selected':'')+'>'+c.icon+' '+c.label+'</option>';}).join('');
      panel.innerHTML=
        '<div style="font-size:0.78rem;font-weight:600;color:var(--bd);margin-bottom:0.6rem;text-transform:uppercase;letter-spacing:0.07em;">✏️ Edit Item</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Category</label>'
        +'<select id="ep_'+key+'_cat" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;">'+catOpts+'</select></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Name</label>'
        +'<input type="text" id="ep_'+key+'_name" value="'+escHtml(item.name)+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'</div>'
        +'<div style="margin-bottom:0.5rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Description</label>'
        +'<input type="text" id="ep_'+key+'_desc" value="'+escHtml(item.desc||'')+'" placeholder="Optional description" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div style="margin-bottom:0.45rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.25rem;text-transform:uppercase;letter-spacing:0.05em;">Pricing Type</label>'
        +'<div style="display:flex;gap:0.75rem;flex-wrap:wrap;">'
        +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
        +'<input type="radio" name="ep_pt_'+key+'" value="sized"'+(pType==='sized'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'sized\')" style="width:auto;accent-color:var(--bl);"/> Sized (S/M/L)</label>'
        +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
        +'<input type="radio" name="ep_pt_'+key+'" value="two"'+(pType==='two'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'two\')" style="width:auto;accent-color:var(--bl);"/> Two Options</label>'
        +'<label style="font-size:0.8rem;color:var(--td);display:flex;align-items:center;gap:0.3rem;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;">'
        +'<input type="radio" name="ep_pt_'+key+'" value="flat"'+(pType==='flat'?' checked':'')+' onchange="setEditPricingType(\''+key+'\',\'flat\')" style="width:auto;accent-color:var(--bl);"/> Flat Price</label>'
        +'</div></div>'
        // Sized fields
        +'<div id="ep_'+key+'_sized" style="display:'+(pType==='sized'?'grid':'none')+';grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Small (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceS" value="'+(pType==='sized'?(item.priceS||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Medium (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceM" value="'+(pType==='sized'?(item.priceM||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Large (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceL" value="'+(pType==='sized'?(item.priceL||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'</div>'
        // Two options fields
        +'<div id="ep_'+key+'_two" style="display:'+(pType==='two'?'grid':'none')+';grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem;">'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 1 Label</label>'
        +'<input type="text" id="ep_'+key+'_labelS" value="'+escHtml(item.labelS||'')+'" placeholder="e.g. Small" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 1 Price (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceTwoS" value="'+(pType==='two'?(item.priceS||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 2 Label</label>'
        +'<input type="text" id="ep_'+key+'_labelL" value="'+escHtml(item.labelL||'')+'" placeholder="e.g. Large" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'<div><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Option 2 Price (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceTwoL" value="'+(pType==='two'?(item.priceL||''):'')+'" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        +'</div>'
        // Flat field
        +'<div id="ep_'+key+'_flat" style="display:'+(pType==='flat'?'block':'none')+';margin-bottom:0.5rem;">'
        +'<label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Price (₱)</label>'
        +'<input type="number" id="ep_'+key+'_priceFlat" value="'+(pType==='flat'?(item.priceS||''):'')+'" placeholder="e.g. 195" style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/>'
        +'</div>'
        // Item options
        +'<div style="margin-bottom:0.7rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.05em;">Item Options — tick everything this item should offer</label>'
        +'<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">'+buildOptionChecklistHtml(deps.getEffectiveOptionIds(item))+'</div></div>'
        // Image URL
        +'<div style="margin-bottom:0.7rem;"><label style="font-size:0.72rem;color:var(--tl);display:block;margin-bottom:0.2rem;text-transform:uppercase;letter-spacing:0.05em;">Image URL</label>'
        +'<input type="text" id="ep_'+key+'_img" value="'+escHtml(item.img||'')+'" placeholder="https://i.postimg.cc/..." style="width:100%;background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.42rem 0.55rem;font-size:0.8rem;color:var(--td);font-family:\'Inter\',sans-serif;"/></div>'
        // Buttons
        +'<div style="display:flex;gap:0.5rem;justify-content:flex-end;">'
        +'<button onclick="toggleEditPanel(\''+key+'\')" style="background:#fff;border:1px solid var(--cd);border-radius:6px;padding:0.38rem 0.9rem;font-size:0.8rem;color:var(--tl);cursor:pointer;font-family:\'Inter\',sans-serif;">Cancel</button>'
        +'<button onclick="saveEditItem(\''+key+'\')" style="background:var(--bd);color:#fff;border:none;border-radius:6px;padding:0.38rem 0.9rem;font-size:0.8rem;cursor:pointer;font-family:\'Inter\',sans-serif;font-weight:500;">💾 Save Changes</button>'
        +'</div>';
      row.appendChild(panel);
    });
   
    // Staff mode: hide edit/delete/drag/toggle/imageURL controls
    if(deps.isStaffLoggedIn()){
      el.querySelectorAll('.avail-toggle').forEach(function(t){t.style.display='none';});
      el.querySelectorAll('[data-delitem]').forEach(function(b){b.style.display='none';});
      el.querySelectorAll('button[onclick*="toggleEditPanel"]').forEach(function(b){b.style.display='none';});
      el.querySelectorAll('[draggable]').forEach(function(r){r.removeAttribute('draggable');});
      el.querySelectorAll('[style*="cursor:grab"]').forEach(function(s){s.style.display='none';});
      el.querySelectorAll('[data-saveimg]').forEach(function(b){b.closest('div').style.display='none';});
    }
    // Wire toggles
    el.querySelectorAll('.avail-toggle').forEach(function(chk){
      chk.addEventListener('change',async function(){
        const name=this.dataset.name,sid=this.dataset.sid,ok=this.checked;
        deps.getAvailability()[name]=ok;
        const n=document.getElementById(sid+'_n'),l=document.getElementById(sid+'_l');
        if(n){n.style.textDecoration=ok?'none':'line-through';n.style.opacity=ok?'1':'0.5';}
        if(l){l.textContent=ok?'✅ Available':'❌ Unavailable';l.style.background=ok?'#d4edda':'#fde8e8';l.style.color=ok?'#155724':'#721c24';}
        deps.renderMenuSection();deps.renderOrderSection();
        await update(availRef,{[name]:ok});
      });
    });
    // Wire save image
    el.querySelectorAll('button[data-saveimg]').forEach(function(btn){
      btn.addEventListener('click',async function(){
        const key=this.dataset.saveimg,sid=this.dataset.sid;
        const input=document.getElementById(sid+'_img');if(!input)return;
        const imgUrl=input.value.trim()||null;
        await update(ref(db,'menuItems/'+key),{img:imgUrl});
        input.style.borderColor='#2d9e5f';input.style.background='#f0faf4';
        setTimeout(function(){input.style.borderColor='var(--cd)';input.style.background='#fff';},1500);
        deps.renderMenuSection();
      });
    });
    // Wire delete item
    el.querySelectorAll('button[data-delitem]').forEach(function(btn){
      btn.addEventListener('click',function(){deps.showDeletePopup(this.dataset.delname,async function(){await remove(ref(db,'menuItems/'+btn.dataset.delitem));});});
    });
    // Wire drag reorder
    let dragItemKey=null;
    el.querySelectorAll('[data-itemkey]').forEach(function(row){
      row.addEventListener('dragstart',function(){dragItemKey=this.dataset.itemkey;});
      row.addEventListener('dragover',function(e){e.preventDefault();});
      row.addEventListener('drop',async function(e){
        e.preventDefault();if(!dragItemKey||dragItemKey===this.dataset.itemkey)return;
        const cat2=this.dataset.itemcat;
        const catItems=deps.getMenuItems().filter(i=>i.cat===cat2).sort((a,b)=>(a.order||0)-(b.order||0));
        const from=catItems.findIndex(i=>i.key===dragItemKey),to=catItems.findIndex(i=>i.key===this.dataset.itemkey);
        if(from<0||to<0)return;
        const reordered=[...catItems];reordered.splice(to,0,reordered.splice(from,1)[0]);
        const updates={};reordered.forEach((item,i)=>{updates[item.key+'/order']=i;});
        await update(menuRef,updates);dragItemKey=null;
      });
    });
  }
  
  
  return{renderCategoryManager,renderOptionManager,renderNewItemOptionChecklist,renderStaffMenu,buildAvail};
}

export{createCatalogAdmin};
