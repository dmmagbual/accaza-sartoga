(function(){
'use strict';
function C(){if(!window.__accazaChannelPricing)throw new Error('Channel-pricing bridge is not ready.');return window.__accazaChannelPricing;}
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}
function isTab(name){var el=document.getElementById('tab-'+name);return el&&el.style.display!=='none';}
function channelsCfg(){return C().channelsCfg();}
function channelPriceOf(ch,key,size){return C().channelPriceOf(ch,key,size);}
function channelOptPrice(ch,gid,label){return C().channelOptPrice(ch,gid,label);}
function chOptKey(gid,label){return C().chOptKey(gid,label);}
function allOptionChoices(){return C().allOptionChoices();}
function menuList(){return C().menuList();}
var POS_CHANNELS=C().channels;
/* ══════════ CHANNEL PRICING (GrabFood / FoodPanda) ══════════ */
function renderChannelPricing(){
  var root=document.getElementById('channelPricingRoot'); if(!root)return;
  var cfg=channelsCfg(); var items=menuList();
  var rows=items.map(function(it){
    function inp(ch,sz){var v=channelPriceOf(ch,it.key,sz);return '<input class="pz-in" type="number" step="any" data-cp="'+ch+'" data-ck="'+esc(it.key)+'" data-cs="'+sz+'" value="'+(v||'')+'" style="width:62px;text-align:right;padding:0.15rem 0.25rem;" placeholder="0"/>';}
    var single=!(Number(it.priceM))&&!(Number(it.priceL));
    if(single){ return '<tr><td style="white-space:nowrap;">'+esc(it.name)+' <span style="font-size:0.68rem;color:var(--tl);">(single)</span></td><td colspan="3" style="text-align:center;">'+inp('grabfood','S')+'</td><td colspan="3" style="text-align:center;">'+inp('foodpanda','S')+'</td></tr>'; }
    return '<tr><td style="white-space:nowrap;">'+esc(it.name)+'</td><td>'+inp('grabfood','S')+'</td><td>'+inp('grabfood','M')+'</td><td>'+inp('grabfood','L')+'</td><td>'+inp('foodpanda','S')+'</td><td>'+inp('foodpanda','M')+'</td><td>'+inp('foodpanda','L')+'</td></tr>';
  }).join('');
  var opts=allOptionChoices();
  var optRows=opts.map(function(o){
    function oinp(ch){var v=channelOptPrice(ch,o.gid,o.label);return '<input class="pz-in" type="number" step="any" data-op="'+ch+'" data-ogid="'+esc(o.gid)+'" data-olabel="'+esc(o.label)+'" value="'+(v||'')+'" style="width:82px;text-align:right;padding:0.15rem 0.25rem;" placeholder="0"/>';}
    return '<tr><td style="white-space:nowrap;">'+esc(o.gname)+' · '+esc(o.label)+' <span style="font-size:0.7rem;color:var(--tl);">(in-store ₱'+o.price+')</span></td><td>'+oinp('grabfood')+'</td><td>'+oinp('foodpanda')+'</td></tr>';
  }).join('');
  root.innerHTML='<div class="pz-h">💱 Channel Pricing</div>'
    +'<p class="pz-sub">Grab &amp; Panda menu prices — the price the customer pays on the platform (your gross revenue). Item prices are per size; add-on prices are one price each, used across every item. Keep these in sync with the live platform menus. Commission is deducted per platform at checkout.</p>'
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Platform deduction rates (% of gross)</div>'
      +POS_CHANNELS.map(function(d){return '<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:end;margin-bottom:0.5rem;"><div style="min-width:90px;font-weight:600;color:var(--bd);align-self:center;">'+d.lbl+'</div><div><span class="pz-lbl">Commission %</span><input class="pz-in" type="number" step="any" id="crate_'+d.k+'" value="'+(cfg[d.k].rate*100)+'" style="width:90px;"/></div><div><span class="pz-lbl">Withholding tax %</span><input class="pz-in" type="number" step="any" id="cwht_'+d.k+'" value="'+(cfg[d.k].wht*100)+'" style="width:100px;"/></div><div><span class="pz-lbl">VAT on services %</span><input class="pz-in" type="number" step="any" id="cvat_'+d.k+'" value="'+(cfg[d.k].vat*100)+'" style="width:100px;"/></div></div>';}).join('')
      +'<button class="pz-btn sec" id="cpRateSave">Save rates</button><div style="font-size:0.72rem;color:var(--tl);margin-top:0.2rem;">Discount is entered per order at checkout. All four (commission, discount, WHT, VAT) are deducted from gross.</div></div>'
    +'<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;"><button class="pz-btn sec" id="cpExport">⬇ Export Excel</button><button class="pz-btn sec" id="cpTemplate">⬇ Import template</button><button class="pz-btn ok" id="cpImportBtn">⬆ Import Excel</button><input type="file" id="cpImportFile" accept=".xlsx,.xls,.csv" style="display:none;"/></div>'
    +'<div class="pz-card" style="margin-bottom:1rem;"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Item prices</div><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Item</th><th colspan="3" style="text-align:center;">GrabFood S / M / L</th><th colspan="3" style="text-align:center;">FoodPanda S / M / L</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7" style="color:var(--tl);padding:0.6rem;">No menu items.</td></tr>')+'</tbody></table></div></div>'
    +'<div class="pz-card"><div style="font-weight:600;color:var(--bd);margin-bottom:0.5rem;">Add-on prices</div><p class="pz-sub" style="margin-top:0;">One price per add-on, applied on every item for that platform. Blank = ₱0 (free) on the platform.</p><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Add-on</th><th style="text-align:center;">GrabFood ₱</th><th style="text-align:center;">FoodPanda ₱</th></tr></thead><tbody>'+(optRows||'<tr><td colspan="3" style="color:var(--tl);padding:0.6rem;">No add-ons defined.</td></tr>')+'</tbody></table></div><div style="margin-top:0.8rem;"><button class="pz-btn ok" id="cpSave">💾 Save all prices</button></div></div>';
  document.getElementById('cpSave').onclick=saveChannelPrices;
  document.getElementById('cpRateSave').onclick=function(){var a=A();var ch={};POS_CHANNELS.forEach(function(d){ch[d.k]={label:d.lbl,rate:(Number(document.getElementById('crate_'+d.k).value)||0)/100,wht:(Number(document.getElementById('cwht_'+d.k).value)||0)/100,vat:(Number(document.getElementById('cvat_'+d.k).value)||0)/100,active:true};});a.update(a.ref(a.db,'posSettings'),{channels:ch}).then(function(){alert('Platform deduction rates saved.');});};
  document.getElementById('cpExport').onclick=exportChannelPrices;
  document.getElementById('cpTemplate').onclick=channelTemplate;
  var ib=document.getElementById('cpImportBtn'),ifl=document.getElementById('cpImportFile');
  if(ib&&ifl){ib.onclick=function(){ifl.value='';ifl.click();};ifl.onchange=function(){if(ifl.files&&ifl.files[0])importChannelPrices(ifl.files[0]);};}
}
function saveChannelPrices(){
  // Targeted, non-destructive update. Cleared/zero boxes write null (delete the field)
  // so setting a price to 0 actually sticks. Fails loud instead of a false "saved".
  var upd={},changed=0;
  document.querySelectorAll('[data-cp]').forEach(function(inp){var ch=inp.getAttribute('data-cp'),k=inp.getAttribute('data-ck'),sz=inp.getAttribute('data-cs');var v=Number(inp.value)||0;upd['channelPrices/'+ch+'/'+k+'/'+sz]=v?v:null;changed++;});
  document.querySelectorAll('[data-op]').forEach(function(inp){var ch=inp.getAttribute('data-op'),gid=inp.getAttribute('data-ogid'),lb=inp.getAttribute('data-olabel');var v=Number(inp.value)||0;upd['channelPrices/'+ch+'/__opt/'+chOptKey(gid,lb)]=v?v:null;changed++;});
  var a=A();
  a.update(a.ref(a.db),upd).then(function(){
    // Re-read the authoritative server copy, refresh the in-memory map, and repaint —
    // so the boxes reflect the DB, not a stale live-sync cache.
    a.get(a.ref(a.db,'channelPrices')).then(function(s){
      var srv=s.val()||{};
      C().setPrices(srv);
      // Verify every field we just wrote actually matches the server.
      var bad=[];
      Object.keys(upd).forEach(function(p){
        var want=Number(upd[p])||0, parts=p.split('/'), cur=srv;
        for(var i=1;i<parts.length;i++){cur=(cur&&cur[parts[i]]!=null)?cur[parts[i]]:undefined;}
        if((Number(cur)||0)!==want)bad.push(p+' → wanted '+want+', server has '+(Number(cur)||0));
      });
      if(isTab('channelpricing'))renderChannelPricing();
      if(bad.length){console.warn('[channelPrices ✗ MISMATCH]',bad);alert('Saved, but '+bad.length+' value(s) did NOT match on the server — press F12 → Console and send me the red line.');}
      else{console.log('[channelPrices ✓] all '+changed+' field(s) verified on server.');alert('Channel prices saved & verified. ✅');}
    });
  }).catch(function(e){console.error('channelPrices SAVE FAILED',e);alert('SAVE FAILED — nothing was written: '+((e&&e.message)||e)+'\n\nMost likely your admin session or database rules. Send me the console error.');});
}
function exportChannelPrices(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var aoa=[['itemKey','item','grab_S','grab_M','grab_L','panda_S','panda_M','panda_L']];
  menuList().forEach(function(it){aoa.push([it.key,it.name,channelPriceOf('grabfood',it.key,'S')||'',channelPriceOf('grabfood',it.key,'M')||'',channelPriceOf('grabfood',it.key,'L')||'',channelPriceOf('foodpanda',it.key,'S')||'',channelPriceOf('foodpanda',it.key,'M')||'',channelPriceOf('foodpanda',it.key,'L')||'']);});
  var oaoa=[['groupId','group','addon','grab','panda']];
  allOptionChoices().forEach(function(o){oaoa.push([o.gid,o.gname,o.label,channelOptPrice('grabfood',o.gid,o.label)||'',channelOptPrice('foodpanda',o.gid,o.label)||'']);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'ChannelPrices');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(oaoa),'AddOns');XLSX.writeFile(wb,'accaza-channel-prices-'+new Date().toISOString().slice(0,10)+'.xlsx');
}
function channelTemplate(){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var aoa=[['itemKey','item','grab_S','grab_M','grab_L','panda_S','panda_M','panda_L']];
  menuList().forEach(function(it){aoa.push([it.key,it.name,'','','','','','']);});
  var oaoa=[['groupId','group','addon','grab','panda']];
  allOptionChoices().forEach(function(o){oaoa.push([o.gid,o.gname,o.label,'','']);});
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'ChannelPrices');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(oaoa),'AddOns');XLSX.writeFile(wb,'accaza-channel-prices-template.xlsx');
}
function importChannelPrices(file){
  if(!window.XLSX){alert('Excel library still loading — try again.');return;}
  var rd=new FileReader();rd.onload=function(e){
    try{var wb=XLSX.read(e.target.result,{type:'array'});var sh=wb.Sheets['ChannelPrices']||wb.Sheets[wb.SheetNames[0]];var rows=XLSX.utils.sheet_to_json(sh,{defval:''});
      var itemByName={};menuList().forEach(function(it){itemByName[(it.name||'').trim().toLowerCase()]=it.key;});
      var byCh={grabfood:Object.assign({},C().getPrices().grabfood||{}),foodpanda:Object.assign({},C().getPrices().foodpanda||{})};var n=0;
      byCh.grabfood.__opt=Object.assign({},(C().getPrices().grabfood||{}).__opt||{});
      byCh.foodpanda.__opt=Object.assign({},(C().getPrices().foodpanda||{}).__opt||{});
      rows.forEach(function(r){var key=String(r.itemKey||'').trim();if(!key){var nm=String(r.item||'').trim().toLowerCase();key=nm?(itemByName[nm]||''):'';}if(!key)return;
        function setp(ch,pre){var o={};['S','M','L'].forEach(function(sz){var v=Number(r[pre+sz])||0;if(v)o[sz]=v;});if(Object.keys(o).length)byCh[ch][key]=o;}
        setp('grabfood','grab_');setp('foodpanda','panda_');n++;});
      var osh=wb.Sheets['AddOns'];var m=0;
      if(osh){XLSX.utils.sheet_to_json(osh,{defval:''}).forEach(function(r){var gid=String(r.groupId||'').trim();var lb=String(r.addon||'').trim();if(!gid||!lb)return;var gk=chOptKey(gid,lb);var gp=Number(r.grab)||0,pp=Number(r.panda)||0;if(gp)byCh.grabfood.__opt[gk]=gp;if(pp)byCh.foodpanda.__opt[gk]=pp;m++;});}
      if(!Object.keys(byCh.grabfood.__opt).length)delete byCh.grabfood.__opt;
      if(!Object.keys(byCh.foodpanda.__opt).length)delete byCh.foodpanda.__opt;
      var a=A();a.set(a.ref(a.db,'channelPrices'),byCh).then(function(){alert('Imported '+n+' item row(s) and '+m+' add-on row(s).');});
    }catch(err){alert('Could not read that file: '+err);}
  };rd.readAsArrayBuffer(file);
}

window.__accazaRenderChannelPricing=renderChannelPricing;
window.__accazaRegisterModule('channelpricing',function(name){if(name!=='channelpricing')return;var a=A();a.get(a.ref(a.db,'channelPrices')).then(function(s){C().setPrices(s.val()||{});renderChannelPricing();}).catch(function(){renderChannelPricing();});});
})();

