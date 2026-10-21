// Chart axes: round gridline steps and short labels sized to fit, so an amount is
// never clipped at the canvas edge or shown as an odd fraction of the tallest bar.
var OVERVIEW_AXIS_STEPS=[1,1.5,2,2.5,3,4,5,6,8,10];
function overviewNiceStep(raw){raw=Number(raw)||0;if(raw<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;for(var i=0;i<OVERVIEW_AXIS_STEPS.length;i++){if(f<=OVERVIEW_AXIS_STEPS[i]+1e-9)return OVERVIEW_AXIS_STEPS[i]*p;}return 10*p;}
function overviewNiceMax(max){return overviewNiceStep(Math.max(Number(max)||0,1)/4)*4;}
function overviewNiceCount(max){return Math.max(1,Math.ceil(overviewNiceStep(Math.max(Number(max)||0,1)/4)))*4;}
function overviewAxisMoney(v){v=Number(v)||0;var a=Math.abs(v),fmt=function(x){return x.toLocaleString('en-PH',{maximumFractionDigits:2});};if(a>=1e6)return'₱'+fmt(v/1e6)+'M';if(a>=1e3)return'₱'+fmt(v/1e3)+'k';return'₱'+fmt(Math.round(v));}
function overviewAxisPad(ctx,max,label){ctx.save();ctx.font='10px Inter,sans-serif';var w=0;[0,.25,.5,.75,1].forEach(function(p){w=Math.max(w,ctx.measureText((label||overviewAxisMoney)(max*p)).width);});ctx.restore();return Math.ceil(w)+12;}
export{overviewAxisMoney,overviewAxisPad,overviewNiceCount,overviewNiceMax,overviewNiceStep};
