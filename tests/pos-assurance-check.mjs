import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const source=read('../src/functions/25-pos-assurance.js'),client=read('../src/admin/pos/00-shared-state.js'),health=read('../assets/js/admin/pos-sync-health.js'),close=read('../src/admin/register/80-shift-lifecycle-zreport.js'),live=read('../assets/js/admin/live-operations.js'),rules=read('../database.rules.json'),firebase=read('../assets/js/admin/firebase-client.mjs');
function ok(value,message){if(!value)throw new Error(message);}
for(const name of ['reportPosDeviceHealth','verifyShiftCloseReadiness','onShiftCloseAssurance'])ok(source.includes(`exports.${name}=`),`Missing POS assurance export ${name}`);
ok(source.includes("orderByChild('shiftId').equalTo(shiftId)")&&source.includes('financialMovements/sale_${id}')&&source.includes('order.inventoryDeducted===true'),'Close verification must use bounded shift orders plus inventory and Finance evidence');
ok(source.includes("status:verified?'verified':'posting_follow_up'")&&source.includes('receiptHash')&&source.includes('ownerDailySummaries/${businessDate}/${shiftId}'),'Immutable close receipt and compact daily summary are incomplete');
ok(health.includes("accaza_pos_device_id")&&health.includes('oldestUnsyncedAt')&&health.includes('},60000)')&&client.includes('AccazaPosSyncHealth.report'),'Cashier heartbeat does not retain device identity, queue age, or bounded cadence');
ok((close.match(/await continuityReadyForClose\(\)/g)||[]).length===2&&close.includes('verifyShiftCloseReadiness({shiftId:shift.id})'),'Shift close must verify local and server readiness before counting and before final save');
ok(live.includes("a.subscribe('posDeviceHealth'")&&live.includes("a.subscribe('ownerDailySummaries/'+day")&&live.includes("['Cashier sync',health.label]"),'Owner view does not expose sync health and compact daily close totals');
for(const node of ['posDeviceHealth','shiftCloseVerifications','shiftCloseReceipts','ownerDailySummaries'])ok(rules.includes(`"${node}"`),`Rules missing ${node}`);
ok(firebase.includes("callableNames.unshift('reportPosDeviceHealth','verifyShiftCloseReadiness')"),'Admin callable bridge missing POS assurance services');
console.log('PASS: cashier heartbeat, server-verified shift close, immutable close receipt, and compact owner daily summary are connected.');
