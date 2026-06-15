# Spec Requirements: Endpoint→Data-Effect Call Graph for Discovery (Java / Spring Classic first)

## Initial Description

Spec 1 of the HAIKAI discovery richness program (a like-for-like API/DB migration tool). This is Spec 1 (labelled "B" in the program letters) of a multi-spec program (B: this; C: business-logic behaviour; D: DB structural fidelity; E: SOAP/WSDL field depth; A-remainder: capture coverage). North star reference: memory `project_migration_ultimate_goal`.

**Problem / goal:** Discovery captures `endpoints` and data entities as two disconnected islands — there is no captured linkage showing which data entities/tables each API endpoint reads/writes. The controller→service→repository→entity/table data-effect chain is never built (the `uses_data` relationship type exists in `discovery-service/src/types/relationship.ts` but nothing produces it). Without this chain, the migration book-of-work / shape-spec generation cannot produce an implementation-ready spec ("reimplement endpoint X, which reads A and writes B"). This is the highest-leverage gap for making Discovery + Architect chat + PM chat a sufficient *specification oracle* for the migration. The runtime API harness (`api-migration-validation-service`) remains the *equivalence verifier* — discovery does not need to prove behaviour, only describe it completely and honestly.

**Pre-agreed constraints from raw-idea.md (not open for re-litigation):**
1. Do NOT add `class`/`method` as first-class reviewable candidate types — would drown the candidate-review stream; the source's class structure is not a migration target (target re-implements differently).
2. Build the class/method call graph as EXTRACTION-LAYER SUBSTRATE — enrich the Java IR (already has classes/methods) with intra-method call/usage edges.
3. Persist only the RELEVANT SUBGRAPH — class/method hops on a path from an endpoint to a data entity, or rule-bearing methods — never the whole codebase.
4. First-class reviewable artifact = the ENDPOINT→DATA-ENTITY EDGE with an access mode (read / write / read-write); hang the path (class/method hops, e.g. `OwnerController.create → OwnerService.save → OwnerRepository`) on the edge as METADATA — no per-hop approve/reject entities.
5. Include the SHARED IDENTITY/MATCHING PRIMITIVE: resolve an entity reference by normalized name + confidence (not exact-string). Save-back today matches by exact name and duplicates (`Owner` vs `owners`). Reused by Spec 3 (DB) and Issue 2 (model-aware enrichment).
6. Unresolved chains (dynamic dispatch, JdbcTemplate / native SQL, reflection) → emit discovery FINDINGS ("endpoint X touches data we could not statically resolve"), never silent drops. Static resolution is best-effort, not 100%.
7. Key `business_logics` + the call graph by a stable method identifier (FQN + signature) so a later spec (Gap C) can attach behaviour to methods without persisting all methods.
8. OPEN/DEFERRED: optional separate collapsible "code-structure" UI layer for full call-tree traceability. Default = edge + path-metadata; only build the structural layer if needed.

## Requirements Discussion

### First Round Questions

**Q1 — Access mode representation**
**Answer:** Headline enum `{read, write, read-write}`, PLUS a finer operation hint (insert/update/delete/select) stamped as edge metadata.

**Q2 — Edge granularity**
**Answer:** One first-class edge PER (endpoint, data-entity) pair, each carrying its own access mode + its own path metadata. (Example: an endpoint reading `Owner` and writing `Visit` → two separate edges.)

**Q3 — Schema home for the edge**
**Answer:** A NEW dedicated relationship table `endpoint_data_effects` (`endpoint_id` → `data_entity_point_id` + `access_mode` + `path_metadata_json`), referencing data entities via the existing `dep_log_`/`dep_phy_` data-entity-point convention. Do NOT overload the endpoint's `request_/response_data_entity_point_id` payload columns or the `interface_logical_entities` table — those are wire-payload / interface-level and semantically different.

**Q4 — Static-resolution depth (the key scope dial)**
**Answer:** Resolve the common Spring Classic happy path: controller method → autowired `@Service`/`@Component` field → its method → autowired `@Repository` / Spring-Data interface field → entity via the repository's generic type param (`JpaRepository<Owner,Long>` → `Owner`) or via the `@Entity`/`@Table` already captured. Single-interface-implementation resolution IS in scope: when an interface has exactly ONE implementing class in the scanned set, resolve through it. Multiple impls / dynamic dispatch / JdbcTemplate / native SQL / `EntityManager.createQuery` / reflection / deeper hops → emit a FINDING (never silent drop).

**Q5 — Multi-table / transactions**
**Answer:** Emit N independent edges (one per entity); NO transaction-grouping construct in v1; stamp a `transactional: true/false` flag on each edge's metadata.

**Q6 — Confidence model (three outcomes)**
**Answer:** Three outcomes:
- High-confidence (≥0.75) → normal edge candidate.
- Low-confidence-but-resolved (<0.75) → an edge candidate carrying a LOW confidence score (surfaces in the normal candidate-review stream, NOT a separate finding).
- Genuinely UNRESOLVED → finding.

No new "needs confirmation" candidate state; no mid-run interactive prompt. Reuse the existing 0.75 auto-accept threshold.

**Q7 — UI surfacing**
**Answer:** Edges flow through the Candidates review stream as a NEW reviewable relationship candidate type, with the controller→service→repository path shown as read-only, expandable metadata on the candidate. UNRESOLVED chains land in the Findings tab.

**Q8 — Code-structure UI layer**
**Answer:** DEFER entirely (not in this spec). BUT store the path as a STRUCTURED ordered list of hops (each hop = FQN + method signature), so a future spec can render a call-tree without a schema migration.

**Q9 — Endpoint scope**
**Answer:** v1 builds data-effect edges for INBOUND HTTP controller endpoints ONLY (`@RestController`/`@Controller` + mapping methods). Async (JMS/Kafka/Rabbit/SQS listeners, `@Scheduled`, `@EventListener`) and outbound (Feign, RestTemplate, WebClient) endpoint flavours get NO data-effect edges in v1.

**Q10 — `business_logics` keying**
**Answer:** This spec ONLY stamps the stable method identifier (FQN + signature, e.g. `com.foo.OwnerService#save(Owner)`) onto the path hops + emitted `business_logics` candidates. NO behaviour attachment (that is Spec 2 / Gap C).

**Q11 — Out of scope**
**Answer:** Persist ONLY the relevant subgraph (class/method hops on an endpoint→data path + rule-bearing methods); discard the rest of the call graph from persistence. Explicitly excluded: XML/HBM-only Hibernate-mapping wiring, other language packs (Java/Spring Classic first), Gap C behaviour attachment, the code-structure UI layer, and any graph visualization.

### Existing Code to Reference

**Confirmed reuse / upgrade targets (provided by user):**
- **Shared identity/matching primitive (upgrade in place):** `mcp-server/src/services/candidateSaveBackService.ts` — upgrade `resolveEntityToPointId` from exact-name matching to normalized-name + confidence matching. This IS the shared identity/matching primitive, reused by Spec 3 (DB) and Issue 2 (model-aware enrichment). Today it matches by exact name and duplicates (`Owner` vs `owners`).
- **Edge modelling precedent:** Model the new edge on the `interface_logical_entities` precedent — `InterfaceLogicalEntityEntity.java` (carries `direction` + `dataEntityPointId`).
- **Endpoint/candidate emit (reuse):** `processController` + `controllerToDtos` in `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`. This adapter also already emits existing `interface_logical_entities` / `logical_data_entity_physical_data_entities` links.
- **Findings pipeline (reuse for unresolved chains):** `FindingEmitter.ts` + `springClassicFindingScanner.ts`, plus frontend `FindingsTab` / `FindingDetailDrawer`.
- **Unwired relationship type:** `discovery-service/src/types/relationship.ts` (`uses_data` exists but nothing produces it).
- **Java IR (extraction substrate):** `discovery-service/src/services/extensionPacks/languageExtractors/java` — already has classes/methods; to be enriched with intra-method call/usage edges.

**Genuinely NEW work (no existing prior art):**
- There is NO existing controller→service→repository resolver. The closest prior art is the `angularJsClassic` adapter's `$http` call-site detection — but that is call-site detection, NOT a cross-file type resolver. The Java IR call/usage-edge enrichment under `discovery-service/src/services/extensionPacks/languageExtractors/java` is genuinely new work.

### Follow-up Questions

None — requirements gathering was completed prior to this document being written; all eleven questions are resolved and user-approved.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was checked and is empty. (User confirmed: proceed without — the UI reuses the existing Candidates row plus expandable path metadata, and the Findings tab.)

### Visual Insights:

None applicable.

## Requirements Summary

### Functional Requirements

- Build, for each inbound HTTP controller endpoint (`@RestController`/`@Controller` + mapping methods), a set of **endpoint→data-entity data-effect edges** describing which data entities/tables the endpoint reads/writes.
- Emit **one first-class edge per (endpoint, data-entity) pair**. An endpoint reading `Owner` and writing `Visit` produces two distinct edges.
- Each edge carries:
  - A headline **access mode** enum `{read, write, read-write}`.
  - A finer **operation hint** (insert/update/delete/select) in edge metadata.
  - A **`transactional: true/false`** flag in metadata.
  - A **structured, ordered list of path hops** (each hop = FQN + method signature), e.g. `OwnerController.create → OwnerService.save → OwnerRepository`, surfaced as read-only expandable metadata on the candidate.
  - A **confidence score** governing the three-outcome model.
- **Static resolution** follows the Spring Classic happy path: controller method → autowired `@Service`/`@Component` field → its method → autowired `@Repository` / Spring-Data interface field → entity (via the repository generic type param `JpaRepository<Owner,Long>` → `Owner`, or via the already-captured `@Entity`/`@Table`). Single-interface-implementation (exactly one impl in scanned set) IS resolved through.
- **Three confidence outcomes:**
  - ≥0.75 → normal edge candidate.
  - <0.75 but resolved → edge candidate carrying a LOW confidence score (in the normal candidate-review stream, not a finding).
  - Genuinely unresolved → a Finding.
- **Edges flow through the Candidates review stream** as a NEW reviewable relationship candidate type.
- **Unresolved chains** (multiple impls / dynamic dispatch / JdbcTemplate / native SQL / `EntityManager.createQuery` / reflection / deeper hops) → emit a discovery **Finding** ("endpoint X touches data we could not statically resolve"); never a silent drop.
- **Method identity:** stamp the stable method identifier (FQN + signature, e.g. `com.foo.OwnerService#save(Owner)`) onto path hops and emitted `business_logics` candidates. No behaviour attachment in this spec.
- **Entity resolution at save-back** uses the upgraded normalized-name + confidence matching primitive (no more exact-string duplication like `Owner` vs `owners`).

### Reusability Opportunities

- Upgrade `resolveEntityToPointId` in `candidateSaveBackService.ts` (shared identity/matching primitive — also consumed by Spec 3 and Issue 2).
- Model the new `endpoint_data_effects` relationship entity on `InterfaceLogicalEntityEntity.java` (`direction` + `dataEntityPointId` pattern).
- Reuse `processController` + `controllerToDtos` in the Spring Classic framework adapter for endpoint/candidate emit.
- Reuse `FindingEmitter.ts` + `springClassicFindingScanner.ts` + frontend `FindingsTab` / `FindingDetailDrawer` for unresolved-chain findings.
- Reuse the existing 0.75 auto-accept confidence threshold.
- Enrich the existing Java IR (`languageExtractors/java`) which already holds classes/methods.

### Scope Boundaries

**In Scope:**
- Inbound HTTP controller endpoints only (`@RestController`/`@Controller` + mapping methods), Java / Spring Classic pack FIRST.
- New `endpoint_data_effects` AMS relationship table (`endpoint_id` → `data_entity_point_id` + `access_mode` + `path_metadata_json`) using the `dep_log_`/`dep_phy_` data-entity-point convention.
- Access mode enum + operation hint + `transactional` flag + structured ordered path-hop list (FQN + method signature per hop).
- Controller→service→repository→entity static resolver covering the happy path + single-interface-implementation resolution.
- Three-outcome confidence model (high candidate / low-confidence candidate / unresolved finding).
- Candidate-stream surfacing with read-only expandable path metadata; findings for unresolved chains.
- Normalized-name + confidence entity-matching upgrade to the save-back primitive.
- Stamping the stable method identifier (FQN + signature) onto path hops + `business_logics` candidates.
- Persist ONLY the relevant subgraph (path hops + rule-bearing methods).

**Out of Scope:**
- `class`/`method` as first-class reviewable candidate types.
- Async endpoint flavours (JMS/Kafka/Rabbit/SQS listeners, `@Scheduled`, `@EventListener`) and outbound (Feign, RestTemplate, WebClient).
- Transaction-grouping construct (only a per-edge `transactional` flag in v1).
- Any "needs confirmation" candidate state or mid-run interactive prompt.
- Behaviour attachment to methods (Gap C / Spec 2).
- The collapsible "code-structure" UI layer (deferred — but the structured path data is stored now so a future spec needs no schema migration).
- Any graph visualization.
- XML/HBM-only Hibernate-mapping wiring.
- Other language packs (Java/Spring Classic first; design to extend).
- Persisting the rest of the call graph beyond the relevant subgraph.

### Technical Considerations

**Layering (build order):**
1. **AMS meta-model** — add the `endpoint_data_effects` representation (new dedicated table) + access mode + structured path metadata. This is the gating dependency.
2. **MCP save-back** — persist the edge, resolving entities via the normalized-name + confidence identity primitive.
3. **discovery-service extraction** — enrich the Java IR with intra-method call/usage edges + the controller→service→repository→entity resolver; emit findings for unresolved chains.

Java / Spring Classic FIRST; design to extend to other packs.

**Repo conventions / constraints to honour:**
- **AMS wire format:** AMS speaks `snake_case` at the wire by default (CLAUDE.md / `spring.jackson.property-naming-strategy: SNAKE_CASE`). The new `endpoint_data_effects` DTO consumers (gateway proxy, discovery-service AMS client, frontend API module) expect snake_case — no `@CamelCaseWire` annotation needed unless a camelCase consumer is introduced.
- **Liquibase:** New changesets must be NEW files; never edit applied changesets (even comment-only edits break startup with checksum-validation errors).
- **In-flight runs:** Do not edit `discovery-service/src/**` during an in-flight discovery run (`tsx watch` auto-reload kills runs).

**Relevant code references:**
- IR: `discovery-service/src/services/extensionPacks/languageExtractors/java`
- Framework adapter: `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts` (existing `interface_logical_entities` / `logical_data_entity_physical_data_entities` links)
- Unwired relationship type: `discovery-service/src/types/relationship.ts` (`uses_data`)
- Save-back: `mcp-server/src/services/candidateSaveBackService.ts` (exact-name → upgrade to normalized-name + confidence)
- AMS modelling precedent: `InterfaceLogicalEntityEntity.java`
- Findings: `FindingEmitter.ts`, `springClassicFindingScanner.ts`, frontend `FindingsTab` / `FindingDetailDrawer`

**Schema-home note:** Do NOT overload the endpoint's `request_/response_data_entity_point_id` payload columns or the `interface_logical_entities` table — those are wire-payload / interface-level and semantically different from the data-effect (read/write) relationship.

**Relationship to runtime harness:** The `api-migration-validation-service` remains the equivalence verifier. Discovery describes data effects completely and honestly; it does not prove behaviour.
