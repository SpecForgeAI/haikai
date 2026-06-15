# Tasks: Agentic Endpoint & Interaction Discovery

> Migration from hard-coded AST detection to LLM-driven agentic discovery.
> Phases 1-3 are implementation. Phases 4-6 are testing and validation.

## Phase 1: Wire Agentic Endpoint Discovery into Pipeline

- [x] T1.1: Add `discover_endpoints()` call to `pipeline.py` after Step 2 (tree-sitter enrichment), gated on `llm_client` being available
- [x] T1.2: Pass `snapshot_path`, `project_root`, and `llm_client` to `discover_endpoints()`
- [x] T1.3: Store returned `EndpointInfo[]` into `StructuralAnalysis.endpoints` for each file
- [x] T1.4: Write results via existing `FileStore.write_endpoints()`
- [x] T1.5: Update `_extraction_meta.yaml` to record `discovery_method: "agentic"` (vs old `"ast"`)
- [ ] T1.6: Test: run pipeline on this repo with LLM → verify `_endpoints.txt` is populated
- [ ] T1.7: Test: run pipeline without LLM → verify `_endpoints.txt` is empty (graceful skip)

## Phase 2: Wire Agentic Interaction Discovery into Pipeline

- [x] T2.1: Add `discover_interactions()` call to `pipeline.py` alongside/before the interaction classifier
- [x] T2.2: Feed discovered `InteractionInfo[]` into the existing enrichment step
- [x] T2.3: Ensure YAML fast-path classification still runs first (zero cost), agentic discovery supplements it
- [ ] T2.4: Update `_classification_meta.yaml` to distinguish YAML vs agentic discovery sources
- [ ] T2.5: Test: run pipeline on this repo → verify `_interactions.txt` has agentic discoveries

## Phase 3: Clean Up AST Extractors

- [ ] T3.1: Remove `extract_endpoints()` overrides from: `python.py`, `java.py`, `typescript.py`, `go.py`, `csharp.py`
- [ ] T3.2: Remove `extract_interactions()` overrides from all 5 extractors
- [ ] T3.3: Remove associated private methods (`_walk_endpoints`, `_check_decorated_endpoint`, `_walk_ts_endpoints`, etc.)
- [x] T3.4: Delete `src/ast/extractors/endpoint_config.py` (already deleted on feature branch)
- [x] T3.5: Remove endpoint/interaction extraction calls from `treesitter_provider.py`
- [x] T3.6: Remove stale imports (`EndpointInfo`, `InteractionInfo`, `get_endpoint_frameworks`, etc.) from extractors
- [x] T3.7: Verify all existing structural tests still pass — 363 passing

## Phase 4: Unit Tests (Mocked LLM)

- [x] T4.1: Create `tests/ast/test_endpoint_discoverer.py` — 16 tests — mock LLM tests:
  - Direct FINAL_ANSWER → EndpointInfo[] parsed correctly
  - TOOL_CALL → tool executes → result fed back → FINAL_ANSWER
  - Max turns limit (doesn't loop forever)
  - LLM errors (exception → graceful fallback, empty list)
  - Empty structural store → handles gracefully
  - Malformed JSON in FINAL_ANSWER → no crash
- [x] T4.2: Create `tests/ast/test_interaction_discoverer.py` — 15 tests
- [ ] T4.3: Rewrite `tests/ast/test_endpoint_extraction.py` — replace old AST-based tests with:
  - Store writer tests (still relevant — `FileStore.write_endpoints()`)
  - Config loader tests (remove — `endpoint_config.py` deleted)
  - EndpointInfo/InteractionInfo model tests (keep)
- [x] T4.4: Verify all existing tests pass: enricher (20), agent (17), classifier (52) — all green

## Phase 5: Integration Tests (Real LLM, Real Repos)

- [ ] T5.1: API integration test: `POST /api/v1/structural/analyze` with a fixture repo → verify `_endpoints.txt` contains expected endpoints
- [ ] T5.2: CLI integration test: `extract --repo <fixture>` → verify snapshot files on disk
- [ ] T5.3: Benchmark: run against piggymetrics (Java/Spring) — compare endpoint count vs old AST baseline
- [ ] T5.4: Benchmark: run against saleor (Python/Django) — verify Django endpoints now discovered
- [ ] T5.5: Benchmark: run against vendure (TypeScript/NestJS) — verify NestJS endpoints now discovered
- [ ] T5.6: New language test: run against at least 1 Ruby/PHP/Rust repo — verify endpoints discovered
- [ ] T5.7: Add structural analysis tests to `test-harness.ps1` integration suite

## Phase 6: Skill File Refinement

- [ ] T6.1: Run `discover-endpoints.md` against all benchmark repos, review results, iterate on prompt
- [ ] T6.2: Run `discover-interactions.md` against all benchmark repos, review results, iterate on prompt
- [ ] T6.3: Remove framework-specific examples from skill files if they bias the LLM toward only those frameworks
- [ ] T6.4: Add guidance for edge cases found during testing (e.g., generated code, dynamic routes, env-variable URLs)
- [ ] T6.5: Document final endpoint/interaction counts per benchmark repo in a results table
