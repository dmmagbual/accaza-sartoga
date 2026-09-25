// Accaza AI — standalone installable app. Fully independent of admin.html's Accaza AI:
// separate callable, separate audit action, general chat only, no Accaza business-data
// access. Reuses only the low-level helpers and constants already declared above in this
// bundle (accazaAiText/accazaAiHistory/accazaAiWebQuestionBlocked/askGemini|DeepSeek|
// OllamaGeneralChat/accazaAiWithFallback/accazaAiOllamaConfigured/accazaAiDay/
// ACCAZA_AI_QUERY_ROLES/requirePortalUser/operationalAuditRecord) — never the fact-pack or
// admin rate-limit code from askAccazaAI, which stays untouched.
//
// Two audiences:
// - Staff (portal accounts in ACCAZA_AI_QUERY_ROLES): unlimited.
// - Guests (Firebase anonymous sign-in): 10 messages per Manila business day per guest,
//   plus a shared daily ceiling across ALL guests so a guest who keeps resetting their
//   browser (new anonymous uid) cannot run up the AI provider bill without bound.
const ACCAZA_AI_STANDALONE_RELEASE_VERSION = "1.2";
const ACCAZA_AI_GUEST_DAILY_LIMIT = 10;
const ACCAZA_AI_GUEST_GLOBAL_DAILY_LIMIT = 100;
function accazaAiStandaloneIsGuest(request){return Boolean(request.auth&&request.auth.uid&&request.auth.token&&request.auth.token.firebase&&request.auth.token.firebase.sign_in_provider==="anonymous");}
// One transaction on the day node enforces both limits atomically, so concurrent sends
// from one guest (or many guests at the ceiling) cannot overshoot either limit.
async function claimAccazaAiGuestMessage(db,uid,day,now){
  let limit="";
  const claimed=await db.ref(`/accazaAiGuestUsage/${day}`).transaction(current=>{
    const usage=current&&typeof current==="object"?current:{},users=usage.users&&typeof usage.users==="object"?usage.users:{},mine=Number(users[uid]&&users[uid].count||0),total=Number(usage.total||0);
    if(mine>=ACCAZA_AI_GUEST_DAILY_LIMIT){limit="guest";return;}
    if(total>=ACCAZA_AI_GUEST_GLOBAL_DAILY_LIMIT){limit="global";return;}
    return {total:total+1,updatedAt:now,users:Object.assign({},users,{[uid]:{count:mine+1,updatedAt:now}})};
  },undefined,false);
  if(!claimed.committed)throw new HttpsError("resource-exhausted",limit==="guest"?`Guest limit reached (${ACCAZA_AI_GUEST_DAILY_LIMIT} messages today). Try again tomorrow, or sign in with a staff account.`:"Guest chat is busy today. Please try again tomorrow, or sign in with a staff account.");
  const users=(claimed.snapshot.val()||{}).users||{};
  return {used:Number(users[uid]&&users[uid].count||0),limit:ACCAZA_AI_GUEST_DAILY_LIMIT,remaining:Math.max(0,ACCAZA_AI_GUEST_DAILY_LIMIT-Number(users[uid]&&users[uid].count||0))};
}
// A message the AI never answered should not cost the guest one of their 10.
async function releaseAccazaAiGuestMessage(db,uid,day){
  try{await db.ref(`/accazaAiGuestUsage/${day}`).transaction(current=>{
    if(!current||typeof current!=="object")return current;
    const users=current.users&&typeof current.users==="object"?current.users:{},mine=Number(users[uid]&&users[uid].count||0);if(mine<1)return current;
    return Object.assign({},current,{total:Math.max(0,Number(current.total||0)-1),users:Object.assign({},users,{[uid]:Object.assign({},users[uid],{count:mine-1})})});
  },undefined,false);}catch(_error){/* best effort: a failed refund only costs the guest one message */}
}
exports.askAccazaAIStandalone=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:120,memory:"256MiB",secrets:[GEMINI_API_KEY,DEEPSEEK_API_KEY,OLLAMA_ACCESS_CLIENT_ID,OLLAMA_ACCESS_CLIENT_SECRET,ASHNA_API_KEY]},async request=>{
  const db=getDatabase(),guest=accazaAiStandaloneIsGuest(request);
  let actor;
  if(guest)actor={uid:request.auth.uid,role:"guest"};
  else{actor=await requirePortalUser(db,request);if(!ACCAZA_AI_QUERY_ROLES.includes(actor.role))throw new HttpsError("permission-denied","Accaza AI is available to authorized portal accounts only.");}
  const question=accazaAiText(request.data&&request.data.question,800),history=accazaAiHistory(request.data&&request.data.history);
  if(question.length<3)throw new HttpsError("invalid-argument","Enter a question for Accaza AI.");
  if(accazaAiWebQuestionBlocked(question))throw new HttpsError("failed-precondition","Accaza AI is general chat only here and has no access to Accaza business data.");
  const now=Date.now(),day=accazaAiDay(now),allowance=guest?await claimAccazaAiGuestMessage(db,actor.uid,day,now):null;
  let response;
  try{response=await accazaAiWithFallback(accazaAiGeneralChatProviders(question,history),{db,surface:guest?"standalone_guest":"standalone_staff",general:true});}
  catch(error){if(guest)await releaseAccazaAiGuestMessage(db,actor.uid,day);throw error;}
  const provider=response.provider,answer=response.result.answer,sources=response.result.sources||[];
  const auditId=`${now}_${crypto.randomUUID()}`;
  await db.ref(`/operationalAudit/${auditId}`).set(operationalAuditRecord("ask_accaza_ai_standalone","accazaAIStandalone",auditId,actor,{provider,guest,questionHash:crypto.createHash("sha256").update(question).digest("hex"),sources:sources.map(source=>source.url),guestUsed:allowance?allowance.used:null,accounting:"Read-only general AI chat only (standalone Accaza AI app); zero access to Accaza business data; no order, inventory movement, subledger, Finance movement, or Books journal touched."}));
  return {answer,sources,provider,guest,allowance,releaseVersion:ACCAZA_AI_STANDALONE_RELEASE_VERSION};
});
