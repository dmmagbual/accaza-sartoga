// ---------------------------------------------------------------------------
// Rewards stamps (loyalty currencies) - admin card inside POS Settings.
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
var _loyaltyStampsState = {rows: {}, colors: [], loaded: false, busy: false, note: '', noteBad: false, editing: null};

function loyaltyStampsCard() {
  var settings = document.getElementById('posSettingsRoot'); if (!settings) return null;
  var card = document.getElementById('loyaltyStampsRoot');
  if (!card) { card = document.createElement('div'); card.id = 'loyaltyStampsRoot'; card.style.marginTop = '1.4rem'; settings.appendChild(card); }
  return card;
}

function loyaltyStampsApi() { var a = A(); return (a && a.callables && a.callables.manageLoyaltyCurrency) ? a.callables : null; }

function loyaltyStampCapLabel(row) {
  var cap = (row && row.dailyCap != null && row.dailyCap !== '') ? Number(row.dailyCap) : null;
  return (cap && cap > 0) ? (cap + ' per day') : 'No daily limit';
}

function loyaltyStampsRowsHtml() {
  var rows = _loyaltyStampsState.rows, codes = Object.keys(rows);
  if (!codes.length) return '<tr><td colspan="4" style="padding:.6rem;color:#666;">No stamps configured yet.</td></tr>';
  codes.sort(function (a, b) { return (Number(rows[a].order) || 99) - (Number(rows[b].order) || 99) || a.localeCompare(b); });
  return codes.map(function (code) {
    var row = rows[code] || {}, off = row.enabled === false;
    var swatch = '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;margin-right:.45rem;border:1px solid rgba(0,0,0,.2);background:' + String(row.color || '#ccc') + ';"></span>';
    // Label always accompanies the colour - a stamp is never identified by colour alone.
    return '<tr style="border-top:1px solid #eee;' + (off ? 'opacity:.55;' : '') + '">' +
      '<td style="padding:.5rem .4rem;">' + swatch + '<strong>' + loyaltyStampsEscape(row.label || code) + '</strong>' +
      '<div style="font-size:.72rem;color:#777;">code: ' + loyaltyStampsEscape(code) + (off ? ' &middot; disabled' : '') + '</div></td>' +
      '<td style="padding:.5rem .4rem;font-size:.8rem;">' + loyaltyStampCapLabel(row) + '</td>' +
      '<td style="padding:.5rem .4rem;font-size:.8rem;">' + (Number(row.order) || 99) + '</td>' +
      '<td style="padding:.5rem .4rem;text-align:right;white-space:nowrap;">' +
      '<button type="button" data-stampedit="' + loyaltyStampsEscape(code) + '" style="margin-right:.35rem;">Edit</button>' +
      '<button type="button" data-stamptoggle="' + loyaltyStampsEscape(code) + '">' + (off ? 'Enable' : 'Disable') + '</button>' +
      '</td></tr>';
  }).join('');
}

function loyaltyStampsEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
  });
}

function loyaltyStampsColorPicker(selected) {
  var colors = _loyaltyStampsState.colors || [];
  if (!colors.length) return '<div style="font-size:.78rem;color:#777;">Loading colours…</div>';
  return colors.map(function (color) {
    var on = String(color.hex || '').toLowerCase() === String(selected || '').toLowerCase();
    return '<button type="button" data-stampcolor="' + loyaltyStampsEscape(color.hex) + '" title="' + loyaltyStampsEscape(color.name) + '"' +
      ' style="width:auto;padding:.3rem .5rem;margin:0 .3rem .3rem 0;border-radius:8px;cursor:pointer;' +
      'border:2px solid ' + (on ? '#222' : 'transparent') + ';background:#fff;">' +
      '<span style="display:inline-block;width:13px;height:13px;border-radius:50%;vertical-align:middle;margin-right:.35rem;border:1px solid rgba(0,0,0,.2);background:' + loyaltyStampsEscape(color.hex) + ';"></span>' +
      '<span style="font-size:.74rem;">' + loyaltyStampsEscape(color.name) + (on ? ' ✓' : '') + '</span></button>';
  }).join('');
}

function loyaltyStampsFormHtml() {
  var editing = _loyaltyStampsState.editing;
  if (!editing) return '<button type="button" id="stampAdd">Add a stamp</button>';
  var isNew = editing.isNew === true;
  return '<div style="border:1px solid #e3e3e3;border-radius:10px;padding:.8rem;background:#fafafa;">' +
    '<div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end;">' +
    '<label style="font-size:.76rem;">Code' +
    '<input id="stampCode" value="' + loyaltyStampsEscape(editing.code || '') + '"' + (isNew ? '' : ' disabled') +
    ' placeholder="e.g. green" style="display:block;width:130px;"></label>' +
    '<label style="font-size:.76rem;">Label' +
    '<input id="stampLabel" value="' + loyaltyStampsEscape(editing.label || '') + '" placeholder="e.g. Green stamp" style="display:block;width:180px;"></label>' +
    '<label style="font-size:.76rem;">Daily limit (blank = none)' +
    '<input id="stampCap" value="' + loyaltyStampsEscape(editing.dailyCap == null ? '' : editing.dailyCap) + '" placeholder="none" style="display:block;width:120px;"></label>' +
    '<label style="font-size:.76rem;">Order' +
    '<input id="stampOrder" value="' + loyaltyStampsEscape(editing.order == null ? '' : editing.order) + '" placeholder="99" style="display:block;width:80px;"></label>' +
    '</div>' +
    (isNew ? '<div style="font-size:.72rem;color:#8a6d3b;margin-top:.4rem;">The code is permanent - it names the field that holds members\' stamps, so it can never be renamed later.</div>' : '') +
    '<div style="margin-top:.6rem;font-size:.76rem;">Colour</div>' +
    '<div id="stampColors" style="margin-top:.3rem;">' + loyaltyStampsColorPicker(editing.color) + '</div>' +
    '<div style="margin-top:.7rem;">' +
    '<button type="button" id="stampSave"' + (_loyaltyStampsState.busy ? ' disabled' : '') + '>' + (_loyaltyStampsState.busy ? 'Saving…' : 'Save stamp') + '</button> ' +
    '<button type="button" id="stampCancel">Cancel</button>' +
    '</div></div>';
}

function loyaltyStampsMarkup() {
  var note = _loyaltyStampsState.note;
  return '<div style="border:1px solid #e3e3e3;border-radius:12px;padding:1rem;background:#fff;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem;flex-wrap:wrap;">' +
    '<div><h3 style="margin:0;font-family:\'Playfair Display\',serif;color:var(--bd);">Rewards stamps</h3>' +
    '<p style="font-size:.78rem;color:#666;margin:.25rem 0 0;">The stamp types your program awards. A stamp can be relabelled, recoloured or limited at any time. It can be turned off, but never deleted or renamed - members hold real balances in it.</p></div>' +
    '<button type="button" id="stampRefresh" style="flex:0 0 auto;">Refresh</button></div>' +
    (note ? '<div style="margin-top:.7rem;padding:.5rem .6rem;border-radius:8px;font-size:.78rem;' + (_loyaltyStampsState.noteBad ? 'background:#fde8e8;color:#721c24;' : 'background:#e8f5e9;color:#1b5e20;') + '">' + loyaltyStampsEscape(note) + '</div>' : '') +
    '<table style="width:100%;border-collapse:collapse;margin-top:.8rem;font-size:.84rem;">' +
    '<thead><tr style="text-align:left;color:#666;font-size:.74rem;">' +
    '<th style="padding:.3rem .4rem;">Stamp</th><th style="padding:.3rem .4rem;">Daily limit</th><th style="padding:.3rem .4rem;">Order</th><th></th>' +
    '</tr></thead><tbody>' + loyaltyStampsRowsHtml() + '</tbody></table>' +
    '<div style="margin-top:.9rem;">' + loyaltyStampsFormHtml() + '</div></div>';
}

function renderLoyaltyStamps() {
  var card = loyaltyStampsCard(); if (!card) return;
  if (!loyaltyStampsApi()) {
    card.innerHTML = '<div style="padding:.8rem;border-radius:10px;background:#fde8e8;color:#721c24;font-size:.82rem;">Rewards stamp settings are unavailable right now. Refresh the portal and try again.</div>';
    return;
  }
  card.innerHTML = loyaltyStampsMarkup();
  loyaltyStampsWire(card);
  if (!_loyaltyStampsState.loaded && !_loyaltyStampsState.busy) loyaltyStampsLoad();
}

function loyaltyStampsWire(card) {
  var refresh = card.querySelector('#stampRefresh');
  if (refresh) refresh.onclick = function () { _loyaltyStampsState.loaded = false; _loyaltyStampsState.note = ''; loyaltyStampsLoad(); };
  var add = card.querySelector('#stampAdd');
  if (add) add.onclick = function () {
    var palette = _loyaltyStampsState.colors || [];
    _loyaltyStampsState.editing = {isNew: true, code: '', label: '', color: palette.length ? palette[0].hex : '', dailyCap: '', order: ''};
    _loyaltyStampsState.note = ''; renderLoyaltyStamps();
  };
  var cancel = card.querySelector('#stampCancel');
  if (cancel) cancel.onclick = function () { _loyaltyStampsState.editing = null; renderLoyaltyStamps(); };
  var save = card.querySelector('#stampSave');
  if (save) save.onclick = function () { loyaltyStampsSave(card); };
  card.querySelectorAll('[data-stampcolor]').forEach(function (button) {
    button.onclick = function () {
      if (!_loyaltyStampsState.editing) return;
      _loyaltyStampsState.editing.color = button.getAttribute('data-stampcolor');
      // Keep whatever the operator has already typed while re-rendering the swatches.
      loyaltyStampsCaptureForm(card); renderLoyaltyStamps();
    };
  });
  card.querySelectorAll('[data-stampedit]').forEach(function (button) {
    button.onclick = function () {
      var code = button.getAttribute('data-stampedit'), row = _loyaltyStampsState.rows[code] || {};
      _loyaltyStampsState.editing = {isNew: false, code: code, label: row.label || '', color: row.color || '', dailyCap: row.dailyCap == null ? '' : row.dailyCap, order: row.order == null ? '' : row.order};
      _loyaltyStampsState.note = ''; renderLoyaltyStamps();
    };
  });
  card.querySelectorAll('[data-stamptoggle]').forEach(function (button) {
    button.onclick = function () {
      var code = button.getAttribute('data-stamptoggle'), row = _loyaltyStampsState.rows[code] || {};
      loyaltyStampsToggle(code, row.enabled === false ? 'enable' : 'disable');
    };
  });
}

// Preserve in-progress typing across a re-render (choosing a colour re-renders the form).
function loyaltyStampsCaptureForm(card) {
  var editing = _loyaltyStampsState.editing; if (!editing) return;
  var code = card.querySelector('#stampCode'), label = card.querySelector('#stampLabel');
  var cap = card.querySelector('#stampCap'), order = card.querySelector('#stampOrder');
  if (code && !code.disabled) editing.code = code.value;
  if (label) editing.label = label.value;
  if (cap) editing.dailyCap = cap.value;
  if (order) editing.order = order.value;
}

function loyaltyStampsLoad() {
  var api = loyaltyStampsApi(); if (!api) return;
  _loyaltyStampsState.busy = true;
  api.manageLoyaltyCurrency({action: 'list'}).then(function (result) {
    var payload = (result && result.data) || {};
    _loyaltyStampsState.rows = payload.currencies || {};
    // The palette is whatever the server offers - the screen never invents a colour.
    _loyaltyStampsState.colors = payload.colors || [];
    _loyaltyStampsState.loaded = true;
  }).catch(function (error) {
    _loyaltyStampsState.note = loyaltyStampsMessage(error, 'Could not load the stamp list.');
    _loyaltyStampsState.noteBad = true;
  }).then(function () {
    _loyaltyStampsState.busy = false; renderLoyaltyStamps();
  });
}

function loyaltyStampsSave(card) {
  var api = loyaltyStampsApi(); if (!api || _loyaltyStampsState.busy) return;
  loyaltyStampsCaptureForm(card);
  var editing = _loyaltyStampsState.editing; if (!editing) return;
  var payload = {
    action: 'save',
    code: String(editing.code || '').trim(),
    label: String(editing.label || '').trim(),
    color: editing.color || '',
    dailyCap: String(editing.dailyCap == null ? '' : editing.dailyCap).trim(),
    order: String(editing.order == null ? '' : editing.order).trim(),
  };
  if (!payload.order) delete payload.order;
  _loyaltyStampsState.busy = true; renderLoyaltyStamps();
  api.manageLoyaltyCurrency(payload).then(function (result) {
    var data = (result && result.data) || {};
    _loyaltyStampsState.note = data.created ? ('Added the ' + payload.label + ' stamp.') : ('Saved the ' + payload.label + ' stamp.');
    _loyaltyStampsState.noteBad = false;
    _loyaltyStampsState.editing = null; _loyaltyStampsState.loaded = false;
  }).catch(function (error) {
    // Validation errors come back from the server (palette colour, code shape, cap) and
    // are shown as written - the operator needs the exact reason.
    _loyaltyStampsState.note = loyaltyStampsMessage(error, 'Could not save that stamp.');
    _loyaltyStampsState.noteBad = true;
  }).then(function () {
    _loyaltyStampsState.busy = false;
    if (!_loyaltyStampsState.loaded && !_loyaltyStampsState.noteBad) loyaltyStampsLoad(); else renderLoyaltyStamps();
  });
}

function loyaltyStampsToggle(code, action) {
  var api = loyaltyStampsApi(); if (!api || _loyaltyStampsState.busy) return;
  if (action === 'disable' && !confirm('Turn this stamp off? Members keep the stamps they already hold, and it can be turned back on at any time.')) return;
  _loyaltyStampsState.busy = true; _loyaltyStampsState.note = ''; renderLoyaltyStamps();
  api.manageLoyaltyCurrency({action: action, code: code}).then(function () {
    _loyaltyStampsState.note = action === 'enable' ? 'Stamp turned on.' : 'Stamp turned off. Members keep any stamps they already hold.';
    _loyaltyStampsState.noteBad = false; _loyaltyStampsState.loaded = false;
  }).catch(function (error) {
    // A refusal here is a real safeguard (a live rule still awards it, or a live reward
    // still costs it). Show the server's wording: it names what to turn off first.
    _loyaltyStampsState.note = loyaltyStampsMessage(error, 'Could not change that stamp.');
    _loyaltyStampsState.noteBad = true;
  }).then(function () {
    _loyaltyStampsState.busy = false;
    if (!_loyaltyStampsState.loaded && !_loyaltyStampsState.noteBad) loyaltyStampsLoad(); else renderLoyaltyStamps();
  });
}

function loyaltyStampsMessage(error, fallback) {
  var message = error && (error.message || (error.details && error.details.message));
  return String(message || fallback);
}
