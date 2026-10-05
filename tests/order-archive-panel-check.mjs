// Order Archive panel (split out of admin core.mjs, Oct 2026). Renders the archived-order
// summary and cards from the live map core supplies, shows the delete button only to an admin
// and only for a rejected order past the 90-day retention, and deletes only after manager
// approval through the server command, then re-renders without the order.
import assert from 'node:assert/strict';
const DAY=86400000,now=Date.now();
const nodes={};
const el=id=>nodes[id]||(nodes[id]={id,value:'',innerHTML:'',textContent:'',disabled:false,onclick:null,buttons:[],querySelectorAll(selector){
  if(selector!=='button[data-delarch]')return[];
  if(this._for===this.innerHTML)return this._buttons;this._for=this.innerHTML;
  return this._buttons=[...this.innerHTML.matchAll(/data-delarch="([^"]+)"/g)].map(m=>{const listeners={};return{getAttribute:()=>m[1],addEventListener:(type,fn)=>{listeners[type]=fn;},click(){listeners.click.call(this);}};});
}});
globalThis.document={getElementById:el};
const {createOrderArchivePanel}=await import('../assets/js/admin/order-archive-panel.mjs');

const archived={
  OLDREJ:{id:'OLDREJ',name:'Ana',prevStatus:'Rejected',status:'Archived',archivedAt:now-120*DAY,total:150,items:'Latte x1',payment:'Cash',type:'Pick-up',date:'2026-06-01',time:'10:00'},
  NEWREJ:{id:'NEWREJ',name:'Ben',prevStatus:'Rejected',status:'Archived',archivedAt:now-5*DAY,total:90,items:'Tea x1',payment:'Cash',type:'Pick-up',date:'2026-10-01',time:'11:00'},
  DONE:{id:'DONE',name:'Cy',prevStatus:'Completed',status:'Archived',archivedAt:now-2*DAY,total:300,items:'Mocha x2',payment:'GCash',type:'Pick-up',date:'2026-10-04',time:'12:00'},
};
let admin=true;const calls=[];
const panel=createOrderArchivePanel({
  getArchivedOrders:()=>archived,archiveOutcome:o=>({style:'',icon:'',label:o.prevStatus}),hub:{historyStatus:()=>({loaded:3,hasOlder:false}),loadOlder:async()=>{}},isAdmin:()=>admin,
  showDeletePopup:(label,confirm)=>{calls.push(['popup',label]);return confirm();},
  requestManagerApproval:async(action,id,amount,reason)=>{calls.push(['approval',action,id,amount,reason]);return{approvalId:'AP1'};},
  manageOrderArchive:async(command)=>{calls.push(['command',command]);},
});
panel.render();
assert.match(nodes.archiveSummary.innerHTML,/Loaded 3 most recent archived order/);
assert.match(nodes.archiveSummary.innerHTML,/₱300/,'completed revenue is shown with a real peso sign');
assert.ok(!/Â|â‚/.test(nodes.archiveSummary.innerHTML+nodes.archiveList.innerHTML),'no garbled characters');
assert.deepEqual([...nodes.archiveList.innerHTML.matchAll(/data-delarch="([^"]+)"/g)].map(m=>m[1]),['OLDREJ'],'only a rejected order past 90 days can be deleted');
assert.equal((nodes.archiveList.innerHTML.match(/Retained audit record/g)||[]).length,2);

const [button]=nodes.archiveList.querySelectorAll('button[data-delarch]');
button.click();
await new Promise(resolve=>setTimeout(resolve,10));
assert.deepEqual(calls.find(c=>c[0]==='approval'),['approval','delete_archived_order','OLDREJ',150,'Delete rejected order after retention period']);
assert.deepEqual(calls.find(c=>c[0]==='command'),['command',{action:'delete',orderId:'OLDREJ',approvalId:'AP1'}]);
assert.ok(!archived.OLDREJ,'the deleted order leaves the live map');
assert.ok(!nodes.archiveList.innerHTML.includes('OLDREJ'),'and the panel re-renders without it');

admin=false;panel.render();
assert.ok(!nodes.archiveList.innerHTML.includes('data-delarch')&&!nodes.archiveList.innerHTML.includes('Retained audit record'),'staff see no delete controls');
console.log('PASS: the Order Archive panel renders from core\'s live map, offers delete only to admins for rejected orders past retention, and deletes only through manager approval and the server command.');
