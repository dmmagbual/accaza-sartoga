import assert from 'node:assert/strict';
import {archiveOrderStamp,sortArchivedOrders} from '../assets/js/admin/archive-order-sort.mjs';

const orders=[
  {id:'OLD-ARCHIVED-LATE',timestamp:1000,archivedAt:9000},
  {id:'NEW-ARCHIVED-EARLY',timestamp:3000,archivedAt:4000},
  {id:'MIDDLE',timestamp:2000,archivedAt:5000}
];
assert.deepEqual(sortArchivedOrders(orders).map(function(o){return o.id;}),[
  'NEW-ARCHIVED-EARLY','MIDDLE','OLD-ARCHIVED-LATE'
]);
assert.deepEqual(orders.map(function(o){return o.id;}),[
  'OLD-ARCHIVED-LATE','NEW-ARCHIVED-EARLY','MIDDLE'
]);

const legacy={date:'August 24, 2026',time:'02:30 PM',archivedAt:1};
assert.ok(archiveOrderStamp(legacy)>1,'legacy displayed date and time should precede archive timestamp fallback');
assert.equal(archiveOrderStamp({archivedAt:1234}),1234);

console.log('PASS: archived orders sort by original order date and time, newest first.');
