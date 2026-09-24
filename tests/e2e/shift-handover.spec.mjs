import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const source=['10-cash-denominations.js','79-shift-handover.js'].map(name=>fs.readFileSync(new URL('../../src/admin/register/'+name,import.meta.url),'utf8')).join('\n');

test.beforeEach(async({page})=>{
  await page.setContent('<main></main>');
  await page.evaluate(()=>{
    window.peso=n=>'PHP '+Number(n).toFixed(2);
    window.esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.calls=[];
    window.AccazaOfflineQueue={all:async()=>[{id:'failed_transaction',status:'failed',order:{shiftId:'SH-TEST'}},{id:'old_synced_transaction',status:'synced',order:{shiftId:'SH-TEST'}},{id:'other_shift_transaction',status:'failed',order:{shiftId:'SH-OTHER'}}]};
    window.AccazaPosSyncHealth={deviceId:()=> 'device-test'};
    window.A=()=>({callables:{manageShiftHandover:async data=>{
      window.calls.push(data);
      if(window.failHandover)throw new Error('Connection lost');
      return {data:{cash:{countedCash:150,actualFloatRetained:100,cashToSettle:50}}};
    }}});
  });
  await page.addScriptTag({content:source});
});

test('failed sale is retained and cashier can hand over without manager approval',async({page})=>{
  await page.evaluate(()=>openHandoverCount({id:'SH-TEST'},new Error('One failed sale')));
  await page.locator('[data-dk="b100"]').fill('1');
  await page.locator('[data-dk="b50"]').fill('1');
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('heading',{name:'Shift handed over'})).toBeVisible();
  await expect(page.getByText('The next cashier can open their shift.')).toBeVisible();
  const calls=await page.evaluate(()=>window.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].closeCount).toEqual({b100:1,b50:1});
  expect(calls[0].rows[0].status).toBe('failed');
  expect(calls[0].rows).toHaveLength(1);
});

test('lost acknowledgement keeps the locked cash count visible and allows retry',async({page})=>{
  await page.evaluate(()=>{window.failHandover=true;openHandoverCount({id:'SH-TEST'},new Error('Sync incomplete'),{b100:1,b50:1});});
  await expect(page.locator('[data-dk="b100"]')).toHaveValue('1');
  await expect(page.locator('[data-dk="b100"]')).toBeDisabled();
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('status')).toContainText('Handover not confirmed');
  await expect(page.locator('[data-dk="b50"]')).toHaveValue('1');
  await page.evaluate(()=>{window.failHandover=false;});
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('heading',{name:'Shift handed over'})).toBeVisible();
  expect(await page.evaluate(()=>window.calls.map(c=>c.closeCount))).toEqual([{b100:1,b50:1},{b100:1,b50:1}]);
});

test('an unreadable queue is never reported as empty or successfully handed over',async({page})=>{
  await page.evaluate(()=>{window.AccazaOfflineQueue=null;openHandoverCount({id:'SH-TEST'},new Error('Queue unavailable'));});
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('status')).toContainText('Do not clear browser data');
  expect(await page.evaluate(()=>window.calls)).toHaveLength(0);
});

// 24 Sep 2026 (Alex, SH-945869): the till's close check failed on the device although nothing
// was outstanding. The server now closes such a shift at handover and the Z report shows.
test('a clean handover closed by the server shows the Z report and records why the till check failed',async({page})=>{
  await page.evaluate(()=>{
    window.zShown=[];window.showZ=(s,z)=>window.zShown.push({shift:s.id,net:z.net,sales:z.saleList.length});
    window.zReportView=r=>Object.assign({},r,{saleList:r.sales||[]});
    window.AccazaOfflineQueue={all:async()=>[]};
    window.A=()=>({callables:{manageShiftHandover:async data=>{window.calls.push(data);return {data:{handedOver:true,resolved:true,automatic:true,cash:{countedCash:150,actualFloatRetained:100,cashToSettle:50},variance:0,zReport:{net:50,variance:0,sales:[{id:'POS-1'}],capturedAt:1},shift:{id:'SH-TEST',closeAt:1}}};}}});
    openHandoverCount({id:'SH-TEST'},Object.assign(new Error('The sync check did not finish within 30 seconds.'),{closeStep:'timeout'}),{b100:1,b50:1});
  });
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('heading',{name:'Shift closed'})).toBeVisible();
  expect(await page.evaluate(()=>window.zShown)).toEqual([{shift:'SH-TEST',net:50,sales:1}]);
  const calls=await page.evaluate(()=>window.calls);
  expect(calls[0].closeCheckError).toBe('[timeout] The sync check did not finish within 30 seconds.');
  expect(calls[0].rows).toHaveLength(0);
  await page.getByRole('button',{name:'Show Z report'}).click();
  expect(await page.evaluate(()=>window.zShown.length)).toBe(2);
});

test('a handover the server cannot close yet says why',async({page})=>{
  await page.evaluate(()=>{
    window.AccazaOfflineQueue={all:async()=>[]};
    window.A=()=>({callables:{manageShiftHandover:async data=>{window.calls.push(data);return {data:{handedOver:true,cash:{countedCash:150,actualFloatRetained:100,cashToSettle:50},pendingSales:0,autoFinalizeBlocker:'2 sale(s) on 1 other POS device(s) still require synchronization.'}};}}});
    openHandoverCount({id:'SH-TEST'},new Error('offline'),{b100:1,b50:1});
  });
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('heading',{name:'Shift handed over'})).toBeVisible();
  await expect(page.getByText('Why it is still open: 2 sale(s) on 1 other POS device(s)')).toBeVisible();
});

test('a handover the server cannot close yet still prints a provisional Z report',async({page})=>{
  await page.evaluate(()=>{
    window.zShown=[];window.showZ=(s,z)=>window.zShown.push({shift:s.id,status:z.status,sales:z.saleList.length});window.zReportView=r=>Object.assign({},r,{saleList:r.sales||[]});
    window.AccazaOfflineQueue={all:async()=>[]};
    window.A=()=>({callables:{manageShiftHandover:async data=>{window.calls.push(data);return {data:{handedOver:true,cash:{countedCash:150,actualFloatRetained:100,cashToSettle:50},pendingSales:1,autoFinalizeBlocker:'Sale POS-9 still needs recovery.',provisionalZReport:{status:'provisional',net:50,sales:[{id:'POS-9',unsynced:true}],openItems:{retainedSales:[{orderId:'POS-9',total:50}]}},shift:{id:'SH-TEST'}}};}}});
    openHandoverCount({id:'SH-TEST'},new Error('offline'),{b100:1,b50:1});
  });
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('heading',{name:'Shift handed over'})).toBeVisible();
  expect(await page.evaluate(()=>window.zShown)).toEqual([{shift:'SH-TEST',status:'provisional',sales:1}]);
  await page.getByRole('button',{name:'Show provisional Z report'}).click();
  expect(await page.evaluate(()=>window.zShown.length)).toBe(2);
});

test('with no server at all the till still shows its own provisional Z report',async({page})=>{
  await page.evaluate(()=>{
    window.zShown=[];window.showZ=(s,z)=>window.zShown.push({shift:s.id,status:z.status});
    window.localProvisionalZ=async(shift,counts,reason)=>({status:'provisional',countedCash:150,reason});
    window.failHandover=true;
    openHandoverCount({id:'SH-TEST'},new Error('offline'),{b100:1,b50:1});
  });
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('status')).toContainText('Handover not confirmed');
  expect(await page.evaluate(()=>window.zShown)).toEqual([{shift:'SH-TEST',status:'provisional'}]);
  await page.getByRole('button',{name:'Submit count and finish shift'}).click();
  await expect(page.getByRole('status')).toContainText('Handover not confirmed');
  expect(await page.evaluate(()=>window.zShown.length)).toBe(1);
  await page.getByRole('button',{name:'Show provisional Z report (this till)'}).click();
  expect(await page.evaluate(()=>window.zShown.length)).toBe(2);
});
