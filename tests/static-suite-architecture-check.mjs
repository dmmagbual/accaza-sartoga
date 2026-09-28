import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=process.cwd();
const directory=path.join(root,'tests','static');
const expected=[
  '00-context.mjs',
  '10-syntax-rendering.mjs',
  '20-access-customer.mjs',
  '30-server-release.mjs',
  '40-operations-ui.mjs',
  '45-operations-ui-continued.mjs',
  '50-executable-regressions.mjs',
  '60-finance-books.mjs',
  '70-xss-reconciliation-summary.mjs'
];
const actual=fs.readdirSync(directory).filter(name=>name.endsWith('.mjs')).sort();
if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Static-check module inventory drifted: ${actual.join(', ')}`);
const runner=fs.readFileSync(path.join(root,'tests','static-check.mjs'),'utf8');
let combined='';
for(const file of expected){
  const source=fs.readFileSync(path.join(directory,file),'utf8');
  combined+=source+'\n';
  if(Buffer.byteLength(source,'utf8')>50000)throw new Error(`Static-check domain regrew beyond 50 KB: ${file}. Split it at a statement boundary into a new module (see 45-operations-ui-continued.mjs).`);
  // Early warning (Sep 2026): above 95% of the bound, split before the next guard blocks a release.
  if(Buffer.byteLength(source,'utf8')>47500){const message=`tests/static/${file} is ${Buffer.byteLength(source,'utf8')} bytes of its 50 KB bound. Split it before adding more guards.`;console.warn('STATIC MODULE SIZE WARNING: '+message);if(process.env.GITHUB_ACTIONS)console.log(`::warning file=tests/static/${file}::${message}`);}
  if(file!=='00-context.mjs'&&!runner.includes(`./static/${file}`))throw new Error(`Static-check runner omits domain: ${file}`);
}
if((combined.match(/\bfail\(/g)||[]).length!==548)throw new Error('Static-check failure-guard inventory changed from the reviewed baseline of 548');
if((combined.match(/spawnSync\(/g)||[]).length!==33)throw new Error('Static-check executable-check inventory changed from the reviewed baseline of 33');
const guardSource=combined.split(/\r?\n/).filter(line=>/\bfail\(|spawnSync\(/.test(line)).map(line=>line.trim()).join('\n');
const guardDigest=crypto.createHash('sha256').update(guardSource).digest('hex');
// Sep 2026: the Phase 6 customer-runtime and Phase 4C admin-core size guards now read their ceilings from
// tests/bundle-budgets.mjs instead of separate literals; guard count and every other guard line are unchanged.
// Sep 2026 (year-end close): the Books carry marker became openingCarry(month, because the carry now
// also takes the balance-sheet year; the guard's meaning is unchanged.
if(guardDigest!=='15b4799079595aa0be9f125789a8103b17c930773533ca32a89c319ee3ac7566')throw new Error('Static-check guard source changed; review the assertion-level change and update the baseline deliberately');
for(const domain of ['syntax','access','release','operations','regressions','finance','summary'])if(!runner.includes(`name:'${domain}'`))throw new Error(`Static-check domain routing missing: ${domain}`);
console.log('PASS: all 548 static guards and 33 executable checks remain byte-equivalent and routed through bounded domain modules.');
