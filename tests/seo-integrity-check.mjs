import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const fail=message=>{throw new Error(message);};
const decode=value=>value
  .replace(/&amp;/g,'&')
  .replace(/&mdash;|&#8212;/g,'—')
  .replace(/&ntilde;/g,'ñ')
  .replace(/&#39;/g,"'");

const publicPages=new Map([
  ['index.html','https://accazacoffee.com/'],
  ['about.html','https://accazacoffee.com/about.html'],
  ['contact.html','https://accazacoffee.com/contact.html'],
  ['reservations.html','https://accazacoffee.com/reservations.html'],
  ['rewards.html','https://accazacoffee.com/rewards.html']
]);

const seenTitles=new Set();
for(const [file,canonical] of publicPages){
  const html=read(file);
  const title=decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim()||'');
  const description=decode(html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim()||'');
  const robots=html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1]?.toLowerCase()||'';
  const canonicalHref=html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1]||'';
  const h1Count=(html.match(/<h1\b/gi)||[]).length;

  if(title.length<35||title.length>65)fail(`${file} title length must remain between 35 and 65 characters; found ${title.length}`);
  if(seenTitles.has(title))fail(`${file} duplicates another public page title`);
  seenTitles.add(title);
  if(description.length<100||description.length>200)fail(`${file} meta description must remain useful and concise; found ${description.length} characters`);
  if(!robots.includes('index')||robots.includes('noindex'))fail(`${file} must remain indexable`);
  if(canonicalHref!==canonical)fail(`${file} canonical must be ${canonical}`);
  if(h1Count!==1)fail(`${file} must contain exactly one H1; found ${h1Count}`);
}

const index=read('index.html');
if(!/<title>[^<]*Coffee Shop in Dasmariñas/i.test(index))fail('Homepage title must target Coffee Shop in Dasmariñas');
if(!/<h1>\s*Coffee Shop in<br\/>\s*<span>Dasmariñas, Cavite<\/span>\s*<\/h1>/i.test(index))fail('Homepage H1 must preserve the primary local-search phrase');
if((index.match(/<\/head>/gi)||[]).length!==1)fail('Homepage must contain exactly one closing head tag');
if(index.indexOf('assets/css/customer/site.css')>index.indexOf('</head>'))fail('Customer site stylesheet must remain inside the document head');

for(const file of ['admin.html','books.html','menu.html']){
  const robots=read(file).match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1]?.toLowerCase()||'';
  if(!robots.includes('noindex'))fail(`${file} must not compete with public pages in search results`);
}

const expectedUrls=new Set(publicPages.values());
const sitemap=read('sitemap.xml');
const sitemapUrls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
if(sitemapUrls.length!==expectedUrls.size)fail('Sitemap must contain every public page exactly once');
for(const url of sitemapUrls){
  if(!expectedUrls.has(url))fail(`Sitemap contains a non-canonical or non-indexable URL: ${url}`);
  expectedUrls.delete(url);
}
if(expectedUrls.size)fail(`Sitemap is missing: ${[...expectedUrls].join(', ')}`);
for(const lastmod of sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(lastmod[1]))fail(`Invalid sitemap lastmod: ${lastmod[1]}`);
}

const robotsTxt=read('robots.txt');
if(!/^User-agent:\s*\*/mi.test(robotsTxt)||!/^Allow:\s*\/$/mi.test(robotsTxt))fail('robots.txt must allow public crawling');
if(!/^Sitemap:\s*https:\/\/accazacoffee\.com\/sitemap\.xml$/mi.test(robotsTxt))fail('robots.txt must advertise the canonical sitemap');

for(const file of ['index.html','contact.html']){
  const html=read(file);
  const json=html.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i)?.[1];
  if(!json)fail(`${file} is missing local-business structured data`);
  const schema=JSON.parse(json);
  if(schema['@type']!=='CafeOrCoffeeShop')fail(`${file} must use the most specific business type`);
  if(schema.acceptsReservations!==true)fail(`${file} acceptsReservations must be a JSON boolean`);
  if(schema.hasMenu!=='https://accazacoffee.com/#menu')fail(`${file} must link structured data to the live menu`);
  const actionTypes=new Set((schema.potentialAction||[]).map(action=>action['@type']));
  if(!actionTypes.has('OrderAction')||!actionTypes.has('ReserveAction'))fail(`${file} must expose order and reservation actions`);
}

console.log('SEO integrity check passed');
