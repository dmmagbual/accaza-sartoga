import {getApp,getApps} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {getDatabase,onValue,ref} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

function bind(){
  if(!getApps().length){setTimeout(bind,100);return;}
  const app=getApp(),auth=getAuth(app),db=getDatabase(app),fns=getFunctions(app,"asia-southeast1");
  window.__booksConvertSuspense=function(payload){
    if(!auth.currentUser)return Promise.reject(new Error("Sign in to Accaza Books first."));
    return auth.currentUser.getIdToken(true)
      .then(token=>httpsCallable(fns,"createManagerApproval")({action:"convert_suspense_supplier_advance",sourceId:payload.originalMovementId,amount:payload.amount,reason:payload.reason,managerIdToken:token}))
      .then(approval=>httpsCallable(fns,"postFinancialCommand")(Object.assign({},payload,{action:"convert_suspense_to_supplier_advance",commandId:"suspense_advance_reclass_"+payload.originalMovementId,approvalId:approval.data.approvalId})))
      .then(result=>result.data);
  };
  onValue(ref(db,"/suspenseAdvanceConversions"),snapshot=>{window.__suspenseAdvanceConversions=snapshot.val()||{};if(window.App&&App.render)App.render();},()=>{});
}
bind();
