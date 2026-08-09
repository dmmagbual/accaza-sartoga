(function(global){
  'use strict';
  var DB_NAME='accaza-pos-offline',DB_VERSION=1,STORE='transactions',opening=null,flushing=false;
  function request(req){return new Promise(function(resolve,reject){req.onsuccess=function(){resolve(req.result);};req.onerror=function(){reject(req.error||new Error('IndexedDB request failed'));};});}
  function open(){
    if(opening)return opening;
    opening=new Promise(function(resolve,reject){
      if(!global.indexedDB){reject(new Error('This browser does not support durable offline storage.'));return;}
      var req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=function(){var db=req.result;if(!db.objectStoreNames.contains(STORE)){var s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('status','status',{unique:false});s.createIndex('createdAt','createdAt',{unique:false});}};
      req.onsuccess=function(){resolve(req.result);};req.onerror=function(){reject(req.error||new Error('Could not open offline storage.'));};
    }).then(function(db){return migrateLegacy(db).then(function(){return db;});});
    return opening;
  }
  function tx(mode,work){return open().then(function(db){return new Promise(function(resolve,reject){var t=db.transaction(STORE,mode),s=t.objectStore(STORE),value;try{value=work(s,t);}catch(e){reject(e);return;}t.oncomplete=function(){resolve(value);};t.onerror=function(){reject(t.error||new Error('Offline storage transaction failed.'));};t.onabort=function(){reject(t.error||new Error('Offline storage transaction aborted.'));};});});}
  function migrateLegacy(db){
    var old;try{old=JSON.parse(localStorage.getItem('accaza_offline_orders')||'[]');}catch(e){old=[];}
    if(!Array.isArray(old)||!old.length)return Promise.resolve();
    return new Promise(function(resolve,reject){var t=db.transaction(STORE,'readwrite'),s=t.objectStore(STORE);old.forEach(function(order){if(!order||!order.id)return;var id=order.clientTxnId||('legacy-'+order.id);order.clientTxnId=id;s.put({id:id,order:order,drawerDelta:drawerDelta(order),status:'pending',createdAt:Number(order.timestamp)||Date.now(),updatedAt:Date.now(),attempts:0,lastError:'',legacy:true});});t.oncomplete=function(){try{localStorage.removeItem('accaza_offline_orders');}catch(e){}resolve();};t.onerror=function(){reject(t.error);};});
  }
  function drawerDelta(order){var out={};function add(map,sign){Object.keys(map||{}).forEach(function(k){out[k]=(Number(out[k])||0)+sign*(Number(map[k])||0);if(!out[k])delete out[k];});}add(order.cashReceived,1);add(order.cashChange,-1);return out;}
  function put(row){row.updatedAt=Date.now();return tx('readwrite',function(s){s.put(row);});}
  function enqueue(order){if(!order||!order.clientTxnId)return Promise.reject(new Error('Offline transaction ID is missing.'));return put({id:order.clientTxnId,order:order,drawerDelta:drawerDelta(order),status:'pending',createdAt:Number(order.timestamp)||Date.now(),updatedAt:Date.now(),attempts:0,lastError:''}).then(function(){return order.clientTxnId;});}
  function all(){return open().then(function(db){return request(db.transaction(STORE,'readonly').objectStore(STORE).getAll());}).then(function(rows){return(rows||[]).sort(function(a,b){return Number(a.createdAt)-Number(b.createdAt);});});}
  function get(id){return open().then(function(db){return request(db.transaction(STORE,'readonly').objectStore(STORE).get(id));});}
  function summary(){return all().then(function(rows){var s={pending:0,syncing:0,failed:0,synced:0,total:rows.length,rows:rows};rows.forEach(function(r){if(s[r.status]!=null)s[r.status]++;});return s;});}
  function patch(id,fields){return get(id).then(function(row){if(!row)return;Object.assign(row,fields||{}, {updatedAt:Date.now()});return put(row);});}
  function prune(){var cutoff=Date.now()-24*60*60*1000;return all().then(function(rows){var ids=rows.filter(function(r){return r.status==='synced'&&Number(r.syncedAt||0)<cutoff;}).map(function(r){return r.id;});if(!ids.length)return;return tx('readwrite',function(s){ids.forEach(function(id){s.delete(id);});});});}
  function flush(sync,onChange){
    if(flushing)return Promise.resolve({busy:true});flushing=true;
    return all().then(function(rows){var work=rows.filter(function(r){return r.status==='pending'||r.status==='failed'||r.status==='syncing';});var chain=Promise.resolve(),result={synced:0,failed:0};work.forEach(function(row){chain=chain.then(function(){return patch(row.id,{status:'syncing',attempts:(Number(row.attempts)||0)+1,lastError:''}).then(function(){if(onChange)onChange();return sync({transactionId:row.id,order:row.order,drawerDelta:row.drawerDelta});}).then(function(response){return patch(row.id,{status:'synced',syncedAt:Date.now(),serverResult:(response&&response.data)||response||null}).then(function(){result.synced++;if(onChange)onChange();});}).catch(function(error){var msg=String((error&&error.message)||error||'Sync failed').slice(0,500);return patch(row.id,{status:'failed',lastError:msg,failedAt:Date.now()}).then(function(){result.failed++;if(onChange)onChange();});});});});return chain.then(function(){return prune().then(function(){return result;});});}).finally(function(){flushing=false;if(onChange)onChange();});
  }
  global.AccazaOfflineQueue={open:open,enqueue:enqueue,all:all,summary:summary,flush:flush,retry:function(id){return patch(id,{status:'pending',lastError:''});},drawerDelta:drawerDelta};
})(window);
