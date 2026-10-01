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
  return '<div class="rw-note ' + (_rewardsState.noteBad ? 'bad' : 'ok') + '">' + rewardsEscape(_rewardsState.note) + '</div>';
}

function rewardsSubtabsHtml() {
  var tabs = [
    {id: 'reports', label: 'Reports'},
    {id: 'stamps', label: 'Stamps'},
    {id: 'catalog', label: 'Reward catalog'},
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
  if (!_rewardsState.currenciesLoaded && !_rewardsState.busy) rewardsLoadCurrencies();
}

function rewardsWire(root) {
  var refresh = root.querySelector('#rewardsRefresh');
  if (refresh) refresh.onclick = function () {
    _rewardsState.note = '';
    if (_rewardsState.view === 'stamps') { _rewardsStampsState.loaded = false; rewardsStampsLoad(); }
    else if (_rewardsState.view === 'catalog') { _rewardsState.catalogLoaded = false; rewardsCatalogLoad(); }
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
      else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
      else if (_rewardsState.view === 'reports' && !_rewardsState.reportsLoaded) rewardsReportsLoad();
    };
  });
  var body = root.querySelector('#rewardsBody');
  if (body && _rewardsState.view === 'stamps') rewardsStampsWire(body);
  else if (body && _rewardsState.view === 'catalog') rewardsCatalogWire(body);
  else if (body && _rewardsState.view === 'rules') rewardsRulesWire(body);
  else if (body && _rewardsState.view === 'members') rewardsMembersWire(body);
}

// The stamp list (labels, colours, order) comes from the same server config the
// stamps screen manages - the tab offers only currencies the server accepts.
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
    else if (_rewardsState.view === 'stamps' && !_rewardsStampsState.loaded) rewardsStampsLoad();
    else if (_rewardsState.view === 'catalog' && !_rewardsState.catalogLoaded) rewardsCatalogLoad();
    else if (_rewardsState.view === 'rules' && !_rewardsState.rulesLoaded) rewardsRulesLoad();
  });
}
// ---------------------------------------------------------------------------
// Rewards · Reports (spec §13). Everything on this screen comes from
// getLoyaltyReports: maintained /loyaltyStats aggregates plus the small staff
// roster joined in server-side. Nothing here ever asks for member or ledger
// history — the numbers arrive already counted.
// ---------------------------------------------------------------------------
function rewardsMilestoneLabel(key) {
  if (key === '6_months') return '6-month';
  if (key === '1_year') return '1-year';
  return String(key || '').replace(/_/g, ' ');
}

function rewardsReportsHtml() {
  if (!_rewardsState.reports) {
    return '<div class="rw-loading">' +
      (_rewardsState.busy ? 'Loading reports…' : 'Press Refresh to load the program totals.') + '</div>';
  }
  var r = _rewardsState.reports;

  // --- headline numbers -----------------------------------------------------
  var costRows = Object.keys(r.redemptionCostByReward || {}).map(function (key) {
    var row = r.redemptionCostByReward[key] || {};
    return {name: String(row.name || key), totalCost: Number(row.totalCost) || 0};
  }).sort(function (a, b) { return b.totalCost - a.totalCost; });
  var totalRedemptionCost = costRows.reduce(function (sum, row) { return sum + row.totalCost; }, 0);
  var totalRedemptions = Object.keys(r.redemptionsByCashier || {}).reduce(function (sum, key) {
    return sum + (Number(r.redemptionsByCashier[key]) || 0);
  }, 0);

  var html = '<div class="rw-stats">' +
    rewardsStatCard('Active members', String(r.activeMembers || 0), 'members not blocked or anonymized') +
    rewardsStatCard('Rewards redeemed', String(totalRedemptions), 'all cashiers, all time') +
    rewardsStatCard('Redemption cost', rewardsPeso(totalRedemptionCost), 'list price of free items and discounts given') +
    '</div>';

  // --- redemption cost by reward ---------------------------------------------
  html += '<div class="rw-card"><div class="rw-card-head"><h4 class="rw-card-title">Redemption cost by reward</h4></div>';
  if (!costRows.length) {
    html += '<div class="rw-empty"><div class="rw-empty-ic">🎁</div>' +
      '<div class="rw-empty-t">No reward has been redeemed yet</div>' +
      '<div class="rw-empty-s">Costs appear here the first time a member claims a reward.</div></div>';
  } else {
    html += '<table class="rw-table"><thead><tr>' +
      '<th>Reward</th><th style="text-align:right;">Total cost</th>' +
      '</tr></thead><tbody>' +
      costRows.map(function (row) {
        return '<tr><td>' + rewardsEscape(row.name) + '</td>' +
          '<td class="rw-amount">' + rewardsPeso(row.totalCost) + '</td></tr>';
      }).join('') +
      '<tr class="rw-total"><td>Total</td><td class="rw-amount">' + rewardsPeso(totalRedemptionCost) + '</td></tr>' +
      '</tbody></table>';
  }
  html += '</div>';

  // --- cashier activity -------------------------------------------------------
  // stampsByCashier rows look like {red: 12, yellow: 3, updatedAt: <ms>} — updatedAt
  // is bookkeeping, not a currency, so it is skipped when the stamp cells are built.
  var stampsByCashier = r.stampsByCashier || {}, redemptionsByCashier = r.redemptionsByCashier || {};
  var cashierKeys = {};
  Object.keys(stampsByCashier).forEach(function (k) { cashierKeys[k] = true; });
  Object.keys(redemptionsByCashier).forEach(function (k) { cashierKeys[k] = true; });
  var currencyCodes = rewardsCurrencyCodes();
  var cashiers = Object.keys(cashierKeys).map(function (key) {
    var stamps = stampsByCashier[key] || {};
    return {
      key: key,
      name: (r.cashierNames && r.cashierNames[key]) || key,
      redemptions: Number(redemptionsByCashier[key]) || 0,
      stamps: currencyCodes.map(function (code) {
        return {code: code, qty: Number(stamps[code]) || 0};
      }).filter(function (cell) { return cell.qty > 0; }),
      updatedAt: Number(stamps.updatedAt) || 0,
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  html += '<div class="rw-card"><div class="rw-card-head"><h4 class="rw-card-title">Cashier activity</h4></div>';
  if (!cashiers.length) {
    html += '<div class="rw-empty"><div class="rw-empty-ic">☕</div>' +
      '<div class="rw-empty-t">No cashier has stamped or redeemed yet</div>' +
      '<div class="rw-empty-s">Stamp and redemption counts per cashier appear here once the program is in use.</div></div>';
  } else {
    html += '<table class="rw-table"><thead><tr>' +
      '<th>Cashier</th>' +
      currencyCodes.map(function (code) {
        return '<th style="text-align:right;">' + rewardsEscape(rewardsCurrencyLabel(code)) + '</th>';
      }).join('') +
      '<th style="text-align:right;">Redemptions</th>' +
      '<th style="text-align:right;">Last stamped</th>' +
      '</tr></thead><tbody>' +
      cashiers.map(function (row) {
        var qtyByCode = {};
        row.stamps.forEach(function (cell) { qtyByCode[cell.code] = cell.qty; });
        return '<tr><td>' + rewardsEscape(row.name) + '</td>' +
          currencyCodes.map(function (code) {
            var qty = qtyByCode[code] || 0;
            return '<td class="rw-amount">' + (qty ? String(qty) : '—') + '</td>';
          }).join('') +
          '<td class="rw-amount">' + (row.redemptions ? String(row.redemptions) : '—') + '</td>' +
          '<td class="rw-amount rw-nowrap">' + (row.updatedAt ? rewardsDate(row.updatedAt) : '—') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }
  html += '</div>';

  // --- tenure milestones --------------------------------------------------------
  var milestones = (r.tenureMilestones || []).slice().sort(function (a, b) {
    return (Number(b.tenureDays) || 0) - (Number(a.tenureDays) || 0);
  });
  html += '<div class="rw-card"><div class="rw-card-head"><h4 class="rw-card-title">Membership milestones (last 30 days)</h4></div>';
  if (!milestones.length) {
    html += '<div class="rw-empty"><div class="rw-empty-ic">🏆</div>' +
      '<div class="rw-empty-t">No membership milestone in the last 30 days</div>' +
      '<div class="rw-empty-s">Members crossing their 6-month or 1-year mark are celebrated here.</div></div>';
  } else {
    html += milestones.map(function (row) {
      var initial = rewardsEscape(String(row.firstName || 'M').trim().charAt(0).toUpperCase());
      return '<div class="rw-mile"><span class="rw-ava">' + initial + '</span>' +
        '<span>' + rewardsEscape(row.firstName || 'Member') +
        ' reached the ' + rewardsEscape(rewardsMilestoneLabel(row.milestone)) + ' mark.</span>' +
        '<span class="rw-badge off" style="margin-left:auto;">' + (Number(row.tenureDays) || 0) + ' days</span></div>';
    }).join('');
  }
  html += '</div>';

  return html;
}

function rewardsStatCard(label, value, hint) {
  return '<div class="rw-stat"><span class="rw-stat-num">' + rewardsEscape(value) + '</span>' +
    '<span class="rw-stat-lbl">' + rewardsEscape(label) + '</span>' +
    '<span class="rw-stat-hint">' + rewardsEscape(hint) + '</span></div>';
}

function rewardsReportsLoad() {
  var api = rewardsApi(); if (!api) return;
  _rewardsState.busy = true; renderRewards();
  api.getLoyaltyReports().then(function (result) {
    _rewardsState.reports = (result && result.data) || null;
    _rewardsState.reportsLoaded = true;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not load the loyalty reports.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
  });
}
// ---------------------------------------------------------------------------
// Rewards · Stamps (loyalty currencies).
//
// Server authority: manageLoyaltyCurrency (loyaltyAdmin). This screen deliberately
// offers only what the server will accept, so the UI can never imply a capability the
// server refuses:
//   - colour is picked from the server's fixed palette, never a free colour picker;
//   - a stamp is never deleted, only disabled - members hold real balances in it;
//   - the code is write-once. It names the balance field ({code}Balance) holding real
//     member stamps, so renaming it would strand every stamp a member is holding.
//
// Server refusals are shown verbatim rather than reworded: the message names exactly
// what to turn off first (for example a live earning rule that still awards the stamp),
// and softening it would hide the reason stamps would otherwise be dropped silently.
// ---------------------------------------------------------------------------
var _rewardsStampsState = {rows: {}, colors: [], loaded: false, busy: false, note: '', noteBad: false, editing: null};

function rewardsStampsApi() { var a = A(); return (a && a.callables && a.callables.manageLoyaltyCurrency) ? a.callables : null; }

function rewardsStampCapLabel(row) {
  var cap = (row && row.dailyCap != null && row.dailyCap !== '') ? Number(row.dailyCap) : null;
  return (cap && cap > 0) ? (cap + ' per day') : 'No daily limit';
}

function rewardsStampsRowsHtml() {
  var rows = _rewardsStampsState.rows, codes = Object.keys(rows);
  if (!codes.length) return '';
  codes.sort(function (a, b) { return (Number(rows[a].order) || 99) - (Number(rows[b].order) || 99) || a.localeCompare(b); });
  return codes.map(function (code) {
    var row = rows[code] || {}, off = row.enabled === false;
    var swatch = '<span class="rw-swatch" style="background:' + rewardsEscape(String(row.color || '#ccc')) + ';"></span>';
    // Label always accompanies the colour - a stamp is never identified by colour alone.
    return '<tr class="' + (off ? 'rw-off' : '') + '">' +
      '<td>' + swatch + '<span class="rw-nowrap">' + rewardsEscape(row.label || code) + '</span>' +
      '<div class="rw-cell-sub">' + 'code: ' + rewardsEscape(code) + (off ? ' · disabled' : '') + '</div></td>' +
      '<td class="rw-nowrap">' + rewardsStampCapLabel(row) + '</td>' +
      '<td class="rw-nowrap">' + (Number(row.order) || 99) + '</td>' +
      '<td class="rw-actions">' +
      '<button type="button" class="rw-btn sm sec" data-stampedit="' + rewardsEscape(code) + '">Edit</button>' +
      '<button type="button" class="rw-btn sm ' + (off ? 'sec' : 'danger') + '" data-stamptoggle="' + rewardsEscape(code) + '">' + (off ? 'Enable' : 'Disable') + '</button>' +
      '</td></tr>';
  }).join('');
}

function rewardsStampsColorPicker(selected) {
  var colors = _rewardsStampsState.colors || [];
  if (!colors.length) return '<div class="rw-cell-sub">Loading colours…</div>';
  return '<div class="rw-colors">' + colors.map(function (color) {
    var on = String(color.hex || '').toLowerCase() === String(selected || '').toLowerCase();
    return '<button type="button" class="rw-color' + (on ? ' on' : '') + '" data-stampcolor="' + rewardsEscape(color.hex) + '" title="' + rewardsEscape(color.name) + '">' +
      '<span class="rw-swatch" style="background:' + rewardsEscape(color.hex) + ';"></span>' +
      '<span>' + rewardsEscape(color.name) + (on ? ' ✓' : '') + '</span></button>';
  }).join('') + '</div>';
}

function rewardsStampsFormHtml() {
  var editing = _rewardsStampsState.editing;
  if (!editing) {
    return '<div class="rw-form-actions" style="margin-top:1rem;"><button type="button" id="stampAdd" class="rw-btn ok"' + (_rewardsStampsState.busy ? ' disabled' : '') + '>Add a stamp</button></div>';
  }
  var isNew = editing.isNew === true;
  return '<div class="rw-form">' +
    '<div class="rw-form-title">' + (isNew ? 'Add a stamp' : 'Edit ' + rewardsEscape(editing.label || editing.code)) + '</div>' +
    '<div class="rw-fields">' +
    '<div class="rw-field"><label>Code</label>' +
    '<input id="stampCode" value="' + rewardsEscape(editing.code || '') + '"' + (isNew ? '' : ' disabled') +
    ' placeholder="e.g. green"></div>' +
    '<div class="rw-field"><label>Label</label>' +
    '<input id="stampLabel" value="' + rewardsEscape(editing.label || '') + '" placeholder="e.g. Green stamp"></div>' +
    '<div class="rw-field"><label>Daily limit (blank = none)</label>' +
    '<input id="stampCap" value="' + rewardsEscape(editing.dailyCap == null ? '' : editing.dailyCap) + '" placeholder="none"></div>' +
    '<div class="rw-field"><label>Order</label>' +
    '<input id="stampOrder" value="' + rewardsEscape(editing.order == null ? '' : editing.order) + '" placeholder="99"></div>' +
    '</div>' +
    (isNew ? '<div class="rw-warn">The code is permanent - it names the field that holds members\' stamps, so it can never be renamed later.</div>' : '') +
    '<div class="rw-field-label">Colour</div>' +
    '<div id="stampColors">' + rewardsStampsColorPicker(editing.color) + '</div>' +
    '<div class="rw-form-actions">' +
    '<button type="button" id="stampSave" class="rw-btn ok"' + (_rewardsStampsState.busy ? ' disabled' : '') + '>' + (_rewardsStampsState.busy ? 'Saving…' : 'Save stamp') + '</button>' +
    '<button type="button" id="stampCancel" class="rw-btn sec">Cancel</button>' +
    '</div></div>';
}

function rewardsStampsHtml() {
  if (!rewardsStampsApi()) {
    return '<div class="rw-fatal">Rewards stamp settings are unavailable right now. Refresh the portal and try again.</div>';
  }
  if (!_rewardsStampsState.loaded) {
    return '<div class="rw-loading">' + (_rewardsStampsState.busy ? 'Loading stamps…' : 'Press Refresh to load the stamp list.') + '</div>';
  }
  var note = _rewardsStampsState.note;
  var codes = Object.keys(_rewardsStampsState.rows);
  var table = codes.length
    ? '<table class="rw-table"><thead><tr>' +
      '<th>Stamp</th><th>Daily limit</th><th>Order</th><th></th>' +
      '</tr></thead><tbody>' + rewardsStampsRowsHtml() + '</tbody></table>'
    : '<div class="rw-empty"><div class="rw-empty-ic">🥇</div><div class="rw-empty-t">No stamps configured yet.</div>' +
      '<div class="rw-empty-s">Stamps are what members collect — create your first stamp type below.</div></div>';
  return '<div class="rw-fineprint" style="margin-top:0;">The stamp types your program awards. A stamp can be relabelled, recoloured or limited at any time. It can be turned off, but never deleted or renamed - members hold real balances in it.</div>' +
    (note ? '<div class="rw-note ' + (_rewardsStampsState.noteBad ? 'bad' : 'ok') + '" style="margin-top:.8rem;">' + rewardsEscape(note) + '</div>' : '') +
    table + rewardsStampsFormHtml();
}

function rewardsStampsWire(body) {
  var add = body.querySelector('#stampAdd');
  if (add) add.onclick = function () {
    var palette = _rewardsStampsState.colors || [];
    _rewardsStampsState.editing = {isNew: true, code: '', label: '', color: palette.length ? palette[0].hex : '', dailyCap: '', order: ''};
    _rewardsStampsState.note = ''; renderRewards();
  };
  var cancel = body.querySelector('#stampCancel');
  if (cancel) cancel.onclick = function () { _rewardsStampsState.editing = null; renderRewards(); };
  var save = body.querySelector('#stampSave');
  if (save) save.onclick = function () { rewardsStampsSave(body); };
  body.querySelectorAll('[data-stampcolor]').forEach(function (button) {
    button.onclick = function () {
      if (!_rewardsStampsState.editing) return;
      _rewardsStampsState.editing.color = button.getAttribute('data-stampcolor');
      // Keep whatever the operator has already typed while re-rendering the swatches.
      rewardsStampsCaptureForm(body); renderRewards();
    };
  });
  body.querySelectorAll('[data-stampedit]').forEach(function (button) {
    button.onclick = function () {
      var code = button.getAttribute('data-stampedit'), row = _rewardsStampsState.rows[code] || {};
      _rewardsStampsState.editing = {isNew: false, code: code, label: row.label || '', color: row.color || '', dailyCap: row.dailyCap == null ? '' : row.dailyCap, order: row.order == null ? '' : row.order};
      _rewardsStampsState.note = ''; renderRewards();
    };
  });
  body.querySelectorAll('[data-stamptoggle]').forEach(function (button) {
    button.onclick = function () {
      var code = button.getAttribute('data-stamptoggle'), row = _rewardsStampsState.rows[code] || {};
      rewardsStampsToggle(code, row.enabled === false ? 'enable' : 'disable');
    };
  });
}

// Preserve in-progress typing across a re-render (choosing a colour re-renders the form).
function rewardsStampsCaptureForm(body) {
  var editing = _rewardsStampsState.editing; if (!editing) return;
  var code = body.querySelector('#stampCode'), label = body.querySelector('#stampLabel');
  var cap = body.querySelector('#stampCap'), order = body.querySelector('#stampOrder');
  if (code && !code.disabled) editing.code = code.value;
  if (label) editing.label = label.value;
  if (cap) editing.dailyCap = cap.value;
  if (order) editing.order = order.value;
}

function rewardsStampsLoad() {
  var api = rewardsStampsApi(); if (!api) return;
  _rewardsStampsState.busy = true;
  api.manageLoyaltyCurrency({action: 'list'}).then(function (result) {
    var payload = (result && result.data) || {};
    _rewardsStampsState.rows = payload.currencies || {};
    // The palette is whatever the server offers - the screen never invents a colour.
    _rewardsStampsState.colors = payload.colors || [];
    _rewardsStampsState.loaded = true;
    // The shared currency labels feed the catalog and rules screens - refresh them too.
    _rewardsState.currenciesLoaded = false;
  }).catch(function (error) {
    _rewardsStampsState.note = rewardsMessage(error, 'Could not load the stamp list.');
    _rewardsStampsState.noteBad = true;
  }).then(function () {
    _rewardsStampsState.busy = false; renderRewards();
  });
}

function rewardsStampsSave(body) {
  var api = rewardsStampsApi(); if (!api || _rewardsStampsState.busy) return;
  rewardsStampsCaptureForm(body);
  var editing = _rewardsStampsState.editing; if (!editing) return;
  var payload = {
    action: 'save',
    code: String(editing.code || '').trim(),
    label: String(editing.label || '').trim(),
    color: editing.color || '',
    dailyCap: String(editing.dailyCap == null ? '' : editing.dailyCap).trim(),
    order: String(editing.order == null ? '' : editing.order).trim(),
  };
  if (!payload.order) delete payload.order;
  _rewardsStampsState.busy = true; renderRewards();
  api.manageLoyaltyCurrency(payload).then(function (result) {
    var data = (result && result.data) || {};
    _rewardsStampsState.note = data.created ? ('Added the ' + payload.label + ' stamp.') : ('Saved the ' + payload.label + ' stamp.');
    _rewardsStampsState.noteBad = false;
    _rewardsStampsState.editing = null; _rewardsStampsState.loaded = false;
    _rewardsState.currenciesLoaded = false;
  }).catch(function (error) {
    // Validation errors come back from the server (palette colour, code shape, cap) and
    // are shown as written - the operator needs the exact reason.
    _rewardsStampsState.note = rewardsMessage(error, 'Could not save that stamp.');
    _rewardsStampsState.noteBad = true;
  }).then(function () {
    _rewardsStampsState.busy = false;
    if (!_rewardsStampsState.loaded && !_rewardsStampsState.noteBad) rewardsStampsLoad(); else renderRewards();
  });
}

function rewardsStampsToggle(code, action) {
  var api = rewardsStampsApi(); if (!api || _rewardsStampsState.busy) return;
  if (action === 'disable' && !confirm('Turn this stamp off? Members keep the stamps they already hold, and it can be turned back on at any time.')) return;
  _rewardsStampsState.busy = true; _rewardsStampsState.note = ''; renderRewards();
  api.manageLoyaltyCurrency({action: action, code: code}).then(function () {
    _rewardsStampsState.note = action === 'enable' ? 'Stamp turned on.' : 'Stamp turned off. Members keep any stamps they already hold.';
    _rewardsStampsState.noteBad = false; _rewardsStampsState.loaded = false;
    _rewardsState.currenciesLoaded = false;
  }).catch(function (error) {
    // A refusal here is a real safeguard (a live rule still awards it, or a live reward
    // still costs it). Show the server's wording: it names what to turn off first.
    _rewardsStampsState.note = rewardsMessage(error, 'Could not change that stamp.');
    _rewardsStampsState.noteBad = true;
  }).then(function () {
    _rewardsStampsState.busy = false;
    if (!_rewardsStampsState.loaded && !_rewardsStampsState.noteBad) rewardsStampsLoad(); else renderRewards();
  });
}
// ---------------------------------------------------------------------------
// Rewards · Reward catalog. Server authority: manageLoyaltyRewardCatalog
// (loyaltyAdmin). The form mirrors Loyalty.validateRewardDefinition exactly, so
// the UI never offers a combination the server will refuse:
//   - a peso cap is required for free-item and money-off grants, and even for
//     percent-off (an uncapped percent discount cannot exist);
//   - a percent-off grant needs a percent between 1 and 100;
//   - a no-substitution free item must name its item;
//   - expiry is always a positive number of days.
// A reward is never deleted, only disabled - history and open claims reference
// it. Server refusals are shown verbatim.
// ---------------------------------------------------------------------------
var REWARDS_GRANT_TYPES = [
  {id: 'free_item_capped', label: 'Free item · up to a peso cap'},
  {id: 'percent_off_capped', label: 'Percent off · capped in pesos'},
  {id: 'fixed_off_capped', label: 'Fixed peso amount off'},
  {id: 'free_item_no_sub', label: 'One specific free item · no substitution'},
];

function rewardsGrantLabel(id) {
  for (var i = 0; i < REWARDS_GRANT_TYPES.length; i++) if (REWARDS_GRANT_TYPES[i].id === id) return REWARDS_GRANT_TYPES[i].label;
  return String(id || '');
}

function rewardsGrantDetail(row) {
  var cap = Number(row.cap), percent = Number(row.percent);
  if (row.grantType === 'free_item_capped') return 'Free item up to ' + rewardsPeso(cap);
  if (row.grantType === 'percent_off_capped') return percent + '% off, up to ' + rewardsPeso(cap);
  if (row.grantType === 'fixed_off_capped') return rewardsPeso(cap) + ' off the order';
  if (row.grantType === 'free_item_no_sub') return 'Free item: ' + rewardsEscape(row.itemId || '(not set)');
  return rewardsEscape(row.grantType || '');
}

function rewardsCatalogHtml() {
  var rows = _rewardsState.catalog, ids = Object.keys(rows);
  if (!_rewardsState.catalogLoaded) {
    return '<div class="rw-loading">' + (_rewardsState.busy ? 'Loading the catalog…' : 'Press Refresh to load the reward catalog.') + '</div>';
  }
  ids.sort(function (a, b) {
    return String((rows[a] && rows[a].name) || a).localeCompare(String((rows[b] && rows[b].name) || b));
  });
  var body = ids.length ? ids.map(function (rewardId) {
    var row = rows[rewardId] || {}, off = row.enabled === false;
    return '<tr class="' + (off ? 'rw-off' : '') + '">' +
      '<td><span class="rw-nowrap">' + rewardsEscape(row.name || rewardId) + '</span>' +
      '<div class="rw-cell-sub">' + 'id: ' + rewardsEscape(rewardId) + (row.system ? ' · built-in' : '') + (off ? ' · disabled' : '') + '</div></td>' +
      '<td class="rw-nowrap">' + rewardsEscape(rewardsCurrencyLabel(row.costCurrency)) + ' × ' + (Number(row.costQty) || 0) + '</td>' +
      '<td>' + rewardsGrantDetail(row) +
      (row.stackingAllowed === true ? '<div class="rw-cell-sub">stacks with discounts</div>' : '') + '</td>' +
      '<td class="rw-nowrap">' + (Number(row.expiryDays) || 0) + ' days</td>' +
      '<td class="rw-actions">' +
      '<button type="button" class="rw-btn sm sec" data-rewardedit="' + rewardsEscape(rewardId) + '">Edit</button>' +
      '<button type="button" class="rw-btn sm ' + (off ? 'sec' : 'danger') + '" data-rewardtoggle="' + rewardsEscape(rewardId) + '">' + (off ? 'Enable' : 'Disable') + '</button>' +
      '</td></tr>';
  }).join('') : '';

  var table = ids.length
    ? '<table class="rw-table"><thead><tr>' +
      '<th>Reward</th><th>Cost</th><th>Grant</th><th>Claim expires</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>'
    : '<div class="rw-empty"><div class="rw-empty-ic">🎁</div><div class="rw-empty-t">No rewards configured yet.</div>' +
      '<div class="rw-empty-s">Add your first reward below so members have something to save their stamps for.</div></div>';

  return table + rewardsCatalogFormHtml();
}

function rewardsCatalogFormHtml() {
  var editing = _rewardsState.catalogEditing;
  if (!editing) {
    return '<div class="rw-form-actions" style="margin-top:1rem;"><button type="button" id="rewardAdd" class="rw-btn ok"' + (_rewardsState.busy ? ' disabled' : '') + '>Add a reward</button></div>';
  }
  var isNew = editing.isNew === true;
  var currencyOptions = rewardsCurrencyCodes().map(function (code) {
    return '<option value="' + rewardsEscape(code) + '"' + (editing.costCurrency === code ? ' selected' : '') + '>' +
      rewardsEscape(rewardsCurrencyLabel(code)) + '</option>';
  }).join('');
  var grantOptions = REWARDS_GRANT_TYPES.map(function (type) {
    return '<option value="' + rewardsEscape(type.id) + '"' + (editing.grantType === type.id ? ' selected' : '') + '>' +
      rewardsEscape(type.label) + '</option>';
  }).join('');
  var needsCap = editing.grantType === 'free_item_capped' || editing.grantType === 'percent_off_capped' || editing.grantType === 'fixed_off_capped';
  var needsPercent = editing.grantType === 'percent_off_capped';
  var needsItem = editing.grantType === 'free_item_no_sub';

  return '<div class="rw-form">' +
    '<div class="rw-form-title">' + (isNew ? 'Add a reward' : 'Edit ' + rewardsEscape(editing.name || editing.rewardId)) + '</div>' +
    '<div class="rw-fields">' +
    '<div class="rw-field"><label>Name</label><input id="rewardName" value="' + rewardsEscape(editing.name || '') + '" placeholder="e.g. Free drink"></div>' +
    '<div class="rw-field"><label>Costs</label><select id="rewardCostCurrency">' + currencyOptions + '</select></div>' +
    '<div class="rw-field"><label>Stamps</label><input id="rewardCostQty" value="' + rewardsEscape(editing.costQty == null ? '' : editing.costQty) + '" placeholder="10"></div>' +
    '<div class="rw-field"><label>Grant type</label><select id="rewardGrantType">' + grantOptions + '</select></div>' +
    (needsCap ? '<div class="rw-field"><label>Peso cap</label><input id="rewardCap" value="' + rewardsEscape(editing.cap == null ? '' : editing.cap) + '" placeholder="120"></div>' : '') +
    (needsPercent ? '<div class="rw-field"><label>Percent (1-100)</label><input id="rewardPercent" value="' + rewardsEscape(editing.percent == null ? '' : editing.percent) + '" placeholder="20"></div>' : '') +
    (needsItem ? '<div class="rw-field"><label>Item id</label><input id="rewardItemId" value="' + rewardsEscape(editing.itemId || '') + '" placeholder="item id from the menu"></div>' : '') +
    '<div class="rw-field"><label>Claim expiry (days)</label><input id="rewardExpiry" value="' + rewardsEscape(editing.expiryDays == null ? '' : editing.expiryDays) + '" placeholder="30"></div>' +
    '</div>' +
    '<div class="rw-checks">' +
    '<label><input type="checkbox" id="rewardStacking"' + (editing.stackingAllowed === true ? ' checked' : '') + '> Can stack with other discounts</label>' +
    '<label><input type="checkbox" id="rewardEnabled"' + (editing.enabled !== false ? ' checked' : '') + '> Enabled</label>' +
    '</div>' +
    '<div class="rw-form-actions">' +
    '<button type="button" id="rewardSave" class="rw-btn ok"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Saving…' : 'Save reward') + '</button>' +
    '<button type="button" id="rewardCancel" class="rw-btn sec">Cancel</button>' +
    '</div></div>';
}

// Keep whatever the operator has typed when the grant-type select re-renders the form.
function rewardsCatalogCaptureForm(body) {
  var editing = _rewardsState.catalogEditing; if (!editing) return;
  var name = body.querySelector('#rewardName'), cost = body.querySelector('#rewardCostCurrency');
  var qty = body.querySelector('#rewardCostQty'), grantType = body.querySelector('#rewardGrantType');
  var cap = body.querySelector('#rewardCap'), percent = body.querySelector('#rewardPercent');
  var itemId = body.querySelector('#rewardItemId'), expiry = body.querySelector('#rewardExpiry');
  var stacking = body.querySelector('#rewardStacking'), enabled = body.querySelector('#rewardEnabled');
  if (name) editing.name = name.value;
  if (cost) editing.costCurrency = cost.value;
  if (qty) editing.costQty = qty.value;
  if (grantType) editing.grantType = grantType.value;
  if (cap) editing.cap = cap.value;
  if (percent) editing.percent = percent.value;
  if (itemId) editing.itemId = itemId.value;
  if (expiry) editing.expiryDays = expiry.value;
  if (stacking) editing.stackingAllowed = stacking.checked;
  if (enabled) editing.enabled = enabled.checked;
}

function rewardsCatalogWire(body) {
  var add = body.querySelector('#rewardAdd');
  if (add) add.onclick = function () {
    var codes = rewardsCurrencyCodes();
    _rewardsState.catalogEditing = {
      isNew: true, rewardId: '',
      name: '', costCurrency: codes[0] || '', costQty: '',
      grantType: 'free_item_capped', cap: '', percent: '', itemId: '',
      expiryDays: '30', stackingAllowed: false, enabled: true,
    };
    _rewardsState.note = ''; renderRewards();
  };
  var cancel = body.querySelector('#rewardCancel');
  if (cancel) cancel.onclick = function () { _rewardsState.catalogEditing = null; renderRewards(); };
  var save = body.querySelector('#rewardSave');
  if (save) save.onclick = function () { rewardsCatalogSave(body); };
  var grantType = body.querySelector('#rewardGrantType');
  if (grantType) grantType.onchange = function () {
    rewardsCatalogCaptureForm(body);
    renderRewards();
  };
  body.querySelectorAll('[data-rewardedit]').forEach(function (button) {
    button.onclick = function () {
      var rewardId = button.getAttribute('data-rewardedit');
      var row = _rewardsState.catalog[rewardId] || {};
      _rewardsState.catalogEditing = {
        isNew: false, rewardId: rewardId,
        name: row.name || '', costCurrency: row.costCurrency || '', costQty: row.costQty == null ? '' : row.costQty,
        grantType: row.grantType || 'free_item_capped', cap: row.cap == null ? '' : row.cap,
        percent: row.percent == null ? '' : row.percent, itemId: row.itemId == null ? '' : row.itemId,
        expiryDays: row.expiryDays == null ? '' : row.expiryDays,
        stackingAllowed: row.stackingAllowed === true, enabled: row.enabled !== false,
      };
      _rewardsState.note = ''; renderRewards();
    };
  });
  body.querySelectorAll('[data-rewardtoggle]').forEach(function (button) {
    button.onclick = function () {
      var rewardId = button.getAttribute('data-rewardtoggle');
      var row = _rewardsState.catalog[rewardId] || {};
      rewardsCatalogToggle(rewardId, row.enabled === false ? 'enable' : 'disable');
    };
  });
}

function rewardsCatalogLoad() {
  var api = rewardsApi(); if (!api) return;
  _rewardsState.busy = true; renderRewards();
  api.manageLoyaltyRewardCatalog({action: 'list'}).then(function (result) {
    _rewardsState.catalog = ((result && result.data) || {}).catalog || {};
    _rewardsState.catalogLoaded = true;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not load the reward catalog.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
  });
}

function rewardsCatalogSave(body) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  rewardsCatalogCaptureForm(body);
  var editing = _rewardsState.catalogEditing; if (!editing) return;
  var payload = {
    name: String(editing.name || '').trim(),
    costCurrency: editing.costCurrency,
    costQty: String(editing.costQty == null ? '' : editing.costQty).trim(),
    grantType: editing.grantType,
    cap: String(editing.cap == null ? '' : editing.cap).trim(),
    percent: String(editing.percent == null ? '' : editing.percent).trim(),
    itemId: String(editing.itemId || '').trim(),
    expiryDays: String(editing.expiryDays == null ? '' : editing.expiryDays).trim(),
    stackingAllowed: editing.stackingAllowed === true,
    enabled: editing.enabled !== false,
  };
  if (!editing.isNew) payload.rewardId = editing.rewardId;
  _rewardsState.busy = true; renderRewards();
  api.manageLoyaltyRewardCatalog(payload).then(function () {
    _rewardsState.note = editing.isNew ? 'Reward added.' : ('Saved ' + (payload.name || 'the reward') + '.');
    _rewardsState.noteBad = false;
    _rewardsState.catalogEditing = null; _rewardsState.catalogLoaded = false;
  }).catch(function (error) {
    // Validation comes back from the server (cap, percent, item, expiry, stamp code)
    // and is shown as written - the operator needs the exact reason.
    _rewardsState.note = rewardsMessage(error, 'Could not save that reward.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false;
    if (!_rewardsState.catalogLoaded && !_rewardsState.noteBad) rewardsCatalogLoad(); else renderRewards();
  });
}

function rewardsCatalogToggle(rewardId, action) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  if (action === 'disable' && !confirm('Turn this reward off? It disappears from new redemptions immediately. Members who already hold a claim keep it until it expires.')) return;
  _rewardsState.busy = true; _rewardsState.note = ''; renderRewards();
  api.manageLoyaltyRewardCatalog({action: action, rewardId: rewardId}).then(function () {
    _rewardsState.note = action === 'enable' ? 'Reward turned on.' : 'Reward turned off. Existing claims are unaffected until they expire.';
    _rewardsState.noteBad = false; _rewardsState.catalogLoaded = false;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not change that reward.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false;
    if (!_rewardsState.catalogLoaded && !_rewardsState.noteBad) rewardsCatalogLoad(); else renderRewards();
  });
}
// ---------------------------------------------------------------------------
// Rewards · Earning rules. Server authority: manageLoyaltyEarningRule
// (loyaltyAdmin). The form offers exactly the four server triggers, and each
// trigger's condition field matches what evaluateEarningRules reads:
//   - amount_threshold needs condition.minNetAmount (fires strictly above it,
//     and only the HIGHEST qualifying amount rule per stamp fires — a tier
//     ladder, not a stack — so tiers are entered as one rule each);
//   - order_count needs condition.every (fires when the order number is a
//     multiple of it);
//   - per_order and first_order_after_signup take no condition.
// Schedules are optional start/end timestamps. Enabled is part of the saved
// row — there is no separate toggle action on this endpoint.
// ---------------------------------------------------------------------------
var REWARDS_TRIGGERS = [
  {id: 'per_order', label: 'Every completed order'},
  {id: 'amount_threshold', label: 'Order above an amount'},
  {id: 'order_count', label: 'Every Nth order'},
  {id: 'first_order_after_signup', label: 'Member\'s first order'},
];

function rewardsTriggerLabel(id) {
  for (var i = 0; i < REWARDS_TRIGGERS.length; i++) if (REWARDS_TRIGGERS[i].id === id) return REWARDS_TRIGGERS[i].label;
  return String(id || '');
}

function rewardsConditionSummary(rule) {
  var condition = rule && rule.condition || {};
  if (rule.trigger === 'amount_threshold') {
    return 'net amount over ' + rewardsPeso(Number(condition.minNetAmount) || 0);
  }
  if (rule.trigger === 'order_count') {
    var every = Number(condition.every) || 0;
    return every > 0 ? ('every ' + every + ' orders') : 'every — (not set)';
  }
  return 'no condition';
}

function rewardsScheduleSummary(rule) {
  var start = Number(rule && rule.startAt) || null, end = Number(rule && rule.endAt) || null;
  if (start && end) return rewardsDate(start) + ' → ' + rewardsDate(end);
  if (start) return 'from ' + rewardsDate(start);
  if (end) return 'until ' + rewardsDate(end);
  return 'always';
}

function rewardsToDatetimeLocal(ms) {
  var value = Number(ms);
  if (!value || isNaN(value)) return '';
  // Manila wall time on any device: +8h shift, then read the UTC calendar fields.
  return new Date(value + 28800000).toISOString().slice(0, 16);
}

function rewardsRulesHtml() {
  var rows = _rewardsState.rules, ids = Object.keys(rows);
  if (!_rewardsState.rulesLoaded) {
    return '<div class="rw-loading">' + (_rewardsState.busy ? 'Loading rules…' : 'Press Refresh to load the earning rules.') + '</div>';
  }
  ids.sort(function (a, b) {
    return String((rows[a] && rows[a].name) || a).localeCompare(String((rows[b] && rows[b].name) || b));
  });
  var body = ids.length ? ids.map(function (ruleId) {
    var row = rows[ruleId] || {}, off = row.enabled === false;
    return '<tr class="' + (off ? 'rw-off' : '') + '">' +
      '<td><span class="rw-nowrap">' + rewardsEscape(row.name || ruleId) + '</span>' +
      '<div class="rw-cell-sub">' + 'id: ' + rewardsEscape(ruleId) + (row.system ? ' · built-in' : '') + (off ? ' · disabled' : '') + '</div></td>' +
      '<td>' + rewardsEscape(rewardsTriggerLabel(row.trigger)) +
      '<div class="rw-cell-sub">' + rewardsEscape(rewardsConditionSummary(row)) + '</div></td>' +
      '<td class="rw-nowrap">' + rewardsEscape(rewardsCurrencyLabel(row.currency)) + ' × ' + (Number(row.qty) || 0) + '</td>' +
      '<td class="rw-nowrap">' + rewardsEscape(rewardsScheduleSummary(row)) + '</td>' +
      '<td class="rw-actions">' +
      '<button type="button" class="rw-btn sm sec" data-ruleedit="' + rewardsEscape(ruleId) + '">Edit</button>' +
      '</td></tr>';
  }).join('') : '';

  var table = ids.length
    ? '<table class="rw-table"><thead><tr>' +
      '<th>Rule</th><th>When</th><th>Awards</th><th>Schedule</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>'
    : '<div class="rw-empty"><div class="rw-empty-ic">📌</div><div class="rw-empty-t">No earning rules configured yet.</div>' +
      '<div class="rw-empty-s">Rules decide how members earn stamps — for example one stamp per completed order.</div></div>';

  return table + rewardsRulesFormHtml();
}

function rewardsRulesFormHtml() {
  var editing = _rewardsState.rulesEditing;
  if (!editing) {
    return '<div class="rw-form-actions" style="margin-top:1rem;"><button type="button" id="ruleAdd" class="rw-btn ok"' + (_rewardsState.busy ? ' disabled' : '') + '>Add a rule</button></div>';
  }
  var isNew = editing.isNew === true;
  var currencyOptions = rewardsCurrencyCodes().map(function (code) {
    return '<option value="' + rewardsEscape(code) + '"' + (editing.currency === code ? ' selected' : '') + '>' +
      rewardsEscape(rewardsCurrencyLabel(code)) + '</option>';
  }).join('');
  var triggerOptions = REWARDS_TRIGGERS.map(function (trigger) {
    return '<option value="' + rewardsEscape(trigger.id) + '"' + (editing.trigger === trigger.id ? ' selected' : '') + '>' +
      rewardsEscape(trigger.label) + '</option>';
  }).join('');
  var conditionField = '';
  if (editing.trigger === 'amount_threshold') {
    conditionField = '<div class="rw-field"><label>Minimum net amount (₱)</label><input id="ruleMinNet" value="' + rewardsEscape(editing.minNetAmount == null ? '' : editing.minNetAmount) + '" placeholder="500"></div>';
  } else if (editing.trigger === 'order_count') {
    conditionField = '<div class="rw-field"><label>Every N orders</label><input id="ruleEvery" value="' + rewardsEscape(editing.every == null ? '' : editing.every) + '" placeholder="5"></div>';
  }

  return '<div class="rw-form">' +
    '<div class="rw-form-title">' + (isNew ? 'Add an earning rule' : 'Edit ' + rewardsEscape(editing.name || editing.ruleId)) + '</div>' +
    '<div class="rw-fields">' +
    '<div class="rw-field"><label>Name</label><input id="ruleName" value="' + rewardsEscape(editing.name || '') + '" placeholder="e.g. Yellow stamp · net over ₱500"></div>' +
    '<div class="rw-field"><label>When</label><select id="ruleTrigger">' + triggerOptions + '</select></div>' +
    '<div class="rw-field"><label>Award</label><select id="ruleCurrency">' + currencyOptions + '</select></div>' +
    '<div class="rw-field"><label>Stamps</label><input id="ruleQty" value="' + rewardsEscape(editing.qty == null ? '' : editing.qty) + '" placeholder="1"></div>' +
    conditionField +
    '</div>' +
    '<div class="rw-fields">' +
    '<div class="rw-field"><label>Starts (optional)</label><input id="ruleStart" type="datetime-local" value="' + rewardsEscape(rewardsToDatetimeLocal(editing.startAt)) + '"></div>' +
    '<div class="rw-field"><label>Ends (optional)</label><input id="ruleEnd" type="datetime-local" value="' + rewardsEscape(rewardsToDatetimeLocal(editing.endAt)) + '"></div>' +
    '<div class="rw-field rw-field-inline"><label>&nbsp;</label><label class="rw-check-label"><input type="checkbox" id="ruleEnabled"' + (editing.enabled !== false ? ' checked' : '') + '> Enabled</label></div>' +
    '</div>' +
    (editing.trigger === 'amount_threshold'
      ? '<div class="rw-warn">Amount rules are a ladder, not a stack: when an order crosses several amounts for the same stamp, only the highest one fires. Enter each tier as its own rule.</div>'
      : '') +
    '<div class="rw-form-actions">' +
    '<button type="button" id="ruleSave" class="rw-btn ok"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Saving…' : 'Save rule') + '</button>' +
    '<button type="button" id="ruleCancel" class="rw-btn sec">Cancel</button>' +
    '</div></div>';
}

function rewardsRulesCaptureForm(body) {
  var editing = _rewardsState.rulesEditing; if (!editing) return;
  var name = body.querySelector('#ruleName'), trigger = body.querySelector('#ruleTrigger');
  var currency = body.querySelector('#ruleCurrency'), qty = body.querySelector('#ruleQty');
  var minNet = body.querySelector('#ruleMinNet'), every = body.querySelector('#ruleEvery');
  var start = body.querySelector('#ruleStart'), end = body.querySelector('#ruleEnd');
  var enabled = body.querySelector('#ruleEnabled');
  if (name) editing.name = name.value;
  if (trigger) editing.trigger = trigger.value;
  if (currency) editing.currency = currency.value;
  if (qty) editing.qty = qty.value;
  if (minNet) editing.minNetAmount = minNet.value;
  if (every) editing.every = every.value;
  // The picker shows Manila wall time; without the +08:00 suffix the browser would
  // read the entry in whatever zone the viewing device happens to be in.
  if (start) editing.startAt = start.value ? Date.parse((start.value + ':00').slice(0, 19) + '+08:00') : null;
  if (end) editing.endAt = end.value ? Date.parse((end.value + ':00').slice(0, 19) + '+08:00') : null;
  if (enabled) editing.enabled = enabled.checked;
}

function rewardsRulesWire(body) {
  var add = body.querySelector('#ruleAdd');
  if (add) add.onclick = function () {
    var codes = rewardsCurrencyCodes();
    _rewardsState.rulesEditing = {
      isNew: true, ruleId: '',
      name: '', trigger: 'per_order', currency: codes[0] || '', qty: '1',
      minNetAmount: '', every: '', startAt: null, endAt: null, enabled: true,
    };
    _rewardsState.note = ''; renderRewards();
  };
  var cancel = body.querySelector('#ruleCancel');
  if (cancel) cancel.onclick = function () { _rewardsState.rulesEditing = null; renderRewards(); };
  var save = body.querySelector('#ruleSave');
  if (save) save.onclick = function () { rewardsRulesSave(body); };
  var trigger = body.querySelector('#ruleTrigger');
  if (trigger) trigger.onchange = function () {
    rewardsRulesCaptureForm(body);
    renderRewards();
  };
  body.querySelectorAll('[data-ruleedit]').forEach(function (button) {
    button.onclick = function () {
      var ruleId = button.getAttribute('data-ruleedit');
      var row = _rewardsState.rules[ruleId] || {};
      var condition = row.condition || {};
      _rewardsState.rulesEditing = {
        isNew: false, ruleId: ruleId,
        name: row.name || '', trigger: row.trigger || 'per_order', currency: row.currency || '',
        qty: row.qty == null ? '' : row.qty,
        minNetAmount: condition.minNetAmount == null ? '' : condition.minNetAmount,
        every: condition.every == null ? '' : condition.every,
        startAt: row.startAt == null ? null : row.startAt,
        endAt: row.endAt == null ? null : row.endAt,
        enabled: row.enabled !== false,
      };
      _rewardsState.note = ''; renderRewards();
    };
  });
}

function rewardsRulesLoad() {
  var api = rewardsApi(); if (!api) return;
  _rewardsState.busy = true; renderRewards();
  api.manageLoyaltyEarningRule({action: 'list'}).then(function (result) {
    _rewardsState.rules = ((result && result.data) || {}).rules || {};
    _rewardsState.rulesLoaded = true;
  }).catch(function (error) {
    _rewardsState.note = rewardsMessage(error, 'Could not load the earning rules.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false; renderRewards();
  });
}

function rewardsRulesSave(body) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  rewardsRulesCaptureForm(body);
  var editing = _rewardsState.rulesEditing; if (!editing) return;
  // Only the condition field that belongs to the chosen trigger is sent; the
  // server stores whatever object it receives, so a stale field would become
  // a live condition for a later trigger switch.
  var condition = {};
  if (editing.trigger === 'amount_threshold') condition.minNetAmount = String(editing.minNetAmount == null ? '' : editing.minNetAmount).trim();
  else if (editing.trigger === 'order_count') condition.every = String(editing.every == null ? '' : editing.every).trim();
  var payload = {
    trigger: editing.trigger,
    currency: editing.currency,
    qty: String(editing.qty == null ? '' : editing.qty).trim(),
    condition: condition,
    startAt: editing.startAt == null ? null : Number(editing.startAt),
    endAt: editing.endAt == null ? null : Number(editing.endAt),
    enabled: editing.enabled !== false,
    name: String(editing.name || '').trim(),
  };
  if (!editing.isNew) payload.ruleId = editing.ruleId;
  _rewardsState.busy = true; renderRewards();
  api.manageLoyaltyEarningRule(payload).then(function () {
    _rewardsState.note = editing.isNew ? 'Rule added.' : ('Saved ' + (payload.name || 'the rule') + '.');
    _rewardsState.noteBad = false;
    _rewardsState.rulesEditing = null; _rewardsState.rulesLoaded = false;
  }).catch(function (error) {
    // The server names the exact problem (trigger, stamp, quantity) - show it as written.
    _rewardsState.note = rewardsMessage(error, 'Could not save that rule.');
    _rewardsState.noteBad = true;
  }).then(function () {
    _rewardsState.busy = false;
    if (!_rewardsState.rulesLoaded && !_rewardsState.noteBad) rewardsRulesLoad(); else renderRewards();
  });
}
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
// ---------------------------------------------------------------------------
// Rewards · module registration. The loader calls this handler whenever the
// rewards tab opens. The screen loads on demand and never subscribes - every
// refresh is an explicit callable round-trip.
// ---------------------------------------------------------------------------
window.__accazaRegisterModule('rewards', function () { renderRewards(); });
