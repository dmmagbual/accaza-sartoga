(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaRecipeTempPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - temperature-option repair planner.
     A "Hot" choice was written as the COMPLETE hot recipe, but the costing engine ADDS
     option rows to the base. Ordering Hot therefore charged the drink twice. This planner
     rewrites each temperature choice as a difference from the base so the engine's
     addition lands on the recipe the operator actually wrote. Pure arithmetic, no I/O. */
  var VERSION='temp-plan-1';
  var SIZES=['S','M','L'];
  var TEMP_GROUP='og_temp';
  function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
  function q6(v){return Math.round(n(v)*1000000)/1000000;}
  function effQty(row,size,recipe){
    if(!row)return 0;
    var direct=row['qty'+size];
    if(direct!=null&&direct!=='')return n(direct);
    if(row.qty==null||row.qty==='')return 0;
    var sm=(recipe&&recipe.sizeMult)||row.sizeMult||{S:1,M:1.3,L:1.6};
    return n(row.qty)*n(sm[size]==null?1:sm[size]);
  }
  function totals(rows,recipe){
    var out={};
    (rows||[]).forEach(function(r){
      if(!r||!r.ing)return;
      var t=out[r.ing]||(out[r.ing]={ing:r.ing,unit:r.unit||'',stockUnit:r.stockUnit||'',S:0,M:0,L:0});
      SIZES.forEach(function(s){t[s]=q6(t[s]+effQty(r,s,recipe));});
    });
    return out;
  }
  function iceIndex(inventory){
    var out={};
    Object.keys(inventory||{}).forEach(function(id){
      if(String((inventory[id]||{}).name||'').trim().toLowerCase()==='ice')out[id]=true;
    });
    return out;
  }
  function difference(after,before){
    var ids={},rows=[];
    Object.keys(after||{}).forEach(function(i){ids[i]=1;});
    Object.keys(before||{}).forEach(function(i){ids[i]=1;});
    Object.keys(ids).sort().forEach(function(id){
      var a=(after||{})[id]||{},b=(before||{})[id]||{},meta=(after||{})[id]||(before||{})[id]||{};
      var row={ing:id,unit:meta.unit||'',stockUnit:meta.stockUnit||''},any=false;
      SIZES.forEach(function(s){var v=q6(n(a[s])-n(b[s]));row['qty'+s]=v;if(v!==0)any=true;});
      if(any)rows.push(row);
    });
    return rows;
  }
  function groupKey(group,label){
    var want=String(label).toLowerCase();
    var keys=Object.keys(group||{});
    for(var i=0;i<keys.length;i++)if(String(keys[i]).toLowerCase()===want)return keys[i];
    return null;
  }
  /* A choice block is already a DIFFERENCE when it carries a negative quantity, or when it
     shares less than half of the base ingredients. Otherwise it is a full recipe copy. */
  function classify(block,baseTotals,recipe){
    var rows=(block&&block.ings)||[];
    if(!rows.length)return 'none';
    var negative=rows.some(function(r){return SIZES.some(function(s){return effQty(r,s,recipe)<0;});});
    if(negative)return 'difference';
    var baseIds=Object.keys(baseTotals||{});
    if(!baseIds.length)return 'difference';
    var mine=totals(rows,recipe);
    var shared=baseIds.filter(function(id){return mine[id];}).length;
    return (shared/baseIds.length)>=0.5?'full-copy':'difference';
  }
  /* Rewrite one drink's temperature choices as differences from the base. The base itself is
     never touched, so a drink's plain cost cannot move and a drink that does not offer the
     Temperature group is left completely alone. */
  function planRecipe(key,recipe,ice,item){
    recipe=recipe||{};
    var offered=Array.isArray(item&&item.options)?item.options:[];
    if(offered.indexOf(TEMP_GROUP)<0)return null;
    var base=(recipe.base||[]).filter(function(r){return r&&r.ing;});
    var group=(recipe.choiceAdd||{})[TEMP_GROUP]||{};
    var hotKey=groupKey(group,'Hot'),icedKey=groupKey(group,'Iced');
    var hot=hotKey?group[hotKey]:null,iced=icedKey?group[icedKey]:null;
    var baseTotals=totals(base,recipe);
    var baseHasIce=base.some(function(r){return ice[r.ing];});
    var kind=classify(hot,baseTotals,recipe);
    /* The base already carries the ice, so an Iced choice that adds ice again double-counts it. */
    var icedAddsIce=((iced&&iced.ings)||[]).some(function(r){return ice[r.ing]&&SIZES.some(function(s){return effQty(r,s,recipe)>0;});});
    var duplicateIce=baseHasIce&&icedAddsIce;
    var newIced=duplicateIce?null:iced;
    var newHot=hot;
    if(kind==='full-copy'){
      var rows=difference(totals(hot.ings,recipe),baseTotals);
      newHot=rows.length?{label:'Hot',ings:rows}:null;
    }
    if(kind!=='full-copy'&&!duplicateIce)return null;
    return {
      key:key,kind:kind,duplicateIce:duplicateIce,baseHasIce:baseHasIce,
      before:{base:base,hot:hot,iced:iced},
      after:{base:base,hot:newHot,iced:newIced},
      updates:(function(){
        var u={};
        if(kind==='full-copy')u['recipes/'+key+'/choiceAdd/'+TEMP_GROUP+'/'+(hotKey||'Hot')]=newHot;
        if(duplicateIce)u['recipes/'+key+'/choiceAdd/'+TEMP_GROUP+'/'+icedKey]=null;
        return u;
      })()
    };
  }
  /* Build the repair plan for every recipe. Returns the drinks that move and one flat
     multi-path update map, so the whole repair can be written in a single atomic call. */
  function plan(recipes,inventory,menuItems){
    var ice=iceIndex(inventory),drinks=[],updates={};
    Object.keys(recipes||{}).sort().forEach(function(key){
      var p=planRecipe(key,recipes[key],ice,(menuItems||{})[key]);
      if(!p)return;
      drinks.push(p);
      Object.keys(p.updates).forEach(function(path){updates[path]=p.updates[path];});
    });
    return {version:VERSION,tempGroup:TEMP_GROUP,drinks:drinks,updates:updates,
      summary:{examined:Object.keys(recipes||{}).length,changed:drinks.length,
        fullCopies:drinks.filter(function(d){return d.kind==='full-copy';}).length,
        duplicateIce:drinks.filter(function(d){return d.duplicateIce;}).length}};
  }
  /* Rebuild a recipes map with the plan applied - used to prove the costs before writing. */
  function applyToRecipes(recipes,result){
    var out=JSON.parse(JSON.stringify(recipes||{}));
    (result.drinks||[]).forEach(function(d){
      var rec=out[d.key];if(!rec)return;
      rec.choiceAdd=rec.choiceAdd||{};
      var g=rec.choiceAdd[TEMP_GROUP]||{};
      if(d.after.hot)g.Hot=d.after.hot;else delete g.Hot;
      if(d.after.iced)g.Iced=d.after.iced;else delete g.Iced;
      if(Object.keys(g).length)rec.choiceAdd[TEMP_GROUP]=g;else delete rec.choiceAdd[TEMP_GROUP];
    });
    return out;
  }
  return {VERSION:VERSION,SIZES:SIZES,TEMP_GROUP:TEMP_GROUP,plan:plan,planRecipe:planRecipe,
    applyToRecipes:applyToRecipes,effQty:effQty,totals:totals,difference:difference,iceIndex:iceIndex,classify:classify};
});
