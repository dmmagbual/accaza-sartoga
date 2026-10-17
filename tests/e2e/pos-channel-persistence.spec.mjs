import {test,expect} from '@playwright/test';
import fs from 'node:fs';
// Regression: after switching to GrabFood/FoodPanda, the checkout dropdown showed a stale "In-store"
// (restored from the typed-input draft) while the till was really charging the platform channel.
const state=fs.readFileSync(new URL('../../src/admin/pos/00-shared-state.js',import.meta.url),'utf8');
const checkout=fs.readFileSync(new URL('../../src/admin/pos/50e-cart-checkout.js',import.meta.url),'utf8');
const helpers=state.split('\n').filter(line=>/^function (capturePosDraft|restorePosDraft)\(/.test(line)).join('\n');
const channelLine=checkout.split('\n').find(line=>line.includes("var _chsel=document.getElementById('posChannelSel');"));

test.beforeEach(async({page})=>{
  if(!helpers.includes('capturePosDraft')||!helpers.includes('restorePosDraft')||!channelLine)throw new Error('POS draft helpers or channel handler not found.');
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({content:`var posDraft={},posChannel='instore',posCart={},posScopedDisc=[];window.__posPkgs=[];
${helpers}
function buildPOS(){document.getElementById('root').innerHTML='<div id="posCartPanel"></div>';renderPosCart();}
function renderPosCart(options){var p=document.getElementById('posCartPanel');if(!(options&&options.fresh))capturePosDraft(p);
  p.innerHTML='<select id="posChannelSel">'+['instore','grabfood','foodpanda'].map(function(k){return '<option value="'+k+'"'+(posChannel===k?' selected':'')+'>'+k+'</option>';}).join('')+'</select><input id="posCust">';
  restorePosDraft(p);
${channelLine}
}`});
});

for(const channel of ['grabfood','foodpanda']){
  test(`the channel dropdown stays on ${channel} across redraws and view switches`,async({page})=>{
    await page.evaluate(()=>{buildPOS();document.getElementById('posCust').value='Ana';renderPosCart();});
    await page.selectOption('#posChannelSel',channel);
    await expect.poll(()=>page.evaluate(()=>posChannel)).toBe(channel);
    await expect(page.locator('#posChannelSel')).toHaveValue(channel);
    await page.evaluate(()=>{buildPOS();buildPOS();renderPosCart();}); // Shift Orders / QR / Online and back, then a live redraw
    await expect(page.locator('#posChannelSel')).toHaveValue(channel);
    await expect(page.locator('#posCust')).toHaveValue('Ana'); // typed entries are still kept
    await page.selectOption('#posChannelSel','instore');
    await expect.poll(()=>page.evaluate(()=>posChannel)).toBe('instore');
    await page.evaluate(()=>buildPOS());
    await expect(page.locator('#posChannelSel')).toHaveValue('instore');
  });
}

test('a stale draft can never override the real channel',async({page})=>{
  await page.evaluate(()=>{posDraft={posChannelSel:{value:'instore',checked:false,type:'select-one'}};posChannel='foodpanda';buildPOS();});
  await expect(page.locator('#posChannelSel')).toHaveValue('foodpanda');
});
