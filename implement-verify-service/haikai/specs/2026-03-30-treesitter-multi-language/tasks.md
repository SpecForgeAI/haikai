# Task Breakdown: Tree-sitter Multi-Language Support

## Overview
Total: 2 phases, 14 tasks

**Goal:** Refactor tree-sitter extraction into a config-driven, multi-language framework. Add TypeScript and Go support.

**Reference Documents:**
- Spec: `spec.md`
- Current provider: `src/ast/treesitter_provider.py` (639 lines)
- Shared pipeline: `src/ast/pipeline.py`
- Config pattern: `config/analysis_providers.yaml`, `config/symbol_kind_mappings.yaml`

**Dependencies:**
- `tree-sitter>=0.23.0` (already in requirements.txt)
- `tree-sitter-python>=0.23.0` (already in requirements.txt)
- `tree-sitter-typescript>=0.23.0` (Phase 2)
- `tree-sitter-go>=0.23.0` (Phase 2)

---

## Phase 1: Refactor to Config-Driven Framework

**Goal:** Split the monolith into pluggable components. Zero behaviour change. Prove with before/after tests.

### Task 1.1: Capture baseline output
**Dependencies:** None
**Files:** `tests/ast/test_multi_language_regression.py`

- Run full analysis on `src/ast/*.py` (17 files) using current code
- Save `_calls.txt` and `_imports.txt` output as test fixtures
- Create regression test that compares future output against these fixtures
- This is the "before" snapshot that proves Phase 1 changes nothing

**Acceptance:** Test exists, passes, fixtures committed.

---

### Task 1.2: Extract shared models
**Dependencies:** None
**Files:** `src/ast/treesitter_models.py`

- Move `RawCallSite` and `ResolutionContext` from `treesitter_provider.py` to `treesitter_models.py`
- Update all imports
- Run full test suite — 296 tests pass

**Acceptance:** No code in `treesitter_provider.py` defines `RawCallSite` or `ResolutionContext`.

---

### Task 1.3: Extract resolver
**Dependencies:** Task 1.2
**Files:** `src/ast/treesitter_resolver.py`

- Move `CallResolver` class (5-stage pipeline) from `treesitter_provider.py` to `treesitter_resolver.py`
- Move `_snake_to_pascal()` helper
- Update all imports
- Run full test suite — 296 tests pass

**Acceptance:** `CallResolver` lives in its own file. No language-specific code in it.

---

### Task 1.4: Extract utility functions
**Dependencies:** Task 1.2
**Files:** `src/ast/treesitter_utils.py`

- Move `_parse_index()` and `_parse_imports()` to `treesitter_utils.py`
- Update all imports
- Run full test suite — 296 tests pass

**Acceptance:** Utility functions in their own file.

---

### Task 1.5: Create extractor interface
**Dependencies:** Task 1.2
**Files:** `src/ast/extractors/__init__.py`, `src/ast/extractors/base.py`

- Create `LanguageExtractor` abstract base class with 4 methods:
  - `extract_calls(source: bytes, file_path: str) -> list[RawCallSite]`
  - `extract_imports(source: bytes) -> list[tuple[str, list[str], bool]]`
  - `extract_assignments(source: bytes) -> dict[str, str]`
  - `extract_annotations(source: bytes) -> dict[str, str]`
- Add `grammar` property (returns the tree-sitter grammar module)
- Add `file_extensions` property (returns list of extensions this extractor handles)

**Acceptance:** Interface defined, importable.

---

### Task 1.6: Move Python extraction to PythonExtractor
**Dependencies:** Tasks 1.3, 1.5
**Files:** `src/ast/extractors/python.py`

- Move `CallExtractor` logic into `PythonExtractor(LanguageExtractor)`
- All 4 methods implemented using the existing Python AST walking code
- Current `CallExtractor` class removed from `treesitter_provider.py`
- Run full test suite — 296 tests pass

**Acceptance:** No Python AST node types referenced outside `extractors/python.py`.

---

### Task 1.7: Create config file and loader
**Dependencies:** Task 1.5
**Files:** `config/treesitter_languages.yaml`, `src/ast/treesitter_config.py`

- Create YAML config mapping extensions → packages → extractors
- Create loader that reads config, dynamically imports extractor classes
- Graceful fallback: if config missing, default to Python-only (backward compat)
- Graceful degradation: if a grammar package not installed, skip with warning

**Acceptance:** Config file exists. Loader returns available extractors. Missing packages don't crash.

---

### Task 1.8: Refactor TreeSitterProvider as router
**Dependencies:** Tasks 1.6, 1.7
**Files:** `src/ast/treesitter_provider.py`

- `TreeSitterProvider.__init__()` loads config, discovers available extractors
- `analyze_batch()` groups files by extension → routes to correct extractor
- Resolution pipeline called once with all `RawCallSite` objects merged
- `treesitter_provider.py` should be ~100 lines (down from 639)

**Acceptance:** Provider works as before. 296 tests pass. Regression test from Task 1.1 passes (identical output).

---

### Task 1.9: Integration test — real data no-regression
**Dependencies:** Task 1.8
**Files:** `tests/ast/test_multi_language_regression.py`

- Run regression test from Task 1.1
- Compare `_calls.txt` byte-for-byte against baseline
- Compare `_imports.txt` byte-for-byte against baseline
- All 296 + regression tests pass

**Acceptance:** Identical output proves refactoring changed nothing.

---

## Phase 2: TypeScript and Go Extractors

**Goal:** Add real multi-language support. Prove with integration tests on fixture files.

### Task 2.1: TypeScript extractor
**Dependencies:** Phase 1 complete
**Files:** `src/ast/extractors/typescript.py`, `tests/fixtures/sample_typescript.ts`, `tests/ast/test_typescript_extraction.py`

- Implement `TypeScriptExtractor(LanguageExtractor)` with 4 methods
- Handle: `call_expression`, `member_expression`, `new_expression`, `optional_chain_expression`
- Handle imports: `import_statement`, `import_clause`, named/default/namespace imports
- Handle assignments: `variable_declaration`, `const`/`let`/`var`
- Handle annotations: `type_annotation` on parameters
- Create fixture file with: classes, interfaces, method calls, constructors, optional chaining, re-exports
- Integration test: extract from fixture, verify `RawCallSite` entries
- Add `tree-sitter-typescript` to `requirements.txt`
- Update `config/treesitter_languages.yaml`

**Acceptance:** TypeScript fixture analyzed, calls + imports extracted, integration test passes.

---

### Task 2.2: Go extractor
**Dependencies:** Phase 1 complete
**Files:** `src/ast/extractors/go.py`, `tests/fixtures/sample_go.go`, `tests/ast/test_go_extraction.py`

- Implement `GoExtractor(LanguageExtractor)` with 4 methods
- Handle: `call_expression`, `selector_expression`, `go_statement`, `defer_statement`
- Handle imports: `import_declaration`, `import_spec`, aliased imports
- Handle assignments: `short_var_declaration`, `assignment_statement`, `var_declaration`
- Handle annotations: N/A (use `var_declaration` type info instead)
- Handle method receivers: `method_declaration` → extract `(receiver *Type)` as scope
- Create fixture file with: structs, methods with receivers, goroutines, defer, multi-package imports
- Integration test: extract from fixture, verify `RawCallSite` entries
- Add `tree-sitter-go` to `requirements.txt`
- Update `config/treesitter_languages.yaml`

**Acceptance:** Go fixture analyzed, calls + imports extracted, integration test passes.

---

### Task 2.3: Cross-language integration test
**Dependencies:** Tasks 2.1, 2.2
**Files:** `tests/ast/test_multi_language_integration.py`

- Create test that analyzes a mixed directory: Python + TypeScript + Go files
- Verify single merged `_calls.txt` contains entries from all 3 languages
- Verify `_imports.txt` contains entries from all 3 languages
- Verify diagrams generate correctly from multi-language data
- Verify language field in `StructuralAnalysis` is set correctly per file

**Acceptance:** Mixed-language analysis produces correct, merged output.

---

### Task 2.4: Update documentation
**Dependencies:** Tasks 2.1, 2.2, 2.3
**Files:** `haikai/specs/2026-03-29-structural-store/PROGRESS.md`, `haikai/specs/2026-03-29-structural-store/TEST-COVERAGE.md`

- Update PROGRESS.md: mark TypeScript/Go support as done
- Update TEST-COVERAGE.md: add new integration tests to the "real data" table
- Update PROGRESS.md "Not Done" section: remove multi-language item

**Acceptance:** Docs reflect current state.

---

## Stop Points

- **After Task 1.1:** Review baseline fixtures before proceeding with refactoring
- **After Task 1.9:** Verify no-regression before adding new languages
- **After Task 2.3:** Review cross-language output before updating docs
