// Accaza AI record tools (Sep 2026). In Accaza analysis mode a management user's question can
// be answered from live records: the model plans which records it needs, calls these tools,
// reads the results and only then writes the reply. Every tool is READ-ONLY (get() queries
// only), date-bounded, row-capped and counted against a per-question record budget, so a
// question can neither change a record nor run up Firebase downloads. Times are Manila.
const ACCAZA_AI_TOOL_ROLES = ["owner","superadmin","admin","manager"];
const ACCAZA_AI_AGENT_MAX_ROUNDS = 4;
const ACCAZA_AI_AGENT_MAX_CALLS_PER_ROUND = 6;
const ACCAZA_AI_TOOL_RECORD_BUDGET = 2500;
const ACCAZA_AI_TOOL_RESULT_CHARS = 14000;
const ACCAZA_AI_TOOL_MAX_DAYS = 7;
const ACCAZA_AI_TOOL_SALES_MAX_DAYS = 3;
const ACCAZA_AI_MANILA_OFFSET_MS = 8 * 3600000;
// Fields that never leave the server: credentials, contact details, images, raw sale payloads.
// Also dropped: hashes and coin/bill denomination counts (the counted totals are kept).
const ACCAZA_AI_TOOL_SKIP_KEY = /(token|secret|password|passcode|^pin$|pinhash|email|phone|mobile|photo|image|proof|signature|^command$|payload|lineitems|^items$|fcm|^ip$|useragent|hash$|^(opencount|closecount|drawer)$)/i;
function accazaAiManilaTime(ms){const date=new Date(Number(ms)+ACCAZA_AI_MANILA_OFFSET_MS);return `${date.toISOString().slice(0,10)} ${date.toISOString().slice(11,16)}`;}
function accazaAiLooksLikeTime(key,value){return typeof value==="number"&&value>1.5e12&&value<2.5e12&&/(at|ts|time|timestamp|date|since|until|seen)$/i.test(key);}
// Scalars and one level of nesting only; timestamps become Manila "YYYY-MM-DD HH:MM".
function accazaAiCompact(value,depth=0,key=""){
  if(value==null)return value;
  if(accazaAiLooksLikeTime(key,value))return accazaAiManilaTime(value);
  if(typeof value==="number")return Math.round(value*100)/100;
  if(typeof value==="boolean")return value;
  if(typeof value==="string")return value.length>160?`${value.slice(0,160)}…`:value;
  if(Array.isArray(value))return depth>=1?`[${value.length} item${value.length===1?"":"s"}]`:value.slice(0,8).map(item=>accazaAiCompact(item,depth+1));
  if(typeof value==="object"){if(depth>=2)return "[details]";const size=Object.keys(value).length;if(depth>=1&&size>12)return `[${size} entries]`;const out={};for(const [field,item] of Object.entries(value).slice(0,40)){if(ACCAZA_AI_TOOL_SKIP_KEY.test(field))continue;const compact=accazaAiCompact(item,depth+1,field);if(compact!==undefined)out[field]=compact;}return out;}
  return undefined;
}
function accazaAiCentavos(value){return Math.round((Number(value)||0)*100);}
function accazaAiDateRange(args,maxDays){
  const from=String(args&&args.date_from||"").trim(),to=String(args&&args.date_to||from).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return{error:"Use dates as YYYY-MM-DD (Manila)."};
  let start=Date.parse(`${from}T00:00:00+08:00`),end=Date.parse(`${to}T00:00:00+08:00`)+86400000;
  if(!Number.isFinite(start)||!Number.isFinite(end))return{error:"Invalid date."};
  if(end<=start){const swap=start;start=end-86400000;end=swap+86400000;}
  const days=Math.round((end-start)/86400000);
  if(days>maxDays)return{error:`That range is ${days} days; this tool reads at most ${maxDays} days at a time. Ask for a shorter range, or use get_finance_month for whole months.`};
  const dayList=[];for(let at=start;at<end;at+=86400000)dayList.push(new Date(at+ACCAZA_AI_MANILA_OFFSET_MS).toISOString().slice(0,10));
  return{start,end,from,to,days:dayList};
}
function accazaAiCount(map,key,centavos){const label=String(key||"unknown").slice(0,60)||"unknown";const row=map[label]||(map[label]={count:0,centavos:0});row.count+=1;row.centavos+=centavos||0;}
function accazaAiCountsOut(map){return Object.fromEntries(Object.entries(map).sort((a,b)=>b[1].count-a[1].count).slice(0,20).map(([key,row])=>[key,{count:row.count,amount:row.centavos/100}]));}
function accazaAiValues(snap){const value=snap&&snap.val();return value&&typeof value==="object"?Object.entries(value).map(([id,row])=>Object.assign({id},row&&typeof row==="object"?row:{value:row})):[];}
function accazaAiInRange(row,range){return Object.keys(row).some(key=>/(at|ts|timestamp)$/i.test(key)&&Number(row[key])>=range.start&&Number(row[key])<range.end);}

const ACCAZA_AI_RECORD_TOOLS = {
  get_shifts:{
    description:"Shifts that opened in a Manila date range (plus the evening before, for overnight shifts): cashier, open/close/handover times, status, float, expected and counted cash, variance, Z report, handover state, shift crew and each till's sync health (pending, failed and oldest unsynced sale).",
    days:ACCAZA_AI_TOOL_MAX_DAYS,
    async run(db,range){
      const shifts=accazaAiValues(await db.ref("/shifts").orderByChild("openAt").startAt(range.start-18*3600000).endAt(range.end-1).limitToLast(20).get());
      const detailed=await Promise.all(shifts.map(async shift=>{
        const [handover,crew,devices]=await Promise.all([db.ref(`/shiftHandovers/${shift.id}`).get(),db.ref(`/shiftCrews/${shift.id}`).get(),db.ref(`/posDeviceHealth/${shift.id}`).get()]);
        return Object.assign(accazaAiCompact(shift),{handover:accazaAiCompact(handover.val()),crew:accazaAiCompact(crew.val()),tillSyncHealth:accazaAiCompact(devices.val())});
      }));
      return{records:shifts.length*4,result:{shiftCount:shifts.length,shifts:detailed}};
    },
  },
  get_sales:{
    description:"Sales rung or received in a Manila date range (at most 3 days): count and PHP totals by status, channel, payment method, shift and seller, voided sales, sales per hour, first and last sale time, and the latest sales. Read from live orders and archived orders.",
    days:ACCAZA_AI_TOOL_SALES_MAX_DAYS,
    async run(db,range){
      const [live,archived]=await Promise.all([db.ref("/orders").orderByChild("timestamp").startAt(range.start).endAt(range.end-1).limitToFirst(600).get(),db.ref("/archivedOrders").orderByChild("timestamp").startAt(range.start).endAt(range.end-1).limitToFirst(600).get()]);
      const byId={};accazaAiValues(archived).concat(accazaAiValues(live)).forEach(order=>{byId[order.id]=order;});
      const orders=Object.values(byId).sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));
      const status={},channel={},payment={},shift={},seller={},hour={};let total=0,voided=0;
      orders.forEach(order=>{
        const cents=accazaAiCentavos(order.total),pay=typeof order.payment==="string"?order.payment:(order.payment&&(order.payment.method||order.payment.name))||order.paymentMethod||"unknown";
        accazaAiCount(status,order.voided===true?"voided":order.status,cents);
        if(order.voided===true){voided+=1;return;}
        total+=cents;accazaAiCount(channel,order.channel||order.source,cents);accazaAiCount(payment,pay,cents);accazaAiCount(shift,order.shiftId||"no shift",cents);accazaAiCount(seller,order.soldBy||order.cashier||order.soldByStaffId,cents);
        accazaAiCount(hour,accazaAiManilaTime(order.timestamp).slice(0,13)+":00",cents);
      });
      const latest=orders.slice(-12).map(order=>({id:order.id,time:accazaAiManilaTime(order.timestamp),total:accazaAiCentavos(order.total)/100,status:order.voided===true?"voided":order.status,channel:order.channel||order.source||"",shiftId:order.shiftId||"",soldBy:order.soldBy||order.cashier||""}));
      return{records:orders.length,result:{saleCount:orders.length-voided,voidedCount:voided,salesTotal:total/100,capped:live.numChildren()>=600||archived.numChildren()>=600,firstSale:orders.length?accazaAiManilaTime(orders[0].timestamp):null,lastSale:orders.length?accazaAiManilaTime(orders[orders.length-1].timestamp):null,byStatus:accazaAiCountsOut(status),byChannel:accazaAiCountsOut(channel),byPayment:accazaAiCountsOut(payment),byShift:accazaAiCountsOut(shift),bySeller:accazaAiCountsOut(seller),byHour:accazaAiCountsOut(hour),latestSales:latest}};
    },
  },
  get_audit_log:{
    description:"The operational audit log for a Manila date range: every server-recorded action (sales sync, corrections, refunds, shift close and handover, recoveries, approvals, AI questions) with time, action, record and actor role. Optional 'contains' filters by words in the action or record.",
    days:ACCAZA_AI_TOOL_MAX_DAYS,
    extra:{contains:{type:"string",description:"Optional word to filter actions or record IDs, e.g. shift, handover, refund, sync."}},
    async run(db,range,args){
      const rows=accazaAiValues(await db.ref("/operationalAudit").orderByChild("ts").startAt(range.start).endAt(range.end-1).limitToLast(400).get());
      const needle=String(args&&args.contains||"").trim().toLowerCase().slice(0,40);
      const matched=rows.filter(row=>!needle||`${row.action||""} ${row.sourceType||""} ${row.sourceId||""} ${row.reason||""}`.toLowerCase().includes(needle)).sort((a,b)=>Number(a.ts||0)-Number(b.ts||0));
      const byAction={};matched.forEach(row=>accazaAiCount(byAction,row.action,0));
      return{records:rows.length,result:{eventCount:matched.length,capped:rows.length>=400,byAction:Object.fromEntries(Object.entries(accazaAiCountsOut(byAction)).map(([key,row])=>[key,row.count])),events:matched.slice(-80).map(row=>accazaAiCompact(row))}};
    },
  },
  get_pos_sync_issues:{
    description:"Till-to-server sync problems in a Manila date range: offline sale sync states, sales the server refused (with the refusal message and whether a manager recovered or dismissed them), background tasks that stopped retrying, and the day's app error counters.",
    days:ACCAZA_AI_TOOL_MAX_DAYS,
    async run(db,range){
      const [offline,alerts,dead,...telemetry]=await Promise.all([db.ref("/offlinePosSync").orderByChild("updatedAt").startAt(range.start).endAt(range.end-1).limitToLast(400).get(),db.ref("/posSyncAlerts").orderByChild("state").limitToLast(120).get(),db.ref("/functionDeadLetters").orderByChild("abandonedAt").startAt(range.start).endAt(range.end-1).limitToLast(50).get(),...range.days.map(day=>db.ref(`/clientTelemetryDaily/${day}`).get())]);
      const offlineRows=accazaAiValues(offline),alertRows=accazaAiValues(alerts),inRangeAlerts=alertRows.filter(row=>accazaAiInRange(row,range)),deadRows=accazaAiValues(dead),states={};
      offlineRows.forEach(row=>accazaAiCount(states,row.state,0));
      return{records:offlineRows.length+alertRows.length+deadRows.length+range.days.length,result:{offlineSyncByState:Object.fromEntries(Object.entries(accazaAiCountsOut(states)).map(([key,row])=>[key,row.count])),unfinishedOfflineSyncs:offlineRows.filter(row=>!/^(synced|order-written|completed)$/.test(String(row.state||""))).slice(0,40).map(row=>accazaAiCompact(row)),refusedSales:inRangeAlerts.slice(0,40).map(row=>accazaAiCompact(row)),refusedSaleCount:inRangeAlerts.length,stoppedBackgroundTasks:deadRows.slice(0,20).map(row=>accazaAiCompact(row)),appErrorCounters:Object.fromEntries(range.days.map((day,index)=>[day,accazaAiCompact(telemetry[index].val())]))}};
    },
  },
  get_close_and_incidents:{
    description:"Shift close and control follow-up for a Manila date range: pending shift handovers (provisional Z), close follow-ups, the daily financial close status, and logged incidents.",
    days:ACCAZA_AI_TOOL_MAX_DAYS,
    async run(db,range){
      const [pending,followUps,incidents,...closes]=await Promise.all([db.ref("/pendingShiftHandovers").orderByChild("at").limitToLast(50).get(),db.ref("/shiftCloseFollowUps").orderByChild("state").limitToLast(80).get(),db.ref("/incidents").orderByChild("createdAt").startAt(range.start).endAt(range.end-1).limitToLast(50).get(),...range.days.map(day=>db.ref(`/financialCloses/${day}/current`).get())]);
      const pendingRows=accazaAiValues(pending),followRows=accazaAiValues(followUps),incidentRows=accazaAiValues(incidents);
      return{records:pendingRows.length+followRows.length+incidentRows.length+range.days.length,result:{pendingHandoversNow:pendingRows.map(row=>accazaAiCompact(row)),closeFollowUps:followRows.filter(row=>row.state==="open"||accazaAiInRange(row,range)).slice(0,40).map(row=>accazaAiCompact(row)),incidents:incidentRows.map(row=>accazaAiCompact(row)),dailyFinancialClose:Object.fromEntries(range.days.map((day,index)=>[day,accazaAiCompact(closes[index].val())]))}};
    },
  },
  get_cash_custody:{
    description:"Cash custody records closed in a Manila date range: which shift handed over how much cash, what is still awaiting deposit, and deposit status.",
    days:ACCAZA_AI_TOOL_MAX_DAYS,
    async run(db,range){
      const rows=accazaAiValues(await db.ref("/cashCustody").orderByChild("closedAt").startAt(range.start).endAt(range.end-1).limitToLast(100).get());
      const handed=rows.reduce((sum,row)=>sum+accazaAiCentavos(row.amount!=null?row.amount:row.total),0),remaining=rows.reduce((sum,row)=>sum+accazaAiCentavos(row.remaining),0);
      return{records:rows.length,result:{custodyCount:rows.length,cashHandedOver:handed/100,stillAwaitingDeposit:remaining/100,custody:rows.slice(0,60).map(row=>accazaAiCompact(row))}};
    },
  },
  get_finance_month:{
    description:"Finance Books profit and loss for one month (YYYY-MM) from the posted ledger: revenue streams, cost of sales and operating expenses by account, with totals. Accounting amounts, not cash flow.",
    params:{month:{type:"string",description:"Month as YYYY-MM."}},
    async run(db,_range,args){
      const month=String(args&&args.month||"").trim();if(!/^\d{4}-\d{2}$/.test(month))return{records:0,result:{error:"Use month as YYYY-MM."}};
      const [chartSnap,netSnap]=await Promise.all([/* download-ok: catalog chart of accounts configuration, not business history */db.ref("/booksChart").get(),db.ref(`/books/monthlyNet/${month}`).get()]),chart=chartSnap.val()||{},net=netSnap.val()||{};
      const income=accazaAiTopAccounts(chart,net,["Income"],12),cogs=accazaAiTopAccounts(chart,net,["COGS"],12),expenses=accazaAiTopAccounts(chart,net,["Expense"],15),sum=rows=>accazaAiCentavos(rows.reduce((total,row)=>total+Number(row.amount||0),0))/100,revenue=sum(income),costOfSales=sum(cogs),operatingExpense=sum(expenses);
      return{records:2,result:{month,posted:netSnap.exists(),revenue,costOfSales,grossProfit:accazaAiMoney(revenue-costOfSales),operatingExpense,operatingResult:accazaAiMoney(revenue-costOfSales-operatingExpense),revenueStreams:income,costOfSalesAccounts:cogs,operatingExpenseAccounts:expenses}};
    },
  },
};
function accazaAiToolSchema(name){
  const tool=ACCAZA_AI_RECORD_TOOLS[name],properties=tool.params||Object.assign({date_from:{type:"string",description:"First Manila date, YYYY-MM-DD."},date_to:{type:"string",description:"Last Manila date, YYYY-MM-DD (same as date_from for one day)."}},tool.extra||{});
  return{name,description:tool.description,parameters:{type:"object",properties,required:tool.params?Object.keys(tool.params):["date_from"]}};
}
function accazaAiGeminiTools(){return[{functionDeclarations:Object.keys(ACCAZA_AI_RECORD_TOOLS).map(accazaAiToolSchema)}];}
function accazaAiOpenAiTools(){return Object.keys(ACCAZA_AI_RECORD_TOOLS).map(name=>({type:"function",function:accazaAiToolSchema(name)}));}
function accazaAiToolContext(db){return{db,recordsRead:0,calls:[],cache:{},names:null};}
// Firebase account IDs are unreadable in a reply, so they are shown as the linked staff name
// (or "account …1234" when the account is not a POS staff profile).
async function accazaAiStaffNames(ctx){
  if(!ctx.names)ctx.names=ctx.db.ref("/posStaff").get()/* download-ok: bounded staff roster; names and account links only */.then(snap=>{const names={};Object.values(snap.val()||{}).forEach(row=>{if(row&&row.accountUid)names[row.accountUid]=String(row.name||row.displayName||"").slice(0,60);});return names;}).catch(()=>({}));
  return ctx.names;
}
function accazaAiNameAccounts(text,names){return text.replace(/"([A-Za-z0-9]{28})"/g,(match,uid)=>JSON.stringify(names[uid]||`account …${uid.slice(-4)}`));}
async function accazaAiRunRecordTool(ctx,name,args){
  const tool=ACCAZA_AI_RECORD_TOOLS[name],safeArgs=args&&typeof args==="object"?args:{},key=`${name}:${JSON.stringify(safeArgs)}`;
  if(!tool)return{error:`Unknown tool ${String(name).slice(0,40)}.`};
  if(ctx.cache[key])return ctx.cache[key];
  if(ctx.recordsRead>=ACCAZA_AI_TOOL_RECORD_BUDGET)return{error:"The record budget for this question is used up. Answer from what you already have and say what could not be checked."};
  let range=null;if(!tool.params){range=accazaAiDateRange(safeArgs,tool.days);if(range.error)return{error:range.error};}
  let output;
  try{output=await tool.run(ctx.db,range,safeArgs);}catch(error){ctx.calls.push({tool:name,args:safeArgs,records:0,failed:true});return{error:`Could not read these records right now (${accazaAiText(error&&error.message,120)}).`};}
  ctx.recordsRead+=Number(output.records||0);ctx.calls.push({tool:name,args:safeArgs,records:Number(output.records||0)});
  const text=accazaAiNameAccounts(JSON.stringify(output.result),await accazaAiStaffNames(ctx));
  const result=text.length>ACCAZA_AI_TOOL_RESULT_CHARS?{truncated:true,note:"Result shortened; ask a narrower range or filter for detail.",partial:text.slice(0,ACCAZA_AI_TOOL_RESULT_CHARS)}:JSON.parse(text);
  ctx.cache[key]=result;return result;
}
function accazaAiToolSources(ctx){return ctx.calls.map(call=>`${call.tool} ${call.args.month||[call.args.date_from,call.args.date_to].filter(Boolean).filter((value,index,list)=>list.indexOf(value)===index).join(" to ")}${call.failed?" (failed)":` (${call.records} records)`}`);}
const ACCAZA_AI_AGENT_GUIDE = "You can read Accaza's live records with the provided tools. Work like an analyst: first decide which records would answer the question, call the tools (several at once if useful, and again to dig deeper), compare what they show, and only then write the reply. Every factual statement must come from the FACT PACK or a tool result: quote the exact times, shift IDs, staff names, counts and PHP amounts the records show. If the records do not show something, say so plainly instead of guessing, and label any inference as an inference. All dates and times are Manila time. For a question about what happened (an incident, a problem, a shift or a day), first check that day's shifts, sales, sync issues and audit log, then reply in this order: a one- or two-sentence direct answer; a \"Timeline\" label followed by a list of times and what the records show; a \"Cause\" paragraph that separates what the records prove from what is inferred; and a \"Still open\" list if anything remains unresolved. Do not add generic recommendations to an incident answer unless the user asks what to do. This overrides the instruction to use only the FACT PACK.";
function accazaAiAgentQuestion(question,facts,now){return`QUESTION: ${question}\n\nTODAY (Manila): ${financeDateFromTimestamp(now)}\n\nFACT PACK:\n${JSON.stringify(facts)}`;}
async function askGeminiAccazaAgent(question,facts,history,timeoutMs,ctx,now){
  const key=GEMINI_API_KEY.value();if(!key)throw new HttpsError("failed-precondition","Accaza AI is not configured. Set the GEMINI_API_KEY Firebase secret first.");
  const deadline=Date.now()+timeoutMs,contents=[...accazaAiHistory(history).map(row=>({role:row.role,parts:[{text:row.text}]})),{role:"user",parts:[{text:accazaAiAgentQuestion(question,facts,now)}]}];
  for(let round=0;round<=ACCAZA_AI_AGENT_MAX_ROUNDS;round+=1){
    const final=round===ACCAZA_AI_AGENT_MAX_ROUNDS,remaining=deadline-Date.now();if(remaining<3000)throw accazaAiProviderFailure("Gemini ran out of time while checking records.");
    const {response,body}=await accazaAiFetchJson("Gemini",`https://generativelanguage.googleapis.com/v1beta/models/${ACCAZA_AI_MODEL}:generateContent`,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:`${ACCAZA_AI_ANALYSIS_INSTRUCTION} ${ACCAZA_AI_AGENT_GUIDE}`}]},contents,tools:accazaAiGeminiTools(),toolConfig:{functionCallingConfig:{mode:final?"NONE":"AUTO"}},generationConfig:{temperature:0.15,maxOutputTokens:1400}})},remaining);
    if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,"Gemini could not answer right now."));
    const content=body&&body.candidates&&body.candidates[0]&&body.candidates[0].content,parts=content&&Array.isArray(content.parts)?content.parts:[],calls=parts.filter(part=>part&&part.functionCall);
    if(!calls.length||final)return accazaAiProseAnswer(parts.map(part=>part&&part.text||"").join("\n"));
    // The model turn goes back verbatim so Gemini's thought signatures stay intact.
    contents.push(content);
    const results=await Promise.all(calls.map((part,index)=>index<ACCAZA_AI_AGENT_MAX_CALLS_PER_ROUND?accazaAiRunRecordTool(ctx,part.functionCall.name,part.functionCall.args):Promise.resolve({error:"Too many tool calls in one step; call it again next step."})));
    contents.push({role:"user",parts:calls.map((part,index)=>({functionResponse:{name:part.functionCall.name,response:{result:results[index]}}}))});
  }
  throw accazaAiProviderFailure("Gemini did not finish its record check.");
}
async function askOpenAiCompatibleAccazaAgent(label,url,key,model,question,facts,history,timeoutMs,ctx,now){
  const deadline=Date.now()+timeoutMs,messages=[{role:"system",content:`${ACCAZA_AI_ANALYSIS_INSTRUCTION} ${ACCAZA_AI_AGENT_GUIDE}`},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:accazaAiAgentQuestion(question,facts,now)}];
  for(let round=0;round<=ACCAZA_AI_AGENT_MAX_ROUNDS;round+=1){
    const final=round===ACCAZA_AI_AGENT_MAX_ROUNDS,remaining=deadline-Date.now();if(remaining<3000)throw accazaAiProviderFailure(`${label} ran out of time while checking records.`);
    const {response,body}=await accazaAiFetchJson(label,url,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify({model,messages,temperature:0.15,max_tokens:1400,stream:false,tools:accazaAiOpenAiTools(),tool_choice:final?"none":"auto"})},remaining);
    if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,`${label} could not answer right now.`));
    const message=body&&body.choices&&body.choices[0]&&body.choices[0].message||{},calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
    if(!calls.length||final)return accazaAiProseAnswer(message.content);
    messages.push({role:"assistant",content:message.content||"",tool_calls:calls});
    const results=await Promise.all(calls.map((call,index)=>{let args={};try{args=JSON.parse(call&&call.function&&call.function.arguments||"{}");}catch(_error){args={};}return index<ACCAZA_AI_AGENT_MAX_CALLS_PER_ROUND?accazaAiRunRecordTool(ctx,call&&call.function&&call.function.name,args):Promise.resolve({error:"Too many tool calls in one step; call it again next step."});}));
    calls.forEach((call,index)=>messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(results[index])}));
  }
  throw accazaAiProviderFailure(`${label} did not finish its record check.`);
}
// Management analysis: every provider can read records (Danilo, 25 Sep 2026, "all backups"),
// except Qwen, which is too slow on SUPERDAD for multi-step tool use and answers from the
// FACT PACK. Order and reserve match the no-tool list.
function accazaAiAgentProviders(question,facts,history,ctx,now){return[
  {name:"gemini",maxMs:55000,enabled:()=>Boolean(GEMINI_API_KEY.value()),ask:timeoutMs=>askGeminiAccazaAgent(question,facts,history,timeoutMs,ctx,now)},
  {name:"deepseek",maxMs:35000,enabled:()=>Boolean(DEEPSEEK_API_KEY.value()),ask:timeoutMs=>askOpenAiCompatibleAccazaAgent("DeepSeek","https://api.deepseek.com/chat/completions",DEEPSEEK_API_KEY.value(),"deepseek-flash",question,facts,history,timeoutMs,ctx,now)},
  {name:"ollama",maxMs:ACCAZA_AI_OLLAMA_TIMEOUT_MS,enabled:accazaAiOllamaConfigured,ask:timeoutMs=>askOllamaAccazaAi(question,facts,history,timeoutMs)},
  {name:"ashna",maxMs:25000,reserveMs:25000,enabled:()=>Boolean(ASHNA_API_KEY.value()),ask:timeoutMs=>askOpenAiCompatibleAccazaAgent("Ashna","https://api.ashna.ai/v1/api/chat/completions",accazaAiOllamaHeaderValue(ASHNA_API_KEY.value()),ACCAZA_AI_ASHNA_MODEL,question,facts,history,timeoutMs,ctx,now)},
];}
