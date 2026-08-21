import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/,route=>route.abort());});

test('customer shell exposes safe connection state and local payment assets',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page).toHaveTitle(/Accaza Coffee House/i);
  await expect(page.locator('#fbSync')).toContainText(/Firebase|Connecting/i);
  await expect(page.locator('.btn-place-order')).toBeDisabled();
  await expect(page.locator('#orderConnectionRetry')).toBeHidden();
  await expect(page.locator('#qrGcash img')).toHaveAttribute('src','assets/img/payment/gcash-qr.jpg');
  await expect(page.locator('#qrBdo img')).toHaveAttribute('src','assets/img/payment/bdo-qr.jpg');
  expect((await page.request.get('/assets/img/payment/gcash-qr.jpg')).ok()).toBeTruthy();
  expect((await page.request.get('/assets/img/payment/bdo-qr.jpg')).ok()).toBeTruthy();
});

test('customer page has usable landmarks, labels, and keyboard focus',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('nav')).toBeVisible();
  await expect(page.locator('main, section').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).not.toHaveCount(0);
  await expect(page.locator('img:not([alt])')).toHaveCount(0);
  await expect(page.locator('a[href*="PLACEHOLDER"]')).toHaveCount(0);
});

test('admin shell carries the coordinated release marker',async({page})=>{
  await page.goto('/admin.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('meta[name="accaza-admin-build"]')).toHaveAttribute('content',/^[0-9]+$/);
  await expect(page.locator('body')).toContainText(/Accaza Coffee/i);
});
