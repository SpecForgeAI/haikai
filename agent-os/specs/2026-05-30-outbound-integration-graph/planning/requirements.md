# Spec Requirements: Outbound Integration Graph for Discovery (Java / Spring Classic + Spring Boot)

## Initial Description

Spec #5 of 6 in the HAIKAI Phase-2 "oracle perfection" program (a like-for-like API/DB migration tool where a current service+DB is treated as a black box and the inside is upgraded — Java 8 / Spring Classic + Sybase → Java 21 / Spring Boot 4 + PostgreSQL). North-star reference: memory `project_migration_ultimate_goal`.

**Problem / goal:** To migrate a service as a black box, the specification oracle must know what the service **CALLS OUT TO** — the migration target has to reproduce the same downstream HTTP calls and published messages. Today discovery is **outbound-blind**: it captures inbound endpoints and data entities, but the outbound side is structurally invisible. Three compounding defects (all verified against the codebase, 2026-05-30):

1. **The Java extractor discards call-argument literals.** `toCallIR` in `discovery-service/src/services/extensionPacks/languageExtractors/java/extract.ts` (line 63) hardcodes `args: []`; `astUtils.ts` (lines 554–561) captures only `argCount` (and `CallInfo` has no `args` field at all). So outbound targets — the URL in `restTemplate.getForObject("http://…")`, the topic in `kafkaTemplate.send("orders", …)` — are structurally invisible to every resolver. (NB: `CallIR.args` is already typed `string[]` in `languageExtractors/languageIR.ts` line 55 — the field EXISTS in the IR contract; it is simply never populated by the Java path.)
2. **The meta-model HAS `data_movements`** ("data flowing between application points, optionally referencing a data entity point or interface" — meta-model reference line 73) **but discovery has no `data_movements` candidate type** (`discovery-service/src/types/candidate.ts` lines 66–89) and **`mcp-server/src/services/candidateSaveBackService.ts` (line 1584) inits `data_movements: []` in the model scaffold with NO producer.** The relationship row is allocated but nothing ever fills it.
3. **The today-only outbound detection is shallow and orphaned.** springClassic's `processOutboundIntegrations` (`frameworkAdapters/springClassic/index.ts` line 1235) is a **regex over `file.rawContent`**, **literal-URL only** (`if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) continue;` — non-literal URLs are skipped, lines 1316 / 1349), covers only `@FeignClient` / `RestTemplate` / `WebClient`, and emits an **orphan `endpoints` candidate with NO edge** tying it back to the calling endpoint/service (lines 1325–1340). **springBoot has no `processOutboundIntegrations` at all.** Undetected entirely: messaging producers (Kafka / JMS / Rabbit / SQS `send`); HTTP clients beyond literal-URL Feign/RestTemplate/WebClient (OkHttp, Apache HttpClient, JDK HttpClient, `RestClient`); caches / secondary stores (Redis, Mongo, Elasticsearch); files / S3 / FTP; email / SMS; third-party SDKs.

The runtime API harness (`api-migration-validation-service`) remains the **equivalence verifier** — discovery does not prove the downstream calls fire; it describes them completely and honestly so the target can reproduce them.

**Pre-agreed constraints from raw-idea.md (FINAL — not open for re-litigation):**

1. **Root-cause fix:** the Java extractor RETAINS call-argument literals — change `extract.ts` / `astUtils.ts` so `CallIR.args` carries the literal/string args (at least string literals + simple constants), so an outbound resolver can read targets the way Spec 1's DB resolver reads repository methods. Coordinate with **Spec #6** (which also needs SQL-string literals) — this is a SHARED extractor change landed HERE first.
2. **New outbound resolver** (analogous to `endpointDataEffectResolver`): detect outbound calls and resolve TARGETS — HTTP clients (RestTemplate / WebClient / Feign / OkHttp / Apache HttpClient / JDK HttpClient / RestClient), messaging producers (Kafka / JMS / Rabbit / SQS `send` → topic/queue), cache / secondary stores (Redis / Mongo / Elasticsearch), files / S3 / FTP, email / SMS, third-party SDKs. Walk the endpoint→service call graph (reuse Spec 1's walk) to attribute each outbound edge to the calling endpoint/service.
3. **Meta-model edge = `data_movements`** (REUSE the existing relationship type — NOT a new type): emit a `data_movements` candidate from the calling endpoint/service's `application_point` to the dependency. NEVER create `application_points` / `data_entity_points` directly (auto-managed) — emit the `data_movements` candidate carrying the source endpoint/service NAME + the resolved target, and let save-back resolve the `application_point` references via the existing convention (ADD the `data_movements` producer to `candidateSaveBackService.ts`, which currently has none).
4. **External vs modellable targets** (architecture-vs-reality): when the outbound target resolves to a known/in-model service/interface, the `data_movements` connects to it; when the target is purely EXTERNAL (a bare URL / topic / store with no in-model counterpart), capture it as a rich Finding (the integration dependency + verbatim target + payload hint) rather than minting speculative external architecture entities. Messaging payload shapes → Findings (like Spec 4's deferred cases). Do NOT pollute the architecture with invented external entities.
5. **Deterministic core** (literals are statically present); LLM is the existing fallback only.
6. **Scope:** Java / Spring Classic + Spring Boot adapters (add the missing `processOutboundIntegrations` to springBoot).

## Requirements Discussion

### First Round Questions

**Q1 — Root-cause extractor change (call-arg-literal retention)**
**Answer:** Populate `CallIR.args` from the Java AST. Add an `args: string[]` field to `CallInfo` (`astUtils.ts`), populate it from the invocation's `arguments` node alongside the existing `argCount` walk (lines 554–561), capturing **at least string literals and simple constants** — for each positional argument: a string-literal node → its unquoted text; a character/numeric/boolean literal → its text; a bare `final`/static constant identifier → its identifier text (best-effort, resolution is the resolver's job); anything else (method calls, concatenation, builders) → a stable placeholder token (e.g. the raw node text, truncated) so arity and ordering are preserved without fabricating a literal. Then change `toCallIR` (`extract.ts` line 63) from `args: []` to `args: c.args`. **`CallIR.args` is already typed `string[]` in `languageIR.ts` (line 55)** — this is pure population of an existing IR field; NO IR-type change, NO change to other language packs' `toCallIR`. This is the SHARED substrate Spec #6 (SQL-text) consumes; land it in THIS spec first.

**Q2 — New outbound resolver shape**
**Answer:** A new `outboundIntegrationResolver.ts` in `frameworkAdapters/springClassic/`, modelled on `endpointDataEffectResolver.ts`. Pure (no I/O); reads the supplied `SourceFileIR[]` only; designed to be called BOTH from the framework adapter (to emit `data_movements` candidates) AND from the finding scanner (to emit external-dependency findings) over the same IR — running it twice is cheap and keeps candidate vs finding emission cleanly separated (this is the established `endpointDataEffectResolver` pattern, resolver doc lines 49–53). It detects outbound call sites by **receiver-type / method-name signature** over the enriched `CallIR.args` (deterministic), classifies the **integration kind**, and resolves the **verbatim target** (URL / topic / queue / store / path) from the now-retained literal args.

**Q3 — Which outbound families to detect (v1)**
**Answer:** All families named in the raw idea, detected deterministically from method-name + receiver signatures:
- **HTTP clients:** RestTemplate (`getForObject`/`postForObject`/`exchange`/`execute`/…), WebClient (`.get()/.post()/….uri("…")`), Feign (`@FeignClient` interfaces — already partly handled), `RestClient` (Spring 6), OkHttp (`Request.Builder().url("…")` / `newCall`), Apache HttpClient (`new HttpGet("…")` / `execute`), JDK `HttpClient` (`HttpRequest.newBuilder().uri(URI.create("…"))`).
- **Messaging producers:** Kafka (`kafkaTemplate.send("topic", …)`), JMS (`jmsTemplate.convertAndSend("queue", …)` / `.send(...)`), Rabbit (`rabbitTemplate.convertAndSend("exchange","routingKey", …)`), SQS (`sqs*.sendMessage(...)` / `SendMessageRequest`). Resolve the **topic / queue / exchange** target from the literal args.
- **Cache / secondary stores:** Redis (`redisTemplate` / `StringRedisTemplate` ops, `@Cacheable`/`@CachePut` cache names), Mongo (`mongoTemplate` / `MongoRepository`), Elasticsearch (`elasticsearch*` / ES repository) — treated as secondary STORES.
- **Files / S3 / FTP:** `s3Client.putObject/getObject(bucket, key)`, `FileWriter`/`Files.write`/`Path` to a literal path, FTP client `store`/`retrieve`.
- **Email / SMS:** `JavaMailSender.send(...)`, Twilio / SES SDK send.
- **Third-party SDKs:** generic catch — any call on a recognised SDK client class (configurable signature list) whose target literal is resolvable.
Each detected outbound carries: `integration_kind` (e.g. `outbound-rest`, `messaging-producer`, `cache-store`, `secondary-store`, `file-store`, `object-store`, `email`, `sms`, `third-party-sdk`), the verbatim resolved target, an optional HTTP verb / messaging operation, and a `confidence`.

**Q4 — Call-graph attribution (which endpoint/service owns the outbound edge)**
**Answer:** REUSE Spec 1's endpoint→service call-graph walk (`endpointDataEffectResolver`'s controller-mapping → autowired-`@Service` → service-method traversal, including same-class private-helper inlining + cycle guard). Attribute each outbound call site to the **calling endpoint** when the walk reaches it from an inbound controller mapping; otherwise attribute it to the **owning service** (the `@Service`/`@Component` class containing the call). The `data_movements` source is that endpoint's interface or the owning service (its `application_point`). When the same outbound target is reached from multiple endpoints, emit one `data_movements` per (source application_point, resolved target) pair (deduped), mirroring Spec 1's one-edge-per-pair rule.

**Q5 — Meta-model edge: `data_movements` (REUSE, not a new type)**
**Answer:** Emit a NEW `data_movements` candidate type (added to `discovery-service/src/types/candidate.ts`). The candidate carries the **source endpoint/service NAME** (NOT a point id) + the **resolved target** + `integration_kind` + verbatim target + optional payload hint. The **save-back producer** (new — see Q6) resolves the source name to its `application_point` id via the existing `ap_{serviceId}` convention and writes the AMS `data_movements` row. NEVER emit or create `application_points` / `data_entity_points` directly — they are auto-managed (meta-model reference lines 16, 29, 83). The `data_movements` row shape is already fixed by AMS `DataMovementDto.java` and the baseline builder (`architectureBaselineService.ts` lines 1164–1176): `{ id, source_application_point_id, target_application_point_id, dataEntityPointId, interfaceWithSchemaId, biDirectional, movement_type, description, tags, valid_from, valid_to }`.

**Q6 — Save-back producer (the missing `data_movements` producer)**
**Answer:** ADD a `data_movements` deferred producer to `candidateSaveBackService.ts`, modelled EXACTLY on the existing `endpoint_data_effects` deferred producer (lines 2283–2333) — a Pass-2.x deferred relationship pass that runs AFTER Pass-1 entity mints so source/target names resolve against freshly-minted services/interfaces. It: (a) reads the candidate's source endpoint/service name and resolves it to a `source_application_point_id` via the existing convention (`ap_{serviceId}` — the auto-managed application_point id for a service, per `architectureBaselineService.ts` lines 1157–1158); (b) resolves the target to a `target_application_point_id` when the target maps to an in-model service/interface, else leaves the target side for a Finding (Q7); (c) writes the snake_case/camelCase-mixed `data_movements` row matching `DataMovementDto`; (d) idempotent-matches on (source_application_point_id, target_application_point_id, movement_type) to avoid duplicates; (e) skips (never fabricates) a row whose source cannot be resolved, logging the skip, exactly like the `endpoint_data_effects` producer. Register the candidate type in the producer config map (the `endpoint_data_effects` entry at line 249 is the template) so the candidate routes to `relationships.data_movements`.

**Q7 — External vs modellable target (architecture ≠ reality)**
**Answer:** Two outcomes per resolved outbound:
- **Modellable** — the target resolves to a known/in-model service or interface (e.g. a Feign client whose `name`/`url` maps to a discovered service, or an internal base path matching a discovered interface) → the `data_movements` connects source `application_point` → target `application_point`. No external entity invented.
- **Purely external** — a bare URL / topic / queue / store name / file path / SDK endpoint with NO in-model counterpart → capture a **rich Finding** (the integration dependency + verbatim target + payload hint + `integration_kind` + the calling endpoint/service + the call-site FQN+line as evidence), NOT a speculative external architecture entity. The `data_movements` is still emitted with the resolved source `application_point` and a NULL/absent target_application_point (the architecture records "this service has an outbound dependency" without minting a fake counterpart), and the Finding carries the verbatim external detail. **Do NOT mint speculative external service/interface entities.** This mirrors the Spec 1 / Spec 4 "resolved-but-not-fully-modellable → Finding, never a silent drop, never an invented entity" discipline.

**Q8 — Messaging payload shapes**
**Answer:** **DEFER full message-payload schema modelling** (like Spec 4's deferred cases). v1 captures the messaging producer + the topic/queue/exchange target + a best-effort **payload-type hint** (the static type of the `send(...)` payload argument, e.g. `OrderEvent`) as a Finding detail; it does NOT model the full message field schema. A later spec can attach payload schemas. No gateway-relay / LLM dependency introduced for payloads in this spec (deterministic only).

**Q9 — Determinism vs LLM**
**Answer:** **Deterministic core.** The literal targets are statically present in the (now-retained) call args, so detection + target resolution is purely static. The LLM is the EXISTING fallback only (the pipeline's general LLM file-analysis step) — this spec adds NO new LLM call, NO new gateway relay. Keeps the resolver offline-testable.

**Q10 — springBoot adapter parity**
**Answer:** ADD `processOutboundIntegrations` to the springBoot adapter (`frameworkAdapters/springBoot/index.ts`) and wire it into the class-dispatch loop (lines 1116–1123) alongside `processController` / `processJpaEntity` / `processServiceLayerBusinessLogic` / `processConfigurationClass`, mirroring springClassic's call site (springClassic line 2005). Both adapters share the new `outboundIntegrationResolver` + the new `data_movements`-candidate emit helper; the adapter-specific piece is only the per-class gating/dispatch.

**Q11 — Out of scope**
**Answer:** Minting speculative external service/interface entities (external targets → Findings only); non-Java stacks (Java first; design to extend); full message-payload schema modelling (Finding-and-defer, Q8); a dependency-graph VISUALIZATION (reuse the existing candidate/relationship rendering surfaces); any new AMS table or Liquibase changeset for `data_movements` (it already persists — see Technical Considerations); any new LLM/gateway-relay dependency.

### Existing Code to Reference

**Confirmed reuse anchors (all verified against the codebase, 2026-05-30):**

- **Extractor (root-cause fix):** `discovery-service/src/services/extensionPacks/languageExtractors/java/extract.ts` (`toCallIR`, line 63 — `args: []` → `args: c.args`) and `.../java/astUtils.ts` (the `CallInfo` interface lines 94–105 — add `args: string[]`; the call-arg walk lines 554–561 — populate `args` alongside `argCount`). The IR contract `CallIR.args: string[]` already exists in `discovery-service/src/services/extensionPacks/languageIR.ts` (line 55).
- **Resolver precedent:** `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts` — the call-graph walk (controller mapping → autowired `@Service` → service method, same-class private-helper inlining + cycle guard) and the "pure, called from both adapter and finding scanner over the same IR" pattern (doc lines 49–53). The new `outboundIntegrationResolver.ts` mirrors this.
- **Candidate-emit precedent:** `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates.ts` (`endpoint_data_effects` candidate emit, line 139) — the template for a new `data_movements`-candidate emit helper.
- **Existing (shallow) outbound detection to REPLACE/SUBSUME:** `frameworkAdapters/springClassic/index.ts` `processOutboundIntegrations` (line 1235), incl. its `@FeignClient` handling (lines 1242–1292) and the literal-URL-only RestTemplate/WebClient regex (lines 1294–1369). Its orphan-`endpoints` emit (lines 1325–1340) is superseded by the `data_movements`-edge emit.
- **springBoot adapter (add parity):** `frameworkAdapters/springBoot/index.ts` — the class-dispatch loop (lines 1116–1123) where `processOutboundIntegrations` must be wired in; `runSpringBootAdapter` entrypoint (line 1101).
- **Candidate type union:** `discovery-service/src/types/candidate.ts` (lines 66–89) — add `'data_movements'` to `CandidateType`.
- **Save-back producer template:** `mcp-server/src/services/candidateSaveBackService.ts` — the `endpoint_data_effects` deferred producer (lines 2283–2333) is the EXACT template for the new `data_movements` producer; the producer-config map entry (`endpoint_data_effects` at line 249) is the routing template; the model scaffold already inits `data_movements: []` (line 1584).
- **Identity / point resolution:** `candidateSaveBackService.ts` `matchByNormalizedName` (line 389) + `resolveEntityPoint` (line 446) + `resolveEntityToPointId` (line 524) — Spec 1's normalized-name identity primitive, reused to resolve the source service/interface name. The `application_point` id convention (`ap_{serviceId}`) is established in `architectureBaselineService.ts` (lines 993–1058, 1157–1158).
- **`data_movements` row shape (match exactly):** AMS `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/DataMovementDto.java` (snake_case `source_application_point_id` / `target_application_point_id` / `movement_type` / `valid_from` / `valid_to` / `id` / `description` / `tags`; camelCase `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional` — explicit `@JsonProperty`, NO `@CamelCaseWire`); the JS row builder `mcp-server/src/services/architectureBaselineService.ts` `buildRelationships` `data_movements` block (lines 1147–1177).
- **Findings pipeline (external-dependency + payload-hint findings):** `discovery-service/src/services/findings/FindingEmitter.ts` (`findingEmitter` singleton) + `springClassicFindingScanner.ts`; frontend `FindingsTab` / `FindingDetailDrawer`. (NB: these are touched by the in-flight `2026-05-28-bulk-findings-actions` work and by Spec #4 — coordinate emit there.)
- **Frontend candidate rendering:** the existing Candidates review stream + relationship-candidate row rendering (`frontend/src/components/Discovery/*`) — the new `data_movements` candidates surface there; NO new visualization.

**Genuinely NEW work (no prior art):**

- There is no outbound-call resolver today (the existing detection is a literal-URL regex, not a type/argument-aware resolver). The `outboundIntegrationResolver` + the `data_movements` candidate type + the `data_movements` save-back producer + the springBoot `processOutboundIntegrations` are new.
- The call-arg-literal population in the Java extractor is new (the field exists but is never filled by the Java path).

### Follow-up Questions

None — requirements gathering was completed prior to this document being written; all eleven questions are resolved and user pre-approved. This is an autonomous build with no open questions.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was created and is empty. (Proceed without — the feature reuses the existing Candidates review stream + relationship-candidate row rendering + the Findings tab; no new design surface.)

### Visual Insights:

None applicable.

## Requirements Summary

### Functional Requirements

- **Retain Java call-argument literals.** Add `args: string[]` to `CallInfo` and populate it from the invocation `arguments` AST node (string literals + char/numeric/boolean literals + bare constant identifiers; non-literal expressions → a stable placeholder token preserving arity/order). Change `toCallIR` to pass `args: c.args` instead of `[]`. Populates the already-existing `CallIR.args: string[]` IR field; no IR-type change; no change to other language packs.
- **New deterministic `outboundIntegrationResolver`** (pure, reads `SourceFileIR[]`, callable from both adapter and finding scanner) that detects outbound call sites by receiver-type / method-name signature over the retained `CallIR.args`, classifies the `integration_kind`, and resolves the verbatim target from the literal args, across: HTTP clients (RestTemplate / WebClient / Feign / RestClient / OkHttp / Apache HttpClient / JDK HttpClient), messaging producers (Kafka / JMS / Rabbit / SQS → topic/queue/exchange), cache & secondary stores (Redis / Mongo / Elasticsearch), files / S3 / FTP, email / SMS, third-party SDKs.
- **Call-graph attribution** reusing Spec 1's endpoint→service walk: attribute each outbound call site to the calling endpoint (when reached from a controller mapping) or the owning `@Service`/`@Component`; one `data_movements` per (source application_point, resolved target) pair (deduped).
- **Emit a NEW `data_movements` candidate type** carrying the source endpoint/service NAME + resolved target + `integration_kind` + verbatim target + optional payload-type hint. NEVER emit/create `application_points` / `data_entity_points` directly.
- **ADD the missing `data_movements` save-back producer** to `candidateSaveBackService.ts`, modelled on the `endpoint_data_effects` deferred producer: resolve the source name → `source_application_point_id` (`ap_{serviceId}` convention) via Spec 1's normalized-name primitive; resolve the target → `target_application_point_id` when in-model (else leave NULL + emit a Finding); write the `DataMovementDto`-shaped row; idempotent-match on (source ap, target ap, movement_type); skip-not-fabricate on unresolved source. Register the candidate type in the producer-config map.
- **External vs modellable:** in-model target → `data_movements` connects source↔target `application_point`s; purely external target → `data_movements` with resolved source + NULL target + a rich **Finding** (integration dependency + verbatim target + payload hint + `integration_kind` + calling endpoint/service + call-site FQN+line). NO speculative external entities.
- **Messaging payloads → Findings (deferred):** capture producer + topic/queue/exchange + a best-effort payload-type hint as Finding detail; do NOT model full message field schemas (later spec).
- **springBoot parity:** add `processOutboundIntegrations` to the springBoot adapter and wire it into the class-dispatch loop, sharing the resolver + candidate-emit helper with springClassic.
- **Surface `data_movements` candidates** in the existing Candidates review stream / relationship-candidate rendering; external-dependency Findings in the Findings tab. No new visualization.

### Reusability Opportunities

- Populate the existing `CallIR.args: string[]` IR field (no new type); the same retained args are consumed by Spec #6 (SQL-text capture).
- Reuse `endpointDataEffectResolver`'s call-graph walk + the "pure resolver called from both adapter and finding scanner" pattern for `outboundIntegrationResolver`.
- Reuse `endpointDataEffectCandidates.ts` as the candidate-emit template; the `endpoint_data_effects` deferred save-back producer (lines 2283–2333) + producer-config entry (line 249) as the `data_movements` producer template.
- Reuse Spec 1's normalized-name identity primitive (`matchByNormalizedName` / `resolveEntityPoint` / `resolveEntityToPointId`) and the `ap_{serviceId}` application_point convention (`architectureBaselineService.ts`).
- Reuse the existing AMS `data_movements` persistence (`DataMovementEntity` / `DataMovementDto` / `DataMovementRepository`) and the `buildRelationships` `data_movements` row shape — NO new AMS table/changeset.
- Reuse `FindingEmitter` + `springClassicFindingScanner` + frontend `FindingsTab` / `FindingDetailDrawer` for external-dependency + payload findings.
- Reuse the existing Candidates stream + relationship-candidate row rendering for the new `data_movements` candidates.

### Scope Boundaries

**In Scope:**

- Java call-arg-literal retention (`CallInfo.args` + populate from AST + `toCallIR` passthrough); Java / Spring Classic + Spring Boot only.
- New `outboundIntegrationResolver` covering HTTP clients, messaging producers, cache/secondary stores, files/S3/FTP, email/SMS, third-party SDKs; deterministic target resolution from literals.
- Call-graph attribution (reuse Spec 1's walk); one `data_movements` per (source ap, target) pair.
- New `data_movements` candidate type + new `data_movements` save-back producer (resolving `application_point`s via the existing convention; never creating `*_points`).
- External-vs-modellable split: in-model → `data_movements` source↔target; external → `data_movements` (source + NULL target) + rich Finding.
- Messaging payload-type hint as a Finding (full schema deferred).
- springBoot `processOutboundIntegrations` parity.
- Surfacing in the existing Candidates stream + Findings tab.

**Out of Scope:**

- Minting speculative external service/interface entities (external targets → Findings only).
- Non-Java stacks (Java first; design to extend).
- Full message-payload schema modelling (Finding-and-defer).
- A dependency-graph visualization (reuse existing rendering).
- Any new AMS table / Liquibase changeset for `data_movements` (already persists).
- Any new LLM / gateway-relay dependency (deterministic; existing LLM fallback only).
- Creating / modifying `application_points` / `data_entity_points` / any `*_points` wrapper, or synthesizing a 1:1 mapping.

### Technical Considerations

- **`data_movements` already persists in AMS — VERIFIED.** AMS has `DataMovementEntity.java` + `DataMovementDto.java` + `DataMovementRepository.java`; the relationship is part of the architecture-model JSON. **No new AMS table, NO new Liquibase changeset expected** for this spec (the brief's expectation is confirmed against the codebase). The new producer writes the row shape AMS already accepts.
- **`data_movements` wire shape (match exactly):** snake_case `id` / `source_application_point_id` / `target_application_point_id` / `movement_type` / `description` / `tags` / `valid_from` / `valid_to`; **camelCase** `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional` (explicit `@JsonProperty` on `DataMovementDto`; the DTO carries NO `@CamelCaseWire`, so the snake fields use the global SNAKE_CASE default and the three legacy fields are explicit camelCase). The save-back producer + any frontend typing MUST mirror this mixed shape exactly. For an outbound dependency, the optional `dataEntityPointId` / `interfaceWithSchemaId` are typically absent (the dependency is carried by the source→target `application_point` link + the Finding), and `movement_type` carries the `integration_kind`.
- **`application_point` id convention:** the auto-managed `application_point` for a service has id `ap_{serviceId}` (`architectureBaselineService.ts` lines 1157–1158). The producer resolves the source service/interface NAME to its entity id (via Spec 1's normalized-name primitive) then derives `ap_{id}`. NEVER create an `application_points` row — they are auto-managed by AMS (meta-model reference lines 16, 83).
- **AMS wire format:** AMS speaks snake_case by default (CLAUDE.md / `spring.jackson.property-naming-strategy: SNAKE_CASE`); the `data_movements` consumers (gateway proxy, discovery AMS client, frontend) follow the `DataMovementDto` shape above. No new `@CamelCaseWire` needed.
- **In-flight runs:** Do NOT edit `discovery-service/src/**` during an in-flight discovery run (`tsx watch` auto-reload kills runs). Sequence extractor + resolver + adapter edits to a quiet window.
- **Determinism:** the literal targets are statically present in the retained call args; detection + resolution is static. NO new LLM / gateway relay — the existing LLM file-analysis step remains the only (pre-existing) fallback. Keeps the resolver offline unit-testable (done-bar: offline resolver + candidate/finding mappers + AMS model round-trip green).
- **Relationship to runtime harness:** `api-migration-validation-service` remains the equivalence verifier; discovery describes outbound dependencies completely + honestly; it does not prove the calls fire.

## Phase-2 Build Ordering & File-Overlap

**Spec #5 of 6 — built STRICTLY SEQUENTIALLY after Specs #1–#4.** This section is mandatory because Spec #5 shares hot files with #6 and #3.

- **Shared with Spec #6 (SQL-text capture) — `extract.ts` / `astUtils.ts` (the Java extractor).** Both specs need retained call-argument literals. **THIS spec (#5) lands the call-arg-literal retention FIRST** (the `CallInfo.args` field + AST population + `toCallIR` passthrough); **Spec #6 reuses it** for SQL-string literals (e.g. `JdbcTemplate.query("SELECT …")`). **Build #5 BEFORE #6.** Do not duplicate the args-retention work in #6 — it is a single shared change owned here.
- **Shared with Spec #3 (model-aware dedup/enrichment) — `mcp-server/src/services/candidateSaveBackService.ts`.** Spec #3 adds its `enrich` deferred pass + matcher guards to this file (the `Pass 2.7` enrich block at lines 2335+ is already present in the working tree). **Build the `data_movements` producer AFTER #3's matcher-guard commit** so the new deferred pass slots cleanly after #3's passes and reuses the (post-#3) normalized-name matcher without merge churn.
- **Touches `discovery-service/src/types/candidate.ts`** (the `CandidateType` union — add `'data_movements'`). This union is also touched by #1 (`endpoint_data_effects`, already landed) and may be touched by #4/#6; coordinate the single union edit to avoid conflicts.
- **Touches the data-effect resolver area** (`frameworkAdapters/springClassic/`) shared with #1/#4/#6 — the new `outboundIntegrationResolver.ts` is additive (a new file) and reuses #1's walk; it does not modify `endpointDataEffectResolver.ts`. The springClassic `index.ts` dispatch + the springBoot `index.ts` dispatch are edited additively.
- **Findings emit** (`FindingEmitter` / `springClassicFindingScanner` / frontend `FindingsTab`) is shared with #4 and the in-flight `2026-05-28-bulk-findings-actions` work — add the external-dependency + payload findings additively; do not refactor the shared finding scanner.

**Build layering within Spec #5 (in order):**

1. **discovery-service** — (a) extractor call-arg retention in `languageExtractors/java/{extract,astUtils}.ts` (LAND FIRST — shared with #6); (b) new `outboundIntegrationResolver.ts` + a `data_movements` candidate-emit helper; (c) add `'data_movements'` to `types/candidate.ts`; (d) emit external-dependency + payload-hint Findings; (e) add springBoot `processOutboundIntegrations` + wire its dispatch.
2. **MCP save-back** — NEW `data_movements` producer in `candidateSaveBackService.ts` (after #3's matcher-guard commit): resolve source/target `application_point`s via the existing convention + Spec 1's primitive; NEVER create `*_points`; match the `DataMovementDto` row shape exactly; idempotent; skip-not-fabricate.
3. **frontend** — render the new `data_movements` candidates in the existing candidate surfaces (+ the external-dependency Findings in `FindingsTab`); NO new visualization.

**AMS** — `data_movements` is part of the architecture-model JSON; NO new AMS table/changeset (verified: `DataMovementEntity`/`DataMovementDto`/`DataMovementRepository` already exist).
