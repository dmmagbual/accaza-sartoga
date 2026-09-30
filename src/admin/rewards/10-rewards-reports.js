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
