// Accaza AI is deliberately read-only. Gemini receives a compact, server-built
// fact pack; it never gets Firebase credentials or permission to change records.
const ACCAZA_AI_MODEL = "gemini-2.5-flash-lite";
const ACCAZA_AI_HOURLY_LIMIT = 10;
const ACCAZA_AI_DAILY_LIMIT = 50;
function accazaAiText(value,max=800){return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);}
function accazaAiDay(now){return financeDateFromTimestamp(now);}
async function claimAccazaAiAllowance(db,uid,now){
  const day=accazaAiDay(now),cutoff=now-(60*60*1000),base=`accazaAiUsage/${uid}`;let limit="";
  const claimed=await db.ref(base).transaction(current=>{
    const usage=current&&typeof current==="object"?current:{},recent=(Array.isArray(usage.recent)?usage.recent:[]).map(Number).filter(timestamp=>Number.isFinite(timestamp)&&timestamp>cutoff).slice(-ACCAZA_AI_HOURLY_LIMIT);
    const days=usage.days&&typeof usage.days==="object"?usage.days:{},today=Number(days[day]&&days[day].count||0);
    if(today>=ACCAZA_AI_DAILY_LIMIT){limit="daily";return;}
    if(recent.length>=ACCAZA_AI_HOURLY_LIMIT){limit="hourly";return;}
    return {days:{[day]:{count:today+1,updatedAt:now}},recent:[...recent,now],updatedAt:now};
  },undefined,false);
  if(!claimed.committed)throw new HttpsError("resource-exhausted",limit==="daily"?`Daily Accaza AI limit reached (${ACCAZA_AI_DAILY_LIMIT}). Try again tomorrow.`:`Hourly Accaza AI limit reached (${ACCAZA_AI_HOURLY_LIMIT}). Try again later.`);
  const usage=claimed.snapshot.val()||{},today=Number(usage.days&&usage.days[day]&&usage.days[day].count||0),recent=(Array.isArray(usage.recent)?usage.recent:[]).filter(timestamp=>Number(timestamp)>cutoff);
  return {hourRemaining:Math.max(0,ACCAZA_AI_HOURLY_LIMIT-recent.length),dayRemaining:Math.max(0,ACCAZA_AI_DAILY_LIMIT-today)};
}
function accazaAiSearchText(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function accazaAiEditDistance(left,right){const a=String(left||""),b=String(right||"");if(Math.abs(a.length-b.length)>2)return 3;const row=Array.from({length:b.length+1},(_,index)=>index);for(let i=1;i<=a.length;i+=1){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j+=1){const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=saved;}}return row[b.length];}
function accazaAiItemMatch(menu,question){const q=accazaAiSearchText(question),queryWords=q.split(" ").filter(word=>word.length>2);return Object.entries(menu||{}).map(([id,row])=>{const name=String(row&&row.name||""),words=accazaAiSearchText(name).split(" ").filter(Boolean),exact=q.includes(accazaAiSearchText(name))?100:0,score=exact||words.reduce((total,word)=>total+(queryWords.includes(word)?3:queryWords.some(queryWord=>accazaAiEditDistance(queryWord,word)<=1)?2:0),0);return{id,row:row||{},name,score};}).filter(item=>item.name&&item.score>0).sort((a,b)=>b.score-a.score||b.name.length-a.name.length)[0]||null;}
const ACCAZA_AI_APP_GUIDE={scope:"Accaza AI is read-only. It can explain the Admin/POS/Finance Books app and report only the supplied live facts.",pos:"POS prices sales on the server, keeps an offline queue for temporary network loss, and requires a verified shift close. Correct a completed sale through the controlled correction/refund workflow; never edit posted orders directly.",inventory:"Inventory is driven by recipes, receiving, internal usage and approved adjustments. Recipe cost uses current inventory costs; posted sales retain their sale-time inventory plan and COGS evidence.",finance:"Finance Books is double-entry. Posted records are corrected by controlled reversals or correction workflows, not overwritten. Cash, receivables, payables, retained float and profit are different balances.",suppliers:"Supplier outstanding balances are open payables. A partial payment reduces remainingAmount and preserves the original supplier invoice and settlement evidence.",staff:"Only management may request staff information. Accaza AI provides operational staff roster facts only; it does not disclose private employee information, credentials, or payroll data."};
const ACCAZA_AI_DATA_MAP={app_help:{source:"curated server guide",limit:"no database read"},recipe_cost:{source:"menu item, recipe and keyed costing inputs",limit:"one matched item"},inventory:{source:"current inventory catalog",limit:"one matched stock item"},supplier:{source:"supplier master and indexed payable rows",limit:"one supplier; latest 100 invoices"},finance:{source:"current close, cash summary and open-payable summary",limit:"latest 100 open payables"},sales_comparison:{source:"daily Financial Close current summaries",limit:"two named months; at most 62 daily summaries"},staff:{source:"operational staff roster",limit:"no payroll, credentials or private data"}};
function accazaAiMoney(value){return Math.round((Number(value)||0)*100)/100;}
function accazaAiRows(rows,mapper,limit=25){return Object.entries(rows||{}).map(([id,row])=>mapper(id,row||{})).filter(Boolean).slice(0,limit);}
const ACCAZA_AI_MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
function accazaAiComparisonMonths(question,now){const found=[...accazaAiSearchText(question).matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g)].map(match=>ACCAZA_AI_MONTHS[match[1]]);if(found.length<2)return[];const year=Number(accazaAiDay(now).slice(0,4));return found.slice(0,2).map(month=>`${year}-${String(month).padStart(2,"0")}`);}
async function accazaAiMonthSales(db,month){
  const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate(),dates=Array.from({length:days},(_,index)=>`${month}-${String(index+1).padStart(2,"0")}`),snaps=await Promise.all(dates.map(date=>db.ref(`/financialCloses/daily_${date.replace(/-/g,"_")}/current`).get())),total={month,daysWithClose:0,netSales:0,cashSales:0,nonCashSales:0,platformSales:0,expectedCogs:0};
  snaps.forEach(snap=>{const admin=snap.val()&&snap.val().admin;if(!admin)return;total.daysWithClose+=1;["netSales","cashSales","nonCashSales","platformSales","expectedCogs"].forEach(key=>{total[key]=accazaAiMoney(total[key]+Number(admin[key]||0));});});
  return total;
}
async function accazaAiFactPack(db,question,now){
  const lower=question.toLowerCase(), facts={asOf:new Date(now).toISOString(),appGuide:ACCAZA_AI_APP_GUIDE,dataMap:ACCAZA_AI_DATA_MAP,sources:["Accaza AI app guide"]};
  const comparisonMonths=accazaAiComparisonMonths(question,now);if(comparisonMonths.length===2&&/\b(compare|comparison|sales|revenue|stream|increase|decrease|picked)\b/.test(lower)){facts.salesComparison=await Promise.all(comparisonMonths.map(month=>accazaAiMonthSales(db,month)));facts.salesComparison.delta={netSales:accazaAiMoney(facts.salesComparison[1].netSales-facts.salesComparison[0].netSales),cashSales:accazaAiMoney(facts.salesComparison[1].cashSales-facts.salesComparison[0].cashSales),nonCashSales:accazaAiMoney(facts.salesComparison[1].nonCashSales-facts.salesComparison[0].nonCashSales),platformSales:accazaAiMoney(facts.salesComparison[1].platformSales-facts.salesComparison[0].platformSales),expectedCogs:accazaAiMoney(facts.salesComparison[1].expectedCogs-facts.salesComparison[0].expectedCogs)};facts.sources.push(`financialCloses daily current summaries for ${comparisonMonths.join(" and ")}`);}
  if(/\b(cost|cogs|margin|price|recipe|latte|coffee|drink|menu)\b/.test(lower)){
    // Menu is a small configuration catalog; exact cost inputs remain keyed reads.
    const menu=(/* download-ok: catalog menu configuration is a small non-historical catalog used to identify the requested item */await db.ref("/menuItems").get()).val()||{},match=accazaAiItemMatch(menu,question);
    if(match){const recipe=(await db.ref(`/recipes/${match.id}`).get()).val()||null,settings=await readPosSettings(db,["sharedBaseIngredients","optionCosts","packagingAssignments"]);
      facts.menuItem={id:match.id,name:match.name,price:match.row.price||match.row.prices||null};facts.sources.push(`menuItems/${match.id}`);
      if(recipe){const cost=await readCatalogKeyed(db,["inventory","optionGroups","packagingRules"],maps=>Costing.costRecipe({itemKey:match.id,item:match.row,recipe,inventory:maps.inventory,sharedBaseIngredients:settings.sharedBaseIngredients||{},optionCosts:settings.optionCosts||{},optionGroups:maps.optionGroups,packagingRules:maps.packagingRules,packagingAssignments:settings.packagingAssignments||{}}));facts.recipeCost={totalCost:cost.totalCost,cogsCovered:cost.cogsCovered,lines:(cost.lines||[]).map(x=>({ingredient:x.ingredientName,quantity:x.recipeQuantityPerServing,unit:x.recipeUnit,unitCost:x.unitCost,totalCost:x.totalCost,source:x.source})),warnings:(cost.warnings||[]).map(x=>x.message)};facts.sources.push(`recipes/${match.id}`,"inventory (keyed recipe ingredients)");}
    }
  }
  if(/\b(finance|financial|sales|cash|profit|payable|supplier|balance|revenue|expense)\b/.test(lower)){
    const [closeSnap,cashSnap,openPayablesSnap]=await Promise.all([db.ref(`/financialCloses/${accazaAiDay(now)}/current`).get(),db.ref("/cashBalanceSummary/balances").get(),db.ref("/payables").orderByChild("status").equalTo("open").limitToLast(100).get()]),close=closeSnap.val()||null,payables=openPayablesSnap.val()||{};
    if(close)facts.todayFinancialClose={status:close.status||"unknown",adminNetSales:close.admin&&close.admin.netSales,financeNetRevenue:close.finance&&close.finance.netRevenue,salesDifference:close.totals&&close.totals.salesDifference,controlAccounts:close.controlAccounts||[]};
    facts.cashBalances=accazaAiRows(cashSnap.val(),(id,row)=>({account:id,name:row.name||id,balance:accazaAiMoney(row.balance)}));facts.openPayables={count:Object.keys(payables).length,shown:accazaAiRows(payables,(id,row)=>({id,supplier:row.party||"",reference:row.ref||id,date:row.date||"",remainingAmount:accazaAiMoney(row.remainingAmount!=null?row.remainingAmount:row.amount)}))};facts.sources.push(`financialCloses/${accazaAiDay(now)}/current`,`cashBalanceSummary/balances`,`payables status=open (latest 100)`);
  }
  if(/\b(supplier|vendor|payable|invoice|bill)\b/.test(lower)){
    const suppliers=(/* download-ok: catalog active supplier master is small non-historical configuration used to identify a requested supplier */await db.ref("/suppliers").get()).val()||{},match=accazaAiItemMatch(suppliers,question);
    if(match){const rows=(await db.ref("/payables").orderByChild("supplierId").equalTo(match.id).limitToLast(100).get()).val()||{},open=accazaAiRows(rows,(id,row)=>row.status==="open"?{id,reference:row.ref||id,date:row.date||"",due:row.due||"",remainingAmount:accazaAiMoney(row.remainingAmount!=null?row.remainingAmount:row.amount)}:null,100);facts.supplier={id:match.id,name:match.name,openInvoiceCount:open.length,outstanding:accazaAiMoney(open.reduce((total,row)=>total+row.remainingAmount,0)),invoices:open};facts.sources.push(`suppliers/${match.id}`,`payables supplierId=${match.id} (latest 100)`);}
  }
  if(/\b(staff|employee|barista|cashier|manager|roster)\b/.test(lower)){
    const staff=(/* download-ok: bounded operational staff roster; excludes payroll and credentials */await db.ref("/posStaff").get()).val()||{};facts.staffRoster=accazaAiRows(staff,(id,row)=>({id,name:row.name||row.displayName||id,role:row.role||"",active:row.active!==false}),100);facts.sources.push("posStaff (operational roster only)");
  }
  if(/\b(stock|inventory|ingredient|on hand|quantity)\b/.test(lower)){
    const inventory=(/* download-ok: catalog current inventory list used only to identify the requested stock item */await db.ref("/inventory").get()).val()||{},match=accazaAiItemMatch(inventory,question);if(match){facts.inventoryItem={id:match.id,name:match.name,onHand:match.row.onHand!=null?match.row.onHand:match.row.qty,unit:match.row.unit||match.row.uom||"",unitCost:match.row.unitCost||match.row.cost||null};facts.sources.push(`inventory/${match.id}`);}
  }
  return facts;
}
async function askGeminiAccazaAi(question,facts){
  const key=GEMINI_API_KEY.value();if(!key)throw new HttpsError("failed-precondition","Accaza AI is not configured. Set the GEMINI_API_KEY Firebase secret first.");
  const instruction="You are Accaza AI for Accaza Coffee House. Answer only about Accaza operations, POS, inventory, recipes and Finance Books. Use only the FACT PACK. Do not invent figures. Clearly distinguish selling price, recipe cost, gross profit and margin. For finance, distinguish cash, receivables, payables, retained float and profit. State when the fact pack does not contain the answer. You are read-only: never say that you posted, changed or approved a transaction. Keep the answer concise and cite the supplied source paths.";
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ACCAZA_AI_MODEL}:generateContent`,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents:[{role:"user",parts:[{text:`QUESTION: ${question}\n\nFACT PACK:\n${JSON.stringify(facts)}`}]}],generationConfig:{temperature:0.15,maxOutputTokens:700}})});
  const body=await response.json().catch(()=>({}));if(!response.ok)throw new HttpsError("unavailable",body&&body.error&&body.error.message||"Gemini could not answer right now.");
  const answer=accazaAiText(body&&body.candidates&&body.candidates[0]&&body.candidates[0].content&&body.candidates[0].content.parts&&body.candidates[0].content.parts.map(p=>p.text||"").join("\n"),5000);if(!answer)throw new HttpsError("unavailable","Gemini returned no answer. Please try again.");return answer;
}
exports.askAccazaAI=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB",secrets:[GEMINI_API_KEY]},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Accaza AI is available to management accounts only.");
  const question=accazaAiText(request.data&&request.data.question,800);if(question.length<3)throw new HttpsError("invalid-argument","Enter a question for Accaza AI.");
  const now=Date.now(),allowance=await claimAccazaAiAllowance(db,actor.uid,now),facts=await accazaAiFactPack(db,question,now),answer=await askGeminiAccazaAi(question,facts),auditId=`${now}_${crypto.randomUUID()}`;
  await db.ref(`/operationalAudit/${auditId}`).set(operationalAuditRecord("ask_accaza_ai","accazaAI",auditId,actor,{questionHash:crypto.createHash("sha256").update(question).digest("hex"),sources:facts.sources||[],hourRemaining:allowance.hourRemaining,dayRemaining:allowance.dayRemaining,accounting:"Read-only AI analysis only; no order, inventory movement, subledger, Finance movement, or Books journal changed."}));
  return {answer,sources:facts.sources||[],allowance};
});
