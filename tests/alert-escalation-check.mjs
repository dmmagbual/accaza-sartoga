import fs from 'node:fs';
const maintenance=fs.readFileSync(new URL('../src/functions/60-maintenance.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../src/functions/00-bootstrap-notifications.js',import.meta.url),'utf8');
if(bootstrap.includes('AlertEscalation'))throw new Error('Production-health push escalation is still imported.');
for(const forbidden of ['AlertEscalation.decide','productionMonitor/notificationState','decision.notify','decision.audience'])if(maintenance.includes(forbidden))throw new Error(`Production-health push escalation is still active: ${forbidden}`);
if(!maintenance.includes('notification:"disabled"'))throw new Error('Production-health evaluation does not explicitly record that push notification is disabled.');
console.log('PASS: production-health evaluation remains available without sending staff push notifications.');
