import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

if(!process.env.ACCAZA_DATE_TEST_CHILD){
  for(const tz of ['Asia/Manila','Pacific/Port_Moresby','UTC','America/New_York']){
    execFileSync(process.execPath,[process.argv[1]],{env:{...process.env,TZ:tz,ACCAZA_DATE_TEST_CHILD:'1'},stdio:'inherit'});
  }
}else{
  const instant=Date.parse('2026-08-31T14:30:00Z'); // PNG: Sept 1; Philippines: Aug 31.
  class Clock extends Date {constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
  const ctx={Date:Clock,Intl,window:{addEventListener(){},dispatchEvent(){}},localStorage:{getItem(){return null;},setItem(){}},CustomEvent:class {}};
  vm.createContext(ctx);
  for(const file of ['assets/js/shared/business-date.js','assets/js/shared/sales-authority.js','assets/js/shared/report-period.js','src/books/business-intelligence.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
  const helpers=ctx.window.AccazaBusinessIntelligenceTest,p=ctx.window.AccazaReportPeriod;
  assert.equal(ctx.window.AccazaDate.key(),'2026-08-31');
  assert.equal(p.get().from,'2026-08-02');assert.equal(p.get().to,'2026-08-31');
  assert.equal(p.get().endAt-p.get().startAt+1,30*86400000);
  const custom=p.set({mode:'custom',customFrom:'2026-08-01',customTo:'2026-08-31'});
  assert.equal(custom.startAt,Date.parse('2026-07-31T16:00:00Z'));
  assert.equal(custom.endAt,Date.parse('2026-08-31T15:59:59.999Z'));
  assert.equal(helpers.orderDate({timestamp:custom.startAt-1}),'2026-07-31');
  assert.equal(helpers.orderDate({timestamp:custom.startAt}),'2026-08-01');
  assert.equal(helpers.orderDate({timestamp:custom.endAt}),'2026-08-31');
  assert.equal(helpers.orderDate({timestamp:custom.endAt+1}),'2026-09-01');
  assert.equal(helpers.shift('2026-01-01',-1),'2025-12-31');
  assert.equal(helpers.shiftYear('2024-02-29',-1),'2023-02-28');
  // Journal calendar dates must never be shifted as instants.
  assert.equal(vm.runInContext("biDate('2026-08-01')",ctx),'2026-08-01');
  const model=fs.readFileSync('src/books/app/00-accounting-model.js','utf8');
  vm.runInContext(model.match(/function todayStr\(\)\{[^\n]+/)[0],ctx);
  assert.equal(vm.runInContext('todayStr()',ctx),'2026-08-31');
  const html=fs.readFileSync('books.html','utf8');
  assert.ok(html.indexOf('shared/business-date.js')<html.indexOf('shared/report-period.js'));
  console.log('PASS: Philippine report boundaries, independent of device timezone '+process.env.TZ);
}
