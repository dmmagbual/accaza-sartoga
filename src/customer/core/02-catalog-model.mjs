
// DB refs
const settingsRef=ref(db,'settings'),staffAccountsRef=ref(db,'staffAccounts'),adminAccountsRef=ref(db,'adminAccounts'),ordersRef=ref(db,'orders'),archivedRef=ref(db,'archivedOrders'),archivedResRef=ref(db,'archivedReservations'),reservationsRef=ref(db,'reservations'),feedbacksRef=ref(db,'feedbacks'),reviewsRef=ref(db,'reviews'),availRef=ref(db,'availability'),paymentRef=ref(db,'payment'),calBlocksRef=ref(db,'calBlocks'),menuRef=ref(db,'menuItems'),categoriesRef=ref(db,'categories'),optionGroupsRef=ref(db,'optionGroups'),appCustomersRef=ref(db,'appCustomers'),publicOrderStatusRef=ref(db,'publicOrderStatus');const packagesRef=ref(db,'packages');
window.__custPkgs=[];
window.__accazaC={db:db,ref:ref,set:set,get:get,onValue:onValue,get menuItemsMap(){return menuItemsMap;},get optionGroupsMap(){return optionGroupsMap;},getMenuItems:getMenuItems,getCats:getCats,getCatLabel:getCatLabel,getItemOptionGroups:getItemOptionGroups};
window.__custAddPackage=function(components,meta){(components||[]).forEach(function(c){var key=Date.now()+'_'+Math.random().toString(36).substr(2,5)+Math.floor(Math.random()*99);cart[key]={name:c.name,details:c.details||('pkg: '+meta.name),qty:c.qty,unitTotal:c.unitTotal,cat:c.cat||'',itemKey:c.itemKey,size:c.size||null,optLabels:c.optLabels||[],stream:(meta.type==='promo'?'promo':'events'),pkgId:meta.id,packageRole:c.packageRole||null};});window.__custPkgs.push(meta);updateCartDisplay();renderOrderSection();};

let currentAdminHash=null,staffAccountsMap={},adminAccountsMap={},staffLoggedIn=false,superAdminLoggedIn=false,currentUser=null,currentLoginRole=null;
const SUPER_ADMIN_USERNAME='superadmin',CAFE_PHONE='639276924831',CAFE_EMAIL='admin@accazacoffee.com',MAX_GUESTS=30;
const TIME_SLOTS=['3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM','12:00 Midnight'];

const DEFAULT_CATS=[
  {id:'coffee',label:'Coffee Based',icon:'☕',order:0},
  {id:'noncaf',label:'Non-Coffee Based',icon:'🌿',order:1},
  {id:'frappe',label:'Iced Blended Coffee',icon:'🥤',order:2},
  {id:'nonfrappe',label:'Iced Blended Non-Coffee',icon:'🧊',order:3},
  {id:'soda',label:'Soda-Based Refreshers',icon:'🍋',order:4},
  {id:'pastry',label:'Pastries',icon:'🍞',order:5}
];

// Customize cats
const DRINK_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];
const TEMP_CATS=['coffee','noncaf'];
const MILK_CATS=['coffee','noncaf','frappe','nonfrappe'];
const SHOT_CATS=['coffee','frappe'];
const SYRUP_CATS=['coffee','noncaf','frappe','nonfrappe'];
const TOPPING_CATS=['coffee','noncaf','frappe','nonfrappe','soda'];

// ── OPTION GROUPS (data-driven item variations) ─────────────
const DEFAULT_OPTION_GROUPS={
  og_temp:{name:'Temperature',type:'single',required:true,order:0,choices:[{label:'Hot',price:0},{label:'Cold (Chilled, no ice)',price:0},{label:'Iced (with ice)',price:0}]},
  og_sweet:{name:'Sweetness',type:'single',required:true,order:1,choices:[{label:'Not Sweet',price:0},{label:'Less Sweet',price:0},{label:'Regular',price:0}]},
  og_milk:{name:'Choice of Milk',type:'single',required:true,order:2,choices:[{label:'Whole Milk',price:0},{label:'Goodmate Sub Oat',price:65}]},
  og_shot:{name:'Add Espresso Shot',type:'multi',required:false,order:3,choices:[{label:'Add 1 Shot',price:55}]},
  og_syrup:{name:'Add Syrup',type:'multi',required:false,order:4,choices:[{label:'Sugar Syrup',price:25},{label:'Sea Salt Caramel Syrup',price:40},{label:'White Chocolate Syrup',price:40},{label:'Toffee Nut Syrup',price:40},{label:'Hazelnut Syrup',price:40}]},
  og_top:{name:'Toppings',type:'multi',required:false,order:5,choices:[{label:'Sea Salt Cold Foam',price:35},{label:'Whipped Cream',price:35},{label:'Chocolate Chip',price:35}]}
};
function legacyOptionIdsFor(cat){
  var ids=[];
  if(TEMP_CATS.includes(cat))ids.push('og_temp');
  if(DRINK_CATS.includes(cat))ids.push('og_sweet');
  if(MILK_CATS.includes(cat))ids.push('og_milk');
  if(SHOT_CATS.includes(cat))ids.push('og_shot');
  if(SYRUP_CATS.includes(cat))ids.push('og_syrup');
  if(TOPPING_CATS.includes(cat))ids.push('og_top');
  return ids;
}
function getEffectiveOptionIds(item){return item.options?item.options:(item.optionsSet?[]:legacyOptionIdsFor(item.cat));}
function getItemOptionGroups(item){
  return getEffectiveOptionIds(item).map(function(id){var g=optionGroupsMap[id];return g?Object.assign({},g,{id:id}):null;}).filter(Boolean).sort(function(a,b){return(a.order||0)-(b.order||0);});
}
