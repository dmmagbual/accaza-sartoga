(function(global){
  'use strict';
  var sentAt=0,signature='';
  function deviceId(){var key='accaza_pos_device_id',id='';try{id=localStorage.getItem(key)||'';if(!id){id='pos_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);localStorage.setItem(key,id);}}catch(_e){id='pos_session';}return id;}
  function report(state,force){var a=global.__accaza,shift=global.__posShift;if(!a||!a.callables||!a.callables.reportPosDeviceHealth||!shift||!shift.id||global.__online===false)return Promise.resolve(null);state=state||{};var rows=state.rows||[],outstanding=Number(state.pending||0)+Number(state.syncing||0)+Number(state.failed||0),oldest=rows.filter(function(row){return row.status!=='synced';}).reduce(function(value,row){var at=Number(row.createdAt)||0;return!value||at<value?at:value;},0),next=[shift.id,outstanding,state.failed||0,oldest].join('|'),now=Date.now();if(!force&&next===signature&&now-sentAt<60000)return Promise.resolve(null);signature=next;sentAt=now;return a.callables.reportPosDeviceHealth({shiftId:shift.id,deviceId:deviceId(),pending:Number(state.pending)||0,syncing:Number(state.syncing)||0,failed:Number(state.failed)||0,oldestUnsyncedAt:oldest}).catch(function(){return null;});}
  global.AccazaPosSyncHealth={report:report,deviceId:deviceId};
  setInterval(function(){report(global.__posOfflineState?global.__posOfflineState():{},true);},60000);
})(window);
