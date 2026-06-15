# Specification: SOAP/WSDL Message-Field Depth for Discovery (Spec 4)

## Goal
For a Java/Spring-Classic SOAP service, capture the full request/response MESSAGE-FIELD structure (fields, types, cardinality, nullability, value-domain restrictions) AND the operation->DB data-effect path, richly enough to be the migration-spec oracle. Today SOAP discovery stops at the operation level and mints ZERO data entities.

## User Stories
- As a migration architect, I want each SOAP operation's request/response DTO shape (every field, its type, cardinality, nullability, and enum/range restrictions) captured as architecture entities, so the message contract is re-implementable from the model alone.
- As a migration architect, I want each SOAP operation walked to the DB tables it reads/writes (the SOAP analogue of the REST endpoint->data-effect graph), so the operation->data path seeds complete operation capture for the equivalence harness.

## Specific Requirements

**Mint SOAP message types as logical_data_entities (meta-model spine)**
- SOAP message types (XSD complex types / doc-literal wrapper elements) -> `logical_data_entities`; conforms to the reference (conceptual data objects / API DTO shapes).
- Named complex types -> ONE SHARED `logical_data_entity` per named type, referenced by a `logical_data_entity_relationship`; NOT inlined per message (dedups across messages, plays into Issue 2 dedup).
- Carry a small PROVENANCE field on each minted entity: source namespace / originating DTO class name.
- Link the interface to its message types via the EXISTING `interface_logical_entities` relationship (reuse; NOT a new type).
- NEVER create the auto-managed `*_points` wrappers; NEVER synthesize a 1:1 logical<->physical mapping; logical and physical stay distinct layers.

**Mint SOAP message fields as logical_data_attributes**
- SOAP message fields -> `logical_data_attributes` with first-class field structure: `name`, `data_type` (mapped from the XSD source type).
- `is_nullable` stays a REAL column, mapped from XSD `nillable` (present-but-null), NOT overloaded with cardinality.
- Cardinality (`min_occurs`, `max_occurs`, `is_collection`) and the XSD source-type string go in the on-attribute JSONB metadata blob, not on `is_nullable`.
- XSD `minOccurs=0` (optional / may be absent) and `nillable="true"` (present-but-null) are distinct facts and must not be conflated.

**XSD restrictions as on-attribute structured metadata (NOT loose Findings)**
- Value-domain restrictions land in the structured JSONB metadata blob ON the attribute, mirroring Spec 3's `constraints_metadata` precedent.
- Capture: `xsd:enumeration`, `xsd:pattern`, `minLength`/`maxLength`, `minInclusive`/`maxInclusive`, `totalDigits`/`fractionDigits`.
- Rationale: an enum/range is intrinsic to the DTO shape the migration must re-implement, so it belongs on the architecture entity, not a side-channel Finding.
- The XSD source-type string is captured as-is, with NO normalization.

**Deepen the XSD field walker (wsdlParser.ts)**
- Today `wsdlParser.ts` collects only top-level element/complexType NAMES; deepen it to full field depth, types, cardinality, nullability, and restrictions.
- Walk nested/derived complex types to an ENV-TUNABLE depth cap (like Spec 2).
- Detect cycles (e.g. `Employee -> manager : Employee`) and STOP with a Finding rather than loop.
- Fold `xsd:extension` base-type fields into the derived child entity (the child carries the inherited fields).
- Remains pure / side-effect-free / deterministic (no I/O, no LLM); existing soft-fail (`parseError` -> `wsdl_parse_failed`) behaviour is preserved.

**New deterministic Java-DTO field parser + reconciliation**
- A NEW deterministic Java-field parser reads `@RequestWrapper`/`@ResponseWrapper` / JAXB `@XmlType` Java DTO class FIELDS, so annotation-only / no-WSDL services still get field depth.
- RECONCILE the WSDL/XSD schema view <-> the Java-class view using Issue 2's identity primitive + `link`/dedup, resolving to a single entity per logical message type.
- Field extraction, Java-DTO parse, and reconciliation are DETERMINISTIC (no LLM, no gateway relay) and offline-testable like Spec 3.
- Emit a Finding ONLY when NEITHER a parsable schema NOR a parsable Java DTO exists.

**Operation->DB data-effect chain in v1 (reuse Spec 1's resolver)**
- Detect the SOAP entry-point (`@Endpoint`/`@PayloadRoot` for Spring-WS, `@WebMethod` for JAX-WS handler) -- this entry-point detection is the only NEW part.
- REUSE Spec 1's `endpointDataEffectResolver` downstream service->repository->entity walk unchanged; do NOT fork it.
- Emit `endpoint_data_effects` rows for SOAP operations with the IDENTICAL Spec 1 shape: `access_mode` (read/write/read-write), `path_metadata_json` call chain, operation hint (insert/update/delete/select), `transactional` flag.
- Unresolvable chains become Findings (Spec 1's existing unresolved-chain behaviour), never fabricated edges.

**Bind operation request/response messages to the endpoint**
- Bind each operation's request/response message entity via the EXISTING `EndpointEntity.request_data_entity_point_id` / `response_data_entity_point_id` columns.
- Resolution to `dep_log_<id>` happens at save-back; never create `*_points` directly.

**AMS schema change (single blob + provenance; changeset >=167)**
- ONE new JSONB column on `logical_data_attributes` holding cardinality + restrictions + the XSD source-type (a SINGLE blob, NOT ~8 typed columns).
- A small provenance field on `logical_data_entities` (source namespace / originating DTO class name).
- NEW Liquibase changeset, next free number 167 (166 is Issue 2's); never edit applied changesets.
- snake_case wire (no `@CamelCaseWire`); follow the `constraints_metadata` Hypersistence `@Type(JsonType.class) Map<String,Object>` idiom and the boxed-`Double` PATCH-safety precedent.

**Multi-part / RPC-literal -> Finding-and-defer**
- v1 fully supports the dominant doc-literal-wrapped single-part style.
- Multi-part / RPC-literal/encoded messages emit a Finding ("operation X uses a multi-part/RPC-style message not fully expanded") rather than being mis-modelled.

**Save-back resolution + dedup (reuse only)**
- In `candidateSaveBackService.ts`, resolve + dedup the new entities/attributes through the existing `logical_data_entities` / `logical_data_attributes` / `logical_data_entity_relationships` candidate arms.
- REUSE the identity primitive (`normalizeNameForMatch` / `matchByNormalizedName` / `resolveEntityPoint`), the `dep_log_<id>` convention, and Issue 2's model-aware dedup/`link`; do NOT re-implement dedup.
- The WSDL<->Java reconciliation resolves through the same identity primitive; bind the endpoint request/response point-ids; never touch `*_points`.

## Existing Code to Leverage

**`springClassicSoap/{wsdlParser,soapEndpointEmitter,jaxWsScanner,springWsScanner,index}.ts` + `soapEvidenceGaps.ts`**
- `wsdlParser.ts` is the pure, deterministic XSD walker to DEEPEN to full field depth + restrictions + nested/derived types (currently name-only top-level element/complexType collection).
- `soapEndpointEmitter.ts` already merges the 3 SOAP signals into `interfaces`/`endpoints` candidates and is where message-entity emission + endpoint request/response bindings attach.
- The existing scanners stay AS-IS for operation/interface detection; `soapEvidenceGaps.ts` is the Finding-builder pattern to extend for the new Finding cases.

**`contractCandidates.ts` (packFindingScanners level)**
- Existing candidate-emission site; the new `logical_data_entities` / `logical_data_attributes` / `interface_logical_entities` / `endpoint_data_effects` candidates plus endpoint bindings emit through here / `soapEndpointEmitter.ts`.
- Wire the deepened SOAP step + Java-DTO parse + reconciliation pass + SOAP data-effect step into `discoveryV3Pipeline.ts`.

**`endpointDataEffectResolver.ts` (Spec 1)**
- The downstream controller->service->repository->entity walk is REUSED verbatim; Spec 4 only adds the SOAP entry-point (`@Endpoint`/`@PayloadRoot` / `@WebMethod`) feeding it.
- Produces the resolved `access_mode` + operation hint + `transactional` + structured path-hop list already shaped for `endpoint_data_effects`; unresolved chains already become Findings.

**AMS `LogicalDataAttributeEntity`/`Dto`, `LogicalDataEntityEntity`/`Dto`, `EndpointEntity`, `EndpointDataEffectEntity`; changesets 161/163/164**
- `LogicalDataAttributeEntity` already has a real `is_nullable` column -- the new JSONB metadata column is added beside it; provenance is added to `LogicalDataEntityEntity`.
- `EndpointEntity` already has `request_data_entity_point_id` / `response_data_entity_point_id`; `EndpointDataEffectEntity` (Spec 1) is the existing table SOAP operations emit into.
- `164-physical-entity-constraints-jsonb.sql` (single nullable JSONB-on-entity blob) and `161-endpoint-data-effects.sql` (JSONB + boxed-`Double`) are the exact precedents to follow.

**`candidateSaveBackService.ts` (identity primitive, `dep_log_`, Issue 2 dedup/link)**
- Already configures `logical_data_entities` / `logical_data_attributes` / `logical_data_entity_relationships` / `interface_logical_entities` candidate arms with link/dedup and parent-FK (`logical_entity_id`) resolution.
- The shared `normalizeNameForMatch` / `matchByNormalizedName` / `resolveEntityPoint` primitive and the `dep_log_<id>` / `dep_phy_<id>` synthesis are REUSED for reconciliation + binding; the new JSONB metadata + provenance fields pass through as additive payload.

## Out of Scope
- Non-Spring / non-Java SOAP stacks.
- LLM enrichment of message shapes (this spec's core is deterministic; no gateway relay).
- Any new UI beyond the existing Candidates stream + Findings tab (no new panel type).
- WS-* policy/security capture.
- SOAP-fault detail beyond what operation detection already does.
- Multi-part / RPC-literal/encoded messages beyond a Finding-and-defer (not fully expanded in v1).
- Re-implementing dedup (Issue 2's dedup + the save-back identity primitive are reused).
- Synthesizing 1:1 logical<->physical mappings; creating `*_points` wrappers directly.
- Editing any applied Liquibase changeset; editing `discovery-service/src/**` during an in-flight run.
