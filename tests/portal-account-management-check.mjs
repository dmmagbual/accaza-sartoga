import fs from 'node:fs';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const server=read('src/functions/20b-portal-accounts.js');
const auth=read('src/functions/20-portal-auth.js');
const client=read('assets/js/admin/staff-access.js');
const portal=read('assets/js/admin/portal-auth.mjs');
const html=read('src/html/admin/50-admin-workspace.html');
const rules=read('database.rules.json');

for(const marker of ['exports.managePortalAccount','requireSuperAdmin','claimPortalAccountMutation','portalAccountMutationLock','activeSuperAdminCount','assertAccountNotOnOpenShift','normalize_legacy','revokeRefreshTokens','portal_account_disabled','Systems Administrator'])assert.ok(server.includes(marker),`Portal-account server control missing: ${marker}`);
assert.equal((server.match(/financeKey\(data\.uid, "Account"\)/g)||[]).length,4,'Every account mutation must reject path-like Firebase UIDs');
assert.ok(server.includes('Portal account mutation lock cleanup failed'),'A successful account change must not be reported as failed only because lock cleanup needs retrying');
for(const marker of ['Username','Role / position','Access level','Super Admin','On active shift','Reset password','Normalize roles'])assert.ok(client.includes(marker),`Account-access interface missing: ${marker}`);
assert.ok(html.includes("posSwitchTab('staffaccounts'")&&html.includes('User Accounts &amp; Access')&&html.includes('accountAccessRoot'),'Unified account-management tab is missing');
assert.ok(!html.includes('tab-staffaccess')&&!html.includes('tab-adminaccounts'),'Legacy account tabs must stay retired');
assert.ok(!client.includes('passwordHash')&&!client.includes('staffAccounts/')&&!client.includes('adminAccounts/'),'Browser must not create legacy password-hash accounts');
assert.ok(auth.includes('return normalized === "owner" ? "superadmin" : normalized'),'Legacy owner role must canonicalize to Super Admin on the server');
assert.ok(portal.includes("if(r==='owner')r='superadmin'"),'Legacy owner role must canonicalize to Super Admin in the portal');
assert.ok(rules.includes('"adminPerms":           { ".read": "auth != null && root.child(\'admins\').child(auth.uid).exists()", ".write": false }'),'Permission writes must be server-authoritative');
assert.ok(rules.includes('"staffAccounts":        { ".read": false, ".write": false }')&&rules.includes('"adminAccounts":        { ".read": false, ".write": false }'),'Legacy password-account nodes must be closed');
assert.ok(server.includes('Close the active POS shift before normalizing legacy account roles.')&&server.includes('This account belongs to the open POS shift.'),'Open-shift safeguards are incomplete');

console.log('PASS: unified Firebase account management, Super Admin canonicalization, and active-shift safeguards are present.');
