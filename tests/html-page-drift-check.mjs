import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const pages=[
  {source:'src/html/customer',target:'index.html',build:'accaza-customer-build'},
  {source:'src/html/admin',target:'admin.html',build:'accaza-admin-build'}
];

for(const page of pages){
  const sourceDir=path.join(root,page.source);
  const files=fs.readdirSync(sourceDir).filter(name=>name.endsWith('.html')).sort();
  assert.ok(files.length>1,`${page.source} must contain ordered HTML sections`);
  const assembled=files.map(name=>fs.readFileSync(path.join(sourceDir,name),'utf8')).join('');
  const deployed=fs.readFileSync(path.join(root,page.target),'utf8');
  assert.equal(deployed,assembled,`${page.target} drifted; run npm run build:html`);
  assert.match(deployed,new RegExp(`<meta name="${page.build}" content="\\d+"\\s*/>`),`${page.target} is missing its build marker`);
  assert.doesNotMatch(deployed,/data:image\/[^;]+;base64,/i,`${page.target} must not embed large base64 assets`);
  for(const paymentAsset of ['assets/img/payment/gcash-qr.jpg','assets/img/payment/bdo-qr.jpg']){
    assert.ok(deployed.includes(paymentAsset),`${page.target} is missing ${paymentAsset}`);
    assert.ok(fs.existsSync(path.join(root,paymentAsset)),`${paymentAsset} is missing from the repository`);
  }
}

console.log('HTML page sources exactly match deployed pages and contain no embedded base64 assets.');
