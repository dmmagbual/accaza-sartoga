
function cashMove(dir){
  if(!activeShift){alert('Open a shift first.');return;}
  var shiftId=activeShift.id;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  var denom=denomTrackingOnR();
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:'+(denom?'520':'400')+'px;width:100%;max-height:90vh;overflow:auto;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.5rem;">Cash in — add to drawer</div>'
    +(denom?('<span class="pz-lbl">Notes/coins added</span>'+denomGridHtml('cmDenom')):'<div><span class="pz-lbl">Amount ₱</span><input class="pz-in" id="cmAmt" type="number" step="any"/></div>')
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Reason</span><select class="pz-in" id="cmReason"><option>Owner top-up</option><option>Change float</option><option>Return</option><option>Other</option></select></div>'
    +'<div style="margin-top:0.5rem;padding:0.45rem 0.55rem;background:#f4efe7;border-radius:6px;font-size:0.76rem;color:var(--tl);">Owner, Superadmin, Admin, or Manager approval is recorded when you submit.</div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="cmSubmit">Add to drawer</button><button class="pz-btn sec" id="cmCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  if(denom)wireDenom('cmDenom');
  mask.querySelector('#cmCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#cmSubmit').onclick=async function(){
    var amt, counts=null;
    if(denom){var rd=denomRead('cmDenom'); amt=rd.total; counts=rd.counts;} else { amt=Number(mask.querySelector('#cmAmt').value)||0; }
    if(!amt||amt<0){alert('Enter a valid amount / notes.');return;}
    var reason=mask.querySelector('#cmReason').value||'Other',a=A(),btn=this;if(!a.managerApproval||!a.consumeManagerApproval){alert('Privileged cash-in approval is unavailable. Refresh the portal.');return;}if(!activeShift||activeShift.id!==shiftId){alert('The active shift changed. Close this window and try again.');return;}btn.disabled=true;btn.textContent='Approving…';var sourceId='cash_in_'+shiftId+'_'+Date.now();
    try{var ap=await a.managerApproval('cash_in',sourceId,amt,reason);if(!activeShift||activeShift.id!==shiftId)throw new Error('The active shift changed before the cash-in was recorded.');var cr=await a.consumeManagerApproval({action:'cash_in',sourceId:sourceId,amount:amt,operationKey:sourceId,approvalId:ap.approvalId}),cd=(cr&&cr.data)||cr||{},approver=cd.approvedBy||'Privileged account';if(!activeShift||activeShift.id!==shiftId)throw new Error('The active shift changed before the cash-in was recorded.');var arr=(activeShift.payIns||[]).slice();arr.push({amount:amt,reason:reason,by:approver,approvedByUid:cd.approvedByUid||'',approvedRole:cd.approvedRole||'',ts:Date.now(),denoms:counts||null,approvalId:ap.approvalId});await Promise.all([a.update(a.ref(a.db,'shifts/'+shiftId),{payIns:arr}),a.update(a.ref(a.db,'posActiveShift'),{payIns:arr})]);if(denom&&counts)saveDrawer(mergeD(drawerNow(),counts));window.__posLog('cash-in',reason,peso(amt)+' by '+approver+' · '+ap.approvalId);document.body.removeChild(mask);alert('Recorded. Expected drawer increased by '+peso(amt)+'.');}catch(e){btn.disabled=false;btn.textContent='Add to drawer';if(String((e&&e.message)||e).indexOf('cancelled')<0)alert('Cash-in approval failed: '+((e&&e.message)||e));}
  };
}
function pendingPanel(){
  var all=Object.keys(ordersMap).map(function(k){return Object.assign({id:k},ordersMap[k]);}).filter(function(o){return !o.voided&&['grabfood','foodpanda'].indexOf(o.channel)<0;}).sort(function(a,b){return (a.timestamp||0)-(b.timestamp||0);}),list=all.filter(function(o){return o.paymentStatus==='pending';}),review=all.filter(function(o){return o.paymentStatus==='cashier_verified';});
  var tot=list.reduce(function(s,o){return s+(Number(o.total)||0);},0);
  var h='<div class="pz-card" style="margin-bottom:1rem;border:1px solid #ffe0a3;background:#fffdf5;">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:700;color:#8a6d1b;">⏳ Payments to verify</span><span style="font-weight:700;color:#8a6d1b;">'+peso(tot)+' · '+list.length+'</span></div>';
  if(!list.length){h+='<p class="pz-sub" style="margin:0.4rem 0 0;">Nothing awaiting payment verification.</p>';}else{
  h+='<p class="pz-sub" style="margin:0.3rem 0 0.6rem;">The saved policy decides whether the cashier may record the first check or a manager must verify directly.</p>';
  h+='<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr style="text-align:left;color:var(--tl);"><th style="padding:0.3rem;">Sale</th><th style="padding:0.3rem;">Amount</th><th style="padding:0.3rem;">Method</th><th style="padding:0.3rem;">Ref no.</th><th style="padding:0.3rem;">Time</th><th></th></tr></thead><tbody>';
  h+=list.map(function(o){var refs=(o.payments||[]).filter(function(p){return p.ref;}).map(function(p){return esc(p.ref);}).join(', ')||'—';var meth=(o.payments&&o.payments.length>1)?'Split':esc(o.payment||''),managerOnly=verificationPolicyForOrder(o)==='manager_only';return '<tr style="border-top:1px solid #eee;"><td style="padding:0.3rem;font-weight:600;">'+esc(o.id)+'</td><td style="padding:0.3rem;">'+peso(o.total)+'</td><td style="padding:0.3rem;">'+meth+'</td><td style="padding:0.3rem;">'+refs+'</td><td style="padding:0.3rem;color:var(--tl);">'+esc(o.time||'')+'</td><td style="padding:0.3rem;"><button class="pz-btn ok" '+(managerOnly?'data-validate':'data-verify')+'="'+esc(o.id)+'" style="padding:0.25rem 0.6rem;">'+(managerOnly?'Manager verify':'Cashier verify')+'</button></td></tr>';}).join('');
  h+='</tbody></table></div>';}
  h+='<div style="border-top:1px solid #eadfca;margin-top:.8rem;padding-top:.8rem;display:flex;justify-content:space-between;"><b style="color:#0c5460;">Manager revalidation</b><b>'+review.length+'</b></div>';
  if(!review.length)h+='<p class="pz-sub" style="margin:.35rem 0 0;">No cashier-verified payments awaiting review.</p>';else h+='<div style="overflow-x:auto;margin-top:.45rem;"><table style="width:100%;border-collapse:collapse;font-size:.8rem;"><tbody>'+review.map(function(o){var refs=paysOf(o).filter(function(p){return p.ref;}).map(function(p){return esc(p.ref);}).join(', ')||'—';return'<tr style="border-top:1px solid #eee;"><td style="padding:.35rem;font-weight:600;">'+esc(o.id)+'</td><td style="padding:.35rem;">'+peso(o.total)+'</td><td style="padding:.35rem;">'+esc(o.payment||'')+'</td><td style="padding:.35rem;">'+refs+'</td><td style="padding:.35rem;"><button class="pz-btn ok" data-validate="'+esc(o.id)+'" style="padding:.25rem .6rem;">Manager validate</button></td></tr>';}).join('')+'</tbody></table></div>';
  h+='</div>';
  return h;
}