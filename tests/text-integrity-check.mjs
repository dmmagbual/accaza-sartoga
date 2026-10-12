import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=process.cwd();
const listed=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});
assert.equal(listed.status,0,'Text-integrity check requires a Git checkout');

const publishedText=/\.(?:html|css|js|mjs)$/i;
// UTF-8 bytes misread as Windows-1252 commonly begin with these lead characters.
// Requiring a second non-ASCII character avoids flagging ordinary words that use accents.
const mojibake=/(?:\u00c2|\u00c3|\u00e2|\u00ef|\u00f0)[^\x00-\x7f]/u;
for(const file of listed.stdout.split('\0').filter(Boolean).filter(file=>publishedText.test(file))){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  // A file that deliberately matches mojibake (a detector or a regression fixture) opts out by name.
  if(source.includes('mojibake-check: allow'))continue;
  const match=mojibake.exec(source);
  assert.ok(!source.includes('\ufffd'),`${file} contains an invalid UTF-8 replacement character`);
  if(match){
    const line=source.slice(0,match.index).split(/\r?\n/).length;
    assert.fail(`${file}:${line} contains likely UTF-8/Windows-1252 mojibake`);
  }
}

// The Archive Orders panel was split out of core.mjs (Oct 2026), so its labels are checked where they now live.
const panel=fs.readFileSync(path.join(root,'assets/js/admin/order-archive-panel.mjs'),'utf8');
for(const marker of [
  "'+escHtml(o.date)+' · '+escHtml(o.time)",
  "🛒 '+escHtml(o.items)",
  '">₱\'+(Number(o.total)||0).toLocaleString()+\' · \'',
  "o.archivedDate||'—'",
  "Loading older orders…"
])assert.ok(panel.includes(marker),`Archive Orders UTF-8 marker missing: ${marker}`);

console.log('PASS: published text contains valid display characters and Archive Orders retains its UTF-8 labels.');
