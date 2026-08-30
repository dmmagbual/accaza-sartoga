
// ── ADMIN FUNCTIONS ──
function updateStats(){var stat=document.getElementById('statOrders');if(!stat)return;const orders=Object.values(adminOrdersMap),active=orders.filter(o=>o.status!=='Received');stat.textContent=active.length;document.getElementById('statPending').textContent=active.filter(o=>o.status==='Pending').length;document.getElementById('statReservations').textContent=Object.keys(adminResMap).length;document.getElementById('statRevenue').textContent='₱'+active.filter(o=>o.status!=='Rejected').reduce((s,o)=>s+(o.total||0),0).toLocaleString();}

function renderOrders(){
  const el=document.getElementById('ordersList'),orders=Object.values(adminOrdersMap).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  if(!orders.length){el.innerHTML='<div class="empty-state">No active orders yet.</div>';return;}
  el.innerHTML=orders.map(function(o){
    const isDelivery=o.type==='Delivery',isReceived=o.status==='Received',canArchive=o.status==='Completed'||o.status==='Received'||o.status==='Rejected';
    const modeBadge=isDelivery?'<span class="badge" style="background:#d1ecf1;color:#0c5460;">🛵 Delivery</span>':'<span class="badge" style="background:#d4edda;color:#155724;">🏠 Pick-up</span>';
    const oid=escHtml(o.id),status=escHtml(o.status||'Pending'),statusClass=String(o.status||'pending').toLowerCase().replace(/[^a-z0-9_-]/g,'-'),proof=safeImageSrc(o.proof);
    return'<div class="order-admin-card" style="'+(isReceived?'opacity:0.75;':'')+'"><div class="order-admin-top"><div><div class="order-admin-name">'+escHtml(o.name)+' <span style="font-size:0.75rem;color:var(--tl);">#'+oid+'</span></div><div class="order-admin-meta">'+escHtml(o.phone)+(o.contact?' · '+escHtml(o.contact):'')+' · '+escHtml(o.date)+' '+escHtml(o.time)+'</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;"><span class="badge badge-'+statusClass+'">'+status+'</span>'+modeBadge+(o.receivedByCustomer?'<span class="badge" style="background:#c8e6c9;color:#1b5e20;">✅ Customer Confirmed</span>':'')+'</div></div>'
      +'<div class="order-admin-items">🛒 '+escHtml(o.items)+'</div>'
      +(o.address?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📍 '+escHtml(o.address)+'</div>':'')
      +(o.notes?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📝 '+escHtml(o.notes)+'</div>':'')
      +(proof?'<div style="margin:0.5rem 0;"><p style="font-size:0.75rem;color:var(--tl);margin-bottom:0.3rem;">📎 Proof:</p><img src="'+proof+'" alt="Payment receipt proof" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid var(--cd);cursor:pointer;" onclick="showProof(this.src)"/></div>':'<p style="font-size:0.75rem;color:#c0392b;margin:0.3rem 0;">⚠️ No valid proof of payment</p>')
      +'<div class="order-admin-footer"><span class="order-total-tag">₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+'</span><div style="display:flex;align-items:center;gap:0.5rem;">'
      +(isReceived?'<span style="font-size:0.8rem;color:#1b5e20;font-weight:500;">✅ Received</span>':'<select class="status-select" data-orderid="'+oid+'"><option'+(o.status==='Pending'?' selected':'')+'>Pending</option><option'+(o.status==='Confirmed'?' selected':'')+'>Confirmed</option><option'+(o.status==='Preparing'?' selected':'')+'>Preparing</option><option'+(o.status==='Completed'?' selected':'')+'>Completed</option><option'+(o.status==='Rejected'?' selected':'')+' style="color:#c0392b;">Rejected</option></select>')
      +(canArchive?'<button data-archive="'+oid+'" style="background:#e2e3e5;border:1px solid #bbb;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#41464b;cursor:pointer;">📦 Archive</button>':'')+(o.status!=='Received'?'<button data-notify="'+oid+'" style="background:#e7f5ec;border:1px solid #8fd0a8;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#1b7a43;cursor:pointer;font-weight:600;">🔔 Notify</button>':'')+'<button data-printorder="'+oid+'" style="background:#fff3e0;border:1px solid #ffcc80;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#e65100;cursor:pointer;font-weight:600;">🖨️ Print</button>'
      +'</div></div></div>';
  }).join('');
  el.querySelectorAll('.status-select[data-orderid]').forEach(function(sel){sel.addEventListener('change',function(){update(ref(db,'orders/'+this.dataset.orderid),{status:this.value});});});
  el.querySelectorAll('button[data-printorder]').forEach(function(b){b.addEventListener('click',function(){printOrder(this.dataset.printorder);});});
  el.querySelectorAll('button[data-notify]').forEach(function(b){b.addEventListener('click',function(){notifyCustomer(this.dataset.notify);});});
  el.querySelectorAll('button[data-archive]').forEach(function(btn){btn.addEventListener('click',function(){const oid=this.dataset.archive,o=adminOrdersMap[oid];if(!o)return;showDeletePopup('Archive order from '+o.name,async function(){await set(ref(db,'archivedOrders/'+oid),{...o,status:'Archived',prevStatus:o.status,archivedAt:Date.now(),archivedDate:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})});await remove(ref(db,'orders/'+oid));});});});
}

function renderReservations(){
  const el=document.getElementById('resList'),reservations=Object.values(adminResMap).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  const todayStr=new Date().toISOString().slice(0,10);
  const todayRes=reservations.filter(r=>r.date===todayStr&&r.status!=='Declined'&&r.status!=='Completed');
  const banner=document.getElementById('todayResBanner');
  if(banner){if(todayRes.length>0){banner.style.display='flex';document.getElementById('todayResText').textContent='⚠️ '+todayRes.length+' reservation'+(todayRes.length>1?'s':'')+' today!';}else{banner.style.display='none';}}
  if(!reservations.length){el.innerHTML='<div class="empty-state">No reservations yet.</div>';return;}
  el.innerHTML=reservations.map(function(r){
    const guests=Math.max(1,Math.min(50,parseInt(r.guests)||1)),bookType=guests<=2?'💑 Individual':guests<=5?'👨‍👩‍👧 Small':guests<=20?'👥 Medium':'🎉 Large';
    const isFullDay=r.time==='Full Day Booking';
    const rawStatus=r.status==='Confirmed'?'Accepted':r.status,st=['Pending','Accepted','Declined','Completed'].indexOf(rawStatus)>=0?rawStatus:'Pending',rid=escHtml(r.id);
    return'<div class="order-admin-card"><div class="order-admin-top"><div><div class="order-admin-name">'+escHtml(r.name)+' <span style="font-size:0.75rem;color:var(--tl);">#'+rid+'</span>'+(isFullDay?'<span class="badge" style="background:#fff3cd;color:#664d03;margin-left:0.4rem;">📅 Full Day</span>':'')+'</div><div class="order-admin-meta">'+escHtml(r.phone)+' · '+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guests'+(r.occasion?' · '+escHtml(r.occasion):'')+'</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;"><span class="badge badge-'+st.toLowerCase()+'">'+st+'</span><span style="font-size:0.7rem;color:var(--tl);">'+bookType+'</span></div></div>'
      +(r.notes?'<div class="order-admin-items">📝 '+escHtml(r.notes)+'</div>':'')
      +(r.contact?'<div style="font-size:0.78rem;color:var(--tl);margin:0.2rem 0;">📱 '+escHtml(r.contact)+' · prefers <strong>'+escHtml(r.contactMethod||'phone')+'</strong></div>':'')
      +(st==='Accepted'?'<div style="margin:0.6rem 0;padding:0.6rem 0.75rem;background:#f0faf4;border:1px solid #a8d5b5;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;"><p style="font-size:0.75rem;font-weight:600;color:#2d6a4f;">📨 Contact the customer to confirm booking details</p><button data-contactres="'+rid+'" style="background:#2d9e5f;color:#fff;border:none;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.75rem;cursor:pointer;">📨 Contact Options</button></div>':'')
      +'<div class="order-admin-footer"><span></span><div style="display:flex;gap:0.5rem;"><select class="status-select" data-resid="'+rid+'"><option'+(st==='Pending'?' selected':'')+'>Pending</option><option'+(st==='Accepted'?' selected':'')+'>Accepted</option><option'+(st==='Declined'?' selected':'')+'>Declined</option><option'+(st==='Completed'?' selected':'')+'>Completed</option></select>'+(st==='Completed'||st==='Declined'?'<button data-resid="'+rid+'" class="arch-res-btn" style="background:#e2e3e5;border:1px solid #bbb;border-radius:4px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#41464b;cursor:pointer;">📦 Archive</button>':'')+'</div></div></div>';
  }).join('');
  el.querySelectorAll('.status-select[data-resid]').forEach(function(sel){
    sel.addEventListener('change',async function(){
      const id=this.dataset.resid,val=this.value;
      await update(ref(db,'reservations/'+id),{status:val});
      const r=adminResMap[id];
      if(r&&r.date&&r.time==='Full Day Booking'){
        if(val==='Accepted'){const slots={};TIME_SLOTS.forEach(s=>slots[s]=false);await update(ref(db,'calBlocks/'+r.date),{slots,fullDayReservationId:id});}
        if(val==='Completed'||val==='Declined'){const snap=await get(ref(db,'calBlocks/'+r.date));const data=snap.val();if(data&&data.fullDayReservationId===id)await remove(ref(db,'calBlocks/'+r.date));}
      }
      if(val==='Accepted')openResContactPopup(id);
    });
  });
  el.querySelectorAll('button[data-contactres]').forEach(function(btn){btn.addEventListener('click',function(){openResContactPopup(this.dataset.contactres);});});
  el.querySelectorAll('.arch-res-btn').forEach(function(btn){btn.addEventListener('click',function(){const id=this.dataset.resid,r=adminResMap[id];if(!r)return;showDeletePopup('Archive reservation for '+r.name,async function(){const pst=r.status==='Confirmed'?'Accepted':r.status;await set(ref(db,'archivedReservations/'+id),{...r,status:'Archived',prevStatus:pst,archivedAt:Date.now(),archivedDate:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})});await remove(ref(db,'reservations/'+id));});});});
}

// ── AVAILABILITY & CATEGORY MANAGER ──
function renderCategoryManager(){
  const el=document.getElementById('categoryList');if(!el)return;
  const cats=getCats();
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
      const items=getMenuItems().filter(i=>i.cat===id);
      if(items.length>0){alert('Cannot delete — this category has '+items.length+' item(s). Remove the items first.');return;}
      showDeletePopup(categoriesMap[id]?.label||id,async function(){await remove(ref(db,'categories/'+id));});
    });
  });
  // Drag reorder
  let dragId=null;
  el.querySelectorAll('[data-catid]').forEach(function(row){
    row.addEventListener('dragstart',function(){dragId=this.dataset.catid;});
    row.addEventListener('dragover',function(e){e.preventDefault();});
    row.addEventListener('drop',async function(e){
      e.preventDefault();if(!dragId||dragId===this.dataset.catid)return;
      const cats2=getCats();const from=cats2.findIndex(c=>c.id===dragId),to=cats2.findIndex(c=>c.id===this.dataset.catid);
      const reordered=[...cats2];reordered.splice(to,0,reordered.splice(from,1)[0]);
      const updates={};reordered.forEach((c,i)=>{updates[c.id+'/order']=i;});
      await update(categoriesRef,updates);dragId=null;
    });
  });
}

// ── CHANGE PASSWORD ────────────────────────────────────────
window.togglePwVis=function(inputId,btn){var inp=document.getElementById(inputId);if(!inp)return;var show=inp.type==='password';inp.type=show?'text':'password';btn.textContent=show?'🙈':'👁️';};
window.changeAdminPassword=async function(){
  var cur=document.getElementById('cpCurrent').value;
  var nw=document.getElementById('cpNew').value;
  var conf=document.getElementById('cpConfirm').value;
  var msg=document.getElementById('cpMsg');
  function showMsg(text,ok){
    msg.textContent=text;
    msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!cur||!nw||!conf){showMsg('Please fill in all fields.', false);return;}
  if(nw!==conf){showMsg('New passwords do not match.', false);return;}
  if(nw.length<6){showMsg('New password must be at least 6 characters.', false);return;}
  async function hashPass(p){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  var curHash=await hashPass(cur);
  var activeHash;
  if(!currentUser||currentUser.role==='superadmin'){activeHash=currentAdminHash;}
  else if(currentUser.role==='admin'){activeHash=adminAccountsMap[currentUser.uid]?adminAccountsMap[currentUser.uid].passwordHash:'';}
  else if(currentUser.role==='staff'){activeHash=staffAccountsMap[currentUser.uid]?staffAccountsMap[currentUser.uid].passwordHash:'';}
  if(curHash!==activeHash){showMsg('Current password is incorrect.', false);return;}
  var newHash=await hashPass(nw);
  try{
    if(!currentUser||currentUser.role==='superadmin'){
      await update(settingsRef,{adminPasswordHash:newHash});currentAdminHash=newHash;
    }else if(currentUser.role==='admin'){
      await update(ref(db,'adminAccounts/'+currentUser.uid),{passwordHash:newHash});
      adminAccountsMap[currentUser.uid].passwordHash=newHash;
    }else if(currentUser.role==='staff'){
      await update(ref(db,'staffAccounts/'+currentUser.uid),{passwordHash:newHash});
      staffAccountsMap[currentUser.uid].passwordHash=newHash;
    }
    document.getElementById('cpCurrent').value='';
    document.getElementById('cpNew').value='';
    document.getElementById('cpConfirm').value='';
    showMsg('✅ Password updated successfully!', true);
  }catch(e){showMsg('Error: '+e.message, false);}
};


// ── FORGOT PASSWORD ────────────────────────────────────────
window.toggleForgotPw=function(){
  var p=document.getElementById('forgotPwPanel');
  if(!p)return;
  p.style.display=(p.style.display==='none'||!p.style.display)?'block':'none';
  if(p.style.display==='block'){
    document.getElementById('recoveryPass').focus();
    document.getElementById('recoveryMsg').style.display='none';
  }
};
window.resetAdminPassword=async function(){
  var pass=document.getElementById('recoveryPass').value;
  var msg=document.getElementById('recoveryMsg');
  if(!pass){msg.textContent='Please enter your recovery password.';msg.style.color='#c0392b';msg.style.display='block';return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pass));
  var hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(!currentAdminHash||hex!==currentAdminHash){
    msg.textContent='❌ Incorrect recovery password.';msg.style.color='#c0392b';msg.style.display='block';
    document.getElementById('recoveryPass').value='';return;
  }
  try{
    await update(settingsRef,{adminPasswordHash:null});
    currentAdminHash=null;
    document.getElementById('recoveryPass').value='';
    msg.textContent='✅ Password reset! You can now log in with your original password.';
    msg.style.color='#1a7a45';msg.style.display='block';
    setTimeout(function(){window.toggleForgotPw();msg.style.display='none';},3000);
  }catch(e){msg.textContent='Error: '+e.message;msg.style.color='#c0392b';msg.style.display='block';}
};

// ── STAFF ACCOUNTS ─────────────────────────────────────────
function renderStaffAccounts(){
  var el=document.getElementById('staffList');if(!el)return;
  var keys=Object.keys(staffAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No staff accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=staffAccountsMap[uid];
    return'<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">👤 '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:var(--tl);display:block;margin-top:0.1rem;">Staff · Password protected</span></div>'
      +'<button data-delstaff="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️ Remove</button>'
      +'</div>';
  }).join('');
  el.querySelectorAll('[data-delstaff]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var uid=this.dataset.delstaff;
      var name=staffAccountsMap[uid]?staffAccountsMap[uid].username:'this account';
      showDeletePopup('staff account for '+name,async function(){
        await remove(ref(db,'staffAccounts/'+uid));
      });
    });
  });
}
window.addStaffAccount=async function(){
  var username=(document.getElementById('staffUsername').value||'').trim().toLowerCase();
  var password=document.getElementById('staffPassword').value;
  var msg=document.getElementById('staffAddMsg');
  function showMsg(text,ok){
    msg.textContent=text;msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!username){showMsg('Username is required.',false);return;}
  if(!password||password.length<4){showMsg('Password must be at least 4 characters.',false);return;}
  // Check username not already taken
  var taken=Object.values(staffAccountsMap).some(function(a){return a.username===username;});
  if(taken){showMsg('Username "'+username+'" is already taken.',false);return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  var hashHex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  var uid='staff_'+Date.now();
  try{
    await set(ref(db,'staffAccounts/'+uid),{username,passwordHash:hashHex});
    document.getElementById('staffUsername').value='';
    document.getElementById('staffPassword').value='';
    showMsg('✅ Staff account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};


// ── ADMIN ACCOUNTS ─────────────────────────────────────────
function renderAdminAccounts(){
  var el=document.getElementById('adminAccList');if(!el)return;
  var keys=Object.keys(adminAccountsMap);
  if(!keys.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No admin accounts yet.</p>';return;}
  el.innerHTML=keys.map(function(uid){
    var acc=adminAccountsMap[uid];
    var noPay=acc.access==='nopay';
    return'<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.7rem 1rem;margin-bottom:0.5rem;">'
      +'<div><span style="font-size:0.9rem;font-weight:500;color:var(--bd);">🔑 '+escHtml(acc.username)+'</span>'
      +'<span style="font-size:0.72rem;color:'+(noPay?'#b07a2a':'var(--tl)')+';display:block;margin-top:0.1rem;">'+(noPay?'Admin · All except Payment Details':'Admin · Full access')+'</span></div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;">'
      +'<select data-accessuid="'+uid+'" title="Access level" style="background:var(--cr);border:1px solid var(--cd);border-radius:6px;padding:0.3rem 0.5rem;font-size:0.75rem;font-family:\'Inter\',sans-serif;color:var(--td);cursor:pointer;">'
      +'<option value="full"'+(noPay?'':' selected')+'>✅ Full access</option>'
      +'<option value="nopay"'+(noPay?' selected':'')+'>🔒 No Payment Details</option>'
      +'</select>'
      +'<button data-deladmin="'+uid+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️ Remove</button>'
      +'</div></div>';
  }).join('');
  el.querySelectorAll('[data-deladmin]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var uid=this.dataset.deladmin;
      var name=adminAccountsMap[uid]?adminAccountsMap[uid].username:'this account';
      showDeletePopup('admin account for '+name,async function(){
        await remove(ref(db,'adminAccounts/'+uid));
      });
    });
  });
  el.querySelectorAll('[data-accessuid]').forEach(function(sel){
    sel.addEventListener('change',async function(){
      await update(ref(db,'adminAccounts/'+this.dataset.accessuid),{access:this.value});
    });
  });
}
window.addAdminAccount=async function(){
  var username=(document.getElementById('adminAccUsername').value||'').trim().toLowerCase();
  var password=document.getElementById('adminAccPassword').value;
  var msg=document.getElementById('adminAccMsg');
  function showMsg(text,ok){
    msg.textContent=text;msg.style.display='block';
    msg.style.background=ok?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)';
    msg.style.color=ok?'#1a7a45':'#c0392b';
    msg.style.border='1px solid '+(ok?'rgba(45,158,95,0.3)':'rgba(192,57,57,0.3)');
  }
  if(!username){showMsg('Username is required.',false);return;}
  if(username===SUPER_ADMIN_USERNAME){showMsg('"'+username+'" is reserved.',false);return;}
  if(!password||password.length<4){showMsg('Password must be at least 4 characters.',false);return;}
  var taken=Object.values(adminAccountsMap).some(function(a){return a.username===username;});
  if(taken){showMsg('Username "'+username+'" already taken.',false);return;}
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  var hashHex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  try{
    var access=(document.getElementById('adminAccAccess')||{}).value||'full';
    await set(ref(db,'adminAccounts/'+('admin_'+Date.now())),{username,passwordHash:hashHex,access});
    document.getElementById('adminAccUsername').value='';
    document.getElementById('adminAccPassword').value='';
    var accSel=document.getElementById('adminAccAccess');if(accSel)accSel.value='full';
    showMsg('✅ Admin account "'+username+'" created.',true);
  }catch(e){showMsg('Error: '+e.message,false);}
};

// ── OPTION GROUPS MANAGER (admin) ───────────────────────────
function buildOptionChecklistHtml(selectedIds){
  var ids=Object.keys(optionGroupsMap);
  if(!ids.length)return '<span style="font-size:0.78rem;color:var(--tl);">No option groups yet — create them in the 🧩 Item Options panel.</span>';
  return ids.sort(function(a,b){return(optionGroupsMap[a].order||0)-(optionGroupsMap[b].order||0);}).map(function(id){
    var g=optionGroupsMap[id];
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
  var ids=Object.keys(optionGroupsMap).sort(function(a,b){return(optionGroupsMap[a].order||0)-(optionGroupsMap[b].order||0);});
  if(!ids.length){el.innerHTML='<p style="font-size:0.85rem;color:var(--tl);">No option groups yet. Add your first one below.</p>';return;}
  var items=getMenuItems();
  el.innerHTML=ids.map(function(id){
    var g=optionGroupsMap[id];
    var used=items.filter(function(i){return getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
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
      var g=optionGroupsMap[id];if(!g)return;
      var used=getMenuItems().filter(function(i){return getEffectiveOptionIds(i).indexOf(id)!==-1;}).length;
      showDeletePopup('option "'+g.name+'"'+(used?' (used by '+used+' item'+(used===1?'':'s')+')':''),async function(){
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
    await set(ref(db,'optionGroups/'+id),{name:name,type:type,required:required,order:Object.keys(optionGroupsMap).length,choices:[{label:'Option 1',price:0}]});
    document.getElementById('newOgName').value='';
    var c=document.getElementById('ogAddConfirm');c.style.display='block';setTimeout(function(){c.style.display='none';},2500);
  }catch(e){alert('Error: '+e.message);}
};

// ── STAFF MENU (read-only view) ─────────────────────────────
function renderStaffMenu(){
  var el=document.getElementById('staffMenuContainer');if(!el)return;
  var cats=getCats();var items=getMenuItems();
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
        return'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0;border-bottom:1px solid rgba(0,0,0,0.04);">'
          +(item.img?'<img src="'+item.img+'" alt="" style="width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
            :'<div style="width:38px;height:38px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">'+cat.icon+'</div>')
          +'<div style="flex:1;min-width:0;"><div style="font-size:0.88rem;font-weight:500;color:var(--bd);">'+item.name+'</div>'
          +(item.desc?'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.1rem;">'+item.desc+'</div>':'')
          +'<div style="font-size:0.78rem;color:#c9a36a;margin-top:0.15rem;">'+priceStr+'</div></div>'
          +'<span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:999px;flex-shrink:0;background:'+(isAvail(item.name)?'rgba(45,158,95,0.12)':'rgba(192,57,57,0.1)')+';color:'+(isAvail(item.name)?'#2d9e5f':'#c0392b')+';">'+(isAvail(item.name)?'✅':'❌')+'</span>'
          +'</div>';
      }).join('')
      +'</div>';
  }).join('');
}

// ── PUBLIC REVIEWS (dynamic) ────────────────────────────────
function renderPublicReviews(){
  var el=document.getElementById('publicReviewsContainer');if(!el)return;
  var entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<p style="text-align:center;color:var(--tl);padding:2rem;">No reviews yet.</p>';return;}
  function stars(n){return'⭐'.repeat(Math.max(1,Math.min(5,parseInt(n)||5)));}
  function card(r,featured){
    var initials=escHtml((r.name||'?').split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase());
    return'<div class="review-card"'+(featured?' style="margin-bottom:1.25rem;"':'')+'>'+
      '<div class="review-stars">'+stars(r.stars)+'</div>'+
      (r.title?'<p style="font-weight:600;color:var(--bd);margin-bottom:0.75rem;font-size:0.95rem;">'+escHtml(r.title)+'</p>':'')+
      '<p class="review-text">'+escHtml(r.text).replace(/\n/g,'<br>')+'</p>'+
      '<div class="review-author"><div class="review-avatar">'+initials+'</div>'+
      '<div><div class="review-name">'+escHtml(r.name)+'</div>'+
      '<div class="review-date">'+escHtml(r.date)+'</div></div></div></div>';
  }
  var html2='';
  if(entries.length===1){
    html2=card(entries[0][1],true);
  }else{
    html2=card(entries[0][1],true);
    html2+='<div class="reviews-grid">';
    for(var i=1;i<entries.length;i++)html2+=card(entries[i][1],false);
    html2+='</div>';
  }
  el.innerHTML=html2;
}


// ── EDIT ITEM HELPERS ──────────────────────────────────────
function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function safeImageSrc(s){s=String(s||'');if(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)||/^https:\/\//i.test(s))return escHtml(s);return '';}
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
  var item=menuItemsMap[key];if(!item){alert('Item not found.');return;}
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
    if(newName!==oldName&&availability[oldName]!==undefined){
      var wasAvail=availability[oldName];
      await update(availRef,{[newName]:wasAvail,[oldName]:null});
    }
    window.toggleEditPanel(key);
    buildAvail();renderMenuSection();renderOrderSection();
  }catch(e){alert('Error saving: '+e.message);}
};


function buildAvail(){
  const el=document.getElementById('availList');if(!el)return;
  const items=getMenuItems();
  if(!Object.keys(menuItemsMap).length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:2rem;">Loading...</p>';return;}
  const cats=getCats();let html='';
  cats.forEach(function(cat){
    const catItems=items.filter(i=>i.cat===cat.id).sort((a,b)=>(a.order||0)-(b.order||0));
    html+='<div style="font-family:\'Playfair Display\',serif;font-size:1.1rem;color:var(--bd);margin:1.5rem 0 0.75rem;padding-bottom:0.4rem;border-bottom:2px solid var(--cd);">'+cat.icon+' '+cat.label+'</div>';
    if(!catItems.length){html+='<p style="font-size:0.82rem;color:var(--tl);padding:0.5rem 0 1rem;">No items in this category yet.</p>';return;}
    catItems.forEach(function(item){
      const ok=isAvail(item.name),sid='av_'+item.key;
      const priceStr=item.priceM&&item.priceL?'S ₱'+item.priceS+' · M ₱'+item.priceM+' · L ₱'+item.priceL:item.priceL&&item.labelS&&item.labelL?''+item.labelS+' ₱'+item.priceS+' · '+item.labelL+' ₱'+item.priceL:'₱'+item.priceS;
      const imgSrc=item.img||'';
      const imgBlock=imgSrc?'<img src="'+imgSrc+'" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\'none\'"/>'
        :'<div style="width:44px;height:44px;border-radius:6px;background:linear-gradient(135deg,var(--cd),var(--bl));display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">'+cat.icon+'</div>';
      html+='<div style="background:#fff;border:1px solid var(--cd);border-radius:8px;padding:0.85rem 1rem;margin-bottom:0.6rem;" draggable="true" data-itemkey="'+item.key+'" data-itemcat="'+cat.id+'">'
        +'<div style="display:flex;align-items:center;gap:0.75rem;">'
        +'<span style="cursor:grab;color:var(--tl);font-size:1.1rem;flex-shrink:0;user-select:none;">⠿</span>'
        +imgBlock
        +'<div style="flex:1;min-width:0;"><div style="font-size:0.9rem;font-weight:500;color:var(--bd);'+(ok?'':'text-decoration:line-through;opacity:0.5;')+'" id="'+sid+'_n">'+item.name+'</div><div style="font-size:0.75rem;color:var(--tl);">'+priceStr+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0;">'
        +'<span id="'+sid+'_l" style="font-size:0.75rem;font-weight:600;padding:0.2rem 0.65rem;border-radius:999px;background:'+(ok?'#d4edda':'#fde8e8')+';color:'+(ok?'#155724':'#721c24')+';white-space:nowrap;">'+(ok?'✅ Available':'❌ Unavailable')+'</span>'
        +'<input type="checkbox" class="avail-toggle" '+(ok?'checked':'')+' data-name="'+item.name+'" data-sid="'+sid+'"/>'
        +'<button onclick="toggleEditPanel(\''+item.key+'\')" style="background:#fff8e1;border:1px solid #f0d080;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#7a5c00;cursor:pointer;">✏️</button>'
        +'<button data-delitem="'+item.key+'" data-delname="'+item.name+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;">🗑️</button>'
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
    var item=menuItemsMap[key];if(!item)return;
    var cats=getCats();
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
      +'<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">'+buildOptionChecklistHtml(getEffectiveOptionIds(item))+'</div></div>'
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
  if(staffLoggedIn){
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
      availability[name]=ok;
      const n=document.getElementById(sid+'_n'),l=document.getElementById(sid+'_l');
      if(n){n.style.textDecoration=ok?'none':'line-through';n.style.opacity=ok?'1':'0.5';}
      if(l){l.textContent=ok?'✅ Available':'❌ Unavailable';l.style.background=ok?'#d4edda':'#fde8e8';l.style.color=ok?'#155724':'#721c24';}
      renderMenuSection();renderOrderSection();
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
      renderMenuSection();
    });
  });
  // Wire delete item
  el.querySelectorAll('button[data-delitem]').forEach(function(btn){
    btn.addEventListener('click',function(){showDeletePopup(this.dataset.delname,async function(){await remove(ref(db,'menuItems/'+btn.dataset.delitem));});});
  });
  // Wire drag reorder
  let dragItemKey=null;
  el.querySelectorAll('[data-itemkey]').forEach(function(row){
    row.addEventListener('dragstart',function(){dragItemKey=this.dataset.itemkey;});
    row.addEventListener('dragover',function(e){e.preventDefault();});
    row.addEventListener('drop',async function(e){
      e.preventDefault();if(!dragItemKey||dragItemKey===this.dataset.itemkey)return;
      const cat2=this.dataset.itemcat;
      const catItems=getMenuItems().filter(i=>i.cat===cat2).sort((a,b)=>(a.order||0)-(b.order||0));
      const from=catItems.findIndex(i=>i.key===dragItemKey),to=catItems.findIndex(i=>i.key===this.dataset.itemkey);
      if(from<0||to<0)return;
      const reordered=[...catItems];reordered.splice(to,0,reordered.splice(from,1)[0]);
      const updates={};reordered.forEach((item,i)=>{updates[item.key+'/order']=i;});
      await update(menuRef,updates);dragItemKey=null;
    });
  });
}

// ── DASHBOARD ──
function renderDashboard(){
  const archived=Object.values(archivedOrdersMap);
  const now2=new Date(),todayStr=now2.toISOString().slice(0,10);
  const startOfWeek=new Date(now2);startOfWeek.setDate(now2.getDate()-now2.getDay());startOfWeek.setHours(0,0,0,0);
  const startOfMonth=new Date(now2.getFullYear(),now2.getMonth(),1);
  function sumOrders(arr){return{rev:arr.reduce((s,o)=>s+(o.total||0),0),cnt:arr.length};}
  const todayOrders=archived.filter(o=>new Date(o.archivedAt||0).toISOString().slice(0,10)===todayStr);
  const weekOrders=archived.filter(o=>new Date(o.archivedAt||0)>=startOfWeek);
  const monthOrders=archived.filter(o=>new Date(o.archivedAt||0)>=startOfMonth);
  const t=sumOrders(todayOrders),w=sumOrders(weekOrders),m=sumOrders(monthOrders),a=sumOrders(archived);
  function setCard(id,rev,cnt){const el=document.getElementById(id);if(el)el.textContent='₱'+rev.toLocaleString();const cel=document.getElementById(id+'Count');if(cel)cel.textContent=cnt+' order'+(cnt!==1?'s':'');}
  setCard('dashToday',t.rev,t.cnt);setCard('dashWeek',w.rev,w.cnt);setCard('dashMonth',m.rev,m.cnt);setCard('dashAllTime',a.rev,a.cnt);
  const gcash=archived.filter(o=>o.payment==='GCash').length,bank=archived.filter(o=>o.payment==='Bank Transfer').length,total2=gcash+bank||1;
  const gp=document.getElementById('gcashPct'),bp=document.getElementById('bankPct');
  if(gp)gp.textContent='GCash '+Math.round(gcash/total2*100)+'%';if(bp)bp.textContent='Bank '+Math.round(bank/total2*100)+'%';
  drawPaymentPie(gcash/total2,bank/total2);drawRevenueChart(archived);
  // Top 5
  const itemCount={};
  archived.forEach(function(o){if(!o.items)return;o.items.split(',').forEach(function(s){const name=s.trim().replace(/\s*\(.*?\)\s*/g,'').replace(/\s*x\d+\s*$/,'').trim();const qty=parseInt((s.match(/x(\d+)/)||[])[1]||1);if(name)itemCount[name]=(itemCount[name]||0)+qty;});});
  const top5=Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const topEl=document.getElementById('topItemsList');
  if(topEl)topEl.innerHTML=top5.length?top5.map(function(entry,i){const medals=['🥇','🥈','🥉','4','5'];return'<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--cd);"><span style="font-size:1rem;min-width:20px;text-align:center;">'+medals[i]+'</span><span style="flex:1;font-size:0.83rem;color:var(--bd);">'+entry[0]+'</span><span style="font-size:0.8rem;font-weight:600;color:var(--bl);">'+entry[1]+' sold</span></div>';}).join(''):'<p style="color:var(--tl);font-size:0.83rem;text-align:center;padding:1rem;">No archived orders yet.</p>';
  // Status breakdown
  const allActive=Object.values(adminOrdersMap);
  const statuses=['Pending','Confirmed','Preparing','Completed','Received','Rejected'];
  const statusColors={Pending:'#856404',Confirmed:'#0c5460',Preparing:'#664d03',Completed:'#155724',Received:'#1b5e20',Rejected:'#721c24'};
  const statusBg={Pending:'#fef3cd',Confirmed:'#d1ecf1',Preparing:'#fff3cd',Completed:'#d4edda',Received:'#c8e6c9',Rejected:'#f8d7da'};
  const stEl=document.getElementById('statusBreakdown');
  if(stEl)stEl.innerHTML=statuses.map(function(s){const cnt=allActive.filter(o=>o.status===s).length;return'<div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0.75rem;background:'+statusBg[s]+';border-radius:6px;margin-bottom:0.4rem;"><span style="font-size:0.82rem;font-weight:500;color:'+statusColors[s]+';">'+s+'</span><span style="font-size:0.9rem;font-weight:700;color:'+statusColors[s]+';">'+cnt+'</span></div>';}).join('')+'<div style="margin-top:0.5rem;padding:0.45rem 0.75rem;background:#e2e3e5;border-radius:6px;display:flex;justify-content:space-between;"><span style="font-size:0.82rem;font-weight:500;color:#41464b;">Archived</span><span style="font-size:0.9rem;font-weight:700;color:#41464b;">'+Object.keys(archivedOrdersMap).length+'</span></div>';
}

function drawPaymentPie(gcashR,bankR){
  const canvas=document.getElementById('paymentChart');if(!canvas)return;
  const size=160;canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d'),cx=size/2,cy=size/2,r=size*0.42;
  ctx.clearRect(0,0,size,size);
  if(gcashR+bankR===0){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle='#cdbda7';ctx.fill();return;}
  const start=-Math.PI/2;
  [[gcashR,'#b08d57'],[bankR,'#3b8fd4']].forEach(function(pair,i){
    const s=i===0?start:start+gcashR*Math.PI*2,e=i===0?start+gcashR*Math.PI*2:start+Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,s,e);ctx.closePath();ctx.fillStyle=pair[1];ctx.fill();
  });
}

function drawRevenueChart(archived){
  const canvas=document.getElementById('revenueChart');if(!canvas)return;
  const W=canvas.offsetWidth||500,H=180;canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,W,H);
  const days=[],today2=new Date();
  for(let i=29;i>=0;i--){const d=new Date(today2);d.setDate(today2.getDate()-i);days.push(d.toISOString().slice(0,10));}
  const revByDay={},cntByDay={};days.forEach(d=>{revByDay[d]=0;cntByDay[d]=0;});
  archived.filter(o=>o.prevStatus!=='Rejected').forEach(function(o){const d=new Date(o.archivedAt||0).toISOString().slice(0,10);if(revByDay[d]!==undefined){revByDay[d]+=(o.total||0);cntByDay[d]++;}});
  const revVals=days.map(d=>revByDay[d]),cntVals=days.map(d=>cntByDay[d]);
  const maxRev=Math.max(...revVals,1),maxCnt=Math.max(...cntVals,1);
  const pad={l:40,r:10,t:10,b:30},chartW=W-pad.l-pad.r,chartH=H-pad.t-pad.b,gap=chartW/days.length,barW=gap*0.6;
  ctx.strokeStyle='rgba(0,0,0,0.07)';ctx.lineWidth=1;
  [0,0.25,0.5,0.75,1].forEach(function(pct){const y=pad.t+chartH*(1-pct);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle='#79806f';ctx.font='10px Inter,sans-serif';ctx.textAlign='right';ctx.fillText('₱'+(maxRev*pct/1000).toFixed(0)+'k',pad.l-4,y+3);});
  revVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.2,bh=val/maxRev*chartH;ctx.fillStyle='rgba(176,141,87,0.75)';ctx.fillRect(x,pad.t+chartH-bh,barW,bh);});
  ctx.strokeStyle='#3b8fd4';ctx.lineWidth=2;ctx.beginPath();
  cntVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.5,y=pad.t+chartH*(1-val/maxCnt);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.stroke();
  ctx.fillStyle='#3b8fd4';cntVals.forEach(function(val,i){const x=pad.l+i*gap+gap*0.5,y=pad.t+chartH*(1-val/maxCnt);ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#79806f';ctx.font='9px Inter,sans-serif';ctx.textAlign='center';
  days.forEach(function(d,i){if(i%5===0||i===29)ctx.fillText(d.slice(5),pad.l+i*gap+gap*0.5,H-8);});
}

// ── ARCHIVE PDF ──
window.downloadArchivePDF=function(){
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=Object.values(archivedOrdersMap).sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  if(!orders.length){alert('No archived orders found for the selected date range.');return;}
  const rejCnt=orders.filter(o=>o.prevStatus==='Rejected').length;const totalRev=orders.filter(o=>o.prevStatus!=='Rejected').reduce((s,o)=>s+(o.total||0),0);
  const gcashCnt=orders.filter(o=>o.payment==='GCash').length,bankCnt=orders.filter(o=>o.payment==='Bank Transfer').length;
  const rowH=52,headerH=220,pageW=800,totalH=headerH+orders.length*rowH+80;
  const canvas=document.createElement('canvas');canvas.width=pageW;canvas.height=totalH;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#e0d4c6';ctx.fillRect(0,0,pageW,totalH);
  ctx.fillStyle='#19241b';ctx.fillRect(0,0,pageW,headerH);
  ctx.fillStyle='#c9a36a';ctx.font='bold 28px Georgia,serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House',pageW/2,55);
  ctx.fillStyle='rgba(224,212,198,0.7)';ctx.font='14px Inter,sans-serif';ctx.fillText('Saratoga Ave, La Mediterranea, Dasmariñas, Cavite',pageW/2,82);
  ctx.fillStyle='#fff';ctx.font='bold 18px Georgia,serif';ctx.fillText('Order Archive Report',pageW/2,118);
  const dateRange=fromVal&&toVal?fromVal+' to '+toVal:fromVal?'From '+fromVal:toVal?'Up to '+toVal:'All Time';
  ctx.fillStyle='rgba(224,212,198,0.6)';ctx.font='12px Inter,sans-serif';ctx.fillText(dateRange,pageW/2,140);
  ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(40,156,pageW-80,48);
  ctx.fillStyle='#c9a36a';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('Total Orders: '+orders.length,60,178);
  ctx.textAlign='center';ctx.fillText('Total Revenue: ₱'+totalRev.toLocaleString(),pageW/2,178);
  ctx.textAlign='right';ctx.fillText('GCash: '+gcashCnt+' · Bank: '+bankCnt+(rejCnt?' · Rejected: '+rejCnt:''),pageW-60,178);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,198);
  let y=headerH+16;
  ctx.fillStyle='#19241b';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';
  ['Order ID','Customer','Items','Total','Payment','Type','Date'].forEach(function(h,i){ctx.fillText(h,[40,120,240,530,610,680,730][i],y);});
  ctx.strokeStyle='#cdbda7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+8);ctx.lineTo(pageW-40,y+8);ctx.stroke();
  y+=rowH*0.6;
  orders.forEach(function(o,idx){
    if(idx%2===0){ctx.fillStyle='rgba(176,141,87,0.06)';ctx.fillRect(40,y-14,pageW-80,rowH);}
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText((o.id||'—'),40,y+4);
    ctx.fillText((o.name||'—').slice(0,14),120,y+4);
    ctx.fillText(((o.items||'').length>35?o.items.slice(0,35)+'…':o.items||'—'),240,y+4);
    ctx.fillStyle=o.prevStatus==='Rejected'?'#c0392b':'#b08d57';ctx.font='bold 11px Inter,sans-serif';ctx.fillText((o.prevStatus==='Rejected'?'✗ ':'')+'₱'+(o.total||0).toLocaleString(),530,y+4);
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';
    ctx.fillText(o.payment==='GCash'?'GCash':'Bank',610,y+4);ctx.fillText(o.type||'—',680,y+4);ctx.fillText(o.archivedDate||'—',730,y+4);
    ctx.strokeStyle='#cdbda7';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(40,y+rowH-14);ctx.lineTo(pageW-40,y+rowH-14);ctx.stroke();
    y+=rowH;
  });
  ctx.fillStyle='#19241b';ctx.fillRect(0,totalH-40,pageW,40);
  ctx.fillStyle='rgba(224,212,198,0.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House · Confidential · For internal use only',pageW/2,totalH-14);
  const link=document.createElement('a');link.download='Accaza_Archive_'+new Date().toISOString().slice(0,10)+'.png';link.href=canvas.toDataURL('image/png');link.click();
};

// ── MISC ADMIN ──
function renderComments(){
  const types=['Complaint','Suggestion','Compliment','Other'];
  const empty={Complaint:'No complaints yet. 🎉',Suggestion:'No suggestions yet.',Compliment:'No compliments yet.',Other:'No other feedback yet.'};
  const color={Complaint:'#c0392b',Suggestion:'#f39c12',Compliment:'#2d9e5f',Other:'#888'};
  types.forEach(function(type){
    const el=document.getElementById('fbList'+type);if(!el)return;
    const items=Object.entries(feedbacksMap).filter(function(e){return e[1].type===type;});
    if(!items.length){el.innerHTML='<p style="color:var(--tl);padding:1rem;background:#fff;border-radius:8px;text-align:center;font-size:0.85rem;">'+empty[type]+'</p>';return;}
    el.innerHTML=items.map(function(e){const f=e[1]||{},key=escHtml(e[0]),status=f.status==='Resolved'?'Resolved':'Unread',name=escHtml(f.name),contact=escHtml(f.contact),date=escHtml(f.date),message=escHtml(f.message);return'<div style="background:#fff;border:1px solid #cdbda7;border-left:4px solid '+color[type]+';border-radius:8px;padding:1rem;margin-bottom:0.75rem;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.5rem;"><div><div style="font-weight:500;font-size:0.9rem;color:#19241b;">'+name+'</div><div style="font-size:0.75rem;color:#79806f;">'+(contact?contact+' · ':'')+date+'</div></div><span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;font-weight:500;background:'+(status==='Resolved'?'#d4edda':'#fef3cd')+';color:'+(status==='Resolved'?'#155724':'#856404')+';">'+status+'</span></div><p style="font-size:0.85rem;color:#44523f;font-style:italic;margin:0.4rem 0;">"'+message+'"</p><div class="staff-hide" style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem;">'+(status==='Unread'?'<button data-markfb="'+key+'" style="background:#f0faf4;border:1px solid #a8d5b5;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#2d6a4f;cursor:pointer;">✅ Mark Resolved</button>':'')+(status==='Resolved'?'<button data-delfb="'+key+'" data-delfbname="'+name+'" style="background:#fff0f0;border:1px solid #e0b0b0;border-radius:6px;padding:0.35rem 0.85rem;font-size:0.78rem;color:#c0392b;cursor:pointer;">🗑️ Delete</button>':'')+'</div></div>';}).join('');
    el.querySelectorAll('button[data-markfb]').forEach(function(btn){btn.addEventListener('click',function(){update(ref(db,'feedbacks/'+this.dataset.markfb),{status:'Resolved'});});});
    el.querySelectorAll('button[data-delfb]').forEach(function(btn){btn.addEventListener('click',function(){showDeletePopup(this.dataset.delfbname,async function(){await remove(ref(db,'feedbacks/'+btn.dataset.delfb));});});});
  });
}

function renderAdminReviews(){
  const el=document.getElementById('adminReviewsList'),entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<div class="empty-state">No reviews added yet.</div>';return;}
  el.innerHTML=entries.map(function(e){const key=escHtml(e[0]),r=e[1]||{},name=escHtml(r.name),date=escHtml(r.date),review=escHtml(r.text),stars=Math.max(0,Math.min(5,parseInt(r.stars)||0));return'<div class="order-admin-card" style="display:flex;justify-content:space-between;align-items:flex-start;">'+'<div><div class="order-admin-name">'+name+' '+'⭐'.repeat(stars)+'</div>'+'<div class="order-admin-meta">'+date+'</div>'+'<div class="order-admin-items">"'+review+'"</div></div>'+(staffLoggedIn?'':'<button data-delrev="'+key+'" data-delrevname="'+name+'" style="background:none;border:1px solid #e0b0b0;border-radius:4px;padding:0.3rem 0.6rem;font-size:0.75rem;color:#c0392b;cursor:pointer;margin-left:1rem;flex-shrink:0;">Remove</button>')+'</div>';}).join('');
  el.querySelectorAll('button[data-delrev]').forEach(function(btn){btn.addEventListener('click',function(){showDeletePopup(this.dataset.delrevname,async function(){await remove(ref(db,'reviews/'+btn.dataset.delrev));});});});
}

window.addReview=async function(){
  const name=document.getElementById('newReviewName').value.trim(),stars=parseInt(document.getElementById('newReviewStars').value),text=document.getElementById('newReviewText').value.trim();
  if(!name||!text){alert('Please enter name and review.');return;}
  var dateVal=document.getElementById('newReviewDate').value.trim()||new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
  await push(reviewsRef,{name,stars,text,date:dateVal});
  document.getElementById('newReviewName').value='';document.getElementById('newReviewDate').value='';document.getElementById('newReviewText').value='';
  document.getElementById('reviewAddConfirm').style.display='block';setTimeout(function(){document.getElementById('reviewAddConfirm').style.display='none';},2500);
};

window.savePayment=async function(){
  function getChk(id){var el=document.getElementById(id);return el?el.checked:true;}
  // Update disabled notes
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    if(note)note.style.display=getChk('chk'+k)?'none':'block';
  });
  const data={gcashNum:document.getElementById('editGcashNum').value,gcashName:document.getElementById('editGcashName').value,bdoNum:document.getElementById('editBdoNum').value,bdoName:document.getElementById('editBdoName')?document.getElementById('editBdoName').value:'',ubNum:document.getElementById('editUbNum').value,ubName:document.getElementById('editUbName')?document.getElementById('editUbName').value:'',mayaNum:document.getElementById('editMayaNum').value,mayaName:document.getElementById('editMayaName').value,bank3Label:document.getElementById('editBank3Label').value,bank3Num:document.getElementById('editBank3Num').value,bank3Name:document.getElementById('editBank3Name').value,bank4Label:document.getElementById('editBank4Label').value,bank4Num:document.getElementById('editBank4Num').value,bank4Name:document.getElementById('editBank4Name').value,gcashEnabled:getChk('chkGcash'),bdoEnabled:getChk('chkBdo'),ubEnabled:getChk('chkUb'),mayaEnabled:getChk('chkMaya'),bank3Enabled:getChk('chkBank3'),bank4Enabled:getChk('chkBank4')};
  await set(paymentRef,data);document.getElementById('saveConfirm').style.display='block';setTimeout(function(){document.getElementById('saveConfirm').style.display='none';},3000);
};

let archivePanelOpen=false;
window.toggleArchivePanel=function(){archivePanelOpen=!archivePanelOpen;document.getElementById('archivePanel').style.display=archivePanelOpen?'block':'none';document.getElementById('ordersList').style.display=archivePanelOpen?'none':'block';var btn=document.getElementById('archiveToggleBtn');var hdg=document.getElementById('ordersHeading');if(btn){btn.textContent=archivePanelOpen?'← Back to Orders':'📦 View Archive';}if(hdg){hdg.textContent=archivePanelOpen?'Order Archive':'Active Orders';}if(archivePanelOpen)renderArchive();};
function renderArchive(){
  const el=document.getElementById('archiveList'),sumEl=document.getElementById('archiveSummary');
  const fromVal=document.getElementById('archiveFrom').value,toVal=document.getElementById('archiveTo').value;
  let orders=Object.values(archivedOrdersMap).sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
  if(fromVal)orders=orders.filter(o=>new Date(o.archivedAt||0)>=new Date(fromVal));
  if(toVal)orders=orders.filter(o=>new Date(o.archivedAt||0)<=new Date(toVal+'T23:59:59'));
  const rejCnt=orders.filter(o=>o.prevStatus==='Rejected').length;const totalRev=orders.filter(o=>o.prevStatus!=='Rejected').reduce((s,o)=>s+(o.total||0),0),gcashCnt=orders.filter(o=>o.payment==='GCash').length,bankCnt=orders.filter(o=>o.payment==='Bank Transfer').length;
  sumEl.innerHTML='<div><span class="archive-sum-num">'+orders.length+(rejCnt?' <span style="font-size:0.7rem;color:#721c24;">('+rejCnt+' ✗)</span>':'')+'</span><span class="archive-sum-lbl">Orders</span></div><div><span class="archive-sum-num">₱'+totalRev.toLocaleString()+'</span><span class="archive-sum-lbl">Revenue</span></div><div><span class="archive-sum-num">'+gcashCnt+'G / '+bankCnt+'B</span><span class="archive-sum-lbl">GCash / Bank</span></div>';
  if(!orders.length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:1.5rem;font-size:0.88rem;">No archived orders for selected range.</p>';return;}
  el.innerHTML=orders.map(function(o){return'<div class="archive-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;"><div><div style="font-weight:500;font-size:0.88rem;color:var(--bd);">'+escHtml(o.name)+' <span style="font-size:0.72rem;color:var(--tl);">#'+escHtml(o.id)+'</span></div><div style="font-size:0.75rem;color:var(--tl);">'+escHtml(o.date)+' · '+escHtml(o.time)+'</div></div>'+(o.prevStatus==='Rejected'?'<span class="badge badge-rejected">🔴 Rejected</span>':'<span class="badge badge-archived">📦 Archived</span>')+'</div><div style="font-size:0.8rem;color:var(--tm);margin:0.3rem 0;">🛒 '+escHtml(o.items)+'</div><div style="font-size:0.78rem;color:var(--tl);">₱'+(Number(o.total)||0).toLocaleString()+' · '+escHtml(o.payment)+' · '+escHtml(o.type)+'</div><div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Archived: '+escHtml(o.archivedDate||'—')+'</div></div>';}).join('');
}

window.openResContactPopup=function(id){
  const r=adminResMap[id];if(!r)return;
  const pref=(r.contactMethod||'call').toLowerCase();
  const prefLabels={whatsapp:'💬 WhatsApp',viber:'📱 Viber',sms:'📩 SMS',call:'📞 Phone Call',email:'📧 Email'};
  const contactRaw=r.contact||r.phone||'';
  const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactRaw)?contactRaw:'';
  const phone=(contactRaw.includes('@')?(r.phone||''):contactRaw).replace(/\D/g,'').replace(/^0/,'');
  const msg=encodeURIComponent('Hi '+r.name+'! 😊 Your reservation at Accaza Coffee House has been accepted!\n\n📅 Date: '+r.date+'\n🕐 Time: '+r.time+'\n👥 Guests: '+r.guests+(r.occasion?' · '+r.occasion:'')+'\n📍 Saratoga Ave, La Mediterranea, Dasmariñas, Cavite\n\nWe look forward to seeing you! ☕🐻\n— Accaza Coffee House');
  document.getElementById('resContactInfo').innerHTML='<p><strong>'+escHtml(r.name)+'</strong> · '+Math.max(1,Math.min(50,parseInt(r.guests)||1))+' guests · '+escHtml(r.date)+' · '+escHtml(r.time)+'</p><p>📱 '+escHtml(contactRaw||r.phone)+'</p><p style="color:#2d6a4f;font-weight:600;">⭐ Preferred contact: '+(prefLabels[pref]||'📞 Phone')+'</p>';
  const hl=function(m){return pref===m?'box-shadow:0 0 0 3px rgba(45,158,95,0.55);':'opacity:0.85;';};
  let btns='';
  btns+='<a href="https://wa.me/63'+phone+'?text='+msg+'" target="_blank" rel="noopener noreferrer" style="'+hl('whatsapp')+'background:#25D366;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">💬 WhatsApp'+(pref==='whatsapp'?' ⭐':'')+'</a>';
  btns+='<a href="viber://chat?number=%2B63'+phone+'&text='+msg+'" style="'+hl('viber')+'background:#7360f2;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📱 Viber'+(pref==='viber'?' ⭐':'')+'</a>';
  btns+='<a href="sms:+63'+phone+'?body='+msg+'" style="'+hl('sms')+'background:#44523f;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📩 SMS'+(pref==='sms'?' ⭐':'')+'</a>';
  btns+='<a href="tel:+63'+phone+'" style="'+hl('call')+'background:#0c5460;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📞 Call'+(pref==='call'?' ⭐':'')+'</a>';
  if(email)btns+='<a href="mailto:'+encodeURIComponent(email)+'?subject=Your%20Accaza%20Reservation&body='+msg+'" style="'+hl('email')+'background:#856404;color:#fff;border-radius:6px;padding:0.5rem 0.9rem;font-size:0.8rem;text-decoration:none;">📧 Email'+(pref==='email'?' ⭐':'')+'</a>';
  document.getElementById('resContactBtns').innerHTML=btns;
  document.getElementById('resContactPopup').classList.add('show');
};

let resArchiveOpen=false;
window.toggleResArchivePanel=function(){resArchiveOpen=!resArchiveOpen;document.getElementById('resArchivePanel').style.display=resArchiveOpen?'block':'none';document.getElementById('resList').style.display=resArchiveOpen?'none':'block';var btn=document.getElementById('resArchiveToggleBtn'),hdg=document.getElementById('resHeading');if(btn)btn.textContent=resArchiveOpen?'← Back to Reservations':'📦 View Archive';if(hdg)hdg.textContent=resArchiveOpen?'Reservation Archive':'Reservations';if(resArchiveOpen)renderResArchive();};

function filteredResArchive(){
  const fromVal=document.getElementById('resArchiveFrom').value,toVal=document.getElementById('resArchiveTo').value;
  let list=Object.values(archivedResMap).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  if(fromVal)list=list.filter(r=>(r.date||'')>=fromVal);
  if(toVal)list=list.filter(r=>(r.date||'')<=toVal);
  return list;
}
window.renderResArchive=function(){
  const el=document.getElementById('resArchiveList'),sumEl=document.getElementById('resArchiveSummary');
  const list=filteredResArchive();
  const totalGuests=list.filter(r=>r.prevStatus!=='Declined').reduce((s,r)=>s+(parseInt(r.guests)||0),0);
  const declinedCnt=list.filter(r=>r.prevStatus==='Declined').length;
  sumEl.innerHTML='<div><span class="archive-sum-num">'+list.length+'</span><span class="archive-sum-lbl">Reservations</span></div><div><span class="archive-sum-num">'+totalGuests+'</span><span class="archive-sum-lbl">Guests Served</span></div><div><span class="archive-sum-num">'+declinedCnt+'</span><span class="archive-sum-lbl">Declined</span></div>';
  if(!list.length){el.innerHTML='<p style="color:var(--tl);text-align:center;padding:1.5rem;font-size:0.88rem;">No archived reservations for selected range.</p>';return;}
  el.innerHTML=list.map(function(r){var guests=Math.max(1,Math.min(50,parseInt(r.guests)||1));return'<div class="archive-card"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;"><div><div style="font-weight:500;font-size:0.88rem;color:var(--bd);">'+escHtml(r.name)+' <span style="font-size:0.72rem;color:var(--tl);">#'+escHtml(r.id)+'</span></div><div style="font-size:0.75rem;color:var(--tl);">'+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guests'+(r.occasion?' · '+escHtml(r.occasion):'')+'</div></div>'+(r.prevStatus==='Declined'?'<span class="badge badge-declined">Declined</span>':'<span class="badge badge-archived">📦 Archived</span>')+'</div>'+(r.notes?'<div style="font-size:0.8rem;color:var(--tm);margin:0.3rem 0;">📝 '+escHtml(r.notes)+'</div>':'')+'<div style="font-size:0.72rem;color:var(--tl);margin-top:0.3rem;">Archived: '+escHtml(r.archivedDate||'—')+'</div></div>';}).join('');
};
window.printResArchive=function(){
  const fromVal=document.getElementById('resArchiveFrom').value,toVal=document.getElementById('resArchiveTo').value;
  const list=filteredResArchive().slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if(!list.length){alert('No archived reservations found for the selected date range.');return;}
  const totalGuests=list.filter(r=>r.prevStatus!=='Declined').reduce((s,r)=>s+(parseInt(r.guests)||0),0);
  const declinedCnt=list.filter(r=>r.prevStatus==='Declined').length;
  const rowH=44,headerH=220,pageW=800,totalH=headerH+list.length*rowH+80;
  const canvas=document.createElement('canvas');canvas.width=pageW;canvas.height=totalH;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#e0d4c6';ctx.fillRect(0,0,pageW,totalH);
  ctx.fillStyle='#19241b';ctx.fillRect(0,0,pageW,headerH);
  ctx.fillStyle='#c9a36a';ctx.font='bold 28px Georgia,serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House',pageW/2,55);
  ctx.fillStyle='rgba(224,212,198,0.7)';ctx.font='14px Inter,sans-serif';ctx.fillText('Saratoga Ave, La Mediterranea, Dasmariñas, Cavite',pageW/2,82);
  ctx.fillStyle='#fff';ctx.font='bold 18px Georgia,serif';ctx.fillText('Reservation Archive Report',pageW/2,118);
  const dateRange=fromVal&&toVal?fromVal+' to '+toVal:fromVal?'From '+fromVal:toVal?'Up to '+toVal:'All Time';
  ctx.fillStyle='rgba(224,212,198,0.6)';ctx.font='12px Inter,sans-serif';ctx.fillText(dateRange,pageW/2,140);
  ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(40,156,pageW-80,48);
  ctx.fillStyle='#c9a36a';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('Total Reservations: '+list.length,60,178);
  ctx.textAlign='center';ctx.fillText('Guests Served: '+totalGuests,pageW/2,178);
  ctx.textAlign='right';ctx.fillText('Declined: '+declinedCnt,pageW-60,178);
  ctx.fillStyle='rgba(224,212,198,0.4)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Generated: '+new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}),pageW/2,198);
  let y=headerH+16;
  ctx.fillStyle='#19241b';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';
  ['Res ID','Name','Date','Time','Guests','Occasion','Status'].forEach(function(h,i){ctx.fillText(h,[40,140,300,400,500,560,690][i],y);});
  ctx.strokeStyle='#cdbda7';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+8);ctx.lineTo(pageW-40,y+8);ctx.stroke();
  y+=rowH*0.6;
  list.forEach(function(r,idx){
    if(idx%2===0){ctx.fillStyle='rgba(176,141,87,0.06)';ctx.fillRect(40,y-14,pageW-80,rowH);}
    ctx.fillStyle='#1c2420';ctx.font='11px Inter,sans-serif';ctx.textAlign='left';
    ctx.fillText((r.id||'—'),40,y+4);
    ctx.fillText((r.name||'—').slice(0,18),140,y+4);
    ctx.fillText((r.date||'—'),300,y+4);
    ctx.fillText((r.time||'—').slice(0,14),400,y+4);
    ctx.fillText(String(r.guests||'—'),500,y+4);
    ctx.fillText((r.occasion||'—').slice(0,16),560,y+4);
    ctx.fillStyle=r.prevStatus==='Declined'?'#c0392b':'#155724';ctx.font='bold 11px Inter,sans-serif';
    ctx.fillText(r.prevStatus||'Completed',690,y+4);
    ctx.strokeStyle='#cdbda7';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(40,y+rowH-14);ctx.lineTo(pageW-40,y+rowH-14);ctx.stroke();
    y+=rowH;
  });
  ctx.fillStyle='#19241b';ctx.fillRect(0,totalH-40,pageW,40);
  ctx.fillStyle='rgba(224,212,198,0.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Accaza Coffee House · Confidential · For internal use only',pageW/2,totalH-14);
  const w=window.open('','_blank');
  if(!w){const link=document.createElement('a');link.download='Accaza_Reservations_'+new Date().toISOString().slice(0,10)+'.png';link.href=canvas.toDataURL('image/png');link.click();return;}
  w.document.write('<html><head><title>Reservation Archive — Accaza Coffee House</title></head><body style="margin:0;"><img src="'+canvas.toDataURL('image/png')+'" alt="Reservation archive" style="width:100%;" onload="setTimeout(function(){window.print();},400);"/></body></html>');
  w.document.close();
};

function showDeletePopup(label,onConfirm){
  document.getElementById('deleteLabel').textContent=label;
  const isArchive=String(label).toLowerCase().includes('archive');
  document.getElementById('deleteConfirmBtn').textContent=isArchive?'Yes, Archive':'Yes, Delete';
  document.getElementById('deleteConfirmBtn').style.background=isArchive?'#41464b':'#c0392b';
  document.getElementById('deleteConfirmBtn').onclick=function(){onConfirm();document.getElementById('deletePopup').classList.remove('show');};
  document.getElementById('deletePopup').classList.add('show');
}

window.openAdmin=function(){document.getElementById('loginOverlay').classList.add('show');setTimeout(function(){document.getElementById('adminPass').focus();},150);};
window.closeAdmin=function(){document.getElementById('loginOverlay').classList.remove('show');document.getElementById('loginErr').style.display='none';document.getElementById('adminPass').value='';};

// ── ROLE SELECTOR ──────────────────────────────────────────
window.selectLoginRole=function(role){
  currentLoginRole=role;
  document.getElementById('loginForm').style.display='block';
  var aBtn=document.getElementById('roleAdminBtn'),sBtn=document.getElementById('roleStaffBtn');
  aBtn.style.background=role==='admin'?'var(--bd)':'#fff';
  aBtn.style.color=role==='admin'?'#fff':'var(--td)';
  aBtn.style.borderColor=role==='admin'?'var(--bd)':'var(--cd)';
  sBtn.style.background=role==='staff'?'var(--bl)':'#fff';
  sBtn.style.color=role==='staff'?'#fff':'var(--td)';
  sBtn.style.borderColor=role==='staff'?'var(--bl)':'var(--cd)';
  var fBtn=document.getElementById('forgotPwBtn');
  if(fBtn)fBtn.style.display=role==='admin'?'inline':'none';
  document.getElementById('forgotPwPanel').style.display='none';
  document.getElementById('loginErr').style.display='none';
  setTimeout(function(){document.getElementById('adminUser').focus();},100);
};

// ── LOGIN SUCCESS ───────────────────────────────────────────
async function loginSuccess(role,username,uid){
  currentUser={role,username,uid};
  try{localStorage.setItem('accaza_admin_session',JSON.stringify({role:role,username:username,uid:uid||null}));}catch(e){}
  try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}
  document.getElementById('adminUser').value='';
  document.getElementById('adminPass').value='';
  closeAdmin();
  document.body.classList.remove('staff-mode');
  // Reset tab visibility
  document.querySelectorAll('.admin-tab').forEach(function(t){t.style.removeProperty('display');});
  var aaccTab=document.getElementById('tabBtnAdminAccounts');
  if(aaccTab)aaccTab.style.display='none';

  if(role==='superadmin'||role==='admin'){
    adminLoggedIn=true;superAdminLoggedIn=(role==='superadmin');staffLoggedIn=false;
    ['adminDash','availSection','commentsSection'].forEach(function(id){document.getElementById(id).style.display='block';});
    ['navAvail','navComments','navAdminPanel'].forEach(function(id){document.getElementById(id).style.display='block';});
    document.getElementById('navAdminPanelLink').textContent='🔐 Admin Panel';
    if(superAdminLoggedIn&&aaccTab)aaccTab.style.removeProperty('display');
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent=(superAdminLoggedIn?'👑 Super Admin':'🔑 Admin')+': '+username;
    // Restrict Payment Details for limited admins
    if(role==='admin'&&uid&&adminAccountsMap[uid]&&adminAccountsMap[uid].access==='nopay'){
      document.querySelectorAll('.admin-tab').forEach(function(btn){
        var oc=btn.getAttribute('onclick')||'';
        if(oc.indexOf("'payment'")!==-1)btn.style.display='none';
      });
      var tpay=document.getElementById('tab-payment');if(tpay)tpay.style.display='none';
      if(hdr)hdr.textContent='🔑 Admin: '+username+' · Limited access';
    }
    setTimeout(function(){
      buildAvail();renderCategoryManager();renderOptionManager();renderNewItemOptionChecklist();renderComments();renderOrders();renderReservations();
      renderAdminReviews();renderAdminCalendar();renderDashboard();renderStaffAccounts();
      if(superAdminLoggedIn)renderAdminAccounts();
    },300);
  }else{
    // Staff
    staffLoggedIn=true;adminLoggedIn=false;superAdminLoggedIn=false;
    document.body.classList.add('staff-mode');
    document.getElementById('adminDash').style.display='block';
    document.getElementById('commentsSection').style.display='block';
    ['availSection','navAvail'].forEach(function(id){document.getElementById(id).style.display='none';});
    document.getElementById('navAdminPanel').style.display='block';
    document.getElementById('navComments').style.display='block';
    document.getElementById('navAdminPanelLink').textContent='🔐 Staff Panel';
    // Hide tabs not for staff
    document.querySelectorAll('.admin-tab').forEach(function(btn){
      var oc=btn.getAttribute('onclick')||'';
      var hides=['payment','staffaccounts','adminaccounts'];
      if(hides.some(function(t){return oc.indexOf("'"+t+"'")!==-1;})){btn.style.display='none';}
    });
    var hdr=document.querySelector('#adminDash .admin-header p');
    if(hdr)hdr.textContent='👤 Staff: '+username;
    setTimeout(function(){
      renderOrders();renderReservations();renderAdminCalendar();renderDashboard();
      renderAdminReviews();renderComments();renderStaffMenu();
    },300);
  }
  window.scrollTo(0,0);
}

// ── CHECK LOGIN ─────────────────────────────────────────────
// Restore admin/staff session across page loads
(function(){/* old admin auto-login disabled - admin now lives on admin.html */})();
window.checkLogin=async function(){
  var username=(document.getElementById('adminUser').value||'').trim().toLowerCase();
  var pass=document.getElementById('adminPass').value;
  if(!username||!pass){document.getElementById('loginErr').style.display='block';return;}
  var hashBuf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pass));
  var hashHex=Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  document.getElementById('loginErr').style.display='none';

  if(currentLoginRole==='admin'){
    // Check super admin
    if(username===SUPER_ADMIN_USERNAME&&hashHex===currentAdminHash){
      await loginSuccess('superadmin','superadmin',null);
    }else{
      // Check admin accounts
      var match=null;
      for(var uid in adminAccountsMap){
        if(adminAccountsMap[uid].username===username&&adminAccountsMap[uid].passwordHash===hashHex){
          match={uid,username:adminAccountsMap[uid].username};break;
        }
      }
      if(match){await loginSuccess('admin',match.username,match.uid);}
      else{document.getElementById('loginErr').style.display='block';document.getElementById('adminPass').value='';}
    }
  }else if(currentLoginRole==='staff'){
    var smatch=null;
    for(var suid in staffAccountsMap){
      if(staffAccountsMap[suid].username===username&&staffAccountsMap[suid].passwordHash===hashHex){
        smatch={uid:suid,username:staffAccountsMap[suid].username};break;
      }
    }
    if(smatch){await loginSuccess('staff',smatch.username,smatch.uid);}
    else{document.getElementById('loginErr').style.display='block';document.getElementById('adminPass').value='';}
  }else{
    document.getElementById('loginErr').style.display='block';
  }
};

window.logoutAdmin=function(){
  adminLoggedIn=false;superAdminLoggedIn=false;staffLoggedIn=false;currentUser=null;currentLoginRole=null;
  try{localStorage.removeItem('accaza_admin_session');}catch(e){}
  clearOrderAlert();
  document.body.classList.remove('staff-mode');
  // Hide all tab content panels (they live outside adminDash)
  document.querySelectorAll('.admin-tab-content').forEach(function(el){el.style.display='none';});
  ['adminDash','availSection','commentsSection'].forEach(function(id){document.getElementById(id).style.display='none';});
  ['navAvail','navComments','navAdminPanel'].forEach(function(id){document.getElementById(id).style.display='none';});
  document.querySelectorAll('.admin-tab').forEach(function(t){t.style.removeProperty('display');});
  var aaccTab=document.getElementById('tabBtnAdminAccounts');
  if(aaccTab)aaccTab.style.display='none';
  // Reset login form
  document.getElementById('loginForm').style.display='none';
  var aBtn=document.getElementById('roleAdminBtn'),sBtn=document.getElementById('roleStaffBtn');
  if(aBtn){aBtn.style.background='#fff';aBtn.style.color='var(--td)';aBtn.style.borderColor='var(--cd)';}
  if(sBtn){sBtn.style.background='#fff';sBtn.style.color='var(--td)';sBtn.style.borderColor='var(--cd)';}
  var hdr=document.querySelector('#adminDash .admin-header p');
  if(hdr)hdr.textContent='🔥 Firebase Realtime DB';
  window.scrollTo(0,0);
};
window.switchTab=function(tab,btn){
  if(tab==='payment'&&currentUser&&currentUser.role==='admin'&&currentUser.uid&&adminAccountsMap[currentUser.uid]&&adminAccountsMap[currentUser.uid].access==='nopay'){alert('⛔ You do not have access to Payment Details.');return;}
  document.querySelectorAll('.admin-tab').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(function(t){t.style.display='none';});
  document.getElementById('tab-'+tab).style.display='block';
  if(tab==='orders')clearOrderAlert();
  if(tab==='reviews')renderAdminReviews();
  if(tab==='calendar')renderAdminCalendar();
  if(tab==='dashboard')renderDashboard();
  if(tab==='appcustomers')renderAppCustomers();
};
