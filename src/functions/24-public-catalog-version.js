// Keep public catalog freshness separate from the catalog payload. Customers
// listen to this tiny marker and fetch menu data only when it changes.
function bumpPublicCatalogVersion(source){
  return async function(){
    await getDatabase().ref('/publicCatalogVersion').transaction(function(current){
      var previous=current&&typeof current==='object'?current:{};
      return{schemaVersion:1,version:(Number(previous.version)||0)+1,changedAt:Date.now(),source:source};
    },undefined,false);
  };
}
exports.updatePublicCatalogVersionOnCategories = onValueWritten({ref:'/categories',region:ORDER_REGION,retry:true},bumpPublicCatalogVersion('categories'));
exports.updatePublicCatalogVersionOnMenuItems = onValueWritten({ref:'/menuItems',region:ORDER_REGION,retry:true},bumpPublicCatalogVersion('menuItems'));
exports.updatePublicCatalogVersionOnOptionGroups = onValueWritten({ref:'/optionGroups',region:ORDER_REGION,retry:true},bumpPublicCatalogVersion('optionGroups'));
