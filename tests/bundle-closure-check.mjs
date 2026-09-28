// Bundle closure check (29 Sep 2026). tools/build-runtime-bundles.mjs joins each bundle's sections in
// file-name order. PR 632 added src/admin/pos/51-serve-queue.js after the section that held the POS
// closure's "})();", so the serving queue ran outside the POS scope: buildPOS threw
// "onlineOrdersMap is not defined" and the POS tab showed "This section could not load".
// Every bundle that opens a closure must close it in its last section, and no section's top-level
// function may leak to the page's global scope.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd();
const tool=fs.readFileSync(path.join(root,'tools/build-runtime-bundles.mjs'),'utf8');
const bundles=[...tool.matchAll(/\{source:'([^']+)',target:'([^']+)'\}/g)].map(m=>({source:m[1],target:m[2]}));
assert.ok(bundles.length>=5,'build-runtime-bundles.mjs bundle list was not found');

const sectionsOf=dir=>fs.readdirSync(path.join(root,dir)).filter(n=>/\.m?js$/.test(n)).sort();
const strip=s=>s.replace(/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*/,'');
const closure=[];
for(const b of bundles){
  const files=sectionsOf(b.source);
  if(!/^\(function\(\)\{/.test(strip(fs.readFileSync(path.join(root,b.source,files[0]),'utf8'))))continue;
  closure.push(b);
  const closers=files.filter(n=>/^\}\)\(\);[ \t]*$/m.test(fs.readFileSync(path.join(root,b.source,n),'utf8')));
  assert.deepEqual(closers,[files.at(-1)],`${b.source}: the closure must be closed only in the last section (${files.at(-1)}), found in: ${closers.join(', ')||'none'}`);
  const built=fs.readFileSync(path.join(root,b.target),'utf8').trimEnd();
  assert.ok(built.endsWith('})();'),`${b.target} must end with the closure's "})();"`);
}
assert.ok(closure.some(b=>b.source==='src/admin/pos'),'the POS bundle must be recognised as a closure bundle');

// Runtime: load the built bundle and confirm none of its top-level functions reached the global scope.
function stubContext(){
  const el=()=>({innerHTML:'',style:{},dataset:{},classList:{toggle(){},add(){},remove(){},contains:()=>false},querySelector:()=>null,querySelectorAll:()=>[],appendChild(){},setAttribute(){},addEventListener(){}});
  const ctx={console,setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},performance:{now:()=>0},navigator:{onLine:true},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    document:{getElementById:()=>null,createElement:el,body:el(),head:el(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
    addEventListener(){},removeEventListener(){}};
  ctx.window=ctx;ctx.self=ctx;ctx.__accazaRegisterModule=()=>{};
  return vm.createContext(ctx);
}
for(const b of closure){
  const ctx=stubContext();
  vm.runInContext(fs.readFileSync(path.join(root,b.target),'utf8'),ctx,{filename:b.target});
  const names=new Set();
  for(const n of sectionsOf(b.source))for(const m of fs.readFileSync(path.join(root,b.source,n),'utf8').matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm))names.add(m[1]);
  const leaked=[...names].filter(n=>Object.prototype.hasOwnProperty.call(ctx,n));
  assert.deepEqual(leaked,[],`${b.target}: section functions leaked outside the closure: ${leaked.slice(0,10).join(', ')}`);
}
console.log(`PASS bundle closure: ${closure.map(b=>b.target).join(', ')} keep every section inside their closure`);
