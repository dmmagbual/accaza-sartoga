import{HISTORY_TAB_PATHS}from"./realtime-hub.mjs?v=745";
import{reportCoverage,feedLabel}from"./report-coverage.mjs";

// Bounded history pager plus the report coverage stamp (audit A-08). A report that knows its period
// registers window.AccazaReportStart[tab] = function returning the earliest time it depends on.
function reportStart(tab){try{var f=window.AccazaReportStart&&window.AccazaReportStart[tab];return typeof f==='function'?Number(f())||0:0;}catch(_e){return 0;}}
function createHistoryPager(subscriptionHub){
  window.AccazaReportCoverage=function(tab){var paths=HISTORY_TAB_PATHS[tab];return paths?reportCoverage(subscriptionHub,paths,reportStart(tab)):null;};
  return function renderHistoryPager(tab){
    var paths=HISTORY_TAB_PATHS[tab],host=document.getElementById('tab-'+tab);if(!paths||!host)return;
    var old=host.querySelector('.accaza-history-pager');if(old){if(old.__coverageTimer)clearInterval(old.__coverageTimer);old.remove();}
    var box=document.createElement('div');box.className='accaza-history-pager';box.style.cssText='margin:1rem 0;padding:0.65rem;border:1px solid #e1d5c5;border-radius:7px;background:#fffaf3;font-size:0.74rem;color:var(--tl);';
    box.innerHTML='<div data-report-coverage style="margin-bottom:0.4rem;"></div><div style="display:flex;gap:0.35rem;flex-wrap:wrap;">'+paths.map(function(path){return '<button class="pz-btn sec" data-history-more="'+path+'" style="padding:0.22rem 0.55rem;">Load older '+feedLabel(path)+'</button>';}).join('')+'</div>';
    host.appendChild(box);
    var line=box.querySelector('[data-report-coverage]');
    function paint(){if(!box.isConnected){clearInterval(box.__coverageTimer);return;}var c=window.AccazaReportCoverage(tab);line.innerHTML='<b style="color:'+(c.complete?'#2d6a4f':'#9a5b00')+';">Data coverage:</b> '+String(c.text).replace(/[&<>]/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[ch];});}
    paint();box.__coverageTimer=setInterval(paint,5000);
    box.querySelectorAll('[data-history-more]').forEach(function(btn){btn.onclick=async function(){var path=btn.getAttribute('data-history-more'),label=feedLabel(path);btn.disabled=true;btn.textContent='Loading '+label+'…';try{var r=await subscriptionHub.loadOlder(path);btn.textContent=r.loaded?(r.loaded+' older '+label+' loaded'):'All '+label+' reached';paint();if(r.hasOlder){setTimeout(function(){btn.disabled=false;btn.textContent='Load older '+label;},900);}}catch(e){btn.disabled=false;btn.textContent='Retry older '+label;}};});
  };
}

export{createHistoryPager};
