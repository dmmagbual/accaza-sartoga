/* Purchase item search — regression guard (admin 704).
   The existing-item picker on a purchase line is a type-to-search box over the active
   inventory list, like the Supplier field. The typed text is only a label: the line must
   carry the stable inventory id, and text that no longer names exactly one item must clear
   that id so a purchase can never post against an item the screen no longer shows. */
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const must = (source, marker, message) => { if (!source.includes(marker)) failures.push(message); };
for (const file of ['assets/js/admin/pos.js', 'src/admin/pos/20-purchasing.js']) {
  const s = read(file);
  must(s, `<input class="pz-in" data-pitem="'+i+'" list="purItemOpts" autocomplete="off"`,
    `${file}: the existing-item picker must be a searchable input bound to the purItemOpts list.`);
  must(s, `<div class="purchase-lines">'+lineHtml+'</div>'+itemDatalist+'</div>'`,
    `${file}: one shared item datalist must render with the purchase lines.`);
  must(s, `function itemLabel(i){var b=itemBaseLabel(i);return itemDup[b.toLowerCase()]>1?b+' · #'+String(i.id).slice(-4):b;}`,
    `${file}: item labels must stay unique so a label resolves to exactly one inventory id.`);
  must(s, `return String(x.name||'').trim().toLowerCase()===q;});if(!hit.length)hit=invList.filter(function(x){return String(x.name||'').toLowerCase().indexOf(q)>=0;});if(hit.length>1)hit=[];`,
    `${file}: an exact item name wins; a partial name matching more than one item must not pick one.`);
  must(s, `var id=row?row.id:'';if(id!==ln.ing){ln.ing=id;ln.recvUnit=row?(row.unit||''):'';ln.skuId='';renderPurchases();}`,
    `${file}: committing text with no single match must clear the line's item, unit and brand.`);
  if (s.includes(`data-pf="ing" data-pi="'+i+'">'+itemOpts(`)) failures.push(`${file}: the old item <select> must not return.`);
}
if (failures.length) { console.error(failures.map((f) => `✗ ${f}`).join('\n')); process.exit(1); }
console.log('✓ Purchase item search binds to stable inventory ids and clears on no match');
