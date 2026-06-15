# Specification: Tree-sitter Language Expansion

## Summary

Extend tree-sitter call graph extraction to cover all languages already supported by ctags in the pipeline: **Java**, **Rust**, **C**, **C++**, and **C#**. These join the existing Python, TypeScript, and Go extractors, giving tree-sitter parity with ctags for all `source_extensions` in the structural analysis endpoint.

---

## Problem

The pipeline's structural endpoint already scans 9 file types:

```python
source_extensions = {".py", ".js", ".ts", ".java", ".go", ".rs", ".c", ".cpp", ".cs"}
```

Ctags processes all of them. But tree-sitter only has extractors for 3 (Python, TypeScript, Go). For the other 6 extensions (`.java`, `.rs`, `.c`, `.cpp`, `.cs`), we get ctags symbols but **no call graph, no import tracking, no assignment/annotation resolution**.

That means:
- No call-graph diagrams for Java/Rust/C/C++/C# codebases
- No dependency analysis for those languages
- No cross-file resolution beyond what ctags symbols provide

**Goal:** Full tree-sitter extraction for all 9 extension groups — one extractor per language family.

---

## Current State

### Tree-sitter extractors (3 languages)

| Language | Extractor | Extensions | Lines |
|----------|-----------|------------|-------|
| Python | `PythonExtractor` | `.py`, `.pyi` | 222 |
| TypeScript | `TypeScriptExtractor` | `.ts`, `.tsx`, `.js`, `.jsx` | 327 |
| Go | `GoExtractor` | `.go` | 320 |

### What each extractor provides (the 4-method interface)

| Method | ~Lines | What it does |
|--------|--------|-------------|
| `extract_calls` + `_walk_calls` + `_extract_call` | 80-100 | Walk AST, find function/method call nodes, build `RawCallSite` objects |
| `extract_imports` | 30-50 | Parse import/require/use/include statements into `(module, [names], is_relative)` tuples |
| `extract_assignments` + `_walk_assignments` | 40-60 | Find `self.x = Foo()` / `this.x = new Foo()` patterns for type resolution |
| `extract_annotations` + `_walk_annotations` | 30-40 | Pull type hints / declarations for resolution |
| `_find_enclosing_scope` | ~30 | Walk up AST to find containing function/class/method name |
| `_resolve_rhs` | 15-20 | Determine class name on right side of assignment |
| Boilerplate (init, properties) | ~15 | Parser setup, `file_extensions`, `grammar` |
| **Total per extractor** | **~250** | |

### Infrastructure already in place

- `LanguageExtractor` abstract base class (`src/ast/extractors/base.py`)
- Config-driven loader (`config/treesitter_languages.yaml` → `treesitter_config.py`)
- Language-agnostic resolver (`treesitter_resolver.py` — 5-stage pipeline)
- Language-agnostic output (`_calls.txt`, `_imports.txt`)
- Dynamic import + graceful degradation (missing grammar → skip with warning)

**No infrastructure changes needed.** This is purely new extractor classes + config entries.

---

## Languages to Add

### 1. Java

| Concept | AST Node Types | Example |
|---------|---------------|---------|
| Function call | `method_invocation`, `object_creation_expression` | `foo.bar()`, `new Foo()` |
| Import | `import_declaration` | `import java.util.List;` |
| Assignment | `local_variable_declaration`, `assignment_expression`, `field_declaration` | `List<String> items = new ArrayList<>()` |
| Annotation | `type_identifier` on parameters, fields, return types | `public void process(Database db)` |
| Class | `class_declaration`, `interface_declaration`, `enum_declaration` | `public class Foo extends Bar {}` |
| Method scope | `method_declaration` → parent `class_declaration` | `Foo.process` |
| Static call | `method_invocation` with type as receiver | `Collections.sort(list)` |

- **Extensions:** `.java`
- **Grammar:** `tree-sitter-java`
- **Complexity:** Medium — Java's AST is verbose but regular. Generics (`<>`) in type positions need handling.

### 2. Rust

| Concept | AST Node Types | Example |
|---------|---------------|---------|
| Function call | `call_expression`, `method_call_expression` | `foo()`, `bar.baz()` |
| Import | `use_declaration` | `use std::collections::HashMap;` |
| Assignment | `let_declaration`, `assignment_expression` | `let db = Database::new()` |
| Annotation | Type in `let_declaration`, function params | `fn process(db: &Database)` |
| Struct/Impl | `struct_item`, `impl_item`, `trait_item` | `impl Foo { fn bar() {} }` |
| Method scope | `function_item` inside `impl_item` | `Foo::bar` |
| Macro call | `macro_invocation` | `println!("hello")` |
| Trait method | `call_expression` via trait dispatch | `trait.method()` |

- **Extensions:** `.rs`
- **Grammar:** `tree-sitter-rust`
- **Complexity:** Medium-high — `use` trees can be nested (`use std::{io, fs::{self, File}}`), `impl` blocks define scope.

### 3. C

| Concept | AST Node Types | Example |
|---------|---------------|---------|
| Function call | `call_expression` | `printf("hello")`, `foo->bar()` |
| Include | `preproc_include` | `#include <stdio.h>`, `#include "mylib.h"` |
| Assignment | `declaration`, `assignment_expression` | `int x = foo()` |
| Annotation | Type specifiers in declarations | `void process(Database *db)` |
| Struct | `struct_specifier` | `struct Foo { int x; }` |
| Function scope | `function_definition` | enclosing function name |
| Pointer call | `call_expression` via `->` or `*` | `ptr->method()`, `(*fptr)()` |

- **Extensions:** `.c`, `.h`
- **Grammar:** `tree-sitter-c`
- **Complexity:** Low-medium — simpler than OOP languages. Preprocessor macros are opaque to AST but we extract what tree-sitter parses.

### 4. C++

| Concept | AST Node Types | Example |
|---------|---------------|---------|
| Function call | `call_expression`, `new_expression` | `foo.bar()`, `new Foo()` |
| Include | `preproc_include` | `#include <vector>`, `#include "myclass.h"` |
| Assignment | `declaration`, `init_declarator` | `auto db = Database()` |
| Annotation | Type specifiers, `auto`, templates | `void process(Database& db)` |
| Class | `class_specifier`, `struct_specifier` | `class Foo : public Base {}` |
| Method scope | `function_definition` inside `class_specifier`, or qualified name | `Foo::bar` |
| Template call | `template_function` → `call_expression` | `std::make_shared<Foo>()` |
| Namespace | `namespace_definition`, `using_declaration` | `using namespace std;` |

- **Extensions:** `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.h` (shared with C — see resolution note)
- **Grammar:** `tree-sitter-cpp`
- **Complexity:** High — templates, namespaces, operator overloading, multiple inheritance. Most complex extractor.

### 5. C# (C-Sharp)

| Concept | AST Node Types | Example |
|---------|---------------|---------|
| Function call | `invocation_expression`, `object_creation_expression` | `foo.Bar()`, `new Foo()` |
| Import | `using_directive` | `using System.Collections.Generic;` |
| Assignment | `variable_declaration`, `assignment_expression` | `var db = new Database()` |
| Annotation | Type in declarations, parameters | `void Process(Database db)` |
| Class | `class_declaration`, `interface_declaration`, `struct_declaration` | `public class Foo : Bar {}` |
| Method scope | `method_declaration` → parent `class_declaration` | `Foo.Process` |
| Namespace | `namespace_declaration` | `namespace MyApp.Services {}` |
| Property | `property_declaration` with get/set | `public Database Db { get; set; }` |

- **Extensions:** `.cs`
- **Grammar:** `tree-sitter-c-sharp`
- **Complexity:** Medium — similar to Java. LINQ expressions and async/await add some node types but core extraction is straightforward.

---

## File Changes

### New files (5 extractors)

| File | Language | Est. Lines |
|------|----------|-----------|
| `src/ast/extractors/java.py` | Java | ~280 |
| `src/ast/extractors/rust.py` | Rust | ~300 |
| `src/ast/extractors/c.py` | C | ~220 |
| `src/ast/extractors/cpp.py` | C++ | ~350 |
| `src/ast/extractors/csharp.py` | C# | ~280 |

### Modified files

| File | Change |
|------|--------|
| `config/treesitter_languages.yaml` | Add 5 language entries |
| `requirements.txt` | Add 5 grammar packages |
| `src/structural_endpoints.py` | Add `.h`, `.hpp`, `.cc`, `.cxx`, `.hxx` to `source_extensions` |
| `Dockerfile` | Add grammar packages to pip install |

### No changes needed

| File | Why |
|------|-----|
| `src/ast/extractors/base.py` | Interface unchanged — 4 methods + 2 properties |
| `src/ast/treesitter_provider.py` | Config-driven routing already handles N languages |
| `src/ast/treesitter_resolver.py` | Language-agnostic — consumes `RawCallSite` |
| `src/ast/treesitter_config.py` | Dynamic import already works for any extractor |
| `src/ast/treesitter_models.py` | `RawCallSite` model unchanged |
| `src/ast/store.py` | Consumes language-agnostic output |
| `src/ast/pipeline.py` | Orchestrates without knowing languages |

---

## Config Extension

```yaml
# config/treesitter_languages.yaml — additions

  java:
    extensions: [".java"]
    package: tree_sitter_java
    extractor: src.ast.extractors.java.JavaExtractor
    enabled: true

  rust:
    extensions: [".rs"]
    package: tree_sitter_rust
    extractor: src.ast.extractors.rust.RustExtractor
    enabled: true

  c:
    extensions: [".c", ".h"]
    package: tree_sitter_c
    extractor: src.ast.extractors.c.CExtractor
    enabled: true

  cpp:
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"]
    package: tree_sitter_cpp
    extractor: src.ast.extractors.cpp.CppExtractor
    enabled: true

  csharp:
    extensions: [".cs"]
    package: tree_sitter_c_sharp
    extractor: src.ast.extractors.csharp.CSharpExtractor
    enabled: true
```

### `.h` Ambiguity (C vs C++)

`.h` files could be C or C++. Resolution strategy:
1. Default: assign `.h` to C extractor (simpler grammar, parses most headers)
2. If a project has both `.c` and `.cpp` files, `.h` files in directories with `.cpp` siblings get routed to C++
3. Configurable override: user can reassign `.h` in `treesitter_languages.yaml`
4. Phase 1: just use C extractor for `.h` — pragmatic, handles 90% of cases

---

## Resolution Pipeline (unchanged)

The 5-stage resolver is language-agnostic and requires **zero changes**:

1. **Assignment tracking** — `self.db = Database()` → `self.db.query()` resolves to `Database.query`
2. **Type annotations** — `def f(db: Database)` → `db.query()` resolves to `Database.query`
3. **Import following** — `from db import execute` → `execute()` resolves via imports
4. **Ctags cross-reference** — look up symbol name in `_index.txt`
5. **Convention heuristic** — `snake_case()` → look for `PascalCase` class match

All stages consume `RawCallSite` and produce `CallInfo`. Language doesn't matter.

---

## Implementation Order

Ordered by complexity (easiest first) and ecosystem demand:

| Phase | Language | Why this order |
|-------|----------|---------------|
| 1 | **Java** | Largest enterprise ecosystem, AST similar to TypeScript (already done) |
| 2 | **C#** | Very similar to Java — reuse patterns, fast follow |
| 3 | **C** | Simpler language, fewer constructs |
| 4 | **Rust** | Growing ecosystem, `use` tree parsing needs care |
| 5 | **C++** | Most complex — templates, namespaces, operator overloading |

Each phase is independently shippable. One extractor + config + tests per phase.

---

## Testing Strategy

Per the project testing policy: **every unit test MUST have a corresponding integration test on real data.**

### Per-language test set

| Test type | File | What |
|-----------|------|------|
| Fixture | `tests/fixtures/sample_<lang>.<ext>` | Real-ish source file with classes, imports, calls, assignments |
| Integration | `tests/integration/test_<lang>_extractor.py` | Extract from fixture, verify `RawCallSite` fields |
| Cross-language | `tests/integration/test_multi_language.py` | Mixed directory → single merged `_calls.txt` |

### What each integration test verifies

1. **Calls:** correct caller, callee, line number, confidence for each `RawCallSite`
2. **Imports:** all import statements parsed, modules + names correct, relative flag correct
3. **Assignments:** type-bearing assignments captured (`var db = new Database()` → `{"db": "Database"}`)
4. **Annotations:** type annotations on parameters and fields captured
5. **Scope:** enclosing function/method/class correctly identified
6. **No regression:** existing Python/TS/Go tests still pass (run full suite)

### Fixture requirements

Each fixture file should exercise:
- Simple function calls
- Method calls (instance + static/class)
- Constructor / object creation
- Import variations (named, wildcard, aliased, relative)
- Nested scopes (class → method → lambda/closure)
- Language-specific patterns (see AST node tables above)

---

## Grammar Packages

All available on PyPI with `>=0.23.0` versions:

| Package | Latest | Size |
|---------|--------|------|
| `tree-sitter-java` | 0.23.5 | ~200KB |
| `tree-sitter-rust` | 0.24.2 | ~300KB |
| `tree-sitter-c` | 0.24.1 | ~150KB |
| `tree-sitter-cpp` | 0.23.4 | ~400KB |
| `tree-sitter-c-sharp` | 0.23.1 | ~350KB |

All require `build-essential` (already in Dockerfile for existing grammars).

---

## Performance Targets

Same as existing extractors:

| Operation | Target |
|-----------|--------|
| Parse + extract (single file) | <50ms |
| Full analysis (100 files, any language) | <5s |
| Full analysis (500 files, mixed) | <25s |
| Grammar loading (per language) | <100ms |

---

## Out of Scope

- Cross-language call resolution (Java calling C via JNI, Rust FFI, etc.)
- Preprocessor macro expansion (C/C++ `#define` — tree-sitter sees the macro call, not the expansion)
- Template metaprogramming resolution (C++ — extract the call, but don't resolve template instantiation)
- Framework-specific patterns (Spring DI, ASP.NET routing, Rust async traits)
- Language Server Protocol integration (separate spec)
- Additional languages beyond ctags parity (Kotlin, Swift, Ruby, PHP — future work)
