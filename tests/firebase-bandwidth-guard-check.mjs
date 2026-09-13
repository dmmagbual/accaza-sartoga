import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const portal=read('src/functions/20-portal-auth.js');
const bridge=read('src/functions/10-books-bridge.js');
const books=read('assets/js/books/live-pos.mjs');
const hub=read('assets/js/admin/realtime-hub.mjs');
const orders=read('src/functions/30-orders.js');

if(portal.includes('db.ref("/books/journal").get()')&&!portal.includes('if (!booksMonthlyNetMetaSnap.exists())'))throw new Error('Recurring health scan downloads the full journal without a one-time migration guard.');
for(const marker of ['/books/monthlyNet','/books/monthlyNetMeta'])if(!bridge.includes(marker))throw new Error(`Monthly journal summary missing: ${marker}`);
for(const marker of ['startAt(monthStart)','openingCarry(month)','else stopOptionalFeed(name)'])if(!books.includes(marker))throw new Error(`Books bandwidth guard missing: ${marker}`);
for(const marker of ['VERSIONED_MASTER_PATHS','publicCatalogVersion','MASTER_CACHE_KEY'])if(!hub.includes(marker))throw new Error(`Admin master-data cache guard missing: ${marker}`);
for(const heavy of ['orderInventoryPlan','inventoryUsage','cogsDetail','cogsCategorySnapshot','cogsAccountSnapshot'])if(!orders.includes(`"${heavy}"`))throw new Error(`Active-order projection does not strip ${heavy}.`);
if(/var critical=\{[^}]*categories:1/.test(hub)||/var critical=\{[^}]*menuItems:1/.test(hub))throw new Error('Catalog master data is still globally critical.');

console.log('Firebase bandwidth regression safeguards passed.');
