# Spec Requirements: Per-endpoint response-contract capture for discovery (Java / Spring Classic first) — Phase-2 Gap #1

## Initial Description

Spec **#1 of 6** of the HAIKAI Phase-2 "oracle perfection" program (like-for-like
API/DB migration tool), and the **highest priority** of the six. North star: memory
`project_migration_ultimate_goal` — treat a current service+DB as a black box and
upgrade the inside; the runtime harness (api-migration-validation-service)
captures→replays→diffs every endpoint, so the target MUST return byte-identical
responses (status + body + headers) for the same input.

**Problem / goal:** A 5-agent audit found the #1 gap — discovery captures what
endpoints and data EXIST, not what RESPONSE each input produces. The layers that
DETERMINE the response are invisible today. This spec captures the per-endpoint
RESPONSE CONTRACT and attaches it to the existing `endpoints` entity, so the seeding
spec (#2) can replay richer error/auth scenarios and a migration target can be judged
byte-for-byte.

**Audit findings this spec addresses (verified against the current tree):**

1. `@ControllerAdvice` / `@ExceptionHandler` / `@ResponseStatus` → error responses:
   the IR records them, but there are ZERO consumers. Every 4xx/5xx body+status is
   invisible. (Verified: no reader exists for these in the springClassic adapter.)
2. Security / authz: the **springClassic** pack (the migration source) captures NO
   security. Only the **springBoot** adapter reads `@PreAuthorize`/`@Secured`/
   `@RolesAllowed` (verified at
   `discovery-service/src/services/extensionPacks/frameworkAdapters/springBoot/index.ts`
   lines 152–155, 403–425, 605) — and that adapter never runs for a classic source.
   The springClassic adapter
   (`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/`:
   `index.ts`, `endpointDataEffectCandidates.ts`, `endpointDataEffectResolver.ts`) has
   ZERO security references (verified). Auth outcomes (401/403 vs 200) are
   response-changing and must be captured.
3. Bean validation (`@Valid` / JSR-380) → 400 bodies: not captured (only the
   `@RequestBody` type is read).
4. Serialization shape: Jackson `@JsonInclude`/`@JsonFormat`/`@JsonProperty`/custom
   serializers/date format/null handling, response headers, status-code semantics
   (201 vs 200, `Location`) — no consumers.
5. Config-conditional responses: `@ConditionalOnProperty`/`@Profile`/`@Value` branches
   that change the response — the gap-fill prompt ACTIVELY collapses them. (Verified
   verbatim at `discovery-service/src/services/prompts/frameworks/java-spring-boot.md:76`:
   "Do not speculate one candidate per branch — emit the underlying class/method once,
   annotated with the source file location.")
6. Spec 2 behaviour capture (`discovery-service/src/services/llmBehaviourCaptureStep.ts`,
   the admit gate ~line 514) only admits endpoint-reachable `business_logics` methods —
   it CANNOT see controllers/advice/filters/serializers, the layers that determine the
   response. So response-shaping layers need their OWN dedicated stage; they are not a
   subset of Spec 2's selector.

**Key framing / decisions carried from the raw idea (all FINAL, pre-approved):**

1. **Meta-model placement** = a NEW structured `response_contract` JSONB field ON the
   EXISTING `endpoints` entity (AMS), via a NEW Liquibase changeset. This is metadata
   ON an existing entity — it MIRRORS Spec 2's `business_logics.behavior`
   (`162-business-logic-behavior.sql`) and Spec 3's `physical_data_entities`
   `constraints_metadata` (`164-physical-entity-constraints-jsonb.sql`). It is NOT a
   new entity or relationship TYPE, and it is NOT a `*_points` wrapper. Coverage /
   error / auth / serialization behaviour is per-endpoint REALITY, conformant with the
   architecture-vs-reality principle (memory `project_architecture_vs_reality`).
2. **Single spec, internally phased** (NOT split into two): Group A = error / auth /
   validation OUTCOMES; Group B = serialization / header / status WIRE-SHAPE. One
   cohesive "response contract."
3. **Deterministic spine + LLM enrichment** (mirrors the program): a NEW deterministic
   scanner statically detects the annotations/config and resolves which advice/security
   applies to each endpoint; an OPTIONAL LLM-enrichment pass (reusing the Spec 2
   gateway relay + tier-gating, `temperature: 0`) fills response-body shapes/semantics.
   Deterministic detection ALWAYS runs; LLM enrichment is tier-gated like Spec 2.
4. **Security on the springClassic pack** (fixes the audit gap): capture method-level
   `@PreAuthorize`/`@Secured`/`@RolesAllowed` deterministically AND a best-effort
   security-filter-chain parse (Spring Security `<http>` XML and/or `SecurityFilterChain`
   bean URL→role rules). Rules that cannot be statically resolved → a Finding
   ("endpoint X auth determined by an unresolved filter chain").
5. **Config-conditional capture** (reverses the collapse): capture config/profile/value-
   conditional response divergence as `conditional_variants` in `response_contract`,
   plus a Finding flagging that the endpoint is config-dependent (not a pure function of
   its input). UPDATE the gap-fill prompt to STOP collapsing these branches
   (`java-spring-boot.md:76`).
6. **New dedicated stage**, NOT an overload of Spec 2's selector. Reuse Spec 1's
   controller→advice/method resolution to attach the contract to the right endpoint;
   reuse `FindingEmitter` for the un-modellable cases.
7. **Scope:** Java / Spring-Classic first (the migration source).

## Requirements Discussion

> All decisions below are FINAL and pre-approved by the user. They are recorded as
> question/answer pairs to match the established spec-folder structure; NONE are open,
> and NONE require relay to the user. The build runs autonomously and cannot ask
> questions — every value needed to build is stated here.

### First Round Questions

**Q1:** Where does the response contract live in the meta-model — a new entity, a new
relationship, or metadata on an existing entity?
**Answer:** Metadata ON the existing `endpoints` entity: ONE new nullable
`response_contract` JSONB column, added by a NEW Liquibase changeset. No new entity
type, no new relationship type, no `*_points` wrapper. This mirrors Spec 2's
`business_logics.behavior` and Spec 3's `physical_data_entities.constraints_metadata`,
which are the in-repo precedents for "rich per-entity reality captured as one JSONB
blob." The block embeds its OWN internal `schema_version` (loose JSONB, so the shape
can evolve with no further migration — Spec 1's `path_metadata_json` precedent).

**Q2:** What is the exact shape of `response_contract`?
**Answer:** ONE `response_contract` JSONB column whose top-level shape is:

```
{
  "error_responses": [
    { "exception": "<FQN or simple name>",
      "status": <int>,
      "body_shape": "<prose or structured sketch of the error body>",
      "source": "<@ControllerAdvice FQN#method | @ResponseStatus on type | @ExceptionHandler | inferred>" }
  ],
  "auth": {
    "required_roles": ["<role>", ...],
    "expected_unauthenticated_status": <int|null>,   // e.g. 401
    "expected_forbidden_status": <int|null>,         // e.g. 403
    "source": "<@PreAuthorize | @Secured | @RolesAllowed | <http> XML | SecurityFilterChain bean | unresolved>"
  },
  "validation": [
    { "field": "<bean field / param>",
      "constraint": "<@NotNull | @Size(...) | @Pattern(...) | ...>",
      "failure_status": <int>,                       // typically 400
      "message": "<message template if present>" }
  ],
  "serialization": {
    "null_handling": "<e.g. NON_NULL omits nulls | includes nulls | ...>",
    "date_format": "<pattern string or 'epoch-millis' / 'iso-8601' / null>",
    "field_naming": "<snake_case | camelCase | as-declared | per-field overrides>",
    "envelope": "<bare object | wrapped { data: ... } | list | page | null>",
    "headers": [ { "name": "<header>", "value_or_rule": "<literal or rule>" } ]
  },
  "status_codes": {
    "success": <int>,                                // e.g. 200 or 201
    "location_header": <bool>                         // true when a Location header is set (e.g. on 201)
  },
  "conditional_variants": [
    { "condition": "<@ConditionalOnProperty(...) | @Profile(...) | @Value branch>",
      "response_summary": "<how the response differs under this condition>" }
  ],
  "provenance": { "source_files": ["<path>", ...], "method_id": "<FQN + signature of the handler>", "advice_ids": ["<FQN#method>", ...] },
  "confidence": <double 0..1>
}
```

Typed enough that the UI can render each part section-by-section; loose enough that
prose sub-fields (`body_shape`, `response_summary`, `value_or_rule`) are free text.
The DETERMINISTIC scanner fills `status`, `exception`, `constraint`, `required_roles`,
`failure_status`, `success`/`location_header`, `field_naming`/`null_handling`/
`date_format` where annotated, and the `source`/`provenance` fields. The OPTIONAL LLM
pass fills `body_shape`, `response_summary`, `message` interpolation, `envelope`, and
any semantics that cannot be read statically. `confidence` is a boxed `Double` inside
the JSONB (boxed so a PATCH carrying no value preserves null rather than wiping to 0.0
— memory `project_primitive_double_dto_overwrite`); there is NO separate confidence
column.

**Q3:** Deterministic vs LLM — which parts are statically detected and which are
LLM-enriched, and how is the LLM pass gated?
**Answer:** Two-tier, mirroring the whole program. (a) DETERMINISTIC detection ALWAYS
runs (it is the spine): a new scanner statically detects `@ControllerAdvice`/
`@ExceptionHandler`/`@ResponseStatus`, `@PreAuthorize`/`@Secured`/`@RolesAllowed`,
`@Valid`/JSR-380 constraints, Jackson annotations (`@JsonInclude`/`@JsonFormat`/
`@JsonProperty`/custom serializer registrations/`ObjectMapper` config),
`@ConditionalOnProperty`/`@Profile`/`@Value`, and `ResponseEntity` status/`Location`
usages — and resolves which advice/security applies to each endpoint via Spec 1's
controller→method resolution. (b) An OPTIONAL LLM-enrichment pass fills response-body
SHAPES and SEMANTICS the static pass cannot (the prose sub-fields in Q2). The LLM pass
REUSES Spec 2's gateway-relay + tier-gating conventions (concurrency pool, confidence
tags via `getConfidenceForTag`, skip/failure-rate handling) and runs at
`temperature: 0`. GATING: deterministic always runs; LLM enrichment is tier-gated
exactly like Spec 2's `llmBehaviourCaptureStep` (NOT a separate off-by-default opt-in
flag — avoid a built-but-never-runs feature), with the program's per-run cap + token
ceiling. The deterministic spine keeps the enrichment set bounded.

**Q4:** How is security captured on the springClassic pack (the audit gap), and what
happens when it can't be resolved statically?
**Answer:** Capture BOTH: (i) method-level `@PreAuthorize`/`@Secured`/`@RolesAllowed`
on the controller handler (and class-level, inherited down to the method)
deterministically — port the springBoot adapter's existing annotation reader (its
`@PreAuthorize`/`@Secured`/`@RolesAllowed` logic, springBoot `index.ts` 152–155,
403–425) into the springClassic response-contract scanner so the classic source is no
longer security-blind; AND (ii) a best-effort security-filter-chain parse — Spring
Security `<http>` XML (`<intercept-url pattern access>`) and/or a `SecurityFilterChain`
/ `WebSecurityConfigurerAdapter` bean's URL→role authorization rules — matched against
each endpoint's path to derive `required_roles` + expected 401/403. Any rule that
CANNOT be statically resolved (SpEL beyond simple role checks, dynamic matchers,
method-security wired through an unparseable chain) → a Finding via `FindingEmitter`
("endpoint X auth determined by an unresolved filter chain"), and the contract's
`auth.source` is set to `unresolved` rather than guessed.

**Q5:** How is config-conditional response divergence handled, given the gap-fill prompt
currently collapses it?
**Answer:** REVERSE the collapse for response-shaping branches: when an endpoint's
response differs by `@ConditionalOnProperty`/`@Profile`/`@Value`, record each branch as
a `conditional_variants[]` entry in `response_contract` (`condition` +
`response_summary`) AND emit a Finding flagging the endpoint as config-dependent (its
response is not a pure function of its input). UPDATE the gap-fill prompt at
`discovery-service/src/services/prompts/frameworks/java-spring-boot.md:76` so it STOPS
instructing the model to collapse these to one candidate when the branch changes the
RESPONSE. (Scope note: the prompt edit is narrowed to response-shaping divergence; it
does not mandate one `business_logics` candidate per branch for non-response config.)

**Q6:** Is this a new stage, or an extension of Spec 2's selector?
**Answer:** A NEW dedicated stage. Spec 2's selector admits only endpoint-reachable
`business_logics` methods and CANNOT see controllers/advice/filters/serializers (the
response-shaping layers) — verified at the `llmBehaviourCaptureStep` admit gate
(~line 514). So response-contract capture gets its OWN deterministic scanner plus its
OWN optional LLM-enrichment stage. It REUSES Spec 1's controller→advice/method
resolution to attach each contract to the correct `endpoints` candidate, and REUSES
`FindingEmitter` for the un-modellable cases. It does NOT overload or widen Spec 2's
method selector.

**Q7:** How is the contract persisted on save-back and surfaced in the review UI?
**Answer:** PERSIST additively: the MCP save-back service
(`mcp-server/src/services/candidateSaveBackService.ts`) passes `response_contract`
through onto the endpoint candidate exactly like the existing additive idioms there
(`entity.behavior = data.behavior` at ~lines 1097–1098, and the
`path_metadata_json` snake/camel-tolerant pass-through at ~lines 1159–1160) — accept
both `data.response_contract` and `data.responseContract`, store onto the AMS
`endpoints.response_contract` column, additive + nullable so endpoints with no contract
round-trip cleanly. SURFACE: render the response contract READ-ONLY in the EXISTING
endpoint candidate-details panel (`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`
+ `candidateDetailsSupport.ts`) — reuse the `SUPPORTED_DETAIL_TYPES` expandable
read-only pattern Spec 2 used for `business_logics`, plus the existing low-confidence
visual treatment for the `confidence` badge. NO new panel type, NO accept/reject/edit
on the contract block itself (the endpoint candidate is already reviewable).

**Q8:** What is the AMS wire convention for the new field?
**Answer:** snake_case — `response_contract` — with NO `@CamelCaseWire`. VERIFIED: the
endpoint DTO `architecture-model-service/.../model/dto/entity/EndpointDto.java` is a
plain record using explicit `@JsonProperty("snake_case")` declarations
(`interface_id`, `endpoint_type`, `path_or_address`, `protocol_metadata_json`, …) and
is NOT annotated `@CamelCaseWire`; it follows the AMS snake_case default. (The
`@CamelCaseWire`-annotated `EndpointDataEffectDto` is a DIFFERENT, Spec-1 DTO and is
NOT the attachment point here.) Therefore `response_contract` is snake_case on the wire
and inside the JSONB, matching its host DTO. NO `@CamelCaseWire` is to be added.

**Q9:** What is explicitly out of scope?
**Answer:** Non-Spring / non-Java stacks (Java / Spring-Classic first; design to
extend); the runtime harness changes — Spec #2 owns seeding and CONSUMES this spec's
`response_contract`, this spec does not touch the harness; blocking gates (capture is
additive and advisory, never a gate); new entity or relationship TYPES; any `*_points`
creation; outbound/SOAP response-contract capture in v1 (inbound HTTP Spring-Classic
endpoints first, consistent with Spec 1's inbound-HTTP scope); and any
shape-spec / book-of-work generation that later consumes the contract (only
persist/display/expose here).

### Existing Code to Reference

**Similar Features Identified (verified to exist in the current tree):**

- Feature: Spec 2 behaviour capture — the closest structural twin (rich per-entity
  JSONB on an existing entity, deterministic-selector + gateway-relay LLM pass +
  tier-gating + `temperature: 0`, read-only expandable candidate panel). Paths:
  changeset `architecture-model-service/src/main/resources/db/changelog/sql/162-business-logic-behavior.sql`;
  stage `discovery-service/src/services/llmBehaviourCaptureStep.ts` (admit gate ~line
  514; `getConfidenceForTag` + tier-gating live here). MIRROR its column shape, its
  relay conventions, and its UI treatment.
- Feature: Spec 3 `constraints_metadata` JSONB on `physical_data_entities` — second
  precedent for "structured per-entity reality as one JSONB blob." Changeset
  `architecture-model-service/src/main/resources/db/changelog/sql/164-physical-entity-constraints-jsonb.sql`.
- Feature: Spec 1 endpoint→data-effect resolution (controller→service call-graph,
  stable method-id keying, `path_metadata_json` loose-JSONB precedent). Paths:
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts`
  and `endpointDataEffectCandidates.ts`; changeset
  `architecture-model-service/src/main/resources/db/changelog/sql/161-endpoint-data-effects.sql`.
  REUSE the controller→advice/method resolution to attach each contract to the right
  endpoint; do NOT re-derive the call graph.
- Feature: springClassic adapter endpoint emission (where `endpoints` candidates are
  produced; the new contract attaches to these). Path:
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`
  (emission sites ~543, 1209, 1281, 1327). VERIFIED to contain ZERO security references
  today — this is the gap Decision 4 fixes.
- Feature: springBoot adapter security reader (the ONLY existing reader of
  `@PreAuthorize`/`@Secured`/`@RolesAllowed`; never runs for a classic source). Path:
  `discovery-service/src/services/extensionPacks/frameworkAdapters/springBoot/index.ts`
  (lines 152–155, 403–425, 605). PORT its annotation-reading logic into the new
  springClassic response-contract scanner.
- Feature: gap-fill prompt with the config-collapse instruction to reverse. Path:
  `discovery-service/src/services/prompts/frameworks/java-spring-boot.md:76` (verbatim:
  "Do not speculate one candidate per branch — emit the underlying class/method once,
  annotated with the source file location.").
- Feature: Findings emission + emission sources registry. Paths:
  `discovery-service/src/services/findings/FindingEmitter.ts` and
  `discovery-service/src/services/findings/emissionSources.ts` (the contract scanner
  registers a new emission source here for the unresolved-auth / config-dependent
  Findings).
- Feature: MCP additive save-back pass-through idiom. Path:
  `mcp-server/src/services/candidateSaveBackService.ts` (`entity.behavior = data.behavior`
  ~1097–1098; `path_metadata_json` snake/camel-tolerant pass-through ~1159–1160).
  MIRROR for `response_contract`.
- Feature: endpoint DTO + candidate-details panel. Paths:
  `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/EndpointDto.java`
  (snake_case, NO `@CamelCaseWire` — add `response_contract` here);
  `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` +
  `frontend/src/components/DashboardView/candidateDetailsSupport.ts` (`SUPPORTED_DETAIL_TYPES`
  expandable read-only pattern + low-confidence visual treatment).

### Follow-up Questions

No follow-up questions were required. All decisions were pre-approved by the user and
are recorded above as final; the code anchors were verified against the current tree
during this requirements pass.

## Visual Assets

### Files Provided:

No visual assets provided. The feature reuses Spec 2's existing expandable
candidate-details panel pattern for the read-only contract block; no mockups are
needed. (The `planning/visuals/` folder was created and is empty.)

### Visual Insights:

Not applicable — proceeding without visuals per the user's confirmation; UI reuses the
established `SUPPORTED_DETAIL_TYPES` expandable read-only treatment.

## Requirements Summary

### Functional Requirements

- Capture a per-endpoint RESPONSE CONTRACT — what response (status + body + headers)
  each input produces — and attach it to the EXISTING `endpoints` entity, so the
  migration target can be judged byte-for-byte and the seeding spec (#2) can replay
  richer error/auth scenarios.
- Store the contract as ONE `response_contract` JSONB column on `endpoints`, with the
  Q2 shape (error_responses, auth, validation, serialization, status_codes,
  conditional_variants, provenance, confidence), an internal `schema_version`, and a
  boxed-`Double` `confidence` inside the blob.
- Run a NEW DETERMINISTIC scanner (the spine, always on) that statically detects:
  `@ControllerAdvice`/`@ExceptionHandler`/`@ResponseStatus` (Group A error outcomes);
  `@PreAuthorize`/`@Secured`/`@RolesAllowed` + a best-effort Spring Security `<http>`
  XML / `SecurityFilterChain` bean filter-chain parse (Group A auth outcomes);
  `@Valid`/JSR-380 constraints (Group A validation 400s); Jackson `@JsonInclude`/
  `@JsonFormat`/`@JsonProperty`/custom serializers/date format/null handling +
  response headers (Group B serialization); `ResponseEntity` status + `Location`
  semantics (Group B status_codes); and `@ConditionalOnProperty`/`@Profile`/`@Value`
  response divergence (conditional_variants). It resolves which advice/security applies
  to each endpoint via Spec 1's controller→method resolution.
- Run an OPTIONAL LLM-enrichment pass that fills the prose/semantic sub-fields the
  static pass cannot (body_shape, response_summary, message interpolation, envelope),
  via the Spec 2 gateway relay at `temperature: 0`, reusing Spec 2's concurrency pool,
  confidence tags (`getConfidenceForTag`), and skip/failure-rate handling. Tier-gate it
  exactly like Spec 2 (NOT an off-by-default opt-in flag), with the program's per-run
  cap + token ceiling.
- Fix the springClassic security gap: the classic source must now capture method-level
  authz annotations (ported from the springBoot reader) AND best-effort filter-chain
  rules; unresolved rules → a Finding and `auth.source = unresolved` (never guessed).
- Reverse the config-collapse: record config/profile/value-conditional response
  divergence as `conditional_variants` + a config-dependent Finding, and update the
  gap-fill prompt at `java-spring-boot.md:76` to stop collapsing response-shaping
  branches.
- Persist the contract additively via MCP save-back (snake/camel-tolerant pass-through
  onto `endpoints.response_contract`, mirroring the existing `behavior` /
  `path_metadata_json` idioms), additive + nullable.
- Surface the contract READ-ONLY + expandable, with a confidence badge, in the EXISTING
  endpoint candidate-details panel (reuse `SUPPORTED_DETAIL_TYPES` + the low-confidence
  visual treatment). View-only — no accept/reject/edit on the contract block.
- Expose `response_contract` on the AMS endpoint read DTO so Spec #2 (seeding) and any
  future downstream consumer can read it.

### Reusability Opportunities

- `162-business-logic-behavior.sql` + `llmBehaviourCaptureStep.ts`: the structural twin
  — clone the JSONB-on-existing-entity column shape, the gateway-relay + tier-gating +
  `temperature: 0` conventions, and the read-only expandable UI treatment.
- `164-physical-entity-constraints-jsonb.sql`: second JSONB-on-existing-entity
  precedent.
- Spec 1's `endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts` +
  `161-endpoint-data-effects.sql`: reuse the controller→advice/method resolution and
  the loose-JSONB (`path_metadata_json`) precedent; do not re-derive the call graph.
- springBoot adapter `index.ts` (152–155, 403–425, 605): port the
  `@PreAuthorize`/`@Secured`/`@RolesAllowed` reader into the springClassic scanner.
- `FindingEmitter.ts` + `emissionSources.ts`: reuse for the unresolved-auth and
  config-dependent Findings (register a new emission source).
- `candidateSaveBackService.ts` (~1097–1098, ~1159–1160): mirror the additive
  pass-through idiom for `response_contract`.
- `EndpointDto.java` + `CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`:
  the snake_case host DTO and the `SUPPORTED_DETAIL_TYPES` expandable read-only panel.

### Scope Boundaries

**In Scope:**

- AMS meta-model: a NEW Liquibase changeset (next free number ≥ 168 at build time — 167
  is the highest applied today; `2026-*` dated files are non-numeric and do not occupy
  168) adding a nullable `response_contract` JSONB column to the EXISTING `endpoints`
  table; snake_case wire, NO `@CamelCaseWire` (matching `EndpointDto`'s verified
  convention); read-DTO exposure of the column.
- discovery-service (springClassic, inbound HTTP): a NEW deterministic response-contract
  scanner (error/auth/validation/serialization/status/conditional detection +
  advice/security resolution) and an OPTIONAL LLM-enrichment stage via the gateway
  relay (tier-gated, `temperature: 0`); the springClassic security capture (annotations
  + filter chain); the gap-fill prompt edit at `java-spring-boot.md:76`; a new
  `emissionSources.ts` entry + `FindingEmitter` use for unresolved-auth /
  config-dependent Findings.
- MCP save-back: additive `response_contract` pass-through onto the endpoint candidate.
- frontend: render the read-only expandable contract block + confidence badge in the
  EXISTING endpoint candidate-details panel.
- Java / Spring-Classic, inbound HTTP endpoints only; designed to extend.

**Out of Scope:**

- Non-Spring / non-Java stacks (Java / Spring-Classic first; design to extend).
- The runtime harness changes — Spec #2 owns seeding and CONSUMES this contract; this
  spec does not touch the harness.
- Blocking gates — capture is additive and advisory, never a gate.
- New entity or relationship TYPES; any `*_points` creation.
- Outbound / SOAP response-contract capture in v1 (inbound HTTP first, per Spec 1's
  scope).
- Shape-spec / book-of-work generation that later consumes the contract (only
  persist/display/expose here).
- Accept/reject/edit actions on the contract block (view-only).

### Technical Considerations

- AMS speaks snake_case at the wire by default (CLAUDE.md). `response_contract` is
  snake_case and is added WITHOUT `@CamelCaseWire`, because its host DTO `EndpointDto`
  is snake_case (verified: explicit `@JsonProperty("snake_case")` declarations, no
  `@CamelCaseWire`). Do NOT add `@CamelCaseWire`.
- Add the column via a NEW Liquibase changeset ONLY (next free ≥ 168 at build time).
  NEVER edit an applied changeset — comment-only edits also break startup via Liquibase
  checksum validation (memory `feedback_liquibase_immutable_changesets`).
- The contract is metadata ON the existing `endpoints` entity — NOT a new entity /
  relationship type and NOT a `*_points` wrapper. This is conformant with the
  architecture-vs-reality principle: error/auth/serialization behaviour is per-endpoint
  REALITY (memory `project_architecture_vs_reality`, `feedback_read_meta_model`).
- `confidence` is a boxed `Double` INSIDE the JSONB so a PATCH carrying no value
  preserves null rather than wiping to 0.0 (memory
  `project_primitive_double_dto_overwrite`); there is NO separate confidence column.
  The block embeds its own `schema_version` so the shape can evolve with no further
  migration (Spec 1's `path_metadata_json` precedent).
- Deterministic detection ALWAYS runs; LLM enrichment is OPTIONAL and tier-gated like
  Spec 2 (NOT an off-by-default opt-in flag). All LLM access goes through the EXISTING
  gateway relay used by Spec 2 — NO direct LLM calls from discovery-service —
  at `temperature: 0`.
- Unresolved security (SpEL beyond simple roles, dynamic matchers, unparseable chains)
  → a Finding via `FindingEmitter`, and `auth.source = unresolved`; never guess a role.
- The gap-fill prompt edit is narrowed to RESPONSE-shaping config branches; it does not
  mandate one `business_logics` candidate per branch for non-response config.
- Do NOT edit `discovery-service/src/**` while a discovery run is in flight — tsx watch
  auto-reload kills runs (memory `feedback_no_src_edits_during_run`).
- The user starts services and owns all git operations; the build stops at code +
  verification (memories `feedback_user_starts_services`, `feedback_no_git_operations`).

### Build Layering (within this spec)

1. **AMS** — NEW Liquibase changeset (≥ 168) adding `response_contract` JSONB to
   `endpoints`; add `response_contract` to the `Endpoint` JPA entity (boxed types;
   JSONB mapping like `behavior`) and to `EndpointDto` (snake_case `@JsonProperty`, NO
   `@CamelCaseWire`); expose on the read path.
2. **discovery-service** — the NEW deterministic response-contract scanner (Group A +
   Group B detection + advice/security resolution reusing Spec 1) + the OPTIONAL
   gateway-relay LLM-enrichment stage (tier-gated, `temperature: 0`, Spec 2
   conventions) + the springClassic security capture + the `java-spring-boot.md:76`
   prompt edit + the new `emissionSources.ts` entry / `FindingEmitter` Findings.
3. **MCP save-back** — additive `response_contract` pass-through in
   `candidateSaveBackService.ts` (snake/camel-tolerant), like Spec 4's field
   pass-throughs.
4. **frontend** — render the read-only expandable contract block + confidence badge in
   the EXISTING endpoint candidate-details panel (`SUPPORTED_DETAIL_TYPES` +
   low-confidence treatment); NO new panel type.

### Phase-2 Build Ordering & File-Overlap (program-level)

This is **Spec #1 of a 6-spec Phase-2 "oracle perfection" program** built **STRICTLY
SEQUENTIALLY #1 → #6, committing between each**, because the specs share core files.
**Build #1 (this spec) FIRST.**

- **Files this spec touches** (and that later specs also touch — hence the strict
  ordering):
  - AMS `endpoints` entity + `EndpointDto` + a NEW changeset (≥ 168).
  - discovery `springClassic` scanners
    (`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/**`)
    + the gap-fill prompt
    (`discovery-service/src/services/prompts/frameworks/java-spring-boot.md`) + the
    Findings emission registry
    (`discovery-service/src/services/findings/emissionSources.ts`).
  - `mcp-server/src/services/candidateSaveBackService.ts`.
  - the frontend endpoint candidate-details panel
    (`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` +
    `candidateDetailsSupport.ts`).
- **Why ordering matters / known overlaps:**
  - Later specs **#3 (integrity)** and **#4 (inbound)** also touch the springClassic
    scanners and `emissionSources.ts` — building #1 first establishes the
    response-contract scanner + its emission source before they layer on.
  - **#2 (seeding)** CONSUMES this spec's `response_contract` to drive richer error/auth
    replay scenarios — so #1 must land and commit before #2 builds.
  - Each spec commits before the next begins, so #1 is self-contained, additive, and
    must not break the shared files for the specs that follow.
