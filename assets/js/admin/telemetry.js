(function(global){
  'use strict';
  var ALLOWED={pos_boot:1,pos_build:1,cart_render:1,charge_to_durable:1,offline_flush:1,realtime_order_arrival:1};
  var queue=[],marks={},lastFlush=0,flushing=false,local={};
  function now(){return global.performance&&performance.now?performance.now():Date.now();}
  function cleanName(v){v=String(v||'').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,50);return ALLOWED[v]?v:'';}
  function metric(name,duration,ok){name=cleanName(name);duration=Math.max(0,Math.min(120000,Math.round(Number(duration)||0)));if(!name)return;queue.push({type:'metric',name:name,duration:duration,ok:ok!==false});var s=local[name]||(local[name]={count:0,total:0,max:0,failed:0});s.count++;s.total+=duration;s.max=Math.max(s.max,duration);if(ok===false)s.failed++;schedule();}
  function error(name){name=String(name||'client_error').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,50)||'client_error';queue.push({type:'error',name:name});schedule();}
  function start(name){marks[name]=now();return name;}
  function end(name,ok){if(marks[name]==null)return;var d=now()-marks[name];delete marks[name];metric(name,d,ok);return d;}
  function schedule(){if(queue.length>=10)flush();}
  function flush(){if(flushing||!queue.length||Date.now()-lastFlush<5000||!global.__accaza||!global.__accaza.recordClientTelemetry)return Promise.resolve({deferred:true});var batch=queue.splice(0,20);flushing=true;lastFlush=Date.now();return Promise.resolve(global.__accaza.recordClientTelemetry({events:batch,build:'admin-v171'})).catch(function(){queue=batch.concat(queue).slice(0,40);return{failed:true};}).finally(function(){flushing=false;});}
  global.addEventListener('error',function(e){var src=String(e&&e.filename||'').split('/').pop().replace(/\.(m?js).*$/,'');error('js_'+(src||'unknown'));});
  global.addEventListener('unhandledrejection',function(){error('unhandled_promise');});
  global.addEventListener('load',function(){setTimeout(function(){try{var n=performance.getEntriesByType('navigation')[0];if(n)metric('pos_boot',n.loadEventEnd||n.duration,true);}catch(e){}flush();},0);});
  global.addEventListener('online',flush);global.addEventListener('pagehide',flush);setInterval(flush,30000);
  global.AccazaTelemetry={start:start,end:end,metric:metric,error:error,flush:flush,snapshot:function(){return JSON.parse(JSON.stringify(local));}};
})(window);
