(function(){
  'use strict';

  var deferredPrompt=null;
  var card=document.getElementById('saveRewardsCard');
  var consent=document.getElementById('installRewardsConsent');
  var button=document.getElementById('installRewardsBtn');
  var status=document.getElementById('installRewardsStatus');

  function isInstalled(){
    return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  }
  function setStatus(message){if(status)status.textContent=message||'';}
  function updateButton(){if(button)button.disabled=!consent||!consent.checked;}
  function show(){
    if(!card)return;
    card.hidden=isInstalled();
    if(isInstalled())setStatus('Accaza Rewards is already on this device.');
  }
  function manualInstructions(){
    var isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    setStatus(isiOS
      ? 'On iPhone or iPad: tap Share, then Add to Home Screen, then Add.'
      : 'Open your browser menu and choose Install app or Add to Home screen.');
  }

  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){
      navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){
        setStatus('The shortcut cannot be prepared while this browser is offline. Please try again when connected.');
      });
    });
  }
  window.addEventListener('beforeinstallprompt',function(event){
    event.preventDefault();
    deferredPrompt=event;
    show();
    setStatus('Ready to add after you give consent.');
  });
  window.addEventListener('appinstalled',function(){
    deferredPrompt=null;
    if(card)card.hidden=true;
    setStatus('Accaza Rewards was added to this device.');
  });
  if(consent)consent.addEventListener('change',updateButton);
  if(button)button.addEventListener('click',async function(){
    if(!consent||!consent.checked){setStatus('Please give consent first.');return;}
    if(!deferredPrompt){manualInstructions();return;}
    button.disabled=true;
    deferredPrompt.prompt();
    var choice=await deferredPrompt.userChoice;
    deferredPrompt=null;
    if(choice&&choice.outcome==='accepted')setStatus('Your browser is adding Accaza Rewards.');
    else setStatus('Nothing was installed. You can choose Add Accaza Rewards again later.');
    updateButton();
  });
  updateButton();
  window.AccazaRewardsInstall={show:show};
})();
