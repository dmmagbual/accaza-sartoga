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
  var html = '<div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;">' +
    '<label style="font-size:.76rem;">Mobile number<input id="memberSearchPhone" value="' + rewardsEscape(query.phone) + '" placeholder="09… or +63…" style="display:block;width:160px;"></label>' +
    '<label style="font-size:.76rem;">or Member ID<input id="memberSearchId" value="' + rewardsEscape(query.memberId) + '" placeholder="mem_…" style="display:block;width:180px;"></label>' +
    '<button type="button" id="memberSearch"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Searching…' : 'Look up') + '</button>' +
    '</div>' +
    '<div style="font-size:.72rem;color:#666;margin-top:.35rem;">Find one member by exact mobile number or member ID. Browsing the member list is intentionally not possible.</div>';
  if (_rewardsState.member) html += '<div style="margin-top:.9rem;">' + rewardsMemberCardHtml(_rewardsState.member) + '</div>';
  return html;
}

function rewardsStatusBadge(status) {
  var palette = {active: ['#e8f5e9', '#1b5e20', 'Active'], blocked: ['#fde8e8', '#721c24', 'Blocked'], anonymized: ['#eee', '#444', 'Anonymized']};
  var row = palette[status] || palette.active;
  return '<span style="display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.72rem;background:' + row[0] + ';color:' + row[1] + ';">' + row[2] + '</span>';
}

function rewardsMemberCardHtml(member) {
  var stampsHtml = (member.stamps || []).map(function (currency) {
    return '<span style="display:inline-flex;align-items:center;margin:0 .8rem .4rem 0;font-size:.82rem;">' +
      '<span style="display:inline-block;width:13px;height:13px;border-radius:50%;margin-right:.35rem;border:1px solid rgba(0,0,0,.2);background:' + rewardsEscape(currency.color || '#ccc') + ';"></span>' +
      rewardsEscape(currency.label || currency.code) + ': <strong>&nbsp;' + (Number(currency.balance) || 0) + '</strong></span>';
  }).join('');
  var rows = [
    ['Member ID', rewardsEscape(member.memberId)],
    ['Mobile', rewardsEscape(member.maskedPhone || '—')],
    ['Member since', member.memberSince ? rewardsDate(member.memberSince) : '—'],
    ['Open reward claims', String(Number(member.openRewards) || 0)],
  ];
  var html = '<div style="border:1px solid #e3e3e3;border-radius:12px;padding:.9rem;background:#fff;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;">' +
    '<div style="font-size:.95rem;font-weight:600;color:var(--bd);">' + rewardsEscape(member.name || '(name removed)') + '</div>' +
    rewardsStatusBadge(member.status) + '</div>' +
    '<table style="margin-top:.5rem;border-collapse:collapse;font-size:.8rem;">' +
    rows.map(function (row) {
      return '<tr><td style="padding:.15rem .6rem .15rem 0;color:#666;white-space:nowrap;">' + row[0] + '</td><td style="padding:.15rem 0;">' + row[1] + '</td></tr>';
    }).join('') + '</table>' +
    '<div style="margin-top:.6rem;font-size:.76rem;color:#666;">Stamps held</div>' +
    '<div style="margin-top:.25rem;">' + (stampsHtml || '<span style="font-size:.8rem;color:#666;">None.</span>') + '</div>';

  if (member.status === 'anonymized') {
    html += '<div style="margin-top:.8rem;padding:.6rem;border-radius:8px;background:#eee;color:#444;font-size:.78rem;">' +
      'Personal data was removed' + (member.anonymizedAt ? (' on ' + rewardsDate(member.anonymizedAt)) : '') +
      '. The ledger, balances and reward claims are kept for accounting, and no further change is possible on this record.</div>';
  } else if (_rewardsState.anonymizeArmed === member.memberId) {
    html += '<div style="margin-top:.8rem;border:1px solid #b35b5b;border-radius:10px;padding:.7rem;background:#fdf3f3;">' +
      '<div style="font-size:.8rem;font-weight:600;color:#721c24;">Erase personal data — permanent</div>' +
      '<div style="font-size:.74rem;color:#555;margin-top:.3rem;">This deletes the member\'s name, mobile number and badge forever. Any stamps they still hold are forfeited. ' +
      'Ledger entries, balances and reward claims are kept for accounting, but the person behind the record can never be identified or restored.</div>' +
      '<label style="font-size:.76rem;margin-top:.5rem;display:block;">Type ANONYMIZE (all caps) to continue:' +
      '<input id="memberAnonymizeWord" autocomplete="off" style="display:block;width:170px;margin-top:.25rem;"></label>' +
      '<div style="display:flex;gap:.4rem;margin-top:.5rem;">' +
      '<button type="button" id="memberAnonymizeConfirm"' + (_rewardsState.busy ? ' disabled' : '') + ' style="border-color:#b35b5b;color:#721c24;background:#fff;">' + (_rewardsState.busy ? 'Erasing…' : 'Erase forever') + '</button>' +
      '<button type="button" id="memberAnonymizeCancel"' + (_rewardsState.busy ? ' disabled' : '') + '>Cancel</button></div></div>';
  } else {
    html += '<div style="margin-top:.8rem;display:flex;gap:.4rem;flex-wrap:wrap;">' +
      (member.status === 'blocked'
        ? '<button type="button" data-memberunblock="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + '>Unblock member</button>'
        : '<button type="button" data-memberblock="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + '>Block member</button>') +
      '<button type="button" data-memberanonymize="' + rewardsEscape(member.memberId) + '"' + (_rewardsState.busy ? ' disabled' : '') + ' style="border-color:#b35b5b;color:#721c24;background:#fff;">Erase personal data…</button>' +
      '</div>' +
      '<div style="font-size:.72rem;color:#666;margin-top:.4rem;">Blocking keeps every stamp and only pauses earning and redemption. Erasing is permanent: the member\'s name, number and badge are deleted, and any stamps still held are forfeited.</div>';
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
