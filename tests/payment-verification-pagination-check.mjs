import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const records = Object.fromEntries(Array.from({length: 250}, (_, i) => [`order_${String(i + 1).padStart(3, '0')}`, {amount: i + 1}]));
for (const file of ['src/admin/register/52-payment-verification.js', 'assets/js/admin/register.js']) {
  const source = fs.readFileSync(file, 'utf8'), start = source.indexOf('async function payVerifyQueuePages'), end = source.indexOf('\n// Verify:', start);
  assert.ok(start >= 0 && end > start, `${file} payment verification paginator must remain extractable`);
  const context = {};vm.createContext(context);vm.runInContext(`${source.slice(start, end)};this.paginate=payVerifyQueuePages;`, context);
  let reads = 0;
  const api = {db:{},ref:()=>({}),orderByKey:()=>({kind:'key'}),startAt:(value)=>({kind:'start',value}),limitToFirst:(value)=>({kind:'limit',value}),query:(_base,...parts)=>({parts}),get:async(target)=>{reads+=1;const startAt=target.parts.find((part)=>part.kind==='start'),limit=target.parts.find((part)=>part.kind==='limit').value,keys=Object.keys(records).sort().filter((key)=>!startAt||key>=startAt.value).slice(0,limit);return{val:()=>Object.fromEntries(keys.map((key)=>[key,records[key]]))};}};
  const paged = await context.paginate(api);
  assert.deepEqual(Object.keys(paged).sort(), Object.keys(records).sort(), `${file} pagination must neither skip nor duplicate a boundary row`);
  assert.equal(reads, 3, `${file}: 250 open reviews require three bounded reads`);
}
console.log('PASS: payment verification queue uses complete 100-row key pagination without a boundary gap.');
