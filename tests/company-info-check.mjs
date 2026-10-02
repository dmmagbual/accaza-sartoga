// Settings restructure: a dedicated TAX COMPLIANCE tab plus a COMPANY INFORMATION
// tab, so the BIR tax card leaves POS Settings and the registered business facts
// (TIN, branch code, structure) get one single home. The owner asked for both tabs;
// TIN/branch/structure move out of the tax card and live in Company Information,
// and tax activation is refused until that record is complete — the server stamps
// the facts into taxSettings at activation so receipts and online orders keep
// printing exactly as they do today.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const workspace = read('../src/html/admin/50-admin-workspace.html');
const loader = read('../assets/js/admin/module-loader.js');
const core = read('../assets/js/admin/core.mjs');
const staffAccess = read('../assets/js/admin/staff-access.js');
const bootstrap = read('../src/admin/register/00-bootstrap-payment-controls.js');
const posSettings = read('../src/admin/register/70-settings-staff.js');
const taxCompliance = read('../src/admin/register/72-tax-compliance.js');
const companyInfo = read('../src/admin/register/71-company-info.js');
const companyCf = read('../src/functions/20e-company-info.js');
const taxCf = read('../src/functions/20c-tax-settings.js');
const rules = read('../database.rules.json');
const pkg = JSON.parse(read('../package.json'));

// --- 1. Navigation: both tabs sit in Settings, above POS Settings ------------
const settingsRow = (workspace.match(/<div class="tabgrp" data-grp="settings"[\s\S]*?<\/div>/) || [])[0] || '';
const settingsTabs = [...settingsRow.matchAll(/(?:posSwitchTab|switchTab|showAdminSection)\('([a-zA-Z]+)'/g)].map((m) => m[1]);
assert.deepEqual(settingsTabs, ['companyinfo', 'taxcompliance', 'possettings', 'accountingperiods', 'channelpricing', 'dedupe', 'payment', 'staffaccounts', 'changepw'],
  'Settings must lead with Company Information and Tax Compliance, then the existing tabs in order');
assert.ok(workspace.includes('id="tab-companyinfo"') && workspace.includes('id="companyInfoRoot"'), 'Company Information needs its own tab panel and root');
assert.ok(workspace.includes('id="tab-taxcompliance"') && workspace.includes('id="taxComplianceRoot"'), 'Tax Compliance needs its own tab panel and root');

// --- 2. Lazy loading and staff hiding --------------------------------------
assert.ok(/companyinfo:\['pos','register'\]/.test(loader) && /taxcompliance:\['pos','register'\]/.test(loader), 'Both new tabs must lazy-load the register bundle like POS Settings');
assert.ok(/companyinfo:'companyInfoRoot'/.test(loader) && /taxcompliance:'taxComplianceRoot'/.test(loader), 'Both new tabs must declare their render roots');
const alwaysHide = (core.match(/var _permAlwaysHide=(\[[^\]]*\]);/) || [])[1] || '';
assert.ok(alwaysHide.includes("'companyinfo'") && alwaysHide.includes("'taxcompliance'"), 'Company Information and Tax Compliance must stay owner-only — never grantable to staff');
assert.ok(/label:'Company Information',locked:true/.test(staffAccess) && /label:'Tax Compliance',locked:true/.test(staffAccess), 'The staff account screen must show both new tabs as locked rows');

// --- 3. Module wiring -------------------------------------------------------
assert.ok(/if\(name==='companyinfo'\)\{renderCompanyInfo\(\);\}/.test(bootstrap), 'The register module must render Company Information');
assert.ok(/if\(name==='taxcompliance'\)\{renderTaxCompliance\(\);\}/.test(bootstrap), 'The register module must render Tax Compliance');

// --- 4. POS Settings gives up the tax card ---------------------------------
assert.ok(!posSettings.includes('wireTaxCard') && !posSettings.includes('taxCardBox') && !posSettings.includes('TAX_REQ_META'),
  'The BIR tax card must leave POS Settings completely');

// --- 5. Tax Compliance tab: the tax card + the 1905 reminder on turn-off ----
assert.ok(taxCompliance.includes('function renderTaxCompliance()'), 'The Tax Compliance tab must have its own renderer');
assert.ok(taxCompliance.includes('function wireTaxCard()') && taxCompliance.includes('TAX_REQ_META') && taxCompliance.includes('taxCardBox'),
  'The BIR tax card moves here unchanged in substance');
assert.ok(/1905/.test(taxCompliance.split('id="taxOff"')[1] || ''), 'Turning tax OFF must remind the owner to file BIR Form 1905 so the RDO registration stays truthful');
assert.ok(taxCompliance.includes('payload={mode:mode,inclusive:inc,requirements:state.ticks}'),
  'Saving tax settings must no longer send TIN/branch/structure — those live in Company Information');

// --- 6. Company Information tab --------------------------------------------
assert.ok(companyInfo.includes('function renderCompanyInfo()'), 'The Company Information tab must have its own renderer');
assert.ok(companyInfo.includes("ref(a.db,'companyInfo')"), 'The tab must load the stored company record');
for (const marker of ['Registered business name', 'Trade name', 'Registered address', 'BIR TIN', 'Branch code', 'Business structure', 'RDO', 'Form 2303', 'VAT registration date'])
  assert.ok(companyInfo.includes(marker), `Company Information must collect: ${marker}`);
assert.ok(companyInfo.includes("sole") && companyInfo.includes("opc") && companyInfo.includes("corporation"), 'Structure choices: sole proprietorship, OPC, corporation');
assert.ok(companyInfo.includes('__accazaAuthz') && companyInfo.includes('setCompanyInfo'), 'Only the owner saves, through the setCompanyInfo callable');

// --- 7. setCompanyInfo Cloud Function: owner-only, validated, audited -------
assert.ok(companyCf.includes('exports.setCompanyInfo = onCall'), 'setCompanyInfo must exist');
assert.ok(companyCf.includes('["owner", "superadmin"].includes(actor.role)'), 'only the owner can change company information');
assert.ok(companyCf.includes('action: "set_company_info"'), 'every company-info change must be audited');
assert.ok(companyCf.includes('TIN must be 9 digits'), 'a malformed TIN must be refused');
assert.ok(companyCf.includes('schemaVersion: 1'), 'the stored record carries a schema version');

// --- 8. Tax activation stamps the company facts -----------------------------
assert.ok(taxCf.includes('db.ref("/companyInfo")'), 'setTaxSettings must read the single company record');
assert.ok(taxCf.includes('Enter your BIR TIN and branch code before activating a tax category.'),
  'activation without the company TIN must be refused');
assert.ok(taxCf.includes('Company Information'), 'the refusal must point the owner at the Company Information tab');
assert.ok(taxCf.includes('taxTin(company.tin)'), 'the TIN is validated and stamped from the company record');
assert.ok(taxCf.includes('taxBranchCode(company.branchCode)'), 'the branch code is stamped from the company record');
assert.ok(taxCf.includes('TAX_STRUCTURES.includes(company.structure)'), 'the business structure is stamped from the company record');

// --- 9. Database rules: companyInfo stays admin-only ------------------------
const companyRule = (rules.split('\n').find((l) => l.trim().startsWith('"companyInfo"')) || '');
assert.ok(companyRule.includes('".read": "auth != null && root.child(\'admins\').child(auth.uid).exists()"') && companyRule.includes('".write": false'),
  'companyInfo must be admin-readable and server-written only — never public, unlike the TIN-free publicTaxInfo mirror');

// --- 10. Test wiring ---------------------------------------------------------
assert.ok(pkg.scripts['test:company-info'] === 'node tests/company-info-check.mjs', 'the check must run as test:company-info');
assert.ok((pkg.scripts.test || '').includes('npm run test:company-info'), 'the main test chain must include the company-info check');

console.log('PASS: Settings restructure — Company Information and Tax Compliance tabs, owner-only, TIN/branch/structure single-homed in companyInfo and stamped into taxSettings at activation, rules-locked, audited.');
