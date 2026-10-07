import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Oct 2026: the hero, latte and gallery photos used to come from postimg.cc as 1280px PNGs
// (19.7 MB for the 13 photos, 1.1-2.7 MB each). They are now same-origin WebP files under
// assets/img/gallery. This check keeps them small, keeps every page pointing at them, and
// keeps the lightbox order matched to the gallery cards.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir='assets/img/gallery';
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function fail(message){throw new Error(message);}

const FULL_MAX_BYTES=260_000,THUMB_MAX_BYTES=80_000,FULL_TOTAL_MAX_BYTES=1_400_000,MAX_WIDTH=1280,THUMB_WIDTH=640;
const gallery=Array.from({length:11},(_,i)=>`gallery-${String(i+1).padStart(2,'0')}`);
// gallery-01 is the tall card (cover-cropped to two rows), so it always uses the full file;
// gallery-02 is only 600px wide to begin with.
const withThumb=new Set([...gallery.filter(name=>name!=='gallery-01'&&name!=='gallery-02'),'hero-wallpaper']);
const expected=[...gallery,'hero-wallpaper','latte-art'].flatMap(name=>withThumb.has(name)?[`${name}.webp`,`${name}-640.webp`]:[`${name}.webp`]);

function webpWidth(buffer,file){
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')fail(`${file} is not a WebP file`);
  const chunk=buffer.toString('ascii',12,16);
  if(chunk==='VP8X')return 1+buffer.readUIntLE(24,3);
  if(chunk==='VP8 ')return buffer.readUInt16LE(26)&0x3fff;
  if(chunk==='VP8L')return 1+((buffer[21]|(buffer[22]<<8))&0x3fff);
  fail(`${file} has an unknown WebP chunk ${chunk}`);
}

const onDisk=fs.readdirSync(path.join(root,dir)).sort();
if(JSON.stringify(onDisk)!==JSON.stringify([...expected].sort()))fail(`${dir} must hold exactly the expected photos.\n  expected ${[...expected].sort().join(', ')}\n  found    ${onDisk.join(', ')}`);
let fullTotal=0;
for(const file of onDisk){
  const buffer=fs.readFileSync(path.join(root,dir,file)),thumb=file.endsWith('-640.webp'),width=webpWidth(buffer,file);
  if(width>(thumb?THUMB_WIDTH:MAX_WIDTH))fail(`${file} is ${width}px wide; the limit is ${thumb?THUMB_WIDTH:MAX_WIDTH}px`);
  if(buffer.length>(thumb?THUMB_MAX_BYTES:FULL_MAX_BYTES))fail(`${file} is ${buffer.length} bytes; the limit is ${thumb?THUMB_MAX_BYTES:FULL_MAX_BYTES}`);
  if(!thumb)fullTotal+=buffer.length;
}
if(fullTotal>FULL_TOTAL_MAX_BYTES)fail(`Full-size site photos total ${fullTotal} bytes; the limit is ${FULL_TOTAL_MAX_BYTES}`);

const lightboxSources={customer:'src/customer/core/16-startup-ui.mjs',admin:'assets/js/admin/core.mjs'};
const referenced=new Set();
for(const side of ['customer','admin']){
  const story=read(`src/html/${side}/10-home-story.html`),footer=read(`src/html/${side}/30-engagement-footer.html`),core=read(lightboxSources[side]);
  for(const [file,text] of [[`src/html/${side}/10-home-story.html`,story],[`src/html/${side}/30-engagement-footer.html`,footer]])
    if(/<img[^>]+i\.postimg\.cc/.test(text))fail(`${file} still loads a site photo from postimg.cc`);
  const heroTag=(story.match(/<div class="hero-bg"><img[^>]*>/)||[])[0]||'';
  if(!heroTag.includes(`src="${dir}/hero-wallpaper.webp"`)||!heroTag.includes(`${dir}/hero-wallpaper-640.webp 640w`))fail(`${side} hero must use the local hero-wallpaper WebP with its 640px option`);
  if(side==='customer'&&(!heroTag.includes('fetchpriority="high"')||heroTag.includes('loading="lazy"')))fail('Customer hero must stay high priority and eager (it is the largest paint)');
  if(side==='admin'&&!heroTag.includes('loading="lazy"'))fail('Admin hero must stay lazy so the hidden customer section never downloads on POS start-up');
  if(!story.includes(`src="${dir}/latte-art.webp"`))fail(`${side} story section must use the local latte photo`);
  const lightbox=JSON.parse((core.match(/var GALLERY = (\[[^\]]*\])/)||[])[1]||'null');
  const expectedLightbox=gallery.map(name=>`${dir}/${name}.webp`);
  if(JSON.stringify(lightbox)!==JSON.stringify(expectedLightbox))fail(`${lightboxSources[side]} lightbox list must be the 11 local gallery photos in card order`);
  const cards=[...footer.matchAll(/onclick="openLightbox\((\d+)\)" class="gallery-card[^"]*"><img ([^>]*)>/g)];
  if(cards.length!==gallery.length)fail(`${side} gallery must have ${gallery.length} cards, found ${cards.length}`);
  for(const [,index,attrs] of cards){
    const name=gallery[Number(index)];
    if(!new RegExp(`src="${dir}/${name}(-640)?\\.webp"`).test(attrs))fail(`${side} gallery card ${index} must show ${name}, matching the lightbox`);
    if(!attrs.includes('loading="lazy"')||!attrs.includes('decoding="async"'))fail(`${side} gallery card ${index} must be lazy and async`);
    if(withThumb.has(name)&&!attrs.includes(`${dir}/${name}-640.webp 640w, ${dir}/${name}.webp 1280w`))fail(`${side} gallery card ${index} must offer the 640px and 1280px files`);
  }
  for(const text of [story,footer,core])for(const match of text.matchAll(/assets\/img\/gallery\/([\w-]+\.webp)/g))referenced.add(match[1]);
}
for(const file of referenced)if(!onDisk.includes(file))fail(`Referenced photo is missing: ${dir}/${file}`);
for(const file of onDisk)if(!referenced.has(file))fail(`Unused photo would be published: ${dir}/${file}`);
if(read('sw.js').includes('assets/img/gallery'))fail('Site photos must not be precached by the service worker');

console.log(`gallery photo check passed: ${onDisk.length} files, full-size total ${fullTotal} bytes`);
