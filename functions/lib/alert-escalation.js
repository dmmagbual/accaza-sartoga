"use strict";

const COOLDOWN_MS={critical:4*3600000,warning:12*3600000};
const RANK={healthy:0,warning:1,critical:2};
function cleanStatus(value){return Object.prototype.hasOwnProperty.call(RANK,value)?value:"healthy";}
function decide(previous,current,state,now=Date.now()){
  previous=previous||{};current=current||{};state=state||{};
  const before=cleanStatus(previous.status),after=cleanStatus(current.status),last=Number(state.lastNotifiedAt||0),signature=String(current.signature||""),sameSignature=signature&&signature===String(state.lastSignature||""),recovered=after==="healthy"&&before!=="healthy";
  let reason="",notify=false;
  if(recovered){notify=true;reason="recovered";}
  else if(after!=="healthy"){
    const worsened=RANK[after]>RANK[before],newCritical=after==="critical"&&!sameSignature,firstAlert=!last,reminder=last>0&&now-last>=COOLDOWN_MS[after];
    if(firstAlert||worsened||newCritical){notify=true;reason=firstAlert?"first_alert":worsened?"severity_increased":"critical_signal_changed";}
    else if(reminder){notify=true;reason="reminder";}
  }
  if(!notify)return{notify:false,reason:"suppressed",nextState:state};
  const counts=current.counts||{},title=recovered?"✅ Accaza production health recovered":after==="critical"?"🚨 Accaza production health critical":"⚠️ Accaza production health warning",body=recovered?"The automated monitor is healthy again. Review Operations Center and close any related incident only after verification.":`${Number(counts.critical)||0} critical · ${Number(counts.warning)||0} warning signal(s). Open Operations Center; do not repair financial records directly.`;
  return{notify:true,reason,title,body,audience:"management",link:"/admin.html#tab-operations",nextState:{lastNotifiedAt:now,lastStatus:after,lastSignature:signature,lastReason:reason,schemaVersion:1}};
}

module.exports={COOLDOWN_MS,decide};
