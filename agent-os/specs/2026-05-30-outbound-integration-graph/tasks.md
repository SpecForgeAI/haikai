# Task Breakdown: Outbound Integration Graph for Discovery (Java / Spring Classic + Spring Boot)

## Overview
Total Tasks: 6 task groups

Spec #5 of 6 in the Phase-2 "oracle perfection" program. Captures what a service **CALLS OUT TO** (outbound HTTP, published messages, secondary stores, files/objects, email/SMS, third-party SDKs) as first-class **`data_movements`** edges (already AMS-persisted — NO new table/changeset) plus rich Findings for purely-external targets. Built **strictly sequentially** on **committed HEAD `5c37472`** (Specs #1–#4 done). Deterministic core; no new LLM / gateway relay.

### Global CAUTION (applies to EVERY task group)
- **Build on `5c37472`; ADD / EXTEND only.** Do NOT revert or rewrite Spec #1–#4 work already on HEAD.
- **NEVER create or modify `*_points` wrappers** (`application_points` / `data_entity_points` / any polymorphic wrapper) — they are AUTO-MANAGED by AMS (meta-model reference L16, L29, L83). **NEVER synthesize a 1:1 logical↔physical (or any) mapping.**
- **REUSE, do not fork:** the EXISTING `data_movements` relationship type, Spec #1's endpoint→service call-graph walk (`endpointDataEffectResolver`), and the (Spec-#3-guarded, committed) normalized-name identity primitive (`matchByNormalizedName` / `resolveEntityPoint` / `resolveEntityToPointId`). REUSE the existing AMS persistence + the Findings + Candidates rendering surfaces.
- **No `discovery-service/src/**` edits during an in-flight discovery run** (`tsx watch` auto-reload kills runs) — sequence extractor + resolver + adapter edits to a quiet window.
- **External-only edges that do not resolve to an in-model target → a rich Finding, NEVER a fabricated edge / invented external entity.**

### CAUTION — test verification (READ BEFORE RUNNING ANY TESTS)
There is a **PRE-EXISTING tree-sitter test-isolation issue**: many Java-parsing Jest suites FAIL when run together in one process (confirmed on clean HEAD `5c37472`, unrelated to any spec). Therefore:
- **Run each group's tests IN ISOLATION (by file path), never the whole discovery suite at once.**
- A combined-run red (multiple Java suites in one process) is **NOT a regression** — do not chase it.
- Test runner per service: **discovery-service = Jest**, **mcp-server = Jest**, **frontend = Vitest**.

---

## Task List

### Discovery Service — Extractor Substrate

#### Task Group 1: Java Extractor Call-Argument Retention (LAND FIRST — shared with Spec #6)
**Dependencies:** None (foundation for Group 2, Group 4, and Spec #6)
**Service / runner:** discovery-service / **Jest**

The root-cause fix. `CallIR.args` is ALREADY typed `string[]` (`extensionPacks/languageIR.ts:55`) but `toCallIR` hardcodes `args: []` (`extract.ts:74`) and `astUtils.ts` `CallInfo` (L115–126) captures only `argCount`. POPULATE `args` with the literal/string-constant arguments of each call. NO IR-type change. This is the shared substrate Spec #6 (SQL-text capture) consumes — it is OWNED here, landed first; do NOT duplicate it in #6.

- [x] 1.0 Complete Java extractor call-argument retention
  - [x] 1.1 Write 2–8 focused tests FIRST (Jest, isolated)
    - Test that `CallInfo.args` / `CallIR.args` is populated for: a string-literal arg (unquoted text), a numeric/char/boolean literal (its text), a bare `final`/static constant identifier (its identifier text)
    - Test that a non-literal arg (method call / concatenation / builder) yields a stable placeholder token (e.g. raw node text, truncated) so **arity + ORDERING are preserved** without fabricating a literal
    - Test the multi-arg ordering case (e.g. `kafkaTemplate.send("orders", payload)` → `["orders", "<placeholder>"]`)
    - **Regression test:** `argCount` STILL equals the positional argument count (it must keep working)
    - Limit to 2–8 highly focused tests; skip exhaustive per-node-type coverage
  - [x] 1.2 Add `args: string[]` to the `CallInfo` interface (`languageExtractors/java/astUtils.ts`, L115–126), alongside the existing `argCount` field
  - [x] 1.3 Populate `args` in the call-arg walk (`astUtils.ts` ~L605–619, the `childForFieldName('arguments')` loop that currently only counts `argCount`)
    - String literal → UNQUOTED text; char/numeric/boolean literal → its text; bare constant identifier → its identifier text (best-effort — resolution is the resolver's job)
    - Anything else → a stable placeholder token (raw node text, truncated)
    - Keep `argCount` incrementing exactly as today (no regression)
  - [x] 1.4 Change `toCallIR` (`extract.ts:74`) from `args: []` to `args: c.args`
    - Pure population of the EXISTING `CallIR.args: string[]` IR field — NO IR-type change
    - Do NOT touch any other language pack's `toCallIR`
  - [x] 1.5 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 1.1, **by file path, in isolation** (Jest)
    - Do NOT run the whole discovery suite (tree-sitter isolation issue → false red)

**Per-group verification note:** Run the Group 1 Jest file(s) in isolation by path. Green = `args` populated for literals + placeholder-for-non-literals with ordering preserved, AND `argCount` unchanged.

**Acceptance Criteria:**
- The 2–8 tests from 1.1 pass (run in isolation)
- `CallIR.args` carries literal/constant arg text, with placeholders preserving arity + order for non-literals
- `argCount` regression test passes (still the positional count)
- No IR-type change; no other language pack's `toCallIR` modified
- ADD/EXTEND only on `5c37472`; no `*_points`, no 1:1 mapping

---

### Discovery Service — Outbound Resolver

#### Task Group 2: New Deterministic `outboundIntegrationResolver`
**Dependencies:** Task Group 1 (consumes the now-populated `CallIR.args`)
**Service / runner:** discovery-service / **Jest**

A NEW pure module (no I/O, reads supplied `SourceFileIR[]` only), modelled on `endpointDataEffectResolver`, **additive** — do NOT modify `endpointDataEffectResolver.ts`. Detect outbound call sites by receiver-type / method-name signature over the retained `CallIR.args`, classify the `integration_kind`, resolve the verbatim target from the literal args, and REUSE Spec #1's endpoint→service call-graph walk to attribute each outbound edge to the calling endpoint / owning service.

- [x] 2.0 Complete the outbound integration resolver
  - [x] 2.1 Write 2–8 focused tests FIRST (Jest, isolated)
    - HTTP client target resolution (e.g. `restTemplate.getForObject("http://…")` → `integration_kind: outbound-rest`, verbatim target + verb)
    - Messaging producer target resolution (e.g. `kafkaTemplate.send("orders", …)` → `messaging-producer`, topic `orders`, payload-type hint)
    - One secondary-store OR file/object case (e.g. Redis/Mongo op, or `s3Client.putObject(bucket, key)`)
    - Call-graph attribution: an outbound call reached from a controller mapping attributes to the **calling endpoint**; an outbound call in a plain `@Service` attributes to the **owning service**
    - Dedup: same target reached from multiple endpoints → ONE resolved edge per (source application_point owner, resolved target) pair (mirrors Spec #1's one-edge-per-pair rule)
    - Limit to 2–8 focused tests; do NOT cover every family exhaustively here
  - [x] 2.2 Add `frameworkAdapters/springClassic/outboundIntegrationResolver.ts` (NEW file; pure; reads `SourceFileIR[]`)
    - Designed to be called BOTH from the framework adapter (→ `data_movements` candidates) AND from the finding scanner (→ external-dependency Findings) over the same IR — the established "run it twice, cheap, keeps candidate vs finding emission separate" pattern
  - [x] 2.3 Implement outbound-family detection over `CallIR.args` (deterministic, by receiver-type / method-name signature)
    - HTTP clients: RestTemplate (`getForObject`/`postForObject`/`exchange`/`execute`/…), WebClient (`.get()/.post()/….uri("…")`), Feign (`@FeignClient`), `RestClient` (Spring 6), OkHttp (`Request.Builder().url("…")`/`newCall`), Apache HttpClient (`new HttpGet("…")`/`execute`), JDK `HttpClient` (`HttpRequest.newBuilder().uri(URI.create("…"))`)
    - Messaging producers: Kafka (`kafkaTemplate.send("topic", …)`), JMS (`jmsTemplate.convertAndSend`/`.send`), Rabbit (`rabbitTemplate.convertAndSend("exchange","routingKey", …)`), SQS (`sqs*.sendMessage`/`SendMessageRequest`) — resolve topic/queue/exchange from literal args
    - Cache / secondary stores: Redis (`redisTemplate`/`StringRedisTemplate`, `@Cacheable`/`@CachePut` cache names), Mongo (`mongoTemplate`/`MongoRepository`), Elasticsearch — treated as secondary STORES
    - Files / S3 / FTP: `s3Client.putObject/getObject(bucket, key)`, `FileWriter`/`Files.write`/`Path` to a literal path, FTP `store`/`retrieve`
    - Email / SMS: `JavaMailSender.send(...)`, Twilio / SES send; third-party SDKs: generic catch over a configurable signature list whose target literal is resolvable
  - [x] 2.4 Classify + carry per detected outbound: `integration_kind` (`outbound-rest` / `messaging-producer` / `cache-store` / `secondary-store` / `file-store` / `object-store` / `email` / `sms` / `third-party-sdk`), verbatim resolved target, optional HTTP verb / messaging operation, optional payload-type hint, `confidence`
  - [x] 2.5 REUSE Spec #1's endpoint→service call-graph walk for attribution
    - REUSE `endpointDataEffectResolver`'s controller-mapping → autowired-`@Service` → service-method traversal (same-class private-helper inlining + cycle guard) — do NOT re-implement, do NOT modify that file
    - Attribute to the CALLING ENDPOINT when reached from an inbound controller mapping; otherwise to the OWNING `@Service`/`@Component`
    - The `data_movements` SOURCE is that endpoint's interface or the owning service (its `application_point`)
  - [x] 2.6 Output two lists: resolved outbound edges (source endpoint/service NAME + resolved target + `integration_kind` + verb/op + payload hint + `confidence`) and an unresolved/external list — deduped one-per-(source owner, resolved target) pair
  - [x] 2.7 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 2.1, **by file path, in isolation** (Jest)
    - Do NOT run the whole discovery suite

**Per-group verification note:** Run the Group 2 Jest file(s) in isolation by path. Green = families detected, targets resolved verbatim from `CallIR.args`, attribution correct, edges deduped one-per-pair.

**Acceptance Criteria:**
- The 2–8 tests from 2.1 pass (run in isolation)
- `outboundIntegrationResolver.ts` is a NEW additive, pure module; `endpointDataEffectResolver.ts` UNCHANGED
- Targets resolved deterministically from the populated `CallIR.args` (no LLM, no gateway relay)
- Attribution reuses Spec #1's walk; one edge per (source application_point owner, resolved target) pair
- ADD/EXTEND only on `5c37472`; no `*_points`, no 1:1 mapping

---

### Discovery Service — Candidate Type, Emission & External Findings

#### Task Group 3: `data_movements` Candidate Type + Emission + External-Dependency Findings
**Dependencies:** Task Group 2
**Service / runner:** discovery-service / **Jest**

Add `data_movements` to the `CandidateType` union and emit a candidate per resolved outbound edge (carrying the source endpoint/service NAME + resolved target + `integration_kind`, for save-back to resolve LATE to `application_point`s). For purely-EXTERNAL targets (no in-model counterpart) emit a rich Finding — NEVER a speculative external entity. Wire both into the pipeline.

- [x] 3.0 Complete candidate type, emission, and external Findings
  - [x] 3.1 Write 2–8 focused tests FIRST (Jest, isolated)
    - A resolved outbound edge emits a `data_movements` candidate carrying source endpoint/service NAME + resolved target + `integration_kind` + verbatim target (+ payload hint) — and NOT any `application_points`/`data_entity_points`
    - A purely-external target emits a rich Finding (verbatim target + payload hint + `integration_kind` + calling endpoint/service + call-site FQN+line) via `FindingEmitter`
    - A modellable target does NOT emit an external Finding (Finding is external-only)
    - Limit to 2–8 focused tests
  - [x] 3.2 Add `'data_movements'` to the `CandidateType` union (`discovery-service/src/types/candidate.ts`, L66–89; `endpoint_data_effects` at L81 is the precedent)
    - **Single coordinated union edit** — this union is also touched by #1 (landed) and may be touched by #4/#6
  - [x] 3.3 Add a `data_movements`-candidate emit helper, modelled on `endpointDataEffectCandidates.ts`
    - Candidate carries the SOURCE endpoint/service NAME (NOT a point id) + resolved target + `integration_kind` + verbatim target + optional payload-type hint
    - NEVER emit/create `application_points` / `data_entity_points` — save-back resolves the point references LATE
  - [x] 3.4 Emit external-dependency + payload-hint Findings for purely-external targets via `FindingEmitter` (`findingEmitter` singleton) + `springClassicFindingScanner.ts`
    - Finding carries: the integration dependency + verbatim target + payload hint + `integration_kind` + the calling endpoint/service + the call-site FQN+line as evidence
    - ADD additively; do NOT refactor the shared finding scanner (it is shared with Spec #4 + the in-flight `2026-05-28-bulk-findings-actions` work)
    - External target → ALSO emit the `data_movements` candidate with resolved source + NULL/absent target (records "this service has an outbound dependency" without minting a fake counterpart); NEVER invent an external service/interface entity
  - [x] 3.5 Wire candidate-emit + finding-emit into the springClassic pipeline (the existing `processOutboundIntegrations` at `springClassic/index.ts:1609`, dispatched at L2387 — its orphan-`endpoints` emit is SUPERSEDED by the `data_movements`-edge emit)
  - [x] 3.6 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 3.1, **by file path, in isolation** (Jest)
    - Do NOT run the whole discovery suite

**Per-group verification note:** Run the Group 3 Jest file(s) in isolation by path. Green = candidate emitted per resolved edge (name-carrying, no points), external-only → rich Finding + source-only edge, modellable → no external Finding.

**Acceptance Criteria:**
- The 2–8 tests from 3.1 pass (run in isolation)
- `'data_movements'` added to `CandidateType` (single coordinated edit)
- Candidate carries source/target NAMES only — never `application_points`/`data_entity_points`
- Purely-external targets → rich Finding (verbatim target + evidence) + source-only edge; never an invented entity; finding scanner not refactored
- ADD/EXTEND only on `5c37472`; no `*_points`, no 1:1 mapping

---

### Discovery Service — springBoot Adapter Parity

#### Task Group 4: springBoot `processOutboundIntegrations`
**Dependencies:** Task Group 2 (shares the resolver), Task Group 3 (shares the candidate-emit + finding-emit helpers)
**Service / runner:** discovery-service / **Jest**

The springBoot adapter has NO `processOutboundIntegrations` at all (confirmed: dispatch loop `springBoot/index.ts` L1206–1209 has only `processController` / `processJpaEntity` / `processServiceLayerBusinessLogic` / `processConfigurationClass`). ADD it, mirroring springClassic's `processOutboundIntegrations` (`springClassic/index.ts:1609`, dispatched L2387) — but reading the now-populated `CallIR.args` so non-literal-URL cases resolve where possible. Both adapters SHARE the new resolver + emit helpers; the adapter-specific piece is only the per-class gating/dispatch.

- [x] 4.0 Complete springBoot outbound detection parity
  - [x] 4.1 Write 2–8 focused tests FIRST (Jest, isolated)
    - A springBoot service class with an HTTP-client outbound call → a `data_movements` candidate via the shared resolver + emit helper
    - A springBoot service class with a messaging producer → a `data_movements` candidate (topic/queue resolved from `CallIR.args`)
    - Dispatch wiring: `processOutboundIntegrations` is invoked from the class-dispatch loop for an eligible class
    - Limit to 2–8 focused tests
  - [x] 4.2 Add `processOutboundIntegrations` to `frameworkAdapters/springBoot/index.ts`
    - Mirror springClassic's `processOutboundIntegrations` signature/shape; REUSE the shared `outboundIntegrationResolver` (Group 2) + the `data_movements`-candidate emit + external-finding emit helpers (Group 3)
    - Read the now-populated `CallIR.args` so non-literal-URL cases resolve where possible (improving on springClassic's literal-URL-only legacy path)
  - [x] 4.3 Wire `processOutboundIntegrations` into the class-dispatch loop (`springBoot/index.ts` L1206–1209), alongside the sibling `processController` / `processJpaEntity` / `processServiceLayerBusinessLogic` / `processConfigurationClass` dispatch calls
  - [x] 4.4 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 4.1, **by file path, in isolation** (Jest)
    - Do NOT run the whole discovery suite

**Per-group verification note:** Run the Group 4 Jest file(s) in isolation by path. Green = springBoot dispatch invokes `processOutboundIntegrations`, sharing the resolver + emit helpers, emitting `data_movements` candidates.

**Acceptance Criteria:**
- The 2–8 tests from 4.1 pass (run in isolation)
- `processOutboundIntegrations` ADDED to springBoot and wired into the dispatch loop
- REUSES the shared resolver + emit helpers (no fork); reads the populated `CallIR.args`
- ADD/EXTEND only on `5c37472`; no `*_points`, no 1:1 mapping

---

### MCP Save-Back — `data_movements` Producer

#### Task Group 5: MCP `data_movements` Save-Back Producer
**Dependencies:** Task Group 3 (consumes the `data_movements` candidate); **Spec #3's committed matcher-guard** (build the producer AFTER it so the deferred pass slots in cleanly)
**Service / runner:** mcp-server / **Jest**

`candidateSaveBackService.ts` inits `data_movements: []` (~L1746) with NO producer. ADD the NEW deferred producer, modelled EXACTLY on the `endpoint_data_effects` deferred producer (~L2547, the block introduced by the comment ~L2542) + its `CANDIDATE_TYPE_CONFIG` entry (L280) + routing case (L1201). A Pass-2.x deferred pass running AFTER Pass-1 entity mints so source/target NAMES resolve against freshly-minted services/interfaces. Resolve source/target to `application_point`s via the `ap_{serviceId}` convention WITHOUT creating `*_points`.

- [x] 5.0 Complete the `data_movements` save-back producer
  - [x] 5.1 Write 2–8 focused tests FIRST (Jest, isolated)
    - A modellable `data_movements` candidate resolves source NAME → `source_application_point_id` (`ap_{serviceId}`) AND target NAME → `target_application_point_id`, producing a row
    - A purely-external candidate (target not in-model) resolves source → `ap_{serviceId}` and leaves `target_application_point_id` NULL/absent (NEVER fabricated)
    - Idempotency: re-running does not duplicate a row matched on (`source_application_point_id`, `target_application_point_id`, `movement_type`)
    - Skip-not-fabricate: a candidate whose SOURCE cannot be resolved is SKIPPED (logged), not written
    - **Wire-shape test:** the emitted row matches `DataMovementDto` EXACTLY — snake_case `source_application_point_id` / `target_application_point_id` / `movement_type` (+ `id`/`description`/`tags`/`valid_from`/`valid_to`) and camelCase `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional`
    - Limit to 2–8 focused tests
  - [x] 5.2 Register `data_movements` in `CANDIDATE_TYPE_CONFIG` (the `endpoint_data_effects` entry at L280 is the routing template) so the candidate routes to `relationships.data_movements`
  - [x] 5.3 Collect `data_movements` candidates into a deferred bucket + add the routing branch (mirror `deferredEndpointDataEffects` ~L1992 / the `if (candidate.candidate_type === 'endpoint_data_effects')` branch ~L2045)
  - [x] 5.4 Add the DEFERRED producer block (model on the `endpoint_data_effects` block ~L2547–2604; conversion helper modelled on `convertEndpointDataEffectToRow` ~L1283)
    - (a) Resolve the candidate's source endpoint/service NAME → `source_application_point_id` via the `ap_{serviceId}` convention (`architectureBaselineService.ts` L1035, L1157–1158), using the (Spec-#3-guarded, committed) normalized-name primitive (`matchByNormalizedName` ~L420 / `resolveEntityPoint` ~L484 / `resolveEntityToPointId` ~L564)
    - (b) Resolve the target → `target_application_point_id` when it maps to an in-model service/interface; else leave it NULL/absent (the external-only edge from Group 3's Finding) — NEVER fabricate a target
    - (c) Write the snake_case/camelCase-MIXED `DataMovementDto` row (reference the `buildRelationships` `data_movements` block `architectureBaselineService.ts` L1141–1177); `movement_type` carries the `integration_kind`; the optional `dataEntityPointId` / `interfaceWithSchemaId` are typically absent for an outbound dependency (honour the DTO's XOR — leave BOTH absent rather than fabricate)
    - (d) Idempotent-match on (`source_application_point_id`, `target_application_point_id`, `movement_type`) — no duplicates
    - (e) SKIP (never fabricate) a row whose SOURCE cannot be resolved, logging the skip — exactly like the `endpoint_data_effects` producer
    - NEVER create an `application_points` / `data_entity_points` row — they are auto-managed by AMS
  - [x] 5.5 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 5.1, **by file path, in isolation** (Jest)
    - Do NOT run the whole mcp-server suite

**Per-group verification note:** Run the Group 5 Jest file(s) in isolation by path. Green = producer resolves source via `ap_{serviceId}`, writes the exact mixed `DataMovementDto` shape, is idempotent, skips-not-fabricates on unresolved source, leaves external targets NULL.

**Acceptance Criteria:**
- The 2–8 tests from 5.1 pass (run in isolation)
- New deferred `data_movements` producer added + registered in `CANDIDATE_TYPE_CONFIG`; routes to `relationships.data_movements` (fills the `data_movements: []` init ~L1746)
- Row matches `DataMovementDto` mixed wire shape EXACTLY; `movement_type` = `integration_kind`
- Source resolved via `ap_{serviceId}` + the Spec-#3-guarded identity primitive; idempotent on (source ap, target ap, movement_type); skip-not-fabricate on unresolved source
- External-only edges → NULL target (left as Group 3's Finding); NEVER a fabricated edge / `*_points` / 1:1 mapping
- ADD/EXTEND only on `5c37472`

---

### Frontend — Surfacing

#### Task Group 6: Render `data_movements` Candidates in Existing Surfaces
**Dependencies:** Task Group 3 (candidate type), Task Group 5 (producer / wire shape)
**Service / runner:** frontend / **Vitest**

Render outbound dependencies / `data_movements` candidates in the EXISTING candidate surfaces (candidate-details + Candidates stream) and the external-dependency Findings in the existing `FindingsTab` / `FindingDetailDrawer`. NO bespoke widget, NO dependency-graph visualization. Frontend typing for the `data_movements` row MUST mirror the mixed snake/camelCase `DataMovementDto` shape exactly (no existing `data_movements` typing in `frontend/src/api/*.ts` today — add it mirroring the DTO).

- [x] 6.0 Complete frontend surfacing
  - [x] 6.1 Write 2–8 focused tests FIRST (Vitest)
    - A `data_movements` candidate renders in the existing Candidates stream / relationship-candidate row (source endpoint/service + resolved target + `integration_kind`)
    - The candidate-details surface renders the `data_movements` candidate's key fields
    - (If typing is added) the frontend `data_movements` type mirrors the mixed snake/camelCase `DataMovementDto` shape
    - Limit to 2–8 focused tests
  - [x] 6.2 Add/extend frontend typing for the `data_movements` row mirroring `DataMovementDto` EXACTLY — snake_case `source_application_point_id` / `target_application_point_id` / `movement_type` (+ `id`/`description`/`tags`/`valid_from`/`valid_to`) and camelCase `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional`
  - [x] 6.3 Render the `data_movements` candidate in the EXISTING Candidates review stream + relationship-candidate row rendering (`frontend/src/components/Discovery/*`) — REUSE existing rows; NO bespoke widget
  - [x] 6.4 Render the `data_movements` candidate's details in the EXISTING candidate-details surface
  - [x] 6.5 Confirm external-dependency + payload Findings surface in the EXISTING `FindingsTab` / `FindingDetailDrawer` (no new component — these are emitted by Group 3)
  - [x] 6.6 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2–8 tests from 6.1 (Vitest)
    - Do NOT run the whole frontend suite

**Per-group verification note:** Run the Group 6 Vitest file(s) by path. Green = `data_movements` candidates render in the existing candidate surfaces with the exact mixed wire shape; external Findings show in the existing Findings tab. No new visualization.

**Acceptance Criteria:**
- The 2–8 tests from 6.1 pass
- `data_movements` candidates render in the EXISTING Candidates stream + candidate-details (no bespoke widget, no graph viz)
- Frontend `data_movements` typing mirrors the mixed `DataMovementDto` shape EXACTLY
- External-dependency Findings surface in the existing `FindingsTab` / `FindingDetailDrawer`
- ADD/EXTEND only on `5c37472`; no `*_points`, no 1:1 mapping

---

## Phase-2 Build Ordering & File-Overlap (Spec #5 of 6)

**Position:** Spec **#5 of 6** in the Phase-2 "oracle perfection" program. Built **STRICTLY SEQUENTIALLY** on committed HEAD **`5c37472`** (Specs #1–#4 done) — NOT in parallel. This section is mandatory because Spec #5 shares hot files with #6 and #3.

**Why the ordering is load-bearing (file overlap, not a nicety):**
- **Shared with Spec #6 (SQL-text capture) — `languageExtractors/java/{extract,astUtils}.ts`.** Both specs need retained call-argument literals. **Spec #5 lands the call-arg-literal retention FIRST** (Group 1: `CallInfo.args` + AST population + `toCallIR` passthrough). **Spec #6 REUSES it** for SQL-string literals (e.g. `JdbcTemplate.query("SELECT …")`). **Build #5 BEFORE #6. Do NOT duplicate the args-retention work in #6** — it is a single shared change OWNED here.
- **Shared with Spec #3 (model-aware dedup/enrichment) — `mcp-server/src/services/candidateSaveBackService.ts`.** Spec #3 adds its `enrich` deferred pass + matcher guards to this file (the Pass 2.7 enrich block is already present in the working tree). **Build the Group 5 `data_movements` producer AFTER #3's matcher-guard commit** so the new deferred pass slots cleanly after #3's passes and reuses the (post-#3) normalized-name matcher without merge churn.
- **`discovery-service/src/types/candidate.ts`** (the `CandidateType` union — add `'data_movements'`). Also touched by #1 (`endpoint_data_effects`, landed) and possibly #4/#6 — make this a SINGLE coordinated union edit (Group 3, sub-task 3.2) to avoid conflicts.
- **The data-effect resolver area** (`frameworkAdapters/springClassic/`) is shared with #1/#4/#6 — the new `outboundIntegrationResolver.ts` is **ADDITIVE (a new file)** and reuses #1's walk; it does NOT modify `endpointDataEffectResolver.ts`. The springClassic `index.ts` dispatch + the springBoot `index.ts` dispatch are edited **additively**.
- **Findings emit** (`FindingEmitter` / `springClassicFindingScanner` / frontend `FindingsTab`) is shared with #4 and the in-flight `2026-05-28-bulk-findings-actions` work — add the external-dependency + payload findings **ADDITIVELY**; do NOT refactor the shared finding scanner.

**Build layering within Spec #5 (strict order):**
1. **discovery-service** — (a) **Group 1** extractor call-arg retention (`languageExtractors/java/{extract,astUtils}.ts`) — **LAND FIRST, shared with #6**; (b) **Group 2** new `outboundIntegrationResolver.ts`; (c) **Group 3** add `'data_movements'` to `types/candidate.ts` + candidate-emit + external/payload Findings; (d) **Group 4** springBoot `processOutboundIntegrations` + wire its dispatch.
2. **MCP save-back** — **Group 5** new `data_movements` producer in `candidateSaveBackService.ts` (AFTER #3's matcher-guard commit): resolve source/target `application_point`s via the existing `ap_{serviceId}` convention + Spec #1's normalized-name primitive; NEVER create `*_points`; match the `DataMovementDto` row shape exactly; idempotent; skip-not-fabricate on unresolved source.
3. **frontend** — **Group 6** render the new `data_movements` candidates in the existing candidate surfaces (+ the external-dependency Findings in `FindingsTab`); NO new visualization.

**AMS** — `data_movements` is part of the architecture-model JSON; **NO new AMS table / Liquibase changeset** (VERIFIED on HEAD: `DataMovementEntity` / `DataMovementDto` / `DataMovementRepository` already exist; the new producer writes the row shape AMS already accepts).

**`data_movements` wire shape (match EXACTLY) — `DataMovementDto.java`:** snake_case `id` / `source_application_point_id` / `target_application_point_id` / `movement_type` / `description` / `tags` / `valid_from` / `valid_to`; camelCase `dataEntityPointId` / `interfaceWithSchemaId` / `biDirectional` (explicit `@JsonProperty`, NO `@CamelCaseWire`). XOR: at most one of `dataEntityPointId` / `interfaceWithSchemaId` — for an outbound dependency both are typically ABSENT; `movement_type` carries the `integration_kind`.

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — Java Extractor Call-Argument Retention (LAND FIRST; shared with Spec #6)
2. Task Group 2 — `outboundIntegrationResolver`
3. Task Group 3 — `data_movements` Candidate Type + Emission + External Findings
4. Task Group 4 — springBoot `processOutboundIntegrations`
5. Task Group 5 — MCP `data_movements` Save-Back Producer (AFTER Spec #3's matcher-guard commit)
6. Task Group 6 — Frontend surfacing in existing candidate + Findings surfaces

## Test Runner & Isolation Reminder
- **discovery-service = Jest**, **mcp-server = Jest**, **frontend = Vitest**.
- **Run each group's tests IN ISOLATION by file path.** The pre-existing tree-sitter test-isolation issue (many Java-parsing Jest suites fail together in one process, confirmed on clean HEAD `5c37472`) means a **combined-run red is NOT a regression** — never the whole discovery suite at once.
