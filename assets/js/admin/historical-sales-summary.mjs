function dateKey(timestamp){return new Date(Number(timestamp)+8*3600000).toISOString().slice(0,10);}
function zero(){return{orders:0,gross:0,discount:0,refund:0,net:0,cogs:0,channels:{},payments:{},items:{},hours:{},weekdays:{},cashiers:{},days:{}};}
function cashierLabel(value){return String(value||'').replace(/\s+/g,' ').trim().slice(0,120);}
export function canonicalCashierName(value){var token=cashierLabel(value).toLowerCase().replace(/[^a-z0-9]+/g,'');if(token.includes('rya'))return'Rya';if(token.includes('alex'))return'Alex';if(token.includes('louize'))return'Louize';return'Maria';}
export function reconcileCashierSales(summary,staff){
  var rows=Object.create(null),roster=new Map(),staffIds=new Map();
  function ensureRow(key,name){return rows[key]||(rows[key]={key:key,name:name,orders:0,cents:0});}
  (staff||[]).forEach(function(person){
    var name=cashierLabel(person&&person.name);if(!name)return;
    var token=name.toLowerCase(),key=person.id?'staff_id_'+person.id:token,entry={key:key,name:name};
    roster.set(token,roster.has(token)?null:entry);
    if(person.id)staffIds.set(key,entry);
    if(person.active!==false)ensureRow(key,name);
  });
  var maria=roster.get('maria')||{key:'maria',name:'Maria'},fallback=ensureRow(maria.key,maria.name);
  Object.entries(summary&&summary.cashiers||{}).forEach(function([key,source]){
    if(!source)return;
    var raw=cashierLabel(source.name||key),token=raw.toLowerCase(),alias=canonicalCashierName(raw);
    var target=staffIds.get(key);
    if(!target&&key.startsWith('staff_cashier_')){
      var originalId='staff_id_'+key.slice('staff_cashier_'.length);
      target=staffIds.get(originalId)||{key:originalId,name:raw};
    }
    if(!target&&roster.has(token)&&roster.get(token)===null)target={key:'legacy_'+token,name:raw+' (older records)'};
    target=target||roster.get(token)||roster.get(alias.toLowerCase())||{key:alias.toLowerCase(),name:alias};
    target=ensureRow(target.key,target.name);
    target.orders+=Number(source.orders)||0;
    target.cents+=Math.round((Number(source.net)||0)*100);
  });
  var expected=Math.round((Number(summary&&summary.net)||0)*100),assigned=Object.values(rows).reduce(function(sum,row){return sum+row.cents;},0),difference=expected-assigned;
  if(difference>=0)fallback.cents+=difference;
  else{
    var remaining=-difference;
    var fallbackTake=Math.min(fallback.cents,remaining);fallback.cents-=fallbackTake;remaining-=fallbackTake;
    Object.values(rows).forEach(function(row){if(row===fallback)return;var take=Math.min(row.cents,remaining);row.cents-=take;remaining-=take;});
  }
  Object.values(rows).forEach(function(row){row.net=row.cents/100;delete row.cents;});
  return rows;
}
function addMap(target,source,items){Object.keys(source||{}).forEach(function(key){var row=source[key]||{},out=target[key]||(items?{name:String(row.name||key),categoryId:String(row.categoryId||''),units:0,net:0}:{orders:0,net:0});if(items){out.name=String(row.name||out.name||key);out.categoryId=String(row.categoryId||out.categoryId||'');out.units+=Number(row.units)||0;out.net+=(Number(row.netCents)||0)/100;}else{out.orders+=Number(row.orders)||0;out.net+=(Number(row.netCents)||0)/100;}target[key]=out;});}
function addDay(target,key,row){var day=target.days[key]||(target.days[key]={orders:0,gross:0,discount:0,refund:0,net:0,cogs:0,channels:{},payments:{},items:{},hours:{},cashiers:{}});day.orders+=Number(row.orders)||0;day.gross+=(Number(row.grossCents)||0)/100;day.discount+=(Number(row.discountCents)||0)/100;day.refund+=(Number(row.refundCents)||0)/100;day.net+=(Number(row.netCents)||0)/100;day.cogs+=(Number(row.cogsCents)||0)/100;addMap(day.channels,row.channels,false);addMap(day.payments,row.payments,false);addMap(day.items,row.items,true);addMap(day.hours,row.hours,false);addMap(day.cashiers,row.cashiers,false);Object.keys(row.cashiers||{}).forEach(function(cashier){if(day.cashiers[cashier])day.cashiers[cashier].name=String((row.cashiers[cashier]||{}).name||cashier);});return day;}
function mergeDay(target,key,row){var day=addDay(target,key,row),orders=Number(row.orders)||0,netCents=Number(row.netCents)||0,weekday=String(new Date(key+'T12:00:00+08:00').getUTCDay());target.orders+=orders;target.gross+=(Number(row.grossCents)||0)/100;target.discount+=(Number(row.discountCents)||0)/100;target.refund+=(Number(row.refundCents)||0)/100;target.net+=netCents/100;target.cogs+=(Number(row.cogsCents)||0)/100;addMap(target.channels,row.channels,false);addMap(target.payments,row.payments,false);addMap(target.items,row.items,true);addMap(target.hours,row.hours,false);addMap(target.cashiers,row.cashiers,false);Object.keys(row.cashiers||{}).forEach(function(cashier){if(target.cashiers[cashier])target.cashiers[cashier].name=String((row.cashiers[cashier]||{}).name||cashier);});addMap(target.weekdays,{[weekday]:{orders:orders,netCents:netCents}},false);return day;}

// Only compact, precomputed day records are accepted here. This intentionally
// has no raw-order fallback: a missing summary must be prepared by controlled
// maintenance, never by downloading an entire month into an Admin browser.
export function summarizeHistoricalSales(months, period){
  var start=dateKey(period.startAt!=null?period.startAt:period.start),end=dateKey(period.endAt!=null?period.endAt:period.end),result=zero();
  Object.values(months||{}).forEach(function(month){if(Number(month&&month.schemaVersion)<2)return;Object.keys(month.days||{}).sort().forEach(function(key){if(key>=start&&key<=end)mergeDay(result,key,month.days[key]||{});});});
  // Cashier and weekday analytics come from the selected daily rows. Month-level
  // aggregates answer a whole-month question only and must never leak into MTD.
  return result;
}

export function addLiveSales(summary,orders,period,sales){
  period={startAt:period.startAt!=null?period.startAt:period.start,endAt:period.endAt!=null?period.endAt:period.end};
  var result=summary||zero();(orders||[]).forEach(function(order){if(!sales.qualifies(order))return;var stamp=sales.stamp(order);if(stamp<period.startAt||stamp>period.endAt)return;var amount=sales.amounts(order),key=dateKey(stamp),hour=String(new Date(stamp+8*3600000).getUTCHours()),weekday=String(new Date(stamp+8*3600000).getUTCDay()),cashierName=cashierLabel(order.soldBy||order.soldByName||order.staff||order.cashier||order.completedByName)||'Maria',staffId=String(order.soldByStaffId||'').trim(),cashierKey=/^[a-zA-Z0-9_-]{1,120}$/.test(staffId)?'staff_'+(order.soldByRole==='cashier'?'cashier':'id')+'_'+staffId:'staff_'+cashierName.toLowerCase(),day=result.days[key]||(result.days[key]={orders:0,gross:0,discount:0,refund:0,net:0,cogs:0,channels:{},payments:{},items:{},hours:{},cashiers:{}}),reported=String(order.channel||"").toLowerCase(),channel=reported==='grabfood'||reported==='foodpanda'||reported==='instore'||reported==='online'?reported:(order.source&&order.source!=='pos'?'online':'instore'),payment=sales.paymentKey({method:order.payment||"Unspecified"}),lines=Array.isArray(order.correctedLineItems||order.lineItems)?(order.correctedLineItems||order.lineItems):[];
    [result,day].forEach(function(target){target.orders++;target.gross+=amount.gross;target.discount+=amount.discount;target.refund+=amount.refund;target.net+=amount.net;var c=target.channels[channel]||(target.channels[channel]={orders:0,net:0});c.orders++;c.net+=amount.net;var p=target.payments[payment]||(target.payments[payment]={orders:0,net:0});p.orders++;p.net+=amount.net;var h=target.hours[hour]||(target.hours[hour]={orders:0,net:0});h.orders++;h.net+=amount.net;});
    var cashier=result.cashiers[cashierKey]||(result.cashiers[cashierKey]={name:cashierName,orders:0,net:0}),dayCashier=day.cashiers[cashierKey]||(day.cashiers[cashierKey]={name:cashierName,orders:0,net:0}),dow=result.weekdays[weekday]||(result.weekdays[weekday]={orders:0,net:0});cashier.name=cashierName;cashier.orders++;cashier.net+=amount.net;dayCashier.name=cashierName;dayCashier.orders++;dayCashier.net+=amount.net;dow.orders++;dow.net+=amount.net;
    var factor=amount.gross>0?Math.max(0,amount.net/amount.gross):0;lines.forEach(function(line,index){var itemKey=String(line&&(line.itemKey||line.key||line.name)||('line_'+index)),name=String(line&&(line.name||line.itemName||line.itemKey)||itemKey),categoryId=String(line&&(line.categoryId||line.category||line.cat)||''),units=Math.max(0,Number(line&&line.qty)||0),net=units*(Number(line&&line.unitTotal)||0)*factor;[result,day].forEach(function(target){var item=target.items[itemKey]||(target.items[itemKey]={name:name,categoryId:categoryId,units:0,net:0});item.name=name;item.categoryId=categoryId||item.categoryId||'';item.units+=units;item.net+=net;});});
  });return result;
}
