
function renderTaxCompliance(){
  var root=document.getElementById('taxComplianceRoot');if(!root)return;
  root.innerHTML='<div id="taxCardBox"></div><div id="taxReturnsBox"></div>';
  wireTaxCard();
  wireTaxReturns();
}

/* ══════════ BIR TAX CARD (VAT / Percentage tax) ══════════ */
/* Labels mirror the server-side canonical checklist in src/functions/20c-tax-settings.js —
   activation is blocked client-side with the same message, and the server re-checks every id.
   The registered identity (TIN, branch code, business structure) is typed once in the
   Company Information tab; the server stamps it into taxSettings at activation, so receipts
   and online orders keep printing exactly as they do today. */
var TAX_REQ_META={
  cas_1905_filed:{label:'BIR Form 1905 filed to register this POS system with your RDO',help:'RR 7-2024: the POS itself must be registered before Accaza receipts can serve as official invoices.'},
  pos_reports_audit:{label:'This POS can produce sales and audit reports on demand',help:'BIR officers may require daily and periodic sales reports from the register at any time.'},
  pos_data_retention:{label:'Sales records and books are kept for at least 10 years',help:'BIR requires accounting records, including POS data, to be retained for 10 years.'},
  cor_2303:{label:'Certificate of Registration (BIR Form 2303) issued and displayed',help:'Your COR must show the tax type (VAT or Non-VAT) and be posted at the place of business.'},
  tin_branch:{label:'TIN and branch code obtained from BIR',help:'The 9-digit TIN (and 5-digit branch code, 00000 for head office) printed on every receipt.'},
  books_registered:{label:'Books of accounts registered with BIR',help:'Manual books must be stamped by the RDO; computerized books need BIR-accredited accounting.'},
  vat_invoices:{label:'VAT official invoices / receipts printed under BIR authority',help:'VAT-registered businesses must issue BIR-registered VAT invoices and receipts.'},
  nonvat_invoices:{label:'NON-VAT official receipts printed under BIR authority',help:'Non-VAT businesses must still issue BIR-registered receipts marked NON-VAT.'},
  sequential_numbering:{label:'Receipt numbering is sequential with no gaps',help:'BIR-registered invoices run in an unbroken series; skipped numbers are flagged in audits.'},
  form_2550q:{label:'Ready to file BIR Form 2550Q (quarterly VAT return)',help:'Quarterly VAT return, due the 25th day after each quarter ends.'},
  form_2551q:{label:'Ready to file BIR Form 2551Q (quarterly percentage tax)',help:'Quarterly percentage tax return, due the 25th day after each quarter ends.'}
};
var TAX_REQ_ORDER={
  vat:['cas_1905_filed','pos_reports_audit','pos_data_retention','cor_2303','tin_branch','books_registered','vat_invoices','sequential_numbering','form_2550q'],
  percentage:['cas_1905_filed','pos_reports_audit','pos_data_retention','cor_2303','tin_branch','books_registered','nonvat_invoices','sequential_numbering','form_2551q']
};
var TAX_INFO={
  vat:{title:'Value Added Tax (VAT)',rateLabel:'VAT rate (%)',defaultRate:12,desc:'Each receipt splits out the VAT portion, Finance Books credits net sales and books output VAT to account 2210, and the Senior/PWD 20% is computed on the VAT-exempt price. Choose below whether your prices already contain the VAT or VAT is added on top.'},
  percentage:{title:'Percentage Tax (Non-VAT)',rateLabel:'Percentage tax rate (%)',defaultRate:3,desc:'A flat percentage of gross sales booked to liability 2220 / expense 6086, and the Senior/PWD 20% stays on the full price. Choose below whether the tax sits inside your prices or is added on top.'}
};
var TAX_STRUCTURES={sole:'Sole Proprietorship',opc:'One Person Corporation',corporation:'Corporation'};
function wireTaxCard(){
  var box=document.getElementById('taxCardBox');if(!box)return;
  var canEdit=['owner','superadmin'].indexOf(String((window.__accazaAuthz||{}).role))>=0;
  var state={mode:'none',inclusive:null,ticks:{vat:{},percentage:{}},dateEdited:false};
  function draw(){
    var live=window.__taxSettings||{},mode=state.mode,info=TAX_INFO[mode];
    var liveMode=live.mode==='vat'||live.mode==='percentage'?live.mode:'none';
    var h='<div class="az-sec">BIR Tax &mdash; VAT / Percentage tax</div><div class="pz-card" style="margin-bottom:1rem;">';
    h+='<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">'
      +'<span style="display:inline-block;padding:0.15rem 0.6rem;border-radius:99px;font-size:0.75rem;font-weight:700;'
      +(liveMode==='none'?'background:rgba(0,0,0,.08);color:var(--tm);':'background:rgba(28,107,84,.12);color:#1C6B54;')+'">'
      +(liveMode==='none'?'NO TAX ACTIVE':(liveMode==='vat'?'VAT ACTIVE':'PERCENTAGE TAX ACTIVE'))+'</span>';
    if(liveMode!=='none'){var lm=TAX_INFO[liveMode];h+='<span style="font-size:0.8rem;color:var(--tm);">'+esc(lm.title)+' at '+(liveMode==='vat'?(live.vatRate||12):(live.percentageRate||3))+'% '+(live.inclusive===false?'(tax added on top)':'(tax inside prices)')+' &middot; effective '+esc(new Date(Number(live.effectiveAt)||Date.now()).toLocaleDateString('en-PH'))+(live.tin?' &middot; TIN '+esc(live.tin):'')+'</span>';}
    else h+='<span style="font-size:0.8rem;color:var(--tm);">Receipts print without tax lines. Pick a category below when you are ready.</span>';
    h+='</div>';
    if(!canEdit){h+='<p class="az-note" style="margin:0.7rem 0 0;">Only the owner account can change tax settings.</p></div>';box.innerHTML=h;return;}
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.8rem;">';
    ['vat','percentage'].forEach(function(m){
      var mi=TAX_INFO[m],sel=(mode===m);
      h+='<button type="button" data-taxmode="'+m+'" style="text-align:left;padding:0.75rem 0.9rem;border-radius:10px;cursor:pointer;border:'+(sel?'2px solid #1C6B54;box-shadow:0 2px 8px rgba(28,107,84,.18);':'2px solid var(--cd);')+'background:'+(sel?'rgba(28,107,84,.06)':'transparent')+';font-family:inherit;">'
        +'<div style="font-weight:700;color:var(--bd);">'+esc(mi.title)+'</div>'
        +'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.2rem;">'+(m==='vat'?'12% default, editable. Splits VAT out of your prices.':'3% default, editable. Carved from gross sales.')+(liveMode===m?' &middot; CURRENTLY ON':'')+'</div></button>';
    });
    h+='</div>';
    if(mode!=='none'){
      var rateVal=(live[mode==='vat'?'vatRate':'percentageRate']!=null?live[mode==='vat'?'vatRate':'percentageRate']:info.defaultRate);
      var done=TAX_REQ_ORDER[mode].filter(function(id){return !!state.ticks[mode][id];}).length;
      h+='<div style="border-top:1px solid var(--cd);margin-top:0.9rem;padding-top:0.8rem;">'
        +'<div style="font-weight:700;font-size:0.9rem;color:var(--bd);">BIR requirements ('+done+'/'+TAX_REQ_ORDER[mode].length+' confirmed)</div>'
        +'<p class="az-note" style="margin:0.3rem 0 0.2rem;">Tick each item only when it is truly done. Tax cannot be activated until every requirement is confirmed.</p>';
      TAX_REQ_ORDER[mode].forEach(function(id){
        var meta=TAX_REQ_META[id];
        h+='<label style="display:flex;gap:0.55rem;align-items:flex-start;cursor:pointer;font-size:0.85rem;margin-top:0.5rem;"><input type="checkbox" data-taxreq="'+id+'"'+(state.ticks[mode][id]?' checked':'')+' style="margin-top:0.2rem;"/>'
          +'<span><b>'+esc(meta.label)+'</b><br><span style="font-size:0.75rem;color:var(--tl);">'+esc(meta.help)+'</span></span></label>';
      });
      var inc=state.inclusive!=null?state.inclusive:(live.inclusive!==false);
      function taxPill(v,sel,title,sub){return '<button type="button" data-taxinc="'+v+'" style="text-align:left;padding:0.6rem 0.9rem;border-radius:10px;cursor:pointer;border:'+(sel?'2px solid #1C6B54;box-shadow:0 2px 8px rgba(28,107,84,.18);':'2px solid var(--cd);')+'background:'+(sel?'rgba(28,107,84,.06)':'transparent')+';font-family:inherit;"><div style="font-weight:700;color:var(--bd);">'+title+'</div><div style="font-size:0.75rem;color:var(--tl);margin-top:0.2rem;">'+sub+'</div></button>';}
      h+='<div style="margin-top:0.9rem;"><span class="pz-lbl">Price display &mdash; is the tax inside your prices or added on top?</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-top:0.35rem;">'
        +taxPill('inclusive',inc,'Tax inside prices (inclusive)','Your listed prices already contain the tax. Customers pay exactly the shelf price.')
        +taxPill('exclusive',!inc,'Tax added on top (exclusive)','Listed prices exclude the tax. POS and the online ordering site add it on top at checkout, so customers pay more than the shelf price.')
        +'</div></div>';
      h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;align-items:end;margin-top:0.9rem;">'
        +'<div><span class="pz-lbl">'+esc(info.rateLabel)+'</span><input class="pz-in" id="taxRate" type="number" step="0.01" min="0.01" max="100" value="'+rateVal+'"/></div>'
        +'<div><span class="pz-lbl">Effective date</span><input class="pz-in" id="taxEffective" type="date" min="'+window.AccazaDate.key()+'" value="'+(liveMode==='none'?window.AccazaDate.key():window.AccazaDate.key(live.effectiveAt))+'"/></div>'
        +'<div style="font-size:0.75rem;color:var(--tl);padding-bottom:0.35rem;">Sales completed before this date keep their original treatment.</div></div>';
      h+='<div style="background:rgba(28,107,84,.06);border:1px solid rgba(28,107,84,.25);border-radius:10px;padding:0.75rem 0.9rem;margin-top:0.9rem;font-size:0.8rem;color:var(--tm);">'
        +'<b style="color:var(--bd);">'+esc(info.title)+'</b> &mdash; '+esc(info.desc)
        +'<br><b style="color:var(--bd);">When to file:</b> BIR Form '+(mode==='vat'?'2550Q':'2551Q')+' quarterly &mdash; due 25 April, 25 July, 25 October, 25 January through eBIRForms or eFPS.'
        +'<br><b style="color:var(--bd);">Penalties:</b> late filing means a 25% surcharge on the tax due, 12% annual interest, plus compromise penalties.'
        +'<br><b style="color:var(--bd);">Forms and guides:</b> <a href="https://www.bir.gov.ph" target="_blank" rel="noopener">www.bir.gov.ph</a></div>';
    }
    var liveStruct=(live.structure&&TAX_STRUCTURES[live.structure])?TAX_STRUCTURES[live.structure]:'';
    h+='<div style="margin-top:0.9rem;border-top:1px solid var(--cd);padding-top:0.8rem;font-size:0.8rem;color:var(--tm);">'
      +'<b style="color:var(--bd);">Receipt identity:</b> '
      +(live.tin?'TIN '+esc(live.tin)+(live.branchCode?' &middot; branch '+esc(live.branchCode):''):'TIN not set yet')
      +(liveStruct?' &middot; '+esc(liveStruct):'')
      +' &mdash; typed once in <b style="color:var(--bd);">Company Information</b> and stamped onto every receipt automatically when a tax category is activated.</div>';
    h+='<div style="display:flex;gap:0.6rem;align-items:center;margin-top:0.9rem;">'
      +(mode!=='none'?'<button class="pz-btn ok" id="taxSave" style="padding:0.55rem 1.3rem;">'+(liveMode===mode?'Save changes':'Activate '+esc(info.title))+'</button>':'')
      +(liveMode!=='none'?'<button class="pz-btn sec" id="taxOff" style="padding:0.55rem 1rem;">Turn tax OFF</button>':'')
      +'<span id="taxStatus" style="font-size:0.8rem;color:var(--tl);"></span></div></div>';
    box.innerHTML=h;
    box.querySelectorAll('[data-taxmode]').forEach(function(b){b.onclick=function(){state.mode=(state.mode===b.getAttribute('data-taxmode'))?'none':b.getAttribute('data-taxmode');draw();};});
    box.querySelectorAll('[data-taxreq]').forEach(function(c){c.onchange=function(){state.ticks[state.mode][c.getAttribute('data-taxreq')]=c.checked;if(!c.checked)delete state.ticks[state.mode][c.getAttribute('data-taxreq')];draw();};});
    box.querySelectorAll('[data-taxinc]').forEach(function(b){b.onclick=function(){state.inclusive=(b.getAttribute('data-taxinc')==='inclusive');draw();};});
    var eff=document.getElementById('taxEffective');if(eff)eff.onchange=function(){state.dateEdited=true;};
    var off=document.getElementById('taxOff');if(off)off.onclick=function(){
      if(!confirm('Turn OFF tax? New sales will print without tax lines and post without tax. Completed sales keep their original treatment.\n\nAfter switching off, file BIR Form 1905 with your RDO to update your registration — otherwise BIR records still show this POS as issuing tax receipts.'))return;
      var a=A();if(!a||!a.callables||!a.callables.setTaxSettings){alert('Tax service unavailable. Refresh and try again.');return;}
      a.callables.setTaxSettings({mode:'none'}).then(function(){if(window.accazaToast)window.accazaToast('Tax turned off. New sales print without tax.','ok');}).catch(function(e){alert('Could not turn tax off: '+((e&&e.message)||e));});
    };
    var save=document.getElementById('taxSave');if(save)save.onclick=function(){saveTaxSettings(state);};
  }
  var a=A();
  if(a&&a.get){a.get(a.ref(a.db,'taxSettings')).then(function(s){if(s.val())window.__taxSettings=s.val();draw();}).catch(function(){});}
  draw();
}
function saveTaxSettings(state){
  var live=window.__taxSettings||{},mode=state.mode;
  if(mode!=='vat'&&mode!=='percentage')return;
  var missing=TAX_REQ_ORDER[mode].filter(function(id){return !state.ticks[mode][id];});
  if(missing.length){alert('Complete first the BIR requirement before tax is activated.\n\nStill to confirm:\n- '+missing.map(function(id){return TAX_REQ_META[id].label;}).join('\n- '));return;}
  var inc=state.inclusive!=null?state.inclusive:((window.__taxSettings||{}).inclusive!==false);
  if(inc===false&&(window.__taxSettings||{}).inclusive!==false){
    if(!confirm('Tax-EXCLUSIVE pricing: POS and the online ordering site will ADD the tax on top of your listed prices, so customers pay more than the shelf price.\n\nContinue with tax added on top?'))return;
  }
  var payload={mode:mode,inclusive:inc,requirements:state.ticks};
  var rateEl=document.getElementById('taxRate');
  if(rateEl&&rateEl.value!==''){var rate=Number(rateEl.value);if(!(rate>0&&rate<=100)){alert('Enter a rate between 0.01 and 100.');return;}payload[mode==='vat'?'vatRate':'percentageRate']=rate;}
  var effEl=document.getElementById('taxEffective');
  if(effEl&&effEl.value&&state.dateEdited){var when=Date.parse(effEl.value+'T00:00:00+08:00');if(!Number.isFinite(when)||when<Date.now()-86400000){alert('Effective date must be today or later.');return;}payload.effectiveAt=when;}
  var btn=document.getElementById('taxSave'),status=document.getElementById('taxStatus');
  if(btn)btn.disabled=true;if(status)status.textContent='Saving…';
  var a=A();
  if(!a||!a.callables||!a.callables.setTaxSettings){if(btn)btn.disabled=false;alert('Tax service unavailable. Refresh and try again.');return;}
  a.callables.setTaxSettings(payload).then(function(resp){
    var tax=(resp&&resp.data&&resp.data.tax)||null;if(tax)window.__taxSettings=tax;
    if(window.accazaToast)window.accazaToast('Tax settings saved.','ok');
    wireTaxCard();
  }).catch(function(e){
    if(btn)btn.disabled=false;if(status)status.textContent='';
    alert(((e&&e.message)||e)+'\n\nTax settings were NOT changed.');
  });
}

/* ══════════ BIR QUARTERLY RETURNS (2550Q / 2551Q / annual 1701-1702 export) ══════════ */
/* One-click preparation from the Tax Compliance tab. Figures come from reconciled
   Financial Close summaries and purchase input VAT through the prepareQuarterlyTaxReturn
   Cloud Function — no raw order data is re-read here. /taxReturns history is fetched
   once when the tab opens (single read, no listener). */
var QUARTER_DUE={1:'25 April',2:'25 July',3:'25 October',4:'25 January'};
var QUARTER_LABEL={1:'Q1 (Jan - Mar)',2:'Q2 (Apr - Jun)',3:'Q3 (Jul - Sep)',4:'Q4 (Oct - Dec)'};
var QUARTER_END={1:'-03-31',2:'-06-30',3:'-09-30',4:'-12-31'};
function wireTaxReturns(){
  var box=document.getElementById('taxReturnsBox');if(!box)return;
  var todayKey=window.AccazaDate.key(),thisYear=Number(todayKey.slice(0,4));
  var lastQ={year:thisYear-1,quarter:4};
  for(var q=4;q>=1;q--){if(todayKey>String(thisYear)+QUARTER_END[q]){lastQ={year:thisYear,quarter:q};break;}}
  var st={year:lastQ.year,quarter:lastQ.quarter,record:null,annualRecord:null,history:{},busy:false};
  function quarterEnded(year,quarter){return todayKey>String(year)+QUARTER_END[quarter];}
  function dueLabel(year,quarter){return QUARTER_DUE[quarter]+' '+(Number(quarter)===4?Number(year)+1:year);}
  function pullFromHistory(){
    var q=(st.history['q'+st.year+'Q'+st.quarter]||{}).current||null;
    st.record=(q&&q.mode==='quarterly')?q:null;
    var a=(st.history['annual_'+st.year]||{}).current||null;
    st.annualRecord=(a&&a.mode==='annual')?a:null;
  }
  function refreshHistory(){var a=A();if(a&&a.get)a.get(a.ref(a.db,'taxReturns')).then(function(s){st.history=s.val()||{};draw();}).catch(function(){});}
  function prepareReturn(mode){
    var a=A();if(!a||!a.callables||!a.callables.prepareQuarterlyTaxReturn){alert('Tax return service unavailable. Refresh and try again.');return;}
    if(mode==='quarterly'&&!quarterEnded(st.year,st.quarter)){alert('That quarter has not ended yet. Prepare the return after the quarter closes.');return;}
    st.busy=true;draw();
    a.callables.prepareQuarterlyTaxReturn(mode==='annual'?{mode:'annual',year:st.year}:{mode:'quarterly',year:st.year,quarter:st.quarter,requestId:'ui-'+Date.now()}).then(function(resp){
      st.busy=false;var r=(resp&&resp.data)||null;
      if(mode==='annual')st.annualRecord=r;else st.record=r;
      if(window.accazaToast)window.accazaToast(r&&r.duplicate?'Return already prepared — showing the saved copy.':'Return prepared.','ok');
      refreshHistory();draw();
    }).catch(function(e){
      st.busy=false;draw();
      alert('Could not prepare the return:\n\n'+((e&&e.message)||e));
    });
  }
  function trQuarterlyHtml(r){
    var f=r.figures||{},p=r.pnl||{},vat=r.returnType==='2550Q';
    function row(label,val,strong){return '<tr><td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);color:var(--tm);">'+label+'</td><td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);text-align:right;font-weight:'+(strong?'700':'500')+';color:var(--bd);">'+val+'</td></tr>';}
    var h='<div style="border:1px solid rgba(28,107,84,.35);background:rgba(28,107,84,.05);border-radius:10px;padding:0.8rem 0.9rem;margin-top:0.9rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;"><b style="color:var(--bd);">BIR Form '+esc(r.returnType)+' &mdash; '+esc(QUARTER_LABEL[Number(r.quarter)]||'')+' '+r.year+'</b>'
      +'<span style="padding:0.15rem 0.6rem;border-radius:99px;font-size:0.75rem;font-weight:700;background:rgba(28,107,84,.12);color:#1C6B54;">'+esc(r.status||'READY')+(r.duplicate?' &middot; SAVED COPY':'')+'</span></div>'
      +'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.15rem;">Period '+esc(r.periodStart)+' to '+esc(r.periodEnd)+' &middot; filing due '+esc(dueLabel(r.year,Number(r.quarter)))+' through eBIRForms or eFPS</div>'
      +'<table style="width:100%;border-collapse:collapse;margin-top:0.6rem;font-size:0.85rem;">'
      +row('Gross sales (including tax)',peso(f.grossSales));
    if(vat){
      h+=row('VAT-exempt sales &mdash; senior / PWD (RA 9994 / 10754)',peso(f.vatExemptSales));
      h+=row('Output VAT &mdash; account 2210',peso(f.outputVat));
      h+=row('Less: input VAT from purchases &mdash; account 1250',peso(f.inputVat));
      h+=row('<b style="color:var(--bd);">Amount due with BIR Form 2550Q</b>','<span style="font-size:1rem;">'+peso(r.amountDue)+'</span>',true);
    }else{
      h+=row('<b style="color:var(--bd);">Amount due with BIR Form 2551Q (percentage tax)</b>','<span style="font-size:1rem;">'+peso(r.amountDue)+'</span>',true);
    }
    h+='</table>'
      +'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.5rem;">Gross-margin P&L for the quarter: net sales '+peso(p.netSales)+' &middot; cost of sales '+peso(p.expectedCogs)+' &middot; discounts '+peso(p.discounts)+' &middot; refunds '+peso(p.refunds)
      +'<br>From '+(f.closeCount||0)+' reconciled Financial Close'+(f.closeCount===1?'':'s')+(r.revision?' &middot; revision '+r.revision:'')+' &middot; prepared '+esc(new Date(Number(r.preparedAt)||Date.now()).toLocaleString('en-PH'))+'.</div>'
      +'<button class="pz-btn sec" id="trDownload" style="padding:0.45rem 1rem;margin-top:0.6rem;">Download CSV</button></div>';
    return h;
  }
  function trAnnualHtml(r){
    var an=r.annual||{},qs=an.quarters||[],t=an.totals||{},tp=t.pnl||{};
    function cell(val,bold){return '<td style="padding:0.3rem 0;border-top:1px solid var(--cd);text-align:right;'+(bold?'font-weight:700;color:var(--bd);':'')+'">'+val+'</td>';}
    var h='<div style="border:1px solid rgba(28,107,84,.35);background:rgba(28,107,84,.05);border-radius:10px;padding:0.8rem 0.9rem;margin-top:0.9rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;"><b style="color:var(--bd);">Annual export &mdash; BIR Form '+esc(an.form||'1701')+' &middot; '+r.year+'</b>'
      +'<span style="padding:0.15rem 0.6rem;border-radius:99px;font-size:0.75rem;font-weight:700;background:rgba(28,107,84,.12);color:#1C6B54;">'+esc(r.status||'READY')+(r.duplicate?' &middot; SAVED COPY':'')+'</span></div>'
      +'<table style="width:100%;border-collapse:collapse;margin-top:0.6rem;font-size:0.78rem;">'
      +'<tr style="color:var(--tl);"><th style="text-align:left;padding:0.25rem 0;">Quarter</th><th style="text-align:right;">Gross sales</th><th style="text-align:right;">Exempt</th><th style="text-align:right;">Output VAT</th><th style="text-align:right;">% Tax</th><th style="text-align:right;">Input VAT</th><th style="text-align:right;">Net sales</th><th style="text-align:right;">Cost of sales</th><th style="text-align:right;padding:0.25rem 0;">Reconciled</th></tr>';
    qs.forEach(function(q){
      var f=q.figures||{},p=q.pnl||{},ok=q.gate&&q.gate.ok;
      h+='<tr><td style="padding:0.3rem 0;border-top:1px solid var(--cd);color:var(--bd);font-weight:600;">Q'+q.quarter+'</td>'
        +cell(peso(f.grossSales))+cell(peso(f.vatExemptSales))+cell(peso(f.outputVat))+cell(peso(f.percentageTax))+cell(peso(f.inputVat))+cell(peso(p.netSales))+cell(peso(p.expectedCogs))
        +'<td style="padding:0.3rem 0;border-top:1px solid var(--cd);text-align:right;color:'+(ok?'#1C6B54':'#a3542a')+';font-weight:700;">'+(ok?'YES':'NO')+'</td></tr>';
    });
    h+='<tr><td style="padding:0.35rem 0;border-top:2px solid var(--bd);color:var(--bd);font-weight:700;">TOTAL</td>'
      +cell(peso(t.grossSales),true)+cell(peso(t.vatExemptSales),true)+cell(peso(t.outputVat),true)+cell(peso(t.percentageTax),true)+cell(peso(t.inputVat),true)+cell(peso(tp.netSales),true)+cell(peso(tp.expectedCogs),true)
      +'<td></td></tr></table>'
      +'<div style="font-size:0.75rem;color:var(--tl);margin-top:0.5rem;">VAT payable for the year (output less input): <b>'+peso(t.vatPayable)+'</b>'+(r.revision?' &middot; revision '+r.revision:'')+' &middot; prepared '+esc(new Date(Number(r.preparedAt)||Date.now()).toLocaleString('en-PH'))+'.</div>'
      +'<button class="pz-btn sec" id="trDownloadAnnual" style="padding:0.45rem 1rem;margin-top:0.6rem;">Download CSV</button></div>';
    return h;
  }
  function trHistoryHtml(){
    var keys=Object.keys(st.history).filter(function(k){return st.history[k]&&st.history[k].current&&st.history[k].current.returnType;}).sort().reverse();
    if(!keys.length)return '<p class="az-note" style="margin:0.3rem 0 0;">Nothing prepared yet. Prepare a quarter above once its Financial Closes are reconciled.</p>';
    var h='<table style="width:100%;border-collapse:collapse;margin-top:0.4rem;font-size:0.8rem;">';
    keys.forEach(function(k){
      var cur=st.history[k].current;
      var label=cur.mode==='annual'?('Form '+((cur.annual&&cur.annual.form)||'1701')+' annual export'):('Form '+cur.returnType+' '+QUARTER_LABEL[Number(cur.quarter)]);
      var period=cur.mode==='annual'?String(cur.year):(esc(cur.periodStart)+' to '+esc(cur.periodEnd));
      h+='<tr><td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);color:var(--bd);font-weight:600;">'+label+' '+cur.year+'</td>'
        +'<td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);color:var(--tm);">'+period+'</td>'
        +'<td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);text-align:right;font-weight:700;color:var(--bd);">'+peso(cur.amountDue)+'</td>'
        +'<td style="padding:0.3rem 0;border-bottom:1px solid var(--cd);text-align:right;color:var(--tl);">'+esc(new Date(Number(cur.preparedAt)||0).toLocaleDateString('en-PH'))+'</td></tr>';
    });
    return h+'</table>';
  }
  function trCsvCell(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}
  function trDownload(filename,rows){
    var csv=rows.map(function(r){return r.map(trCsvCell).join(',');}).join('\r\n');
    var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    var link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;
    document.body.appendChild(link);link.click();document.body.removeChild(link);
    setTimeout(function(){URL.revokeObjectURL(link.href);},1500);
  }
  function trQuarterlyCsv(r){
    var f=r.figures||{},p=r.pnl||{},c=r.company||{},vat=r.returnType==='2550Q';
    var rows=[['Accaza','BIR Form '+r.returnType+' preparation'],
      ['Registered name',c.registeredName||''],['TIN',c.tin||''],['Branch code',c.branchCode||''],['Business structure',TAX_STRUCTURES[c.structure]||c.structure||''],
      ['Period',r.periodStart+' to '+r.periodEnd],['Filing due',dueLabel(r.year,Number(r.quarter))],[],
      ['Item','Amount'],['Gross sales (including tax)',f.grossSales]];
    if(vat)rows.push(['VAT-exempt sales (senior/PWD)',f.vatExemptSales],['Output VAT - account 2210',f.outputVat],['Input VAT from purchases - account 1250',f.inputVat],['VAT payable (output less input)',f.vatPayable]);
    else rows.push(['Percentage tax - account 2220',f.percentageTax]);
    rows.push(['Amount due',r.amountDue],[],
      ['Net sales',p.netSales],['Cost of sales (expected COGS)',p.expectedCogs],['Discounts',p.discounts],['Refunds',p.refunds],
      ['Financial closes counted',f.closeCount],['Prepared at',new Date(Number(r.preparedAt)||Date.now()).toISOString()],['Revision',r.revision||1]);
    return rows;
  }
  function trAnnualCsv(r){
    var an=r.annual||{},c=r.company||{},t=an.totals||{},tp=t.pnl||{};
    var rows=[['Accaza','Annual accountant export - BIR Form '+(an.form||'1701')+' '+r.year],
      ['Registered name',c.registeredName||''],['TIN',c.tin||''],['Branch code',c.branchCode||''],[],
      ['Quarter','Period','Reconciled','Gross sales','VAT-exempt sales','Output VAT','Percentage tax','Input VAT','VAT payable','Net sales','Cost of sales']];
    (an.quarters||[]).forEach(function(q){
      var f=q.figures||{},p=q.pnl||{};
      rows.push(['Q'+q.quarter,q.periodStart+' to '+q.periodEnd,(q.gate&&q.gate.ok)?'YES':'NO',f.grossSales,f.vatExemptSales,f.outputVat,f.percentageTax,f.inputVat,f.vatPayable,p.netSales,p.expectedCogs]);
    });
    rows.push(['TOTAL '+r.year,'','','',t.grossSales,t.vatExemptSales,t.outputVat,t.percentageTax,t.inputVat,t.vatPayable,tp.netSales,tp.expectedCogs]);
    return rows;
  }
  function draw(){
    pullFromHistory();
    var live=window.__taxSettings||{},liveMode=(live.mode==='vat'||live.mode==='percentage')?live.mode:'none';
    var form=liveMode==='percentage'?'2551Q':'2550Q';
    var h='<div class="az-sec">BIR quarterly returns &mdash; one-click preparation</div><div class="pz-card" style="margin-bottom:1rem;">'
      +'<p class="az-note" style="margin:0;">Figures come from your reconciled Financial Close summaries and purchase input VAT. Every preparation is saved with a revision and an audit trail; preparing the same quarter again with unchanged figures simply returns the saved return.</p>';
    if(liveMode==='none')h+='<p class="az-note" style="margin:0.6rem 0 0;color:#a3542a;">Activate VAT or percentage tax above before preparing a quarterly return. The annual accountant export below works even without an active tax category.</p>';
    h+='<div style="display:flex;gap:0.6rem;align-items:end;flex-wrap:wrap;margin-top:0.8rem;">'
      +'<div><span class="pz-lbl">Year</span><select class="pz-in" id="trYear">';
    for(var y=thisYear;y>=2020;y--)h+='<option value="'+y+'"'+(y===st.year?' selected':'')+'>'+y+'</option>';
    h+='</select></div><div><span class="pz-lbl">Quarter</span><div style="display:flex;gap:0.4rem;">';
    [1,2,3,4].forEach(function(qq){
      var ended=quarterEnded(st.year,qq),sel=st.quarter===qq;
      h+='<button type="button" data-trq="'+qq+'"'+(ended?'':' disabled title="This quarter has not ended yet."')+' style="padding:0.45rem 0.8rem;border-radius:8px;cursor:'+(ended?'pointer':'not-allowed')+';border:'+(sel?'2px solid #1C6B54;background:rgba(28,107,84,.08);':'1px solid var(--cd);background:transparent;')+(ended?'':'opacity:.45;')+'font-weight:700;color:var(--bd);font-family:inherit;">Q'+qq+'</button>';
    });
    h+='</div></div></div>'
      +'<div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin-top:0.9rem;">'
      +'<button class="pz-btn ok" id="trPrepare" style="padding:0.55rem 1.2rem;"'+(liveMode==='none'||st.busy||!quarterEnded(st.year,st.quarter)?' disabled':'')+'>'+(st.busy?'Preparing…':'Prepare '+form+' for '+esc(QUARTER_LABEL[st.quarter])+' '+st.year)+'</button>'
      +'<span style="font-size:0.8rem;color:var(--tm);">Filing due '+esc(dueLabel(st.year,st.quarter))+' &middot; through eBIRForms or eFPS</span></div>';
    if(st.record)h+=trQuarterlyHtml(st.record);
    h+='<div style="border-top:1px solid var(--cd);margin-top:1rem;padding-top:0.8rem;">'
      +'<div style="font-weight:700;font-size:0.9rem;color:var(--bd);">Annual accountant export</div>'
      +'<p class="az-note" style="margin:0.3rem 0 0.2rem;">Every quarter of the year with its own tax figures, reconciliation status and gross-margin P&L in one CSV — ready to hand to your accountant for BIR Form 1701 (sole proprietorship) or 1702 (OPC / corporation).</p>'
      +'<button class="pz-btn sec" id="trPrepareAnnual" style="padding:0.5rem 1.1rem;margin-top:0.5rem;"'+(st.busy?' disabled':'')+'>'+(st.busy?'Preparing…':'Prepare annual export '+st.year)+'</button></div>';
    if(st.annualRecord)h+=trAnnualHtml(st.annualRecord);
    h+='<div style="border-top:1px solid var(--cd);margin-top:1rem;padding-top:0.8rem;"><div style="font-weight:700;font-size:0.9rem;color:var(--bd);">Prepared returns</div>'+trHistoryHtml()+'</div>';
    h+='</div>';
    box.innerHTML=h;
    var ys=document.getElementById('trYear');if(ys)ys.onchange=function(){
      st.year=Number(ys.value);
      if(!quarterEnded(st.year,st.quarter)){for(var qq=4;qq>=1;qq--){if(quarterEnded(st.year,qq)){st.quarter=qq;break;}}}
      pullFromHistory();draw();
    };
    box.querySelectorAll('[data-trq]').forEach(function(b){b.onclick=function(){st.quarter=Number(b.getAttribute('data-trq'));pullFromHistory();draw();};});
    var pr=document.getElementById('trPrepare');if(pr)pr.onclick=function(){prepareReturn('quarterly');};
    var pa=document.getElementById('trPrepareAnnual');if(pa)pa.onclick=function(){prepareReturn('annual');};
    var dl=document.getElementById('trDownload');if(dl)dl.onclick=function(){if(st.record)trDownload('Accaza-'+st.record.returnType+'-'+st.record.year+'-Q'+st.record.quarter+'.csv',trQuarterlyCsv(st.record));};
    var da=document.getElementById('trDownloadAnnual');if(da)da.onclick=function(){if(st.annualRecord)trDownload('Accaza-'+((st.annualRecord.annual||{}).form||'1701')+'-annual-'+st.annualRecord.year+'.csv',trAnnualCsv(st.annualRecord));};
  }
  draw();
  refreshHistory();
}
