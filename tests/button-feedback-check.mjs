import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const recipe=read('src/admin/pos/30-recipes.js');
const adminCss=read('assets/css/admin/site.css');
const booksCss=read('assets/css/books.css');

for(const marker of ["button.textContent='Saving recipe…'","button.setAttribute('aria-busy','true')","return a.validateRecipeDefinition(raw)","button.removeAttribute('aria-busy')","button.textContent='Saving choices…'","Shared choice ingredients saved","window.__posSettings.optionCosts=clean"]){
  if(!recipe.includes(marker))throw new Error(`Recipe save feedback missing: ${marker}`);
}
for(const [name,css] of [['Admin',adminCss],['Finance Books',booksCss]]){
  for(const marker of ['button:not(:disabled):active','button[aria-busy="true"]','button:disabled']){
    if(!css.includes(marker))throw new Error(`${name} button feedback missing: ${marker}`);
  }
}
console.log('Admin and Finance button feedback checks passed.');
