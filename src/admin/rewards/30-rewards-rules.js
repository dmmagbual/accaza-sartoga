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
