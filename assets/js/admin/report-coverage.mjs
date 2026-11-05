// Report coverage stamp (audit A-08, 5 Nov 2026). Admin reports read bounded windows of history
// (the newest few hundred records per feed, with Load older). This states, for each feed a report
// uses, how far back the loaded records reach and, when the report knows its period, whether that
// covers it. It reads only what is already loaded: no database reads.
const LABELS={orders:'orders',archivedOrders:'archived orders',financialMovements:'finance postings',platformPayouts:'platform payouts',internalUsage:'internal usage',inventoryAdjustments:'stock adjustments',stockReceipts:'stock receipts',inventoryMovements:'stock movements',cfLedger:'cash ledger',purchaseInvoices:'purchases',batchCards:'baking batches',shifts:'shifts',activityLog:'activity log',discrepancies:'discrepancies',archivedReservations:'archived reservations'};
// Manila is UTC+8 all year (no daylight saving), so a fixed offset gives the same text on every device.
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function manila(ms){return new Date(Number(ms)+28800000);}
function day(ms){var d=manila(ms);return d.getUTCDate()+' '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear();}
function clock(ms){var d=manila(ms);return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');}
export function feedLabel(path){return LABELS[path]||path;}
// startMs: the earliest moment the report on screen depends on (0 when the report has no fixed period).
export function reportCoverage(hub,paths,startMs,now){
  var gaps=[],pending=[],reach=[],ms=Number(startMs)||0;
  var feeds=(paths||[]).map(function(path){
    var s=hub.historyStatus(path)||{},label=feedLabel(path),state;
    if(s.error){state='error';gaps.push(label+' could not load');}
    else if(!s.ready){state='loading';pending.push(label);}
    else if(!s.bounded||!s.hasOlder||(ms&&s.oldestAt&&s.oldestAt<=ms)){state='complete';}
    else{state='partial';reach.push(label+' from '+(s.oldestAt?day(s.oldestAt):'—'));if(ms)gaps.push(label+' only from '+(s.oldestAt?day(s.oldestAt):'—'));}
    return {path:path,label:label,state:state,oldestAt:Number(s.oldestAt)||0,loaded:Number(s.loaded)||0};
  });
  var stamp='as at '+clock(now||Date.now())+' Manila',complete=!gaps.length&&!pending.length&&(ms>0||!reach.length),text;
  if(gaps.some(function(g){return /could not load/.test(g);}))text='Incomplete ('+stamp+'): '+gaps.join('; ')+'.';
  else if(pending.length)text='Still loading '+pending.join(', ')+' ('+stamp+').';
  else if(ms)text=gaps.length?'Incomplete for this period ('+stamp+'): '+gaps.join('; ')+'. Load older records before relying on these totals.':'Complete for this period from '+day(ms)+' ('+stamp+').';
  else text=reach.length?'Recent records only ('+stamp+'): '+reach.join('; ')+'. Load older records for earlier dates.':'All records loaded ('+stamp+').';
  return {complete:complete,text:text,feeds:feeds};
}
