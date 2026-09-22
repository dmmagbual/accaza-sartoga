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
