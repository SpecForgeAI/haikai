# Tasks: Tree-sitter Language Expansion

## Phase 1 — Java ✅

- [x] Install `tree-sitter-java` in requirements.txt and Dockerfile
- [x] Create `src/ast/extractors/java.py` implementing `LanguageExtractor`
  - [x] `extract_calls` — `method_invocation`, `object_creation_expression`, static calls
  - [x] `extract_imports` — `import_declaration` (single + wildcard)
  - [x] `extract_assignments` — `local_variable_declaration`, `field_declaration`
  - [x] `extract_annotations` — type identifiers, generics (base type only)
  - [x] `_find_enclosing_scope` — method → class/interface/enum chain
- [x] Add Java entry to `config/treesitter_languages.yaml`
- [x] Create `tests/fixtures/sample_java.java`
- [x] Create `tests/ast/test_java_extraction.py` — 12 integration tests
- [x] Run full test suite — verify no regression ✅

## Phase 2 — C# ✅

- [x] Install `tree-sitter-c-sharp` in requirements.txt and Dockerfile
- [x] Create `src/ast/extractors/csharp.py` implementing `LanguageExtractor`
  - [x] `extract_calls` — `invocation_expression`, `object_creation_expression`
  - [x] `extract_imports` — `using_directive` (namespace + static)
  - [x] `extract_assignments` — `variable_declaration` (incl. `var` inference), `assignment_expression`
  - [x] `extract_annotations` — explicit types, nullable handling
  - [x] `_find_enclosing_scope` — method → class/struct/interface, with namespace prefix
- [x] Add C# entry to `config/treesitter_languages.yaml`
- [x] Create `tests/fixtures/sample_csharp.cs`
- [x] Create `tests/ast/test_csharp_extraction.py` — 13 integration tests
- [x] Run full test suite — verify no regression ✅

## Phase 3 — C ✅

- [x] Install `tree-sitter-c` in requirements.txt and Dockerfile
- [x] Create `src/ast/extractors/c.py` implementing `LanguageExtractor`
  - [x] `extract_calls` — `call_expression`, pointer calls (`->`, `(*fptr)()`)
  - [x] `extract_imports` — `preproc_include` with recursive walk for `#ifdef` guards (system vs local → `is_relative` flag)
  - [x] `extract_assignments` — `declaration` with `init_declarator`, `assignment_expression`
  - [x] `extract_annotations` — type specifiers in parameters and declarations
  - [x] `_find_enclosing_scope` — `function_definition` (no classes in C)
- [x] Add C entry to `config/treesitter_languages.yaml` (`.c`, `.h`)
- [x] Create `tests/fixtures/sample_c.c` + `tests/fixtures/sample_c.h`
- [x] Create `tests/ast/test_c_extraction.py` — 13 integration tests
- [x] Document `.h` ambiguity decision (default → C extractor)
- [x] Update `source_extensions` in `structural_endpoints.py` to include `.h`
- [x] Run full test suite — verify no regression ✅

## Phase 4 — Rust ✅

- [x] Install `tree-sitter-rust` in requirements.txt and Dockerfile
- [x] Create `src/ast/extractors/rust.py` implementing `LanguageExtractor`
  - [x] `extract_calls` — `call_expression`, `method_call_expression` (field_expression), `macro_invocation`
  - [x] `extract_imports` — `use_declaration` (including nested `use` trees, `self`, aliases)
  - [x] `extract_assignments` — `let_declaration`, `assignment_expression`, type inference from `Type::new()`
  - [x] `extract_annotations` — types in let bindings, params, return types
  - [x] `_find_enclosing_scope` — `function_item` inside `impl_item` → `Type::method`
- [x] Add Rust entry to `config/treesitter_languages.yaml`
- [x] Create `tests/fixtures/sample_rust.rs`
- [x] Create `tests/ast/test_rust_extraction.py` — 14 integration tests
- [x] Run full test suite — verify no regression ✅

## Phase 5 — C++ ✅

- [x] Install `tree-sitter-cpp` in requirements.txt and Dockerfile
- [x] Create `src/ast/extractors/cpp.py` implementing `LanguageExtractor`
  - [x] `extract_calls` — `call_expression`, `new_expression`, qualified calls (`Namespace::Class::method()`)
  - [x] `extract_imports` — `preproc_include` with recursive walk for `#ifdef` guards
  - [x] `extract_assignments` — `declaration`, `init_declarator`, `auto` type
  - [x] `extract_annotations` — type specifiers, template args (base type only)
  - [x] `_find_enclosing_scope` — qualified declarators (`Foo::bar`), class/namespace chain
  - [x] Handle template functions (`make_shared<Foo>()`)
- [x] Add C++ entry to `config/treesitter_languages.yaml` (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`)
- [x] Create `tests/fixtures/sample_cpp.cpp` + `tests/fixtures/sample_cpp.hpp`
- [x] Create `tests/ast/test_cpp_extraction.py` — 14 integration tests
- [x] Update `source_extensions` in `structural_endpoints.py` to include `.cc`, `.cxx`, `.hpp`, `.hxx`
- [x] Run full test suite — verify no regression ✅

## Cross-cutting ✅

- [x] Update existing tests for new language support (`.rs`/`.java`/`.c` → `.rb`/`.swift`/`.kt` for unsupported tests)
- [x] Verify config loader picks up all 8 extractors across 17 extensions
- [x] Run test coverage skill — report generated at `TEST-COVERAGE.md`
- [x] Update docs: CHANGELOG, ARCHITECTURE, README with new language support
- [x] Verify Docker build with all 8 grammar packages (all grammars import + resolve correctly)
- [ ] Performance test: 500 mixed-language files < 25s

## Verification Results

| Phase | Extractor | Tests | Status |
|-------|-----------|-------|--------|
| 1 | Java | 12 | ✅ All passing |
| 2 | C# | 13 | ✅ All passing |
| 3 | C | 13 | ✅ All passing |
| 4 | Rust | 14 | ✅ All passing |
| 5 | C++ | 14 | ✅ All passing |
| — | Full AST suite | 337 | ✅ Zero regressions |
| — | Full repo suite | 763 | ✅ (same pre-existing failures as main) |

## Test Coverage Skill Output

| Category | Tests | % |
|----------|------:|--:|
| Integration tests (real data) | 312 | 40.9% |
| Unit tests covered by integration | 225 | 29.5% |
| Resilience scenarios (functional) | 13 | 1.7% |
| Unit tests (synthetic only) | 212 | 27.8% |
| **Total** | **763** | **100%** |

**Real-data backing: 550 / 763 (72.1%)**
