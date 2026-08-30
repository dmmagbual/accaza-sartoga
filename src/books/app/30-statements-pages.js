
/* ============================================================ PAGES ============================================================ */
const PAGES = {
  dashboard(){
    const pl=plData();
    const cash = ["1000","1010","1011","1012","1013","1014","1020","1021"].reduce((s,c)=>s+accountBalance(c,false),0); // cash across all time
    const ar = accountBalance("1100",false);
    const ap = accountBalance("2000",false);
    const cogsPct = pl.netSales>0 ? (pl.totalCogs/pl.netSales*100) : 0;
    const grossPct = pl.netSales>0 ? (pl.gross/pl.netSales*100) : 0;
    const topExp = pl.expense.slice().sort((a,b)=>b.bal-a.bal)[0];
    const kpi=(lbl,val,sub,cls)=>`<div class="kpi ${cls||''}"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="sub">${sub||''}</div></div>`;
    return `<div class="page-head"><div><h2>Dashboard</h2><p>${periodLabel()} · ${DB.meta&&DB.meta.name||''}</p></div>
        <div class="btn-row">${window.__booksUser?'<button class="btn" onclick="App.syncBooks(this)">↻ Sync all Finance transactions</button>':''}<button class="btn primary" onclick="App.newEntry()">+ New entry</button></div></div>
      <div class="hint">Live double-entry books. When signed in, POS sales, COGS, and cash post automatically, and receivables/payables read from your finance subledgers. Set opening balances to make the balance sheet and cash flow tie out.</div>
      <div class="kpis">
        ${kpi("Cash position", pesoNoDec(cash), "On hand + bank + wallet (all-time)", cash>=0?'good':'bad')}
        ${kpi("Sales ("+periodLabel()+")", pesoNoDec(pl.netSales), "Completed sales less refunds and voids")}
        ${kpi("Gross profit", pesoNoDec(pl.gross), grossPct.toFixed(1)+"% margin", pl.gross>=0?'good':'bad')}
        ${kpi("Net income", pesoNoDec(pl.net), pl.net>=0?'Profit':'Loss', pl.net>=0?'good':'bad')}
        ${kpi("COGS ratio", cogsPct.toFixed(1)+"%", "of sales")}
        ${(function(){var t=arApTotals(); return window.__booksUser
          ? kpi("Receivables (open)", pesoNoDec(t.ar), "Owed to us", 'good')+kpi("Payables (open)", pesoNoDec(t.ap), "We owe", 'bad')+kpi("Net working capital", pesoNoDec(t.net), t.net>=0?'AR exceeds AP':'AP exceeds AR', t.net>=0?'good':'bad')
          : kpi("Receivable (Grab/Panda)", pesoNoDec(ar), "From journal")+kpi("Payables", pesoNoDec(ap), "From journal");})()}
        ${kpi("Top expense", topExp?topExp.a.name:"—", topExp?pesoNoDec(topExp.bal):"")}
      </div>
      <div class="two-col">
        <div class="card card-pad">
          <div class="section-label">Quick post</div>
          <p class="tiny muted" style="margin-top:-.2rem">Pre-filled, balanced entries for the transactions you run daily. Adjust the amounts, then post.</p>
          <div class="btn-row">
            ${QUICK.map((q,i)=>`<button class="chip" onclick="App.newEntry(QUICK[${i}].build())">${q.label}</button>`).join("")}
          </div>
        </div>
        <div class="card card-pad">
          <div class="section-label">This period at a glance</div>
          <table><tbody>
            <tr><td>Net sales</td><td class="num">${peso(pl.netSales)}</td></tr>
            <tr><td>Cost of goods sold</td><td class="num neg">(${peso(pl.totalCogs)})</td></tr>
            <tr class="sub-row"><td>Gross profit</td><td class="num">${peso(pl.gross)}</td></tr>
            <tr><td>Operating expenses</td><td class="num neg">(${peso(pl.totalExp)})</td></tr>
            <tr class="total-row"><td>Net ${pl.net>=0?'income':'loss'}</td><td class="num ${pl.net>=0?'pos':'neg'}">${peso(pl.net)}</td></tr>
          </tbody></table>
        </div>
      </div>`;
  },

  cashflow(){
    if(!window.__booksUser)return `<div class="page-head"><div><h2>Cash Flow</h2><p>Bank, wallet and cash movements</p></div></div><div class="empty"><div class="big">🏦</div><b>Sign in for live Cash Flow</b><br><span class="tiny">Cash Flow now lives in Finance / Books.</span></div>`;
    if(!window.__controlAudit&&window.__auditControls&&!window.__controlAuditLoading){window.__controlAuditLoading=true;window.__auditControls().then(function(r){window.__controlAudit=r||{};}).catch(function(){window.__controlAudit={};}).finally(function(){window.__controlAuditLoading=false;if(window.App&&App.render)App.render();});}
    const s=cfStatement(),receiptRows=Object.keys(s.add).sort().map(k=>`<tr><td><span class="account-child">${esc(k)}</span></td><td class="num pos">${peso(s.add[k])}</td></tr>`).join('')||'<tr><td><span class="account-child muted">No receipts</span></td><td class="num muted">—</td></tr>',deductionRows=Object.keys(s.ded).sort().map(k=>`<tr><td><span class="account-child">${esc(k)}</span></td><td class="num neg">(${peso(s.ded[k])})</td></tr>`).join('')||'<tr><td><span class="account-child muted">No deductions</span></td><td class="num muted">—</td></tr>',correctionRows=s.correctionDetail.map(x=>`<tr><td><span class="account-child">${esc(x.type)}</span><div class="tiny muted">${esc(x.date)} · ${esc(x.id)}</div></td><td class="num">${x.net<0?'−':''}${peso(Math.abs(x.net))}</td></tr>`).join('')||'<tr><td><span class="account-child muted">No balance corrections</span></td><td class="num muted">—</td></tr>',balRows=obj=>s.keys.filter((k,i,a)=>a.indexOf(k)===i).map(k=>`<tr><td><span class="account-child">${esc(cfName(k))}</span></td><td class="num">${peso(obj[k]||0)}</td></tr>`).join(''),expected=r2(s.totBegin+s.totAdd-s.totDed+s.corrections),ties=Math.abs(expected-s.totEnd)<.01;
    const cards=s.accs.map(a=>`<div class="kpi"><div class="lbl">${esc(a.name)} · ${esc(a.type||'bank')}</div><div class="val">${peso(s.ending[a.id]||0)}</div><div class="sub">Opening ${a.openingDate||'—'} · ${peso(a.opening||0)} · <span class="linkish" onclick="App.cashAccountEdit('${a.id}')">edit</span></div></div>`).join('');
    const activity=s.detail.slice().reverse().slice(0,100).map(x=>`<tr><td>${x.date}</td><td>${esc(x.type)}<div class="tiny muted">${esc(x.id)}</div></td><td class="num ${x.net>=0?'pos':'neg'}">${x.net>=0?peso(x.net):'('+peso(-x.net)+')'}</td></tr>`).join('');
    const allPayouts=Object.keys(window.__platformPayouts||{}).map(id=>Object.assign({id},window.__platformPayouts[id]||{})),payouts=allPayouts.filter(p=>!p.reversed&&!p.depositMovementId&&Number(p.actualPayout)>0),orphanedPayoutDeposits=allPayouts.filter(p=>p.reversed&&p.depositMovementId&&!p.depositReversalMovementId&&Number(p.actualPayout)>0),custody=Object.keys(window.__cashCustody||{}).map(id=>Object.assign({id},window.__cashCustody[id]||{})).filter(c=>Number(c.remaining)>0),payoutDepositRows=payouts.map(p=>`<tr><td>Platform payout · ${esc(p.channel||'')}</td><td>${p.settledAt?new Date(p.settledAt).toLocaleDateString('en-PH'):'—'}</td><td class="num">${peso(p.actualPayout)}</td><td><button class="btn sm" onclick="App.cfRecordDeposit('payout','${p.id}')">Deposit</button></td></tr>`).join(''),custodyDepositRows=custody.map(c=>`<tr><td>Register custody · <b>${esc(c.shiftReference||c.reference||c.staff||c.shiftId||c.id)}</b></td><td>${c.closedAt?new Date(c.closedAt).toLocaleDateString('en-PH'):'—'}</td><td class="num">${peso(c.remaining)}</td><td><label class="tiny"><input type="checkbox" data-cf-custody="${esc(c.id)}"/> Include</label></td></tr>`).join(''),exceptionRows=orphanedPayoutDeposits.map(p=>`<tr><td><b>Deposit recorded after payout reversal</b><div class="tiny muted">${esc(p.channel||'platform')} · ${esc(p.id)}</div></td><td>${esc(cfName(p.accountId))}</td><td class="num neg">(${peso(p.actualPayout)})</td><td><button class="btn sm" onclick="App.repairPayoutDeposit('${p.id}',this)">Repair deposit</button></td></tr>`).join('');
    const movementById=new Map(cfMovements().map(m=>[m.id,m])),lateCorrections=cfMovements().filter(original=>{if(original.type!=='manual_books_journal'||!original.correctionReplacementId||!original.reversedByMovementId||original.lateCorrectionRepairId)return false;const reversal=movementById.get(original.reversedByMovementId),replacement=movementById.get(original.correctionReplacementId);if(!reversal||reversal.type!=='manual_books_journal_correction_reversal'||reversal.reversalOf!==original.id||!replacement||replacement.correctsMovementId!==original.id)return false;const lines=original.lines||[],cashOnly=lines.length>=2&&lines.every(l=>{const a=String(l.account||'');return a==='asset:register_cash'||a==='asset:cash_awaiting_deposit'||a==='asset:petty_cash'||a.indexOf('asset:cash_account:')===0;});return cashOnly&&Math.abs(cfCashDelta(original))<.005&&cfDay(reversal.occurredAt)>cfDay(original.occurredAt);}),lateCorrectionRows=lateCorrections.map(original=>{const reversal=movementById.get(original.reversedByMovementId),amount=(original.lines||[]).reduce((max,l)=>Math.max(max,Number(l.debit)||0,Number(l.credit)||0),0);return `<tr><td><b>Correction reversal posted in a later period</b><div class="tiny muted">${esc(original.id)} · original ${cfDay(original.occurredAt)} · reversal ${cfDay(reversal.occurredAt)}</div></td><td>Cash-to-cash correction</td><td class="num neg">${peso(amount)}</td><td><button class="btn sm" onclick="App.repairLateJournalCorrection('${original.id}',this)">Repair periods</button></td></tr>`;}).join('');
    return `<div class="page-head"><div><h2>Cash Flow</h2><p>Authoritative cash statement · moved from Admin</p></div><div class="btn-row"><button class="btn" onclick="App.go('transactions')">Record transaction</button><button class="btn primary" onclick="App.cashAccountEdit('')">+ Cash account</button></div></div>
      <div class="hint">Beginning cash comes from movements before the selected start date. Cash on Hand and Register Cash Float use the same dated account split as the Balance Sheet; the reclassification does not change total cash.</div>
      ${(function(){var audit=window.__controlAudit,maintenance=audit&&audit.systemDateMaintenance,issues=Array.isArray(audit&&audit.issues)?audit.issues:[];if(!audit)return '';var maintenanceText=maintenance&&maintenance.repaired?'<div class="tiny" style="color:#155724;margin-bottom:.55rem">System maintenance aligned '+maintenance.repaired+' historical Finance date'+(maintenance.repaired===1?'':'s')+' to their verified cash dates. No cash amount, account, or source record changed.</div>':'';if(!issues.length&&!maintenanceText)return '';var rows=issues.map(function(i){var action=i.actionTarget?'<button class="btn sm" onclick="App.openControlResolution(\''+esc(i.actionTarget)+'\',\''+esc(i.source||'')+'\',this)">'+esc(i.actionLabel||'Open solution')+'</button>':'';return '<tr><td><b>'+esc(i.title||i.kind||'Control exception')+'</b><div class="tiny muted">'+esc(i.sourceLabel||'')+'</div></td><td>'+esc(i.solution||'Open the linked source record and use its controlled correction workflow.')+'</td><td>'+action+'</td></tr>';}).join('');return '<div class="card" style="margin-bottom:1rem"><div class="card-pad"><div class="section-label">Resolution guide</div><div class="tiny muted">Every remaining exception has a controlled next step. System-only date maintenance is completed automatically and is not a manager task.</div>'+maintenanceText+'</div>'+(rows?'<div class="tbl-wrap"><table><thead><tr><th>Exception</th><th>How to resolve it</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+'</div>';})()}
      ${(function(){var a=window.__controlAudit;var b='<button class="btn primary" onclick="App.runControlAudit(this)">Run control audit</button>';if(!a)return '<div class="card" style="margin-bottom:1rem"><div class="card-pad"><div class="section-label">Financial control audit</div><div class="tiny muted">Server check for unbalanced entries, missing sale postings, suspense/clearing balances, off-chart balances, and unreviewed cash discrepancies.</div><div style="margin-top:.6rem">'+b+'</div></div></div>';var issues=Array.isArray(a.issues)?a.issues:[];var b2=issues.some(function(i){return (i.kind||'')==='cash_finance_date_mismatch';})?' <button class="btn" onclick="App.repairFinanceDates(this)">Repair date mismatches</button>':'';var rows=issues.map(function(i){return '<tr><td>'+esc(i.severity||'')+'</td><td>'+esc(i.title||i.kind||'Control exception')+'</td><td>'+esc(i.sourceLabel||'')+'</td><td>'+esc(i.detail||'')+'</td><td class="num">'+(i.amount!=null?peso(i.amount):'')+'</td></tr>';}).join('');return '<div class="card" style="margin-bottom:1rem'+(issues.length?';border-color:#c96b62':'')+'"><div class="card-pad"><div class="section-label"'+(issues.length?' style="color:#9d3028"':'')+'>Financial control audit &middot; '+(a.issueCount||0)+' exception(s)</div><div class="tiny muted" style="margin-bottom:.4rem">'+b+b2+'</div></div>'+(issues.length?'<div class="tbl-wrap"><table><thead><tr><th>Severity</th><th>Issue</th><th>Source</th><th>Detail</th><th class="num">Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="card-pad" style="color:#155724">No exceptions found.</div>')+'</div>';})()}
      ${orphanedPayoutDeposits.length?`<div class="card" style="margin-bottom:1rem;border-color:#c96b62"><div class="card-pad"><div class="section-label" style="color:#9d3028">Financial control exceptions · ${orphanedPayoutDeposits.length}</div><div class="tiny muted">These deposits were posted after their payouts had already been reversed. Repairing appends an approved correction; original entries remain in the audit trail.</div></div><div class="tbl-wrap"><table><thead><tr><th>Issue</th><th>Cash account</th><th class="num">Amount</th><th></th></tr></thead><tbody>${exceptionRows}</tbody></table></div></div>`:''}
      ${lateCorrections.length?`<div class="card" style="margin-bottom:1rem;border-color:#c96b62"><div class="card-pad"><div class="section-label" style="color:#9d3028">Journal period exceptions · ${lateCorrections.length}</div><div class="tiny muted">These corrected cash journals used a later date for their mechanical reversal. Repairing appends two matched entries so the original and late periods both net correctly; the corrected replacement and full audit history remain.</div></div><div class="tbl-wrap"><table><thead><tr><th>Issue</th><th>Scope</th><th class="num">Amount</th><th></th></tr></thead><tbody>${lateCorrectionRows}</tbody></table></div></div>`:''}
      <div class="kpis">${cards}</div>
      <div class="card card-pad" style="margin-bottom:1rem"><div class="page-head" style="margin-bottom:.6rem"><div><div class="section-label">Cash flow statement</div></div><div class="tiny">From <input type="date" value="${CF_FROM}" onchange="App.cfRange('from',this.value)"/> to <input type="date" value="${CF_TO}" onchange="App.cfRange('to',this.value)"/></div></div>
        <div class="tbl-wrap"><table><thead><tr><th>Cash movement</th><th class="num">Amount</th></tr></thead><tbody>
          <tr class="group-account"><td>Beginning cash balance · ${CF_FROM}</td><td class="num">${peso(s.totBegin)}</td></tr>${balRows(s.begin)}
          <tr class="sub-row"><td>Plus: Receipts</td><td class="num pos">${peso(s.totAdd)}</td></tr>${receiptRows}
          <tr class="sub-row"><td>Less: Deductions</td><td class="num neg">(${peso(s.totDed)})</td></tr>${deductionRows}
          <tr class="sub-row"><td>Plus / less: Balance corrections <span class="tiny muted">not receipts or payments</span></td><td class="num">${s.corrections<0?'−':''}${peso(Math.abs(s.corrections))}</td></tr>${correctionRows}
          <tr class="total-row"><td>Calculated ending cash</td><td class="num">${peso(expected)}</td></tr>
          <tr class="group-account"><td>Ending cash balances · ${CF_TO}</td><td class="num">${peso(s.totEnd)}</td></tr>${balRows(s.ending)}
        </tbody></table></div>
        <div class="balance-bar ${ties?'ok':'off'}">${ties?'✓ Beginning cash + receipts − deductions ± corrections agrees with ending cash':'✗ Cash statement differs by '+peso(Math.abs(expected-s.totEnd))}<span>${peso(s.totBegin)} + ${peso(s.totAdd)} − ${peso(s.totDed)} ${s.corrections<0?'−':'+'} ${peso(Math.abs(s.corrections))} = ${peso(expected)}</span></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-pad"><div class="section-label">Cash accounts · all open for viewing and editing</div></div><div class="tbl-wrap"><table><thead><tr><th>Account</th><th>Type</th><th>Opening date</th><th class="num">Opening</th><th></th></tr></thead><tbody>${s.accs.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.type)}</td><td>${a.openingDate||'—'}</td><td class="num">${peso(a.opening)}</td><td><button class="btn sm ghost" onclick="App.cashAccountEdit('${a.id}')">Edit</button></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-pad"><div class="section-label">Deposits to record</div><div class="tiny muted">Register custody shows only cash still physically available after approved cash payments and earlier deposits. Select the sources that make up one actual bank deposit; do not deposit the original shift amounts automatically.</div>${custody.length?'<div style="margin-top:.65rem"><button class="btn primary" onclick="App.cfRecordCustodyDeposit()">Record selected register-cash deposit</button></div>':''}</div><div class="tbl-wrap"><table><thead><tr><th>Source</th><th>Date</th><th class="num">Available now</th><th></th></tr></thead><tbody>${payoutDepositRows}${custodyDepositRows||(!payoutDepositRows?'<tr><td colspan="4" class="empty">No deposits waiting to be recorded.</td></tr>':'')}</tbody></table></div></div>
      <div class="card"><div class="card-pad"><div class="section-label">Cash activity · selected period</div></div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Movement</th><th class="num">Net cash</th></tr></thead><tbody>${activity||'<tr><td colspan="3" class="empty">No cash activity in this period.</td></tr>'}</tbody></table></div></div>`;
  },

  journal(){
    const all=ENTRIES(),byId=new Map(all.map(e=>[e.id,e])),children={};
    all.forEach(e=>{if(e.reversalOf)(children[e.reversalOf]=children[e.reversalOf]||[]).push(e);});
    const replacements={};all.forEach(e=>{if(e.correctsMovementId)replacements[e.correctsMovementId]=e;});
    const mechanics=new Set();all.forEach(e=>{if(e.reversalOf)mechanics.add(e.id);if(e.correctsMovementId)mechanics.add(e.id);});
    const display=all.filter(e=>!mechanics.has(e.id)).map(original=>{
      const replacement=replacements[original.id]||null,reversal=(children[original.id]||[])[0]||null,primary=replacement||original;
      return {original,reversal,replacement,primary,date:replacement?replacement.date:original.date};
    }).filter(g=>entryInPeriod({date:g.date})).sort((a,b)=>(b.date+b.primary.id).localeCompare(a.date+a.primary.id));
    const entryLines=e=>(e.lines||[]).map(l=>`<div style="display:flex;justify-content:space-between;gap:1rem">
          <span style="${(Number(l.credit)||0)>0?'padding-left:1.1rem':''}"><span class="acc-code">${l.code}</span> ${esc(accName(l.code))}</span>
          <span class="num">${(Number(l.debit)||0)>0?peso(l.debit):'<span class="muted">'+peso(l.credit)+' cr</span>'}</span></div>`).join("");
    const historyEntry=(label,e)=>e?`<div style="padding:.45rem 0;border-top:1px solid var(--cd)"><b>${label}</b> · ${esc(e.date||'')} · ${esc(e.ref||e.id)}<div style="margin-top:.25rem">${entryLines(e)}</div></div>`:'';
    const rows = display.map(g=>{
      const e=g.primary,dr=(e.lines||[]).reduce((s,l)=>s+(Number(l.debit)||0),0),corrected=!!g.replacement,closed=!corrected&&!!g.reversal,status=corrected?'Corrected':closed?(g.reversal&&g.reversal.voided?'Voided':'Reversed'):'';
      const history=(corrected||closed)?`<details style="margin-top:.45rem"><summary class="tiny linkish">View posting history</summary>${historyEntry('Original posting',g.original)}${historyEntry(g.reversal&&g.reversal.voided?'Void entry':'Reversal entry',g.reversal)}${historyEntry('Corrected replacement',g.replacement)}</details>`:'';
      const posLocked=e.sourceType==='order'||/^order_|^pos_/i.test(e.type||'')||/^POS-/i.test(e.ref||''),customerPayableId=linkedCustomerPayableId(e),customerPayableControl=(e.lines||[]).some(l=>l.code==='2030');
      return `<tr>
        <td class="journal-date">${e.date}<div class="tiny muted">${esc(e.ref)||'—'} ${e.source==='pos'?'<span class="badge-rev" style="color:#28576b;background:#e9f2f6">POS</span>':''}${status?'<span class="badge-rev">'+status+'</span>':''}</div></td>
        <td class="journal-entry"><b>${esc(e.memo)||'(no memo)'}</b>${e.linkedDiscrepancyId?`<div class="tiny" style="margin-top:.2rem"><span class="badge-rev">Admin variance · ${esc(e.linkedDiscrepancyId)}</span></div>`:''}<div style="margin-top:.35rem;font-size:.8rem">${entryLines(e)}</div>${history}</td>
        <td class="num journal-amount">${closed?peso(0):peso(dr)}</td>
        <td class="journal-actions">${!closed&&customerPayableId?`<button class="btn sm primary" onclick="App.correctPayable('${customerPayableId}')">Close linked payable</button>`:!closed&&customerPayableControl?`<button class="btn sm ghost" onclick="App.editEntry('${e.id}')">Open customer payable</button>`:!closed&&!posLocked&&!e.reversalOf&&!e.reversedByMovementId?`<button class="btn sm ghost" onclick="App.editEntry('${e.id}')">Edit / correct</button> ${(e.sourceType==='booksManualJournal'||e.type==='manual_books_journal')?`<button class="btn sm ghost" onclick="App.reverseEntry('${e.id}',false)">Reverse</button> <button class="btn sm ghost" onclick="App.reverseEntry('${e.id}',true)">Void</button>`:''}`:'<span class="tiny muted">'+(status||(posLocked?'POS locked':'Automatic posting'))+'</span>'}</td></tr>`;
    }).join("");
    return `<div class="page-head"><div><h2>Journal</h2><p>${periodLabel()} · ${display.length} displayed entr${display.length===1?'y':'ies'} · correction mechanics grouped into posting history</p></div>
        <button class="btn primary" onclick="App.newEntry()">+ New entry</button></div>
      <div class="hint">Every non-POS journal can be corrected while its accounting month is open. POS sale and COGS journals remain locked. Saving an edit creates a linked reversal and replacement, so the original audit trail is never erased.</div>
      <div class="card"><div class="tbl-wrap"><table class="journal-table">
        <colgroup><col style="width:155px"><col><col style="width:120px"><col style="width:205px"></colgroup><thead><tr><th>Date</th><th>Entry &amp; lines</th><th class="num">Amount</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan=4><div class="empty"><div class="big">📓</div>No entries in this period.<br><button class="btn primary" style="margin-top:.8rem" onclick="App.newEntry()">Post your first entry</button></div></td></tr>'}</tbody>
      </table></div></div>`;
  },

  ledger(){
    const groups = TYPES.map(t=>({t, rows:DB.accounts.filter(a=>a.type===t)}));
    const body = groups.map(g=>{
      const rws = g.rows.map(a=>{ const bal=accountBalance(a.code,true); const has=Math.abs(bal)>0.005;
        return `<tr><td><span class="acc-code">${a.code}</span></td>
          <td><span class="linkish" onclick="App.drill('${a.code}')">${esc(a.name)}</span></td>
          <td class="num">${has?peso(bal):'<span class="muted">'+peso(0)+'</span>'}</td></tr>`; }).join("");
      return `<tr class="sub-row"><td colspan="3"><span class="type-pill t-${g.t.toLowerCase()}">${g.t}</span></td></tr>`+rws;
    }).join("");
    return `<div class="page-head"><div><h2>General Ledger</h2><p>Assets, liabilities and equity through ${periodBounds().end}; income, COGS and expenses for ${periodLabel()} only</p></div></div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Account</th><th class="num">Balance (normal side)</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  },

  tb(){
    let totDr=0, totCr=0;
    const rows = DB.accounts.map(a=>{
      const net = accountNet(a.code, entriesInPeriod()); // selected-period debit-positive activity
      const dr = net>0?net:0, cr=net<0?-net:0; totDr+=dr; totCr+=cr;
      return `<tr><td><span class="acc-code">${a.code}</span></td>
        <td><span class="linkish" onclick="App.drill('${a.code}')">${esc(a.name)}</span> <span class="type-pill t-${a.type.toLowerCase()}">${a.type}</span></td>
        <td class="num">${dr?peso(dr):'<span class="muted">—</span>'}</td><td class="num">${cr?peso(cr):'<span class="muted">—</span>'}</td></tr>`;
    }).join("");
    const balanced = Math.abs(r2(totDr)-r2(totCr))<0.005;
    return `<div class="page-head"><div><h2>Trial Balance</h2><p>${periodLabel()} activity · debits and credits posted inside the selected period</p></div></div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${rows}<tr class="total-row"><td></td><td>Totals</td><td class="num">${peso(totDr)}</td><td class="num">${peso(totCr)}</td></tr></tbody></table></div>
      <div class="card-pad ${balanced?'':''}" style="border-top:1px solid var(--line)"><span class="balance-bar ${balanced?'ok':'off'}" style="display:inline-flex">${balanced?'✓ In balance — debits equal credits':'✗ Out of balance by '+peso(Math.abs(totDr-totCr))}</span></div></div>`;
  },

  pl(){
    const pl=plData();
    const line=(x,contra)=>`<tr><td><span class="acc-code">${x.a.code}</span> ${x.synthetic?'<span>'+esc(x.a.name)+'</span> <span class="tiny muted">· review the browser journal</span>':'<span class="linkish" onclick="App.drill(\''+x.a.code+'\')">'+esc(x.a.name)+'</span>'}</td><td class="num ${contra?'neg':''}">${contra?'('+peso(Math.abs(x.bal))+')':peso(x.bal)}</td></tr>`;
    // contra: Income accounts with debit-normal balance (4900) show as negative already via bal sign
    const salesRows = pl.sales.map(x=> line(x, x.bal<0)).join("");
    const otherIncomeRows = pl.otherIncome.map(x=> line(x, x.bal<0)).join("");
    const cogsRows = pl.cogs.map(x=>line(x,true)).join("");
    const expRows = pl.expense.map(x=>line(x,true)).join("");
    const grossPct = pl.netSales>0?(pl.gross/pl.netSales*100):0;
    const netPct = pl.netSales>0?(pl.net/pl.netSales*100):0;
    return `<div class="page-head"><div><h2>Profit &amp; Loss</h2><p>${periodLabel()}</p></div>
      <button class="btn primary" onclick="App.newEntry()">+ New entry</button></div>
      ${periodButtons()}
      <div class="card"><div class="tbl-wrap"><table>
        <thead><tr><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr class="sub-row"><td colspan="2">Recognized sales <span class="tiny muted">· Admin-authorized bridge entries only; fully voided transactions excluded</span></td></tr>
          ${salesRows||'<tr><td colspan=2 class="muted">No completed sales in this period</td></tr>'}
          <tr class="total-row"><td>Net sales</td><td class="num">${peso(pl.netSales)}</td></tr>
          <tr class="sub-row"><td colspan="2">Cost of goods sold</td></tr>
          ${cogsRows||'<tr><td colspan=2 class="muted">—</td></tr>'}
          <tr class="total-row"><td>Total COGS</td><td class="num neg">(${peso(pl.totalCogs)})</td></tr>
          <tr class="total-row"><td>Gross profit <span class="tiny muted">${grossPct.toFixed(1)}%</span></td><td class="num ${pl.gross>=0?'pos':'neg'}">${peso(pl.gross)}</td></tr>
          <tr class="sub-row"><td colspan="2">Other income</td></tr>
          ${otherIncomeRows||'<tr><td colspan=2 class="muted">—</td></tr>'}
          <tr class="total-row"><td>Total other income</td><td class="num">${peso(pl.totalOtherIncome)}</td></tr>
          <tr class="sub-row"><td colspan="2">Operating expenses</td></tr>
          ${expRows||'<tr><td colspan=2 class="muted">—</td></tr>'}
          <tr class="total-row"><td>Total expenses</td><td class="num neg">(${peso(pl.totalExp)})</td></tr>
          <tr class="total-row"><td>Net ${pl.net>=0?'income':'loss'} <span class="tiny muted">${netPct.toFixed(1)}%</span></td><td class="num ${pl.net>=0?'pos':'neg'}" style="font-size:1.05rem">${peso(pl.net)}</td></tr>
        </tbody></table></div></div>`;
  },

  bs(){
    // Balance sheet uses ALL entries up to and including selected period (cumulative), not just the month.
    const ents = entriesThroughPeriodEnd();
    const grp = type => DB.accounts.filter(a=>a.type===type).map(a=>{ const net=accountNet(a.code,ents); const bal = DEBIT_NORMAL[type]?net:-net; return {a,bal}; }).filter(x=>Math.abs(x.bal)>0.005);
    const assets=grp("Asset"), liab=grp("Liability"), equity=grp("Equity");
    const totAssets=assets.reduce((s,x)=>s+x.bal,0);
    const totLiab=liab.reduce((s,x)=>s+x.bal,0);
    let totEquity=equity.reduce((s,x)=>s+x.bal,0);
    // Calendar-year close: completed years roll into retained earnings at Dec 31;
    // only the current year's result remains current net income.
    const currentYear=String(periodBounds().end||todayStr()).slice(0,4),yearStart=currentYear+"-01-01";
    const resultFor = rows => {
      const inc=DB.accounts.filter(a=>a.type==="Income").reduce((s,a)=>s+-postedAccountNet(a.code,rows),0);
      const cog=DB.accounts.filter(a=>a.type==="COGS").reduce((s,a)=>s+postedAccountNet(a.code,rows),0);
      const exp=DB.accounts.filter(a=>a.type==="Expense").reduce((s,a)=>s+postedAccountNet(a.code,rows),0);
      return r2(inc-cog-exp);
    };
    const retainedFromClosedYears=resultFor(ents.filter(e=>String(e&&e.date||"").slice(0,10)<yearStart));
    const currentNetIncome=resultFor(ents.filter(e=>String(e&&e.date||"").slice(0,10)>=yearStart));
    const netIncome=r2(retainedFromClosedYears+currentNetIncome);
    const totEquityWithNI = totEquity + netIncome;
    const totLE = totLiab + totEquityWithNI;
    const balanced = Math.abs(r2(totAssets)-r2(totLE))<0.005;
    const rows = (arr,type) => {
      const balances=new Map(arr.map(x=>[x.a.code,x])), rendered=new Set(), out=[];
      ACCOUNT_GROUPS.filter(g=>g.type===type).forEach(main=>{
        const children=groupChildren(main).map(a=>balances.get(a.code)).filter(Boolean);
        if(!children.length)return;
        const total=r2(children.reduce((sum,x)=>sum+x.bal,0));
        out.push(`<tr class="group-account"><td><span class="acc-code">${main.code}</span> ${esc(main.name)} <span class="type-pill t-${type.toLowerCase()}">Main</span></td><td class="num">${peso(total)}</td></tr>`);
        children.forEach(x=>{rendered.add(x.a.code);out.push(`<tr><td><span class="account-child"><span class="acc-code">${x.a.code}</span> <span class="linkish" onclick="App.drill('${x.a.code}')">${esc(x.a.name)}</span></span></td><td class="num">${peso(x.bal)}</td></tr>`);});
      });
      arr.filter(x=>!rendered.has(x.a.code)).forEach(x=>out.push(`<tr><td><span class="acc-code">${x.a.code}</span> <span class="linkish" onclick="App.drill('${x.a.code}')">${esc(x.a.name)}</span></td><td class="num">${peso(x.bal)}</td></tr>`));
      return out.join("");
    };
    return `<div class="page-head"><div><h2>Balance Sheet</h2><p>Cumulative balance as of ${periodBounds().end}</p></div></div>
      <div class="hint">Opening balances are Owner's Capital. Completed calendar-year profit or loss closes to Retained Earnings at December 31; the active year's result remains Current-year net income.</div>
      <div class="two-col">
        <div class="card"><div class="card-pad"><div class="section-label"><span class="type-pill t-asset">Assets</span></div></div><div class="tbl-wrap"><table><tbody>
          ${rows(assets,"Asset")||'<tr><td class="muted">—</td><td></td></tr>'}
          <tr class="total-row"><td>Total assets</td><td class="num">${peso(totAssets)}</td></tr></tbody></table></div></div>
        <div class="card"><div class="card-pad"><div class="section-label"><span class="type-pill t-liability">Liabilities</span> &amp; <span class="type-pill t-equity">Equity</span></div></div><div class="tbl-wrap"><table><tbody>
          <tr class="sub-row"><td colspan="2">Liabilities</td></tr>
          ${rows(liab,"Liability")||'<tr><td class="muted">—</td><td></td></tr>'}
          <tr><td><b>Total liabilities</b></td><td class="num"><b>${peso(totLiab)}</b></td></tr>
          <tr class="sub-row"><td colspan="2">Equity</td></tr>
          ${rows(equity,"Equity")||''}
          <tr><td>Retained earnings (closed through Dec 31, ${Number(currentYear)-1})</td><td class="num ${retainedFromClosedYears>=0?'pos':'neg'}">${peso(retainedFromClosedYears)}</td></tr>
          <tr><td>Current-year net ${currentNetIncome>=0?'income':'loss'} (${currentYear})</td><td class="num ${currentNetIncome>=0?'pos':'neg'}">${peso(currentNetIncome)}</td></tr>
          <tr><td><b>Total equity</b></td><td class="num"><b>${peso(totEquityWithNI)}</b></td></tr>
          <tr class="total-row"><td>Total liabilities &amp; equity</td><td class="num">${peso(totLE)}</td></tr></tbody></table></div></div>
      </div>
      <div class="card-pad center"><span class="balance-bar ${balanced?'ok':'off'}" style="display:inline-flex">${balanced?'✓ Balanced — Assets = Liabilities + Equity':'✗ Out of balance by '+peso(Math.abs(totAssets-totLE))}</span></div>`;
  },

  coa(){
    const entries=ENTRIES(), groups = TYPES.map(t=>({t, rows:DB.accounts.filter(a=>a.type===t)}));
    const accountRow = a=>`<tr><td><span class="acc-code">${a.code}</span></td><td><span class="${accountGroupFor(a)?'account-child':''}"><b>${esc(a.name)}</b></span></td><td class="tiny muted">${esc(a.note)}</td><td class="num">${peso(normalBalanceFor(a.code,entries))}</td>
        <td style="white-space:nowrap"><button class="btn sm ghost" onclick="App.editAccount('${a.code}')">Edit</button></td></tr>`;
    const body = groups.map(g=>{
      const rows=[], emitted=new Set();
      ACCOUNT_GROUPS.filter(x=>x.type===g.t).forEach(main=>{
        rows.push(`<tr class="group-account"><td><span class="acc-code">${main.code}</span></td><td>${esc(main.name)} <span class="type-pill t-asset">Main</span></td><td class="tiny muted">${esc(main.note)}</td><td class="num">${peso(groupBalance(main,entries))}</td><td><span class="tiny muted">Protected</span></td></tr>`);
        groupChildren(main).forEach(a=>{rows.push(accountRow(a));emitted.add(a.code);});
      });
      g.rows.filter(a=>!emitted.has(a.code)).forEach(a=>rows.push(accountRow(a)));
      return `<tr class="sub-row"><td colspan="5"><span class="type-pill t-${g.t.toLowerCase()}">${g.t}</span> <span class="tiny muted">· normal balance: ${DEBIT_NORMAL[g.t]?'Debit':'Credit'}</span></td></tr>`+rows.join("");
    }).join("");
    return `<div class="page-head"><div><h2>Chart of Accounts</h2><p>${DB.accounts.length} posting accounts · ${ACCOUNT_GROUPS.length} protected main accounts · balances as of latest entry</p></div>
      ${(!window.__booksUser||window.__booksChartManager)?`<div class="btn-row" style="gap:.5rem">${(window.__booksUser&&window.__booksChartManager)?'<button class="btn" onclick="App.importLocalChart()">⬆ Import local accounts</button>':''}<button class="btn primary" onclick="App.editAccount()">+ Add account</button></div>`:'<span class="tiny muted">Chart is managed by the finance owners</span>'}</div>
      <div class="hint">Main accounts are read-only totals. Transactions must be posted to their indented subaccounts, preserving detailed inventory and cash audit trails.</div>
      <div class="card"><div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Note</th><th class="num">Balance</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }
};
