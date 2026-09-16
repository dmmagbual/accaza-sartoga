/* Stale-tab guard (Firebase download audit, 16 Sep 2026).
   A tab that stays open keeps running the code it loaded, including download
   loops that a later release fixed: on 16 Sep a Mac tab opened before the
   System Health fixes kept calling the scan every minute for hours after they
   were deployed. Every 15 minutes, and whenever the tab becomes visible or
   comes back online, this compares the running build with the public
   /build-version.json (served by GitHub Pages, not Firebase; the release
   manifest itself is excluded from the site). When a newer build
   is live it shows a reload bar. Admin and Books reload by themselves only
   when nothing can be lost: online, untouched for 15 minutes, no edited form
   field still on screen, no POS sale in progress and no offline sale syncing.
   Customer pages only show the bar. */
(function(global){
  'use strict';
  var CHECK_MS=15*60*1000,IDLE_MS=15*60*1000,MANIFEST='/build-version.json';
  var APPS=[['admin','accaza-admin-build'],['books','accaza-books-build'],['customer','accaza-customer-build']];
  var AUTO_RELOAD_APPS={admin:true,books:true};
  var SKIP_TYPES={hidden:1,button:1,submit:1,reset:1,image:1,file:1,search:1,password:1};

  function runningBuild(doc){
    for(var i=0;i<APPS.length;i++){var meta=doc.querySelector('meta[name="'+APPS[i][1]+'"]');if(meta)return{app:APPS[i][0],build:Number(meta.getAttribute('content'))||0};}
    return null;
  }
  function publishedBuild(manifest,app){var builds=manifest&&manifest.builds;var n=Number(builds&&builds[app]);return Number.isFinite(n)?n:0;}
  function fieldEdited(el){
    if(!el||el.disabled||el.readOnly||SKIP_TYPES[String(el.type||'').toLowerCase()])return false;
    if(el.closest&&el.closest('[data-freshness-ignore]'))return false;
    if(el.type==='checkbox'||el.type==='radio')return el.checked!==el.defaultChecked;
    if(el.tagName==='SELECT'){for(var i=0;i<el.options.length;i++)if(el.options[i].selected!==el.options[i].defaultSelected)return true;return false;}
    return String(el.value)!==String(el.defaultValue);
  }
  // Pure decision, exported for tests.
  // A tab reloads by itself at most once per published build, so a manifest
  // that is ahead of the page it describes can never become a reload loop.
  function decide(s){
    var stale=!!(s&&s.running>0&&s.published>s.running);
    var reload=stale&&AUTO_RELOAD_APPS[s.app]===true&&s.online===true&&Number(s.idleMs)>=IDLE_MS&&!s.editedFields&&!s.unsavedWork&&s.canMarkReload===true&&Number(s.reloadedFor)!==Number(s.published);
    return{stale:stale,reload:reload};
  }
  global.AccazaBuildFreshness={decide:decide,publishedBuild:publishedBuild,fieldEdited:fieldEdited,CHECK_MS:CHECK_MS,IDLE_MS:IDLE_MS};

  var doc=global.document;if(!doc||typeof global.fetch!=='function')return;
  var running=runningBuild(doc);if(!running||!running.build)return;
  var lastActivity=Date.now(),touched=[],checking=false,lastCheck=0;
  function activity(){lastActivity=Date.now();}
  ['pointerdown','keydown','wheel','touchstart'].forEach(function(type){doc.addEventListener(type,activity,{passive:true,capture:true});});
  doc.addEventListener('input',function(e){activity();var t=e.target;if(t&&touched.indexOf(t)<0){touched.push(t);if(touched.length>200)touched.shift();}},true);
  function editedFieldsOnScreen(){
    touched=touched.filter(function(el){return el.isConnected;});
    return touched.some(function(el){return el.getClientRects().length>0&&fieldEdited(el);});
  }
  function unsavedWork(){
    try{
      if(global.__pos&&typeof global.__pos.hasItems==='function'&&global.__pos.hasItems())return true;
      var off=typeof global.__posOfflineState==='function'?global.__posOfflineState():null;
      if(off&&Number(off.syncing)>0)return true;
      if(typeof global.__accazaHasUnsavedWork==='function'&&global.__accazaHasUnsavedWork())return true;
    }catch(_e){return true;}
    return false;
  }
  var RELOAD_KEY='accazaFreshnessReloadedFor';
  function reloadedFor(){try{return Number(global.sessionStorage.getItem(RELOAD_KEY))||0;}catch(_e){return 0;}}
  function markReload(build){try{global.sessionStorage.setItem(RELOAD_KEY,String(build));return global.sessionStorage.getItem(RELOAD_KEY)===String(build);}catch(_e){return false;}}
  function storageWritable(){try{var k=RELOAD_KEY+'Probe';global.sessionStorage.setItem(k,'1');global.sessionStorage.removeItem(k);return true;}catch(_e){return false;}}
  function showBar(){
    if(doc.getElementById('accazaUpdateReady')||!doc.body)return;
    var bar=doc.createElement('div');bar.id='accazaUpdateReady';bar.setAttribute('role','status');
    bar.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:29000;background:#19241b;color:#fff;border:1px solid #b08d57;border-radius:10px;padding:.7rem 1rem;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px Inter,sans-serif;max-width:calc(100vw - 32px);';
    bar.textContent='A new Accaza version is ready. ';
    var button=doc.createElement('button');button.type='button';button.textContent='Reload';
    button.style.cssText='margin-left:.6rem;background:#b08d57;color:#fff;border:0;border-radius:6px;padding:.35rem .65rem;cursor:pointer;';
    button.onclick=function(){global.location.reload();};
    bar.appendChild(button);doc.body.appendChild(bar);
  }
  function check(){
    if(checking||Date.now()-lastCheck<60000)return;
    checking=true;lastCheck=Date.now();
    global.fetch(MANIFEST,{cache:'no-store',credentials:'omit'}).then(function(r){return r.ok?r.json():null;}).then(function(manifest){
      if(!manifest)return;
      var published=publishedBuild(manifest,running.app);
      var result=decide({app:running.app,running:running.build,published:published,online:global.navigator.onLine!==false,idleMs:Date.now()-lastActivity,editedFields:editedFieldsOnScreen(),unsavedWork:unsavedWork(),canMarkReload:storageWritable(),reloadedFor:reloadedFor()});
      if(result.reload&&markReload(published)){global.location.reload();return;}
      if(result.stale)showBar();
    }).catch(function(){}).then(function(){checking=false;});
  }
  global.setInterval(check,CHECK_MS);
  doc.addEventListener('visibilitychange',function(){if(doc.visibilityState==='visible')check();});
  global.addEventListener('online',check);
})(typeof window!=='undefined'?window:globalThis);
