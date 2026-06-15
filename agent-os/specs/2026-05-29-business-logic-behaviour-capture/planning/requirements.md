# Spec Requirements: Business-logic behaviour capture for discovery (Java / Spring Classic first) — Gap C

## Initial Description

Spec 2 of the HAIKAI discovery richness program (like-for-like API/DB migration tool). North star: memory `project_migration_ultimate_goal`. This is the Tier-1 partner of Spec 1 (endpoint→data-effect call graph, already built). Spec 1 + Spec 2 together = the implementation-ready *specification oracle* (B = which data each endpoint touches; C = what it does to that data).

**Problem / goal:** A `business_logics` candidate today is label-only (class + method name + return type + param count + an optional one-sentence LLM blurb) — not enough for an LLM to faithfully RE-IMPLEMENT the logic in the new tech stack. Capture a tech-agnostic STRUCTURED BEHAVIOUR SPEC per rule-bearing method, rich enough for an LLM to re-derive an equivalent implementation, attached to the endpoint(s) that invoke it via Spec 1's call graph. The runtime API harness stays the equivalence VERIFIER; this is best-effort, confidence-scored RECONSTRUCTION GUIDANCE, not a proof — the convergence loop (capture→diff→findings→re-implement) closes the residual gap.

**What to capture (the structured behaviour block) per rule-bearing unit — 7 parts:**
1. IO — inputs (names/types/meaning), outputs (type/meaning).
2. Validation/preconditions — checks + the error/exception → status/fault on failure.
3. Transformation/computation — formulas, field mappings, aggregations, branches, sort/order, defaulting (structured pseudo-logic + prose).
4. Data effects — reuse Spec 1's endpoint→data edges / method-level data touches (do not re-derive).
5. Side effects — external calls, events, audit, idempotency.
6. Edge cases — null/empty/boundary per branch.
7. Provenance + confidence — link to source method (FQN + signature) + a confidence score.

**Key framing / decisions carried from the raw idea:**
1. Attach the behaviour block to the EXISTING `business_logics` entity/candidate, keyed by the stable method id (FQN + signature) that Spec 1 already stamps onto `business_logics` + path hops. Do NOT add `class`/`method` candidate types.
2. Extraction is LLM-ASSISTED (static gets the skeleton; the LLM reads the method body + callees to produce the structured block) and MUST go via the existing gateway LLM relay used by the gap-fill step (`llmGapFillStep.ts`) — NOT a direct LLM call from discovery.
3. LLM-derived → confidence-scored + reviewable; never presented as proven. Reuse existing confidence/threshold conventions.
4. Link behaviour → invoking endpoint(s) via Spec 1's call graph, and → data touched via Spec 1's endpoint→data edges.
5. Java / Spring Classic first; design to extend.
6. AMS meta-model needs a structured `behavior` field on the business-logic entity (the schema gate) — snake_case wire, NEW Liquibase changeset file only (never edit an applied one).

## Requirements Discussion

### First Round Questions

**Q1:** What shape should the `behavior` field take — a typed sub-schema, prose with passthrough JSON, or a hybrid?
**Answer:** ONE `behavior` JSONB column with an internal `schema_version`. Typed enough that the UI can render the 7 parts section-by-section, loose enough that prose sub-fields are free text. Mirrors Spec 1's `path_metadata_json` JSONB precedent (no migration when the shape evolves). The LLM is prompted to emit that documented shape.

**Q2:** How is a "rule-bearing method" SELECTED — deterministic rule or LLM-judged? What is excluded vs always included?
**Answer:** Rule-bearing method SELECTION is a layered filter: a method qualifies only if (i) it is a `business_logics` candidate, AND (ii) it is reachable from an endpoint via Spec 1's call graph, AND (iii) it survives a DETERMINISTIC boilerplate exclusion. EXCLUDE: getters/setters/`equals`/`hashCode`/`toString`/builders, Lombok-generated, framework `@Override` callbacks, trivial one-liners. ALWAYS INCLUDE: `@Transactional` methods, custom-exception throwers, and anything on an endpoint→data path. The pre-filter is deterministic (not LLM-judged) to bound cost and reuse Spec 1's work.

**Q3:** What is the LLM analysis depth, and how is the pass gated (opt-in flag vs tier-gated)?
**Answer:** DEPTH = method body + 1 hop of direct-callee bodies (env-tunable callee cap; no unbounded fan-out). GATING = runs as part of the existing LLM stages, TIER-GATED exactly like gap-fill (NOT a separate off-by-default opt-in flag — avoid a built-but-never-runs feature), with a per-run method cap + token ceiling. The Q2 pre-filter keeps the set bounded.

**Q4:** How is idempotency/caching handled across re-runs so unchanged methods are not re-sent to the LLM?
**Answer:** Store a `source_hash` inside the `behavior` block (hash of the normalized method body + the signatures/bodies of the 1-hop callees fed to the LLM); on re-run, SKIP the LLM call and carry the prior block forward when the hash is unchanged. Do NOT invalidate on Spec 1 data-effect edge changes (the edges are LINKED live, not embedded in the block).

**Q5:** How is the behaviour block surfaced in the review UI?
**Answer:** Read-only EXPANDABLE 7-part block + confidence badge in the EXISTING `business_logics` candidate-details panel (add `business_logics` to `SUPPORTED_DETAIL_TYPES`), reusing Spec 1's expandable pattern + the existing low-confidence visual treatment. VIEW-ONLY — no accept/reject/edit actions on the block itself (the candidate is already reviewable).

**Q6:** How does the behaviour block feed downstream (migration book-of-work / shape-spec generation)?
**Answer:** PERSIST + DISPLAY + EXPOSE the block on the AMS read DTO keyed by the method id, so a future shape-spec / book-of-work step can consume it. Do NOT build the shape-spec generation wiring in this spec — that downstream consumer is OUT OF SCOPE.

**Q7:** What is the LLM vehicle — overload the per-file gap-fill stage or add a new stage?
**Answer:** A NEW sibling stage `llmBehaviourCaptureStep.ts` (per-METHOD) that REUSES the gateway LLM relay + the gap-fill conventions (concurrency pool, confidence tags via `getConfidenceForTag`, skip/failure-rate handling) — rather than overloading the per-FILE gap-fill stage. Relay channel confirmed (framing decision 2).

**Q8:** What is explicitly out of scope?
**Answer:** Non-Java / non-Spring-Classic packs (Java first, design-to-extend); re-implementation / code-generation; the runtime equivalence harness (stays the verifier); the shape-spec generation wiring (per Q6). ALSO: behaviour capture INHERITS Spec 1's INBOUND-HTTP-ONLY scope for v1 (the reachable-method set comes from Spec 1's edges, which are inbound-HTTP-only).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Gap-fill LLM pass (LLM relay / skip / confidence / concurrency precedent) — Path: `discovery-service/src/services/llmGapFillStep.ts` + its `prompts/` composer + `gatewayClient`. The new `llmBehaviourCaptureStep.ts` mirrors its conventions.
- Feature: Spec 1 endpoint→data-effects structured metadata (JSONB structured-metadata + boxed `Double` confidence precedent) — Path: `architecture-model-service/.../db/changelog/sql/161-endpoint-data-effects.sql`. Precedent for the new `behavior` column shape and confidence typing.
- Feature: Business-logic schema (the label-only schema this spec extends) — Path: `architecture-model-service/.../db/changelog/sql/015-business-logic.sql`. Add the `behavior` column via a NEW changeset; NEVER edit 015.
- Feature: Candidate-details expandable read-only panel (`SUPPORTED_DETAIL_TYPES` pattern) — Path: `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`. Add `business_logics` as a supported detail type; reuse the expandable + low-confidence visual treatment.
- Feature: `business_logics` emission sites (service-layer / `@Bean` / AOP) — Path: `discovery-service/.../frameworkAdapters/springClassic/index.ts`.
- Feature: Stable method-id keying (FQN + signature) already stamped on `business_logics` + path hops by Spec 1 — reuse for behaviour-block keying; do NOT introduce a new key.
- Feature: Findings emission precedent — Path: `discovery-service/src/services/findings/FindingEmitter.ts` (referenced in raw idea as relevant code).

### Follow-up Questions

No follow-up questions were required. All 8 clarifying questions were resolved and user-approved prior to documentation.

## Visual Assets

### Files Provided:

No visual assets provided. The feature reuses Spec 1's expandable candidate-details panel; no mockups were needed.

### Visual Insights:

Not applicable — proceeding without visuals per the user's confirmation.

## Requirements Summary

### Functional Requirements

- Capture a tech-agnostic STRUCTURED BEHAVIOUR SPEC (the 7-part block) per rule-bearing method, rich enough for an LLM to re-derive an equivalent implementation.
- Store the block as ONE `behavior` JSONB column on the EXISTING business-logic entity, with an internal `schema_version` and a `source_hash`. Typed enough for section-by-section UI rendering; prose sub-fields are free text.
- SELECT rule-bearing methods via a layered, DETERMINISTIC filter: (i) is a `business_logics` candidate, AND (ii) reachable from an endpoint via Spec 1's call graph, AND (iii) survives boilerplate exclusion (exclude getters/setters/`equals`/`hashCode`/`toString`/builders, Lombok-generated, framework `@Override` callbacks, trivial one-liners; always include `@Transactional` methods, custom-exception throwers, and anything on an endpoint→data path).
- Extract via a NEW per-METHOD discovery stage `llmBehaviourCaptureStep.ts` that reads method body + 1 hop of direct-callee bodies (env-tunable callee cap; no unbounded fan-out), going through the existing gateway LLM relay (NOT a direct LLM call), reusing gap-fill conventions (concurrency pool, confidence tags via `getConfidenceForTag`, skip/failure-rate handling).
- Tier-gate the stage exactly like gap-fill (NOT an off-by-default opt-in flag), with a per-run method cap + token ceiling.
- Cache via `source_hash` (normalized method body + the 1-hop callee signatures/bodies fed to the LLM): on re-run, SKIP the LLM call and carry the prior block forward when the hash is unchanged. Do NOT invalidate on Spec 1 data-effect edge changes (edges are linked live, not embedded).
- Key the block by the stable method id (FQN + signature) Spec 1 already stamps; do NOT add `class`/`method` candidate types.
- Confidence-score every block; never present as proven.
- Surface the block read-only + expandable, with a confidence badge, in the existing `business_logics` candidate-details panel (add `business_logics` to `SUPPORTED_DETAIL_TYPES`). View-only — no accept/reject/edit on the block.
- Persist + display + EXPOSE the block on the AMS read DTO keyed by the method id, so a future shape-spec / book-of-work step can consume it.
- Link behaviour → invoking endpoint(s) and → data touched via Spec 1's call graph and endpoint→data edges (reuse, do not re-derive).

### Reusability Opportunities

- `llmGapFillStep.ts` + `prompts/` composer + `gatewayClient`: clone the conventions for the new per-method behaviour stage (relay, skip, confidence tags, concurrency, failure-rate handling).
- Spec 1's `161-endpoint-data-effects.sql`: JSONB structured-metadata + boxed `Double` confidence precedent for the new `behavior` column.
- `015-business-logic.sql`: the schema being extended (via a NEW changeset only).
- `CandidateDetailsPanel.tsx` + `candidateDetailsSupport.ts`: `SUPPORTED_DETAIL_TYPES` expandable read-only pattern + low-confidence visual treatment.
- `frameworkAdapters/springClassic/index.ts`: the `business_logics` emission sites.
- Spec 1's stable method-id keying (FQN + signature) on `business_logics` + path hops.

### Scope Boundaries

**In Scope:**
- AMS meta-model: NEW Liquibase changeset adding the `behavior` JSONB column to the business-logic entity, with `schema_version` + `source_hash` inside the block; snake_case wire; read DTO exposure of the block keyed by method id.
- discovery-service: NEW per-method `llmBehaviourCaptureStep.ts` LLM pass via the gateway relay, driven by the deterministic selector, tier-gated, with per-run method cap + token ceiling and `source_hash` caching.
- frontend: render the read-only expandable 7-part block + confidence badge in the existing candidate-details panel (`business_logics` added to `SUPPORTED_DETAIL_TYPES`).
- Java / Spring Classic only, designed to extend.

**Out of Scope:**
- Non-Java / non-Spring-Classic packs (Java first; design-to-extend).
- Re-implementation / code-generation of the captured logic.
- The runtime equivalence harness (remains the verifier, not built/changed here).
- The shape-spec / book-of-work generation wiring that consumes the block (the downstream consumer; only persist/display/expose here).
- Methods not reachable via inbound HTTP — v1 INHERITS Spec 1's INBOUND-HTTP-ONLY scope (the reachable-method set comes from Spec 1's inbound-HTTP-only edges).
- Accept/reject/edit actions on the behaviour block (view-only).

### Technical Considerations

- AMS speaks snake_case at the wire by default (CLAUDE.md); the new `behavior` column and DTO follow that default.
- Add the column via a NEW Liquibase changeset file; NEVER edit the applied `015-business-logic.sql` (or any applied changeset) — comment-only edits also break startup via checksum validation.
- LLM access MUST go through the existing gateway relay used by gap-fill; NO direct LLM calls from discovery-service.
- Confidence is a boxed `Double` (precedent: Spec 1's `161-endpoint-data-effects.sql`); the block carries a confidence score and reuses existing confidence/threshold conventions and `getConfidenceForTag`.
- The behaviour block is keyed by the stable method id (FQN + signature) Spec 1 already stamps — no new key.
- The `behavior` block embeds `schema_version` (loose JSONB, no migration as the shape evolves — Spec 1's `path_metadata_json` precedent) and `source_hash` (for re-run skip).
- LLM depth is capped at 1 hop of direct callees (env-tunable cap); no unbounded fan-out. Per-run method cap + token ceiling bound cost.
- Do NOT edit `discovery-service/src/**` while a discovery run is in flight (tsx watch auto-reload kills runs).
- Layering order: AMS meta-model (schema gate) → discovery-service (capture stage) → frontend (render).
