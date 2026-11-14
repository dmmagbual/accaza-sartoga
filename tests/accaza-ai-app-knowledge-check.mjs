import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const guide=fs.readFileSync('src/functions/62-accaza-workflows.js','utf8');
const context=vm.createContext({});
vm.runInContext('const ACCAZA_AI_KNOWLEDGE_SEED={}; function accazaAiSearchText(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}\n'+guide+'\nthis.pick=accazaAiWorkflowFacts; this.followup=accazaAiWorkflowQuestion; this.all=ACCAZA_AI_WORKFLOWS; this.sourceMap=ACCAZA_AI_WORKFLOW_SOURCES;',context);
for(const [question,id] of [['How do I pay salaries?','cashpayments'],['How do I receive a supplier delivery?','purchases'],['How do I count the drawer at shift close?','shifts'],['How do I record wastage?','inventory'],['Where do I settle FoodPanda payout?','payouts'],['How do I reopen a closed month?','periods'],['How do I manage a reward?','rewards'],['How do I manage staff access?','access'],['Where can I see bookings?','reservations'],['Where do I see a system health alert?','operations'],['How do I create a recipe?','recipes'],['How do I post a baking batch?','baking'],['How do I record internet and telephone bills?','cashpayments'],['How can I enable a promotion?','packages'],['How do I add a new staff member?','access'],['How do I record depreciation?','books'],['Where do I record a supplier payment before delivery?','cashpayments']]) assert.ok(context.pick(question).some(x=>x.id===id),question);
assert.equal(new Set(Array.from(context.all,x=>x.id)).size,context.all.length);
for(const workflow of context.all) assert.ok(context.pick(workflow.terms[0]).some(x=>x.id===workflow.id),`No route for ${workflow.id}`);
for(const workflow of context.all){assert.ok(context.sourceMap[workflow.id],`Missing source for ${workflow.id}`);assert.ok(fs.existsSync(context.sourceMap[workflow.id]),`Missing source file for ${workflow.id}`);}
assert.ok(context.pick(context.followup('How do I do that?', [{role:'user',text:'How do I create a recipe?'}])).some(x=>x.id==='recipes'));
assert.ok(context.pick('How do I make a supplier refund?').some(x=>x.id==='supplierrefunds'));
assert.ok(!context.pick('How do I make a supplier refund?').some(x=>x.id==='refunds'));
for(const id of ['recipes','baking']){const g=context.all.find(x=>x.id===id).guide;assert.match(g,/1\./);assert.match(g,/2\./);assert.match(g,/3\./)}
const ai=fs.readFileSync('src/functions/62-accaza-ai.js','utf8');
const part=ai.slice(ai.indexOf('async function accazaAiAccessContext('),ai.indexOf('function accazaAiHistory('));
// Published custom chapters default to management-only until explicitly shared.
{
 const source=ai.slice(ai.indexOf('async function accazaAiKnowledgeFacts('),ai.indexOf('function accazaAiMoney('));
 const lookup=new Function('accazaAiKnowledgeCategories','accazaAiText',source+';return accazaAiKnowledgeFacts;')(()=>['general','recipes','baking'],(x,n)=>String(x||'').slice(0,n));
 const entries={general:{status:'published',content:'private',seeded:false},recipes:{status:'published',content:'standard',seeded:true},baking:{status:'published',content:'shared',audience:'staff'}};
 const fake={ref:path=>({get:async()=>({val:()=>entries[path.split('/').pop()]})})};
 const cashier=await lookup(fake,'test',{role:'cashier'});assert.deepEqual(cashier.articles.map(x=>x.content),['standard','shared']);
 const manager=await lookup(fake,'test',{role:'manager'});assert.deepEqual(manager.articles.map(x=>x.content),['private','standard','shared']);
 entries.baking.status='draft';assert.equal((await lookup(fake,'test',{role:'cashier'})).articles.length,1);entries.recipes.audience='management';assert.equal((await lookup(fake,'test',{role:'cashier'})).articles.length,0);
}
const reads=[],matchedQuestions=[];let grants={},failGrants=false;
const rows={'/inventory':{milk:{name:'Milk',stock:7,unit:'L',cost:3}},'/menuItems':{coffee:{name:'Coffee',price:100}},'/suppliers':{vendor1:{name:'Vendor One'}}};
const db={ref(path){reads.push(path);return {get:async()=>{if(path==='/adminPerms/c'&&failGrants)throw Error('denied');return{val:()=>path==='/adminPerms/c'?grants:(rows[path]||{})}},orderByChild(){return this},equalTo(){return this},limitToLast(){return this}}}};
const load=new Function('ACCAZA_AI_APP_GUIDE','ACCAZA_AI_DATA_MAP','accazaAiKnowledgeFacts','accazaAiWorkflowFacts','accazaAiWorkflowQuestion','accazaAiComparisonMonths','accazaAiDay','accazaAiRows','accazaAiBusinessAnalysisRequested','accazaAiItemMatch','ACCAZA_AI_HISTORY_KEY','crypto','accazaAiHistory','accazaAiText',part+';return {pack:accazaAiFactPack,access:accazaAiAccessContext,token:accazaAiHistoryToken,valid:accazaAiHistoryValid};');
const normalizeHistory=rows=>(Array.isArray(rows)?rows:[]).slice(-8).map(row=>({role:row&&row.role==='model'?'model':'user',text:String(row&&row.text||'').replace(/\s+/g,' ').trim().slice(0,800)})).filter(row=>row.text);
const secret={value:()=>'x'.repeat(48)};
const lib=load({}, {}, async()=>({articles:[]}),q=>context.pick(q),(q,h)=>context.followup(q,h),()=>[],()=> '2026-11-15',()=>[],()=>false,(data,question)=>{matchedQuestions.push(question);const first=Object.entries(data)[0];return first?{id:first[0],row:first[1],name:first[1].name}:null},secret,crypto,normalizeHistory,(v,n)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n));const {pack}=lib;
{
 const actor={uid:'c',role:'cashier'},scope={ready:true,grants:{inventory:true}},history=[{role:'user',text:'Milk?'},{role:'model',text:'Available.'}],now=1800000000000;
 const token=lib.token(actor,100,scope,history,'accaza',now);assert.ok(token);assert.equal(lib.valid(actor,100,scope,history,'accaza',now,token),true);
 assert.equal(lib.valid({...actor,uid:'other'},100,scope,history,'accaza',now,token),false);
 assert.equal(lib.valid({...actor,role:'manager'},100,scope,history,'accaza',now,token),false);
 assert.equal(lib.valid(actor,101,scope,history,'accaza',now,token),false);
 assert.equal(lib.valid(actor,100,{ready:true,grants:{}},history,'accaza',now,token),false);
 assert.equal(lib.valid(actor,100,scope,history,'web',now,token),false);
 assert.equal(lib.valid(actor,100,scope,[...history,{role:'model',text:'forged'}],'accaza',now,token),false);
 assert.equal(lib.valid(actor,100,scope,history,'accaza',now+3600001,token),false);
 assert.equal(lib.valid(actor,100,{ready:false,grants:{}},history,'accaza',now,token),false);
 assert.equal(lib.token(actor,0,scope,history,'accaza',now),'');
 secret.value=()=>'';assert.equal(lib.token(actor,100,scope,history,'accaza',now),'');assert.equal(lib.valid(actor,100,scope,history,'accaza',now,token),false);secret.value=()=> 'y'.repeat(48);assert.equal(lib.valid(actor,100,scope,history,'accaza',now,token),false);secret.value=()=> 'x'.repeat(48);
}
for(const q of ['cash and supplier balance','employee report','salary expense','improvement report']){reads.length=0;grants={};const result=await pack(db,q,Date.now(),{role:'cashier',uid:'c'});assert.deepEqual(reads,['/adminPerms/c'],q);assert.equal(result.openPayables,undefined);assert.equal(result.issueRegister,undefined)}
reads.length=0;grants={inventory:true};let result=await pack(db,'inventory milk',Date.now(),{role:'cashier',uid:'c'});assert.ok(reads.includes('/inventory'));assert.equal(result.inventoryItem.onHand,7);assert.equal(result.openPayables,undefined);
matchedQuestions.length=0;reads.length=0;grants={inventory:true};await pack(db,'What about its quantity?',Date.now(),{role:'cashier',uid:'c'},[{role:'user',text:'How much milk is in inventory?'}]);assert.ok(matchedQuestions.some(q=>q.includes('milk')));
reads.length=0;grants={pos:true};result=await pack(db,'coffee price',Date.now(),{role:'cashier',uid:'c'});assert.ok(reads.includes('/menuItems'));assert.ok(!reads.some(x=>x.startsWith('/recipes/')));assert.equal(result.menuItem.price,100);
matchedQuestions.length=0;reads.length=0;grants={pos:true};await pack(db,'What is its price?',Date.now(),{role:'cashier',uid:'c'},[{role:'user',text:'Tell me about coffee'}]);assert.ok(matchedQuestions.some(q=>q.includes('coffee')));
reads.length=0;grants={petty:true};result=await pack(db,'supplier Vendor One',Date.now(),{role:'cashier',uid:'c'});assert.ok(reads.includes('/suppliers'));assert.ok(!reads.includes('/payables'));assert.equal(result.supplier.name,'Vendor One');
reads.length=0;grants={inventory:true};failGrants=true;await pack(db,'inventory milk',Date.now(),{role:'cashier',uid:'c'});assert.deepEqual(reads,['/adminPerms/c']);failGrants=false;
reads.length=0;await pack(db,'cash balance',Date.now(),{role:'manager'});assert.ok(reads.includes('/cashBalanceSummary/balances'));assert.ok(reads.includes('/payables'));
reads.length=0;await pack(db,'cash balance',Date.now(),null);assert.deepEqual(reads,[]);
const chat=fs.readFileSync('src/functions/62-accaza-chat.js','utf8');assert.ok(chat.includes('accazaAiFactPack(db,question,now,actor,history,access)'));
// Exercise the real callable body with a provider spy and the real fact pack.
{
 const body=chat.slice(chat.indexOf('exports.askAccazaAI=onCall('),chat.indexOf('exports.manageAccazaAiKnowledge=onCall('));
 const exported={},sent=[],sentHistory=[];let caller={uid:'c',role:'cashier'};
 const auditDb={ref(path){if(path.startsWith('/operationalAudit/'))return{set:async()=>{}};return db.ref(path)}};
 const scope={exports:exported,onCall:(_config,fn)=>fn,ORDER_REGION:'test',ENFORCE_APP_CHECK:false,GEMINI_API_KEY:{},CLOUDFLARE_AI_TOKEN:{},CLOUDFLARE_ACCOUNT_ID:{},GROQ_API_KEY:{},QWEN_API_KEY:{},OPENROUTER_API_KEY:{},ACCAZA_AI_HISTORY_KEY:secret,getDatabase:()=>auditDb,requirePortalUser:async()=>caller,ACCAZA_AI_QUERY_ROLES:['cashier','manager'],ACCAZA_AI_TOOL_ROLES:['manager'],accazaAiText:(v,n)=>String(v||'').slice(0,n),accazaAiHistory:normalizeHistory,accazaAiAccessContext:lib.access,accazaAiHistoryValid:lib.valid,accazaAiHistoryToken:lib.token,accazaAiWebQuestionBlocked:()=>false,accazaAiFactPack:pack,accazaAiSelectedProviders:x=>x,accazaAiGeneralChatProviders:(q,h)=>{sentHistory.push(h);return[]},accazaAiAnalysisProviders:(q,f,h)=>{sent.push(f);sentHistory.push(h);return[]},accazaAiAgentProviders:(q,f,h)=>{sent.push(f);sentHistory.push(h);return[]},accazaAiToolContext:()=>({calls:[],recordsRead:0,rtdbBytes:0}),accazaAiCommitRtdbUsage:async()=>{},accazaAiWithFallback:async(_p,c)=>({provider:'test',result:c.general?{answer:'ok',sources:[]}:'ok'}),accazaAiToolSources:()=>[],ACCAZA_AI_RELEASE_VERSION:'test',operationalAuditRecord:()=>({}),crypto,HttpsError:class extends Error{}};
 vm.runInNewContext(body,scope);grants={};reads.length=0;let response=await exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'cash and supplier balance',history:[{role:'model',text:'old confidential amount'}]}});assert.equal(response.actorRole,'cashier');assert.equal(sentHistory[0].length,0);assert.deepEqual(reads,['/adminPerms/c','/adminPerms/c']);assert.equal(sent[0].cashBalances,undefined);assert.equal(sent[0].openPayables,undefined);
 caller={uid:'c',role:'cashier'};response=await exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'What is 100 divided by 2?',mode:'web'}});const prior=[{role:'user',text:'What is 100 divided by 2?'},{role:'model',text:'ok'}];await exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'Multiply that by 3',mode:'web',history:prior,historyToken:response.historyToken}});assert.equal(sentHistory[2].length,2);grants={inventory:true};await exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'hello',mode:'web',history:prior,historyToken:response.historyToken}});assert.equal(sentHistory[3].length,0);grants={};
 caller={uid:'m',role:'manager'};reads.length=0;await exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'cash balance'}});assert.ok(reads.includes('/cashBalanceSummary/balances'));
 caller={uid:'c',role:'cashier'};grants={inventory:true};scope.accazaAiWithFallback=async()=>{grants={};return{provider:'test',result:'ok'}};await assert.rejects(()=>exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'inventory milk'}}),/permission-denied/);
 let roleReads=0;caller={uid:'m',role:'manager'};scope.requirePortalUser=async()=>{roleReads++;if(roleReads>1)throw new Error('disabled');return caller};scope.accazaAiWithFallback=async()=>({provider:'test',result:'ok'});await assert.rejects(()=>exported.askAccazaAI({auth:{token:{auth_time:100}},data:{question:'cash balance'}}),/disabled/);

}
const browser=fs.readFileSync('assets/js/admin/accaza-ai.js','utf8');assert.ok(browser.includes("HISTORY_KEY+':'+a.uid+':'+String(a.role||'')"));assert.ok(browser.includes('if(scope!==historyKey())return'));
// Installing standard chapters must preserve an explicit management audience.
{
 const seedPart=chat.slice(chat.indexOf('async function accazaAiKnowledgeWrite('),chat.indexOf('exports.manageAccazaAiIssue=onCall('));
 const stored={recipes:{seeded:true,seedVersion:2,audience:'management',version:2},baking:{seeded:true,seedVersion:2,version:1}};let updates;
 let lock=null,hold=false,releaseGet,enteredGet;const entered=new Promise(resolve=>{enteredGet=resolve});const seedDb={ref:path=>path==='/accazaAiKnowledgeWriteLock'?{transaction:async fn=>{if(lock!==null)assert.notEqual(fn(null),undefined,'cold cache must consult the server');const next=fn(lock);if(next===undefined)return{committed:false};lock=next;return{committed:true}}}:path?{get:async()=>{if(hold&&path.endsWith('/recipes')){enteredGet();await new Promise(resolve=>{releaseGet=resolve})}return{val:()=>stored[path.split('/').pop()]||null}}}:{update:async x=>{updates=x;for(const [key,value] of Object.entries(x))if(key.startsWith('accazaAiKnowledge/'))stored[key.split('/').pop()]=value}}};
 const out={},scope={exports:out,onCall:(_c,f)=>f,ORDER_REGION:'test',ENFORCE_APP_CHECK:false,getDatabase:()=>seedDb,requirePortalUser:async()=>({uid:'m',role:'manager'}),accazaAiText:(v,n)=>String(v||'').slice(0,n),ACCAZA_AI_KNOWLEDGE_SEED:{recipes:{title:'Recipe',content:'R'},baking:{title:'Baking',content:'B'}},accazaAiSeedVersion:()=>4,ACCAZA_AI_MANUAL_VERSION:4,operationalAuditRecord:()=>({}),crypto,logger:{warn(){}},HttpsError:class extends Error{}};
 vm.runInNewContext(seedPart+'\nthis.testManualLock=accazaAiKnowledgeWrite;',scope);await out.manageAccazaAiKnowledge({data:{action:'seed'}});assert.equal(updates['accazaAiKnowledge/recipes'].audience,'management');assert.equal(updates['accazaAiKnowledge/baking'].audience,'staff');
 stored.recipes.seedVersion=2;hold=true;const seedPromise=out.manageAccazaAiKnowledge({data:{action:'seed'}});await entered;await assert.rejects(()=>out.manageAccazaAiKnowledge({data:{action:'save',category:'recipes',title:'Private',content:'A sufficiently long private procedure',status:'published'}}),/aborted/);hold=false;releaseGet();await seedPromise;await out.manageAccazaAiKnowledge({data:{action:'save',category:'recipes',title:'Private',content:'A sufficiently long private procedure',status:'published'}});await out.manageAccazaAiKnowledge({data:{action:'seed'}});assert.equal(stored.recipes.title,'Private');assert.equal(stored.recipes.audience,'management');
 lock={owner:'stalled',expiresAt:1};await assert.rejects(()=>out.manageAccazaAiKnowledge({data:{action:'seed'}}),/aborted/);assert.equal(lock.owner,'stalled');
 lock=null;let finishWork,startedWork;const started=new Promise(resolve=>{startedWork=resolve});const running=scope.testManualLock(seedDb,{uid:'m'},async()=>{startedWork();await new Promise(resolve=>{finishWork=resolve})});await started;lock={owner:'replacement'};finishWork();await running;assert.equal(lock.owner,'replacement');



}
// Run the actual browser history and panel identity code with a minimal DOM.
{
 let panel={dataset:{aiScope:'accaza_ai_chat_history_v2:manager:manager'},remove(){panel=null}};
 const state=new Map(),win={__accazaAuthz:{uid:'manager',role:'manager'}},doc={getElementById:id=>id==='accazaAiPanel'?panel:null,addEventListener(){}};
 const store={getItem:k=>state.get(k)||null,setItem:(k,v)=>state.set(k,v)};
 const code=browser.replace(/\}\)\(\);\s*$/,"window.__aiTest={history,remember,historyKey};})();");
 vm.runInNewContext(code,{window:win,document:doc,sessionStorage:store,console});
 const longAnswer=('Line one.\n\n  More detail. '.repeat(100)),longQuestion='  How   do I create this recipe?  ';win.__aiTest.remember('accaza','user',longQuestion);win.__aiTest.remember('accaza','assistant',longAnswer);const prior=normalizeHistory([{role:'user',text:longQuestion},{role:'model',text:longAnswer}]),sig=lib.token({uid:'manager',role:'manager'},100,{ready:true,grants:{}},prior,'accaza',1800000000000);assert.equal(lib.valid({uid:'manager',role:'manager'},100,{ready:true,grants:{}},win.__aiTest.history('accaza'),'accaza',1800000000000,sig),true);assert.equal(win.__aiTest.history('accaza').length,2);
 win.__accazaAuthz={uid:'cashier',role:'cashier'};win.__accazaAiIdentityChanged();assert.equal(panel,null);assert.equal(win.__aiTest.history('accaza').length,0);
 win.__accazaAuthz={uid:'manager',role:'manager'};assert.equal(win.__aiTest.history('accaza').length,2);
}
// A revoked session must remove the already-open panel on callable rejection.
{
 let panel={dataset:{},remove(){panel=null}},input={value:'question'},button={disabled:false};
 const messages={appendChild(){}},doc={getElementById(id){return id==='accazaAiPanel'?panel:id==='accazaAiQuestion'?input:id==='accazaAiAsk'?button:id==='accazaAiMessages'?messages:null},addEventListener(){},createElement(){return{style:{},scrollIntoView(){}}}};
 const win={__accazaAuthz:{uid:'u',role:'manager'},__accaza:{askAccazaAI:async()=>{throw {code:'functions/permission-denied'}}}};
 const store={getItem:()=>null,setItem(){}};
 const code=browser.replace(/\}\)\(\);\s*$/,"window.__aiAsk=ask;})();");
 vm.runInNewContext(code,{window:win,document:doc,sessionStorage:store,setTimeout,clearTimeout,console});
 await win.__aiAsk();assert.equal(panel,null);
}
// Stale manual loads must not overwrite a newly selected chapter or enable saving.
{
 const elements={};for(const id of ['accazaAiIssueOpen','accazaAiManualOpen','accazaAiChat','accazaManual','accazaManualChapter','accazaManualSeed','accazaManualSave','accazaManualTitle','accazaManualContent','accazaManualState','accazaManualAudience','accazaManualStatus'])elements[id]={value:'',style:{},disabled:false};
 elements.accazaManual.style.display='none';elements.accazaManualChapter.value='recipes';const pending=[];
 const w={__accazaAiCore:{by:id=>elements[id],add(){},setMode(){},chat(){},mode:()=> 'accaza'},__accaza:{manageAccazaAiKnowledge:arg=>new Promise(resolve=>pending.push({arg,resolve}))}};
 vm.runInNewContext(fs.readFileSync('assets/js/admin/accaza-ai-manager.js','utf8'),{window:w,document:{getElementById:id=>elements[id]},confirm:()=>true});
 w.__accazaAiManager.wire();elements.accazaAiManualOpen.onclick();elements.accazaManualChapter.value='baking';elements.accazaManualChapter.onchange();assert.equal(elements.accazaManualSave.disabled,true);await elements.accazaManualSave.onclick();assert.equal(pending.length,2);
 pending[1].resolve({data:{article:{title:'Baking',content:'Baking procedure',status:'published',audience:'management'}}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(elements.accazaManualTitle.value,'Baking');assert.equal(elements.accazaManualAudience.value,'management');assert.equal(elements.accazaManualSave.disabled,false);
 pending[0].resolve({data:{article:{title:'Old recipe',content:'Old content',status:'published',audience:'staff'}}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(elements.accazaManualTitle.value,'Baking');assert.equal(elements.accazaManualAudience.value,'management');
}
console.log('Accaza workflow coverage and AI access checks passed');
