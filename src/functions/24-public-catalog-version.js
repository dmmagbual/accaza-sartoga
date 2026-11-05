// Keep public catalog freshness separate from the catalog payload. Customers
// listen to this tiny marker and fetch menu data only when it changes.
//
// maxInstances: the region's Cloud Run CPU quota is shared with every other function, and an
// uncapped burst of freshly created revisions is what failed the production deploy (Oct 2026:
// the catalog-version triggers failed every attempt). Bumping a version marker needs at most a
// couple of instances, so the ceiling costs nothing and removes that burst.
// Menu price history (audit R-09, 4 Nov 2026): every change to an item's price fields (price, priceS,
// priceM, priceL, ...) is kept under /menuPriceHistory/{itemId}, with the old and new value, the time and
// the signed-in account that saved it. Keyed by the event id, so a redelivery records nothing twice.
function menuPriceChanges(before,after){
  var out={},b=before&&typeof before==='object'?before:{},a=after&&typeof after==='object'?after:{};
  Object.keys(Object.assign({},b,a)).forEach(function(itemId){
    var x=b[itemId]&&typeof b[itemId]==='object'?b[itemId]:{},y=a[itemId]&&typeof a[itemId]==='object'?a[itemId]:{},fields={};
    Object.keys(Object.assign({},x,y)).forEach(function(k){if(!/^price/i.test(k))return;var val=function(v){if(v==null)return null;var num=Number(v);return Number.isFinite(num)?num:String(v).slice(0,40);},o=val(x[k]),n=val(y[k]);if(o!==n)fields[k]={from:o,to:n};});
    if(Object.keys(fields).length)out[itemId]={name:String(y.name||x.name||'').slice(0,120),fields:fields,removed:!b[itemId]?false:!a[itemId]};
  });
  return out;
}
function bumpPublicCatalogVersion(source){
  return async function(event){
    if(source==='menuItems'&&event&&event.data){
      var changes=menuPriceChanges(event.data.before&&event.data.before.val(),event.data.after&&event.data.after.val()),writes={},key=String(event.id||Date.now()).replace(/[.#$\[\]\/]/g,'_').slice(0,120),at=Date.now();
      Object.keys(changes).forEach(function(itemId){writes['menuPriceHistory/'+itemId+'/'+key]=Object.assign({at:at,byUid:event.authId||null,byType:event.authType||null},changes[itemId]);});
      // History never blocks the catalog version bump below.
      if(Object.keys(writes).length){try{await getDatabase().ref().update(writes);}catch(error){console.warn('menu price history write failed',String(error));}}
    }
    await getDatabase().ref('/publicCatalogVersion').transaction(function(current){
      var previous=current&&typeof current==='object'?current:{};
      return{schemaVersion:1,version:(Number(previous.version)||0)+1,changedAt:Date.now(),source:source};
    },undefined,false);
  };
}
exports.updatePublicCatalogVersionOnCategories = onValueWritten({ref:'/categories',region:ORDER_REGION,retry:true,maxInstances:2},bumpPublicCatalogVersion('categories'));
exports.updatePublicCatalogVersionOnMenuItems = onValueWritten({ref:'/menuItems',region:ORDER_REGION,retry:true,maxInstances:2},bumpPublicCatalogVersion('menuItems'));
exports.updatePublicCatalogVersionOnOptionGroups = onValueWritten({ref:'/optionGroups',region:ORDER_REGION,retry:true,maxInstances:2},bumpPublicCatalogVersion('optionGroups'));
exports.updatePublicCatalogVersionOnPackages = onValueWritten({ref:'/packages',region:ORDER_REGION,retry:true,maxInstances:2},bumpPublicCatalogVersion('packages'));
