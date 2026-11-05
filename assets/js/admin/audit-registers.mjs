import{callables}from"./firebase-client.mjs";
import{escHtml}from"./shared-ui.mjs";

// Read-only audit registers (5 Nov 2026), loaded only when opened: the menu price history (audit R-09)
// and the cancelled invoice numbers (audit C-17). Both are kept by the server from 5 Nov 2026 onwards.
const REASONS={online_order_not_saved:'Website order was not saved',pos_sale_not_saved:'POS sale was not saved'};
function when(ms){return ms?new Date(ms).toLocaleString('en-PH',{timeZone:'Asia/Manila',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
function peso(n){return '₱'+(Number(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function price(v){return v==null||v===''?'—':typeof v==='number'?peso(v):escHtml(String(v));}
const TH='style="text-align:left;padding:0.35rem 0.5rem;border-bottom:1px solid var(--cd);font-size:0.72rem;color:var(--tl);"',TD='style="padding:0.35rem 0.5rem;border-bottom:1px solid #f0e6d8;font-size:0.78rem;vertical-align:top;"';
function table(head,rows){return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><tr>'+head.map(function(h){return '<th '+TH+'>'+h+'</th>';}).join('')+'</tr>'+rows.join('')+'</table></div>';}
function change(r){
  if(r.removed)return 'Item deleted (was '+price(r.from)+')';
  if(r.from==null)return 'Set to '+price(r.to);
  if(r.to==null)return 'Cleared (was '+price(r.from)+')';
  var diff=typeof r.from==='number'&&typeof r.to==='number'?r.to-r.from:null;
  return price(r.from)+' → '+price(r.to)+(diff?' <span style="color:'+(diff>0?'#9a5b00':'#2d6a4f')+';">('+(diff>0?'+':'−')+peso(Math.abs(diff))+')</span>':'');
}
function priceHistory(root,d){
  var rows=d.rows||[];
  if(!rows.length){root.innerHTML='<p class="az-note">No price changes recorded yet. Changes are recorded from 5 Nov 2026; earlier edits were not kept.</p>';return;}
  root.innerHTML='<input type="search" data-price-filter placeholder="Filter by item" style="margin:0.5rem 0;padding:0.35rem 0.55rem;border:1px solid var(--cd);border-radius:6px;font-size:0.8rem;width:100%;max-width:260px;"/><div data-price-rows></div>'+(d.truncated?'<p class="az-note" style="color:#9a5b00;">Showing the newest '+d.limit+' of '+d.total+' changes.</p>':'');
  var out=root.querySelector('[data-price-rows]'),input=root.querySelector('[data-price-filter]');
  function paint(){var q=String(input.value||'').trim().toLowerCase();out.innerHTML=table(['When (Manila)','Item','Price','Change','Saved by'],rows.filter(function(r){return !q||String(r.name||'').toLowerCase().indexOf(q)>-1;}).map(function(r){return '<tr><td '+TD+'>'+when(r.at)+'</td><td '+TD+'>'+escHtml(r.name||r.itemId)+'</td><td '+TD+'>'+escHtml(r.fieldLabel||r.field)+'</td><td '+TD+'>'+change(r)+'</td><td '+TD+'>'+escHtml(r.byName||(r.byUid?'Account '+String(r.byUid).slice(0,6):'System'))+'</td></tr>';}));}
  input.oninput=paint;paint();
}
function csvCell(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
function cancelledInvoices(root,d){
  var rows=d.rows||[];
  if(!rows.length){root.innerHTML='<p class="az-note">No cancelled invoice numbers. Cancelled numbers are recorded from 5 Nov 2026.</p>';return;}
  root.innerHTML=table(['Invoice no.','When (Manila)','Amount','Why it was cancelled','Order ref.','Running grand total'],rows.map(function(r){return '<tr><td '+TD+'><b>'+escHtml(r.invoiceNumber)+'</b></td><td '+TD+'>'+when(r.at)+'</td><td '+TD+'>'+peso(r.amount)+'</td><td '+TD+'>'+escHtml(REASONS[r.reason]||r.reason||'—')+'</td><td '+TD+'>'+escHtml(r.sourceId||'—')+'</td><td '+TD+'>'+peso(r.cumulativeGrandTotal)+(r.includedInGrandTotal?'':' (excluded)')+'</td></tr>';}))
    +(d.truncated?'<p class="az-note" style="color:#9a5b00;">Showing the newest '+d.limit+' cancelled numbers.</p>':'')
    +'<button class="pz-btn sec" data-cancelled-csv style="margin-top:0.6rem;">Download CSV</button>';
  root.querySelector('[data-cancelled-csv]').onclick=function(){
    var csv=[['Invoice no.','Sequence','When (Manila)','Amount','Reason','Order ref.','Running grand total','Counted in grand total']].concat(rows.map(function(r){return [r.invoiceNumber,r.invoiceSeq,when(r.at),(Number(r.amount)||0).toFixed(2),REASONS[r.reason]||r.reason,r.sourceId,(Number(r.cumulativeGrandTotal)||0).toFixed(2),r.includedInGrandTotal?'Yes':'No'];})).map(function(row){return row.map(csvCell).join(',');}).join('\n');
    var url=URL.createObjectURL(new Blob([csv],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='accaza-cancelled-invoices.csv';a.click();URL.revokeObjectURL(url);
  };
}
export async function showAuditRegister(kind,root){
  if(!root)return;
  root.innerHTML='<p class="az-note">Loading…</p>';
  try{
    var res=await callables.getAuditRegisters({register:kind}),d=(res&&res.data)||{};
    if(kind==='price_history')priceHistory(root,d);else cancelledInvoices(root,d);
  }catch(e){root.innerHTML='<p class="az-note" style="color:#b42318;">Could not load this list: '+escHtml((e&&e.message)||e)+'</p>';}
}
