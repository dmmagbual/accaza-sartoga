/* Chooses which Firebase project a staff page talks to.
   Production is the default for every host. UAT is chosen ONLY when the page is served from
   the UAT project's own hosting addresses (exact match). The live site, GitHub Pages,
   localhost, the till and any look-alike host always get production.
   Pure module: no Firebase imports, so the choice can be unit-tested. */
export const PRODUCTION_FIREBASE_CONFIG=Object.freeze({apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"});
export const UAT_FIREBASE_CONFIG=Object.freeze({apiKey:"AIzaSyCZjNQzUz9jugIKIQwqSSMXUL2sYak-Ik0",authDomain:"accazacoffeepos-uat.firebaseapp.com",databaseURL:"https://accazacoffeepos-uat-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accazacoffeepos-uat",storageBucket:"accazacoffeepos-uat.firebasestorage.app",messagingSenderId:"272339698321",appId:"1:272339698321:web:e2e61d7763a110c41e3530"});
export const UAT_HOSTS=Object.freeze(["accazacoffeepos-uat.web.app","accazacoffeepos-uat.firebaseapp.com"]);
export function accazaFirebaseEnv(hostname){return UAT_HOSTS.indexOf(String(hostname||"").trim().toLowerCase())>=0?"uat":"production";}
export function accazaFirebaseConfig(hostname){return Object.assign({},accazaFirebaseEnv(hostname)==="uat"?UAT_FIREBASE_CONFIG:PRODUCTION_FIREBASE_CONFIG);}
export const ACCAZA_FIREBASE_ENV=accazaFirebaseEnv(globalThis.location&&globalThis.location.hostname);
/* A UAT page must never be mistaken for the live till: label the tab and pin a banner. */
export function markUatPage(scope){
  if(ACCAZA_FIREBASE_ENV!=="uat"||typeof document==="undefined")return;
  try{
    if(document.title.indexOf("[UAT]")!==0)document.title="[UAT] "+document.title;
    const show=function(){if(document.getElementById("accazaUatBanner")||!document.body)return;const b=document.createElement("div");b.id="accazaUatBanner";b.setAttribute("role","status");b.textContent="UAT TEST ENVIRONMENT · "+String(scope||"Accaza")+" · synthetic data, not the live shop";b.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#b42318;color:#fff;font:700 12px/1.6 system-ui,sans-serif;text-align:center;padding:2px 8px;pointer-events:none;";document.body.appendChild(b);};
    if(document.body)show();else document.addEventListener("DOMContentLoaded",show,{once:true});
  }catch(e){}
}
