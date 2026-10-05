import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
function fail(message){throw new Error(message);}
const listed=spawnSync('git',['ls-files','--stage','-z'],{encoding:'utf8'});
if(listed.status!==0){console.log('SKIP: repository safety scan requires a Git checkout; CI will enforce it.');process.exit(0);}
const entries=listed.stdout.split('\0').filter(Boolean).map(entry=>{const match=/^(\d{6}) [0-9a-f]{40} \d\t(.*)$/s.exec(entry);if(!match)fail(`Cannot parse tracked Git entry: ${entry}`);return{mode:match[1],file:match[2]};});
const files=entries.map(entry=>entry.file),forbidden=/(^|\/)(\.env(?:\..+)?|.*service[-_ ]?account.*\.json|.*firebase.*backup.*\.json|database[-_ ]?export.*\.json|.*\.(?:pem|p12|key))$/i;
const retiredRuntimeCopies=new Set(['admin-backup.html','index-pos.html','index backup - pre-auth.html','index backup - july 19.html']);
for(const {mode,file} of entries){if(mode==='160000')fail(`Gitlink/submodule is tracked and can block GitHub Pages: ${file}`);if(file.startsWith('_worktrees/'))fail(`Local worktree path is tracked: ${file}`);}
for(const file of files){if(file==='.env.example')continue;if(forbidden.test(file))fail(`Sensitive/private file is tracked: ${file}`);if(file==='tests/repository-safety-check.mjs')continue;if(!fs.existsSync(file)){continue;}const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>2_000_000)continue;const text=fs.readFileSync(file,'utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))fail(`Private key material found in tracked file: ${file}`);if(/"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/.test(text))fail(`Service-account key found in tracked file: ${file}`);}
for(const file of files)if(retiredRuntimeCopies.has(file))fail(`Retired runtime copy is tracked and could be published: ${file}`);
const ignore=fs.readFileSync('.gitignore','utf8');for(const marker of ['.env.*','*backup*.json','*export*.json','admin-backup.html','index backup*.html','index-pos.html','Firebase rules - backup.txt','_worktrees/'])if(!ignore.includes(marker))fail(`Required private/retired-file ignore marker missing: ${marker}`);
console.log(`PASS: ${files.length} tracked files contain no forbidden credential/export artifacts.`);
