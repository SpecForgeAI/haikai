# Spec Requirements: D3 (Keystone) — Internal-behaviour implementation-ready spec generation (+ modernisation)

## Initial Description

This is Spec 3 (D3) and the KEYSTONE of a 6-spec discovery-completeness + net_new
program. It closes the verified "dead zone" so that non-API / internal
functionality (D2 `discovery_capability` groupings — batch pipelines, monitoring,
deployment, FTP ingestion, housekeeping — and behaviour-bearing
`operational_artifact` findings) can become a genuinely IMPLEMENTATION-READY,
Migrate-able spec, exactly as the already-built migration program does for API
endpoints.

D3 does this by adding a 7th migration spec-context type and REUSING the
already-built migration spec generator + implement-state writer UNCHANGED, with a
modernisation twist that REUSES the EXISTING per-project/element target-tech
machinery. The first real migration is a Sybase / Spring-Classic / Java
risk-hierarchy system whose batch tier is CA Autosys JIL + shell scripts +
plain-Java `main()` classes + Geneos monitoring XML + Argon/TIBCO FTP — the
operational work D3 makes implementable in a modern way (Autosys → captured
orchestrator, Argon/TIBCO → captured messaging, Sybase → Postgres, Geneos →
captured observability) while PRESERVING the behavioural contract.

## Problem Statement & Context

### The verified dead zone D3 closes

The built migration spec generator only produces implementation-ready specs for
stories that resolve to the SIX existing migration spec-context types — `service`
/ `api` / `soap` / `data` / `infrastructure` / `test_pack`. The resolver hardcodes
this whitelist (gateway `migrationSpecContextClient.ts` `MIGRATION_SPEC_CONTEXT_TYPES`
at line 59; AMS `MigrationSpecContextResolver.java` `KNOWN_CONTEXT_TYPES` at line 99,
with the matching `CTX_*` constants and the `switch` at line 212).

A story about non-API / internal work resolves to ZERO context blocks → is marked
`insufficient_context` → never reaches `generated` → sits un-actioned. The work
D1 (per-file `operational_artifact` findings) and D2 (`discovery_capability`
groupings + batch spines: JIL topology, plain-Java `main()` entrypoints,
JIL→shell→Java→DB invocation edges) now SURFACE is therefore visible but NOT
implementable. D3 makes it implementable.

### How D3 fits the program

- **D1** added the always-on pass that LLM-summarises unknown-but-relevant files
  into per-file `operational_artifact` findings (the per-file FALLBACK source).
- **D2** turns those scattered findings (plus discovered entities + DB objects)
  into coherent, durable `discovery_capability` records + members + batch spines
  (the PREFERRED source). D2 is being built BEFORE D3, so D3's compile dependency
  on the `discovery_capability` entity is satisfied.
- **D3 (this spec)** = capability/finding → ONE implementation-ready (modernised)
  spec + implement-state, consumable by the already-built Migrate dispatch.
- **D4 / D5 / D6** (the completeness gate, net_new items + provenance,
  reconcile-time verification / `target_only` routing) all stay OUT of D3.

## Confirmed Decisions

All decisions below were presented to the user and confirmed — the user agreed
with every recommendation. They are FINALIZED.

### D1. Context-type name

The 7th migration spec-context type is **`operational_capability`** — the wire
token, the `CTX_OPERATIONAL_CAPABILITY` constant, and the resolver `switch` block
name. The single name is used whether the source is a D2 `discovery_capability` or
a behaviour-bearing finding fallback.

### D2. Capability → work_item path

D3 adds an "approved capability → work_item" path modelled on the already-built
`append-test-item` AMS endpoint: a NEW **`append-capability-story`** endpoint that,
in ONE transaction (reusing `persistOne`):

- mints a `type='story'` WorkItem stamped with `source_capability_id`, AND
- appends the `book_of_work_json.items[]` blob.

The existing `migrationShapeSpecGenerationHandler` then picks it up UNCHANGED —
`selectEligibleStories` already requires `type==='story'` + a non-null
`workItemId`. The explicit PER-CAPABILITY trigger lives in D3; batch / gate-driven
invocation (creating stories for un-covered capabilities) is deferred to D4.

### D3. Source — capability (preferred) + finding (fallback)

BOTH sources are supported:

- a D2 `discovery_capability` (PREFERRED — the coherent unit), resolved by
  `source_capability_id` on the WorkItem;
- a behaviour-bearing `operational_artifact` finding (per-file FALLBACK).

The resolver tries the capability FIRST, then falls back to assembling from a
finding. The finding path also makes D3 testable BEFORE D2's entity is populated.

### D4. Batch-spine → context block

The `operational_capability` block assembles from the capability's `detail_json`
exactly as D2 persists it:

- the JIL-DAG topology snapshot,
- the `invocations[]` edges (JIL → shell → Java → DB),
- members (with their kinds),
- schedule / trigger metadata,
- inputs / outputs,
- side-effects,
- external systems,
- plus name / kind / summary + the aggregated `behaviourBearing` hint.

It emits `missingInputs[]` when the capability has no members or no behaviour
signal.

### D5. Modernisation — reuse the existing target-tech machinery

REUSE the EXISTING per-project/element target-tech machinery AS-IS — the prompt's
**Target State Decisions Context** and **Target Tech Stack Context**, both already
wired gateway resolvers; the architect close-step writes
`target-tech-stack-<id>.md`. There is NO per-capability tech picker.

Add a short "operational capability" modernisation CLAUSE to the prompt instructing
it to target the captured modern equivalent — Autosys → captured orchestrator,
Argon/TIBCO → captured messaging, Sybase → Postgres, Geneos → captured
observability — while PRESERVING the behavioural contract: same schedule semantics;
same data / message / snapshot OUTCOMES. The WHAT (effect/contract) is fixed; the
HOW is modern.

When no relevant decision is captured → emit the EXISTING
`MISSING_DECISION_CONTEXT` / `NO_CAPTURED_DECISIONS` warning and DOWNGRADE — NEVER
invent.

**Confirmed nuance:** the orchestrator / file-transfer / monitoring modern choices
ride the EXISTING general free-text Target State Decisions channel (e.g. "use
Airflow for batch orchestration"). There is NO new tech-category vocabulary in D3;
a dedicated orchestrator / FTP / monitoring category set is a possible LATER
enhancement only.

### D6. Confidence / insufficient_context

- A capability with ZERO members OR no behaviour-bearing signal →
  short-circuit to `insufficient_context` (NO LLM call; `missingInputs` e.g.
  `capability_members` / `capability_behaviour`), mirroring the existing pre-LLM
  context-blocker path.
- A capability with members + spine but a MISSING target-tech decision →
  `generated_with_warnings` (downgraded), NOT blocked.

### D7. Effect-asserting test pack

REUSE the existing `structured_tests_json` shape
(`{ title, description, type: 'unit' | 'functional' }`) — NO schema change — and
add an "operational capability" CLAUSE to the prompt's STRUCTURED TEST PACK section
steering toward EFFECT assertions: run the pipeline → assert DB tables / downstream
message / snapshot outcome, INSTEAD of HTTP request/response. Heavier integration /
E2E effect tests stay with the holistic mechanism + the later D6.

### D8. coveredEndpointIds

Empty `[]` for every capability / finding story. The validator already allows
empty (`specGenerationResponseValidator.ts:371`); the prompt already mandates `[]`
for non-endpoint work. This is a no-op confirmation.

### D9. Reuse vs fork — ONE generator

`migrationShapeSpecGenerationHandler` stays the SINGLE path. D3 ONLY:

- (a) adds the 7th context type to the resolver (gateway
  `MIGRATION_SPEC_CONTEXT_TYPES` + AMS `KNOWN_CONTEXT_TYPES` / `CTX_*` / `switch`),
  and
- (b) requests it in `SHAPE_SPEC_CONTEXT_TYPES`.

The two-pass loop, confidence / no-fabrication, implement-state writer, and
persistence are REUSED UNTOUCHED; the resolver populates the
`operational_capability` block INSTEAD of api/data for a capability story. There is
NO parallel generator.

### D10. Changeset

NO new Liquibase changeset for D3.

- `structured_tests_json` + `covered_endpoint_ids` already exist (changeset 181).
- D2 adds the capability entity (changeset 184).
- The WorkItem → capability provenance link (`source_capability_id`) rides the
  `book_of_work_json` blob (NO DDL), mirroring how `append-test-item` stamps
  `workItemId`.
- If the D4 gate's coverage query later needs `source_capability_id` promoted to a
  column, D4 adds that changeset.

### D11. Frontend — no new UI

NO new UI in D3. An `operational_capability` story flows into the SAME Specs /
Implementation review tiles (scope / AC / test-pack) as today's migration specs —
the implement-state writer hydrates the screen identically. The modern target is
visible INSIDE the generated spec body. A "modern target" chip/label is a
deferrable nice-to-have, NOT in D3.

### D12. Dependency on D2 / testability

D3 is INDEPENDENTLY testable via the FINDING path (the capability path is coded
against D2's documented entity shape and exercised via fixtures / mocks), so D3's
suite is green WITHOUT a live / populated D2 run. We ARE building D2 before D3, so
the compile dependency on D2's `discovery_capability` entity is satisfied — this is
test hygiene, not a hard runtime block.

### D13. Test strategy

Gateway jest LLM-guard (mock `llmClient`) + `architectureModelClientMock`:

- (a) an AMS resolver test that the 7th type resolves an `operational_capability`
  block from a fixture capability / finding;
- (b) a gateway generation test (capability → generated
  `migration_story_spec_generations` row + `implement-state.json` + an
  effect-oriented test pack);
- (c) a NO-REGRESSION test that all 6 existing context types still resolve
  unchanged;
- (d) a thin-capability → `insufficient_context` test.

AMS entity / resolver tests run on H2 2.3 via foreground `mvn`.

### D14. Scope out

The following all stay OUT of D3:

- the completeness gate (D4 — every capability cited-or-dismissed before Migrate);
- net_new items + provenance (D5);
- reconcile-time verification / `target_only` routing (D6).

D3 = capability/finding → ONE implementation-ready (modernised) spec +
implement-state, consumable by the already-built Migrate dispatch.

### D15. Capability kinds + generate-all

D3 handles ALL `operational_capability` kinds UNIFORMLY — `batch_pipeline`,
`monitoring`, `deployment`, `ftp_ingestion`, `housekeeping`. The context block +
prompt are KIND-AGNOSTIC; the kind just informs the modern-tech mapping. There is
NO kind-specific deferral.

Wiring the capability-story append into the existing "Generate all" batch button is
deferred to D4.

## Existing Code to Reference

### Verified reuse targets

**Single generator + spec assembly (reuse UNTOUCHED):**
- `gateway/src/services/migrationShapeSpecGenerationHandler.ts` —
  `selectEligibleStories` requires `type==='story'` + non-null `workItemId`; the
  two-pass loop, confidence / no-fab, and batch behaviour are the single path D3
  reuses without forking.
- `gateway/src/services/migrationImplementReadyState.ts` —
  `buildPersistedImplementStateLiteral`, `buildPlannerResponseFromGenerated`,
  `buildTestPlannerResponseFromTests`, `defaultPutImplementState` (the
  implement-state.json writer that hydrates the Implement screen).
- `gateway/src/services/specGenerationResponseValidator.ts` —
  `SPEC_TEXT_REQUIRED_PREFIX` (`/agent-os:shape-spec`), `coveredEndpointIds` MAY be
  empty at line 371, `STRUCTURED_TEST_TYPE_VALUES` = `unit | functional`.
- `migration_story_spec_generations` row (changeset 181), carrying
  `structured_tests_json` + `covered_endpoint_ids`.

**The 7th context-type wiring point (the 6-type whitelist to extend):**
- `gateway/src/services/migrationSpecContextClient.ts` —
  `MIGRATION_SPEC_CONTEXT_TYPES` at line 59 (+ `SHAPE_SPEC_CONTEXT_TYPES`).
- AMS `MigrationSpecContextResolver.java` — `KNOWN_CONTEXT_TYPES` at line 99, the
  `CTX_*` constants, and the `switch` at line 212.

**The capability → work_item precedent (model `append-capability-story` on it):**
- the built `append-test-item` AMS endpoint — mints a WorkItem + appends the
  `book_of_work_json.items[]` blob in ONE transaction via `persistOne`, stamping
  `workItemId`. D3's `append-capability-story` mirrors this, stamping
  `source_capability_id`.

**The prompt (add two clauses to it):**
- `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
  — already has the Target State Decisions + Target Tech Stack context sections and
  already mandates `coveredEndpointIds []`. D3 adds the "operational capability"
  modernisation clause (D5) and the effect-oriented STRUCTURED TEST PACK clause
  (D7).

**The capability source entity (D2, built before D3):**
- D2's `discovery_capability` entity — shape documented in
  `agent-os/specs/2026-06-14-capability-synthesis-and-batch-spines/planning/requirements.md`.
  Relevant fields for the `operational_capability` block: `name`, `kind`
  (`batch_pipeline` | `monitoring` | `ftp_ingestion` | `deployment` |
  `housekeeping`), `summary`, `confidence` (boxed `Double`), and `detail_json`
  (the JIL-DAG topology, the `invocations[]` edges, schedule / trigger metadata,
  external systems, and the aggregated `behaviourBearing` hint). Members + outbound
  links live in `discovery_capability_member`.

## Visual Assets

No visual assets provided (optional; declined). `planning/visuals/` is empty —
confirmed by directory check.

## Requirements Summary

### Functional Requirements

- A 7th migration spec-context type `operational_capability` added to the resolver
  whitelist (gateway `MIGRATION_SPEC_CONTEXT_TYPES` + AMS `KNOWN_CONTEXT_TYPES` /
  `CTX_*` / `switch`) and requested in `SHAPE_SPEC_CONTEXT_TYPES`.
- The resolver assembling an `operational_capability` context block from a D2
  `discovery_capability` (preferred, by `source_capability_id`) or a
  behaviour-bearing `operational_artifact` finding (fallback), from the
  capability's `detail_json` (JIL-DAG topology, `invocations[]` edges, members +
  kinds, schedule / trigger metadata, inputs/outputs, side-effects, external
  systems, name / kind / summary, `behaviourBearing` hint), emitting
  `missingInputs[]` when thin.
- A NEW `append-capability-story` AMS endpoint (modelled on `append-test-item`)
  that mints a `type='story'` WorkItem stamped with `source_capability_id` AND
  appends the `book_of_work_json.items[]` blob in ONE transaction via `persistOne`,
  consumed UNCHANGED by `migrationShapeSpecGenerationHandler`.
- Reuse of the single generator (two-pass, confidence, no-fab), the implement-state
  writer, and persistence — UNTOUCHED — to turn an `operational_capability` story
  into a generated `migration_story_spec_generations` row + `implement-state.json`.
- A modernisation prompt clause targeting the captured modern equivalent (via the
  EXISTING Target State Decisions + Target Tech Stack channels) while preserving the
  behavioural contract, downgrading to the existing MISSING_DECISION_CONTEXT /
  NO_CAPTURED_DECISIONS warning when no decision is captured (never inventing).
- An effect-asserting STRUCTURED TEST PACK prompt clause (run pipeline → assert DB
  tables / downstream message / snapshot) reusing the existing
  `structured_tests_json` shape with NO schema change.
- Confidence handling: thin capability (zero members / no behaviour) →
  short-circuit `insufficient_context` (no LLM); members + spine but missing
  target-tech decision → `generated_with_warnings`.
- `coveredEndpointIds` empty `[]` for every capability / finding story (validator +
  prompt already support this).
- Uniform handling of all capability kinds (`batch_pipeline`, `monitoring`,
  `deployment`, `ftp_ingestion`, `housekeeping`); the kind only informs the
  modern-tech mapping.

### Reusability Opportunities

- `migrationShapeSpecGenerationHandler.ts` (the single generator; selectEligibleStories
  gate) — reused untouched.
- `migrationImplementReadyState.ts` (implement-state.json writer) — reused untouched.
- `specGenerationResponseValidator.ts` (spec-text prefix, empty coveredEndpointIds,
  unit|functional test types) — reused untouched.
- `migration_story_spec_generations` row + changeset 181 (structured_tests_json /
  covered_endpoint_ids) — reused; no new changeset.
- The `append-test-item` AMS endpoint — the precedent for `append-capability-story`
  (WorkItem + book_of_work_json.items[] blob via persistOne).
- `product-manager.migration-shape-spec-generation.task.md` — already carries
  Target State Decisions + Target Tech Stack sections and mandates
  coveredEndpointIds []; D3 adds two clauses.
- D2's `discovery_capability` entity (detail_json + behaviourBearing hint) — the
  context source.

### Scope Boundaries

**In Scope:**
- The 7th `operational_capability` context type (gateway whitelist + AMS
  KNOWN_CONTEXT_TYPES / CTX_* / switch) + requesting it in SHAPE_SPEC_CONTEXT_TYPES.
- The AMS resolver assembling the `operational_capability` block from a capability
  (preferred) or finding (fallback).
- The NEW `append-capability-story` AMS endpoint (per-capability trigger), reusing
  persistOne + the book_of_work_json blob stamp.
- The modernisation prompt clause + the effect-oriented test-pack prompt clause.
- Confidence short-circuit + downgrade behaviour.
- Reuse of the existing Specs / Implementation review tiles (no new UI).

**Out of Scope:**
- The completeness gate (D4 — every capability cited-or-dismissed before Migrate).
- Net_new items + provenance (D5).
- Reconcile-time verification / `target_only` routing (D6).
- Any new tech-category vocabulary (dedicated orchestrator / FTP / monitoring
  category set) — possible LATER enhancement only.
- A per-capability tech picker — modernisation reuses the existing
  per-project/element target-tech machinery as-is.
- A "modern target" chip/label in the UI — deferrable nice-to-have.
- Batch / gate-driven capability-story invocation + wiring into the "Generate all"
  button — deferred to D4.
- A new Liquibase changeset (none needed; provenance rides the book_of_work_json
  blob).
- A parallel generator (one generator only).

### Technical Considerations

- **Owners:**
  - **gateway** — the 7th context type wiring in `MIGRATION_SPEC_CONTEXT_TYPES` +
    `SHAPE_SPEC_CONTEXT_TYPES`, the generator consuming capabilities / findings, the
    modernisation prompt clause, the effect-oriented test-pack clause, and the
    `append-capability-story` trigger.
  - **AMS** — extend `MigrationSpecContextResolver` `KNOWN_CONTEXT_TYPES` / `CTX_*` /
    `switch` to assemble the `operational_capability` block from a D2
    `discovery_capability` or a finding; the new `append-capability-story` endpoint
    modelled on `append-test-item` (reuse `persistOne` + the `book_of_work_json`
    blob stamp); NO new changeset.
  - **frontend** — minimal reuse of the existing Specs / Implementation review tiles;
    no new UI.
- **Wire format:** AMS snake_case default; D2's `discovery_capability` is a new
  entity with no `@CamelCaseWire`. All PATCH-mutable numerics boxed (avoid the
  primitive → 0-on-PATCH wipe).
- **Changeset discipline:** NO new changeset in D3; never edit applied changesets.
  Latest on disk is 183; D2 adds 184. Any provenance column promotion is D4's
  changeset.
- **Single-path reuse:** the two-pass loop, confidence / no-fab, implement-state
  writer, and persistence are reused untouched — only the resolver populates a new
  block and the prompt gains two clauses. Do NOT fork the generator.
- **No-fabrication:** missing target-tech decision → existing
  MISSING_DECISION_CONTEXT / NO_CAPTURED_DECISIONS warning + downgrade; thin
  capability → `insufficient_context`. Never invent a modern target.
- **Test estate:** gateway Express/TS jest with the live-LLM guard (mock
  `llmClient`) + `architectureModelClientMock`; AMS Java/Spring entity + resolver
  tests on H2 2.3 via foreground `mvn`; frontend React/TS vitest +
  `renderWithProviders` + the tsc baseline (no new UI expected, so frontend changes
  are minimal/none).
- **Testability seam:** the FINDING path makes D3's suite green without a live D2
  run; the capability path is coded against D2's documented entity shape and
  exercised via fixtures / mocks.
