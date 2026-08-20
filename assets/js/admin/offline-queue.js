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
  function isQuotaError(error){var name=String(error&&error.name||''),message=String(error&&error.message||error||'');return name==='QuotaExceededError'||/quota.?exceeded|storage.*(?:full|quota)/i.test(message);}
  function removeIds(ids){if(!ids.length)return Promise.resolve(0);return tx('readwrite',function(s){ids.forEach(function(id){s.delete(id);});}).then(function(){return ids.length;});}
  function all(){return open().then(function(db){return request(db.transaction(STORE,'readonly').objectStore(STORE).getAll());}).then(function(rows){return(rows||[]).sort(function(a,b){return Number(a.createdAt)-Number(b.createdAt);});});}
  function get(id){return open().then(function(db){return request(db.transaction(STORE,'readonly').objectStore(STORE).get(id));});}
  function summary(){return all().then(function(rows){var s={pending:0,syncing:0,failed:0,synced:0,total:rows.length,rows:rows};rows.forEach(function(r){if(s[r.status]!=null)s[r.status]++;});return s;});}
  function patch(id,fields){return get(id).then(function(row){if(!row)return;Object.assign(row,fields||{}, {updatedAt:Date.now()});return put(row);});}
  function prune(){var cutoff=Date.now()-24*60*60*1000;return all().then(function(rows){return removeIds(rows.filter(function(r){return r.status==='synced'&&Number(r.syncedAt||0)<cutoff;}).map(function(r){return r.id;}));});}
  function compactSynced(){return all().then(function(rows){return removeIds(rows.filter(function(r){return r.status==='synced';}).map(function(r){return r.id;}));});}
  function enqueue(order){
    if(!order||!order.clientTxnId)return Promise.reject(new Error('Offline transaction ID is missing.'));
    var row={id:order.clientTxnId,order:order,drawerDelta:drawerDelta(order),status:'pending',createdAt:Number(order.timestamp)||Date.now(),updatedAt:Date.now(),attempts:0,lastError:''};
    return prune().then(function(){return put(row);}).catch(function(error){
      if(!isQuotaError(error))throw error;
      return compactSynced().then(function(){return put(row);});
    }).then(function(){return order.clientTxnId;});
  }
  function storageHealth(){
    var estimatePromise=(global.navigator&&navigator.storage&&navigator.storage.estimate)?navigator.storage.estimate().catch(function(){return{};}):Promise.resolve({});
    var probeId='__storage_health_probe__',probe={id:probeId,status:'synced',createdAt:Date.now(),syncedAt:Date.now(),updatedAt:Date.now(),healthProbe:true};
    var probePromise=put(probe).then(function(){return removeIds([probeId]);}).then(function(){return true;}).catch(function(error){return isQuotaError(error)?false:Promise.reject(error);});
    return Promise.all([summary(),estimatePromise,probePromise]).then(function(parts){var e=parts[1]||{},usage=Number(e.usage)||0,quota=Number(e.quota)||0;return{writable:parts[2],usage:usage,quota:quota,remaining:quota?Math.max(0,quota-usage):null,ratio:quota?usage/quota:null,queue:parts[0]};});
  }
  function flush(sync,onChange){
    if(flushing)return Promise.resolve({busy:true});flushing=true;
    return all().then(function(rows){var work=rows.filter(function(r){return r.status==='pending'||r.status==='failed'||r.status==='syncing';});var chain=Promise.resolve(),result={synced:0,failed:0};work.forEach(function(row){chain=chain.then(function(){return patch(row.id,{status:'syncing',attempts:(Number(row.attempts)||0)+1,lastError:''}).then(function(){if(onChange)onChange();return sync({transactionId:row.id,order:row.order,drawerDelta:row.drawerDelta});}).then(function(response){return patch(row.id,{status:'synced',syncedAt:Date.now(),serverResult:(response&&response.data)||response||null}).then(function(){result.synced++;if(onChange)onChange();});}).catch(function(error){var msg=String((error&&error.message)||error||'Sync failed').slice(0,500);return patch(row.id,{status:'failed',lastError:msg,failedAt:Date.now()}).then(function(){result.failed++;if(onChange)onChange();});});});});return chain.then(function(){return prune().then(function(){return result;});});}).finally(function(){flushing=false;if(onChange)onChange();});
  }
  global.AccazaOfflineQueue={open:open,enqueue:enqueue,all:all,summary:summary,flush:flush,retry:function(id){return patch(id,{status:'pending',lastError:''});},drawerDelta:drawerDelta,storageHealth:storageHealth,isQuotaError:isQuotaError,compactSynced:compactSynced};
})(window);
