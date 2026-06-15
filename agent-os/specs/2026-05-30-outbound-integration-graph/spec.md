# Specification: Outbound Integration Graph for Discovery (Java / Spring Classic + Spring Boot)

## Goal
Make discovery capture what a service CALLS OUT TO — outbound HTTP calls, published messages, secondary stores, files/objects, email/SMS, and third-party SDKs — as first-class `data_movements` edges (plus rich Findings for purely-external targets) so a like-for-like migration target can reproduce the same downstream behaviour. Discovery describes the outbound dependencies completely and honestly; the runtime API harness (`api-migration-validation-service`) remains the *equivalence verifier*. Spec #5 of 6 in the Phase-2 "oracle perfection" program; built strictly after Specs #1–#4 (committed on HEAD `5c37472`).

## User Stories
- As a migration analyst, I want each endpoint/service to show the HTTP calls it makes and the topics/queues it publishes to so that I can specify a target that reproduces the same downstream behaviour.
- As a reviewer, I want each outbound dependency to surface in the existing Candidates stream as a `data_movements` edge (or in the Findings tab when the target is purely external) so that no outbound call is ever silently invisible.
- As a reviewer, I want a purely-external target (a bare URL/topic/store) recorded as a rich Finding with its verbatim target and payload hint so that we never mint a speculative external architecture entity.

## Specific Requirements

**Retain Java call-argument literals (root-cause fix — LAND FIRST, shared with Spec #6)**
- Add an `args: string[]` field to `CallInfo` (`languageExtractors/java/astUtils.ts`, the interface at L115–126) and populate it from the invocation `arguments` AST node alongside the existing `argCount` walk.
- Per positional argument: a string-literal node → its UNQUOTED text; a char/numeric/boolean literal → its text; a bare `final`/static constant identifier → its identifier text (best-effort; resolution is the resolver's job).
- Anything else (method calls, concatenation, builders) → a stable placeholder token (e.g. the raw node text, truncated) so arity and ORDERING are preserved without fabricating a literal.
- Change `toCallIR` (`languageExtractors/java/extract.ts` L74) from `args: []` to `args: c.args`. This is pure population of the ALREADY-existing `CallIR.args: string[]` IR field (`languageIR.ts:55`) — NO IR-type change, NO change to other language packs' `toCallIR`.
- This is the SHARED substrate Spec #6 (SQL-text capture) consumes; it is a single shared change OWNED here and landed in this spec first — do NOT duplicate it in #6.

**New deterministic `outboundIntegrationResolver` (NEW, modelled on `endpointDataEffectResolver`)**
- Add `outboundIntegrationResolver.ts` in `frameworkAdapters/springClassic/`; pure (no I/O), reads the supplied `SourceFileIR[]` only.
- Detect outbound call sites by receiver-type / method-name signature over the now-retained `CallIR.args`, classify the `integration_kind`, and resolve the verbatim target (URL / topic / queue / exchange / store / path) from the literal args.
- Designed to be called BOTH from the framework adapter (to emit `data_movements` candidates) AND from the finding scanner (to emit external-dependency Findings) over the same IR — the established `endpointDataEffectResolver` pattern (running it twice is cheap and keeps candidate vs finding emission cleanly separated).
- Does NOT modify `endpointDataEffectResolver.ts`; it is additive and REUSES that resolver's call-graph walk.
- Deterministic only — the literal targets are statically present; NO new LLM call, NO new gateway relay.

**Outbound families to detect (v1) + the data each edge carries**
- HTTP clients: RestTemplate (`getForObject`/`postForObject`/`exchange`/`execute`/…), WebClient (`.get()/.post()/….uri("…")`), Feign (`@FeignClient` interfaces — already partly handled), `RestClient` (Spring 6), OkHttp (`Request.Builder().url("…")`/`newCall`), Apache HttpClient (`new HttpGet("…")`/`execute`), JDK `HttpClient` (`HttpRequest.newBuilder().uri(URI.create("…"))`).
- Messaging producers: Kafka (`kafkaTemplate.send("topic", …)`), JMS (`jmsTemplate.convertAndSend("queue", …)`/`.send(...)`), Rabbit (`rabbitTemplate.convertAndSend("exchange","routingKey", …)`), SQS (`sqs*.sendMessage(...)`/`SendMessageRequest`) — resolve the topic/queue/exchange from the literal args.
- Cache / secondary stores: Redis (`redisTemplate`/`StringRedisTemplate` ops, `@Cacheable`/`@CachePut` cache names), Mongo (`mongoTemplate`/`MongoRepository`), Elasticsearch (`elasticsearch*`/ES repository) — treated as secondary STORES.
- Files / S3 / FTP: `s3Client.putObject/getObject(bucket, key)`, `FileWriter`/`Files.write`/`Path` to a literal path, FTP client `store`/`retrieve`.
- Email / SMS: `JavaMailSender.send(...)`, Twilio / SES SDK send. Third-party SDKs: generic catch — any call on a recognised SDK client class (configurable signature list) whose target literal is resolvable.
- Each detected outbound carries: `integration_kind` (e.g. `outbound-rest`, `messaging-producer`, `cache-store`, `secondary-store`, `file-store`, `object-store`, `email`, `sms`, `third-party-sdk`), the verbatim resolved target, an optional HTTP verb / messaging operation, an optional payload-type hint, and a `confidence`.

**Call-graph attribution (reuse Spec #1's endpoint→service walk)**
- REUSE `endpointDataEffectResolver`'s controller-mapping → autowired-`@Service` → service-method traversal, including same-class private-helper inlining + cycle guard.
- Attribute each outbound call site to the CALLING ENDPOINT when the walk reaches it from an inbound controller mapping; otherwise to the OWNING `@Service`/`@Component` class containing the call.
- The `data_movements` SOURCE is that endpoint's interface or the owning service (its `application_point`).
- When the same outbound target is reached from multiple endpoints, emit ONE `data_movements` per (source application_point, resolved target) pair (deduped), mirroring Spec #1's one-edge-per-pair rule.

**Emit a NEW `data_movements` candidate type (REUSE the relationship type — NOT a new type)**
- Add `'data_movements'` to the `CandidateType` union (`discovery-service/src/types/candidate.ts`, L66–89; `endpoint_data_effects` at L81 is the precedent).
- The candidate carries the SOURCE endpoint/service NAME (NOT a point id) + the resolved target + `integration_kind` + verbatim target + optional payload-type hint.
- NEVER emit or create `application_points` / `data_entity_points` directly — they are auto-managed by AMS (meta-model reference L16, L29, L83). Save-back resolves the point references (see the producer requirement).
- REUSE `endpointDataEffectCandidates.ts` as the candidate-emit template (a new `data_movements`-candidate emit helper modelled on it).

**ADD the missing `data_movements` save-back producer (NEW — modelled EXACTLY on `endpoint_data_effects`)**
- Add a `data_movements` DEFERRED producer to `mcp-server/src/services/candidateSaveBackService.ts`, modelled on the existing `endpoint_data_effects` deferred producer (~L2542) — a Pass-2.x deferred relationship pass that runs AFTER Pass-1 entity mints so source/target names resolve against freshly-minted services/interfaces.
- (a) Read the candidate's source endpoint/service name and resolve it to a `source_application_point_id` via the `ap_{serviceId}` convention (the auto-managed `application_point` id for a service — `architectureBaselineService.ts` L1157–1158, established L993–1056).
- (b) Resolve the target to a `target_application_point_id` when it maps to an in-model service/interface, else leave the target side NULL/absent for a Finding (see external-vs-modellable).
- (c) Write the snake_case/camelCase-MIXED `data_movements` row matching `DataMovementDto` exactly; `movement_type` carries the `integration_kind`.
- (d) Idempotent-match on (`source_application_point_id`, `target_application_point_id`, `movement_type`) to avoid duplicates; (e) SKIP (never fabricate) a row whose source cannot be resolved, logging the skip — exactly like the `endpoint_data_effects` producer.
- Register the candidate type in the producer-config map (the `endpoint_data_effects` entry at `CANDIDATE_TYPE_CONFIG` L280 is the routing template) so the candidate routes to `relationships.data_movements`. The model scaffold already inits `data_movements: []` (~L1746) with no producer — this fills it.

**External vs modellable target (architecture ≠ reality)**
- MODELLABLE — the target resolves to a known/in-model service or interface (e.g. a Feign client whose `name`/`url` maps to a discovered service, or an internal base path matching a discovered interface) → the `data_movements` connects source `application_point` → target `application_point`. No external entity invented.
- PURELY EXTERNAL — a bare URL / topic / queue / store name / file path / SDK endpoint with NO in-model counterpart → emit the `data_movements` with the resolved source `application_point` and a NULL/absent `target_application_point_id` (the architecture records "this service has an outbound dependency" without minting a fake counterpart), AND capture a rich Finding carrying the verbatim external detail.
- The Finding carries: the integration dependency + verbatim target + payload hint + `integration_kind` + the calling endpoint/service + the call-site FQN+line as evidence.
- Do NOT mint speculative external service/interface entities. Mirrors the Spec #1 / Spec #4 "resolved-but-not-fully-modellable → Finding, never a silent drop, never an invented entity" discipline. REUSE `FindingEmitter.ts` + `springClassicFindingScanner.ts`.

**Messaging payloads → Findings (DEFERRED, like Spec #4's deferred cases)**
- v1 captures the messaging producer + the topic/queue/exchange target + a best-effort PAYLOAD-TYPE HINT (the static type of the `send(...)` payload argument, e.g. `OrderEvent`) as a Finding detail.
- It does NOT model the full message field schema — a later spec can attach payload schemas.
- NO gateway-relay / LLM dependency introduced for payloads in this spec (deterministic only).

**springBoot adapter parity (ADD the missing `processOutboundIntegrations`)**
- ADD `processOutboundIntegrations` to the springBoot adapter (`frameworkAdapters/springBoot/index.ts`) and wire it into the class-dispatch loop (L1206–1209, alongside `processController` / `processJpaEntity` / `processServiceLayerBusinessLogic` / `processConfigurationClass`), mirroring springClassic's call site (`springClassic/index.ts:2387`).
- Both adapters SHARE the new `outboundIntegrationResolver` + the new `data_movements`-candidate emit helper; the adapter-specific piece is only the per-class gating/dispatch.
- The existing springClassic `processOutboundIntegrations` (`springClassic/index.ts:1609`) is literal-URL-only (`@FeignClient` / RestTemplate / WebClient; non-literal URLs skipped) and emits an ORPHAN `endpoints` candidate with NO edge — that orphan emit is SUPERSEDED by the `data_movements`-edge emit.

**UI surfacing (no new visualization)**
- The new `data_movements` candidates surface in the EXISTING Candidates review stream / relationship-candidate row rendering (`frontend/src/components/Discovery/*`).
- External-dependency + payload Findings surface in the existing `FindingsTab` / `FindingDetailDrawer`.
- Build NO dependency-graph visualization; reuse the existing candidate/relationship/finding rendering surfaces. Frontend typing for the `data_movements` row MUST mirror the mixed snake/camelCase `DataMovementDto` shape exactly.

## Visual Design
No visual assets provided (`planning/visuals/` was created and is empty). This is a discovery-service detection/extraction + MCP save-back change with NO new frontend surface — the new `data_movements` candidates render through the EXISTING Candidates stream + relationship-candidate rows, and external-dependency Findings through the existing Findings tab. No mockups are required.

## Existing Code to Leverage

**Java extractor (root-cause fix) — `languageExtractors/java/extract.ts` + `.../astUtils.ts`**
- `toCallIR` hardcodes `args: []` (`extract.ts:74`) — change to `args: c.args`. The IR contract `CallIR.args: string[]` already exists (`languageExtractors/languageIR.ts:55`).
- `CallInfo` (`astUtils.ts:115–126`) carries `argCount` but no `args` — add `args: string[]` and populate it from the invocation `arguments` node alongside the existing `argCount` walk (~L554–561). This is the SHARED substrate Spec #6 consumes.

**Resolver precedent — `frameworkAdapters/springClassic/endpointDataEffectResolver.ts`**
- The call-graph walk (controller mapping → autowired `@Service` → service method, same-class private-helper inlining + cycle guard) and the "pure, called from both adapter and finding scanner over the same IR" pattern. The new `outboundIntegrationResolver.ts` MIRRORS this; do NOT modify this file.

**Candidate-emit precedent — `frameworkAdapters/springClassic/endpointDataEffectCandidates.ts`**
- The `endpoint_data_effects` candidate-emit helper — the template for a new `data_movements`-candidate emit helper.

**Existing shallow outbound detection to SUBSUME — `springClassic/index.ts` `processOutboundIntegrations` (L1609)**
- Its `@FeignClient` handling and the literal-URL-only RestTemplate/WebClient path; its orphan-`endpoints` emit is superseded by the `data_movements`-edge emit. Dispatched at `springClassic/index.ts:2387`.

**springBoot adapter (add parity) — `frameworkAdapters/springBoot/index.ts`**
- The class-dispatch loop (L1206–1209) where `processOutboundIntegrations` must be wired in; `processController`/`processJpaEntity`/`processServiceLayerBusinessLogic`/`processConfigurationClass` are the sibling dispatch calls to mirror.

**Save-back producer template — `mcp-server/src/services/candidateSaveBackService.ts`**
- The `endpoint_data_effects` deferred producer (~L2542) is the EXACT template for the new `data_movements` producer; the producer-config map entry (`CANDIDATE_TYPE_CONFIG` `endpoint_data_effects` at L280) is the routing template; the model scaffold already inits `data_movements: []` (~L1746).

**Identity / point resolution — `candidateSaveBackService.ts` + `architectureBaselineService.ts`**
- `matchByNormalizedName` (L420) + `resolveEntityPoint` (L484) + `resolveEntityToPointId` (L564) — Spec #1's normalized-name identity primitive, reused to resolve the source service/interface name. The `application_point` id convention (`ap_{serviceId}`) is established in `architectureBaselineService.ts` (L993–1056, L1157–1158); the `buildRelationships` `data_movements` block (L1141–1177) is the JS row-builder reference.

**`data_movements` row shape (match exactly) — AMS `DataMovementDto.java`**
- snake_case `id` / `source_application_point_id` / `target_application_point_id` / `movement_type` / `description` / `tags` / `valid_from` / `valid_to`; camelCase `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional` (explicit `@JsonProperty`, NO `@CamelCaseWire`). For an outbound dependency the optional `dataEntityPointId` / `interfaceWithSchemaId` are typically absent; `movement_type` carries the `integration_kind`.

## Out of Scope
- Minting speculative external service/interface entities — external targets → Findings only (never an invented entity).
- Non-Java stacks (Java / Spring Classic + Spring Boot first; design the resolver to extend later).
- Full message-payload schema modelling — capture producer + topic/queue/exchange + payload-type HINT as a Finding; defer the full field schema to a later spec.
- A dependency-graph VISUALIZATION — reuse the existing candidate/relationship/finding rendering surfaces.
- Any NEW AMS table or Liquibase changeset for `data_movements` — it ALREADY persists (`DataMovementEntity` / `DataMovementDto` / `DataMovementRepository` exist; the relationship is part of the architecture-model JSON).
- Any new LLM / gateway-relay dependency — deterministic core; the existing LLM file-analysis step remains the only (pre-existing) fallback.
- Creating / modifying `application_points` / `data_entity_points` / any `*_points` wrapper, or synthesizing a 1:1 mapping (auto-managed by AMS).
- Proving the outbound calls fire — that is the runtime harness's job; discovery describes the dependencies, it does not verify equivalence.

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec **#5 of 6** in the Phase-2 "oracle perfection" program. **Built STRICTLY SEQUENTIALLY after Specs #1–#4** (committed on HEAD `5c37472`) — NOT in parallel. This section is mandatory because Spec #5 shares hot files with #6 and #3.

**Why sequential (file overlap is the reason, not a nicety):**
- **Shared with Spec #6 (SQL-text capture) — `extract.ts` / `astUtils.ts` (the Java extractor).** Both specs need retained call-argument literals. **THIS spec (#5) lands the call-arg-literal retention FIRST** (the `CallInfo.args` field + AST population + `toCallIR` passthrough); **Spec #6 REUSES it** for SQL-string literals (e.g. `JdbcTemplate.query("SELECT …")`). **Build #5 BEFORE #6.** Do NOT duplicate the args-retention work in #6 — it is a single shared change owned here.
- **Shared with Spec #3 (model-aware dedup/enrichment) — `mcp-server/src/services/candidateSaveBackService.ts`.** Spec #3 adds its `enrich` deferred pass + matcher guards to this file (the `Pass 2.7` enrich block is already present in the working tree). **Build the `data_movements` producer AFTER #3's matcher-guard commit** so the new deferred pass slots cleanly after #3's passes and reuses the (post-#3) normalized-name matcher without merge churn.
- **`discovery-service/src/types/candidate.ts`** (the `CandidateType` union — add `'data_movements'`). This union is also touched by #1 (`endpoint_data_effects`, already landed) and may be touched by #4/#6; coordinate the single union edit to avoid conflicts.
- **The data-effect resolver area** (`frameworkAdapters/springClassic/`) is shared with #1/#4/#6 — the new `outboundIntegrationResolver.ts` is ADDITIVE (a new file) and reuses #1's walk; it does NOT modify `endpointDataEffectResolver.ts`. The springClassic `index.ts` dispatch + the springBoot `index.ts` dispatch are edited additively.
- **Findings emit** (`FindingEmitter` / `springClassicFindingScanner` / frontend `FindingsTab`) is shared with #4 and the in-flight `2026-05-28-bulk-findings-actions` work — add the external-dependency + payload findings ADDITIVELY; do NOT refactor the shared finding scanner.

**Build layering within Spec #5 (in order):**
1. **discovery-service** — (a) extractor call-arg retention in `languageExtractors/java/{extract,astUtils}.ts` (LAND FIRST — shared with #6); (b) new `outboundIntegrationResolver.ts` + a `data_movements` candidate-emit helper; (c) add `'data_movements'` to `types/candidate.ts`; (d) emit external-dependency + payload-hint Findings; (e) add springBoot `processOutboundIntegrations` + wire its dispatch.
2. **MCP save-back** — NEW `data_movements` producer in `candidateSaveBackService.ts` (after #3's matcher-guard commit): resolve source/target `application_point`s via the existing `ap_{serviceId}` convention + Spec #1's normalized-name primitive; NEVER create `*_points`; match the `DataMovementDto` row shape exactly; idempotent; skip-not-fabricate on unresolved source.
3. **frontend** — render the new `data_movements` candidates in the existing candidate surfaces (+ the external-dependency Findings in `FindingsTab`); NO new visualization.

**AMS** — `data_movements` is part of the architecture-model JSON; NO new AMS table/changeset (VERIFIED: `DataMovementEntity` / `DataMovementDto` / `DataMovementRepository` already exist; the new producer writes the row shape AMS already accepts).

**Constraints:** deterministic; do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch` auto-reload kills runs — sequence extractor + resolver + adapter edits to a quiet window); reuse (don't fork) the existing `data_movements` relationship type, Spec #1's call-graph walk, the save-back identity primitive (guarded by Spec #3), the existing AMS persistence, and the Findings + Candidates rendering surfaces; NEVER create/modify `*_points` wrappers or synthesize a 1:1 mapping. Build on `5c37472`; ADD/EXTEND only.
