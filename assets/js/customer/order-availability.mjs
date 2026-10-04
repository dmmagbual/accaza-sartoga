import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import{getDatabase,ref,get,onValue}from"https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import{initializeAccazaAppCheck}from"../shared/firebase-app-check.mjs";

const firebaseConfig={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
const app=getApps()[0]||initializeApp(firebaseConfig);
initializeAccazaAppCheck(app,'Order availability');
const buttons=[...document.querySelectorAll('[data-order-availability]')];
let acceptingOrders=null;

function showState(state){
  buttons.forEach(function(button){
    button.classList.remove('order-availability-open','order-availability-closed','order-availability-checking');
    button.classList.add('order-availability-'+state);
    button.textContent=state==='open'?'Order Now':state==='closed'?'CLOSED':'Checking';
    button.setAttribute('aria-label',state==='open'?'Order now. A cashier is available.':state==='closed'?'Order now. No cashier is currently available.':'Order now. Checking cashier availability.');
    button.title=state==='open'?'Cashier available — online orders are open':state==='closed'?'No cashier available — online orders are closed':'Checking cashier availability';
  });
}
function renderState(){showState(!navigator.onLine?'closed':acceptingOrders===null?'checking':acceptingOrders?'open':'closed');}

if(buttons.length){
  renderState();
  window.addEventListener('offline',renderState);
  const statusRef=ref(getDatabase(app),'publicOrderStatus');
  const once=document.body&&document.body.dataset.orderAvailabilityMode==='once';
  const receive=function(snapshot){
    acceptingOrders=!!(snapshot.val()&&snapshot.val().acceptingOrders===true);renderState();
  };
  const failed=function(){acceptingOrders=false;renderState();};
  const refresh=function(){if(!navigator.onLine){renderState();return;} acceptingOrders=null;renderState();get(statusRef).then(receive,failed);};
  window.addEventListener('online',once?refresh:renderState);
  if(once)refresh();else onValue(statusRef,receive,failed);
}
