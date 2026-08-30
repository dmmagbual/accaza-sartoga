/* ══════════ INVENTORY ARCHITECTURE v2 — Phase 3: Standard vs Actual costing ══════════
   Standard cost = pricing lens (menu margin, food-cost %). Actual COGS stays weighted-average
   (unchanged, already snapshotted per sale into cogsSnapshot). Method 'wac' (default) makes
   standard = live WAC; 'manual' lets you lock a standard that pricing uses independently. */
function openStdCosting(){
  var a=A(); var size=window.__stdSize||'M'; var method=stdCostMethod();
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  document.body.appendChild(mask);
  function close(){ if(mask.parentNode)document.body.removeChild(mask); }
  function pctCol(fc){ return fc<=35?'#2a7':(fc<=45?'#c98a2b':'#c0392b'); }
  function draw(){
    size=window.__stdSize||'M'; method=stdCostMethod();
    var items=(typeof menuList==='function'?menuList():[]).slice();
    var sizeBtns=['S','M','L'].map(function(s){return '<button class="pz-btn '+(s===size?'ok':'sec')+'" data-stdsize="'+s+'" style="padding:0.2rem 0.7rem;">'+s+'</button>';}).join(' ');
    var sumFc=0,nFc=0,nUncosted=0,nNoRec=0;
    var rows=items.map(function(it){
      var price=Number(it['price'+size])||0;
      var r=recipeStdCost(it.key,size);
      if(!r.has||it.noRecipe){ if(!it.noRecipe)nNoRec++; return '<tr><td>'+esc(it.name)+'</td><td class="r">'+(price?peso(price):'—')+'</td><td class="r" style="color:var(--tl);">'+(it.noRecipe?'resale':'no recipe')+'</td><td class="r">—</td><td class="r">—</td><td class="r">—</td></tr>'; }
      var cost=r.cost; var gp=price-cost; var gpp=price>0?(gp/price*100):0; var fc=price>0?(cost/price*100):0;
      if(price>0){sumFc+=fc;nFc++;}
      if(!r.covered)nUncosted++;
      return '<tr>'
        +'<td>'+esc(it.name)+(r.covered?'':' <span title="an ingredient has no cost" style="color:#c0392b;">⚠</span>')+'</td>'
        +'<td class="r">'+(price?peso(price):'—')+'</td>'
        +'<td class="r">'+peso(cost)+'</td>'
        +'<td class="r">'+peso(gp)+'</td>'
        +'<td class="r" style="font-weight:600;">'+(price?num(Math.round(gpp*10)/10)+'%':'—')+'</td>'
        +'<td class="r" style="font-weight:600;color:'+pctCol(fc)+';">'+(price?num(Math.round(fc*10)/10)+'%':'—')+'</td>'
      +'</tr>';
    }).join('');
    var avgFc=nFc?Math.round(sumFc/nFc*10)/10:0;
    // ingredient standard vs WAC drift (matters when method=manual or a standard was locked)
    var drift=ings().filter(function(x){return x.stdCost!=null&&x.stdCost!==''&&Math.abs((Number(x.stdCost)||0)-(Number(x.cost)||0))>0.00001;})
      .map(function(x){var d=(Number(x.cost)||0)-(Number(x.stdCost)||0);return '<tr><td>'+esc(x.name)+'</td><td class="r">'+peso(Number(x.stdCost)||0)+'</td><td class="r">'+peso(Number(x.cost)||0)+'</td><td class="r" style="color:'+(d>0?'#c0392b':'#2a7')+';">'+(d>0?'+':'')+peso(d)+'/'+esc(x.unit||'')+'</td></tr>';}).join('');
    mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:960px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;color:var(--bd);">📊 Standard costing — pricing &amp; margin</div><button class="pz-btn sec" id="stClose" style="padding:0.2rem 0.6rem;">✕</button></div>'
      +'<p class="pz-sub" style="margin-top:0.3rem;">Expected recipe cost per drink using <b>standard</b> cost, and the margin it implies. Actual COGS on sales stays weighted-average and is unchanged. Options/add-ons are excluded (they’re priced separately); this is the base drink.</p>'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:center;background:var(--cd);border-radius:6px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;font-size:0.82rem;">'
        +'<span>Standard cost method: <select class="pz-in" id="stMethod" style="width:auto;display:inline-block;"><option value="wac"'+(method==='wac'?' selected':'')+'>Weighted-average (auto)</option><option value="manual"'+(method==='manual'?' selected':'')+'>Manual / locked</option></select></span>'
        +'<span>Size: '+sizeBtns+'</span>'
        +'<button class="pz-btn sec" id="stSetWac" style="padding:0.2rem 0.6rem;">Set all standards = current WAC</button>'
        +'<button class="pz-btn sec" id="stXls" style="padding:0.2rem 0.6rem;">⬇ Excel</button>'
        +'<span style="margin-left:auto;">Avg food cost: <b style="color:'+pctCol(avgFc)+';">'+num(avgFc)+'%</b>'+(nUncosted?' · <b style="color:#c0392b;">'+nUncosted+' uncosted</b>':'')+'</span>'
      +'</div>'
      +'<div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Menu item</th><th class="r">Price ('+size+')</th><th class="r">Std cost</th><th class="r">GP ₱</th><th class="r">GP %</th><th class="r">Food %</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6" style="padding:1rem;color:var(--tl);">No menu items with recipes yet.</td></tr>')+'</tbody></table></div>'
      +(method==='manual'?('<div style="margin-top:0.8rem;font-weight:600;color:var(--bd);font-size:0.9rem;">Standard vs actual (WAC) drift — ingredients</div><p class="pz-sub" style="margin-top:0.1rem;">Where your locked standard differs from the live weighted-average. Big gaps = time to refresh the standard.</p><div style="overflow-x:auto;"><table class="pz-tbl"><thead><tr><th>Ingredient</th><th class="r">Standard</th><th class="r">WAC (actual)</th><th class="r">Actual − Std</th></tr></thead><tbody>'+(drift||'<tr><td colspan="4" style="padding:0.6rem;color:var(--tl);">No locked standards differ from WAC.</td></tr>')+'</tbody></table></div>'):'<p class="pz-sub" style="margin-top:0.6rem;">Method is <b>Weighted-average</b>: standard tracks live WAC, so standard = actual. Switch to <b>Manual</b> to lock standards (e.g. a target or replacement cost) and see drift.</p>')
      +'</div>';
    document.getElementById('stClose').onclick=close;
    mask.querySelectorAll('[data-stdsize]').forEach(function(b){b.onclick=function(){window.__stdSize=b.getAttribute('data-stdsize');draw();};});
    document.getElementById('stMethod').onchange=function(){var v=this.value;window.__posSettings=window.__posSettings||{};window.__posSettings.stdCostMethod=v;a.update(a.ref(a.db,'posSettings'),{stdCostMethod:v}).catch(function(e){alert('Could not save method: '+((e&&e.code)||e));});draw();};
    document.getElementById('stSetWac').onclick=function(){ if(!confirm('Set every item’s standard cost to its current weighted-average? This snapshots today’s WAC as the standard (useful before switching to Manual).'))return; var upd={}; ings().forEach(function(x){upd['inventory/'+x.id+'/stdCost']=Number(x.cost)||0;}); a.update(a.ref(a.db),upd).then(function(){alert('Standards set to current WAC for '+Object.keys(upd).length+' item(s).');draw();}).catch(function(e){alert('Could not update: '+((e&&e.code)||e));}); };
    document.getElementById('stXls').onclick=function(){ if(!window.XLSX){alert('Excel library still loading — try again.');return;} var aoa=[['Menu item','Size','Price','Std cost','GP','GP%','Food%','Costed']]; (typeof menuList==='function'?menuList():[]).forEach(function(it){['S','M','L'].forEach(function(s){var price=Number(it['price'+s])||0;var r=recipeStdCost(it.key,s);if(!r.has)return;var gp=price-r.cost;aoa.push([it.name,s,price,r.cost,Math.round(gp*100)/100,price>0?Math.round(gp/price*1000)/10:'',price>0?Math.round(r.cost/price*1000)/10:'',r.covered?'yes':'MISSING']);});}); var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),'StdCosting');XLSX.writeFile(wb,'accaza-standard-costing-'+window.AccazaDate.key()+'.xlsx'); };
  }
  draw();
}
