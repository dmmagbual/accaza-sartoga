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
    _rewardsState.currenciesAttempted = false;
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
    _rewardsState.currenciesAttempted = false;
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
    _rewardsState.currenciesAttempted = false;
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
