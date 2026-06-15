# Spec Requirements: SOAP/WSDL message-field depth for discovery (Java / Spring Classic) — Spec 4

## Initial Description

Spec 4 of the HAIKAI discovery-richness program (a like-for-like API/DB migration tool, where a discovery scan + architect/PM conversations must be rich enough to be the migration specification ORACLE). North star: memory `project_migration_ultimate_goal`. This is the SOAP analogue of Spec 1 (which built the REST endpoint→data-effect call graph). Program status: Issue 1 + Specs 1-3 + Issue 2 are built; Spec 4 (this) + Spec 5 remain.

**Problem / goal:** For a Java/Spring-Classic SOAP service, discovery currently stops at the OPERATION level and mints ZERO data entities — so the actual request/response MESSAGE-FIELD shapes crossing the SOAP boundary are invisible to the oracle. The WSDL/XSD parser (`wsdlParser.ts`) collects only top-level element/complexType NAMES, with no field-level depth, no cardinality/nullability/restriction detail, and no endpoint→message-entity binding. Spec 4 captures (a) the full SOAP request/response MESSAGE-FIELD structure (fields, types, cardinality, nullability, value-domain restrictions) AND (b) the operation→DB data-effect path — richly enough to (i) seed complete operation capture for the runtime equivalence harness and (ii) be the DTO-shape oracle for migration.

**Current state (factual):** SOAP detection works via 3 signals — Spring-WS annotations, JAX-WS annotations, and WSDL parsing (`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/`). It emits `interfaces` (SOAP_API) + `endpoints` candidates with operation-level detail (operation name, soap_action, request/response root element + namespace, request/response DTO class NAMES). THE GAP: no `logical_data_entities`/`logical_data_attributes` are minted from SOAP message schemas; no cardinality/nullability/restriction detail; no endpoint→message-entity binding; no operation→DB data-effect chain.

**Meta-model grounding (the conformant spine — conforms to `gateway/src/config/prompts/shared/architecture-context-explainer.md`):**
- SOAP message types (XSD complex types / doc-literal wrapper elements) → `logical_data_entities` (the reference defines these as conceptual data objects / API DTO shapes).
- SOAP message fields → `logical_data_attributes` (fields on logical data entities: name, dataType, isNullable, ...).
- Interface exposes its message types → `interface_logical_entities` (REUSE this existing relationship type; NOT a new type).
- Operation request/response message → bind via the EXISTING `EndpointEntity.request_data_entity_point_id` / `response_data_entity_point_id` columns.
- Operation→DB data path → `endpoint_data_effects` rows (Spec 1's relationship type), referencing data entities via the `dep_log_`/`dep_phy_` data-entity-point convention.
- ARCHITECTURE (the meta-model) stays separate from REALITY. Field structure is architecture (the DTO shape). Value-domain restrictions land as STRUCTURED METADATA ON the attribute (the Spec 3 `constraints_metadata` precedent), NOT as loose Findings — because an enum/range is intrinsic to the DTO shape the migration must re-implement. Findings are reserved for the genuinely-unmodellable cases (no parsable schema AND no parsable Java DTO; multi-part/RPC-style messages; cycle/depth-cap stops; unresolved data chains).
- NEVER create the auto-managed `*_points` wrappers directly — save-back synthesizes `dep_log_<id>` deterministically. NEVER synthesize a 1:1 logical↔physical mapping.

## Requirements Discussion

### First Round Questions

All shaping questions were resolved and user-approved prior to this document. Captured below as resolved Q/A pairs.

**Q1 — Where do XSD field structure vs value-domain restrictions land (Findings vs on-attribute metadata)?**
**Answer:** XSD restrictions → ON-ATTRIBUTE STRUCTURED METADATA, NOT loose Findings. Field structure (name, type, cardinality, nullability) lands as first-class on `logical_data_attributes`. Value-domain restrictions (`xsd:enumeration`, `xsd:pattern`, `minLength`/`maxLength`, `minInclusive`/`maxInclusive`, `totalDigits`/`fractionDigits`) go into a structured JSONB metadata blob ON the attribute, mirroring Spec 3's `constraints_metadata` precedent. Rationale: an enum/range is intrinsic to the DTO shape the migration must re-implement, so it belongs on the architecture entity, not in a side-channel Finding.

**Q2 — Is the operation→DB data-effect chain in v1, and is it built fresh or reused from Spec 1?**
**Answer:** IN v1, and REUSING Spec 1's machinery. Build the SOAP analogue of Spec 1: walk the `@Endpoint`/`@PayloadRoot` (Spring-WS) and `@WebMethod` (JAX-WS) HANDLER method down through service→repository to the DB tables, REUSING Spec 1's `endpointDataEffectResolver` (same downstream service→repo→entity walk; only the SOAP entry-point detection is new) → emit `endpoint_data_effects` rows for SOAP operations. Identical shape to Spec 1: `access_mode` (read/write/read-write), `path_metadata_json` call chain, operation hint (insert/update/delete/select), `transactional` flag.

**Q3 — How are named complex types modelled — inlined per message, or shared?**
**Answer:** Named complex types → ONE SHARED `logical_data_entity` per named type, referenced by a `logical_data_entity_relationship` (NOT inlined per message). More faithful, dedups across messages, and plays into Issue 2's model-aware dedup.

**Q4 — Does v1 parse the Java DTO classes too, or only the WSDL/XSD schema?**
**Answer:** Parse Java DTOs too, AND RECONCILE the two views. v1 parses the annotated `@RequestWrapper`/`@ResponseWrapper` / JAXB `@XmlType` Java DTO class FIELDS (a NEW deterministic Java-field parser) AND reconciles the WSDL/XSD schema view ⟷ the Java-class view using Issue 2's identity primitive + `link`/dedup. Consequence: annotation-only / no-WSDL services STILL get field depth from the Java DTO parse. A Finding is emitted ONLY when NEITHER a parsable schema NOR a parsable Java DTO exists.

**Q5 — Is cardinality overloaded onto `is_nullable`?** (settled by the orchestrator — recorded as resolved)
**Answer:** NO. Cardinality is NOT overloaded onto `is_nullable`. `min_occurs` / `max_occurs` / `is_collection` go into the same on-attribute JSONB metadata blob from Q1. `is_nullable` stays a real column, mapped from XSD `nillable`. (XSD distinguishes an OPTIONAL element `minOccurs=0` from a PRESENT-BUT-NULL element `nillable="true"` — these are different facts and must not be conflated.)

**Q6 — What is the AMS schema change — one blob or many typed columns?** (settled by the orchestrator — recorded as resolved)
**Answer:** ONE new JSONB column on `logical_data_attributes` (holding cardinality + restrictions + the XSD source-type), PLUS a small provenance field on `logical_data_entities` (source namespace / originating DTO class name). A SINGLE blob, NOT ~8 typed columns. NEW Liquibase changeset, next free number ≥167 (166 is Issue 2's). Never edit applied changesets. snake_case wire; no `@CamelCaseWire`.

**Q7 — How are multi-part / RPC-literal messages handled?** (settled by the orchestrator — recorded as resolved)
**Answer:** Finding-and-defer. v1 fully supports the dominant doc-literal-wrapped single-part style. Multi-part / RPC-literal/encoded messages emit a Finding ("operation X uses a multi-part/RPC-style message not fully expanded") rather than being mis-modelled.

**Q8 — How deep does the nested/derived complex-type walk go, and how are cycles handled?** (settled by the orchestrator — recorded as resolved)
**Answer:** Walk to an ENV-TUNABLE depth cap (like Spec 2). Detect cycles (e.g. `Employee → manager : Employee`) and STOP with a Finding rather than loop. Fold `xsd:extension` base-type fields into the derived child (so the child entity carries the inherited fields).

**Q9 — Does Spec 4 re-implement dedup?** (settled by the orchestrator — recorded as resolved)
**Answer:** NO. REUSE Issue 2's model-aware dedup + the save-back identity primitive. Spec 4 does NOT re-implement dedup.

**Q10 — Is the field extraction / Java-DTO parse / reconciliation LLM-assisted or deterministic?** (settled by the orchestrator — recorded as resolved)
**Answer:** Deterministic, NO LLM, for the field extraction + Java-DTO parse + reconciliation — pure parsing, offline-testable like Spec 3, with NO gateway-relay dependency for this spec's core. (The existing SOAP scanners stay as-is for operation/interface detection.)

### Existing Code to Reference

**Similar Features Identified (provided by the orchestrator / user):**

- Feature: SOAP detection + WSDL/XSD parsing (the scanners to DEEPEN; do NOT fork) — Path: `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/{wsdlParser,soapEndpointEmitter,jaxWsScanner,springWsScanner,index}.ts`. `wsdlParser.ts` is the XSD walker to deepen to full field depth + restrictions + nested/derived types; `soapEndpointEmitter.ts` is where message-entity emission + endpoint request/response bindings attach.
- Feature: SOAP evidence-gap / contract-candidate emission — Path: `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/` (`soapEvidenceGaps.ts`, `contractCandidates.ts`). `contractCandidates.ts` is a candidate-emission site for the new `logical_data_entities` / `logical_data_attributes` / `interface_logical_entities` / `endpoint_data_effects`.
- Feature: Spec 1 endpoint→data-effect resolver (REUSE; new SOAP entry-point only) — Path: `discovery-service/src/services/.../endpointDataEffectResolver.ts`. Same downstream service→repo→entity walk; Spec 4 adds a SOAP entry-point (`@Endpoint`/`@PayloadRoot` / `@WebMethod` handler) and emits `endpoint_data_effects` for SOAP operations.
- Feature: Discovery pipeline orchestration — Path: `discovery-service/src/services/discoveryV3Pipeline.ts` (where the deepened SOAP steps + reconciliation pass + SOAP data-effect step are wired in).
- Feature: AMS logical-data entities/attributes (the entities being minted + the new JSONB column / provenance home) — Path: `architecture-model-service` `LogicalDataAttributeEntity`/`LogicalDataAttributeDto` (new JSONB metadata column home) and `LogicalDataEntityEntity`/`LogicalDataEntityDto` (provenance field home).
- Feature: AMS endpoint payload bindings (request/response point-id columns to bind) — Path: `architecture-model-service` `EndpointEntity` (existing `request_data_entity_point_id` / `response_data_entity_point_id`).
- Feature: AMS endpoint→data-effect entity (Spec 1's relationship table; SOAP operations emit into it) — Path: `architecture-model-service` `EndpointDataEffectEntity` (Spec 1). Changeset `161-endpoint-data-effects.sql` is the JSONB-metadata + boxed-`Double` precedent.
- Feature: Spec 3 structured on-entity metadata precedent (the `constraints_metadata` JSONB pattern this spec mirrors for restrictions) — Path: AMS changesets `163-physical-attribute-structural-fidelity.sql` / `164-physical-entity-constraints-jsonb.sql`. Precedent for a single structured JSONB metadata blob on a data entity/attribute, captured deterministically with no normalization.
- Feature: MCP save-back identity primitive + `dep_log_` convention + Issue 2 dedup/link — Path: `mcp-server/src/services/candidateSaveBackService.ts`. REUSE (do NOT fork) the normalized-name + confidence identity primitive, the `dep_log_<id>` data-entity-point synthesis convention, and Issue 2's model-aware dedup/`link`. This is also where the WSDL⟷Java reconciliation resolves to a single entity, and where endpoint request/response point-ids are bound.
- Feature: Frontend candidate-details + Candidates stream (the existing surfaces to render into; no new panel type) — Path: frontend candidate-details panel + Candidates stream (e.g. `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`, per the Spec 1/2 pattern). SOAP message-field structure + restrictions render in the existing candidate-details, in the existing Candidates stream — NO new panel type.

**Genuinely NEW work (no existing prior art):**
- The deterministic Java-DTO FIELD parser (parses `@RequestWrapper`/`@ResponseWrapper` / JAXB `@XmlType` class fields) is new.
- The full-depth XSD field walker (current `wsdlParser.ts` is name-only): field types, cardinality, nullability, value-domain restrictions, nested/derived complex types, `xsd:extension` base-field folding, cycle/depth-cap handling — new.
- The WSDL/XSD ⟷ Java-class RECONCILIATION pass (uses the identity primitive + `link`/dedup) is new.
- The SOAP entry-point DETECTION feeding Spec 1's resolver is new (the resolver's downstream walk is reused).

### Follow-up Questions

No follow-up questions were required. All shaping decisions are FINAL and user-approved (the orchestrator confirmed every question is answered).

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was checked via the mandatory directory listing and is empty. The feature reuses the existing candidate-details panel + Candidates stream + Findings tab; no mockups were needed.

### Visual Insights:

Not applicable — proceeding without visuals.

## Requirements Summary

### Functional Requirements

- For a Java/Spring-Classic SOAP service, mint the full request/response MESSAGE-FIELD structure as architecture entities:
  - SOAP message types (XSD complex types / doc-literal wrapper elements) → `logical_data_entities`.
  - SOAP message fields → `logical_data_attributes` carrying first-class field structure: name, dataType (mapped from the XSD source type), and `is_nullable` (a real column, mapped from XSD `nillable`).
  - Named complex types → ONE SHARED `logical_data_entity` per named type, referenced by a `logical_data_entity_relationship` (deduped across messages, not inlined per message).
- Capture cardinality + value-domain restrictions + the XSD source-type as STRUCTURED METADATA in ONE JSONB blob ON the attribute (the Spec 3 `constraints_metadata` precedent):
  - Cardinality: `min_occurs`, `max_occurs`, `is_collection` (NOT overloaded onto `is_nullable`).
  - Restrictions: `xsd:enumeration`, `xsd:pattern`, `minLength`/`maxLength`, `minInclusive`/`maxInclusive`, `totalDigits`/`fractionDigits`.
  - The XSD source-type string (captured as-is, no normalization).
- Bind each operation's request/response message entity to the endpoint via the EXISTING `EndpointEntity.request_data_entity_point_id` / `response_data_entity_point_id` columns (resolved to `dep_log_<id>` at save-back; never create `*_points` directly).
- Link the interface to the message types it exposes via the EXISTING `interface_logical_entities` relationship (reuse; not a new type).
- Walk nested/derived complex types to an ENV-TUNABLE depth cap; detect cycles (e.g. `Employee → manager : Employee`) and STOP with a Finding rather than loop; fold `xsd:extension` base-type fields into the derived child entity.
- Parse the annotated Java DTO classes too: a NEW deterministic Java-field parser reads `@RequestWrapper`/`@ResponseWrapper` / JAXB `@XmlType` class FIELDS, so annotation-only / no-WSDL services still get field depth.
- RECONCILE the WSDL/XSD schema view ⟷ the Java-class view using Issue 2's identity primitive + `link`/dedup, resolving to a single entity per logical message type.
- Build the operation→DB data-effect chain (the SOAP analogue of Spec 1): detect the SOAP entry-point (`@Endpoint`/`@PayloadRoot` for Spring-WS, `@WebMethod` for JAX-WS handler), then REUSE Spec 1's `endpointDataEffectResolver` downstream service→repository→entity walk → emit `endpoint_data_effects` rows for SOAP operations with `access_mode` (read/write/read-write), `path_metadata_json` call chain, operation hint (insert/update/delete/select), and `transactional` flag — identical shape to Spec 1.
- Capture a small PROVENANCE field on each minted `logical_data_entity` (source namespace / originating DTO class name).
- Emit a Finding ONLY for the genuinely-unmodellable cases: NEITHER a parsable schema NOR a parsable Java DTO exists; multi-part / RPC-literal/encoded messages ("operation X uses a multi-part/RPC-style message not fully expanded"); cycle / depth-cap stops; data chains Spec 1's resolver cannot statically resolve.
- Field extraction, Java-DTO parse, and reconciliation are DETERMINISTIC (no LLM, no gateway relay) — pure parsing, offline-testable like Spec 3. The existing SOAP scanners stay as-is for operation/interface detection.
- Surface the minted SOAP message-field structure + restrictions in the EXISTING candidate-details panel, flowing through the EXISTING Candidates stream — no new panel type. Findings land in the existing Findings tab.

### Reusability Opportunities

- REUSE (do not fork) the existing SOAP scanners `springClassicSoap/{wsdlParser,soapEndpointEmitter,jaxWsScanner,springWsScanner,index}.ts` for operation/interface detection; deepen `wsdlParser.ts` and emit from `soapEndpointEmitter.ts` / `contractCandidates.ts`.
- REUSE Spec 1's `endpointDataEffectResolver.ts` downstream walk; add only a SOAP entry-point.
- REUSE the MCP save-back identity primitive, the `dep_log_` data-entity-point convention, and Issue 2's model-aware dedup/`link` in `candidateSaveBackService.ts`; the WSDL⟷Java reconciliation resolves through the same primitive.
- REUSE the Spec 3 single-JSONB-metadata-blob-on-a-data-entity precedent (`163`/`164` changesets) for the restrictions/cardinality blob, and Spec 1's `161-endpoint-data-effects.sql` JSONB + boxed-`Double` precedent for typing.
- REUSE the EXISTING `EndpointEntity` request/response point-id columns and the `interface_logical_entities` + `logical_data_entity_relationships` relationship types (no new relationship types).
- REUSE the EXISTING candidate-details panel + Candidates stream + Findings tab (no new UI surfaces).

### Scope Boundaries

**In Scope:**
- AMS meta-model: ONE NEW JSONB column on `logical_data_attributes` (cardinality + restrictions + XSD source-type) + a small provenance field on `logical_data_entities` (source namespace / originating DTO class name), via a NEW Liquibase changeset (next free number ≥167); surfaced on the AMS DTOs snake_case (no `@CamelCaseWire`).
- discovery-service: deepen `wsdlParser.ts`'s XSD walker to full field depth + restrictions + nested/derived types (with cycle + env-tunable depth-cap handling and `xsd:extension` base-field folding); a NEW deterministic Java-DTO field parser; a reconciliation pass (WSDL/XSD ⟷ Java via the identity primitive + `link`/dedup); a SOAP entry-point for Spec 1's data-effect resolver; emit `logical_data_entities` / `logical_data_attributes` / `interface_logical_entities` / `endpoint_data_effects` + endpoint request/response bindings via `soapEndpointEmitter.ts` / `contractCandidates.ts`.
- MCP save-back (`candidateSaveBackService.ts`): resolve + dedup the new entities/attributes, reconcile WSDL⟷Java via the identity primitive, bind endpoint request/response point-ids, never touch `*_points`.
- frontend: render the SOAP message-field structure + restrictions in the existing candidate-details + Candidates stream; no new panel type.
- Java / Spring Classic SOAP (Spring-WS + JAX-WS) only; the dominant doc-literal-wrapped single-part message style fully supported.

**Out of Scope:**
- Non-Spring / non-Java SOAP stacks.
- LLM enrichment of message shapes (this spec's core is deterministic; no gateway relay).
- Any new UI beyond the existing Candidates stream + Findings tab (no new panel type).
- WS-* policy/security capture.
- SOAP-fault detail beyond what operation detection already does.
- Multi-part / RPC-literal/encoded messages beyond a Finding-and-defer (not fully expanded in v1).
- Re-implementing dedup (Issue 2's dedup + the save-back identity primitive are reused).
- Synthesizing 1:1 logical↔physical mappings; creating `*_points` wrappers directly.

### Technical Considerations

**Layering (strict build order):**
1. **AMS meta-model (schema gate):** add the ONE new JSONB column on `logical_data_attributes` (cardinality + restrictions + XSD source-type) + the provenance field on `logical_data_entities` (source namespace / originating DTO class name), via a NEW changeset numbered ≥167; surface on the DTOs snake_case.
2. **discovery-service:** deepen the `wsdlParser.ts` XSD walker (full field depth + restrictions + nested/derived types + cycle/depth-cap + `xsd:extension` folding); add the deterministic Java-DTO field parser; add the reconciliation pass; add the SOAP entry-point for Spec 1's resolver; emit the entities/attributes/relationships + endpoint bindings via `soapEndpointEmitter.ts` / `contractCandidates.ts`; wire into `discoveryV3Pipeline.ts`.
3. **MCP save-back:** in `candidateSaveBackService.ts`, resolve + dedup the new entities/attributes, reconcile WSDL⟷Java via the identity primitive, bind the endpoint request/response point-ids; never touch `*_points`.
4. **frontend:** render the message-field structure + restrictions in the existing candidate-details + Candidates stream.

**Repo conventions / constraints to honour:**
- **AMS wire format:** AMS speaks snake_case at the wire by default (CLAUDE.md / `spring.jackson.property-naming-strategy: SNAKE_CASE`). The new column/provenance DTO fields follow that default — NO `@CamelCaseWire` (no camelCase consumer is introduced).
- **Liquibase:** the new column + provenance must be a NEW changeset file, next free number ≥167 (166 is Issue 2's `discovery-candidate-operation`); NEVER edit an applied changeset (even comment-only edits break startup via checksum validation).
- **In-flight runs:** do NOT edit `discovery-service/src/**` during an in-flight discovery run (`tsx watch` auto-reload kills runs).
- **Reuse, don't fork:** reuse the save-back identity primitive, Issue 2's model-aware dedup, Spec 1's `endpointDataEffectResolver`, and the existing SOAP scanners — do not re-implement them.

**Meta-model conformance (per `architecture-context-explainer.md`):**
- `logical_data_entities` = conceptual data objects / API DTO shapes — the correct home for SOAP message types.
- `logical_data_attributes` = fields on logical data entities (name, dataType, isPrimaryKey, isNullable) — the correct home for message fields; the structured metadata blob (cardinality + restrictions + XSD source-type) sits ON the attribute (Spec 3 precedent), provenance sits ON the entity.
- `interface_logical_entities` links interfaces to the logical entities they expose — reused; not a new type.
- `endpoint_data_effects` (Spec 1) links an endpoint to a data entity (via a `data_entity_point`) with `access_mode` + `path_metadata_json` — SOAP operations emit into this existing table.
- `data_entity_points` are AUTO-MANAGED polymorphic wrappers — the `dep_log_<id>` value is synthesized at save-back; never created directly. No 1:1 logical↔physical mapping is synthesized.

**Nullability vs cardinality (must not be conflated):** XSD `minOccurs=0` (optional / may be absent) and `nillable="true"` (present-but-null) are distinct facts. `is_nullable` (real column) ← `nillable`; `min_occurs`/`max_occurs`/`is_collection` → the JSONB metadata blob.

**Schema-home note:** Restrictions and cardinality go in a SINGLE structured JSONB blob on `logical_data_attributes`, NOT as ~8 typed columns and NOT as loose Findings — because the enum/range/cardinality is intrinsic to the DTO shape the migration must re-implement.

**Relationship to runtime harness:** the `api-migration-validation-service` remains the equivalence verifier; SOAP discovery describes the message shapes + data effects completely and honestly, it does not prove behaviour.
