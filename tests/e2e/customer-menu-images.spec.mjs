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
