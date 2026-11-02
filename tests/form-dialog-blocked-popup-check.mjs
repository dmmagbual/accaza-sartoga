// Blocked browser popups must never make an admin action silently do nothing (1 Nov 2026):
// "Move current reviews to 1060" was clicked in a browser that suppressed confirm(), so nothing
// posted and nothing was shown. Two guards: money actions use the in-page dialog, and the shared
// form-dialog safety net shows an in-page notice whenever alert/confirm return instantly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/admin/form-dialog.js', import.meta.url), 'utf8');
let clock = 0, confirmAnswer = false, confirmDelay = 0, alertDelay = 0;
const notices = [];
const context = {
  Date: {now: () => clock},
  confirm: () => { clock += confirmDelay; return confirmAnswer; },
  alert: () => { clock += alertDelay; },
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context);
const dialog = context.AccazaFormDialog;
assert.equal(typeof dialog.run, 'function', 'form dialog keeps run');
assert.equal(typeof dialog.notice, 'function', 'form dialog exposes an in-page notice');
dialog.notice = (message, title) => { notices.push({message: String(message), title}); return Promise.resolve(null); };

// Blocked confirm: instant "No" -> unchanged return value plus an in-page explanation.
confirmAnswer = false; confirmDelay = 0;
assert.equal(context.confirm('Move 38 payments into 1060?'), false, 'a blocked confirm still answers No');
assert.equal(notices.length, 1, 'a blocked confirm is reported on the page');
assert.equal(notices[0].title, 'Confirmation blocked');
assert.match(notices[0].message, /nothing was done/);
assert.match(notices[0].message, /Move 38 payments into 1060\?/);
// A person who takes time to press Cancel or OK sees no extra notice.
confirmAnswer = false; confirmDelay = 1500;
assert.equal(context.confirm('Delete?'), false);
confirmAnswer = true; confirmDelay = 0;
assert.equal(context.confirm('Post?'), true, 'an accepted confirm is never second-guessed');
confirmAnswer = true; confirmDelay = 900;
assert.equal(context.confirm('Post?'), true);
assert.equal(notices.length, 1, 'real answers never raise a notice');
// Blocked alert: the message is still shown in the page.
alertDelay = 0; context.alert('Verification finished: the payment moved to the bank.');
assert.equal(notices.length, 2);
assert.match(notices[1].message, /Verification finished/);
alertDelay = 700; context.alert('Read and dismissed');
assert.equal(notices.length, 2, 'a dismissed alert raises no notice');

// The "Move current reviews to 1060" batch is retired (3 Nov 2026): validating or recording a
// payment as not received moves its receipt into 1060 on the server, one sale at a time.
for (const file of ['src/admin/register/00-bootstrap-payment-controls.js', 'src/admin/register/50-cash-movements.js', 'src/admin/register/60-operations-shift-review.js', 'assets/js/admin/register.js']) {
  const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.ok(!text.includes('prepareCurrentPaymentReviews') && !text.includes('data-prepare-current-reviews') && !text.includes('Move current reviews to 1060'), `${file} no longer offers the retired batch button`);
}
console.log('PASS: blocked alert/confirm popups are reported in the page with unchanged answers, and the retired move-to-1060 batch button is gone.');
