(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaServeStylePlan=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - move packaging out of 43 recipes and into one table.
     A cup, lid and straw depend on how a drink is served, not on which drink it is. This reads
     the packaging every recipe already carries, groups the identical ones into serve styles,
     and works out which drink belongs to which. It proposes; it never decides on its own. */
  var VERSION='serve-style-1';
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
  /* Packaging is whatever the shop already treats as packaging: the item's inventory category
     says so, or its name is one of the shapes a drink is served in. Never a guess on a
     substring - "Strawberry" is not a straw. */
  var PACKAGING_WORDS=/(^|[^a-z])(cup|cups|lid|lids|straw|straws|sleeve|sleeves|tissue|napkin|holder|carrier|stirrer|dome|sealing|paper)([^a-z]|$)/i;
  function isPackaging(itemId,inventory,categories){
    var item=(inventory||{})[itemId];if(!item)return false;
    var category=(categories||{})[item.category]||{};
    var label=String(category.name||'').toLowerCase();
    if(/packag/.test(label))return true;
    return PACKAGING_WORDS.test(String(item.name||''));
  }
  function signature(rows,recipe){
    return rows.map(function(r){
      return r.ing+':'+SIZES.map(function(s){return q6(effQty(r,s,recipe));}).join('/');
    }).sort().join('|');
  }
  function normalise(rows,recipe,inventory){
    return rows.map(function(r){
      var item=(inventory||{})[r.ing]||{};
      var out={ing:r.ing,unit:String(r.unit||item.unit||''),stockUnit:String(r.stockUnit||item.unit||'')};
      SIZES.forEach(function(s){out['qty'+s]=q6(effQty(r,s,recipe));});
      return out;
    }).sort(function(a,b){return a.ing<b.ing?-1:a.ing>b.ing?1:0;});
  }
  function styleIdFor(label){
    return 'style_'+String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
  }
  /* Where the packaging sits today: in the base recipe, or in a temperature choice. */
  function packagingOf(recipe,inventory,categories){
    var out={base:[],hot:[],iced:[]};
    (recipe&&recipe.base||[]).forEach(function(r){if(r&&r.ing&&isPackaging(r.ing,inventory,categories))out.base.push(r);});
    var group=(recipe&&recipe.choiceAdd||{})[TEMP_GROUP]||{};
    ['Hot','Iced'].forEach(function(label){
      var block=group[label];if(!block||!Array.isArray(block.ings))return;
      block.ings.forEach(function(r){if(r&&r.ing&&isPackaging(r.ing,inventory,categories))out[label.toLowerCase()].push(r);});
    });
    return out;
  }
  function offersTemperature(item){
    return Array.isArray(item&&item.options)&&item.options.indexOf(TEMP_GROUP)>=0;
  }
  /* Build the proposal: the distinct packaging sets that already exist become serve styles,
     the drinks that carry each one are assigned to it, and drinks carrying none are listed
     as gaps for the user to place by hand. */
  function propose(recipes,inventory,menuItems,categories){
    var styles={},assignments=[],gaps=[];
    Object.keys(recipes||{}).sort().forEach(function(key){
      var recipe=recipes[key]||{},item=(menuItems||{})[key]||{};
      var found=packagingOf(recipe,inventory,categories);
      var temp=offersTemperature(item);
      function register(rows,label,where){
        if(!rows.length)return null;
        var normalised=normalise(rows,recipe,inventory);
        var sig=signature(normalised,recipe);
        var existing=null;
        Object.keys(styles).forEach(function(id){if(styles[id].signature===sig)existing=id;});
        if(!existing){
          existing=styleIdFor(label+'_'+(Object.keys(styles).length+1));
          styles[existing]={id:existing,name:label,signature:sig,rows:normalised,drinks:[],source:where};
        }
        styles[existing].drinks.push(String(item.name||key));
        return existing;
      }
      var name=String(item.name||key),category=String(item.cat||'');
      var hotStyle=register(found.hot,'Hot cup','choice');
      var icedStyle=register(found.iced,'Iced cup','choice');
      var baseStyle=register(found.base,temp?'Iced cup':(category==='soda'?'Soda cup':category==='nonfrappe'||category==='frappe'?'Blended cup':'Cup'),'base');
      if(!hotStyle&&!icedStyle&&!baseStyle){
        gaps.push({key:key,name:name,cat:category,offersTemperature:temp});
        return;
      }
      assignments.push({key:key,name:name,cat:category,offersTemperature:temp,
        hotStyle:hotStyle||null,icedStyle:icedStyle||(temp?null:null),baseStyle:baseStyle||null,
        stripBase:found.base.length>0,stripHot:found.hot.length>0,stripIced:found.iced.length>0});
    });
    var list=Object.keys(styles).map(function(id){var s=styles[id];return {id:id,name:s.name,rows:s.rows,drinks:s.drinks,source:s.source};});
    return {version:VERSION,styles:list,assignments:assignments,gaps:gaps,
      summary:{recipes:Object.keys(recipes||{}).length,styles:list.length,
        carryingPackaging:assignments.length,withoutPackaging:gaps.length}};
  }
  /* The proposal above finds nine packaging sets that differ only in how many tissues and which
     straw. Three real styles sit underneath them - hot, iced, blended - and the majority pattern
     of the drinks that already carry packaging decides what each one holds. */
  function majorityStyle(proposal,names){
    var best=null;
    (proposal.styles||[]).forEach(function(style){
      if(names.indexOf(style.name)<0)return;
      /* The set most drinks already use wins. On a tie the fuller set wins, because a set that
         is missing the serviette is the incomplete one, not a different style. */
      if(!best)best=style;
      else if(style.drinks.length>best.drinks.length)best=style;
      else if(style.drinks.length===best.drinks.length&&style.rows.length>best.rows.length)best=style;
    });
    return best?best.rows.slice():null;
  }
  function canonical(proposal,inventory){
    var blended=majorityStyle(proposal,['Blended cup']),
        iced=majorityStyle(proposal,['Soda cup','Iced cup']),
        hot=majorityStyle(proposal,['Hot cup']);
    /* A hot cup is handed over with the same serviette as a cold one. Only one drink had ever
       defined a hot style and it listed none, so carry the cold count across rather than let
       hot drinks look cheaper than they are. */
    if(hot&&iced){
      var serviette=null;
      iced.forEach(function(row){
        var name=String(((inventory||{})[row.ing]||{}).name||'');
        if(!serviette&&/tissue|napkin|serviette/i.test(name))serviette=row;
      });
      if(serviette&&!hot.some(function(row){return row.ing===serviette.ing;}))hot=hot.concat([JSON.parse(JSON.stringify(serviette))]);
    }
    var styles={};
    if(hot)styles.hot={name:'Hot',description:'Served hot - double wall cup, flat lid and a serviette.',rows:hot};
    if(iced)styles.iced={name:'Iced',description:'Served over ice - cold cup, strawless lid, thin straw and a serviette.',rows:iced};
    if(blended)styles.blended={name:'Blended',description:'Blended - cold cup, dome lid, thick straw and a serviette.',rows:blended};
    return styles;
  }
  /* Which style a drink gets. A drink that offers Temperature is answered by the choice itself,
     so the choice carries the style and the drink only needs a fallback. */
  function assign(recipes,menuItems,styles){
    styles=styles||{};
    var items={},choices={},unassigned=[];
    /* Never point a drink at a serve style that does not exist - it would cost nothing and say
       nothing. Prefer the closest style that does, and list the drink if none fits. */
    function pick(list){
      for(var i=0;i<list.length;i++)if(styles[list[i]])return list[i];
      return null;
    }
    Object.keys(recipes||{}).sort().forEach(function(key){
      var item=(menuItems||{})[key]||{},cat=String(item.cat||''),style;
      if(offersTemperature(item))style=pick(['iced','blended','hot']);
      else if(cat==='frappe'||cat==='nonfrappe')style=pick(['blended','iced']);
      else if(cat==='soda')style=pick(['iced','blended']);
      else style=null;
      if(style)items[key]=style;
      else unassigned.push({key:key,name:String(item.name||key),cat:cat});
    });
    var temp={};
    if(styles.hot)temp.Hot='hot';
    if(styles.iced)temp.Iced='iced';
    if(Object.keys(temp).length)choices[TEMP_GROUP]=temp;
    return {items:items,choices:choices,unassigned:unassigned};
  }
  /* Everything the repair writes: the styles, the style each drink is served in, and the removal
     of the packaging rows the recipes carried themselves. Recipe ingredients are untouched. */
  /* The shared option library can hold packaging too - its Hot and Iced entries carry the cup.
     Once a serve style supplies it, leaving it there charges the cup twice. */
  function stripLibrary(optionCosts,inventory,categories){
    var updates={},stripped=[];
    Object.keys(optionCosts||{}).forEach(function(gid){
      Object.keys(optionCosts[gid]||{}).forEach(function(key){
        var entry=optionCosts[gid][key]||{},rows=Array.isArray(entry.ings)?entry.ings:[];
        var kept=rows.filter(function(r){return !(r&&r.ing&&isPackaging(r.ing,inventory,categories));});
        if(kept.length===rows.length)return;
        stripped.push({gid:gid,key:key,label:String(entry.label||key),
          removed:rows.length-kept.length,emptied:kept.length===0});
        updates['posSettings/optionCosts/'+gid+'/'+key]=kept.length?{label:entry.label||key,ings:kept}:null;
      });
    });
    return {updates:updates,stripped:stripped};
  }
  function applyPlan(recipes,inventory,menuItems,categories,options){
    options=options||{};
    var proposal=propose(recipes,inventory,menuItems,categories);
    var styles=options.styles||canonical(proposal,inventory);
    var mapping=assign(recipes,menuItems,styles);
    var updates={},stripped=[];
    /* Written as one node so a style removed on screen is removed in the data too. */
    updates['packagingRules']=styles;
    Object.keys(mapping.items).forEach(function(key){updates['menuItems/'+key+'/serveStyle']=mapping.items[key];});
    Object.keys(recipes||{}).forEach(function(key){
      var recipe=recipes[key]||{},found=packagingOf(recipe,inventory,categories);
      if(!found.base.length&&!found.hot.length&&!found.iced.length)return;
      var removed=[];
      if(found.base.length){
        var keep=(recipe.base||[]).filter(function(r){return !(r&&r.ing&&isPackaging(r.ing,inventory,categories));});
        updates['recipes/'+key+'/base']=keep;
        found.base.forEach(function(r){removed.push(r.ing);});
      }
      ['Hot','Iced'].forEach(function(label){
        var block=((recipe.choiceAdd||{})[TEMP_GROUP]||{})[label];
        if(!block||!Array.isArray(block.ings))return;
        var kept=block.ings.filter(function(r){return !(r&&r.ing&&isPackaging(r.ing,inventory,categories));});
        if(kept.length===block.ings.length)return;
        block.ings.forEach(function(r){if(isPackaging(r.ing,inventory,categories))removed.push(r.ing);});
        updates['recipes/'+key+'/choiceAdd/'+TEMP_GROUP+'/'+label]=kept.length?{label:label,ings:kept}:null;
      });
      if(removed.length)stripped.push({key:key,name:String(((menuItems||{})[key]||{}).name||key),removed:removed});
    });
    var library=stripLibrary(options.optionCosts,inventory,categories);
    Object.keys(library.updates).forEach(function(path){updates[path]=library.updates[path];});
    return {version:VERSION,styles:styles,mapping:mapping,updates:updates,stripped:stripped,
      proposal:proposal,choiceUpdates:mapping.choices,unassigned:mapping.unassigned,
      libraryStripped:library.stripped};
  }
  return {VERSION:VERSION,SIZES:SIZES,TEMP_GROUP:TEMP_GROUP,propose:propose,isPackaging:isPackaging,
    packagingOf:packagingOf,normalise:normalise,signature:signature,styleIdFor:styleIdFor,effQty:effQty,
    canonical:canonical,assign:assign,applyPlan:applyPlan,stripLibrary:stripLibrary};
});
