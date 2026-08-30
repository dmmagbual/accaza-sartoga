
/* ══════════ PLATFORM PAYOUT RECONCILIATION ══════════ */
function poGross(o){return Number(o.grossPlatform||o.subtotal||o.total)||0;}
function poNet(o){return (o.netPlatform!=null)?(Number(o.netPlatform)||0):(poGross(o)-(Number(o.commission)||0)-(Number(o.platformDiscount)||0)-(Number(o.platformWht)||0)-(Number(o.platformVat)||0)-(Number(o.platformAdsMarketing)||0)-(Number(o.platformMarketingFee)||0));}
function poGrabDeductions(o){
  o=o||{};var mapped=o.platformMerchantPromo!=null||o.platformDeliveryFeeDiscount!=null,promo=mapped?(Number(o.platformMerchantPromo)||0):0,delivery=mapped?(Number(o.platformDeliveryFeeDiscount)||0):0;
  if(!mapped){(o.platformDiscountLines||[]).forEach(function(d){var amount=Number(d.amount)||0,category=String(d.category||'').toLowerCase(),label=String(d.type||'').toLowerCase();if(category==='delivery_fee_discount'||label.indexOf('delivery fee')>-1)delivery+=amount;else promo+=amount;});if(!(o.platformDiscountLines||[]).length)promo=Number(o.platformDiscount)||0;}
  return{merchantPromo:Math.round(promo*100)/100,deliveryFeeDiscount:Math.round(delivery*100)/100};
}
function refNorm(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function refEq(a,b){var x=refNorm(a),y=refNorm(b);if(!x||!y)return false;if(x===y)return true;var lo=x.length<y.length?x:y,hi=x.length<y.length?y:x;return lo.length>=5&&hi.slice(-lo.length)===lo;}
function settledPayoutOrderIds(){var ids={};Object.keys(payoutsMap).forEach(function(k){var p=payoutsMap[k]||{};if(p.reversed)return;(p.orderIds||[]).forEach(function(id){if(id)ids[id]=k;});});return ids;}
function platEntries(){var out=[];Object.keys(ordersMap).forEach(function(k){var o=ordersMap[k];if(o&&o.source==='pos'&&o.channel&&o.channel!=='instore'&&!o.voided)out.push({key:k,node:'orders',o:o});});Object.keys(archMap).forEach(function(k){var o=archMap[k];if(o&&o.source==='pos'&&o.channel&&o.channel!=='instore'&&!o.voided)out.push({key:k,node:'archivedOrders',o:o});});return out;}
function poUnsettled(ch){var paid=settledPayoutOrderIds();return platEntries().filter(function(e){var id=e.o.id||e.key;return e.o.channel===ch&&(e.o.settlementStatus||'unsettled')!=='settled'&&!paid[id];});}
function reKeyMissedOrder(ch,chLbl){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.recordPlatformCatchup||!a.managerApproval){alert('Re-key service unavailable. Refresh the portal.');return;}
  var rate=(typeof channelRate==='function')?(Number(channelRate(ch))||0):0;
  window.AccazaFormDialog.run({
    title:'Re-key a missed '+chLbl+' order',
    subtitle:'Records a '+chLbl+' order that was never entered in the POS. Books revenue, commission and the receivable on the order date. Stock is NOT deducted — reconcile small differences in inventory.',
    submitLabel:'Record missed order',
    busyLabel:'Recording…',
    fields:[
      {name:'ref',label:chLbl+' order number',type:'text',required:true,maxLength:60,placeholder:(ch==='grabfood'?'GF-123456':'FP-123456')},
      {name:'date',label:'Order date',type:'date',required:true},
      {name:'gross',label:'Gross amount (₱)',type:'number',required:true,min:0.01},
      {name:'commission',label:'Commission (₱)'+(rate?(' — about '+(rate*100).toFixed(1)+'% of gross'):''),type:'number',required:true,min:0,validate:function(v,vals){if(Number(v)>Number(vals.gross||0)+0.009)return 'Commission cannot exceed the gross amount.';}},
      {name:'reference',label:'Reference / reason (audit trail)',type:'text',required:true,maxLength:200,value:'Missed '+chLbl+' order — late entry'}
    ]
  },function(v){
    return a.managerApproval('rekey_platform_order',v.ref,Number(v.gross),v.reference).then(function(ap){
      return a.recordPlatformCatchup({channel:ch,platformRef:v.ref,date:v.date,gross:Number(v.gross),commission:Number(v.commission),commissionRate:rate,reference:v.reference,approvalId:ap.approvalId});
    }).then(function(r){return (r&&r.data)||r||{};});
  }).then(function(d){
    if(!d)return;
    renderPayouts();
    alert('Recorded missed '+chLbl+' order '+(d.platformRef||'')+'. Net receivable '+peso(d.net||0)+' posted and now appears as unsettled.');
  }).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not record the missed order: '+m);});
}
function voidPayoutOrder(orderId,gross){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.processOrderAdjustment||!a.managerApproval){alert('Void service unavailable. Refresh the portal.');return;}
  window.AccazaFormDialog.run({
    title:'Void order '+orderId,
    subtitle:'Reverses this order’s revenue and platform receivable and removes it from the open list. Use for duplicates or mistaken entries. The voided record is kept for audit.',
    submitLabel:'Request approval & void',
    busyLabel:'Voiding…',
    fields:[{name:'reason',label:'Void reason',type:'textarea',required:true,maxLength:300,placeholder:'e.g. Duplicate of GF-855'},{name:'confirmed',label:'I confirm this order should be voided',type:'checkbox',required:true}]
  },function(v){
    return a.managerApproval('void',orderId,Number(gross)||0,v.reason).then(function(ap){
      return a.processOrderAdjustment({action:'void',orderId:orderId,reason:v.reason,approvalId:ap.approvalId});
    });
  }).then(function(){if(ordersMap[orderId])ordersMap[orderId].voided=true;if(archMap[orderId])archMap[orderId].voided=true;renderPayouts();alert('Order '+orderId+' voided. It no longer appears in the open payout list.');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not void the order: '+m);});
}
function reversePayout(payoutId,chLbl){
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var a=A();
  if(!a||!a.reversePlatformPayout||!a.managerApproval){alert('Reverse service unavailable. Refresh the portal.');return;}
  window.AccazaFormDialog.run({
    title:'Reverse settled '+chLbl+' payout',
    subtitle:'Unwinds this settlement: its orders go back to unsettled and the ledger posting is reversed, so you can re-settle correctly. The payout record is kept and marked reversed.',
    submitLabel:'Request approval & reverse',
    busyLabel:'Reversing…',
    fields:[{name:'reason',label:'Reversal reason',type:'textarea',required:true,maxLength:300,placeholder:'e.g. Wrong actual amount / orders included by mistake'},{name:'confirmed',label:'I understand the orders return to unsettled and the posting is reversed',type:'checkbox',required:true}]
  },function(v){
    return a.managerApproval('reverse_platform_payout',payoutId,null,v.reason).then(function(ap){
      return a.reversePlatformPayout({payoutId:payoutId,reason:v.reason,approvalId:ap.approvalId});
    }).then(function(r){return (r&&r.data)||r||{};});
  }).then(function(d){renderPayouts();alert('Payout reversed. '+((d&&d.orderCount)||0)+' order(s) returned to unsettled and can be re-settled.');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not reverse the payout: '+m);});
}
function correctPlatformPresettlement(ch,chLbl,platformRef,entries){
  var a=A();if(!a||!a.correctPlatformPresettlement||!a.managerApproval){alert('Pre-settlement correction service unavailable. Refresh the portal.');return;}
  if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
  var choose=platformRef?Promise.resolve({platformRef:platformRef}):window.AccazaFormDialog.open({title:'Pre-settlement correction',subtitle:'Choose an unsettled '+chLbl+' order from the current list.',submitLabel:'Continue',fields:[{name:'platformRef',label:chLbl+' unsettled order',type:'select',required:true,options:(entries||[]).map(function(e){var o=e.o||{};return{value:o.platformRef||o.id||e.key,label:(o.platformRef||o.id||e.key)+' — '+peso(poGross(o))+' — '+(o.date||'date unavailable')};})}]});
  choose.then(function(v){return a.correctPlatformPresettlement({action:'lookup',channel:ch,platformRef:v.platformRef}).then(function(r){return(r&&r.data)||r||{};});})
  .then(function(found){
    if((found.settlementStatus||'unsettled')==='settled')throw new Error('This order is already settled. Reverse the payout before correcting it.');
    return window.AccazaFormDialog.run({title:'Correct '+found.platformRef+' before settlement',subtitle:'Current gross '+peso(found.gross)+'. Correct the platform reference and verified statement figures. Amount changes update Finance Books; reference-only changes are audit-only. Items, COGS, and inventory do not change.',submitLabel:'Approve & correct',busyLabel:'Posting correction…',fields:[
      {name:'newPlatformRef',label:'Correct '+chLbl+' order reference',type:'text',required:true,maxLength:60,value:found.platformRef},
      {name:'gross',label:'Verified gross order value (₱)',type:'number',required:true,min:0.01,value:found.gross},
      {name:'commission',label:'Verified commission (₱)',type:'number',required:true,min:0,value:found.commission,validate:function(v,vals){return Number(v)>Number(vals.gross||0)+0.009?'Commission cannot exceed verified gross.':'';}},
      {name:'merchantPromo',label:'Merchant-funded promo (₱)',type:'number',required:true,min:0,value:found.merchantPromo||0},
      {name:'deliveryFeeDiscount',label:'Delivery-fee discount (₱)',type:'number',required:true,min:0,value:found.deliveryFeeDiscount||0},
      {name:'adsMarketing',label:'Marketing / advertisements (₱)',type:'number',required:true,min:0,value:found.adsMarketing||0},
      {name:'marketingFee',label:'Marketing fee (₱)',type:'number',required:true,min:0,value:found.marketingFee||0,validate:function(v,vals){var deductions=Number(vals.commission||0)+Number(vals.merchantPromo||0)+Number(vals.deliveryFeeDiscount||0)+Number(vals.adsMarketing||0)+Number(v||0);return deductions>Number(vals.gross||0)+0.009?'Total verified deductions cannot exceed verified gross.':'';}},
      {name:'reason',label:'Correction reason',type:'textarea',required:true,maxLength:300,value:'Correct cashier entry to '+chLbl+' payout statement'},
      {name:'confirmed',label:'Items and quantities are correct; inventory must remain unchanged',type:'checkbox',required:true}
    ]},function(v){
      var correctedNet=Number(v.gross)-Number(v.commission)-Number(v.merchantPromo)-Number(v.deliveryFeeDiscount)-Number(v.adsMarketing)-Number(v.marketingFee)-Number(found.wht||0)-Number(found.vat||0),difference=Math.round(Math.abs(Number(found.net)-correctedNet)*100)/100;
      return a.managerApproval('correct_platform_presettlement',found.orderId,difference,v.reason).then(function(ap){return a.correctPlatformPresettlement({action:'correct',channel:ch,platformRef:found.platformRef,newPlatformRef:v.newPlatformRef,gross:Number(v.gross),commission:Number(v.commission),merchantPromo:Number(v.merchantPromo),deliveryFeeDiscount:Number(v.deliveryFeeDiscount),adsMarketing:Number(v.adsMarketing),marketingFee:Number(v.marketingFee),reason:v.reason,approvalId:ap.approvalId});}).then(function(r){return(r&&r.data)||r||{};});
    });
  }).then(function(d){renderPayouts();alert('Corrected '+d.previousPlatformRef+' to '+d.platformRef+' with gross '+peso(d.gross)+'. Net receivable is now '+peso(d.net)+'. '+(d.financialPosted?'Finance Books received the balanced amount correction. ':'The reference-only change required no journal entry. ')+'Sales History and the audit trail were updated; inventory was unchanged.');})
  .catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not apply pre-settlement correction: '+m);});
}
function editPayoutMetadata(payoutId){
  var payout=payoutsMap[payoutId]||{},a=A();
  if(!payoutId||!payout.id&&!payoutsMap[payoutId]){alert('This platform payout is no longer available. Refresh the portal and try again.');return;}
  if(!a||!a.setPlatformPayoutDate||!window.AccazaFormDialog){alert('Payout editing is not ready. Refresh the portal and try again.');return;}
  window.AccazaFormDialog.run({title:'Edit payout information',subtitle:'Update supporting references and notes only. The payout amount, linked orders, receiving account, and Finance Books posting will not change.',submitLabel:'Save information',busyLabel:'Saving…',fields:[
    {name:'payoutDate',label:'Actual payout date',type:'date',value:payout.payoutDate||''},
    {name:'platformStatementReference',label:'Platform statement / settlement ID',type:'text',maxLength:120,value:payout.platformStatementReference||'',placeholder:'e.g. Grab settlement ID'},
    {name:'depositReference',label:'Bank transaction / deposit reference',type:'text',maxLength:120,value:payout.depositReference||'',placeholder:'Required when the payout was deposited'},
    {name:'notes',label:'Notes',type:'textarea',maxLength:500,value:payout.notes||'',placeholder:'Optional explanation or supporting detail'}
  ]},function(v){return a.setPlatformPayoutDate({payoutId:payoutId,payoutDate:v.payoutDate||'',platformStatementReference:v.platformStatementReference||'',depositReference:v.depositReference||'',notes:v.notes||''}).then(function(r){return(r&&r.data)||r||{};});}).then(function(){(window.accazaToast||function(){})('Payout information saved. Finance Books was not changed.','ok');}).catch(function(e){var m=String((e&&e.message)||(e&&e.code)||e);if(m.indexOf('cancelled')<0)alert('Could not save payout information: '+m);});
}
function renderPayouts(){
  var root=document.getElementById('payoutsRoot');if(!root)return;
  var a=A();
  if(a){var seed={};DEFAULT_VAR_ACCOUNTS.forEach(function(d){if(!varAcctMap[d.id])seed[d.id]={name:d.name,type:d.type,order:d.order};});if(Object.keys(seed).length)a.update(a.ref(a.db,'platformVarAccounts'),seed).catch(function(){});}
  var ch=poChannel;var chLbl=(PO_CHANNELS.filter(function(d){return d.k===ch;})[0]||{lbl:ch}).lbl;
  var accs=varAccounts();
  var unset=poUnsettled(ch);
  var owingOutstandingCh=Math.round(Object.keys(payoutsMap).reduce(function(sum,k){var p=payoutsMap[k]||{};return (p.channel===ch&&!p.reversed&&(Number(p.owingOutstanding)||0)>0.009)?sum+(Number(p.owingOutstanding)||0):sum;},0)*100)/100;
  var inRange=unset.filter(function(e){var t=e.o.timestamp||0;return (!poFrom||t>=dayStart(poFrom))&&(!poTo||t<dayStart(poTo)+86400000);});
  var expected=inRange.reduce(function(s,e){return s+poNet(e.o);},0);
  var grossSum=inRange.reduce(function(s,e){return s+poGross(e.o);},0);
  var commSum=inRange.reduce(function(s,e){return s+(Number(e.o.commission)||0);},0);
  var promoSum=inRange.reduce(function(s,e){return s+poGrabDeductions(e.o).merchantPromo;},0);
  var deliveryDiscSum=inRange.reduce(function(s,e){return s+poGrabDeductions(e.o).deliveryFeeDiscount;},0);
  var adsMarketingSum=inRange.reduce(function(s,e){return s+(Number(e.o.platformAdsMarketing)||0);},0);
  var marketingFeeSum=inRange.reduce(function(s,e){return s+(Number(e.o.platformMarketingFee)||0);},0);
  // receivables (all unsettled, ignoring range)
  var recvCards=PO_CHANNELS.map(function(d){var u=poUnsettled(d.k);var net=u.reduce(function(s,e){return s+poNet(e.o);},0);return '<div style="flex:1;min-width:170px;background:var(--cr);border:1px solid var(--cd);border-radius:8px;padding:0.7rem 0.9rem;"><div style="font-size:0.72rem;color:var(--tl);text-transform:uppercase;letter-spacing:0.05em;">'+esc(d.lbl)+' receivable</div><div style="font-size:1.2rem;font-weight:700;color:var(--bd);">'+peso(net)+'</div><div style="font-size:0.72rem;color:var(--tl);">'+u.length+' unsettled order(s)</div></div>';}).join('');
  inRange.sort(function(x,y){return (x.o.timestamp||0)-(y.o.timestamp||0);});
  var ordRows=inRange.length?inRange.map(function(e,i){var o=e.o,pr=o.platformRef||o.id||e.key,d=poGrabDeductions(o);return '<tr><td style="text-align:center;"><input type="checkbox" data-poinc="'+i+'" checked/></td><td>'+esc(o.date||'')+'</td><td><button type="button" data-pocorrect="'+esc(pr)+'" class="pz-btn sec" style="padding:0.18rem 0.48rem;font-size:0.75rem;border-color:#b07a2b;color:#80520f;" title="Correct this unsettled order before settlement">'+esc(pr)+'</button></td><td class="r">'+peso(poGross(o))+'</td><td class="r">'+peso(d.merchantPromo)+'</td><td class="r">'+peso(Number(o.commission)||0)+'</td><td class="r">'+peso(d.deliveryFeeDiscount)+'</td><td class="r">'+peso(Number(o.platformAdsMarketing)||0)+'</td><td class="r">'+peso(Number(o.platformMarketingFee)||0)+'</td><td class="r">'+peso(poNet(o))+'</td><td class="r"><button class="pz-btn warn" data-povoid="'+esc(o.id||e.key)+'" data-povg="'+(poGross(o))+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;" title="Void this order (e.g. a duplicate)">Void</button></td></tr>';}).join(''):'<tr><td colspan="11" class="az-note" style="padding:0.7rem;">No unsettled '+esc(chLbl)+' orders in this range.</td></tr>';
  var allocRows=accs.map(function(ac){var payoutSourced=ac.id==='va_refund'||ac.id==='va_refund_recovery',captured=ac.id==='va_ads'?adsMarketingSum:(ac.id==='va_marketing_success'?marketingFeeSum:0),capturedNote=(ac.id==='va_ads'||ac.id==='va_marketing_success')?'<div style="font-size:0.68rem;color:#256b52;margin-top:0.15rem;">Already captured on selected orders: '+peso(captured)+'. Enter only an additional payout-level amount.</div>':'';return '<tr><td>'+esc(ac.name)+' <span style="font-size:0.7rem;color:var(--tl);">('+ac.type+')</span>'+capturedNote+(payoutSourced?'<div style="font-size:0.68rem;color:var(--tl);margin-top:0.15rem;">Source is recorded automatically from this payout</div>':'')+'</td><td style="width:220px;"><div style="display:flex;gap:0.3rem;align-items:center;"><input class="pz-in" type="number" min="0" step="any" data-alloc="'+esc(ac.id)+'" data-atype="'+ac.type+'" value="" placeholder="Additional only" style="text-align:right;"/><button class="pz-btn sec" data-allocfill="'+esc(ac.id)+'" title="Put the remaining unallocated payout-level amount here to balance" style="padding:0.15rem 0.4rem;font-size:0.72rem;white-space:nowrap;">⚖ Fill</button></div></td></tr>';}).join('');
  var hist=Object.keys(payoutsMap).map(function(k){return Object.assign({id:k},payoutsMap[k]);}).filter(function(p){return p.channel===ch;}).sort(function(a,b){return (b.settledAt||0)-(a.settledAt||0);});
  var histRows=hist.length?hist.map(function(p){var reference=p.depositReference||p.platformStatementReference||'—',edit='<button class="pz-btn sec" data-poedit="'+esc(p.id)+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;" title="Edit statement, bank reference and notes">Edit info</button>';return '<tr'+(p.reversed?' style="opacity:0.6;"':'')+'><td>'+esc(new Date(p.settledAt||0).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}))+'</td><td>'+(p.reversed?(p.payoutDate?esc(p.payoutDate):'—'):'<input type="date" class="pz-in" data-podate="'+esc(p.id)+'" value="'+esc(p.payoutDate||'')+'" style="padding:0.15rem 0.35rem;font-size:0.74rem;width:140px;" title="Actual payout date from the platform statement"/>')+'</td><td>'+esc(reference)+'</td><td class="r">'+peso(p.expectedNet)+'</td><td class="r">'+peso(p.actualPayout)+'</td><td class="r '+((Number(p.variance)||0)<0?'az-down':(Number(p.variance)||0)>0?'az-up':'')+'">'+peso(p.variance)+'</td><td class="r">'+((p.orderIds||[]).length)+'</td><td class="r">'+edit+' '+(p.reversed?'<span style="color:var(--tl);font-size:0.72rem;">reversed</span>':'<button class="pz-btn sec" data-porev="'+esc(p.id)+'" style="padding:0.15rem 0.5rem;font-size:0.72rem;border-color:#b46a3a;color:#8a4a1a;" title="Reverse this settlement — orders return to unsettled">Reverse</button>')+'</td></tr>';}).join(''):'<tr><td colspan="8" class="az-note" style="padding:0.6rem;">No payouts settled yet for '+esc(chLbl)+'.</td></tr>';

  var html='<div class="pz-h">💱 Platform Payout Reconciliation</div>'
    +'<p class="pz-sub">Weekly truth-up per platform. POS gross is booked as revenue and the flat commission as expense; here you enter the <b>actual payout</b> from Grab/Panda and allocate the difference to named accounts. Every peso is explained.</p>'
    +'<div style="display:flex;gap:0.7rem;flex-wrap:wrap;margin-bottom:1rem;">'+recvCards+'</div>'
    +'<div class="pz-card" style="margin-bottom:1rem;">'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:end;margin-bottom:0.8rem;">'
        +'<div><span class="pz-lbl">Platform</span><select class="pz-in" id="poCh">'+PO_CHANNELS.map(function(d){return '<option value="'+d.k+'"'+(d.k===ch?' selected':'')+'>'+d.lbl+'</option>';}).join('')+'</select></div>'
        +'<div><span class="pz-lbl">From</span><input type="date" class="pz-in" id="poFrom" value="'+(poFrom||'')+'"/></div>'
        +'<div><span class="pz-lbl">To</span><input type="date" class="pz-in" id="poTo" value="'+(poTo||'')+'"/></div>'
        +'<div style="font-size:0.74rem;color:var(--tl);">Leave dates blank to reconcile <b>all</b> unsettled '+esc(chLbl)+' orders.</div>'
        +'<div style="margin-left:auto;display:flex;gap:0.4rem;flex-wrap:wrap;"><button class="pz-btn sec" id="poCorrect" style="border-color:#b07a2b;color:#80520f;">✎ Pre-settlement correction</button><button class="pz-btn sec" id="poReKey" style="border-color:#3a8a6a;color:#256b52;">➕ Re-key missed order</button></div>'
      +'</div>'
      +'<details style="margin-bottom:0.6rem;"><summary style="cursor:pointer;font-weight:600;color:var(--bd);font-size:0.85rem;">📄 Match to payout statement (optional)</summary>'
        +'<div style="margin-top:0.4rem;"><span class="pz-lbl">Paste the order numbers from the '+esc(chLbl)+' payout report (one per line or comma-separated)</span><textarea class="pz-in" id="poStmt" rows="3" placeholder="'+(ch==='grabfood'?'GF-123456, GF-123457, GF-123460':'FP-123456, FP-123457')+'" style="width:100%;font-size:0.8rem;"></textarea><button class="pz-btn sec" id="poMatch" style="margin-top:0.4rem;">Match &amp; tick</button><div id="poMatchInfo" style="font-size:0.78rem;margin-top:0.4rem;"></div></div></details>'
      +'<p class="pz-sub" style="margin-top:0;">Tick only the orders that appear on <b>this</b> payout statement. Untick any that aren’t paid this cycle — they stay unsettled and roll to the next payout automatically.</p>'
      +'<div style="overflow-x:auto;"><table class="pnl-tbl"><thead><tr><th style="text-align:center;"><input type="checkbox" id="poAll" checked title="Select all"/></th><th>Date</th><th>Order #</th><th class="r">Gross</th><th class="r">Merchant promo</th><th class="r">Commission</th><th class="r">Delivery discount</th><th class="r">Marketing / adverts</th><th class="r">Marketing fee</th><th class="r">Expected net</th><th></th></tr></thead><tbody>'+ordRows
        +'<tr class="tot"><td></td><td colspan="2">Expected net (<span id="poCount">'+inRange.length+'</span> ticked)</td><td class="r" id="poGrossSum">'+peso(grossSum)+'</td><td class="r" id="poPromoSum">'+peso(promoSum)+'</td><td class="r" id="poCommSum">'+peso(commSum)+'</td><td class="r" id="poDeliveryDiscSum">'+peso(deliveryDiscSum)+'</td><td class="r" id="poAdsMarketingSum">'+peso(adsMarketingSum)+'</td><td class="r" id="poMarketingFeeSum">'+peso(marketingFeeSum)+'</td><td class="r" id="poExpected">'+peso(expected)+'</td><td></td></tr>'
      +'</tbody></table></div>'
      +(owingOutstandingCh>0?('<div style="margin-top:0.7rem;padding:0.55rem 0.75rem;border:1px solid #e6c07a;background:#fff8e8;border-radius:8px;font-size:0.8rem;color:#8a5a00;">⚠ Outstanding owing to '+esc(chLbl)+': <b>'+peso(owingOutstandingCh)+'</b> — this will be auto-netted from this payout.</div>'):'')
      +'<p class="pz-sub" style="margin:0.6rem 0 0;">Enter the <b>actual amount received</b>. Commission, merchant promo, delivery-fee discount, marketing/advertisements, and marketing fee saved on an order already reduce expected net and must not be entered again. Use settlement allocations only for payout-level amounts that cannot be assigned to an individual order. If penalties made the payout negative, the shortfall is recorded as owing and recovered from the next payout.</p>'
      +'<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:end;margin-top:0.9rem;">'
        +'<div><span class="pz-lbl">Actual payout received</span><input class="pz-in" type="number" step="any" id="poActual" placeholder="0" style="text-align:right;width:180px;"/></div>'
        +'<div style="align-self:center;"><span class="pz-lbl">Variance (actual − expected)</span><div id="poVariance" style="font-weight:700;font-size:1.05rem;">'+peso(0-expected)+'</div></div>'
      +'</div>'
      +'<div class="az-sec" style="margin-top:0.9rem;">Allocate remaining payout-level variance</div>'
      +'<p class="pz-sub" style="margin-top:0.2rem;">Do not repeat deductions already captured on individual orders. Enter only additional statement-level amounts: expense accounts reduce the payout and revenue accounts add. The allocations must equal the remaining variance before settlement.</p>'
      +'<table class="pz-tbl"><thead><tr><th>Account</th><th>Amount ₱</th></tr></thead><tbody>'+allocRows+'</tbody></table>'
      +'<div id="poBalance" style="margin-top:0.6rem;font-weight:600;"></div>'
      +'<button class="pz-btn ok" id="poSettle" style="margin-top:0.7rem;padding:0.6rem 1.2rem;">Save &amp; settle '+esc(chLbl)+' payout</button>'
    +'</div>'
    +'<details style="margin-bottom:1rem;"><summary style="cursor:pointer;font-weight:600;color:var(--bd);">⚙️ Manage variance accounts</summary>'
      +'<div class="pz-card" style="margin-top:0.5rem;"><table class="pz-tbl"><tbody>'
        +accs.map(function(ac){return '<tr><td><input class="pz-in" data-acname="'+esc(ac.id)+'" value="'+esc(ac.name)+'"/></td><td style="width:130px;"><select class="pz-in" data-actype="'+esc(ac.id)+'"><option value="expense"'+(ac.type==='expense'?' selected':'')+'>expense</option><option value="revenue"'+(ac.type==='revenue'?' selected':'')+'>revenue</option></select></td><td style="width:60px;"><button class="pz-btn warn" data-acdel="'+esc(ac.id)+'" style="padding:0.2rem 0.5rem;">✕</button></td></tr>';}).join('')
        +'</tbody></table>'
        +'<div style="display:flex;gap:0.5rem;align-items:end;margin-top:0.6rem;flex-wrap:wrap;"><div><span class="pz-lbl">New account</span><input class="pz-in" id="poNewName" placeholder="e.g. FX adjustment" style="width:200px;"/></div><div><span class="pz-lbl">Type</span><select class="pz-in" id="poNewType"><option value="expense">expense</option><option value="revenue">revenue</option></select></div><button class="pz-btn sec" id="poAddAcc">+ Add</button><button class="pz-btn sec" id="poSaveAcc" style="margin-left:auto;">💾 Save account edits</button></div>'
      +'</div></details>'
    +'<div class="az-sec">Settled payouts — '+esc(chLbl)+'</div>'
    +'<div class="pz-card"><table class="pnl-tbl"><thead><tr><th>Settled</th><th>Payout date</th><th>Reference</th><th class="r">Expected</th><th class="r">Actual</th><th class="r">Variance</th><th class="r">Orders</th><th></th></tr></thead><tbody>'+histRows+'</tbody></table></div>';
  root.innerHTML=html;

  document.getElementById('poCh').onchange=function(){poChannel=this.value;renderPayouts();};
  document.getElementById('poFrom').onchange=function(){poFrom=this.value||null;renderPayouts();};
  document.getElementById('poTo').onchange=function(){poTo=this.value||null;renderPayouts();};
  var _rk=document.getElementById('poReKey'); if(_rk)_rk.onclick=function(){reKeyMissedOrder(ch,chLbl);};
  var _pc=document.getElementById('poCorrect'); if(_pc){_pc.disabled=!inRange.length;_pc.title=inRange.length?'Choose an unsettled order to correct':'No unsettled orders in the current list';_pc.onclick=function(){correctPlatformPresettlement(ch,chLbl,null,inRange);};}
  root.querySelectorAll('[data-pocorrect]').forEach(function(b){b.onclick=function(){correctPlatformPresettlement(ch,chLbl,b.getAttribute('data-pocorrect'));};});
  root.querySelectorAll('[data-povoid]').forEach(function(b){b.onclick=function(){voidPayoutOrder(b.getAttribute('data-povoid'),Number(b.getAttribute('data-povg'))||0);};});
  root.querySelectorAll('[data-porev]').forEach(function(b){b.onclick=function(){reversePayout(b.getAttribute('data-porev'),chLbl);};});
  root.querySelectorAll('[data-poedit]').forEach(function(b){b.onclick=function(){editPayoutMetadata(b.getAttribute('data-poedit'));};});
  root.querySelectorAll('[data-podate]').forEach(function(inp){inp.onchange=function(){var pid=inp.getAttribute('data-podate'),val=inp.value||'';var a=A();if(!a||!a.setPlatformPayoutDate){alert('Service unavailable. Refresh the portal.');return;}inp.disabled=true;a.setPlatformPayoutDate({payoutId:pid,payoutDate:val}).then(function(){if(payoutsMap[pid])payoutsMap[pid].payoutDate=val;(window.accazaToast||function(){})('Payout date saved.','ok');}).catch(function(e){alert('Could not save payout date: '+((e&&e.message)||e));}).finally(function(){inp.disabled=false;});};});
  var pendingPayoutId='';try{pendingPayoutId=sessionStorage.getItem('accazaOpenPayoutMetadata')||'';if(pendingPayoutId)sessionStorage.removeItem('accazaOpenPayoutMetadata');}catch(e){}if(pendingPayoutId)setTimeout(function(){editPayoutMetadata(pendingPayoutId);},0);
  function allocSum(){var rev=0,exp=0;root.querySelectorAll('[data-alloc]').forEach(function(i){var v=Number(i.value)||0;if(i.getAttribute('data-atype')==='revenue')rev+=v;else exp+=v;});return rev-exp;}
  function recompute(){var actual=Number((document.getElementById('poActual')||{}).value)||0;var variance=Math.round((actual-expected)*100)/100;var owingApply=(actual>=0)?owingOutstandingCh:0;var target=Math.round((variance+owingApply)*100)/100;var vEl=document.getElementById('poVariance');if(vEl){vEl.textContent=peso(variance);vEl.style.color=variance<0?'#c0392b':variance>0?'#2a9d5c':'var(--td)';}var alloc=Math.round(allocSum()*100)/100;var diff=Math.round((target-alloc)*100)/100;var bEl=document.getElementById('poBalance');var ok=Math.abs(diff)<0.01;if(bEl){bEl.innerHTML=(owingApply>0?('Prior owing '+peso(owingApply)+' auto-netted. '):'')+(actual<0?('Negative payout — '+peso(-actual)+' recorded as owing to '+esc(chLbl)+'. '):'')+'Allocate '+peso(target)+' (adjustments/penalties) — allocated '+peso(alloc)+' '+(ok?'<span style="color:#2a9d5c;">✓ balanced</span>':'<span style="color:#c0392b;">off by '+peso(diff)+' — click ⚖ Fill on your adjustment account</span>');}return ok;}
  var _pa=document.getElementById('poActual');if(_pa)_pa.oninput=recompute;
  root.querySelectorAll('[data-alloc]').forEach(function(i){i.oninput=recompute;});
  function allocTarget(){var actual=Number((document.getElementById('poActual')||{}).value)||0;var variance=Math.round((actual-expected)*100)/100;var owingApply=(actual>=0)?owingOutstandingCh:0;return Math.round((variance+owingApply)*100)/100;}
  function fillAlloc(id){var inp=root.querySelector('[data-alloc="'+id+'"]');if(!inp)return;var atype=inp.getAttribute('data-atype');var gap=Math.round((allocTarget()-Math.round(allocSum()*100)/100)*100)/100;var cur=Number(inp.value)||0;var nv=Math.round(((atype==='revenue')?(cur+gap):(cur-gap))*100)/100;if(nv<-0.005){alert('The remaining balance goes the other way — a '+atype+' account can’t hold it. Use a '+(atype==='expense'?'revenue':'expense')+' account (or check the actual payout you entered).');return;}inp.value=nv?nv:'';recompute();}
  root.querySelectorAll('[data-allocfill]').forEach(function(b){b.onclick=function(){fillAlloc(b.getAttribute('data-allocfill'));};});
  function selectedEntries(){return inRange.filter(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');return cb&&cb.checked;});}
  function recomputeSel(){var g=0,p=0,c=0,d=0,a=0,m=0,n=0,cnt=0;inRange.forEach(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');if(cb&&cb.checked){var parts=poGrabDeductions(e.o);g+=poGross(e.o);p+=parts.merchantPromo;c+=(Number(e.o.commission)||0);d+=parts.deliveryFeeDiscount;a+=(Number(e.o.platformAdsMarketing)||0);m+=(Number(e.o.platformMarketingFee)||0);n+=poNet(e.o);cnt++;}});expected=Math.round(n*100)/100;grossSum=g;promoSum=p;commSum=c;deliveryDiscSum=d;adsMarketingSum=a;marketingFeeSum=m;var gEl=document.getElementById('poGrossSum');if(gEl)gEl.textContent=peso(g);var pEl=document.getElementById('poPromoSum');if(pEl)pEl.textContent=peso(p);var cEl=document.getElementById('poCommSum');if(cEl)cEl.textContent=peso(c);var dEl=document.getElementById('poDeliveryDiscSum');if(dEl)dEl.textContent=peso(d);var aEl=document.getElementById('poAdsMarketingSum');if(aEl)aEl.textContent=peso(a);var mEl=document.getElementById('poMarketingFeeSum');if(mEl)mEl.textContent=peso(m);var eEl=document.getElementById('poExpected');if(eEl)eEl.textContent=peso(expected);var ctEl=document.getElementById('poCount');if(ctEl)ctEl.textContent=cnt;recompute();}
  root.querySelectorAll('[data-poinc]').forEach(function(cb){cb.onchange=recomputeSel;});
  var poAll=document.getElementById('poAll');if(poAll)poAll.onchange=function(){var ck=this.checked;root.querySelectorAll('[data-poinc]').forEach(function(cb){cb.checked=ck;});recomputeSel();};
  var pmB=document.getElementById('poMatch');if(pmB)pmB.onclick=function(){
    var raw=(document.getElementById('poStmt').value||'');
    var refs=raw.split(/[\n,;\t ]+/).map(function(s){return s.trim();}).filter(Boolean);
    if(!refs.length){alert('Paste the payout order numbers first.');return;}
    var stmtMatched={}, matchedInRange=0;
    inRange.forEach(function(e,i){var cb=root.querySelector('[data-poinc="'+i+'"]');if(!cb)return;var hit=false;refs.forEach(function(r,ri){if(refEq(r,e.o.platformRef)||refEq(r,e.o.id)){hit=true;stmtMatched[ri]=1;}});cb.checked=hit;if(hit)matchedInRange++;});
    recomputeSel();
    var allE=platEntries().filter(function(e){return e.o.channel===ch;});
    var unmatched=refs.filter(function(r,ri){return !stmtMatched[ri];});
    var rows=unmatched.map(function(r){var e=allE.filter(function(en){return refEq(r,en.o.platformRef)||refEq(r,en.o.id);})[0];var reason;if(!e)reason='<span style="color:#c0392b;">not in POS — possible missed re-key</span>';else if((e.o.settlementStatus||'unsettled')==='settled')reason='<span style="color:var(--tl);">already settled</span>';else reason='<span style="color:#8a6d1b;">unsettled but outside the current dates — widen the range, then re-match</span>';return '<div>• '+esc(r)+' — '+reason+'</div>';}).join('');
    var info=document.getElementById('poMatchInfo');if(info)info.innerHTML='<b>'+matchedInRange+'</b> of '+refs.length+' statement order(s) matched &amp; ticked here.'+(unmatched.length?('<div style="margin-top:0.3rem;font-weight:600;">'+unmatched.length+' not matched in the list above:</div>'+rows):' <span style="color:#2a9d5c;">all matched ✓</span>');
  };
  recomputeSel();
  document.getElementById('poSettle').onclick=function(){
    var selected=selectedEntries();
    if(!selected.length){alert('Tick at least one order that appears on this payout statement.');return;}
    var actual=Number((document.getElementById('poActual').value)||0);
    if(!recompute()){alert('Allocations must equal the variance before you can settle.');return;}
    if(!window.AccazaFormDialog){alert('Form service unavailable. Refresh the portal.');return;}
    var allocs={};root.querySelectorAll('[data-alloc]').forEach(function(i){var id=i.getAttribute('data-alloc'),v=Number(i.value)||0;if(v)allocs[id]=v;});
    var pid=uid('po_');
    var left=inRange.length-selected.length;
    var a2=A();if(!a2.settlePlatformPayout||!a2.managerApproval){alert('3D payout approval service is not available. Refresh the portal.');return;}
    var destinations=Object.keys(payoutCashAccounts).map(function(id){return Object.assign({id:id},payoutCashAccounts[id]||{});}).filter(function(x){return x.active!==false;}).sort(function(a,b){return (a.order||0)-(b.order||0)||String(a.name||'').localeCompare(String(b.name||''));});
    if(actual>0&&!destinations.length){alert('Add the receiving bank or GCash account in Finance / Books → Cash Flow before settling this payout.');return;}
    var defaultDestination='';if(ch==='grabfood'){var union=destinations.find(function(x){return /union\s*bank/i.test(String(x.name||''));});defaultDestination=union?union.id:'';}else{var panda=destinations.find(function(x){return /food\s*panda/i.test(String(x.name||''));});defaultDestination=panda?panda.id:'';}
    window.AccazaFormDialog.run({
      title:'Settle '+chLbl+' payout',
      subtitle:'Enter the payout date and select the account that actually received the money. Settlement and bank deposit post together. '+selected.length+' order(s), actual '+peso(actual)+'.',
      submitLabel:'Save & settle',
      busyLabel:'Settling…',
      fields:[{name:'payoutDate',label:'Payout date',type:'date',required:true},{name:'platformStatementReference',label:'Platform statement / settlement ID',type:'text',maxLength:120,placeholder:'Optional Grab or FoodPanda settlement ID'}].concat(actual>0?[{name:'destinationAccountId',label:'Deposited directly to',type:'select',required:true,value:defaultDestination,options:[{value:'',label:'— select receiving account —'}].concat(destinations.map(function(x){return{value:x.id,label:(x.name||x.id)+' · '+(x.type||'cash account')};})),help:ch==='grabfood'?'Select Union Bank unless the Grab statement shows a different receiving account.':'Select the dedicated FoodPanda GCash account.'},{name:'depositReference',label:'Bank transaction / payout reference',type:'text',required:true,maxLength:120,placeholder:'Enter the reference shown in the receiving account'}]:[])
    },function(v){
      return a2.managerApproval('settle_platform_payout',pid,actual,'Settle '+chLbl+' payout').then(function(ap){
        return a2.settlePlatformPayout({payoutId:pid,channel:ch,periodStart:(poFrom||''),periodEnd:(poTo||''),actualPayout:actual,allocations:allocs,orderIds:selected.map(function(e){return e.o.id||e.key;}),payoutDate:v.payoutDate,platformStatementReference:v.platformStatementReference||'',depositReference:v.depositReference||'',destinationAccountId:v.destinationAccountId||'',approvalId:ap.approvalId});
      }).then(function(r){return (r&&r.data)||r||{};});
    }).then(function(d){
      selected.forEach(function(e){var mp=(e.node==='archivedOrders')?archMap:ordersMap;var k=(e.o&&e.o.id)||e.key;if(mp[k])mp[k].settlementStatus='settled';});
      renderPayouts();
      alert('Settled '+(d.orderCount||0)+' '+chLbl+' order(s).'+(d.depositMovementId?' The actual payout was posted directly to the selected receiving account.':'')+(left>0?(' '+left+' left unticked stay unsettled and carry to the next payout.'):'')+((Number(d.owingCreated)||0)>0?(' '+peso(d.owingCreated)+' recorded as owing to '+chLbl+' (recovered next payout).'):'')+((Number(d.owingApplied)||0)>0?(' Prior owing '+peso(d.owingApplied)+' auto-netted.'):'')+' Server variance '+peso(d.variance)+' posted to the audit ledger.');
    }).catch(function(err){var m=String((err&&err.message)||(err&&err.code)||err);if(m.indexOf('cancelled')<0)alert('Could not settle payout: '+m+'. Nothing was settled.');});
  };
  var _add=document.getElementById('poAddAcc');if(_add)_add.onclick=function(){var nm=(document.getElementById('poNewName').value||'').trim();if(!nm){alert('Type an account name.');return;}var t=document.getElementById('poNewType').value;var a3=A();a3.set(a3.ref(a3.db,'platformVarAccounts/'+uid('va_')),{name:nm,type:t,order:accs.length+1}).then(function(){});};
  var _sav=document.getElementById('poSaveAcc');if(_sav)_sav.onclick=function(){var a4=A();var ups={};root.querySelectorAll('[data-acname]').forEach(function(i){var id=i.getAttribute('data-acname');var nm=(i.value||'').trim();var tp=(root.querySelector('[data-actype="'+id+'"]')||{}).value||'expense';if(nm)ups[id]={name:nm,type:tp,order:(varAcctMap[id]&&varAcctMap[id].order)||0};});a4.update(a4.ref(a4.db,'platformVarAccounts'),ups).then(function(){alert('Account edits saved.');});};
  root.querySelectorAll('[data-acdel]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-acdel');if(!confirm('Remove this variance account? Past settled payouts keep their figures.'))return;var a5=A();a5.remove(a5.ref(a5.db,'platformVarAccounts/'+id));};});
}