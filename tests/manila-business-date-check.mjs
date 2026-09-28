// Manila business dates (Sep 2026). Accaza Coffee operates in Dasmariñas, Cavite (Asia/Manila,
// UTC+8, no daylight saving) and the owner often reviews Admin and Finance Books from Port Moresby
// (UTC+10). Every business date, month and year boundary must therefore be a Manila one, whatever
// time zone the viewing device uses; otherwise a report, voucher number or correction lands in
// the wrong day, month or year between 10 pm and midnight Manila time, including New Year's Eve.
//
// 1. Ratchet: device-local calendar calls in business code are limited to the reviewed list below.
// 2. Executable: the date helpers return Manila answers with the process clock in four time zones.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const rel=file=>path.relative(root,file).split(path.sep).join('/');
const fail=message=>{throw new Error(message);};

if(process.argv[2]==='--zone-probe'){zoneProbe();process.exit(0);}

// ---------- 1. ratchet ----------
const BUNDLES=new Set(['assets/js/admin/pos.js','assets/js/admin/register.js','assets/js/admin/analytics.js','assets/js/admin/finance.js','assets/js/books/app.js','assets/js/customer/core.mjs']);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);return entry.isDirectory()?walk(full):/\.m?js$/.test(entry.name)?[full]:[];});
const scanned=['src/admin','src/books','src/customer','assets/js/admin','assets/js/books','assets/js/shared'].flatMap(dir=>walk(path.join(root,dir))).map(rel).filter(file=>!BUNDLES.has(file)).sort();
const LOCAL_CALENDAR=/(?<!AccazaReportPeriod)\.(getFullYear|getMonth|getDate|getDay|getHours|setHours|setDate|setMonth|setFullYear)\(/g;
// Reviewed device-local calendar calls. None of them decides a business date, month or year.
const ALLOWED={
  'src/admin/analytics/20-sales-analytics.js':{count:4,why:'prevMonthKey steps back one month from a date built from a YYYY-MM label; the result is the same in every zone'},
  'src/customer/core/04-realtime-subscriptions.mjs':{count:1,why:'days in a calendar month for the reservation calendar'},
  'src/customer/core/03-state-helpers.mjs':{count:4,why:'reservation calendar starts on the viewer\'s current month'},
  'src/customer/core/11-reservations.mjs':{count:12,why:'reservation calendar picks calendar days; no money or stock date'},
  'src/customer/core/16-startup-ui.mjs':{count:2,why:'archive range defaults for fields that do not exist on the customer page'},
  'assets/js/admin/reservations.mjs':{count:20,why:'Admin reservation calendar picks calendar days; no money or stock date'}
};
const found={};
for(const file of scanned){const matches=fs.readFileSync(path.join(root,file),'utf8').match(LOCAL_CALENDAR)||[];if(matches.length)found[file]=matches.length;}
for(const [file,count] of Object.entries(found)){
  const allowed=ALLOWED[file];
  if(!allowed)fail(`${file} uses the device's local calendar (${count} call${count===1?'':'s'}). Use window.AccazaDate.key() or Manila midnights (Date.parse(day+'T00:00:00+08:00')) so dates follow Asia/Manila on every device.`);
  if(count>allowed.count)fail(`${file} added device-local calendar calls (${count} > reviewed ${allowed.count}). Use Manila business dates instead.`);
}
for(const [file,allowed] of Object.entries(ALLOWED))if((found[file]||0)!==allowed.count)fail(`${file} now has ${found[file]||0} reviewed local-calendar calls, not ${allowed.count}; lower the reviewed count (${allowed.why}).`);

// ---------- 2. executable, in four time zones ----------
for(const zone of ['Pacific/Port_Moresby','America/Los_Angeles','UTC','Asia/Manila']){
  const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--zone-probe'],{cwd:root,encoding:'utf8',env:{...process.env,TZ:zone}});
  if(run.status!==0)fail(`Manila business dates are wrong when the device is set to ${zone}:\n${run.stderr||run.stdout}`);
}
console.log(`PASS: business dates follow Asia/Manila on every device; ${scanned.length} files hold only the reviewed local-calendar calls, and the helpers agree in Port Moresby, Los Angeles, UTC and Manila across New Year.`);

function zoneProbe(){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const fn=(source,name)=>{const start=source.indexOf(`function ${name}(`);if(start<0)fail(`missing function ${name}`);let depth=0,i=source.indexOf('{',start);for(;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)break;}return source.slice(start,i+1);};
  const RealNow=Date.now;
  const at=(iso,run)=>{const fixed=Date.parse(iso);Date.now=()=>fixed;try{return run();}finally{Date.now=RealNow;}};
  const eq=(actual,expected,label)=>{if(actual!==expected)fail(`${process.env.TZ}: ${label} = ${actual}, expected ${expected}`);};
  // 22:30 on 31 Dec in Manila is already 1 Jan in Port Moresby; 00:30 on 1 Jan in Manila is still 31 Dec in Los Angeles.
  const EVE='2026-12-31T14:30:00Z',NEW_YEAR='2026-12-31T16:30:00Z';

  const finance=read('src/admin/finance/00-bootstrap-ledger.js');
  const ledger=new Function(`${fn(finance,'manilaKey')}\n${fn(finance,'todayStr')}\n${fn(finance,'dateFromTs')}\nreturn {todayStr,dateFromTs};`)();
  eq(at(EVE,()=>ledger.todayStr()),'2026-12-31','Admin finance today on New Year\'s Eve');
  eq(at(NEW_YEAR,()=>ledger.todayStr()),'2027-01-01','Admin finance today after midnight');
  eq(ledger.dateFromTs(Date.parse(EVE)),'2026-12-31','cash-flow date of a 10:30 pm sale');
  eq(ledger.dateFromTs(Date.parse(NEW_YEAR)),'2027-01-01','cash-flow date of a 12:30 am sale');

  const analytics=read('src/admin/analytics/10-sales-model-history.js')+'\n'+read('src/admin/analytics/20-sales-analytics.js')+'\n'+read('src/admin/analytics/60-inventory-valuation.js');
  const az=new Function('svFrom','svTo',`${['businessDate','dayStart','addDays','localDateValue','monthStartAt','monthKey','svRange','tsToDate'].map(name=>fn(analytics,name)).join('\n')}\nreturn {dayStart,addDays,localDateValue,monthStartAt,monthKey,svRange,tsToDate};`)('','');
  const manilaMidnight=day=>Date.parse(day+'T00:00:00+08:00');
  eq(at(EVE,()=>az.dayStart(Date.now())),manilaMidnight('2026-12-31'),'Analytics today starts at Manila midnight');
  eq(az.dayStart('2027-01-01'),manilaMidnight('2027-01-01'),'Analytics day start of a chosen date');
  eq(az.localDateValue('2027-01-01'),manilaMidnight('2027-01-01'),'Analytics custom range start');
  eq(az.addDays(manilaMidnight('2026-12-31'),1),manilaMidnight('2027-01-01'),'Analytics next day');
  eq(at(NEW_YEAR,()=>az.monthStartAt(Date.now())),manilaMidnight('2027-01-01'),'Analytics month start after midnight');
  eq(az.monthKey(Date.parse(EVE)),'2026-12','P&L month of a 10:30 pm sale');
  eq(az.monthKey(Date.parse(NEW_YEAR)),'2027-01','P&L month of a 12:30 am sale');
  eq(JSON.stringify(at(NEW_YEAR,()=>az.svRange())),JSON.stringify({f:'2027-01-01',t:'2027-01-01'}),'Stock Value default range after midnight');
  eq(az.tsToDate(Date.parse(EVE)),'2026-12-31','Stock Value movement date');

  const require=createRequireSafe();
  const audit=require(path.join(root,'assets/js/shared/cogs-duplication-audit.js'));
  eq(audit.monthKey({timestamp:Date.parse(EVE)}),'2026-12','COGS correction month of a 10:30 pm order');
  eq(audit.monthKey({timestamp:Date.parse(NEW_YEAR)}),'2027-01','COGS correction month of a 12:30 am order');
  eq(audit.monthEnd('2026-12',Date.parse('2027-02-01T00:00:00Z')),Date.parse('2026-12-31T23:59:59+08:00'),'COGS correction posts inside December (Manila)');

  const ops=read('assets/js/admin/operations-dashboard.js');
  const dateKey=new Function(`${fn(ops,'dateKey')}\nreturn dateKey;`)();
  eq(at(EVE,()=>dateKey(0)),'2026-12-31','System Health today key');
  eq(at(NEW_YEAR,()=>dateKey(1)),'2026-12-31','System Health yesterday key after midnight');

  const reconcile=read('assets/js/admin/inventory-books-reconciliation.mjs');
  const after=new Function(`${fn(reconcile,'sourceIsAfterCutoff')}\nreturn sourceIsAfterCutoff;`)();
  eq(after({occurredAt:Date.parse(EVE)},'2026-12-31'),false,'inventory movement at 10:30 pm is not after its own day');
  eq(after({occurredAt:Date.parse(NEW_YEAR)},'2026-12-31'),true,'inventory movement at 12:30 am is after 31 Dec');

  const usage=read('src/admin/pos/40-internal-usage.js');
  const usageMonth=new Function('usageEntries',`${fn(usage,'usageThisMonth')}\nreturn usageThisMonth;`)(()=>[{ts:Date.parse(EVE)},{ts:Date.parse(NEW_YEAR)}]);
  eq(at(NEW_YEAR,()=>usageMonth().length),1,'internal usage this month after midnight');

  const fund=read('src/admin/register/40-revolving-fund.js'),voucher=fund.slice(fund.indexOf('function nextVoucherNo('),fund.indexOf('function renderPetty(')),keyExpr=(/var key=([^;]+);/.exec(voucher)||[])[1];
  if(!keyExpr)fail('petty cash voucher month expression not found');
  const voucherMonth=new Function(`return ${keyExpr};`);
  eq(at(EVE,voucherMonth),'202612','petty cash voucher month on New Year\'s Eve');
  eq(at(NEW_YEAR,voucherMonth),'202701','petty cash voucher month after midnight');

  const core=read('assets/js/admin/core.mjs');
  for(const marker of ["const todayKey=new Date(Date.now()+28800000).toISOString().slice(0,10),startToday=Date.parse(todayKey+'T00:00:00+08:00');","const startMonth=Date.parse(todayKey.slice(0,7)+'-01T00:00:00+08:00');"])if(!core.includes(marker))fail(`Admin dashboard boundaries are no longer Manila midnights: ${marker}`);
}

function createRequireSafe(){return (file)=>{const module={exports:{}};new Function('module','exports',fs.readFileSync(file,'utf8'))(module,module.exports);return module.exports;};}
