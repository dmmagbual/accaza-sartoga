import {test,expect} from '@playwright/test';
import {installBooksFirebaseFixture} from './books-firebase-fixture.mjs';

// Oct 2026: the public site signs every visitor in anonymously, and Finance Books shares that
// session because it runs on the same site. On 1-2 Oct a café Mac showed Books as "Live" on that
// session while the server refused every supplier and sales-summary call (30 refusals). Books must
// treat an anonymous session as signed out: show "Sign in", call no function, attach no live feed.
const DATA={payables:{p1:{supplier:'Test supplier',amount:100}},receivables:{r1:{amount:50}},suppliers:{s1:{name:'Test supplier'}}};
const STAFF_FEEDS=['payables','receivables','books/monthlyNet','accountingPeriods','cfAccounts','booksChart','posActiveShift/status'];

async function openBooks(page,options){
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|www\.gstatic\.com)/,route=>route.abort());
  await installBooksFirebaseFixture(page,DATA,options);
  await page.goto('/books.html',{waitUntil:'domcontentloaded'});
}

test('an anonymous public-site session is treated as signed out in Finance Books',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openBooks(page,{anonymous:true});
  await expect(page.locator('#liveStatus')).toContainText('Sign in for live POS');
  await page.waitForTimeout(600);
  expect(await page.evaluate(()=>window.__booksUser)).toBeNull();
  expect(await page.evaluate(()=>window.__booksFixtureCalls||[])).toEqual([]);
  const reads=await page.evaluate(()=>window.__booksFixtureReads||[]);
  for(const feed of STAFF_FEEDS)expect(reads,`anonymous session must not attach ${feed}`).not.toContain(feed);
  await expect(page.locator('#liveStatus')).not.toContainText('Live');
  // Sign-in gate (books 159): the sign-in form is shown and Books itself stays hidden.
  await expect(page.locator('#booksGateForm')).toBeVisible();
  await expect(page.locator('#page')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a staff account without Finance Books access is refused and sees nothing',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openBooks(page,{role:'cashier',perms:{pos:true}});
  await expect(page.locator('#booksGate')).toContainText('No Finance Books access');
  await expect(page.locator('#booksGate')).toContainText('Finance Books app');
  await expect(page.locator('#page')).toBeHidden();
  await expect(page.locator('#tabs')).toBeHidden();
  await page.waitForTimeout(400);
  expect(await page.evaluate(()=>window.__booksFixtureCalls||[])).toEqual([]);
  const reads=await page.evaluate(()=>window.__booksFixtureReads||[]);
  for(const feed of STAFF_FEEDS)expect(reads,`a refused account must not attach ${feed}`).not.toContain(feed);
  expect(errors).toEqual([]);
});

test('a finance account given Finance Books app opens Books',async({page})=>{
  await openBooks(page,{role:'finance',perms:{cashflow:true}});
  await expect.poll(()=>page.evaluate(()=>window.__booksUser||'')).toBe('owner@example.test');
  await expect(page.locator('#booksGate')).toBeHidden();
  await expect(page.locator('#page')).toBeVisible();
});

test('a staff sign-in still goes live in Finance Books',async({page})=>{
  await openBooks(page,{});
  await expect.poll(()=>page.evaluate(()=>window.__booksUser||'')).toBe('owner@example.test');
  await expect(page.locator('#liveStatus')).toContainText('Live');
  await expect(page.locator('#booksGate')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.__booksFixtureCalls||[])).toContain('manageSupplier');
  const reads=await page.evaluate(()=>window.__booksFixtureReads||[]);
  expect(reads).toContain('payables');
});
