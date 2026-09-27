function validDay(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));}
function addDays(day,count){var d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
function hasActivity(row){row=row||{};return Number(row.orders)>0||(Number(row.gross)||0)!==0||(Number(row.net)||0)!==0||(Number(row.refund)||0)!==0;}

export function mondayKey(day){
  if(!validDay(day))return'';
  var d=new Date(day+'T00:00:00Z'),shift=(d.getUTCDay()+6)%7;
  d.setUTCDate(d.getUTCDate()-shift);
  return d.toISOString().slice(0,10);
}

export function operatingWeekRows(days,endDay){
  var source=days&&typeof days==='object'?days:{},limit=validDay(endDay)?endDay:'',activeDays=Object.keys(source).filter(function(day){return validDay(day)&&(!limit||day<=limit)&&hasActivity(source[day]);}).sort();
  if(!activeDays.length||!limit)return[];
  var firstDay=activeDays[0],firstWeek=mondayKey(firstDay),lastWeek=mondayKey(limit),totals={};
  Object.keys(source).forEach(function(day){if(!validDay(day)||day<firstDay||day>limit)return;var week=mondayKey(day);totals[week]=(totals[week]||0)+(Number(source[day]&&source[day].net)||0);});
  var rows=[],cursor=firstWeek;
  while(cursor&&cursor<=lastWeek){rows.push({week:cursor,end:addDays(cursor,6),net:totals[cursor]||0,firstSaleDay:cursor===firstWeek?firstDay:'',openingPartial:cursor===firstWeek&&firstDay>firstWeek,currentPartial:cursor===lastWeek&&limit<addDays(cursor,6)});cursor=addDays(cursor,7);}
  return rows;
}

export function weeklyBarColor(week){
  var ordinal=Math.floor(Date.parse(String(week||'')+'T00:00:00Z')/604800000);
  if(!Number.isFinite(ordinal))ordinal=0;
  var hue=(34+ordinal*137.508)%360,saturation=42+(Math.abs(ordinal)%4)*4,lightness=42+(Math.abs(ordinal)%3)*5;
  return 'hsl('+hue.toFixed(1)+' '+saturation+'% '+lightness+'%)';
}

export function createOperatingYearWeekly(d){
  var state={year:'',loading:false,error:'',summary:null,months:null,analyticsReady:false,coverageComplete:false,missingMonths:[],request:0};
  function period(){var today=d.businessDate(Date.now()),year=today.slice(0,4);return{year:year,startAt:Date.parse(year+'-01-01T00:00:00+08:00'),endAt:Date.parse(today+'T23:59:59.999+08:00'),endDay:today};}
  function refresh(){if(!state.months)return;var p=period();state.summary=d.addLive(d.summarize(state.months,p),d.liveOrders(),p,d.salesAuthority());}
  function accept(result){var p=period();state={year:p.year,loading:false,error:'',summary:null,months:result.months||{},analyticsReady:result.analyticsReady===true,coverageComplete:result.coverageComplete===true,missingMonths:Array.isArray(result.missingMonths)?result.missingMonths:[],request:state.request};refresh();}
  function ensure(){var p=period();if(state.year===p.year&&(state.loading||state.months||state.error))return;state={year:p.year,loading:true,error:'',summary:null,months:null,analyticsReady:false,coverageComplete:false,missingMonths:[],request:state.request+1};var request=state.request;d.read({from:p.year+'-01',to:p.endDay.slice(0,7)}).then(function(result){if(request!==state.request)return;if(!result||result.ready!==true||Number(result.schemaVersion)<2)throw new Error('Operating-year weekly summaries need one controlled maintenance run.');accept(result);}).catch(function(error){if(request===state.request)state.error=String(error&&error.message||error);}).finally(function(){if(request===state.request){state.loading=false;d.changed();}});}
  function reset(){state={year:'',loading:false,error:'',summary:null,months:null,analyticsReady:false,coverageComplete:false,missingMonths:[],request:state.request+1};}
  function html(){var p=period(),ready=!!(state.summary&&state.analyticsReady&&state.coverageComplete),missing=state.missingMonths||[],rows=ready?operatingWeekRows(state.summary.days||{},p.endDay):[],max=Math.max.apply(null,rows.map(function(row){return row.net;}).concat([1])),step=rows.length>20?3:rows.length>12?2:1,esc=d.esc,fmt=d.fmt,peso=d.peso;
    if(state.loading)return'<p class="az-note">Loading '+esc(p.year)+' weekly sales…</p>';
    if(state.error)return'<p class="az-note az-summary-hold">Weekly operating-year sales are unavailable: '+esc(state.error)+'</p>';
    if(missing.length)return'<p class="az-note az-summary-hold"><b>Weekly sales withheld:</b> '+esc(missing.join(', '))+' is not yet reconciled to the historical source records.</p>';
    if(!ready)return'<p class="az-note">Weekly operating-year sales will appear after the date-level reporting summary is ready.</p>';
    if(!rows.length)return'<p class="az-note">No weekly sales have been recorded this operating year.</p>';
    return'<div class="az-weekly-context">From the first recorded sale on '+esc(fmt(rows[0].firstSaleDay))+' · Monday–Sunday · latest week may be partial</div><div class="az-weekly-bars">'+rows.map(function(row,index){var height=row.net>0?Math.max(3,Math.round(row.net/max*100)):0,show=index%step===0||index===rows.length-1,flags=(row.openingPartial?'<small>Opening</small>':'')+(row.currentPartial?'<small>Partial</small>':'');return'<div class="az-weekly-col" title="'+esc(fmt(row.week)+' – '+fmt(row.end)+': '+peso(row.net)+(row.openingPartial?' · opening week':'')+(row.currentPartial?' · partial week':''))+'" aria-label="'+esc(fmt(row.week)+' to '+fmt(row.end)+', '+peso(row.net))+'"><div class="az-weekly-value">'+peso(row.net)+'</div><div class="az-weekly-track"><div class="az-weekly-fill" style="height:'+height+'%;--week-color:'+weeklyBarColor(row.week)+'"></div></div><div class="az-weekly-label'+(show?'':' az-weekly-label-skip')+'">'+esc(fmt(row.week))+flags+'</div></div>';}).join('')+'</div>';
  }
  return{accept:accept,ensure:ensure,html:html,refresh:refresh,reset:reset,isLoading:function(){return state.loading;}};
}
