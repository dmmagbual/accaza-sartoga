import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/,route=>route.abort());
  await page.goto('/admin.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    window.AccazaDate={key:()=> '2026-09-03'};
    document.querySelectorAll('body > section').forEach(el=>{el.style.display='none';});
    document.getElementById('adminDash').style.display='block';
    for(const id of ['dashboard','saleshistory','analytics'])document.getElementById('tab-'+id).style.display='block';
    for(const prefix of ['overview','salesHistory','analytics'])window.AccazaAdminPeriods.bind({scope:'sales',fromId:prefix+'PeriodFrom',toId:prefix+'PeriodTo',monthId:prefix+'PeriodMonth',applyId:prefix+'PeriodApply'});
    window.AccazaAdminPeriods.setMonth('sales','2026-09');
  });
});

test('three local controls synchronize with tactile Apply and no global All time',async({page})=>{
  await expect(page.locator('#overviewPeriodFrom')).toHaveValue('2026-09-01');
  await expect(page.locator('#overviewPeriodTo')).toHaveValue('2026-09-03');
  await expect(page.locator('#reportPeriodAll')).toHaveCount(0);
  await expect(page.locator('#reportPeriodFrom')).toHaveCount(0);
  await page.locator('#salesHistoryPeriodMonth').fill('2026-08');
  await expect(page.locator('#overviewPeriodFrom')).toHaveValue('2026-08-01');
  await expect(page.locator('#analyticsPeriodTo')).toHaveValue('2026-08-31');
  await page.locator('#overviewPeriodFrom').fill('2026-09-01');
  await page.locator('#overviewPeriodTo').fill('2026-09-02');
  await page.evaluate(()=>window.AccazaAdminPeriods.setWaiter(()=>new Promise(resolve=>{window.releaseReport=resolve;})));
  const button=page.locator('#overviewPeriodApply');
  await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  expect(await button.evaluate(el=>getComputedStyle(el).transform)).not.toBe('none');
  await page.mouse.up();
  await expect(button).toHaveText('Applying…');await expect(button).toBeDisabled();
  await expect(page.locator('#analyticsPeriodTo')).toHaveValue('2026-09-02');
  await expect(page.locator('#salesHistoryPeriodMonth')).toHaveValue('');
  await page.evaluate(()=>window.releaseReport(true));
  await expect(button).toHaveText('Applied ✓');await expect(button).toHaveText('Apply');await expect(button).toBeEnabled();
});

test('full ranking reads its own dates and permits PDF only after its data loads',async({page})=>{
  await page.evaluate(async()=>{
    window.AccazaAdminPeriods.setMonth('sales','2026-08');
    const {createOverviewInsights}=await import('/assets/js/admin/overview-insights.mjs');
    window.rankingReads=[];window.didPrint=false;window.print=()=>{window.didPrint=true;};
    const overview=createOverviewInsights({esc:String,readRanking:range=>{window.rankingReads.push(range);return new Promise(resolve=>{window.finishRanking=()=>resolve([{id:'september',status:'Completed',paymentStatus:'confirmed',timestamp:Date.parse('2026-09-03T12:00:00+08:00'),total:300,subtotal:300,lineItems:[{name:'Latte',qty:3,unitTotal:100}]}]);});}});
    overview.render({historyComplete:true,sales:[],outcomes:[],active:[]});
  });
  await page.locator('#openDrinkRankingBtn').click();
  await expect(page.locator('#printDrinkRankingBtn')).toBeDisabled();
  await page.evaluate(()=>window.finishRanking());
  await expect(page.locator('#drinkRankingTotal')).toHaveText('3');
  await expect(page.locator('#printDrinkRankingBtn')).toBeEnabled();
  await expect(page.locator('#overviewPeriodMonth')).toHaveValue('2026-08');
  expect(await page.evaluate(()=>window.rankingReads[0].from)).toBe('2026-09-03');
  await page.locator('#printDrinkRankingBtn').click();
  expect(await page.evaluate(()=>window.didPrint)).toBe(true);
});
