import assert from 'node:assert/strict';
import {archiveOrderStamp,sortArchivedOrders,summarizeArchivedOrders} from '../assets/js/admin/archive-order-sort.mjs';

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

assert.deepEqual(summarizeArchivedOrders([
  {prevStatus:'Completed',total:500},
  {prevStatus:'Received',total:300},
  {prevStatus:'Completed',total:250,refundAmount:100},
  {prevStatus:'Completed',total:200,refundAmount:200},
  {prevStatus:'Completed',total:400,voided:true},
  {prevStatus:'Rejected',total:150}
]),{
  totalCount:6,
  completedCount:2,completedRevenue:800,
  refundedCount:2,refundedAmount:300,
  voidedCount:1,voidedAmount:400,
  excludedCount:1,excludedAmount:150
});

console.log('PASS: archived orders sort by original order time and reconcile completed, refunded, voided, and excluded totals.');
