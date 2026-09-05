(function(){
  'use strict';
  var installPrompt=null;
  function standalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;}
  function isAdmin(){return /\/admin\.html(?:$|[?#])/i.test(location.pathname+location.search);}
  function appName(){return isAdmin()?'Accaza POS':'Accaza Coffee';}
  function buttons(){return Array.prototype.slice.call(document.querySelectorAll('[data-accaza-install],#heroInstallBtn'));}
  function refreshButtons(){buttons().forEach(function(button){if(standalone()){button.textContent='✓ '+appName()+' Installed';button.disabled=true;button.style.opacity='0.7';}else{button.disabled=false;button.style.opacity='1';if(button.id!=='heroInstallBtn')button.textContent='📲 Install '+appName()+' App';}});}
  function showHelp(title,html){
    var old=document.getElementById('accazaInstallHelp');if(old)old.remove();
    var mask=document.createElement('div');mask.id='accazaInstallHelp';mask.setAttribute('role','dialog');mask.setAttribute('aria-modal','true');mask.style.cssText='position:fixed;inset:0;z-index:30000;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:1rem;font-family:Inter,sans-serif;';
    mask.innerHTML='<div style="background:#f5f0e8;color:#19241b;border-radius:14px;padding:1.35rem;max-width:430px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.4);"><h3 style="font-family:Playfair Display,serif;margin:0 0 .65rem;font-size:1.25rem;">'+title+'</h3><div style="font-size:.88rem;line-height:1.6;">'+html+'</div><button data-install-close style="margin-top:1rem;width:100%;background:#19241b;color:#fff;border:0;border-radius:8px;padding:.7rem;cursor:pointer;">Close</button></div>';
    document.body.appendChild(mask);mask.querySelector('[data-install-close]').onclick=function(){mask.remove();};mask.onclick=function(e){if(e.target===mask)mask.remove();};mask.querySelector('[data-install-close]').focus();
  }
  function manualHelp(){
    var ua=navigator.userAgent||'';
    if(/iphone|ipad|ipod/i.test(ua))return showHelp('Install '+appName(),'<p>In Safari, tap the <strong>Share</strong> button, then choose <strong>Add to Home Screen</strong>.</p><p>This option will not appear inside Facebook or Messenger. Open the page in Safari first.</p>');
    if(/android/i.test(ua))return showHelp('Install '+appName(),'<p>Open this page in Chrome. Tap <strong>⋮</strong>, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p>If it is missing, refresh once and wait a few seconds.</p>');
    showHelp('Install '+appName(),'<p><strong>Chrome:</strong> open <strong>⋮ → Cast, save and share → Install '+appName()+'</strong>.</p><p><strong>Microsoft Edge:</strong> open <strong>⋯ → Apps → Install '+appName()+'</strong>.</p><p>If no install choice appears, hard-refresh once. The app may already be installed or the browser may not support installation.</p>');
  }
  window.accazaInstallApp=function(){
    if(standalone()){showHelp(appName()+' is installed','<p>You are already running the installed app.</p>');return;}
    if(installPrompt){var prompt=installPrompt;installPrompt=null;prompt.prompt();prompt.userChoice.then(function(choice){if(choice.outcome!=='accepted')manualHelp();refreshButtons();});return;}
    manualHelp();
  };
  window.heroInstallClick=window.accazaInstallApp;
  window.addEventListener('beforeinstallprompt',function(event){event.preventDefault();installPrompt=event;refreshButtons();});
  window.addEventListener('appinstalled',function(){installPrompt=null;refreshButtons();showHelp(appName()+' installed','<p>The app was installed successfully. You can now open it from your desktop or home screen.</p>');});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refreshButtons);else refreshButtons();
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(function(registration){
      registration.update();
      if(isAdmin()){
        var warmAdminShell=function(){var worker=registration.active||registration.waiting;if(worker)worker.postMessage({type:'ACCAZA_PRECACHE_ADMIN'});};
        warmAdminShell();
        navigator.serviceWorker.ready.then(warmAdminShell);
        navigator.serviceWorker.addEventListener('controllerchange',warmAdminShell);
      }
      registration.addEventListener('updatefound',function(){
        var worker=registration.installing;if(!worker)return;
        worker.addEventListener('statechange',function(){
          if(worker.state==='installed'&&navigator.serviceWorker.controller){
            window.dispatchEvent(new CustomEvent('accaza:update-ready'));
            if(!document.getElementById('accazaUpdateReady')){var bar=document.createElement('div');bar.id='accazaUpdateReady';bar.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:29000;background:#19241b;color:#fff;border:1px solid #b08d57;border-radius:10px;padding:.7rem 1rem;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px Inter,sans-serif;';bar.innerHTML='A new Accaza version is ready. <button style="margin-left:.6rem;background:#b08d57;color:#fff;border:0;border-radius:6px;padding:.35rem .65rem;cursor:pointer;">Reload</button>';bar.querySelector('button').onclick=function(){location.reload();};document.body.appendChild(bar);}
          }
        });
      });
    }).catch(function(error){console.warn('Accaza offline shell unavailable',error);});
  });
})();
