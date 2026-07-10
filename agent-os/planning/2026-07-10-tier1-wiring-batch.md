# Tier-1 Wiring Batch (2026-07-10)

**What this is:** the five wiring residuals left by the Code-Tier Oracle Program
(build log: `2026-07-06-code-tier-oracle-build-log.md`). Each item's REQUIREMENTS
live in its parent spec (F §4, I §2–4, N, K) — this batch is wiring, not design,
so no new specs; this doc is the decision + verification record. One commit per
item on `feature/tier1-wiring-batch`, merged to main at the end.

**User decisions (2026-07-10):**
- **Q1 auto-repair:** YES — a failed post-deploy parity verdict auto-POSTs to the
  IVS parity route, which auto-enqueues repair runs. Cap stays CONFIG:
  `PARITY_REPAIR_CAP` env on IVS (default 5) is the official knob. This
  deliberately supersedes the June bug-loop's human-gated posture FOR PARITY
  VERDICTS ONLY (the human-gated bug-send path is untouched).
- **Q2 drift scheduling:** option (b) — current-system credentials may be held
  IN GATEWAY MEMORY for the process lifetime (never persisted, dies on
  restart) to enable an in-process interval drift check.
- **Q3:** Migrate/verify surface may carry OPTIONAL target-DB credentials
  (in-memory only) alongside target API credentials.

## Items, decisions, predicates

### 1. `dialect_affected` plan-time wiring (Spec F §4)
Book-of-work code expansion computes `dialectAffectedEndpointIds` via
`dbChangeConsumerResolver` and threads it into the planner's `CodeModelView`.
FAIL-SOFT: resolver/pack read failure ⇒ no flags, plan proceeds (logged).
**Decision:** the plan-time affected set = `tsql_dialect_sql` + `translated_proc`
reasons ONLY. `altered_table` is EXCLUDED at plan time — in an engine swap every
table alters, which would flag every endpoint and dissolve interface clustering;
altered-table scoping remains a revalidation-route concern where the caller
names tables.
**Predicate:** a model with one tsql-flagged endpoint plans that endpoint as an
individual `dialect_affected` story; resolver failure plans identically to
pre-batch output.

### 2. Verify-loop last mile (Spec I §2–3)
(a) After the deploy-time full reconcile completes, the gateway evaluates each
in-scope code story's completion verdict off the persisted diff and POSTs it to
IVS `POST /api/v2/parity-verdict` (binding: the run item's orchestrate job id +
spec name). Fail-soft per story: a POST failure is logged, never crashes the
reconcile tail. (b) A run-level parity-status read endpoint exposes the
completion/closure/drift evaluators on demand. (c) The IVS verify-task-group
path threads `parity_report` from the job payload into the loop's defect input.
**Predicate:** mocked reconcile tail with one clean + one broken story POSTs
two verdicts (pass + fail with breaks); the IVS repair job payload carries the
parity report; the status endpoint returns per-story gate codes.

### 3. Target-DB credentials → state deltas (Spec N residual)
AMVS target-session secrets body gains an optional `db` block (engine-selectable:
`postgres` for the target, `sybase` for drift checks against current). The
/start route builds the adapter and passes it to the replay runner; disposed on
run end. Gateway: `migrationTargetCredentialsStore` + the reconcile
`loadSecrets` thread the optional db block through. In-memory only, purged on
terminal state — identical posture to API creds.
Plus (Q2b): a gateway in-memory current-system credentials register + an
in-process interval drift check (config-enabled; interval + max-age
configurable; silently idle when no creds registered; dies on restart by
design).
**Predicate:** target replay with a db block persists non-null
`state_delta_json` on mutating items; secrets absent ⇒ null (unchanged);
scheduler test with fake timers fires a drift check only for registered
projects with stale drift state.

### 4. Sequence state deltas (Spec N residual)
`sequenceReplayRunner` snapshots the effect tables around the ACT STEP ONLY —
setup/cleanup steps are scaffolding whose state changes are intentionally
transient; snapshotting them would record noise as oracle. The act capture +
promoted baseline item carry `state_delta_json` exactly like single-shot items.
**Predicate:** a 3-step sequence (setup→act→cleanup) with a fake adapter makes
exactly 2 count snapshots (pre/post act), and the promoted act item carries the
delta.

### 5. Smaller batch
- **Readiness surfacing (F residual):** MigrationDiscoveryContext database
  summary gains `affected_consumer_count` (AMS-side: endpoints with tsql edges
  + endpoints touching translate-disposition proc objects) + gap code
  `db_consumers_unrevalidated` with a wayfinding entry when the count > 0 and
  no scoped-parity diff exists.
- **Story-scoped floor (K/I residual):** gate 4c's `code_coverage_floor_unmet`
  evaluates ONLY the in-scope stories' endpoints (via the coverage rows'
  method/path), not the whole summary.
- **Proc-call edge minting (F residual):** a discovery pipeline post-pass mints
  `endpoint_data_effects` candidates (`query_kind: 'proc_call'`,
  `access_mode: 'execute'`) for proc calls matched against the SAME RUN's proc
  candidates. **Decision:** `access_mode = 'execute'` — deliberately outside
  the write/read-write set so Spec N's state-delta effect scope (write edges →
  table snapshots) never tries to `COUNT(*)` a procedure; the reverse
  consumer queries are mode-agnostic and still see the edge. Code-only runs
  (no proc inventory) stay finding-only, unchanged.
**Predicates:** context summary shows the count + gap code on a seeded model;
floor gate passes when the only floor miss is on an out-of-scope endpoint;
combined-run pipeline mints the proc edge, code-only run mints none.

## Standing constraints
Per-invocation credentials NEVER persisted (Q2b memory-hold is the one scoped
exception, process-lifetime only). NEW Liquibase changesets only. snake_case
AMS wire. Fail-closed gates; fail-soft enrichment. Baseline-red discipline:
verify failures against the pre-batch baseline before attributing.
