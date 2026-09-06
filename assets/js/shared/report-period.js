(function(global){
  'use strict';
  var KEY='accaza-report-period',MAX_PERIODS=12;
  function today(){return global.AccazaDate.key();}
  function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;var parsed=Date.parse(value+'T12:00:00Z');return isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;}
  function validate(from,to){if(!validDate(from)||!validDate(to))throw new Error('Choose valid From and To dates.');if(from>to)throw new Error('The start date must be on or before the end date.');if(to>today())throw new Error('Future reporting dates are not allowed.');var limit=new Date(from+'T12:00:00Z');limit.setUTCFullYear(limit.getUTCFullYear()+1);if(Date.parse(to+'T12:00:00Z')>=limit.getTime())throw new Error('Choose a reporting period of 12 months or less.');}
  // Report dates are Philippine calendar dates, never device-local dates.
  function monthBounds(month){if(!/^\d{4}-\d{2}$/.test(String(month||'')))throw new Error('Choose a valid month.');var p=String(month).split('-'),last=new Date(Date.UTC(Number(p[0]),Number(p[1]),0)).getUTCDate(),now=today(),from=month+'-01',to=month+'-'+String(last).padStart(2,'0');if(from>now)throw new Error('Future reporting months are not allowed.');return{from:from,to:to>now?now:to};}
  function normalize(raw){raw=raw||{};var now=today(),valid=function(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'');},mode=['current','month','custom'].indexOf(raw.mode)>-1?raw.mode:'current',month=/^\d{4}-\d{2}$/.test(raw.month||'')?raw.month:now.slice(0,7),defaults=monthBounds(now.slice(0,7));return {mode:mode,period:mode,count:1,endMonth:month,month:month,customFrom:valid(raw.customFrom)?raw.customFrom:defaults.from,customTo:valid(raw.customTo)?raw.customTo:defaults.to,timeZone:'Asia/Manila'};}
  var state;try{state=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(_e){state=normalize({});}
  function bounds(value){var v=normalize(value||state),end=today();
    if(v.mode==='custom'&&v.customFrom&&v.customTo)return {from:v.customFrom,to:v.customTo,label:v.customFrom+' to '+v.customTo};
    var range=monthBounds(v.mode==='month'?v.month:end.slice(0,7));return {from:range.from,to:range.to,label:range.from+' to '+range.to};
  }
  function snapshot(){var value=Object.assign({},state),range=bounds(value);value.from=range.from;value.to=range.to;value.label=range.label;value.startAt=Date.parse(range.from+'T00:00:00+08:00');value.endAt=Date.parse(range.to+'T23:59:59.999+08:00');return value;}
  function emit(){global.dispatchEvent(new CustomEvent('accaza-report-period',{detail:snapshot()}));}
  function set(next){var candidate=normalize(Object.assign({},state,next||{})),range=bounds(candidate);validate(range.from,range.to);state=candidate;try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_e){}emit();return snapshot();}
  function setMonth(month){var range=monthBounds(month);return set({mode:month===today().slice(0,7)?'current':'month',month:month,endMonth:month,customFrom:range.from,customTo:range.to});}
  global.AccazaReportPeriod={get:snapshot,set:set,setMonth:setMonth,bounds:bounds,validate:validate,maxPeriods:MAX_PERIODS};
  global.addEventListener('storage',function(event){if(event.key!==KEY)return;try{state=normalize(JSON.parse(event.newValue||'{}'));}catch(_e){state=normalize({});}emit();});
})(window);
