/* Sales awaiting cost (24 Sep 2026).
   Sales are never refused because an item's recipe is missing or broken. Those lines take no
   stock and no cost at the till and wait here until a manager either applies the recipe once it
   is built (stock and Cost of Sales are posted as a separate, linked correction) or confirms the
   item genuinely has no cost. All figures come from the server (manageUncostedSales). */
(function(){
  'use strict';
  var state={loading:false,data:null,error:''};
  function A(){return window.__accaza||null;}
  function call(data){var a=A();if(!a||!a.callables||!a.callables.manageUncostedSales)return Promise.reject(new Error('Refresh the page to load the cost-correction service.'));return a.callables.manageUncostedSales(data).then(function(r){return r&&r.data||r||{};});}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function peso(v){return '₱'+(Number(v)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function day(ts){return ts?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',day:'2-digit',month:'short'}).format(new Date(ts)):'';}
  var REASONS={missing_recipe:'No recipe',broken_recipe:'Recipe needs repair',invalid_line:'Incomplete sale line'};
  function root(){return document.getElementById('uncostedSalesRoot');}
  function reasonText(reasons){return Object.keys(reasons||{}).map(function(k){return (REASONS[k]||k)+(reasons[k]>1?' ×'+reasons[k]:'');}).join(', ');}

  function render(){
    var el=root();if(!el)return;
    if(state.loading&&!state.data){el.innerHTML='<div style="padding:.6rem .8rem;color:var(--tl);font-size:.78rem;">Checking sales awaiting cost…</div>';return;}
    if(state.error){el.innerHTML='<div style="margin:0 0 .8rem;padding:.7rem .9rem;border:1px solid #f1b7b7;background:#fff5f5;color:#8b1e1e;border-radius:8px;font-size:.8rem;">Sales awaiting cost could not load: '+esc(state.error)+' <button class="pz-btn sec" data-uc-refresh style="margin-left:.4rem;">Retry</button></div>';wire(el);return;}
    var d=state.data||{groups:[],openCount:0},groups=d.groups||[];
    if(!groups.length){el.innerHTML=d.canResolve?'<div style="margin:0 0 .8rem;padding:.5rem .8rem;border:1px dashed var(--cd);border-radius:8px;font-size:.76rem;color:var(--tl);display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center;"><span>✓ No sales are awaiting recipe cost.</span><button class="pz-btn sec" data-uc-scan style="font-size:.72rem;">Check past sales since '+esc(d.scanFrom||'1 Sep')+'</button></div>':'';wire(el);return;}
    var rows=groups.map(function(g){
      return '<tr><td style="padding:.35rem .4rem;"><b>'+esc(g.itemName)+'</b><div style="font-size:.7rem;color:var(--tl);">'+esc(reasonText(g.reasons))+'</div></td>'
        +'<td style="text-align:right;padding:.35rem .4rem;">'+g.count+'</td><td style="text-align:right;padding:.35rem .4rem;">'+esc(g.qty)+'</td>'
        +'<td style="padding:.35rem .4rem;white-space:nowrap;">'+esc(day(g.firstAt))+(g.lastAt&&day(g.lastAt)!==day(g.firstAt)?' – '+esc(day(g.lastAt)):'')+'</td>'
        +'<td style="padding:.35rem .4rem;"><div style="display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end;">'+(g.itemKey?'<button class="pz-btn ok" data-uc-preview="'+esc(g.itemKey)+'" style="font-size:.72rem;">Preview recipe cost</button>':'')
        +(d.canResolve&&g.itemKey?'<button class="pz-btn sec" data-uc-nocost="'+esc(g.itemKey)+'" data-uc-name="'+esc(g.itemName)+'" style="font-size:.72rem;">Confirm no cost</button>':'')+'</div></td></tr>';
    }).join('');
    el.innerHTML='<section style="margin:0 0 1rem;padding:.9rem 1rem;border:1px solid #ead39a;background:#fffaf0;border-radius:10px;">'
      +'<div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:start;"><div><div style="font-weight:700;color:#7a5200;">Sales awaiting cost · '+d.openCount+' line'+(d.openCount===1?'':'s')+'</div>'
      +'<div style="font-size:.76rem;color:var(--tl);max-width:640px;margin-top:.2rem;">These items were sold without a usable recipe, so no stock was deducted and no Cost of Sales was posted. Build or repair the recipe below, then apply its cost here. Each correction is posted as its own linked entry on the original sale date when that period is open, otherwise today.</div></div>'
      +'<div style="display:flex;gap:.4rem;"><button class="pz-btn sec" data-uc-refresh style="font-size:.72rem;">Refresh</button>'+(d.canResolve?'<button class="pz-btn sec" data-uc-scan style="font-size:.72rem;">Check past sales</button>':'')+'</div></div>'
      +'<div style="overflow-x:auto;margin-top:.6rem;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;"><thead><tr style="text-align:left;color:var(--tl);font-size:.7rem;"><th style="padding:.3rem .4rem;">Item</th><th style="padding:.3rem .4rem;text-align:right;">Sales</th><th style="padding:.3rem .4rem;text-align:right;">Qty</th><th style="padding:.3rem .4rem;">Sold</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +(d.canResolve?'':'<div style="font-size:.72rem;color:var(--tl);margin-top:.4rem;">A manager resolves these.</div>')+'</section>';
    wire(el);
  }
  function wire(el){
    el.querySelectorAll('[data-uc-refresh]').forEach(function(b){b.onclick=function(){load(true);};});
    el.querySelectorAll('[data-uc-preview]').forEach(function(b){b.onclick=function(){preview(b.getAttribute('data-uc-preview'));};});
    el.querySelectorAll('[data-uc-nocost]').forEach(function(b){b.onclick=function(){noCost(b.getAttribute('data-uc-nocost'),b.getAttribute('data-uc-name'));};});
    el.querySelectorAll('[data-uc-scan]').forEach(function(b){b.onclick=function(){scan(b);};});
  }
  function load(force){
    if(state.loading)return;state.loading=true;if(force)state.error='';render();
    call({action:'list'}).then(function(d){state.data=d;state.error='';}).catch(function(e){state.error=String(e&&e.message||e);}).then(function(){state.loading=false;render();});
  }
  function modal(html){var m=document.createElement('div');m.className='pz-mask show';m.innerHTML='<div class="pz-modal" style="max-width:720px;max-height:90vh;overflow:auto;">'+html+'</div>';document.body.appendChild(m);m.addEventListener('click',function(ev){if(ev.target===m)m.remove();});return m;}

  function preview(itemKey){
    var m=modal('<h3 style="margin-top:0;">Recipe cost preview</h3><div data-body>Costing sales against the current recipe…</div>'),body=m.querySelector('[data-body]');
    call({action:'preview',itemKey:itemKey}).then(function(p){
      var canResolve=state.data&&state.data.canResolve,list=(p.rows||[]).map(function(r){
        var detail=r.ok?(r.ingredients||[]).map(function(i){return esc(i.name)+' '+esc(i.qty)+' '+esc(i.unit);}).join(', '):'<span style="color:#8b1e1e;">'+esc(r.message)+'</span>';
        return '<tr><td style="padding:.3rem;">'+esc(day(r.occurredAt))+'<div style="font-size:.68rem;color:var(--tl);">'+esc(r.orderId)+'</div></td><td style="padding:.3rem;text-align:right;">'+esc(r.qty)+(r.size?' '+esc(r.size):'')+'</td><td style="padding:.3rem;font-size:.72rem;">'+detail+'</td><td style="padding:.3rem;text-align:right;white-space:nowrap;">'+(r.ok?peso(r.cost):'—')+'</td><td style="padding:.3rem;font-size:.72rem;white-space:nowrap;">'+(r.ok?esc(r.postDate)+(r.postedToOriginalDate?'':' <span title="The original period is closed" style="color:#8a6d1b;">(today)</span>'):'')+'</td></tr>';
      }).join('');
      body.innerHTML='<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.78rem;"><thead><tr style="text-align:left;color:var(--tl);font-size:.68rem;"><th style="padding:.3rem;">Sale</th><th style="padding:.3rem;text-align:right;">Qty</th><th style="padding:.3rem;">Stock to deduct</th><th style="padding:.3rem;text-align:right;">Cost</th><th style="padding:.3rem;">Posts on</th></tr></thead><tbody>'+(list||'<tr><td colspan="5">No open sales remain.</td></tr>')+'</tbody></table></div>'
        +'<p style="font-weight:700;margin:.7rem 0 .2rem;">Ready: '+p.readyCount+' sale(s) · Cost of Sales '+peso(p.total)+'</p>'
        +(p.blockedCount?'<p style="font-size:.76rem;color:#8b1e1e;margin:.2rem 0;">'+p.blockedCount+' sale(s) cannot be costed until the recipe is complete. They stay open.</p>':'')
        +'<p style="font-size:.72rem;color:var(--tl);margin:.2rem 0;">Posting deducts the stock shown and records Dr Cost of Sales / Cr Inventory, linked to each original sale. Ingredient costs are today\'s. It cannot be posted twice.</p>'
        +(canResolve&&p.readyCount?'<textarea class="pz-in" data-reason placeholder="Note (optional), e.g. recipe built 24 Sep" style="width:100%;min-height:48px;margin-top:.4rem;"></textarea>':'')
        +'<p data-msg role="status" style="font-size:.78rem;"></p><div style="display:flex;gap:.5rem;">'+(canResolve&&p.readyCount?'<button class="pz-btn ok" data-apply>Post '+peso(p.total)+' cost</button>':'')+'<button class="pz-btn sec" data-close>Close</button></div>';
      body.querySelector('[data-close]').onclick=function(){m.remove();};
      var apply=body.querySelector('[data-apply]');
      if(apply)apply.onclick=function(){
        apply.disabled=true;var msg=body.querySelector('[data-msg]');msg.textContent='Posting…';
        call({action:'apply_recipe',itemKey:itemKey,expectedTotal:p.total,reason:(body.querySelector('[data-reason]')||{}).value||''}).then(function(r){
          msg.style.color='#155724';msg.textContent='Posted '+r.applied+' sale(s), Cost of Sales '+peso(r.amount)+'.'+((r.skipped||[]).length?' '+r.skipped.length+' skipped (voided or in progress).':'');load(true);
        }).catch(function(e){msg.style.color='#8b1e1e';msg.textContent=String(e&&e.message||e);apply.disabled=false;});
      };
    }).catch(function(e){body.innerHTML='<p style="color:#8b1e1e;">'+esc(e&&e.message||e)+'</p><button class="pz-btn sec" data-close>Close</button>';body.querySelector('[data-close]').onclick=function(){m.remove();};});
  }

  function noCost(itemKey,name){
    var m=modal('<h3 style="margin-top:0;">Confirm no cost · '+esc(name)+'</h3><p style="font-size:.8rem;">Use this only when the item genuinely has no stock cost of its own, for example an add-on already costed inside the drink, or a free item. The open sales close at ₱0.00 and nothing is posted.</p>'
      +'<textarea class="pz-in" data-reason placeholder="Why this item has no cost (required)" style="width:100%;min-height:60px;"></textarea>'
      +'<label style="display:flex;gap:.4rem;align-items:center;font-size:.78rem;margin:.5rem 0;"><input type="checkbox" data-mark checked> Mark the item “no recipe needed” so future sales are not flagged</label>'
      +'<p data-msg role="status" style="font-size:.78rem;"></p><button class="pz-btn ok" data-ok>Confirm no cost</button> <button class="pz-btn sec" data-close>Cancel</button>');
    m.querySelector('[data-close]').onclick=function(){m.remove();};
    var ok=m.querySelector('[data-ok]');ok.onclick=function(){
      var reason=m.querySelector('[data-reason]').value.trim(),msg=m.querySelector('[data-msg]');
      if(reason.length<5){msg.style.color='#8b1e1e';msg.textContent='Enter a reason.';return;}
      ok.disabled=true;msg.textContent='Saving…';
      call({action:'confirm_no_cost',itemKey:itemKey,reason:reason,markNoRecipe:m.querySelector('[data-mark]').checked}).then(function(r){msg.style.color='#155724';msg.textContent='Closed '+r.resolved+' sale line(s) at no cost.';load(true);setTimeout(function(){m.remove();},1200);})
        .catch(function(e){msg.style.color='#8b1e1e';msg.textContent=String(e&&e.message||e);ok.disabled=false;});
    };
  }

  function scan(button){
    var old=button.textContent,cursor=null,totals={scanned:0,finalized:0,flagged:0,errors:0},rounds=0;button.disabled=true;
    function step(){
      rounds++;button.textContent='Checking… '+totals.scanned+' sales';
      return call({action:'scan',since:(state.data&&state.data.scanFrom)||'2026-09-01',cursor:cursor}).then(function(r){
        totals.scanned+=r.scanned||0;totals.finalized+=r.finalized||0;totals.flagged+=r.flagged||0;totals.errors+=(r.errors||[]).length;cursor=r.cursor;
        if(!r.done&&rounds<40)return step();
      });
    }
    step().then(function(){alert('Checked '+totals.scanned+' sales. '+totals.flagged+' line(s) added to Sales awaiting cost'+(totals.finalized?', '+totals.finalized+' stuck sale(s) completed':'')+(totals.errors?'. '+totals.errors+' could not be checked; try again later':'')+'.');})
      .catch(function(e){alert('The check stopped: '+(e&&e.message||e));})
      .then(function(){button.disabled=false;button.textContent=old;load(true);});
  }

  window.__accazaRegisterModule('uncostedsales',function(){load(true);});
})();
