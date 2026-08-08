(function(){
'use strict';
var admins={},perms={};
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}
var PERMS=[['orders','Orders'],['reservations','Reservations & Calendar'],['pos','POS Register'],['inventory','Inventory'],['purchases','Purchases (Goods Received)'],['recipes','Recipes'],['usage','Internal Usage (staff & R&D)'],['registerOps','Register Ops (shifts, void, refund)'],['reviews','Reviews'],['appcustomers','App Customers'],['availability','Availability'],['comments','Comments'],['analytics','Analytics'],['pnl','P&L (financials)'],['dailyreport','Daily Report'],['discrepancy','Discrepancy Log'],['petty','Petty Cash'],['channelpricing','Channel Pricing (Grab/Panda)'],['dedupe','De-dupe Menu'],['cashflow','Cash Flow'],['receivables','Receivables'],['payables','Payables'],['stockvalue','Stock Value']];
var DEF={orders:true,reservations:true,pos:true,inventory:true,recipes:true,usage:true,registerOps:true,availability:true,comments:true,reviews:true,appcustomers:true,analytics:false,pnl:false,discrepancy:false,petty:true,channelpricing:false,dedupe:false,cashflow:false,receivables:false,payables:false,stockvalue:false};
var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
function init(){var a=A();a.subscribe('admins',function(s){admins=s.val()||{};if(isTab('staffaccess'))render();});a.subscribe('adminPerms',function(s){perms=s.val()||{};if(isTab('staffaccess'))render();});}
window.__accazaRegisterModule('staff',function(name){ if(name==='staffaccess')render(); });
function render(){
  var root=document.getElementById('staffAccessRoot'); if(!root)return;
  var uids=Object.keys(admins);
  var staff=uids.filter(function(u){return admins[u]==='staff';});
  var fulls=uids.filter(function(u){return admins[u]===true||admins[u]==='admin';});
  var html='<div class="pz-h">\ud83d\udd10 Staff Access</div><p class="pz-sub">Tick exactly which sections each staff member can open. Full admins always have full access; Payment Details and account management stay admin-only. To add someone: create their user in Firebase (Authentication \u2192 Add user), add their UID under <b>admins</b> as <b>staff</b>, then set access here. Changes apply on their next login.</p>';
  if(fulls.length)html+='<div class="pz-card" style="margin-bottom:1rem;"><b style="color:var(--bd);font-size:0.85rem;">Full admins ('+fulls.length+')</b><div style="font-size:0.78rem;color:var(--tl);margin-top:0.3rem;line-height:1.7;">'+fulls.map(function(u){var nm=(perms[u]&&perms[u].name)||'';return (nm?esc(nm)+' \u00b7 ':'')+'<code>'+esc(u.slice(0,10))+'\u2026</code>';}).join('<br>')+'</div></div>';
  if(!staff.length){html+='<div class="pz-card"><p class="az-note">No staff accounts yet. Create a Firebase user, add their UID under <b>admins</b> with value <b>staff</b>, and they will appear here to configure.</p></div>';root.innerHTML=html;return;}
  html+=staff.map(function(u){
    var pp=Object.assign({},DEF,perms[u]||{});var nm=(perms[u]&&perms[u].name)||'';
    return '<div class="pz-card" style="margin-bottom:0.8rem;" data-uid="'+esc(u)+'">'
      +'<div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.6rem;flex-wrap:wrap;"><input class="pz-in" data-name style="max-width:220px;" placeholder="Name (e.g. Maria)" value="'+esc(nm)+'"/><code style="font-size:0.7rem;color:var(--tl);">'+esc(u.slice(0,12))+'\u2026</code></div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0.3rem 0.8rem;">'
      +PERMS.map(function(pr){return '<label style="font-size:0.82rem;display:flex;align-items:center;gap:0.4rem;cursor:pointer;"><input type="checkbox" data-perm="'+pr[0]+'"'+(pp[pr[0]]?' checked':'')+'/> '+esc(pr[1])+'</label>';}).join('')
      +'</div>'
      +'<div style="margin-top:0.6rem;display:flex;gap:0.4rem;flex-wrap:wrap;"><button class="pz-btn ok" data-save>\ud83d\udcbe Save access</button><button class="pz-btn sec" data-all>Select all</button><button class="pz-btn sec" data-none>Clear</button></div>'
      +'</div>';
  }).join('');
  root.innerHTML=html;
  root.querySelectorAll('[data-uid]').forEach(function(card){
    var u=card.getAttribute('data-uid');
    card.querySelector('[data-save]').onclick=function(){
      var obj={name:(card.querySelector('[data-name]').value||'').trim()};
      card.querySelectorAll('[data-perm]').forEach(function(c){obj[c.getAttribute('data-perm')]=c.checked;});
      var a=A();a.set(a.ref(a.db,'adminPerms/'+u),obj).then(function(){var b=card.querySelector('[data-save]');b.textContent='\u2705 Saved';setTimeout(function(){b.textContent='\ud83d\udcbe Save access';},1500);}).catch(function(e){alert('Save failed: '+e);});
    };
    card.querySelector('[data-all]').onclick=function(){card.querySelectorAll('[data-perm]').forEach(function(c){c.checked=true;});};
    card.querySelector('[data-none]').onclick=function(){card.querySelectorAll('[data-perm]').forEach(function(c){c.checked=false;});};
  });
}
})();
