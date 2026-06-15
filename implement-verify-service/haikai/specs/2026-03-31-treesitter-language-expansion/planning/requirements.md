# Requirements: Tree-sitter Language Expansion

## Feature Description

Extend tree-sitter call graph extraction from 3 languages (Python, TypeScript, Go) to 8 languages by adding Java, C#, C, Rust, and C++. This achieves parity with ctags for all `source_extensions` configured in the structural analysis endpoint.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- Existing extractor framework (`src/ast/extractors/base.py` → `LanguageExtractor`)
- Existing config-driven loader (`config/treesitter_languages.yaml`)
- Existing language-agnostic resolver (`src/ast/treesitter_resolver.py`)
- tree-sitter Python bindings (`tree-sitter>=0.23.0`)
- New grammar packages:
  - `tree-sitter-java>=0.23.0`
  - `tree-sitter-rust>=0.23.0`
  - `tree-sitter-c>=0.23.0`
  - `tree-sitter-cpp>=0.23.0`
  - `tree-sitter-c-sharp>=0.23.0`

## Requirements

### Java Extractor (`src/ast/extractors/java.py`)
- Call extraction: `method_invocation`, `object_creation_expression` (including `new` keyword)
- Import extraction: `import_declaration` — handle both single-class and wildcard (`java.util.*`) imports
- Assignment extraction: `local_variable_declaration`, `field_declaration`, `assignment_expression`
- Annotation extraction: Type identifiers on parameters, fields, return types; handle generics (`List<String>` → base type `List`)
- Scope detection: `method_declaration` → parent `class_declaration` / `interface_declaration` / `enum_declaration`
- Static calls: Detect type-qualified calls (`Collections.sort()`) vs instance calls (`list.add()`)
- Extensions: `.java`
- Grammar: `tree_sitter_java`

### C# Extractor (`src/ast/extractors/csharp.py`)
- Call extraction: `invocation_expression`, `object_creation_expression`
- Import extraction: `using_directive` — handle namespace imports and static imports (`using static`)
- Assignment extraction: `variable_declaration` (including `var` inference), `assignment_expression`
- Annotation extraction: Explicit types on parameters, fields, properties; handle nullable (`Database?`)
- Scope detection: `method_declaration` → parent `class_declaration` / `interface_declaration` / `struct_declaration`
- Namespace resolution: Track `namespace_declaration` for fully-qualified scope names
- Property calls: `member_access_expression` for property access patterns
- Extensions: `.cs`
- Grammar: `tree_sitter_c_sharp`

### C Extractor (`src/ast/extractors/c.py`)
- Call extraction: `call_expression` — handle direct calls, pointer-to-function calls, `->` member calls
- Include extraction: `preproc_include` — extract header path, distinguish `<system.h>` vs `"local.h"` (map to is_relative flag)
- Assignment extraction: `declaration` with init, `assignment_expression`
- Annotation extraction: Type specifiers in function parameters and variable declarations
- Scope detection: `function_definition` (C has no classes — scope is always function-level)
- Pointer calls: Handle `ptr->func()` and `(*fptr)()` patterns
- Extensions: `.c`, `.h`
- Grammar: `tree_sitter_c`

### Rust Extractor (`src/ast/extractors/rust.py`)
- Call extraction: `call_expression`, `method_call_expression` — handle `::` path calls and `.` method calls
- Import extraction: `use_declaration` — handle nested `use` trees (`use std::{io, fs::{self, File}}`)
- Assignment extraction: `let_declaration` (with and without type annotation), `assignment_expression`
- Annotation extraction: Types in `let` bindings, function parameters, return types
- Scope detection: `function_item` inside `impl_item` → `Type::method`; standalone `function_item` → function name
- Macro calls: Extract `macro_invocation` as call sites (e.g., `println!`, `vec!`)
- Trait impl: Track `impl Trait for Type` blocks for method scope
- Extensions: `.rs`
- Grammar: `tree_sitter_rust`

### C++ Extractor (`src/ast/extractors/cpp.py`)
- Call extraction: `call_expression`, `new_expression` — handle qualified calls (`Namespace::Class::method()`)
- Include extraction: `preproc_include` — same as C, distinguish system vs local
- Assignment extraction: `declaration` with `init_declarator`, `auto` type inference
- Annotation extraction: Type specifiers, template type arguments (extract base type, ignore template params)
- Scope detection: `function_definition` with qualified declarator (`Foo::bar`), `class_specifier` parent chain
- Namespace: Track `namespace_definition`, resolve `using namespace` and `using` declarations
- Template calls: Extract call site even when template arguments present (`make_shared<Foo>()` → `make_shared`)
- Operator overloading: Extract `operator()` calls where detectable
- Extensions: `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`
- Grammar: `tree_sitter_cpp`

### `.h` Header Ambiguity Resolution
- Default: `.h` → C extractor (simpler grammar, handles most cases)
- Future: configurable override in `treesitter_languages.yaml`
- Document the decision and override mechanism

### Config Changes
- Add 5 entries to `config/treesitter_languages.yaml` with extensions, package, extractor path, enabled flag
- Add 5 packages to `requirements.txt`
- Update `source_extensions` in `structural_endpoints.py` to include `.h`, `.hpp`, `.cc`, `.cxx`, `.hxx`
- Update `Dockerfile` to pip install new grammar packages

### No Changes Required
- `LanguageExtractor` base class — interface unchanged
- `TreeSitterProvider` — config-driven routing already handles N languages
- `CallResolver` — language-agnostic, consumes `RawCallSite`
- `treesitter_config.py` — dynamic import already works for any extractor
- `treesitter_models.py` — `RawCallSite` model unchanged
- Store, pipeline, diagrams, serialisers — all language-agnostic

## Testing Requirements

Per project policy: every unit test MUST have a corresponding integration test on real data.

### Per-Language Fixture Files
- `tests/fixtures/sample_java.java` — classes, interfaces, imports, method calls, constructors, static calls, generics
- `tests/fixtures/sample_csharp.cs` — classes, namespaces, using directives, properties, constructors, LINQ
- `tests/fixtures/sample_c.c` + `tests/fixtures/sample_c.h` — functions, includes, struct usage, pointer calls
- `tests/fixtures/sample_rust.rs` — structs, impl blocks, use trees, macro calls, trait implementations
- `tests/fixtures/sample_cpp.cpp` + `tests/fixtures/sample_cpp.hpp` — classes, namespaces, templates, inheritance, operator overloading

### Integration Tests
- One integration test file per language: `tests/integration/test_<lang>_extractor.py`
- Each verifies: calls, imports, assignments, annotations, scope detection
- Cross-language mixed-directory test: extend existing `test_multi_language.py`
- Full regression: all existing 271 tests still pass

### Acceptance Criteria Per Extractor
1. Parses fixture file without errors
2. Extracts ≥90% of call sites from fixture (manual count as baseline)
3. All imports correctly parsed (module, names, relative flag)
4. Assignment type tracking works for constructor patterns
5. Enclosing scope correctly identified for all call sites
6. Performance: <50ms per file parse+extract
7. Graceful degradation: if grammar not installed, skip language with warning

## Performance Targets

| Operation | Target |
|-----------|--------|
| Parse + extract (single file, any language) | <50ms |
| Full analysis (100 files, any language) | <5s |
| Full analysis (500 files, mixed 8 languages) | <25s |
| Grammar loading (per language) | <100ms |

## Implementation Order

| Phase | Language | Rationale |
|-------|----------|-----------|
| 1 | Java | Largest enterprise ecosystem, AST similar to existing TypeScript extractor |
| 2 | C# | Very similar to Java — reuse patterns |
| 3 | C | Simpler language, fewer constructs |
| 4 | Rust | Growing ecosystem, nested `use` trees need care |
| 5 | C++ | Most complex — templates, namespaces, operator overloading |

Each phase is independently shippable and mergeable.

## Constraints

- Grammar packages use native C code — `build-essential` required (already in Dockerfile)
- Each extractor must be self-contained (no cross-extractor dependencies)
- `.h` files default to C; users can override in config
- Cross-language call resolution (JNI, FFI, etc.) is out of scope
- Preprocessor macro expansion (C/C++) is out of scope — extract what tree-sitter parses
- Template metaprogramming resolution (C++) is out of scope
- Framework-specific patterns (Spring DI, ASP.NET, Rust async) are out of scope

## Out of Scope

- Languages beyond ctags parity (Kotlin, Swift, Ruby, PHP, Lua, Scala)
- Cross-language call resolution
- Preprocessor macro expansion
- Template/generic instantiation resolution
- Framework-specific DI/routing patterns
- Language Server Protocol integration (separate spec)
