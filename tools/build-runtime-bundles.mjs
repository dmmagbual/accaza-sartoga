import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const bundles=[
  {source:'src/admin/pos',target:'assets/js/admin/pos.js'},
  {source:'src/functions',target:'functions/index.js'}
];

for(const bundle of bundles){
  const sourceDir=path.join(root,bundle.source);
  const files=fs.readdirSync(sourceDir).filter(name=>name.endsWith('.js')).sort();
  if(!files.length)throw new Error(`No source sections found in ${bundle.source}`);
  const output=files.map(name=>fs.readFileSync(path.join(sourceDir,name),'utf8')).join('');
  fs.writeFileSync(path.join(root,bundle.target),output);
  console.log(`Built ${bundle.target} from ${files.length} ordered sections.`);
}
