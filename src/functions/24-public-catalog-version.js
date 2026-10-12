// Keep public catalog freshness separate from the catalog payload. Customers
// listen to this tiny marker and fetch menu data only when it changes.
//
// maxInstances: the region's Cloud Run CPU quota is shared with every other function, and an
// uncapped burst of freshly created revisions is what failed the production deploy (Oct 2026:
// the catalog-version triggers failed every attempt). Bumping a version marker needs at most a
// couple of instances, so the ceiling costs nothing and removes that burst.
function bumpPublicCatalogVersion(source){
  return async function(){
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
