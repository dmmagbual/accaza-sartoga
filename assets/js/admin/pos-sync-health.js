(function(global){
  'use strict';
  var sentAt=0,signature='';
  function deviceId(){var key='accaza_pos_device_id',id='';try{id=localStorage.getItem(key)||'';if(!id){id='pos_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);localStorage.setItem(key,id);}}catch(_e){id='pos_session';}return id;}
  // Heartbeat cadence (Sep 2026 download audit). Every report is a Cloud Function call that
  // reads the caller's access records and the open shift and pushes a device row to every
  // Live Operations viewer. A POS left open in the background or unattended overnight sent
  // 1,440 of them a day. It now reports every minute only while the screen is in use or a sale
  // is waiting to sync, and every five minutes otherwise, flagged idle so Live Operations
  // keeps counting it. Closing a shift still sends a fresh report first (80-shift-lifecycle).
  var ACTIVE_MS=2*60000,IDLE_MS=10*60000,IDLE_AFTER_MS=30*60000,lastInput=Date.now();
  function outstandingOf(state){state=state||{};return Number(state.pending||0)+Number(state.syncing||0)+Number(state.failed||0);}
  function idleNow(state){var hidden=global.document&&global.document.visibilityState==='hidden';return outstandingOf(state)===0&&(hidden||Date.now()-lastInput>IDLE_AFTER_MS);}
  function currentState(){return global.__posOfflineState?global.__posOfflineState():{};}
  function report(state,force){var a=global.__accaza,shift=global.__posShift;if(!a||!a.callables||!a.callables.reportPosDeviceHealth||!shift||!shift.id||global.__online===false)return Promise.resolve(null);state=state||{};if(Array.isArray(state.rows)&&state.rows.length){/* Report this shift's queue only; older-shift sales are recovered server-side. */var own=state.rows.filter(function(row){return !(row&&row.order&&row.order.shiftId&&row.order.shiftId!==shift.id);}),count=function(st){return own.filter(function(row){return row.status===st;}).length;};state={pending:count('pending'),syncing:count('syncing'),failed:count('failed'),rows:own};}var rows=state.rows||[],outstanding=Number(state.pending||0)+Number(state.syncing||0)+Number(state.failed||0),oldest=rows.filter(function(row){return row.status!=='synced';}).reduce(function(value,row){var at=Number(row.createdAt)||0;return!value||at<value?at:value;},0),next=[shift.id,outstanding,state.failed||0,oldest].join('|'),now=Date.now();if(!force&&next===signature&&now-sentAt<ACTIVE_MS)return Promise.resolve(null);signature=next;sentAt=now;return a.callables.reportPosDeviceHealth({shiftId:shift.id,deviceId:deviceId(),pending:Number(state.pending)||0,syncing:Number(state.syncing)||0,failed:Number(state.failed)||0,oldestUnsyncedAt:oldest,idle:idleNow(state)}).catch(function(){return null;});}
  global.AccazaPosSyncHealth={report:report,deviceId:deviceId};
  function beat(){var state=currentState();if(!idleNow(state)||Date.now()-sentAt>=IDLE_MS-1000)report(state,true);}
  function wake(){var wasIdle=idleNow(currentState());lastInput=Date.now();if(wasIdle)report(currentState(),true);}
  if(global.addEventListener)['pointerdown','keydown','touchstart'].forEach(function(name){global.addEventListener(name,wake,{passive:true,capture:true});});
  if(global.document&&global.document.addEventListener)global.document.addEventListener('visibilitychange',function(){if(global.document.visibilityState==='visible'){lastInput=Date.now();report(currentState(),true);}});
  setInterval(beat,ACTIVE_MS);
})(window);
