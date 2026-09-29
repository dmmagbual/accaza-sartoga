// Attaching a Rewards member to the sale in progress. This is the piece that makes the
// loyalty program actually do something: onOrderLoyaltyEarning only fires for an order
// that carries loyaltyMemberId, so until a member is attached here no stamp can be earned.
//
// Two ways in, both deliberate (spec 1 and 8):
//   * Badge payload - "ACZ1:<memberId>:<code>" from a barcode/QR scanner typing into the
//     focused field, or pasted. Verified server-side by scanLoyaltyBadge, which proves the
//     member's device was present. This is the path that may later also redeem.
//   * Phone lookup - EARN ONLY, never redemption. Looking someone up from memory gives
//     away nothing, so the worst case is a real sale credited to the right person. It must
//     never unlock a reward, because that hands over product with nobody verified present.
//
// Read cost: one callable per attach. No listeners, no member list is ever downloaded -
// the till must never hold anything that grows with the member base.
var posLoyaltyMember = null;

function posLoyaltyCallable(name) {
  var a = A();
  return (a && a.callables && a.callables[name]) || null;
}

// Clearing or finishing a sale drops the member AND gives back any reward that was
// claimed for it but never charged. Dropping the member while silently keeping the claim
// would spend the customer's stamps on a sale that never happened.
function posLoyaltyReset() {
  if (posLoyaltyClaim) posLoyaltyReleaseClaim('Sale cleared before payment');
  posLoyaltyMember = null;
}

// After the sale is safely stored: the claim becomes a real redemption, stamped with the
// order it paid for. Called instead of posLoyaltyReset on the completed path, because
// here the reward was actually given - releasing it would hand the stamps back for
// product the customer already walked away with.
function posLoyaltyFinalize(orderId) {
  var claim = posLoyaltyClaim;
  posLoyaltyClaim = null;
  posLoyaltyMember = null;
  if (!claim || !orderId) return;
  var finalize = posLoyaltyCallable('finalizeLoyaltyRedemption');
  if (!finalize) return;
  finalize({memberId: claim.memberId, rewardInstanceId: claim.rewardInstanceId, orderId: orderId})
    .then(function () { if (window.__posLog) window.__posLog('loyalty-finalize', claim.rewardInstanceId, orderId); })
    .catch(function (e) {
      // The sale and its 4920 posting are already durable; only the reward's own record
      // lags. Say so plainly rather than leaving the cashier to wonder.
      alert('The sale is saved, but marking the reward as redeemed failed: ' + ((e && e.message) || e) + '\n\nThe discount is recorded on the order. Tell a manager so the reward can be closed off.');
    });
}

// Accepts the scanner's full payload. Anything that is not an Accaza badge is rejected
// outright rather than guessed at, because a keyboard-wedge scanner will happily type any
// barcode that crosses it - a product code, a delivery label - into whatever has focus.
function posLoyaltyParseBadge(raw) {
  var parts = String(raw || '').trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'ACZ1') return null;
  if (!parts[1] || !/^[0-9a-f]{12}$/i.test(parts[2])) return null;
  return {memberId: parts[1], code: parts[2].toLowerCase()};
}

function posLoyaltySummary(m) {
  if (!m) return '';
  return esc(m.firstName || 'Member') + ' · ' + esc(m.maskedPhone || '') +
    ' · ' + (Number(m.redBalance) || 0) + ' red / ' + (Number(m.yellowBalance) || 0) + ' yellow';
}

// Rendered into the cart under the discount controls, so the cashier can see at a glance
// whether this sale will earn and for whom.
function posLoyaltyCartRow() {
  if (posLoyaltyMember) {
    var rewards = (posLoyaltyMember.availableRewards || []).length;
    return '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.76rem;color:#155724;background:#e8f5ec;border:1px solid #b8dfc4;border-radius:6px;padding:0.35rem 0.5rem;margin-bottom:0.4rem;">'
      + '<span>⭐ ' + posLoyaltySummary(posLoyaltyMember)
      + (rewards ? '<br><b>' + rewards + ' reward' + (rewards > 1 ? 's' : '') + ' available</b>' : '')
      + (posLoyaltyMember.verifiedBy === 'phone_lookup' ? '<br><span style="color:#8a6d00;">Phone lookup — earns stamps, cannot redeem</span>' : '')
      + '</span>'
      + '<button class="pz-btn warn" id="posLoyaltyClear" style="padding:0 0.35rem;">✕</button>'
      + '</div>';
  }
  return '<button class="pz-btn sec" id="posLoyaltyBtn" style="width:100%;margin-bottom:0.4rem;font-size:0.8rem;">⭐ Rewards member</button>';
}

function posLoyaltyWireCart(scope) {
  var open = (scope || document).querySelector('#posLoyaltyBtn');
  if (open) open.onclick = openLoyaltyMemberModal;
  var clear = (scope || document).querySelector('#posLoyaltyClear');
  if (clear) clear.onclick = function () { posLoyaltyReset(); renderPosCart(); };
}

function openLoyaltyMemberModal() {
  var mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  mask.innerHTML = '<div style="background:#fff;border-radius:10px;max-width:420px;width:100%;padding:1rem;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;"><b>Rewards member</b><button class="pz-btn warn" id="lmClose" style="padding:0 0.5rem;">✕</button></div>'
    + '<div style="font-size:0.78rem;color:var(--tl);margin-bottom:0.35rem;">Scan the member’s badge, or paste it here.</div>'
    + '<input class="pz-in" id="lmBadge" placeholder="Scan badge" style="width:100%;margin-bottom:0.6rem;" autocomplete="off"/>'
    + '<div style="border-top:1px solid var(--cd);padding-top:0.6rem;font-size:0.78rem;color:var(--tl);margin-bottom:0.35rem;">No badge? Look them up by mobile number. This earns stamps but <b>cannot redeem a reward</b>.</div>'
    + '<div style="display:flex;gap:0.4rem;"><input class="pz-in" id="lmPhone" placeholder="09XX XXX XXXX" inputmode="tel" style="flex:1;" autocomplete="off"/><button class="pz-btn ok" id="lmLookup">Find</button></div>'
    + '<div id="lmMsg" style="font-size:0.78rem;margin-top:0.6rem;min-height:1.1em;"></div>'
    + '</div>';
  document.body.appendChild(mask);

  var msg = mask.querySelector('#lmMsg');
  function say(text, bad) { msg.textContent = text; msg.style.color = bad ? '#a4302a' : '#155724'; }
  function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
  function attach(member, how) {
    posLoyaltyMember = Object.assign({verifiedBy: how}, member);
    close();
    renderPosCart();
    (window.accazaToast || function () {})('Rewards: ' + (member.firstName || 'member') + ' attached to this sale', 'ok');
    if (window.__posLog) window.__posLog('loyalty-attach', member.memberId, how);
  }

  mask.querySelector('#lmClose').onclick = close;
  mask.onclick = function (e) { if (e.target === mask) close(); };

  // A keyboard-wedge scanner types the whole payload and then presses Enter, so the badge
  // field reacts to Enter rather than to every keystroke. Pasting behaves identically.
  var badge = mask.querySelector('#lmBadge');
  badge.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var parsed = posLoyaltyParseBadge(badge.value);
    if (!parsed) { say('That is not an Accaza badge. Scan the QR on the member’s Rewards page.', true); badge.select(); return; }
    var scan = posLoyaltyCallable('scanLoyaltyBadge');
    if (!scan) { say('Refresh the POS to load the Rewards service.', true); return; }
    say('Checking badge…');
    scan(parsed).then(function (r) { attach(r.data || {}, 'badge_scan'); })
      .catch(function (err) { say((err && err.message) || 'Badge could not be verified.', true); badge.select(); });
  });
  setTimeout(function () { badge.focus(); }, 30);

  function lookup() {
    var phone = String(mask.querySelector('#lmPhone').value || '').trim();
    if (!phone) { say('Enter the member’s mobile number.', true); return; }
    var find = posLoyaltyCallable('lookupLoyaltyMemberByPhone');
    if (!find) { say('Refresh the POS to load the Rewards service.', true); return; }
    say('Looking up…');
    find({phone: phone}).then(function (r) { attach(r.data || {}, 'phone_lookup'); })
      .catch(function (err) { say((err && err.message) || 'No member found for that number.', true); });
  }
  mask.querySelector('#lmLookup').onclick = lookup;
  mask.querySelector('#lmPhone').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
}

// ---------------------------------------------------------------------------
// Redemption. The reward's peso value is computed SERVER-SIDE at claim time from
// what the order was worth then, so the claim is only valid for that basis. If the
// cart moves afterwards the attached discount is stale, and charging a stale
// discount is charging the customer the wrong amount.
//
// So the claim carries the basis it was priced on, every re-render checks it, and a
// change releases the claim and says so. Releasing is safe now that the stamps come
// back (releaseLoyaltyClaim) - before that this would have silently burned them.
// ---------------------------------------------------------------------------
var posLoyaltyClaim = null; // {rewardInstanceId, rewardId, name, discountAmount, memberId, basis, cartKey}

function posLoyaltyDiscount() {
  return posLoyaltyClaim ? (Number(posLoyaltyClaim.discountAmount) || 0) : 0;
}

// The order value a reward is priced against: the cart net of every OTHER discount,
// never of the loyalty one itself, which would be circular.
function posLoyaltyOrderNet() {
  var sub = Object.keys(posCart).reduce(function (s, k) { var c = posCart[k]; return s + (Number(c.unitTotal) || 0) * (Number(c.qty) || 0); }, 0);
  var manual = Number((document.getElementById('posDisc') || {}).value) || 0;
  return Math.max(0, sub - manual - scopedDiscTotal());
}

// What the live cart says this claim should have been priced on.
function posLoyaltyBasisNow(claim) {
  if (!claim) return null;
  if (claim.cartKey) { var line = posCart[claim.cartKey]; return line ? (Number(line.unitTotal) || 0) : null; }
  return posLoyaltyOrderNet();
}

// Gives the stamps back. Fire-and-report: the claim is dropped locally either way,
// because leaving a stale discount attached to a live sale is the worse failure. A
// release that did not reach the server leaves the reward "claimed", which expires on
// its own and is visible in the member's ledger.
function posLoyaltyReleaseClaim(reason, quiet) {
  var claim = posLoyaltyClaim;
  posLoyaltyClaim = null;
  if (!claim) return Promise.resolve();
  var release = posLoyaltyCallable('releaseLoyaltyClaim');
  if (!release) return Promise.resolve();
  return release({memberId: claim.memberId, rewardInstanceId: claim.rewardInstanceId, reason: reason || 'Sale not completed'})
    .then(function () {
      if (!quiet) (window.accazaToast || function () {})('Reward returned — stamps are back on the member’s account', 'ok');
      if (window.__posLog) window.__posLog('loyalty-release', claim.rewardInstanceId, reason || '');
    })
    .catch(function (e) {
      alert('The reward was removed from this sale, but returning the stamps failed: ' + ((e && e.message) || e) + '\n\nThe reward stays on the member’s account as an open claim and expires on its own. Tell a manager if the member asks.');
    });
}

// Called on every cart render. A claim priced on a different cart is not a discount we
// may charge, so it goes back rather than being quietly adjusted.
function posLoyaltyCheckStale() {
  if (!posLoyaltyClaim) return;
  var now = posLoyaltyBasisNow(posLoyaltyClaim);
  if (now !== null && Math.abs(now - posLoyaltyClaim.basis) < 0.005) return;
  var name = posLoyaltyClaim.name;
  posLoyaltyReleaseClaim('Sale changed after the reward was applied', true).then(function () {
    (window.accazaToast || function () {})('“' + name + '” was removed because the sale changed. Stamps are back — apply it again once the order is final.', 'warn');
    renderPosCart();
  });
}

function posLoyaltyClaimRow() {
  if (!posLoyaltyClaim) return '';
  return '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.76rem;color:#155724;margin-bottom:0.3rem;">'
    + '<span>⭐ ' + esc(posLoyaltyClaim.name) + '</span>'
    + '<span style="white-space:nowrap;">−' + peso(posLoyaltyDiscount())
    + ' <button class="pz-btn warn" id="posLoyaltyRewardRm" style="padding:0 0.35rem;">✕</button></span>'
    + '</div>';
}

// Offered only when a member is attached AND their presence was actually proved. A
// phone-lookup member earns but can never redeem (spec 1) - the server refuses it too,
// this just avoids offering something that will be refused.
function posLoyaltyRedeemButton() {
  if (!posLoyaltyMember || posLoyaltyClaim) return '';
  if (posLoyaltyMember.verifiedBy === 'phone_lookup') return '';
  var offers = posLoyaltyMember.redeemable || [];
  if (!offers.length) return '';
  return '<button class="pz-btn sec" id="posLoyaltyRedeemBtn" style="width:100%;margin-bottom:0.4rem;font-size:0.8rem;">🎁 Redeem reward (' + offers.length + ')</button>';
}

function posLoyaltyWireRedeem(scope) {
  var open = (scope || document).querySelector('#posLoyaltyRedeemBtn');
  if (open) open.onclick = openLoyaltyRedeemModal;
  var remove = (scope || document).querySelector('#posLoyaltyRewardRm');
  if (remove) remove.onclick = function () {
    posLoyaltyReleaseClaim('Cashier removed the reward from this sale').then(function () { renderPosCart(); });
  };
}

function posLoyaltyIsFreeItem(reward) {
  return reward && (reward.grantType === 'free_item_capped' || reward.grantType === 'free_item_no_sub');
}

function openLoyaltyRedeemModal() {
  if (!posLoyaltyMember) return alert('Attach a Rewards member first.');
  if (!Object.keys(posCart).length) return alert('Ring the whole order first, then apply the reward. The discount is worked out from the finished order.');
  var offers = (posLoyaltyMember.redeemable || []);
  if (!offers.length) return alert('This member has no reward they can claim yet.');

  var mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  var chosen = null, otpToken = null;

  function drinkLines() {
    return Object.keys(posCart).filter(function (k) { return lineCat(k) === 'drink'; });
  }

  function draw() {
    var stacked = posScopedDisc.length > 0 || (Number((document.getElementById('posDisc') || {}).value) || 0) > 0;
    var blocked = stacked && !(chosen && chosen.stackingAllowed);
    mask.innerHTML = '<div style="background:#fff;border-radius:10px;max-width:440px;width:100%;padding:1rem;max-height:86vh;overflow:auto;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><b>Redeem a reward</b><button class="pz-btn warn" id="rdClose" style="padding:0 0.5rem;">✕</button></div>'
      + '<div style="font-size:0.78rem;color:var(--tl);margin-bottom:0.5rem;">' + esc(posLoyaltyMember.firstName || 'Member') + ' · '
      + (Number(posLoyaltyMember.redBalance) || 0) + ' red / ' + (Number(posLoyaltyMember.yellowBalance) || 0) + ' yellow</div>'
      + (blocked ? '<div style="font-size:0.78rem;color:#8a6d00;background:#fff6e5;border:1px solid #f0dcae;border-radius:6px;padding:0.5rem;margin-bottom:0.5rem;">This sale already has a Senior / PWD or manual discount. A loyalty reward cannot be combined with it — remove the other discount first.</div>' : '')
      + offers.map(function (r, ix) {
        var on = chosen && chosen.rewardId === r.rewardId;
        return '<button class="pz-btn ' + (on ? 'ok' : 'sec') + '" data-rd="' + ix + '" style="width:100%;text-align:left;margin-bottom:0.3rem;font-size:0.82rem;">'
          + esc(r.name) + '<div style="font-size:0.72rem;opacity:.8;">costs ' + r.costQty + ' ' + esc(r.costCurrency) + ' stamps</div></button>';
      }).join('');

    // A free-item reward is worth whatever drink it is put against, so the cashier picks
    // the line. Without that there is no price to compute the discount from.
    if (posLoyaltyIsFreeItem(chosen)) {
      var lines = drinkLines();
      mask.querySelector('div').insertAdjacentHTML('beforeend',
        '<div style="border-top:1px solid var(--cd);margin-top:0.5rem;padding-top:0.5rem;font-size:0.78rem;color:var(--tl);">Which drink is free?</div>'
        + (lines.length ? lines.map(function (k) {
          var c = posCart[k], on = chosen.cartKey === k;
          return '<button class="pz-btn ' + (on ? 'ok' : 'sec') + '" data-rdline="' + esc(k) + '" style="width:100%;text-align:left;margin-top:0.25rem;font-size:0.8rem;">'
            + esc(c.name) + (c.size ? ' (' + esc(c.size) + ')' : '') + ' · ' + peso(c.unitTotal) + '</button>';
        }).join('') : '<div style="font-size:0.78rem;color:#a4302a;margin-top:0.3rem;">There is no drink on this order to make free.</div>'));
    }

    var ready = chosen && !blocked && (!posLoyaltyIsFreeItem(chosen) || chosen.cartKey);
    mask.querySelector('div').insertAdjacentHTML('beforeend',
      '<div style="border-top:1px solid var(--cd);margin-top:0.6rem;padding-top:0.6rem;">'
      + '<div style="font-size:0.78rem;color:var(--tl);margin-bottom:0.35rem;">The member must be here. Scan their badge, or text them a code.</div>'
      + '<input class="pz-in" id="rdBadge" placeholder="Scan badge" style="width:100%;margin-bottom:0.4rem;" autocomplete="off"' + (ready ? '' : ' disabled') + '/>'
      + '<div style="display:flex;gap:0.4rem;"><button class="pz-btn sec" id="rdSendOtp" style="flex:1;"' + (ready ? '' : ' disabled') + '>Text a code</button></div>'
      + '<div id="rdOtpWrap" style="display:none;margin-top:0.4rem;"><div style="display:flex;gap:0.4rem;"><input class="pz-in" id="rdOtp" placeholder="6-digit code" inputmode="numeric" maxlength="6" style="flex:1;"/><button class="pz-btn ok" id="rdOtpGo">Redeem</button></div></div>'
      + '<div id="rdMsg" style="font-size:0.78rem;margin-top:0.5rem;min-height:1.1em;"></div></div>');
    wire();
  }

  function say(text, bad) {
    var m = mask.querySelector('#rdMsg');
    if (m) { m.textContent = text; m.style.color = bad ? '#a4302a' : '#155724'; }
  }
  function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }

  // The basis is captured here and sent with the claim, so the discount the server prices
  // and the cart it was priced against are the same thing. posLoyaltyCheckStale compares
  // the live cart back to it on every render.
  function claim(proof) {
    var free = posLoyaltyIsFreeItem(chosen);
    var basis = free ? (Number(posCart[chosen.cartKey].unitTotal) || 0) : posLoyaltyOrderNet();
    var call = posLoyaltyCallable('claimLoyaltyReward');
    if (!call) { say('Refresh the POS to load the Rewards service.', true); return; }
    say('Claiming…');
    call(Object.assign({memberId: posLoyaltyMember.memberId, rewardId: chosen.rewardId, itemPrice: free ? basis : null, orderNet: free ? null : basis}, proof))
      .then(function (r) {
        var d = r.data || {};
        posLoyaltyClaim = {rewardInstanceId: d.rewardInstanceId, rewardId: chosen.rewardId, name: d.name || chosen.name, discountAmount: Number(d.discountAmount) || 0, memberId: posLoyaltyMember.memberId, basis: basis, cartKey: free ? chosen.cartKey : null};
        close();
        renderPosCart();
        (window.accazaToast || function () {})('Reward applied — −' + peso(posLoyaltyClaim.discountAmount), 'ok');
        if (window.__posLog) window.__posLog('loyalty-claim', d.rewardInstanceId, posLoyaltyClaim.name + ' −' + peso(posLoyaltyClaim.discountAmount));
      })
      .catch(function (e) { say((e && e.message) || 'The reward could not be claimed.', true); });
  }

  function wire() {
    mask.querySelector('#rdClose').onclick = close;
    mask.querySelectorAll('[data-rd]').forEach(function (b) {
      b.onclick = function () {
        var picked = offers[+b.getAttribute('data-rd')];
        chosen = (chosen && chosen.rewardId === picked.rewardId) ? null : Object.assign({}, picked);
        draw();
      };
    });
    mask.querySelectorAll('[data-rdline]').forEach(function (b) {
      b.onclick = function () { chosen.cartKey = b.getAttribute('data-rdline'); draw(); };
    });

    var badge = mask.querySelector('#rdBadge');
    if (badge && !badge.disabled) badge.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var parsed = posLoyaltyParseBadge(badge.value);
      if (!parsed) { say('That is not an Accaza badge.', true); badge.select(); return; }
      if (parsed.memberId !== posLoyaltyMember.memberId) { say('That badge belongs to a different member than the one on this sale.', true); badge.select(); return; }
      claim({verifiedBy: 'badge_scan', code: parsed.code});
    });

    var send = mask.querySelector('#rdSendOtp');
    if (send && !send.disabled) send.onclick = function () {
      var start = posLoyaltyCallable('startLoyaltyRedeemOtp');
      if (!start) { say('Refresh the POS to load the Rewards service.', true); return; }
      send.disabled = true; say('Sending a code…');
      start({memberId: posLoyaltyMember.memberId})
        .then(function (r) { otpToken = (r.data || {}).otpToken; mask.querySelector('#rdOtpWrap').style.display = 'block'; mask.querySelector('#rdOtp').focus(); say('Code sent. Ask the member to read it out.'); })
        .catch(function (e) { say((e && e.message) || 'The code could not be sent.', true); })
        .finally(function () { send.disabled = false; });
    };

    var go = mask.querySelector('#rdOtpGo');
    if (go) go.onclick = function () {
      var otp = String(mask.querySelector('#rdOtp').value || '').trim();
      if (!/^\d{6}$/.test(otp)) { say('Enter the 6-digit code.', true); return; }
      claim({verifiedBy: 'otp', otpToken: otpToken, otp: otp});
    };
  }

  document.body.appendChild(mask);
  mask.onclick = function (e) { if (e.target === mask) close(); };
  draw();
}
