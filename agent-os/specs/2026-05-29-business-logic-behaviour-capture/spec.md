# Specification: Business-logic behaviour capture for discovery (Java / Spring Classic first) — Gap C

## Goal
Capture a tech-agnostic, confidence-scored STRUCTURED BEHAVIOUR SPEC (a 7-part block) per rule-bearing Java/Spring method, rich enough for an LLM to faithfully re-implement the logic in a new stack, attached to the existing `business_logics` candidate and keyed by the stable method id Spec 1 already stamps. This is Gap C — the Tier-1 partner of the built Spec 1 (endpoint→data-effect call graph); together they form the implementation-ready specification oracle.

## User Stories
- As a migration engineer, I want each rule-bearing `business_logics` candidate to carry a structured, section-by-section description of what the method does (IO, validation, computation, data/side effects, edge cases), so I (and a downstream LLM) can re-implement equivalent behaviour in the target stack without reading the original source.
- As a reviewer, I want to expand a `business_logics` candidate in the existing details panel and read the captured behaviour with a confidence badge, so I can judge how much to trust the reconstruction guidance — knowing the runtime harness remains the equivalence verifier.

## Specific Requirements

**Behaviour block shape (the 7-part structured spec)**
- Per rule-bearing method, capture: (1) IO — input names/types/meaning, output type/meaning; (2) validation/preconditions — checks plus the error/exception → HTTP status/SOAP fault on failure; (3) transformation/computation — formulas, field mappings, aggregations, branches, sort/order, defaulting (structured pseudo-logic + prose); (4) data effects — REUSE Spec 1's endpoint→data edges / method-level touches, do NOT re-derive; (5) side effects — external calls, events, audit, idempotency; (6) edge cases — null/empty/boundary per branch; (7) provenance + confidence — source method id (FQN+signature) + a confidence score.
- Typed enough that the UI can render the 7 parts section-by-section; loose enough that prose sub-fields are free text. The LLM is prompted to emit exactly this documented shape.
- The block carries an internal `schema_version` (loose JSONB, no migration as the shape evolves — mirrors Spec 1's `path_metadata_json` precedent) and a `source_hash` (for re-run skip).
- Keyed by the stable method id `FQN#name(ParamTypes)` (e.g. `com.foo.OwnerService#save(Owner)`) that Spec 1 already stamps onto `business_logics` via `method.methodId`. Do NOT introduce a new key and do NOT add `class`/`method` candidate types.

**AMS schema — new `behavior` JSONB column on the business-logic entity**
- Add ONE `behavior` JSONB column to the existing `business_logics` table via a NEW Liquibase changeset file (NEVER edit the applied `015-business-logic.sql` or any applied changeset — comment-only edits also break startup via checksum validation).
- Model the column on Spec 1's `161-endpoint-data-effects.sql`: JSONB structured metadata; the embedded confidence is `DOUBLE PRECISION` mapped to a boxed `Double` in the JPA entity/DTO so PATCH preserves null (per `project_primitive_double_dto_overwrite.md`).
- snake_case wire by default; do NOT apply `@CamelCaseWire` (the discovery AMS client and frontend snake_case-typed API modules consume it).
- Expose the block on the AMS read DTO for business logics, keyed by the method id, so a future shape-spec / book-of-work step can consume it.

**Extraction stage — new per-method `llmBehaviourCaptureStep.ts`**
- Add a NEW sibling discovery stage `discovery-service/src/services/llmBehaviourCaptureStep.ts` that operates per-METHOD (not per-file), reusing the gap-fill conventions: the gateway LLM relay (`gatewayClient`, NOT a direct LLM call), the `prompts/` composer pattern, the hand-rolled concurrency pool, confidence tags via `getConfidenceForTag`, and skip / failure-rate handling (`failures[]`, max-failure-rate → stage `failed`).
- Do NOT overload the per-FILE gap-fill stage (`llmGapFillStep.ts`); it is a distinct sibling stage with the same idioms.
- LLM analysis DEPTH = the method body + 1 hop of direct-callee bodies only; the callee cap is env-tunable (no unbounded fan-out).
- Add a new confidence tag (e.g. `llm-behaviour-capture`) to the `confidence.ts` tag family (`ConfidenceTagKey`, `CONFIDENCE_DEFAULTS`, `CONFIDENCE_RANGES`, env override) so blocks are confidence-scored via the existing clamp/midpoint logic; never present as proven.

**Stage gating, caps, and pipeline wiring**
- Run the stage as part of the existing LLM stages in `discoveryV3Pipeline.ts`, TIER-GATED exactly like gap-fill (driven by the run's computed tier A/B/C) — NOT a separate off-by-default opt-in flag (avoid a built-but-never-runs feature).
- Bound cost with a per-run method cap and a token ceiling (env-tunable), on top of the deterministic selector keeping the method set small.
- Persist stage metrics on the run's steps payload alongside the gap-fill metrics (processed / skipped / cache-hit / failures / stage status).
- Do NOT edit `discovery-service/src/**` while a discovery run is in flight (tsx watch auto-reload kills runs).

**Deterministic method selector**
- A method qualifies for behaviour capture only if ALL hold: (i) it is a `business_logics` candidate, AND (ii) it is endpoint-reachable via Spec 1's call graph, AND (iii) it survives a DETERMINISTIC boilerplate exclusion. The selector is deterministic (not LLM-judged) to bound cost and reuse Spec 1's work.
- EXCLUDE: getters/setters/`equals`/`hashCode`/`toString`/builders, Lombok-generated methods, framework `@Override` callbacks, and trivial one-liners.
- ALWAYS INCLUDE: `@Transactional` methods, custom-exception throwers, and anything on an endpoint→data path.

**Caching via `source_hash`**
- `source_hash` = hash of the normalized method body PLUS the signatures/bodies of the 1-hop callees actually fed to the LLM.
- On re-run, if the stored `source_hash` is unchanged, SKIP the LLM call and carry the prior `behavior` block forward verbatim.
- Do NOT invalidate the block on Spec 1 data-effect edge changes — the edges are LINKED live (read at render/consume time), not embedded in the block, so edge churn must not force re-capture.

**Read UI — expandable read-only block in the existing candidate-details panel**
- Add `business_logics` to `SUPPORTED_DETAIL_TYPES` in `candidateDetailsSupport.ts` so the candidate gains an expandable details surface.
- Render the 7-part block read-only and section-by-section with a confidence badge, plugged into `CandidateDetailsPanel.tsx` as a conditional block keyed on `candidate_type === 'business_logics'` — mirroring how `EndpointDataEffectPathBlock` is conditionally rendered for `endpoint_data_effects`.
- Reuse Spec 1's expandable disclosure pattern (`useState` toggle, `aria-expanded`, Show/Hide control, per-section `data-testid`) and the existing low-confidence visual treatment.
- VIEW-ONLY: no accept/reject/edit actions on the block itself (the candidate is already reviewable through the normal candidate workflow). Tolerate a missing or malformed block by rendering nothing / a stub, never throwing.

**Linkage to endpoints and data (reuse, do not re-derive)**
- Link behaviour → invoking endpoint(s) via Spec 1's call graph, and → data touched via Spec 1's endpoint→data edges (the `method_id`-keyed path hops on `endpoint_data_effects`). The block references these live; it does not copy or re-derive them.

**Scope gate — Java / Spring Classic, inbound-HTTP-only v1**
- Java / Spring Classic pack first, designed to extend. Behaviour capture INHERITS Spec 1's INBOUND-HTTP-ONLY v1 scope because the endpoint-reachable method set comes from Spec 1's inbound-HTTP-only edges.

## Visual Design
No visual assets were provided (`planning/visuals/` is empty). The feature reuses Spec 1's expandable candidate-details panel and the existing low-confidence visual treatment; no mockups are required.

## Existing Code to Leverage

**`discovery-service/src/services/llmGapFillStep.ts` (+ `prompts/` composer, `gatewayClient`, `confidence.ts`)**
- The LLM-pass precedent to clone for the new per-method stage: gateway relay via `gatewayClient`, layered prompt composition, hand-rolled `promisePool` concurrency (env-tunable), skip heuristic, `failures[]` + max-failure-rate → stage `failed`, and `getConfidenceForTag` clamping/midpoint.
- `confidence.ts` exposes `ConfidenceTagKey`, `CONFIDENCE_DEFAULTS`, `CONFIDENCE_RANGES`, and env overrides — extend with a new behaviour-capture tag rather than inventing a parallel confidence scheme.

**`architecture-model-service/.../db/changelog/sql/161-endpoint-data-effects.sql`**
- Precedent for the new `behavior` column: JSONB structured metadata + `DOUBLE PRECISION` confidence mapped to a boxed `Double` so PATCH preserves null. Follow the same snake_case, no-`@CamelCaseWire`, NEW-changeset approach.

**`architecture-model-service/.../db/changelog/sql/015-business-logic.sql`**
- The label-only `business_logics` schema this spec extends (`name`, `type_text`, `description_md`, `tags`, temporal columns). Add the `behavior` column via a NEW changeset; NEVER edit 015.

**`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`**
- `SUPPORTED_DETAIL_TYPES` allowlist + the `EndpointDataEffectPathBlock` expandable, read-only, malformed-tolerant block are the exact pattern for the new `business_logics` behaviour block (add the type, add a conditional block, reuse the disclosure + low-confidence styling).

**`discovery-service/.../frameworkAdapters/springClassic/index.ts` + `languageExtractors/java/extract.ts` + Spec 1's `endpointDataEffectResolver.ts`**
- The `business_logics` emission sites (service/`@Bean`/AOP) already stamp `methodId` on candidates; `buildMethodId` produces the stable `FQN#name(ParamTypes)` id; Spec 1's resolver (`methodIdOf`) keys path hops on the same id. Reuse this id for the behaviour block and the selector's endpoint-reachability check — do NOT introduce a new key or new call-graph derivation.

## Out of Scope
- Non-Java / non-Spring-Classic framework or language packs (Java first; design-to-extend).
- Re-implementation / code-generation of the captured logic.
- The runtime API equivalence harness (remains the verifier; not built or changed here).
- The shape-spec / book-of-work generation wiring that consumes the block — persist/expose/display only; the downstream consumer is a separate spec.
- Methods not reachable via inbound HTTP — v1 inherits Spec 1's inbound-HTTP-only edge scope.
- Accept/reject/edit actions on the behaviour block (view-only).
- Adding `class` / `method` candidate types — the block attaches to the existing `business_logics` candidate only.
- Re-deriving Spec 1's endpoint→data edges or embedding them in the block (they are linked live).
- Invalidating the cached block on Spec 1 edge changes.
- A direct LLM call from discovery-service (all LLM access goes through the gateway relay).
