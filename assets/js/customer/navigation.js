(function(){
  'use strict';
  var tabs=document.querySelectorAll('#appTabBar a');
  tabs.forEach(function(tab){tab.addEventListener('click',function(){tabs.forEach(function(item){item.classList.remove('active');});this.classList.add('active');});});
})();
