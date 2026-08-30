const FIREBASE_ORIGIN='https://www.gstatic.com/firebasejs/10.12.0/';

const modules={
  'firebase-app.js':`export function initializeApp(config){return {config};}`,
  'firebase-app-check.js':`export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key;}} export function initializeAppCheck(){return {};}`,
  'firebase-auth.js':`const user={uid:'browser-test-customer',getIdToken:async()=> 'browser-test-token'}; const auth={currentUser:user}; export function getAuth(){return auth;} export async function signInAnonymously(){return {user};} export async function signOut(){auth.currentUser=null;} export function onAuthStateChanged(_auth,callback){queueMicrotask(()=>callback(user));return ()=>{};}`,
  'firebase-functions.js':`export function getFunctions(){return {};} export function httpsCallable(_functions,name){return async()=>({data:name==='createOnlineOrder'?{orderId:'test-order'}:{ok:true}});}`,
  'firebase-messaging.js':`export function getMessaging(){return {};} export async function getToken(){return '';} export function onMessage(){return ()=>{};} export async function isSupported(){return false;}`,
  'firebase-database.js':`
    const values={
      'publicOrderStatus':{acceptingOrders:true},
      '.info/connected':true,
      'categories':{coffee:{id:'coffee',label:'Coffee Based',icon:'☕',order:0}},
      'optionGroups':{},
      'menuItems':{latte:{cat:'coffee',name:'Cafe Latte',desc:'Smooth espresso and milk.',priceS:175,priceM:185,priceL:195,optionsSet:true}},
      'availability':{'Cafe Latte':true},
      'payment':{gcashNum:'09123456789',gcashName:'Accaza',gcashEnabled:true,bdoEnabled:true,ubEnabled:false},
      'calBlocks':{},
      'reviews':{review1:{name:'Test Customer',stars:5,date:'August 2026',text:'Excellent coffee and service.'}},
      'customerOrders/browser-test-customer':{'ORDER-TEST':true},
      'orders/ORDER-TEST':{id:'ORDER-TEST',name:'Browser Test Customer',items:'Cafe Latte',total:175,payment:'GCash',type:'Pickup',status:'Ready'}
    };
    const snapshot=value=>({val:()=>value,exists:()=>value!==undefined&&value!==null});
    export function getDatabase(){return {};}
    export function ref(_db,path=''){return {path};}
    export async function get(target){return snapshot(values[target.path]);}
    export async function set(){} export function push(){return {key:'test-key'};} export async function update(){} export async function remove(){}
    export function onValue(target,success){queueMicrotask(()=>success(snapshot(values[target.path])));return ()=>{};}
  `
};

export async function installCustomerFirebaseFixture(page){
  await page.route(FIREBASE_ORIGIN+'**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    const body=modules[name];
    if(!body)return route.abort();
    return route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',headers:{'access-control-allow-origin':'*'},body});
  });
}
