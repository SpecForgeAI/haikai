# Increment 16 of 16 — Refinement, consolidation, and system hardening

## Delivery context
This is increment 16 of 16 for the new legacy / current-state discovery capability.

Previous increments delivered:
- full discovery pipeline (Phase 0 + Phase 1a–1d),
- candidate generation and save-back,
- visibility and review workflow,
- log-based enrichment,
- hypothesis-first Q&A with users.

This final increment focuses on refinement, consolidation, and production readiness.

## Goal
Stabilize and consolidate the discovery capability so it is: reliable across diverse codebases, consistent in output quality, extensible for future improvements, ready for broader usage.

## In scope
1. Pipeline robustness and consistency — stable under repeated runs, tolerant of partial failures, consistent state transitions
2. Idempotency and re-run behavior — safe re-execution, Phase 0 propagation, non-duplicative save-back
3. Data consistency and cleanup — evidence/candidate/entity consistency, orphaned data cleanup, stale run cleanup
4. Performance and scaling baseline — large repo handling, evidence volume, reasonable execution times, remove obvious bottlenecks
5. Configuration and extension readiness — analyzer-pack config hardening, future AST enrichment hooks, stable extension points
6. Observability and diagnostics — run-level logging, phase timing, error reporting, easier debugging
7. UX polish (lightweight) — clarity of discovery results, status messaging, basic usability fixes
8. Documentation and developer clarity — internal docs for phases, evidence schema, DecisionTask engine, analyzer packs, save-back contracts

## Out of scope
- major new features, advanced performance optimization, full analyzer-pack library, deep UI redesign, new discovery phases

## Acceptance criteria
1. Full pipeline executes reliably across multiple runs
2. Re-running does not create duplicates or inconsistencies
3. Evidence, candidates, entities remain consistent and traceable
4. Basic performance acceptable for typical repos
5. Extension points intact and usable
6. Basic logging/diagnostics available
7. Minor UX improvements improve clarity
8. Internal documentation describes system structure and contracts
