# Specification: Tree-sitter Multi-Language Support

## Summary

Refactor the tree-sitter call graph provider from a Python-only monolith into a config-driven, multi-language framework. Phase 1 extracts a pluggable extractor interface and moves Python-specific AST walking behind it. Phase 2 adds TypeScript and Go extractors.

---

## Problem

The current `TreeSitterProvider` (639 lines in `src/ast/treesitter_provider.py`) hardcodes Python:

- `CallExtractor` walks Python-specific AST nodes: `call`, `attribute`, `import_from_statement`, `assignment`, `typed_parameter`
- `analyze_batch()` filters to `.py`/`.pyi` files only
- Grammar is imported directly: `import tree_sitter_python as tspython`
- No mechanism to add another language without modifying the core provider

Meanwhile, the rest of the pipeline is already language-agnostic:
- `_calls.txt`, `_imports.txt` — tab-separated, no Python assumptions
- Resolution pipeline (ctags xref, convention heuristic) — works on symbol names, not AST nodes
- Store, diagrams, serialisers — all consume the generic `CallInfo`/`ImportInfo` models
- `pipeline.py` — orchestrates without knowing about Python

**Goal:** Make tree-sitter extraction config-driven so adding a new language = one extractor file + one config entry.

---

## Design Principles

1. **Config-driven grammar loading.** A YAML file maps file extensions → grammar packages → extractor classes. No code changes to add a supported language.
2. **Pluggable extractors.** Each language implements a `LanguageExtractor` interface with 4 methods: `extract_calls()`, `extract_imports()`, `extract_assignments()`, `extract_annotations()`. Each returns the same model types.
3. **Shared resolution pipeline.** The `CallResolver` and `ResolutionContext` are language-agnostic. They consume `RawCallSite` objects regardless of source language.
4. **Graceful degradation.** If a grammar package isn't installed, skip that language with a warning. Don't crash.
5. **No regression.** Python extraction must produce identical results after refactoring. Prove it with before/after integration tests on the real repo.
6. **Same output format.** `_calls.txt`, `_imports.txt` — unchanged. Consumers don't know or care which language produced the data.

---

## Architecture

### Current (monolith)

```
treesitter_provider.py (639 lines)
├── RawCallSite (dataclass)
├── ResolutionContext (dataclass)
├── CallExtractor          ← Python-specific AST walking
├── CallResolver           ← Language-agnostic (5-stage pipeline)
├── TreeSitterProvider     ← Routes to CallExtractor, Python-only
├── _parse_index()         ← Language-agnostic
└── _parse_imports()       ← Language-agnostic
```

### Target (pluggable)

```
config/treesitter_languages.yaml     ← extension → grammar → extractor mapping

src/ast/
├── treesitter_provider.py           ← TreeSitterProvider (router + resolver, language-agnostic)
├── treesitter_models.py             ← RawCallSite, ResolutionContext (shared)
├── treesitter_resolver.py           ← CallResolver (shared, 5-stage pipeline)
├── treesitter_utils.py              ← _parse_index, _parse_imports, _snake_to_pascal
└── extractors/
    ├── base.py                      ← LanguageExtractor (abstract interface)
    ├── python.py                    ← PythonExtractor (moved from CallExtractor)
    ├── typescript.py                ← TypeScriptExtractor (new)
    └── go.py                        ← GoExtractor (new)
```

### Config File

```yaml
# config/treesitter_languages.yaml
languages:
  python:
    extensions: [".py", ".pyi"]
    package: tree_sitter_python
    extractor: src.ast.extractors.python.PythonExtractor
    enabled: true

  typescript:
    extensions: [".ts", ".tsx", ".js", ".jsx"]
    package: tree_sitter_typescript
    extractor: src.ast.extractors.typescript.TypeScriptExtractor
    enabled: true

  go:
    extensions: [".go"]
    package: tree_sitter_go
    extractor: src.ast.extractors.go.GoExtractor
    enabled: true
```

### LanguageExtractor Interface

```python
from abc import ABC, abstractmethod
from src.ast.treesitter_models import RawCallSite
from src.ast.models import ImportInfo

class LanguageExtractor(ABC):
    """Per-language AST walking. Implementations know about tree-sitter node types."""

    @abstractmethod
    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        """Extract all call sites from source."""
        pass

    @abstractmethod
    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract imports. Returns [(module, [names], is_relative)]."""
        pass

    @abstractmethod
    def extract_assignments(self, source: bytes) -> dict[str, str]:
        """Extract variable assignments for type resolution. Returns {var_name: type_name}."""
        pass

    @abstractmethod
    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type annotations. Returns {param_name: type_name}."""
        pass
```

---

## Language-Specific AST Node Mappings

### Python (existing — move to `PythonExtractor`)

| Concept | Node Type | Example |
|---------|-----------|---------|
| Function call | `call` → `attribute` / `identifier` | `foo.bar()`, `func()` |
| Import | `import_from_statement`, `import_statement` | `from os import path` |
| Assignment | `assignment` → `attribute` (self.x = Foo()) | `self.db = Database()` |
| Annotation | `typed_parameter` | `def f(db: Database)` |
| Class | `class_definition` | `class Foo(Base):` |
| Method scope | `function_definition` parent chain | `class.method` |

### TypeScript (new)

| Concept | Node Type | Example |
|---------|-----------|---------|
| Function call | `call_expression` → `member_expression` / `identifier` | `foo.bar()`, `func()` |
| Import | `import_statement` → `import_clause` | `import { Foo } from './foo'` |
| Assignment | `variable_declaration` / `assignment_expression` | `const db = new Database()` |
| Annotation | `type_annotation` | `function f(db: Database)` |
| Class | `class_declaration` | `class Foo extends Base {}` |
| Method scope | `method_definition` parent chain | `class.method` |
| Constructor | `new_expression` | `new Foo()` |
| Optional chain | `optional_chain_expression` | `foo?.bar()` |

### Go (new)

| Concept | Node Type | Example |
|---------|-----------|---------|
| Function call | `call_expression` → `selector_expression` / `identifier` | `pkg.Func()`, `func()` |
| Import | `import_spec` / `import_declaration` | `import "fmt"` |
| Assignment | `short_var_declaration` / `assignment_statement` | `db := NewDatabase()` |
| Annotation | N/A (Go is statically typed — use variable declarations) | `var db Database` |
| Struct | `type_declaration` → `struct_type` | `type Foo struct {}` |
| Method scope | `method_declaration` with receiver | `func (f *Foo) Bar()` |
| Goroutine | `go_statement` → `call_expression` | `go handler()` |
| Defer | `defer_statement` → `call_expression` | `defer conn.Close()` |

---

## Resolution Pipeline (unchanged)

The 5-stage resolver is language-agnostic and stays in `treesitter_resolver.py`:

1. **Assignment tracking** — `self.db = Database()` → `self.db.query()` resolves to `Database.query`
2. **Type annotations** — `def f(db: Database)` → `db.query()` resolves to `Database.query`
3. **Import following** — `from db import execute` → `execute()` resolves via imports
4. **Ctags cross-reference** — look up symbol name in `_index.txt`
5. **Convention heuristic** — `snake_case()` → look for `PascalCase` class match

All stages consume `RawCallSite` and produce `CallInfo`. Language doesn't matter.

---

## Testing Strategy

### Phase 1 (refactor) — no-regression proof

- Run the existing 21 real-data integration tests BEFORE refactoring
- Capture `_calls.txt` and `_imports.txt` output for `src/ast/*.py`
- Run the same tests AFTER refactoring
- Assert identical output (byte-for-byte `_calls.txt` comparison)
- All 296 existing tests must pass

### Phase 2 (TypeScript + Go) — new integration tests

- **TypeScript fixture:** Create `tests/fixtures/sample_typescript.ts` with classes, imports, method calls, constructors, optional chaining
- **Go fixture:** Create `tests/fixtures/sample_go.go` with structs, methods with receivers, package imports, goroutines, defer
- Integration tests run extractors on real fixture files (not synthetic bytes)
- Verify `_calls.txt` entries have correct caller/callee/confidence
- Verify `_imports.txt` entries match actual import statements
- Cross-language test: analyze a mixed repo (Python + TS + Go) → single merged `_calls.txt`

---

## Out of Scope

- Java, C#, Rust, C/C++ extractors (future — same pattern, add when needed)
- Cross-language call resolution (Python calling a Go service — needs different approach)
- Dynamic language features (JavaScript `eval()`, Python `getattr()`)
- Framework-specific patterns (React hooks, Go interfaces as dispatch)
- AST caching across runs (tree-sitter is fast enough without it)
