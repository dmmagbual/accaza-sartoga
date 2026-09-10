import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {getDatabase, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, query, orderByChild, equalTo, endAt} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {getFunctions, httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const cfg={apiKey:"AIzaSyAsh6j1T0tC-v2avj1J2mfCDdFG88FcpUM",authDomain:"accaza-sartoga.firebaseapp.com",databaseURL:"https://accaza-sartoga-default-rtdb.asia-southeast1.firebasedatabase.app",projectId:"accaza-sartoga",storageBucket:"accaza-sartoga.firebasestorage.app",messagingSenderId:"315522485228",appId:"1:315522485228:web:64ed3b7facef5a39148ec9"};
function setPill(text,cls){ const el=document.getElementById("liveStatus"); if(el){ el.textContent=text; el.className="live-pill "+cls; } }
let app,db,auth;
try{ app=initializeApp(cfg); db=getDatabase(app); auth=getAuth(app); var fns=getFunctions(app,"asia-southeast1"); window.__financeCmd=function(payload){ return httpsCallable(fns,"postFinancialCommand")(payload).then(function(r){return r.data;}); };window.__booksFinancialClose=function(payload){return httpsCallable(fns,"runFinancialClose")(payload).then(function(r){return r.data;});};window.__booksCertifyClose=function(payload){if(!auth.currentUser)return Promise.reject(new Error("Sign in first."));return auth.currentUser.getIdToken(true).then(function(token){return httpsCallable(fns,"createManagerApproval")({action:"certify_financial_close",sourceId:payload.closeId,reason:payload.reason,managerIdToken:token});}).then(function(ap){return httpsCallable(fns,"runFinancialClose")({action:"certify",closeType:"DAILY_CLOSE",businessDate:payload.businessDate,reason:payload.reason,approvalId:ap.data.approvalId});}).then(function(r){return r.data;});}; window.__fixedAsset=function(payload){ return httpsCallable(fns,"manageFixedAsset")(payload).then(function(r){return r.data;}); }; window.__booksSync=function(){var ensureLedger=httpsCallable(fns,"ensureFinancialLedger"),ensureJournal=httpsCallable(fns,"ensureBooksJournal");return ensureLedger({}).then(function(ledger){return ensureJournal({}).then(function(books){return Object.assign({},books.data,{ordersScanned:ledger.data.scanned,financePosted:ledger.data.posted,financeDuplicates:ledger.data.duplicates,orphanReversed:ledger.data.orphanReversed});});});}; window.__cashAccountSave=function(payload){return httpsCallable(fns,"manageCashAccount")(payload).then(function(r){return r.data;});}; window.__manageBooksAccount=function(payload){return httpsCallable(fns,"manageBooksAccount")(payload).then(function(r){return r.data;});}; window.__booksRepairPayout=function(payload){if(!auth.currentUser)return Promise.reject(new Error('Sign in to Accaza Books first.'));return auth.currentUser.getIdToken(true).then(function(token){return httpsCallable(fns,"createManagerApproval")({action:'repair_reversed_payout_deposit',sourceId:payload.payoutId,amount:payload.amount,reason:payload.reason,managerIdToken:token});}).then(function(approval){return httpsCallable(fns,"repairReversedPayoutDeposit")({payoutId:payload.payoutId,reason:payload.reason,approvalId:approval.data.approvalId});}).then(function(r){return r.data;});}; window.__auditControls=function(){return httpsCallable(fns,"auditFinancialControls")({}).then(function(r){return r.data;});}; window.__repairFinanceDates=function(payload){return httpsCallable(fns,"repairFinanceDates")(payload).then(function(r){return r.data;});}; window.__booksAuthReady=true; }
catch(e){ setPill("● Offline (local only)","off");window.__booksLiveLoading=false;if(window.App&&App.render)App.render(); }
if(typeof fns!=="undefined")window.__manageSupplier=function(payload){return httpsCallable(fns,"manageSupplier")(payload).then(function(r){return r.data;});};
if(auth){
  setPersistence(auth, browserLocalPersistence).catch(()=>{});
  window.__booksSignIn=(email,pw)=>{ signInWithEmailAndPassword(auth,email,pw).then(()=>window.App&&App.closeModal()).catch(e=>alert("Sign-in failed: "+e.message)); };
  window.__booksSignOut=()=>signOut(auth);
  let journalCache={}, reviewCache={}, booksStops=[];
  function stopBooksFeeds(){booksStops.splice(0).forEach(function(stop){try{stop();}catch(_e){}});}
  function watchValue(target,onChange,onError){var stop=onValue(target,onChange,onError);booksStops.push(stop);return stop;}
  function scheduleRender(){if(scheduleRender.pending)return;scheduleRender.pending=true;requestAnimationFrame(function(){scheduleRender.pending=false;if(window.App&&App.render)App.render();});}
  function watchMap(target,map,onChange,onError){
    var stopped=false,stops=[],changed=function(s){if(stopped)return;map[s.key]=s.val();onChange();},removed=function(s){if(stopped)return;delete map[s.key];onChange();};
    stops.push(onChildAdded(target,changed,onError),onChildChanged(target,changed,onError),onChildRemoved(target,removed,onError));
    return function(){stopped=true;stops.forEach(function(stop){stop();});};
  }
  function scheduleJournalRefresh(){if(scheduleJournalRefresh.pending)return;scheduleJournalRefresh.pending=true;requestAnimationFrame(function(){scheduleJournalRefresh.pending=false;window.__booksLiveLoading=false;refresh();});}
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
    journalCache={};window.__booksLiveLoading=true;
    journalUnsub=watchMap(query(ref(db,"/books/journal"),orderByChild("date"),endAt(p.to)),journalCache,scheduleJournalRefresh,()=>{window.__booksLiveLoading=false;setPill("● Read blocked — not an admin","bad");if(window.App&&App.render)App.render();});
  }
  let financialUnsub=null;
  function bindPeriodFinancial(){
    if(!auth||!auth.currentUser)return;
    if(financialUnsub)financialUnsub();
    const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{endAt:Date.now()};
    // Cash Flow needs every movement through the report end date to derive the
    // real opening balance. Starting at the selected From date hid prior bank
    // withdrawals while the account fallback still supplied opening deposits.
    window.__financialMovements={};
    financialUnsub=watchMap(query(ref(db,"/financialMovements"),orderByChild("occurredAt"),endAt(Number(p.endAt)||Date.now())),window.__financialMovements,scheduleRender,()=>{});
  }
  let orderStops=[];
  function bindOutstandingOrders(){
    orderStops.splice(0).forEach(function(stop){stop();});
    window.__booksActiveOrders={};window.__booksArchivedOrders={};
    // Account 1100 must include old unsettled platform sales, not only the selected
    // report period. Read the indexed outstanding subset instead of all order history.
    orderStops.push(watchMap(query(ref(db,"/orders"),orderByChild("settlementStatus"),equalTo("unsettled")),window.__booksActiveOrders,scheduleRender,()=>{}));
    orderStops.push(watchMap(query(ref(db,"/orders"),orderByChild("settlementStatus"),equalTo(null)),window.__booksActiveOrders,scheduleRender,()=>{}));
    orderStops.push(watchMap(query(ref(db,"/archivedOrders"),orderByChild("settlementStatus"),equalTo("unsettled")),window.__booksArchivedOrders,scheduleRender,()=>{}));
    orderStops.push(watchMap(query(ref(db,"/archivedOrders"),orderByChild("settlementStatus"),equalTo(null)),window.__booksArchivedOrders,scheduleRender,()=>{}));
  }
  window.__booksRebindPeriod=function(){bindPeriodJournal();bindPeriodFinancial();};
  onAuthStateChanged(auth, user=>{
    window.__booksUser = user?(user.email||"signed in"):null;
    window.__booksChartManager = !!(user && user.email && ["danilomagbual@gmail.com","contact.mariadaniela@gmail.com"].indexOf(String(user.email).toLowerCase())>=0);
    if(user && window.__booksChartManager && window.__manageBooksAccount){ window.__manageBooksAccount({action:'initialize'}).catch(function(){}); }
    stopBooksFeeds();orderStops.splice(0).forEach(function(stop){stop();});
    if(journalUnsub){journalUnsub();journalUnsub=null;}if(financialUnsub){financialUnsub();financialUnsub=null;}
    if(user){ setPill("● Live · "+(user.email||"synced"),"ok");if(window.__manageSupplier)window.__manageSupplier({action:"initialize_legacy"}).catch(function(){});
      bindPeriodJournal();
      watchValue(ref(db,"/accountingPeriods"), s=>{ window.__accountingPeriods=s.val()||{}; window.__isAccountingPeriodClosed=function(date){var record=(window.__accountingPeriods||{})[String(date||'').slice(0,7)]||{};return record.status==='closed';}; if(window.App&&App.render)App.render(); }, ()=>{});
      reviewCache={};booksStops.push(watchMap(ref(db,"/books/reviewQueue"),reviewCache,scheduleJournalRefresh,()=>{}));
      window.__arMap={};booksStops.push(watchMap(ref(db,"/receivables"),window.__arMap,scheduleRender,()=>{}));
      window.__apMap={};booksStops.push(watchMap(ref(db,"/payables"),window.__apMap,scheduleRender,()=>{}));
      window.__supplierMap={};booksStops.push(watchMap(ref(db,"/suppliers"),window.__supplierMap,scheduleRender,()=>{}));
      window.__cashDiscrepancies={};booksStops.push(watchMap(ref(db,"/discrepancies"),window.__cashDiscrepancies,function(){},()=>{}));
      watchValue(ref(db,"/cfAccounts"), s=>{ window.__cfAccounts=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      watchValue(ref(db,"/booksChart"), s=>{ window.__booksChart=s.val()||null; if(window.App&&App.applyServerChart)App.applyServerChart(); }, ()=>{});
      bindPeriodFinancial();
      window.__platformPayouts={};booksStops.push(watchMap(ref(db,"/platformPayouts"),window.__platformPayouts,scheduleRender,()=>{}));
      bindOutstandingOrders();
      window.__booksMenuItems={};booksStops.push(watchMap(ref(db,"/menuItems"),window.__booksMenuItems,scheduleRender,()=>{}));
      window.__booksMenuCategories={};booksStops.push(watchMap(ref(db,"/categories"),window.__booksMenuCategories,scheduleRender,()=>{}));
      window.__cashCustody={};booksStops.push(watchMap(ref(db,"/cashCustody"),window.__cashCustody,scheduleRender,()=>{}));
      window.__faMap={};booksStops.push(watchMap(ref(db,"/fixedAssets"),window.__faMap,scheduleRender,()=>{}));
      window.__piMap={};booksStops.push(watchMap(ref(db,"/purchaseInvoices"),window.__piMap,scheduleRender,()=>{}));
      window.__personalFundings={};booksStops.push(watchMap(ref(db,"/personalFundings"),window.__personalFundings,scheduleRender,()=>{}));
    } else { window.__booksLiveLoading=false;setPill("● Sign in for live POS","off");window.__booksChartManager=false; window.__posEntries=[]; window.__arMap={}; window.__apMap={};window.__supplierMap={}; window.__cashDiscrepancies={}; window.__cfAccounts={}; window.__financialMovements={}; window.__platformPayouts={}; window.__booksActiveOrders={};window.__booksArchivedOrders={};window.__booksMenuItems={};window.__booksMenuCategories={};window.__cashCustody={}; window.__faMap={}; window.__piMap={};window.__personalFundings={}; if(window.App&&App.render)App.render(); }
  });
}
