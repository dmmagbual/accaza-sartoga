(function(){
  'use strict';
  var base='assets/js/admin/';
  var files={offlinequeue:'offline-queue.js',costing:'../shared/costing.js',pos:'pos.js',channelpricing:'channel-pricing.js',analytics:'analytics.js',register:'register.js',staff:'staff-access.js',packages:'packages.js',finance:'finance.js',operations:'operations-dashboard.js'};
  var routes={
    pos:['pos'],inventory:['pos'],purchases:['finance','pos'],recipes:['pos'],usage:['pos'],channelpricing:['pos','channelpricing'],dedupe:['pos'],
    analytics:['pos','analytics'],pnl:['pos','analytics'],payouts:['pos','analytics'],stockvalue:['pos','analytics'],dailyreport:['pos','analytics'],
    ops:['pos','register'],possettings:['pos','register'],discrepancy:['pos','register'],petty:['pos','register'],packages:['pos','packages'],staffaccess:['staff'],
    cashflow:['finance'],receivables:['finance'],payables:['finance'],operations:['operations']
  };
  var roots={pos:'posRoot',inventory:'inventoryRoot',purchases:'purchasesRoot',recipes:'recipesRoot',usage:'usageRoot',channelpricing:'channelPricingRoot',dedupe:'dedupeRoot',analytics:'analyticsRoot',pnl:'pnlRoot',payouts:'payoutsRoot',stockvalue:'stockValueRoot',dailyreport:'dailyReportRoot',ops:'opsRoot',possettings:'posSettingsRoot',discrepancy:'discrepancyRoot',petty:'pettyRoot',packages:'packagesRoot',staffaccess:'staffAccessRoot',cashflow:'cashflowRoot',receivables:'receivablesRoot',payables:'payablesRoot',operations:'operationsRoot'};
  var promises={},handlers={},requestSerial=0;

  window.__accazaRegisterModule=function(name,handler){handlers[name]=handler;};

  function load(name){
    if(promises[name])return promises[name];
    if(name==='pos'&&!window.AccazaOfflineQueue)return load('offlinequeue').then(function(){if(!window.AccazaOfflineQueue)throw new Error('Durable offline queue did not initialize.');return load('pos');});
    if(name==='pos'&&!window.AccazaCosting)return load('costing').then(function(){if(!window.AccazaCosting)throw new Error('Shared costing engine did not initialize.');return load('pos');});
    promises[name]=new Promise(function(resolve,reject){
      var script=document.createElement('script');
      script.src=base+files[name];script.async=true;script.dataset.accazaModule=name;
      script.onload=resolve;
      script.onerror=function(){delete promises[name];reject(new Error('Could not load '+name+' module.'));};
      document.head.appendChild(script);
    });
    return promises[name];
  }
  window.__accazaLoadAdminModule=load;
  window.__openOfflineQueue=function(button){
    var old=button&&button.innerHTML;
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    return load('pos').then(function(){
      if(typeof window.__showOfflineQueue!=='function')throw new Error('Transaction sync queue did not initialize.');
      window.__showOfflineQueue();
    }).catch(function(error){
      console.error('Accaza transaction sync queue failed to open',error);
      alert('The transaction sync queue could not open. Check the connection and try again.');
    }).finally(function(){
      if(button){button.disabled=false;button.removeAttribute('aria-busy');if(old!=null)button.innerHTML=old;}
    });
  };
  function loading(tab){var root=document.getElementById(roots[tab]||'');if(root&&!root.innerHTML.trim())root.innerHTML='<div style="padding:2rem;text-align:center;color:var(--tl);">Loading '+String(tab).replace(/([A-Z])/g,' $1')+'…</div>';}
  function failed(tab,error){var root=document.getElementById(roots[tab]||'');if(root)root.innerHTML='<div style="padding:1.2rem;border:1px solid #f1b7b7;background:#fff5f5;color:#8b1e1e;border-radius:8px;">This section could not load. Check the connection and open the tab again.</div>';console.error('Accaza module load failed',tab,error);}

  window.posSwitchTab=function(tab,button){
    var serial=++requestSerial;
    if(window.switchTab)window.switchTab(tab,button);
    var needed=routes[tab]||[];
    if(!needed.length)return Promise.resolve();
    loading(tab);
    return needed.reduce(function(chain,name){return chain.then(function(){return load(name);});},Promise.resolve()).then(function(){
      if(serial!==requestSerial)return;
      needed.forEach(function(name){if(typeof handlers[name]==='function')handlers[name](tab,button);});
    }).catch(function(error){failed(tab,error);});
  };

  var excelPromise=null;
  window.__accazaLoadExcel=function(){
    if(window.XLSX)return Promise.resolve(window.XLSX);
    if(excelPromise)return excelPromise;
    excelPromise=new Promise(function(resolve,reject){
      var script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';script.async=true;
      script.onload=function(){window.XLSX?resolve(window.XLSX):reject(new Error('Excel library did not initialize.'));};
      script.onerror=function(){excelPromise=null;reject(new Error('Could not download the Excel library.'));};
      document.head.appendChild(script);
    });
    return excelPromise;
  };

  document.addEventListener('click',function(event){
    if(window.XLSX)return;
    var button=event.target&&event.target.closest?event.target.closest('button'):null;if(!button)return;
    var id=button.id||'',label=(button.textContent||'').toLowerCase();
    var known=/^(stXls|recExport|recTemplate|recImportBtn|invExport|invTemplate|invImportBtn|usageExport|cpExport|cpTemplate|cpImportBtn|drExport|svExport|discExport|pettyExport|shiftExport|cfExport)$/i.test(id);
    if(!known&&!/(excel|xlsx|import template|export)/.test(label))return;
    event.preventDefault();event.stopImmediatePropagation();
    var old=button.textContent;button.disabled=true;button.textContent='Loading Excel…';
    window.__accazaLoadExcel().then(function(){button.disabled=false;button.textContent=old;button.click();}).catch(function(error){button.disabled=false;button.textContent=old;alert(error.message);});
  },true);
})();
