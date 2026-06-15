# Specification: Tree-sitter Call Graph Provider

## Summary

Replace the LSP-based call graph extraction with tree-sitter AST parsing + multi-stage call resolution. Tree-sitter parses each file in milliseconds, extracts all call expressions in a single walk, then resolves callee targets using a pipeline of: assignment tracking → type annotation harvesting → import following → ctags cross-reference. Output is `_calls.txt` with a confidence column.

---

## Problem

The LSP approach (now on `feature/lsp-call-graph-2026-03-29`) is wrong for full-repo analysis:

- **N requests per file** — cursor-position-based `prepareCallHierarchy` requires one request per function
- **Subprocess per language** — spawns a language server, 2-3s warmup, sequential queries
- **500 files × 20 functions = 10,000 JSON-RPC requests** — minutes, not seconds
- **Format differences per server** — pyright returns SymbolInformation, others return DocumentSymbol
- **Character offset hacks** — cursor must land on function name, not `def` keyword

Tree-sitter solves all of this: one parse per file, one walk for all calls, no subprocess, no server, same API for all languages.

---

## Design Principles

1. **Parse once, extract everything.** One tree-sitter parse per file gives the full AST. Walk it once to extract all call expressions, assignments, and type annotations.
2. **Resolution is a pipeline.** Multiple strategies attempted in order. First confident match wins. Unresolved calls still emitted with low confidence.
3. **Ctags is the symbol oracle.** Tree-sitter finds call sites, ctags knows where symbols are defined. They complement, not replace, each other.
4. **Confidence is earned.** Each resolution strategy has a base confidence. Multiple corroborating signals increase it. No hardcoded 0.8 — the score reflects what we actually know.
5. **Same output format.** `_calls.txt` stays tab-separated, adds optional confidence column. Existing consumers unaffected.

---

## Architecture

```
                    Source Files
                         │
                    tree-sitter parse
                         │
                    ┌────┴────┐
                    │  AST    │
                    └────┬────┘
                         │
                    CallExtractor
                    (walk AST, find all call_expression nodes)
                         │
              ┌──────────┴──────────┐
              │  Raw Call Sites     │
              │  receiver.method()  │
              │  function()         │
              │  Class()            │
              └──────────┬──────────┘
                         │
                    CallResolver (pipeline)
                         │
         ┌───────┬───────┼───────┬────────┐
         │       │       │       │        │
      Assign   Type    Import  Ctags   Convention
      Tracker  Annot   Follow  XRef    Heuristic
         │       │       │       │        │
         └───────┴───────┴───────┴────────┘
                         │
              ┌──────────┴──────────┐
              │  Resolved Calls     │
              │  with confidence    │
              └──────────┬──────────┘
                         │
                    _calls.txt
```

---

## Call Extraction (tree-sitter)

### What We Parse

For each source file, tree-sitter gives us the full syntax tree. We query for:

```python
# Python call_expression query
CALL_QUERY = """
(call
  function: [
    (attribute
      object: (_) @receiver
      attribute: (identifier) @method)
    (identifier) @function
  ]
) @call
"""
```

This captures:
- `self.db.query(user_id)` → receiver=`self.db`, method=`query`
- `standalone_function(x)` → function=`standalone_function`
- `Database()` → function=`Database` (constructor)
- `super().__init__()` → receiver=`super()`, method=`__init__`

### Enclosing Scope

For each call, we walk up the AST to find the enclosing function/method:

```python
def _find_enclosing_function(node) -> tuple[str, str]:
    """Walk up AST to find enclosing function_definition.
    Returns (qualified_name, file_path).
    """
    current = node.parent
    while current:
        if current.type == "function_definition":
            name = current.child_by_field_name("name").text
            # Check if inside a class
            parent = current.parent
            if parent and parent.type == "class_body":
                class_node = parent.parent
                class_name = class_node.child_by_field_name("name").text
                return f"{class_name}.{name}"
            return name
        current = current.parent
    return "<module>"
```

### Raw Call Site

```python
@dataclass
class RawCallSite:
    file_path: str
    caller_name: str          # e.g. "UserService.get_user"
    receiver: str | None      # e.g. "self.db" or None for bare calls
    method: str               # e.g. "query" or "standalone_function"
    line: int
    arguments: list[str]      # for future use (signature matching)
```

---

## Call Resolution Pipeline

Each resolver takes a `RawCallSite` and the full project context, and returns `(callee_file, callee_qualified_name, confidence)` or None.

### Stage 1: Assignment Tracker (confidence: 0.90-0.95)

For `self.X.method()`, find what `self.X` was assigned to:

```python
# In the same class __init__ or method body:
self.db = Database()           # → self.db is Database
self.logger = Logger("name")   # → self.logger is Logger
db = get_database()            # → local db, need return type (skip or low confidence)
```

**How:** Parse the class body with tree-sitter. Find assignments where LHS matches the receiver. Extract the RHS class name from constructor calls.

**Handles:**
- `self.x = ClassName()` → 0.95 confidence
- `self.x = ClassName.create()` → 0.85 confidence (factory, less certain)
- `x = ClassName()` in local scope → 0.90 confidence
- `self.x = some_function()` → cannot resolve, pass to next stage

### Stage 2: Type Annotation Harvesting (confidence: 0.90)

For typed code, the annotation tells us directly:

```python
class UserService:
    db: Database                          # class-level annotation
    def __init__(self, db: Database):     # parameter annotation
        self.logger: Logger = Logger()    # inline annotation
```

**How:** Query tree-sitter for `type` nodes on parameters, assignments, and class variables. Match against receiver prefix.

**Handles:**
- Parameter types: `def f(self, db: Database)` → `self.db` is `Database`
- Class variable annotations: `db: Database` in class body
- Return type annotations on factories: `def create() -> UserService`

### Stage 3: Import Following (confidence: 0.85)

Use `_imports.txt` (already generated by the store) to resolve bare function calls and class references:

```
# _imports.txt says:
src/service.py	src.db	Database
src/service.py	logging	getLogger
```

So `Database()` in `src/service.py` → `src/db.py:Database.__init__`
And `getLogger()` → external (callee_file = `-`)

**Handles:**
- Bare class constructors: `Database()` → resolve via import
- Imported functions: `getLogger("name")` → resolve via import
- Relative imports: `from .db import Database`

### Stage 4: Ctags Cross-Reference (confidence: 0.40-0.70)

When we know the method name but not the class, search ctags symbols:

```
# call site: self.db.query(user_id)
# Assignment tracker found nothing (db assigned dynamically)
# Search _index.txt for "query" methods:
#   Database.query in src/db.py        → 0.70 (only match)
#   Database.query + Cache.query       → 0.40 each (ambiguous)
```

**Confidence:**
- Single match: 0.70
- 2 matches: 0.40 each
- 3+ matches: 0.30 each
- Match in same directory as caller: +0.10 bonus

### Stage 5: Convention Heuristic (confidence: 0.30)

Last resort, name-similarity scoring:

- Receiver name `db` matches class `Database` (prefix match) → 0.30
- Receiver name `user_repo` matches class `UserRepository` (snake_case match) → 0.30
- Method called `save_user` and class `UserService` has `save_user` → 0.35

Only emitted if no other resolver matched. These are hints for the LLM, not assertions.

---

## Confidence Scoring

```
Final confidence = base_confidence + bonuses

Bonuses:
  +0.05  callee file in same package/directory as caller
  +0.05  method signature matches (arg count)
  +0.05  receiver name matches class name (snake_case → PascalCase)

Cap: 0.95 (never 1.0 — we're not a type checker)
```

---

## `_calls.txt` Format Update

```
# caller_file<TAB>caller<TAB>callee_file<TAB>callee<TAB>line<TAB>confidence
src/service.py	UserService.get_user	src/db.py	Database.query	25	0.95
src/service.py	UserService.get_user	src/log.py	Logger.info	24	0.90
src/api.py	process_batch	src/service.py	UserService.get_user	45	0.95
src/api.py	process_batch	-	print	50	0.40
```

Confidence column is appended (6th field). Existing consumers that split on tab and read 5 fields still work — the 6th is optional. `read_calls()` updated to parse it when present.

---

## Multi-Language Support

Tree-sitter grammars are per-language. Each language needs:
1. A tree-sitter grammar (`tree-sitter-python`, `tree-sitter-javascript`, etc.)
2. A call extraction query (language-specific syntax for call expressions)
3. An assignment pattern (how that language does `x = Foo()`)

### Supported Languages (Phase 1)

| Language | Grammar Package | Call Syntax | Assignment Pattern |
|----------|----------------|-------------|-------------------|
| Python | `tree-sitter-python` | `call(function/attribute)` | `self.x = Class()`, `x: Type` |
| TypeScript/JS | `tree-sitter-typescript` | `call_expression(function/member_expression)` | `this.x = new Class()`, `x: Type` |
| Go | `tree-sitter-go` | `call_expression(function/selector_expression)` | `x := NewClass()`, typed params |

### Phase 2 (future)

Java, Rust, C#, Ruby, PHP — same pattern, different grammar + query.

### Language Config

```yaml
# config/treesitter_languages.yaml
languages:
  python:
    grammar: tree-sitter-python
    extensions: [.py, .pyi]
    call_query: |
      (call
        function: [
          (attribute object: (_) @receiver attribute: (identifier) @method)
          (identifier) @function
        ]) @call
    assignment_patterns:
      - self_attr: "self.{name} = {class}()"
      - annotated: "{name}: {class}"
      - param: "def {func}(self, {name}: {class})"

  typescript:
    grammar: tree-sitter-typescript
    extensions: [.ts, .tsx, .js, .jsx]
    call_query: |
      (call_expression
        function: [
          (member_expression object: (_) @receiver property: (property_identifier) @method)
          (identifier) @function
        ]) @call
    assignment_patterns:
      - this_attr: "this.{name} = new {class}()"
      - typed: "{name}: {class}"
```

---

## Integration with Existing Pipeline

### Provider Registration

```python
# src/ast/treesitter_provider.py
class TreeSitterProvider(AnalysisProvider):
    """Call graph extraction via tree-sitter AST parsing."""

    @property
    def name(self) -> str:
        return "treesitter"

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Parse all files, extract calls, resolve targets."""
        # Phase 1: Parse all files, extract raw call sites
        raw_calls = self._extract_all_calls(file_paths)

        # Phase 2: Build resolution context
        context = ResolutionContext(
            index_path=self._index_path,       # _index.txt from ctags
            imports_path=self._imports_path,    # _imports.txt from store
            assignments=self._assignments,      # from tree-sitter parse
            annotations=self._annotations,      # from tree-sitter parse
        )

        # Phase 3: Resolve each call
        resolved = self._resolve_calls(raw_calls, context)

        # Phase 4: Build StructuralAnalysis per file
        return self._build_analyses(resolved, file_paths)
```

### Pipeline Order

```
file_analyzer.py:
  1. ctags provider  → symbols, inheritance, imports (baseline)
  2. FileStore.write_snapshot() → writes _index.txt, _imports.txt, etc.
  3. tree-sitter provider → reads _index.txt + _imports.txt, produces calls
  4. Merge results → calls added to existing analyses
  5. FileStore.write_calls() → writes _calls.txt with confidence
```

Tree-sitter runs **after** the store writes index files, because it needs `_index.txt` and `_imports.txt` for resolution stages 3-4. This is different from LSP which ran in parallel — tree-sitter is a consumer of ctags output.

---

## Performance

| Repo Size | Tree-sitter Parse | Resolution | Total |
|-----------|-------------------|------------|-------|
| 50 files | ~250ms | ~500ms | <1s |
| 500 files | ~2.5s | ~5s | <10s |
| 5000 files | ~25s | ~50s | <90s |

Compare LSP: 50 files = ~60s, 500 files = ~10min, 5000 files = impractical.

### Memory

Tree-sitter ASTs are lightweight (~100KB per file). For 5000 files, peak memory ~500MB. We parse one file at a time and extract calls, so only one AST in memory at once — effectively O(largest file).

---

## Dependencies

```
tree-sitter>=0.22.0       # Core parser runtime
tree-sitter-python        # Python grammar
tree-sitter-javascript    # JS/TS grammar (Phase 1)
tree-sitter-typescript    # TS grammar
```

All pure pip installs, no system dependencies, no node.js, no subprocess.

---

## Test Strategy

### Unit Tests: Call Extraction

```python
class TestPythonCallExtraction:
    def test_method_call(self):            # self.db.query() → receiver=self.db, method=query
    def test_bare_function(self):          # print("hello") → function=print
    def test_constructor(self):            # Database() → function=Database
    def test_chained_call(self):           # self.db.query().first() → two calls
    def test_nested_call(self):            # f(g(x)) → two calls
    def test_call_in_class_method(self):   # enclosing scope = Class.method
    def test_call_at_module_level(self):   # enclosing scope = <module>
    def test_super_call(self):             # super().__init__() → constructor
    def test_lambda_call(self):            # (lambda: x)() → skip or low confidence
```

### Unit Tests: Resolution Pipeline

```python
class TestAssignmentTracker:
    def test_self_attr_constructor(self):  # self.db = Database() → Database
    def test_local_var_constructor(self):  # db = Database() → Database
    def test_factory_call_unresolved(self): # db = get_db() → None (can't resolve)

class TestTypeAnnotation:
    def test_param_annotation(self):       # def f(self, db: Database) → Database
    def test_class_var_annotation(self):   # db: Database → Database
    def test_return_annotation(self):      # def f() -> Database → Database

class TestImportFollowing:
    def test_resolve_imported_class(self): # from src.db import Database → src/db.py
    def test_resolve_external(self):       # from logging import getLogger → callee_file="-"

class TestCtagsXref:
    def test_single_match(self):           # query → Database.query, confidence 0.70
    def test_ambiguous_match(self):        # query → Database.query + Cache.query, 0.40 each

class TestConventionHeuristic:
    def test_snake_to_pascal(self):        # db → Database, 0.30
```

### Integration Tests

```python
class TestTreeSitterProvider:
    def test_analyze_batch_produces_calls(self):     # real Python files → non-empty calls
    def test_resolution_uses_ctags_index(self):      # ctags symbols resolve ambiguous calls
    def test_confidence_above_threshold(self):       # no calls below 0.30
    def test_round_trip_calls_file(self):            # write → read → matches

class TestFullPipeline:
    def test_ctags_then_treesitter(self):            # ctags writes index, tree-sitter reads it
    def test_sequence_diagram_from_treesitter(self): # real calls → real sequence diagram
```

---

## Implementation Plan

### Phase 1: Python Call Extraction

1. `pip install tree-sitter tree-sitter-python`
2. Create `src/ast/treesitter_provider.py` — TreeSitterProvider + CallExtractor
3. Python call query + enclosing scope walker
4. RawCallSite extraction from AST
5. Tests: call extraction against fixtures

### Phase 2: Resolution Pipeline

6. AssignmentTracker — `self.x = Class()` resolution
7. TypeAnnotationHarvester — `x: Type` resolution
8. ImportFollower — `_imports.txt` cross-reference
9. CtagsXref — `_index.txt` symbol search
10. ConventionHeuristic — name similarity fallback
11. Confidence scoring with bonuses
12. Tests: each resolver + pipeline integration

### Phase 3: Pipeline Integration

13. Wire TreeSitterProvider into file_analyzer.py
14. Update `_calls.txt` format with confidence column
15. Update `read_calls()` to parse confidence
16. Config: `config/treesitter_languages.yaml`
17. Tests: full pipeline ctags → store → tree-sitter → calls → sequence diagram

### Phase 4: Additional Languages

18. TypeScript/JavaScript grammar + queries
19. Go grammar + queries
20. Language-specific assignment patterns
21. Tests per language

---

## Out of Scope

- Type inference beyond direct assignments and annotations (that's a type checker's job)
- Cross-file data flow (e.g. `x = get_db(); return x; ... y = get_result(); y.query()`)
- Dynamic dispatch resolution (e.g. `strategies[key].execute()`)
- Decorator-wrapped calls (e.g. `@retry` modifying call behavior)
- Async/await-specific call tracking (treated as regular calls)
- Call graph visualization beyond existing sequence diagrams
