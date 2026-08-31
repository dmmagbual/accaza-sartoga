import {test,expect} from '@playwright/test';

test('Finance direct links render CSV controls and download journal lines',async({page})=>{
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/,route=>route.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/books.html?tab=journal',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    window.__booksLiveLoading=false;
    window.__posEntries=[{id:'csv-test',date:window.AccazaDate.key(),ref:'CSV-260',memo:'CSV fixture',lines:[{code:'1000',debit:260},{code:'4000',credit:260}]}];
    window.App.go('journal');
  });
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download CSV'}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^accaza-journal-.*\.csv$/);
  const stream=await download.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const csv=Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('CSV-260');expect(csv).toContain('260.00');expect(csv).toContain('Account code');
  expect(errors).toEqual([]);
});
