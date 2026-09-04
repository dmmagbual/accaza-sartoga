(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaOptionLibraryPlan=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - one definition per customer choice, instead of a copy inside every drink.
     A syrup is the same syrup whichever drink it goes in, yet each drink spells it out for
     itself. This lifts the definition most drinks agree on into the shared library, removes the
     copies that match it, and leaves the genuinely different ones behind as overrides. */
  var VERSION='option-library-1';
  var SIZES=['S','M','L'];
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
  function normalise(rows,recipe,inventory){
    return (rows||[]).filter(function(r){return r&&r.ing;}).map(function(r){
      var item=(inventory||{})[r.ing]||{},out={ing:r.ing,unit:String(r.unit||item.unit||''),stockUnit:String(r.stockUnit||item.unit||'')};
      SIZES.forEach(function(s){out['qty'+s]=q6(effQty(r,s,recipe));});
      return out;
    }).sort(function(a,b){return a.ing<b.ing?-1:a.ing>b.ing?1:0;});
  }
  /* A shared definition that TAKES something out has to say so, not carry a fixed minus. Held as
     op:'reduce' it removes what the drink actually uses and nothing more, so the same "Not Sweet"
     works on a latte that has condensed milk and on a soda that has none. */
  function asReducers(rows){
    return (rows||[]).map(function(row){
      var negative=SIZES.every(function(s){return n(row['qty'+s])<=0;})&&SIZES.some(function(s){return n(row['qty'+s])<0;});
      if(!negative)return row;
      var out={ing:row.ing,unit:row.unit,stockUnit:row.stockUnit,op:'reduce'};
      SIZES.forEach(function(s){out['qty'+s]=q6(Math.abs(n(row['qty'+s])));});
      return out;
    });
  }
  function signature(rows){
    return (rows||[]).map(function(r){return r.ing+':'+SIZES.map(function(s){return q6(r['qty'+s]);}).join('/');}).sort().join('|');
  }
  /* Group every per-drink copy of a choice by what it actually says. The spelling most drinks
     agree on becomes the shared one; a spelling only one drink uses stays with that drink. */
  function survey(recipes,inventory,menuItems){
    var choices={};
    Object.keys(recipes||{}).sort().forEach(function(key){
      var recipe=recipes[key]||{},drink=String(((menuItems||{})[key]||{}).name||key);
      Object.keys(recipe.choiceAdd||{}).forEach(function(gid){
        Object.keys(recipe.choiceAdd[gid]||{}).forEach(function(choiceKey){
          var entry=recipe.choiceAdd[gid][choiceKey]||{};
          var rows=normalise(entry.ings,recipe,inventory);
          if(!rows.length)return;
          var id=gid+' '+choiceKey;
          var record=choices[id]||(choices[id]={gid:gid,key:choiceKey,label:String(entry.label||choiceKey),variants:{},copies:0});
          var sig=signature(rows);
          var variant=record.variants[sig]||(record.variants[sig]={signature:sig,rows:rows,drinks:[]});
          variant.drinks.push({key:key,name:drink});
          record.copies++;
        });
      });
    });
    return choices;
  }
  function plan(recipes,inventory,menuItems,options){
    options=options||{};
    var existing=options.optionCosts||{};
    var choices=survey(recipes,inventory,menuItems);
    var library={},entries=[],updates={},removed=0,kept=0,copies=0;
    Object.keys(choices).sort().forEach(function(id){
      var record=choices[id];
      copies+=record.copies;
      var variants=Object.keys(record.variants).map(function(sig){return record.variants[sig];})
        .sort(function(a,b){return b.drinks.length-a.drinks.length||b.rows.length-a.rows.length;});
      var winner=variants[0];
      /* A definition already saved in the library stays the shared one - the user put it there. */
      var saved=(existing[record.gid]||{})[record.key];
      var fromLibrary=!!(saved&&Array.isArray(saved.ings)&&saved.ings.length);
      var sharedRows=fromLibrary?normalise(saved.ings,null,inventory):winner.rows;
      var sharedSig=signature(sharedRows);
      library[record.gid]=library[record.gid]||{};
      library[record.gid][record.key]={label:record.label,ings:asReducers(sharedRows)};
      var overrides=[];
      variants.forEach(function(variant){
        var matches=variant.signature===sharedSig;
        variant.drinks.forEach(function(drink){
          if(matches){updates['recipes/'+drink.key+'/choiceAdd/'+record.gid+'/'+record.key]=null;removed++;}
          else{overrides.push(drink);kept++;}
        });
      });
      entries.push({gid:record.gid,key:record.key,label:record.label,copies:record.copies,
        variants:variants.length,fromLibrary:fromLibrary,rows:sharedRows,
        agreed:record.copies-overrides.length,overrides:overrides});
    });
    updates['posSettings/optionCosts']=library;
    return {version:VERSION,library:library,entries:entries,updates:updates,
      summary:{definitions:entries.length,copies:copies,copiesRemoved:removed,overridesKept:kept,
        disagreeing:entries.filter(function(e){return e.variants>1;}).length}};
  }
  /* Rebuild recipes with the plan applied, so the costs can be proved before anything is written. */
  function applyTo(recipes,result){
    var out=JSON.parse(JSON.stringify(recipes||{}));
    Object.keys(result.updates||{}).forEach(function(path){
      if(path.indexOf('recipes/')!==0)return;
      var parts=path.split('/'),recipe=out[parts[1]];
      if(!recipe||!recipe.choiceAdd)return;
      var group=recipe.choiceAdd[parts[3]];
      if(!group)return;
      delete group[parts[4]];
      if(!Object.keys(group).length)delete recipe.choiceAdd[parts[3]];
      if(!Object.keys(recipe.choiceAdd).length)delete recipe.choiceAdd;
    });
    return out;
  }
  return {VERSION:VERSION,SIZES:SIZES,plan:plan,survey:survey,applyTo:applyTo,normalise:normalise,signature:signature,asReducers:asReducers};
});
