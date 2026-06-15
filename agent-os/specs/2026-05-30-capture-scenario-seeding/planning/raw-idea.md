# Raw Idea: Capture Scenario Seeding

**HAIKAI Phase-2 "oracle perfection" — Spec #2 of 6.**

The runtime equivalence harness (`api-migration-validation-service`) captures → replays → diffs
each API endpoint, and is the API behavioural oracle for the like-for-like migration. But the
harness needs SCENARIOS + INPUTS to exercise each endpoint — and today discovery does not seed
it. The harness improvises every input: it generates exactly ONE `happy_path` scenario per
operation and tells the LLM to invent the request body/params/headers blind, with no edge/error/
auth scenarios, no example inputs, no auth/tokens, and no preconditions.

Meanwhile, the perfect seed material already exists in the discovery model but dead-ends:
- Spec 2's `business_logics.behavior` blocks (validation / edge_cases / io) are persisted but
  NEVER read by the capture orchestrator.
- Spec 1's `endpoint_data_effects.access_mode` (read / write / read-write) is discarded at the
  seam — `safe_to_execute` is decided VERB-ONLY instead.
- Synthesised harness endpoints carry `requestSchema: null` for REST, so the harness can't even
  build a valid request shape.

**The idea:** discovery/AMS computes, per included operation, a set of capture SCENARIO SEEDS
(`happy_path` + `edge` + `error` + `auth_variant`) — each with example inputs, preconditions,
expected status, and a `safe_to_execute` flag — sourced from Spec 2 behaviour, Spec 1 data-effect
access modes, Spec 4 SOAP message shapes, and (when present) Spec #1's `response_contract`. The
harness consumes the seeds: it expands beyond one happy-path (one scenario per seed), pre-fills
inputs/auth/preconditions, drives destructiveness from the real access mode, and keeps the LLM as
a fallback that REFINES seeded inputs rather than inventing blind.

**Computed-on-read at handoff** (mirrors the Capture Coverage Gates spec, 2026-05-30): AMS
computes the seeds in `MigrationDiscoveryContextService` from the already-persisted Spec 1/2/4(/#1)
model and carries them on the migration-discovery-context response DTO (camelCase-wired). NO new
persistence, NO Liquibase changeset in v1.

**Scope:** REST first; SOAP seeds from Spec 4 where available. Advisory / graceful — if a source
signal is absent, degrade to the seeds that can be computed; never block.

**Out of scope:** auto-executing capture; new meta-model entity types; a blocking gate; changing
the LLM capture loop's core; non-Spring protocols for seed generation.

North star: memory `project_migration_ultimate_goal` — treat current service+DB as a black box and
prove the upgraded inside is behaviourally equivalent; the harness is the behavioural oracle, and
discovery must seed it richly enough to exercise every endpoint honestly.
