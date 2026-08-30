
// ── ADMIN CALENDAR ──
function renderAdminCalendar(){
  const title=new Date(adminCalYear,adminCalMonth).toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  document.getElementById('adminCalTitle').textContent=title;
  const today=new Date();today.setHours(0,0,0,0);
  const firstDay=new Date(adminCalYear,adminCalMonth,1).getDay(),daysInMonth=new Date(adminCalYear,adminCalMonth+1,0).getDate();
  let html=['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>'<div style="text-align:center;font-size:0.68rem;color:var(--tl);padding:0.3rem 0;text-transform:uppercase;">'+d+'</div>').join('');
  for(let i=0;i<firstDay;i++)html+='<div class="admin-cal-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(adminCalYear,adminCalMonth,d);date.setHours(0,0,0,0);
    const isPast=date<today,isToday=date.getTime()===today.getTime();
    const k=dateKey(adminCalYear,adminCalMonth,d),status=getDateStatus(adminCalYear,adminCalMonth,d);
    let cls='admin-cal-day';if(isPast)cls+=' past';else if(status==='blocked')cls+=' blocked';else if(status==='partial')cls+=' partial';else cls+=' open';
    if(isToday)cls+=' today';if(adminSelectedDate===k)cls+=' selected';
    html+='<div class="'+cls+'" data-k="'+k+'">'+d+'</div>';
  }
  const grid=document.getElementById('adminCalGrid');grid.innerHTML=html;
  grid.querySelectorAll('.admin-cal-day[data-k]').forEach(function(el){el.addEventListener('click',function(){adminSelectDate(this.dataset.k);});});
}
window.adminCalNavigate=function(dir){adminCalMonth+=dir;if(adminCalMonth>11){adminCalMonth=0;adminCalYear++;}if(adminCalMonth<0){adminCalMonth=11;adminCalYear--;}renderAdminCalendar();};
function adminSelectDate(k){
  adminSelectedDate=k;renderAdminCalendar();
  document.getElementById('adminSlotManager').style.display='block';
  const parts=k.split('-');
  document.getElementById('adminSlotTitle').textContent=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2])).toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  renderAdminSlots(k);
}
function renderAdminSlots(k){
  const grid=document.getElementById('adminSlotGrid');const confirmedSlots=getConfirmedSlotsForDate(k);
  grid.innerHTML=TIME_SLOTS.map(function(slot){
    if(confirmedSlots.has(slot))return'<div class="slot-item booked">📅 '+slot+'</div>';
    if(isSlotBlocked(k,slot)&&!confirmedSlots.has(slot))return'<div class="slot-item blocked" data-k="'+k+'" data-slot="'+slot+'" data-blocked="1">❌ '+slot+'</div>';
    return'<div class="slot-item open" data-k="'+k+'" data-slot="'+slot+'" data-blocked="0">✅ '+slot+'</div>';
  }).join('');
  grid.querySelectorAll('.slot-item[data-slot]').forEach(function(el){
    el.addEventListener('click',async function(){
      const dk=this.dataset.k,slot=this.dataset.slot,isBlocked=this.dataset.blocked==='1';
      if(isBlocked){const snap=await get(ref(db,'calBlocks/'+dk+'/slots/'+slot));if(snap.exists())await remove(ref(db,'calBlocks/'+dk+'/slots/'+slot));const all=await get(ref(db,'calBlocks/'+dk+'/slots'));if(!all.exists())await remove(ref(db,'calBlocks/'+dk));}
      else{await update(ref(db,'calBlocks/'+dk+'/slots'),{[slot]:false});}
      setTimeout(function(){renderAdminSlots(dk);},400);
    });
  });
}
window.blockAllSlots=async function(){if(!adminSelectedDate)return;await set(ref(db,'calBlocks/'+adminSelectedDate),{blocked:true});setTimeout(function(){renderAdminSlots(adminSelectedDate);},400);};
window.openAllSlots=async function(){if(!adminSelectedDate)return;await remove(ref(db,'calBlocks/'+adminSelectedDate));setTimeout(function(){renderAdminSlots(adminSelectedDate);},400);};
