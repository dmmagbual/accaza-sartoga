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
