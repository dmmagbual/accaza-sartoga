import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'books.html'),'utf8');
const start=source.indexOf('function postedAccountNet(code, entries)');
const end=source.indexOf('/* signed balance',start);
if(start<0||end<0)throw new Error('Production postedAccountNet helper was not found.');
const helperSource=source.slice(start,end);
const r2=(n)=>Math.round((Number(n)||0)*100)/100;
const postedAccountNet=new Function('r2',`${helperSource}; return postedAccountNet;`)(r2);

const entries=[
  {id:'payable',lines:[{code:'6100',debit:9000,credit:0}]},
  {id:'purchase',lines:[{code:'6100',debit:2707,credit:0}]},
  {id:'payout',reversed:true,lines:[{code:'6100',debit:582.10,credit:0}]},
  {id:'payout_reversal',reversalOf:'payout',lines:[{code:'6100',debit:0,credit:582.10}]},
  {id:'other_variance',lines:[{code:'6100',debit:129.75,credit:0}]}
];

const ledgerClosing=entries.reduce((sum,e)=>sum+e.lines.reduce((n,l)=>n+(l.code==='6100'?Number(l.debit||0)-Number(l.credit||0):0),0),0);
const statementClosing=postedAccountNet('6100',entries);
if(statementClosing!==r2(ledgerClosing))throw new Error(`P&L ${statementClosing} does not reconcile to General Ledger ${ledgerClosing}.`);
if(statementClosing!==11836.75)throw new Error(`Reversing entry was not included correctly; got ${statementClosing}.`);

console.log('PASS: Finance statements include original and reversing journal lines and reconcile to the General Ledger.');
