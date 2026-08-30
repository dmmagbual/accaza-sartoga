import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const pages=[
  {source:'src/html/customer',target:'index.html'},
  {source:'src/html/admin',target:'admin.html'}
];

export function assemblePage(page){
  const sourceDir=path.join(root,page.source);
  const files=fs.readdirSync(sourceDir).filter(name=>name.endsWith('.html')).sort();
  if(!files.length)throw new Error(`No HTML source sections found in ${page.source}`);
  return {files,output:files.map(name=>fs.readFileSync(path.join(sourceDir,name),'utf8')).join('')};
}

for(const page of pages){
  const {files,output}=assemblePage(page);
  fs.writeFileSync(path.join(root,page.target),output);
  console.log(`Built ${page.target} from ${files.length} ordered sections.`);
}
