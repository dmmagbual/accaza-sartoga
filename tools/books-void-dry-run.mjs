import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const Books=require('../functions/lib/books-bridge.js');
const input=process.argv[2];
if(!input)throw new Error('Pass the directory containing orders.json, archivedOrders.json, and financialMovements.json.');
const read=name=>JSON.parse(fs.readFileSync(path.join(input,name),'utf8'))||{};
const orders=Object.assign({},read('archivedOrders.json'),read('orders.json'));
const movements=read('financialMovements.json');
const money=n=>Math.round((Number(n)||0)*100)/100;
const recognized={};
for(const [id,order] of Object.entries(orders)){
  const status=order.status==='Archived'?order.prevStatus:order.status;
  if(order.voided===true||order.paymentStatus==='pending'||!['Completed','Received'].includes(status))continue;
  const gross=money(order.subtotal!=null?order.subtotal:order.total),discount=money(order.discount),refund=money(order.refundAmount);
  recognized[id]={gross,discount,refund,net:money(gross-discount-refund)};
}
const voided=Books.fullyVoidedSourceIds(movements),ledger={},excluded={};
for(const [id,raw] of Object.entries(movements)){
  const mv=Object.assign({id},raw||{}),sourceId=String(mv.sourceId||'');
  if(!Books.includeInRecognizedBooks(mv,voided)){
    for(const line of mv.lines||[]){const account=String(line.account||'');excluded[account]=money((excluded[account]||0)+money(line.debit)-money(line.credit));}
    continue;
  }
  if(!sourceId)continue;
  const row=ledger[sourceId]||(ledger[sourceId]={gross:0,discount:0,refund:0});
  for(const line of mv.lines||[]){
    const account=String(line.account||'');
    if(account==='revenue:sales')row.gross=money(row.gross+money(line.credit)-money(line.debit));
    else if(account==='expense:customer_discount'||account==='expense:platform_discount')row.discount=money(row.discount+money(line.debit)-money(line.credit));
    else if(account==='revenue:sales_reversal')row.refund=money(row.refund+money(line.debit)-money(line.credit));
  }
}
const mismatches=[];
for(const [id,admin] of Object.entries(recognized)){
  const books=ledger[id]||{gross:0,discount:0,refund:0};books.net=money(books.gross-books.discount-books.refund);
  if(['gross','discount','refund','net'].some(key=>Math.abs(money(books[key])-money(admin[key]))>=0.005))mismatches.push({id,admin,books});
}
const sum=(rows,key)=>money(Object.values(rows).reduce((total,row)=>total+money(row[key]),0));
const admin={gross:sum(recognized,'gross'),discount:sum(recognized,'discount'),refund:sum(recognized,'refund')};admin.net=money(admin.gross-admin.discount-admin.refund);
const books={gross:sum(ledger,'gross'),discount:sum(ledger,'discount'),refund:sum(ledger,'refund')};books.net=money(books.gross-books.discount-books.refund);
const result={recognizedTransactions:Object.keys(recognized).length,voidSourceCount:voided.size,orderLevelMismatches:mismatches.length,mismatches,admin,proposedBooks:books,excludedAccountEffects:Object.fromEntries(Object.entries(excluded).filter(([,amount])=>Math.abs(amount)>=0.005).sort(([a],[b])=>a.localeCompare(b)))};
process.stdout.write(JSON.stringify(result,null,2));
