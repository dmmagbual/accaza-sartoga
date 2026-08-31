import fs from 'node:fs';

const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../assets/js/admin/core.mjs',import.meta.url),'utf8');
const navigationCss=fs.readFileSync(new URL('../assets/css/admin/navigation.css',import.meta.url),'utf8');
const moduleLoader=fs.readFileSync(new URL('../assets/js/admin/module-loader.js',import.meta.url),'utf8');
function assert(ok,message){if(!ok)throw new Error(message);}

const navigation=(html.match(/<div class="admin-tabs"[\s\S]*?<div id="adminWorkspaceHeader"/)||[])[0]||'';
const groups=[...navigation.matchAll(/class="admin-group[^\"]*" data-grp="([^"]+)"/g)].map((match)=>match[1]);
assert(groups.join('|')==='pos|overview|orders|reports|stock|finance|customers|settings','Admin work areas are missing or out of order');

const expected={
  pos:['pos','ops','inbox'],
  overview:['dashboard','operations'],
  orders:['orders','reservations','calendar','availSection'],
  reports:['saleshistory','analytics','dailyreport'],
  stock:['inventory','stockvalue','purchases','recipes','usage','packages'],
  finance:['petty','undeposited','payouts','discrepancy'],
  customers:['appcustomers','reviews','commentsSection'],
  settings:['possettings','accountingperiods','channelpricing','dedupe','payment','staffaccounts','staffaccess','adminaccounts','changepw']
};
for(const [group,tabs] of Object.entries(expected)){
  const row=(navigation.match(new RegExp(`<div class="tabgrp" data-grp="${group}"[\\s\\S]*?</div>`))||[])[0]||'';
  const actual=[...row.matchAll(/onclick="(?:posSwitchTab|switchTab|showAdminSection)\('([^']+)'/g)].map((match)=>match[1]);
  assert(actual.join('|')===tabs.join('|'),`${group} tabs are incomplete or out of order: ${actual.join(', ')}`);
}

const allTabs=Object.values(expected).flat();
assert(allTabs.length===34&&new Set(allTabs).size===34,'Every Admin destination must appear exactly once');
for(const tab of allTabs.filter((name)=>!['availSection','commentsSection'].includes(name)))assert(html.includes(`id="tab-${tab}"`),`Admin panel is missing for ${tab}`);
assert(core.includes("\"'availSection'\":'availability'")&&core.includes("\"'commentsSection'\":'comments'"),'Moved Availability and Comments must retain staff permission checks');
assert(core.includes("panel.classList.add('admin-tab-content','admin-integrated-panel')"),'Availability and Comments must remain real Admin workspace panels');
assert(navigationCss.includes('#adminGroups{display:flex;flex-wrap:wrap')&&navigationCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))'),'Every Admin work area must remain visible without horizontal scrolling');
const lazyTabs=[...navigation.matchAll(/posSwitchTab\('([^']+)'/g)].map((match)=>match[1]);
for(const tab of new Set(lazyTabs))assert(new RegExp(`(?:^|[,\\s])${tab}:\\[`).test(moduleLoader),`Lazy Admin destination ${tab} has no module route`);

console.log('PASS: all 34 Admin destinations are present once, grouped correctly, and retain their panels and permissions.');
