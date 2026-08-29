import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source=fs.readFileSync(path.join(process.cwd(),'assets','js','admin','sales-history.js'),'utf8');
const callbacks={},loadCalls=[];
let moduleHandler=null,styleAdded=false;
const root={innerHTML:''};
const hub={
  historyStatus(){return{hasOlder:false};},
  async loadOlder(pathName){loadCalls.push(pathName);return{loaded:0,hasOlder:false};}
};
const accaza={
  hub,
  subscribe(pathName,callback){callbacks[pathName]=callback;return function(){};}
};
const document={
  head:{appendChild(){styleAdded=true;}},
  createElement(){return{id:'',textContent:'',style:{}};},
  getElementById(id){if(id==='salesHistoryRoot')return root;if(id==='salesHistoryStyle'&&styleAdded)return{};return null;}
};
const window={
  __accaza:accaza,
  __accazaRegisterModule(name,handler){if(name==='saleshistory')moduleHandler=handler;},
  addEventListener(){},
  AccazaSales:{stamp(){return 0;},qualifies(){return false;},amounts(){return{gross:0,discount:0,refund:0,net:0};}},
  AccazaReportPeriod:{get(){return{period:'month'};}}
};
const sandbox={window,document,console,setTimeout,clearTimeout,Blob:function(){},URL:{createObjectURL(){return'';},revokeObjectURL(){}},Date,Object,Array,String,Number,Math,Promise,CustomEvent:function(){}};
vm.runInNewContext(source,sandbox,{filename:'sales-history.js'});
if(typeof moduleHandler!=='function')throw new Error('Sales History module did not register.');
moduleHandler('saleshistory');
for(const pathName of ['orders','archivedOrders','financialMovements']){
  if(typeof callbacks[pathName]!=='function')throw new Error(`Missing ${pathName} subscription.`);
  callbacks[pathName]({val(){return{};}});
}
await new Promise(resolve=>setTimeout(resolve,350));
if(loadCalls.length)throw new Error('Sales History downloaded older pages automatically instead of preserving the selected reporting boundary.');
if(!root.innerHTML.includes('Authoritative sales register'))throw new Error('Sales History did not render the selected reporting period after its bounded feeds loaded.');
console.log('PASS: Sales History renders bounded feeds without automatic historical downloads.');
