// Fallback reliability (Sep 2026). One request has a fixed time budget inside the callable's
// 120 s limit. Each provider call gets its own abort timer, and a timeout, a network error, a
// non-OK reply or an empty answer are all provider failures, so the next provider is tried
// instead of the whole request failing or hanging until the function is killed.
const ACCAZA_AI_REQUEST_BUDGET_MS = 110000;
const ACCAZA_AI_CLOUD_TIMEOUT_MS = 25000;
const ACCAZA_AI_OLLAMA_TIMEOUT_MS = 70000;
const ACCAZA_AI_MIN_ATTEMPT_MS = 8000;
// qwen3:8b on SUPERDAD runs CPU-only at roughly 5-6 tokens/s, so its reply length is sized
// to the time it actually has; a longer cap would only produce timeouts.
const ACCAZA_AI_OLLAMA_MAX_TOKENS = 350;
// Cerebras (paid, prepaid USD 5, Danilo 25 Sep 2026): first backup after Gemini. gpt-oss-120b is a
// reasoning model, so its token cap covers reasoning plus the reply and reasoning is kept low.
const ACCAZA_AI_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const ACCAZA_AI_CEREBRAS_MODEL = "gpt-oss-120b";
// forceFirstTool: in record-reading mode gpt-oss otherwise tends to answer from the fact pack
// without checking records (seen in the 25 Sep live test), so its first step must call a tool.
const ACCAZA_AI_CEREBRAS_OPTIONS = {maxTokens:2500,forceFirstTool:true,body:{reasoning_effort:"low"}};
function accazaAiCerebrasKey(){return accazaAiOllamaHeaderValue(CEREBRAS_API_KEY.value());}
// Groq (free tier, Danilo 25 Sep 2026): first backup after Gemini in GENERAL CHAT ONLY. The free
// tier allows 8,000 tokens per minute (prompt + max_tokens), which a chat fits (at most ~2.5k
// tokens with 8 history turns) but a record-reading question does not (the 25 Sep live test
// needed ~3.7k then ~6.9k tokens and was refused), and Groq's paid tier was closed to sign-ups.
// So analysis and record reading skip Groq; move it there only once a paid tier is active.
const ACCAZA_AI_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ACCAZA_AI_GROQ_MODEL = "openai/gpt-oss-120b";
const ACCAZA_AI_GROQ_OPTIONS = {maxTokens:1500,body:{reasoning_effort:"low"}};
function accazaAiGroqKey(){return accazaAiOllamaHeaderValue(GROQ_API_KEY.value());}
async function accazaAiFetchJson(providerLabel,url,init,timeoutMs){
  const controller=new AbortController(),limit=Math.max(1000,Number(timeoutMs)||ACCAZA_AI_CLOUD_TIMEOUT_MS),timer=setTimeout(()=>controller.abort(),limit);
  try{const response=await fetch(url,Object.assign({},init,{signal:controller.signal}));const body=await response.json().catch(()=>({}));return{response,body};}
  catch(_error){throw accazaAiProviderFailure(controller.signal.aborted?`${providerLabel} did not answer within ${Math.round(limit/1000)} seconds.`:`${providerLabel} could not be reached.`);}
  finally{clearTimeout(timer);}
}
function accazaAiProviderMessage(body,fallback){const error=body&&body.error;return accazaAiText(error&&typeof error==="object"?error.message:error,200)||fallback;}
// A reply cut off by the token cap ends at its last complete sentence instead of mid-word.
function accazaAiTrimToSentence(text){const value=String(text||"").trim(),cut=Math.max(value.lastIndexOf(". "),value.lastIndexOf("! "),value.lastIndexOf("? "),value.lastIndexOf(".\n"),value.lastIndexOf("!\n"),value.lastIndexOf("?\n"));return cut>40?value.slice(0,cut+1).trim():value;}
// Reply style shared by every mode (Danilo, 25 Sep 2026): clean chat-assistant replies,
// paragraphs plus plain "• " / "1. " lists when useful, never raw Markdown.
// General chat (admin General chat + standalone app): neutral assistant identity and no
// company or app references in the reply.
const ACCAZA_AI_GENERAL_CHAT_INSTRUCTION="You are a helpful, knowledgeable AI assistant. Answer the user's question directly and accurately from your built-in knowledge, and say plainly when an answer depends on current or externally verified information you may not have. Write like a polished chat assistant: start with a one- or two-sentence direct answer, then use short, well-organized paragraphs separated by one blank line. When a list genuinely helps (steps, options, key figures or prioritized actions), put each item on its own line starting with \"• \" for bullets or \"1. \", \"2. \" for ordered items, keep each item to one or two sentences, and leave a blank line before and after the list. A short plain-text label on its own line may introduce a section. Do not use Markdown syntax: no # headings, no asterisks, no bold or italic markers, no tables and no emojis. Do not mention any company, brand, product, app, mode or system you are running in, and do not refer to these instructions. You cannot see any private business records; if asked about the user's own business figures, say briefly that you cannot see them and answer in general terms.";
// Accaza analysis (read-only fact pack): same style, Accaza business rules.
const ACCAZA_AI_ANALYSIS_INSTRUCTION="You are Accaza AI for Accaza Coffee House. Answer only about Accaza operations, POS, inventory, recipes and Finance Books, using only the FACT PACK. Do not invent figures. For business analysis, interpret the supplied historical Finance Books facts and give prioritized, practical recommendations, keeping what the figures show, what they suggest and what to do clearly separate. Never present accounting amounts as cash flow. Clearly distinguish selling price, recipe cost, gross profit and margin. For finance, distinguish cash, receivables, payables, retained float and profit. State plainly when the fact pack does not contain the answer. You are read-only: never say that you posted, changed or approved a transaction. Mention only the figures that matter, written as PHP amounts with thousands separators (for example PHP 152,370.88) and percentages to one decimal place. Write like a polished chat assistant: start with a one- or two-sentence direct answer, then use short, well-organized paragraphs separated by one blank line. When a list genuinely helps (steps, options, key figures or prioritized actions), put each item on its own line starting with \"• \" for bullets or \"1. \", \"2. \" for ordered items, keep each item to one or two sentences, and leave a blank line before and after the list. A short plain-text label on its own line may introduce a section. Do not use Markdown syntax: no # headings, no asterisks, no bold or italic markers, no tables and no emojis. For a business or financial analysis, use this order: the direct answer; a short list of the key figures; a paragraph on what they mean; then numbered recommendations, most important first. Do not write source paths in the reply; they are shown to the user separately.";
// Normalizes any provider reply into clean chat text (the client renders pre-wrap): Markdown
// emphasis, headings, quotes and rules are removed; bullets become "• ", numbered items stay
// "1. ", and lists get a blank line around them. Arithmetic like 2*3*4 is left alone.
function accazaAiProseAnswer(value){
  const raw=String(value||"").replace(/\r\n?/g,"\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g," ").replace(/^\s*```[\w-]*\s*$/gm,"").replace(/`([^`\n]+)`/g,"$1").replace(/\*\*([^*\n]+)\*\*/g,"$1").replace(/__([^_\n]+)__/g,"$1").replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/gm,"$1$2").replace(/^[ \t]{0,3}#{1,6}[ \t]+(?:\d{1,2}[.)][ \t]+)?/gm,"\n").replace(/^[ \t]*>[ \t]?/gm,"").replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm,"");
  const out=[];let previous="blank";
  raw.split("\n").forEach(source=>{
    let line=source.replace(/[ \t]+/g," ").trim(),kind="text";
    if(!line){if(out.length&&out[out.length-1]!=="")out.push("");previous="blank";return;}
    const bullet=line.match(/^(?:[-*+\u2022\u25cf\u25aa])\s+(.*)$/),numbered=line.match(/^(\d{1,2})[.)]\s+(.*)$/);
    if(bullet){line="\u2022 "+bullet[1];kind="list";}else if(numbered){line=numbered[1]+". "+numbered[2];kind="list";}
    line=line.replace(/\*\*/g,"");
    if(previous!=="blank"&&previous!==kind&&out.length)out.push("");
    out.push(line);previous=kind;
  });
  const text=out.join("\n").replace(/\n{3,}/g,"\n\n").trim().slice(0,6000);
  if(!text)throw accazaAiProviderFailure("The provider returned an empty answer.");return text;
}
async function askGeminiAccazaAi(question,facts,history,timeoutMs){
  const key=GEMINI_API_KEY.value();if(!key)throw new HttpsError("failed-precondition","Accaza AI is not configured. Set the GEMINI_API_KEY Firebase secret first.");
  const instruction=ACCAZA_AI_ANALYSIS_INSTRUCTION;
  const contents=[...accazaAiHistory(history).map(row=>({role:row.role,parts:[{text:row.text}]})),{role:"user",parts:[{text:`QUESTION: ${question}\n\nFACT PACK:\n${JSON.stringify(facts)}`}]}];
  const {response,body}=await accazaAiFetchJson("Gemini",`https://generativelanguage.googleapis.com/v1beta/models/${ACCAZA_AI_MODEL}:generateContent`,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents,generationConfig:{temperature:0.15,maxOutputTokens:900}})},timeoutMs);if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,"Gemini could not answer right now."));
  return accazaAiProseAnswer(body&&body.candidates&&body.candidates[0]&&body.candidates[0].content&&body.candidates[0].content.parts&&body.candidates[0].content.parts.map(p=>p.text||"").join("\n"));
}
async function askGeminiWebChat(question,history,timeoutMs){
  const key=GEMINI_API_KEY.value();if(!key)throw new HttpsError("failed-precondition","Accaza AI is not configured. Set the GEMINI_API_KEY Firebase secret first.");
  const instruction=ACCAZA_AI_GENERAL_CHAT_INSTRUCTION;
  const contents=[...accazaAiHistory(history).map(row=>({role:row.role,parts:[{text:row.text}]})),{role:"user",parts:[{text:question}]}],{response,body}=await accazaAiFetchJson("Gemini",`https://generativelanguage.googleapis.com/v1beta/models/${ACCAZA_AI_MODEL}:generateContent`,{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents,generationConfig:{temperature:0.35,maxOutputTokens:900}})},timeoutMs);
  if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,"Gemini general chat could not answer right now."));
  return{answer:accazaAiProseAnswer(body&&body.candidates&&body.candidates[0]&&body.candidates[0].content&&body.candidates[0].content.parts&&body.candidates[0].content.parts.map(part=>part.text||"").join("\n")),sources:[]};
}
function accazaAiOllamaHeaderValue(value){return String(value||"").replace(/[^\x21-\x7E]/g,"");}
function accazaAiOllamaClientId(){return accazaAiOllamaHeaderValue(OLLAMA_ACCESS_CLIENT_ID.value());}
function accazaAiOllamaClientSecret(){return accazaAiOllamaHeaderValue(OLLAMA_ACCESS_CLIENT_SECRET.value());}
function accazaAiOllamaConfigured(){return Boolean(accazaAiOllamaClientId()&&accazaAiOllamaClientSecret());}
async function askOllama(messages,temperature,format,timeoutMs){
  const tokens=Math.max(80,Math.min(ACCAZA_AI_OLLAMA_MAX_TOKENS,Math.floor((Number(timeoutMs||0)/1000-12)*5)));
  const {response,body}=await accazaAiFetchJson("Qwen","https://ollama.accazacoffee.com/api/chat",{method:"POST",headers:{"content-type":"application/json","CF-Access-Client-Id":accazaAiOllamaClientId(),"CF-Access-Client-Secret":accazaAiOllamaClientSecret()},body:JSON.stringify({model:"qwen3:8b",messages,stream:false,think:false,options:{temperature,num_predict:tokens}})},timeoutMs);
  if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,"Qwen fallback could not answer right now."));const content=body&&body.message&&body.message.content;return(format||accazaAiAnswer)(body&&body.done_reason==="length"?accazaAiTrimToSentence(content):content);
}
async function askOllamaAccazaAi(question,facts,history,timeoutMs){
  const instruction=ACCAZA_AI_ANALYSIS_INSTRUCTION;
  return askOllama([{role:"system",content:instruction},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:`QUESTION: ${question}\n\nFACT PACK:\n${JSON.stringify(facts)}`}],0.15,accazaAiProseAnswer,timeoutMs);
}
async function askOllamaGeneralChat(question,history,timeoutMs){
  const instruction=ACCAZA_AI_GENERAL_CHAT_INSTRUCTION;
  return{answer:await askOllama([{role:"system",content:instruction},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:question}],0.35,accazaAiProseAnswer,timeoutMs),sources:[]};
}
// Generic OpenAI-compatible provider (Groq, Cerebras) for General chat and fact-pack analysis.
async function askOpenAiCompatibleChat(label,url,key,model,messages,temperature,timeoutMs,options){
  if(!key)throw new HttpsError("failed-precondition",`The ${label} backup is not configured.`);
  const opts=options||{},{response,body}=await accazaAiFetchJson(label,url,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify(Object.assign({model,messages,temperature,max_tokens:opts.maxTokens||900,stream:false},opts.body||{}))},timeoutMs);
  if(!response.ok)throw accazaAiProviderFailure(accazaAiProviderMessage(body,`${label} could not answer right now.`));
  return accazaAiProseAnswer(body&&body.choices&&body.choices[0]&&body.choices[0].message&&body.choices[0].message.content);
}
async function askGroqGeneralChat(question,history,timeoutMs){
  const messages=[{role:"system",content:ACCAZA_AI_GENERAL_CHAT_INSTRUCTION},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:question}];
  return{answer:await askOpenAiCompatibleChat("Groq",ACCAZA_AI_GROQ_URL,accazaAiGroqKey(),ACCAZA_AI_GROQ_MODEL,messages,0.35,timeoutMs,ACCAZA_AI_GROQ_OPTIONS),sources:[]};
}
async function askCerebrasGeneralChat(question,history,timeoutMs){
  const messages=[{role:"system",content:ACCAZA_AI_GENERAL_CHAT_INSTRUCTION},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:question}];
  return{answer:await askOpenAiCompatibleChat("Cerebras",ACCAZA_AI_CEREBRAS_URL,accazaAiCerebrasKey(),ACCAZA_AI_CEREBRAS_MODEL,messages,0.35,timeoutMs,ACCAZA_AI_CEREBRAS_OPTIONS),sources:[]};
}
async function askCerebrasAccazaAi(question,facts,history,timeoutMs){
  const messages=[{role:"system",content:ACCAZA_AI_ANALYSIS_INSTRUCTION},...accazaAiHistory(history).map(row=>({role:row.role==="model"?"assistant":"user",content:row.text})),{role:"user",content:`QUESTION: ${question}\n\nFACT PACK:\n${JSON.stringify(facts)}`}];
  return askOpenAiCompatibleChat("Cerebras",ACCAZA_AI_CEREBRAS_URL,accazaAiCerebrasKey(),ACCAZA_AI_CEREBRAS_MODEL,messages,0.15,timeoutMs,ACCAZA_AI_CEREBRAS_OPTIONS);
}
// Provider order (6 Oct 2026, Danilo removed DeepSeek, Jev/OpenRouter, Ashna and OrcaRouter after
// their keys or plans stopped working): General chat Gemini -> Groq -> Cerebras -> Qwen (own PC);
// analysis Gemini -> Cerebras -> Qwen (Groq's free-tier token limit is too small for it).
function accazaAiAnalysisProviders(question,facts,history){return[
  {name:"gemini",maxMs:ACCAZA_AI_CLOUD_TIMEOUT_MS,enabled:()=>Boolean(GEMINI_API_KEY.value()),ask:timeoutMs=>askGeminiAccazaAi(question,facts,history,timeoutMs)},
  {name:"cerebras",maxMs:ACCAZA_AI_CLOUD_TIMEOUT_MS,enabled:()=>Boolean(accazaAiCerebrasKey()),ask:timeoutMs=>askCerebrasAccazaAi(question,facts,history,timeoutMs)},
  {name:"ollama",maxMs:ACCAZA_AI_OLLAMA_TIMEOUT_MS,enabled:accazaAiOllamaConfigured,ask:timeoutMs=>askOllamaAccazaAi(question,facts,history,timeoutMs)},
];}
function accazaAiGeneralChatProviders(question,history){return[
  {name:"gemini",maxMs:ACCAZA_AI_CLOUD_TIMEOUT_MS,enabled:()=>Boolean(GEMINI_API_KEY.value()),ask:timeoutMs=>askGeminiWebChat(question,history,timeoutMs)},
  {name:"groq",maxMs:ACCAZA_AI_CLOUD_TIMEOUT_MS,enabled:()=>Boolean(accazaAiGroqKey()),ask:timeoutMs=>askGroqGeneralChat(question,history,timeoutMs)},
  {name:"cerebras",maxMs:ACCAZA_AI_CLOUD_TIMEOUT_MS,enabled:()=>Boolean(accazaAiCerebrasKey()),ask:timeoutMs=>askCerebrasGeneralChat(question,history,timeoutMs)},
  {name:"ollama",maxMs:ACCAZA_AI_OLLAMA_TIMEOUT_MS,enabled:accazaAiOllamaConfigured,ask:timeoutMs=>askOllamaGeneralChat(question,history,timeoutMs)},
];}
// Only unusual outcomes are written (a backup answered, or nothing answered), so a normal
// Gemini answer costs no extra write. The Exception Center reads today and yesterday.
async function accazaAiRecordProviderHealth(context,answeredBy,failures){
  if(!context||!context.db)return;
  const now=Date.now(),day=accazaAiDay(now),event={at:now,answeredBy:answeredBy||"none",surface:accazaAiText(context.surface,40),failures:failures.slice(0,5).map(row=>({provider:row.provider,reason:accazaAiText(row.reason,160)}))};
  console.warn(JSON.stringify({event:answeredBy?"accaza_ai_backup_answered":"accaza_ai_all_providers_failed",severity:answeredBy?"WARNING":"ERROR",...event}));
  try{await context.db.ref(`/accazaAiProviderHealth/${day}`).transaction(current=>{
    const health=current&&typeof current==="object"?current:{},backup=Object.assign({},health.backupAnswers),failed=Object.assign({},health.providerFailures);
    failures.forEach(row=>{failed[row.provider]=Number(failed[row.provider]||0)+1;});
    if(answeredBy)backup[answeredBy]=Number(backup[answeredBy]||0)+1;
    return Object.assign({},health,{backupAnswers:backup,providerFailures:failed,failedQuestions:Number(health.failedQuestions||0)+(answeredBy?0:1),lastEvent:event,updatedAt:now});
  },undefined,false);}catch(_error){/* monitoring must never block or fail an answer */}
}
function accazaAiSelectedProviders(providers,requestedProvider,actor){
  const requested=accazaAiText(requestedProvider,24).toLowerCase();
  if(!requested||requested==="auto")return providers;
  if(!actor||!["owner","superadmin"].includes(actor.role))throw new HttpsError("permission-denied","Manual AI model selection is available to owner and superadmin accounts only.");
  const selected=providers.filter(provider=>provider.name===requested);
  if(!selected.length)throw new HttpsError("invalid-argument","That AI model is not available for this chat mode.");
  return selected;
}
async function accazaAiWithFallback(providers,context){
  const started=Date.now(),failures=[];let configured=0;
  for(let index=0;index<providers.length;index+=1){
    const provider=providers[index];if(!provider.enabled())continue;configured+=1;
    const reserve=providers.slice(index+1).reduce((total,next)=>total+(next.reserveMs&&next.enabled()?next.reserveMs:0),0);
    const remaining=ACCAZA_AI_REQUEST_BUDGET_MS-(Date.now()-started),limit=Math.min(provider.maxMs||ACCAZA_AI_CLOUD_TIMEOUT_MS,remaining-reserve);
    if(limit<ACCAZA_AI_MIN_ATTEMPT_MS){failures.push({provider:provider.name,reason:"Skipped: not enough time left."});continue;}
    try{
      const result=await provider.ask(limit);
      console.info(JSON.stringify({event:"accaza_ai_provider_answered",provider:provider.name,surface:accazaAiText(context&&context.surface,40)||"unknown",fallbackDepth:failures.length,routedModel:accazaAiText(result&&result.routedModel,120)||null}));
      if(failures.length)await accazaAiRecordProviderHealth(context,provider.name,failures);
      return{provider:provider.name,result,failures};
    }catch(error){if(!(error&&error.details&&error.details.providerFailure))throw error;failures.push({provider:provider.name,reason:error.message});}
  }
  if(!configured)throw new HttpsError("failed-precondition","Accaza AI has no configured provider. Set the Gemini, Groq, Cerebras or Ollama credentials.");
  await accazaAiRecordProviderHealth(context,null,failures);
  throw new HttpsError("unavailable",context&&context.general?"The AI service is temporarily unavailable. Please try again in a few minutes.":"Accaza AI is temporarily unavailable. Please try again in a few minutes.");
}
exports.askAccazaAI=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120,memory:"256MiB",secrets:[GEMINI_API_KEY,OLLAMA_ACCESS_CLIENT_ID,OLLAMA_ACCESS_CLIENT_SECRET,CEREBRAS_API_KEY,GROQ_API_KEY]},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);if(!ACCAZA_AI_QUERY_ROLES.includes(actor.role))throw new HttpsError("permission-denied","Accaza AI is available to authorized portal accounts only.");
  const question=accazaAiText(request.data&&request.data.question,800),mode=request.data&&request.data.mode==="web"?"web":"accaza",history=accazaAiHistory(request.data&&request.data.history),requestedProvider=accazaAiText(request.data&&request.data.provider,24).toLowerCase()||"auto";if(question.length<3)throw new HttpsError("invalid-argument","Enter a question for Accaza AI.");
  if(mode==="web"&&accazaAiWebQuestionBlocked(question))throw new HttpsError("failed-precondition","Use Accaza analysis for Accaza business or app questions. Web chat never receives Accaza data.");
  const now=Date.now();let answer,sources=[],provider="gemini",routedModel="",toolCtx=null;
  if(mode==="web"){const response=await accazaAiWithFallback(accazaAiSelectedProviders(accazaAiGeneralChatProviders(question,history),requestedProvider,actor),{db,surface:"admin_general",general:true});provider=response.provider;answer=response.result.answer;sources=response.result.sources;routedModel=accazaAiText(response.result.routedModel,120);}else{const facts=await accazaAiFactPack(db,question,now);toolCtx=ACCAZA_AI_TOOL_ROLES.includes(actor.role)?accazaAiToolContext(db):null;const response=await accazaAiWithFallback(accazaAiSelectedProviders(toolCtx?accazaAiAgentProviders(question,facts,history,toolCtx,now):accazaAiAnalysisProviders(question,facts,history),requestedProvider,actor),{db,surface:toolCtx?"admin_analysis_records":"admin_analysis",general:false}).finally(()=>accazaAiCommitRtdbUsage(toolCtx));provider=response.provider;answer=typeof response.result==="string"?response.result:response.result.answer;routedModel=typeof response.result==="string"?"":accazaAiText(response.result.routedModel,120);sources=(facts.sources||[]).concat(toolCtx?accazaAiToolSources(toolCtx):[]);}
  const auditId=`${now}_${crypto.randomUUID()}`;await db.ref(`/operationalAudit/${auditId}`).set(operationalAuditRecord("ask_accaza_ai","accazaAI",auditId,actor,{mode,provider,requestedProvider,routedModel:routedModel||null,questionHash:crypto.createHash("sha256").update(question).digest("hex"),sources:mode==="web"?sources.map(source=>source.url):sources,recordToolCalls:toolCtx?toolCtx.calls.slice(0,24).map(call=>({tool:call.tool,args:JSON.stringify(call.args).slice(0,200),records:call.records,failed:call.failed===true})):null,recordsRead:toolCtx?toolCtx.recordsRead:0,rtdbBytes:toolCtx?toolCtx.rtdbBytes:0,firestoreReads:toolCtx?Number(toolCtx.firestoreReads||0):0,accounting:"Read-only AI analysis only; no order, inventory movement, subledger, Finance movement, or Books journal changed."}));
  return {answer,sources,mode,provider,routedModel:routedModel||null,releaseVersion:ACCAZA_AI_RELEASE_VERSION};
});
exports.manageAccazaAiKnowledge=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);
  if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","Accaza Knowledge Base is available to management accounts only.");
  const data=request.data||{},action=accazaAiText(data.action,20),now=Date.now();
  if(action==="seed"){
    const writes={},changed=[];
    await Promise.all(Object.entries(ACCAZA_AI_KNOWLEDGE_SEED).map(async([category,article])=>{
      const existing=(await db.ref(`/accazaAiKnowledge/${category}`).get()).val();
      if(!existing||(existing.seeded===true&&Number(existing.seedVersion||1)<ACCAZA_AI_MANUAL_VERSION)){
        writes[`accazaAiKnowledge/${category}`]={...article,status:"published",version:Number(existing&&existing.version||0)+1,createdAt:Number(existing&&existing.createdAt||now),updatedAt:now,updatedBy:actor.uid,seeded:true,seedVersion:ACCAZA_AI_MANUAL_VERSION};changed.push(category);
      }
    }));
    if(Object.keys(writes).length)await db.ref().update(Object.assign(writes,{[`operationalAudit/${now}_accaza_ai_knowledge_seed`]:operationalAuditRecord("seed_accaza_ai_knowledge","accazaAiKnowledge","seed",actor,{categories:changed,manualVersion:ACCAZA_AI_MANUAL_VERSION})}));
    return{seeded:changed.length,categories:changed,manualVersion:ACCAZA_AI_MANUAL_VERSION};
  }
  const category=accazaAiText(data.category,40).toLowerCase();
  if(!Object.prototype.hasOwnProperty.call(ACCAZA_AI_KNOWLEDGE_SEED,category))throw new HttpsError("invalid-argument","Choose a valid Accaza manual chapter.");
  if(action==="get")return{category,article:(await db.ref(`/accazaAiKnowledge/${category}`).get()).val()||null};
  if(action!=="save")throw new HttpsError("invalid-argument","Use seed, get or save.");
  const title=accazaAiText(data.title,160),content=accazaAiText(data.content,12000);
  if(!title||content.length<20)throw new HttpsError("invalid-argument","A title and at least 20 characters of knowledge are required.");
  const current=(await db.ref(`/accazaAiKnowledge/${category}`).get()).val()||{},record={title,content,status:data.status==="draft"?"draft":"published",version:Number(current.version||0)+1,createdAt:Number(current.createdAt||now),updatedAt:now,updatedBy:actor.uid,seeded:false,seedVersion:ACCAZA_AI_MANUAL_VERSION};
  await db.ref().update({[`accazaAiKnowledge/${category}`]:record,[`operationalAudit/${now}_accaza_ai_knowledge_${category}`]:operationalAuditRecord("save_accaza_ai_knowledge","accazaAiKnowledge",category,actor,{version:record.version,status:record.status,contentHash:crypto.createHash("sha256").update(content).digest("hex")})});
  return{category,article:record};
});
exports.manageAccazaAiIssue=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);
  if(!["owner","superadmin","admin","manager"].includes(actor.role))throw new HttpsError("permission-denied","The Accaza improvement register is available to management accounts only.");
  const data=request.data||{},action=accazaAiText(data.action,20),now=Date.now();
  if(action==="list"){
    const rows=Object.entries((await db.ref("/accazaAiIssues").orderByChild("createdAt").limitToLast(50).get()).val()||{}).map(([id,row])=>({id,area:accazaAiText(row.area,40),summary:accazaAiText(row.summary,240),impact:accazaAiText(row.impact,240),status:accazaAiText(row.status,30),createdAt:Number(row.createdAt||0),updatedAt:Number(row.updatedAt||0)})).sort((a,b)=>b.createdAt-a.createdAt);
    return{issues:rows};
  }
  if(action==="create"){
    const area=accazaAiText(data.area,40),summary=accazaAiText(data.summary,240),impact=accazaAiText(data.impact,800),requestedOutcome=accazaAiText(data.requestedOutcome,800);
    if(!area||summary.length<5||impact.length<5)throw new HttpsError("invalid-argument","Area, issue summary and business impact are required.");
    const id=`${now}_${crypto.randomUUID()}`,record={area,summary,impact,requestedOutcome,status:"open",createdAt:now,updatedAt:now,createdBy:actor.uid};
    await db.ref().update({[`accazaAiIssues/${id}`]:record,[`operationalAudit/${now}_accaza_ai_issue`]:operationalAuditRecord("create_accaza_ai_issue","accazaAiIssues",id,actor,{area,summaryHash:crypto.createHash("sha256").update(summary).digest("hex"),status:"open"})});
    return{id,issue:record};
  }
  if(action==="status"){
    const id=accazaAiText(data.id,120),statusValue=accazaAiText(data.status,30);if(!id||!["open","reviewing","planned","resolved","not_reproducible"].includes(statusValue))throw new HttpsError("invalid-argument","Choose a valid issue and status.");
    const existing=(await db.ref(`/accazaAiIssues/${id}`).get()).val();if(!existing)throw new HttpsError("not-found","The issue was not found.");
    await db.ref().update({[`accazaAiIssues/${id}/status`]:statusValue,[`accazaAiIssues/${id}/updatedAt`]:now,[`accazaAiIssues/${id}/updatedBy`]:actor.uid,[`operationalAudit/${now}_accaza_ai_issue_status`]:operationalAuditRecord("update_accaza_ai_issue","accazaAiIssues",id,actor,{status:statusValue})});
    return{id,status:statusValue};
  }
  throw new HttpsError("invalid-argument","Use create, list or status.");
});
