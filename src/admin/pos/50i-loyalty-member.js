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

function posLoyaltyReset() { posLoyaltyMember = null; }

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
