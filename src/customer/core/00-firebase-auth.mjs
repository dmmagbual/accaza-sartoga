import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getDatabase,ref,set,push,update,remove,onValue}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{getMessaging,getToken,onMessage,isSupported}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import{getAuth,signInAnonymously,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import{initializeAppCheck,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";

const firebaseConfig={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
const app=initializeApp(firebaseConfig);
const APP_CHECK_SITE_KEY='6LdQ6HstAAAAAGvaa0exDw5aAHxNsrPKCtdlCeis'; // Public reCAPTCHA Enterprise site key registered for the production domain.
if(APP_CHECK_SITE_KEY){try{initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});}catch(e){console.warn('App Check init failed',e);}}
const db=getDatabase(app);
const auth=getAuth(app);
const functions=getFunctions(app,'asia-southeast1');
const createOnlineOrderCall=httpsCallable(functions,'createOnlineOrder');
const confirmOrderReceivedCall=httpsCallable(functions,'confirmOrderReceived');
var myOrdersMap={},_myOrdersSub={},customerUid=null,_customerIndexUnsub=null;
var customerAuthProblem=null,customerAuthRetryTimer=null,customerAuthFailures=0;
var myResMap={},_myResSub={};
function subscribeMyOrders(){try{(myOrderIds||[]).forEach(function(id){if(_myOrdersSub[id])return;_myOrdersSub[id]=true;onValue(ref(db,'orders/'+id),function(s){if(s.exists())myOrdersMap[id]=s.val();if(typeof renderCustomerOrders==='function')renderCustomerOrders();if(typeof checkMyReadyOrders==='function')checkMyReadyOrders();},function(){});});}catch(e){}}
function subscribeCustomerOrderIndex(uid){try{if(_customerIndexUnsub)_customerIndexUnsub();_customerIndexUnsub=onValue(ref(db,'customerOrders/'+uid),function(s){var ids=Object.keys(s.val()||{});ids.forEach(function(id){if(myOrderIds.indexOf(id)<0)myOrderIds.push(id);});try{localStorage.setItem('accaza_my_orders',JSON.stringify(myOrderIds));}catch(e){}subscribeMyOrders();});}catch(e){}}
async function ensureCustomerAuth(forceRefresh){
  var user=auth.currentUser;
  if(!user){
    user=await new Promise(function(resolve,reject){
      var done=false;
      var off=onAuthStateChanged(auth,function(u){if(done||!u)return;done=true;off();resolve(u);});
      signInAnonymously(auth).then(function(result){if(!done&&result&&result.user){done=true;off();resolve(result.user);}}).catch(function(e){if(!done){done=true;off();reject(e);}});
      setTimeout(function(){if(!done){done=true;off();reject(new Error('Customer session timed out.'));}},10000);
    });
  }
  var token=await user.getIdToken(forceRefresh===true);
  if(!token)throw new Error('Customer authentication token was not created.');
  return user;
}
window.__subscribeMyOrders=subscribeMyOrders;
function subscribeMyReservations(){try{(myReservationIds||[]).forEach(function(id){if(_myResSub[id])return;_myResSub[id]=true;onValue(ref(db,'reservations/'+id),function(s){if(s.exists())myResMap[id]=s.val();else delete myResMap[id];if(typeof renderMyReservations==='function')renderMyReservations();},function(){});});}catch(e){}}
window.__subscribeMyReservations=subscribeMyReservations;
function scheduleCustomerAuthRetry(){
  if(customerAuthRetryTimer||!navigator.onLine)return;
  var delay=Math.min(30000,2000*Math.pow(2,Math.min(customerAuthFailures,4)));
  customerAuthRetryTimer=setTimeout(function(){customerAuthRetryTimer=null;attemptCustomerAuth().catch(function(){});},delay);
}
async function attemptCustomerAuth(){
  if(auth.currentUser)return auth.currentUser;
  try{
    var result=await signInAnonymously(auth);
    customerAuthProblem=null;customerAuthFailures=0;
    return result&&result.user;
  }catch(e){
    customerAuthProblem=e||new Error('Firebase sign-in failed.');customerAuthFailures++;
    if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
    scheduleCustomerAuthRetry();
    throw e;
  }
}
window.retryCustomerConnection=function(){
  if(customerAuthRetryTimer){clearTimeout(customerAuthRetryTimer);customerAuthRetryTimer=null;}
  customerAuthProblem=null;
  if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
  return attemptCustomerAuth().catch(function(){(window.accazaToast||window.alert)('We still cannot connect. Please check your internet and try again.');});
};
window.addEventListener('online',function(){attemptCustomerAuth().catch(function(){});});
onAuthStateChanged(auth,function(u){
  if(!u){customerUid=null;attemptCustomerAuth().catch(function(){});return;}
  customerAuthProblem=null;customerAuthFailures=0;
  if(customerAuthRetryTimer){clearTimeout(customerAuthRetryTimer);customerAuthRetryTimer=null;}
  customerUid=u.uid;subscribeCustomerOrderIndex(u.uid);subscribeMyOrders();subscribeMyReservations();
  if(typeof renderPublicOrderStatus==='function')renderPublicOrderStatus();
});
