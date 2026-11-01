(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaCashChange=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - which notes and coins to hand back as change (1 Nov 2026).
     The till used to try the biggest note first and give up when that left an amount it could not
     make: P60 from one P50 and three P20s came back "no exact change". plan() looks at every
     combination the drawer holds and returns an exact one when any exists (not always the fewest
     pieces). Amounts are whole 5-centavo steps so 25c/10c/5c coins never drift. When no exact combination exists it returns the closest
     amount below and how much is still short, the same shape the POS already understood. */
  var DENOMS=[
    {k:'b1000',v:1000,lbl:'₱1000'},{k:'b500',v:500,lbl:'₱500'},{k:'b200',v:200,lbl:'₱200'},{k:'b100',v:100,lbl:'₱100'},{k:'b50',v:50,lbl:'₱50'},{k:'p20',v:20,lbl:'₱20'},
    {k:'c10',v:10,lbl:'₱10'},{k:'c5',v:5,lbl:'₱5'},{k:'c1',v:1,lbl:'₱1'},{k:'c25',v:0.25,lbl:'25¢'},{k:'c10s',v:0.10,lbl:'10¢'},{k:'c5s',v:0.05,lbl:'5¢'}
  ];
  // Work is counted in 5-centavo steps (the smallest coin). Up to P20,000 of change that is at most
  // 400,000 steps and a few MB, run on every keypress; anything larger is a typing slip, so the
  // biggest-note-first answer is used instead of letting the till freeze.
  var UNIT=5,MAX_UNITS=400000;
  function count(v){var n=Math.floor(Number(v)||0);return n>0?n:0;}
  function greedy(cents,avail){var rem=cents,give={};DENOMS.forEach(function(d){var c=Math.round(d.v*100),use=Math.min(Math.floor(rem/c),count(avail&&avail[d.k]));if(use>0){give[d.k]=use;rem-=use*c;}});return {denoms:give,ok:rem===0,short:rem/100};}
  function plan(amount,avail){
    var cents=Math.round((Number(amount)||0)*100);
    if(!(cents>0))return {denoms:{},ok:true,short:0};
    var target=Math.floor(cents/UNIT),odd=cents-target*UNIT;
    if(target>MAX_UNITS)return greedy(cents,avail);
    var reach=new Uint8Array(target+1),via=new Int8Array(target+1).fill(-1),used=new Uint32Array(target+1);
    reach[0]=1;
    // Each denomination extends amounts already reachable by a run of at most "have" pieces;
    // following via[] back from any amount never uses more pieces than the drawer holds.
    DENOMS.forEach(function(d,i){
      var step=Math.round(d.v*100)/UNIT,have=count(avail&&avail[d.k]);if(!have||step>target)return;
      for(var v=step;v<=target;v++){if(reach[v]||!reach[v-step])continue;var run=via[v-step]===i?used[v-step]+1:1;if(run>have)continue;reach[v]=1;via[v]=i;used[v]=run;}
    });
    var best=target;while(best>0&&!reach[best])best--;
    var give={},v=best;while(v>0){var d=DENOMS[via[v]];give[d.k]=(give[d.k]||0)+1;v-=Math.round(d.v*100)/UNIT;}
    var short=(target-best)*UNIT+odd;
    return {denoms:give,ok:short===0,short:short/100};
  }
  return {DENOMS:DENOMS,plan:plan};
});
