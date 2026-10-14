/* 🥐 Baking — one batch card per finished bake: ingredients out of stock, finished pieces into it.
   Ingredients and cookies both sit in inventory 1240, so a card moves value between stock items and
   never changes profit. Posting and reversal happen only in the server callables. */
(function(){
'use strict';
var S={pid:'',open:false,draft:null,batch:null,inv:null,invAt:0,busy:false};
var CSS='<style>#bakingRoot .r{text-align:right}#bakingRoot .s{font-size:.72rem;color:var(--tl)}#bakingRoot .m{font-size:.78rem}#bakingRoot .p{padding:.2rem .5rem}#bakingRoot .b{padding:.35rem .8rem}#bakingRoot .f{font-weight:600;color:var(--bd)}#bakingRoot .v{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end}#bakingRoot .t{margin-top:.7rem}#bakingRoot .e{color:#8b1e1e}#bakingRoot .w{color:#8a6d1b}</style>'
,DF=[['bpname','name'],['bpemoji','emoji'],['bppastry','pastryItemId']],BF=[['bkdate','date'],['bkby','bakedBy'],['bknote','note'],['bkpieces','pieces']]
,UM={volume:['ml','l','tsp','tbsp','cup','fl oz'],weight:['mg','g','kg','lb','oz wt'],count:['pc','pcs','ea','each','dozen']};
function A(){return window.__accaza||null;}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function peso(v){return '₱'+(Number(v)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function r3(v){return Math.round((Number(v)||0)*1e3)/1e3;}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function dk(){return (window.AccazaDate&&window.AccazaDate.key)?window.AccazaDate.key():new Date().toISOString().slice(0,10);}
function me(){return (window.__posShift&&window.__posShift.staff)||'Admin';}
function st(t){return t?new Date(Number(t)).toLocaleString('en-PH'):'';}
function er(e){return String((e&&e.message)||e||'Unknown error');}
function CX(){return window.AccazaCosting||null;}
function cl(n,p){var a=A();return (!a||!a.callables||!a.callables[n])?Promise.reject(new Error('Refresh the page to load the baking service.')):Promise.resolve(a.callables[n](p)).then(function(r){return (r&&r.data)?r.data:r;});}
function pr(){var p=window.__accazaBakingProducts;return (p&&typeof p==='object')?p:{};}
function cm(){var c=window.__accazaBatchCards;return (c&&typeof c==='object')?c:{};}
function im(){return (window.inventoryMap&&typeof window.inventoryMap==='object')?window.inventoryMap:(S.inv||{});}
function it(i){return im()[i]||{};}
function iN(i){return it(i).name||i||'';}
function iU(i){return it(i).unit||'';}
function iC(i){return Number(it(i).cost)||0;}
function iS(i){return Number(it(i).stock)||0;}
function isa(i){return !!i&&(i.active===false||!!i.archivedAt);}
function acc(p){var i=it((p||{}).pastryItemId||'');return [String(i.inventoryAccount||'1240'),String(i.costAccount||'5030')];}
function pl(a){return Object.keys(pr()).map(function(k){return Object.assign({id:k},pr()[k]||{});}).filter(function(p){return a?(p.active!==false):(p.active===false);}).sort(function(x,y){return (Number(x.order)||0)-(Number(y.order)||0)||String(x.name||'').localeCompare(String(y.name||''));});}
function sel(){var l=pl(true);if(!l.some(function(p){return p.id===S.pid;}))S.pid=(l[0]||{}).id||'';return S.pid;}
function opt(cur,k){
  var r=Object.keys(im()).map(function(x){return Object.assign({id:x},im()[x]);}).filter(function(i){return (!isa(i)||i.id===cur)&&(k!=='pastry'||i.id===cur||String(i.inventoryAccount||'')==='1240');}).sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''));});
  return '<option value=""'+(cur?'':' selected')+'>— item —</option>'+r.map(function(i){return '<option value="'+esc(i.id)+'"'+(i.id===cur?' selected':'')+'>'+esc(i.name||i.id)+' ('+esc(i.unit||'')+')'+(k==='pastry'?' · '+peso(i.cost):'')+(isa(i)?' · archived':'')+'</option>';}).join('');
}
/* The unit picker on every ingredient line: the recipe unit he thinks in, as on the recipe costing
   screen. Choices stay dimension-compatible with the item's own stock unit, so an incompatible pair
   can never be picked; a custom or missing stock unit is offered alone. */
function uopts(cur,su){
  var k=String(su||'').trim().toLowerCase(),C=CX(),l=UM[(C&&C.unitInfo)?C.unitInfo(k).dim:'']||[k];
  if(k&&l.indexOf(k)<0)l=[k].concat(l);
  return l.filter(function(u,x){return u&&l.indexOf(u)===x&&(u===k||!C||C.compatible(u,k));}).map(function(u){return '<option value="'+esc(u)+'"'+(u===cur?' selected':'')+'>'+esc(u)+'</option>';}).join('');
}
function tl(l){return {itemId:l.itemId||'',qty:(l.qty!=null&&l.qty!=='')?l.qty:'',unit:l.unit||''};}
function dc(id){var p=pr()[id]||{};return {id:id,isNew:!pr()[id],name:p.name||'',emoji:p.emoji||'🥐',order:Number(p.order)||0,active:p.active!==false,pastryItemId:p.pastryItemId||'',mapping:p.mapping||null,template:((p.template||[]).length?p.template:[{}]).map(tl)};}
function bt(){if(S.batch&&S.batch.pid===S.pid)return S.batch;var l=((pr()[S.pid]||{}).template||[]).map(tl);S.batch={pid:S.pid,date:dk(),bakedBy:me(),note:'',pieces:'',lines:l.length?l:[{itemId:'',qty:'',unit:''}]};return S.batch;}
/* The typed quantity converts to the item's own stock unit for every cost and stock check; the
   payload keeps the typed quantity and unit, because the server converts authoritatively. */
function sq(s){var C=CX(),r=(C&&C.convert)?C.convert(Number(s.qty),s.unit||iU(s.itemId),iU(s.itemId)):null;return (r&&r.ok)?r.qty:null;}
function iNC(s){return '⚠ '+(s.unit||iU(s.itemId))+' cannot be converted to '+iU(s.itemId);}
function use(b){var o=[];((b||{}).lines||[]).forEach(function(l){var q=Number(l.qty)||0;if(l.itemId&&q>0)o.push({itemId:l.itemId,qty:q,unit:l.unit||iU(l.itemId)});});return o;}
function tot(b){return r3(((b||{}).lines||[]).reduce(function(s,l){var x=sq(l);return s+(x==null?0:x*iC(l.itemId));},0));}
function blk(p,b){if(!(p&&p.id))return 'Add a baking product first.';if(!(p.mapping&&p.mapping.confirmedAt))return 'Confirm the mapping before posting a card.';if(!use(b).length)return 'Add at least one ingredient with a quantity.';if(!(Number((b||{}).pieces)>=1))return 'Enter the pieces produced (at least 1).';return '';}
function T(cols,body){return '<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr>'+cols.map(function(c){return '<th'+(c[1]?' class="r"':'')+'>'+c[0]+'</th>';}).join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';}
function rw(l,pre){
  /* Every attribute is closed. Building these names by string surgery once lost the closing quote,
     which swallowed the first <option> and the quantity input into an attribute value: the ingredient
     list appeared to "snap back" to its first item, the unit picker rendered empty, and there was no
     quantity box at all. Keep this explicit. */
  var i=l.i,u=iU(l.itemId),cu=l.unit||u,C=CX(),x=sq(l),m=iC(l.itemId);
  if(u&&C&&C.compatible&&!C.compatible(cu,u))cu=u;
  var f=' data-'+pre+'f="',k='" data-'+pre+'i="'+i+'"';
  return '<tr><td><select class="pz-in"'+f+'itemId'+k+'>'+opt(l.itemId,'ing')+'</select></td>'
   +'<td><select class="pz-in"'+f+'unit'+k+'>'+uopts(cu,u)+'</select></td>'
   +'<td><input class="pz-in" type="number" step="any" style="width:90px;"'+f+'qty'+k+' value="'+esc(l.qty)+'" placeholder="0"/></td>'
   +'<td class="r">'+peso(m)+' · '+(x?peso(x*m):'—')+'</td>'
   +'<td><button class="pz-btn warn p" data-'+pre+'del="'+i+'">✕</button></td></tr>';
}
function sumLines(ls){return (ls||[]).reduce(function(s,l){var x=sq(l);return s+(x==null?0:x*iC(l.itemId));},0);}
function TOTROW(ls){return '<tr style="font-weight:700;"><td colspan="3">Total cost</td><td class="r">'+peso(sumLines(ls))+'</td><td></td></tr>';}
function R(ls,pre){return (ls||[]).map(function(l,i){return rw({itemId:l.itemId,qty:l.qty,unit:l.unit,i:i},pre);}).join('')+TOTROW(ls);}
function pv(p,b){
  var r=((b||{}).lines||[]).map(function(l){if(!l.itemId)return '';var q=Number(l.qty)||0,x=sq(l),m=iC(l.itemId),n=q<=0,u=n?'':l.unit||iU(l.itemId),v=(n||!x)?'—':peso(x*m);
   return '<tr'+(n?' style="color:var(--tl);opacity:.6;"':'')+'><td>'+esc(iN(l.itemId))+'</td><td>'+esc(u)+'</td><td class="r">'+(n?'0':esc(r3(q)))+'</td><td class="r">'+peso(m)+' · '+v+'</td><td class="s e">'+(n?'not used':(x==null?iNC(l):''))+'</td></tr>';}).join('');
  var t=tot(b),n=Number((b||{}).pieces)||0,a=acc(p);
  var g=((b||{}).lines||[]).filter(function(l){var x=sq(l);return x!=null&&iS(l.itemId)<x;}).map(function(l){return '<div class="s w">⚠ '+esc(iN(l.itemId))+' will go to '+esc(r3(iS(l.itemId)-sq(l)))+' '+esc(iU(l.itemId))+'</div>';}).join('');
  return T([['Ingredient'],['Recipe unit'],['Quantity',1],['Cost',1],['']],r)+g
   +'<div class="m t"><b>Total cost '+peso(t)+'</b> · '+esc(n)+' piece(s) · cost per piece '+peso(n>0?r3(t/n):0)+'</div>'
   +'<div class="s">Debit '+esc(a[0])+' '+esc(iN((p||{}).pastryItemId))+' · Credit '+esc(a[0])+' ingredients</div>';
}
function pn(d,ar){
  var h=ar.length?'<div class="t"><span class="pz-lbl">Archived</span><table class="pz-tbl"><tbody>'+ar.map(function(x){return '<tr><td>'+esc(x.emoji||'')+' '+esc(x.name||x.id)+'</td><td class="r"><button class="pz-btn sec p" data-bkrestore="'+esc(x.id)+'">Restore</button></td></tr>';}).join('')+'</tbody></table></div>':'';
  if(!d)return '<div class="pz-card" style="margin-bottom:.8rem;"><div class="f">No baking product selected</div><p class="pz-sub">Use ＋ Add product to configure one.</p>'+h+'</div>';
  var m=d.mapping;
  return '<div class="pz-card" style="margin-bottom:.8rem;"><div class="f">'+(d.isNew?'New baking product':'Product configuration')+'</div>'
   +'<p class="pz-sub">The pastry stock item must sit in inventory 1240 with cost account 5030. The template is the usual starting list — a card is always editable and a line at 0 is skipped.</p>'
   +'<div class="v"><div><span class="pz-lbl">Emoji</span><input class="pz-in" data-bpemoji value="'+esc(d.emoji)+'" style="width:70px;"/></div>'
   +'<div style="flex:1;min-width:170px;"><span class="pz-lbl">Name</span><input class="pz-in" data-bpname value="'+esc(d.name)+'" placeholder="e.g. Choco Chip Cookie"/></div>'
   +'<div style="flex:1;min-width:220px;"><span class="pz-lbl">Pastry stock item (1240)</span><select class="pz-in" data-bppastry>'+opt(d.pastryItemId,'pastry')+'</select></div></div>'
   +'<div class="t"><span class="pz-lbl">Template — usual ingredients for one bake</span>'+T([['Ingredient'],['Recipe unit'],['Quantity'],['Cost'],['']],R(d.template,'bp'))
   +'<button class="pz-btn sec p" data-bpadd>＋ Add line</button></div>'
   +'<div id="bkMapMsg" class="m '+(m&&m.confirmedAt?'':'s')+'"'+(m&&m.confirmedAt?' style="color:#155724;"':'')+'>'+(m&&m.confirmedAt?('✓ Mapping confirmed · '+esc(m.confirmedBy||'')+' · '+esc(st(m.confirmedAt))):'Mapping not confirmed — no card can be posted until it is.')+'</div>'
   +'<div class="v t"><button class="pz-btn ok" data-bpsave>💾 Save product</button><button class="pz-btn sec" data-bpcheck>Check mapping</button>'+(d.isNew?'':'<button class="pz-btn warn" data-bparch>Archive</button>')+'</div>'+h+'</div>';
}
function fm(p,b){
  var no=blk(p,b);
  return '<div class="pz-card" style="margin-bottom:1rem;"><div class="f">New batch card · '+esc(p.name||p.id)+'</div>'
   +'<div class="v"><div><span class="pz-lbl">Date</span><input class="pz-in" type="date" data-bkdate value="'+esc(b.date)+'"/></div>'
   +'<div><span class="pz-lbl">Baked by</span><input class="pz-in" data-bkby value="'+esc(b.bakedBy)+'" style="width:140px;"/></div>'
   +'<div style="flex:1;min-width:150px;"><span class="pz-lbl">Note (optional)</span><input class="pz-in" data-bknote value="'+esc(b.note)+'"/></div>'
   +'<div><span class="pz-lbl">Actual pieces</span><input class="pz-in" type="number" step="1" min="1" data-bkpieces value="'+esc(b.pieces)+'" style="width:80px;"/></div></div>'
   +'<div class="t"><span class="pz-lbl">Ingredients used — editable; leave a line at 0 to skip it</span>'+T([['Ingredient'],['Recipe unit'],['Quantity'],['Cost'],['']],R(b.lines,'bk'))
   +'<button class="pz-btn sec p" data-bkaddline>＋ Add line</button></div>'
   +'<div class="t"><span class="pz-lbl">Preview — what this card will post</span><div id="bkPreview">'+pv(p,b)+'</div></div>'
   +'<div id="bkWhy" class="m">'+(no?'<span class="e">'+esc(no)+'</span>':'')+'</div>'
   +'<div style="margin-top:.4rem;"><button class="pz-btn ok" id="bkPost" data-bkpost'+(no?' disabled':'')+'>Post batch</button></div>'
   +'<p class="pz-sub">Posting deducts the ingredients and adds the pieces to '+esc(iN(p.pastryItemId))+' at the server cost. Insufficient stock is allowed and flagged, never blocked.</p></div>';
}
function cr(pid){
  var cs=Object.keys(cm()).map(function(k){return Object.assign({id:k},cm()[k]||{});}).filter(function(c){return c.productId===pid;}).sort(function(a,b){return (Number(b.ts)||0)-(Number(a.ts)||0);});
  return cs.length?cs.map(function(c){var g=(c.lines||[]).some(function(l){return l.wentNegative===true;});
   return '<tr'+(c.reversed?' style="opacity:.55;text-decoration:line-through;"':'')+'><td>'+esc(c.date||'')+'</td><td class="s">'+esc(c.id)+(c.provisional===true?' <span class="w">⚠ provisional</span>':'')+(g?' <span class="e">⚠ negative stock</span>':'')+'</td>'
   +'<td class="r">'+esc(c.pieces)+'</td><td class="r">'+peso(c.totalCost)+'</td><td class="r">'+peso(c.unitCost)+'</td>'
   +'<td class="s">'+esc(c.postedBy||'')+'<div>'+esc(st(c.postedAt||c.ts))+'</div>'+(c.reversed?'<div class="e">Reversed by '+esc(c.reversedBy||'')+' — '+esc(c.reversalReason||'')+'</div>':'')+'</td>'
   +'<td class="r" style="white-space:nowrap;"><button class="pz-btn sec p" data-bkprint="'+esc(c.id)+'">🖨 Print</button> '+(c.reversed?'':'<button class="pz-btn warn p" data-bkrev="'+esc(c.id)+'">Reverse</button>')+'</td></tr>';}).join('')
   :'<tr><td colspan="7" class="s">No batch cards yet for this product.</td></tr>';
}
function ld(){S.busy=true;var a=A();if(!a||!a.get||!a.ref||!a.db){S.busy=false;S.inv=S.inv||{};S.invAt=Date.now();rd();return;}a.get(a.ref(a.db,'inventory')).then(function(s){S.inv=s.val()||{};}).catch(function(){S.inv=S.inv||{};}).then(function(){S.busy=false;S.invAt=Date.now();rd();});}
function rd(){
  var el=document.getElementById('bakingRoot'); if(!el)return;
  if(!A()){el.innerHTML='<div class="pz-card">Refresh the portal to load the baking service.</div>';return;}
  if(!window.inventoryMap&&!S.busy&&!S.inv){el.innerHTML='<div class="s" style="padding:.6rem .8rem;">Loading stock items…</div>';ld();return;}
  if(!window.inventoryMap&&S.inv&&Date.now()-S.invAt>=3e5&&!S.busy)ld();
  var pid=sel(),p=pr()[pid]||null,b=p?bt():null,ar=pl(false),d=S.open?S.draft:null,ok=!!(p&&p.mapping&&p.mapping.confirmedAt);
  el.innerHTML=CSS+'<div class="pz-h">🥐 Baking</div>'
   +'<p class="pz-sub">Record one finished bake: what it used and how many pieces came out. Write the card after baking — this is not a work-in-progress ledger. Ingredients and cookies both sit in inventory 1240, so a card moves value between stock items and never changes profit.</p>'
   +'<div class="v" style="margin-bottom:.7rem;">'+pl(true).map(function(x){return '<button class="pz-btn '+(x.id===pid?'ok':'sec')+'" data-bkpid="'+esc(x.id)+'" style="padding:.35rem .8rem;">'+esc(x.emoji||'')+' '+esc(x.name||x.id)+'</button>';}).join(' ')
   +' <button class="pz-btn sec b" data-bknew>＋ Add product</button> <button class="pz-btn '+(S.open?'ok':'sec')+' b" data-bkcfg>⚙️ Configure product</button></div>'
   +(S.open?pn(d,ar):'')
   +(!p?'<div class="pz-card" style="margin-bottom:1rem;"><p class="pz-sub">Add a baking product to start posting batch cards. Each product is one thing you bake.</p></div>'
    :!ok?'<div class="pz-card" style="margin-bottom:1rem;"><p class="pz-sub">The mapping for '+esc(p.name||p.id)+' is not confirmed, so no card can be posted. Open the configuration and press <b>Check mapping</b>.</p></div>'
    :fm(p,b))
   +'<div class="pz-card"><div class="f">Batch cards · '+esc(p?(p.name||p.id):'—')+'</div>'+T([['Date'],['Batch'],['Pieces',1],['Total cost',1],['Per piece',1],['Posted by'],['']],cr(p?p.id:''))+'</div>';
  wr(el);
}
function cap(o,fs,pre,key){
  var el=document.getElementById('bakingRoot'); if(!o||!el)return;
  fs.forEach(function(q){var x=el.querySelector('[data-'+q[0]+']');if(x)o[q[1]]=x.value;});
  var a=o[key]||(o[key]=[]);
  el.querySelectorAll('[data-'+pre+'f]').forEach(function(f){var i=+f.getAttribute('data-'+pre+'i'),k=f.getAttribute('data-'+pre+'f');a[i]=a[i]||{itemId:'',qty:'',unit:''};a[i][k]=f.value;});
}
function lv(){
  var p=pr()[S.pid]||null,b=S.batch||bt(),x=document.getElementById('bkPreview');
  if(x)x.innerHTML=pv(p,b);
  var no=blk(p,b),y=document.getElementById('bkWhy');
  if(y)y.innerHTML=no?'<span class="e">'+esc(no)+'</span>':'';
  var z=document.getElementById('bkPost'); if(z)z.disabled=!!no;
}
function ms(t,bad){var m=document.getElementById('bkMapMsg');if(!m){alert(t);return;}m.className='m';m.style.color=bad?'#8b1e1e':'#155724';m.innerHTML=esc(t);}
function put(id,patch,ok){var a=A();if(!a)return;a.update(a.ref(a.db,'bakingProducts/'+id),patch).then(function(){rd();if(ok)alert(ok);}).catch(function(e){ms('Could not save: '+er(e),true);});}
function nw(){S.draft={id:uid('bp_'),isNew:true,name:'',emoji:'🥐',order:pl(false).length+1,active:true,pastryItemId:'',mapping:null,template:[{itemId:'',qty:'',unit:''}]};S.open=true;rd();}
function sv(){
  var d=S.draft; if(!d)return;
  cap(d,DF,'bp','template');
  var nm=String(d.name||'').trim();
  if(!nm){ms('Give the baking product a name.',true);return;}
  if(!d.pastryItemId){ms('Choose the pastry stock item this product makes.',true);return;}
  var tpl=(d.template||[]).filter(function(l){return l.itemId;}).map(function(l){return {itemId:l.itemId,qty:Number(l.qty)||0,unit:l.unit||iU(l.itemId)};});
  if(!tpl.length){ms('Add at least one template ingredient.',true);return;}
  var a=A(); if(!a)return;
  var old=pr()[d.id]||{},chg=String(old.pastryItemId||'')!==String(d.pastryItemId)||(old.template||[]).map(function(l){return l.itemId;}).join()!==tpl.map(function(l){return l.itemId;}).join();
  var keep=(!chg&&old.mapping&&old.mapping.confirmedAt)?old.mapping:null,node=a.ref(a.db,'bakingProducts/'+d.id);
  var rec={name:nm,emoji:String(d.emoji||'').trim()||'🥐',order:Number(d.order)||0,active:d.active!==false,pastryItemId:d.pastryItemId,template:tpl,createdAt:Number(old.createdAt)||Date.now(),createdBy:old.createdBy||me(),mapping:keep};
  (pr()[d.id]?a.update(node,rec):a.set(node,rec)).then(function(){
    var was=!!(old.mapping&&old.mapping.confirmedAt);
    S.pid=d.id;S.draft=null;S.open=false;S.batch=null;rd();
    alert(!keep&&was?'Product saved. The mapping was cleared because the pastry item or the ingredient list changed — press Check mapping again.':'Baking product saved.');
  }).catch(function(e){ms('Could not save: '+er(e),true);});
}
function ck(){
  var d=S.draft; if(!d)return;
  cap(d,DF,'bp','template');
  if(!pr()[d.id]){ms('Save the product first, then confirm its mapping.',true);return;}
  ms('Checking the mapping against the stock items…',false);
  cl('checkBakingMapping',{productId:d.id}).then(function(r){
    var mp={confirmedAt:Number(r&&r.confirmedAt)||Date.now(),confirmedBy:String((r&&r.confirmedBy)||me()),fingerprint:String((r&&r.fingerprint)||'')};
    d.mapping=mp; /* the server stored the confirmation; the browser never authors it */
    ms('✓ Mapping confirmed · '+mp.confirmedBy+' · '+st(mp.confirmedAt),false);
    rd();
  }).catch(function(e){ms(er(e),true);});
}
function arn(){
  var d=S.draft; if(!d||!pr()[d.id])return;
  if(!confirm('Archive this baking product? Its sub-tab disappears and no new cards can be posted. Its cards and printed pages stay.'))return;
  cap(d,DF,'bp','template');
  var id=d.id; S.draft=null; S.open=true;
  put(id,{active:false},'Product archived. It stays under Archived and its batch cards are untouched.');
}
function po(){
  var p=pr()[S.pid]||null,b=S.batch||bt(),no=blk(p,b);
  if(no){alert(no);return;}
  var btn=document.getElementById('bkPost'); if(btn){btn.disabled=true;btn.textContent='Posting…';}
  cl('postBatchCard',{productId:p.id,lines:use(b).map(function(l){return {itemId:l.itemId,qty:l.qty,unit:l.unit};}),pieces:Number(b.pieces),bakedBy:String(b.bakedBy||'').trim()||me(),note:String(b.note||'').trim()})
   .then(function(res){
    var c=(res&&res.card)?res.card:res; S.batch=null;
    if(c&&c.id&&confirm('Batch card posted.\n\n'+c.id+' · '+Number(c.pieces||0)+' piece(s) · '+peso(c.totalCost)+'\n\nPrint it now?'))pt(c);
    rd();
   }).catch(function(e){if(btn){btn.disabled=false;btn.textContent='Post batch';}alert('Could not post the batch card: '+er(e)+' Nothing was changed.');});
}
function rv(id){
  var c=cm()[id]; if(!c||c.reversed)return;
  var fd=window.AccazaFormDialog;
  if(!fd||!fd.run){alert('The control-record form is still loading. Try again in a moment.');return;}
  fd.run({title:'Reverse batch card '+id,subtitle:'Ingredients go back into stock and the pieces come out of '+iN(c.pastryItemId)+'. Every amount reverses exactly as posted. A reversal is permanent — the card is never edited.',submitLabel:'Reverse batch card',fields:[{name:'reason',label:'Reason',required:true,maxLength:300,placeholder:'e.g. wrong ingredient quantity entered'}]},function(v){
    var reason=String(v.reason||'').trim();
    if(reason.length<5)return Promise.reject(new Error('Enter a reason of at least 5 characters.'));
    return cl('reverseBatchCard',{batchId:id,reason:reason}).then(function(){
      c.reversed=true;c.reversedAt=Date.now();c.reversedBy=me();c.reversalReason=reason;
      rd(); alert('Batch card reversed. Ingredients are back in stock and the pieces were removed.');
    }).catch(function(e){alert('Could not reverse the batch card: '+er(e)+' Nothing was changed.');});
  });
}
function pt(c){
  if(!c){alert('Batch card not found.');return;}
  var w=window.open('','_blank','width=380,height=680'); if(!w){alert('Allow pop-ups to print the batch card.');return;}
  var a=acc(c),d1=st(c.ts),d2=st(c.postedAt),d3=st(c.reversedAt);
  var ls=(c.lines||[]).map(function(l){return '<tr><td>'+esc(l.itemName||l.itemId)+'</td><td class="r">'+esc(r3(l.qty))+' '+esc(l.unit||'')+'</td><td class="r">'+peso(l.unitCost)+'</td><td class="r">'+peso(l.value)+'</td></tr>';}).join('');
  w.document.write('<html><head><title>'+esc(c.id||'')+'</title><style>*{font:12px monospace}body{padding:10px}h2,h3{text-align:center;margin:2px 0}table{width:100%;border-collapse:collapse}.r{text-align:right}hr{border:0;border-top:1px dashed #000}@media print{button{display:none}}</style></head><body>'
  +'<h2>Accaza — Baking Batch Card</h2><h3>'+esc(c.productName||'')+'</h3><hr>'
  +'<div>Batch: '+esc(c.id||'')+'</div><div>Date: '+esc(c.date||d1)+(c.date&&d1?' · '+esc(d1):'')+'</div>'
  +'<div>Baked by: '+esc(c.bakedBy||'')+'</div><div>Posted by: '+esc(c.postedBy||'')+(d2?' · '+esc(d2):'')+'</div><hr>'
  +'<table><tr><td><b>Ingredient</b></td><td class="r"><b>Qty</b></td><td class="r"><b>Unit ₱</b></td><td class="r"><b>Value</b></td></tr>'+ls+'</table><hr>'
  +'<table><tr><td><b>Total batch cost</b></td><td class="r"><b>'+peso(c.totalCost)+'</b></td></tr>'
  +'<tr><td><b>Actual pieces produced</b></td><td class="r"><b>'+esc(c.pieces)+'</b></td></tr>'
  +'<tr><td><b>Cost per piece</b></td><td class="r"><b>'+peso(c.unitCost)+'</b></td></tr></table><hr>'
  +'<div>Debit '+esc(a[0])+' '+esc(c.pastryItemName||'finished pieces')+' — '+esc(c.pieces)+' pc at '+peso(c.unitCost)+'</div>'
  +'<div>Credit '+esc(a[0])+' ingredients used — '+peso(c.totalCost)+'</div>'
  +'<div>Checked by: ______</div>'
  +(c.reversed?'<div><b>REVERSED</b> by '+esc(c.reversedBy||'')+(d3?' on '+esc(d3):'')+'</div>':'')
  +'<div style="text-align:center;margin-top:8px;"><button onclick="window.print()">Print</button></div></body></html>');
  w.document.close();
}
function W(el,s,f){el.querySelectorAll(s).forEach(function(x){x.onclick=function(){f(x.getAttribute(s.slice(1,-1)));};});}
function wr(el){
  var d=S.open?S.draft:null,b=S.batch,BP=function(){cap(d,DF,'bp','template');},BK=function(){cap(b,BF,'bk','lines');};
  W(el,'[data-bkpid]',function(v){S.pid=v;S.draft=null;S.batch=null;S.open=false;rd();});
  W(el,'[data-bknew]',nw);
  W(el,'[data-bkcfg]',function(){S.open=!S.open;if(S.open&&!(S.draft&&S.draft.isNew))S.draft=S.pid?dc(S.pid):null;rd();});
  W(el,'[data-bkrestore]',function(v){if(confirm('Restore this baking product? Its sub-tab comes back.')){S.pid=v;put(v,{active:true},'Product restored.');}});
  W(el,'[data-bkprint]',function(v){pt(cm()[v]);});
  W(el,'[data-bkrev]',function(v){rv(v);});
  if(d){
    W(el,'[data-bpsave]',sv); W(el,'[data-bpcheck]',ck); W(el,'[data-bparch]',arn);
    W(el,'[data-bpdel]',function(v){BP();d.template.splice(+v,1);if(!d.template.length)d.template=[{itemId:'',qty:'',unit:''}];rd();});
    W(el,'[data-bpadd]',function(){BP();d.template.push({itemId:'',qty:'',unit:''});rd();});
    el.querySelectorAll('[data-bpf]').forEach(function(f){f[f.tagName==='SELECT'?'onchange':'oninput']=function(){BP();if(f.tagName==='SELECT')rd();};});
  }
  if(!b)return;
  el.querySelectorAll('[data-bkdate],[data-bkby],[data-bknote]').forEach(function(i){i.oninput=function(){BK();};});
  el.querySelectorAll('[data-bkpieces],[data-bkf]').forEach(function(f){f[f.tagName==='SELECT'?'onchange':'oninput']=function(){BK();if(f.tagName==='SELECT')rd();else lv();};});
  W(el,'[data-bkdel]',function(v){BK();b.lines.splice(+v,1);if(!b.lines.length)b.lines=[{itemId:'',qty:'',unit:''}];rd();});
  W(el,'[data-bkaddline]',function(){BK();b.lines.push({itemId:'',qty:'',unit:''});rd();});
  W(el,'[data-bkpost]',po);
}
window.__accazaRenderBaking=rd;
})();
