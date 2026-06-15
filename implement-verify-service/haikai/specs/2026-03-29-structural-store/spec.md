# Specification: Persistent Structural Store (File-Based)

## Summary

Persist ctags + LSP structural analysis as a grepable file tree. No database — just files and directories you can `grep`, `find`, `cat`, and feed to an LLM. The file structure mirrors the analyzed codebase, so navigating the store feels like navigating the project. Analysis runs once per repo+commit, writes everything to disk, and consumers (standards extraction, Q&A, diagrams) read files.

---

## Problem

Today, ctags/LSP output is computed in-flight and discarded. To ask questions about structure or generate diagrams, you'd re-analyze from scratch. We need persistent output that's:

- **Grepable** — `grep -r "extends BaseService"` should just work
- **Browsable** — directory structure mirrors the project
- **LLM-friendly** — files are plain text, sized for context windows
- **Tool-agnostic** — no database client, no special tooling, just a filesystem

---

## Store Layout

```
.specforge/
└── structural/
    └── {repo-name}/
        └── {commit-sha-short}/          # or "latest/" symlink
            ├── _meta.yaml                # snapshot metadata
            ├── _index.txt                # flat symbol index (one line per symbol, grepable)
            ├── _inheritance.txt          # all inheritance relationships (grepable)
            ├── _imports.txt              # all import relationships (grepable)
            ├── _calls.txt                # call graph (LSP tier, grepable)
            ├── _patterns.txt             # detected patterns (grepable)
            ├── _stats.txt                # aggregate statistics
            │
            ├── src/                      # mirrors project structure
            │   ├── api.py.struct          # per-file structural analysis
            │   ├── file_analyzer.py.struct
            │   ├── ast/
            │   │   ├── models.py.struct
            │   │   ├── provider.py.struct
            │   │   └── ctags_provider.py.struct
            │   └── chunking/
            │       ├── ast_chunker.py.struct
            │       └── chunker_factory.py.struct
            │
            └── diagrams/                 # generated diagram sources
                ├── class-diagram.mmd
                ├── inheritance-tree.mmd
                ├── dependency-graph.mmd
                └── component-diagram.mmd
```

### The `latest/` Symlink

After each analysis, update a `latest` symlink so consumers don't need to know the commit SHA:

```
.specforge/structural/{repo-name}/latest → ./{abc1234}/
```

`grep -r "factory" .specforge/structural/deepagent-bot/latest/` always hits the most recent analysis.

---

## File Formats

### `_meta.yaml` — Snapshot Metadata

```yaml
repo: deepagent-bot
remote: github.com/SpecForgeAI/deepagent-bot
commit: abc1234def5678
branch: main
analyzed_at: "2026-03-29T10:20:00Z"
provider: ctags           # or ctags+lsp
duration_ms: 120
file_count: 72
symbol_count: 2156
languages:
  - Python: 65
  - Java: 7
```

### `_index.txt` — Flat Symbol Index

One line per symbol. Designed for grep. Tab-separated for easy `cut`/`awk`.

```
# file<TAB>kind<TAB>name<TAB>scope<TAB>signature<TAB>line<TAB>flags
src/ast/models.py	class	SymbolKind	-	-	6	-
src/ast/models.py	class	SymbolInfo	-	-	28	-
src/ast/models.py	method	__post_init__	SymbolInfo	(self)	45	-
src/ast/provider.py	class	AnalysisProvider	-	-	12	abstract
src/ast/provider.py	class	ProviderRegistry	-	-	30	-
src/ast/provider.py	method	analyze_batch	ProviderRegistry	(self, file_paths: list[str])	45	-
src/ast/provider.py	method	is_provider_enabled	ProviderRegistry	(self, provider_name: str)	38	-
src/ast/ctags_provider.py	class	CtagsProvider	-	-	15	extends:AnalysisProvider
src/ast/ctags_provider.py	method	analyze_batch	CtagsProvider	(self, file_paths: list[str])	60	-
src/ast/ctags_provider.py	method	_map_tag	CtagsProvider	(self, tag: dict)	85	-
src/ast/ctags_provider.py	method	_parse_batch_output	CtagsProvider	(self, output: str, requested_paths: list[str])	105	-
app.py	function	create_app	-	()	25	-
app.py	function	health_check	-	()	45	async
```

**Grep examples:**
```bash
# All classes
grep "	class	" _index.txt

# All async functions/methods
grep "async" _index.txt

# Everything in file_analyzer.py
grep "^src/file_analyzer.py" _index.txt

# All methods on CtagsProvider
grep "	CtagsProvider	" _index.txt

# Anything extending AnalysisProvider
grep "extends:AnalysisProvider" _index.txt

# All factories
grep -i "factory" _index.txt
```

### `_inheritance.txt` — Inheritance Graph

```
# child<TAB>rel<TAB>parent<TAB>file
CtagsProvider	extends	AnalysisProvider	src/ast/ctags_provider.py
ASTChunker	extends	BaseChunker	src/chunking/ast_chunker.py
UserService	extends	BaseService	src/services/user.py
UserService	implements	Cacheable	src/services/user.py
PaymentHandler	extends	BaseHandler	src/handlers/payment.py
```

**Grep examples:**
```bash
# What extends BaseService?
grep "	BaseService" _inheritance.txt

# What does UserService extend?
grep "^UserService	" _inheritance.txt

# All abstract/interface implementations
grep "	implements	" _inheritance.txt
```

### `_imports.txt` — Import Graph

```
# file<TAB>imports<TAB>names
src/ast/ctags_provider.py	src.ast.models	StructuralAnalysis,SymbolInfo,SymbolKind,InheritanceInfo
src/ast/ctags_provider.py	src.ast.provider	AnalysisProvider
src/file_analyzer.py	src.ast.provider	ProviderRegistry
src/file_analyzer.py	src.ast.ctags_provider	CtagsProvider
src/file_analyzer.py	src.ast.formatter	format_structural_output
src/api.py	src.file_analyzer	FileAnalyzer
src/api.py	fastapi	FastAPI,APIRouter,HTTPException
```

**Grep examples:**
```bash
# What imports ProviderRegistry?
grep "ProviderRegistry" _imports.txt

# What does api.py depend on?
grep "^src/api.py" _imports.txt

# All files using fastapi
grep "	fastapi	" _imports.txt
```

### `_calls.txt` — Call Graph (LSP tier)

```
# caller_file<TAB>caller<TAB>callee_file<TAB>callee<TAB>line
src/file_analyzer.py	analyze_batch	src/ast/provider.py	ProviderRegistry.analyze_batch	120
src/file_analyzer.py	analyze_file	src/chunking/chunker_factory.py	ChunkerFactory.get_chunker	145
src/ast/ctags_provider.py	analyze_batch	-	subprocess.run	75
src/api.py	generate_standards	src/file_analyzer.py	FileAnalyzer.analyze_batch	88
```

### `_patterns.txt` — Detected Patterns

```
# pattern<TAB>confidence<TAB>symbol<TAB>file<TAB>evidence
repository	0.8	UserRepository	src/repos/user.py	CRUD methods: get, find, save, delete; extends BaseRepository
factory	0.8	HandlerFactory	src/handlers/factory.py	create_handler() returns BaseHandler subclasses
singleton	0.5	ConfigManager	src/config.py	_instance attribute + get_instance method
observer	0.8	EventBus	src/events/bus.py	subscribe, notify, on_event methods
```

### `_stats.txt` — Aggregate Statistics

```
Repository: deepagent-bot
Analyzed: 2026-03-29T10:20:00Z
Provider: ctags

Files: 72
Symbols: 2156

By Kind:
  class       45
  function    312
  method      1489
  variable    198
  constant    67
  interface   3
  decorator   12
  property    30

By Language:
  Python      65 files, 2003 symbols
  Java        7 files, 153 symbols

Inheritance Depth:
  max         4 (DeepHandler → BaseHandler → AbstractHandler → ABC)
  avg         1.8

Top-Level Classes: 45
  with methods: 38
  abstract: 5
  avg methods per class: 8.2

Async Methods: 89 (6% of all methods)

Design Patterns: 4 detected
  repository  2 instances (avg confidence 0.8)
  factory     1 instance (confidence 0.8)
  observer    1 instance (confidence 0.8)
```

### `{file}.struct` — Per-File Structural Analysis

One `.struct` file per source file, mirroring the project directory structure. Contains everything about that file in a human-readable, grepable format.

Example: `src/ast/ctags_provider.py.struct`

```
File: src/ast/ctags_provider.py
Language: Python
Provider: ctags
Symbols: 12

Imports:
  json
  logging
  os
  shutil
  subprocess
  src.ast.models (StructuralAnalysis, SymbolInfo, SymbolKind, InheritanceInfo)
  src.ast.provider (AnalysisProvider)

Symbols:
  class CtagsProvider extends AnalysisProvider [15-162]
    constant CTAGS_ARGS [22-28]
    constant CTAGS_KIND_MAP [33-57]
    property name [59-61]
    method is_available(self) -> bool [63-64]
    method analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis] [66-88]
    method _map_tag(self, tag: dict) -> Optional[SymbolInfo] [90-115]
    method _parse_batch_output(self, output: str, requested_paths: list[str]) -> dict[str, StructuralAnalysis] [117-162]

Inheritance:
  CtagsProvider → AnalysisProvider
```

---

## Directory Naming Convention

```
.specforge/structural/{repo-name}/{commit-sha-short}/
```

- **`repo-name`** — derived from git remote (e.g., `deepagent-bot`) or directory name for non-git projects
- **`commit-sha-short`** — first 7 chars of git HEAD SHA, or `nocommit-{timestamp}` for non-git
- **`latest/`** — symlink to most recent snapshot

For non-git projects:
```
.specforge/structural/my-project/nocommit-20260329T102000/
```

---

## Store Manager

New module: `src/ast/store.py`

```python
class FileStore:
    """File-based persistent store for structural analysis.
    
    Writes analysis results as plain text files in a directory tree
    that mirrors the analyzed project. Designed for grep, not SQL.
    """
    
    def __init__(self, base_path: str = ".specforge/structural"):
        pass
    
    def write_snapshot(self, repo_name: str, commit_sha: str,
                      branch: str, provider: str,
                      analyses: dict[str, StructuralAnalysis],
                      project_root: str) -> str:
        """Write a full analysis snapshot to disk.
        Creates directory structure, writes all files, updates latest symlink.
        Returns path to snapshot directory."""
    
    def get_latest_path(self, repo_name: str) -> str:
        """Return path to latest snapshot for a repo."""
    
    def list_snapshots(self, repo_name: str) -> list[dict]:
        """List all snapshots with metadata."""
    
    def write_index(self, path: str, analyses: dict[str, StructuralAnalysis]):
        """Write _index.txt — flat symbol index."""
    
    def write_inheritance(self, path: str, analyses: dict[str, StructuralAnalysis]):
        """Write _inheritance.txt — all inheritance relationships."""
    
    def write_imports(self, path: str, analyses: dict[str, StructuralAnalysis]):
        """Write _imports.txt — all import relationships."""
    
    def write_patterns(self, path: str, patterns: list):
        """Write _patterns.txt — detected design patterns."""
    
    def write_stats(self, path: str, analyses: dict[str, StructuralAnalysis], meta: dict):
        """Write _stats.txt — aggregate statistics."""
    
    def write_file_struct(self, snapshot_path: str, file_path: str,
                         analysis: StructuralAnalysis):
        """Write a single .struct file mirroring the project file."""
    
    def write_meta(self, path: str, meta: dict):
        """Write _meta.yaml — snapshot metadata."""
```

---

## Pipeline Integration

### Current Flow

```
file_analyzer.py → ProviderRegistry.analyze_batch() → StructuralAnalysis (in memory) → discard
```

### Proposed Flow

```
file_analyzer.py → ProviderRegistry.analyze_batch() → StructuralAnalysis (in memory)
                 → FileStore.write_snapshot()        → .specforge/structural/ (on disk)
                 → format for LLM prompt (unchanged)
```

Same minimal integration point as before — one call after `analyze_batch()`:

```python
if structural_results:
    store = FileStore()
    store.write_snapshot(
        repo_name=repo_name,
        commit_sha=git_head_sha,
        branch=git_branch,
        provider="ctags",
        analyses=structural_results,
        project_root=project_path,
    )
```

---

## Consumer 1: Codebase Q&A (LLM + grep)

Feed structural files directly into LLM context. The files are already sized and formatted for this.

**Workflow:**
1. User asks: "What classes handle authentication in this project?"
2. Quick grep: `grep -ri "auth" .specforge/structural/latest/_index.txt`
3. Pull relevant `.struct` files into LLM context
4. LLM answers with full structural context — no raw code parsing needed

**For an LLM agent with tool access:**
- Read `_index.txt` → understand the full symbol landscape
- Read `_inheritance.txt` → understand class hierarchies
- Read specific `.struct` files → deep dive into individual files
- Read `_stats.txt` → get the big picture
- All via file reads and greps — no special tooling

**Key insight:** The LLM doesn't need a query engine. It needs files it can read. The file store IS the query interface.

---

## Consumer 2: Diagram Generation

Read structural files, generate diagram source.

**Workflow:**
1. Read `_inheritance.txt` → generate Mermaid class diagram
2. Read `_imports.txt` → generate dependency graph
3. Read `_index.txt` + filter by directory → generate component diagram
4. Write to `diagrams/` subdirectory in the snapshot

The diagram generator reads plain text files and outputs Mermaid/PlantUML/DOT source. No database queries — just file I/O.

### Diagram Types

| Diagram | Input File(s) | Output |
|---------|--------------|--------|
| UML Class Diagram | `_index.txt` + `_inheritance.txt` | `diagrams/class-diagram.mmd` |
| Inheritance Tree | `_inheritance.txt` | `diagrams/inheritance-tree.mmd` |
| Dependency Graph | `_imports.txt` | `diagrams/dependency-graph.mmd` |
| Component Diagram | `_imports.txt` (grouped by dir) | `diagrams/component-diagram.mmd` |
| Sequence Diagram | `_calls.txt` (LSP tier) | `diagrams/sequence-{entry}.mmd` |
| Pattern Map | `_patterns.txt` + `_index.txt` | `diagrams/pattern-map.mmd` |

---

## Structural Diffs (File-Based)

When a new snapshot is created and a previous one exists, generate a `_diff.txt`:

```
.specforge/structural/{repo}/
├── abc1234/     # previous
├── def5678/     # current
│   ├── _diff.txt    # diff from abc1234 → def5678
│   └── ...
└── latest → ./def5678/
```

### `_diff.txt` Format

```
Diff: abc1234 → def5678
Date: 2026-03-29T10:20:00Z

Added Symbols:
  src/ast/store.py	class	FileStore	-
  src/ast/store.py	method	write_snapshot	FileStore
  src/ast/store.py	method	write_index	FileStore

Removed Symbols:
  src/legacy/old_handler.py	class	LegacyHandler	-

Modified Signatures:
  src/file_analyzer.py	method	analyze_batch	FileAnalyzer	+(store: FileStore = None)

Added Inheritance:
  FileStore → BaseStore

Removed Imports:
  src/api.py	no longer imports	src.legacy.old_handler

Summary:
  +3 symbols, -1 symbol, 1 signature change
  +1 inheritance, -1 import
```

Grepable. `grep "^  src/file_analyzer" _diff.txt` shows all changes in that file.

---

## Implementation Plan

### Phase 1: File Store + Writer

1. `src/ast/store.py` — FileStore with directory creation and file writing
2. Index writer (`_index.txt`)
3. Inheritance writer (`_inheritance.txt`)
4. Imports writer (`_imports.txt`)
5. Per-file `.struct` writer
6. Stats writer (`_stats.txt`)
7. Meta writer (`_meta.yaml`)
8. Latest symlink management
9. Wire into `file_analyzer.py`
10. Tests: write snapshot, verify file contents, grep validation

### Phase 2: Diagram Generation

1. `src/ast/diagram_generator.py`
2. Read `_inheritance.txt` → Mermaid class diagram
3. Read `_imports.txt` → Mermaid dependency graph
4. Read `_index.txt` + grouping → Mermaid component diagram
5. Write to `diagrams/` subdirectory
6. Tests: valid Mermaid syntax output

### Phase 3: Structural Diffs

1. Diff computation between two snapshot directories
2. `_diff.txt` writer
3. Auto-diff on new snapshot creation
4. Tests: known changes produce expected diff output

### Phase 4: Call Graph Files (requires LSP)

1. `_calls.txt` writer from LSP call graph data
2. Sequence diagram generation from `_calls.txt`

---

## Configuration

```yaml
# config/structural_store.yaml
store:
  enabled: true                          # AST_STORE_ENABLED env var
  path: ".specforge/structural"          # AST_STORE_PATH env var
  auto_snapshot: true                    # persist after every analysis run
  max_snapshots: 20                      # per repo, oldest pruned
  
  diagrams:
    auto_generate: true                  # generate diagrams on snapshot
    format: "mermaid"                    # mermaid, plantuml, dot
```

---

## Why Files Over Database

| Concern | Files | Database |
|---------|-------|----------|
| **Grep** | `grep -r "pattern" .specforge/` | Need SQL client or wrapper |
| **LLM consumption** | Read file directly into context | Need query → format → feed |
| **Browsing** | `ls`, `cat`, `tree` | Need tooling |
| **Version control** | Can commit to git if needed | Binary blob |
| **Portability** | Copy directory, done | Export/import |
| **Tooling required** | None | SQLite client |
| **Diff between snapshots** | `diff -r snapshot1/ snapshot2/` | Custom diff logic |

The tradeoff: no indexed queries, no joins. But with an LLM in the loop, you don't need indexes — you need readable files the LLM can process. And for humans, `grep` is faster than writing SQL.

---

## Relationship to Existing Specs

| Existing Spec | Relationship |
|--------------|-------------|
| **AST Code Analysis** | This spec adds persistence beneath the existing provider architecture |
| **Metamodel Validation** | Metamodel can read `.struct` files and `_index.txt` instead of re-analyzing |
| **RAG Embeddings** | `.struct` files are ideal embedding targets (one per source file, structured) |
| **Git History Analysis** | `_diff.txt` provides structural context alongside line-level git diffs |

---

## Out of Scope

- Database storage (by design — files only)
- Real-time incremental updates (full snapshot per commit)
- Cross-repo queries (grep across multiple repo directories manually)
- Custom file format parsers (output is plain text, consumers use grep + LLM)
- Interactive exploration UI (files are the UI)
