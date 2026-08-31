
/* ============================================================ CSV EXPORTS ============================================================ */
function csvSafe(value){
  if(value==null)return '';
  if(typeof value==='number'&&Number.isFinite(value))return value.toFixed(2);
  var text=String(value).replace(/\r?\n/g,' ');
  if(/^\s*[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function csvPeriodName(){var r=periodBounds();return (r.start||'start')+'_to_'+(r.end||'end');}
function csvDownload(name,headers,rows,range){
  var content='\uFEFF'+[headers].concat(rows).map(function(row){return row.map(csvSafe).join(',');}).join('\r\n'),blob=new Blob([content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='accaza-'+name+'-'+(range||csvPeriodName())+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
function csvEntryStatus(e){return e.voided?'Voided':e.reversalOf?'Reversal':e.correctsMovementId?'Correction replacement':e.reversedByMovementId?'Corrected / reversed':'Posted';}
function financeTransactions(){return ENTRIES().filter(entryInPeriod).slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||''));});}
function exportJournalCsv(){
  var rows=[];financeTransactions().forEach(function(e){(e.lines||[]).forEach(function(l){rows.push([e.date||'',e.id||'',e.ref||'',e.memo||'',csvEntryStatus(e),e.sourceType||e.source||'',l.code||'',accName(l.code)||'',Number(l.debit)||0,Number(l.credit)||0,e.reversalOf||'',e.correctsMovementId||'']);});});
  csvDownload('journal',['Date','Entry ID','Reference','Memo','Status','Source','Account code','Account name','Debit','Credit','Reversal of','Corrects movement'],rows);
}
function exportLedgerCsv(){
  var running={},rows=[],entries=ENTRIES().filter(entryInPeriod).slice().sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''))||String(a.id||'').localeCompare(String(b.id||''));});
  var bounds=periodBounds(),before=ENTRIES().filter(function(e){return e.date&&String(e.date).slice(0,10)<bounds.start;});
  DB.accounts.forEach(function(a){running[a.code]=isBalanceSheetType(a.type)?normalBalanceFor(a.code,before):0;rows.push([bounds.start,a.code,a.name,a.type,'','','Opening balance',0,0,running[a.code],'Opening']);});
  entries.forEach(function(e){(e.lines||[]).forEach(function(l){var code=l.code||'',account=acc(code),net=(Number(l.debit)||0)-(Number(l.credit)||0);running[code]=r2((running[code]||0)+(DEBIT_NORMAL[account&&account.type]?net:-net));rows.push([e.date||'',code,accName(code)||'',account&&account.type||'',e.id||'',e.ref||'',e.memo||'',Number(l.debit)||0,Number(l.credit)||0,running[code],csvEntryStatus(e)]);});});
  DB.accounts.forEach(function(a){rows.push([bounds.end,a.code,a.name,a.type,'','','Closing balance',0,0,running[a.code]||0,'Closing']);});
  csvDownload('general-ledger',['Date','Account code','Account name','Account type','Entry ID','Reference','Memo','Debit','Credit','Running balance (normal side)','Status'],rows);
}
function accountLedgerDetail(code){
  var a=acc(code),bounds=periodBounds(),carry=isBalanceSheetType(a&&a.type),allThroughEnd=entriesThroughPeriodEnd().filter(function(e){return (e.lines||[]).some(function(line){return line.code===code;});}),entries=(carry?allThroughEnd.filter(entryInPeriod):entriesInPeriod().filter(function(e){return (e.lines||[]).some(function(line){return line.code===code;});})),opening=carry?normalBalanceFor(code,allThroughEnd.filter(function(e){return String(e&&e.date||'').slice(0,10)<bounds.start;})):0,running=opening;
  var rows=entries.slice().sort(function(x,y){return String(x.date||'').localeCompare(String(y.date||''))||String(x.id||'').localeCompare(String(y.id||''));}).map(function(e){var line=(e.lines||[]).find(function(x){return x.code===code;})||{},debit=Number(line.debit)||0,credit=Number(line.credit)||0;running=r2(running+(DEBIT_NORMAL[a.type]?(debit-credit):(credit-debit)));return {date:e.date||'',id:e.id||'',reference:e.ref||'',memo:e.memo||'',debit:debit,credit:credit,balance:running,status:csvEntryStatus(e),reversalOf:e.reversalOf||''};});
  return {account:a,bounds:bounds,carry:carry,opening:opening,rows:rows,closing:running,normalDirection:DEBIT_NORMAL[a.type]?'debit':'credit'};
}
function exportAccountLedgerCsv(code){
  var detail=accountLedgerDetail(code),a=detail.account;if(!a)return alert('This ledger account is unavailable. Refresh Finance Books and try again.');
  var rows=[[detail.bounds.start,a.code,a.name,a.type,'','','Opening balance',0,0,detail.opening,'Opening','']].concat(detail.rows.map(function(row){return [row.date,a.code,a.name,a.type,row.id,row.reference,row.memo,row.debit,row.credit,row.balance,row.status,row.reversalOf];}));
  rows.push([detail.bounds.end,a.code,a.name,a.type,'','','Closing balance',0,0,detail.closing,'Closing','']);
  csvDownload('ledger-'+a.code,['Date','Account code','Account name','Account type','Entry ID','Reference','Memo','Debit','Credit','Running balance (normal side)','Status','Reversal of'],rows,detail.bounds.start+'_to_'+detail.bounds.end);
}
function printAccountLedger(code){
  var detail=accountLedgerDetail(code),a=detail.account;if(!a)return alert('This ledger account is unavailable. Refresh Finance Books and try again.');
  var escapePrint=function(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},money=function(value){return peso(Number(value)||0);},body=detail.rows.map(function(row){return '<tr><td>'+escapePrint(row.date)+'</td><td><b>'+escapePrint(row.reference||row.id)+'</b><br><small>'+escapePrint(row.memo)+'</small></td><td class="num">'+(row.debit?money(row.debit):'')+'</td><td class="num">'+(row.credit?money(row.credit):'')+'</td><td class="num">'+money(row.balance)+'</td></tr>';}).join('')||'<tr><td colspan="5">No entries in this period.</td></tr>',popup=window.open('','_blank','noopener,noreferrer,width=1000,height=720');
  if(!popup)return alert('Allow pop-ups for Accaza Books to print this ledger.');
  popup.document.write('<!doctype html><html><head><title>Accaza ledger '+escapePrint(a.code)+'</title><style>body{font-family:Arial,sans-serif;color:#28211c;margin:28px}h1{font-size:20px;margin:0 0 5px}.meta{color:#6d6257;margin:0 0 18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f5f1eb;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.num{text-align:right}small{color:#6d6257}@media print{body{margin:14mm}button{display:none}}</style></head><body><h1>'+escapePrint(a.code)+' · '+escapePrint(a.name)+'</h1><p class="meta">'+escapePrint(detail.bounds.start)+' to '+escapePrint(detail.bounds.end)+' · opening balance '+money(detail.opening)+' · running balance in '+escapePrint(detail.normalDirection)+' (normal) direction</p><table><thead><tr><th>Date</th><th>Entry</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>'+body+'</tbody></table><p class="meta">Closing balance: '+money(detail.closing)+'</p><script>window.onload=function(){window.print();};<\/script></body></html>');
  popup.document.close();
}
function printFinancePage(title){
  var page=document.getElementById('page'),popup=window.open('','_blank','noopener,noreferrer,width=1100,height=760');if(!page||!popup)return alert('Allow pop-ups for Accaza Books to print this report.');
  popup.document.write('<!doctype html><html><head><title>'+String(title||'Accaza Finance Books').replace(/</g,'&lt;')+'</title><style>body{font-family:Arial,sans-serif;color:#28211c;margin:28px}.page-head h2{font-size:22px;margin:0}.page-head p,.hint,.muted,.tiny{color:#6d6257}.card{margin-top:16px}.tbl-wrap{overflow:visible}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f5f1eb;text-transform:uppercase;font-size:11px;letter-spacing:.04em}.num{text-align:right}.btn,.journal-actions,button{display:none!important}@media print{body{margin:14mm}}</style></head><body><div class="print-title"><h1>'+String(title||'Accaza Finance Books').replace(/</g,'&lt;')+'</h1><p>'+String(periodLabel()).replace(/</g,'&lt;')+'</p></div>'+page.innerHTML+'<script>window.onload=function(){window.print();};<\/script></body></html>');
  popup.document.close();
}
function exportTransactionsCsv(){
  var rows=financeTransactions().map(function(e){var debit=(e.lines||[]).reduce(function(s,l){return s+(Number(l.debit)||0);},0),credit=(e.lines||[]).reduce(function(s,l){return s+(Number(l.credit)||0);},0);return [e.date||'',e.id||'',e.ref||'',e.memo||'',e.sourceType||e.source||'',csvEntryStatus(e),debit,credit,(e.lines||[]).length];});
  csvDownload('transactions',['Date','Entry ID','Reference','Description','Source','Status','Total debit','Total credit','Lines'],rows);
}
function exportProfitLossCsv(){
  var p=plData(),rows=[],push=function(section,x){rows.push([section,x.a.code||'',x.a.name||'',Number(x.bal)||0]);};p.sales.forEach(push.bind(null,'Recognized sales'));rows.push(['Total','','Net sales',p.netSales]);p.cogs.forEach(push.bind(null,'Cost of goods sold'));rows.push(['Total','','Total COGS',p.totalCogs],['Total','','Gross profit',p.gross]);p.otherIncome.forEach(push.bind(null,'Other income'));rows.push(['Total','','Total other income',p.totalOtherIncome]);p.expense.forEach(push.bind(null,'Operating expenses'));rows.push(['Total','','Total expenses',p.totalExp],['Total','','Net income / (loss)',p.net]);csvDownload('profit-and-loss',['Section','Account code','Account','Amount'],rows);
}
function exportTrialBalanceCsv(){
  var totalDr=0,totalCr=0,rows=DB.accounts.map(function(a){var net=accountNet(a.code,entriesInPeriod()),dr=net>0?net:0,cr=net<0?-net:0;totalDr+=dr;totalCr+=cr;return [a.code,a.name,a.type,dr,cr];});rows.push(['','Totals','',r2(totalDr),r2(totalCr)]);csvDownload('trial-balance',['Account code','Account','Type','Debit','Credit'],rows);
}
function exportBalanceSheetCsv(){
  var ents=entriesThroughPeriodEnd(),rows=[],totals={},grp=function(type){return DB.accounts.filter(function(a){return a.type===type;}).map(function(a){var net=accountNet(a.code,ents),bal=DEBIT_NORMAL[type]?net:-net;return {a:a,bal:bal};}).filter(function(x){return Math.abs(x.bal)>.005;});};
  ['Asset','Liability','Equity'].forEach(function(type){var items=grp(type);totals[type]=r2(items.reduce(function(s,x){return s+x.bal;},0));items.forEach(function(x){rows.push([type,x.a.code,x.a.name,x.bal]);});rows.push(['Total','',type==='Asset'?'Total assets':type==='Liability'?'Total liabilities':'Posted equity',totals[type]]);});
  var year=String(periodBounds().end||todayStr()).slice(0,4),start=year+'-01-01',result=function(list){var inc=DB.accounts.filter(function(a){return a.type==='Income';}).reduce(function(s,a){return s-postedAccountNet(a.code,list);},0),cog=DB.accounts.filter(function(a){return a.type==='COGS';}).reduce(function(s,a){return s+postedAccountNet(a.code,list);},0),exp=DB.accounts.filter(function(a){return a.type==='Expense';}).reduce(function(s,a){return s+postedAccountNet(a.code,list);},0);return r2(inc-cog-exp);},retained=result(ents.filter(function(e){return String(e.date||'').slice(0,10)<start;})),current=result(ents.filter(function(e){return String(e.date||'').slice(0,10)>=start;})),equity=r2(totals.Equity+retained+current),le=r2(totals.Liability+equity);rows.push(['Equity','','Retained earnings through '+(Number(year)-1),retained],['Equity','','Current-year net income / (loss)',current],['Total','','Total equity',equity],['Total','','Total liabilities & equity',le]);csvDownload('balance-sheet-as-of-'+periodBounds().end,['Section','Account code','Account','Amount'],rows);
}
function exportCashFlowCsv(){
  var s=cfStatement(),rows=[['Statement',CF_FROM,'','Beginning cash balance',s.totBegin]];
  Array.from(new Set(s.keys)).forEach(function(k){rows.push(['Opening account',CF_FROM,'',cfName(k),s.begin[k]||0]);});
  Object.keys(s.add).sort().forEach(function(k){rows.push(['Receipt','','',k,s.add[k]]);});
  rows.push(['Subtotal','','','Total receipts',s.totAdd]);
  Object.keys(s.ded).sort().forEach(function(k){rows.push(['Deduction','','',k,-Math.abs(s.ded[k])]);});
  rows.push(['Subtotal','','','Total deductions',-s.totDed]);
  s.correctionDetail.forEach(function(x){rows.push(['Balance correction',x.date,x.id,x.type,x.net]);});
  rows.push(['Subtotal','','','Total balance corrections (not cash receipts/payments)',s.corrections],['Statement',CF_TO,'','Calculated ending cash',r2(s.totBegin+s.totAdd-s.totDed+s.corrections)],['Statement',CF_TO,'','Ending cash balance',s.totEnd]);
  Array.from(new Set(s.keys)).forEach(function(k){rows.push(['Closing account',CF_TO,'',cfName(k),s.ending[k]||0]);});
  s.detail.forEach(function(x){rows.push(['Cash activity',x.date,x.id,x.type,x.net]);});
  csvDownload('cash-flow',['Section','Date','Movement ID','Description','Amount'],rows,CF_FROM+'_to_'+CF_TO);
}
function exportFinanceCsv(kind){if(window.__booksLiveLoading)return alert('Finance is still loading. Wait for the ledger to finish refreshing before downloading.');var exporters={insights:function(){if(window.AccazaExportBusinessMetrics)window.AccazaExportBusinessMetrics();},transactions:exportTransactionsCsv,journal:exportJournalCsv,ledger:exportLedgerCsv,pl:exportProfitLossCsv,bs:exportBalanceSheetCsv,cashflow:exportCashFlowCsv,tb:exportTrialBalanceCsv},run=exporters[kind];if(!run)return alert('CSV export is not available for this screen.');run();}
function csvButton(kind){return '<button class="btn export-btn" onclick="App.exportCsv(\''+kind+'\')" title="Download the selected period as CSV">↓ Download CSV</button>';}
