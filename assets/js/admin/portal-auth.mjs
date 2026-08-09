import{auth,db,ref,get,signInWithEmailAndPassword,signOut,onAuthStateChanged,setPersistence,browserLocalPersistence}from"./firebase-client.mjs";

function portalRole(raw){
  var r=raw===true?'owner':(typeof raw==='string'?raw:((raw&&raw.role)||''));
  r=String(r||'').toLowerCase();
  if(['owner','superadmin','admin','manager'].indexOf(r)>-1)return {ui:'admin',server:r};
  if(['staff','cashier','kitchen','finance'].indexOf(r)>-1)return {ui:'staff',server:r};
  return null;
}

function installPortalAuth(options){
  var subscriptionHub=options.subscriptionHub,onAuthorized=options.onAuthorized,onSignedOut=options.onSignedOut,openLogin=options.openLogin;
  var authGateResolved=false,portalAuthPromise=null,portalAuthUid=null;
  window.__accazaAuthGateReady=function(){return authGateResolved;};
  async function authorizePortalUser(user){
    if(portalAuthUid===user.uid&&window.__accazaAuthz)return;
    if(portalAuthPromise)return portalAuthPromise;
    portalAuthPromise=(async function(){
      var results=await Promise.all([get(ref(db,'admins/'+user.uid)),get(ref(db,'adminPerms/'+user.uid+'/name')).catch(function(){return null;})]);
      var roleSnap=results[0],nameSnap=results[1],mapped=roleSnap.exists()?portalRole(roleSnap.val()):null;
      if(!mapped)throw new Error('This Firebase account is not authorized for the Accaza portal.');
      var display=(user.displayName||user.email||user.uid);if(nameSnap&&nameSnap.exists()&&nameSnap.val())display=nameSnap.val();
      await onAuthorized(mapped.ui,display,user.uid,mapped.server);portalAuthUid=user.uid;authGateResolved=true;
      if(location.hash)setTimeout(function(){var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView();},450);
    })();
    try{return await portalAuthPromise;}finally{portalAuthPromise=null;}
  }
  onAuthStateChanged(auth,async function(user){
    if(!user){authGateResolved=true;portalAuthUid=null;window.__accazaAuthz=null;subscriptionHub.deauthorize();if(onSignedOut)onSignedOut();return;}
    try{await authorizePortalUser(user);}catch(e){authGateResolved=true;console.error('ACCAZA AUTHORIZATION ERROR',e);try{await signOut(auth);}catch(_so){}try{sessionStorage.removeItem('accaza_admin_session');}catch(_ss){}var le=document.getElementById('loginErr');if(le){le.textContent=(e&&e.message)||'This account is not authorized.';le.style.display='block';le.style.whiteSpace='normal';}openLogin();}
  });
  window.checkLogin=async function(){
    var username=(document.getElementById('adminUser').value||'').trim().toLowerCase(),pass=document.getElementById('adminPass').value,_le=document.getElementById('loginErr'),_btn=document.getElementById('adminLoginBtn');
    if(!username||username.indexOf('@')<1||!pass){_le.textContent='Enter your Firebase account email and password.';_le.style.display='block';return;}_le.style.display='none';if(_btn){_btn.disabled=true;_btn.textContent='Signing in…';}
    try{try{await setPersistence(auth,browserLocalPersistence);}catch(_p){}var cred=await signInWithEmailAndPassword(auth,username,pass);await authorizePortalUser(cred.user);}catch(_e){console.error('ACCAZA AUTH ERROR',_e);_le.textContent=(_e&&_e.message&&_e.message.indexOf('not authorized')>-1)?_e.message:'Login failed. Check the email and password.';_le.style.display='block';document.getElementById('adminPass').value='';}finally{if(_btn){_btn.disabled=false;_btn.textContent='Log In';}}
  };
  window.logoutAdmin=function(){
    try{sessionStorage.removeItem('accaza_admin_session');}catch(e){}portalAuthUid=null;window.__accazaAuthz=null;subscriptionHub.deauthorize();if(onSignedOut)onSignedOut();var go=function(){window.location.href='index.html';};try{signOut(auth).then(go).catch(go);}catch(e){go();}
  };
  return {authorizePortalUser:authorizePortalUser};
}

export{portalRole,installPortalAuth};
