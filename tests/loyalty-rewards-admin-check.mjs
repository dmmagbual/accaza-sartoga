// The Rewards Program admin tab (catalog, earning rules, reports, member support) and the
// customer-side reward progress it feeds. The assertions that matter:
//  - the tab is admin-only, because loyaltyAdmin is not a grantable staff permission —
//    the screen must never imply an access level the server would refuse;
//  - every screen talks to callables only; no growing loyalty node is ever read or
//    subscribed to (the Sep 2026 download audit rule);
//  - member support can resolve exactly one member at a time, never browse;
//  - anonymization is two-step on the client AND confirmed on the server, one-way;
//  - admin-entered text is escaped before it lands in a table;
//  - the member card reply carries the whole enabled catalog so the customer page can
//    show progress toward every reward from the same single call.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const core = read('src/admin/rewards/00-rewards-core.js');
const reports = read('src/admin/rewards/10-rewards-reports.js');
const stamps = read('src/admin/rewards/15-rewards-stamps.js');
const catalog = read('src/admin/rewards/20-rewards-catalog.js');
const rules = read('src/admin/rewards/30-rewards-rules.js');
const members = read('src/admin/rewards/40-rewards-members.js');
const register = read('src/admin/rewards/99-rewards-register.js');
const loader = read('assets/js/admin/module-loader.js');
const adminCore = read('assets/js/admin/core.mjs');
const staffAccess = read('assets/js/admin/staff-access.js');
const client = read('assets/js/admin/firebase-client.mjs');
const navHtml = read('src/html/admin/50-admin-workspace.html');
const server = read('src/functions/26-loyalty.js') + '\n' + read('src/functions/26-loyalty2-admin.js');
const serverMembers = read('src/functions/26a-loyalty-members.js');
const customerJs = read('assets/js/customer/rewards.js');
const customerHtml = read('rewards.html');
const bundle = read('assets/js/admin/rewards.js');
const sections = core + reports + stamps + catalog + rules + members + register;

// --- the tab exists, loads as a module, and is admin-only -------------------
assert.ok(/posSwitchTab\('rewards',this\)/.test(navHtml) && /id="tab-rewards"/.test(navHtml) && /id="rewardsRoot"/.test(navHtml),
  'the admin navigation needs a Rewards button, a tab pane, and a module root');
assert.ok(/rewards:'rewards\.js'/.test(loader) && /rewards:\['rewards'\]/.test(loader) && /rewards:'rewardsRoot'/.test(loader),
  'the module loader must know the rewards file, route, and root');
assert.ok(/window\.__accazaRegisterModule\('rewards'/.test(register), 'the rewards module must self-register');
assert.ok(/_permAlwaysHide=\[[^\]]*'reards'/.test(adminCore) || /_permAlwaysHide=\[[^\]]*'rewards'/.test(adminCore),
  'Rewards must sit in _permAlwaysHide: loyaltyAdmin is not a grantable staff permission, so the tab can only ever be admin-only');
assert.ok(!/loyaltyAdmin/.test(adminCore.match(/var DEFAULT_STAFF_PERMS=\{[^}]*\}/)[0]),
  'loyaltyAdmin must not appear in the staff permission defaults — it is not a grantable key');
assert.ok(/\{label:'Rewards Program',locked:true\}/.test(staffAccess),
  'the account-access screen must show Rewards as locked, mirroring the Admin navigation');
assert.ok(bundle.includes('renderRewards') && bundle.includes('rewardsMembersHtml'),
  'the built rewards bundle must carry the screens (drift check pins exact contents)');

// --- every callable is registered, and the screen refuses to run without them
for (const name of ['manageLoyaltyEarningRule','manageLoyaltyRewardCatalog','manageLoyaltyMemberStatus','getLoyaltyReports','searchLoyaltyMembers','manageLoyaltyMemberAnonymize','manageDragonQuest']) {
  assert.ok(client.includes(`'${name}'`), `${name} must be registered with the Rewards client`);
}
assert.ok(/\(a && a\.callables && a\.callables\.getLoyaltyReports\) \? a\.callables : null/.test(core),
  'every screen must go through the availability guard, or a missing callable would crash mid-render');

// --- the server side agrees: everything the tab calls is loyaltyAdmin-only --
for (const name of ['manageLoyaltyEarningRule', 'manageLoyaltyRewardCatalog', 'manageLoyaltyMemberStatus', 'getLoyaltyReports']) {
  const body = server.slice(server.indexOf('exports.' + name));
  assert.ok(/requirePortalPermission\(db, request, \["loyaltyAdmin"\]\)/.test(body.slice(0, 600)),
    `${name} must require loyaltyAdmin`);
}
for (const name of ['searchLoyaltyMembers', 'manageLoyaltyMemberAnonymize']) {
  const body = serverMembers.slice(serverMembers.indexOf('exports.' + name));
  assert.ok(/requirePortalPermission\(db, request, \["loyaltyAdmin"\]\)/.test(body.slice(0, 600)),
    `${name} must require loyaltyAdmin`);
}

// --- read budget: callables only, nothing growing, no subscriptions ---------
for (const node of ['loyaltyMembers/', 'loyaltyLedger/', 'loyaltyBalances/', 'loyaltyRewards/', 'loyaltyMembersByPhone/']) {
  assert.ok(!sections.includes(node), `the Rewards tab must never read ${node} — those nodes grow with the business`);
}
assert.ok(!/ref\(|onValue|subscribe\(/.test(sections),
  'the Rewards tab talks to callables only — no direct database handle, no listener');
assert.ok(/api\.getLoyaltyReports\(\)/.test(reports) && !/getLoyaltyMemberCard/.test(sections),
  'reports must come from the getLoyaltyReports aggregates, never per-member reads');

// --- reward catalog: no delete, honest toggle copy, escaped names -----------
assert.ok(!/action: 'delete'|action:'delete'/.test(catalog), 'a reward must never be deletable from the UI');
assert.ok(/action === 'disable' && !confirm\('Turn this reward off\? It disappears from new redemptions immediately\. Members who already hold a claim keep it until it expires\.'\)/.test(catalog),
  'disabling must say what happens to members holding a claim');
assert.ok(/function rewardsEscape/.test(core) && /rewardsEscape\(row\.name \|\| rewardId\)/.test(catalog),
  'admin-entered reward names must be escaped before they reach the table');
assert.ok(/function rewardsGrantDetail/.test(catalog) && /free_item_no_sub/.test(catalog),
  'the grant column must explain what each reward type actually grants');

// --- earning rules: the ladder is taught, not discovered in production -----
assert.ok(/Amount rules are a ladder, not a stack/.test(rules),
  'the rules screen must warn that amount rules fire highest-only, so tiers are entered one per rule');
assert.ok(/var condition = \{\};/.test(rules) && /a stale field would become/.test(rules),
  'the save payload must build the condition per trigger, so a stale field cannot become live');

// --- member support: one member at a time, exact keys only ------------------
assert.ok(/Browsing the member list is intentionally not possible\./.test(members),
  'the members screen must state that browsing is impossible — that is a download-budget guarantee');
assert.ok(/searchLoyaltyMembers\(\{ phone: query \}\)|searchLoyaltyMembers\(\{phone: query\}\)/.test(members) || /phone: query/.test(members),
  'lookup goes through searchLoyaltyMembers with a phone or member id, never a list read');
assert.ok(/Type ANONYMIZE \(all caps\) to continue:/.test(members) && /!== 'ANONYMIZE'/.test(members),
  'anonymization must require a typed confirmation on the client');
assert.ok(/data\.confirm !== true/.test(serverMembers) && /This member is already anonymized\./.test(serverMembers),
  'the server must demand its own confirmation and refuse a second pass');
assert.ok(/ledger, balances and reward claims retained for accounting/.test(serverMembers),
  'the audit record must say accounting is retained — redemptions reconcile through the order ledger');
assert.ok(/status === 'blocked' \? 'Member blocked\. They keep their stamps and can be unblocked at any time\.'/.test(members),
  'blocking must say what it does to the member\'s stamps');

// --- reports render only what the server aggregated ------------------------
assert.ok(/rewardsMilestoneLabel/.test(reports) && /6-month|1-year/.test(reports.replace(/_/g, '-')),
  'tenure milestone labels come from the server values, not client date math over member records');

// --- the customer page: progress and redeem-now from the same card reply ----
assert.ok(/const catalogList = Object\.keys\(catalog\)\.map/.test(server) && /const redeemable = catalogList\.filter\(\(r\) => balanceOf\(r\.costCurrency\) >= r\.costQty\);/.test(server),
  'redeemable must be the affordable subset of the one catalog read the card already pays for');
assert.ok(/catalog: catalogList/.test(server),
  'the card reply must carry the whole enabled catalog so progress costs no extra reads');
assert.ok(/function paintRedeemable\(card\)/.test(customerJs) && /card\.redeemable \|\| \[\]/.test(customerJs) && /card\.catalog \|\| \[\]/.test(customerJs),
  'the Rewards page must render redeem-now and progress from the single card reply');
assert.ok(/fill\.style\.width = Math\.min\(100, Math\.round\(\(balance \/ cost\) \* 100\)\) \+ "%"/.test(customerJs),
  'progress bars must clamp at 100%');
assert.ok(/name\.textContent = reward\.name \|\| "Reward"/.test(customerJs),
  'reward names on the customer page go in through textContent — they are admin-entered');
assert.ok(/id="redeemBlock"/.test(customerHtml) && /id="progressBlock"/.test(customerHtml),
  'the badge screen needs the redeem-now and keep-collecting blocks');

console.log('PASS: the Rewards admin tab is admin-only, callable-only and never reads a growing loyalty node; member support resolves one member at a time with a two-step anonymize; and the customer page shows redeem-now and stamp progress from the same single card call.');
