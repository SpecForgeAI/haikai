# Requirements: Tree-sitter Multi-Language Support

## Feature Description

Refactor the tree-sitter call graph provider from a Python-only monolith (639 lines) into a config-driven, multi-language framework with pluggable per-language extractors. Add TypeScript and Go as the first additional languages.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- Existing `src/ast/treesitter_provider.py` (to be refactored)
- Existing shared pipeline: `src/ast/pipeline.py`
- tree-sitter Python bindings (`tree-sitter>=0.23.0`)
- Per-language grammar packages:
  - `tree-sitter-python>=0.23.0` (existing)
  - `tree-sitter-typescript>=0.23.0` (new)
  - `tree-sitter-go>=0.23.0` (new)
- YAML config for language registration (`config/treesitter_languages.yaml`)

## Requirements

### Config-Driven Language Registration
- YAML config file: `config/treesitter_languages.yaml`
- Maps file extensions → grammar package → extractor class
- Per-language `enabled` flag (can disable without removing code)
- Config loader with graceful fallback: if config missing, default to Python-only
- Graceful degradation: if a grammar package not installed, skip that language with warning — don't crash
- Dynamic import of extractor classes from config (no hardcoded class references in provider)

### LanguageExtractor Interface
- Abstract base class: `src/ast/extractors/base.py`
- 4 abstract methods:
  - `extract_calls(source: bytes, file_path: str) -> list[RawCallSite]`
  - `extract_imports(source: bytes) -> list[tuple[str, list[str], bool]]`
  - `extract_assignments(source: bytes) -> dict[str, str]`
  - `extract_annotations(source: bytes) -> dict[str, str]`
- Properties: `grammar` (tree-sitter grammar module), `file_extensions` (list of handled extensions)
- Shared models: `RawCallSite`, `ResolutionContext` extracted to `treesitter_models.py`

### PythonExtractor
- Moved from current `CallExtractor` in `treesitter_provider.py`
- Handles: `call`, `attribute`, `import_from_statement`, `import_statement`, `assignment`, `typed_parameter`, `class_definition`, `function_definition`
- Must produce identical output to current code (byte-for-byte `_calls.txt` regression test)

### TypeScriptExtractor
- Handles: `call_expression`, `member_expression`, `new_expression`, `optional_chain_expression`
- Import types: `import_statement`, `import_clause`, named/default/namespace imports, re-exports
- Assignments: `variable_declaration` (`const`/`let`/`var`), `assignment_expression`
- Annotations: `type_annotation` on parameters and return types
- Scope detection: `class_declaration` → `method_definition` parent chain
- `.ts`, `.tsx`, `.js`, `.jsx` file extensions

### GoExtractor
- Handles: `call_expression`, `selector_expression`, `go_statement`, `defer_statement`
- Import types: `import_declaration`, `import_spec`, aliased imports
- Assignments: `short_var_declaration`, `assignment_statement`, `var_declaration`
- Annotations: N/A — use `var_declaration` type info and receiver types
- Method receivers: `method_declaration` → extract `(receiver *Type)` as scope
- Struct declarations: `type_declaration` → `struct_type`
- `.go` file extension

### TreeSitterProvider Refactoring
- Becomes a router: reads config → groups files by extension → dispatches to correct extractor
- Resolution pipeline (`CallResolver`) moved to `treesitter_resolver.py` — unchanged, language-agnostic
- Utility functions (`_parse_index`, `_parse_imports`) moved to `treesitter_utils.py`
- Target size: ~100 lines (down from 639)
- No language-specific AST node types referenced in the provider

### Resolution Pipeline (unchanged)
- 5-stage pipeline stays in `treesitter_resolver.py`: assignment tracking → type annotations → import following → ctags xref → convention heuristic
- Consumes `RawCallSite` objects regardless of source language
- Produces `CallInfo` objects for the store

### Output Format (unchanged)
- `_calls.txt` — tab-separated: caller_file, caller, callee_file, callee, line, confidence
- `_imports.txt` — tab-separated: file, module, names
- All downstream consumers (store, diagrams, serialisers, query endpoint) unaffected

## Testing Requirements

### Phase 1 — No-Regression
- Capture baseline `_calls.txt` and `_imports.txt` from current code on `src/ast/*.py`
- After refactoring: byte-for-byte comparison against baseline
- All 296 existing tests must pass
- Integration tests run against real repo files (per project testing policy)

### Phase 2 — New Languages
- TypeScript: fixture file `tests/fixtures/sample_typescript.ts` with classes, imports, constructors, optional chaining
- Go: fixture file `tests/fixtures/sample_go.go` with structs, receivers, goroutines, defer, multi-package imports
- Integration tests extract from real fixture files, verify `RawCallSite` entries
- Cross-language test: mixed directory (Python + TS + Go) → single merged `_calls.txt`
- Every unit test must have a corresponding integration test on real data

## Performance Targets

| Operation | Target |
|-----------|--------|
| Parse + extract calls (single file) | <50ms |
| Full analysis (100 Python files) | <5s |
| Full analysis (100 TypeScript files) | <5s |
| Full analysis (100 Go files) | <5s |
| Mixed analysis (300 files, 3 languages) | <15s |
| Grammar loading (per language) | <100ms |
| Config parsing | <10ms |

## Constraints

- Grammar packages are optional — only Python is required. TypeScript and Go are optional extras.
- Each language extractor must be self-contained (no cross-extractor dependencies)
- tree-sitter grammar packages use native C code — `build-essential` required in Docker
- TypeScript grammar covers both TypeScript and JavaScript (JSX/TSX included)
- Go has no type annotations in the Python sense — extractor uses variable declarations instead
- Cross-language call resolution (e.g., Python calling a Go service) is out of scope

## Out of Scope

- Java, C#, Rust, C/C++ extractors (future — same pattern, add when needed)
- Cross-language call resolution
- Dynamic language features (JavaScript `eval()`, Python `getattr()`)
- Framework-specific patterns (React hooks, Go interfaces as dispatch)
- AST caching across runs
- Language Server Protocol integration (parked on separate branch)
