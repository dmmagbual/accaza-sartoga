import fs from 'node:fs';
import {createContext} from './static/00-context.mjs';
import {run as syntax} from './static/10-syntax-rendering.mjs';
import {run as access} from './static/20-access-customer.mjs';
import {run as release} from './static/30-server-release.mjs';
import {run as operations} from './static/40-operations-ui.mjs';
import {run as regressions} from './static/50-executable-regressions.mjs';
import {run as finance} from './static/60-finance-books.mjs';
import {run as summary} from './static/70-xss-reconciliation-summary.mjs';

const domains=[
  {name:'syntax',run:syntax,requires:[]},
  {name:'access',run:access,requires:[]},
  {name:'release',run:release,requires:['access']},
  {name:'operations',run:operations,requires:['release']},
  {name:'regressions',run:regressions,requires:[]},
  {name:'finance',run:finance,requires:['operations']},
  {name:'summary',run:summary,requires:['release','regressions']}
];
const requested=process.argv[2]||'all';
if(requested!=='all'&&!domains.some(domain=>domain.name===requested))throw new Error(`Unknown static-check domain: ${requested}`);
const selected=new Set();
function include(name){
  const domain=domains.find(item=>item.name===name);
  for(const dependency of domain.requires)include(dependency);
  selected.add(name);
}
if(requested==='all')for(const domain of domains)selected.add(domain.name);else include(requested);

const context=createContext();
try{
  for(const domain of domains)if(selected.has(domain.name))domain.run(context);
  if(requested!=='all')console.log(`PASS: static-check domain ${requested} and its prerequisites completed.`);
}finally{
  fs.rmSync(context.temp,{recursive:true,force:true});
}
