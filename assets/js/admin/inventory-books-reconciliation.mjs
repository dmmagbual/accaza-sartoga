export const INVENTORY_ACCOUNTS=[
  ['1200','Coffee & Beans'],['1210','Milk & Dairy'],['1220','Syrups & Flavors'],
  ['1230','Cups & Packaging'],['1240','Food & Pastries'],
  ['1270','Operating & Cleaning Supplies'],['1280','Office Supplies'],
  ['1290','Inventory Receiving Clearing']
];

const ASSIGNABLE=new Set(INVENTORY_ACCOUNTS.slice(0,7).map(function(row){return row[0];}));
const BOOK_CODES=new Set(INVENTORY_ACCOUNTS.map(function(row){return row[0];}));
export const ROUNDING_TOLERANCE=0.01;
function r2(value){return Math.round((Number(value)||0)*100)/100;}
function withinRoundingTolerance(value){return Math.abs(Number(value)||0)<=ROUNDING_TOLERANCE+1e-9;}

export function inventoryBookCode(account){
  const value=String(account||'');
  if(/^coa:\d{4}$/.test(value)&&BOOK_CODES.has(value.slice(4)))return value.slice(4);
  if(BOOK_CODES.has(value))return value;
  if(value==='inventory:control')return '1200';
  if(value.indexOf('inventory:')===0)return '1290';
  return '';
}

function sourceIsAfterCutoff(source,cutoff){
  if(typeof cutoff==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(cutoff)){
    const date=String(source&&source.date||'');
    if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date>cutoff;
    const occurredAt=Number(source&&source.occurredAt)||0;
    return occurredAt>0&&new Date(occurredAt).toISOString().slice(0,10)>cutoff;
  }
  const occurredAt=Number(source&&source.occurredAt)||0;
  return Number.isFinite(cutoff)&&occurredAt>=cutoff;
}

export function reconcileInventoryBooks(itemRows,movements,cutoffExclusive){
  const names=Object.fromEntries(INVENTORY_ACCOUNTS),rowsByCode={};
  INVENTORY_ACCOUNTS.forEach(function(row){rowsByCode[row[0]]={code:row[0],name:row[1],stockValue:0,booksValue:0,itemCount:0};});
  const unmapped={code:'UNMAPPED',name:'Unmapped Stock Items',stockValue:0,booksValue:0,itemCount:0};
  (itemRows||[]).forEach(function(item){
    const code=ASSIGNABLE.has(String(item.inventoryAccount||''))?String(item.inventoryAccount):'UNMAPPED';
    const target=code==='UNMAPPED'?unmapped:rowsByCode[code];
    target.stockValue=r2(target.stockValue+r2((Number(item.quantity)||0)*(Number(item.unitCost)||0)));
    target.itemCount++;
  });
  (movements||[]).forEach(function(movement){
    if(sourceIsAfterCutoff(movement,cutoffExclusive))return;
    Object.keys(movement&&movement.net||{}).forEach(function(rawCode){
      const code=inventoryBookCode(rawCode);if(!code)return;
      rowsByCode[code].booksValue=r2(rowsByCode[code].booksValue+(Number(movement.net[rawCode])||0));
    });
    (Array.isArray(movement&&movement.lines)?movement.lines:[]).forEach(function(line){
      const code=inventoryBookCode(line&&(line.code||line.account));if(!code)return;
      rowsByCode[code].booksValue=r2(rowsByCode[code].booksValue+(Number(line.debit)||0)-(Number(line.credit)||0));
    });
  });
  const rows=INVENTORY_ACCOUNTS.map(function(row){const out=rowsByCode[row[0]];out.difference=r2(out.stockValue-out.booksValue);out.withinTolerance=withinRoundingTolerance(out.difference);return out;});
  if(unmapped.itemCount){unmapped.difference=r2(unmapped.stockValue);rows.push(unmapped);}
  const totals=rows.reduce(function(out,row){out.stockValue=r2(out.stockValue+row.stockValue);out.booksValue=r2(out.booksValue+row.booksValue);return out;},{stockValue:0,booksValue:0});
  totals.difference=r2(totals.stockValue-totals.booksValue);
  const balanced=withinRoundingTolerance(totals.difference)&&rows.filter(function(row){return row.code!=='1290'&&row.code!=='UNMAPPED';}).every(function(row){return row.withinTolerance;})&&unmapped.itemCount===0&&withinRoundingTolerance(rowsByCode['1290'].booksValue);
  return {rows:rows,totals:totals,unmappedCount:unmapped.itemCount,clearingBalance:rowsByCode['1290'].booksValue,roundingTolerance:ROUNDING_TOLERANCE,balanced:balanced,names:names};
}
