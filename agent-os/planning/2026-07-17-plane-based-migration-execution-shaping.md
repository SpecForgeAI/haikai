# Plane-Based Migration Execution & Plan-UX Reframe (2026-07-17)

**Status: AGREED (shaping), NOT BUILT.** Durable design record of a long
design conversation. Reframes how the migration plan is *structured*,
*executed*, and *presented*, and closes two concrete execution gaps. Builds on
/ repositions the Data-Tier Oracle Program
(`2026-07-14-data-tier-oracle-program.md`, wave 1 O/Q/P merged). Pause for
review + compaction; build the constituent specs (below) after.

## 1. Organising principle — build / verify / reconcile, per plane

The migration is **one repeatable unit — build / verify / reconcile —
applied per PLANE, foundation-first**, not per feature.

- A **known** migration differs from ad-hoc feature dev: the unit of work is a
  **tier/plane** migrated wholesale (the whole surface is known up front), NOT
  a feature spanning tiers. So we **migrate by plane, not by feature.**
- Planes, in order: **DB (persistence) → Service → UI.** Each in-scope plane
  runs build → verify → reconcile; the next plane starts only after the prior
  in-scope plane's reconcile is human-approved.
- **Generic streams, specifics in specs** (the master principle — identical to
  "generic core, specifics in data" from the migration-pair ruleset). Streams
  are generic *by purpose*; the per-item generated spec carries all tech
  detail (REST vs SOAP, framework, versions). No tech-variant streams.

## 2. Decisions (this conversation) — all resolved

1. **Plane-based streams** — yes (migration is short, mostly automated in
   execution).
2. **Migrate by plane, not feature.** Service plane = **ALL** service/API code
   (UI-facing *and* external), all API-reconciled. UI plane = frontend only,
   **build-only** (no UI reconcile), consumes the already-verified APIs, runs
   **last**. Do NOT carve UI-backing service code into the UI plane.
3. **`internal_processing` stays its own stream** (non-API behavioural purpose,
   not a tech-variant of API).
4. **Merge REST + SOAP → one generic `api_migration` stream**; the per-endpoint
   spec details the protocol. Kill `api_soap_integration_compatibility` as a
   stream. Apply this everywhere — no protocol/tech stream splits.
5. **Tests peppered into build stories** (unit/functional/integration/e2e per
   what the story builds). Drop `migration_test_pack` as a stream. (Distinct
   from the acceptance/evidence pack, which is a reconcile *output*.)
6. **Reconcile is a first-class per-plane stream**, automatic (implied by an
   in-scope build plane, never separately picked):
   `data_parity_reconciliation_reporting` (after schema + data) and
   `api_reconciliation_reporting` (after API build).
7. **Infra + cutover are OPTIONAL** and may occur **outside** the tool; when
   off, the tool assumes external handling. **Infra is positionable**
   (start / middle / end); if deferred, reconciles **re-run** against the real
   env afterward.
8. **`data_migration` is always implied when Persistence is in scope** (no
   schema-only toggle).
9. **Human review between planes is a HARD PAUSE** — execution literally halts
   and waits for "approve & continue" in the book-of-work workspace.
10. **Migration style stage simplified/removed** — **Phased with human review
    between planes is the default (and only in-tool) model** for now. Big-bang
    is at most a single toggle; strangler / parallel-run / blue-green are
    **external** for now.
11. **Reconciliation is a TOOL CAPABILITY, never per-migration generated
    code** (see §5) — both DB and API.
12. **Data-parity gate repositions** from the pre-migrate hard-block (gate 4d)
    to the **DB-plane reconcile inside phased execution**, and is
    **Persistence-tier-conditional** (skipped entirely for service-only
    migrations).

## 3. Stream vocabulary: old 10 → new set

Old (flat 10, multi-select): `target_service_api_implementation`,
`target_frontend_implementation`, `target_database_schema_implementation`,
`target_infrastructure_environment_implementation`, `data_migration`,
`api_soap_integration_compatibility`, `internal_processing_implementation`,
`migration_test_pack`, `reconciliation_reporting`,
`cutover_rollback_decommission`.

New (grouped by plane; reconciles auto; tests in build):

| Plane / role | Stream(s) | Selected how |
|---|---|---|
| Persistence — build | `target_database_schema_implementation`, `data_migration` | Auto if **Persistence** tier in scope (data always implied) |
| Persistence — reconcile | `data_parity_reconciliation_reporting` | **Implied** by the above |
| Service — build | **`api_migration`** (REST+SOAP merged), `internal_processing_implementation` | Auto if **Service** tier in scope |
| Service — reconcile | `api_reconciliation_reporting` | **Implied** by the above |
| UI — build | `target_frontend_implementation` (tests peppered in) | Auto if **UI** tier in scope; build-only |
| Optional | `target_infrastructure_environment_implementation` (positionable), `cutover_rollback_decommission` | Explicit opt-in; may be external |
| **Removed** | ~~`migration_test_pack`~~ (→ build stories), ~~`api_soap_integration_compatibility`~~ (→ `api_migration`) | — |

Note: `internal_processing` inclusion is auto-detected from discovery (jobs /
listeners / batch present) and confirmed. Reconcile "streams" are NOT
dispatched to IVS as specs — they invoke the tool's reconcile capability (§5).

## 4. Tier-driven scope + gates

The target-state conversation confirms `[Persistence][Service][UI]` tier scope
up front. That scope is the **single source of truth** for which planes exist —
the plan does not re-ask it.

**Plane entry gate = (tier in scope) AND (previous *in-scope* plane's reconcile
approved/overridden).** This one rule covers every combo:

- DB-only → Persistence plane (+ optional infra/cutover); Service/UI closed.
- **Service-only (no persistence)** → data-parity **skipped** (not in scope),
  Service plane enters immediately. (⚠ the existing data-parity gate must
  become Persistence-conditional — today it would wrongly block this.)
- DB + Service → Persistence → data-parity approve → Service.
- DB + Service + UI → full chain; UI last (build-only).
- Any other combo composes; absent-tier gates are no-ops.

## 5. Generate vs Apply vs Reconcile (the mechanics) + two runner gaps

Three things, three mechanisms — the asymmetry is correct and load-bearing:

| | Generate | Apply / Run |
|---|---|---|
| **Schema** | pack DDL (deterministic, `dbMigrationPack`) | ⚠ **runner needed** — Spring Boot + Liquibase **bootstrap shell** (kept, pluggable per pair/target-tech). Liquibase auto-runs the pack's `db.changelog-master.xml` on boot. |
| **Data** | pack COPY/upsert scripts + manifest (deterministic, `dataScripts.ts`) | ⚠ **runner needed** — today the pack *documents* the extract→`COPY` pipe but **"does NOT execute it"** (verbatim in code). Execute source→transform(ruleset)→target `COPY`. Generic + ruleset-driven, NOT per-migration bespoke ETL. |
| **Reconcile (DB + API)** | — (never generated) | ✅ **tool capability** — data-parity comparator (Spec P, AMVS) + API baseline replay/diff (existing gateway reconcile). |

**Migration = generate artefacts + apply them** (the target must receive them);
**reconciliation = a capability that runs against both systems** (never
generated). Reconciliation MUST be uniform tool logic — a per-migration
generated oracle could itself be wrong and silently pass a broken migration.

**The two runners are the concrete new "basic code"** the user sanctioned. Both
generic, keyed to the migration pair / target tech, and **kept** (not
throwaway): for `sybase15→postgres18 + Spring`, the schema runner is the
Liquibase-on-boot bootstrap; the data runner executes the generated
extract→COPY pipe with ruleset transforms.

## 6. Phased execution model (replaces big-bang)

Today's executor `buildOrderedDispatchSet` is **big-bang**: dispatch all
stories, only the final one deploys. Phased replaces this.

For each in-scope plane, in order **DB → Service → UI**, run **automatically**
to the plane's reconcile, then **HALT**:

- **DB plane:** dispatch "schema build" specs to IVS → then "data migration"
  specs/scripts (the data runner) → then **data-parity reconciliation** (tool
  capability) → **HALT.** Human reviews the DB reconcile in the book-of-work
  workspace and clicks **approve & continue** (or fixes something). Fail/unclean
  = hard block or human override (§2.9/2.12).
- **Service plane:** build (API + internal, tests in stories) → verify → **API
  reconciliation** (tool capability) → **HALT** for human review.
- **UI plane:** build-only → migration complete → optional cutover.

Between planes is a **literal pause** (execution stops, waits for approve).
Big-bang, if ever wanted, is a single default-off toggle — never a stage.

## 7. Create Migration Plan wizard — 7 stages → 3

Premise: the **target-state conversation is complete** before the wizard opens,
so tiers / tech / decisions / mappings are **shown as confirmed, never
re-asked** (fixes the "answering the same questions again" pain).

1. **Context & inputs** — pick which completed target-state conversation +
   which discovery runs/baselines feed the plan. Read-only confirmation from
   the conversation: tiers in scope, target tech (PostgreSQL 18 / Spring…),
   decisions count, mappings, readiness. (Old stages 1+2; intent read from
   conversation.)
2. **Scope** — planes derived from tiers (read-only ✓/✗) + the genuine toggles:
   `internal_processing` present? (auto-detected, confirm); **Infrastructure**
   in scope? (when: start/middle/end · in-tool/external); **Cutover** in scope?
   (in-tool/external). Reconciles shown as auto. `data_migration` implied with
   Persistence (no toggle). (Old "Delivery streams" transformed + old "Data &
   cutover" merged — it's all scope.)
3. **Generate** — review card (planes, in-tool/external activities, inputs;
   note: phased, human-gated between planes) → Generate. (Old stage 7.)

Removed stages: **"Migration style"** (phased is default) and **"Test Pack"**
(tests → build stories). Net: dramatically simpler; the worst offenders (the
10-stream multi-select, the test-pack stage) are gone.

## 8. Constituent build specs (decomposition; letters continue O–U)

Suggested split (one program, several specs; build order noted):

- **Spec V — Plane-based stream vocabulary + plan generator.** Merge REST/SOAP
  → `api_migration` (planner stops partitioning by protocol; specs carry it);
  keep `internal_processing`; tests into build-story specs; promote reconciles
  to per-plane streams; drop `migration_test_pack`; tier-driven stream
  inclusion. *(Feeds W and Z.)*
- **Spec W — Phased human-gated execution.** Replace big-bang with per-plane
  build/verify/reconcile; hard human-review pauses (halt + approve&continue in
  the workspace); tier-aware plane gates; reposition the data-parity gate into
  the DB reconcile (Persistence-conditional). *(Depends on X + Y for the DB
  plane to actually run.)*
- **Spec X — Schema-apply runner (bootstrap shell).** Generic, pair/target-tech
  pluggable Spring Boot + Liquibase bootstrap that applies the pack on boot;
  kept artefact.
- **Spec Y — Data-migration runner.** Execute the generated extract→`COPY`
  pipe; generic + ruleset-driven (source → transform → target); kept.
- **Spec Z — Create Migration Plan wizard reshape (3 stages).** Frontend modal
  collapse; tier-scope-driven confirmation; remove style + test-pack stages;
  infra/cutover as scope. *(Depends on V.)*

Reconciliation needs **no new spec** — both DB (Spec P) and API (existing)
already run as capabilities; only the data-parity gate *position* changes (in
W).

Rough order: **X, Y** (runners, independent) → **V** (streams) → **W**
(execution, needs X/Y/V) → **Z** (wizard, needs V). X/Y/V can parallelise.

## 9. Constraints & cross-refs

Emission/behaviour discipline as before; NEW Liquibase changesets only;
snake_case AMS wire; fail-closed gates with human override; the runners are
generic + pair-keyed (engine-name guard applies — engine specifics stay in the
pair ruleset / pack / apply-strategy, not generic core). Predicate stages
should be re-aligned to the phased flow as part of W (DATA moves to the DB
reconcile slot; a phase-gate predicate; stages read in executed order).
Cross-refs: `2026-07-14-data-tier-oracle-program.md` (O/Q/P),
`2026-07-10-predicate-run-judging-design.md`, `docs/trace-logging.md`.
