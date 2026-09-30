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
    return '<div style="padding:1rem;text-align:center;color:#666;font-size:.82rem;">' +
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

  var html = '<div style="display:flex;gap:.6rem;flex-wrap:wrap;">' +
    rewardsStatCard('Active members', String(r.activeMembers || 0), 'members not blocked or anonymized') +
    rewardsStatCard('Rewards redeemed', String(totalRedemptions), 'all cashiers, all time') +
    rewardsStatCard('Redemption cost', rewardsPeso(totalRedemptionCost), 'list price of free items and discounts given') +
    '</div>';

  // --- redemption cost by reward ---------------------------------------------
  html += '<h4 style="margin:1.2rem 0 .4rem;font-size:.85rem;color:var(--bd);">Redemption cost by reward</h4>';
  if (!costRows.length) {
    html += '<div style="padding:.6rem;color:#666;font-size:.8rem;">No reward has been redeemed yet.</div>';
  } else {
    html += '<table style="width:100%;border-collapse:collapse;font-size:.8rem;">' +
      '<thead><tr style="text-align:left;border-bottom:2px solid #eee;">' +
      '<th style="padding:.4rem .3rem;">Reward</th><th style="padding:.4rem .3rem;text-align:right;">Total cost</th>' +
      '</tr></thead><tbody>' +
      costRows.map(function (row) {
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:.4rem .3rem;">' + rewardsEscape(row.name) + '</td>' +
          '<td style="padding:.4rem .3rem;text-align:right;">' + rewardsPeso(row.totalCost) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

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

  html += '<h4 style="margin:1.2rem 0 .4rem;font-size:.85rem;color:var(--bd);">Cashier activity</h4>';
  if (!cashiers.length) {
    html += '<div style="padding:.6rem;color:#666;font-size:.8rem;">No cashier has stamped or redeemed yet.</div>';
  } else {
    html += '<table style="width:100%;border-collapse:collapse;font-size:.8rem;">' +
      '<thead><tr style="text-align:left;border-bottom:2px solid #eee;">' +
      '<th style="padding:.4rem .3rem;">Cashier</th>' +
      currencyCodes.map(function (code) {
        return '<th style="padding:.4rem .3rem;text-align:right;">' + rewardsEscape(rewardsCurrencyLabel(code)) + '</th>';
      }).join('') +
      '<th style="padding:.4rem .3rem;text-align:right;">Redemptions</th>' +
      '<th style="padding:.4rem .3rem;text-align:right;">Last stamped</th>' +
      '</tr></thead><tbody>' +
      cashiers.map(function (row) {
        var qtyByCode = {};
        row.stamps.forEach(function (cell) { qtyByCode[cell.code] = cell.qty; });
        return '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:.4rem .3rem;">' + rewardsEscape(row.name) + '</td>' +
          currencyCodes.map(function (code) {
            var qty = qtyByCode[code] || 0;
            return '<td style="padding:.4rem .3rem;text-align:right;">' + (qty ? String(qty) : '—') + '</td>';
          }).join('') +
          '<td style="padding:.4rem .3rem;text-align:right;">' + (row.redemptions ? String(row.redemptions) : '—') + '</td>' +
          '<td style="padding:.4rem .3rem;text-align:right;">' + (row.updatedAt ? rewardsDate(row.updatedAt) : '—') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // --- tenure milestones --------------------------------------------------------
  var milestones = (r.tenureMilestones || []).slice().sort(function (a, b) {
    return (Number(b.tenureDays) || 0) - (Number(a.tenureDays) || 0);
  });
  html += '<h4 style="margin:1.2rem 0 .4rem;font-size:.85rem;color:var(--bd);">Membership milestones (last 30 days)</h4>';
  if (!milestones.length) {
    html += '<div style="padding:.6rem;color:#666;font-size:.8rem;">No member crossed the 6-month or 1-year mark in the last 30 days.</div>';
  } else {
    html += '<ul style="margin:0;padding-left:1.2rem;font-size:.8rem;">' +
      milestones.map(function (row) {
        return '<li style="padding:.2rem 0;">' + rewardsEscape(row.firstName || 'Member') +
          ' reached the ' + rewardsEscape(rewardsMilestoneLabel(row.milestone)) +
          ' mark (' + (Number(row.tenureDays) || 0) + ' days).</li>';
      }).join('') + '</ul>';
  }

  return html;
}

function rewardsStatCard(label, value, hint) {
  return '<div style="flex:1 1 140px;min-width:140px;padding:.7rem .8rem;border:1px solid #e3e3e3;border-radius:10px;background:#fafafa;">' +
    '<div style="font-size:.7rem;color:#666;text-transform:uppercase;letter-spacing:.04em;">' + rewardsEscape(label) + '</div>' +
    '<div style="font-size:1.3rem;font-weight:600;color:var(--bd);margin-top:.15rem;">' + rewardsEscape(value) + '</div>' +
    '<div style="font-size:.68rem;color:#666;margin-top:.15rem;">' + rewardsEscape(hint) + '</div></div>';
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
    return '<div style="padding:1rem;text-align:center;color:#666;font-size:.82rem;">' +
      (_rewardsState.busy ? 'Loading the catalog…' : 'Press Refresh to load the reward catalog.') + '</div>';
  }
  ids.sort(function (a, b) {
    return String((rows[a] && rows[a].name) || a).localeCompare(String((rows[b] && rows[b].name) || b));
  });
  var body = ids.length ? ids.map(function (rewardId) {
    var row = rows[rewardId] || {}, off = row.enabled === false;
    return '<tr style="border-bottom:1px solid #eee;' + (off ? 'opacity:.55;' : '') + '">' +
      '<td style="padding:.4rem .3rem;"><strong>' + rewardsEscape(row.name || rewardId) + '</strong>' +
      '<div style="font-size:.72rem;color:#777;">id: ' + rewardsEscape(rewardId) + (row.system ? ' · built-in' : '') + (off ? ' · disabled' : '') + '</div></td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;white-space:nowrap;">' +
      rewardsEscape(rewardsCurrencyLabel(row.costCurrency)) + ' × ' + (Number(row.costQty) || 0) + '</td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;">' + rewardsGrantDetail(row) +
      (row.stackingAllowed === true ? '<div style="font-size:.72rem;color:#777;">stacks with discounts</div>' : '') + '</td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;white-space:nowrap;">' + (Number(row.expiryDays) || 0) + ' days</td>' +
      '<td style="padding:.4rem .3rem;text-align:right;white-space:nowrap;">' +
      '<button type="button" data-rewardedit="' + rewardsEscape(rewardId) + '" style="margin-right:.35rem;">Edit</button>' +
      '<button type="button" data-rewardtoggle="' + rewardsEscape(rewardId) + '">' + (off ? 'Enable' : 'Disable') + '</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="5" style="padding:.6rem;color:#666;">No rewards configured yet.</td></tr>';

  return '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">' +
    '<thead><tr style="text-align:left;border-bottom:2px solid #eee;color:#666;font-size:.74rem;">' +
    '<th style="padding:.4rem .3rem;">Reward</th><th style="padding:.4rem .3rem;">Cost</th>' +
    '<th style="padding:.4rem .3rem;">Grant</th><th style="padding:.4rem .3rem;">Claim expires</th><th></th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>' +
    '<div style="margin-top:.9rem;">' + rewardsCatalogFormHtml() + '</div>';
}

function rewardsCatalogFormHtml() {
  var editing = _rewardsState.catalogEditing;
  if (!editing) {
    return '<button type="button" id="rewardAdd"' + (_rewardsState.busy ? ' disabled' : '') + '>Add a reward</button>';
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

  return '<div style="border:1px solid #e3e3e3;border-radius:10px;padding:.8rem;background:#fafafa;">' +
    '<div style="font-size:.8rem;font-weight:600;margin-bottom:.5rem;">' + (isNew ? 'Add a reward' : 'Edit ' + rewardsEscape(editing.name || editing.rewardId)) + '</div>' +
    '<div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;">' +
    '<label style="font-size:.76rem;">Name<input id="rewardName" value="' + rewardsEscape(editing.name || '') + '" placeholder="e.g. Free drink" style="display:block;width:180px;"></label>' +
    '<label style="font-size:.76rem;">Costs<select id="rewardCostCurrency" style="display:block;width:130px;">' + currencyOptions + '</select></label>' +
    '<label style="font-size:.76rem;">Stamps<input id="rewardCostQty" value="' + rewardsEscape(editing.costQty == null ? '' : editing.costQty) + '" placeholder="10" style="display:block;width:80px;"></label>' +
    '<label style="font-size:.76rem;">Grant type<select id="rewardGrantType" style="display:block;width:230px;">' + grantOptions + '</select></label>' +
    (needsCap ? '<label style="font-size:.76rem;">Peso cap<input id="rewardCap" value="' + rewardsEscape(editing.cap == null ? '' : editing.cap) + '" placeholder="120" style="display:block;width:90px;"></label>' : '') +
    (needsPercent ? '<label style="font-size:.76rem;">Percent (1-100)<input id="rewardPercent" value="' + rewardsEscape(editing.percent == null ? '' : editing.percent) + '" placeholder="20" style="display:block;width:90px;"></label>' : '') +
    (needsItem ? '<label style="font-size:.76rem;">Item id<input id="rewardItemId" value="' + rewardsEscape(editing.itemId || '') + '" placeholder="item id from the menu" style="display:block;width:160px;"></label>' : '') +
    '<label style="font-size:.76rem;">Claim expiry (days)<input id="rewardExpiry" value="' + rewardsEscape(editing.expiryDays == null ? '' : editing.expiryDays) + '" placeholder="30" style="display:block;width:110px;"></label>' +
    '</div>' +
    '<div style="display:flex;gap:1rem;margin-top:.5rem;font-size:.78rem;">' +
    '<label><input type="checkbox" id="rewardStacking"' + (editing.stackingAllowed === true ? ' checked' : '') + '> Can stack with other discounts</label>' +
    '<label><input type="checkbox" id="rewardEnabled"' + (editing.enabled !== false ? ' checked' : '') + '> Enabled</label>' +
    '</div>' +
    '<div style="margin-top:.7rem;">' +
    '<button type="button" id="rewardSave"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Saving…' : 'Save reward') + '</button> ' +
    '<button type="button" id="rewardCancel">Cancel</button>' +
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
    return '<div style="padding:1rem;text-align:center;color:#666;font-size:.82rem;">' +
      (_rewardsState.busy ? 'Loading rules…' : 'Press Refresh to load the earning rules.') + '</div>';
  }
  ids.sort(function (a, b) {
    return String((rows[a] && rows[a].name) || a).localeCompare(String((rows[b] && rows[b].name) || b));
  });
  var body = ids.length ? ids.map(function (ruleId) {
    var row = rows[ruleId] || {}, off = row.enabled === false;
    return '<tr style="border-bottom:1px solid #eee;' + (off ? 'opacity:.55;' : '') + '">' +
      '<td style="padding:.4rem .3rem;"><strong>' + rewardsEscape(row.name || ruleId) + '</strong>' +
      '<div style="font-size:.72rem;color:#777;">id: ' + rewardsEscape(ruleId) + (row.system ? ' · built-in' : '') + (off ? ' · disabled' : '') + '</div></td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;">' + rewardsEscape(rewardsTriggerLabel(row.trigger)) +
      '<div style="font-size:.72rem;color:#777;">' + rewardsEscape(rewardsConditionSummary(row)) + '</div></td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;white-space:nowrap;">' +
      rewardsEscape(rewardsCurrencyLabel(row.currency)) + ' × ' + (Number(row.qty) || 0) + '</td>' +
      '<td style="padding:.4rem .3rem;font-size:.8rem;">' + rewardsEscape(rewardsScheduleSummary(row)) + '</td>' +
      '<td style="padding:.4rem .3rem;text-align:right;white-space:nowrap;">' +
      '<button type="button" data-ruleedit="' + rewardsEscape(ruleId) + '">Edit</button>' +
      '</td></tr>';
  }).join('') : '<tr><td colspan="5" style="padding:.6rem;color:#666;">No earning rules configured yet.</td></tr>';

  return '<table style="width:100%;border-collapse:collapse;font-size:.82rem;">' +
    '<thead><tr style="text-align:left;border-bottom:2px solid #eee;color:#666;font-size:.74rem;">' +
    '<th style="padding:.4rem .3rem;">Rule</th><th style="padding:.4rem .3rem;">When</th>' +
    '<th style="padding:.4rem .3rem;">Awards</th><th style="padding:.4rem .3rem;">Schedule</th><th></th>' +
    '</tr></thead><tbody>' + body + '</tbody></table>' +
    '<div style="margin-top:.9rem;">' + rewardsRulesFormHtml() + '</div>';
}

function rewardsRulesFormHtml() {
  var editing = _rewardsState.rulesEditing;
  if (!editing) {
    return '<button type="button" id="ruleAdd"' + (_rewardsState.busy ? ' disabled' : '') + '>Add a rule</button>';
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
    conditionField = '<label style="font-size:.76rem;">Minimum net amount (₱)<input id="ruleMinNet" value="' + rewardsEscape(editing.minNetAmount == null ? '' : editing.minNetAmount) + '" placeholder="500" style="display:block;width:130px;"></label>';
  } else if (editing.trigger === 'order_count') {
    conditionField = '<label style="font-size:.76rem;">Every N orders<input id="ruleEvery" value="' + rewardsEscape(editing.every == null ? '' : editing.every) + '" placeholder="5" style="display:block;width:110px;"></label>';
  }

  return '<div style="border:1px solid #e3e3e3;border-radius:10px;padding:.8rem;background:#fafafa;">' +
    '<div style="font-size:.8rem;font-weight:600;margin-bottom:.5rem;">' + (isNew ? 'Add an earning rule' : 'Edit ' + rewardsEscape(editing.name || editing.ruleId)) + '</div>' +
    '<div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;">' +
    '<label style="font-size:.76rem;">Name<input id="ruleName" value="' + rewardsEscape(editing.name || '') + '" placeholder="e.g. Yellow stamp · net over ₱500" style="display:block;width:210px;"></label>' +
    '<label style="font-size:.76rem;">When<select id="ruleTrigger" style="display:block;width:190px;">' + triggerOptions + '</select></label>' +
    '<label style="font-size:.76rem;">Award<select id="ruleCurrency" style="display:block;width:130px;">' + currencyOptions + '</select></label>' +
    '<label style="font-size:.76rem;">Stamps<input id="ruleQty" value="' + rewardsEscape(editing.qty == null ? '' : editing.qty) + '" placeholder="1" style="display:block;width:80px;"></label>' +
    conditionField +
    '</div>' +
    '<div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;margin-top:.5rem;">' +
    '<label style="font-size:.76rem;">Starts (optional)<input id="ruleStart" type="datetime-local" value="' + rewardsEscape(rewardsToDatetimeLocal(editing.startAt)) + '" style="display:block;width:190px;"></label>' +
    '<label style="font-size:.76rem;">Ends (optional)<input id="ruleEnd" type="datetime-local" value="' + rewardsEscape(rewardsToDatetimeLocal(editing.endAt)) + '" style="display:block;width:190px;"></label>' +
    '<label style="font-size:.78rem;"><input type="checkbox" id="ruleEnabled"' + (editing.enabled !== false ? ' checked' : '') + '> Enabled</label>' +
    '</div>' +
    (editing.trigger === 'amount_threshold'
      ? '<div style="font-size:.72rem;color:#8a6d3b;margin-top:.5rem;">Amount rules are a ladder, not a stack: when an order crosses several amounts for the same stamp, only the highest one fires. Enter each tier as its own rule.</div>'
      : '') +
    '<div style="margin-top:.7rem;">' +
    '<button type="button" id="ruleSave"' + (_rewardsState.busy ? ' disabled' : '') + '>' + (_rewardsState.busy ? 'Saving…' : 'Save rule') + '</button> ' +
    '<button type="button" id="ruleCancel">Cancel</button>' +
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
// ---------------------------------------------------------------------------
// Rewards · module registration. The loader calls this handler whenever the
// rewards tab opens. The screen loads on demand and never subscribes - every
// refresh is an explicit callable round-trip.
// ---------------------------------------------------------------------------
window.__accazaRegisterModule('rewards', function () { renderRewards(); });
