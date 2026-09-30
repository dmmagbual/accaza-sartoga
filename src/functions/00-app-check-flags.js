// App Check enforcement flags. This section sorts first in src/functions so both
// constants are initialized before any onCall options object in the bundle reads them.
// The committed defaults below are the only lever that reaches production:
// functions/.env.accaza-sartoga is git-ignored and therefore absent on the CI runner,
// and a workflow step's env: is shell environment for the firebase CLI process, which
// the CLI never forwards into a deployed function's runtime configuration.
// CallableOptions requires a real Boolean; a defineBoolean parameter object is truthy
// at runtime and would enforce even when the flag is false, hence the String() coercion.
const ENFORCE_APP_CHECK = String(process.env.ENFORCE_APP_CHECK || "false").toLowerCase() === "true";
// Independent of ENFORCE_APP_CHECK on purpose, so the staff surface can enforce while the
// public order path stays in monitor mode. A rejected legitimate order costs a sale; an
// unverified order call is already contained by server repricing, the per-uid rate limit,
// SHA-256 signature idempotency and the quantity/line/total caps.
const ENFORCE_APP_CHECK_ORDERS = String(process.env.ENFORCE_APP_CHECK_ORDERS || "false").toLowerCase() === "true";
