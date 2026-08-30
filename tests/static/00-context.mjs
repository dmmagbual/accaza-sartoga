import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

export function createContext(){
  const root=process.cwd();
  const require=createRequire(import.meta.url);
  const htmlFiles=['admin.html','index.html'];
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'accaza-static-check-'));
  const state={checked:0};
  function fail(message){throw new Error(message);}
  function section(source,start,end){
    const a=source.indexOf(start);
    if(a<0)fail(`Missing section: ${start}`);
    const b=source.indexOf(end,a+start.length);
    if(b<0)fail(`Missing section end: ${end}`);
    return source.slice(a,b);
  }
  function localScripts(folder){
    const dir=path.join(root,folder);
    return fs.readdirSync(dir).filter(name=>/\.(?:js|mjs)$/i.test(name)).sort().map(name=>({name,source:fs.readFileSync(path.join(dir,name),'utf8'),target:path.join(dir,name)}));
  }
  function localStyles(folder){
    const dir=path.join(root,folder);
    return fs.readdirSync(dir).filter(name=>/\.css$/i.test(name)).sort().map(name=>({name,source:fs.readFileSync(path.join(dir,name),'utf8'),target:path.join(dir,name)}));
  }
  const adminScripts=localScripts(path.join('assets','js','admin'));
  const customerScripts=localScripts(path.join('assets','js','customer'));
  const booksScripts=localScripts(path.join('assets','js','books'));
  const adminStyles=localStyles(path.join('assets','css','admin'));
  const customerStyles=localStyles(path.join('assets','css','customer'));
  const adminHtml=fs.readFileSync(path.join(root,'admin.html'),'utf8');
  const customerHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const booksPageHtml=fs.readFileSync(path.join(root,'books.html'),'utf8');
  const adminSource=adminHtml+'\n'+adminScripts.map(item=>item.source).join('\n')+'\n'+adminStyles.map(item=>item.source).join('\n');
  const customerSource=customerHtml+'\n'+customerScripts.map(item=>item.source).join('\n')+'\n'+customerStyles.map(item=>item.source).join('\n');
  const booksSource=booksPageHtml+'\n'+booksScripts.map(item=>item.source).join('\n')+'\n'+fs.readFileSync(path.join(root,'assets','css','books.css'),'utf8');
  const financialSource=fs.readFileSync(path.join(root,'functions','lib','financial.js'),'utf8');
  return {fs,path,vm,spawnSync,root,require,htmlFiles,temp,state,fail,section,adminScripts,customerScripts,booksScripts,adminStyles,customerStyles,adminHtml,customerHtml,booksPageHtml,adminSource,customerSource,booksSource,financialSource};
}
