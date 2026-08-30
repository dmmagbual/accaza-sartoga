// HTML/script syntax and customer-field rendering containment.
export function run(context){
const {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource}=context;
for(const file of htmlFiles){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const appSource=file==='admin.html'?adminSource:customerSource;
  const scriptPattern=/<script(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script>/gi;
  let match,index=0;
  while((match=scriptPattern.exec(source))){
    index++;
    const attrs=match.groups.attrs||'';
    const body=match.groups.body||'';
    if(/\bsrc\s*=/.test(attrs)||/application\/ld\+json/i.test(attrs)||!body.trim())continue;
    const isModule=/type\s*=\s*["']module["']/i.test(attrs);
    const target=path.join(temp,`${path.basename(file,'.html')}-${index}.${isModule?'mjs':'js'}`);
    fs.writeFileSync(target,body,'utf8');
    const result=spawnSync(process.execPath,['--check',target],{encoding:'utf8'});
    if(result.status!==0)fail(`${file} script ${index} failed syntax check:\n${result.stderr||result.stdout}`);
    state.checked++;
  }

  const helperLine=appSource.split(/\r?\n/).find(line=>line.startsWith('function escHtml('));
  if(!helperLine)fail(`${file}: escHtml helper missing`);
  const sandbox={payload:'<img src=x onerror="bad"> \'test\' &'};
  vm.runInNewContext(`${helperLine}; result=escHtml(payload);`,sandbox);
  if(/[<>]/.test(sandbox.result)||sandbox.result.includes('"')||sandbox.result.includes("'"))fail(`${file}: escHtml did not neutralize the test payload`);

  if(appSource.includes('function renderComments()')){
    const comments=section(appSource,'function renderComments()','function renderAdminReviews()');
    if(/\+f\.(?:name|contact|date|message|status)\+/.test(comments))fail(`${file}: feedback field still enters HTML directly`);
  }
  if(file==='admin.html'&&appSource.includes('function renderOrders()')){
    const orders=section(appSource,'function renderOrders()','return {renderOrders');
    if(/\+o\.(?:name|phone|contact|items|address|notes|proof|payment|status|id)\+/.test(orders))fail(`${file}: order field still enters HTML directly`);
  }
  if(file==='admin.html'&&appSource.includes('function renderReservations()')){
    const reservations=section(appSource,'function renderReservations()','window.openResContactPopup');
    if(/\+r\.(?:name|phone|contact|notes|occasion|date|time|status|id)\+/.test(reservations))fail(`${file}: reservation field still enters HTML directly`);
  }
  if(file==='index.html'){
    for(const forbidden of ['staffAccountsRef','adminAccountsRef','function renderAdminCalendar()','function renderAdminAccounts()','function renderStaffAccounts()','function renderDashboard()','window.printOrder = function']){
      if(appSource.includes(forbidden))fail(`customer runtime retains privileged Admin implementation: ${forbidden}`);
    }
    const customerCore=customerScripts.find(item=>item.name==='core.mjs');
    if(!customerCore||Buffer.byteLength(customerCore.source,'utf8')>110000)fail('customer runtime has regrown beyond the 110 KB Phase 6 guard');
  }
}

for(const item of [...adminScripts,...customerScripts]){
  const result=spawnSync(process.execPath,['--check',item.target],{encoding:'utf8'});
  if(result.status!==0)fail(`${item.target} failed syntax check:\n${result.stderr||result.stdout}`);
  state.checked++;
}
context.state.checked=state.checked;
}
