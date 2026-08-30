
/* ---- quick-post templates (pre-filled balanced entries) ---- */
const QUICK = [
  {label:"☕ Record day's sales + cash", build:()=>({date:todayStr(),ref:"DAY-"+new Date().getDate(),memo:"Sales for the day",
    lines:[{code:"1000",debit:0,credit:""},{code:"1020",debit:0,credit:""},{code:"4000",debit:"",credit:0},{code:"4010",debit:"",credit:0}]
      .map(l=>({code:l.code,debit:l.debit,credit:l.credit}))})},
  {label:"🛵 Grab/Panda sales", build:()=>({date:todayStr(),ref:"PLT-"+new Date().getDate(),memo:"Platform sales net of commission",
    lines:[{code:"1100",debit:"",credit:0},{code:"6040",debit:"",credit:0},{code:"4020",debit:0,credit:""},{code:"4030",debit:0,credit:""}]})},
  {label:"📦 Record COGS (recipe use)", build:()=>({date:todayStr(),ref:"COGS-"+new Date().getDate(),memo:"Cost of goods sold — inventory consumed",
    lines:[{code:"5000",debit:"",credit:0},{code:"5010",debit:"",credit:0},{code:"1200",debit:0,credit:""},{code:"1210",debit:0,credit:""}]})},
  {label:"🧾 Pay / receive supplier stock", build:()=>({date:todayStr(),ref:"PO-",memo:"Stock received from supplier (on account)",
    lines:[{code:"1200",debit:"",credit:0},{code:"2000",debit:0,credit:""}]})},
  {label:"🗑️ Wastage / spoilage", build:()=>({date:todayStr(),ref:"WASTE-"+new Date().getDate(),memo:"Spoilage / waste written off",
    lines:[{code:"5900",debit:"",credit:0},{code:"1210",debit:0,credit:""}]})},
  {label:"👥 Pay salaries", build:()=>({date:todayStr(),ref:"PAY-"+new Date().getDate(),memo:"Barista salaries",
    lines:[{code:"6000",debit:"",credit:0},{code:"1010",debit:0,credit:""}]})},
  {label:"💸 Owner drawing", build:()=>({date:todayStr(),ref:"DRAW-"+new Date().getDate(),memo:"Owner personal drawing",
    lines:[{code:"3100",debit:"",credit:0},{code:"1000",debit:0,credit:""}]})}
];

/* ---- live POS sign-in (email/password) ---- */
App.signInPrompt=function(){
  if(window.__booksUser){ if(confirm("Signed in as "+window.__booksUser+". Sign out of live POS sync?")) window.__booksSignOut&&window.__booksSignOut(); return; }
  if(!window.__booksAuthReady){ alert("Live sync is still starting. If this page is opened directly from a file it can't reach Firebase — deploy it to your Accaza domain (e.g. accazacoffee.com/books.html) so it shares your admin login."); return; }
  const m=document.getElementById("modal");
  m.innerHTML=`<div class="modal-head"><h3>Sign in to live POS sync</h3><button class="x" onclick="App.closeModal()">×</button></div>
    <div class="modal-body"><p class="tiny muted" style="margin-top:0">Use your Accaza admin account. When this app is served from the same domain as the POS, you're signed in automatically.</p>
      <div class="field"><label>Email</label><input id="si_email" type="email" autocomplete="username"/></div>
      <div class="field"><label>Password</label><input id="si_pw" type="password" autocomplete="current-password"/></div></div>
    <div class="modal-foot"><button class="btn ghost" onclick="App.closeModal()">Cancel</button>
      <button class="btn primary" onclick="window.__booksSignIn(document.getElementById('si_email').value,document.getElementById('si_pw').value)">Sign in</button></div>`;
  document.getElementById("modalBg").classList.add("show");
};
App.syncBooks=function(btn){
  if(!window.__booksSync){alert("Live sync is not ready — sign in first.");return;}
  if(!confirm("Reconcile Finance sales to authoritative Admin Sales History, then rebuild Books? Missing postings and balanced corrections are captured in Finance. This is idempotent and safe to rerun."))return;
  btn.disabled=true;const old=btn.textContent;btn.textContent="Syncing…";
  window.__booksSync().then(function(r){
    alert("Sales reconciled and Books rebuilt. Orders and records checked: "+r.ordersScanned+" · new Finance postings: "+r.financePosted+" · orphaned sales corrected: "+r.orphanReversed+" · existing postings: "+r.financeDuplicates+" · Finance movements: "+r.movements+" · authoritative net sales: "+peso(r.netSales)+" · COGS posted: "+r.cogsPosted+" · COGS awaiting review: "+r.missingCogs+" · review items: "+r.reviewItems);
    btn.disabled=false;btn.textContent=old;
  }).catch(function(e){alert("Books sync stopped: "+((e&&e.message)||e)+" Safe to retry.");btn.disabled=false;btn.textContent=old;});
};

window.App = App; // expose for the live-POS reader module below
// If the Firebase SDK can't load at all (opened offline / from a file), downgrade the pill.
setTimeout(function(){ var el=document.getElementById('liveStatus'); if(el && /Connecting/.test(el.textContent) && !window.__booksAuthReady){ el.textContent='● Offline (local only)'; el.className='live-pill off';window.__booksLiveLoading=false;if(window.App&&App.render)App.render(); } },5000);
window.addEventListener('accaza-report-period',function(e){const p=(e&&e.detail)||(window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{});PERIOD=p.mode||'month';if(window.__booksRebindPeriod)window.__booksRebindPeriod();if(window.App){App.rebuildPeriodSel&&App.rebuildPeriodSel();App.render();}});
App.init();
