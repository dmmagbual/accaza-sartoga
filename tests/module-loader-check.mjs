import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('assets/js/admin/module-loader.js','utf8');
const loaded=[],handled=[],roots={};
const window={switchTab(tab){handled.push('switch:'+tab);}};
const document={
  head:{appendChild(script){
    loaded.push(script.src);
    const name=script.dataset.accazaModule;
    if(name==='offlinequeue')window.AccazaOfflineQueue={VERSION:'test'};
    else if(name==='costing')window.AccazaCosting={VERSION:'test'};
    else if(name)window.__accazaRegisterModule(name,tab=>handled.push(name+':'+tab));
    queueMicrotask(()=>script.onload&&script.onload());
  }},
  createElement(){return {dataset:{}};},
  getElementById(id){return roots[id]||(roots[id]={innerHTML:''});},
  addEventListener(){},
};
const sandbox={window,document,console,Promise,Error,queueMicrotask,alert(){}};
vm.runInNewContext(source,sandbox);

if(loaded.length)throw new Error('lazy modules loaded during startup');
window.__showOfflineQueue=()=>handled.push('queue:opened');
const queueButton={innerHTML:'Offline queue',disabled:false,setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];}};
await window.__openOfflineQueue(queueButton);
if(!handled.includes('queue:opened'))throw new Error('offline queue did not open from a cold admin load');
if(queueButton.disabled||queueButton['aria-busy'])throw new Error('offline queue button remained busy after opening');
await window.posSwitchTab('analytics',null);
if(loaded.join('|')!=='assets/js/admin/offline-queue.js|assets/js/admin/../shared/costing.js|assets/js/admin/pos.js|assets/js/admin/analytics.js')throw new Error('analytics dependency order is incorrect: '+loaded.join('|'));
if(!handled.includes('pos:analytics')||!handled.includes('analytics:analytics'))throw new Error('analytics handlers were not called');
const count=loaded.length;
await window.posSwitchTab('pnl',null);
if(loaded.length!==count)throw new Error('already-loaded modules were downloaded twice');
if(loaded.some(src=>src.includes('xlsx')))throw new Error('Excel library loaded before an Excel action');
await window.posSwitchTab('operations',null);
if(!loaded.includes('assets/js/admin/operations-dashboard.js'))throw new Error('system health module was not loaded on demand');
if(!handled.includes('operations:operations'))throw new Error('system health handler was not called');

console.log('PASS: cold-load offline queue, lazy tab routing, dependency order, module reuse, operational dashboard, and deferred Excel loading passed.');
