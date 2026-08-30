import{reconcileInventoryBooks}from'./inventory-books-reconciliation.mjs';
(function(){
'use strict';
var ordersMap={},archMap={},reviewsMap={},feedbacksMap={},custMap={},invMap={},recMap={},expMap={},expCatMap={},expItems={},monthlyExp={},adjMap={},usageMap={},payoutsMap={},varAcctMap={},receiptsMap={},posSettingsMap={},inventoryBooksJournal={},payoutCashAccounts={};
var inventoryBooksLoaded=false;
var financialCloseState={},financialCloseLoading={};
var svFrom=null,svTo=null,svExpand=null;
var azRange='month', azFrom=null, azTo=null, pnlMonth=null, analyticsHistoryLoading=false;
var poChannel='grabfood', poFrom=null, poTo=null;
var PO_CHANNELS=[{k:'grabfood',lbl:'GrabFood'},{k:'foodpanda',lbl:'FoodPanda'}];
var DEFAULT_VAR_ACCOUNTS=[
  {id:'va_ads',name:'Platform ads / marketing',type:'expense',order:1},
  {id:'va_marketing_success',name:'Grab marketing success fee',type:'expense',order:2},
  {id:'va_promo',name:'Other promo co-funding',type:'expense',order:3},
  {id:'va_fees',name:'Payment / processing fees',type:'expense',order:4},
  {id:'va_penalty',name:'Penalties / adjustments',type:'expense',order:5},
  {id:'va_refund',name:'Grab refund / cancellation deduction',type:'expense',order:6},
  {id:'va_refund_recovery',name:'Grab refund recovery / reversal',type:'revenue',order:7},
  {id:'va_incentive',name:'Incentives / rebates',type:'revenue',order:8}
];
function varAccounts(){var keys=Object.keys(varAcctMap);var list=keys.length?keys.map(function(k){return Object.assign({id:k},varAcctMap[k]);}):DEFAULT_VAR_ACCOUNTS.slice();return list.sort(function(a,b){return (a.order||0)-(b.order||0);});}
function A(){return window.__accaza;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function peso(n){n=Number(n)||0;return '₱'+n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function peso0(n){n=Number(n)||0;return '₱'+Math.round(n).toLocaleString('en-PH');}
function pct(n){return (n>=0?'+':'')+(Math.round(n*10)/10)+'%';}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function isTab(n){var el=document.getElementById('tab-'+n);return el&&el.style.display!=='none';}

var tries=0,iv=setInterval(function(){if(window.__accaza){clearInterval(iv);init();}else if(++tries>150)clearInterval(iv);},100);
/* Orders + archivedOrders feed every finance tab below — re-render whichever is
   open so loading older history (or live sales) refreshes the visible figures,
   not just Analytics. Fixes the Payout receivable staying stale after "Load older". */
function rerenderOrderTabs(){
  if(isTab('analytics'))renderAnalytics();
  if(isTab('payouts'))renderPayouts();
  if(isTab('stockvalue'))renderStockValue();
  if(isTab('dailyreport'))renderDailyReport();
}
function init(){
  var a=A();
  a.subscribe('orders',function(s){ordersMap=s.val()||{};captureCompletedAt(ordersMap);rerenderOrderTabs();});
  a.subscribe('archivedOrders',function(s){archMap=s.val()||{};rerenderOrderTabs();});
  a.subscribe('reviews',function(s){reviewsMap=s.val()||{};if(isTab('analytics'))renderAnalytics();});
  a.subscribe('feedbacks',function(s){feedbacksMap=s.val()||{};});
  a.subscribe('appCustomers',function(s){custMap=s.val()||{};if(isTab('analytics'))renderAnalytics();});
  a.subscribe('recipes',function(s){recMap=s.val()||{};});
  a.subscribe('expenseItems',function(s){expItems=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('monthlyExpenses',function(s){monthlyExp=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('inventoryAdjustments',function(s){adjMap=s.val()||{};if(isTab('pnl'))renderPnl();if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('internalUsage',function(s){usageMap=s.val()||{};if(isTab('pnl'))renderPnl();if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('stockReceipts',function(s){receiptsMap=s.val()||{};if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('inventory',function(s){invMap=s.val()||{};if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('books/journal',function(s){inventoryBooksJournal=s.val()||{};inventoryBooksLoaded=true;if(isTab('stockvalue'))renderStockValue();});
  a.subscribe('posSettings',function(s){posSettingsMap=s.val()||{};if(isTab('pnl'))renderPnl();});
  a.subscribe('platformPayouts',function(s){payoutsMap=s.val()||{};if(isTab('payouts'))renderPayouts();if(isTab('pnl'))renderPnl();if(isTab('analytics'))renderAnalytics();});
  a.subscribe('cfAccounts',function(s){payoutCashAccounts=s.val()||{};if(isTab('payouts'))renderPayouts();});
  a.subscribe('platformVarAccounts',function(s){varAcctMap=s.val()||{};if(isTab('payouts'))renderPayouts();if(isTab('pnl'))renderPnl();});
}
// extend the POS tab switcher to also render our tabs
window.__accazaRegisterModule('analytics',function(name){ if(name==='analytics')renderAnalytics(); if(name==='payouts')renderPayouts(); if(name==='stockvalue')renderStockValue(); if(name==='dailyreport')renderDailyReport(); });

// capture completedAt for ops metrics (idempotent, additive)
function captureCompletedAt(all){var a=A();Object.keys(all).forEach(function(id){var o=all[id];if(o&&o.status==='Completed'&&!o.completedAt){a.update(a.ref(a.db,'orders/'+id),{completedAt:Date.now()});}});}
