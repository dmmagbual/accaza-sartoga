(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AccazaPlatformChannels=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  /* Accaza - delivery platform commission defaults (3 Nov 2026).
     POS Settings may override each rate. Pages outside the POS bundle (platform payout
     reconciliation) could not see the POS copy of these defaults, so the "about N% of gross" hint
     on a re-keyed missed order never showed. tests/cash-change-check.mjs keeps this list equal to
     POS_CHANNELS in src/admin/pos/00-shared-state.js. */
  var CHANNELS=[
    {k:'grabfood',lbl:'GrabFood',rate:0.25,wht:0,vat:0},
    {k:'foodpanda',lbl:'FoodPanda',rate:0.30,wht:0.005,vat:0.036}
  ];
  function find(ch){for(var i=0;i<CHANNELS.length;i++)if(CHANNELS[i].k===ch)return CHANNELS[i];return null;}
  // Commission rate for a channel: the POS Settings value when set, otherwise the default; 0 for
  // anything that is not a delivery platform.
  function rate(ch,channelSettings){
    var d=find(ch);if(!d)return 0;
    var s=channelSettings&&channelSettings[ch];
    var v=s&&s.rate!=null?Number(s.rate):d.rate;
    return Number.isFinite(v)&&v>=0&&v<1?v:d.rate;
  }
  return {CHANNELS:CHANNELS.map(function(c){return Object.assign({},c);}),rate:rate};
});
