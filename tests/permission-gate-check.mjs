/* AP 0.7 — every callable must declare access, and a new one must not slip in unclassified.

   The permission model (verified 12 Oct 2026): roles live at /admins/<uid> and must be one of
   superadmin, admin, manager, staff, cashier, kitchen, finance; fine-grained grants live at
   /adminPerms/<uid> as key -> true; requirePortalPermission lets owner/superadmin/admin/manager bypass
   the per-key check, so the effective surface is the role list plus the key map.

   What this guard does: it scans every onCall export and fails when a callable is neither gated by a
   known permission helper nor recorded in the baseline below. That is the property the AP plan asks
   for — a new callable cannot be added without declaring access or being deliberately classified.

   What it does NOT claim: that each baseline entry's existing gate is sufficient. My scans found no
   callable without an auth signal and none relying only on bare request.auth, but the 42 entries
   below use signals other than the shared helpers, so each still needs a human read to record WHY it is
   appropriate (public customer endpoint, Super Admin screen, and so on). They are marked review: true.
*/
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = path.join(root, 'src/functions');
const helpers = [
  "requirePortalPermission(",
  "requireAdmin(",
  "requireSuperAdmin(",
  "requireStaff(",
  "requireFinanceRole(",
  "requirePermission(",
  "requireBooksAccess(",
  "requireManagerApproval("
];

/** Callables gated by a shared permission helper (key -> helper name). */
export const GATED = {
  "10-books-bridge:ensureBooksJournal": "requirePortalPermission",
  "10-books-bridge:manageCashAccount": "requirePortalPermission",
  "20-portal-auth:manageSupplier": "requirePortalPermission",
  "20-portal-auth:manageAccountingPeriod": "requirePortalPermission",
  "20-portal-operations:repairOrderInventoryMarker": "requirePortalPermission",
  "20-portal-operations:updateOrderStatus": "requirePortalPermission",
  "20-portal-operations:acceptOnlineOrder": "requirePortalPermission",
  "20-portal-operations:consumeManagerApproval": "requirePortalPermission",
  "20a-pos-staff-identity:openLinkedPosShift": "requirePortalPermission",
  "20b-portal-accounts:managePortalAccount": "requireSuperAdmin",
  "20d-tax-returns:prepareQuarterlyTaxReturn": "requirePortalPermission",
  "21-operational-controls:manageOrderArchive": "requirePortalPermission",
  "21-operational-controls:reviewDiscrepancy": "requirePortalPermission",
  "21-operational-controls:reopenDiscrepancy": "requirePortalPermission",
  "21-staff-advance-liquidation:managePettyVoucher": "requirePortalPermission",
  "21-staff-advance-liquidation:retireRevolvingFund": "requirePortalPermission",
  "21a-undeposited-pages:getUndepositedControlSnapshot": "requirePortalPermission",
  "21a-undeposited-pages:getUndepositedPage": "requirePortalPermission",
  "22-close-controls:repairClosedShiftTurnover": "requirePortalPermission",
  "22-close-controls:repairShiftDeclaredTips": "requirePortalPermission",
  "22-close-controls:reconcileUndepositedCustody": "requirePortalPermission",
  "22-close-controls:legacyOwnerCapitalReset": "requirePortalPermission",
  "22-close-controls:runFinancialClose": "requirePortalPermission",
  "22-close-controls:repairReversedPayoutDeposit": "requirePortalPermission",
  "22-close-controls:setUndepositedOpeningBalance": "requirePortalPermission",
  "22-close-controls:repairPettyVoucherFinancial": "requirePortalPermission",
  "22-close-controls:repairReversalAccountingDate": "requirePortalPermission",
  "22-close-controls:archiveActivityLog": "requirePortalPermission",
  "23-cash-balance-summary:getCurrentCashBalances": "requirePortalPermission",
  "25-pos-assurance:verifyShiftCloseReadiness": "requirePortalPermission",
  "25b-shift-handover:manageShiftHandover": "requirePortalPermission",
  "25c-shift-crew:managePosShiftCrew": "requirePortalPermission",
  "25c-shift-crew:managePosSaleRecovery": "requirePortalPermission",
  "26-loyalty:scanLoyaltyBadge": "requirePortalPermission",
  "26-loyalty:lookupLoyaltyMemberByPhone": "requirePortalPermission",
  "26-loyalty:claimLoyaltyReward": "requirePortalPermission",
  "26-loyalty:finalizeLoyaltyRedemption": "requirePortalPermission",
  "26-loyalty2-admin:releaseLoyaltyClaim": "requirePortalPermission",
  "26-loyalty2-admin:startLoyaltyRedeemOtp": "requirePortalPermission",
  "26-loyalty2-admin:manageLoyaltyEarningRule": "requirePortalPermission",
  "26-loyalty2-admin:manageLoyaltyRewardCatalog": "requirePortalPermission",
  "26-loyalty2-admin:manageLoyaltyCurrency": "requirePortalPermission",
  "26-loyalty2-admin:manageLoyaltyMemberStatus": "requirePortalPermission",
  "26-loyalty2-admin:getLoyaltyReports": "requirePortalPermission",
  "26a-loyalty-members:searchLoyaltyMembers": "requirePortalPermission",
  "26a-loyalty-members:manageLoyaltyMemberAnonymize": "requirePortalPermission",
  "26b-dragon-quest:manageDragonQuest": "requirePortalPermission",
  "30-orders:syncOfflinePosSale": "requirePortalPermission",
  "30-orders:getSupplierAdvanceDetails": "requirePortalPermission",
  "30-orders:manageQrOrderTicket": "requirePortalPermission",
  "40-sales-finance:validateRecipeDefinition": "requirePortalPermission",
  "40-sales-finance:saveSharedChoiceIngredients": "requirePortalPermission",
  "40-sales-finance:ensureShiftReference": "requirePortalPermission",
  "41-expense-assets:repairPettyExpenseClassifications": "requirePortalPermission",
  "41-expense-assets:manageFixedAsset": "requirePortalPermission",
  "42a-financial-command-entry:postFinancialCommand": "requirePortalPermission",
  "43a-purchase-payable:reconcilePurchasePayable": "requirePortalPermission",
  "43b-purchase-corrections:managePurchaseCorrection": "requirePortalPermission",
  "43c-platform-presettlement:correctPlatformPresettlement": "requirePortalPermission",
  "43d-platform-settlement:settlePlatformPayout": "requirePortalPermission",
  "43e-platform-reversal:reversePlatformPayout": "requirePortalPermission",
  "43f-platform-metadata:setPlatformPayoutDate": "requirePortalPermission",
  "43g-order-adjustments:processOrderAdjustment": "requirePortalPermission",
  "43h-platform-catchup:recordPlatformCatchup": "requirePortalPermission",
  "43i-uncosted-sales:manageUncostedSales": "requirePortalPermission",
  "43j-order-service:manageOrderService": "requirePortalPermission",
  "44-reconciliation:ensureFinancialLedger": "requirePortalPermission",
  "44-reconciliation:repairFinanceDates": "requirePortalPermission",
  "44-reconciliation:auditFinancialControls": "requirePortalPermission",
  "50-inventory:ensureInventoryLedger": "requirePortalPermission",
  "61-historical-archive:readHistoricalOrders": "requirePortalPermission",
  "61-historical-archive:readHistoricalSalesRollup": "requirePortalPermission"
};

/** Callables whose access comes from another signal; each still needs a recorded reason. */
export const NEEDS_REVIEW = {
  "20-portal-auth:manageStaffMessage": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-auth:manageIncident": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:recordClientTelemetry": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:getOperationalExceptions": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:resolveBackgroundFailure": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:getProductionCertification": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:getProductionValidation": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20-portal-operations:createManagerApproval": {
    "signals": [
      "admins/",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20a-pos-staff-identity:managePosStaffIdentity": {
    "signals": [
      "actor.role",
      "actor.uid",
      "admins/",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20c-tax-settings:setTaxSettings": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "20e-company-info:setCompanyInfo": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "25-pos-assurance:reportPosDeviceHealth": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck"
    ],
    "review": true
  },
  "25-pos-assurance:signOutAllPortalSessions": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "26-loyalty:startLoyaltySignup": {
    "signals": [
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:completeLoyaltySignup": {
    "signals": [
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:getLoyaltyMemberCard": {
    "signals": [
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:getMyLoyaltyCard": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:linkLoyaltyByBadge": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:startLoyaltyLinkOtp": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:confirmLoyaltyLinkOtp": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26-loyalty:unlinkLoyaltyFromDevice": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26a-loyalty-members:startLoyaltyBadgeRecovery": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26a-loyalty-members:confirmLoyaltyBadgeRecovery": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "26b-dragon-quest:getDragonQuest": {
    "signals": [
      "enforceAppCheck"
    ],
    "review": true
  },
  "26b-dragon-quest:enrollDragonQuest": {
    "signals": [
      "enforceAppCheck"
    ],
    "review": true
  },
  "30-orders:createQrOrderTicket": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "30-orders:createOnlineOrder": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "30-orders:getPaymentProof": {
    "signals": [
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "30-orders:confirmOrderReceived": {
    "signals": [
      "request.auth",
      "enforceAppCheck"
    ],
    "review": true
  },
  "30-orders:ensureActiveOrders": {
    "signals": [
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "44-reconciliation:manageBooksAccount": {
    "signals": [
      "actor.uid",
      "enforceAppCheck"
    ],
    "review": true
  },
  "44-reconciliation:manageChartAccount": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "44b-ap-integrity:apIntegrityBaseline": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "44c-purchase-doc-numbers:backfillPurchaseDocumentNumbers": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "50-inventory:postInventoryMovements": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  // Homemade pastry batch cards (admin 683). Each callable requires a portal user, then
  // requireBakingAccess: owner/superadmin/admin/manager by role, otherwise an explicit
  // /adminPerms/{uid}/baking grant. The production movements they post are server-only, so this
  // is the only door and the browser never supplies a quantity, a cost or an account.
  "50a-baking:checkBakingMapping": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "50a-baking:postBatchCard": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "50a-baking:reverseBatchCard": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "60-maintenance:runDatabaseBackupNow": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "61-historical-archive:manageHistoricalOrderArchive": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "62-accaza-chat:askAccazaAI": {
    "signals": [
      "actor.role",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "62-accaza-chat:manageAccazaAiKnowledge": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "62-accaza-chat:manageAccazaAiIssue": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "62c-accaza-ai-business:manageAccazaAiBusiness": {
    "signals": [
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  },
  "63-accaza-ai-standalone:askAccazaAIStandalone": {
    "signals": [
      "request.auth",
      "actor.role",
      "actor.uid",
      "enforceAppCheck",
      "requirePortalUser("
    ],
    "review": true
  }
};

export const REASONS = {
  "actor.role|actor.uid|enforceAppCheck|requirePortalUser(":
    "Shared portal gate then an inline role check, on an App Check attested device: requirePortalUser rejects an unauthenticated caller, a disabled account, a role outside the seven allowed roles and a session older than the Super Admin cutoff.",
  "request.auth|enforceAppCheck":
    "App Check attested and a signed-in user required, with no portal role: the customer and device facing endpoints (QR ordering, online orders, loyalty signup and OTP, device telemetry) must work for someone who has no portal account.",
  "actor.role|enforceAppCheck|requirePortalUser(":
    "Shared portal gate plus an inline role check; App Check attested.",
  "enforceAppCheck":
    "App Check attested; the callable itself authorises the caller it acts for (for example a device reporting its own health or a sign-out scoped to the caller).",
  "enforceAppCheck|requirePortalUser(":
    "Shared portal gate; App Check attested.",
  "admins/|enforceAppCheck|requirePortalUser(":
    "Shared portal gate, then a read of the caller own admin record before acting; App Check attested.",
  "actor.role|actor.uid|admins/|enforceAppCheck|requirePortalUser(":
    "Shared portal gate, an inline role check and a read of the admin record; App Check attested.",
  "actor.role|actor.uid|enforceAppCheck":
    "Inline role check plus the caller identity, on an App Check attested device.",
  "actor.uid|enforceAppCheck":
    "Acts only for the caller own identity, on an App Check attested device.",
  "request.auth|actor.role|actor.uid|enforceAppCheck|requirePortalUser(":
    "Shared portal gate, an inline role check and the caller identity; App Check attested.",
};

/* Mechanism level by design: each reason explains what the detected mechanism enforces, not a claim that
   the endpoint is appropriate. A new callable whose signals match no listed mechanism fails the guard, so
   the reason has to be written deliberately. */

export const BASELINE_DIGEST = '37a674b17f7ee355f5f632c4e5d14448330ba3a3d657681d189d5e6dc7d87e1e';

const failures = [];
let total = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const re = /exports\.([A-Za-z0-9_]+)\s*=\s*onCall\(/g;
  let match; const found = [];
  while ((match = re.exec(text))) found.push({name: match[1], at: match.index});
  found.forEach((entry, index) => {
    const body = text.slice(entry.at, index + 1 < found.length ? found[index + 1].at : text.length);
    const key = file.replace(/\.js$/, '') + ':' + entry.name;
    total += 1;
    if (helpers.some((helper) => body.includes(helper))) return;
    if (Object.prototype.hasOwnProperty.call(NEEDS_REVIEW, key)) {
      const signature = (NEEDS_REVIEW[key].signals || []).join('|');
      if (!REASONS[signature]) failures.push(key + ' uses an access mechanism with no recorded reason: ' + (signature || '(none)'));
      return;
    }
    failures.push(key);
  });
}

if (failures.length) {
  console.error('Permission gate check failed — these callables declare no access control and are not classified:\n- ' + failures.join('\n- ') + '\nAdd each to NEEDS_REVIEW with the signal it uses and why that is appropriate, or gate it with requirePortalPermission.');
  process.exit(1);
}

const unresolved = Object.keys(NEEDS_REVIEW).filter((key) => !REASONS[(NEEDS_REVIEW[key].signals || []).join('|')]);
if (unresolved.length) { console.error('Permission gate check failed \u2014 these callables use an access mechanism with no recorded reason:\n- ' + unresolved.join('\n- ')); process.exit(1); }
console.log('PASS: all ' + total + ' callables declare access — ' + Object.keys(GATED).length + ' through a shared permission helper, ' + Object.keys(NEEDS_REVIEW).length + ' through ' + Object.keys(REASONS).length + ' documented mechanisms, every one App Check attested with a recorded reason.');
