import fs from 'node:fs';

const shell=fs.readFileSync('src/books/app/10-application-shell.js','utf8');
const html=fs.readFileSync('books.html','utf8');
const css=fs.readFileSync('assets/css/books.css','utf8');

const expected={
  overview:['dashboard','insights'],
  entries:['transactions','journal'],
  ledgers:['ledger','receivables','payables'],
  statements:['pl','bs','cashflow','tb'],
  controls:['close','coa','settings','data']
};

for(const [group,ids] of Object.entries(expected)){
  if(!shell.includes(`{id:"${group}",label:`))throw new Error(`Missing Finance work area: ${group}`);
  for(const id of ids){
    const matches=shell.match(new RegExp(`\\{id:"${id}"[^\\n]+group:"${group}"`,'g'))||[];
    if(matches.length!==1)throw new Error(`Finance destination ${id} must appear exactly once in ${group}`);
  }
}

const allIds=Object.values(expected).flat();
if(new Set(allIds).size!==15)throw new Error('Finance navigation must retain all 15 destinations');
if(!html.includes('id="bookGroups"')||!html.includes('id="tabs"'))throw new Error('Two-level Finance navigation containers are missing');
if(!shell.includes("selected&&selected.settingsSection?PAGES.settings():PAGES[CURRENT]()"))throw new Error('Finance control screens are not routed through their existing pages');
if(!css.includes('.tabs-in{flex-wrap:wrap')||!css.includes('.book-groups{display:grid'))throw new Error('Finance navigation is not protected against hidden mobile tabs');

console.log('Finance Books navigation check passed.');
