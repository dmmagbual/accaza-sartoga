// Accaza AI — standalone installable app. Fully independent of admin.html's Accaza AI:
// separate callable, separate audit action, general chat only, no Accaza business-data
// access, and no per-user rate limit. Reuses only the low-level helpers and constants
// already declared above in this bundle (accazaAiText/accazaAiHistory/accazaAiWebQuestionBlocked/
// askGemini|DeepSeek|OllamaGeneralChat/accazaAiWithFallback/accazaAiOllamaConfigured/
// ACCAZA_AI_QUERY_ROLES/requirePortalUser/operationalAuditRecord) — never the removed
// fact-pack/rate-limit code from askAccazaAI, which stays untouched.
const ACCAZA_AI_STANDALONE_RELEASE_VERSION = "1.0";
exports.askAccazaAIStandalone=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB",secrets:[GEMINI_API_KEY,DEEPSEEK_API_KEY,OLLAMA_ACCESS_CLIENT_ID,OLLAMA_ACCESS_CLIENT_SECRET]},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);
  if(!ACCAZA_AI_QUERY_ROLES.includes(actor.role))throw new HttpsError("permission-denied","Accaza AI is available to authorized portal accounts only.");
  const question=accazaAiText(request.data&&request.data.question,800),history=accazaAiHistory(request.data&&request.data.history);
  if(question.length<3)throw new HttpsError("invalid-argument","Enter a question for Accaza AI.");
  if(accazaAiWebQuestionBlocked(question))throw new HttpsError("failed-precondition","Accaza AI is general chat only here and has no access to Accaza business data.");
  const now=Date.now(),response=await accazaAiWithFallback([{name:"gemini",enabled:()=>Boolean(GEMINI_API_KEY.value()),ask:()=>askGeminiWebChat(question,history)},{name:"deepseek",enabled:()=>Boolean(DEEPSEEK_API_KEY.value()),ask:()=>askDeepSeekGeneralChat(question,history)},{name:"ollama",enabled:accazaAiOllamaConfigured,ask:()=>askOllamaGeneralChat(question,history)}]);
  const provider=response.provider,answer=response.result.answer,sources=response.result.sources||[];
  const auditId=`${now}_${crypto.randomUUID()}`;
  await db.ref(`/operationalAudit/${auditId}`).set(operationalAuditRecord("ask_accaza_ai_standalone","accazaAIStandalone",auditId,actor,{provider,questionHash:crypto.createHash("sha256").update(question).digest("hex"),sources:sources.map(source=>source.url),accounting:"Read-only general AI chat only (standalone Accaza AI app); zero access to Accaza business data; no order, inventory movement, subledger, Finance movement, or Books journal touched."}));
  return {answer,sources,provider,releaseVersion:ACCAZA_AI_STANDALONE_RELEASE_VERSION};
});
