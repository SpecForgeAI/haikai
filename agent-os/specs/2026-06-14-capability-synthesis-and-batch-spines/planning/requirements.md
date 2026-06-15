# Spec Requirements: D2 — Capability Synthesis + Batch Spines

## Initial Description

This is Spec 2 (D2) of a 6-spec discovery-completeness + net_new program that
makes the migration tool discover NON-API / internal functionality. The first
real migration is a Sybase / Spring-Classic / Java risk-hierarchy system whose
batch tier is CA Autosys JIL + shell scripts + plain-Java `main()` classes +
Geneos monitoring XML + Argon/TIBCO FTP.

D1 (the prior spec) added an always-on pass that LLM-summarises
unknown-but-relevant files into per-file `operational_artifact` findings. D2
turns those scattered per-file findings (plus discovered entities + DB objects)
into COHERENT, durable, migrate-able CAPABILITIES, and adds the structured batch
"spines" (the orchestration topology + invocation linkage) that make the
grouping accurate.

D2 ONLY PRODUCES `discovery_capability` records + their members + the batch
spines. Downstream consumption (keystone modernised-spec generation, book-of-work
/ migration plan) is explicitly out of scope and built in later specs.

## Problem Statement & Context

### Why per-file D1 findings need grouping

D1 emits one finding PER FILE. But operational functionality is a GRAPH, not a
list of files: an Autosys JIL box triggers shell scripts, which invoke plain-Java
`main()` batch classes, which read/write Sybase tables and publish a downstream
message. Thirty disconnected "here's a shell script" findings are nearly useless
for migration. "Here's the Daily Risk Hierarchy Load Pipeline capability,
composed of these parts, on this schedule, honouring these data/message
contracts" is what becomes ONE migration story.

A capability is a cross-cutting CURRENT-STATE aggregation — distinct from a
book-of-work feature (= planned work). D2 introduces that grouping concept plus
the structured extractors (JIL parser, plain-Java `main()` emission, invocation
linkage) that give the grouping good members.

### Verified model gaps (why a new concept is needed, not a reuse)

The current meta-model has NO home for this grouping. Confirmed by inspection:

- **`discovery_finding` is NOT a link target** — it is absent from
  `ALLOWED_LINK_TARGET_TYPES`, so `DiscoveryFindingLink` cannot express
  finding-to-finding or capability-to-finding membership. (D2 deliberately does
  NOT change this — see D1 below.)
- **`DiscoveryCluster` is `@deprecated` / Phase-1c-only** — an internal
  clustering artifact, not a durable reviewable output; must NOT be reused for
  capabilities.
- **Candidate types are a closed whitelist** — the allowed candidate-type set is
  fixed; a capability is not a candidate and must not be forced into that
  vocabulary.
- **`calls` is atom-to-atom** — the existing relationship/`calls` machinery links
  atoms (method→method etc.); it cannot represent an inferred cross-language
  JIL→shell→Java→DB chain at the confidence levels involved without polluting the
  architecture relationship tables.

These gaps motivate the single new model concept of the whole 6-spec program: a
findings-side `discovery_capability` grouping (Option A), shaped so it can
graduate to a first-class "Discovered Capabilities" output (Option B) later with
NO data re-model. This is the ONLY new Liquibase changeset in the program (~184,
after 183).

## Confirmed Decisions

All decisions below were presented to the user and confirmed (the user agreed
with every recommendation). They are FINALIZED.

### D1. Capability membership model

The capability gets its OWN membership table: **`discovery_capability_member`**,
with a polymorphic `member_type` / `member_id` pair supporting:

- `discovery_finding`
- `discovery_candidate`
- `architecture_element`
- `discovery_relationship`

Do NOT extend `DiscoveryFindingLink`, and do NOT add `discovery_finding` to
`ALLOWED_LINK_TARGET_TYPES`. This keeps finding-link semantics completely
untouched and gives the cleanest Option-A → Option-B graduation path (the
membership data does not move when the capability graduates to a first-class
output).

### D2. Synthesis approach — deterministic membership + LLM naming-only

Membership is computed **deterministically**; the LLM is **naming-only** and
NEVER decides membership.

- The LLM (temperature 0, source-hash caching mirroring `llmBehaviourCaptureStep`,
  via the existing `gatewayClient` → gateway relay precedent) NAMES, summarises,
  and CLASSIFIES the `kind` of a seed group. It does not add, remove, or move
  members.
- **Two deterministic seeding modes:**
  - (a) **JIL-DAG transitive closure** for orchestrated pipelines: a box plus
    everything its DAG transitively triggers = one seed.
  - (b) **Co-location / shared-external-system / artifactKind heuristic** for the
    un-orchestrated long tail (Monitoring, Deployment/ARM, FTP ingestion — items
    that are NOT all in the Autosys DAG).
- A mis-seed is caught by the capability's human review (the review is the
  safety net, not a perfect seeder).
- **Graceful degradation:** sparse or absent signals produce fewer / smaller
  seeds; zero signals = a no-op (no capabilities emitted, no error).

### D3. Plain-Java `main()` batch-entrypoint emission

Emit the batch-entrypoint CLASS as candidate type **`class`** (NOT
`app_component`), with a **`batch_entrypoint`** marker in its `data`, and emit
the `main` / `execute` methods as child **`method`** candidates. Capture the
operation-flag pattern (`-o UPDATE` / `-o ARCHIVE`).

- **Rationale:** the capability already owns the component-level grouping, so the
  class is represented faithfully (`class` / `method` are first-class meta-model
  types) rather than promoted to an architectural `app_component`.
- **Recognition rule:** `public static void main(String[])` signature AND
  (shell-invoked per D8 linkage OR a batch package/name signal).
- **Gating:** fires ONLY on runs carrying batch signals.
- **No regression:** MUST NOT regress existing Spring emission. The drop point is
  `springClassic/index.ts:1792`
  (`if (!stereotyped && !nameSuggests) return;`).

### D4. Frontend scope

Minimum, read-only: a **READ-ONLY "Capabilities" section / sub-tab inside the
existing Findings review (`FindingsTab.tsx`)**.

- Lists synthesised capabilities: name, kind, member count, confidence.
- On expand: shows members + the batch-spine summary, reusing
  `FindingDetailDrawer` patterns.
- NO capability review actions / cascade UI.
- NO standalone "Discovered Capabilities" tab — that is the Option-B graduation,
  deferred.

### D5. Capability entity fields

`discovery_capability` fields:

- `id`
- `run_id`
- `project_id`
- `architecture_id`
- `name`
- `kind` — string-typed / extensible, NO DB enum (e.g. `batch_pipeline` |
  `monitoring` | `ftp_ingestion` | `deployment` | `housekeeping`)
- `summary`
- `review_status` — default `pending_review`
- `previous_review_status`
- `confidence` — boxed `Double`
- `detail_json` — JSONB: the JIL-DAG topology snapshot, the D8 invocation edges,
  schedule / trigger metadata, external systems, and an aggregated
  `behaviourBearing` hint (forward-needed by the D4-gate spec)
- `source` / `created_by_stage`
- timestamps

Members and outbound architecture-entity links live in the membership table
(D1), NOT on the capability row. All PATCH-mutable numerics are boxed.
snake_case wire, NO `@CamelCaseWire` (new entity, no camelCase consumer).

### D6. Review lifecycle

Capability `review_status` mirrors the finding / candidate vocabulary:
`pending_review` / `approved` / `rejected` / `deferred`, plus a
`previous_review_status` audit trail.

- Approving / rejecting a capability does NOT cascade to its members in D2.
  Members keep independent `review_status`; the capability disposition is a
  separate, additive signal.
- Cascade is deferred to the keystone / gate specs.

### D7. JIL parser + output landing

A **hand-rolled key:value parser** (NOT tree-sitter) for `.jil` files,
supporting:

- `insert_job`, `job_type` (c / b / f), `box_name`, `command`, `machine`,
  `condition` (success / done / notrunning / failure), `start_times`,
  `start_mins`, `days_of_week`, `run_calendar`, `alarm_if_fail`,
  `std_out_file` / `std_err_file`.
- Unknown keywords captured into a generic **`attributes`** bag — no hard failure
  on dialects.

The structured topology (boxes / jobs / edges / schedules) lands
**AUTHORITATIVELY in the capability `detail_json`** during synthesis, enriching
(not competing with) the `.jil` file's D1 `operational_artifact` finding. NO new
per-job candidate rows are minted.

### D8. Invocation linkage

Capture the JIL → shell → Java → DB chain as STRUCTURED edges inside the
capability `detail_json`:

- A typed **`invocations[]`** array of
  `{ from, fromKind, to, toKind, mechanism, confidence }`.
- Resolved by FQCN / string match against discovered Java candidates plus D1's
  `detailJson.invokes` strings.
- Do NOT mint `DiscoveryRelationship` / `discovery_candidate` rows for inferred
  cross-language edges.
- Inferred edges carry explicit `confidence` (lower than deterministic edges).

This keeps low-confidence inferred links out of the architecture relationship
tables.

### D9. Dependency on D1

D2 stands alone.

- It consumes D1 `operational_artifact` findings WHEN PRESENT but does NOT
  require them.
- Synthesis also seeds from batch-entrypoint candidates + DB-object findings +
  JIL topology alone, so D2 is fully testable with fixture `.jil` + Java + DB
  inputs and NO D1 run.
- Absent D1 → capabilities have fewer members (graceful degradation).

### D10. Changeset + AMS surface

- Changeset **~184** (183 is the latest on disk:
  `183-migration-reconciliation-break.sql`).
- `184-discovery-capability.sql` with TWO tables: `discovery_capability` +
  `discovery_capability_member`.
- `DiscoveryCapabilityEntity` + `DiscoveryCapabilityMemberEntity`, DTOs, mapper,
  repositories.
- `DiscoveryCapabilityController` + service: list / get / create / bulk-create /
  patch-review.
- **KEEP the patch-review endpoint** even though D2's UI is read-only — it is
  trivial, forward-needed by the D4-gate spec, and avoids a later AMS round-trip.
- Modelled on `MigrationReconciliationBreakEntity` (183) + `DiscoveryFinding`
  patterns. Boxed PATCH-mutable types, snake_case wire.

### D11. Scope boundaries (OUT of D2)

Explicitly out of scope:

- Keystone consumption (capabilities → implementation-ready modernised specs).
- Book-of-work / migration-plan consumption.
- Modernisation spec-generation.
- The Option-B first-class "Discovered Capabilities" tab.

D2 ONLY PRODUCES `discovery_capability` records + members + batch spines.

### D12. Test strategy

- **LLM synthesis:** MOCK the LLM (no live LLM). Assert deterministic
  seed-grouping AND that naming consumes the mocked response.
- **JIL parser:** deterministic unit tests with fixture `.jil` files — boxes,
  file-watcher jobs (`job_type f`), DAG conditions (success / done / notrunning /
  failure), unknown-keyword tolerance.
- **`main()` emission:** a positive test (`public static void main` + batch
  signal → `class` with `batch_entrypoint` marker + captured `-o` flag) PLUS a
  NEGATIVE test that a normal Spring service is unchanged (no emission
  regression).
- **AMS:** changeset / entity tests on H2 (foreground `mvn`, per the H2 2.3
  estate).
- **Tree-sitter:** reuse the EXISTING Java tree-sitter IR; NO bare top-level
  `require('tree-sitter')`.

## Existing Code to Reference

### Verified reuse targets

**AMS — entity / persistence template:**
- `MigrationReconciliationBreakEntity` + `sql/183-migration-reconciliation-break.sql`
  — the changeset / boxed-type / snake_case template for changeset 184.
- `DiscoveryFindingEntity` — boxed `Double` confidence, string `review_status`,
  `previous_review_status` audit pattern.

**discovery-service — LLM + synthesis seams:**
- `gatewayClient.ts` → gateway `src/routes/discoveryGapFill.ts` — the LLM relay
  precedent (`gatewayClient` → gateway route).
- `llmBehaviourCaptureStep.ts` — source-hash caching / determinism (temperature 0)
  pattern to mirror.
- `discoveryV3Pipeline.ts` — the synthesis-step seam, inserted AFTER merge /
  persist.
- `springClassic/index.ts:1792` — the `main()` emission edit point
  (`if (!stereotyped && !nameSuggests) return;`).
- `languageExtractors/java/extract.ts` — the IR already parses `main()`; the gap
  is purely the emission rule.

**frontend — minimal read-only surface:**
- `FindingsTab.tsx` — host for the read-only "Capabilities" section.
- `FindingDetailDrawer.tsx` — expand / member-detail patterns to reuse.
- `findingTypeLabels.ts` — label conventions.

### Do-NOT-reuse (verified)

- `DiscoveryCluster` is `@deprecated` / Phase-1c-only — do NOT reuse it for
  capabilities.

## Visual Assets

No visual assets provided. The optional sketch was declined; `planning/visuals/`
is empty (confirmed by directory check).

## Requirements Summary

### Functional Requirements

- A new findings-side `discovery_capability` grouping (Option A, graduate-able to
  Option B) that aggregates members and links out to architecture entities via a
  dedicated polymorphic membership table.
- A bespoke hand-rolled Autosys JIL parser producing the orchestration topology
  (boxes / jobs / trigger DAG / schedules / machine / file-watchers), with
  unknown-keyword tolerance.
- Plain-Java `main()` batch-entrypoint emission as `class` + child `method`
  candidates, with a `batch_entrypoint` marker and captured operation-flag
  pattern, gated to batch-signal runs only and not regressing Spring emission.
- Structured invocation linkage (JIL → shell → Java → DB) as a typed
  `invocations[]` array inside the capability `detail_json`, resolved by FQCN /
  string match, carrying explicit confidence, with no new relationship /
  candidate rows.
- Deterministic capability synthesis (JIL-DAG transitive closure + co-location /
  shared-external-system / artifactKind heuristic) with LLM naming-only
  (mocked in tests), degrading gracefully to a no-op on zero signals.
- AMS persistence + endpoints (list / get / create / bulk-create / patch-review)
  and a read-only frontend "Capabilities" section inside `FindingsTab`.

### Reusability Opportunities

- 183 reconciliation-break entity + changeset as the 184 capability template.
- `DiscoveryFindingEntity` for the boxed-confidence / review-status / audit-trail
  field pattern.
- `gatewayClient` → gateway relay + `llmBehaviourCaptureStep` caching for the
  naming-only LLM call.
- Existing Java tree-sitter IR (already parses `main()`) for the emission rule.
- `FindingsTab` / `FindingDetailDrawer` for the minimal read-only UI.

### Scope Boundaries

**In Scope:**
- `discovery_capability` + `discovery_capability_member` tables, entities, DTOs,
  mapper, repositories, controller + service (changeset 184).
- JIL parser, plain-Java `main()` emission rule, invocation linkage, capability
  synthesis step (discovery-service).
- Read-only Capabilities section inside `FindingsTab` (frontend).
- Patch-review endpoint (kept despite read-only UI — forward-needed).

**Out of Scope:**
- Keystone consumption (capabilities → modernised specs).
- Book-of-work / migration-plan consumption.
- Modernisation spec-generation.
- Option-B first-class "Discovered Capabilities" tab.
- Capability review actions / cascade UI in the frontend.
- Member cascade on capability approve / reject (deferred to keystone / gate).

### Technical Considerations

- **Owners:** discovery-service (JIL parser, plain-Java `main()` emission rule,
  invocation linkage, capability synthesis step) + AMS (`discovery_capability`
  entity + membership + persistence + endpoints + changeset 184) + frontend
  (read-only Capabilities section inside `FindingsTab`). The synthesis LLM call
  reuses the existing `gatewayClient` → gateway relay pattern; a small dedicated
  gateway route MAY be added if the synthesis prompt diverges (implementation
  detail).
- **Wire format:** snake_case default; NO `@CamelCaseWire` (new entity, no
  camelCase consumer). All PATCH-mutable numerics boxed (avoid the primitive →
  0-on-PATCH wipe).
- **Changeset discipline:** new changeset 184 only; never edit applied
  changesets. Latest on disk is 183.
- **discovery-service is TypeScript:** only edit `discovery-service/src` when no
  discovery run is active. Reuse the existing Java tree-sitter IR; NO bare
  top-level `require('tree-sitter')`.
- **Determinism:** synthesis seeding is deterministic; the LLM is naming-only,
  temperature 0, source-hash cached, and mocked in tests.
- **Graceful degradation:** absent D1 / sparse signals → fewer / smaller seeds;
  zero signals → no-op.
- **No relationship-table pollution:** inferred cross-language edges live in
  `detail_json` with explicit (lower) confidence, NOT in
  `DiscoveryRelationship` / `discovery_candidate`.
- **Forward compatibility:** the `behaviourBearing` aggregate hint in
  `detail_json` and the kept patch-review endpoint are intentional seams for the
  later D4-gate spec.
