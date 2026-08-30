import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {getDatabase, ref, onValue, query, orderByChild, startAt, endAt} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {getFunctions, httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const cfg={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
function setPill(text,cls){ const el=document.getElementById("liveStatus"); if(el){ el.textContent=text; el.className="live-pill "+cls; } }
let app,db,auth;
try{ app=initializeApp(cfg); db=getDatabase(app); auth=getAuth(app); var fns=getFunctions(app,"asia-southeast1"); window.__financeCmd=function(payload){ return httpsCallable(fns,"postFinancialCommand")(payload).then(function(r){return r.data;}); };window.__booksFinancialClose=function(payload){return httpsCallable(fns,"runFinancialClose")(payload).then(function(r){return r.data;});};window.__booksCertifyClose=function(payload){if(!auth.currentUser)return Promise.reject(new Error("Sign in first."));return auth.currentUser.getIdToken(true).then(function(token){return httpsCallable(fns,"createManagerApproval")({action:"certify_financial_close",sourceId:payload.closeId,reason:payload.reason,managerIdToken:token});}).then(function(ap){return httpsCallable(fns,"runFinancialClose")({action:"certify",closeType:"DAILY_CLOSE",businessDate:payload.businessDate,reason:payload.reason,approvalId:ap.data.approvalId});}).then(function(r){return r.data;});}; window.__fixedAsset=function(payload){ return httpsCallable(fns,"manageFixedAsset")(payload).then(function(r){return r.data;}); }; window.__booksSync=function(){var ensureLedger=httpsCallable(fns,"ensureFinancialLedger"),ensureJournal=httpsCallable(fns,"ensureBooksJournal");return ensureLedger({}).then(function(ledger){return ensureJournal({}).then(function(books){return Object.assign({},books.data,{ordersScanned:ledger.data.scanned,financePosted:ledger.data.posted,financeDuplicates:ledger.data.duplicates,orphanReversed:ledger.data.orphanReversed});});});}; window.__cashAccountSave=function(payload){return httpsCallable(fns,"manageCashAccount")(payload).then(function(r){return r.data;});}; window.__manageBooksAccount=function(payload){return httpsCallable(fns,"manageBooksAccount")(payload).then(function(r){return r.data;});}; window.__booksRepairPayout=function(payload){if(!auth.currentUser)return Promise.reject(new Error('Sign in to Accaza Books first.'));return auth.currentUser.getIdToken(true).then(function(token){return httpsCallable(fns,"createManagerApproval")({action:'repair_reversed_payout_deposit',sourceId:payload.payoutId,amount:payload.amount,reason:payload.reason,managerIdToken:token});}).then(function(approval){return httpsCallable(fns,"repairReversedPayoutDeposit")({payoutId:payload.payoutId,reason:payload.reason,approvalId:approval.data.approvalId});}).then(function(r){return r.data;});}; window.__auditControls=function(){return httpsCallable(fns,"auditFinancialControls")({}).then(function(r){return r.data;});}; window.__repairFinanceDates=function(payload){return httpsCallable(fns,"repairFinanceDates")(payload).then(function(r){return r.data;});}; window.__booksAuthReady=true; }
catch(e){ setPill("● Offline (local only)","off");window.__booksLiveLoading=false;if(window.App&&App.render)App.render(); }
if(auth){
  setPersistence(auth, browserLocalPersistence).catch(()=>{});
  window.__booksSignIn=(email,pw)=>{ signInWithEmailAndPassword(auth,email,pw).then(()=>window.App&&App.closeModal()).catch(e=>alert("Sign-in failed: "+e.message)); };
  window.__booksSignOut=()=>signOut(auth);
  let journalCache={}, reviewCache={};
  function toEntries(j){ const out=[]; Object.keys(j||{}).forEach(k=>{ const n=j[k]||{}; let lines=[];
      if(n.net) lines=Object.keys(n.net).filter(c=>Math.abs(n.net[c])>=0.005).sort().map(c=>({code:c==='4995'?'5905':c,debit:n.net[c]>0?n.net[c]:0,credit:n.net[c]<0?-n.net[c]:0}));
      else if(Array.isArray(n.lines)) lines=n.lines.map(l=>({code:String(l.code)==='4995'?'5905':l.code,debit:Number(l.debit)||0,credit:Number(l.credit)||0}));
      if(lines.length) out.push({id:k,date:n.date||String(k).slice(0,10),ref:n.ref||k,memo:n.memo||"POS entry",lines,source:"pos",channel:n.channel||"",type:n.type||"",sourceType:n.sourceType||"",sourceId:n.sourceId||"",reversalOf:n.reversalOf||"",reversedByMovementId:n.reversedByMovementId||"",correctsMovementId:n.correctsMovementId||"",correctionReplacementId:n.correctionReplacementId||"",correctionReversalMovementId:n.correctionReversalMovementId||"",linkedPayableId:n.linkedPayableId||"",linkedDiscrepancyId:n.linkedDiscrepancyId||"",revision:Number(n.revision||0),voided:n.voided===true,reason:n.reason||n.correctionReason||""}); });
    return out; }
  function refresh(){ window.__posEntries=toEntries(journalCache);
    if(window.App&&App.render){ App.rebuildPeriodSel&&App.rebuildPeriodSel(); App.render(); } }
  let journalUnsub=null;
  function bindPeriodJournal(){
    if(!auth||!auth.currentUser)return;
    if(journalUnsub)journalUnsub();
    const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{from:todayStr(),to:todayStr()};
    // Load every posted entry through the report end date. Balance-sheet, General Ledger,
    // control-account, and opening-balance views need prior-period activity; period reports
    // continue to use entriesInPeriod() so income, COGS, and expenses do not carry forward.
    journalUnsub=onValue(query(ref(db,"/books/journal"),orderByChild("date"),endAt(p.to)),s=>{journalCache=s.val()||{};window.__booksLiveLoading=false;refresh();},()=>{window.__booksLiveLoading=false;setPill("● Read blocked — not an admin","bad");if(window.App&&App.render)App.render();});
  }
  let financialUnsub=null;
  function bindPeriodFinancial(){
    if(!auth||!auth.currentUser)return;
    if(financialUnsub)financialUnsub();
    const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{startAt:0,endAt:Date.now()};
    financialUnsub=onValue(query(ref(db,"/financialMovements"),orderByChild("occurredAt"),startAt(Number(p.startAt)||0),endAt(Number(p.endAt)||Date.now())),s=>{window.__financialMovements=s.val()||{};if(window.App&&App.render)App.render();},()=>{});
  }
  window.__booksRebindPeriod=function(){bindPeriodJournal();bindPeriodFinancial();};
  onAuthStateChanged(auth, user=>{
    window.__booksUser = user?(user.email||"signed in"):null;
    window.__booksChartManager = !!(user && user.email && ["danilomagbual@gmail.com","contact.mariadaniela@gmail.com"].indexOf(String(user.email).toLowerCase())>=0);
    if(user && window.__booksChartManager && window.__manageBooksAccount){ window.__manageBooksAccount({action:'initialize'}).catch(function(){}); }
    if(user){ setPill("● Live · "+(user.email||"synced"),"ok");
      bindPeriodJournal();
      onValue(ref(db,"/accountingPeriods"), s=>{ window.__accountingPeriods=s.val()||{}; window.__isAccountingPeriodClosed=function(date){var record=(window.__accountingPeriods||{})[String(date||'').slice(0,7)]||{};return record.status==='closed';}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/books/reviewQueue"), s=>{ reviewCache=s.val()||{}; refresh(); }, ()=>{});
      onValue(ref(db,"/receivables"), s=>{ window.__arMap=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/payables"), s=>{ window.__apMap=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/discrepancies"), s=>{ window.__cashDiscrepancies=s.val()||{}; }, ()=>{});
      onValue(ref(db,"/cfAccounts"), s=>{ window.__cfAccounts=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/booksChart"), s=>{ window.__booksChart=s.val()||null; if(window.App&&App.applyServerChart)App.applyServerChart(); }, ()=>{});
      bindPeriodFinancial();
      onValue(ref(db,"/platformPayouts"), s=>{ window.__platformPayouts=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/orders"), s=>{ window.__booksActiveOrders=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/archivedOrders"), s=>{ window.__booksArchivedOrders=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/menuItems"), s=>{ window.__booksMenuItems=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/categories"), s=>{ window.__booksMenuCategories=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/cashCustody"), s=>{ window.__cashCustody=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/fixedAssets"), s=>{ window.__faMap=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/purchaseInvoices"), s=>{ window.__piMap=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      onValue(ref(db,"/personalFundings"), s=>{ window.__personalFundings=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
    } else { window.__booksLiveLoading=false;setPill("● Sign in for live POS","off");window.__booksChartManager=false; window.__posEntries=[]; window.__arMap={}; window.__apMap={}; window.__cashDiscrepancies={}; window.__cfAccounts={}; window.__financialMovements={}; window.__platformPayouts={}; window.__booksActiveOrders={};window.__booksArchivedOrders={};window.__booksMenuItems={};window.__booksMenuCategories={};window.__cashCustody={}; window.__faMap={}; window.__piMap={};window.__personalFundings={}; if(window.App&&App.render)App.render(); }
  });
}
