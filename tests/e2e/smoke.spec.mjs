import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {installCustomerFirebaseFixture} from './customer-firebase-fixture.mjs';

const release=JSON.parse(fs.readFileSync(new URL('../../release-manifest.json',import.meta.url),'utf8'));

test.beforeEach(async({page})=>{await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/,route=>route.abort());});

test('customer shell exposes safe connection state and local payment assets',async({page})=>{
  await installCustomerFirebaseFixture(page);
  const paymentQrRequests=[];
  page.on('request',request=>{
    if(/\/assets\/img\/payment\/(?:gcash|bdo)-qr\.jpg$/.test(new URL(request.url()).pathname)) paymentQrRequests.push(request.url());
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page).toHaveTitle(/Accaza Coffee House/i);
  await expect(page.locator('#fbSync')).toContainText(/Firebase|Connecting/i);
  await expect(page.locator('#orderConnectionRetry')).toBeHidden();
  await expect(page.locator('#qrGcash img')).toHaveCount(0);
  await expect(page.locator('#qrBdo img')).toHaveCount(0);
  await expect(page.locator('#qrGcash [data-payment-qr]')).toHaveText('Click for QR code');
  await expect(page.locator('#qrBdo [data-payment-qr]')).toHaveText('Click for QR code');
  expect(paymentQrRequests).toEqual([]);

  await page.locator('#qrGcash [data-payment-qr]').click();
  await expect(page.locator('#qrGcash img')).toHaveAttribute('src','assets/img/payment/gcash-qr.jpg');
  await page.locator('#qrBdo [data-payment-qr]').click();
  await expect(page.locator('#qrBdo img')).toHaveAttribute('src','assets/img/payment/bdo-qr.jpg');
  expect(paymentQrRequests.some(url=>url.endsWith('/assets/img/payment/gcash-qr.jpg'))).toBeTruthy();
  expect(paymentQrRequests.some(url=>url.endsWith('/assets/img/payment/bdo-qr.jpg'))).toBeTruthy();
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

test('customer live runtime initializes ordering, tracker, reservations, and reviews',async({page})=>{
  await installCustomerFirebaseFixture(page);
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('meta[name="accaza-customer-build"]')).toHaveAttribute('content',String(release.builds.customer));
  await expect(page.locator('#orderServiceHeadline')).toHaveText('OPEN FOR ONLINE ORDERS',{timeout:20000});
  await expect(page.locator('#menuGrid .menu-card').first()).toBeVisible({timeout:20000});
  await page.locator('#orderTabsRow .otab').first().click();
  const firstOrderItem=page.locator('#orderItemList .item-row').first();
  await expect(firstOrderItem).toBeVisible({timeout:20000});
  await firstOrderItem.locator('.qty-btn').click();
  await expect(page.locator('#customizePopup')).toHaveClass(/show/);
  await page.locator('#customizePopup .cust-option[data-action="size"]').first().click();
  await page.locator('#btnAddToCart').click();
  await expect(page.locator('#cartItems')).toContainText('Cafe Latte');
  await expect(page.locator('.btn-place-order')).toBeEnabled();
  await expect(page.locator('#activeOrdersList')).toContainText('ORDER-TEST');
  await expect(page.locator('#activeOrdersList')).toContainText('Ready');
  await expect(page.locator('#activeOrdersList .confirm-recv-btn')).toBeVisible();
  await expect(page.locator('#calGrid .cal-day')).not.toHaveCount(0,{timeout:20000});
  await expect(page.locator('.review-card').first()).toBeVisible({timeout:20000});
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','/manifest.json');
  await expect(page.locator('script[src="assets/js/pwa-register.js"]')).toHaveCount(1);
  await expect.poll(async()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/'))),{timeout:10000}).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('admin shell carries the coordinated release marker',async({page})=>{
  await page.goto('/admin.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('meta[name="accaza-admin-build"]')).toHaveAttribute('content',/^[0-9]+$/);
  await expect(page.locator('body')).toContainText(/Accaza Coffee/i);
});

test('Finance Books starts from the assembled runtime without browser errors',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/books.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('meta[name="accaza-books-build"]')).toHaveAttribute('content',String(release.builds.books));
  await expect(page.locator('#tabs').locator('button')).not.toHaveCount(0);
  await expect(page.locator('#page')).not.toBeEmpty();
  // CI intentionally has no Firebase credentials or dependable network. End the
  // connection placeholder explicitly before testing the signed-out report state.
  await page.evaluate(()=>{window.__booksLiveLoading=false;});
  await page.getByRole('button',{name:'Key Metrics'}).click();
  await expect(page.locator('#page')).toContainText('Key Financial Metrics');
  await expect(page.locator('#page')).toContainText('Sign in for verified metrics');
  await page.evaluate(()=>{window.__booksUser='quality-gate';window.__posEntries=[];window.__booksActiveOrders={};window.__booksArchivedOrders={};window.App.go('insights');});
  await expect(page.locator('.bi-hero')).toBeVisible();
  await expect(page.locator('#page')).toContainText('Prioritized management actions');
  await expect(page.locator('#page')).toContainText('performs no writes');
  expect(pageErrors).toEqual([]);
});
