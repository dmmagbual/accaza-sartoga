(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaCogsDuplicationAudit=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - find COGS already posted twice by a temperature choice.
     A "Hot" choice that repeated the whole recipe was ADDED to the base, so the order's own
     posted cost detail carries the same ingredient twice: once from the base and again from
     the choice. This reads only that posted record - never the recipe - so it keeps working
     after the recipes are repaired, and it is what the correction is evidenced by. */
  var VERSION='cogs-dup-1';
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function n(v){var x=Number(v);return Number.isFinite(x)?x:0;}
  function money(v){return Math.round(n(v)*100)/100;}
  function q6(v){return Math.round(n(v)*1000000)/1000000;}
  function monthKey(order){
    var ms=n(order&&(order.timestamp||order.archivedAt));
    if(!ms){
      var text=String((order&&(order.date||order.archivedDate))||'');
      var m=/^([A-Za-z]+)\s+\d+,\s+(\d{4})$/.exec(text);
      if(m){var ix=MONTHS.indexOf(m[1]);if(ix>=0)return m[2]+'-'+('0'+(ix+1)).slice(-2);}
      return 'unknown';
    }
    var d=new Date(ms);
    return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);
  }
  /* The last millisecond of that month, so the correction lands in the period it belongs to. */
  function monthEnd(key,now){
    var parts=/^(\d{4})-(\d{2})$/.exec(String(key));
    if(!parts)return n(now)||Date.now();
    var end=new Date(Number(parts[1]),Number(parts[2]),0,23,59,59,0).getTime();
    var stamp=n(now)||Date.now();
    return end>stamp?stamp:end;
  }
  function audit(orders,options){
    options=options||{};
    var rows={},skipped=[],review=[],orderCount=0,lineCount=0,postedTotal=0,byMonth={},byDrink={};
    Object.keys(orders||{}).forEach(function(orderId){
      var order=orders[orderId]||{},detail=order.cogsDetail;
      if(!detail||!Array.isArray(detail.lines)||!detail.lines.length)return;
      orderCount++;
      detail.lines.forEach(function(line){postedTotal+=n(line.totalCost);});
      var groups={};
      detail.lines.forEach(function(line){
        var key=String(line.itemKey||'')+'|'+String(line.size||'');
        (groups[key]=groups[key]||[]).push(line);
      });
      (order.lineItems||[]).forEach(function(item){
        if(!item)return;
        var labels=(item.optLabels||[]).map(String);
        /* Only a Hot choice was ever written as the whole recipe over again. A milk or syrup
           choice that adds an ingredient the base already holds is a genuine addition, so the
           base test is asked only of Hot. The library-versus-own test needs no such gate: one
           choice defined twice is wrong whatever was chosen. */
        var repeatsBase=labels.indexOf('Hot')>=0||labels.indexOf('hot')>=0;
        var group=groups[String(item.itemKey||'')+'|'+String(item.size||'')];
        if(!group)return;
        /* An extra shot legitimately adds an ingredient the base already holds, so a line that
           chose one cannot be told apart from the duplicate. Report it, never correct it. */
        var ambiguous=labels.some(function(label){return /shot|extra|add/i.test(label);});
        /* Three places one ingredient can be charged from: the base recipe, the shared option
           library, and the drink's own copy of that same choice. Only one option definition
           should ever apply, and a choice that repeats the base adds nothing on top of it. */
        var base={},shared={},own={},names={};
        group.forEach(function(line){
          var id=String(line.ingredientId||'');if(!id)return;
          var source=String(line.source||'');
          var side=source==='base'?base:source==='option_global'?shared:own;
          var cell=side[id]||(side[id]={cost:0,qty:0});
          cell.cost+=n(line.totalCost);cell.qty+=n(line.totalQuantity);
          names[id]=names[id]||{name:String(line.ingredientName||id),unit:String(line.stockUnit||'')};
        });
        var month=monthKey(order),drink=String(item.name||(group[0]&&group[0].itemName)||item.itemKey||'');
        var found=0;
        Object.keys(names).forEach(function(id){
          var b=base[id]||{cost:0,qty:0},g=shared[id]||{cost:0,qty:0},r=own[id]||{cost:0,qty:0};
          /* Only what a choice ADDS can duplicate the base. A milk swap takes milk away in the
             same breath, and subtracting that first would hide the duplicate behind it. */
          var addedCost=Math.max(g.cost,0)+Math.max(r.cost,0),addedQty=Math.max(g.qty,0)+Math.max(r.qty,0);
          var cost=repeatsBase?money(Math.min(addedCost,b.cost)):0,qty=repeatsBase?q6(Math.min(addedQty,b.qty)):0;
          /* The library and the drink's own copy both firing is also a duplicate, but the posted
             record says which SOURCE a row came from, not which choice - so on an order with more
             than one choice the two cannot be told apart. Report it; never post it blind. */
          if(g.cost>0&&r.cost>0)review.push({orderId:orderId,drink:drink,ingredient:names[id].name,
            labels:labels.join(' / '),cost:money(Math.min(g.cost,r.cost))});
          if(cost<=0||qty<=0)return;
          found+=cost;
          if(ambiguous)return;
          var key=id+'|'+month;
          var row=rows[key]||(rows[key]={itemId:id,name:names[id].name,unit:names[id].unit,month:month,qty:0,cost:0,orders:0});
          row.qty=q6(row.qty+qty);row.cost=money(row.cost+cost);row.orders++;
        });
        if(!found)return;
        if(ambiguous){skipped.push({orderId:orderId,drink:drink,labels:labels.join(' / '),cost:money(found)});return;}
        lineCount++;
        (byMonth[month]=byMonth[month]||{lines:0,cost:0});byMonth[month].lines++;byMonth[month].cost=money(byMonth[month].cost+found);
        (byDrink[drink]=byDrink[drink]||{lines:0,cost:0});byDrink[drink].lines++;byDrink[drink].cost=money(byDrink[drink].cost+found);
      });
    });
    var list=Object.keys(rows).map(function(k){return rows[k];}).sort(function(a,b){
      return a.month<b.month?-1:a.month>b.month?1:(b.cost-a.cost);
    });
    return {version:VERSION,rows:list,skipped:skipped,review:review,
      ordersRead:orderCount,linesCorrected:lineCount,postedTotal:money(postedTotal),
      historicCost:money(list.reduce(function(s,r){return s+r.cost;},0)),
      byMonth:byMonth,byDrink:byDrink};
  }
  /* Turn the schedule into stock movements. Quantity returns to stock at the cost ruling today,
     so the value restored can differ from what was expensed - that gap is reported, not hidden. */
  function movements(result,inventory,options){
    options=options||{};
    var now=n(options.now)||Date.now(),actor=String(options.actorName||'Admin');
    var out=[],restored=0,residual=0;
    (result.rows||[]).forEach(function(row){
      var item=(inventory||{})[row.itemId];
      if(!item)return;
      var unitCost=n(item.cost),value=money(row.qty*unitCost);
      restored+=value;residual=money(residual+(row.cost-value));
      out.push({movement:{
        movementId:'costfix_'+row.month.replace('-','')+'_'+row.itemId,
        itemId:row.itemId,type:'adjustment',qty:row.qty,
        offsetAccount:String(options.offsetAccount||'5000'),
        adjustmentNature:'costing-correction',
        sourceType:'cogs-duplication-correction',
        sourceId:'costfix_'+row.month.replace('-',''),
        note:'Stock returned - a Hot choice repeated the whole recipe and charged it twice ('+row.month+')',
        actorName:actor,occurredAt:monthEnd(row.month,now)
      },schedule:{itemId:row.itemId,name:row.name,unit:row.unit,month:row.month,qty:row.qty,
        expensed:row.cost,restored:value,residual:money(row.cost-value),unitCost:unitCost,orders:row.orders}});
    });
    return {movements:out.map(function(x){return x.movement;}),schedule:out.map(function(x){return x.schedule;}),
      restoredValue:money(restored),residualValue:money(residual),
      historicCost:money(result.historicCost)};
  }
  return {VERSION:VERSION,audit:audit,movements:movements,monthKey:monthKey,monthEnd:monthEnd};
});
