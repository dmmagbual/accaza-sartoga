import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const crewSource=fs.readFileSync(new URL('../../src/admin/register/78-shift-crew.js',import.meta.url),'utf8');
const posState=fs.readFileSync(new URL('../../src/admin/pos/00-shared-state.js',import.meta.url),'utf8');
const sellerSource=posState.match(/function posSellerState\(\)\{[^\n]*\n/)[0];

test.beforeEach(async({page})=>{
  await page.setContent('<main id="root"></main>');
  await page.evaluate(()=>{
    window.peso=n=>'PHP '+Number(n).toFixed(2);
    window.esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.isTab=()=>false;window.renderOps=()=>{};
    window.calls=[];
    window.F=()=>({run:async(_config,submit)=>submit({reason:'Rung by Louize on Maria shift; cash is in the drawer'})});
    window.A=()=>({callables:{
      managePosShiftCrew:async data=>{window.calls.push(data);return {data:{left:true}};},
      managePosSaleRecovery:async data=>{window.calls.push(data);if(data.action==='list')return {data:{rows:window.recovered?[]:[{transactionId:'pos_refused_1',orderId:'POS-REFUSED1',shiftId:'SH-1',shiftStaff:'Maria',shiftStatus:'handover_pending',rungBy:'Louize',total:150,orderTimestamp:1,message:"This sale belongs to Maria's shift.",count:3,recoverable:true,items:'Latte x1'}]}};window.recovered=true;return {data:{state:'recovered'}};}
    }});
  });
  await page.addScriptTag({content:crewSource+'\n'+sellerSource});
});

test('the till accepts payment only from the shift owner or a crew member',async({page})=>{
  const states=await page.evaluate(()=>{
    const shift={id:'SH-1',staff:'Maria',staffId:'st_maria',accountUid:'maria',crew:{louize:{staff:'Louize',staffId:'st_louize',joinedAt:1},alex:{staff:'alex',joinedAt:1,leftAt:2}}};
    const as=uid=>{window.__accazaAuthz={uid};window.__posShift=shift;return posSellerState();};
    const out={owner:as('maria'),crew:as('louize'),left:as('alex'),stranger:as('rya')};
    window.__posShift=null;out.none=posSellerState();return out;
  });
  expect(states.owner).toMatchObject({ok:true,role:'owner',staff:'Maria'});
  expect(states.crew).toMatchObject({ok:true,role:'crew',staff:'Louize',staffId:'st_louize'});
  expect(states.left).toMatchObject({ok:false,reason:'notcrew',owner:'Maria'});
  expect(states.stranger).toMatchObject({ok:false,reason:'notcrew',owner:'Maria'});
  expect(states.none).toMatchObject({ok:false,reason:'noshift'});
});

test('crew panel offers join, leave and remove to the right people',async({page})=>{
  const shift={id:'SH-1',staff:'Maria',accountUid:'maria',crew:{louize:{staff:'Louize',joinedAt:Date.now()}}};
  const html=await page.evaluate(s=>{const out={};for(const [who,role] of [['rya','staff'],['maria','staff'],['louize','staff'],['boss','manager']]){window.__accazaAuthz={uid:who,role};out[who]=crewPanelHtml(s);}return out;},shift);
  expect(html.rya).toContain('Join this shift');expect(html.rya).not.toContain('data-crew-remove');
  expect(html.maria).toContain('data-crew-remove="louize"');expect(html.maria).not.toContain('Join this shift');
  expect(html.louize).toContain('data-crew-leave');expect(html.louize).not.toContain('Join this shift');
  expect(html.boss).toContain('data-crew-remove="louize"');
  await page.evaluate(s=>{window.__accazaAuthz={uid:'maria',role:'staff'};window.activeShift=s;window.confirm=()=>true;document.getElementById('root').innerHTML=crewPanelHtml(s);wireCrewPanel(document.getElementById('root'));},shift);
  await page.getByRole('button',{name:'Remove'}).click();
  await expect.poll(()=>page.evaluate(()=>window.calls)).toEqual([{action:'remove',shiftId:'SH-1',uid:'louize'}]);
});

test('management recovers a refused sale with a recorded reason',async({page})=>{
  await page.evaluate(()=>reviewRefusedSales());
  await expect(page.getByRole('heading',{name:'Sales needing recovery'})).toBeVisible();
  await expect(page.getByText('POS-REFUSED1')).toBeVisible();
  await expect(page.getByText('Louize',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Recover'}).click();
  await expect(page.getByText('No refused sales.')).toBeVisible();
  const calls=await page.evaluate(()=>window.calls);
  expect(calls.find(c=>c.action==='recover')).toEqual({action:'recover',transactionId:'pos_refused_1',reason:'Rung by Louize on Maria shift; cash is in the drawer'});
});
