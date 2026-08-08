(function waitForAuthGate(){
  if(window.__accazaAuthz)return;
  if(window.__accazaAuthGateReady&&window.__accazaAuthGateReady()){if(window.openAdmin)window.openAdmin();return;}
  setTimeout(waitForAuthGate,150);
})();
