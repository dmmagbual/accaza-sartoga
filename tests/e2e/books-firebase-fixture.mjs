// Stub Firebase modules for Finance Books browser tests (Sep 2026). A signed-in owner session (or, on
// request, the public site's anonymous visitor session) is
// served from in-memory data: value listeners return the stored node, child listeners replay the
// stored children that match the query (orderByChild + startAt/endAt/equalTo), and every write is
// a no-op. Nothing reaches the network.
const FIREBASE_ORIGIN='https://www.gstatic.com/firebasejs/10.12.0/';

const buildModules=(data={},options={})=>({
  'firebase-app.js':`export function initializeApp(){return {};} export function getApp(){return {};} export function getApps(){return [{}];}`,
  'firebase-app-check.js':`const instance={}; export class ReCaptchaEnterpriseProvider{constructor(key){this.key=key;}} export function initializeAppCheck(){return instance;} export async function getToken(){return {token:'app-check-test-token'};}`,
  'firebase-auth.js':`
    const user=${options.anonymous?"{uid:'public-site-visitor',email:null,isAnonymous:true,getIdToken:async()=> 'anonymous-token',getIdTokenResult:async()=>({authTime:new Date().toUTCString(),claims:{}})}":"{uid:'books-test-owner',email:'owner@example.test',getIdToken:async()=> 'books-test-token',getIdTokenResult:async()=>({authTime:new Date().toUTCString(),claims:{}})}"};
    const auth={currentUser:user};
    export function getAuth(){return auth;}
    export function onAuthStateChanged(_auth,callback){setTimeout(()=>callback(user),0);return ()=>{};}
    export async function signInWithEmailAndPassword(){return {user};} export async function signOut(){}
    export async function setPersistence(){} export const browserLocalPersistence={};`,
  'firebase-functions.js':`export function getFunctions(){return {};} export function httpsCallable(_functions,name){return async()=>{(globalThis.__booksFixtureCalls||(globalThis.__booksFixtureCalls=[])).push(name);return {data:{}};};}`,
  'firebase-database.js':`
    const data=${JSON.stringify(data)};
    const clean=path=>String(path||'').replace(/^\\/+|\\/+$/g,'');
    const nodeAt=path=>clean(path).split('/').filter(Boolean).reduce((node,part)=>node&&typeof node==='object'?node[part]:undefined,data);
    const snapshot=(key,value)=>({key,val:()=>value===undefined?null:value,exists:()=>value!==undefined&&value!==null,forEach:callback=>{Object.keys(value||{}).forEach(k=>callback(snapshot(k,value[k])));}});
    const matches=(child,constraints)=>{let field=null,ok=true;for(const c of constraints||[]){if('orderByChild' in c)field=c.orderByChild;const v=field?(child&&child[field]):undefined;if('equalTo' in c)ok=ok&&v===c.equalTo;if('startAt' in c)ok=ok&&v!==undefined&&v>=c.startAt;if('endAt' in c)ok=ok&&v!==undefined&&v<=c.endAt;if('startAfter' in c)ok=ok&&v!==undefined&&v>c.startAfter;if('endBefore' in c)ok=ok&&v!==undefined&&v<c.endBefore;}return ok;};
    const children=target=>{const node=nodeAt(target.path);if(!node||typeof node!=='object')return {};const out={};Object.keys(node).forEach(k=>{if(matches(node[k],target.constraints))out[k]=node[k];});return out;};
    export function getDatabase(){return {};}
    export function ref(_db,path=''){return {path:clean(path),constraints:[]};}
    export function query(target,...constraints){return {path:target.path,constraints};}
    export function orderByChild(field){return {orderByChild:field};} export function orderByKey(){return {orderByKey:true};}
    export function equalTo(value){return {equalTo:value};} export function startAt(value){return {startAt:value};} export function endAt(value){return {endAt:value};}
    export function startAfter(value){return {startAfter:value};} export function endBefore(value){return {endBefore:value};}
    export async function get(target){listened(target.path);return snapshot(target.path.split('/').pop(),target.constraints.length?children(target):nodeAt(target.path));}
    const listened=path=>{(globalThis.__booksFixtureReads||(globalThis.__booksFixtureReads=[])).push(clean(path));};
    export function onValue(target,success){listened(target.path);setTimeout(()=>success(snapshot(target.path.split('/').pop(),target.constraints.length?children(target):nodeAt(target.path))),0);return ()=>{};}
    export function onChildAdded(target,success){listened(target.path);setTimeout(()=>{const rows=children(target);Object.keys(rows).forEach(k=>success(snapshot(k,rows[k])));},0);return ()=>{};}
    export function onChildChanged(){return ()=>{};} export function onChildRemoved(){return ()=>{};}
    export async function set(){} export function push(target){return {path:target.path+'/test-key',key:'test-key'};} export async function remove(){}
    export function onDisconnect(){return {remove:async()=>{},set:async()=>{},cancel:async()=>{}};} export function serverTimestamp(){return 0;}`
});

// options.anonymous: serve the public site's anonymous visitor session instead of the owner.
export async function installBooksFirebaseFixture(page,data,options={}){
  const modules=buildModules(data,options);
  await page.route(FIREBASE_ORIGIN+'**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    const body=modules[name];
    if(!body)return route.abort();
    return route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',headers:{'access-control-allow-origin':'*'},body});
  });
}
