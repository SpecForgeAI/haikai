# Task Breakdown: Endpoint→Data-Effect Call Graph for Discovery (Java / Spring Classic first)

## Overview
Total Tasks: 4 task groups (one per layer), approximately 21-31 tests total.

This spec is built in a strict dependency-ordered 3-layer sequence (plus the
frontend on top), because each layer is wired against a working layer beneath
it:

1. **AMS meta-model layer** — the new `endpoint_data_effects` relationship is
   the gating dependency; nothing can persist an edge until this exists.
2. **MCP save-back layer** — persists edges via the new AMS endpoint and
   upgrades the shared `resolveEntityToPointId` identity/matching primitive.
3. **discovery-service extraction layer** — enriches the Java IR with
   call/usage edges and adds the controller→service→repository→entity resolver
   that produces the edge candidates + unresolved-chain findings.
4. **Frontend layer** — surfaces the edge as a new reviewable relationship
   candidate type with expandable read-only path metadata.

Each task group is independently reviewable and committable. Scope is v1:
INBOUND HTTP controller endpoints only (`@RestController`/`@Controller` +
mapping methods), Java / Spring Classic pack only.

**Hard constraints carried from spec.md (honor in every group):**
- AMS DTOs speak `snake_case` at the wire by default — NO `@CamelCaseWire`
  annotation (per CLAUDE.md); gateway proxy + discovery AMS client + frontend
  API typings all stay snake_case.
- Liquibase: add a NEW changeset file only; NEVER edit an applied changeset
  (even comment-only edits break startup via checksum validation). Next free
  number is `161` under `db/changelog/sql/`.
- Do NOT edit `discovery-service/src/**` while a discovery run is in flight
  (`tsx watch` auto-reload kills runs) — do Task Group 3 only when no run is
  active.
- Do NOT add `class`/`method` as candidate types; method identity (FQN +
  signature) is substrate stamped onto path hops + `business_logics` only.
- Do NOT introduce any new "needs confirmation" candidate state or any mid-run
  interactive prompt.

## Task List

### AMS Meta-Model Layer (architecture-model-service)

#### Task Group 1: `endpoint_data_effects` Relationship Entity, DTO, Repository, Mapper, Service/Controller, Liquibase
**Dependencies:** None

- [x] 1.0 Complete the AMS `endpoint_data_effects` relationship surface
  - [x] 1.1 Write 4-6 focused Java tests for the new relationship surface
    - Limit to 4-6 highly focused tests maximum (follow existing AMS test
      style, e.g. `DiscoveryFindingBulkReviewTest` / the repository+service
      tests under `src/test/java/.../discovery`).
    - Critical cases only:
      - Round-trip: persist an `endpoint_data_effects` row
        (`endpoint_id` → `data_entity_point_id` + `access_mode` +
        `path_metadata_json`) and read it back via the repository.
      - DTO ↔ entity mapping preserves `access_mode`, `confidence`, and the
        structured `path_metadata_json` payload (no field loss).
      - Wire format is `snake_case` end-to-end (serialize the DTO and assert
        snake_case keys; assert NO camelCase leakage).
      - `findByModelFileId` / `findByEndpointId` return the expected rows and
        `deleteByModelFileId` removes them (model-file scoping).
      - (Optional) `access_mode` accepts each of `read` / `write` /
        `read-write`; rejects an unknown value if validation is added.
    - Skip exhaustive coverage of every column and getter/setter.
  - [x] 1.2 Create JPA entity `EndpointDataEffectEntity`
    - Place under `model/entity/discovery/` (alongside the discovery entities)
      OR mirror `InterfaceLogicalEntityEntity`'s package — match the precedent
      it is modeled on.
    - Model on `InterfaceLogicalEntityEntity.java` (which carries `direction`
      + `dataEntityPointId`): `@Entity`, `@Table(name = "endpoint_data_effects")`,
      Lombok `@Getter/@Setter/@NoArgsConstructor/@AllArgsConstructor/@Builder`.
    - Columns: `id` (TEXT PK), `model_file_id` (NOT NULL),
      `endpoint_id` (NOT NULL), `data_entity_point_id` (NOT NULL — uses the
      `dep_log_`/`dep_phy_` convention, NOT a raw entity FK),
      `access_mode` (TEXT — `read`/`write`/`read-write`),
      `path_metadata_json` (TEXT/JSON — structured ordered hop list + operation
      hint + `transactional` flag), `confidence` (DOUBLE — boxed `Double`, NOT
      primitive, per the repo's PATCH-safety memory),
      plus `description`, `tags`, `valid_from`, `valid_to` to match the
      precedent.
  - [x] 1.3 Create DTO `EndpointDataEffectDto`
    - Java record modeled on `InterfaceLogicalEntityDto`.
    - Relies on the global Jackson `SNAKE_CASE` strategy in `application.yml`;
      explicit `@JsonProperty("snake_case_name")` declarations are fine
      (belt-and-braces, consistent with the precedent). NO `@CamelCaseWire`.
    - Carry `endpoint_id`, `data_entity_point_id`, `access_mode`, `confidence`,
      and `path_metadata_json` (the structured hop list — keep it a typed
      nested shape or a passthrough JSON node so a future call-tree UI needs no
      migration).
  - [x] 1.4 Create repository `EndpointDataEffectRepository`
    - Model on `InterfaceLogicalEntityRepository`:
      `extends JpaRepository<EndpointDataEffectEntity, String>` with
      `findByModelFileId`, `findByEndpointId`, and `deleteByModelFileId`.
  - [x] 1.5 Create mapper `EndpointDataEffectMapper`
    - Place under `mapper/discovery/` (or alongside the relationship mappers)
      following the existing mapper style; map entity ↔ DTO both directions.
  - [x] 1.6 Wire the relationship into the service/controller save-back surface
    - Hang the new relationship off the SAME save-back/PUT path the other
      discovery relationships use (the model PUT that already persists
      `interface_logical_entities` /
      `logical_data_entity_physical_data_entities`). Do NOT overload the
      endpoint's `request_/response_data_entity_point_id` columns or the
      `interface_logical_entities` table.
    - Include `endpoint_data_effects` in the DELETE-ALL → re-INSERT in
      FK-dependency order (after `endpoints` and data-entity-points exist), and
      in the model read/export surface so the frontend can fetch it.
  - [x] 1.7 Create the NEW Liquibase changeset
    - New SQL file `db/changelog/sql/161-endpoint-data-effects.sql` defining the
      `endpoint_data_effects` table (FK `model_file_id` → `model_files(id)`
      `ON DELETE CASCADE`, mirror the column shape from 1.2; index on
      `model_file_id` and `endpoint_id`). Model on `015-business-logic.sql`.
    - Register a NEW `changeSet` block in `db.changelog-master.yaml` with a
      `tableExists` precondition (`onFail: MARK_RAN`) per the existing pattern.
      Do NOT edit any applied changeset.
  - [x] 1.8 Expose the snake_case wire to downstream consumers (typings only)
    - Add `endpoint_data_effects` to the discovery-service AMS client model
      typings and the frontend API module typings (snake_case), and confirm the
      gateway model proxy passes it through (it proxies the whole model, so
      typically no route change — verify, do not assume).
  - [x] 1.9 Run ONLY the 4-6 tests written in 1.1
    - Verify the new changeset applies cleanly on a fresh DB.
    - Do NOT run the entire AMS test suite at this stage.

**Acceptance Criteria:**
- The 4-6 tests from 1.1 pass; the new changeset applies on a clean DB.
- `endpoint_data_effects` persists `endpoint_id`, `data_entity_point_id`,
  `access_mode`, `confidence`, and structured `path_metadata_json`; round-trips
  in `snake_case` with no field loss.
- Data entity referenced via the `dep_log_`/`dep_phy_` point convention, not a
  raw entity FK.
- No applied changeset edited; no `@CamelCaseWire` added; payload columns and
  `interface_logical_entities` untouched.

### MCP Save-Back Layer (mcp-server)

#### Task Group 2: Persist Edge Candidates + Upgrade the Shared Identity/Matching Primitive
**Dependencies:** Task Group 1

- [x] 2.0 Complete edge persistence and the normalized-name + confidence matcher
  - [x] 2.1 Write 5-7 focused Jest tests
    - Limit to 5-7 highly focused tests maximum (follow the existing
      `candidateSaveBackService` test style).
    - Critical cases only:
      - `resolveEntityToPointId` resolves `Owner` to the SAME point id as
        `owners` / `OWNER` (normalized-name match — the duplication fix), via
        both logical and physical arrays.
      - Returns the existing exact-match result unchanged when an exact name is
        present (no regression for the ~1232–1393 call sites).
      - Below-threshold fuzzy match returns the resolved point id PLUS a LOW
        confidence (the matcher exposes a confidence, not just a string).
      - Genuinely unresolved name returns the unresolved outcome (null/flag) so
        the caller can route it to a finding rather than fabricate a point id.
      - An `endpoint_data_effects` candidate converts to the correct relationship
        row: `endpoint_id` resolved via the primitive (endpoint side),
        `data_entity_point_id` resolved via the primitive (entity side),
        `access_mode` + `confidence` + `path_metadata_json` carried through.
      - The new candidate type maps to the `relationships` section /
        `endpoint_data_effects` target array (parallel to
        `interface_logical_entities`).
    - Skip exhaustive normalization-rule coverage.
  - [x] 2.2 Extract a cohesive, parameterized identity/matching primitive
    - Refactor `resolveEntityToPointId` (in
      `mcp-server/src/services/candidateSaveBackService.ts`, currently exact-name
      only at ~226–237) from exact-string to normalized-name + confidence
      matching. Normalize on case, singular/plural, and separators
      (`Owner`≈`owners`).
    - Design as the SHARED primitive (later reused by the DB structural-fidelity
      spec and model-aware enrichment): keep it cohesive and parameterized
      (e.g. return `{ pointId, confidence, matchKind }`), NOT inlined. Do not
      hard-code the edge use case into it.
    - Preserve the existing public signature/behavior for the current call sites
      (~1232–1393) — add a thin compat shim if the richer return shape would
      otherwise break them, so they keep working unchanged.
  - [x] 2.3 Register the `endpoint_data_effects` candidate type
    - Add an entry to `CANDIDATE_TYPE_CONFIG` (target section `relationships`,
      target array `endpoint_data_effects`, an id prefix e.g. `ede-`,
      `parentFkField: null`) — model exactly on the
      `interface_logical_entities` entry.
  - [x] 2.4 Convert edge candidates to relationship rows
    - Add an `endpoint_data_effects` branch in `convertCandidateToEntity` (or its
      relationship sibling) that resolves the endpoint side and the
      data-entity-point side THROUGH the primitive from 2.2 and emits the AMS
      row shape from Task Group 1 (`endpoint_id`, `data_entity_point_id`,
      `access_mode`, `confidence`, `path_metadata_json`).
    - Reuse the existing 0.75 auto-accept threshold
      (`CANDIDATE_AUTO_ACCEPT_THRESHOLD`); do NOT add a new candidate state.
  - [x] 2.5 Run ONLY the 5-7 tests written in 2.1
    - Also run the existing `candidateSaveBackService` tests covering the
      ~1232–1393 call sites to confirm no regression from the primitive upgrade.
    - Do NOT run the entire mcp-server suite at this stage.

**Acceptance Criteria:**
- The 5-7 tests from 2.1 pass; existing `resolveEntityToPointId` call sites
  still pass.
- `Owner`/`owners` resolve to the same point id (duplication fixed).
- Matcher is cohesive, parameterized, and reusable (returns a confidence, not
  just a string); both edge sides resolve through it.
- `endpoint_data_effects` candidates persist as the AMS relationship row from
  Task Group 1; no new candidate state introduced.

### discovery-service Extraction Layer (discovery-service)

> Do NOT edit `discovery-service/src/**` while a discovery run is in flight.

#### Task Group 3: Java IR Call/Usage Enrichment + Spring Classic Resolver + Findings
**Dependencies:** Task Groups 1 & 2

- [x] 3.0 Complete IR enrichment, the resolver, and unresolved-chain findings
  - [x] 3.1 Write 6-9 focused Vitest/Jest tests (per the discovery test style)
    - Limit to 6-9 highly focused tests maximum.
    - Critical cases only:
      - IR enrichment: a method node carries its calls + autowired field uses
        and its stable method id (FQN + signature, e.g.
        `com.foo.OwnerService#save(Owner)`).
      - Happy-path resolve: `OwnerController.create` →
        `@Autowired OwnerService#save(Owner)` → `@Autowired OwnerRepository`
        (`JpaRepository<Owner,Long>`) yields a single edge with
        `access_mode: write`, operation hint `insert`/`update`, and a 3-hop
        structured path.
      - Read path: a `findBy…` repository method yields `access_mode: read`,
        operation hint `select`.
      - Entity resolution via repository generic type param
        (`JpaRepository<Owner,Long>` → `Owner`) AND via already-captured
        `@Entity`/`@Table`.
      - Single-interface-impl: an interface with exactly ONE implementing class
        in the scanned set resolves through the impl.
      - `@Transactional` on the method/class in the resolved path stamps
        `transactional: true` (else `false`).
      - One edge PER (endpoint, data-entity): an endpoint touching `Owner` and
        `Visit` emits TWO edges.
      - Unresolved chain (multiple impls / dynamic dispatch / `JdbcTemplate` /
        native SQL / `EntityManager.createQuery` / reflection / too-deep) emits a
        FINDING with endpoint identity + where resolution stopped — and NO
        fabricated edge.
      - Low-confidence-but-resolved emits a normal edge candidate carrying a LOW
        confidence (NOT a finding).
    - Skip exhaustive AST-shape and annotation-permutation coverage.
  - [x] 3.2 Enrich the Java IR with intra-method call/usage edges
    - Under `discovery-service/src/services/extensionPacks/languageExtractors/java`
      (`javaParser.ts` / `extract.ts` / `astUtils.ts`), capture per method: the
      calls it makes and the autowired fields it uses (enough to walk
      controller→service→repository).
    - Stamp every method node with its stable method id (FQN + signature) for
      keying.
    - Wire through the existing `uses_data` relationship type in
      `discovery-service/src/types/relationship.ts` (this spec is its first
      producer) for the edge.
    - This is genuinely NEW cross-file work — not call-site detection like
      `angularJsClassic` `$http`.
  - [x] 3.3 Add the controller→service→repository→entity resolver
    - NEW resolver in the Spring Classic adapter
      (`extensionPacks/frameworkAdapters/springClassic/index.ts`) walking:
      controller mapping method → autowired `@Service`/`@Component` field → its
      method → autowired `@Repository`/Spring-Data interface field → entity.
    - Resolve the entity via the repository generic type param OR the captured
      `@Entity`/`@Table`. Include single-interface-impl resolution (exactly one
      impl in the scanned set).
    - Derive `access_mode` + operation hint from repository/method semantics
      (`save`→write/insert-or-update, `findBy`→read/select, `delete`→write/delete);
      derive `transactional` from `@Transactional` presence in the resolved path.
    - Persist ONLY the relevant subgraph (hops on an endpoint→data path +
      rule-bearing methods); discard the rest of the call graph from persistence.
  - [x] 3.4 Emit edge candidates via the existing controller traversal
    - Hang the resolver off `processController` + `controllerToDtos` in
      `springClassic/index.ts` (the existing endpoint/candidate emit point that
      already emits `interface_logical_entities` /
      `logical_data_entity_physical_data_entities`).
    - Emit ONE `endpoint_data_effects` candidate per (endpoint, data-entity) pair
      with `access_mode`, operation hint, `transactional`, `confidence`, and the
      structured ordered hop list (each hop = FQN + method signature).
    - Apply the three-outcome confidence model: ≥0.75 → normal candidate;
      <0.75 but resolved → normal candidate carrying a LOW confidence;
      unresolved → finding (3.5). No new candidate state, no interactive prompt.
    - Limit edges to INBOUND HTTP controller endpoints only
      (`@RestController`/`@Controller` + mapping methods); async/outbound get
      NO edges in v1.
  - [x] 3.5 Emit findings for unresolved chains
    - Reuse `FindingEmitter.ts` + `springClassicFindingScanner.ts` to emit a
      Finding ("endpoint X touches data we could not statically resolve") for
      multiple impls / dynamic dispatch / `JdbcTemplate` / native SQL /
      `EntityManager.createQuery` / reflection / hops deeper than the resolver
      handles.
    - Include enough context (endpoint identity + where resolution stopped) to
      make the finding actionable. Never silently drop a data effect.
  - [x] 3.6 Stamp the stable method id onto path hops + `business_logics`
    - Stamp FQN + signature onto path hops AND emitted `business_logics`
      candidates (substrate keying only).
    - Do NOT attach behaviour to methods (Gap C / Spec 2) and do NOT add
      `class`/`method` as candidate types.
  - [x] 3.7 Run ONLY the 6-9 tests written in 3.1
    - Do NOT run the entire discovery-service suite at this stage.

**Acceptance Criteria:**
- The 6-9 tests from 3.1 pass.
- Java IR methods carry call/usage edges + stable method id; only the relevant
  subgraph is persisted.
- Resolver covers the Spring Classic happy path + single-interface-impl; derives
  `access_mode`, operation hint, and `transactional` correctly.
- One edge per (endpoint, data-entity); inbound HTTP controllers only.
- Three-outcome confidence model honored; unresolved chains become findings with
  actionable context; no silent drops; no new candidate state.

### Frontend Layer (frontend)

#### Task Group 4: Surface the Edge Candidate with Read-Only Expandable Path Metadata
**Dependencies:** Task Groups 1, 2 & 3

- [x] 4.0 Surface `endpoint_data_effects` in the existing Candidates review stream
  - [x] 4.1 Write 3-5 focused Vitest tests (per the existing candidate-table /
        candidate-details test style under `components/DashboardView/__tests__`)
    - Limit to 3-5 highly focused tests maximum.
    - Critical cases only:
      - An `endpoint_data_effects` candidate renders in the Candidates stream as
        a relationship candidate with its `access_mode` and endpoint→entity
        identity visible.
      - The controller→service→repository path renders as read-only, EXPANDABLE
        metadata (each hop = FQN + method signature) and is collapsed by default.
      - A low-confidence-but-resolved edge renders in the NORMAL stream (not the
        Findings tab) and shows its low confidence.
      - (Optional) Approve/reject acts on the edge candidate like any other
        relationship candidate (reuse existing review actions).
    - Skip exhaustive rendering-state coverage.
  - [x] 4.2 Add the candidate type to the frontend taxonomy
    - Register `endpoint_data_effects` as a NEW reviewable relationship candidate
      type wherever candidate types/labels are enumerated (so it routes into the
      existing Candidates stream — reuse `DiscoveryCandidateTable` /
      `CandidateDetailsPanel` / `candidateDetailsSupport`). No new UI layer.
  - [x] 4.3 Render read-only expandable path metadata
    - In the candidate details surface, render `path_metadata_json` as a
      read-only, expandable ordered hop list (FQN + method signature per hop),
      plus the operation hint and `transactional` flag. Reuse the existing
      expansion pattern (`candidateDetailsExpansion`). No graph visualization,
      no per-hop approve/reject.
  - [x] 4.4 Confirm unresolved-chain findings already surface
    - Verify unresolved-chain findings appear in the existing `FindingsTab` /
      `FindingDetailDrawer` with no frontend change beyond what the existing
      findings pipeline already renders (the finding type from 3.5 should flow
      through). Add a label mapping only if the new finding type needs a
      human-readable label.
  - [x] 4.5 Add snake_case API typings for the edge (if not already from 1.8)
    - Ensure the frontend findings/model API typings expose the
      `endpoint_data_effects` fields in `snake_case` consistent with AMS.
  - [x] 4.6 Run ONLY the 3-5 tests written in 4.1
    - Do NOT run the entire frontend suite at this stage.

**Acceptance Criteria:**
- The 3-5 tests from 4.1 pass.
- `endpoint_data_effects` edges render in the EXISTING Candidates stream as a new
  reviewable relationship candidate type; path renders as read-only expandable
  metadata.
- Low-confidence-but-resolved edges appear in the normal stream (not Findings);
  unresolved chains appear in the existing Findings tab.
- No new UI layer and no graph visualization added; typings stay snake_case.

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. AMS Meta-Model Layer (Task Group 1) — gating dependency
2. MCP Save-Back Layer (Task Group 2)
3. discovery-service Extraction Layer (Task Group 3) — only when no run is in flight
4. Frontend Layer (Task Group 4)
