# Task Breakdown: AST Code Analysis (Phase 1 — ctags + Pipeline Integration)

## Overview
Total Tasks: 6 task groups, 32 sub-tasks

**Goal:** Get ctags structural data flowing through the pipeline so the LLM receives metadata instead of raw code, and chunking respects symbol boundaries.

**Status: Phase 1 COMPLETE** — All 6 task groups implemented and tested (49 tests passing).

## Task List

### Data Models

#### Task Group 1: Structural Analysis Data Models ✅
**Dependencies:** None

- [x] 1.0 Complete structural analysis data models
  - [x] 1.1 Write 5 focused tests for data models
  - [x] 1.2 Create `src/ast/__init__.py`
  - [x] 1.3 Create `src/ast/models.py` — SymbolKind, SymbolInfo, InheritanceInfo, ImportInfo, CallInfo, StructuralAnalysis
  - [x] 1.4 Create `tests/ast/__init__.py` and `tests/ast/test_models.py`
  - [x] 1.5 All 5 tests pass

### Provider Abstraction

#### Task Group 2: Provider Registry and Abstraction ✅
**Dependencies:** Task Group 1

- [x] 2.0 Complete provider abstraction layer
  - [x] 2.1 Write 6 focused tests for provider registry
  - [x] 2.2 Create `src/ast/provider.py` — AnalysisProvider ABC + ProviderRegistry
  - [x] 2.3 Create `tests/ast/test_provider.py` with MockProvider and UnavailableProvider
  - [x] 2.4 All 6 tests pass

### ctags Provider

#### Task Group 3: CtagsProvider with Contract Mapping ✅
**Dependencies:** Task Group 2

- [x] 3.0 Complete CtagsProvider implementation
  - [x] 3.1 Create test fixture `tests/fixtures/sample_python.py`
  - [x] 3.2 Write 8+ focused tests for CtagsProvider
  - [x] 3.3 Create `src/ast/ctags_provider.py` — CTAGS_KIND_MAP, analyze_batch(), _map_tag()
  - [x] 3.4 Additional tests: batch multiple files, empty list, inheritance, availability
  - [x] 3.5 All tests pass (9 passing)

### AST Chunker

#### Task Group 4: AST-Aware Chunker with Gap Region Handling ✅
**Dependencies:** Task Group 1

- [x] 4.0 Complete AST chunker with zero dropped content
  - [x] 4.1 Write 8 focused tests for AST chunker
  - [x] 4.2 Create `src/chunking/ast_chunker.py` (121 lines)
  - [x] 4.3 Modify `src/chunking/chunker_factory.py` — ASTChunker as highest priority
  - [x] 4.4 Create `tests/chunking/test_ast_chunker.py`
  - [x] 4.5 All 8 tests pass

### Pipeline Integration

#### Task Group 5: Formatter + file_analyzer.py Integration ✅
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete pipeline integration
  - [x] 5.1 Write 4+ focused tests for structural output formatter
  - [x] 5.2 Create `src/ast/formatter.py` — format_structural_output() with Imports, Symbols, Inheritance, Calls sections
  - [x] 5.3 Write 4 focused tests for pipeline integration
  - [x] 5.4-5.7 Modify `src/file_analyzer.py` — ProviderRegistry, CtagsProvider, structural content
  - [x] 5.8 Create test files
  - [x] 5.9 All 11 tests pass (7 formatter + 4 integration)

### Config, Docker & Verification

#### Task Group 6: Configuration, Docker, and Verification Gates ✅
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete config, Docker, and verification gates
  - [x] 6.1 Create `config/analysis_providers.yaml`
  - [x] 6.2 Modify `Dockerfile` — universal-ctags installed
  - [x] 6.3 Add `tiktoken` to `requirements.txt`
  - [x] 6.4 Write 2 verification gate tests
  - [x] 6.5 Create `tests/ast/test_token_reduction.py` — 2 tests pass
  - [x] 6.6 Gate 1.3: ≥80% token reduction verified
  - [x] 6.7 Gate 1.4: Backward compatibility verified (ctags disabled = no regression)

## Verification Gates — ALL PASSED

- ✅ Gate 1.1: ctags produces valid StructuralAnalysis
- ✅ Gate 1.2: AST chunker never splits mid-function, never drops content
- ✅ Gate 1.3: ≥80% per-file token reduction
- ✅ Gate 1.4: Backward compatibility (all tests pass with ctags disabled)
- ✅ Gate 1.5: Docker build with ctags

## What's NOT in Phase 1 (future work)

- [ ] LSP Provider (`src/ast/lsp_provider.py`) — Tier 2 deep analysis, auto-install, server lifecycle
- [ ] AST Analysis Strategy (`src/strategies/ast_analysis_strategy.py`) — LLM-as-interpreter strategy
- [ ] Pattern Detector — tracked in separate spec `2026-03-29-pattern-detection/`
- [ ] `config/lsp_servers.yaml` — LSP server registry (13 languages)
- [ ] LLM triage (skip trivial files from LLM based on structural complexity)
- [ ] Caching by content hash

## Test Summary

49 tests across 6 test files:
- `test_models.py` — 5 tests
- `test_provider.py` — 6 tests
- `test_ctags_provider.py` — 9 tests
- `test_ast_chunker.py` — 8 tests
- `test_formatter.py` — 7 tests
- `test_pipeline_integration.py` — 4 tests
- `test_token_reduction.py` — 2 tests

Plus 24 tree-sitter tests, 326 extractor tests — all building on this foundation.
