(function(global){
  'use strict';
  var PREFIX='accaza_pos_tab_primary_v1_',LEASE_MS=15000,HEARTBEAT_MS=3000,STANDBY_MS=30*60000;
  var tabId='',leaseKey='',primary=true,available=true,timer=null,lastInput=Date.now(),standby=false,devicePrimary=null,deviceShift='';
  try{tabId='tab_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);localStorage.setItem('__accaza_pos_guard_probe__','1');localStorage.removeItem('__accaza_pos_guard_probe__');}catch(_error){available=false;tabId='uncoordinated';}
  function scope(){var shift=global.__posShift||{},authz=global.__accazaAuthz||{};return shift.id&&authz.uid?PREFIX+authz.uid+'_'+shift.id:'';}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_error){return null;}}
  function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_error){available=false;return false;}}
  function release(key){if(!available||!key)return;try{var row=read(key);if(row&&row.tabId===tabId)localStorage.removeItem(key);}catch(_error){}}
  function setStandby(next){next=next===true;if(standby===next)return;standby=next;if(global.dispatchEvent)global.dispatchEvent(new CustomEvent('accaza-pos-standby',{detail:{standby:standby}}));paint();}
  function wake(){lastInput=Date.now();setStandby(false);claim(false);}
  function paint(){
    var old=document.getElementById('posTabGuardBanner');
    var remoteBlocked=devicePrimary===false&&global.__online!==false;
    if((primary&&!standby&&!remoteBlocked)||!leaseKey){if(old)old.remove();return;}
    var banner=old||document.createElement('div');banner.id='posTabGuardBanner';banner.setAttribute('role','status');banner.style.cssText=standby?'position:fixed;inset:0;z-index:100020;display:flex;align-items:center;justify-content:center;text-align:center;background:rgba(25,36,27,.88);color:#fff;padding:2rem;font:700 1.05rem/1.45 system-ui,sans-serif;cursor:pointer;':'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:100020;max-width:620px;background:#fff4e5;border:2px solid #c77800;color:#5c3a00;border-radius:9px;padding:.7rem .9rem;box-shadow:0 8px 24px rgba(0,0,0,.2);font:600 .82rem/1.35 system-ui,sans-serif;';
    banner.innerHTML=standby?'POS standby · touch anywhere to wake. The shift and locally queued sales remain safe.':remoteBlocked?'POS is active in another browser or device. Use that POS, or deliberately move control here. <button type="button" data-pos-device-takeover style="margin-left:.5rem;padding:.35rem .55rem;border:1px solid #8a5a00;border-radius:5px;background:#fff;cursor:pointer;font-weight:700;">Use this device instead</button>':'POS is active in another tab in this browser. Use that tab to take payment. <button type="button" data-pos-tab-takeover style="margin-left:.5rem;padding:.35rem .55rem;border:1px solid #8a5a00;border-radius:5px;background:#fff;cursor:pointer;font-weight:700;">Use this tab instead</button>';
    if(!old)document.body.appendChild(banner);
    if(standby)banner.onclick=wake;else banner.onclick=null;
    var take=banner.querySelector('[data-pos-tab-takeover]');if(take)take.onclick=function(){if(confirm('Use this tab as the till? The other tab will become read-only. Sales already stored on this browser remain safe.'))claim(true);};
    var deviceTake=banner.querySelector('[data-pos-device-takeover]');if(deviceTake)deviceTake.onclick=function(){if(!confirm('Move POS control to this browser or device? The previous POS will become read-only when online. Its locally queued sales will still synchronize safely.'))return;deviceTake.disabled=true;deviceTake.textContent='Taking control…';var health=global.AccazaPosSyncHealth;Promise.resolve(health&&health.takeControl?health.takeControl():null).then(function(){paint();}).finally(function(){deviceTake.disabled=false;deviceTake.textContent='Use this device instead';});};
  }
  function publish(next){var changed=primary!==next;primary=next;paint();if(changed&&global.dispatchEvent)global.dispatchEvent(new CustomEvent('accaza-pos-tab-primary',{detail:{primary:primary,tabId:tabId}}));}
  function claim(force){
    var nextKey=scope(),now=Date.now();
    if(nextKey!==leaseKey){release(leaseKey);leaseKey=nextKey;}
    if(!available||!leaseKey){publish(true);return true;}
    var current=read(leaseKey),stale=!current||now-Number(current.at||0)>LEASE_MS;
    if(force||stale||current.tabId===tabId){if(!write(leaseKey,{tabId:tabId,at:now}))return publish(true),true;current=read(leaseKey);}
    publish(!!current&&current.tabId===tabId);return primary;
  }
  function explain(){paint();alert(devicePrimary===false&&global.__online!==false?'Another browser or device currently controls this POS. Use it, or choose “Use this device instead”. No sale has been recorded yet.':'This browser already has an active POS tab. Use that tab, or choose “Use this tab instead”. No sale has been recorded yet.');}
  function canCharge(){wake();return claim(false)&&(global.__online===false||devicePrimary!==false);}
  function updateDeviceAuthority(result,shiftId){if(deviceShift&&shiftId&&deviceShift!==shiftId)devicePrimary=null;deviceShift=shiftId||deviceShift;devicePrimary=result&&typeof result.primaryDevice==='boolean'?result.primaryDevice:null;paint();return devicePrimary;}
  function beat(){claim(false);if(primary&&Date.now()-lastInput>=STANDBY_MS)setStandby(true);}
  timer=setInterval(beat,HEARTBEAT_MS);if(timer&&timer.unref)timer.unref();
  if(global.addEventListener){global.addEventListener('storage',function(event){if(event.key===leaseKey)claim(false);});global.addEventListener('beforeunload',function(){release(leaseKey);});['pointerdown','keydown','touchstart'].forEach(function(name){global.addEventListener(name,wake,{passive:true,capture:true});});}
  if(global.document&&document.addEventListener)document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')wake();});
  global.AccazaPosTabGuard={canCharge:canCharge,explain:explain,takeControl:function(){wake();return claim(true);},updateDeviceAuthority:updateDeviceAuthority,isPrimary:function(){return primary&&(global.__online===false||devicePrimary!==false);},isStandby:function(){return standby;},available:function(){return available;},tabId:function(){return tabId;},stop:function(){if(timer)clearInterval(timer);release(leaseKey);}};
  beat();
})(window);
