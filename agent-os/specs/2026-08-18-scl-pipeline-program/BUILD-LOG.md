# SCL Pipeline Program — Build Log

Design source of truth: `agent-os/planning/2026-08-18-scl-pipeline-design.md`.
Read that FIRST. This log tracks the autonomous build of the 10-spec program
(user go 2026-08-18: build all, commit/merge per spec, stop only on genuine
blockers; user will not use the tool until done).

Conventions: feature branch per spec, --no-ff merge to main after tests green.
PS 5.1: commit via tempfile + `git commit -F`, verify with git log. NEVER
commit the standing local files (.env*, gateway/threads/*, haikai-skills/).
Thresholds + row budgets = CONFIG values, not hardcoded.

## Program status

| # | Spec | Branch | Status |
|---|------|--------|--------|
| 0 | Commit earlier session fixes (reconcile + spec-gen + wire miner) | fix/reconcile-and-spec-gen-2026-08-17 | MERGED d60716ba |
| 1 | SCL core model + AMS persistence | feature/scl-01-core-model | MERGED 3d0dba2a (changeset 224; routes /api/model/projects/{p}/architectures/{a}/scl; 15 tests green) |
| 2 | Deterministic Java slicer + fixture legacy app | feature/scl-02-java-slicer | in_progress (discovery-service/src/scl/; java-parser npm, pure JS) |
| 3 | Corpus assembly: roots, dedup, reachability | feature/scl-03-corpus-assembly | pending |
| 4 | LLM annotation pass | feature/scl-04-annotation | pending |
| 5 | Modernization decisions: pair ruleset + conversation phase | feature/scl-05-modernization-decisions | pending |
| 6 | Structural Model tab (frontend) | feature/scl-06-structural-model-tab | pending |
| 7 | Corpus-derived spec planner | feature/scl-07-corpus-planner | pending |
| 8 | SCL spec carriage | feature/scl-08-spec-carriage | pending |
| 9 | Test suite generator (TDD) | feature/scl-09-test-generator | pending |
| 10 | Execution integration + clean-slate removal | feature/scl-10-execution-integration | pending |

## Key architecture decisions made during build

- SCL contract JSON schema lives as TS types in discovery-service (producer)
  mirrored in gateway (consumer); AMS stores `body_json` OPAQUE — schema
  evolution never needs AMS changes.
- Java parsing: tree-sitter + tree-sitter-java — ALREADY dependencies of
  discovery-service (the existing AST pipeline uses them), so no new native
  deps; reuse the module's own parser loading.

## Per-spec notes

(appended as specs complete)
