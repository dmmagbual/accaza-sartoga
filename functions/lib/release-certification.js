"use strict";
function check(id,label,status,detail){return{id,label,status,detail};}
function countOpen(value){return Object.values(value||{}).filter(row=>row&&row.status!=="resolved").length;}
function latestCertified(indexes){const rows=[];(indexes||[]).forEach(index=>Object.values(index||{}).forEach(row=>rows.push(row||{})));return rows.filter(row=>row.status==="CERTIFIED").sort((a,b)=>Number(b.preparedAt||0)-Number(a.preparedAt||0))[0]||null;}
function evaluate(input,now=Date.now()){
  input=input||{};const backup=input.backup||{},health=input.health||{},operational=input.operational||{counts:{}},admins=input.admins||{},permissions=input.permissions||{},openIncidents=countOpen(input.incidents),certified=latestCertified(input.closeIndexes),checks=[];
  const backupCurrent=Number(backup.takenAt)>0&&now-Number(backup.takenAt)<36*3600000&&backup.version==="backup-v2"&&backup.validation==="passed"&&/^[a-f0-9]{64}$/.test(String(backup.dataSha256||""));
  checks.push(check("backup_integrity","Current verified backup",backupCurrent?"passed":"blocked",backupCurrent?"backup-v2 fingerprint is current":"A current validated backup-v2 fingerprint is required"));
  checks.push(check("production_health","Production health",health.status==="healthy"?"passed":"blocked",`Monitor status: ${String(health.status||"missing")}`));
  checks.push(check("operational_exceptions","Operational and financial exceptions",Number(operational.counts&&operational.counts.critical)===0?"passed":"blocked",`${Number(operational.counts&&operational.counts.critical)||0} critical exception(s)`));
  checks.push(check("incident_register","Open incidents",openIncidents===0?"passed":"blocked",`${openIncidents} unresolved incident(s)`));
  checks.push(check("financial_close","Recent certified financial close",certified?"passed":"pending",certified?`Certified close ${String(certified.closeId||certified.shiftId||"")}`:"No certified close found in the latest two business dates"));
  const adminIds=new Set(Object.keys(admins)),permissionIds=Object.keys(permissions),orphans=permissionIds.filter(uid=>!adminIds.has(uid));
  checks.push(check("permission_consistency","Portal permission consistency",orphans.length===0?"passed":"blocked",`${adminIds.size} portal account(s); ${orphans.length} orphan permission profile(s)`));
  checks.push(check("isolated_restore","Isolated backup restore rehearsal","operator_required","Requires isolated-project fingerprint and reconciliation evidence"));
  checks.push(check("dependency_review","Current dependency security review","operator_required","Run the current registry audit and review all findings"));
  checks.push(check("financial_signoff","Qualified financial review","operator_required","Inventory, cash, AR, AP, Finance, and Books require reviewer sign-off"));
  const blocked=checks.filter(row=>row.status==="blocked").length,pending=checks.filter(row=>row.status!=="passed"&&row.status!=="blocked").length;
  return{schemaVersion:1,generatedAt:now,status:blocked?"blocked":pending?"operator_review_required":"ready",counts:{passed:checks.filter(row=>row.status==="passed").length,blocked,pending},scope:{portalAccounts:adminIds.size,permissionProfiles:permissionIds.length,openIncidents},checks,readyForOperatorReview:blocked===0};
}
module.exports={evaluate};
