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
  if(Buffer.byteLength(source,'utf8')>50000)throw new Error(`Static-check domain regrew beyond 50 KB: ${file}`);
  if(file!=='00-context.mjs'&&!runner.includes(`./static/${file}`))throw new Error(`Static-check runner omits domain: ${file}`);
}
if((combined.match(/\bfail\(/g)||[]).length!==527)throw new Error('Static-check failure-guard inventory changed from the reviewed baseline of 527');
if((combined.match(/spawnSync\(/g)||[]).length!==31)throw new Error('Static-check executable-check inventory changed from the Phase 8 baseline of 31');
const guardSource=combined.split(/\r?\n/).filter(line=>/\bfail\(|spawnSync\(/.test(line)).map(line=>line.trim()).join('\n');
const guardDigest=crypto.createHash('sha256').update(guardSource).digest('hex');
if(guardDigest!=='4b8a1c0a6f6ccaa36d8d5b739f981c84203d47765d65172898fc59e1672cc344')throw new Error('Static-check guard source changed; review the assertion-level change and update the Phase 18 baseline deliberately');
for(const domain of ['syntax','access','release','operations','regressions','finance','summary'])if(!runner.includes(`name:'${domain}'`))throw new Error(`Static-check domain routing missing: ${domain}`);
console.log('PASS: all 527 static guards and 31 executable checks remain byte-equivalent and routed through bounded domain modules.');
