# Task Breakdown: Tree-sitter Call Graph Provider

## Overview
Total Tasks: 4 phases, 21 sub-tasks

**Goal:** Extract call graphs from source code using tree-sitter AST parsing with multi-stage call resolution. Replace the LSP cursor-based approach with a fast, batch-friendly provider that produces `_calls.txt` with confidence scores.

**Key Design Principles:**
1. **Parse once, extract everything.** One tree-sitter parse per file, one AST walk for all call sites.
2. **Resolution pipeline.** Assignment tracking → type annotations → import following → ctags xref → convention heuristic. First confident match wins.
3. **Confidence is earned.** Score reflects actual evidence, not hardcoded values.
4. **Ctags is the symbol oracle.** Tree-sitter finds calls, ctags resolves targets.

**Reference Documents:**
- Spec: `spec.md`
- Existing call graph model: `src/ast/models.py:CallInfo`
- Existing store writer: `src/ast/store.py:write_calls()`
- Existing sequence diagrams: `src/ast/diagram_builders.py:SequenceDiagramBuilder`

**Dependencies:**
- `tree-sitter>=0.22.0`
- `tree-sitter-python`
- Existing ctags provider (for `_index.txt`, `_imports.txt`)

## Task List

### Phase 1: Python Call Extraction

#### Task Group 1: Tree-sitter Parser + Call Extractor
**Dependencies:** None (tree-sitter is self-contained)

- [x] 1.0 Set up tree-sitter and extract Python call sites
  - [x] 1.1 Add dependencies: `tree-sitter`, `tree-sitter-python`
  - [x] 1.2 Create `src/ast/treesitter_provider.py`
    - `TreeSitterProvider(AnalysisProvider)` class
    - `name` property returns `"treesitter"`
    - `is_available()` checks tree-sitter + grammar importable
    - `analyze_batch()` orchestrates parse → extract → resolve → build
  - [x] 1.3 Implement `CallExtractor`
    - `RawCallSite` dataclass: file_path, caller_name, receiver, method, line, arguments
    - Python call query: `(call function: [(attribute ...) (identifier ...)])`
    - `_find_enclosing_function(node)` — walk up AST to find caller scope
    - Handle: method calls (`self.x.method()`), bare functions (`func()`), constructors (`Class()`), chained calls, nested calls
  - [x] 1.4 Write tests: `tests/ast/test_treesitter_extraction.py`
    - Test method call extraction (receiver + method)
    - Test bare function call
    - Test constructor call
    - Test chained calls produce two call sites
    - Test nested calls `f(g(x))` produce two call sites
    - Test enclosing scope is `Class.method` for methods
    - Test enclosing scope is `<module>` for top-level calls
    - Test super().__init__() extraction
  - [x] 1.5 Verify extraction against `tests/fixtures/sample_python.py`
    - Extract all calls, compare to known call sites in the file

**Acceptance Criteria:**
- Tree-sitter parses Python files and extracts all call expressions
- Each call site has correct receiver, method, line, and enclosing scope
- Chained and nested calls extracted as separate entries
- Tests pass against real fixture files

---

### Phase 2: Resolution Pipeline

#### Task Group 2: Call Target Resolution
**Dependencies:** Task Group 1

- [x] 2.0 Implement resolution pipeline
  - [x] 2.1 Create `ResolutionContext` dataclass
    - index_entries: parsed `_index.txt` symbols (from ctags)
    - import_entries: parsed `_imports.txt` (from store)
    - assignments: `{class_name.attr_name: resolved_type}` (from tree-sitter)
    - annotations: `{class_name.attr_name: annotated_type}` (from tree-sitter)
  - [x] 2.2 Implement AssignmentTracker
    - Parse class `__init__` for `self.x = ClassName()` patterns
    - Parse local scope for `x = ClassName()` patterns
    - Confidence: 0.95 for constructor, 0.85 for factory call
    - Test: self.db = Database() resolves self.db to Database
    - Test: factory call `self.db = get_db()` returns None
  - [x] 2.3 Implement TypeAnnotationHarvester
    - Parse parameter annotations: `def f(self, db: Database)`
    - Parse class variable annotations: `db: Database`
    - Parse inline annotations: `self.db: Database = ...`
    - Confidence: 0.90
    - Test: param annotation resolves
    - Test: class var annotation resolves
  - [x] 2.4 Implement ImportFollower
    - Read `_imports.txt` from snapshot
    - Match bare function/class calls to imported names
    - Resolve to source file or mark as external (`-`)
    - Confidence: 0.85
    - Test: `from src.db import Database` → Database() resolves to src/db.py
    - Test: `from logging import getLogger` → callee_file = "-"
  - [x] 2.5 Implement CtagsXref
    - Read `_index.txt` from snapshot
    - Search for method name across all classes
    - Single match: 0.70, ambiguous: 0.40 each, same directory bonus +0.10
    - Test: single match resolves with 0.70
    - Test: ambiguous match emits all candidates at 0.40
  - [x] 2.6 Implement ConventionHeuristic
    - snake_case receiver → PascalCase class matching
    - Method name + class name similarity scoring
    - Confidence: 0.30
    - Test: `db` → `Database` at 0.30
    - Test: `user_service` → `UserService` at 0.30
  - [x] 2.7 Wire pipeline: run resolvers in order, first confident match wins
    - If no resolver matches, emit with callee_file="-", confidence=0.20
    - Test: pipeline runs all stages in order
    - Test: high-confidence resolver short-circuits later stages

**Acceptance Criteria:**
- Each resolver tested in isolation with correct confidence
- Pipeline runs stages in order, stops at first match
- Unresolved calls still emitted with low confidence
- Resolution uses real `_index.txt` and `_imports.txt` data

---

### Phase 3: Pipeline Integration

#### Task Group 3: Wire into file_analyzer + update _calls.txt
**Dependencies:** Task Groups 1-2, existing ctags provider

- [x] 3.0 Integrate tree-sitter provider into pipeline
  - [x] 3.1 Update `_calls.txt` format
    - Add 6th column: confidence (float, 2 decimal places)
    - Update `write_calls()` in store.py to write confidence
    - Update `read_calls()` in diagram_builders.py to parse confidence (optional field, default 1.0 for backward compat)
    - Test: round-trip write → read preserves confidence
    - Test: old format without confidence still parses (backward compat)
  - [x] 3.2 Wire TreeSitterProvider into file_analyzer.py
    - Register after ctags, after store writes index files
    - Config: `AST_TREESITTER_ENABLED` env var (default: true when tree-sitter installed)
    - Test: pipeline runs ctags → store → tree-sitter → merge
  - [x] 3.3 Create `config/treesitter_languages.yaml`
    - Python config with call query and assignment patterns
    - Extensible for future languages
  - [x] 3.4 Integration test: full pipeline
    - Analyze `tests/fixtures/sample_python.py` with ctags + tree-sitter
    - Verify `_calls.txt` has resolved calls with confidence
    - Verify sequence diagram builds from real data
    - Verify `_index.txt` + `_calls.txt` grep examples from spec work
  - [x] 3.5 Performance test
    - Analyze `src/` directory (this repo, ~30 files)
    - Assert total time < 5 seconds
    - Assert no file takes > 500ms

**Acceptance Criteria:**
- `_calls.txt` has confidence column, backward compatible
- Tree-sitter provider runs after ctags in pipeline
- Full round-trip: source → ctags → store → tree-sitter → _calls.txt → sequence diagram
- Performance: this repo analyzed in < 5 seconds

---

### Phase 4: Additional Languages

#### Task Group 4: TypeScript + Go Support
**Dependencies:** Task Groups 1-3

- [x] 4.0 Add TypeScript and Go support
  - [x] 4.1 TypeScript/JavaScript call extraction
    - Grammar: `tree-sitter-typescript`, `tree-sitter-javascript`
    - Call query: `(call_expression function: [(member_expression ...) (identifier ...)])`
    - Assignment patterns: `this.x = new Class()`, typed params
    - Test: method call, bare function, constructor, `new Class()`
  - [x] 4.2 Go call extraction
    - Grammar: `tree-sitter-go`
    - Call query: `(call_expression function: [(selector_expression ...) (identifier ...)])`
    - Assignment patterns: `x := NewClass()`, typed params (explicit types)
    - Test: method call, function call, `pkg.Function()`
  - [x] 4.3 Update config with new languages
  - [x] 4.4 Integration test: multi-language repo

**Acceptance Criteria:**
- TypeScript and Go files produce call graphs
- Resolution pipeline works across languages
- Config-driven language support

---

## Execution Order

1. **Phase 1: Python Call Extraction** — tree-sitter setup, AST walking, raw call sites
2. **Phase 2: Resolution Pipeline** — 5 resolvers, confidence scoring, pipeline wiring
3. **Phase 3: Pipeline Integration** — _calls.txt update, file_analyzer wiring, performance
4. **Phase 4: Additional Languages** — TypeScript, Go (can be deferred)

## Completion Criteria

Feature is complete when ALL of the following are true:
- Tree-sitter parses Python files and extracts all call expressions
- Resolution pipeline resolves call targets with calibrated confidence
- `_calls.txt` includes confidence column, backward compatible
- Full pipeline: ctags → store → tree-sitter → _calls.txt → sequence diagram
- This repo analyzed in < 5 seconds
- All existing 238 tests still pass + new test coverage
- Integration test proves real calls extracted and resolved

## Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **Structural Store** | Tree-sitter writes to `_calls.txt` in the store |
| **Pattern Detection** | Call-graph tier patterns (mediator, facade, chain) consume `_calls.txt` |
| **LSP Call Graph** | Replaced by this spec. LSP branch preserved for IDE-specific use cases |
| **Diagram Pipeline** | Sequence diagrams consume `_calls.txt` (already built) |
