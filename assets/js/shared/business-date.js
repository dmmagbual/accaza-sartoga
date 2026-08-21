(function(global){
  'use strict';
  var formatter=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
  function key(value){
    var parts=formatter.formatToParts(value instanceof Date?value:new Date(value==null?Date.now():value)),map={};
    parts.forEach(function(part){map[part.type]=part.value;});
    return map.year+'-'+map.month+'-'+map.day;
  }
  global.AccazaDate=Object.freeze({key:key,timeZone:'Asia/Manila'});
})(window);
