(function(){
  'use strict';
  var STORE='accaza_identity_autofill_v1',LIMIT=40,lists={},values=load();
  var groups=[
    ['supplier',/\b(supplier|vendor)\b/i],
    ['customer',/\b(customer|client|guest)\b/i],
    ['staff',/\b(staff|employee|received by|prepared by|approved by|approver|cashier|custodian)\b/i],
    ['payee',/\b(payee|recipient|requester)\b/i],
    ['owner',/\b(owner|partner)\b/i],
    ['brand',/\bbrand\b/i],
    ['item',/\b(item name|product name|asset name|equipment name)\b/i],
    ['location',/\b(location|branch|site)\b/i]
  ];
  var blocked=/\b(invoice|reference|reason|note|description|purpose|memo|password|email|phone|amount|account|code|date|lot|expiry|search)\b/i;
  function load(){try{var x=JSON.parse(localStorage.getItem(STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(e){return {};}}
  function save(){try{localStorage.setItem(STORE,JSON.stringify(values));}catch(e){}}
  function context(el){var label=el.closest&&el.closest('label'),labelText=label?label.textContent:'';if(!labelText&&el.id){var linked=document.querySelector('label[for="'+String(el.id).replace(/"/g,'\\"')+'"]');labelText=linked?linked.textContent:'';}var previous=el.previousElementSibling;return [el.id,el.name,el.getAttribute('data-afd'),el.placeholder,el.getAttribute('aria-label'),labelText,previous&&previous.textContent].filter(Boolean).join(' ');}
  function groupFor(el){if(!el||el.tagName!=='INPUT'||(el.type&&el.type!=='text')||el.readOnly||el.disabled||el.hasAttribute('list'))return '';var text=context(el);if(blocked.test(text))return '';for(var i=0;i<groups.length;i++)if(groups[i][1].test(text))return groups[i][0];return '';}
  function listFor(group){if(lists[group])return lists[group];var list=document.createElement('datalist');list.id='accazaAutofill_'+group;document.body.appendChild(list);lists[group]=list;refresh(group);return list;}
  function refresh(group){var list=lists[group];if(!list)return;list.innerHTML=(values[group]||[]).map(function(v){var o=document.createElement('option');o.value=v;return o;}).reduce(function(fragment,o){fragment.appendChild(o);return fragment;},document.createDocumentFragment());}
  function remember(group,value){value=String(value||'').trim().replace(/\s+/g,' ');if(value.length<2||value.length>120)return;var key=value.toLocaleLowerCase(),rows=(values[group]||[]).filter(function(x){return String(x).toLocaleLowerCase()!==key;});rows.unshift(value);values[group]=rows.slice(0,LIMIT);refresh(group);save();}
  function wire(el){if(el.dataset.accazaAutofill)return;var group=groupFor(el);if(!group)return;el.dataset.accazaAutofill=group;el.setAttribute('list',listFor(group).id);el.setAttribute('autocomplete','off');el.addEventListener('change',function(){remember(group,el.value);});el.addEventListener('blur',function(){remember(group,el.value);});}
  function scan(root){if(root&&root.matches&&root.matches('input'))wire(root);(root.querySelectorAll?root:document).querySelectorAll('input').forEach(wire);}
  function start(){scan(document);new MutationObserver(function(changes){changes.forEach(function(change){change.addedNodes.forEach(function(node){if(node.nodeType===1)scan(node);});});}).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
