# Accaza AI knowledge and access maintenance

The server workflow guide in `src/functions/62-accaza-workflows.js` supplies source-linked application guidance. Every guide is assigned to at least one standard Operations Manual chapter through `ACCAZA_AI_MANUAL_WORKFLOWS`. Review its source map, guide and chapter assignment whenever a referenced screen or workflow changes. The detailed Recipe Costing and Art of Baking procedures are dedicated chapters. Standard manual installation preserves customized chapters; custom chapters default to management-only until a manager explicitly publishes them for staff.

The coverage test proves that every workflow in the curated guide is source-linked, routable and assigned to the Operations Manual. It does not prove that every future app action or edge case has already been documented. When available evidence is incomplete or conflicts, Accaza AI must say so rather than inventing steps. Prompt instructions do not guarantee a model's response.

## History signing prerequisite

`askAccazaAI` binds the Secret Manager secret `ACCAZA_AI_HISTORY_KEY`. Before an authorized Functions release, an administrator must provision an enabled, cryptographically random secret of at least 32 characters and verify the function's runtime identity can access it. Do not commit or log the value. Without the bound secret, deployment or startup may fail; if the runtime receives an empty key, conversation history fails closed to single-turn operation. Rotating the key invalidates old conversation tokens. Existing cached clients that do not send tokens also receive single-turn behavior. Tokens are scoped to the user, role, grants, authentication time and mode, and expire after one hour. Existing session-cutoff caching still applies, and a revoked-then-restored grant can make an unexpired token valid again.

## Manual write lock

Manual seed and save actions share the server-only `accazaAiKnowledgeWriteLock` to prevent overlapping writes from replacing a manager's chapter. The lock does not expire automatically: a stalled writer must not be allowed to resume after a later write. If the lock remains after an invocation failure, authorized system support must inspect the lock and logs, verify the owning invocation is no longer running, and obtain the required authorization before clearing any live database record. Do not clear the lock merely because it is old. Chapter changes and their operational-audit entry remain in one atomic update.

## Firebase cost and release checks

Each non-management AI request now reads the caller's permissions before preparing data and rechecks the account and permissions before returning. Manual writes acquire and release a lock; no new listener or poll is added. Compare Firebase downloads and Function execution per AI question/manual update against a representative baseline before release, including the larger workflow fact pack, and investigate unexplained regressions. The local tests are not production usage evidence.
