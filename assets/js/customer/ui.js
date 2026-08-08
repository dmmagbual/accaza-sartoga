/* ===================== PHASE 1 ENHANCEMENTS (UI) ===================== */
(function(){
  // Toast helper (global)
  window.accazaToast=function(msg,type){
    var w=document.getElementById('toastWrap');
    if(!w){w=document.createElement('div');w.id='toastWrap';w.setAttribute('role','status');w.setAttribute('aria-live','polite');document.body.appendChild(w);}
    var t=document.createElement('div');t.className='toast'+(type?(' '+type):'');
    var ic=type==='ok'?'✓':type==='err'?'⚠':'☕';
    var s1=document.createElement('span');s1.className='ic';s1.textContent=ic;
    var s2=document.createElement('span');s2.className='tx';s2.textContent=msg;
    t.appendChild(s1);t.appendChild(s2);w.appendChild(t);
    setTimeout(function(){t.classList.add('hide');setTimeout(function(){if(t.parentNode)t.remove();},340);},3600);
  };

  function init(){
    var nav=document.querySelector('nav');
    // Back-to-top button
    var tt=document.createElement('button');
    tt.id='toTop';tt.setAttribute('aria-label','Back to top');tt.innerHTML='&#8593;';
    tt.onclick=function(){window.scrollTo({top:0,behavior:'smooth'});};
    document.body.appendChild(tt);
    // Scroll handlers: navbar shrink + show back-to-top
    function onScroll(){
      var y=window.pageYOffset||document.documentElement.scrollTop||0;
      if(nav){if(y>40)nav.classList.add('nav-shrink');else nav.classList.remove('nav-shrink');}
      if(y>500)tt.classList.add('show');else tt.classList.remove('show');
    }
    window.addEventListener('scroll',onScroll,{passive:true});onScroll();

    // Scroll reveal on stable section wrappers
    var sels=['.about-inner','.reel-inner','.menu-inner','.order-inner','.res-inner','.reviews-inner','.feedback-inner','.gallery-inner','.contact-inner'];
    var els=[];
    sels.forEach(function(s){document.querySelectorAll(s).forEach(function(e){e.classList.add('reveal');els.push(e);});});
    var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduce||!('IntersectionObserver' in window)){
      els.forEach(function(e){e.classList.add('in');});
    }else{
      var io=new IntersectionObserver(function(ents){
        ents.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target);}});
      },{threshold:0.10,rootMargin:'0px 0px -40px 0px'});
      els.forEach(function(e){io.observe(e);});
    }
    // Failsafe: never leave a block hidden
    setTimeout(function(){document.querySelectorAll('.reveal:not(.in)').forEach(function(e){e.classList.add('in');});},1700);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
