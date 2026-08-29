import fs from 'node:fs';

const file='index.html';
let html=fs.readFileSync(file,'utf8');
const start='<!-- AVAILABILITY (Admin Only) -->';
const end='<!-- CUSTOMIZE POPUP -->';
const a=html.indexOf(start),b=html.indexOf(end);
if(a<0||b<0||b<=a)throw new Error('Retired admin DOM boundaries were not found.');
html=html.slice(0,a)+'<!-- Release 2D: retired embedded admin portal removed; use admin.html. -->\n\n'+html.slice(b);
fs.writeFileSync(file,html,'utf8');
console.log('Removed retired admin DOM from index.html.');
