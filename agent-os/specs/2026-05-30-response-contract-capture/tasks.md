# Task Breakdown: Per-endpoint response-contract capture (Java / Spring-Classic first)

## Overview
Total Tasks: 5 task groups, 38 sub-tasks.

Program note: This is Spec #1 of the 6-spec Phase-2 program and is built FIRST.
Everything here is additive + nullable: endpoints with no contract must round-trip
cleanly. Program constraints that bind every group below:
- NEVER edit an applied Liquibase changeset (167 is highest applied; the new one is
  ≥ 168). Comment-only edits also break startup via checksum validation.
- Do NOT add `@CamelCaseWire` to `EndpointDto` (verified plain snake_case).
- Deterministic detection ALWAYS runs; LLM enrichment is tier-gated like Spec 2's
  `llmBehaviourCaptureStep` (NOT an off-by-default opt-in flag).
- All LLM access goes through Spec 2's EXISTING gateway relay at `temperature: 0`;
  NO direct LLM calls from discovery-service.
- `confidence` is a boxed `Double` INSIDE the JSONB blob; NO separate column.
- Do NOT edit `discovery-service/src/**` while a discovery run is in flight.
- The user starts services and owns all git operations; this build stops at code +
  verification.

## Task List

### AMS layer (Java / Spring Boot)

#### Task Group 1: `response_contract` JSONB column, JPA mapping, DTO + read-path exposure
**Dependencies:** None

- [x] 1.0 Add the `response_contract` JSONB field to the `endpoints` meta-model and
  expose it on the read path.
  - [x] 1.1 Write 2-8 focused tests: (a) a Liquibase/JPA persistence test that
    saves an `Endpoint` with a populated `response_contract` blob (including a boxed
    `Double` `confidence` and an internal `schema_version`) and reads it back
    byte-equivalently; (b) a null/round-trip test proving an endpoint with no
    contract persists and reads back as `null` (additive + nullable); (c) a Jackson
    serialization test asserting `EndpointDto` emits the field as snake_case
    `response_contract` on the wire and that `confidence: null` is preserved (not
    coerced to `0.0`).
  - [x] 1.2 Create a NEW Liquibase changeset at the next free number ≥ 168 under
    `architecture-model-service/src/main/resources/db/changelog/sql/` adding ONE
    nullable `response_contract` JSONB column to the EXISTING `endpoints` table.
    Mirror the column shape of `162-business-logic-behavior.sql` /
    `164-physical-entity-constraints-jsonb.sql`. Register it in the changelog
    master. Do NOT touch any applied changeset.
  - [x] 1.3 Map `response_contract` on the `Endpoint` JPA entity as JSONB using the
    same idiom as `behavior`, with boxed types (so PATCH-with-no-value preserves
    null). The blob embeds its own internal `schema_version`.
  - [x] 1.4 Add `response_contract` to `EndpointDto.java` as an explicit
    `@JsonProperty("response_contract")` field. Do NOT add `@CamelCaseWire`. Keep
    `confidence` boxed (`Double`) inside the blob model.
  - [x] 1.5 Expose `response_contract` on the endpoint read path (entity→DTO
    mapping / read controller/service) so Spec #2 and future consumers can read it.
  - [x] 1.6 Ensure AMS-layer tests pass (run ONLY the tests written in 1.1).

**Acceptance Criteria:**
- A new changeset ≥ 168 adds a nullable `response_contract` JSONB column to
  `endpoints`; no applied changeset is modified; the app starts (checksums valid).
- `Endpoint` persists/reads the blob as JSONB with boxed types; `confidence: null`
  is preserved, never wiped to `0.0`.
- `EndpointDto` serializes the field as snake_case `response_contract`; NO
  `@CamelCaseWire` is present.
- An endpoint with no contract round-trips cleanly as `null`.
- The read path returns `response_contract` for downstream consumers.

### discovery-service (springClassic adapter + LLM enrichment + findings + prompt)

#### Task Group 2: Deterministic response-contract scanner + springClassic security + LLM enrichment + findings + prompt
**Dependencies:** Task Group 1 (blob shape / column shape finalized)

- [x] 2.0 Build the new deterministic response-contract scanner (always-on spine),
  the springClassic security capture, the tier-gated LLM-enrichment stage, the new
  emission source + Findings, and the gap-fill prompt edit. Do not edit `src/**`
  while a discovery run is in flight.
  - [x] 2.1 Write 2-8 focused tests against the new springClassic scanner using
    small fixture sources: (a) Group A — `@ControllerAdvice`/`@ExceptionHandler`/
    `@ResponseStatus` produce `error_responses[]` with `exception`/`status`/`source`,
    and `@Valid`/JSR-380 constraints produce `validation[]` with
    `field`/`constraint`/`failure_status`; (b) auth — method-level `@PreAuthorize`/
    `@Secured`/`@RolesAllowed` (incl. class-level inherited to method) fill
    `auth.required_roles` + expected 401/403, and an unresolvable filter-chain rule
    sets `auth.source = unresolved` AND emits a Finding (never guesses a role);
    (c) Group B — Jackson `@JsonInclude`/`@JsonFormat`/`@JsonProperty` and
    `ResponseEntity` status + `Location` fill `serialization` and
    `status_codes.success`/`location_header`; (d) `@ConditionalOnProperty`/
    `@Profile`/`@Value` response divergence yields `conditional_variants[]` + a
    config-dependent Finding; (e) the contract attaches to the correct endpoint via
    Spec 1's controller→method resolution and fills `provenance`.
  - [x] 2.2 Create the NEW deterministic scanner in the springClassic adapter
    (under `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/`).
    Deterministic detection ALWAYS runs. Implement Group A error/validation
    detection (`@ControllerAdvice`/`@ExceptionHandler`/`@ResponseStatus`;
    `@Valid`/JSR-380), Group B serialization (Jackson annotations / custom
    serializers / `ObjectMapper` config / date format / null handling / headers) and
    `status_codes` (`ResponseEntity` status + `Location`). Fill all statically-knowable
    fields plus every `source`/`provenance` field, and set the internal
    `schema_version` and a deterministic `confidence`.
  - [x] 2.3 Resolve which advice/security applies to each endpoint by REUSING Spec 1's
    controller→method resolution (`endpointDataEffectResolver.ts` /
    `endpointDataEffectCandidates.ts`); do NOT re-derive the call graph. Attach each
    contract to the right endpoint candidate at the existing springClassic emission
    sites.
  - [x] 2.4 Capture springClassic security (the audit gap): (i) PORT the springBoot
    adapter's method-level annotation reader (`@PreAuthorize`/`@Secured`/
    `@RolesAllowed`, springBoot `index.ts` ~152–155, 403–425, 605) into the new
    scanner, including class-level annotations inherited down to the method; and
    (ii) best-effort security-filter-chain parse — Spring Security `<http>` XML
    (`<intercept-url pattern access>`) and/or `SecurityFilterChain` /
    `WebSecurityConfigurerAdapter` bean URL→role rules — matched against each
    endpoint path to derive `required_roles` + expected 401/403.
  - [x] 2.5 Register a NEW emission source in
    `discovery-service/src/services/findings/emissionSources.ts` and use
    `FindingEmitter` to emit: an unresolved-auth Finding (with
    `auth.source = unresolved`, never a guessed role) for any rule that cannot be
    statically resolved (SpEL beyond simple roles, dynamic matchers, unparseable
    chains); and a config-dependent Finding for each endpoint whose response is not a
    pure function of its input.
  - [x] 2.6 Add the OPTIONAL LLM-enrichment stage that fills ONLY the prose/semantic
    sub-fields the static pass cannot (`body_shape`, `response_summary`, `message`
    interpolation, `envelope`). Route ALL LLM access through Spec 2's EXISTING gateway
    relay at `temperature: 0`; reuse Spec 2 conventions (concurrency pool, confidence
    tags via `getConfidenceForTag`, skip/failure-rate handling). Tier-gate EXACTLY
    like `llmBehaviourCaptureStep` (honoring the per-run cap + token ceiling); NOT an
    off-by-default opt-in flag. The deterministic spine bounds the enrichment set.
  - [x] 2.7 Edit the gap-fill prompt at
    `discovery-service/src/services/prompts/frameworks/java-spring-boot.md` (the
    `@ConditionalOnProperty`/`@Profile` collapse bullet, line ~76) so it STOPS
    collapsing branches that change the RESPONSE. Narrow the edit to response-shaping
    divergence; do NOT mandate one `business_logics` candidate per branch for
    non-response config.
  - [x] 2.8 Ensure discovery-service tests pass (run ONLY the tests written in 2.1).

**Acceptance Criteria:**
- A new deterministic scanner runs always-on in the springClassic adapter and
  produces a `response_contract` for endpoints, attached via Spec 1's resolution
  (no re-derived call graph).
- Group A (error/auth/validation) and Group B (serialization/status) fields are
  filled where statically knowable, with `source`/`provenance` populated and an
  embedded `schema_version`.
- springClassic now captures method-level authz annotations AND best-effort
  filter-chain rules; unresolved rules → Finding + `auth.source = unresolved`, never
  a guessed role.
- Config/profile/value response divergence is recorded as `conditional_variants[]`
  plus a config-dependent Finding; the gap-fill prompt no longer collapses
  response-shaping branches.
- The LLM stage fills only prose/semantic sub-fields via the existing gateway relay
  at `temperature: 0`, tier-gated like Spec 2; no direct LLM calls.
- A new emission source is registered; this stage does NOT overload Spec 2's method
  selector.

### MCP save-back

#### Task Group 3: Additive `response_contract` pass-through
**Dependencies:** Task Group 1 (AMS column exists)

- [x] 3.0 Pass `response_contract` through onto the endpoint candidate in
  `mcp-server/src/services/candidateSaveBackService.ts`.
  - [x] 3.1 Write 2-4 focused tests: (a) `data.response_contract` is stored onto the
    endpoint's `response_contract`; (b) the camelCase alias `data.responseContract`
    is accepted and stored identically (snake/camel-tolerant); (c) an endpoint with
    no contract round-trips cleanly (additive + nullable; field left untouched/null).
  - [x] 3.2 Add the additive snake/camel-tolerant pass-through mirroring the existing
    idioms (`entity.behavior = data.behavior` ~1097–1098; `path_metadata_json`
    snake/camel-tolerant pass-through ~1159–1160): accept both
    `data.response_contract` and `data.responseContract`, store onto the AMS
    `endpoints.response_contract` column. Do not overwrite an existing value with
    `undefined`/missing.
  - [x] 3.3 Ensure MCP save-back tests pass (run ONLY the tests written in 3.1).

**Acceptance Criteria:**
- Both `response_contract` and `responseContract` are accepted and persisted onto
  `endpoints.response_contract`.
- The pass-through is additive + nullable; endpoints without a contract round-trip
  cleanly with no overwrite.

### frontend (read-only surfacing)

#### Task Group 4: Read-only expandable contract block + confidence badge in the existing panel
**Dependencies:** Task Group 1 (DTO field shape), Task Group 3 (data present on candidate)

- [x] 4.0 Render the response contract READ-ONLY and expandable in the EXISTING
  endpoint candidate-details panel. NO new panel type; NO accept/reject/edit on the
  contract block.
  - [x] 4.1 Write 2-5 focused tests: (a) when an endpoint candidate has a
    `response_contract`, the expandable read-only block renders its sections
    (error_responses / auth / validation / serialization / status_codes /
    conditional_variants); (b) the `confidence` badge renders and the existing
    low-confidence visual treatment applies below the threshold; (c) when
    `response_contract` is absent/null, no block renders (additive, no crash);
    (d) the block exposes no accept/reject/edit controls.
  - [x] 4.2 Wire `response_contract` into `candidateDetailsSupport.ts` via
    `SUPPORTED_DETAIL_TYPES`, reusing the Spec 2 `business_logics` expandable
    read-only pattern, and render it in `CandidateDetailsPanel.tsx`. Apply the
    existing low-confidence visual treatment to the `confidence` badge.
  - [x] 4.3 Ensure frontend tests pass (run ONLY the tests written in 4.1).

**Acceptance Criteria:**
- The contract renders read-only and expandable inside the existing endpoint
  candidate-details panel using the established `SUPPORTED_DETAIL_TYPES` pattern.
- A `confidence` badge shows with the existing low-confidence treatment.
- No new panel type and no accept/reject/edit on the contract block; absent
  contracts render nothing and do not break the panel.

### Test review & gap analysis

#### Task Group 5: Cross-layer gap fill
**Dependencies:** Task Groups 1-4 complete

- [x] 5.0 Review the per-group tests for critical end-to-end gaps and fill them.
  - [x] 5.1 Review coverage across AMS persistence/wire, the scanner (Group A + B +
    security + conditional_variants), MCP save-back, and the UI; list any critical
    uncovered path.
  - [x] 5.2 Add up to a MAXIMUM of 10 strategic tests for critical gaps only —
    prioritize: an end-to-end round-trip (scanner-shaped contract → save-back →
    AMS persist → read DTO → snake_case wire → panel render); the boxed-`Double`
    `confidence` null-preservation across save-back/PATCH; and the `schema_version`
    forward-compat read.
  - [x] 5.3 Run the full focused suite (Groups 1-4 plus the gap tests) and confirm
    green. Verify additive + nullable behavior holds end-to-end (no contract →
    clean round-trip). Do not run while a discovery run is in flight.

**Acceptance Criteria:**
- No more than 10 additional strategic tests are added, targeting critical gaps only.
- An end-to-end round-trip is verified: deterministic contract → save-back → AMS →
  read DTO → snake_case wire → read-only panel.
- `confidence` boxed-null preservation and `schema_version` forward-compat are
  covered; the full focused suite is green.

## Execution Order
1. **Task Group 1 (AMS)** — changeset ≥ 168, JPA JSONB mapping, `EndpointDto`
   snake_case field, read-path exposure. Establishes the storage + wire contract.
2. **Task Group 2 (discovery-service)** — deterministic scanner (Group A + B),
   springClassic security capture, tier-gated LLM enrichment via the gateway relay,
   new emission source + Findings, gap-fill prompt edit. Depends on the blob shape
   from Group 1.
3. **Task Group 3 (MCP save-back)** — additive snake/camel-tolerant
   `response_contract` pass-through. Depends on the Group 1 column. Can proceed in
   parallel with Group 2 once Group 1 lands.
4. **Task Group 4 (frontend)** — read-only expandable contract block + confidence
   badge in the existing panel. Depends on Group 1 (DTO field) and Group 3 (data on
   the candidate).
5. **Task Group 5 (test review & gap analysis)** — cross-layer end-to-end gap fill
   (max 10 tests) after Groups 1-4 are complete.
