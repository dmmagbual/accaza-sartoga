/* ---------- cash denomination tracking (checkout) ---------- */
var POS_DENOMS=[
  {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
  {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
];
function denomTrackingOn(){return !!(window.__posSettings&&window.__posSettings.denomTracking);}
function shiftDrawer(){var sh=window.__posShift;return (sh&&sh.drawer)?Object.assign({},sh.drawer):{};}
function posRcvRead(){var counts={},total=0;document.querySelectorAll('[data-prd]').forEach(function(inp){var q=Number(inp.value)||0;if(q>0){counts[inp.getAttribute('data-prd')]=q;total+=q*(Number(inp.getAttribute('data-prv'))||0);}});return {counts:counts,total:Math.round(total*100)/100};}
function mergeDenoms(a,b){var o=Object.assign({},a||{});Object.keys(b||{}).forEach(function(k){o[k]=(Number(o[k])||0)+(Number(b[k])||0);});return o;}
function posKeepTip(change){var k=document.getElementById('posKeep');if(!k||!k.checked)return 0;change=Math.round((Number(change)||0)*100)/100;var amt=Number((document.getElementById('posKeepAmt')||{}).value);if(!(amt>0))amt=change;return Math.min(Math.max(0,Math.round(amt*100)/100),change);}
// Exact change from every combination the drawer holds (assets/js/shared/cash-change.js); the
// largest-first loop below is only the fallback if that shared script failed to load.
function makeChange(amount,avail){if(window.AccazaCashChange)return window.AccazaCashChange.plan(amount,avail||{});var rem=Math.round(amount*100);var give={};POS_DENOMS.forEach(function(d){if(rem<=0)return;var cents=Math.round(d.v*100);var have=Number(avail[d.k])||0;var use=Math.min(Math.floor(rem/cents),have);if(use>0){give[d.k]=use;rem-=use*cents;}});return {denoms:give,ok:rem<=0,short:rem/100};}
function posDenomTotal(c){var t=0;POS_DENOMS.forEach(function(d){t+=(Number(c&&c[d.k])||0)*Math.round(d.v*100);});return t/100;}
// Notes/coins the cashier wants to hand over that the POS count (drawer + just received) does not hold.
// The server refuses a sale whose change would take a count below zero, so these must be fixed first.
function posDenomLack(given,avail){return POS_DENOMS.filter(function(d){return (Number(given&&given[d.k])||0)>(Number(avail&&avail[d.k])||0);}).map(function(d){return (Number(avail&&avail[d.k])||0)+' × '+d.lbl;});}
function posDenomPadHtml(){
  return '<span class="pz-lbl">Cash received — enter note/coin counts</span>'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:0.3rem;margin-top:0.3rem;">'
    +POS_DENOMS.map(function(d){return '<label style="font-size:0.68rem;color:var(--tm);display:flex;flex-direction:column;gap:0.1rem;">'+d.lbl+'<input class="pz-in" type="number" min="0" step="1" data-prd="'+d.k+'" data-prv="'+d.v+'" placeholder="0" style="padding:0.2rem 0.3rem;"/></label>';}).join('')
    +'</div><div id="posDenomInfo" style="font-size:0.8rem;font-weight:600;margin-top:0.45rem;"></div>';
}
