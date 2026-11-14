// App Check enforcement flags. This section sorts first in src/functions so both
// constants are initialized before any onCall options object in the bundle reads them.
// The committed defaults below are the only lever that reaches production:
// functions/.env.accaza-sartoga is git-ignored and therefore absent on the CI runner,
// and a workflow step's env: is shell environment for the firebase CLI process, which
// the CLI never forwards into a deployed function's runtime configuration.
// CallableOptions requires a real Boolean; a defineBoolean parameter object is truthy
// at runtime and would enforce even when the flag is false, hence the String() coercion.
// 28 Oct 2026: staff enforcement ON. Production logs 18-28 Oct showed 12,293 of 12,295 staff callable
// calls with a VALID App Check token (2 MISSING, both development calls on 20 Oct). Rollback: set this
// default back to "false" and merge (APP_CHECK_ENFORCEMENT_RUNBOOK.md section 5). UAT keeps its own
// ENFORCE_APP_CHECK=false override from tools/uat/deploy-uat.ps1.
// 15 Nov 2026: production ignores an ENFORCE_APP_CHECK value in the runtime environment. Cloud Run showed
// ENFORCE_APP_CHECK=false on live staff functions (reportPosDeviceHealth, manageSupplier, recordClientTelemetry)
// that were built from a committed default of "true", so staff calls without a token were accepted while this
// file said enforcement was on. In production the committed default below is the only lever; the environment
// override still works for UAT, the emulator and tests, which carry no GCLOUD_PROJECT of the production project.
const APP_CHECK_ENV_STAFF = process.env.ENFORCE_APP_CHECK;
const APP_CHECK_PRODUCTION = process.env.GCLOUD_PROJECT === "accaza-sartoga";
if (APP_CHECK_PRODUCTION && APP_CHECK_ENV_STAFF) console.warn("ENFORCE_APP_CHECK is set in the production runtime environment and is ignored; the committed default applies.");
const ENFORCE_APP_CHECK = String((APP_CHECK_PRODUCTION ? "" : APP_CHECK_ENV_STAFF) || "true").toLowerCase() === "true";
// Independent of ENFORCE_APP_CHECK on purpose, so the staff surface can enforce while the
// public order path stays in monitor mode. A rejected legitimate order costs a sale; an
// unverified order call is already contained by server repricing, the per-uid rate limit,
// SHA-256 signature idempotency and the quantity/line/total caps.
const ENFORCE_APP_CHECK_ORDERS = String(process.env.ENFORCE_APP_CHECK_ORDERS || "false").toLowerCase() === "true";
