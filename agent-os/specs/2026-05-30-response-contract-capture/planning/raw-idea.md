# Raw Idea: Per-endpoint response-contract capture for discovery

HAIKAI Phase-2 "oracle perfection," **Spec #1 of 6** (highest priority), built first
in a strictly sequential #1→#6 program. North star: like-for-like API/DB migration
(memory `project_migration_ultimate_goal`).

**The gap (found by a 5-agent audit):** discovery captures what endpoints and data
EXIST, not what RESPONSE each input produces. The runtime harness
captures→replays→diffs every endpoint, so the migration target must return
byte-identical responses (status + body + headers) for the same input — but the
layers that DETERMINE the response are invisible to discovery today:

- `@ControllerAdvice` / `@ExceptionHandler` / `@ResponseStatus` error responses —
  recorded in the IR, ZERO consumers read them. Every 4xx/5xx body+status is invisible.
- Security / authz — the springClassic pack (the migration source) captures NO
  security; only the springBoot adapter reads `@PreAuthorize`/`@Secured`, and it
  never runs for a classic source. Auth outcomes (401/403 vs 200) change the response.
- Bean validation (`@Valid` / JSR-380) → 400 bodies — not captured.
- Serialization shape — Jackson `@JsonInclude`/`@JsonFormat`/`@JsonProperty`/custom
  serializers/date format/null handling, response headers, status semantics (201 vs
  200, Location) — no consumers.
- Config-conditional responses — `@ConditionalOnProperty`/`@Profile`/`@Value`
  branches that change the response; the gap-fill prompt ACTIVELY collapses them.

**The fix:** capture a per-endpoint RESPONSE CONTRACT as a NEW structured
`response_contract` JSONB field ON the EXISTING `endpoints` entity (metadata on an
existing entity, like Spec 2's `business_logics.behavior` and Spec 3's
`constraints_metadata` — NOT a new entity/relationship type). A NEW deterministic
scanner statically detects the annotations/config and resolves which advice/security
applies to each endpoint; an OPTIONAL LLM-enrichment pass (reusing Spec 2's relay +
tier-gating, temperature 0) fills response-body shapes/semantics. Capture security on
the springClassic pack (fix the gap), capture config-conditional variants (reverse
the collapse and update the gap-fill prompt), and emit a Finding for anything that
cannot be statically resolved (e.g. an unresolved security-filter chain).

Java / Spring-Classic first (the migration source). Spec #2 (seeding) consumes this
spec's `response_contract` for richer error/auth replay scenarios.

All product decisions are FINAL and pre-approved; this folder is decision-complete
for autonomous build.
