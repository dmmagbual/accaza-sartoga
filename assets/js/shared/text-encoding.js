(function(global){
  'use strict';
  /* Repair only the recognizable UTF-8-as-Windows-1252 corruption pattern.
     Correct Unicode is left untouched. */
  var WIN1252={"€":128,"‚":130,"ƒ":131,"„":132,"…":133,"†":134,"‡":135,"ˆ":136,"‰":137,"Š":138,"‹":139,"Œ":140,"Ž":142,"‘":145,"’":146,"“":147,"”":148,"•":149,"–":150,"—":151,"˜":152,"™":153,"š":154,"›":155,"œ":156,"ž":158,"Ÿ":159};
  function suspicious(value){return /(?:\u00c2[\u0080-\u00ff]|\u00c3[\u0080-\u00ff]|\u00e2[\u0080-\u00ff\u201a\u20ac\u201c\u201d\u2013\u2014]|\u00f0\u0178)/.test(String(value||''));}
  function repair(value){
    value=String(value==null?'':value);if(!suspicious(value)||!global.TextDecoder)return value;
    try{
      var bytes=Uint8Array.from(Array.from(value),function(ch){var n=ch.charCodeAt(0);return n<=255?n:WIN1252[ch];});
      if(Array.from(bytes).some(function(n){return n===undefined;}))return value;
      var fixed=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      return fixed&&fixed!==value?fixed:value;
    }catch(_e){return value;}
  }
  function repairNode(node){
    if(!node)return;
    if(node.nodeType===3){var parent=node.parentNode,tag=parent&&parent.nodeName;if(tag==='SCRIPT'||tag==='STYLE'||tag==='TEXTAREA')return;var fixed=repair(node.nodeValue);if(fixed!==node.nodeValue)node.nodeValue=fixed;return;}
    if(node.nodeType!==1)return;
    ['title','aria-label','placeholder','alt'].forEach(function(name){if(node.hasAttribute&&node.hasAttribute(name)){var value=node.getAttribute(name),fixed=repair(value);if(fixed!==value)node.setAttribute(name,fixed);}});
    node.childNodes&&node.childNodes.forEach(repairNode);
  }
  function start(){repairNode(document.body);if(!global.MutationObserver||!document.body)return;new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(repairNode);if(record.type==='characterData')repairNode(record.target);});}).observe(document.body,{subtree:true,childList:true,characterData:true});}
  global.AccazaTextEncoding={repair:repair,start:start};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
