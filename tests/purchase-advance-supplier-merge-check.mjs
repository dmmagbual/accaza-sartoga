/* Supplier advance allocation — merged supplier and load-state regression guard. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.join(import.meta.dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('src/admin/pos/11h-purchase-workspace.js');
const purchaseUi=read('src/admin/pos/20-purchasing.js');
const bundle=read('assets/js/admin/pos.js');
const hub=read('assets/js/admin/realtime-hub.mjs');
const failures=[];
const must=(text,marker,message)=>{if(!text.includes(marker))failures.push(message);};

const functionLine=(name)=>source.split(/\r?\n/).find((line)=>line.startsWith(`function ${name}(`));
const context=vm.createContext({supplierMap:{
  old_airuss:{name:'Airuss',active:false,mergedInto:'airuss_printing'},
  airuss_printing:{name:'Airuss Printing Company',active:true},
  other_supplier:{name:'Other Supplier',active:true},
  cycle_a:{name:'Cycle A',active:false,mergedInto:'cycle_b'},
  cycle_b:{name:'Cycle B',active:false,mergedInto:'cycle_a'}
}});
for(const name of ['purchaseSupplierKey','purchaseSupplierResolvedId','purchaseSupplierById','purchaseAdvanceMatchesSupplier']){
  const line=functionLine(name);
  if(!line){failures.push(`Missing ${name}().`);continue;}
  vm.runInContext(line,context);
}
if(!failures.length){
  if(vm.runInContext("purchaseSupplierResolvedId('old_airuss')",context)!=='airuss_printing')failures.push('A merged supplier ID must resolve to the surviving supplier.');
  if(vm.runInContext("purchaseSupplierById('old_airuss').id",context)!=='airuss_printing')failures.push('A stale purchase draft must bind to the surviving active supplier.');
  if(!vm.runInContext("purchaseAdvanceMatchesSupplier({supplierId:'airuss_printing'},'old_airuss','Airuss')",context))failures.push('An advance on the surviving supplier must match a draft that still has the merged supplier ID.');
  if(!vm.runInContext("purchaseAdvanceMatchesSupplier({supplierId:'old_airuss'},'airuss_printing','Airuss Printing Company')",context))failures.push('A legacy advance on the merged supplier must match the surviving supplier.');
  if(vm.runInContext("purchaseAdvanceMatchesSupplier({supplierId:'other_supplier'},'old_airuss','Airuss')",context))failures.push('An unrelated supplier advance must never be offered.');
  if(vm.runInContext("purchaseSupplierResolvedId('cycle_a')",context)!=='')failures.push('A malformed supplier merge cycle must fail closed.');
}

for(const [file,text] of [['src/admin/pos/11h-purchase-workspace.js',source],['assets/js/admin/pos.js',bundle]]){
  must(text,'P.supplierId=selectedSupplier.id;P.supplier=selectedSupplier.name',`${file}: stale purchase drafts must be rebound to the surviving supplier ID.`);
  must(text,"advanceState.error,advanceLoading=!advanceLoadError&&!advanceState.ready",`${file}: advance availability must distinguish loading and failed feeds from a genuine empty result.`);
}
must(purchaseUi,'Loading approved supplier advances…','Purchases must display an explicit supplier-advance loading state.');
must(purchaseUi,'Supplier advances could not load. Refresh Admin and try again.','Purchases must display an explicit supplier-advance error state.');
must(hub,'dispatch(entry,entry.last||facade(entry));','Live-data failures must notify consumers so loading UI cannot remain stuck or silently appear empty.');

if(failures.length){console.error('Supplier advance merged-supplier check FAILED:\n- '+failures.join('\n- '));process.exit(1);}
console.log('PASS: supplier advances survive supplier merges and expose loading failures without cross-supplier allocation.');
