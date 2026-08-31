
/* ============================================================ TABS ============================================================ */
const TABS = [
  /* Release compatibility markers: {id:"cashflow",label:"Cash Flow"} {id:"settings",label:"Settings"} {id:"close",label:"Financial Close"} {id:"coa",label:"Chart of Accounts"} */
  {id:"dashboard",label:"Dashboard",group:"overview"},
  {id:"insights",label:"Key Metrics",group:"overview"},
  {id:"transactions",label:"Transactions",group:"entries"},
  {id:"journal",label:"Journal",group:"entries"},
  {id:"ledger",label:"General Ledger",group:"ledgers"},
  {id:"receivables",label:"Receivables",group:"ledgers"},
  {id:"payables",label:"Payables",group:"ledgers"},
  {id:"pl",label:"Profit & Loss",group:"statements"},
  {id:"bs",label:"Balance Sheet",group:"statements"},
  {id:"cashflow",label:"Cash Flow",group:"statements"},
  {id:"tb",label:"Trial Balance",group:"statements"},
  {id:"close",label:"Financial Close",group:"controls",settingsSection:"close"},
  {id:"coa",label:"Chart of Accounts",group:"controls",settingsSection:"coa"},
  {id:"settings",label:"Settings",group:"controls",settingsSection:"general"},
  {id:"data",label:"Backup & Restore",group:"controls",settingsSection:"data"}
];
const TAB_GROUPS = [
  {id:"overview",label:"Overview"},
  {id:"entries",label:"Entries"},
  {id:"ledgers",label:"Ledgers"},
  {id:"statements",label:"Statements"},
  {id:"controls",label:"Controls"}
];
let CURRENT = "dashboard";

const App = {
  exportCsv(kind){return exportFinanceCsv(kind);},
  init(){
    // period selector
    this.rebuildPeriodSel();
    const requested=new URLSearchParams(location.search).get("tab"); if(TABS.some(t=>t.id===requested))CURRENT=requested;
    const selected=TABS.find(t=>t.id===CURRENT);if(selected&&selected.settingsSection)window.__booksSettingsSection=selected.settingsSection;
    this.renderTabs(); this.render();
  },
  setPeriod(v){ var p=window.AccazaReportPeriod&&window.AccazaReportPeriod.set?window.AccazaReportPeriod.set({mode:v}):{mode:'month'};PERIOD=p.mode||'month';this.rebuildPeriodSel();this.render(); },
  setPeriodCount(v){ var p=window.AccazaReportPeriod&&window.AccazaReportPeriod.set?window.AccazaReportPeriod.set({count:v}):{};PERIOD=p.mode||PERIOD;this.rebuildPeriodSel();this.render(); },
  setPeriodEnd(v){ var p=window.AccazaReportPeriod&&window.AccazaReportPeriod.set?window.AccazaReportPeriod.set({endMonth:v}):{};PERIOD=p.mode||PERIOD;this.rebuildPeriodSel();this.render(); },
  applyDateRange(){var from=(document.getElementById('periodFrom')||{}).value,to=(document.getElementById('periodTo')||{}).value;if(!from||!to)return alert('Choose both dates.');if(from>to)return alert('The start date must be on or before the end date.');var p=window.AccazaReportPeriod&&window.AccazaReportPeriod.set?window.AccazaReportPeriod.set({mode:'custom',customFrom:from,customTo:to}):{};PERIOD=p.mode||PERIOD;this.rebuildPeriodSel();this.render();},
  renderTabs(){
    const selected=TABS.find(t=>t.id===CURRENT)||TABS[0],activeGroup=selected.group;
    document.getElementById("bookGroups").innerHTML=TAB_GROUPS.map(g=>`<button class="book-group ${g.id===activeGroup?'active':''}" ${g.id===activeGroup?'aria-current="true"':''} onclick="App.openGroup('${g.id}')">${g.label}</button>`).join("");
    document.getElementById("tabs").innerHTML = TABS.filter(t=>t.group===activeGroup).map(t=>`<button class="tab ${t.id===CURRENT?'active':''}" ${t.id===CURRENT?'aria-current="page"':''} onclick="App.go('${t.id}')">${t.label}</button>`).join("");
  },
  openGroup(id){const first=TABS.find(t=>t.group===id);if(first)this.go(first.id);},
  go(id){ const selected=TABS.find(t=>t.id===id);if(!selected)return;CURRENT=id;if(selected.settingsSection)window.__booksSettingsSection=selected.settingsSection;this.renderTabs();this.render();window.scrollTo(0,0); },
  settingsSection(id){ const selected=TABS.find(t=>t.settingsSection===id);this.go(selected?selected.id:'settings'); },
  render(){ const page=document.getElementById("page"),selected=TABS.find(t=>t.id===CURRENT);if(window.__booksLiveLoading){page.innerHTML='<div class="page-head"><div><h2>Refreshing Finance Books…</h2><p>Restoring the shared journal and statement balances</p></div></div><div class="hint">Finance figures are reconnecting. Existing balances are being preserved and will appear automatically when the ledger is ready.</div>';return;}page.innerHTML = selected&&selected.settingsSection?PAGES.settings():PAGES[CURRENT](); },

  /* ---- backup / restore ---- */
  exportJSON(){
    const blob=new Blob([JSON.stringify(DB,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download="accaza-books-backup-"+todayStr()+".json"; a.click(); URL.revokeObjectURL(url);
  },
  importJSON(file){
    if(!file) return; const rd=new FileReader();
    rd.onload=()=>{ try{ const p=JSON.parse(rd.result); if(!p.accounts||!p.entries) throw new Error("Not an Accaza Books backup"); if(!confirm("Replace all current books with this backup?")) return; DB=p; save(); App.init(); alert("Backup restored."); }catch(e){ alert("Could not import: "+e.message); } };
    rd.readAsText(file);
  },

  /* ---- journal entry modal ---- */
  newEntry(prefill){ this.openEntryModal(prefill||null,null); },
  openEntryModal(pf,edit){
    pf = pf || {date:todayStr(), ref:"", memo:"", lines:[{code:"",debit:"",credit:""},{code:"",debit:"",credit:""}]};
    const m=document.getElementById("modal");
    const linkedPayableId=(edit&&edit.linkedPayableId)||pf.linkedPayableId||"",linkedDiscrepancyId=(edit&&edit.linkedDiscrepancyId)||pf.linkedDiscrepancyId||"",payables=window.__apMap||{},payableOptions='<option value="">— select the exact open payable —</option>'+Object.keys(payables).filter(id=>(payables[id]||{}).status==='open'||id===linkedPayableId).map(id=>{const p=payables[id]||{};return `<option value="${esc(id)}" ${id===linkedPayableId?'selected':''}>${esc(p.party||'Payable')} · ${esc(p.ref||id)} · ${peso(p.remainingAmount!=null?p.remainingAmount:p.amount)}</option>`;}).join(''),discrepancies=window.__cashDiscrepancies||{},discrepancyOptions='<option value="">— select the exact open cash variance —</option>'+Object.keys(discrepancies).filter(id=>{const d=discrepancies[id]||{};return d.kind==='cash'&&(d.status!=='reviewed'||id===linkedDiscrepancyId);}).map(id=>{const d=discrepancies[id]||{},left=Number(d.remainingAmount!=null?d.remainingAmount:Math.abs(Number(d.variance)||0));return `<option value="${esc(id)}" ${id===linkedDiscrepancyId?'selected':''}>${Number(d.variance)<0?'Shortage':'Overage'} · ${peso(left)} · ${esc(d.staff||d.shiftId||id)}</option>`;}).join('');
    const optHtml = sel => '<option value="">— account —</option>' +
      TYPES.map(t=>{ const rows=DB.accounts.filter(a=>a.type===t&&!isMainAccount(a.code)&&a.active!==false); if(!rows.length) return ""; return `<optgroup label="${t}">`+rows.map(a=>`<option value="${a.code}" ${a.code===sel?'selected':''}>${a.code} · ${esc(a.name)}</option>`).join("")+`</optgroup>`; }).join("");
    const lineRow = (l,i)=>`<div class="jl-row" data-i="${i}">
        <select onchange="App.lineEdit(${i},'code',this.value)">${optHtml(l.code)}</select>
        <input type="number" step="0.01" min="0" placeholder="0.00" value="${l.debit||""}" oninput="App.lineEdit(${i},'debit',this.value)"/>
        <input type="number" step="0.01" min="0" placeholder="0.00" value="${l.credit||""}" oninput="App.lineEdit(${i},'credit',this.value)"/>
        <button class="jl-x" onclick="App.lineDel(${i})" title="Remove line">×</button></div>`;
    this._draft = JSON.parse(JSON.stringify(pf));this._edit=edit||null;
    m.innerHTML = `
      <div class="modal-head"><h3>${edit?'Correct journal entry':'New journal entry'}</h3><button class="x" onclick="App.closeModal()">×</button></div>
      <div class="modal-body">
        ${edit?'<div class="hint">Eligible open-period cash/Undeposited transfers save in place with revision history and a synchronized pooled balance—no void/repost. Keep the same cash account and direction. A privileged Finance role and reason are required. Closed periods, bank reconciliation locks, or insufficient cash block the save. Other journal types retain their existing correction workflow.</div><div class="field"><label>Correction reason</label><input id="e_reason" value="'+esc(edit.reason||'')+'" placeholder="Required · explain what was wrong" oninput="App._edit.reason=this.value"/></div>':''}
        <div class="grid2">
          <div class="field"><label>Date</label><input type="date" id="e_date" value="${pf.date}" oninput="App._draft.date=this.value"/></div>
          <div class="field"><label>Reference (optional)</label><input id="e_ref" value="${esc(pf.ref)}" placeholder="Receipt, invoice, transfer or approval ID" oninput="App._draft.ref=this.value"/></div>
        </div>
        <div class="field"><label>Memo / description</label><input id="e_memo" value="${esc(pf.memo)}" placeholder="What this entry is for" oninput="App._draft.memo=this.value"/></div>
        <div class="field"><label>Journal purpose</label><select id="e_purpose" onchange="document.getElementById('e_variance_wrap').style.display=this.value==='cash_variance'?'block':'none'"><option value="normal">Normal journal</option><option value="cash_variance" ${linkedDiscrepancyId?'selected':''}>Correct an Admin cash variance</option></select></div>
        <div class="field" id="e_variance_wrap" style="display:${linkedDiscrepancyId?'block':'none'}"><label>Linked Admin shortage / overage</label><select id="e_discrepancy">${discrepancyOptions}</select><div class="tiny muted">Posting verifies the variance amount and control-account direction, links the journal, updates cash custody when applicable, and closes or partially resolves the Admin discrepancy.</div></div>
        <div class="field"><label>Linked bill / payable <span class="muted">(required when account 2000 is used)</span></label><select id="e_payable">${payableOptions}</select><div class="tiny muted">Debiting Accounts Payable closes the selected bill in both the supplier register and General Ledger. To create a new AP credit, use New bill or Purchases.</div></div>
        <div class="section-label">Lines · debits must equal credits</div>
        <div class="jl-head"><span>Account</span><span>Debit</span><span>Credit</span><span></span></div>
        <div id="jlLines">${pf.lines.map(lineRow).join("")}</div>
        <div class="btn-row" style="margin-top:.3rem"><button class="btn sm ghost" onclick="App.lineAdd()">+ Add line</button></div>
        <div id="balBar"></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" onclick="App.closeModal()">Cancel</button>
        <button class="btn primary" id="postBtn" onclick="App.postEntry()">${edit?'Save correction':'Post entry'}</button>
      </div>`;
    document.getElementById("modalBg").classList.add("show");
    this.refreshBalBar();
  },
  _draft:null,_edit:null,
  lineEdit(i,f,v){ this._draft.lines[i][f] = (f==='code')?v:(v===""?"":Number(v)); this.refreshBalBar(); },
  lineAdd(){ this._draft.lines.push({code:"",debit:"",credit:""}); this.rerenderLines(); },
  lineDel(i){ if(this._draft.lines.length<=1) return; this._draft.lines.splice(i,1); this.rerenderLines(); },
  rerenderLines(){ // re-open preserving draft
    const pf=this._draft,edit=this._edit,payable=document.getElementById('e_payable'),discrepancy=document.getElementById('e_discrepancy');if(payable)pf.linkedPayableId=payable.value;if(discrepancy)pf.linkedDiscrepancyId=discrepancy.value;this.openEntryModal(pf,edit);
  },
  refreshBalBar(){
    const d=this._draft; let dr=0,cr=0; d.lines.forEach(l=>{dr+=Number(l.debit)||0;cr+=Number(l.credit)||0;});
    dr=r2(dr);cr=r2(cr); const diff=r2(dr-cr); const ok=(diff===0 && dr>0);
    const bar=document.getElementById("balBar"); if(!bar) return;
    bar.className="balance-bar "+(ok?"ok":"off");
    bar.innerHTML = ok ? `<span>✓ Balanced</span><span>Debits ${peso(dr)} · Credits ${peso(cr)}</span>`
      : `<span>${dr===0?'Enter amounts':'Out of balance by '+peso(Math.abs(diff))}</span><span>Debits ${peso(dr)} · Credits ${peso(cr)}</span>`;
    const btn=document.getElementById("postBtn"); if(btn) btn.disabled=!ok, btn.style.opacity=ok?1:.5;
  },
  postEntry(){
    const d=this._draft;
    if(window.__isAccountingPeriodClosed&&window.__isAccountingPeriodClosed(d.date||todayStr()))return alert('This accounting month is closed. Reopen it in Admin Settings before posting or correcting a dated journal.');
    const lines = d.lines.map(l=>({code:l.code, debit:r2(l.debit||0), credit:r2(l.credit||0)}))
                         .filter(l=>l.code && (l.debit>0||l.credit>0));
    if(lines.length<2) return alert("Need at least two lines.");
    if(lines.some(l=>isMainAccount(l.code))) return alert("Main accounts are calculated rollups. Post to a subaccount instead.");
    if(lines.some(l=>l.debit>0&&l.credit>0)) return alert("A line can't have both a debit and a credit.");
    const dr=r2(lines.reduce((s,l)=>s+l.debit,0)), cr=r2(lines.reduce((s,l)=>s+l.credit,0));
    if(dr!==cr||dr<=0) return alert("Entry is not balanced.");
    if(!window.__financeCmd) return alert("Live connection not ready — sign in first.");
    if(!(d.memo||"").trim()) return alert("Memo / description is required.");
    if(this._edit&&!(this._edit.reason||"").trim())return alert("Correction reason is required.");
    const usesAp=lines.some(l=>l.code==='2000'),linkedPayableId=(document.getElementById('e_payable')||{}).value||'',variancePurpose=(document.getElementById('e_purpose')||{}).value==='cash_variance',linkedDiscrepancyId=variancePurpose?((document.getElementById('e_discrepancy')||{}).value||''):'';if(usesAp&&!linkedPayableId)return alert('Select the exact open bill or payable for account 2000.');if(variancePurpose&&!linkedDiscrepancyId)return alert('Select the exact Admin cash shortage or overage this journal corrects.');
    const btn=document.getElementById("postBtn");btn.disabled=true;btn.textContent="Posting…";
    const commandId=this._edit?(this._edit.commandId||(this._edit.commandId="books_edit_"+crypto.randomUUID())):"books_manual_"+Date.now(),payload={action:this._edit?"correct_manual_journal":"manual_journal",commandId,date:d.date||todayStr(),ref:d.ref||"",memo:d.memo||"",lines,linkedPayableId,linkedDiscrepancyId};if(this._edit){payload.originalMovementId=this._edit.originalMovementId;payload.expectedRevision=this._edit.expectedRevision;payload.reason=this._edit.reason.trim();payload.correctionDate=todayStr();}
    const saved=()=>{this.closeModal();CURRENT="journal";this.renderTabs();this.rebuildPeriodSel();this.render();},failed=e=>{alert("Could not save journal: "+((e&&e.message)||e));btn.disabled=false;btn.textContent=this._edit?"Save correction":"Post entry";};
    window.__financeCmd(payload).then(()=>{
      saved();
    }).catch(e=>{if(!this._edit)return failed(e);window.__financeCmd({action:'cash_journal_edit_status',commandId:'edit_status_'+Date.now(),editCommandId:commandId,originalMovementId:this._edit.originalMovementId}).then(status=>{if(status&&status.committed){saved();alert('The journal was saved, although the original confirmation was interrupted. Revision '+status.revision+' is recorded.');}else failed(e);}).catch(()=>failed(e));});
  },
  rebuildPeriodSel(){
    const p=window.AccazaReportPeriod&&window.AccazaReportPeriod.get?window.AccazaReportPeriod.get():{from:todayStr(),to:todayStr()},from=document.getElementById("periodFrom"),to=document.getElementById("periodTo");if(from)from.value=p.from||p.customFrom||todayStr();if(to)to.value=p.to||p.customTo||todayStr();
  },
  editEntry(id){const e=ENTRIES().find(x=>x.id===id);if(!e||e.reversalOf||e.reversedByMovementId)return;const usesCustomerPayable=(e.lines||[]).some(l=>l.code==='2030'),customerPayableId=usesCustomerPayable?linkedCustomerPayableId(e):'';if(customerPayableId)return App.correctPayable(customerPayableId);if(usesCustomerPayable){CURRENT='payables';this.renderTabs();this.render();return alert('This journal belongs to Customer Change / Refund Payable. Use its Close to capital button so account 2030 and the exact customer subledger close together.');}if(window.__isAccountingPeriodClosed&&window.__isAccountingPeriodClosed(e.date||todayStr()))return alert('This journal belongs to a closed month. Reopen that month in Admin Settings to create its controlled correction.');this.openEntryModal({date:e.date||todayStr(),ref:e.ref||"",memo:e.memo||"",linkedPayableId:e.linkedPayableId||"",linkedDiscrepancyId:e.linkedDiscrepancyId||"",lines:(e.lines||[]).map(l=>({code:l.code,debit:Number(l.debit)||"",credit:Number(l.credit)||""}))},{originalMovementId:id,expectedRevision:Number(e.revision||0),linkedPayableId:e.linkedPayableId||"",linkedDiscrepancyId:e.linkedDiscrepancyId||"",reason:""});},
  reverseEntry(id,voidIt){
    const e=ENTRIES().find(x=>x.id===id); if(!e||e.reversedByMovementId||e.reversalOf) return;
    if(voidIt&&window.__isAccountingPeriodClosed&&window.__isAccountingPeriodClosed(e.date||todayStr()))return alert('A void uses the original accounting date. Reopen that month in Admin Settings first, or use a current-month reversal to preserve the closed history.');
    const reason=prompt((voidIt?"Why was this journal wrong from the beginning? It will be voided on its original accounting date.":"Why is this valid journal being reversed now? The reversal will use today's date.")+" The original stays in the audit history.","");if(!reason||!reason.trim())return;
    if(!window.__financeCmd) return alert("Live connection not ready — sign in first.");
    window.__financeCmd({action:voidIt?"void_manual_journal":"reverse_manual_journal",commandId:(voidIt?"books_void_":"books_reverse_")+id,originalMovementId:id,date:todayStr(),reason:reason.trim()}).then(()=>this.render()).catch(err=>alert("Could not "+(voidIt?"void":"reverse")+" journal: "+((err&&err.message)||err)));
  },
  closeModal(){ document.getElementById("modalBg").classList.remove("show"); document.getElementById("modal").innerHTML=""; },
  cashJournalHistory(id){
    if(!window.__financeCmd)return alert('Sign in before viewing revision history.');
    window.__financeCmd({action:'cash_journal_history',commandId:'history_'+Date.now(),originalMovementId:id}).then(result=>{
      const revisions=Object.values(result.revisions||{}).filter(Boolean).sort((a,b)=>b.revision-a.revision),lines=m=>(m.lines||[]).map(l=>esc(l.account)+' · Dr '+peso(l.debit)+' / Cr '+peso(l.credit)).join('<br>');
      const detail=m=>esc(new Date(m.occurredAt||m.postedAt).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}))+' · '+esc(m.reference||m.sourceId||'')+'<p>'+esc(m.memo||'')+'</p>'+lines(m);
      document.getElementById('modal').innerHTML='<div class="modal-head"><h3>Cash journal revision history</h3><button class="x" onclick="App.closeModal()">×</button></div><div class="modal-body">'+revisions.map(r=>'<div class="card card-pad"><b>Revision '+r.revision+'</b><p>'+esc(r.reason)+' · '+esc(r.changedByRole)+' · '+esc(r.changedBy)+'</p><p class="tiny">'+esc(new Date(r.changedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'}))+' · Philippine time</p><div class="tiny">Before · '+detail(r.before)+'<hr>After · '+detail(r.after)+'<p>Undeposited pool: '+peso(r.poolBefore)+' → '+peso(r.poolAfter)+'</p></div></div>').join('')+'</div>';
      document.getElementById('modalBg').classList.add('show');
    }).catch(e=>alert('Could not load revision history: '+e.message));
  },

  /* ---- drill through: show entries touching an account ---- */
  drill(code){
    const a=acc(code),bounds=periodBounds(),carry=isBalanceSheetType(a&&a.type),allThroughEnd=entriesThroughPeriodEnd().filter(e=>e.lines.some(l=>l.code===code)),ents=(carry?allThroughEnd.filter(entryInPeriod):entriesInPeriod().filter(e=>e.lines.some(l=>l.code===code))),opening=carry?normalBalanceFor(code,allThroughEnd.filter(e=>String(e&&e.date||"").slice(0,10)<bounds.start)):0;
    let running=opening;
    const rows = ents.slice().sort((x,y)=>(x.date+ x.id).localeCompare(y.date+y.id)).map(e=>{
      const l=e.lines.find(l=>l.code===code); const dr=Number(l.debit)||0, crd=Number(l.credit)||0;
      running += DEBIT_NORMAL[a.type]?(dr-crd):(crd-dr);
      return `<tr class="${e.reversed?'reversed':''}"><td>${e.date}</td><td>${esc(e.ref)} ${e.reversalOf?'<span class=badge-rev>rev</span>':''}<div class="tiny muted">${esc(e.memo)}</div></td>
        <td class="num">${dr?peso(dr):''}</td><td class="num">${crd?peso(crd):''}</td><td class="num">${peso(running)}</td></tr>`;
    }).join("");
    const m=document.getElementById("modal");
    m.innerHTML=`<div class="modal-head"><h3>${a.code} · ${esc(a.name)} <span class="type-pill t-${a.type.toLowerCase()}">${a.type}</span></h3><button class="x" onclick="App.closeModal()">×</button></div>
      <div class="modal-body"><div class="tiny muted" style="margin-bottom:.5rem">${periodLabel()} · ${carry?'opening balance '+peso(opening):'period activity only; prior periods are not carried forward'} · ${ents.length} entr${ents.length===1?'y':'ies'} · running balance in ${DEBIT_NORMAL[a.type]?'debit':'credit'} (normal) direction</div>
      <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Entry</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>${rows||'<tr><td colspan=5 class="empty">No entries in this period</td></tr>'}</tbody></table></div></div>
      <div class="modal-foot"><button class="btn ghost" onclick="App.closeModal()">Close</button></div>`;
    document.getElementById("modalBg").classList.add("show");
  }
};
