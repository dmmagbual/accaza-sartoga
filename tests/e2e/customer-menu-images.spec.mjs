import {test,expect} from '@playwright/test';
import {installCustomerFirebaseFixture} from './customer-firebase-fixture.mjs';

// Menu photos (Sep 2026): the customer menu escapes each stored photo link before it enters the
// page, so a link can never break out of its <img> tag, while every legitimate link still loads
// the same address. Menu photos load lazily; the hero photo is fetched first. Photo hosts are blocked
// here, so the built-in onerror handler adds a style attribute; that attribute is ignored below.
const PHOTO='https://photos.example.test/latte.jpg?w=400&h=300';
const HOSTILE='https://photos.example.test/x.jpg" onerror="window.__menuImagePwned=1';

test.beforeEach(async({page})=>{await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173|www\.gstatic\.com)/,route=>route.abort());});

test('menu photos keep their exact address, load lazily, and cannot inject markup',async({page})=>{
  await installCustomerFirebaseFixture(page,{
    menuItems:{
      latte:{cat:'coffee',name:'Cafe Latte',desc:'Smooth espresso and milk.',priceS:175,priceM:185,priceL:195,optionsSet:true,img:PHOTO},
      mocha:{cat:'coffee',name:'Cafe Mocha',desc:'Chocolate and espresso.',priceS:185,priceM:195,priceL:205,optionsSet:true,img:HOSTILE}
    },
    availability:{'Cafe Latte':true,'Cafe Mocha':true}
  });
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#menuGrid .menu-card-img')).toHaveCount(2,{timeout:20000});
  const menuImages=await page.locator('#menuGrid .menu-card-img').evaluateAll(images=>images.map(img=>({src:img.getAttribute('src'),loading:img.getAttribute('loading'),decoding:img.getAttribute('decoding'),attributes:img.getAttributeNames()})));
  expect(menuImages.map(image=>image.src).sort()).toEqual([HOSTILE,PHOTO].sort());
  for(const image of menuImages){
    expect(image.loading).toBe('lazy');
    expect(image.decoding).toBe('async');
    expect(image.attributes.filter(name=>name!=='style').sort()).toEqual(['alt','class','decoding','loading','onerror','src']);
  }
  await page.locator('#orderTabsRow .otab').first().click();
  await expect(page.locator('#orderItemList .item-row-img')).toHaveCount(2,{timeout:20000});
  const rowImages=await page.locator('#orderItemList .item-row-img').evaluateAll(images=>images.map(img=>({src:img.getAttribute('src'),loading:img.getAttribute('loading'),attributes:img.getAttributeNames()})));
  expect(rowImages.map(image=>image.src).sort()).toEqual([HOSTILE,PHOTO].sort());
  for(const image of rowImages){expect(image.loading).toBe('lazy');expect(image.attributes.filter(name=>name!=='style').sort()).toEqual(['alt','class','decoding','loading','onerror','src']);}
  await page.locator('#orderItemList .item-row').filter({hasText:'Cafe Mocha'}).locator('.qty-btn').click();
  await expect(page.locator('#customizePopup')).toHaveClass(/show/);
  const popupImage=page.locator('#customizePopup img').first();
  await expect(popupImage).toHaveAttribute('src',HOSTILE);
  expect((await popupImage.evaluate(img=>img.getAttributeNames())).filter(name=>name!=='style').sort()).toEqual(['alt','onerror','src']);
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.__menuImagePwned)).toBeUndefined();
  expect(pageErrors).toEqual([]);
});

test('the hero photo is requested first and fonts and photos connect early',async({page})=>{
  await installCustomerFirebaseFixture(page);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.hero-bg img')).toHaveAttribute('fetchpriority','high');
  await expect(page.locator('.hero-bg img')).not.toHaveAttribute('loading','lazy');
  for(const origin of ['https://i.postimg.cc','https://fonts.googleapis.com','https://fonts.gstatic.com'])await expect(page.locator(`link[rel="preconnect"][href="${origin}"]`)).toHaveCount(1);
  await expect(page.locator('link[rel="preconnect"][href="https://fonts.gstatic.com"]')).toHaveAttribute('crossorigin','');
  await expect(page.locator('link[rel="preconnect"][href="https://i.postimg.cc"]')).not.toHaveAttribute('crossorigin',/.*/);
});

test('site photos load from the site itself as small WebP files and the lightbox follows the cards',async({page})=>{
  await installCustomerFirebaseFixture(page);
  const remote=[],local=[];
  page.on('request',request=>{const url=request.url();if(/postimg\.cc\/(g2vgBmhF|8zM97Trf|g0qrJsnX|TwtsR8Gd|5yPsM8BH|wMbQrgz3|BvGckmr5|sXJJz5YV|B6mT84jW|yxJZk9qq|CxpqxzcB|Pq2pyKTr|sxZMVrSZ)\//.test(url))remote.push(url);});
  page.on('response',async response=>{if(/\/assets\/img\/gallery\//.test(response.url()))local.push({url:response.url(),status:response.status(),bytes:(await response.body()).length});});
  await page.goto('/',{waitUntil:'load'});
  await expect.poll(()=>page.locator('.hero-bg img').evaluate(img=>img.complete&&img.naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator('.hero-bg img').evaluate(img=>img.currentSrc)).toMatch(/\/assets\/img\/gallery\/hero-wallpaper(-640)?\.webp$/);
  await page.locator('.gallery-grid').scrollIntoViewIfNeeded();
  const cards=page.locator('.gallery-card img');
  await expect(cards).toHaveCount(11);
  for(let i=0;i<11;i++){await cards.nth(i).scrollIntoViewIfNeeded();await expect.poll(()=>cards.nth(i).evaluate(img=>img.complete&&img.naturalWidth)).toBeGreaterThan(0);}
  await page.locator('.gallery-card').nth(4).click();
  await expect(page.locator('#lightbox-img')).toHaveAttribute('src','assets/img/gallery/gallery-05.webp');
  await expect.poll(()=>page.locator('#lightbox-img').evaluate(img=>img.complete&&img.naturalWidth)).toBeGreaterThan(0);
  expect(remote).toEqual([]);
  expect(local.length).toBeGreaterThan(0);
  for(const photo of local){expect(photo.status).toBe(200);expect(photo.bytes).toBeLessThan(260_000);}
});
