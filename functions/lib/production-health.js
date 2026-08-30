"use strict";

const crypto=require("node:crypto");
const TARGETS={pos_boot:3000,pos_build:1500,cart_render:100,charge_to_durable:1500,offline_flush:5000,realtime_order_arrival:1500,live_ready:5000};
function alert(id,severity,title,detail){return{id,severity,title,detail};}
function evaluate(input,now=Date.now()){
  input=input||{};const alerts=[],backup=input.backup||{},rows=input.telemetry||[],operational=input.operational||{counts:{}};
  const backupAge=now-Number(backup.takenAt||0),hash=String(backup.dataSha256||"");
  if(!backup.takenAt)alerts.push(alert("backup_missing","critical","No verified database backup","System Health has no completed backup record."));
  else if(backupAge>36*3600000)alerts.push(alert("backup_stale","critical","Database backup is stale",`Latest backup is ${Math.floor(backupAge/3600000)} hours old.`));
  else if(backup.version!=="backup-v2"||backup.validation!=="passed"||!/^[a-f0-9]{64}$/.test(hash))alerts.push(alert("backup_unverified","warning","Backup integrity evidence is incomplete","Confirm backup-v2 validation and its SHA-256 fingerprint."));
  const combined={metrics:{},errors:0,samples:0,latest:0};rows.forEach(row=>{row=row||{};combined.latest=Math.max(combined.latest,Number(row.updatedAt)||0);Object.values(row.errors||{}).forEach(n=>combined.errors+=Number(n)||0);Object.keys(row.metrics||{}).forEach(key=>{const src=row.metrics[key]||{},dst=combined.metrics[key]||(combined.metrics[key]={count:0,totalMs:0,maxMs:0,failed:0});dst.count+=Number(src.count)||0;dst.totalMs+=Number(src.totalMs)||0;dst.maxMs=Math.max(dst.maxMs,Number(src.maxMs)||0);dst.failed+=Number(src.failed)||0;combined.samples+=Number(src.count)||0;});});
  Object.keys(TARGETS).forEach(key=>{const row=combined.metrics[key]||{},count=Number(row.count)||0;if(!count)return;const average=Number(row.totalMs||0)/count,target=TARGETS[key];if(Number(row.failed)>0||average>target||Number(row.maxMs)>target*2)alerts.push(alert(`performance_${key}`,"warning",`${key.replace(/_/g," ")} needs attention`,`${count} samples; average ${Math.round(average)}ms, worst ${Math.round(Number(row.maxMs)||0)}ms, failed ${Number(row.failed)||0}.`));});
  if(combined.errors>0)alerts.push(alert("client_errors","warning","Client errors detected",`${combined.errors} privacy-safe client error signal(s) were recorded.`));
  if(Number(operational.counts&&operational.counts.critical)>0)alerts.push(alert("operational_critical","critical","Critical operational exceptions exist",`${operational.counts.critical} critical exception(s) require controlled review.`));
  const rank={critical:0,warning:1};alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]||a.id.localeCompare(b.id));
  const status=alerts.some(x=>x.severity==="critical")?"critical":alerts.length?"warning":"healthy",signature=crypto.createHash("sha256").update(JSON.stringify(alerts.map(x=>[x.id,x.severity]))).digest("hex").slice(0,24);
  return{evaluatedAt:now,status,signature,counts:{critical:alerts.filter(x=>x.severity==="critical").length,warning:alerts.filter(x=>x.severity==="warning").length,total:alerts.length},signals:{backupAgeMs:backup.takenAt?backupAge:null,telemetrySamples:combined.samples,clientErrors:combined.errors,operationalExceptions:Number(operational.counts&&operational.counts.total)||0},alerts};
}
module.exports={TARGETS,evaluate};
