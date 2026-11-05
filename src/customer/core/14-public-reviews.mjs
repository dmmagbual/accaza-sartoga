
function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// ── PUBLIC REVIEWS ── (assets/js/customer/public-reviews.mjs)
installPublicReviews({get,query,reviewsRef,orderByKey,limitToLast,escHtml});
