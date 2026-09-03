function addIngredient(){
  var name=(document.getElementById('invName').value||'').trim(); if(!name){alert('Enter an ingredient name.');return;}
  var type=(document.getElementById('invType')||{}).value||'base';
  var openingStock=Number(document.getElementById('invStock').value)||0, openingCost=Number(document.getElementById('invCost').value)||0;
  if(openingStock<0){alert('Opening stock cannot be negative. Use Adjust for a controlled count correction.');return;}
  if(openingStock>0&&!(document.getElementById('invOpeningConfirmed')||{}).checked){alert('Confirm that this opening stock is physically present and has not already been included in the system’s recorded physical count.');return;}
  if(openingStock>0&&!(openingCost>0)){alert('Enter the opening cost per unit so the physical stock receives the correct inventory value in Finance Books.');return;}
  var inventoryAccount=(document.getElementById('invAssetAccount')||{}).value||'',costAccount=(document.getElementById('invCostAccount')||{}).value||'';if(!inventoryAccount||!costAccount){alert('Choose both the Inventory Asset and Cost account.');return;}
  var maker=(window.__posShift&&window.__posShift.staff)||'Admin',unit=document.getElementById('invUnit').value,openingValue=Math.round(openingStock*openingCost*100)/100;
  if(!confirm('Confirm stock-item setup\n\nItem: '+name+'\nOpening stock: '+openingStock+' '+unit+'\nOpening cost: '+peso(openingCost)+' / '+unit+'\nOpening inventory value: '+peso(openingValue)+'\nMaker: '+maker+'\n\n'+(openingStock>0?'I confirm this stock is physically present and was not already counted or received.':'This creates the item with zero opening stock. Future deliveries must go through Purchases.')))return;
  var o={name:name,unit:document.getElementById('invUnit').value,type:type,recipeItem:!isSupplyType(type),category:(document.getElementById('invCat')||{}).value||'',inventoryAccount:inventoryAccount,costAccount:costAccount,stock:0,reorder:Number(document.getElementById('invReorder').value)||0,cost:0,updatedAt:Date.now()};
  if(type==='consumable'){ o.serves=(document.getElementById('invServes')||{}).value||'both'; o.size=(document.getElementById('invSize')||{}).value||''; o.qtyPerOrder=Number((document.getElementById('invQPO')||{}).value)||1; }
  var a=A(), id=uid('ing_'), sourceId=uid('new_');a.set(a.ref(a.db,'inventory/'+id),o).then(function(){
    return postMovements([{movementId:movementId('manual_edit',sourceId,id),itemId:id,type:'manual_edit',qty:openingStock,unitCost:openingCost,setCost:true,offsetAccount:'3000',adjustmentNature:'beginning-inventory',sourceType:'new-inventory-item',sourceId:sourceId,note:'Opening quantity confirmed by '+maker+' when item was created',actorName:maker,occurredAt:Date.now()}]);
  }).then(function(){ document.getElementById('invName').value='';document.getElementById('invStock').value='';document.getElementById('invCost').value='';document.getElementById('invOpeningConfirmed').checked=false; }).catch(function(e){ alert('Could not add the item: '+((e&&e.message)||e)+'. If the item appeared, do not create it again; use Adjust after reviewing the movement ledger.'); });
}
function adjustStock(id){
  var i=inventoryMap[id]; if(!i)return;
  var before=Number(i.stock)||0;
  var mask=document.createElement('div'); mask.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML='<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:1.2rem;">'
    +'<div style="font-weight:700;color:var(--bd);margin-bottom:0.2rem;">Adjust stock — '+esc(i.name)+'</div>'
    +'<p class="pz-sub" style="margin:0.2rem 0 0.7rem;">Book stock now: <b>'+num(before)+' '+esc(i.unit||'')+'</b></p>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.35rem;cursor:pointer;"><input type="radio" name="adjmode" value="count" checked/> Enter physical count (system computes the variance)</label>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.35rem;cursor:pointer;"><input type="radio" name="adjmode" value="delta"/> Enter a +/- adjustment (e.g. -3 wastage)</label>'
    +'<label style="display:block;font-size:0.85rem;margin-bottom:0.6rem;cursor:pointer;"><input type="radio" name="adjmode" value="reval"/> Restate the unit cost (weighted average) \u2014 no quantity change</label>'
    +'<div><span class="pz-lbl" id="adjLbl">Physical count ('+esc(i.unit||'units')+')</span><input class="pz-in" id="adjVal" type="number" step="any"/></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Reason</span><select class="pz-in" id="adjReason"><option value="count-variance">Physical count variance</option><option value="beginning-inventory">Beginning inventory correction</option><option value="wastage">Wastage / spoilage</option><option value="staff-drink">Staff drink</option><option value="extra-cup">Extra cup</option><option value="comp">Complimentary item</option><option value="other">Other</option></select></div>'
    +'<div style="margin-top:0.5rem;"><span class="pz-lbl">Finance offset account</span><select class="pz-in" id="adjOffset"><option value="5905">5905 · Inventory Reconciliation Gain / (Loss)</option><option value="5900">5900 · Wastage &amp; Spoilage</option><option value="3000">3000 · Owner\'s Capital (beginning inventory only)</option></select><div class="ei-help" style="margin-top:.25rem;">Inventory is the other side automatically. Choose one offset account for this adjustment.</div></div>'
    +'<div id="adjPreview" style="margin-top:0.6rem;font-size:0.82rem;color:var(--tm);"></div>'
    +'<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button class="pz-btn ok" id="adjSubmit">Apply adjustment</button><button class="pz-btn sec" id="adjCancel">Cancel</button></div></div>';
  document.body.appendChild(mask);
  function mode(){return (mask.querySelector('input[name=adjmode]:checked')||{}).value||'count';}
  function calcDelta(){var v=Number((mask.querySelector('#adjVal')||{}).value)||0;return mode()==='count'?(v-before):v;}
  function suggestedOffset(){var reason=(mask.querySelector('#adjReason')||{}).value||'count-variance';return reason==='beginning-inventory'?'3000':reason==='wastage'?'5900':'5905';}
  function isReval(){return mode()==='reval';}
  function revalDelta(){var nc=Number((mask.querySelector('#adjVal')||{}).value);if(!isFinite(nc)||nc<0)return null;return{newCost:nc,valueDelta:Math.round(before*(nc-(Number(i.cost)||0))*100)/100};}
  function syncOffsets(){
    /* A revaluation restates cost, so wastage is not an option; capital only for beginning inventory. */
    var sel=mask.querySelector('#adjOffset'),want=sel.value;
    var opts=isReval()?[['5905','5905 · Inventory Reconciliation Gain / (Loss)'],['3000','3000 · Owner\'s Capital (beginning inventory only)']]
      :[['5905','5905 · Inventory Reconciliation Gain / (Loss)'],['5900','5900 · Wastage & Spoilage'],['3000','3000 · Owner\'s Capital (beginning inventory only)']];
    sel.innerHTML=opts.map(function(o){return '<option value="'+o[0]+'">'+esc(o[1])+'</option>';}).join('');
    sel.value=opts.some(function(o){return o[0]===want;})?want:'5905';
  }
  function refreshReval(){
    var r=revalDelta(),cost=Number(i.cost)||0,offset=(mask.querySelector('#adjOffset')||{}).value||'5905';
    mask.querySelector('#adjLbl').textContent='New unit cost per '+(i.unit||'unit')+' (now '+peso(cost)+')';
    if(!r){mask.querySelector('#adjPreview').innerHTML='Enter the corrected unit cost.';return;}
    var vb=Math.round(before*cost*100)/100,va=Math.round(before*r.newCost*100)/100,dir=r.valueDelta>0?'Debit Inventory · Credit '+offset:'Debit '+offset+' · Credit Inventory';
    mask.querySelector('#adjPreview').innerHTML='Stock stays '+num(before)+' '+esc(i.unit||'')+'.<br/>Stock value '+peso(vb)+' → '+peso(va)+'<br/>'+(Math.abs(r.valueDelta)<0.005?'No value change — nothing will post.':'Finance entry: <b>'+dir+' '+peso(Math.abs(r.valueDelta))+'</b>')+'<br/><span style="color:var(--tl);">Completed orders keep the cost they were sold at. This changes what future orders consume.</span>';
  }
  function refresh(){if(isReval()){syncOffsets();refreshReval();return;}syncOffsets();var d=calcDelta();var after=before+d;var cost=Number(i.cost)||0,value=Math.abs(d*cost),offset=(mask.querySelector('#adjOffset')||{}).value||'5905',direction=d>0?'Debit Inventory · Credit '+offset:'Debit '+offset+' · Credit Inventory';mask.querySelector('#adjLbl').textContent=(mode()==='count'?'Physical count':'Adjustment +/-')+' ('+(i.unit||'units')+')';mask.querySelector('#adjPreview').innerHTML=d?('New stock: <b>'+num(after)+' '+esc(i.unit||'')+'</b><br/>Finance entry: <b>'+esc(direction)+' '+peso(value)+'</b>'):'';}
  mask.querySelectorAll('input[name=adjmode]').forEach(function(r){r.onchange=refresh;});
  mask.querySelector('#adjVal').oninput=refresh;
  mask.querySelector('#adjReason').onchange=function(){mask.querySelector('#adjOffset').value=suggestedOffset();refresh();};
  mask.querySelector('#adjOffset').onchange=refresh;
  mask.querySelector('#adjCancel').onclick=function(){document.body.removeChild(mask);};
  mask.querySelector('#adjSubmit').onclick=function(){
    if(isReval()){
      var r=revalDelta();if(!r){alert('Enter the corrected unit cost.');return;}
      if(Math.abs(r.valueDelta)<0.005){alert('That is the cost already on file — nothing to restate.');return;}
      if(!(before>0)){alert('There is no stock on hand, so there is no value to restate.');return;}
      var rr=mask.querySelector('#adjReason').value||'other',ro=mask.querySelector('#adjOffset').value||'5905';
      if(ro==='3000'&&rr!=='beginning-inventory'){alert('Owner\'s Capital may only be used for a beginning inventory correction.');return;}
      document.body.removeChild(mask);finalizeRevaluation(id,before,r.newCost,rr,ro);return;
    }
    var d=calcDelta();if(!d){alert('No change entered.');return;}var reason=mask.querySelector('#adjReason').value||'other',offset=mask.querySelector('#adjOffset').value||'';if(offset==='3000'&&reason!=='beginning-inventory'){alert('Owner\'s Capital may only be used for a beginning inventory correction.');return;}document.body.removeChild(mask);finalizeAdjust(id,before,d,reason,offset);};
  refresh();
}
function finalizeRevaluation(id,onHand,newCost,reason,offsetAccount){
  var i=inventoryMap[id]; if(!i)return;
  var oldCost=Number(i.cost)||0,valueDelta=Math.round(onHand*(newCost-oldCost)*100)/100;
  var a=A(),revId=uid('rev_'),mid=movementId('revaluation',revId,id),now=Date.now();
  postMovements([{movementId:mid,itemId:id,type:'revaluation',qty:0,unitCost:newCost,setCost:true,offsetAccount:offsetAccount,adjustmentNature:reason,sourceType:'inventory-revaluation',sourceId:revId,note:reason,actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:now}]).then(function(){
    return a.set(a.ref(a.db,'inventoryRevaluations/'+revId),{ing:id,name:i.name,unit:i.unit||'',onHand:onHand,costBefore:oldCost,costAfter:newCost,valueDelta:valueDelta,reason:reason,offsetAccount:offsetAccount,movementId:mid,ts:now});
  }).then(function(){
    if(window.__posLog)window.__posLog('inv-revalue',i.name,peso(oldCost)+' → '+peso(newCost)+' · '+num(onHand)+' '+(i.unit||'')+' on hand · offset '+offsetAccount+' · '+peso(Math.abs(valueDelta)));
    alert('Restated '+i.name+' to '+peso(newCost)+' per '+(i.unit||'unit')+'.\nFinance offset: '+offsetAccount+' · '+peso(Math.abs(valueDelta))+'.\nCompleted orders are unchanged; future orders consume at the new cost.');
  }).catch(function(e){alert('Revaluation FAILED — cost was not changed: '+((e&&e.message)||e));});
}
function finalizeAdjust(id,before,delta,reason,offsetAccount){
  var i=inventoryMap[id]; if(!i)return;
  var after=before+delta; var cost=Number(i.cost)||0; var varianceValue=-delta*cost;  /* stock down = +COGS */
  var a=A(), adjId=uid('adj_'), mid=movementId('adjustment',adjId,id), now=Date.now();
  postMovements([{movementId:mid,itemId:id,type:reason==='wastage'?'waste':'adjustment',qty:delta,unitCost:cost,offsetAccount:offsetAccount,adjustmentNature:reason,sourceType:'inventory-adjustment',sourceId:adjId,note:reason,actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:now}]).then(function(){
    return a.set(a.ref(a.db,'inventoryAdjustments/'+adjId),{ing:id,name:i.name,unit:i.unit||'',delta:delta,before:before,after:after,reason:reason,offsetAccount:offsetAccount,unitCost:cost,varianceValue:varianceValue,movementId:mid,ts:now});
  }).then(function(){
  var _invPct=(window.__posSettings&&window.__posSettings.tolerances&&Number(window.__posSettings.tolerances.invPct))||5;
  var _pctMove=before>0?Math.abs(delta)/before*100:(delta!==0?100:0);
  if(_pctMove>_invPct){
    a.set(a.ref(a.db,'discrepancies/'+uid('disc_')),{kind:'inventory',item:i.name,ing:id,expectedQty:before,actualQty:after,variance:delta,value:varianceValue,type:delta<0?'shortage':'overage',staff:(window.__posShift&&window.__posShift.staff)||'Admin',reason:reason,status:'open',ts:Date.now()});
  }
  if(window.__posLog)window.__posLog('inv-adjust',i.name,(delta>0?'+':'')+num(delta)+' '+(i.unit||'')+' · '+reason+' · offset '+offsetAccount+' · '+peso(Math.abs(varianceValue)));
  alert('Adjusted '+i.name+' to '+num(after)+' '+(i.unit||'')+'.\nFinance offset: '+offsetAccount+' · '+peso(Math.abs(varianceValue))+' ('+reason+').');
  }).catch(function(e){alert('Adjustment FAILED — stock was not changed: '+((e&&e.message)||e));});
}
