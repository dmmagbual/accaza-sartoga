// Guards the Cash Payments "Paid from" selector (Sep 2026 incident).
// The selector reads the funding-account list owned by the finance module (window.__cf).
// The Cash Payments route did not load that module, so on a fresh page the list was empty and
// the selector silently fell back to "Undeposited Collection" only; a bank or e-wallet payment
// could not be recorded, and an empty selection defaulted to Undeposited Collection.
import fs from 'node:fs';
import vm from 'node:vm';

let failures=0;
function fail(message){console.error('FAIL:',message);failures++;}
function read(path){return fs.readFileSync(path,'utf8');}

// 1. Every admin route whose code reads window.__cf must load the finance module first.
const loader=read('assets/js/admin/module-loader.js');
const routesAt=loader.indexOf('var routes={');
const routes=vm.runInNewContext('('+loader.slice(routesAt+'var routes='.length,loader.indexOf('};',routesAt)+1)+')',{});
function checkRoute(tab){
  const list=routes[tab]||[];
  const f=list.indexOf('finance');
  if(f<0)fail(`Admin route "${tab}" uses window.__cf but does not load the finance module.`);
  else if(list.slice(0,f).some(name=>name!=='finance'))fail(`Admin route "${tab}" must load finance before its consumers (got ${list.join(', ')}).`);
}
checkRoute('petty');
checkRoute('purchases');

// 2. Executable check of the selector functions.
const source=read('src/admin/register/40-revolving-fund.js');
function extract(name){
  const start=source.indexOf(`function ${name}(`);
  if(start<0){fail(`${name} is missing`);return '';}
  return source.slice(start,source.indexOf('\n',start));
}
const names=['cashPaymentFundingReady','cashPaymentFundingAccounts','cashPaymentFundingOptions','refreshCashPaymentFundingSelect','cashPaymentFundingLabel'];
const code=names.map(extract).join('\n');
function context(cf,accountsMap){
  const select={value:'',innerHTML:'',disabled:false};
  const ctx={
    window:cf?{__cf:cf}:{},
    document:{getElementById:id=>id==='pvFundAcct'?select:null},
    cashAccountsMap:accountsMap||{},
    esc:s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
    select
  };
  vm.createContext(ctx);
  vm.runInContext(code,ctx);
  return ctx;
}
function optionIds(html){return [...html.matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]);}
function selectedId(html){const m=html.match(/<option value="([^"]*)" selected>/);return m?m[1]:null;}

const accounts=[
  {id:'cash_on_hand',name:'Cash on Hand (available above float)'},
  {id:'undeposited',name:'Undeposited Collection'},
  {id:'cash_float',name:'Register Cash Float (protected)',disabled:true},
  {id:'bdo',name:'BDO'},
  {id:'gcash',name:'GCash'},
  {id:'maribank',name:'Maribank'}
];
const cf={accounts:()=>accounts.slice()};

// Finance available: every active account appears, the protected float never does.
let ctx=context(cf);
let html=vm.runInContext("cashPaymentFundingOptions('undeposited')",ctx);
const ids=optionIds(html);
for(const id of ['cash_on_hand','undeposited','bdo','gcash','maribank'])if(!ids.includes(id))fail(`Paid from is missing account ${id} (got ${ids.join(', ')}).`);
if(ids.includes('cash_float'))fail('Protected Register Cash Float must not be selectable.');
if(selectedId(html)!=='undeposited')fail('Default selection should stay Undeposited Collection.');
// Adding more accounts must never shrink the list.
accounts.push({id:'bpi',name:'BPI'},{id:'maya',name:'Maya'});
if(optionIds(vm.runInContext("cashPaymentFundingOptions('')",ctx)).length!==7)fail('Adding bank accounts changed the number of selectable accounts incorrectly.');
// A chosen bank survives a re-render.
if(selectedId(vm.runInContext("cashPaymentFundingOptions('maribank')",ctx))!=='maribank')fail('A selected bank account is lost on re-render.');
// An unknown selection falls back to Undeposited Collection, not to an arbitrary account.
if(selectedId(vm.runInContext("cashPaymentFundingOptions('closed_account')",ctx))!=='undeposited')fail('Unknown selection should fall back to Undeposited Collection.');

// In-place refresh keeps the user's choice.
ctx.select.value='gcash';
vm.runInContext('refreshCashPaymentFundingSelect()',ctx);
if(selectedId(ctx.select.innerHTML)!=='gcash'||ctx.select.disabled)fail('Refreshing the Paid from list must keep the chosen account and stay enabled.');

// Finance not loaded: no partial list pretending Undeposited Collection is the only account.
ctx=context(null);
html=vm.runInContext("cashPaymentFundingOptions('undeposited')",ctx);
if(optionIds(html).join()!=='')fail('Without the finance account list the selector must show a loading placeholder with an empty value, not a partial list.');
if(/Undeposited Collection/.test(html))fail('Selector silently fell back to Undeposited Collection only.');
vm.runInContext('refreshCashPaymentFundingSelect()',ctx);
if(!ctx.select.disabled)fail('Paid from must be disabled while the account list is unavailable.');

// Historical labels resolve inactive accounts by name instead of mislabelling them as Undeposited Collection.
ctx=context(cf,{old_bank:{name:'Old Bank (closed)',active:false}});
if(vm.runInContext("cashPaymentFundingLabel('old_bank')",ctx)!=='Old Bank (closed)')fail('Inactive funding account is mislabelled in the voucher register.');
if(vm.runInContext("cashPaymentFundingLabel('')",ctx)!=='Undeposited Collection')fail('Legacy vouchers with no funding account should read Undeposited Collection.');

// 3. Wiring: creation refuses an empty/unknown account; finance announces account changes; the register listens.
if(source.includes("fv('pvFundAcct')||'undeposited'"))fail('Voucher creation silently defaults the funding account to Undeposited Collection.');
if(!source.includes("cashPaymentFundingAccounts().some(function(x){return x.id===fundingAccountId;})"))fail('Voucher creation does not validate the selected funding account.');
if(!source.includes("window.addEventListener('accaza:cash-balances-updated',function(){if(isTab('petty'))refreshCashPaymentFundingSelect();});"))fail('Cash Payments does not refresh Paid from when accounts load.');
const finance=read('src/admin/finance/00-bootstrap-ledger.js');
if(!finance.includes("a.subscribe('cfAccounts',function(s){accountsMap=s.val()||{};")||!/subscribe\('cfAccounts'[^\n]*isTab\('petty'\)\)window\.dispatchEvent\(new CustomEvent\('accaza:cash-balances-updated'\)\)/.test(finance))fail('Finance does not announce cfAccounts changes to Cash Payments.');
for(const bundle of [['assets/js/admin/register.js','src/admin/register/40-revolving-fund.js'],['assets/js/admin/finance.js','src/admin/finance/00-bootstrap-ledger.js']]){
  if(!read(bundle[0]).includes(read(bundle[1])))fail(`${bundle[0]} is stale; run npm run build:runtime.`);
}

if(failures)process.exit(1);
console.log('Cash payment funding account checks passed.');
