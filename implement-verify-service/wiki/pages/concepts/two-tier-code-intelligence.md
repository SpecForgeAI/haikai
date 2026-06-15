# Two-tier code intelligence

Why the AST layer uses **both** ctags and tree-sitter, not one or the other.

## The two tiers

| Tier | Tool | Output | Strength | Weakness |
|---|---|---|---|---|
| Symbol | Universal Ctags | Functions, classes, methods, signatures | Fast, 100+ languages | No call edges, no import structure |
| AST | tree-sitter | Calls, imports, assignments, annotations | Precise, framework-agnostic | One grammar per language; we currently support 8 |

Both feed into the same merged `StructuralAnalysis` object via `src/ast/provider.py` (`ProviderRegistry`).

## Why both

ctags is cheap and broad. Tree-sitter is precise and AST-aware. They answer different questions:

- "What functions/classes exist in this 100,000-file Java repo?" → **ctags** wins. Sub-minute scan.
- "What does `OrderService.placeOrder` call?" → **tree-sitter** wins. ctags can't see call edges.
- "What annotations decorate this method?" → **tree-sitter** wins. ctags doesn't model annotations.
- "What are the symbols in this Ruby file?" → **ctags** wins. We don't have a tree-sitter Ruby extractor.

The merged store ([[structural-store]]) carries both and lets downstream consumers pick.

## Coverage matrix

ctags supports any language ctags has a parser for (~100). Tree-sitter coverage in this project is currently 8 languages × 17 extensions:

| Language | Extensions | Extractor |
|---|---|---|
| Python | `.py`, `.pyi` | `extractors/python.py` |
| TypeScript/JS | `.js`, `.jsx`, `.ts`, `.tsx` | `extractors/typescript.py` |
| Go | `.go` | `extractors/go.py` |
| Java | `.java` | `extractors/java.py` |
| C# | `.cs` | `extractors/csharp.py` |
| C | `.c`, `.h` | `extractors/c.py` |
| Rust | `.rs` | `extractors/rust.py` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` | `extractors/cpp.py` |

Each extractor implements `LanguageExtractor` with 4 methods: `extract_calls`, `extract_imports`, `extract_assignments`, `extract_annotations`. Adding a language = YAML config entry in `config/treesitter_languages.yaml` + extractor class.

## Why not one or the other

Drop ctags → lose 90+ languages we don't have tree-sitter extractors for. Files in those languages would still be analyzed for symbols, just not for call edges.

Drop tree-sitter → lose call edges, lose annotations, lose any chance of [[agentic-discovery]] (it depends on `_calls.txt`).

Both layers are load-bearing.

## Sources

- `src/ast/ctags_provider.py`, `src/ast/treesitter_provider.py`, `src/ast/provider.py`
- `src/ast/extractors/`
- `docs/ARCHITECTURE.md` § "Structural Analysis Pipeline"
- [[../../raw/2026-05-04_codebase-walk]]
