
function escHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
// ── PUBLIC REVIEWS (dynamic) ────────────────────────────────
var _publicReviewsLoaded=false,_publicReviewsLoading=false;
var DEFAULT_PUBLIC_REVIEWS={
  'rev_001':{name:'Maria Theresa & Quinn Isabella Margaux',stars:5,date:'June 2, 2026',text:'Accaza Coffee House is a hidden gem right along the roadside near SM Dasmariñas — easy to find whether you\'re commuting or driving. Inside, it\'s surprisingly spacious with a calm, serene atmosphere that\'s rare among today\'s cramped cafés.\n\nThe coffee is outstanding, with well-crafted flavors from bold to smooth. But what truly sets Accaza apart is how perfectly it serves both students and professionals — it\'s a productive sanctuary where you can focus, study, or work in peace.\n\nHighly recommended for anyone looking for great coffee and a place to get things done. ☕✨'},
  'rev_002':{name:'Molina Page',stars:5,date:'June 2026',text:'The coffee was absolutely delightful — perfectly brewed, rich in flavor, and made with genuine care. Every sip spoke to your passion and quality.\n\nBeyond the coffee, your staff made the visit truly special. From the warm greeting to the attentive service, everyone made me feel genuinely valued. It\'s rare to find a team so professional yet so kind and approachable.'},
  'rev_003':{name:'Camilla Andrea',stars:5,date:'April 6, 2026 · via Facebook',text:'Nasa may highway ang coffee shop, ngunit nakakubli ang ganda nitong hindi mo mamamalas kung hindi sasadyain. Mukha siyang maliit sa labas, subalit malaki ang espasyo pagpasok, na tila napunta ka na sa ibang lugar.\n\nGusto ko mang ipagdamot ang lugar para patuloy akong makatambay nang matiwasay, subalit tingin ko\'y kasalanan ito sa mga mahilig sa kape (at sa may-ari rin) kung hindi ito maibabahagi sa iba.'},
  'rev_004':{name:'Cess Borja',stars:5,date:'July 2025',text:'"10/10 would recommend!! we will surely come back 🤌"'}
};
window.__loadPublicReviews=async function(){
  if(_publicReviewsLoaded||_publicReviewsLoading)return;
  _publicReviewsLoading=true;
  var el=document.getElementById('publicReviewsContainer');
  if(el)el.innerHTML='<p style="text-align:center;color:var(--tl);padding:2rem;">Loading reviews...</p>';
  try{
    var snap=await get(query(reviewsRef,orderByKey(),limitToLast(20)));
    if(snap.exists())reviewsMap=snap.val();
    else{
      reviewsMap=DEFAULT_PUBLIC_REVIEWS;
      // Preserve the existing seed for a newly created database, but do not
      // write from a read failure or on every public page visit.
      set(reviewsRef,DEFAULT_PUBLIC_REVIEWS).catch(function(){});
    }
  }catch(e){
    if(!Object.keys(reviewsMap).length)reviewsMap=DEFAULT_PUBLIC_REVIEWS;
  }
  _publicReviewsLoading=false;
  _publicReviewsLoaded=true;
  renderPublicReviews();
};
function renderPublicReviews(){
  var el=document.getElementById('publicReviewsContainer');if(!el)return;
  var entries=Object.entries(reviewsMap);
  if(!entries.length){el.innerHTML='<p style="text-align:center;color:var(--tl);padding:2rem;">No reviews yet.</p>';return;}
  function stars(n){return'⭐'.repeat(Math.max(1,Math.min(5,parseInt(n)||5)));}
  function card(r,featured){
    var initials=escHtml((r.name||'?').split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase());
    return'<div class="review-card"'+(featured?' style="margin-bottom:1.25rem;"':'')+'>'+
      '<div class="review-stars">'+stars(r.stars)+'</div>'+
      (r.title?'<p style="font-weight:600;color:var(--bd);margin-bottom:0.75rem;font-size:0.95rem;">'+escHtml(r.title)+'</p>':'')+
      '<p class="review-text">'+escHtml(r.text).replace(/\n/g,'<br>')+'</p>'+
      '<div class="review-author"><div class="review-avatar">'+initials+'</div>'+
      '<div><div class="review-name">'+escHtml(r.name)+'</div>'+
      '<div class="review-date">'+escHtml(r.date)+'</div></div></div></div>';
  }
  var html2='';
  if(entries.length===1){
    html2=card(entries[0][1],true);
  }else{
    html2=card(entries[0][1],true);
    html2+='<div class="reviews-grid">';
    for(var i=1;i<entries.length;i++)html2+=card(entries[i][1],false);
    html2+='</div>';
  }
  el.innerHTML=html2;
}
