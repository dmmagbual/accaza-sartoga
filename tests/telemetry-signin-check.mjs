import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// Oct 2026: admin telemetry called recordClientTelemetry before a staff account was authorized
// (login screen, or the public site's anonymous session on the same origin). The server refused
// about 490 calls a day and the client retried every 30 s. This runs the real telemetry.js.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'assets/js/admin/telemetry.js'),'utf8');
function fail(message){throw new Error(message);}

function harness(){
  let now=1_000_000;
  const calls=[];let reply=()=>Promise.resolve({accepted:1});
  const document={querySelector:()=>({content:'650'})};
  const listeners={};
  const window={document,addEventListener(type,fn){listeners[type]=fn;},__accaza:{recordClientTelemetry(command){calls.push(command);return reply(command);}}};
  const context={window,document,performance:{now:()=>now,getEntriesByType:()=>[]},setInterval(){},setTimeout(){},Promise,JSON,Math,String,Number,Date:{now:()=>now}};
  vm.createContext(context);vm.runInContext(source,context);
  const T=window.AccazaTelemetry;
  return{T,window,calls,advance(ms){now+=ms;},setReply(fn){reply=fn;},signIn(){window.__accazaAuthz={uid:'staff-1',role:'staff',isPrivileged:false};},signOut(){window.__accazaAuthz=null;},fireError(event){if(listeners.error)listeners.error(event);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

{ // Nothing is sent before sign-in, nothing is lost, and the first flush after sign-in sends it.
  const h=harness();
  h.T.metric('pos_boot',4200,true);h.T.error('js_core');
  const before=await h.T.flush();
  if(!before.deferred||h.calls.length)fail('Telemetry must not call the server before a staff account is authorized');
  h.window.__accazaAuthz={uid:''};if(!(await h.T.flush()).deferred||h.calls.length)fail('An authorization object without a uid is not a signed-in staff account');
  h.signIn();await h.T.flush();
  if(h.calls.length!==1||h.calls[0].events.length!==2||h.calls[0].events[0].name!=='pos_boot')fail('Events queued on the login screen must be sent once after sign-in');
  if(h.calls[0].build!=='admin-v650')fail('Telemetry must keep reporting the admin build label');
}
{ // Browser errors carry the source, error type and line, never the message text.
  const h=harness();h.signIn();
  h.fireError({filename:'https://accazacoffee.com/assets/js/admin/register.js?v=742',lineno:1234,error:{name:'TypeError'},message:'TypeError: order for Maria is missing'});
  h.fireError({filename:'https://accazacoffee.com/admin.html',lineno:77,error:{name:'ReferenceError'}});
  h.fireError({filename:'',lineno:0});
  await h.T.flush();
  const names=(h.calls[0]?h.calls[0].events:[]).map(event=>event.name);
  if(names.length!==3)fail('Three browser errors must queue three events');
  if(names[0]!=='js_register_typeerror_l1234')fail('A browser error must report its source file, error type and line; got '+names[0]);
  if(names[1]!=='js_admin_html_referenceerror_l77')fail('An inline-handler error must report the page, error type and line; got '+names[1]);
  if(names[2]!=='js_unknown')fail('A browser error without a filename must stay js_unknown; got '+names[2]);
  if(names.some(name=>/maria|missing|message/i.test(name)))fail('A browser error name must never carry message text');
}
{ // A refusal drops the batch instead of retrying it forever.
  for(const code of ['functions/permission-denied','functions/unauthenticated','permission-denied']){
    const h=harness();h.signIn();h.setReply(()=>Promise.reject(Object.assign(new Error('refused'),{code})));
    h.T.metric('pos_boot',3000,true);const result=await h.T.flush();await settle();
    if(!result||result.dropped!==1)fail(`A ${code} refusal must drop the batch`);
    h.advance(31_000);await h.T.flush();
    if(h.calls.length!==1)fail(`A ${code} refusal must not be retried`);
  }
}
{ // Connection-type failures are retried, so a till that drops offline still reports.
  const h=harness();h.signIn();let first=true;
  h.setReply(()=>{if(first){first=false;return Promise.reject(Object.assign(new Error('offline'),{code:'functions/unavailable'}));}return Promise.resolve({accepted:1});});
  h.T.metric('offline_flush',900,true);const failed=await h.T.flush();await settle();
  if(!failed||!failed.failed)fail('A connection failure must be reported as retryable');
  h.advance(6_000);await h.T.flush();
  if(h.calls.length!==2||h.calls[1].events[0].name!=='offline_flush')fail('A connection failure must be retried with the same events');
}
{ // Signing out pauses sending again, and the waiting queue stays bounded.
  const h=harness();h.signIn();h.T.metric('pos_boot',1000,true);await h.T.flush();h.signOut();
  for(let i=0;i<120;i++)h.T.error('js_loop');
  h.advance(10_000);if(!(await h.T.flush()).deferred||h.calls.length!==1)fail('Telemetry must stop sending after sign-out');
  h.signIn();h.advance(10_000);await h.T.flush();h.advance(10_000);await h.T.flush();h.advance(10_000);await h.T.flush();
  const sent=h.calls.slice(1).reduce((n,c)=>n+c.events.length,0);
  if(sent!==40)fail(`Telemetry waiting for sign-in must keep at most 40 events, sent ${sent}`);
}
console.log('PASS: admin telemetry waits for an authorized staff account, drops refused batches instead of retrying them, retries connection failures, and keeps at most 40 waiting events.');
