(function(){
  'use strict';
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(function(registration){
      registration.update();
      registration.addEventListener('updatefound',function(){
        var worker=registration.installing;if(!worker)return;
        worker.addEventListener('statechange',function(){
          if(worker.state==='installed'&&navigator.serviceWorker.controller){
            window.dispatchEvent(new CustomEvent('accaza:update-ready'));
          }
        });
      });
    }).catch(function(error){console.warn('Accaza offline shell unavailable',error);});
  });
})();
