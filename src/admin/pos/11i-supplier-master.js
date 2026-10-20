/* ══════════ SUPPLIER MASTER LIST (Oct 2026) ══════════
   One shared supplier record for Purchases, Cash Payments, Payables and Finance Books, now
   with the contact person and the BIR details a purchase listing needs (registered name,
   TIN + branch, VAT status, address). The server (manageSupplier) validates every field,
   keeps one supplier per TIN + branch and audits each change; this screen only displays and
   collects. Search and filters run on the supplier list already loaded — no extra reads. */
var SUPPLIER_VAT_LABELS={vat:'VAT-registered',non_vat:'Non-VAT',unknown:'Unknown'};
function allSuppliersForList(){return Object.keys(supplierMap).map(function(id){return Object.assign({id:id},supplierMap[id]);}).sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'});});}
function supplierTinText(x){var t=String(x&&x.tin||'').replace(/\D/g,'');return t.length===9?t.slice(0,3)+'-'+t.slice(3,6)+'-'+t.slice(6)+'-'+(String(x.branchCode||'').replace(/\D/g,'')||'00000'):'';}
function supplierIsCurrent(x){return !x.mergedInto&&x.active!==false;}
function supplierListView(){return window.__supplierListView||(window.__supplierListView={q:'',filter:'active'});}
function supplierListRows(){
  var v=supplierListView(),q=String(v.q||'').trim().toLowerCase();
  return allSuppliersForList().filter(function(x){
    var current=supplierIsCurrent(x);
    if(v.filter==='active'&&!current)return false;
    if(v.filter==='inactive'&&current)return false;
    if(v.filter==='missing_tin'&&(!current||supplierTinText(x)))return false;
    return !q||[x.name,x.registeredName,x.contactPerson,x.phone,x.email,x.tin,supplierTinText(x)].join(' ').toLowerCase().indexOf(q)>=0;
  });
}
function supplierListSummary(){var c={active:0,inactive:0,missing:0};allSuppliersForList().forEach(function(x){if(supplierIsCurrent(x)){c.active++;if(!supplierTinText(x))c.missing++;}else c.inactive++;});return c.active+' active · '+c.inactive+' inactive or merged · '+c.missing+' active without a TIN';}
function supplierRowHtml(x){
  var tin=supplierTinText(x),vat=String(x.vatStatus||'unknown'),current=supplierIsCurrent(x),survivor=x.mergedInto&&supplierMap[x.mergedInto];
  var name='<b>'+esc(x.name||'')+'</b>'+(x.registeredName&&x.registeredName!==x.name?'<small>'+esc(x.registeredName)+'</small>':'')+(x.address?'<small>'+esc(x.address)+'</small>':'');
  var contact=[x.contactPerson?'<b>'+esc(x.contactPerson)+'</b>':'',x.phone?'<a href="tel:'+esc(String(x.phone).replace(/[^+0-9]/g,''))+'">'+esc(x.phone)+'</a>':'',x.email?'<a href="mailto:'+esc(x.email)+'">'+esc(x.email)+'</a>':''].filter(Boolean).map(function(s,i){return i?'<small>'+s+'</small>':s;}).join('')||'<span class="tiny">—</span>';
  var tax=(tin?'<span style="font-variant-numeric:tabular-nums;">'+esc(tin)+'</span><br>':'')+(tin?'':'<span class="sup-badge missing">No TIN</span> ')+(vat==='vat'||vat==='non_vat'?'<span class="sup-badge '+vat+'">'+SUPPLIER_VAT_LABELS[vat]+'</span>':(tin?'<span class="sup-badge">VAT status unknown</span>':''));
  var status=x.mergedInto?('<span style="color:#7a6a58;">Merged into '+esc((survivor&&survivor.name)||x.mergedInto)+'</span>'):(x.active===false?'<span style="color:#c0392b;">Inactive</span>':'<span style="color:#155724;">Active</span>');
  var act=x.mergedInto?'<span class="tiny">Kept for the audit trail</span>':'<select class="pz-in sup-act" data-supplier-action="'+esc(x.id)+'" aria-label="Actions for '+esc(x.name||'supplier')+'"><option value="">Actions…</option><option value="edit">Edit details</option><option value="merge">Merge into…</option>'+(current?'<option value="deactivate">Deactivate</option>':'<option value="reactivate">Reactivate</option>')+'<option value="delete">Delete</option></select>';
  return '<tr><td data-l="Supplier">'+name+'</td><td data-l="Contact">'+contact+'</td><td data-l="TIN · VAT">'+tax+'</td><td data-l="Status">'+status+'</td><td>'+act+'</td></tr>';
}
function supplierListBody(m){
  var rows=supplierListRows(),body=m.querySelector('[data-supplier-rows]'),sum=m.querySelector('[data-supplier-summary]');
  if(sum)sum.textContent=supplierListSummary();
  body.innerHTML=rows.length?rows.map(supplierRowHtml).join(''):'<tr><td colspan="5">'+(Object.keys(supplierMap).length?'No supplier matches this search.':'No suppliers yet.')+'</td></tr>';
  body.querySelectorAll('[data-supplier-action]').forEach(function(s){s.onchange=function(){var id=s.getAttribute('data-supplier-action'),act=s.value;s.value='';if(act)supplierAction(id,act);};});
}
function showSupplierList(){
  var old=document.getElementById('supplierListMask');if(old)old.remove();
  var v=supplierListView(),m=document.createElement('div');m.id='supplierListMask';m.className='pz-mask show';
  var filters=[['active','Active suppliers'],['missing_tin','Active, missing TIN'],['inactive','Inactive or merged'],['all','All suppliers']];
  m.innerHTML='<div class="pz-modal sup-modal"><div style="display:flex;justify-content:space-between;gap:1rem;"><div class="pz-h">Suppliers</div><button class="pz-btn sec" data-supplier-list-close aria-label="Close">✕</button></div><p class="pz-sub">One shared supplier record used across Purchases, Cash Payments, Payables and Finance Books. The TIN, registered name and address feed the BIR purchase listing for VAT filing.</p>'
    +'<div class="sup-tools"><input class="pz-in" type="search" data-supplier-search placeholder="Search name, contact, phone, email or TIN" value="'+esc(v.q||'')+'"/><select class="pz-in" data-supplier-filter>'+filters.map(function(f){return '<option value="'+f[0]+'"'+(v.filter===f[0]?' selected':'')+'>'+f[1]+'</option>';}).join('')+'</select><button class="pz-btn ok" data-supplier-add>＋ Add supplier</button></div>'
    +'<div class="tiny" data-supplier-summary style="margin-bottom:.4rem;"></div><div class="pz-card" style="overflow:auto;max-height:60vh;padding:0;"><table class="pz-table sup-table" style="width:100%;"><thead><tr><th>Supplier</th><th>Contact</th><th>TIN · VAT</th><th>Status</th><th></th></tr></thead><tbody data-supplier-rows></tbody></table></div><button class="pz-btn ok" data-supplier-list-close style="width:100%;margin-top:0.8rem;">Close</button></div>';
  document.body.appendChild(m);
  supplierListBody(m);
  m.querySelectorAll('[data-supplier-list-close]').forEach(function(b){b.onclick=function(){m.remove();};});
  var q=m.querySelector('[data-supplier-search]');q.oninput=function(){v.q=q.value;supplierListBody(m);};
  var f=m.querySelector('[data-supplier-filter]');f.onchange=function(){v.filter=f.value;supplierListBody(m);};
  m.querySelector('[data-supplier-add]').onclick=function(){supplierAction('','create');};
}
function supplierListRefresh(){var m=document.getElementById('supplierListMask');if(m)supplierListBody(m);if(typeof renderPurchases==='function')renderPurchases();}
function supplierFail(label,e){if(String((e&&e.code)||e).indexOf('cancelled')<0)alert('Could not '+label+': '+((e&&e.message)||e));}
function supplierDetailsForm(id){
  var row=id?(supplierMap[id]||{}):{},creating=!id;
  return F().run({title:creating?'Add supplier':'Edit '+(row.name||'supplier'),width:'640px',
    subtitle:'Historical purchases, payments and payables keep the name printed on them. The TIN, registered name and address are used for the BIR purchase listing; every change is recorded in the audit trail.',
    submitLabel:creating?'Create supplier':'Save supplier',busyLabel:'Saving…',fields:[
    {name:'name',label:'Supplier name (as used in Accaza)',required:true,maxLength:120,value:row.name||''},
    {name:'registeredName',label:'Registered business name',maxLength:160,value:row.registeredName||'',help:'As printed on the supplier\'s BIR Certificate of Registration (Form 2303) or official receipt.'},
    {name:'tin',label:'TIN',maxLength:17,placeholder:'123-456-789',value:supplierTinText(row).slice(0,11),validate:function(v){var d=String(v||'').replace(/\D/g,'');return d&&d.length!==9&&(d.length<12||d.length>14)?'TIN must be 9 digits (example: 123-456-789), or 12–14 with its branch.':'';}},
    {name:'branchCode',label:'Branch code',maxLength:5,placeholder:'00000',value:row.tin?(row.branchCode||'00000'):'',help:'00000 for the head office.'},
    {name:'vatStatus',label:'VAT status',type:'select',value:row.vatStatus||'unknown',options:[{value:'vat',label:'VAT-registered (issues VAT invoices)'},{value:'non_vat',label:'Non-VAT'},{value:'unknown',label:'Unknown'}],validate:function(v,values){return v==='vat'&&!String(values.tin||'').replace(/\D/g,'')?'A VAT-registered supplier needs its TIN — input VAT cannot be claimed without it.':'';}},
    {name:'address',label:'Registered address',type:'textarea',rows:2,maxLength:240,value:row.address||''},
    {name:'contactPerson',label:'Contact person',maxLength:120,value:row.contactPerson||''},
    {name:'phone',label:'Phone',type:'tel',maxLength:40,value:row.phone||''},
    {name:'email',label:'Email',type:'email',maxLength:120,value:row.email||''},
    {name:'notes',label:'Notes',type:'textarea',rows:2,maxLength:300,value:row.notes||'',help:'For example ordering days, delivery terms or account number references.'}
  ]},function(v){var details={registeredName:v.registeredName,tin:v.tin,branchCode:v.branchCode,vatStatus:v.vatStatus,address:v.address,contactPerson:v.contactPerson,phone:v.phone,email:v.email,notes:v.notes};
    return A().manageSupplier(creating?{action:'create',name:v.name,details:details}:{action:'update',supplierId:id,name:v.name,details:details});})
  .then(function(r){var d=(r&&r.data)||r||{};if(creating&&d.duplicate){alert('“'+d.name+'” already exists. Its details were not changed — choose Edit details on that supplier instead.');return;}
    var sid=d.supplierId||id;supplierMap[sid]=Object.assign({},supplierMap[sid]||{active:true},{name:d.name},d.details||{});supplierListRefresh();});
}
function supplierAction(id,act){
  var row=supplierMap[id]||{};
  if(act==='create'||act==='edit')return supplierDetailsForm(act==='create'?'':id).catch(function(e){supplierFail('save supplier',e);});
  if(act==='deactivate'){if(!confirm('Deactivate '+(row.name||'this supplier')+'? It will no longer be selectable for new purchases, cash payments, or bills. Existing linked records are unaffected.'))return;return A().manageSupplier({action:'deactivate',supplierId:id}).then(function(){supplierMap[id]=Object.assign({},supplierMap[id]||{},{active:false});supplierListRefresh();}).catch(function(e){supplierFail('deactivate supplier',e);});}
  if(act==='reactivate')return A().manageSupplier({action:'reactivate',supplierId:id}).then(function(){supplierMap[id]=Object.assign({},supplierMap[id]||{},{active:true});supplierListRefresh();}).catch(function(e){supplierFail('reactivate supplier',e);});
  if(act==='merge'){
    var others=allSuppliersForList().filter(function(x){return x.id!==id&&supplierIsCurrent(x);});
    if(!others.length){alert('There is no other active supplier to merge into.');return;}
    return F().run({title:'Merge '+(row.name||'supplier')+' into another supplier',subtitle:'Use this for a duplicate of the same real supplier. Purchases, payables, advances, stock receipts, batches and approved brands are repointed to the surviving record. Every posted Finance movement and the supplier name printed on each historical document stay exactly as they are — no cash, stock or journal amount moves.',submitLabel:'Merge suppliers',busyLabel:'Merging…',fields:[
      {name:'targetId',label:'Surviving supplier',type:'select',required:true,value:'',options:[{value:'',label:'— choose the record to keep —'}].concat(others.map(function(x){return {value:x.id,label:x.name||x.id};})),help:'“'+(row.name||id)+'” becomes inactive and is kept as a merged record in the audit trail. Its contact and TIN details are not copied — check the surviving record afterwards.'},
      {name:'reason',label:'Reason for the merge',required:true,maxLength:300,help:'Recorded in the operational audit trail.'}
    ]},function(v){if(!v.targetId)throw new Error('Choose the supplier record to keep.');return A().manageSupplier({action:'merge',supplierId:id,targetId:v.targetId,reason:v.reason});})
    .then(function(r){var d=(r&&r.data)||r||{};supplierMap[id]=Object.assign({},supplierMap[id]||{},{mergedInto:d.mergedInto,active:false});supplierListRefresh();alert('Merged into '+(d.survivingName||'the surviving supplier')+'. '+(d.repointed||0)+' linked record(s) now point to it.');})
    .catch(function(e){supplierFail('merge supplier',e);});
  }
  if(act==='delete')return A().manageSupplier({action:'references',supplierId:id}).then(function(r){
    var d=(r&&r.data)||r||{};
    if((d.total||0)>0){alert('“'+(row.name||id)+'” is used by '+d.total+' record(s), so it cannot be deleted. Merge it into the correct supplier instead — that keeps every purchase, payable and receipt linked.');return null;}
    return F().run({title:'Delete '+(row.name||'supplier'),subtitle:'Nothing references this record — no purchases, payables, advances, stock receipts, batches or approved brands — so it can be removed outright. A supplier with any history must be merged or deactivated instead.',submitLabel:'Delete supplier',busyLabel:'Deleting…',fields:[{name:'reason',label:'Reason for deleting',required:true,maxLength:300,help:'Recorded in the operational audit trail.'}]},function(v){return A().manageSupplier({action:'delete',supplierId:id,reason:v.reason});})
      .then(function(){delete supplierMap[id];supplierListRefresh();});
  }).catch(function(e){supplierFail('delete supplier',e);});
}
