import{initializeAppCheck,getToken,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

const APP_CHECK_SITE_KEY='6LdQ6HstAAAAAGvaa0exDw5aAHxNsrPKCtdlCeis';
const instances=new WeakMap();
const tokenChecks=new WeakSet();

function recordStatus(scope,status,error){
  const root=globalThis.__accazaAppCheckStatus||(globalThis.__accazaAppCheckStatus={});
  root[String(scope||'app').slice(0,40)]={status,at:Date.now(),error:error?String(error&&error.message||error).slice(0,160):''};
}

function checkToken(instance,scope){
  if(!instance||tokenChecks.has(instance))return;
  tokenChecks.add(instance);
  getToken(instance,false).then(function(result){
    recordStatus(scope,result&&result.token?'verified':'failed',result&&result.token?'':'No token returned');
  }).catch(function(error){
    recordStatus(scope,'failed',error);
    console.warn(`${scope||'Accaza'} App Check token failed`,error);
  });
}

function initializeAccazaAppCheck(app,scope){
  if(instances.has(app))return instances.get(app);
  try{
    const instance=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
    instances.set(app,instance);
    recordStatus(scope,'initialized');
    checkToken(instance,scope);
    return instance;
  }catch(error){
    recordStatus(scope,'failed',error);
    console.warn(`${scope||'Accaza'} App Check init failed`,error);
    return null;
  }
}

export{APP_CHECK_SITE_KEY,initializeAccazaAppCheck};
