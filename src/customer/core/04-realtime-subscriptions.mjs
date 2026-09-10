
// ── FIREBASE LISTENERS ──
onValue(categoriesRef,snap=>{
  const saved=snap.val();
  if(saved){categoriesMap=saved;}
  else{const seed={};DEFAULT_CATS.forEach(c=>{seed[c.id]=c;});set(categoriesRef,seed);categoriesMap=seed;}
  categoriesListCache=null;
  rebuildTabs();
  scheduleCatalogRender();
});

function migrateItemOptions(){
  if(itemOptMigrated)return;
  if(!Object.keys(menuItemsMap).length||!Object.keys(optionGroupsMap).length)return;
  var updates={};
  Object.keys(menuItemsMap).forEach(function(k){
    var it=menuItemsMap[k];
    if(it&&!it.optionsSet){
      var ids=legacyOptionIdsFor(it.cat);
      updates['menuItems/'+k+'/optionsSet']=true;
      if(ids.length)updates['menuItems/'+k+'/options']=ids;
    }
  });
  itemOptMigrated=true;
  if(Object.keys(updates).length)update(ref(db),updates).catch(function(){});
}
onValue(optionGroupsRef,snap=>{
  if(snap.exists()){optionGroupsMap=snap.val();}
  else if(!optSeedStarted){
    optSeedStarted=true;
    optionGroupsMap=DEFAULT_OPTION_GROUPS;
    set(optionGroupsRef,DEFAULT_OPTION_GROUPS).catch(function(){});
  }
  migrateItemOptions();
});

onValue(menuRef,snap=>{
  const saved=snap.val();
  if(saved){menuItemsMap=saved;}
  else{
    const seed={};
    const defaultMenu=[
      {cat:'coffee',name:'Espresso Tonic',desc:'Bright espresso over tonic water with a citrus kick.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Americano',desc:'Bold espresso rounded out with water.',priceS:155,priceM:165,priceL:175},
      {cat:'coffee',name:'Cafe Latte',desc:'Smooth espresso paired with milk for a creamy, balanced finish.',priceS:175,priceM:185,priceL:195},
      {cat:'coffee',name:'Cappuccino',desc:'Espresso with milk and light, creamy cold foam.',priceS:185,priceM:195,priceL:205},
      {cat:'coffee',name:'French Vanilla',desc:'Espresso with french vanilla flavor, milk, and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Caramel Macchiato',desc:'Layers of espresso, vanilla, and caramel.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Spanish Latte',desc:'Rich and creamy blend of espresso, milk and sweet condensed milk.',priceS:195,priceM:205,priceL:215},
      {cat:'coffee',name:'Sea Salt Caramel Latte',desc:'Sweet and salty caramel espresso.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Sea Salt Latte',desc:'Rich, velvety coffee with bold, creamy and subtly salty notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Nougat',desc:'Espresso with coconut and toffee nut notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'White Chocolate Mocha',desc:'Smooth espresso with sweet white chocolate and milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Mocha',desc:'Classic dark chocolate and espresso with milk.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Banana Oat Latte',desc:'Creamy oat milk latte with espresso and banana sweetness.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Raspberry Oat Latte',desc:'Oat milk latte with espresso and fresh raspberry notes.',priceS:205,priceM:215,priceL:225},
      {cat:'coffee',name:'Cinnamon Oat Latte',desc:'Cinnamon spice blended with espresso and oat milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'White Chocolate',desc:'White chocolate with milk and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Dark Chocolate',desc:'Rich dark chocolate with milk and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Banana Oat',desc:'Oat milk and banana flavor, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Raspberry Oat',desc:'Oat milk with raspberry flavor, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Cinnamon Oat',desc:'Oat milk infused with cinnamon and condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'noncaf',name:'Matcha Latte',desc:'Matcha with milk, sweetened with condensed milk.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Caramel Frappe',desc:'Espresso blended with caramel, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Java Chip',desc:'Espresso and dark chocolate blended with chocolate chips.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Toffee Nut Frappe',desc:'Espresso infused with toffee nut, blended smooth.',priceS:195,priceM:205,priceL:215},
      {cat:'frappe',name:'Caramel Cream Frappe',desc:'Espresso blended with caramel and vanilla.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'White Mocha Frappe',desc:'Espresso blended with creamy white chocolate.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Dark Mocha Frappe',desc:'Espresso blended with rich dark chocolate.',priceS:205,priceM:215,priceL:225},
      {cat:'frappe',name:'Butterscotch Frappe',desc:'Espresso blended with butterscotch.',priceS:195,priceM:205,priceL:215},
      {cat:'frappe',name:'Cappuccino Frappe',desc:'Espresso and milk blended to a smooth icy finish.',priceS:195,priceM:205,priceL:215},
      {cat:'nonfrappe',name:'Vanilla Frappe',desc:'Ice blended vanilla and milk, topped with whipped cream.',priceS:175,priceM:185,priceL:195},
      {cat:'nonfrappe',name:'Matcha Cream Frappe',desc:'Ice blended matcha with milk, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Nougat Frappe',desc:'Ice blended coconut and toffee nut, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Dark Chocolate Frappe',desc:'Ice blended rich dark chocolate, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Strawberry Cream Frappe',desc:'Ice blended strawberry with cream, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'nonfrappe',name:'Strawberry Frappe',desc:'Ice blended strawberry, topped with whipped cream.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Tahitian Lime',desc:'Tahitian Lime soda-based refresher topped with dried lemon.',priceS:195,priceM:205,priceL:215},
      {cat:'soda',name:'Pink Guava',desc:'Guava soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Peach Black Tea',desc:'Peach & Black Tea soda-based refresher.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Lychee',desc:'Lychee soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Raspberry Soda',desc:'Raspberry soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'soda',name:'Passionfruit',desc:'Passionfruit soda-based refresher topped with dried lemon.',priceS:205,priceM:215,priceL:225},
      {cat:'pastry',name:'Buttered Croissant',desc:'Classic buttered croissant.',priceS:95},
      {cat:'pastry',name:'Croffle',desc:'Buttery croissant pressed in a waffle.',priceS:135},
      {cat:'pastry',name:'Matcha Croffle',desc:'Croissant waffle topped with whipped cream and matcha.',priceS:195},
      {cat:'pastry',name:'Biscoff Croffle',desc:'Croissant waffle topped with Biscoff spread.',priceS:195},
      {cat:'pastry',name:'Dark Chocolate Croffle',desc:'Croissant waffle topped with dark chocolate.',priceS:195},
      {cat:'pastry',name:'White Chocolate Croffle',desc:'Croissant waffle topped with white chocolate.',priceS:195},
      {cat:'pastry',name:'Pain Au Chocolat',desc:'Croissant filled with chocolate.',priceS:105},
      {cat:'pastry',name:'Cinnamon Roll',desc:'Flaky cinnamon roll topped with cinnamon cream cheese sauce.',priceS:155}
    ];
    defaultMenu.forEach((item,i)=>{seed['item_'+String(i).padStart(3,'0')]=item;});
    set(menuRef,seed);menuItemsMap=seed;
  }
  menuItemsListCache=null;
  migrateItemOptions();
  scheduleCatalogRender();
});

// ── NEW ORDER ALERTS (admin/staff) ──────────────────────────
function playChime(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    var t=audioCtx.currentTime;
    // Urgent two-tone alert: 6 alternating pulses, ~1.8s total
    for(var i=0;i<6;i++){
      var o=audioCtx.createOscillator(),gn=audioCtx.createGain();
      o.type='triangle';
      o.frequency.value=(i%2===0)?988:740;
      var st=t+i*0.3;
      gn.gain.setValueAtTime(0.0001,st);
      gn.gain.exponentialRampToValueAtTime(0.55,st+0.02);
      gn.gain.setValueAtTime(0.55,st+0.22);
      gn.gain.exponentialRampToValueAtTime(0.0001,st+0.3);
      o.connect(gn);gn.connect(audioCtx.destination);
      o.start(st);o.stop(st+0.32);
    }
  }catch(e){}
}
function clearOrderAlert(){
  unseenOrders=0;
  if(orderChimeTimer){clearInterval(orderChimeTimer);orderChimeTimer=null;}
  var t=document.getElementById('orderToast');if(t)t.style.display='none';
  var b=document.getElementById('ordersBadge');if(b)b.style.display='none';
}
function notifyNewOrders(fresh){
  unseenOrders+=fresh.length;
  var last=fresh[fresh.length-1];
  document.getElementById('orderToastTitle').textContent=unseenOrders>1?unseenOrders+' new orders received!':'New order from '+(last&&last.name?last.name:'a customer')+'!';
  document.getElementById('orderToastSub').textContent=(last&&last.total?'₱'+last.total.toLocaleString()+' · ':'')+'Tap to view orders';
  document.getElementById('orderToast').style.display='flex';
  var b=document.getElementById('ordersBadge');
  if(b){b.textContent=unseenOrders;b.style.display='inline-block';}
  playChime();
  if(orderChimeTimer)clearInterval(orderChimeTimer);
  orderChimeTimer=setInterval(playChime,3800);
}
window.ackNewOrders=function(){
  clearOrderAlert();
  var ob=document.getElementById('tabBtnOrders');if(ob)ob.click();
  var ad=document.getElementById('adminDash');if(ad)ad.scrollIntoView({behavior:'smooth'});
};
// ===== CUSTOMER 'ORDER READY' IN-APP ALERT (free; works while the app is open) =====
var _readyAlerted;try{_readyAlerted=new Set(JSON.parse(localStorage.getItem('accaza_ready_alerted')||'[]'));}catch(e){_readyAlerted=new Set();}
var _ordersSeeded=false,_readyTimer=null,_readyStop=null;
function _saveReadyAlerted(){try{localStorage.setItem('accaza_ready_alerted',JSON.stringify(Array.from(_readyAlerted)));}catch(e){}}
function stopReadyAlert(){if(_readyTimer){clearInterval(_readyTimer);_readyTimer=null;}if(_readyStop){clearTimeout(_readyStop);_readyStop=null;}}
window.dismissReadyAlert=function(){stopReadyAlert();var el=document.getElementById('orderReadyAlert');if(el)el.style.display='none';};
function playReadyChime(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    var t=audioCtx.currentTime;
    var notes=[523.25,659.25,783.99,1046.5]; // C5 E5 G5 C6 — cheerful ascending arpeggio
    notes.forEach(function(f,i){
      var o=audioCtx.createOscillator(),gn=audioCtx.createGain();
      o.type='triangle';o.frequency.value=f;
      var st=t+i*0.17;
      gn.gain.setValueAtTime(0.0001,st);
      gn.gain.exponentialRampToValueAtTime(0.6,st+0.02);
      gn.gain.setValueAtTime(0.6,st+0.13);
      gn.gain.exponentialRampToValueAtTime(0.0001,st+0.33);
      o.connect(gn);gn.connect(audioCtx.destination);
      o.start(st);o.stop(st+0.36);
    });
  }catch(e){}
}
function triggerReadyAlert(o){
  var el=document.getElementById('orderReadyAlert');if(!el)return;
  var sub=document.getElementById('orderReadySub');
  if(sub)sub.textContent='Order #'+(o.id||'')+' \u2014 '+((o.type==='Delivery')?'ready for delivery':'ready for pick-up');
  el.style.display='flex';
  try{playReadyChime();}catch(e){}
  stopReadyAlert();
  _readyTimer=setInterval(function(){try{playReadyChime();}catch(e){}try{if(navigator.vibrate)navigator.vibrate([500,200,500]);}catch(e){}},3800);
  try{if(navigator.vibrate)navigator.vibrate([500,200,500,200,500]);}catch(e){}
  _readyStop=setTimeout(function(){if(window.dismissReadyAlert)window.dismissReadyAlert();},45000);
}
function checkMyReadyOrders(){
  try{
    myOrderIds.forEach(function(id){
      var o=myOrdersMap[id];if(!o)return;
      if(o.status==='Ready'){
        if(!_ordersSeeded){_readyAlerted.add(id);}
        else if(!_readyAlerted.has(id)){_readyAlerted.add(id);_saveReadyAlerted();triggerReadyAlert(o);}
      }else if(_readyAlerted.has(id)){_readyAlerted.delete(id);_saveReadyAlerted();if(window.dismissReadyAlert)window.dismissReadyAlert();}
    });
    if(!_ordersSeeded){_ordersSeeded=true;_saveReadyAlerted();}
  }catch(e){}
}
(function(){var un=function(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}document.removeEventListener('touchstart',un);document.removeEventListener('click',un);};document.addEventListener('touchstart',un,{passive:true});document.addEventListener('click',un);})();
onValue(reviewsRef,snap=>{
  const saved=snap.val();
  if(saved){reviewsMap=saved;}
  else{
    const seed={
      'rev_001':{name:'Maria Theresa & Quinn Isabella Margaux',stars:5,date:'June 2, 2026',text:'Accaza Coffee House is a hidden gem right along the roadside near SM Dasmariñas — easy to find whether you\'re commuting or driving. Inside, it\'s surprisingly spacious with a calm, serene atmosphere that\'s rare among today\'s cramped cafés.\n\nThe coffee is outstanding, with well-crafted flavors from bold to smooth. But what truly sets Accaza apart is how perfectly it serves both students and professionals — it\'s a productive sanctuary where you can focus, study, or work in peace.\n\nHighly recommended for anyone looking for great coffee and a place to get things done. ☕✨'},
      'rev_002':{name:'Molina Page',stars:5,date:'June 2026',text:'The coffee was absolutely delightful — perfectly brewed, rich in flavor, and made with genuine care. Every sip spoke to your passion and quality.\n\nBeyond the coffee, your staff made the visit truly special. From the warm greeting to the attentive service, everyone made me feel genuinely valued. It\'s rare to find a team so professional yet so kind and approachable.'},
      'rev_003':{name:'Camilla Andrea',stars:5,date:'April 6, 2026 · via Facebook',text:'Nasa may highway ang coffee shop, ngunit nakakubli ang ganda nitong hindi mo mamamalas kung hindi sasadyain. Mukha siyang maliit sa labas, subalit malaki ang espasyo pagpasok, na tila napunta ka na sa ibang lugar.\n\nGusto ko mang ipagdamot ang lugar para patuloy akong makatambay nang matiwasay, subalit tingin ko\'y kasalanan ito sa mga mahilig sa kape (at sa may-ari rin) kung hindi ito maibabahagi sa iba.'},
      'rev_004':{name:'Cess Borja',stars:5,date:'July 2025',text:'"10/10 would recommend!! we will surely come back 🤌"'}
    };
    set(reviewsRef,seed);reviewsMap=seed;
  }
  renderPublicReviews();
});
onValue(availRef,snap=>{const s=snap.val();if(s)Object.keys(s).forEach(k=>availability[k]=s[k]);scheduleCatalogRender();});
onValue(paymentRef,snap=>{
  const p=snap.val();if(!p)return;
  if(p.gcashNum)document.getElementById('gcashNum').textContent=p.gcashNum;
  if(p.gcashName)document.getElementById('gcashName').textContent=p.gcashName;
  if(p.bdoNum)document.getElementById('bankNum').textContent=p.bdoNum;
  if(p.ubNum)document.getElementById('bankNum2').textContent=p.ubNum;
  var editGcashNum=document.getElementById('editGcashNum');if(p.gcashNum&&editGcashNum)editGcashNum.value=p.gcashNum;
  var editGcashName=document.getElementById('editGcashName');if(p.gcashName&&editGcashName)editGcashName.value=p.gcashName;
  var editBdoNum=document.getElementById('editBdoNum');if(p.bdoNum&&editBdoNum)editBdoNum.value=p.bdoNum;
  var editUbNum=document.getElementById('editUbNum');if(p.ubNum&&editUbNum)editUbNum.value=p.ubNum;
  // Enabled flags → update admin toggles
  function setChk(id,val){var el=document.getElementById(id);if(el){el.checked=(val!==false);}}
  setChk('chkGcash',p.gcashEnabled!==false);
  setChk('chkBdo',p.bdoEnabled!==false);
  setChk('chkUb',p.ubEnabled!==false);
  setChk('chkMaya',p.mayaEnabled!==false);
  setChk('chkBank3',p.bank3Enabled!==false);
  setChk('chkBank4',p.bank4Enabled!==false);
  // Show/hide individual bank rows in customer panel
  var bdoRow=document.getElementById('bdoRow');
  var ubRow=document.getElementById('ubRow');
  if(bdoRow)bdoRow.style.display=p.bdoEnabled!==false?'block':'none';
  if(ubRow)ubRow.style.display=p.ubEnabled!==false?'block':'none';
  // QR codes
  var qrGcash=document.getElementById('qrGcash');
  var qrBdo=document.getElementById('qrBdo');
  var qrSection=document.getElementById('qrSection');
  if(qrGcash)qrGcash.style.display=p.gcashEnabled!==false?'block':'none';
  if(qrBdo)qrBdo.style.display=p.bdoEnabled!==false?'block':'none';
  // Hide whole QR box if both GCash and BDO are off
  if(qrSection)qrSection.style.display=(p.gcashEnabled!==false||p.bdoEnabled!==false)?'block':'none';
  ['Gcash','Bdo','Ub','Maya','Bank3','Bank4'].forEach(function(k){
    var note=document.getElementById('chk'+k+'Note');
    var chk=document.getElementById('chk'+k);
    if(note&&chk)note.style.display=chk.checked?'none':'block';
  });
  // GCash customer button
  var gcashBtn=document.getElementById('btnGcash');
  if(gcashBtn)gcashBtn.style.display=p.gcashEnabled!==false?'':'none';
  // Bank Transfer button (show if any bank enabled)
  var bankBtn=document.getElementById('btnBank');
  if(bankBtn)bankBtn.style.display=(p.bdoEnabled!==false||p.ubEnabled!==false||p.bank3Enabled!==false||p.bank4Enabled!==false)?'':'none';
  // Auto-select first visible payment method
  (function(){
    var gcashOk=p.gcashEnabled!==false;
    var mayaOk=!!(p.mayaNum&&p.mayaEnabled!==false);
    var bankOk=(p.bdoEnabled!==false||p.ubEnabled!==false||p.bank3Enabled!==false||p.bank4Enabled!==false);
    var needSwitch=(paymentType==='gcash'&&!gcashOk)||(paymentType==='maya'&&!mayaOk)||(paymentType==='bank'&&!bankOk);
    if(needSwitch){
      var first=gcashOk?'gcash':mayaOk?'maya':bankOk?'bank':null;
      if(first)setPayment(first);
    }
  })();
  // PayMaya
  var mayaBtn=document.getElementById('btnMaya');
  if(p.mayaNum){document.getElementById('mayaNum').textContent=p.mayaNum;
    if(p.mayaName)document.getElementById('mayaName').textContent=p.mayaName;
    if(document.getElementById('editMayaNum'))document.getElementById('editMayaNum').value=p.mayaNum;
    if(document.getElementById('editMayaName'))document.getElementById('editMayaName').value=p.mayaName||'';
    if(mayaBtn)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'';
  }else{if(mayaBtn)mayaBtn.style.display='none';}
  if(mayaBtn&&p.mayaNum)mayaBtn.style.display=(p.mayaEnabled!==false)?'':'none';
  // Extra Bank
  var b3row=document.getElementById('bank3Row');
  if(p.bank3Num){
    document.getElementById('bank3Num').textContent=p.bank3Num;
    document.getElementById('bank3AccName').textContent=p.bank3Name||'ACCAZA';
    if(p.bank3Label){document.getElementById('bank3LabelDisp').textContent=p.bank3Label+' Account';}
    if(document.getElementById('editBank3Label'))document.getElementById('editBank3Label').value=p.bank3Label||'';
    if(document.getElementById('editBank3Num'))document.getElementById('editBank3Num').value=p.bank3Num;
    if(document.getElementById('editBank3Name'))document.getElementById('editBank3Name').value=p.bank3Name||'';
    if(b3row)b3row.style.display=p.bank3Enabled!==false?'block':'none';
  }else{if(b3row)b3row.style.display='none';}
  // Extra Bank 2
  var b4row=document.getElementById('bank4Row');
  if(p.bank4Num){
    document.getElementById('bank4Num').textContent=p.bank4Num;
    document.getElementById('bank4AccName').textContent=p.bank4Name||'ACCAZA';
    if(p.bank4Label){document.getElementById('bank4LabelDisp').textContent=p.bank4Label+' Account';}
    if(document.getElementById('editBank4Label'))document.getElementById('editBank4Label').value=p.bank4Label||'';
    if(document.getElementById('editBank4Num'))document.getElementById('editBank4Num').value=p.bank4Num;
    if(document.getElementById('editBank4Name'))document.getElementById('editBank4Name').value=p.bank4Name||'';
    if(b4row)b4row.style.display=p.bank4Enabled!==false?'block':'none';
  }else{if(b4row)b4row.style.display='none';}
});
onValue(calBlocksRef,snap=>{calBlocks=snap.val()||{};renderCustomerCalendar();});
