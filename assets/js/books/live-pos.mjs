import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {getDatabase, ref, onValue, onChildAdded, onChildChanged, onChildRemoved, query, orderByChild, equalTo, startAt, endAt} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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
  let journalCache={}, monthlyNetCache={}, reviewCache={}, booksStops=[], optionalStops={}, currentTab=(window.__booksCurrentTab||'dashboard');
  const OPTIONAL_FEEDS={
    reviewQueue:{tabs:['journal'],global:'__booksReviewQueue',target:function(){return ref(db,"/books/reviewQueue");},onChange:scheduleJournalRefresh},
    financialMovements:{tabs:['cashflow'],global:'__financialMovements',target:function(){const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{endAt:Date.now()};return query(ref(db,"/financialMovements"),orderByChild("occurredAt"),endAt(Number(p.endAt)||Date.now()));},onChange:scheduleRender},
    platformPayouts:{tabs:['cashflow'],global:'__platformPayouts',target:function(){return ref(db,"/platformPayouts");},onChange:scheduleRender},
    cashCustody:{tabs:['cashflow'],global:'__cashCustody',target:function(){return ref(db,"/cashCustody");},onChange:scheduleRender},
    suppliers:{tabs:['journal','transactions','purchases','payables'],global:'__supplierMap',target:function(){return ref(db,"/suppliers");},onChange:scheduleRender},
    purchaseInvoices:{tabs:['purchases'],global:'__piMap',target:function(){return ref(db,"/purchaseInvoices");},onChange:scheduleRender},
    fixedAssets:{tabs:['fixedassets'],global:'__faMap',target:function(){return ref(db,"/fixedAssets");},onChange:scheduleRender},
    personalFundings:{tabs:['transactions'],global:'__personalFundings',target:function(){return ref(db,"/personalFundings");},onChange:scheduleRender},
    menuItems:{tabs:['insights'],global:'__booksMenuItems',target:function(){return ref(db,"/menuItems");},onChange:scheduleRender},
    menuCategories:{tabs:['insights'],global:'__booksMenuCategories',target:function(){return ref(db,"/categories");},onChange:scheduleRender},
    discrepancies:{tabs:['journal','transactions'],global:'__cashDiscrepancies',target:function(){return ref(db,"/discrepancies");},onChange:scheduleRender}
  };
  function stopOptionalFeed(name){var stop=optionalStops[name],spec=OPTIONAL_FEEDS[name];if(stop){try{stop();}catch(_e){}delete optionalStops[name];}if(spec)window[spec.global]={};}
  function attachOptionalFeed(name){var spec=OPTIONAL_FEEDS[name];if(!spec||optionalStops[name]||spec.tabs.indexOf(currentTab)<0||!auth.currentUser)return;if(!window[spec.global])window[spec.global]={};optionalStops[name]=watchMap(spec.target(),window[spec.global],spec.onChange,()=>{});}
  function syncOptionalFeeds(){Object.keys(OPTIONAL_FEEDS).forEach(function(name){var spec=OPTIONAL_FEEDS[name];if(spec.tabs.indexOf(currentTab)>=0)attachOptionalFeed(name);else stopOptionalFeed(name);});}
  function stopBooksFeeds(){booksStops.splice(0).forEach(function(stop){try{stop();}catch(_e){}});Object.keys(optionalStops).forEach(stopOptionalFeed);optionalStops={};}
  function watchValue(target,onChange,onError){var stop=onValue(target,onChange,onError);booksStops.push(stop);return stop;}
  function scheduleRender(){if(scheduleRender.pending)return;scheduleRender.pending=true;requestAnimationFrame(function(){scheduleRender.pending=false;if(window.App&&App.render)App.render();});}
  function watchMap(target,map,onChange,onError){
    var stopped=false,stops=[],changed=function(s){if(stopped)return;map[s.key]=s.val();onChange();},removed=function(s){if(stopped)return;delete map[s.key];onChange();};
    stops.push(onChildAdded(target,changed,onError),onChildChanged(target,changed,onError),onChildRemoved(target,removed,onError));
    return function(){stopped=true;stops.forEach(function(stop){stop();});};
  }
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('accaza-books-tab',function(event){var next=event&&event.detail&&event.detail.id;if(!next||next===currentTab)return;currentTab=next;syncOptionalFeeds();if(window.App&&App.render)App.render();});
  function scheduleJournalRefresh(){if(scheduleJournalRefresh.pending)return;scheduleJournalRefresh.pending=true;requestAnimationFrame(function(){scheduleJournalRefresh.pending=false;window.__booksLiveLoading=false;refresh();});}
  function toEntries(j){ const out=[]; Object.keys(j||{}).forEach(k=>{ const n=j[k]||{}; let lines=[];
      if(n.net) lines=Object.keys(n.net).filter(c=>Math.abs(n.net[c])>=0.005).sort().map(c=>({code:c==='4995'?'5905':c,debit:n.net[c]>0?n.net[c]:0,credit:n.net[c]<0?-n.net[c]:0}));
      else if(Array.isArray(n.lines)) lines=n.lines.map(l=>({code:String(l.code)==='4995'?'5905':l.code,debit:Number(l.debit)||0,credit:Number(l.credit)||0}));
      if(lines.length) out.push({id:k,date:n.date||String(k).slice(0,10),ref:n.ref||k,memo:n.memo||"POS entry",lines,source:"pos",channel:n.channel||"",type:n.type||"",sourceType:n.sourceType||"",sourceId:n.sourceId||"",reversalOf:n.reversalOf||"",reversedByMovementId:n.reversedByMovementId||"",correctsMovementId:n.correctsMovementId||"",correctionReplacementId:n.correctionReplacementId||"",correctionReversalMovementId:n.correctionReversalMovementId||"",linkedPayableId:n.linkedPayableId||"",linkedDiscrepancyId:n.linkedDiscrepancyId||"",revision:Number(n.revision||0),voided:n.voided===true,reason:n.reason||n.correctionReason||""}); });
    return out; }
  function openingCarry(beforeMonth){var net={};Object.keys(monthlyNetCache||{}).filter(function(month){return month<beforeMonth;}).forEach(function(month){Object.keys(monthlyNetCache[month]||{}).forEach(function(code){net[code]=Math.round((Number(net[code]||0)+Number(monthlyNetCache[month][code]||0))*100)/100;});});var lines=Object.keys(net).filter(function(code){return Math.abs(net[code])>=0.005;}).sort().map(function(code){return {code:code==='4995'?'5905':code,debit:net[code]>0?net[code]:0,credit:net[code]<0?-net[code]:0};});return lines.length?[{id:'__opening_before_'+beforeMonth,date:'0000-00-00',ref:'OPENING-CARRY',memo:'Prior-period balance carried from immutable monthly journal totals',lines:lines,source:'books-monthly-carry',synthetic:true}]:[];}
  function refresh(){const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{from:todayStr()};const month=String(p.from||todayStr()).slice(0,7); window.__posEntries=openingCarry(month).concat(toEntries(journalCache));
    if(window.App&&App.render){ App.rebuildPeriodSel&&App.rebuildPeriodSel(); App.render(); } }
  let journalUnsub=null;
  function bindPeriodJournal(){
    if(!auth||!auth.currentUser)return;
    if(journalUnsub)journalUnsub();
    const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{from:todayStr(),to:todayStr()};
    const monthStart=String(p.from||todayStr()).slice(0,7)+'-01';
    // Prior months come from compact immutable totals; only the selected month onward
    // is downloaded so balance-sheet carry-forward remains complete without full history.
    journalCache={};window.__booksLiveLoading=true;
    journalUnsub=watchMap(query(ref(db,"/books/journal"),orderByChild("date"),startAt(monthStart),endAt(p.to)),journalCache,scheduleJournalRefresh,()=>{window.__booksLiveLoading=false;setPill("● Read blocked — not an admin","bad");if(window.App&&App.render)App.render();});
  }
  function bindPeriodFinancial(){
    if(!auth||!auth.currentUser)return;
    stopOptionalFeed('financialMovements');
    syncOptionalFeeds();
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
    if(journalUnsub){journalUnsub();journalUnsub=null;}
    if(user){ setPill("● Live · "+(user.email||"synced"),"ok");if(window.__manageSupplier)window.__manageSupplier({action:"initialize_legacy"}).catch(function(){});
      bindPeriodJournal();
      watchValue(ref(db,"/books/monthlyNet"), s=>{ monthlyNetCache=s.val()||{}; scheduleJournalRefresh(); }, ()=>{});
      watchValue(ref(db,"/accountingPeriods"), s=>{ window.__accountingPeriods=s.val()||{}; window.__isAccountingPeriodClosed=function(date){var record=(window.__accountingPeriods||{})[String(date||'').slice(0,7)]||{};return record.status==='closed';}; if(window.App&&App.render)App.render(); }, ()=>{});
      reviewCache={};window.__booksReviewQueue={};
      window.__arMap={};booksStops.push(watchMap(ref(db,"/receivables"),window.__arMap,scheduleRender,()=>{}));
      window.__apMap={};booksStops.push(watchMap(ref(db,"/payables"),window.__apMap,scheduleRender,()=>{}));
      window.__supplierMap={};window.__cashDiscrepancies={};
      watchValue(ref(db,"/cfAccounts"), s=>{ window.__cfAccounts=s.val()||{}; if(window.App&&App.render)App.render(); }, ()=>{});
      watchValue(ref(db,"/booksChart"), s=>{ window.__booksChart=s.val()||null; if(window.App&&App.applyServerChart)App.applyServerChart(); }, ()=>{});
      bindPeriodFinancial();
      bindOutstandingOrders();
      window.__platformPayouts={};window.__booksMenuItems={};window.__booksMenuCategories={};window.__cashCustody={};window.__faMap={};window.__piMap={};window.__personalFundings={};
      syncOptionalFeeds();
    } else { window.__booksLiveLoading=false;setPill("● Sign in for live POS","off");window.__booksChartManager=false; window.__posEntries=[]; window.__arMap={}; window.__apMap={};window.__supplierMap={}; window.__cashDiscrepancies={}; window.__booksReviewQueue={}; window.__cfAccounts={}; window.__financialMovements={}; window.__platformPayouts={}; window.__booksActiveOrders={};window.__booksArchivedOrders={};window.__booksMenuItems={};window.__booksMenuCategories={};window.__cashCustody={};window.__faMap={}; window.__piMap={};window.__personalFundings={}; if(window.App&&App.render)App.render(); }
  });
}
