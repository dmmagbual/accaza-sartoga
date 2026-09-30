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
