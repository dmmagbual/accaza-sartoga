import{HISTORY_TAB_PATHS}from"./realtime-hub.mjs";

function createHistoryPager(subscriptionHub){
  return function renderHistoryPager(tab){
    var paths=HISTORY_TAB_PATHS[tab],host=document.getElementById('tab-'+tab);if(!paths||!host)return;
    var old=host.querySelector('.accaza-history-pager');if(old)old.remove();
    var box=document.createElement('div');box.className='accaza-history-pager';box.style.cssText='margin:1rem 0;padding:0.65rem;border:1px solid #e1d5c5;border-radius:7px;background:#fffaf3;font-size:0.74rem;color:var(--tl);';
    box.innerHTML='<div style="margin-bottom:0.4rem;"><b>Bounded history:</b> reports use the recent loaded pages. Load older pages when reviewing an older period.</div><div style="display:flex;gap:0.35rem;flex-wrap:wrap;">'+paths.map(function(path){return '<button class="pz-btn sec" data-history-more="'+path+'" style="padding:0.22rem 0.55rem;">Load older '+path+'</button>';}).join('')+'</div>';
    host.appendChild(box);
    box.querySelectorAll('[data-history-more]').forEach(function(btn){btn.onclick=async function(){var path=btn.getAttribute('data-history-more');btn.disabled=true;btn.textContent='Loading '+path+'…';try{var r=await subscriptionHub.loadOlder(path);btn.textContent=r.loaded?(r.loaded+' older '+path+' loaded'):'All '+path+' history reached';if(r.hasOlder){setTimeout(function(){btn.disabled=false;btn.textContent='Load older '+path;},900);}}catch(e){btn.disabled=false;btn.textContent='Retry older '+path;}};});
  };
}

export{createHistoryPager};
