import fs from 'node:fs';
const maintenance=fs.readFileSync(new URL('../src/functions/60-maintenance.js',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../src/functions/00-bootstrap-notifications.js',import.meta.url),'utf8');
if(bootstrap.includes('AlertEscalation'))throw new Error('Production-health push escalation is still imported.');
for(const forbidden of ['AlertEscalation.decide','productionMonitor/notificationState','decision.notify','decision.audience'])if(maintenance.includes(forbidden))throw new Error(`Production-health push escalation is still active: ${forbidden}`);
if(!maintenance.includes('notification:"disabled"'))throw new Error('Production-health evaluation does not explicitly record that push notification is disabled.');
// Option A (2026-09-27): push escalation is retired, not paused. The unused decision module is
// deleted and Admin no longer reads or describes the frozen notification state.
if(fs.existsSync(new URL('../functions/lib/alert-escalation.js',import.meta.url)))throw new Error('Retired production-health escalation module is back in functions/lib.');
const operations=fs.readFileSync(new URL('../assets/js/admin/operations-dashboard.js',import.meta.url),'utf8');
for(const forbidden of ['productionMonitor/notificationState','Management alert:','reminders cool down'])if(operations.includes(forbidden))throw new Error(`Operations Center still presents retired push escalation: ${forbidden}`);
console.log('PASS: production-health evaluation remains available without sending staff push notifications.');
