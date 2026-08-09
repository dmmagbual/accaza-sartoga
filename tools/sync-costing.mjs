import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'assets','js','shared','costing.js');
const target=path.join(root,'functions','lib','costing.js');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.copyFileSync(source,target);
console.log('Synced shared costing engine into Functions package.');
