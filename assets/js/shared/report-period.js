(function(global){
  'use strict';
  var KEY='accaza-report-period',MAX_PERIODS=12;
  function pad(n){return String(n).padStart(2,'0');}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function month(d){return d.getFullYear()+'-'+pad(d.getMonth()+1);}
  function parseMonth(value,fallback){var m=/^(\d{4})-(\d{2})$/.exec(String(value||''));return m?new Date(Number(m[1]),Number(m[2])-1,1):fallback;}
  function clamp(v,min,max){v=Math.floor(Number(v)||min);return Math.max(min,Math.min(max,v));}
  function normalize(raw){raw=raw||{};var legacy=String(raw.period||'');var mode=['month','quarter','year','custom'].indexOf(raw.mode)>-1?raw.mode:(['month','quarter','year','custom'].indexOf(legacy)>-1?legacy:'month');var now=new Date(),end=parseMonth(raw.endMonth,now);return {mode:mode,period:mode,count:clamp(raw.count,1,MAX_PERIODS),endMonth:month(end),customFrom:/^\d{4}-\d{2}-\d{2}$/.test(raw.customFrom||'')?raw.customFrom:'',customTo:/^\d{4}-\d{2}-\d{2}$/.test(raw.customTo||'')?raw.customTo:'',timeZone:'Asia/Manila'};}
  var state;try{state=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_e){state=normalize({});}
  function bounds(value){var v=normalize(value||state),end=parseMonth(v.endMonth,new Date()),start=new Date(end),finish=new Date(end);
    if(v.mode==='custom'&&v.customFrom&&v.customTo){return {from:v.customFrom,to:v.customTo,label:v.customFrom+' to '+v.customTo};}
    if(v.mode==='month'){start.setMonth(start.getMonth()-(v.count-1));finish.setMonth(finish.getMonth()+1);finish.setDate(0);}
    else if(v.mode==='quarter'){end.setMonth(Math.floor(end.getMonth()/3)*3+2,1);start=new Date(end);start.setMonth(start.getMonth()-3*(v.count-1)-2,1);finish=new Date(end.getFullYear(),end.getMonth()+1,0);}
    else {end.setMonth(11,1);start=new Date(end.getFullYear()-(v.count-1),0,1);finish=new Date(end.getFullYear(),11,31);}
    var today=iso(new Date());if(iso(finish)>today&&v.endMonth===month(new Date()))finish=new Date();
    var unit=v.mode==='month'?'month':v.mode==='quarter'?'quarter':'year';return {from:iso(start),to:iso(finish),label:v.count===1?(v.mode==='month'?'This month':v.mode==='quarter'?'This quarter':'This year'):(v.count+' '+unit+(v.count===1?'':'s')+' ending '+month(end))};
  }
  function snapshot(){var value=Object.assign({},state),range=bounds(value);value.from=range.from;value.to=range.to;value.label=range.label;value.startAt=Date.parse(range.from+'T00:00:00+08:00');value.endAt=Date.parse(range.to+'T23:59:59.999+08:00');return value;}
  function emit(){global.dispatchEvent(new CustomEvent('accaza-report-period',{detail:snapshot()}));}
  function set(next){state=normalize(Object.assign({},state,next||{}));if(state.mode==='custom'&&(!state.customFrom||!state.customTo)){var now=iso(new Date());state.customFrom=now;state.customTo=now;}try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_e){}emit();return snapshot();}
  global.AccazaReportPeriod={get:snapshot,set:set,bounds:bounds,maxPeriods:MAX_PERIODS};
  global.addEventListener('storage',function(event){if(event.key!==KEY)return;try{state=normalize(JSON.parse(event.newValue||'{}'));}catch(_e){state=normalize({});}emit();});
})(window);
