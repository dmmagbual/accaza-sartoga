
function handoverCall(data){var a=A();if(!a||!a.callables||!a.callables.manageShiftHandover)return Promise.reject(new Error('Refresh the POS to load the handover service.'));return a.callables.manageShiftHandover(data).then(function(r){return r.data||r;});}
// The till close check tags its errors with the failed step; the handover records it.
function closeCheckReason(error){return ((error&&error.closeStep)?'['+error.closeStep+'] ':'')+String((error&&error.message)||error||'');}
function openHandoverCount(shift,error,savedCounts){
  var m=document.createElement('div');m.className='pz-mask show';
  m.innerHTML='<div class="pz-modal" style="max-width:560px;"><h3>Finish shift</h3><p>The close check could not finish. Submit your count: if every sale is already synchronized and posted, the server closes the shift and shows the Z report now. Otherwise the next cashier can still trade and management reconciles this shift.</p><p style="font-size:.8rem;">'+esc(error&&error.message||error||'')+'</p>'+denomGridHtml('handoverCount')+'<p>Count all cash in the drawer. Retain the required float and hand over the remaining cash for settlement.</p><div data-handover-status role="status"></div><button class="pz-btn ok" data-submit>Submit count and finish shift</button> <button class="pz-btn sec" data-cancel>Cancel</button></div>';
  document.body.appendChild(m);
  if(savedCounts)m.querySelectorAll('[data-dp="handoverCount"]').forEach(function(input){input.value=savedCounts[input.getAttribute('data-dk')]||'';input.disabled=true;});
  wireDenom('handoverCount');
  // Keep this form and count visible on any failed server acknowledgement.
  var button=m.querySelector('[data-submit]'),status=m.querySelector('[data-handover-status]');
  m.querySelector('[data-cancel]').onclick=function(){m.remove();};
  if(savedCounts)status.textContent='Your previous submitted count was '+peso(DENOMS.reduce(function(s,d){return s+(Number(savedCounts[d.k])||0)*d.v;},0))+'. Confirm it below to use that count.';
  button.onclick=async function(){
    button.disabled=true;status.textContent='Saving handover…';
    try{
      var count=savedCounts?{counts:savedCounts}:denomRead('handoverCount');
      if(!window.AccazaOfflineQueue||!window.AccazaOfflineQueue.all)throw new Error('The local sale queue cannot be read. Do not clear browser data; reload this same browser to recover it.');
      var rows=(await window.AccazaOfflineQueue.all()).filter(function(row){return !(row&&row.status==='synced')&&!(row&&row.order&&row.order.shiftId&&row.order.shiftId!==shift.id);});
      var device=window.AccazaPosSyncHealth&&window.AccazaPosSyncHealth.deviceId();
      if(!device)throw new Error('This browser has no device identity. Keep the queue and refresh the POS.');
      var result=await handoverCall({action:'submit',shiftId:shift.id,deviceId:device,closeCount:count.counts,rows:rows,closeCheckError:closeCheckReason(error).slice(0,300)});
      if(result.resolved&&result.zReport){var closedShift=Object.assign({},shift,result.shift||{});if(window.__posLog)window.__posLog('shift-close',shift.id,'closed by server after handover · counted '+peso(result.cash.countedCash)+' · variance '+peso(result.variance!=null?result.variance:result.zReport.variance));m.querySelector('.pz-modal').innerHTML='<h3>Shift closed</h3><p>Every sale was confirmed, so the server closed the shift.</p><p>Cash counted: <b>'+peso(result.cash.countedCash)+'</b><br>Retain as float: <b>'+peso(result.cash.actualFloatRetained)+'</b><br>Cash to settle: <b>'+peso(result.cash.cashToSettle)+'</b></p><button class="pz-btn ok" data-z>Show Z report</button> <button class="pz-btn sec" data-done>Done</button>';m.querySelector('[data-z]').onclick=function(){showZ(closedShift,zReportView(result.zReport));};m.querySelector('[data-done]').onclick=function(){m.remove();};showZ(closedShift,zReportView(result.zReport));return;}
      m.querySelector('.pz-modal').innerHTML='<h3>Shift handed over</h3><p>The next cashier can open their shift.</p><p>Cash counted: <b>'+peso(result.cash.countedCash)+'</b><br>Retain as float: <b>'+peso(result.cash.actualFloatRetained)+'</b><br>Cash to settle: <b>'+peso(result.cash.cashToSettle)+'</b></p><p>Shift '+esc(shift.id)+' remains pending reconciliation. Queued sales are retained for recovery.</p>'+(result.autoFinalizeBlocker?'<p style="font-size:.8rem;">Why it is still open: '+esc(result.autoFinalizeBlocker)+'</p>':'')+'<button class="pz-btn ok" data-done>Done</button>';
      m.querySelector('[data-done]').onclick=function(){m.remove();};
    }catch(e){status.textContent='Handover not confirmed: '+String(e.message||e)+'. Your queue and cash count remain here.';button.disabled=false;}
  };
}
async function reviewShiftHandovers(){
  var m=document.createElement('div');m.className='pz-mask show';m.innerHTML='<div class="pz-modal" style="max-width:700px;"><h3>Shift handovers pending reconciliation</h3><div data-content>Loading…</div><button class="pz-btn sec" data-close>Close</button></div>';document.body.appendChild(m);m.querySelector('[data-close]').onclick=function(){m.remove();};var content=m.querySelector('[data-content]');
  async function list(){var result=await handoverCall({action:'list'});content.innerHTML=(result.rows||[]).map(function(r){return '<p><button class="pz-btn sec" data-shift="'+esc(r.shiftId)+'">'+esc(r.staff)+' · '+esc(r.shiftId)+'</button><br>Cash counted '+peso(r.cash.countedCash)+' · cash to settle '+peso(r.cash.cashToSettle)+'</p>';}).join('')||'No pending handovers.';content.querySelectorAll('[data-shift]').forEach(function(b){b.onclick=function(){detail(b.getAttribute('data-shift')).catch(fail);};});}
  function fail(e){content.textContent=String(e.message||e);}
  async function detail(id){var r=await handoverCall({action:'inspect',shiftId:id});content.innerHTML='<p>'+esc(id)+' · '+esc(r.state)+'</p>'+(r.closeCheckError?'<p style="font-size:.8rem;">Till close check: '+esc(r.closeCheckError)+'</p>':'')+(r.autoFinalizeBlocker?'<p style="font-size:.8rem;">Not closed automatically: '+esc(r.autoFinalizeBlocker)+'</p>':'')+(r.commands||[]).map(function(c){return '<p><b>'+esc(c.orderId)+'</b>: '+(c.syncedAt?'Synced':esc(c.lastError||'Waiting for recovery'))+'</p>';}).join('')+'<h4>Devices to check</h4>'+Object.entries(r.devices||{}).map(function(entry){return '<p>'+esc(entry[0])+' · last reported outstanding: '+esc(entry[1].outstanding||0)+'</p>';}).join('')+'<p>Check every device used for this shift, including unavailable or old browser sessions. Recover every missing sale before finalizing.</p><label><input type="checkbox" data-checked> Every device queue is checked and all sales are accounted for</label><textarea class="pz-in" data-reason placeholder="Explain the device checks and cash handover reconciliation"></textarea><p data-message role="status"></p><button class="pz-btn sec" data-retry>Retry retained sales</button> <button class="pz-btn ok" data-finish>Finalize reconciliation</button>';
    async function run(action){var message=content.querySelector('[data-message]'),buttons=content.querySelectorAll('button');buttons.forEach(function(b){b.disabled=true;});try{var out=await handoverCall({action:action,shiftId:id,reason:content.querySelector('[data-reason]').value,devicesChecked:content.querySelector('[data-checked]').checked});if(out.resolved)await list();else await detail(id);}catch(e){message.textContent=String(e.message||e);buttons.forEach(function(b){b.disabled=false;});}}
    content.querySelector('[data-retry]').onclick=function(){run('retry');};content.querySelector('[data-finish]').onclick=function(){run('reconcile');};
  }
  try{await list();}catch(e){fail(e);}
}
