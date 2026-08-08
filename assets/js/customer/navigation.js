(function(){var tabs=document.querySelectorAll('#appTabBar a');tabs.forEach(function(t){t.addEventListener('click',function(){tabs.forEach(function(x){x.classList.remove('active');});this.classList.add('active');});});})();
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').then(function(reg){reg.update();}).catch(function(){});});}
// Hero Install Button Logic
var _heroDeferredPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  _heroDeferredPrompt = e;
});
function heroInstallClick(){
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isAndroid = /android/i.test(navigator.userAgent);

  // Already running as installed app
  if(isStandalone){
    document.getElementById('alreadyInstalledPopup').style.display = 'flex';
    return;
  }

  // Android: trigger native install prompt if available
  if(isAndroid && _heroDeferredPrompt){
    _heroDeferredPrompt.prompt();
    _heroDeferredPrompt.userChoice.then(function(r){
      if(r.outcome === 'accepted'){
        setTimeout(function(){
          document.getElementById('alreadyInstalledPopup').style.display = 'flex';
        }, 1800);
      }
      _heroDeferredPrompt = null;
    });
    return;
  }

  // iOS: show manual instructions
  if(isIOS){
    document.getElementById('iosInstallPopup').style.display = 'flex';
    return;
  }

  // Desktop Chrome / other Android (no prompt yet or already installed)
  if(_heroDeferredPrompt){
    _heroDeferredPrompt.prompt();
    _heroDeferredPrompt.userChoice.then(function(r){
      if(r.outcome === 'accepted'){
        setTimeout(function(){
          document.getElementById('alreadyInstalledPopup').style.display = 'flex';
        }, 1800);
      }
      _heroDeferredPrompt = null;
    });
  } else {
    document.getElementById('alreadyInstalledPopup').style.display = 'flex';
  }
}

(function(){
  var deferred=null;
  var isStandalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(isStandalone)return;
  function dismissed(){try{return localStorage.getItem('accazaPwaDismissed')==='1';}catch(e){return false;}}
  function setDismissed(){try{localStorage.setItem('accazaPwaDismissed','1');}catch(e){}}
  function makeBanner(html){
    var b=document.createElement('div');b.id='pwaBanner';
    b.style.cssText='position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#19241b;color:#e0d4c6;border:1px solid #b08d57;border-radius:12px;padding:0.75rem 1rem;display:flex;align-items:center;gap:0.75rem;box-shadow:0 6px 24px rgba(0,0,0,0.35);font-family:Inter,sans-serif;font-size:0.85rem;max-width:92%;';
    b.innerHTML=html;document.body.appendChild(b);return b;
  }
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();deferred=e;
    if(dismissed()||document.getElementById('pwaBanner'))return;
    var b=makeBanner('<span>📲 Get the <strong>Accaza app</strong> on your phone!</span><button id="pwaInstallBtn" style="background:#b08d57;color:#fff;border:none;border-radius:8px;padding:0.5rem 1rem;font-size:0.85rem;cursor:pointer;font-family:Inter,sans-serif;">Install</button><button id="pwaCloseBtn" style="background:none;border:none;color:#e0d4c6;font-size:1rem;cursor:pointer;line-height:1;">✕</button>');
    document.getElementById('pwaInstallBtn').onclick=function(){if(deferred){deferred.prompt();deferred=null;}b.remove();};
    document.getElementById('pwaCloseBtn').onclick=function(){setDismissed();b.remove();};
  });
  var isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isIOS&&!dismissed()){
    setTimeout(function(){
      if(document.getElementById('pwaBanner'))return;
      var b=makeBanner('<span>📲 Install the <strong>Accaza app</strong>: tap <strong>Share</strong> then <strong>&ldquo;Add to Home Screen&rdquo;</strong></span><button id="pwaCloseBtn" style="background:none;border:none;color:#e0d4c6;font-size:1rem;cursor:pointer;line-height:1;">✕</button>');
      document.getElementById('pwaCloseBtn').onclick=function(){setDismissed();b.remove();};
    },4000);
  }
})();
