/* Seeds the Accaza UAT Firebase project with the minimum it needs to sign in and work.
   Synthetic only: nothing is copied from production. Refuses any project but UAT.

   Usage (from the project folder, signed in with `gcloud auth login`):
     node tools/uat/seed-uat.mjs                     create/confirm the UAT owner, role and chart access
     node tools/uat/seed-uat.mjs --reset-password    also set a new password for the UAT owner
   Optional: set UAT_OWNER_PASSWORD to choose the password instead of a generated one.

   What it writes (UAT only):
     - Firebase Auth: email/password sign-in enabled; user uat-owner@accazacoffee.com
     - RTDB admins/{uid} = "superadmin"
     - RTDB config/booksChartManagers/<key> for the UAT owner (Finance Books chart editing)
     - RTDB uatEnvironment marker (synthetic:true)
   Suppliers, stock items and purchases are created through the app itself during the
   UAT run, so their shape always comes from the current code, not from this script.
   The Finance Books chart seeds itself on the first Books sign-in (ensureBooksChart). */
import {execSync} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const UAT_PROJECT = 'accazacoffeepos-uat';
export const UAT_DB = `https://${UAT_PROJECT}-default-rtdb.asia-southeast1.firebasedatabase.app`;
export const UAT_OWNER_EMAIL = 'uat-owner@accazacoffee.com';
export const booksManagerKey = (email) => String(email || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');

export function assertUatTarget(project, dbUrl) {
  if (project !== UAT_PROJECT) throw new Error(`Refusing to seed "${project}": only ${UAT_PROJECT} may be seeded.`);
  if (dbUrl !== UAT_DB) throw new Error(`Refusing to seed database ${dbUrl}: only ${UAT_DB} may be seeded.`);
}

async function call(method, url, token, body) {
  const res = await fetch(url, {method, headers: {Authorization: `Bearer ${token}`, 'x-goog-user-project': UAT_PROJECT, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.split('?')[0]} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const projectArg = (process.argv.find((a) => a.startsWith('--project=')) || '').slice(10) || UAT_PROJECT;
  assertUatTarget(projectArg, UAT_DB);
  const token = execSync('gcloud auth print-access-token', {encoding: 'utf8', shell: true}).trim();
  if (!token) throw new Error('No gcloud access token. Run: gcloud auth login');
  const idt = `https://identitytoolkit.googleapis.com`;

  await call('PATCH', `${idt}/admin/v2/projects/${UAT_PROJECT}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, token, {signIn: {email: {enabled: true, passwordRequired: true}}});
  console.log('Auth: email/password sign-in enabled.');

  const found = await call('POST', `${idt}/v1/projects/${UAT_PROJECT}/accounts:lookup`, token, {email: [UAT_OWNER_EMAIL]});
  let uid = found && found.users && found.users[0] && found.users[0].localId, password = '';
  if (!uid) {
    password = process.env.UAT_OWNER_PASSWORD || crypto.randomBytes(15).toString('base64url');
    const created = await call('POST', `${idt}/v1/projects/${UAT_PROJECT}/accounts`, token, {email: UAT_OWNER_EMAIL, password, emailVerified: true, displayName: 'UAT Owner'});
    uid = created.localId;
    console.log(`Auth: created ${UAT_OWNER_EMAIL}.`);
  } else if (process.argv.includes('--reset-password')) {
    password = process.env.UAT_OWNER_PASSWORD || crypto.randomBytes(15).toString('base64url');
    await call('POST', `${idt}/v1/projects/${UAT_PROJECT}/accounts:update`, token, {localId: uid, password});
    console.log(`Auth: password reset for ${UAT_OWNER_EMAIL}.`);
  } else {
    console.log(`Auth: ${UAT_OWNER_EMAIL} already exists (use --reset-password for a new password).`);
  }
  if (!uid) throw new Error('Could not resolve the UAT owner uid.');

  const now = Date.now();
  await call('PATCH', `${UAT_DB}/.json`, token, {
    [`admins/${uid}`]: 'superadmin',
    [`config/booksChartManagers/${booksManagerKey(UAT_OWNER_EMAIL)}`]: {email: UAT_OWNER_EMAIL, active: true, seededAt: now},
    uatEnvironment: {synthetic: true, seededAt: now, seededBy: 'tools/uat/seed-uat.mjs', ownerEmail: UAT_OWNER_EMAIL},
  });
  const role = await call('GET', `${UAT_DB}/admins/${uid}.json`, token);
  if (role !== 'superadmin') throw new Error(`Seed check failed: admins/${uid} = ${JSON.stringify(role)}`);
  console.log(`RTDB: admins/${uid} = superadmin; Books chart access granted; uatEnvironment marker written.`);
  console.log(`Sign in at https://${UAT_PROJECT}.web.app/admin.html as ${UAT_OWNER_EMAIL}`);
  if (password) console.log(`Password (shown once, store it safely): ${password}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(`UAT seed failed: ${e.message}`); process.exit(1); });
}
