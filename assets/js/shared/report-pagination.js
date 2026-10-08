(function(global){
  'use strict';
  var SIZE=50,pages={};
  function apply(root,scope,force){
    if(!root)return;
    Array.prototype.forEach.call(root.querySelectorAll('table'),function(table,index){
      if(table.closest('[data-no-report-pagination]'))return;
      var body=table.tBodies&&table.tBodies[0],allRows=body?Array.prototype.slice.call(body.rows):[],rows=allRows.filter(function(row){return !row.classList.contains('total-row')&&!row.classList.contains('tot')&&!row.hasAttribute('data-summary-row');}),size=Math.max(1,Number(table.dataset.reportPageSize)||SIZE),groups=[];
      rows.forEach(function(row){var group=row.getAttribute('data-report-page-group'),last=groups[groups.length-1];if(group&&last&&last.key===group)last.rows.push(row);else groups.push({key:group||'',rows:[row]});});
      var existing=table.parentNode&&table.parentNode.querySelector(':scope > .report-pagination');if(groups.length<=size){if(existing)existing.remove();allRows.forEach(function(row){row.hidden=false;});return;}
      if(existing&&!force&&table.dataset.reportRowCount===String(groups.length))return;table.dataset.reportRowCount=String(groups.length);
      var key=String(scope||'report')+':'+index,page=Math.max(1,Math.min(pages[key]||1,Math.ceil(groups.length/size))),total=Math.ceil(groups.length/size),start=(page-1)*size;
      pages[key]=page;allRows.forEach(function(row){row.hidden=false;});groups.forEach(function(group,i){group.rows.forEach(function(row){row.hidden=i<start||i>=start+size;});});
      if(existing)existing.remove();
      var nav=document.createElement('div');nav.className='report-pagination';nav.innerHTML='<span>Showing '+(start+1)+'–'+Math.min(start+size,groups.length)+' of '+groups.length+'</span><div><button type="button" '+(page===1?'disabled':'')+'>Previous</button><strong>Page '+page+' of '+total+'</strong><button type="button" '+(page===total?'disabled':'')+'>Next</button></div>';
      var buttons=nav.querySelectorAll('button');buttons[0].onclick=function(){pages[key]=page-1;apply(root,scope,true);};buttons[1].onclick=function(){pages[key]=page+1;apply(root,scope,true);};table.parentNode.appendChild(nav);
    });
  }
  function reset(scope){Object.keys(pages).forEach(function(key){if(!scope||key.indexOf(scope+':')===0)delete pages[key];});}
  global.AccazaReportPagination={apply:apply,reset:reset,pageSize:SIZE};
  if(document&&document.addEventListener)document.addEventListener('DOMContentLoaded',function(){var timer,host=document.getElementById('adminDash');if(!host)return;function refresh(){clearTimeout(timer);timer=setTimeout(function(){var tab=document.querySelector('.admin-tab-content:not([style*="display:none"]):not([style*="display: none"])');if(tab)apply(tab,'admin-'+tab.id);},30);}var observer=new MutationObserver(function(records){if(records.some(function(record){return record.type==='childList'||(record.type==='attributes'&&record.attributeName==='style');}))refresh();});observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});refresh();});
})(window);
