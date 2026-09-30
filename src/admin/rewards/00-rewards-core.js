// ---------------------------------------------------------------------------
// Rewards program admin screen (Phase 2, 30 Sep 2026).
//
// One tab, four sections: reports, the reward catalog, earning rules, and
// member support. One discipline holds the whole screen together: every read
// goes through a callable that touches only small config or maintained
// aggregates. The screen never reads loyaltyMembers, loyaltyLedger,
// loyaltyBalances or loyaltyRewards directly - those grow with the business
// for as long as it runs, and the Sep 2026 download audit exists to keep
// requests like that off the client. Member lookup is a search (exact phone
// or member id) that resolves a single record server-side, never a browse.
//
// Server authority: getLoyaltyReports, manageLoyaltyRewardCatalog,
// manageLoyaltyEarningRule, searchLoyaltyMembers, manageLoyaltyMemberStatus,
// manageLoyaltyMemberAnonymize, manageLoyaltyCurrency (all loyaltyAdmin).
// Refusals are shown verbatim - the message names the reason.
// ---------------------------------------------------------------------------
var _rewardsState = {
  view: 'reports',
  currencies: {}, currenciesLoaded: false,
  busy: false, note: '', noteBad: false,
  catalog: {}, catalogLoaded: false, catalogEditing: null,
  rules: {}, rulesLoaded: false, rulesEditing: null,
  reports: null, reportsLoaded: false,
  member: null, memberQuery: null,
};

function A() { return window.__accaza; }

function rewardsApi() {
  var a = A();
  return (a && a.callables && a.callables.getLoyaltyReports) ? a.callables : null;
}

function rewardsEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
  });
}

function rewardsMessage(error, fallback) {
  var message = error && (error.message || (error.details && error.details.message));
  return String(message || fallback);
}

function rewardsPeso(amount) {
  var value = Number(amount) || 0;
  return '₱' + value.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function rewardsCurrencyLabel(code) {
  var row = _rewardsState.currencies[code] || {};
  return row.label || code;
}

function rewardsCurrencyCodes() {
  return Object.keys(_rewardsState.currencies).sort(function (a, b) {
    return (Number(_rewardsState.currencies[a].order) || 99) - (Number(_rewardsState.currencies[b].order) || 99) || a.localeCompare(b);
  });
}

function rewardsDate(ms) {
  var value = Number(ms);
  if (!value) return '';
  try { return new Date(value).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila'}); } catch (e) { return ''; }
}

function rewardsNoteHtml() {
  if (!_rewardsState.note) return '';
  return '<div style="margin-top:.7rem;padding:.5rem .6rem;border-radius:8px;font-size:.78rem;' +
    (_rewardsState.noteBad ? 'background:#fde8e8;color:#721c24;' : 'background:#e8f5e9;color:#1b5e20;') +
    '">' + rewardsEscape(_rewardsState.note) + '</div>';
}

function rewardsSubtabsHtml() {
  var tabs = [
    {id: 'reports', label: 'Reports'},
    {id: 'catalog', label: 'Reward catalog'},
    {id: 'rules', label: 'Earning rules'},
    {id: 'members', label: 'Members'}
  ];
  return tabs.map(function (tab) {
    var on = _rewardsState.view === tab.id;
    return '<button type="button" data-rewardstab="' + tab.id + '"' + (on ? ' style="background:#19241b;color:#fff;border-color:#19241b;"' : '') + '>' + tab.label + '</button>';
  }).join('');
}

function rewardsBodyHtml() {
  if (_rewardsState.view === 'catalog') return rewardsCatalogHtml();
  if (_rewardsState.view === 'rules') return rewardsRulesHtml();
  if (_rewardsState.view === 'members') return rewardsMembersHtml();
  return rewardsReportsHtml();
}

function rewardsMarkup() {
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;flex-wrap:wrap;">' +
    '<div><h3 style="margin:0;font-family:\'Playfair Display\',serif;color:var(--bd);">Rewards program</h3>' +
    '<p style="font-size:.78rem;color:#666;margin:.25rem 0 0;">The reward catalog, how stamps are earned, program totals and member support.</p></div>' +
    '<button type="button" id="rewardsRefresh" style="flex:0 0 auto;"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Working…' : 'Refresh') + '</button></div>' +
    '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.8rem;">' + rewardsSubtabsHtml() + '</div>' +
    rewardsNoteHtml() +
    '<div id="rewardsBody" style="margin-top:.8rem;">' + rewardsBodyHtml() + '</div>';
}

function renderRewards() {
  var root = document.getElementById('rewardsRoot'); if (!root) return;
  if (!rewardsApi()) {
    root.innerHTML = '<div style="padding:.8rem;border-radius:10px;background:#fde8e8;color:#721c24;font-size:.82rem;">Rewards administration is unavailable right now. Refresh the portal and try again.</div>';
    return;
  }
  root.innerHTML = rewardsMarkup();
  rewardsWire(root);
  if (!_rewardsState.currenciesLoaded && !_rewardsState.busy) rewardsLoadCurrencies();
}

function rewardsWire(root) {
  var refresh = root.querySelector('#rewardsRefresh');
  if (refresh) refresh.onclick = function () {
    _rewardsState.note = '';
    if (_rewardsState.view === 'catalog') { _rewardsState.catalogLoaded = false; rewardsCatalogLoad(); }
    else if (_rewardsState.view === 'rules') { _rewardsState.rulesLoaded = false; rewardsRulesLoad(); }
    else if (_rewardsState.view === 'members') { rewardsMembersRenderOnly(); }
    else { _rewardsState.reportsLoaded = false; rewardsReportsLoad(); }
  };
  root.querySelectorAll('[data-rewardstab]').forEach(function (button) {
    button.onclick = function () {
      _rewardsState.view = button.getAttribute('data-rewardstab');
      _rewardsState.note = '';
      renderRewards();
      if (_rewardsState.view === 'catalog' && !_rewardsState.catalogLoaded) rewardsCatalogLoad();
      else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
      else if (_rewardsState.view === 'reports' && !_rewardsState.reportsLoaded) rewardsReportsLoad();
    };
  });
  var body = root.querySelector('#rewardsBody');
  if (body && _rewardsState.view === 'catalog') rewardsCatalogWire(body);
  else if (body && _rewardsState.view === 'rules') rewardsRulesWire(body);
  else if (body && _rewardsState.view === 'members') rewardsMembersWire(body);
}

// The stamp list (labels, colours, order) comes from the same server config the
// stamps card manages - the screen offers only currencies the server accepts.
function rewardsLoadCurrencies() {
  var api = rewardsApi(); if (!api) return;
  _rewardsState.busy = true; renderRewards();
  api.manageLoyaltyCurrency({action: 'list'}).then(function (result) {
    _rewardsState.currencies = ((result && result.data) || {}).currencies || {};
    _rewardsState.currenciesLoaded = true;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not load the stamp list.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
    if (_rewardsState.view === 'reports' && !_rewardsState.reportsLoaded) rewardsReportsLoad();
    else if (_rewardsState.view === 'catalog' && !_rewardsState.catalogLoaded) rewardsCatalogLoad();
    else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
  });
}
