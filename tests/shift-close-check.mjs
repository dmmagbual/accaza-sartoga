// 24 Sep 2026 (Alex, SH-945869): the server confirmed the shift ready, then the till's second
// close check failed on the device inside an 8-second limit and never reached the server, so
// no Z report printed. This runs the real till close check against stubbed browser services.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/admin/register/80-shift-lifecycle-zreport.js',import.meta.url),'utf8'),handoverSource=fs.readFileSync(new URL('../src/admin/register/79-shift-handover.js',import.meta.url),'utf8');
const shiftReview=fs.readFileSync(new URL('../src/admin/register/60-operations-shift-review.js',import.meta.url),'utf8');
const handover=fs.readFileSync(new URL('../src/admin/register/79-shift-handover.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function harness({verify,flush}={}){
  const calls={verify:0,report:0,flush:0};
  const el=()=>({style:{},setAttribute(){},remove(){},textContent:''});
  const ctx={setTimeout,clearTimeout,setInterval,clearInterval,Promise,
    document:{getElementById:()=>null,createElement:el,body:{appendChild(){}}},
    __online:true,__posShift:{id:'SH-1'},
    AccazaOfflineQueue:{summary:async()=>({rows:[{status:'synced'},{status:'failed',order:{shiftId:'SH-OLD'}}]})},
    AccazaPosSyncHealth:{deviceId:()=>'pos_tablet'},
    __flushOfflineQueue:()=>{calls.flush++;return flush?flush():Promise.resolve({});},
    __reportPosSyncHealth:async()=>{calls.report++;return null;},
    A:()=>({callables:{verifyShiftCloseReadiness:async payload=>{calls.verify++;assert.equal(JSON.stringify(payload),JSON.stringify({shiftId:'SH-1',deviceId:'pos_tablet'}));return verify?verify(calls.verify):{data:{}};}}})};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(handoverSource+'\n'+source,ctx);return {ctx,calls};
}
// Normal path: one server call; a sale left from an older shift does not block this close.
{const {ctx,calls}=harness();await ctx.continuityReadyForClose();assert.equal(calls.verify,1);assert.equal(calls.report,1);}
// A connection drop during the check is waited out instead of failing instantly.
{const {ctx,calls}=harness();ctx.__online=false;setTimeout(()=>{ctx.__online=true;},400);await ctx.continuityReadyForClose();assert.equal(calls.verify,1);}
// A dropped server request is retried once with a fresh device report.
{const {ctx,calls}=harness({verify:n=>{if(n===1){const e=new Error('Failed to fetch');e.code='functions/unavailable';throw e;}return {data:{}};}});await ctx.continuityReadyForClose();assert.equal(calls.verify,2);assert.equal(calls.report,2);}
// A business refusal from the server is final and names the step.
{const {ctx,calls}=harness({verify:()=>{const e=new Error('Wait for server posting to finish. Inventory: 1');e.code='functions/failed-precondition';throw e;}});
 await assert.rejects(ctx.continuityReadyForClose(),e=>e.closeStep==='server check'&&/Inventory: 1/.test(e.message));assert.equal(calls.verify,1);
 assert.equal(ctx.closeCheckReason(Object.assign(new Error('x'),{closeStep:'server check'})),'[server check] x');}
// A connection that stays down fails with the connection step, not a silent handover.
{const {ctx}=harness();ctx.CLOSE_CHECK_RECONNECT_MS=300;ctx.__online=false;await assert.rejects(ctx.continuityReadyForClose(),e=>e.closeStep==='connection');}
// A step that never finishes is bounded and reported as a timeout.
{const {ctx,calls}=harness({flush:()=>new Promise(()=>{})});ctx.CLOSE_CHECK_TIMEOUT_MS=300;await assert.rejects(ctx.continuityReadyForClose(),e=>e.closeStep==='timeout');assert.equal(calls.verify,0);}
// An unsynchronized sale for this shift is a real blocker.
{const {ctx,calls}=harness();ctx.AccazaOfflineQueue.summary=async()=>({rows:[{status:'failed',order:{shiftId:'SH-1'}}]});await assert.rejects(ctx.continuityReadyForClose(),e=>e.closeStep==='queue');assert.equal(calls.verify,0);}
assert.ok(ctx30s(source),'the close check allows 30 seconds, not 8');
function ctx30s(s){return /CLOSE_CHECK_TIMEOUT_MS=30000/.test(s)&&!/\},8000\)/.test(s);}
// A blocked pop-up never loses the Z report.
assert.ok(source.includes("window.open('','_blank','width=380,height=680')||zReportInPageWindow()")&&shiftReview.includes("||zReportInPageWindow()"),'Z report must fall back to an in-page view');
assert.ok(!/Allow pop-ups to (print|view) the Z-report/.test(source+shiftReview),'no alert-only Z report path may remain');
// The handover records why the till check failed and shows the server's Z report.
assert.ok(handover.includes('closeCheckError:closeCheckReason(error)')&&handover.includes('result.resolved&&result.zReport')&&handover.includes('showZ(closedShift,zReportView(result.zReport))'),'handover must carry the failure reason and show the automatic Z report');
// A failed final save goes to the server handover path (which always returns a Z report),
// never to an alert that leaves the shift without one.
assert.ok(source.includes("openHandoverCount(shift,closeStepError('save',e),counts)")&&!source.includes('Shift was not closed because the final report could not be saved'),'a failed save must still end with a Z report');
// Open items print on the provisional and exception Z reports.
{const {ctx}=harness();ctx.esc=s=>String(s);ctx.peso=n=>'PHP '+Number(n).toFixed(2);
 const html=ctx.zOpenItemsHtml({retainedSales:[{orderId:'POS-1',total:120}],otherDevices:[{outstanding:2}],crewUnreported:[{staff:'Louize'}],postingInventory:['a'],closeCheckError:'[timeout] slow'});
 for(const text of ['Sale POS-1 PHP 120.00 not yet confirmed','2 sale(s) waiting on another till',"Louize's till has not reported",'Posting in progress: inventory 1, Finance Books 0','Close check: [timeout] slow'])assert.ok(html.includes(text),text);
 assert.equal(ctx.zOpenItemsHtml({}),'');}
assert.ok(source.includes("z.status==='provisional'")&&source.includes('FINAL Z WITH OPEN ITEMS')&&source.includes('AMENDED Z REPORT'),'Z report must label provisional, exception and amended reports');
await sleep(0);
console.log('PASS: till close check waits out connection drops, retries transient server errors once, bounds a hung step at 30 s, names the failed step, and the Z report falls back in-page; a failed save still ends with a Z report and open items print on it.');
