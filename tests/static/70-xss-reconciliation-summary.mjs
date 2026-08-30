// Kitchen-ticket XSS regression, reconciliation audit, and result summary.
export function run(context){
const {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource}=context;
const {adminCoreItem,fn,orderStatusCheck,operationalExceptionsCheck,managerApprovalCheck,approvalMatrixCheck,financialCloseCheck,financialCloseUi,pricing,proofCheck,activeOrdersCheck,moduleLoaderCheck,inventoryLedgerCheck,costingEngineCheck,financialLedgerCheck,checkoutWorkflowCheck,offlineRecoveryCheck,booksBridgeCheck,salesAuthorityCheck,salesHistoryAutoloadCheck,overviewHistoryAutoloadCheck,overviewColdLoadCheck,overviewSelfHealCheck,overviewAuthRetryCheck,archiveOrderSortCheck,inventoryBooksReconciliationCheck,booksStatementReconciliationCheck}=context;
// Kitchen-ticket print-path XSS regression: extract the shipped window.printOrder from core.mjs by
// brace matching (string/comment aware), execute it in a sandbox with the real shared-ui escHtml,
// and require the poisoned ticket DOM to match a clean order ticket DOM with no injected markup.
const printOrderHeader=(adminCoreItem.source.match(/window\.printOrder\s*=\s*function/)||[])[0];
if(!printOrderHeader)fail('Admin core.mjs no longer ships window.printOrder');
const printOrderStart=adminCoreItem.source.indexOf(printOrderHeader);
let printOrderCursor=adminCoreItem.source.indexOf('{',printOrderStart+printOrderHeader.length);
if(printOrderCursor<0)fail('window.printOrder function body is missing');
let printOrderDepth=0,printOrderEnd=-1;
while(printOrderCursor<adminCoreItem.source.length){
  const ch=adminCoreItem.source[printOrderCursor];
  if(ch==="'"||ch==='"'||ch==='`'){
    const quote=ch;printOrderCursor++;
    while(printOrderCursor<adminCoreItem.source.length&&adminCoreItem.source[printOrderCursor]!==quote){
      if(adminCoreItem.source[printOrderCursor]==='\\')printOrderCursor++;
      printOrderCursor++;
    }
  }else if(ch==='/'&&adminCoreItem.source[printOrderCursor+1]==='/'){
    while(printOrderCursor<adminCoreItem.source.length&&adminCoreItem.source[printOrderCursor]!=='\n')printOrderCursor++;
  }else if(ch==='/'&&adminCoreItem.source[printOrderCursor+1]==='*'){
    printOrderCursor+=2;
    while(printOrderCursor<adminCoreItem.source.length&&!(adminCoreItem.source[printOrderCursor]==='*'&&adminCoreItem.source[printOrderCursor+1]==='/'))printOrderCursor++;
    printOrderCursor++;
  }else if(ch==='{')printOrderDepth++;
  else if(ch==='}'){printOrderDepth--;if(printOrderDepth===0){printOrderEnd=printOrderCursor;break;}}
  printOrderCursor++;
}
if(printOrderEnd<0)fail('window.printOrder braces are unbalanced');
const printOrderSource=adminCoreItem.source.slice(printOrderStart,printOrderEnd+1);
const sharedUiSource=adminScripts.find(item=>item.name==='shared-ui.mjs');
const escHtmlLine=sharedUiSource&&sharedUiSource.source.split(/\r?\n/).find(line=>line.startsWith('function escHtml('));
if(!escHtmlLine)fail('shared-ui.mjs escHtml helper missing');
const ticketPayload='img src=x onerror="window.__ticketPwn(1)"';
const kitchenOrders={
  poisoned:{id:'PWN-1',type:'Delivery',total:2,items:'Espresso <'+ticketPayload+'>, Mocha <'+ticketPayload+'>',address:'12 Oz Lane <'+ticketPayload+'>',date:'<'+ticketPayload+'>',time:'<'+ticketPayload+'>',notes:'Ring the bell <'+ticketPayload+'>',name:'Mallory <'+ticketPayload+'>',phone:'0917 <'+ticketPayload+'>',contact:'<'+ticketPayload+'>',onDuty:'Duty <'+ticketPayload+'>',payment:'GCash <'+ticketPayload+'>'},
  clean:{id:'PWN-1',type:'Delivery',total:2,items:'Espresso, Mocha',address:'12 Oz Lane',date:'Aug 29',time:'2:30 PM',notes:'Ring the bell',name:'Mallory',phone:'0917 000 0000',contact:'0906 000 0000',onDuty:'Duty',payment:'GCash'}
};
const kitchenTickets=[];
const kitchenSandbox={
  adminOrdersMap:kitchenOrders,
  window:{open:function(){return{document:{write:function(html){kitchenTickets.push(String(html));},close:function(){}},focus:function(){},print:function(){}};}},
  setTimeout:function(){}
};
try{
  vm.runInNewContext(escHtmlLine+'\n'+printOrderSource+'\nwindow.printOrder("poisoned");window.printOrder("clean");',kitchenSandbox);
}catch(error){fail('kitchen-ticket printOrder threw while rendering: '+error.message);}
if(kitchenTickets.length!==2)fail('kitchen-ticket regression could not render both tickets');
const decodeTicketText=text=>text.replace(/&(amp|lt|gt|quot|#39);/g,(match,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
function ticketEvents(html){
  const events=[];let index=0;
  while(index<html.length){
    const next=html.indexOf('<',index);
    if(next<0){events.push({type:'text',text:decodeTicketText(html.slice(index))});break;}
    if(next>index)events.push({type:'text',text:decodeTicketText(html.slice(index,next))});
    if(html.startsWith('<!--',next)){
      const end=html.indexOf('-->',next);
      if(end<0)fail('kitchen ticket has an unterminated comment');
      index=end+3;continue;
    }
    if(html[next+1]==='!'){const end=html.indexOf('>',next);index=end+1;continue;}
    const close=html.indexOf('>',next);
    if(close<0)fail('kitchen ticket has an unterminated tag');
    let raw=html.slice(next+1,close).trim();
    const selfClose=raw.endsWith('/');
    if(selfClose)raw=raw.slice(0,-1).trim();
    if(raw.startsWith('/'))events.push({type:'close',tag:raw.slice(1).trim().toLowerCase()});
    else{
      const tag=(raw.match(/^[^\s/]+/)||[''])[0].toLowerCase();
      const attrs={};const attrPattern=/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;let attrMatch;
      while((attrMatch=attrPattern.exec(raw)))attrs[attrMatch[1].toLowerCase()]=attrMatch[2]??attrMatch[3]??attrMatch[4]??'';
      events.push({type:'open',tag,attrs});
    }
    index=close+1;
  }
  return events;
}
const poisonedEvents=ticketEvents(kitchenTickets[0]),cleanEvents=ticketEvents(kitchenTickets[1]);
for(const event of poisonedEvents){
  if(event.type!=='open')continue;
  if(event.tag==='img')fail('kitchen-ticket print path injected a raw <img> element from order data');
  if('onerror' in event.attrs)fail('kitchen-ticket print path injected an onerror attribute from order data');
  for(const attribute of Object.keys(event.attrs))if(/^on/i.test(attribute))fail(`kitchen-ticket print path injected a ${attribute} handler attribute from order data`);
}
const ticketShape=events=>events.filter(event=>event.type!=='text').map(event=>event.type==='open'?{type:'open',tag:event.tag,attrs:Object.keys(event.attrs).sort().map(key=>key+'='+event.attrs[key]).join('&')}:event);
if(JSON.stringify(ticketShape(poisonedEvents))!==JSON.stringify(ticketShape(cleanEvents)))fail('poisoned kitchen-ticket DOM structure differs from a clean order ticket DOM');
const poisonedText=poisonedEvents.filter(event=>event.type==='text').map(event=>event.text).join('\n');
if(!poisonedText.includes(ticketPayload))fail('kitchen-ticket print path dropped order data instead of escaping it');

const reconciliation=require(path.join(root,'functions','lib','reconciliation-controls.js'));
const rules=reconciliation.DEFAULT_ACCOUNT_RULES,legacyJournal={old_a:{date:'2026-08-29',lines:[{code:'1900',debit:0,credit:100}]},old_b:{date:'2026-08-30',lines:[{code:'1900',debit:25,credit:0}]},new_a:{date:'2026-08-31',lines:[{code:'1900',debit:10,credit:0}]}},before=JSON.stringify(legacyJournal);
const controlIssues=reconciliation.controlAccountIssues(legacyJournal,rules);
if(controlIssues.length!==1||controlIssues[0].code!=='1900'||controlIssues[0].balance!==10||controlIssues[0].count!==1)fail('Control audit did not isolate post-cutover clearing activity');
if(JSON.stringify(legacyJournal)!==before)fail('Read-only reconciliation audit changed journal history or balances');
if(reconciliation.controlAccountIssues({cash:{date:'2026-08-31',lines:[{code:'1000',debit:500,credit:0}]}},rules).length)fail('Normal balance-sheet accounts were incorrectly treated as zero-balance clearing accounts');
if(reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-29',variance:-50}))fail('Closed legacy discrepancy resurfaced in the server audit');
if(!reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-30',variance:-120})||!reconciliation.operationalDiscrepancy({kind:'cash',status:'open',date:'2026-08-31',variance:25}))fail('Protected or post-cutover discrepancy was hidden from the server audit');

console.log(`PASS: ${state.checked} executable HTML and external scripts parsed successfully.`);
console.log('PASS: shared reconciliation controls isolate legacy history, retain new exceptions, and remain rebuild-safe.');
console.log('PASS: customer-field rendering containment checks passed.');
console.log('PASS: database rule structure and Release 1A limits are present.');
console.log('PASS: Release 1B authentication and role-enforcement guards are present.');
console.log('PASS: Release 1C server-pricing and customer-ownership guards are present.');
console.log('PASS: kitchen-ticket print path escapes every customer-supplied field; a poisoned ticket DOM matches a clean order.');
process.stdout.write(pricing.stdout);
process.stdout.write(proofCheck.stdout);
process.stdout.write(activeOrdersCheck.stdout);
process.stdout.write(moduleLoaderCheck.stdout);
process.stdout.write(inventoryLedgerCheck.stdout);
process.stdout.write(costingEngineCheck.stdout);
process.stdout.write(financialLedgerCheck.stdout);
process.stdout.write(checkoutWorkflowCheck.stdout);
process.stdout.write(offlineRecoveryCheck.stdout);
process.stdout.write(booksBridgeCheck.stdout);
process.stdout.write(salesAuthorityCheck.stdout);
process.stdout.write(salesHistoryAutoloadCheck.stdout);
process.stdout.write(archiveOrderSortCheck.stdout);
process.stdout.write(inventoryBooksReconciliationCheck.stdout);
process.stdout.write(operationalExceptionsCheck.stdout);
process.stdout.write(managerApprovalCheck.stdout);
process.stdout.write(financialCloseCheck.stdout);
console.log('PASS: functions/index.js syntax is valid.');
}
