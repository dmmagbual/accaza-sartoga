(function(global){
  'use strict';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fieldHtml(f){
    var id='afd_'+esc(f.name),required=f.required?' <span style="color:#a33;">required</span>':'';
    if(f.type==='checkbox')return '<label style="display:flex;align-items:flex-start;gap:.55rem;padding:.65rem;background:#f3eee5;border:1px solid #d8cbbb;border-radius:8px;cursor:pointer;"><input id="'+id+'" data-afd="'+esc(f.name)+'" type="checkbox" '+(f.value?'checked':'')+' style="margin-top:.15rem;accent-color:#44523f;"><span><b>'+esc(f.label)+'</b>'+(f.help?'<small style="display:block;color:#74685d;margin-top:.15rem;">'+esc(f.help)+'</small>':'')+'</span></label>';
    if(f.type==='select')return '<label style="display:block;"><span style="display:block;font-size:.69rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6d5d4d;margin-bottom:.3rem;">'+esc(f.label)+required+'</span><select id="'+id+'" data-afd="'+esc(f.name)+'" style="width:100%;box-sizing:border-box;border:1px solid #cdbda9;border-radius:8px;background:#fffdf9;color:#19241b;padding:.72rem .78rem;font:15px Inter,sans-serif;outline:none;">'+(f.options||[]).map(function(o){var value=o&&typeof o==='object'?o.value:o,label=o&&typeof o==='object'?o.label:o;return '<option value="'+esc(value)+'"'+(String(value)===String(f.value==null?'':f.value)?' selected':'')+'>'+esc(label)+'</option>';}).join('')+'</select>'+(f.help?'<small style="display:block;color:#74685d;margin-top:.25rem;line-height:1.4;">'+esc(f.help)+'</small>':'')+'</label>';
    var tag=f.type==='textarea'?'textarea':'input',attrs=tag==='input'?' type="'+esc(f.type||'text')+'"':' rows="'+(f.rows||3)+'"';
    if(f.min!=null)attrs+=' min="'+esc(f.min)+'"';if(f.max!=null)attrs+=' max="'+esc(f.max)+'"';if(f.step!=null)attrs+=' step="'+esc(f.step)+'"';if(f.maxLength)attrs+=' maxlength="'+esc(f.maxLength)+'"';
    return '<label style="display:block;"><span style="display:block;font-size:.69rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6d5d4d;margin-bottom:.3rem;">'+esc(f.label)+required+'</span><'+tag+' id="'+id+'" data-afd="'+esc(f.name)+'"'+attrs+' placeholder="'+esc(f.placeholder||'')+'" style="width:100%;box-sizing:border-box;border:1px solid #cdbda9;border-radius:8px;background:#fffdf9;color:#19241b;padding:.72rem .78rem;font:15px Inter,sans-serif;outline:none;"'+(tag==='textarea'?'>':' value="'+esc(f.value==null?'':f.value)+'">')+(tag==='textarea'?esc(f.value==null?'':f.value)+'</textarea>':'')+(f.help?'<small style="display:block;color:#74685d;margin-top:.25rem;line-height:1.4;">'+esc(f.help)+'</small>':'')+'</label>';
  }
  function run(config,submit){
    config=config||{};var fields=config.fields||[];
    return new Promise(function(resolve,reject){
      var old=document.getElementById('accazaFormDialog');if(old)old.remove();
      var mask=document.createElement('div');mask.id='accazaFormDialog';mask.setAttribute('role','dialog');mask.setAttribute('aria-modal','true');mask.setAttribute('aria-labelledby','afdTitle');mask.style.cssText='position:fixed;inset:0;z-index:32000;background:rgba(17,28,20,.72);display:flex;align-items:center;justify-content:center;padding:1rem;font-family:Inter,sans-serif;';
      mask.innerHTML='<form style="background:#f8f4ed;border:1px solid #b08d57;border-radius:12px;max-width:'+(config.width||'500px')+';width:100%;max-height:92vh;overflow:auto;box-shadow:0 18px 60px rgba(0,0,0,.45);" novalidate><div style="background:#19241b;color:#f5f0e8;padding:1rem 1.15rem;border-radius:11px 11px 0 0;border-bottom:3px double #b08d57;"><div style="font-size:.66rem;letter-spacing:.18em;text-transform:uppercase;color:#cdb996;">Accaza control record</div><h2 id="afdTitle" style="font:600 1.22rem Playfair Display,serif;margin:.18rem 0 0;">'+esc(config.title||'Enter details')+'</h2>'+(config.subtitle?'<p style="font-size:.78rem;color:#d9cdbf;margin:.3rem 0 0;line-height:1.45;white-space:pre-line;">'+esc(config.subtitle)+'</p>':'')+'</div><div style="padding:1.1rem;display:grid;gap:.85rem;">'+fields.map(fieldHtml).join('')+'<div data-afd-error role="alert" style="display:none;background:#fff0ef;border:1px solid #efb7b2;color:#8b1e1e;border-radius:7px;padding:.6rem .7rem;font-size:.78rem;line-height:1.45;"></div><div style="display:flex;gap:.55rem;justify-content:flex-end;padding-top:.2rem;"><button type="button" data-afd-cancel style="border:1px solid #cdbda9;background:#fff;color:#66584b;border-radius:7px;padding:.65rem 1rem;cursor:pointer;font-weight:600;">Cancel</button><button type="submit" data-afd-submit style="border:0;background:#44523f;color:#fff;border-radius:7px;padding:.65rem 1.1rem;cursor:pointer;font-weight:700;">'+esc(config.submitLabel||'Continue')+'</button></div></div></form>';
      document.body.appendChild(mask);var form=mask.querySelector('form'),error=mask.querySelector('[data-afd-error]'),button=mask.querySelector('[data-afd-submit]'),cancel=mask.querySelector('[data-afd-cancel]'),closed=false;
      function close(value,isCancel){if(closed)return;closed=true;mask.remove();if(isCancel){var e=new Error('cancelled');e.code='cancelled';reject(e);}else resolve(value);}
      cancel.onclick=function(){close(null,true);};mask.addEventListener('keydown',function(e){if(e.key==='Escape'&&!button.disabled)close(null,true);});
      form.onsubmit=function(event){event.preventDefault();error.style.display='none';var values={};try{fields.forEach(function(f){var el=mask.querySelector('[data-afd="'+f.name+'"]'),v=f.type==='checkbox'?!!el.checked:String(el.value||'').trim();if(f.type==='number'&&v!=='')v=Number(v);if(f.required&&(v===''||v==null||v===false))throw new Error(f.label+' is required.');if(f.type==='number'&&v!==''&&!Number.isFinite(v))throw new Error(f.label+' must be a valid number.');if(f.min!=null&&v!==''&&Number(v)<Number(f.min))throw new Error(f.label+' must be at least '+f.min+'.');if(f.max!=null&&v!==''&&Number(v)>Number(f.max))throw new Error(f.label+' cannot exceed '+f.max+'.');if(f.validate){var msg=f.validate(v,values);if(msg)throw new Error(msg);}values[f.name]=v;});}catch(e){error.textContent=e.message;error.style.display='block';return;}
        button.disabled=true;cancel.disabled=true;var oldLabel=button.textContent;button.textContent=config.busyLabel||'Saving…';
        Promise.resolve().then(function(){return submit?submit(values):values;}).then(function(result){close(result===undefined?values:result,false);}).catch(function(e){button.disabled=false;cancel.disabled=false;button.textContent=oldLabel;if(e&&e.code==='cancelled'){error.textContent='Approval was cancelled. Your entries are still here.';}else error.textContent=String((e&&e.message)||e||'The action failed. Nothing was changed.');error.style.display='block';});
      };
      var first=mask.querySelector('input:not([type="checkbox"]),textarea,select');if(first)setTimeout(function(){first.focus();if(first.tagName!=='SELECT'&&first.select)first.select();},30);
    });
  }
  // One-button in-page message (no fields). Resolves when closed either way.
  function notice(message,title){return run({title:title||'Accaza',subtitle:String(message==null?'':message),submitLabel:'OK',fields:[]},null).catch(function(){return null;});}
  function saleDetailsLink(id,label){
    return '<button type="button" data-sale-details="'+esc(id)+'" aria-haspopup="dialog" style="background:none;border:0;padding:0;color:var(--bd);cursor:pointer;text-decoration:underline;font:inherit;">'+esc(label)+'</button>';
  }
  function openSaleDetails(order,trigger){
    var dialog=document.createElement('dialog');
    dialog.setAttribute('aria-labelledby','accaza-sale-details-title');
    dialog.style.cssText='width:min(26rem,calc(100% - 2rem));border:1px solid var(--cd);border-radius:10px;padding:1.25rem;background:var(--cr);color:var(--bd);';
    var shiftId=String(order.shiftId||'');
    dialog.innerHTML='<h2 id="accaza-sale-details-title" style="font-size:1.05rem;margin:0 0 .75rem;">Sale details</h2>'
      +'<div><b>Shift reference</b><div data-shift-reference role="status">'+(shiftId?'Loading shift…':'No shift linked')+'</div></div>'
      +'<dl style="margin:.8rem 0;"><dt>POS reference</dt><dd style="margin:0 0 .5rem;">'+esc(order.id)+'</dd>'
      +(order.platformRef?'<dt>Platform reference</dt><dd style="margin:0 0 .5rem;">'+esc(order.platformRef)+'</dd>':'')
      +'<dt>Sale date</dt><dd style="margin:0;">'+esc([order.date,order.time].filter(Boolean).join(' · ')||'Unavailable')+'</dd></dl>'
      +'<details data-shift-details hidden style="margin-bottom:.8rem;"><summary>Open shift details</summary><p style="margin:.5rem 0;"></p></details>'
      +'<form method="dialog"><button class="pz-btn sec" autofocus>Close</button></form>';
    document.body.append(dialog);
    dialog.addEventListener('close',function(){dialog.remove();if(trigger.isConnected)trigger.focus();},{once:true});
    dialog.showModal();
    if(!shiftId)return;
    var reference=dialog.querySelector('[data-shift-reference]');
    Promise.resolve().then(function(){
      if (!/^[a-zA-Z0-9_-]+$/.test(shiftId)) throw new Error("Invalid shift key");
      var a=global.__accaza;
      return a.get(a.ref(a.db,'shifts/'+shiftId));
    }).then(function(snapshot){
      var shift=snapshot.val();
      if(!shift){reference.textContent='Shift details unavailable';return;}
      reference.textContent=shift.shiftReference||(shift.zReport&&shift.zReport.shiftReference)||'Reference unavailable';
      var details=dialog.querySelector('[data-shift-details]');
      var opened=Number(shift.openAt);
      var date=opened>0?new Date(opened).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'';
      details.querySelector('p').textContent=[shift.staff,date,(shift.status==='closed'?'Closed shift':shift.status==='open'?'Open shift':'')].filter(Boolean).join(' · ');
      details.hidden=false;
    }).catch(function(){reference.textContent='Shift details unavailable';});
  }
  function bindSaleDetails(root,getOrder){
    root.querySelectorAll('[data-sale-details]').forEach(function(button){
      button.onclick=function(){
        var order=getOrder(button.getAttribute('data-sale-details'));
        if(order)openSaleDetails(order,button);
      };
    });
  }
  global.AccazaSaleDetails={link:saleDetailsLink,bind:bindSaleDetails};
  global.AccazaFormDialog={run:run,open:function(config){return run(config,function(values){return values;});},notice:notice};
  // Safety net for blocked browser popups. Some embedded browsers (for example an app's built-in
  // browser pane) suppress alert/confirm and return immediately, so a button looks like it did
  // nothing. No person can answer a real popup in under 40 ms, so an instant answer means the
  // popup was blocked: say so on the page. Return values are unchanged, so every caller behaves
  // exactly as before (a blocked confirm is still "No").
  var BLOCKED_MS=40,nativeConfirm=global.confirm,nativeAlert=global.alert;
  if(typeof nativeConfirm==='function')global.confirm=function(message){var started=Date.now(),answer=nativeConfirm.call(global,message);if(!answer&&Date.now()-started<BLOCKED_MS)global.AccazaFormDialog.notice('Your browser blocked the confirmation popup, so nothing was done.\n\n'+String(message==null?'':message)+'\n\nOpen Accaza Admin in Chrome or Edge to continue.','Confirmation blocked');return answer;};
  if(typeof nativeAlert==='function')global.alert=function(message){var started=Date.now();nativeAlert.call(global,message);if(Date.now()-started<BLOCKED_MS)global.AccazaFormDialog.notice(message,'Message');};
})(window);
