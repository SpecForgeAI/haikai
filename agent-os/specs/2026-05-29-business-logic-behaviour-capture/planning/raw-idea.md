# Spec 2 — Business-logic behaviour capture for discovery (Java / Spring Classic first) — Gap C

Part of the HAIKAI discovery richness program (like-for-like API/DB migration tool). North star: memory `project_migration_ultimate_goal`. This is the Tier-1 partner of Spec 1 (endpoint→data-effect call graph, already built). Spec 1 + Spec 2 together = the implementation-ready *specification oracle* (B = which data each endpoint touches; C = what it does to that data).

## Problem / goal
A `business_logics` candidate today is label-only (class + method name + return type + param count + an optional one-sentence LLM blurb) — not enough for an LLM to faithfully RE-IMPLEMENT the logic in the new tech stack. Capture a tech-agnostic STRUCTURED BEHAVIOUR SPEC per rule-bearing method, rich enough for an LLM to re-derive an equivalent implementation, attached to the endpoint(s) that invoke it via Spec 1's call graph. The runtime API harness stays the equivalence VERIFIER; this is best-effort, confidence-scored RECONSTRUCTION GUIDANCE, not a proof — the convergence loop (capture→diff→findings→re-implement) closes the residual gap.

## What to capture (the structured behaviour block) per rule-bearing unit
1. IO — inputs (names/types/meaning), outputs (type/meaning).
2. Validation/preconditions — checks + the error/exception → status/fault on failure.
3. Transformation/computation — formulas, field mappings, aggregations, branches, sort/order, defaulting (structured pseudo-logic + prose).
4. Data effects — reuse Spec 1's endpoint→data edges / method-level data touches (do not re-derive).
5. Side effects — external calls, events, audit, idempotency.
6. Edge cases — null/empty/boundary per branch.
7. Provenance + confidence — link to source method (FQN + signature) + a confidence score.

## Key framing / decisions to carry
1. Attach the behaviour block to the EXISTING `business_logics` entity/candidate, keyed by the stable method id (FQN + signature) that Spec 1 already stamps onto `business_logics` + path hops. Do NOT add `class`/`method` candidate types.
2. Extraction is LLM-ASSISTED (static gets the skeleton; the LLM reads the method body + callees to produce the structured block) and MUST go via the existing gateway LLM relay used by the gap-fill step (`llmGapFillStep.ts`) — NOT a direct LLM call from discovery.
3. LLM-derived → confidence-scored + reviewable; never presented as proven. Reuse existing confidence/threshold conventions.
4. Link behaviour → invoking endpoint(s) via Spec 1's call graph, and → data touched via Spec 1's endpoint→data edges.
5. Java / Spring Classic first; design to extend.
6. AMS meta-model needs a structured `behavior` field on the business-logic entity (the schema gate) — snake_case wire, NEW Liquibase changeset file only (never edit an applied one).

## Open shaping questions (resolve with the user, do NOT auto-decide)
- Structured vs free-form behaviour block: typed sub-schema vs prose + passthrough JSON.
- "Rule-bearing method" SELECTION heuristic: exclude getters/setters/DTO plumbing/framework boilerplate — deterministic rule or LLM-judged?
- LLM cost/depth budget per run; gated/opt-in?
- Idempotency/caching across re-runs (don't re-LLM unchanged methods).
- Review-UI surfacing: extend the existing `business_logics` candidate-details panel (expandable read-only, like Spec 1's path metadata).
- How the behaviour block feeds the migration book-of-work / shape-spec generation.

## Repo conventions / constraints
AMS snake_case by default (CLAUDE.md); NEW Liquibase changeset files only; no `discovery-service/src/**` edits during an in-flight run; LLM via the gateway relay (not direct). Relevant code: `discovery-service/.../frameworkAdapters/springClassic/index.ts` (business_logics emission sites — service-layer/@Bean/AOP), `discovery-service/src/services/llmGapFillStep.ts` + `prompts/` composer (LLM-pass precedent), `discovery-service/src/services/findings/FindingEmitter.ts`, AMS business-logic entity + `db/changelog/sql/015-business-logic.sql`, frontend `business_logics` candidate-details surface.
