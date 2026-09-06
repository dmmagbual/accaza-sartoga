(function(global){
  'use strict';
  var SIZE=50,pages={};
  function apply(root,scope,force){
    if(!root)return;
    Array.prototype.forEach.call(root.querySelectorAll('table'),function(table,index){
      if(table.closest('[data-no-report-pagination]'))return;
      var body=table.tBodies&&table.tBodies[0],allRows=body?Array.prototype.slice.call(body.rows):[],rows=allRows.filter(function(row){return !row.classList.contains('total-row')&&!row.classList.contains('tot')&&!row.hasAttribute('data-summary-row');});
      if(rows.length<=SIZE)return;
      var existing=table.parentNode&&table.parentNode.querySelector(':scope > .report-pagination');if(existing&&!force&&table.dataset.reportRowCount===String(rows.length))return;table.dataset.reportRowCount=String(rows.length);
      var key=String(scope||'report')+':'+index,page=Math.max(1,Math.min(pages[key]||1,Math.ceil(rows.length/SIZE))),total=Math.ceil(rows.length/SIZE),start=(page-1)*SIZE;
      pages[key]=page;allRows.forEach(function(row){row.hidden=false;});rows.forEach(function(row,i){row.hidden=i<start||i>=start+SIZE;});
      if(existing)existing.remove();
      var nav=document.createElement('div');nav.className='report-pagination';nav.innerHTML='<span>Showing '+(start+1)+'–'+Math.min(start+SIZE,rows.length)+' of '+rows.length+'</span><div><button type="button" '+(page===1?'disabled':'')+'>Previous</button><strong>Page '+page+' of '+total+'</strong><button type="button" '+(page===total?'disabled':'')+'>Next</button></div>';
      var buttons=nav.querySelectorAll('button');buttons[0].onclick=function(){pages[key]=page-1;apply(root,scope,true);};buttons[1].onclick=function(){pages[key]=page+1;apply(root,scope,true);};table.parentNode.appendChild(nav);
    });
  }
  function reset(scope){Object.keys(pages).forEach(function(key){if(!scope||key.indexOf(scope+':')===0)delete pages[key];});}
  global.AccazaReportPagination={apply:apply,reset:reset,pageSize:SIZE};
  if(document&&document.addEventListener)document.addEventListener('DOMContentLoaded',function(){var timer,host=document.getElementById('adminPanel');if(!host)return;function refresh(){clearTimeout(timer);timer=setTimeout(function(){var tab=document.querySelector('.admin-tab-content:not([style*="display:none"]):not([style*="display: none"])');if(tab)apply(tab,'admin-'+tab.id);},30);}new MutationObserver(refresh).observe(host,{childList:true,subtree:true});refresh();});
})(window);
