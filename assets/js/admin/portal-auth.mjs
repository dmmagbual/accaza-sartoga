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
  // Owner emergency sign-out: a session that signed in before /sessionControl/cutoff/at ends
  // here at once (the server refuses it as well). The node is a single small record.
  // Exception: a POS cart being rung up right now (assets/js/admin/pos.js) lives only in memory
  // — a submitted sale is safe either way (it queues in IndexedDB and syncs after sign-in, see
  // offline-queue.js), but an unsubmitted cart would be wiped by the sign-out redirect. So a
  // cart in progress gets a short, capped grace window to finish or clear before the device is
  // dropped; every other session (nothing in the cart, or not on the POS screen) signs out at
  // once as before. The cap keeps this a true emergency stop, not a standing exemption.
  var stopCutoffWatch=null,cutoffSignOut=false,cutoffPending=false;
  var CUTOFF_CART_GRACE_MS=90000,CUTOFF_CART_POLL_MS=2000;
  function cutoffBanner(msg){
    var b=document.getElementById('sessionCutoffBanner');
    if(!msg){if(b)b.remove();return;}
    if(!b){b=document.createElement('div');b.id='sessionCutoffBanner';b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#8b1e1e;color:#fff;text-align:center;padding:.5rem 1rem;font:600 .85rem/1.3 system-ui,sans-serif;';document.body.appendChild(b);}
    b.textContent=msg;
  }
  function cartInProgress(){try{return !!(window.__pos&&window.__pos.hasItems&&window.__pos.hasItems());}catch(_e){return false;}}
  async function finishCutoffSignOut(user,cutoff){
    cutoffSignOut=true;cutoffBanner(null);try{sessionStorage.removeItem('accaza_admin_session');}catch(_s){}
    try{await signOut(auth);}catch(_o){}
    cutoffSignOut=false;var le=document.getElementById('loginErr');if(le){le.textContent='The owner signed every device out'+(cutoff.reason?(': '+cutoff.reason):'')+'. Sign in again.';le.style.display='block';le.style.whiteSpace='normal';}openLogin();
  }
  function watchSessionCutoff(user){
    if(stopCutoffWatch)stopCutoffWatch();
    stopCutoffWatch=subscriptionHub.subscribe('sessionControl',async function(snap){
      var cutoff=snap.val()&&snap.val().cutoff,at=Number(cutoff&&cutoff.at)||0;if(!at||cutoffSignOut||cutoffPending||!auth.currentUser||auth.currentUser.uid!==user.uid)return;
      var signedInAt=0;try{signedInAt=Date.parse((await user.getIdTokenResult()).authTime)||0;}catch(_e){return;}
      if(!signedInAt||signedInAt>=at)return;
      cutoffPending=true;
      var deadline=Date.now()+CUTOFF_CART_GRACE_MS;
      while(Date.now()<deadline&&cartInProgress()){
        cutoffBanner('The owner signed everyone out. Finish or clear this sale — this device signs out in a moment.');
        await new Promise(function(r){setTimeout(r,CUTOFF_CART_POLL_MS);});
        if(!auth.currentUser||auth.currentUser.uid!==user.uid){cutoffPending=false;cutoffBanner(null);return;}
      }
      cutoffPending=false;
      await finishCutoffSignOut(user,cutoff);
    },{critical:true});
  }
  async function authorizePortalUser(user){
    if(portalAuthUid===user.uid&&window.__accazaAuthz)return;
    if(portalAuthPromise)return portalAuthPromise;
    portalAuthPromise=(async function(){
      var results=await Promise.all([get(ref(db,'admins/'+user.uid)),get(ref(db,'adminPerms/'+user.uid+'/name')).catch(function(){return null;})]);
      var roleSnap=results[0],nameSnap=results[1],mapped=roleSnap.exists()?portalRole(roleSnap.val()):null;
      if(!mapped)throw new Error('This Firebase account is not authorized for the Accaza portal.');
      var display=(user.displayName||user.email||user.uid);if(nameSnap&&nameSnap.exists()&&nameSnap.val())display=nameSnap.val();
      await onAuthorized(mapped.ui,display,user.uid,mapped.server);portalAuthUid=user.uid;authGateResolved=true;watchSessionCutoff(user);
      if(location.hash)setTimeout(function(){var t=document.getElementById(location.hash.slice(1));if(t)t.scrollIntoView();},450);
    })();
    try{return await portalAuthPromise;}finally{portalAuthPromise=null;}
  }
  onAuthStateChanged(auth,async function(user){
    // A shared anonymous session (created by the public site on the same origin) must never
    // drive the admin portal — treat it as signed-out so it can't hijack the admin login.
    if(!user||user.isAnonymous){authGateResolved=true;portalAuthUid=null;window.__accazaAuthz=null;subscriptionHub.deauthorize();if(onSignedOut)onSignedOut();return;}
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
