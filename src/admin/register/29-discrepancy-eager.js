
/* ---------- Discrepancy helpers that must stay EAGER ---------- */
/* Always-on discrepancy subscriptions need these helpers inside the register IIFE.
   A companion split must expose an explicit window API; see the reverted split plan. */
function dnum(n){n=Number(n)||0;return (Math.round(n*1000)/1000).toLocaleString('en-PH');}
function discrepancyDate(d){return String(d&&d.date||window.AccazaDate.key(d&&((d.ts||d.closedAt||d.createdAt)||Date.now()))).slice(0,10);}
function isRetainedLegacyDiscrepancy(d){return discrepancyDate(d)==='2026-08-30'&&d&&d.kind==='cash'&&Number(d.variance)<0&&Math.abs(Math.abs(Number(d.variance))-120)<.005;}
function isHiddenLegacyDiscrepancy(d){var day=discrepancyDate(d);return day<='2026-08-30'&&!isRetainedLegacyDiscrepancy(d);}
function discList(openOnly){var arr=Object.keys(discMap).map(function(k){return Object.assign({id:k},discMap[k]);}).filter(function(d){return !isHiddenLegacyDiscrepancy(d);});if(openOnly)arr=arr.filter(function(d){return d.status!=='reviewed'&&d.status!=='legacy_closed';});return arr.sort(function(a,b){return (b.ts||0)-(a.ts||0);});}
function updateDiscBadge(){var n=discList(true).length;var b=document.getElementById('discBadge');if(b){b.textContent=n;b.style.display=n?'inline-block':'none';}}
