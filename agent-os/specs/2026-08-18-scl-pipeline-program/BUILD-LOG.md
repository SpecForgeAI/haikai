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
| 2 | Deterministic Java slicer + fixture legacy app | feature/scl-02-java-slicer | MERGED 14f33e5e (wasm web-tree-sitter after native nondeterminism hunt; 28 tests incl. determinism soak; slicer API: sliceProject(rootDir) async) |
| 2n | NOTE: native node-tree-sitter binding proven nondeterministic (member-vanishing node reads); SCL parses via web-tree-sitter 0.22.6 + tree-sitter-wasms 0.1.13; native javaParser got constant-buffer floor fix | — | done |
| 3 | Corpus assembly: roots, dedup, reachability | feature/scl-03-corpus-assembly | MERGED c353d6fb (generic root detectors + closure + fan-in + reachability v1; POST /scl/scans route) |
| 4 | LLM annotation pass | feature/scl-04-annotation | MERGED 365fa560 (guarded glosses + capture contradiction pass; AMS GET /scans/{id} added) |
| 5 | Modernization decisions: pair ruleset + conversation phase | feature/scl-05-modernization-decisions | MERGED 7e96f35e + NUL-byte fix 14e7432a (22-rule pair ruleset, inventory, review/confirm routes, Target State panel) |
| 6 | Structural Model tab (frontend) | feature/scl-06-structural-model-tab | MERGED c031cb9c (tab in DiscoveryRunDetailView; explain route; signals_json wrap wire fix) |
| 7 | Corpus-derived spec planner | feature/scl-07-corpus-planner | MERGED b5554956 (6 layers + controller groups; SCL_STORY_ROW_BUDGET; legacy byte-identical without corpus) |
| 8 | SCL spec carriage | feature/scl-08-spec-carriage | MERGED e3798d69 (deterministic contract-block specs, [decision:] citations, TDD criteria, no captured examples) |
| 9 | Test suite generator (TDD) | feature/scl-09-test-generator | MERGED 2b5c7d99 (fixtures/per-row/golden generators; integrity + quarantine; contest arbiter fail-closed; SCL_CONTEST_* thresholds) |
| 10 | Execution integration + clean-slate removal | feature/scl-10-execution-integration | MERGED 6d6e7497 (IVS initial_commit_files + file-hashes endpoint; dispatch attaches red suite; build-results integrity/threshold halts; captured-examples REMOVED from service-plane spec construction; e2e fixture proof) |

## PROGRAM COMPLETE 2026-08-18 — main 6d6e7497, all pushed

Work-machine pickup (big change => FRESH CLONE becomes the new area):
- npm install in discovery-service (NEW deps: web-tree-sitter 0.22.6,
  tree-sitter-wasms 0.1.13), gateway, frontend as usual.
- AMS: rebuild (mvn package) — Liquibase changeset 224 applies on boot.
- IVS: restart (new job payload fields + endpoint).
- Services to restart: AMS, gateway, discovery-service, IVS, frontend.
- New env knobs (optional, defaults sane): SCL_STORY_ROW_BUDGET=40,
  SCL_CONTEST_SPEC_THRESHOLD=0.2, SCL_CONTEST_RUN_THRESHOLD=0.05.
- New-migration flow (AMENDED 2026-08-19, main a41ca58a — user ruling: the
  ONE code scan produces the structural model; a separate trigger meant
  scanning the same code twice): the service-scoped CODE SCAN now runs the
  structural slicer itself as step 9.6 (same clone, same root dir as the LLM
  analysis; fail-soft loud; outcome completed|failed|skipped in
  steps_payload['service-scoped-llm-analysis'].structuralScan; no-Java roots
  skip WITHOUT a scan row so an empty scan never supersedes a real corpus;
  POST /discovery/scl/scans = recovery path only) -> Structural Model tab
  populates with the code scan -> ANNOTATION FIRES AUTOMATICALLY too
  (2026-08-19 second amendment, main e70b0627 — spec 4's route had ZERO
  frontend callers; the structural step now POSTs the gateway
  .../scl/annotation/run after a completed scan [requires the GATEWAY
  running during code scans]; requested/request_failed rides
  steps_payload...structuralScan.annotation; manual POST = recovery only)
  -> confirm modernization decisions on Target State -> expand book of
  work (corpus plan used automatically when a scan exists) -> generate
  specs -> Migrate.

## Key architecture decisions made during build

- SCL contract JSON schema lives as TS types in discovery-service (producer)
  mirrored in gateway (consumer); AMS stores `body_json` OPAQUE — schema
  evolution never needs AMS changes.
- Java parsing: tree-sitter + tree-sitter-java — ALREADY dependencies of
  discovery-service (the existing AST pipeline uses them), so no new native
  deps; reuse the module's own parser loading.

## Per-spec notes

(appended as specs complete)
