/* ===================== LIVE ORDER STATUS ===================== */
(function(){
  var STEPS=[['Pending','Placed'],['Confirmed','Confirmed'],['Preparing','Preparing'],['Ready','Ready'],['Received','Received']];
  var WORDS=['Pending','Confirmed','Preparing','Ready','Completed','Received','Rejected'];
  var sessionStatus={};   // orderId -> last status seen THIS session (alerts only on live change)
  var audioCtx=null, gestureDone=false;

  function ensureGesture(){
    if(gestureDone)return;gestureDone=true;
    try{audioCtx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}
    try{if('Notification'in window&&Notification.permission==='default')Notification.requestPermission();}catch(e){}
  }
  document.addEventListener('click',ensureGesture,{once:false});

  function chime(){
    try{
      if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended')audioCtx.resume();
      [880,1175].forEach(function(f,i){
        var o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);
        o.type='sine';o.frequency.value=f;var t=audioCtx.currentTime+i*0.16;
        g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.22,t+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+0.45);
        o.start(t);o.stop(t+0.45);
      });
    }catch(e){}
  }
  function pushNote(title,body){try{if('Notification'in window&&Notification.permission==='granted')new Notification(title,{body:body,icon:'/favicon_192x192.png',badge:'/favicon_192x192.png'});}catch(e){}}

  function findStatus(card){var sp=card.querySelectorAll('span');for(var i=0;i<sp.length;i++){var t=(sp[i].textContent||'').trim();if(WORDS.indexOf(t)>-1)return t;}return null;}
  function findId(card){var ps=card.querySelectorAll('p');for(var i=0;i<ps.length;i++){if((ps[i].getAttribute('style')||'').indexOf('1.8rem')>-1)return (ps[i].textContent||'').trim();}return null;}

  function stepperHTML(status){
    if(status==='Rejected')return '<div class="acz-rejected">⚠ Order rejected — please contact us at 0927 692 4831</div>';
    if(status==='Completed')status='Received';
    var idx=0;for(var i=0;i<STEPS.length;i++){if(STEPS[i][0]===status){idx=i;break;}}
    var h='<div class="acz-steps">';
    for(var j=0;j<STEPS.length;j++){var cls='acz-step'+(j<idx?' done':(j===idx?' active':''));h+='<div class="'+cls+'"><div class="acz-dot">'+(j<idx?'✓':(j+1))+'</div><div class="acz-lbl">'+STEPS[j][1]+'</div></div>';}
    return h+'</div>';
  }

  function alertChange(id,status){
    var msg;
    if(status==='Ready')msg='🎉 Order '+id+' is READY! Please proceed to pick it up / receive it.';
    else if(status==='Completed'||status==='Received')msg='🎉 Thank you! Order '+id+' is complete.';
    else if(status==='Preparing')msg='👨‍🍳 Order '+id+' is now being prepared.';
    else if(status==='Confirmed')msg='✅ Order '+id+' has been confirmed!';
    else if(status==='Rejected')msg='⚠ Order '+id+' was rejected. Please contact us at 0927 692 4831.';
    else msg='Order '+id+' status updated: '+status;
    if(window.accazaToast)window.accazaToast(msg,status==='Rejected'?'err':'ok');
    chime();pushNote('Accaza Coffee House',msg);
  }

  function enhance(){
    var list=document.getElementById('activeOrdersList');if(!list)return;
    var cards=list.querySelectorAll(':scope > div');
    cards.forEach(function(card){
      var status=findStatus(card),id=findId(card);
      if(!status||!id)return;
      if(!card.querySelector('.acz-steps')&&!card.querySelector('.acz-rejected')){
        var first=card.firstElementChild,wrap=document.createElement('div');wrap.innerHTML=stepperHTML(status);
        var node=wrap.firstChild;if(first&&first.nextSibling)card.insertBefore(node,first.nextSibling);else card.appendChild(node);
      }
      var prev=sessionStatus[id];
      if(prev!==undefined&&prev!==status)alertChange(id,status);
      sessionStatus[id]=status;
    });
  }

  function start(){
    var list=document.getElementById('activeOrdersList');if(!list){setTimeout(start,600);return;}
    enhance();
    new MutationObserver(function(){enhance();}).observe(list,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
