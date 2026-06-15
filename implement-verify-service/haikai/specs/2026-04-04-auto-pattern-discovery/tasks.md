# Tasks: LLM-Powered Interaction Classification

## Phase 1: Rename + Restructure

- [x] T1.1: Rename `data_movement_patterns.yaml` → `interaction_patterns.yaml`, update all references
- [x] T1.2: Rename `DataMovementInfo` → `InteractionInfo` in models, extractors, store, provider, tests
- [x] T1.3: Rename `_data_movements.txt` → `_interactions.txt` in FileStore
- [x] T1.4: Create empty `auto_discovered_patterns.yaml` with schema header
- [x] T1.5: Update `endpoint_config.py` path references
- [x] T1.6: All 104 existing tests pass after rename

## Phase 2: Unknown Framework Detection

- [x] T2.1: Create `src/ast/interaction_classifier.py` — `InteractionClassifier` class
- [x] T2.2: Implement `detect_unclassified()` — diff calls against YAML-classified, filter internals
- [x] T2.3: Implement `batch_by_framework()` — group by detected framework, skip testing/validation
- [x] T2.4: 9 unit tests — separation, filtering, batching, real repo classification

## Phase 3: LLM Agent Classification

- [x] T3.1: Create `src/ast/interaction_agent.py` — `classify_batch()` with LLM
- [x] T3.2: Prompt construction — framework context, call sites TSV, output schema
- [x] T3.3: Source enrichment — `_read_source_snippet()` with >>> line marker
- [x] T3.4: Iterative loop — classify → ambiguous? → read source → reclassify (max 3 passes)
- [x] T3.5: Wired to `LLMClient.generate_json()` (Anthropic/OpenAI/Azure)
- [x] T3.6: 15 tests with mocked LLM — prompt format, classification, enrichment, errors

## Phase 4: Cache + Output

- [x] T4.1: `write_auto_discovered_patterns()` — append to YAML with dedup + timestamps
- [x] T4.2: `write_classified_interactions()` — `_interactions.txt` with `classified_by` column (yaml/llm)
- [x] T4.3: `write_classification_meta()` — stats, framework batches, timestamps
- [x] T4.4: 8 unit tests — output format, provenance, dedup, empty handling, meta stats

## Phase 5: Pipeline Integration

- [x] T5.1: Add `classify_interactions` + `llm_client` params to `run_structural_pipeline()`
- [x] T5.2: Wire `InteractionClassifier` into pipeline — runs after tree-sitter when gated on
- [x] T5.3: Gate off (default) — existing behaviour unchanged, no classification meta
- [x] T5.4: 8 integration tests — provenance, meta, gate on/off, existing files intact
- [ ] T5.5: Integration test with real LLM — requires API keys (deferred)

## Phase 6: Verification

- [ ] T6.1: Run with real LLM against test repos — compare YAML vs LLM coverage (requires API keys)
- [ ] T6.2: Verify LLM cost < $0.10 per repo (requires API keys)
- [x] T6.3: `auto_discovered_patterns.yaml` dedup verified in unit tests
- [x] T6.4: Manual patterns take precedence — verified by config loader merge order
- [x] T6.5: All 144 tests pass (no regressions)
