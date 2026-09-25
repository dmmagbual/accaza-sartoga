// Accaza AI analytics tools (Sep 2026). Trends, patterns, item performance, margins and
// bundles for management analysis. They READ the existing reporting rollup
// (Firestore historicalSalesMonths, maintained by the archive trigger) and, for bundles, the
// archived order replicas. Nothing here writes to the Realtime Database or changes any POS,
// admin, order, inventory or Finance Books record; the only write is this feature's own
// Firestore read-allowance counter (aiAnalyticsUsage/{day}). All maths is done here in code,
// in integer centavos; the model only interprets the results.
const ACCAZA_AI_ANALYTICS_MAX_DAYS = 92;
const ACCAZA_AI_TREND_MAX_MONTHS = 12;
const ACCAZA_AI_PAIRS_MAX_DAYS = 31;
const ACCAZA_AI_PAIRS_MAX_ORDERS = 500;
const ACCAZA_AI_FIRESTORE_DAILY_READ_CAP = 3000;
const ACCAZA_AI_COSTED_ITEMS = 25;
const ACCAZA_AI_WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const ACCAZA_AI_STRATEGY_GUIDE = "For trends, strategy and marketing questions use the analytics tools: get_sales_trend (month by month), get_sales_patterns (days, weekdays, hours, paydays, unusual days), get_item_performance (best and weakest items; include_cost for margins and the menu-engineering class) and get_item_pairs (items bought together, for bundles). Base every suggestion on a figure from these results and say which figure supports it; prefer specific, low-cost actions a small coffee shop can run this month (bundles, time-slot promos, menu placement, pricing tests, channel-specific offers), and say how to measure whether each one worked. Item costs are current recipe costs at medium size and item prices are actual average net prices, so call margins estimates. Platform (GrabFood, FoodPanda) item revenue is before platform commissions.";
function accazaAiPesos(cents){return Math.round(Number(cents)||0)/100;}
function accazaAiPct(part,whole){return Number(whole)?Math.round(Number(part)/Number(whole)*1000)/10:null;}
function accazaAiBaseItemName(name){return String(name||"").replace(/\s*\((?:XS|S|M|L|XL|Small|Medium|Large|Regular|Solo|Hot|Iced|\d+\s?oz)\)\s*$/i,"").trim()||String(name||"");}
function accazaAiMonthsBetween(from,to){
  if(!/^\d{4}-\d{2}$/.test(from)||!/^\d{4}-\d{2}$/.test(to))return{error:"Use months as YYYY-MM."};
  let [year,month]=from.split("-").map(Number);const [endYear,endMonth]=to.split("-").map(Number),list=[];
  if(endYear*12+endMonth<year*12+month)return{error:"month_to is before month_from."};
  while(year*12+month<=endYear*12+endMonth){list.push(`${year}-${String(month).padStart(2,"0")}`);month+=1;if(month>12){month=1;year+=1;}if(list.length>ACCAZA_AI_TREND_MAX_MONTHS)return{error:`At most ${ACCAZA_AI_TREND_MAX_MONTHS} months at a time.`};}
  return{months:list};
}
// One Firestore counter per Manila day caps what the AI may read, so it can never crowd the
// POS and reports out of the shared free daily quota.
// A negative count returns an unused reservation (the bundle query reserves its maximum first).
async function accazaAiClaimFirestoreReads(ctx,count){
  const firestore=getFirestore(),day=financeDateFromTimestamp(Date.now()),ref=firestore.collection("aiAnalyticsUsage").doc(day);
  const allowed=await firestore.runTransaction(async transaction=>{const snap=await transaction.get(ref),used=Number(snap.exists&&snap.data().reads||0);if(count>0&&used+count>ACCAZA_AI_FIRESTORE_DAILY_READ_CAP)return false;transaction.set(ref,{day,reads:Math.max(0,used+count),updatedAt:Date.now()},{merge:true});return true;});
  if(!allowed)throw new Error(`today's AI analytics read allowance (${ACCAZA_AI_FIRESTORE_DAILY_READ_CAP} reads) is used up; try again tomorrow`);
  ctx.firestoreReads=Math.max(0,(ctx.firestoreReads||0)+count);
}
async function accazaAiSalesMonthDocs(ctx,months){
  ctx.salesMonths=ctx.salesMonths||{};const missing=months.filter(month=>!(month in ctx.salesMonths));
  if(missing.length){await accazaAiClaimFirestoreReads(ctx,missing.length);const firestore=getFirestore(),snaps=await firestore.getAll(...missing.map(month=>firestore.collection(HistoricalArchive.MONTH_COLLECTION).doc(month)));snaps.forEach((snap,index)=>{ctx.salesMonths[missing[index]]=snap.exists?snap.data()||{}:null;});}
  return months.map(month=>({month,data:ctx.salesMonths[month]}));
}
function accazaAiRangeMonths(range){return[...new Set(range.days.map(day=>day.slice(0,7)))];}
async function accazaAiRangeDays(ctx,range){
  const docs=await accazaAiSalesMonthDocs(ctx,accazaAiRangeMonths(range)),days={};
  docs.forEach(doc=>{const monthDays=doc.data&&doc.data.days||{};range.days.forEach(day=>{if(monthDays[day])days[day]=monthDays[day];});});
  return{days,monthsRead:docs.length};
}
function accazaAiAddItems(target,items){Object.entries(items||{}).forEach(([key,row])=>{const current=target[key]||(target[key]={name:accazaAiBaseItemName(row&&row.name||key),categoryId:String(row&&row.categoryId||""),units:0,netCents:0});current.units+=Number(row&&row.units)||0;current.netCents+=Number(row&&row.netCents)||0;if(row&&row.categoryId)current.categoryId=String(row.categoryId);});}
async function accazaAiItemCosts(db,keys){
  if(!keys.length)return{};
  const [menuSnap,settings,...recipeSnaps]=await Promise.all([/* download-ok: catalog menu items for recipe costing */db.ref("/menuItems").get(),readPosSettings(db,["sharedBaseIngredients","optionCosts","packagingAssignments"]),...keys.map(key=>db.ref(`/recipes/${key}`).get())]);
  const menu=menuSnap.val()||{};
  return readCatalogKeyed(db,["inventory","optionGroups","packagingRules"],maps=>{const out={};keys.forEach((key,index)=>{const recipe=recipeSnaps[index].val();if(!recipe||!menu[key]){out[key]=null;return;}try{const cost=Costing.costRecipe({itemKey:key,item:menu[key],recipe,size:"M",inventory:maps.inventory,sharedBaseIngredients:settings.sharedBaseIngredients||{},optionCosts:settings.optionCosts||{},optionGroups:maps.optionGroups,packagingRules:maps.packagingRules,packagingAssignments:settings.packagingAssignments||{}});out[key]={costCents:Math.round((Number(cost.totalCost)||0)*100),covered:cost.cogsCovered!==false};}catch(_error){out[key]=null;}});return out;});
}
Object.assign(ACCAZA_AI_RECORD_TOOLS,{
  get_sales_trend:{
    description:"Month-by-month sales trend (up to 12 months) from the sales reporting rollup: orders, gross, discounts, refunds, net sales, cost of sales, gross margin %, average ticket, net per trading day and channel mix, with the change from the previous month.",
    params:{month_from:{type:"string",description:"First month, YYYY-MM."},month_to:{type:"string",description:"Last month, YYYY-MM."}},
    async run(_db,_range,args,ctx){
      const span=accazaAiMonthsBetween(String(args&&args.month_from||"").trim(),String(args&&args.month_to||args&&args.month_from||"").trim());if(span.error)return{records:0,result:{error:span.error}};
      const docs=await accazaAiSalesMonthDocs(ctx,span.months);let previous=null;
      const months=docs.map(({month,data})=>{
        if(!data)return{month,noSales:true};
        const net=Number(data.netCents)||0,orders=Number(data.orders)||0,tradingDays=Object.keys(data.days||{}).length,channels={};
        Object.entries(data.channels||{}).forEach(([key,row])=>{channels[key]={orders:Number(row.orders)||0,net:accazaAiPesos(row.netCents),sharePct:accazaAiPct(row.netCents,net)};});
        const row={month,orders,gross:accazaAiPesos(data.grossCents),discounts:accazaAiPesos(data.discountCents),refunds:accazaAiPesos(data.refundCents),net:accazaAiPesos(net),costOfSales:accazaAiPesos(data.cogsCents),grossMarginPct:accazaAiPct(net-(Number(data.cogsCents)||0),net),averageTicket:orders?accazaAiPesos(net/orders):null,tradingDays,netPerTradingDay:tradingDays?accazaAiPesos(net/tradingDays):null,channels};
        if(previous)row.changeFromPreviousMonth={netPct:accazaAiPct(net-previous.netCents,previous.netCents),ordersPct:accazaAiPct(orders-previous.orders,previous.orders),averageTicketPct:previous.orders&&orders?accazaAiPct(net/orders-previous.netCents/previous.orders,previous.netCents/previous.orders):null};
        previous={netCents:net,orders};return row;
      });
      return{records:docs.length,result:{source:"historicalSalesMonths (sales reporting rollup; completed, non-voided sales)",months,note:"A month still in progress is partial; compare net per trading day instead of totals."}};
    },
  },
  get_sales_patterns:{
    description:"Sales patterns for a Manila date range (up to 92 days) from the sales reporting rollup: daily series, average by weekday, busiest and quietest hours, payday (15th-16th, the last two days of the month and the 1st) versus other days, best and worst days, unusual days, and channel totals.",
    days:ACCAZA_AI_ANALYTICS_MAX_DAYS,
    async run(_db,range,_args,ctx){
      const {days,monthsRead}=await accazaAiRangeDays(ctx,range),series=[],weekday={},hours={},channels={};let payday={days:0,netCents:0,orders:0},other={days:0,netCents:0,orders:0};
      range.days.forEach(day=>{const row=days[day];if(!row)return;const net=Number(row.netCents)||0,orders=Number(row.orders)||0,date=new Date(`${day}T00:00:00+08:00`),dow=ACCAZA_AI_WEEKDAYS[new Date(date.getTime()+8*3600000).getUTCDay()],dom=Number(day.slice(8,10)),lastDay=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).getUTCDate();
        series.push({date:day,weekday:dow,orders,net:accazaAiPesos(net)});
        const w=weekday[dow]||(weekday[dow]={days:0,orders:0,netCents:0});w.days+=1;w.orders+=orders;w.netCents+=net;
        const bucket=dom===15||dom===16||dom===1||dom>=lastDay-1?payday:other;bucket.days+=1;bucket.netCents+=net;bucket.orders+=orders;
        Object.entries(row.hours||{}).forEach(([hour,value])=>{const h=hours[hour]||(hours[hour]={orders:0,netCents:0});h.orders+=Number(value.orders)||0;h.netCents+=Number(value.netCents)||0;});
        Object.entries(row.channels||{}).forEach(([key,value])=>{const c=channels[key]||(channels[key]={orders:0,netCents:0});c.orders+=Number(value.orders)||0;c.netCents+=Number(value.netCents)||0;});
      });
      const nets=series.map(row=>row.net),mean=nets.length?nets.reduce((a,b)=>a+b,0)/nets.length:0,sd=nets.length>2?Math.sqrt(nets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(nets.length-1)):0;
      const sorted=[...series].sort((a,b)=>b.net-a.net),totalNet=series.reduce((a,b)=>a+Math.round(b.net*100),0);
      const hourRows=Object.entries(hours).map(([hour,row])=>({hour:`${String(hour).padStart(2,"0")}:00`,orders:row.orders,net:accazaAiPesos(row.netCents),sharePct:accazaAiPct(row.netCents,totalNet)})).sort((a,b)=>a.hour.localeCompare(b.hour));
      const avg=bucket=>bucket.days?{days:bucket.days,averageNet:accazaAiPesos(bucket.netCents/bucket.days),averageOrders:Math.round(bucket.orders/bucket.days*10)/10}:{days:0};
      return{records:monthsRead,result:{source:"historicalSalesMonths daily rows",range:`${range.from} to ${range.to}`,tradingDays:series.length,daysWithoutSales:range.days.length-series.length,totalNet:accazaAiPesos(totalNet),averageNetPerTradingDay:series.length?Math.round(mean*100)/100:null,
        byWeekday:ACCAZA_AI_WEEKDAYS.filter(day=>weekday[day]).map(day=>({weekday:day,tradingDays:weekday[day].days,averageNet:accazaAiPesos(weekday[day].netCents/weekday[day].days),averageOrders:Math.round(weekday[day].orders/weekday[day].days*10)/10})),
        byHour:hourRows,paydayVersusOtherDays:{payday:avg(payday),other:avg(other)},bestDays:sorted.slice(0,3),worstDays:sorted.slice(-3).reverse(),
        unusualDays:sd>0?series.filter(row=>Math.abs(row.net-mean)>2*sd).map(row=>Object.assign({},row,{versusAveragePct:accazaAiPct(row.net-mean,mean)})):[],
        channels:Object.fromEntries(Object.entries(channels).map(([key,row])=>[key,{orders:row.orders,net:accazaAiPesos(row.netCents),sharePct:accazaAiPct(row.netCents,totalNet)}])),dailySeries:series}};
    },
  },
  get_item_performance:{
    description:"Item performance for a Manila date range (up to 92 days) from the sales reporting rollup: units, net sales, share and average price per item, change between the first and second half of the range, best sellers and slow sellers. With include_cost, adds each top item's current recipe cost, estimated unit margin and its menu-engineering class (star, plowhorse, puzzle, dog).",
    days:ACCAZA_AI_ANALYTICS_MAX_DAYS,
    extra:{include_cost:{type:"boolean",description:"Also estimate unit margins and the menu-engineering class for the top items."}},
    async run(db,range,args,ctx){
      const {days,monthsRead}=await accazaAiRangeDays(ctx,range),half=Math.ceil(range.days.length/2),all={},first={},second={};
      range.days.forEach((day,index)=>{const row=days[day];if(!row)return;accazaAiAddItems(all,row.items);accazaAiAddItems(index<half?first:second,row.items);});
      const totalUnits=Object.values(all).reduce((a,b)=>a+b.units,0),totalNet=Object.values(all).reduce((a,b)=>a+b.netCents,0);
      const rows=Object.entries(all).map(([key,row])=>({key,name:row.name,category:row.categoryId||"",units:row.units,net:accazaAiPesos(row.netCents),netSharePct:accazaAiPct(row.netCents,totalNet),unitSharePct:accazaAiPct(row.units,totalUnits),averagePrice:row.units?accazaAiPesos(row.netCents/row.units):null,firstHalfUnits:first[key]?first[key].units:0,secondHalfUnits:second[key]?second[key].units:0})).sort((a,b)=>b.net-a.net);
      rows.forEach(row=>{row.unitChangePct=accazaAiPct(row.secondHalfUnits-row.firstHalfUnits,row.firstHalfUnits);});
      let records=monthsRead,menuEngineering=null;
      if(args&&args.include_cost===true&&rows.length){
        const top=rows.slice(0,ACCAZA_AI_COSTED_ITEMS),costs=await accazaAiItemCosts(db,top.map(row=>row.key));records+=top.length+3;
        const costed=top.filter(row=>costs[row.key]&&costs[row.key].costCents>0&&row.averagePrice!=null);
        costed.forEach(row=>{const cost=costs[row.key];row.recipeCostM=accazaAiPesos(cost.costCents);row.estimatedUnitMargin=Math.round((row.averagePrice-row.recipeCostM)*100)/100;row.estimatedMarginPct=accazaAiPct(row.estimatedUnitMargin,row.averagePrice);if(!cost.covered)row.costIncomplete=true;});
        const unitsTotal=costed.reduce((a,b)=>a+b.units,0),popularityLine=costed.length?0.7/costed.length:0,marginLine=unitsTotal?costed.reduce((a,b)=>a+b.estimatedUnitMargin*b.units,0)/unitsTotal:0;
        costed.forEach(row=>{const popular=unitsTotal&&row.units/unitsTotal>=popularityLine,profitable=row.estimatedUnitMargin>=marginLine;row.menuClass=popular&&profitable?"star":popular?"plowhorse":profitable?"puzzle":"dog";});
        menuEngineering={method:"Kasavana-Smith: popular = at least 70% of an equal share of units among costed items; profitable = unit margin at or above the units-weighted average",averageUnitMargin:Math.round(marginLine*100)/100,itemsWithoutRecipeCost:top.filter(row=>!costed.includes(row)).map(row=>row.name),meaning:{star:"keep, feature and protect quality",plowhorse:"popular but thin margin: review price, portion or recipe cost",puzzle:"good margin but slow: promote, reposition or bundle",dog:"slow and thin: consider replacing or reworking"}};
      }
      return{records,result:{source:"historicalSalesMonths daily item rows (sizes combined per item)",range:`${range.from} to ${range.to}`,itemCount:rows.length,totalUnits,totalNet:accazaAiPesos(totalNet),topItems:rows.slice(0,30),slowSellers:rows.filter(row=>row.units>0).sort((a,b)=>a.units-b.units).slice(0,10).map(row=>({name:row.name,units:row.units,net:row.net})),menuEngineering}};
    },
  },
  get_item_pairs:{
    description:"Items bought together in the same order over a Manila date range (up to 31 days, up to 500 orders) from the archived order copies: top pairs with how often they occur, the chance the second item is added when the first is bought, and lift. Use it for bundle and upsell ideas.",
    days:ACCAZA_AI_PAIRS_MAX_DAYS,
    async run(_db,range,_args,ctx){
      await accazaAiClaimFirestoreReads(ctx,ACCAZA_AI_PAIRS_MAX_ORDERS);
      const snap=await getFirestore().collection(HistoricalArchive.COLLECTION).where("salesAt",">=",range.start).where("salesAt","<",range.end).orderBy("salesAt").limit(ACCAZA_AI_PAIRS_MAX_ORDERS).select("order").get();
      if(snap.size<ACCAZA_AI_PAIRS_MAX_ORDERS)await accazaAiClaimFirestoreReads(ctx,snap.size-ACCAZA_AI_PAIRS_MAX_ORDERS).catch(()=>{});
      const counts={},pairs={},names={};let orders=0,multiItem=0,lines=0;
      snap.docs.forEach(doc=>{const order=doc.get("order")||{},status=HistoricalArchive.effectiveStatus(order);if(order.voided===true||!["Completed","Received"].includes(status))return;
        const list=Array.isArray(order.correctedLineItems||order.lineItems)?(order.correctedLineItems||order.lineItems):[],keys=[...new Set(list.filter(line=>Number(line&&line.qty)>0).map(line=>{const key=String(line.itemKey||line.key||line.name||"");names[key]=names[key]||accazaAiBaseItemName(line.name||line.itemName||key);return key;}).filter(Boolean))].sort();
        if(!keys.length)return;orders+=1;lines+=keys.length;if(keys.length>1)multiItem+=1;keys.forEach(key=>{counts[key]=(counts[key]||0)+1;});
        for(let i=0;i<keys.length;i+=1)for(let j=i+1;j<keys.length;j+=1){const pair=`${keys[i]}|${keys[j]}`;pairs[pair]=(pairs[pair]||0)+1;}});
      const top=Object.entries(pairs).filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([pair,count])=>{const [a,b]=pair.split("|"),confidenceAB=count/counts[a],confidenceBA=count/counts[b];return{items:[names[a],names[b]],ordersTogether:count,supportPct:accazaAiPct(count,orders),secondItemGivenFirstPct:Math.round(confidenceAB*1000)/10,firstItemGivenSecondPct:Math.round(confidenceBA*1000)/10,lift:Math.round(count*orders/(counts[a]*counts[b])*100)/100};});
      return{records:snap.size,result:{source:"historicalOrders (archived order copies)",range:`${range.from} to ${range.to}`,ordersAnalysed:orders,capped:snap.size>=ACCAZA_AI_PAIRS_MAX_ORDERS,averageDistinctItemsPerOrder:orders?Math.round(lines/orders*100)/100:null,multiItemOrderPct:accazaAiPct(multiItem,orders),topPairs:top,note:"Lift above 1 means the two are bought together more often than chance. Pairs seen fewer than 2 times are left out."}};
    },
  },
});
