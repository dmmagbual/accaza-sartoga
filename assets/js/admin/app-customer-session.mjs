import{db,ref,get,update}from"./firebase-client.mjs";

export function createAppCustomerSession(deps={}){
  const setupPush=deps.setupPush||function(){};
  const refreshNotifyPrompt=deps.refreshNotifyPrompt||function(){};

  function isAppMode(){
    return document.documentElement.classList.contains('app-mode')||
      window.matchMedia('(display-mode: standalone)').matches||
      window.navigator.standalone===true;
  }
  function getUser(){
    try{return JSON.parse(localStorage.getItem('accaza_app_user')||'null');}
    catch(e){return null;}
  }
  function prefill(){
    const u=getUser();if(!u)return;
    const n=document.getElementById('custName'),p=document.getElementById('custPhone');
    if(n&&!n.value)n.value=u.name;
    if(p&&!p.value)p.value=u.phone;
    const ind=document.getElementById('appUserIndicator');
    if(ind){const nm=document.getElementById('appUserName');if(nm)nm.textContent=u.name;ind.style.display='block';}
  }
  async function submit(){
    const n=(document.getElementById('appLoginName').value||'').trim();
    const p=(document.getElementById('appLoginPhone').value||'').trim();
    const err=document.getElementById('appLoginErr');
    if(n.length<2){err.textContent='Please enter your full name.';err.style.display='block';return;}
    const key=p.replace(/[^0-9]/g,'');
    if(key.length<10){err.textContent='Please enter a valid phone number.';err.style.display='block';return;}
    err.style.display='none';
    const user={name:n,phone:p,since:Date.now()};
    try{
      localStorage.setItem('accaza_app_user',JSON.stringify(user));
      const snap=await get(ref(db,'appCustomers/'+key));
      const old=snap.val()||{};
      await update(ref(db,'appCustomers/'+key),{name:n,phone:p,orders:old.orders||0,firstSeen:old.firstSeen||Date.now(),lastSeen:Date.now()});
    }catch(e){}
    const ov=document.getElementById('appLoginOverlay');if(ov)ov.style.display='none';
    prefill();setupPush();refreshNotifyPrompt();
  }
  function logout(){try{localStorage.removeItem('accaza_app_user');}catch(e){}location.reload();}
  function init(){
    if(!isAppMode())return;
    const ov=document.getElementById('appLoginOverlay'),u=getUser();
    if(!u){if(ov)ov.style.display='flex';}
    else{prefill();setupPush();refreshNotifyPrompt();}
  }

  window.appLoginSubmit=submit;
  window.appLogout=logout;
  return{init,isAppMode,getUser,prefill};
}
