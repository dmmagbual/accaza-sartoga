
/* ══════════ COMPANY INFORMATION (registered business identity) ══════════ */
/* One single home for the registered business facts. The TIN, branch code and
   business structure typed here are stamped into taxSettings when a tax category
   is activated (Tax Compliance tab), so every receipt prints the registered
   identity BIR requires (RR 18-2012). Owner-only changes, audited server-side by
   setCompanyInfo; a TIN saved in the old tax card pre-fills automatically so the
   owner never retypes identity facts they already entered. */
function renderCompanyInfo(){
  var root=document.getElementById('companyInfoRoot');if(!root)return;
  root.innerHTML='<div id="companyInfoBox"></div>';
  wireCompanyInfo();
}
var COMPANY_STRUCTURES={
  sole:{label:'Sole Proprietorship',hint:'One owner. Annual income tax return: BIR Form 1701.'},
  opc:{label:'One Person Corporation',hint:'Single-stockholder corporation. Annual return: BIR Form 1702.'},
  corporation:{label:'Corporation',hint:'Annual income tax return: BIR Form 1702.'}
};
function wireCompanyInfo(){
  var box=document.getElementById('companyInfoBox');if(!box)return;
  var canEdit=['owner','superadmin'].indexOf(String((window.__accazaAuthz||{}).role))>=0;
  var state={loaded:false,rec:{}};
  function dateStr(v){var n=Number(v);return (n>0&&isFinite(n))?window.AccazaDate.key(n):'';}
  function draw(){
    var r=state.rec||{};
    var dis=canEdit?'':' disabled';
    var h='<div class="az-sec">Company Information &mdash; your registered business identity</div><div class="pz-card">';
    if(!state.loaded){h+='<p class="az-note" style="margin:0;">Loading company record…</p></div>';box.innerHTML=h;return;}
    h+='<p class="az-note" style="margin:0 0 0.9rem;">Typed once here, used everywhere. The TIN, branch code and business structure are stamped onto your tax settings when you activate a tax category in the <b>Tax Compliance</b> tab, and they print on official receipts exactly as BIR requires.</p>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">'
      +'<div><span class="pz-lbl">Registered business name</span><input class="pz-in" id="ciName" type="text" maxlength="160" placeholder="As printed on your BIR Form 2303" value="'+esc(r.registeredName||'')+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">Trade name</span><input class="pz-in" id="ciTrade" type="text" maxlength="160" placeholder="Operating name, if different (optional)" value="'+esc(r.tradeName||'')+'"'+dis+'/></div>'
      +'<div style="grid-column:1/-1;"><span class="pz-lbl">Registered address</span><input class="pz-in" id="ciAddr" type="text" maxlength="300" placeholder="Business address registered with BIR" value="'+esc(r.address||'')+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">BIR TIN</span><input class="pz-in" id="ciTin" type="text" inputmode="numeric" maxlength="11" placeholder="123-456-789" value="'+esc(r.tin||'')+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">Branch code</span><input class="pz-in" id="ciBranch" type="text" inputmode="numeric" maxlength="5" placeholder="00000" value="'+esc(r.branchCode||'')+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">Business structure</span><select class="pz-in" id="ciStructure"'+dis+'>'
      +'<option value="sole"'+(r.structure==='sole'||!r.structure?' selected':'')+'>Sole Proprietorship</option>'
      +'<option value="opc"'+(r.structure==='opc'?' selected':'')+'>One Person Corporation</option>'
      +'<option value="corporation"'+(r.structure==='corporation'?' selected':'')+'>Corporation</option>'
      +'</select><span style="font-size:0.72rem;color:var(--tl);display:block;margin-top:0.2rem;">'+esc((COMPANY_STRUCTURES[r.structure]||COMPANY_STRUCTURES.sole).hint)+'</span></div>'
      +'<div><span class="pz-lbl">RDO</span><input class="pz-in" id="ciRdo" type="text" maxlength="60" placeholder="e.g. RDO 043" value="'+esc(r.rdo||'')+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">Form 2303 (COR) issued</span><input class="pz-in" id="ciCor" type="date" value="'+dateStr(r.cor2303IssuedAt)+'"'+dis+'/></div>'
      +'<div><span class="pz-lbl">VAT registration date</span><input class="pz-in" id="ciVat" type="date" value="'+dateStr(r.vatRegisteredAt)+'"'+dis+'/></div>'
      +'</div>';
    h+='<div style="background:rgba(28,107,84,.06);border:1px solid rgba(28,107,84,.25);border-radius:10px;padding:0.75rem 0.9rem;margin-top:0.9rem;font-size:0.8rem;color:var(--tm);">'
      +'<b style="color:var(--bd);">Why this matters:</b> your business structure decides the annual return (Form 1701 for sole proprietorship, Form 1702 for OPC / corporation), the TIN and branch code print on every official receipt, and quarterly 2550Q / 2551Q preparation in the Tax Compliance tab reads these facts.'
      +'</div>';
    if(canEdit){
      h+='<div style="display:flex;gap:0.6rem;align-items:center;margin-top:0.9rem;">'
        +'<button class="pz-btn ok" id="ciSave" style="padding:0.55rem 1.3rem;">Save company information</button>'
        +'<span id="ciStatus" style="font-size:0.8rem;color:var(--tl);"></span></div>';
    } else {
      h+='<p class="az-note" style="margin:0.8rem 0 0;">Only the owner account can change company information.</p>';
    }
    h+='</div>';
    box.innerHTML=h;
    var save=document.getElementById('ciSave');if(save)save.onclick=function(){saveCompanyInfo();};
  }
  var a=A();
  if(a&&a.get){
    a.get(a.ref(a.db,'companyInfo')).then(function(s){
      state.rec=s.val()||{};
      // A TIN typed in the old tax card before this tab existed still counts: pre-fill it once.
      if(!state.rec.tin||!state.rec.branchCode||!state.rec.structure){
        a.get(a.ref(a.db,'taxSettings')).then(function(t){
          var live=t.val()||{};
          if(!state.rec.tin&&live.tin)state.rec.tin=live.tin;
          if(!state.rec.branchCode&&live.branchCode)state.rec.branchCode=live.branchCode;
          if(!state.rec.structure&&live.structure)state.rec.structure=live.structure;
          state.loaded=true;draw();
        }).catch(function(){state.loaded=true;draw();});
      } else {state.loaded=true;draw();}
    }).catch(function(){state.loaded=true;draw();});
  }
  draw();
}
function saveCompanyInfo(){
  var g=function(id){var el=document.getElementById(id);return el?String(el.value||'').trim():'';};
  var payload={registeredName:g('ciName'),tradeName:g('ciTrade'),address:g('ciAddr'),tin:g('ciTin'),branchCode:g('ciBranch'),structure:g('ciStructure'),rdo:g('ciRdo')};
  if(!payload.registeredName){alert('Enter your registered business name first.');return;}
  if(!payload.address){alert('Enter your registered address first.');return;}
  var digits=payload.tin.replace(/\D/g,'');
  if(!/^\d{9}$/.test(digits)){alert('BIR TIN must be 9 digits (example: 123-456-789).');return;}
  payload.tin=digits;
  var branch=payload.branchCode.replace(/\D/g,'');
  if(!branch)branch='00000';
  if(!/^\d{5}$/.test(branch)){alert('Branch code must be 5 digits (use 00000 for the head office).');return;}
  payload.branchCode=branch;
  if(payload.structure!=='sole'&&payload.structure!=='opc'&&payload.structure!=='corporation'){alert('Choose a business structure.');return;}
  var corEl=document.getElementById('ciCor'),vatEl=document.getElementById('ciVat');
  if(corEl&&corEl.value){var d=Date.parse(corEl.value+'T00:00:00+08:00');if(!isFinite(d)){alert('Enter a valid Form 2303 date.');return;}payload.cor2303IssuedAt=d;}
  if(vatEl&&vatEl.value){var v=Date.parse(vatEl.value+'T00:00:00+08:00');if(!isFinite(v)){alert('Enter a valid VAT registration date.');return;}payload.vatRegisteredAt=v;}
  var btn=document.getElementById('ciSave'),status=document.getElementById('ciStatus');
  if(btn)btn.disabled=true;if(status)status.textContent='Saving…';
  var a=A();
  if(!a||!a.callables||!a.callables.setCompanyInfo){if(btn)btn.disabled=false;alert('Company service unavailable. Refresh and try again.');return;}
  a.callables.setCompanyInfo(payload).then(function(resp){
    if(resp&&resp.data&&resp.data.company)window.__companyInfo=resp.data.company;
    if(window.accazaToast)window.accazaToast('Company information saved.','ok');
    wireCompanyInfo();
  }).catch(function(e){
    if(btn)btn.disabled=false;if(status)status.textContent='';
    alert(((e&&e.message)||e)+'\n\nCompany information was NOT changed.');
  });
}
