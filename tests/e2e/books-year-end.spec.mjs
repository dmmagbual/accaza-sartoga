import {test,expect} from '@playwright/test';
import {installBooksFirebaseFixture} from './books-firebase-fixture.mjs';

// Calendar-year close (Sep 2026). Finance Books carries months before the selected period from
// the immutable monthly totals. Completed years must appear as retained earnings and the
// balance-sheet year's earlier months as current-year net income, before and after 31 December.
// monthlyNet stores debit-minus-credit per account for each Manila month.
const sale=(amount)=>({'1000':amount,'4000':-amount});
const DATA={
  books:{
    monthlyNet:{'2025-12':sale(10000),'2026-03':sale(30000),'2026-08':sale(20000),'2026-09':sale(5000),'2026-12':sale(7000),'2027-01':sale(3000),'2027-03':sale(1000)},
    journal:{
      j_2026_09:{date:'2026-09-10',ref:'SEP',memo:'September sale',lines:[{code:'1000',debit:5000,credit:0},{code:'4000',debit:0,credit:5000}]},
      j_2026_12:{date:'2026-12-15',ref:'DEC',memo:'December sale',lines:[{code:'1000',debit:7000,credit:0},{code:'4000',debit:0,credit:7000}]},
      j_2027_01:{date:'2027-01-05',ref:'JAN',memo:'January sale',lines:[{code:'1000',debit:3000,credit:0},{code:'4000',debit:0,credit:3000}]},
      j_2027_03:{date:'2027-03-02',ref:'MAR',memo:'March sale',lines:[{code:'1000',debit:1000,credit:0},{code:'4000',debit:0,credit:1000}]}
    }
  }
};

// Run as the owner does: a laptop in Port Moresby (UTC+10), two hours ahead of Manila.
test.use({timezoneId:'Pacific/Port_Moresby'});

async function openBooks(page,now){
  await page.clock.setSystemTime(new Date(now));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|www\.gstatic\.com)/,route=>route.abort());
  await installBooksFirebaseFixture(page,DATA);
  await page.goto('/books.html',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.__booksUser||'')).toBe('owner@example.test');
}

async function equity(page,period){
  await page.evaluate(p=>{if(p.month)window.AccazaReportPeriod.setMonth(p.month);else window.AccazaReportPeriod.set({mode:'custom',customFrom:p.from,customTo:p.to});window.App.go('bs');},period);
  // The equity rows appear as soon as the balance sheet paints, which can be before the selected
  // period's journal has arrived: live-pos.mjs clears __booksLiveLoading on any feed delivery, not
  // only the journal's, so a monthlyNet update can reveal a carry-only page for a frame. Waiting
  // for three rows alone therefore reads a partially loaded period. Wait for figures that are both
  // fully formed and unchanged between samples, so the assertion sees the settled period.
  const shaped=text=>/^(Retained earnings|Current-year net|Total equity).* ₱[\d,]+\.\d{2}$/.test(text);
  let rows=[],previous=null;
  await expect.poll(async()=>{
    const current=await page.locator('#page tr').evaluateAll(list=>list.map(row=>row.innerText.replace(/\s+/g,' ').trim()).filter(text=>/^(Retained earnings|Current-year net|Total equity)/.test(text)));
    const settled=current.length===3&&current.every(shaped)&&previous!==null&&JSON.stringify(current)===JSON.stringify(previous);
    previous=current;
    if(settled)rows=current;
    return settled;
  },{timeout:15000}).toBe(true);
  await expect(page.locator('#page')).toContainText('Balanced');
  return rows;
}

test.describe('balance sheet equity after the year end',()=>{
  // Opened on 20 Mar 2027 (noon Manila) because Finance Books correctly refuses future periods.
  test.beforeEach(async({page})=>{await openBooks(page,'2027-03-20T04:00:00Z');});

  test('mid-year: earlier months of the year stay current-year income',async({page})=>{
    expect(await equity(page,{month:'2026-09'})).toEqual([
      'Retained earnings (closed through Dec 31, 2025) ₱10,000.00',
      'Current-year net income (2026) ₱55,000.00',
      'Total equity ₱65,000.00'
    ]);
  });

  test('after 31 December the completed year closes to retained earnings',async({page})=>{
    expect(await equity(page,{month:'2027-01'})).toEqual([
      'Retained earnings (closed through Dec 31, 2026) ₱72,000.00',
      'Current-year net income (2027) ₱3,000.00',
      'Total equity ₱75,000.00'
    ]);
  });

  test('a period spanning the year end classifies by the period end year',async({page})=>{
    expect(await equity(page,{from:'2026-12-01',to:'2027-01-31'})).toEqual([
      'Retained earnings (closed through Dec 31, 2026) ₱72,000.00',
      'Current-year net income (2027) ₱3,000.00',
      'Total equity ₱75,000.00'
    ]);
  });

  test('later in the new year, January carries as current-year income',async({page})=>{
    expect(await equity(page,{month:'2027-03'})).toEqual([
      'Retained earnings (closed through Dec 31, 2026) ₱72,000.00',
      'Current-year net income (2027) ₱4,000.00',
      'Total equity ₱76,000.00'
    ]);
  });
});

test("New Year's Eve in Port Moresby is still 31 December in Manila",async({page})=>{
  // 22:30 on 31 Dec 2026 in Manila is already 00:30 on 1 Jan 2027 on the owner's laptop.
  await openBooks(page,'2026-12-31T14:30:00Z');
  const period=await page.evaluate(()=>{window.AccazaReportPeriod.set({mode:'current'});return window.AccazaReportPeriod.get();});
  expect([period.from,period.to]).toEqual(['2026-12-01','2026-12-31']);
  await expect(page.evaluate(()=>window.AccazaReportPeriod.setMonth('2027-01'))).rejects.toThrow(/Future reporting/);
  await page.evaluate(()=>window.App.go('bs'));
  await expect(page.locator('#page')).toContainText('Current-year net income (2026)');
  await expect(page.locator('#page')).toContainText('Retained earnings (closed through Dec 31, 2025)');
});
