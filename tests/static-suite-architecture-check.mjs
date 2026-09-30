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
if((combined.match(/\bfail\(/g)||[]).length!==559)throw new Error('Static-check failure-guard inventory changed from the reviewed baseline of 559');
if((combined.match(/spawnSync\(/g)||[]).length!==33)throw new Error('Static-check executable-check inventory changed from the reviewed baseline of 33');
const guardSource=combined.split(/\r?\n/).filter(line=>/\bfail\(|spawnSync\(/.test(line)).map(line=>line.trim()).join('\n');
const guardDigest=crypto.createHash('sha256').update(guardSource).digest('hex');
// Sep 2026: the Phase 6 customer-runtime and Phase 4C admin-core size guards now read their ceilings from
// tests/bundle-budgets.mjs instead of separate literals; guard count and every other guard line are unchanged.
// Sep 2026 (year-end close): the Books carry marker became openingCarry(month, because the carry now
// also takes the balance-sheet year; the guard's meaning is unchanged.
// Sep 2026 (receipt integrity): four reviewed guards require structured sold-menu lines, hide
// recipe-like options, preserve grouped legacy details, and reject mojibake in the print source.
// Sep 2026 (receipt parity): two reviewed guards require Completed Orders to use the same priced
// customer receipt as Shift Orders and prevent the retired kitchen-ticket template from returning.
// Sep 2026 (Rewards at the till): one reviewed guard now also requires the completed-sale reset to
// drop the attached Rewards member, so the next customer can never be credited for this sale. The
// guard count is unchanged at 554 - this is the same assertion, widened, not a new or weaker one.
// Sep 2026 (Rewards redemption): that same guard now pins posLoyaltyFinalize(oid) in the completed-sale
// sequence instead of posLoyaltyReset(). A finished sale must CLOSE the claimed reward against its
// order id, not release it - releasing would hand the stamps back for a drink already handed over.
// Still the same single guard, still 554.
// Oct 2026 (App Check lever): five new reviewed guards in 30-server-release.mjs pin enforcement to
// the committed defaults in src/functions/00-app-check-flags.js. The Functions bundle is a plain
// concatenation, so a flag declared after the first onCall options object that reads it is still in
// the temporal dead zone and throws at load. The guards therefore require the staff flag to be
// declared before any enforceAppCheck: use, require the order flag to keep its own committed default
// rather than inheriting the staff flag (so the staff surface can enforce while the public order path
// stays in monitor mode), and require process.env to be read exactly twice so no callable can drift
// back to a private raw read. Reviewed guard count 554 -> 559; executable checks unchanged at 33.
// Oct 2026 (deploy retry): the two reviewed --force guards were reshaped, not weakened, so both
// firebase deploy steps can retry once after a transient Cloud Functions API error. The count guard
// used to require exactly one --force line; it now requires that every --force deploy targets the
// shared "$only" list and that the list is still exactly the 44 idempotent retry functions, and the
// full-deploy guard now checks every full deploy line rather than only the first. Guard count is
// unchanged by this reshape.
if(guardDigest!=='9b3e4873bf7b4be78f102a78b879788eba4d31ccbf353e2a909c0e21a44e8661')throw new Error('Static-check guard source changed; review the assertion-level change and update the baseline deliberately');
for(const domain of ['syntax','access','release','operations','regressions','finance','summary'])if(!runner.includes(`name:'${domain}'`))throw new Error(`Static-check domain routing missing: ${domain}`);
console.log('PASS: all 559 static guards and 33 executable checks remain byte-equivalent and routed through bounded domain modules.');
