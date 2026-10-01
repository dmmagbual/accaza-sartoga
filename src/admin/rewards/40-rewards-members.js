// ---------------------------------------------------------------------------
// Rewards · Member support. Server authority: searchLoyaltyMembers,
// manageLoyaltyMemberStatus, manageLoyaltyMemberAnonymize (all loyaltyAdmin).
//
// Lookup is a SEARCH, never a browse: exact phone (resolved through the server's
// private hash index) or exact member id, returning ONE record. There is no
// member list here and there never will be — /loyaltyMembers grows with every
// signup for as long as the shop runs.
//
// Actions are deliberately narrow:
//   - block/unblock pauses a membership (the member keeps their stamps);
//   - anonymize is the PH Data Privacy Act path: personal data erased, the
//     stub blocked, one-way and permanent. Anonymization forfeits the stamps
//     the member was still holding, so it demands a typed confirmation.
// Server refusals are shown verbatim.
// ---------------------------------------------------------------------------
function rewardsMembersHtml() {
  var query = _rewardsState.memberQuery || {phone: '', memberId: ''};
  var html = '<div class="rw-search">' +
    '<div class="rw-field"><label>Mobile number</label><input id="memberSearchPhone" value="' + rewardsEscape(query.phone) + '" placeholder="09… or +63…"></div>' +
    '<div class="rw-field"><label>or Member ID</label><input id="memberSearchId" value="' + rewardsEscape(query.memberId) + '" placeholder="mem_…"></div>' +
    '<div class="rw-field rw-field-inline"><label>&nbsp;</label><button type="button" id="memberSearch" class="rw-btn ok"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Searching…' : 'Look up') + '</button></div>' +
    '</div>' +
    '<div class="rw-fineprint">Find one member by exact mobile number or member ID. Browsing the member list is intentionally not possible.</div>';
  if (_rewardsState.member) html += rewardsMemberCardHtml(_rewardsState.member);
  return html;
}

function rewardsStatusBadge(status) {
  var cls = {active: 'ok', blocked: 'bad', anonymized: 'off'}[status] || 'ok';
  var label = {active: 'Active', blocked: 'Blocked', anonymized: 'Anonymized'}[status] || 'Active';
  return '<span class="rw-badge ' + cls + '">' + label + '</span>';
}

function rewardsMemberCardHtml(member) {
  var stampsHtml = (member.stamps || []).map(function (currency) {
    return '<span class="rw-stamp">' +
      '<span class="rw-swatch" style="background:' + rewardsEscape(currency.color || '#ccc') + ';"></span>' +
      rewardsEscape(currency.label || currency.code) + ': <strong>&nbsp;' + (Number(currency.balance) || 0) + '</strong></span>';
  }).join('');
  var rows = [
    ['Member ID', rewardsEscape(member.memberId)],
    ['Mobile', rewardsEscape(member.maskedPhone || '—')],
    ['Member since', member.memberSince ? rewardsDate(member.memberSince) : '—'],
    ['Open reward claims', String(Number(member.openRewards) || 0)],
  ];
  var html = '<div class="rw-member">' +
    '<div class="rw-member-top">' +
    '<div class="rw-member-name">' + rewardsEscape(member.name || '(name removed)') + '</div>' +
    rewardsStatusBadge(member.status) + '</div>' +
    '<div class="rw-kv">' +
    rows.map(function (row) {
      return '<div class="rw-kv-row"><span class="rw-kv-key">' + row[0] + '</span><span class="rw-kv-val">' + row[1] + '</span></div>';
    }).join('') + '</div>' +
    '<div class="rw-stamplist-label">Stamps held</div>' +
    '<div class="rw-stamplist">' + (stampsHtml || '<span class="rw-cell-sub">None.</span>') + '</div>';

  if (member.status === 'anonymized') {
    html += '<div class="rw-mutedbox">' +
      'Personal data was removed' + (member.anonymizedAt ? (' on ' + rewardsDate(member.anonymizedAt)) : '') +
      '. The ledger, balances and reward claims are kept for accounting, and no further change is possible on this record.</div>';
  } else if (_rewardsState.anonymizeArmed === member.memberId) {
    html += '<div class="rw-dangerbox">' +
      '<div class="rw-dangerbox-title">Erase personal data — permanent</div>' +
      '<div class="rw-dangerbox-body">This deletes the member\'s name, mobile number and badge forever. Any stamps they still hold are forfeited. ' +
      'Ledger entries, balances and reward claims are kept for accounting, but the person behind the record can never be identified or restored.</div>' +
      '<div class="rw-field"><label>Type ANONYMIZE (all caps) to continue:</label>' +
      '<input id="memberAnonymizeWord" autocomplete="off"></div>' +
      '<div class="rw-form-actions">' +
      '<button type="button" id="memberAnonymizeConfirm" class="rw-btn danger"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Erasing…' : 'Erase forever') + '</button>' +
      '<button type="button" id="memberAnonymizeCancel" class="rw-btn sec"' + (_rewardsState.busy ? ' disabled' : '') + '>Cancel</button></div></div>';
  } else {
    html += '<div class="rw-actions-row">' +
      (member.status === 'blocked'
        ? '<button type="button" class="rw-btn sec" data-memberunblock="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + '>Unblock member</button>'
        : '<button type="button" class="rw-btn sec" data-memberblock="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + '>Block member</button>') +
      '<button type="button" class="rw-btn danger" data-memberanonymize="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + '>Erase personal data…</button>' +
      '</div>' +
      '<div class="rw-fineprint">Blocking keeps every stamp and only pauses earning and redemption. Erasing is permanent: the member\'s name, number and badge are deleted, and any stamps still held are forfeited.</div>';
  }
  return html + '</div>';
}

function rewardsMembersWire(body) {
  var search = body.querySelector('#memberSearch');
  if (search) search.onclick = function () { rewardsMemberSearch(body); };
  ['memberSearchPhone', 'memberSearchId'].forEach(function (id) {
    var input = body.querySelector('#' + id);
    if (input) input.onkeydown = function (event) {
      if (event.key === 'Enter') { event.preventDefault(); rewardsMemberSearch(body); }
    };
  });
  var block = body.querySelector('[data-memberblock]');
  if (block) block.onclick = function () {
    var memberId = block.getAttribute('data-memberblock');
    if (!confirm('Block this member? They stop earning and redeeming immediately, but keep every stamp they hold. Blocking can be reversed at any time.')) return;
    rewardsMemberSetStatus(memberId, 'blocked');
  };
  var unblock = body.querySelector('[data-memberunblock]');
  if (unblock) unblock.onclick = function () {
    rewardsMemberSetStatus(unblock.getAttribute('data-memberunblock'), 'active');
  };
  var anonymize = body.querySelector('[data-memberanonymize]');
  if (anonymize) anonymize.onclick = function () {
    // Arm the confirmation in the card itself: the consequence list is rendered
    // above the input, and only the typed word can fire the irreversible call.
    _rewardsState.anonymizeArmed = anonymize.getAttribute('data-memberanonymize');
    _rewardsState.note = '';
    renderRewards();
    var word = document.getElementById('memberAnonymizeWord');
    if (word) word.focus();
  };
  var anonymizeCancel = body.querySelector('#memberAnonymizeCancel');
  if (anonymizeCancel) anonymizeCancel.onclick = function () {
    _rewardsState.anonymizeArmed = null;
    _rewardsState.note = '';
    renderRewards();
  };
  var anonymizeConfirm = body.querySelector('#memberAnonymizeConfirm');
  if (anonymizeConfirm) anonymizeConfirm.onclick = function () {
    var word = body.querySelector('#memberAnonymizeWord');
    var typed = word ? String(word.value || '').trim() : '';
    if (typed !== 'ANONYMIZE') {
      _rewardsState.note = 'Nothing was erased - the confirmation word did not match.';
      _rewardsState.noteBad = true;
      renderRewards();
      return;
    }
    rewardsMemberAnonymize(_rewardsState.anonymizeArmed);
  };
  var anonymizeWord = body.querySelector('#memberAnonymizeWord');
  if (anonymizeWord) anonymizeWord.onkeydown = function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      var button = body.querySelector('#memberAnonymizeConfirm');
      if (button && !button.disabled) button.onclick();
    }
  };
}

function rewardsMemberSearch(body) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  var phone = body.querySelector('#memberSearchPhone'), memberId = body.querySelector('#memberSearchId');
  var phoneValue = phone ? String(phone.value || '').trim() : '';
  var idValue = memberId ? String(memberId.value || '').trim() : '';
  var payload = {};
  if (phoneValue) payload.phone = phoneValue;
  else if (idValue) payload.memberId = idValue;
  else {
    _rewardsState.note = 'Enter a mobile number or a member ID to search.';
    _rewardsState.noteBad = true;
    renderRewards();
    return;
  }
  _rewardsState.memberQuery = {phone: phoneValue, memberId: idValue};
  _rewardsState.anonymizeArmed = null;
  _rewardsState.busy = true; _rewardsState.note = ''; renderRewards();
  api.searchLoyaltyMembers(payload).then(function (result) {
    _rewardsState.member = ((result && result.data) || {}).member || null;
    if (!_rewardsState.member) throw new Error('No Rewards member was found.');
  }).catch(function (error) {
    _rewardsState.member = null;
    _rewardsState.note = rewardsMessage(error, 'Could not look up that member.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
  });
}

function rewardsMemberSetStatus(memberId, status) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  _rewardsState.busy = true; _rewardsState.note = ''; renderRewards();
  api.manageLoyaltyMemberStatus({memberId: memberId, status: status}).then(function () {
    _rewardsState.note = status === 'blocked' ? 'Member blocked. They keep their stamps and can be unblocked at any time.' : 'Member unblocked.';
    _rewardsState.noteBad = false;
    // The active-members total changed server-side; pick it up on the next Reports visit.
    _rewardsState.reportsLoaded = false;
  }).catch(function (error) {
    // The server refuses anonymized members - the wording names the reason.
    _rewardsState.note = rewardsMessage(error, 'Could not change that member.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false;
    rewardsMembersRenderOnly();
  });
}

function rewardsMemberAnonymize(memberId) {
  var api = rewardsApi(); if (!api || _rewardsState.busy || !memberId) return;
  // The typed word was already checked against the armed panel; the server
  // demands its own confirm:true before anything is destroyed.
  _rewardsState.busy = true; _rewardsState.note = ''; renderRewards();
  api.manageLoyaltyMemberAnonymize({memberId: memberId, confirm: true}).then(function (result) {
    var forfeited = ((result && result.data) || {}).forfeited || {};
    var summary = Object.keys(forfeited).map(function (code) {
      return (rewardsCurrencyLabel(code) + ' × ' + forfeited[code]);
    }).join(', ');
    _rewardsState.note = 'Personal data erased.' + (summary ? ' Forfeited stamps: ' + summary + '.' : ' No stamps were held.');
    _rewardsState.noteBad = false;
    _rewardsState.reportsLoaded = false;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not erase that member.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false;
    _rewardsState.anonymizeArmed = null;
    rewardsMembersRenderOnly();
  });
}

// Refresh path: re-run the last search so the card shows current balances, or
// fall back to the empty search form when nothing has been searched yet.
function rewardsMembersRenderOnly() {
  var query = _rewardsState.memberQuery;
  if (query && (query.phone || query.memberId) && _rewardsState.member) {
    var body = document.getElementById('rewardsBody');
    if (!body) { renderRewards(); return; }
    _rewardsState.busy = true; renderRewards();
    var api = rewardsApi(); if (!api) return;
    var payload = query.phone ? {phone: query.phone} : {memberId: query.memberId};
    api.searchLoyaltyMembers(payload).then(function (result) {
      _rewardsState.member = ((result && result.data) || {}).member || null;
    }).catch(function (error) {
      _rewardsState.note = rewardsMessage(error, 'Could not refresh that member.');
      _rewardsState.noteBad = true;
    }).then(function () {
      _rewardsState.busy = false; renderRewards();
    });
    return;
  }
  renderRewards();
}
