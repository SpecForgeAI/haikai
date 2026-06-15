# Specification: Endpoint→Data-Effect Call Graph for Discovery (Java / Spring Classic first)

## Goal
Build the endpoint→data-effect call graph (controller→service→repository→entity/table) so each inbound HTTP endpoint's data reads and writes are captured as a first-class, reviewable relationship — making Discovery a sufficient *specification* oracle for like-for-like migration (the runtime API harness remains the *equivalence verifier*).

## User Stories
- As a migration analyst, I want each API endpoint to show which data entities it reads and writes so that I can produce an implementation-ready shape-spec ("reimplement endpoint X, which reads A and writes B").
- As a reviewer, I want each endpoint→data-effect edge to surface in the existing Candidates stream with its controller→service→repository path visible as read-only detail so that I can approve or reject it like any other candidate.
- As a reviewer, I want endpoints whose data access cannot be statically resolved to land in the Findings tab so that no data effect is ever silently dropped.

## Specific Requirements

**AMS meta-model: new `endpoint_data_effects` relationship (Layer 1 — gating dependency)**
- Add a NEW dedicated relationship table/entity `endpoint_data_effects`: `endpoint_id` → `data_entity_point_id` + `access_mode` + structured `path_metadata_json`.
- Reference the data entity via the existing `dep_log_`/`dep_phy_` data-entity-point convention (same as related links), NOT a raw entity FK.
- Model the JPA entity and DTO on the `InterfaceLogicalEntityEntity.java` precedent (it carries `direction` + `dataEntityPointId`); follow its repository/service/controller wiring shape.
- Do NOT overload the endpoint's `request_/response_data_entity_point_id` payload columns or the `interface_logical_entities` table — those are wire-payload / interface-level and semantically distinct from a read/write data effect.
- Persist schema via a NEW Liquibase changeset file only; never edit an applied changeset (comment-only edits break startup via checksum validation).
- DTO speaks snake_case at the wire (AMS default per CLAUDE.md); no `@CamelCaseWire` annotation unless a camelCase consumer is later introduced.
- Expose gateway proxy + discovery-service AMS client + frontend API module typings in snake_case to match.

**Edge shape and access semantics**
- Emit exactly ONE edge per (endpoint, data-entity) pair; an endpoint reading `Owner` and writing `Visit` produces two distinct edges.
- Headline `access_mode` enum: `{read, write, read-write}`.
- Finer operation hint in metadata (one of insert / update / delete / select) to disambiguate within write/read.
- A `transactional: true | false` flag in metadata (no transaction-grouping construct in v1).
- A `confidence` score on each edge driving the three-outcome model below.
- Path stored as a STRUCTURED, ordered list of hops in `path_metadata_json` — each hop = FQN + method signature (e.g. `com.foo.OwnerService#save(Owner)`) — so a future call-tree UI needs no schema migration.

**MCP save-back: persist edges + upgrade the shared identity/matching primitive (Layer 2)**
- Persist each edge candidate as an `endpoint_data_effects` row via the new AMS endpoint.
- Upgrade `resolveEntityToPointId` in `mcp-server/src/services/candidateSaveBackService.ts` from exact-name matching to a normalized-name + confidence matching primitive (fixes `Owner` vs `owners` duplication).
- This matcher is the SHARED identity/matching primitive — design it for reuse by later specs (DB structural fidelity, model-aware enrichment); keep it cohesive and parameterized, not inlined.
- Resolve both the endpoint side and the data-entity-point side through this primitive when writing the edge.
- Honour the existing save-back flow and call sites already using `resolveEntityToPointId` (lines ~1232–1393) — they must keep working after the upgrade.

**discovery-service extraction: enrich Java IR with call/usage edges (Layer 3a)**
- Enrich the Java IR under `discovery-service/src/services/extensionPacks/languageExtractors/java` (already holds classes/methods) with intra-method call/usage edges.
- Capture, per method, the calls it makes and the autowired fields it uses (enough to walk controller→service→repository).
- Stamp every method node with its stable method identifier (FQN + signature) for keying.
- Persist ONLY the relevant subgraph (hops on an endpoint→data path + rule-bearing methods) — discard the rest of the call graph from persistence.
- This IR enrichment is genuinely NEW work; the closest prior art (`angularJsClassic` `$http` call-site detection) is call-site detection, not a cross-file type resolver.

**discovery-service extraction: controller→service→repository→entity resolver (Layer 3b — NEW)**
- Add a NEW resolver in the Spring Classic adapter that walks: controller mapping method → autowired `@Service`/`@Component` field → its method → autowired `@Repository`/Spring-Data interface field → entity.
- Resolve the entity via the repository's generic type param (`JpaRepository<Owner,Long>` → `Owner`) or via the already-captured `@Entity`/`@Table`.
- Single-interface-implementation resolution IS in scope: when an interface has exactly ONE implementing class in the scanned set, resolve through it.
- Derive `access_mode` + operation hint from the repository/method semantics (e.g. `save` → write/insert-or-update, `findBy` → read/select, `delete` → write/delete).
- Derive `transactional` from `@Transactional` presence on the method/class in the resolved path.
- Reuse `processController` + `controllerToDtos` in `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts` for endpoint/candidate emit; this adapter already emits `interface_logical_entities` / `logical_data_entity_physical_data_entities` links.

**Three-outcome confidence model**
- ≥0.75 → normal edge candidate (reuse the existing 0.75 auto-accept threshold).
- <0.75 but resolved → an edge candidate carrying a LOW confidence score, surfaced in the NORMAL candidate-review stream (NOT a finding).
- Genuinely unresolved → a Finding (see below).
- Do NOT introduce any new "needs confirmation" candidate state and do NOT add any mid-run interactive prompt.

**Findings for unresolved chains (never a silent drop)**
- Emit a discovery Finding ("endpoint X touches data we could not statically resolve") for: multiple impls / dynamic dispatch / `JdbcTemplate` / native SQL / `EntityManager.createQuery` / reflection / hops deeper than the resolver handles.
- Reuse `FindingEmitter.ts` + `springClassicFindingScanner.ts` to produce these findings.
- Include enough context (endpoint identity + where resolution stopped) for the finding to be actionable.

**Endpoint scope (v1)**
- Build data-effect edges for INBOUND HTTP controller endpoints ONLY (`@RestController`/`@Controller` + mapping methods).
- Async flavours (JMS/Kafka/Rabbit/SQS listeners, `@Scheduled`, `@EventListener`) and outbound (Feign, RestTemplate, WebClient) get NO edges in v1.
- Java / Spring Classic pack ONLY; design the resolver + IR enrichment so other packs can extend it later.

**Method identity keying (substrate only — no behaviour)**
- Stamp the stable method identifier (FQN + signature, e.g. `com.foo.OwnerService#save(Owner)`) onto path hops AND emitted `business_logics` candidates.
- Do NOT attach any behaviour to methods — that is Spec 2 / Gap C.
- Class/method are SUBSTRATE: do NOT add `class`/`method` as candidate types; the source's class structure is not a migration target.

**UI surfacing (no new UI layer)**
- Edges surface in the EXISTING Candidates review stream as a NEW reviewable relationship candidate type.
- Show the controller→service→repository path as read-only, expandable metadata on the candidate.
- Unresolved chains surface in the existing Findings tab (`FindingsTab` / `FindingDetailDrawer`).
- Build NO code-structure UI layer and NO graph visualization in this spec; the structured path data is stored now so a future UI needs no migration.

## Existing Code to Leverage

**`mcp-server/src/services/candidateSaveBackService.ts` — `resolveEntityToPointId`**
- Currently resolves an entity reference to a data-entity-point id by EXACT name, causing duplicates (`Owner` vs `owners`).
- Upgrade it in place to normalized-name + confidence matching; this becomes the shared identity/matching primitive reused by later specs.
- Existing call sites (lines ~1232–1393) must continue to function after the upgrade.

**`InterfaceLogicalEntityEntity.java` (AMS modelling precedent)**
- Carries `direction` + `dataEntityPointId` — the structural template for the new `endpoint_data_effects` entity.
- Replicate its repository/service/controller wiring and snake_case DTO conventions for the new relationship.

**`processController` + `controllerToDtos` in `springClassic/index.ts`**
- Already walks `@RestController`/`@Controller` mapping methods and emits endpoint candidates plus `interface_logical_entities` / `logical_data_entity_physical_data_entities` links.
- Reuse as the emit point for the new endpoint→data-effect edge candidates; hang the new resolver off this existing controller traversal.

**`FindingEmitter.ts` + `springClassicFindingScanner.ts` + frontend `FindingsTab` / `FindingDetailDrawer`**
- Existing findings pipeline end-to-end (emit → surface → detail).
- Reuse verbatim to emit and display unresolved-chain findings; no new findings infrastructure needed.

**Java IR (`languageExtractors/java`) + `relationship.ts` (`uses_data`)**
- The IR already holds classes/methods (`javaParser.ts`, `extract.ts`, `astUtils.ts`) — enrich with intra-method call/usage edges rather than building a new extractor.
- `uses_data` relationship type exists in `discovery-service/src/types/relationship.ts` but nothing produces it; this spec is its first producer (wire it through for the edge).

## Out of Scope
- Adding `class` or `method` as first-class reviewable candidate types.
- Async endpoint flavours (JMS/Kafka/Rabbit/SQS listeners, `@Scheduled`, `@EventListener`) and outbound calls (Feign, RestTemplate, WebClient).
- Any transaction-grouping construct (only a per-edge `transactional` flag in v1).
- Any "needs confirmation" candidate state or mid-run interactive prompt.
- Behaviour attachment to methods (Gap C / Spec 2).
- The collapsible "code-structure" UI layer (structured path data is stored now; the layer itself is deferred).
- Any graph visualization.
- XML/HBM-only Hibernate-mapping wiring.
- Other language packs (Java / Spring Classic first; design to extend).
- Persisting the rest of the call graph beyond the relevant subgraph.
