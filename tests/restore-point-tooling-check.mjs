/* Restore point tooling (consolidation plan gate R0, Task 0.5).
   The restore point must never become the thing that destroys data. This pins the safety
   properties of the two scripts: snapshots live outside the repository, only allow-listed small
   settings/counter nodes are captured, a null/empty snapshot is never recorded or restored, every
   snapshot carries a sha256, a restore goes back into the same project (UAT only with -ToUat),
   counters and transaction nodes are refused, the live node is saved first, removing chart keys
   needs -AllowRemove, the node is typed back, and an audit intent row precedes the write. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const before = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return i >= 0 && j >= 0 && i < j; };

const take = read('tools/restore-point/take.ps1');
const restore = read('tools/restore-point/restore-node.ps1');
const allowed = ['config', 'documentCounters', 'pettyCashCounter', 'booksChart', 'cfAccounts'];
const heavy = ['orders', 'archivedOrders', 'shifts', 'financialMovements', 'payables', 'purchaseInvoices', 'pettyCashVouchers', 'cashCustody', 'books', 'inventory', 'inventoryMovements', 'stockReceipts', 'cfLedger', 'operationalAudit'];

/* ---------- take.ps1 ---------- */
check(take.includes('$tag = "restore/$Task-$stamp"') && take.includes('git push -q origin $tag'), 'take.ps1 must tag origin/main as restore/<task>-<stamp> and push the tag (code layer).');
check(take.includes('--branch main --status success'), 'take.ps1 must record the last SUCCESSFUL Functions deploy on main, not just the latest run.');
check(take.includes('$functionsTag = "$tag-functions"') && take.includes('git tag -a $functionsTag $deploy.headSha'), 'take.ps1 must tag the deployed Functions commit when it differs from origin/main.');
check(take.includes('Join-Path $env:USERPROFILE ("AccazaRestorePoints\\'), 'take.ps1 must write the restore point OUTSIDE the repository.');
const allowSrc = (/\$Allowed = @\(([^)]*)\)/.exec(take) || [])[1] || '';
const allowList = [...allowSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(JSON.stringify(allowList) === JSON.stringify(allowed), `take.ps1 allow-list must be exactly ${allowed.join(', ')} (got ${allowList.join(', ')}).`);
check(take.includes('if ($Allowed -cnotcontains $n.Trim(\'/\')) { throw'), 'take.ps1 must refuse (case-sensitively) any node outside the allow-list, including the root and child paths.');
for (const n of heavy) check(!allowList.includes(n), `Transaction node ${n} must never be on the snapshot allow-list.`);
const defaults = (/\[string\[\]\]\$Nodes = @\(([^)]*)\)/.exec(take) || [])[1] || '';
const defaultNodes = [...defaults.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(defaultNodes.length >= 3 && defaultNodes.every((n) => allowed.includes(n)), `Default snapshot nodes must come from the allow-list (got ${defaultNodes.join(', ')}).`);
check(take.includes("[ValidateSet('accaza-sartoga', 'accazacoffeepos-uat')][string]$Project"), 'take.ps1 project must be limited to production or UAT.');
check(take.includes("if (-not $text -or $text -eq 'null' -or $text -eq '{}') { throw"), 'take.ps1 must refuse a null/empty snapshot (restoring it would delete the live node).');
check(take.includes('$MaxBytes = 524288') && take.includes('if ($bytes -gt $MaxBytes) { throw'), 'take.ps1 must cap snapshot size (settings nodes only).');
check(take.includes('sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash') && take.includes('fileName = $fileName'), 'Every snapshot must be recorded with its file name and sha256.');
check(take.includes('Write-NoBom $manifestFile'), 'The manifest must be written as UTF-8 without BOM.');
check(take.includes('NEVER import a whole-database backup over live data'), 'The manifest must state that a whole-database import over live data is forbidden.');
check(!/database:get "\/"|database:get \/ /.test(take), 'take.ps1 must never read the whole database.');

/* ---------- restore-node.ps1 ---------- */
check(restore.includes("if (-not $clean) { throw 'Refusing to restore the database root."), 'restore-node.ps1 must refuse the database root.');
for (const n of heavy) check(restore.includes(`'${n}'`), `restore-node.ps1 must refuse transaction node ${n}.`);
check(restore.includes("$ReferenceOnly = @('documentCounters', 'pettyCashCounter')") && before(restore, '$ReferenceOnly -contains', 'firebase database:'), 'Number counters must never be restored backwards (that would re-issue PUR/PV/document numbers).');
check(restore.includes('[Parameter(Mandatory = $true)][ValidateSet(\'accaza-sartoga\', \'accazacoffeepos-uat\')][string]$Project'), 'The target project must be explicit and limited to production or UAT.');
check(restore.includes("if ($Project -cne $m.project -and -not ($ToUat -and $Project -ceq 'accazacoffeepos-uat')) { throw"), 'A restore must go back into the project it was taken from (production to UAT only with -ToUat; never UAT to production).');
check(restore.includes('$entry = $m.nodes | Where-Object { $_.node -ceq $clean }') && restore.includes('$target = $entry.node') && restore.includes('is not in this restore point'), 'Only a node captured in the restore point may be restored, matched case-sensitively, and the manifest spelling is the write target.');
check(!restore.includes('database:set "/$clean"'), 'The write target must be $target (manifest spelling), never the typed parameter.');
check(restore.includes('(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash -cne $entry.sha256) { throw'), 'restore-node.ps1 must refuse a snapshot whose sha256 changed.');
check(restore.includes("if (-not $snapText -or $snapText -eq 'null' -or $snapText -eq '{}') { throw"), 'restore-node.ps1 must refuse a null/empty snapshot.');
check(before(restore, 'firebase database:get "/$target" --project $Project -o $preFile', 'Read-Host'), 'The live node must be saved (pre-restore file) before confirmation and any write.');
check(restore.includes("@('booksChart', 'cfAccounts') -ccontains $target -and -not $AllowRemove) { throw"), 'Removing chart/account keys created since the snapshot must need -AllowRemove.');
check(before(restore, 'Read-Host', 'firebase database:set') && restore.includes("if ($typed.Trim().Trim('/') -cne $target) { throw"), 'The node path must be typed back (case-sensitive) before anything is written.');
const intentAt = restore.indexOf('firebase database:set "/operationalAudit/${ms}_restore_node_intent"');
const writeAt = restore.indexOf('firebase database:set "/$target" $file');
const doneAt = restore.indexOf('firebase database:set "/operationalAudit/${ms}_restore_node_done"');
check(intentAt > 0 && writeAt > intentAt && doneAt > writeAt, 'The audit intent row must be written before the restore and the done row after it.');
check(restore.includes("action = 'restore_node_from_restore_point'") && restore.includes('firebaseAccount = $account') && restore.includes('preRestoreFile = $preFile'), 'The audit row must record the action, the Firebase account and the undo file.');
check((restore.match(/Write-NoBom \$(intentFile|doneFile)/g) || []).length === 2, 'Audit row files must be written as UTF-8 without BOM.');

/* every native command is checked (a failed step must stop the script) */
for (const [name, src] of [['take.ps1', take], ['restore-node.ps1', restore]]) {
  const natives = src.split('\n').filter((l) => /^\s*(git|firebase) /.test(l));
  check(natives.length > 0, `${name}: expected native git/firebase commands.`);
  natives.forEach((line) => {
    const next = src.slice(src.indexOf(line) + line.length, src.indexOf(line) + line.length + 120);
    check(/\$LASTEXITCODE -(ne|eq) 0/.test(next), `${name}: "${line.trim()}" must be followed by a $LASTEXITCODE check.`);
  });
}

if (failures.length) { console.error(`FAIL: ${failures.length} restore point tooling check(s)\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('PASS: restore points capture only allow-listed small nodes outside the repo with sha256, refuse null snapshots, counters and transaction nodes, restore into the same project only, save the live node first and audit intent before the write.');
