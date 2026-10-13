/* A page held open across a deploy can mix versions: the loader in memory predates a module the
   release moved, while the network serves the new files. Cash & Controls -> Reconciliation Issues
   broke exactly that way on 13 Oct 2026 after the register split, and a cashier saw "This section
   could not load." The loader now reloads once, per build, to pick up a consistent set of files --
   and the session flag is what stops that becoming a reload loop. */
import fs from 'node:fs';
import path from 'node:path';
const loader = fs.readFileSync(path.join(import.meta.dirname, '..', 'assets', 'js', 'admin', 'module-loader.js'), 'utf8');
const failures = [];
const failed = loader.slice(loader.indexOf('function failed(tab,error)'), loader.indexOf('function failed(tab,error)') + 1400);
if (!failed) failures.push('the module loader has no failure path.');
else {
  if (!failed.includes('window.location.reload()')) failures.push('a mixed-version failure must reload the page once instead of showing an error to a cashier.');
  if (!/accaza:moduleReload:/.test(failed)) failures.push('the reload must be guarded per build, or a persistent failure becomes a reload loop.');
  if (!failed.includes('window.sessionStorage.setItem(guard')) failures.push('the guard must be recorded BEFORE reloading, otherwise the next load repeats it.');
  if (failed.indexOf('setItem(guard') > failed.indexOf('reload()')) failures.push('the guard must be set before the reload call.');
  if (!failed.includes('try{') || !failed.includes('catch')) failures.push('the reload path must be wrapped, so a storage failure cannot break the error message.');
  if (!failed.includes('This section could not load')) failures.push('the plain failure message must survive as the fallback.');
}
if (failures.length) { console.error('Module loader self-heal check failed:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('PASS: a mixed-version module failure reloads the page once per build, records the guard first so it cannot loop, and still falls back to the message.');
