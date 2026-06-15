# Specification: Per-endpoint response-contract capture for discovery (Java / Spring Classic first)

## Goal
Capture a per-endpoint RESPONSE CONTRACT — the status, body, and headers each input produces — and attach it as a new `response_contract` JSONB field on the existing `endpoints` entity, so a migration target can be judged byte-for-byte and Spec #2 (seeding) can replay richer error/auth scenarios.

## User Stories
- As a migration engineer, I want each endpoint's error/auth/validation/serialization behaviour captured so the target service can be diffed for byte-identical responses.
- As the seeding spec (#2), I want to read `response_contract` from the endpoint so I can drive richer error and auth replay scenarios.
- As a reviewer, I want to see the response contract read-only with a confidence badge in the existing endpoint candidate-details panel so I can sanity-check what discovery inferred.

## Specific Requirements

**AMS meta-model placement (`response_contract` JSONB on `endpoints`)**
- Add ONE nullable `response_contract` JSONB column to the existing `endpoints` table via a NEW Liquibase changeset (next free number ≥ 168; 167 is highest applied today; never edit an applied changeset).
- This is metadata ON an existing entity, mirroring `business_logics.behavior` (162) and `physical_data_entities.constraints_metadata` (164). NOT a new entity, relationship type, or `*_points` wrapper.
- Map the column on the `Endpoint` JPA entity as JSONB (same idiom as `behavior`), using boxed types.
- The blob embeds its own internal `schema_version` so the shape can evolve with no further migration (Spec 1 `path_metadata_json` precedent).

**`response_contract` blob shape**
- Top-level keys: `error_responses[]`, `auth`, `validation[]`, `serialization`, `status_codes`, `conditional_variants[]`, `provenance`, `confidence`, plus internal `schema_version` (per Q2 shape in requirements.md).
- `error_responses[]`: `exception`, `status`, `body_shape`, `source`.
- `auth`: `required_roles[]`, `expected_unauthenticated_status` (e.g. 401|null), `expected_forbidden_status` (e.g. 403|null), `source`.
- `validation[]`: `field`, `constraint`, `failure_status` (typ. 400), `message`. `serialization`: `null_handling`, `date_format`, `field_naming`, `envelope`, `headers[]`. `status_codes`: `success` (int), `location_header` (bool). `conditional_variants[]`: `condition`, `response_summary`. `provenance`: `source_files[]`, `method_id`, `advice_ids[]`.
- `confidence` is a boxed `Double` INSIDE the blob (boxed so a PATCH with no value preserves null, not 0.0 — `project_primitive_double_dto_overwrite`); NO separate confidence column.
- Typed enough for section-by-section UI rendering; prose sub-fields (`body_shape`, `response_summary`, `value_or_rule`, `message` interpolation, `envelope`) are free text.

**AMS wire convention + read-path exposure**
- `response_contract` is snake_case on the wire and inside the JSONB, matching its host DTO.
- Add `response_contract` to `EndpointDto` as an explicit `@JsonProperty("response_contract")` field. Do NOT add `@CamelCaseWire` — verified `EndpointDto` is plain snake_case with no such annotation.
- Expose the column on the endpoint read path so Spec #2 and future consumers can read it.

**New deterministic response-contract scanner (the always-on spine)**
- New scanner in the springClassic adapter; deterministic detection ALWAYS runs (it is the spine that bounds the LLM enrichment set).
- Group A (outcomes): detect `@ControllerAdvice`/`@ExceptionHandler`/`@ResponseStatus` (error responses); `@Valid`/JSR-380 constraints (validation 400s); auth annotations + filter chain (see security requirement).
- Group B (wire shape): detect Jackson `@JsonInclude`/`@JsonFormat`/`@JsonProperty`/custom serializer registrations/`ObjectMapper` config (serialization); `ResponseEntity` status + `Location` usage (status_codes).
- Detect `@ConditionalOnProperty`/`@Profile`/`@Value` response divergence (conditional_variants).
- Resolve which advice/security applies to each endpoint via Spec 1's controller→method resolution; do NOT re-derive the call graph.
- Fills statically-knowable fields: `status`, `exception`, `constraint`, `required_roles`, `failure_status`, `success`/`location_header`, `field_naming`/`null_handling`/`date_format`, and all `source`/`provenance` fields.

**springClassic security capture (fixes the audit gap)**
- The springClassic pack currently captures ZERO security (verified). Capture both layers deterministically.
- (i) Port the springBoot adapter's method-level annotation reader (`@PreAuthorize`/`@Secured`/`@RolesAllowed`; springBoot `index.ts` ~152–155, 403–425, 605) into the new springClassic scanner; include class-level annotations inherited down to the method.
- (ii) Best-effort security-filter-chain parse: Spring Security `<http>` XML (`<intercept-url pattern access>`) and/or a `SecurityFilterChain` / `WebSecurityConfigurerAdapter` bean's URL→role rules, matched against each endpoint path to derive `required_roles` + expected 401/403.
- Any rule that cannot be statically resolved (SpEL beyond simple roles, dynamic matchers, unparseable chains) → emit a Finding via `FindingEmitter` and set `auth.source = unresolved`. Never guess a role.

**Optional LLM-enrichment stage (tier-gated, temperature 0)**
- A dedicated optional stage fills only the prose/semantic sub-fields the static pass cannot: `body_shape`, `response_summary`, `message` interpolation, `envelope`, and similar semantics.
- All LLM access goes through Spec 2's EXISTING gateway relay — NO direct LLM calls from discovery-service — at `temperature: 0`.
- Reuse Spec 2 conventions: concurrency pool, confidence tags via `getConfidenceForTag`, skip/failure-rate handling.
- Tier-gate exactly like Spec 2's `llmBehaviourCaptureStep` (NOT an off-by-default opt-in flag — avoid a built-but-never-runs feature), honoring the program's per-run cap + token ceiling.

**Config-conditional capture (reverse the collapse)**
- Record each config/profile/value-conditional response branch as a `conditional_variants[]` entry (`condition` + `response_summary`).
- Emit a Finding flagging the endpoint as config-dependent (its response is not a pure function of its input).
- Update the gap-fill prompt at `discovery-service/src/services/prompts/frameworks/java-spring-boot.md` (the `@ConditionalOnProperty`/`@Profile` collapse bullet) so it STOPS collapsing branches that change the RESPONSE.
- Narrow the edit to response-shaping divergence; do NOT mandate one `business_logics` candidate per branch for non-response config.

**New dedicated stage, not an extension of Spec 2's selector**
- Response-contract capture is its OWN deterministic scanner + OWN optional LLM stage; it does NOT overload or widen Spec 2's method selector (which only admits endpoint-reachable `business_logics` methods and cannot see controllers/advice/filters/serializers — verified admit gate ~line 514).
- Register a new emission source in `emissionSources.ts` and use `FindingEmitter` for the unresolved-auth and config-dependent Findings.

**MCP additive save-back pass-through**
- In `candidateSaveBackService.ts`, pass `response_contract` through onto the endpoint candidate, mirroring the existing additive idioms (`entity.behavior = data.behavior` ~1097–1098; `path_metadata_json` snake/camel-tolerant pass-through ~1159–1160).
- Accept both `data.response_contract` and `data.responseContract`; store onto the AMS `endpoints.response_contract` column.
- Additive + nullable: endpoints with no contract round-trip cleanly.

**Read-only UI surfacing in the existing panel**
- Render the contract READ-ONLY and expandable in the EXISTING endpoint candidate-details panel (`CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`).
- Reuse the `SUPPORTED_DETAIL_TYPES` expandable read-only pattern Spec 2 used for `business_logics`, plus the existing low-confidence visual treatment for the `confidence` badge.
- NO new panel type; NO accept/reject/edit on the contract block itself (the endpoint candidate is already reviewable).

## Visual Design
No visual assets provided. The feature reuses Spec 2's existing expandable read-only candidate-details panel pattern; no mockups needed.

## Existing Code to Leverage

**Spec 2 behaviour capture — the structural twin**
- Changeset `architecture-model-service/src/main/resources/db/changelog/sql/162-business-logic-behavior.sql`: clone the JSONB-on-existing-entity column shape.
- `discovery-service/src/services/llmBehaviourCaptureStep.ts`: mirror gateway-relay + tier-gating + `temperature: 0`, `getConfidenceForTag`, concurrency/skip/failure handling; the admit gate (~line 514) confirms the selector cannot see response-shaping layers — hence a new stage.

**Spec 1 endpoint→data-effect resolution + loose-JSONB precedent**
- `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts` and `endpointDataEffectCandidates.ts`: reuse controller→advice/method resolution to attach the contract to the right endpoint; do not re-derive the call graph.
- Changeset `161-endpoint-data-effects.sql`: `path_metadata_json` loose-JSONB precedent for the embedded `schema_version`.

**springBoot adapter security reader + springClassic emission**
- `discovery-service/src/services/extensionPacks/frameworkAdapters/springBoot/index.ts` (~152–155, 403–425, 605): port the `@PreAuthorize`/`@Secured`/`@RolesAllowed` reader (verified: `ENDPOINT_SECURITY_ANNOTATIONS` list present).
- `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts` (emission sites ~543, 1209, 1281, 1327): verified ZERO security references today — the gap this spec fixes; new contract attaches to these endpoint candidates.

**Findings emission + save-back idioms**
- `discovery-service/src/services/findings/FindingEmitter.ts` + `emissionSources.ts`: register a new emission source for unresolved-auth / config-dependent Findings.
- `mcp-server/src/services/candidateSaveBackService.ts` (~1097–1098, ~1159–1160): mirror the additive snake/camel-tolerant pass-through for `response_contract`.

**Endpoint DTO + candidate-details panel + Spec 3 precedent**
- `architecture-model-service/.../model/dto/entity/EndpointDto.java`: verified snake_case, NO `@CamelCaseWire` — add `response_contract` as `@JsonProperty("response_contract")`.
- `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`: reuse `SUPPORTED_DETAIL_TYPES` expandable read-only + low-confidence treatment.
- Changeset `164-physical-entity-constraints-jsonb.sql`: second JSONB-on-existing-entity precedent.

## Out of Scope
- Non-Spring / non-Java stacks (Java / Spring-Classic first; design to extend).
- Runtime harness changes — Spec #2 owns seeding and CONSUMES this contract; this spec does not touch the harness.
- Blocking gates — capture is additive and advisory, never a gate.
- New entity or relationship TYPES; any `*_points` creation.
- Outbound / SOAP response-contract capture in v1 (inbound HTTP Spring-Classic endpoints first).
- Shape-spec / book-of-work generation that later consumes the contract (only persist/display/expose here).
- Accept/reject/edit actions on the contract block (view-only).
- Editing any applied Liquibase changeset (comment-only edits also break startup via checksum validation).
- Direct LLM calls from discovery-service (all access via the existing gateway relay).
- Mandating one `business_logics` candidate per branch for non-response config (prompt edit narrowed to response-shaping divergence).
