
/* ---------- sales model ---------- */
function isSale(o){return window.AccazaSales.qualifies(o);}
function allOrders(){var out={};[ordersMap,archMap].forEach(function(m){Object.keys(m).forEach(function(k){var o=m[k];if(o)out[String(o.id||k)]=o;});});return Object.values(out);}
function itemCost(li){var rec=recMap[li.itemKey];if(!rec)return null;var mult=(rec.sizeMult&&rec.sizeMult[li.size]!=null)?rec.sizeMult[li.size]:1;var c=0;(rec.base||[]).forEach(function(b){var ing=invMap[b.ing];if(!ing)return;var per=b['qty'+(li.size||'M')];var q=(per!=null&&per!=='')?(Number(per)||0):(Number(b.qty)||0)*mult;c+=q*(Number(ing.cost)||0);});var labels=li.optLabels||[];var _it=((A()&&A().menuItemsMap)||{})[li.itemKey]||{key:li.itemKey};var getChoiceIngs=window.__accazaChoiceIngs;labels.forEach(function(lb){(getChoiceIngs?getChoiceIngs(_it,rec,lb,li.size):[]).forEach(function(r){var ing=invMap[r.ing];if(ing)c+=(Number(r.qty)||0)*(Number(ing.cost)||0);});});return c*(Number(li.qty)||1);}
function orderCOGS(o){var _x=Number(o.extraCost)||0;
  if(o.cogsSnapshot!=null)return{cost:(Number(o.cogsSnapshot)||0)+_x,covered:o.cogsCovered!==false};
  if(!o.lineItems)return{cost:_x,covered:false};var cost=0,any=false,all=true;o.lineItems.forEach(function(li){var c=itemCost(li);if(c==null)all=false;else{cost+=c;any=true;}});return{cost:cost+_x,covered:any&&all};}
function saleFields(o){var v=window.AccazaSales.amounts(o);return{ts:window.AccazaSales.stamp(o),gross:v.gross,discount:v.discount,refund:v.refund,net:v.net,payment:o.payment||'—',type:o.type||'—',lineItems:o.lineItems||null,phone:(o.phone||'').replace(/[^0-9]/g,''),name:o.name||'Walk-in',o:o};}
function salesBetween(from,to){return allOrders().filter(isSale).map(saleFields).filter(function(s){return s.ts>=from&&s.ts<to;});}
function dayStart(d){d=new Date(d);d.setHours(0,0,0,0);return d.getTime();}
function addDays(ts,n){var d=new Date(ts);d.setDate(d.getDate()+n);return d.getTime();}
function localDateValue(v){var p=String(v||'').split('-');if(p.length!==3)return NaN;return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])).getTime();}
function rangeBounds(){
  if(azFrom!=null&&azTo!=null)return[azFrom,azTo+1];
  var now=Date.now(),today=dayStart(now),end=addDays(today,1);if(azRange==='today')return[today,end];if(azRange==='7d')return[addDays(today,-6),end];if(azRange==='30d')return[addDays(today,-29),end];if(azRange==='month'){var d=new Date();return[new Date(d.getFullYear(),d.getMonth(),1).getTime(),end];}return[new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime(),end];
}
function businessDate(ts){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(ts)||0));}
function dateKeys(from,to){var out=[],d=new Date(Date.parse(businessDate(from)+'T00:00:00Z')),last=businessDate(to-1);while(d.toISOString().slice(0,10)<=last){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function fmtD(value){var key=/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):businessDate(value);return new Date(key+'T12:00:00+08:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'});}
function azRangeLabel(from,to){var nm={today:'Today','7d':'Last 7 days','30d':'Last 30 days',month:'This month',all:'All time',custom:'Custom range'};return (nm[azRange]||azRange)+' · '+fmtD(from)+' – '+fmtD(to-86400000);}
function sharedPeriod(v){
  v=v||(window.AccazaAdminPeriods&&window.AccazaAdminPeriods.get&&window.AccazaAdminPeriods.get('sales'));if(!v)return;
  azRange='custom';
  azFrom=Number(v.startAt)||null;
  azTo=Number(v.endAt)||null;
}
async function ensureAnalyticsHistory(){
  // The hub loads the selected period plus the equally sized comparison period.
  // No creation-date pagination or full-history scan is needed here.
  var hub=A()&&A().hub;
  analyticsHistoryLoading=!!(hub&&['orders','archivedOrders'].some(function(path){var status=hub.historyStatus(path);return status.loading||status.error;}));
}

function bar(label,val,max,disp){var w=max>0?Math.max(2,Math.round(val/max*100)):0;return '<div class="az-bar-row"><div class="az-bar-lbl">'+esc(label)+'</div><div class="az-bar-track"><div class="az-bar-fill" style="width:'+w+'%;"></div></div><div class="az-bar-val">'+(disp!=null?disp:val)+'</div></div>';}
function kpi(label,val,delta){var d='';if(delta!=null&&isFinite(delta))d='<div class="d '+(delta>0?'az-up':delta<0?'az-down':'az-flat')+'">'+pct(delta)+' vs prev</div>';return '<div class="az-kpi"><div class="v">'+val+'</div><div class="l">'+esc(label)+'</div>'+d+'</div>';}
