# Task Breakdown: SOAP/WSDL Message-Field Depth for Discovery (Spec 4)

## Overview
Total Tasks: 7 task groups

This is the LARGEST spec of the discovery-richness program and its core is DETERMINISTIC (no LLM, no gateway relay). The groups MUST be built in the strict layering order below; each group depends on the prior one (AMS schema is the gate; save-back cannot resolve fields the discovery groups have not emitted; the frontend renders what save-back persists).

### Program-wide cautions (apply to EVERY group)

- **Do NOT restore/checkout/revert files from HEAD.** ALL prior specs of this program -- Issue 1, Spec 1 (endpoint->data-effect), Spec 2, Spec 3 (structural fidelity / `constraints_metadata`), and Issue 2 (model-aware dedup / `link` / `operation` column) -- are UNCOMMITTED in the working tree. A `git checkout`/`git restore`/`git stash` would destroy them. Only ADD new files and EXTEND existing ones; never roll anything back.
- **Reuse, do not fork.** Reuse Spec 1's `endpointDataEffectResolver`, Issue 2's model-aware dedup + the save-back identity primitive (`normalizeNameForMatch` / `matchByNormalizedName` / `resolveEntityPoint`), the `dep_log_<id>` convention, the existing SOAP scanners, and the Spec 1/Spec 3 frontend rendering patterns. Do not re-implement any of them.
- **Never create/modify `*_points` wrappers directly, and never synthesize a 1:1 logical<->physical mapping.** `data_entity_points` are backend auto-managed; `dep_log_<id>` is synthesized at save-back only.
- **Findings are reserved for the genuinely-unmodellable cases** (no parsable schema AND no parsable Java DTO; multi-part/RPC-style messages; cycle/depth-cap stops; data chains the resolver cannot statically resolve). Field structure, cardinality, nullability, and value-domain restrictions are ARCHITECTURE and land on the entity/attribute, NOT as loose Findings.

---

## Task List

### AMS Meta-Model Layer (schema gate)

#### Task Group 1: New on-attribute JSONB metadata column + on-entity provenance
**Dependencies:** None (this is the gate -- nothing downstream can be saved until it lands)

- [x] 1.0 Complete the AMS schema + DTO change
  - [x] 1.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum.
    - Cover only critical behaviours: the new attribute JSONB metadata blob round-trips (cardinality `min_occurs`/`max_occurs`/`is_collection` + restrictions `enumeration`/`pattern`/`minLength`/`maxLength`/`minInclusive`/`maxInclusive`/`totalDigits`/`fractionDigits` + xsd source-type) on a `LogicalDataAttribute` write/read; the new provenance field round-trips on a `LogicalDataEntity`; a PATCH that omits the JSONB / provenance does NOT null it (boxed-type PATCH safety, per `project_primitive_double_dto_overwrite.md`); and `is_nullable` is UNAFFECTED (still a real `Boolean` column, not overloaded).
    - Skip exhaustive coverage of every restriction permutation and every column.
  - [x] 1.2 Add the NEW Liquibase changeset `167-...sql` under `architecture-model-service/src/main/resources/db/changelog/sql/`
    - ONE new nullable JSONB column on `logical_data_attributes` holding cardinality (`min_occurs`/`max_occurs`/`is_collection`) + value-domain restrictions + the XSD source-type string -- a SINGLE blob, NOT ~8 typed columns.
    - PLUS one small provenance column on `logical_data_entities` (source namespace / originating DTO class name; a plain text/JSONB field as the existing entity columns dictate).
    - Mirror `164-physical-entity-constraints-jsonb.sql` (single nullable JSONB-on-entity, additive) and `161-endpoint-data-effects.sql` (JSONB + boxed-`Double` typing). `is_nullable` stays a real column mapped from `nillable` -- do NOT touch or overload it.
    - **Caution:** create a NEW file `167-...sql`; NEVER edit an applied changeset (even comment-only edits break startup via checksum validation, per `feedback_liquibase_immutable_changesets.md`). 166 is Issue 2's `discovery-candidate-operation.sql` -- 167 is the next free number off the working tree.
    - **Caution:** do NOT restore/revert any working-tree file -- 165/166 and all prior changesets are uncommitted; only ADD `167`.
  - [x] 1.3 Register `167` in `db.changelog-master.yaml`
    - Append a new `changeSet` block following the 165/166 `sqlFile` pattern (`relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`).
    - preConditions: `onFail: MARK_RAN` + `onError: HALT` + `not: columnExists` guard for EACH new column (the attribute JSONB column AND the entity provenance column) -- add a `tableExists` guard too if the prior-spec table-creating changesets are themselves still uncommitted in this tree.
  - [x] 1.4 Surface the JSONB metadata on `LogicalDataAttributeEntity` + `LogicalDataAttributeDto`
    - Use the EXACT Hypersistence idiom from `PhysicalDataEntityEntity.constraintsMetadata`: `@Type(JsonType.class) @Column(name="...", columnDefinition="jsonb") Map<String,Object>`.
    - snake_case wire (global default) -- NO `@CamelCaseWire` (no camelCase consumer is introduced).
  - [x] 1.5 Surface the provenance field on `LogicalDataEntityEntity` + `LogicalDataEntityDto`
    - Plain `@Column` field beside the existing entity columns; snake_case wire; NO `@CamelCaseWire`.
    - Ensure the mapper(s) carry both new fields through additively.
  - [x] 1.6 Mark Task Group 1 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 1.1 (the AMS module test(s) for this change). Do NOT run the entire AMS suite.
    - Live AMS startup / Liquibase application leans on the USER's environment (do not start Spring Boot yourself per `feedback_user_starts_services`).

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `167-...sql` exists as a NEW changeset and is registered in the master with columnExists `MARK_RAN` guards; no applied changeset was edited.
- The attribute JSONB metadata blob and the entity provenance field round-trip snake_case; a PATCH omitting them does not null them; `is_nullable` is untouched.
- No prior-spec working-tree file was reverted.

---

### Discovery Layer -- deep XSD walker

#### Task Group 2: Deepen `wsdlParser.ts` from name-only to full field depth
**Dependencies:** Task Group 1

- [x] 2.0 Deepen the deterministic XSD field walker
  - [x] 2.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum, offline (pure parse, no I/O, no LLM) -- like Spec 3.
    - Cover only critical behaviours: per-field name + type extraction; cardinality mapping (`minOccurs=0`->optional, `maxOccurs>1`/`unbounded`->`is_collection`); nullability from `nillable="true"` kept DISTINCT from `minOccurs=0`; at least one value-domain restriction (e.g. `xsd:enumeration` and one of `pattern`/`minLength`/`minInclusive`); a nested complex type walked one level; cycle detection STOPS with a Finding (not an infinite loop); `xsd:extension` base-type fields folded into the derived child.
    - Skip exhaustive coverage of every restriction facet and every nesting permutation.
  - [x] 2.2 Extend `springClassicSoap/wsdlParser.ts` to emit full field depth
    - Per field: `name`, XSD source `type` (captured AS-IS, NO normalization), cardinality (`minOccurs`/`maxOccurs`->optional/collection), nullability (`nillable`).
    - Value-domain restrictions: `xsd:enumeration`, `xsd:pattern`, `minLength`/`maxLength`, `minInclusive`/`maxInclusive`, `totalDigits`/`fractionDigits` -- shaped to drop into the on-attribute JSONB metadata blob defined in Group 1.
    - Keep it pure / side-effect-free / deterministic; preserve the existing soft-fail (`parseError` -> `wsdl_parse_failed`) behaviour.
  - [x] 2.3 Walk nested/derived complex types to an ENV-TUNABLE depth cap
    - Mirror Spec 2's env-tunable cap pattern; on hitting the cap, STOP and emit a depth-cap Finding (do NOT silently truncate without record).
  - [x] 2.4 Cycle detection and `xsd:extension` folding
    - Detect type cycles (e.g. `Employee -> manager : Employee`) and STOP with a Finding rather than loop.
    - Fold `xsd:extension` base-type fields into the derived child entity (the child carries the inherited fields).
  - [x] 2.5 Multi-part / RPC-literal detection -> Finding-and-defer
    - v1 fully supports doc-literal-wrapped single-part. Detect multi-part / RPC-literal/encoded shapes and emit the Finding ("operation X uses a multi-part/RPC-style message not fully expanded") rather than mis-modelling -- extend the `soapEvidenceGaps.ts` Finding-builder pattern for the new Finding cases.
  - [x] 2.6 Mark Task Group 2 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 2.1 (the `wsdlParser` offline test(s)). Do NOT run the entire discovery suite.
    - Live end-to-end parsing of a real WSDL/XSD leans on the USER's environment.
  - **Caution (this group):** do NOT edit `discovery-service/src/**` during an in-flight discovery run -- `tsx watch` auto-reload kills runs (`feedback_no_src_edits_during_run`). Only edit when no run is active.
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- Specs 1/2/3 and Issue 2 are uncommitted; DEEPEN `wsdlParser.ts` in place, do not fork or reset it.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- `wsdlParser.ts` emits per-field name/type/cardinality/nullability/restrictions at full depth; nested/derived types walked to the env-tunable cap; cycles and depth-cap stop with Findings; `xsd:extension` base fields folded into the child.
- `minOccurs=0` (optional) and `nillable="true"` (present-but-null) are kept distinct; XSD source-type is captured with no normalization.
- Existing soft-fail behaviour preserved; the parser stays pure/deterministic.
- No prior-spec working-tree file was reverted.

---

### Discovery Layer -- Java DTO field parser

#### Task Group 3: New deterministic Java-DTO field parser
**Dependencies:** Task Group 2

- [x] 3.0 Build the new deterministic Java-DTO field parser
  - [x] 3.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum, offline (pure parse, no LLM) -- like Spec 3.
    - Cover only critical behaviours: extract field `name` + `type` from an annotated `@RequestWrapper`/`@ResponseWrapper` / JAXB `@XmlType` DTO class; collection-ness inferred (`List<T>`/`T[]` -> collection); nullability inferred (boxed vs primitive / `@XmlElement(nillable/required)` where present); a class with NO parsable fields degrades gracefully (no throw).
    - Skip exhaustive coverage of every JAXB annotation permutation.
  - [x] 3.2 Add the NEW parser module (deterministic, no LLM, no gateway relay)
    - Reads the annotated Java DTO class FIELDS: `name`, `type`, collection-ness, nullability.
    - Offline-testable; pure parsing only. Place alongside the SOAP scanners (e.g. under `springClassicSoap/`) so it composes with the existing signals.
  - [x] 3.3 Shape the parser output to the shared field model
    - Emit the same per-field shape the WSDL walker (Group 2) produces, so Group 4's reconciliation can compare the two views field-for-field.
    - This parser is the ONLY field source for annotation-only / no-WSDL services -- it must stand alone.
  - [x] 3.4 Mark Task Group 3 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 3.1 (the Java-DTO-parser offline test(s)). Do NOT run the entire discovery suite.
    - Live end-to-end against a real source tree leans on the USER's environment.
  - **Caution (this group):** do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch` reload kills runs).
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- only ADD the new parser; prior specs are uncommitted.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- The parser extracts field name/type/collection-ness/nullability from `@RequestWrapper`/`@ResponseWrapper` / `@XmlType` classes deterministically (no LLM).
- Output shape matches the WSDL walker's field model so reconciliation can compare them.
- Annotation-only / no-WSDL services get field depth from this parser alone.
- No prior-spec working-tree file was reverted.

---

### Discovery Layer -- reconciliation + emission

#### Task Group 4: Reconcile WSDL<->Java and emit entities/attributes/relationships/bindings
**Dependencies:** Task Groups 2 and 3

- [x] 4.0 Reconcile the two field views and emit the SOAP message-shape candidates
  - [x] 4.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum, offline.
    - Cover only critical behaviours: WSDL-view and Java-view of the SAME message reconcile to ONE entity (no duplicate) via the identity primitive + `link`/dedup concept (reuse Issue 2's primitive); a NAMED complex type emits ONE SHARED `logical_data_entity` referenced by a `logical_data_entity_relationship` (NOT inlined per message); attributes carry the cardinality + restriction JSONB metadata blob; `interface_logical_entities` links the interface to its message types; the endpoint request/response message bindings are emitted; a service with NEITHER a parsable schema NOR a parsable Java DTO emits a Finding (and only then).
    - Skip exhaustive coverage of every reconciliation edge case.
  - [x] 4.2 Implement the reconciliation pass (WSDL/XSD view <-> Java-DTO view)
    - REUSE Issue 2's identity primitive + `link`/dedup concept; resolve to a single entity per logical message type. Do NOT re-implement dedup.
    - When only one source is parsable, use it; when both are, reconcile field-for-field.
  - [x] 4.3 Emit the candidates via `soapEndpointEmitter.ts` / `contractCandidates.ts`
    - `logical_data_entities`: ONE shared entity per NAMED complex type (referenced by relationship, NOT inlined), each carrying the PROVENANCE field (source namespace / originating DTO class name) from Group 1.
    - `logical_data_attributes`: one per field, carrying the cardinality + restriction + XSD-source-type JSONB metadata blob; `is_nullable` set from `nillable`.
    - `logical_data_entity_relationships`: the shared-type references between messages and named types.
    - `interface_logical_entities`: link the interface to the message types it exposes (REUSE; not a new type).
    - Endpoint request/response message bindings (to be resolved to `dep_log_<id>` at save-back -- never create `*_points` here).
  - [x] 4.4 Wire the deepened SOAP step + Java parse + reconciliation pass into `discoveryV3Pipeline.ts`
    - The existing scanners stay AS-IS for operation/interface detection; this group adds the message-shape emission downstream of them.
  - [x] 4.5 Mark Task Group 4 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 4.1 (the reconciliation/emission offline test(s)). Do NOT run the entire discovery suite.
    - Live end-to-end emission leans on the USER's environment.
  - **Caution (this group):** do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch` reload kills runs).
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- EXTEND `soapEndpointEmitter.ts` / `contractCandidates.ts` / `discoveryV3Pipeline.ts` in place; prior specs are uncommitted.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- WSDL and Java views of a message reconcile to ONE entity via the reused identity primitive; named complex types are shared (one entity, referenced by relationship), not inlined.
- Attributes carry the cardinality + restriction JSONB metadata blob; `is_nullable` comes from `nillable`; provenance sits on the entity.
- `interface_logical_entities` + endpoint request/response bindings emitted; a Finding is emitted ONLY when neither source is parsable.
- No prior-spec working-tree file was reverted.

---

### Discovery Layer -- SOAP operation->DB data-effect

#### Task Group 5: SOAP entry-point feeding Spec 1's resolver -> `endpoint_data_effects`
**Dependencies:** Task Group 4

- [x] 5.0 Add the SOAP entry-point and emit SOAP `endpoint_data_effects`
  - [x] 5.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum, offline.
    - Cover only critical behaviours: a Spring-WS `@Endpoint`/`@PayloadRoot` handler is detected as a SOAP entry-point; a JAX-WS `@WebMethod` handler is detected; the detected entry-point feeds Spec 1's `endpointDataEffectResolver` and yields an `endpoint_data_effects` row with the IDENTICAL Spec 1 shape (`access_mode`, `path_metadata_json` call chain, operation hint insert/update/delete/select, `transactional`); an unresolvable chain becomes a Finding (not a fabricated edge).
    - Skip exhaustive coverage of every handler permutation.
  - [x] 5.2 Implement SOAP entry-point detection (the ONLY new part)
    - Detect `@Endpoint`/`@PayloadRoot` (Spring-WS) and `@WebMethod` (JAX-WS) handler methods as entry-points.
  - [x] 5.3 Feed the entry-point into Spec 1's `endpointDataEffectResolver` -- REUSE, do NOT fork
    - The downstream service->repository->entity walk is reused VERBATIM (`endpointDataEffectResolver.ts` under `extensionPacks/frameworkAdapters/springClassic/`). Spec 4 only supplies the SOAP entry-point.
  - [x] 5.4 Emit `endpoint_data_effects` rows for SOAP operations
    - Same shape as Spec 1; unresolved chains become Findings (Spec 1's existing behaviour), never fabricated edges.
    - Wire this SOAP data-effect step into `discoveryV3Pipeline.ts` alongside Group 4's emission.
  - [x] 5.5 Mark Task Group 5 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 5.1 (the SOAP data-effect offline test(s)). Do NOT run the entire discovery suite.
    - Live end-to-end resolution leans on the USER's environment.
  - **Caution (this group):** do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch` reload kills runs).
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- REUSE `endpointDataEffectResolver.ts` unchanged and add only the new entry-point; Spec 1 and all prior specs are uncommitted.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- Spring-WS (`@Endpoint`/`@PayloadRoot`) and JAX-WS (`@WebMethod`) handlers are detected as SOAP entry-points.
- The entry-point feeds Spec 1's resolver UNCHANGED and emits `endpoint_data_effects` rows with the identical Spec 1 shape; unresolvable chains become Findings.
- No prior-spec working-tree file was reverted.

---

### MCP Save-Back Layer

#### Task Group 6: Resolve + dedup + bind the SOAP-derived candidates in `candidateSaveBackService.ts`
**Dependencies:** Task Group 5

- [x] 6.0 Extend save-back to persist the SOAP message-shape + data-effect candidates
  - [x] 6.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum.
    - Cover only critical behaviours: the new SOAP `logical_data_entities` / `logical_data_attributes` resolve + dedup through the existing candidate arms (no duplicate on re-run, via the reused identity primitive + Issue 2 dedup/`link`); a WSDL-vs-Java duplicate reconciles to ONE persisted entity; the JSONB metadata blob + provenance pass through as additive payload; `interface_logical_entities` is written; the endpoint `request_data_entity_point_id` / `response_data_entity_point_id` resolve to `dep_log_<id>`; the SOAP `endpoint_data_effects` rows persist.
    - Skip exhaustive coverage of every candidate-arm permutation.
  - [x] 6.2 Resolve + dedup the new entities/attributes -- REUSE the identity primitive + Issue 2 dedup
    - Reuse `normalizeNameForMatch` / `matchByNormalizedName` / `resolveEntityPoint` and Issue 2's model-aware dedup/`link`; do NOT re-implement dedup.
    - Reconcile WSDL<->Java duplicates through the SAME identity primitive.
    - Pass the new attribute JSONB metadata blob and the entity provenance field through as additive payload (parent-FK `logical_entity_id` resolution unchanged).
  - [x] 6.3 Write `interface_logical_entities` and bind the endpoint point-ids
    - Bind `request_data_entity_point_id` / `response_data_entity_point_id` via the `dep_log_<id>` convention synthesized at save-back.
    - NEVER create/modify `*_points` wrappers directly; NEVER synthesize a 1:1 logical<->physical mapping.
  - [x] 6.4 Persist the SOAP `endpoint_data_effects` rows
    - Through the existing Spec 1 data-effect save path (same `dep_log_`/`dep_phy_` data-entity-point convention).
  - [x] 6.5 Mark Task Group 6 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 6.1 (the save-back test(s) for this change). Do NOT run the entire MCP suite.
    - Live save-back against a running AMS leans on the USER's environment.
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- EXTEND `candidateSaveBackService.ts` in place; Issue 2's dedup/`link` and the identity primitive are uncommitted and must be reused, not rolled back.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass.
- New SOAP entities/attributes resolve + dedup through the reused identity primitive + Issue 2 dedup (idempotent on re-run); WSDL<->Java duplicates reconcile to one persisted entity.
- JSONB metadata + provenance pass through additively; `interface_logical_entities` written; endpoint request/response point-ids bound via `dep_log_<id>`; SOAP `endpoint_data_effects` persisted.
- No `*_points` wrapper created/modified directly; no 1:1 mapping synthesized; no prior-spec working-tree file reverted.

---

### Frontend Layer

#### Task Group 7: Render SOAP message-field structure + restrictions in the existing surfaces
**Dependencies:** Task Group 6

- [x] 7.0 Surface the SOAP message-field structure + restrictions (no new panel type)
  - [x] 7.1 Write 2-8 focused tests FIRST
    - Limit to 2-8 highly focused tests maximum (Vitest).
    - Cover only critical behaviours: a SOAP message `logical_data_entity` candidate renders its fields with type + cardinality + nullability in the existing `CandidateDetailsPanel`; the value-domain restrictions (enum/pattern/length/range) render (reusing the Spec 3 constraints rendering pattern); the entity provenance is shown; the candidate flows through the existing Candidates stream (no new panel type); a candidate with no restrictions/metadata renders cleanly (no crash).
    - Skip exhaustive coverage of every restriction-display permutation.
  - [x] 7.2 Extend `candidateDetailsSupport.ts` to read the new fields
    - Read the attribute JSONB metadata blob (cardinality + restrictions + XSD source-type) and the entity provenance; reuse the Spec 1 data-effect + Spec 3 constraints support helpers.
  - [x] 7.3 Render in the EXISTING `CandidateDetailsPanel.tsx` + Candidates stream
    - Reuse the Spec 1 data-effect rendering and the Spec 3 constraints-metadata rendering patterns; NO new panel type, NO new UI surface. Findings land in the existing Findings tab.
  - [x] 7.4 Mark Task Group 7 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 7.1 (the frontend candidate-details test(s)). Do NOT run the entire frontend suite.
    - Live end-to-end rendering leans on the USER's environment.
  - **Caution (this group):** do NOT restore/checkout/revert any working-tree file -- EXTEND `CandidateDetailsPanel.tsx` / `candidateDetailsSupport.ts` in place; the Spec 1/Spec 3 rendering this builds on is uncommitted.

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass.
- SOAP message fields render with type/cardinality/nullability + value-domain restrictions + provenance in the EXISTING candidate-details panel, flowing through the EXISTING Candidates stream.
- No new panel type or UI surface added; Findings remain in the existing Findings tab.
- No prior-spec working-tree file was reverted.

---

## Execution Order

Strict layering -- each group depends on the prior:
1. AMS Meta-Model Layer (Task Group 1) -- schema gate
2. Discovery deep XSD walker (Task Group 2)
3. Discovery Java-DTO field parser (Task Group 3)
4. Discovery reconciliation + emission (Task Group 4)
5. Discovery SOAP operation->DB data-effect (Task Group 5)
6. MCP save-back (Task Group 6)
7. Frontend (Task Group 7)

## Per-Group Verification Posture
- Each group writes 2-8 FOCUSED tests first (sub-task x.1) and ends by marking its sub-tasks `- [x]` and running ONLY that group's tests (final sub-task) -- never the whole suite at any stage.
- Offline unit tests (AMS module test for Group 1; pure-parse Vitest/Jest for discovery Groups 2-5; save-back tests for Group 6; Vitest for Group 7) are the green bar to hit locally.
- Live, end-to-end validation (real AMS startup + Liquibase, a real discovery run over a real SOAP source tree, real save-back, real rendering) leans on the USER's environment -- do not start services yourself.
- Discovery Groups (2-5) must NOT be edited during an in-flight discovery run (`tsx watch` auto-reload kills runs).
