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
// Stranded helpers (3 Nov 2026). A function defined in one sealed admin bundle is invisible in the
// others. The 30 Aug split left num() in the POS bundle while the Register shift review kept calling
// it, so "Review live cash" threw and did nothing for two months. Every call a bundle makes to a
// helper that only another bundle defines must fail here. A call behind typeof X==='function' is a
// deliberate optional dependency and is reported separately below.
{
  // Callers: every admin bundle. Definers: the sealed (closure) admin bundles; a non-closure
  // bundle's functions are page globals and visible everywhere.
  const adminBundles=bundles.filter(b=>b.source.startsWith('src/admin/'));
  const adminClosures=closure.filter(b=>b.source.startsWith('src/admin/'));
  const code=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,'""');
  const text=b=>sectionsOf(b.source).map(n=>fs.readFileSync(path.join(root,b.source,n),'utf8')).join('\n');
  const own=b=>new Set([...text(b).matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1]||m[2]));
  const stranded=[],guarded=[];
  for(const b of adminBundles){
    const mine=own(b),body=code(text(b));
    for(const o of adminClosures){
      if(o===b)continue;
      for(const m of text(o).matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)){
        const n=m[1],re=n.replace(/\$/g,'\\$');
        if(mine.has(n)||!new RegExp(`(?<![.\\w$])${re}\\s*\\(`).test(body))continue;
        (new RegExp(`typeof\\s+${re}\\s*===?\\s*""`).test(body)?guarded:stranded).push(`${b.source} calls ${n}() defined only in ${o.source}`);
      }
    }
  }
  assert.deepEqual(stranded,[],`helpers called across sealed bundles (define them in the calling bundle):\n${stranded.join('\n')}`);
  // A typeof guard hides the miss instead of fixing it: re-key a missed platform order once read
  // channelRate() from the POS bundle this way and never showed its commission hint.
  assert.deepEqual([...new Set(guarded)],[],`cross-bundle helpers hidden behind typeof (share them instead):\n${[...new Set(guarded)].join('\n')}`);
}
console.log(`PASS bundle closure: ${closure.map(b=>b.target).join(', ')} keep every section inside their closure`);
