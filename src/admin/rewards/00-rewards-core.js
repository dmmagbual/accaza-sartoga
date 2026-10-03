// ---------------------------------------------------------------------------
// Rewards program admin screen (Phase 2, 30 Sep 2026).
//
// One tab, five sections: reports, stamps, the reward catalog, earning rules,
// and member support. One discipline holds the whole screen together: every read
// goes through a callable that touches only small config or maintained
// aggregates. The screen never reads loyaltyMembers, loyaltyLedger,
// loyaltyBalances or loyaltyRewards directly - those grow with the business
// for as long as it runs, and the Sep 2026 download audit exists to keep
// requests like that off the client. Member lookup is a search (exact phone
// or member id) that resolves a single record server-side, never a browse.
//
// Server authority: getLoyaltyReports, manageLoyaltyCurrency,
// manageLoyaltyRewardCatalog, manageLoyaltyEarningRule, searchLoyaltyMembers,
// manageLoyaltyMemberStatus, manageLoyaltyMemberAnonymize (all loyaltyAdmin).
// Refusals are shown verbatim - the message names the reason.
//
// Presentation: every section renders with the shared classes in
// assets/css/admin/rewards.css (rw-*) so the screen keeps one visual language.
// ---------------------------------------------------------------------------
var _rewardsState = {
  view: 'reports',
  currencies: {}, currenciesLoaded: false, currenciesAttempted: false,
  busy: false, note: '', noteBad: false,
  catalog: {}, catalogLoaded: false, catalogEditing: null,
  rules: {}, rulesLoaded: false, rulesEditing: null,
  reports: null, reportsLoaded: false,
  member: null, memberQuery: null,
  dragon: {loaded: false, seasons: {}, missions: {}, activeSeasonId: null, selectedSeasonId: null, editingSeason: null, editingMission: null},
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
  return '<div class="rw-note ' + (_rewardsState.noteBad ? 'bad' : 'ok') + '">' + rewardsEscape(_rewardsState.note) + '</div>';
}

function rewardsSubtabsHtml() {
  var tabs = [
    {id: 'reports', label: 'Reports'},
    {id: 'stamps', label: 'Stamps'},
    {id: 'catalog', label: 'Reward catalog'},
    {id: 'dragon', label: 'Dragon Quest'},
    {id: 'rules', label: 'Earning rules'},
    {id: 'members', label: 'Members'}
  ];
  return tabs.map(function (tab) {
    var on = _rewardsState.view === tab.id;
    return '<button type="button" class="rw-tab' + (on ? ' on' : '') + '" data-rewardstab="' + tab.id + '">' + tab.label + '</button>';
  }).join('');
}

function rewardsBodyHtml() {
  if (_rewardsState.view === 'stamps') return rewardsStampsHtml();
  if (_rewardsState.view === 'catalog') return rewardsCatalogHtml();
  if (_rewardsState.view === 'dragon') return rewardsDragonHtml();
  if (_rewardsState.view === 'rules') return rewardsRulesHtml();
  if (_rewardsState.view === 'members') return rewardsMembersHtml();
  return rewardsReportsHtml();
}

function rewardsMarkup() {
  return '<div class="rw-head">' +
    '<div><h3 class="rw-title">Rewards program</h3>' +
    '<p class="rw-sub">The stamp types, the reward catalog, how stamps are earned, program totals and member support.</p></div>' +
    '<button type="button" id="rewardsRefresh" class="rw-btn sec"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Working…' : 'Refresh') + '</button></div>' +
    '<div class="rw-tabs">' + rewardsSubtabsHtml() + '</div>' +
    rewardsNoteHtml() +
    '<div id="rewardsBody">' + rewardsBodyHtml() + '</div>';
}

function renderRewards() {
  var root = document.getElementById('rewardsRoot'); if (!root) return;
  if (!rewardsApi()) {
    root.innerHTML = '<div class="rw-fatal">Rewards administration is unavailable right now. Refresh the portal and try again.</div>';
    return;
  }
  root.innerHTML = rewardsMarkup();
  rewardsWire(root);
  if (!_rewardsState.currenciesLoaded && !_rewardsState.currenciesAttempted && !_rewardsState.busy) rewardsLoadCurrencies();
}

function rewardsWire(root) {
  var refresh = root.querySelector('#rewardsRefresh');
  if (refresh) refresh.onclick = function () {
    _rewardsState.note = '';
    if (!_rewardsState.currenciesLoaded) {
      _rewardsState.currenciesAttempted = false;
      rewardsLoadCurrencies();
      return;
    }
    if (_rewardsState.view === 'stamps') { _rewardsStampsState.loaded = false; rewardsStampsLoad(); }
    else if (_rewardsState.view === 'catalog') { _rewardsState.catalogLoaded = false; rewardsCatalogLoad(); }
    else if (_rewardsState.view === 'dragon') { _rewardsState.dragon.loaded = false; rewardsDragonLoad(); }
    else if (_rewardsState.view === 'rules') { _rewardsState.rulesLoaded = false; rewardsRulesLoad(); }
    else if (_rewardsState.view === 'members') { rewardsMembersRenderOnly(); }
    else { _rewardsState.reportsLoaded = false; rewardsReportsLoad(); }
  };
  root.querySelectorAll('[data-rewardstab]').forEach(function (button) {
    button.onclick = function () {
      _rewardsState.view = button.getAttribute('data-rewardstab');
      _rewardsState.note = '';
      renderRewards();
      if (_rewardsState.view === 'stamps' && !_rewardsStampsState.loaded) rewardsStampsLoad();
      else if (_rewardsState.view === 'catalog' && !_rewardsState.catalogLoaded) rewardsCatalogLoad();
      else if (_rewardsState.view === 'dragon' && !_rewardsState.dragon.loaded) rewardsDragonLoad();
      else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
      else if (_rewardsState.view === 'reports' && !_rewardsState.reportsLoaded) rewardsReportsLoad();
    };
  });
  var body = root.querySelector('#rewardsBody');
  if (body && _rewardsState.view === 'stamps') rewardsStampsWire(body);
  else if (body && _rewardsState.view === 'catalog') rewardsCatalogWire(body);
  else if (body && _rewardsState.view === 'dragon') rewardsDragonWire(body);
  else if (body && _rewardsState.view === 'rules') rewardsRulesWire(body);
  else if (body && _rewardsState.view === 'members') rewardsMembersWire(body);
}

// The stamp list (labels, colours, order) comes from the same server config the
// stamps screen manages - the tab offers only currencies the server accepts.
function rewardsLoadCurrencies() {
  var api = rewardsApi(); if (!api) return;
  if (_rewardsState.busy || _rewardsState.currenciesAttempted) return;
  _rewardsState.currenciesAttempted = true;
  _rewardsState.busy = true; renderRewards();
  var loaded = false;
  api.manageLoyaltyCurrency({action: 'list'}).then(function (result) {
    _rewardsState.currencies = ((result && result.data) || {}).currencies || {};
    _rewardsState.currenciesLoaded = true;
    loaded = true;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not load the stamp list.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
    if (!loaded) return;
    if (_rewardsState.view === 'reports' && !_rewardsState.reportsLoaded) rewardsReportsLoad();
    else if (_rewardsState.view === 'stamps' && !_rewardsStampsState.loaded) rewardsStampsLoad();
    else if (_rewardsState.view === 'catalog' && !_rewardsState.catalogLoaded) rewardsCatalogLoad();
    else if (_rewardsState.view === 'dragon' && !_rewardsState.dragon.loaded) rewardsDragonLoad();
    else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
  });
}
