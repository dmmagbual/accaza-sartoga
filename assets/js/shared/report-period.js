(function(global){
  'use strict';
  var KEY='accaza-report-period',MAX_PERIODS=12;
  function today(){return global.AccazaDate.key();}
  function shift(date,days){var d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
  // Report dates are Philippine calendar dates, never device-local dates.
  function normalize(raw){raw=raw||{};var mode=['30d','all','custom'].indexOf(raw.mode)>-1?raw.mode:'30d';return {mode:mode,period:mode,count:1,endMonth:today().slice(0,7),customFrom:/^\d{4}-\d{2}-\d{2}$/.test(raw.customFrom||'')?raw.customFrom:'',customTo:/^\d{4}-\d{2}-\d{2}$/.test(raw.customTo||'')?raw.customTo:'',timeZone:'Asia/Manila'};}
  var state;try{state=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_e){state=normalize({});}
  function bounds(value){var v=normalize(value||state),end=today();
    if(v.mode==='all')return {from:'0000-01-01',to:end,label:'All time'};
    if(v.mode==='custom'&&v.customFrom&&v.customTo)return {from:v.customFrom,to:v.customTo,label:v.customFrom+' to '+v.customTo};
    return {from:shift(end,-29),to:end,label:'Last 30 days'};
  }
  function snapshot(){var value=Object.assign({},state),range=bounds(value);value.from=range.from;value.to=range.to;value.label=range.label;value.startAt=Date.parse(range.from+'T00:00:00+08:00');value.endAt=Date.parse(range.to+'T23:59:59.999+08:00');return value;}
  function emit(){global.dispatchEvent(new CustomEvent('accaza-report-period',{detail:snapshot()}));}
  function set(next){state=normalize(Object.assign({},state,next||{}));if(state.mode==='custom'&&(!state.customFrom||!state.customTo)){var now=today();state.customFrom=now;state.customTo=now;}try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_e){}emit();return snapshot();}
  global.AccazaReportPeriod={get:snapshot,set:set,bounds:bounds,maxPeriods:MAX_PERIODS};
  global.addEventListener('storage',function(event){if(event.key!==KEY)return;try{state=normalize(JSON.parse(event.newValue||'{}'));}catch(_e){state=normalize({});}emit();});
})(window);
