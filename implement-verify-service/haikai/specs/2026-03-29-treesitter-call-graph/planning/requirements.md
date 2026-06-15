# Requirements: Tree-sitter Call Graph Provider

## Feature Description

Replace LSP-based call graph extraction with tree-sitter AST parsing and multi-stage call resolution. Tree-sitter parses each file in milliseconds, extracts all call expressions in a single walk, then resolves callee targets through a 5-stage pipeline. Output is `_calls.txt` with a confidence column. This is the Python-only implementation — multi-language support is a separate spec.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- tree-sitter Python bindings (`tree-sitter>=0.23.0`)
- tree-sitter Python grammar (`tree-sitter-python>=0.23.0`)
- Existing ctags provider (for `_index.txt` symbol data)
- Existing file store (`src/ast/store.py` for `_calls.txt` persistence)
- Existing diagram builders (`src/ast/diagram_builders.py` for sequence diagrams)

## Requirements

### Tree-sitter Parser + Call Extraction
- One parse per file — single AST walk extracts all call expressions
- Extract: method calls (`foo.bar()`), bare function calls (`func()`), constructor calls (`Foo()`), chained calls (`a.b().c()`), nested calls (`f(g(x))`), super calls (`super().__init__()`)
- Extract enclosing scope for each call (class.method or module-level)
- Extract line numbers for each call site
- Handle Python-specific nodes: `call`, `attribute`, `identifier`, `class_definition`, `function_definition`

### Import Extraction
- Extract `from X import Y` and `import X` statements
- Capture: module path, imported names, relative import flag
- Write to `_imports.txt` via existing store

### Assignment Tracking
- Track `self.x = Foo()` patterns for type resolution
- Track constructor assignments where RHS is a class instantiation
- Map variable names to inferred types for call resolution

### Type Annotation Harvesting
- Extract `def f(db: Database)` parameter annotations
- Map parameter names to annotated types for call resolution
- Skip `self` parameter annotations

### 5-Stage Resolution Pipeline
1. **Assignment tracking** — `self.db = Database()` → `self.db.query()` resolves to `Database.query`
2. **Type annotations** — `def f(db: Database)` → `db.query()` resolves to `Database.query`
3. **Import following** — reads `_imports.txt` to resolve bare function calls via import data
4. **Ctags cross-reference** — looks up symbol name in `_index.txt`, handles ambiguous matches
5. **Convention heuristic** — `snake_case()` → searches for `PascalCase` class with matching method

- First confident match wins (short-circuit)
- Unresolved calls emitted with low confidence (0.1)
- Each stage has a base confidence that reflects certainty level

### Output Format
- `_calls.txt` — tab-separated: caller_file, caller_name, callee_file, callee_name, line, confidence
- Confidence: 0.0–0.95 float, reflects actual resolution evidence
- Header comment row describing columns
- Written via `store.write_calls()`

### Sequence Diagram Generation
- `SequenceDiagramBuilder` reads `_calls.txt` to generate sequence diagrams
- Confidence threshold filtering (exclude low-confidence noise)
- Builtin exclusion (filter out stdlib calls like `print`, `len`)
- Output in Mermaid, PlantUML, and Graphviz formats via existing serialisers

### Pipeline Integration
- Wired into `src/ast/pipeline.py` (shared pipeline)
- Runs after ctags snapshot is written (needs `_index.txt` and `_imports.txt`)
- Results merged into ctags analysis via `ProviderRegistry._merge_results()`
- Tree-sitter writes calls; ctags writes symbols/inheritance — they complement each other

## Testing Requirements

- Integration tests on real `src/ast/*.py` files (17 files)
- Verify call edges produced, high/medium confidence calls present
- Verify `_calls.txt` round-trips through `write_calls()` → `read_calls()`
- Verify sequence diagrams generated from real call data
- Verify imports populated and written to `_imports.txt`
- Performance tests: under 5s total, no single file over 500ms
- Edge cases: super() calls, module-level calls, self-calls
- Every unit test must have a corresponding integration test on real data

## Performance Targets

| Operation | Target |
|-----------|--------|
| Parse single Python file | <10ms |
| Extract calls (single file) | <20ms |
| Full analysis (17 files in src/ast/) | <5s |
| No single file over | 500ms |
| Resolution pipeline per call | <1ms |

## Constraints

- Python-only (Phase 1) — multi-language is a separate spec
- tree-sitter grammar must be installed (`tree-sitter-python` pip package)
- Resolution depends on ctags `_index.txt` being written first
- Import following depends on `_imports.txt` being written first (see stale data fix in pipeline.py)
- Cannot resolve dynamic dispatch (`strategies[key].execute()`)
- Cannot resolve `getattr()` or other reflection-based calls

## Out of Scope

- TypeScript, Go, or other language support (separate spec: `2026-03-30-treesitter-multi-language`)
- LSP-based call graph (parked on `feature/lsp-call-graph-2026-03-29`)
- Cross-file data flow analysis
- Async/await-specific call tracking
- Dynamic dispatch resolution
