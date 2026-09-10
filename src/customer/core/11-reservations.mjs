
// ── RESERVATIONS ──
const resStatusConfig={Pending:{icon:'🟡',color:'#856404',bg:'#fef3cd',msg:'Your reservation request has been received and is awaiting confirmation from our staff.'},Accepted:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your reservation is confirmed! Our staff will reach out with the final details. See you soon! ☕'},Confirmed:{icon:'🟢',color:'#155724',bg:'#d4edda',msg:'Your reservation is confirmed! Our staff will reach out with the final details. See you soon! ☕'},Declined:{icon:'🔴',color:'#721c24',bg:'#f8d7da',msg:'Unfortunately we could not accommodate this reservation. Please contact us at 0927 692 4831 to discuss options.'},Completed:{icon:'✅',color:'#155724',bg:'#d4edda',msg:'Thank you for visiting Accaza Coffee House! We hope to see you again. ☕🐻'}};
function renderMyReservations(){
  var el=document.getElementById('myReservationsList');if(!el)return;
  var mine=myReservationIds.map(function(id){return myResMap[id];}).filter(function(r){return r&&r.status!=='Archived';}).sort(function(a,b){return(b.timestamp||0)-(a.timestamp||0);});
  if(!mine.length){el.innerHTML='';return;}
  el.innerHTML='<h3 style="font-family:\'Playfair Display\',serif;color:var(--cr);font-size:1.15rem;margin-bottom:0.85rem;text-align:center;">Your Reservation'+(mine.length>1?'s':'')+'</h3>'+mine.map(function(r){
    var st=(r.status==='Confirmed')?'Accepted':(r.status||'Pending');var s=resStatusConfig[st]||resStatusConfig.Pending;var guests=Math.max(1,Math.min(50,parseInt(r.guests)||1));
    return '<div style="background:#fff;border:2px solid #a8d5b5;border-radius:12px;overflow:hidden;margin-bottom:1rem;">'
      +'<div style="background:var(--bd);padding:0.85rem 1.1rem;text-align:center;"><p style="font-size:0.7rem;color:rgba(224,212,198,0.6);text-transform:uppercase;letter-spacing:0.15em;">Reservation</p><p style="font-family:\'Playfair Display\',serif;font-size:1.3rem;color:#fff;font-weight:600;">#'+escHtml(r.id)+'</p><p style="font-size:0.75rem;color:#c9a36a;margin-top:0.2rem;">📅 '+escHtml(r.date)+' · '+escHtml(r.time)+' · '+guests+' guest'+(guests>1?'s':'')+'</p></div>'
      +'<div style="padding:0.9rem 1.1rem;background:'+s.bg+';"><p style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.15em;color:'+s.color+';margin-bottom:0.4rem;font-weight:600;">Reservation Status</p><div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;"><span style="font-size:1.2rem;">'+s.icon+'</span><span style="font-size:0.98rem;font-weight:700;color:'+s.color+';">'+escHtml(st)+'</span></div><p style="font-size:0.82rem;color:'+s.color+';line-height:1.5;">'+s.msg+'</p></div></div>';
  }).join('')+'<p style="font-size:0.72rem;color:rgba(224,212,198,0.6);text-align:center;">🔥 Status updates automatically — no refresh needed!</p>';
}
window.renderMyReservations=renderMyReservations;
function getConfirmedGuestsForDate(k){return Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).reduce((s,r)=>s+(parseInt(r.guests)||0),0);}
function getConfirmedSlotsForDate(k){const s=new Set();Object.values(adminResMap).filter(r=>r.date===k&&(r.status==='Accepted'||r.status==='Confirmed')).forEach(r=>s.add(r.time));return s;}
function dateKey(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function getDateStatus(y,m,d){const k=dateKey(y,m,d);const bl=calBlocks[k];if(bl&&bl.blocked)return'blocked';const g=getConfirmedGuestsForDate(k);if(g>=MAX_GUESTS)return'blocked';if(g>0)return'partial';if(bl&&bl.slots&&Object.values(bl.slots).some(v=>v===false))return'partial';return'open';}
function isSlotBlocked(k,slot){const b=calBlocks[k];if(b&&b.blocked)return true;if(b&&b.slots&&b.slots[slot]===false)return true;return false;}
function renderCustomerCalendar(){
  if(!document.getElementById('calGrid'))return;
  const title=new Date(calYear,calMonth).toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  document.getElementById('calTitle').textContent=title;
  const today=new Date();today.setHours(0,0,0,0);
  const maxDate=new Date(today);maxDate.setMonth(maxDate.getMonth()+5);
  document.getElementById('calPrev').disabled=new Date(calYear,calMonth,1)<=new Date(today.getFullYear(),today.getMonth(),1);
  document.getElementById('calNext').disabled=new Date(calYear,calMonth,1)>=new Date(maxDate.getFullYear(),maxDate.getMonth(),1);
  const firstDay=new Date(calYear,calMonth,1).getDay(),daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  let html=['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>'<div class="cal-day-label">'+d+'</div>').join('');
  for(let i=0;i<firstDay;i++)html+='<div class="cal-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const date=new Date(calYear,calMonth,d);date.setHours(0,0,0,0);
    const isPast=date<today,isToday=date.getTime()===today.getTime();
    const status=getDateStatus(calYear,calMonth,d),k=dateKey(calYear,calMonth,d);
    let cls='cal-day';if(isPast)cls+=' past';else if(status==='blocked')cls+=' blocked';else if(status==='partial')cls+=' partial';else cls+=' open';
    if(isToday)cls+=' today';if(selectedDate===k)cls+=' selected';
    const clickable=!isPast&&status!=='blocked';
    html+='<div class="'+cls+'" '+(clickable?'data-y="'+calYear+'" data-m="'+calMonth+'" data-d="'+d+'"':'')+'>'+d+'</div>';
  }
  const grid=document.getElementById('calGrid');
  grid.innerHTML=html;
  grid.querySelectorAll('.cal-day[data-y]').forEach(function(el){
    el.addEventListener('click',function(){selectCalDate(parseInt(this.dataset.y),parseInt(this.dataset.m),parseInt(this.dataset.d));});
  });
}
window.calNavigate=function(dir){calMonth+=dir;if(calMonth>11){calMonth=0;calYear++;}if(calMonth<0){calMonth=11;calYear--;}renderCustomerCalendar();};
function selectCalDate(y,m,d){
  selectedDate=dateKey(y,m,d);selectedTime=null;renderCustomerCalendar();
  document.getElementById('timeSlotsWrap').style.display='block';
  document.getElementById('selectedDateLabel').textContent=new Date(y,m,d).toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  renderTimeSlots();document.getElementById('resFormWrap').style.display='none';
  document.getElementById('timeSlotsWrap').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderTimeSlots(){
  const confirmedSlots=getConfirmedSlotsForDate(selectedDate),dayFull=getConfirmedGuestsForDate(selectedDate)>=MAX_GUESTS;
  const fdBtn=document.getElementById('fullDaySlot');
  if(fdBtn){const fdSel=selectedTime==='Full Day Booking';fdBtn.style.background=fdSel?'rgba(45,158,95,0.5)':'rgba(45,158,95,0.15)';fdBtn.style.color=fdSel?'#fff':'#a5d6a7';fdBtn.style.borderColor=fdSel?'rgba(45,158,95,0.8)':'rgba(45,158,95,0.3)';}
  const grid=document.getElementById('timeSlotsGrid');
  grid.innerHTML=TIME_SLOTS.map(function(slot){
    const blocked=isSlotBlocked(selectedDate,slot)||dayFull,confirmed=confirmedSlots.has(slot),sel=selectedTime===slot;
    const cls='time-slot '+(sel?'selected':blocked?'blocked':'available');
    return'<button type="button" class="'+cls+'" '+(blocked?'disabled aria-disabled="true"':'data-slot="'+slot+'"')+'>'+slot+(confirmed&&!blocked?'<br/><span style="font-size:0.62rem;opacity:0.7;">booked</span>':'')+'</button>';
  }).join('');
  grid.querySelectorAll('.time-slot[data-slot]').forEach(function(el){el.addEventListener('click',function(){window.selectTimeSlot(this.dataset.slot);});});
}
const fullDaySlotButton=document.getElementById('fullDaySlot');if(fullDaySlotButton)fullDaySlotButton.addEventListener('click',function(){window.selectTimeSlot('Full Day Booking');});
window.selectTimeSlot=function(slot){
  selectedTime=slot;renderTimeSlots();
  const fw=document.getElementById('resFormWrap');fw.style.display='block';
  const label=new Date(selectedDate+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  document.getElementById('resSummaryDateTime').textContent=label+' · '+slot;
  window.updateBookingType();fw.scrollIntoView({behavior:'smooth',block:'nearest'});
};
window.resetResSelection=function(){selectedTime=null;document.getElementById('resFormWrap').style.display='none';};
window.updateBookingType=function(){
  const guests=parseInt(document.getElementById('resGuests').value)||1,infoEl=document.getElementById('bookingTypeInfo');
  let type,color,bg,icon,msg,reqAdvance=false;
  if(guests<=2){type='Individual / Couple';icon='💑';color='#155724';bg='#d4edda';msg='Same-day booking accepted. Our staff will contact you to confirm.';}
  else if(guests<=5){type='Small Group';icon='👨‍👩‍👧';color='#664d03';bg='#fff3cd';msg='Same-day booking. Deposit details will be discussed upon staff confirmation.';}
  else if(guests<=20){type='Medium Group';icon='👥';color='#0c5460';bg='#d1ecf1';msg='At least 7 days advance booking required.';reqAdvance=true;}
  else{type='Large Group';icon='🎉';color='#721c24';bg='#fde8e8';msg='At least 7 days advance booking required. Admin callback required.';reqAdvance=true;}
  infoEl.innerHTML='<div style="background:'+bg+';border-radius:8px;padding:0.75rem 1rem;display:flex;align-items:flex-start;gap:0.6rem;"><span style="font-size:1.2rem;">'+icon+'</span><div><p style="font-size:0.82rem;font-weight:600;color:'+color+';">'+type+'</p><p style="font-size:0.78rem;color:'+color+';line-height:1.5;margin-top:0.2rem;">'+msg+'</p></div></div>';
  if(reqAdvance&&selectedDate){const today=new Date();today.setHours(0,0,0,0);const bd=new Date(selectedDate+'T00:00:00');if(Math.ceil((bd-today)/(1000*60*60*24))<7)infoEl.innerHTML+='<div style="background:#fde8e8;border:1px solid #f5c6c6;border-radius:6px;padding:0.75rem;margin-top:0.5rem;"><p style="font-size:0.78rem;color:#721c24;line-height:1.6;">⚠️ This booking requires at least 7 days advance notice. Please select a later date, or call us at <strong>0927 692 4831</strong>.</p></div>';}
};
window.setResContact=function(type){resContactMethod=type;['Wa','Vb','Sms','Call','Email'].forEach(function(_,i){const ids=['resBtnWa','resBtnVb','resBtnSms','resBtnCall','resBtnEmail'],types=['whatsapp','viber','sms','call','email'];const el=document.getElementById(ids[i]);if(el)el.classList.toggle('active',types[i]===type);});const ph={whatsapp:'Enter your WhatsApp number',viber:'Enter your Viber number',sms:'Enter your phone number for SMS',call:'Enter your phone number',email:'Enter your email address'};document.getElementById('resContact').placeholder=ph[type]||'Enter your contact';};
window.submitReservation=async function(){
  if(window._placingRes)return;
  const name=document.getElementById('resName').value.trim(),phone=document.getElementById('resPhone').value.trim();
  if(!selectedDate||!selectedTime){alert('Please select a date and time.');return;}
  if(!name||!phone){alert('Please enter your name and phone number.');return;}
  const guests=parseInt(document.getElementById('resGuests').value)||1;
  if(guests>=6){const today=new Date();today.setHours(0,0,0,0);const diff=Math.ceil((new Date(selectedDate+'T00:00:00')-today)/(1000*60*60*24));if(diff<7&&!confirm('This booking typically requires 7 days advance notice. Proceed anyway?'))return;}
  const id='RES-'+(Date.now()%2176782336).toString(36).toUpperCase().padStart(6,'0');
  window._placingRes=true;
  const _rbtn=document.querySelector('.btn-reserve');_rbtn.disabled=true;_rbtn.style.opacity='0.5';_rbtn.textContent='⏳ Submitting…';
  try{
    var _resAu=await ensureCustomerAuth();
    await set(ref(db,'reservations/'+id),{id,name,phone,date:selectedDate,time:selectedTime,guests:document.getElementById('resGuests').value,occasion:document.getElementById('resOccasion').value,notes:document.getElementById('resNotes').value.trim(),contact:document.getElementById('resContact').value.trim(),contactMethod:resContactMethod,status:'Pending',ownerUid:_resAu.uid,timestamp:Date.now()});
    if(myReservationIds.indexOf(id)<0)myReservationIds.push(id);try{localStorage.setItem('accaza_my_reservations',JSON.stringify(myReservationIds));}catch(e){}subscribeMyReservations();renderMyReservations();
    window._placingRes=false;_rbtn.textContent='✅ Request Sent!';
    document.getElementById('resConfirm').style.display='block';
    setTimeout(function(){document.getElementById('resConfirm').style.display='none';var rb=document.querySelector('.btn-reserve');rb.disabled=false;rb.style.opacity='1';rb.textContent='Submit Reservation Request';document.getElementById('resName').value='';document.getElementById('resPhone').value='';document.getElementById('resNotes').value='';document.getElementById('resContact').value='';selectedDate=null;selectedTime=null;document.getElementById('resFormWrap').style.display='none';document.getElementById('timeSlotsWrap').style.display='none';renderCustomerCalendar();},5000);
  }catch(e){window._placingRes=false;_rbtn.disabled=false;_rbtn.style.opacity='1';_rbtn.textContent='Submit Reservation Request';alert('Could not submit: '+e.message);}
};
