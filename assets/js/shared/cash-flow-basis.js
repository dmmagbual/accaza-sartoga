/* Bounded Cash Flow basis (Sep 2026 download audit).
   The Books Cash Flow statement used to download every Finance movement ever
   posted (0.8 MB on 16 Sep 2026, +~15 KB a day) to work out opening balances.
   It now combines:
   - server-maintained cash deltas per month and per day (cashFlowMonthly,
     cashFlowDaily; opening balances of cash accounts excluded),
   - the cash-account opening movements (cashFlowOpenings), placed on each
     account's opening date,
   - the movements inside the selected period only, and
   - for a reversal inside the period, every movement of that source (read by
     the sourceId index), so fully reversed pairs are treated exactly as before.
   The figures match the full-history statement; see
   tests/download-loophole-check.mjs. */
(function(global){
  'use strict';
  var CASH_PREFIX='asset:cash_account:';
  function cents(v){return Math.round((Number(v)||0)*100);}
  function manilaDay(ts){var n=Number(ts);return new Date((isFinite(n)&&n>0?n:Date.now())+8*3600000).toISOString().slice(0,10);}
  // Same keys as the Books statement: cash account ids, register, undeposited, petty.
  function movementCents(m){var out={};((m&&m.lines)||[]).forEach(function(l){var a=String(l&&l.account||''),v=cents(l&&l.debit)-cents(l&&l.credit),k='';if(a.indexOf(CASH_PREFIX)===0)k=a.slice(CASH_PREFIX.length);else if(a==='asset:register_cash')k='register';else if(a==='asset:cash_awaiting_deposit')k='undeposited';else if(a==='asset:petty_cash')k='petty';if(k&&v)out[k]=(out[k]||0)+v;});return out;}
  function indexCents(delta){var out={};if(!delta)return out;if(delta.registerCents)out.register=Number(delta.registerCents);if(delta.undepositedCents)out.undeposited=Number(delta.undepositedCents);if(delta.revolvingCents)out.petty=Number(delta.revolvingCents);Object.keys(delta.cashAccountCents||{}).forEach(function(id){if(delta.cashAccountCents[id])out[id]=(out[id]||0)+Number(delta.cashAccountCents[id]);});return out;}
  function sum(map){return Object.keys(map).reduce(function(s,k){return s+(map[k]||0);},0);}
  function bump(target,map,sign){Object.keys(map).forEach(function(k){target[k]=(target[k]||0)+sign*map[k];});}
  function isOpening(m){return /^opening_balance/.test(String(m&&m.type||''))&&String(m&&m.sourceType||'')==='cashAccount';}
  function isVoid(m){return /_void$/.test(String(m&&m.type||''));}
  function groupKey(m){return String(m&&m.sourceType||'')+'|'+String(m&&m.sourceId||'');}
  function effectiveDay(m,accounts,ledgerDay){if(!isOpening(m))return ledgerDay;var a=(accounts||{})[String(m&&m.sourceId||'')],d=String(a&&a.openingDate||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?d:ledgerDay;}
  function openingRows(openings){return Object.keys(openings||{}).map(function(id){var o=openings[id]||{};return {id:id,type:o.type,sourceType:'cashAccount',sourceId:o.accountId,occurredAt:Number(o.occurredAt)||0,__cents:indexCents(o.delta)};});}
  function centsOf(m){return m.__cents||movementCents(m);}
  // Source groups that must be checked for a fully reversed pair: any source with a
  // reversal inside the period.
  function reversalSources(periodMovements){var keys={};Object.keys(periodMovements||{}).forEach(function(id){var m=periodMovements[id]||{};if(isVoid(m)&&m.sourceId&&!isOpening(m)&&sum(movementCents(m))!==0)keys[groupKey(m)]={sourceType:String(m.sourceType||''),sourceId:String(m.sourceId)};});return keys;}
  // Same rule as the full-history statement: within one source, up to the report end,
  // exactly one original and one reversal that cancel are excluded from the statement.
  // Opening movements come complete from their index; other sources are loaded on demand.
  function fullyReversed(groups,openings,to){
    var all={},out={};
    Object.keys(groups||{}).forEach(function(key){all[key]=Object.keys(groups[key]||{}).map(function(id){return Object.assign({id:id},groups[key][id]);}).filter(function(m){return groupKey(m)===key;});});
    openingRows(openings).forEach(function(o){var key=groupKey(o);(all[key]=all[key]||[]).push(o);});
    Object.keys(all).forEach(function(key){var rows=all[key].filter(function(m){return m.sourceId&&manilaDay(m.occurredAt)<=to&&sum(centsOf(m))!==0;}),originals=rows.filter(function(m){return !isVoid(m);}),voids=rows.filter(isVoid);if(originals.length!==1||voids.length!==1)return;if(sum(centsOf(originals[0]))+sum(centsOf(voids[0]))===0){out[originals[0].id]=originals[0];out[voids[0].id]=voids[0];}});
    return out;
  }
  function ready(input){var from=String(input.from||'');if(!input.meta||input.meta.complete!==true||Number(input.meta.summarySchemaVersion)<4)return false;if(!input.monthly||!input.openings||!input.daily||input.dailyMonth!==from.slice(0,7)||!input.movements)return false;var need=reversalSources(input.movements);return Object.keys(need).every(function(k){return input.groups&&input.groups[k];});}
  /* input: {from,to,accounts,movements (period),monthly,daily (the From month),openings,groups,categoryOf(m,net),isCorrection(m)}
     returns begin/ending/add/ded in pesos plus detail rows, like the full-history statement. */
  function statement(input){
    var from=input.from,to=input.to,fromMonth=from.slice(0,7),accounts=input.accounts||{},begin={},period={},add={},ded={},detail=[],correctionDetail=[],corrections=0;
    Object.keys(input.monthly||{}).forEach(function(month){if(month<fromMonth)bump(begin,indexCents(input.monthly[month]),1);});
    Object.keys(input.daily||{}).forEach(function(day){if(day.slice(0,7)===fromMonth&&day<from)bump(begin,indexCents(input.daily[day]),1);});
    var reversed=fullyReversed(input.groups,input.openings,to);
    // Reversed pairs are excluded from the statement entirely; the index already holds
    // any member dated before the period, so take it back out of opening cash.
    Object.keys(reversed).forEach(function(id){var m=reversed[id];if(isOpening(m))return;if(manilaDay(m.occurredAt)<from)bump(begin,movementCents(m),-1);});
    var rows=Object.keys(input.movements||{}).map(function(id){return Object.assign({id:id},input.movements[id]);}).filter(function(m){return !isOpening(m);}).concat(openingRows(input.openings));
    // Same order as the full-history statement: by time, then by key (database key order).
    rows.sort(function(a,b){return Number(a.occurredAt||0)-Number(b.occurredAt||0)||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);});
    rows.forEach(function(m){
      if(reversed[m.id])return;
      var ledger=manilaDay(m.occurredAt),d=effectiveDay(m,accounts,ledger),c=centsOf(m),net=sum(c);
      if(d<from){if(isOpening(m))bump(begin,c,1);return;}
      if(d>to)return;
      bump(period,c,1);
      if(net===0)return;
      var pesos=net/100;
      if(input.isCorrection&&input.isCorrection(m)){corrections+=net;correctionDetail.push({date:d,id:m.id,type:'Manual Books correction',net:pesos});}
      else{var cat=input.categoryOf?input.categoryOf(m,pesos):String(m.type||'');var target=net>0?add:ded;target[cat]=(target[cat]||0)+Math.abs(net);detail.push({date:d,id:m.id,type:cat,net:pesos});}
    });
    var ending={};bump(ending,begin,1);bump(ending,period,1);
    function toPesos(map){var out={};Object.keys(map).forEach(function(k){out[k]=Math.round(map[k])/100;});return out;}
    return {begin:toPesos(begin),ending:toPesos(ending),add:toPesos(add),ded:toPesos(ded),detail:detail,corrections:corrections/100,correctionDetail:correctionDetail,openingSources:Object.keys(input.openings||{}).map(function(id){return String((input.openings[id]||{}).accountId||'');})};
  }
  // Ledger balance of one cash key over all history (month index plus openings).
  function ledgerBalance(key,monthly,openings){var total=0;Object.keys(monthly||{}).forEach(function(m){total+=indexCents(monthly[m])[key]||0;});openingRows(openings).forEach(function(o){total+=o.__cents[key]||0;});return total/100;}
  global.AccazaCashFlowBasis={statement:statement,ready:ready,reversalSources:reversalSources,ledgerBalance:ledgerBalance,movementCents:movementCents,indexCents:indexCents,manilaDay:manilaDay};
})(typeof window!=='undefined'?window:globalThis);
