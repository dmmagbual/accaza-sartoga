
/* ---------- Discrepancy helpers that must stay EAGER ---------- */
/* AP: register bundle split, step 1 (13 Oct 2026).
   The always-on subscription in 00-bootstrap-payment-controls.js runs on every register tab:
     a.subscribe('discrepancies', function(s){ discMap=s.val()||{}; updateDiscBadge(); if(isTab('discrepancy'))renderDiscrepancies(); });
   updateDiscBadge() therefore has to exist without the discrepancies screen being open, and it needs
   discList() -> isHiddenLegacyDiscrepancy() -> discrepancyDate() -> window.AccazaDate. Those functions,
   plus the number formatter dnum() they share with the rest of the register screens, live here so the
   discrepancies RENDER code can move to a lazily loaded companion (step 2) without leaving the badge
   broken on the other tabs. Same bundle, same scope, function declarations only -- moving them between
   files changes no behaviour. */
function dnum(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function discrepancyDate(d){return String(d&&d.date||window.AccazaDate.key(d&&((d.ts||d.closedAt||d.createdAt)||Date.now()))).slice(0,10);}
function isRetainedLegacyDiscrepancy(d){return discrepancyDate(d)==='2026-08-30'&&d&&d.kind==='cash'&&Number(d.variance)<0&&Math.abs(Math.abs(Number(d.variance))-120)<.005;}
function isHiddenLegacyDiscrepancy(d){var day=discrepancyDate(d);return day<='2026-08-30'&&!isRetainedLegacyDiscrepancy(d);}
function discList(openOnly){var arr=Object.keys(discMap).map(function(k){return Object.assign({id:k},discMap[k]);}).filter(function(d){return !isHiddenLegacyDiscrepancy(d);});if(openOnly)arr=arr.filter(function(d){return d.status!=='reviewed'&&d.status!=='legacy_closed';});return arr.sort(function(a,b){return (b.ts||0)-(a.ts||0);});}
function updateDiscBadge(){var n=discList(true).length;var b=document.getElementById('discBadge');if(b){b.textContent=n;b.style.display=n?'inline-block':'none';}}
