# Requirements: Persistent Structural Store (File-Based)

## Feature Description

A file-based persistent store for structural analysis data (ctags + LSP output). All output is plain text files organized in a directory tree that mirrors the analyzed project. Designed for `grep`, `cat`, `find` — no database, no special tooling. Files are sized and formatted to be fed directly into LLM context for codebase Q&A. Enables three consumers from the same data: standards extraction, codebase Q&A, and diagram generation.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- Existing `src/ast/` module (models, ctags_provider, provider registry)
- Plain text files (tab-separated for index files, structured text for .struct files)
- YAML for metadata
- Mermaid.js syntax for diagram output (PlantUML and DOT as secondary formats)
- Git CLI for commit/branch/remote metadata extraction

## Requirements

### File Store Layer
- New module: `src/ast/store.py`
- Directory-based storage at configurable path (default: `{project_dir}/.specforge/structural/`)
- Directory structure: `{repo-name}/{commit-sha-short}/` per snapshot
- `latest/` symlink updated after each analysis
- Per-file `.struct` files mirroring project directory structure
- Cross-file index files prefixed with `_` at snapshot root
- All files plain text — grepable, readable, LLM-consumable
- Git metadata extraction: commit SHA, branch name, remote URL (graceful fallback for non-git dirs)
- Configurable via `config/structural_store.yaml` or env vars (`AST_STORE_ENABLED`, `AST_STORE_PATH`)
- Snapshot pruning: configurable `max_snapshots` per repo, oldest removed

### Index Files (snapshot-level, grepable)
- `_index.txt` — one line per symbol, tab-separated: file, kind, name, scope, signature, line, flags
- `_inheritance.txt` — one line per relationship: child, rel_type, parent, file
- `_imports.txt` — one line per import: file, module, imported_names
- `_calls.txt` — one line per call edge: caller_file, caller, callee_file, callee, line (LSP tier only)
- `_patterns.txt` — one line per pattern: type, confidence, symbol, file, evidence
- `_stats.txt` — human-readable aggregate statistics (counts by kind, language, inheritance depth, etc.)
- `_meta.yaml` — snapshot metadata (repo, commit, branch, timestamp, provider, counts)
- All index files have comment headers describing columns

### Per-File Structural Files
- One `.struct` file per analyzed source file (e.g., `src/api.py` → `src/api.py.struct`)
- Contains: file path, language, imports, symbol tree (with indentation for scope), inheritance
- Symbols show: kind, name, signature, line range, flags (async, abstract, extends)
- Human-readable format — can be `cat`ed or fed directly to an LLM

### Pipeline Integration
- Wire `FileStore.write_snapshot()` into `file_analyzer.py` after `ProviderRegistry.analyze_batch()`
- Zero impact when store is disabled (`AST_STORE_ENABLED=false` skips all persistence)
- Existing standards extraction pipeline unchanged — store is additive

### Diagram Generation
- New module: `src/ast/diagram_generator.py`
- Reads index files (`_inheritance.txt`, `_imports.txt`, `_index.txt`) — NOT the analysis models directly
- Generates Mermaid syntax as primary format
- Diagram types:
  - UML class diagrams (from `_index.txt` + `_inheritance.txt`)
  - Inheritance trees (from `_inheritance.txt`)
  - Module dependency graphs (from `_imports.txt`)
  - Component diagrams (from `_imports.txt` grouped by directory)
  - Sequence diagrams (from `_calls.txt` — requires LSP data)
  - Pattern maps (from `_patterns.txt` + `_index.txt`)
- Written to `diagrams/` subdirectory in snapshot
- Optional: auto-generate on snapshot creation (`auto_generate` config)

### Structural Diffs
- `_diff.txt` generated when new snapshot created and previous exists for same repo
- Sections: Added Symbols, Removed Symbols, Modified Signatures, Added/Removed Inheritance, Added/Removed Imports, Summary
- Grepable format — same tab-separated convention as index files
- Computed by comparing `_index.txt` and `_inheritance.txt` between snapshots

### Codebase Q&A Support
- No dedicated Q&A module needed — the file store IS the query interface
- LLM agents read `_index.txt` for overview, `.struct` files for detail, `_inheritance.txt` for hierarchy
- Files sized for LLM context windows (`.struct` files are compact per-file summaries)
- grep provides the "query engine" for humans and tool-using agents

## Performance Targets

| Operation | Target |
|-----------|--------|
| Write snapshot (500 files, 3000 symbols) | <500ms |
| Write `_index.txt` (3000 symbols) | <50ms |
| grep across `_index.txt` (3000 lines) | <10ms |
| Read single `.struct` file | <1ms |
| Diagram generation (50 classes) | <200ms |
| Diff computation (two snapshots) | <500ms |
| Snapshot disk size (1000-file repo) | ~1-5MB |

## Constraints

- No indexed queries — grep is the search mechanism (fast enough for our scale)
- No joins — cross-file relationships are in index files, not per-file `.struct` files
- Tab-separated format means symbol names/signatures with tabs would need escaping (rare in practice)
- Symlinks may not work on all Windows configurations (fallback: write path to a `latest.txt` file)
- Large repos (>10K files) may produce large `_index.txt` files (>10K lines) — still grepable

## Out of Scope

- Database storage (by design)
- Interactive query UI
- Cross-repo queries (grep across directories manually)
- Real-time incremental updates (full snapshot per commit)
- Custom file format parsers (plain text only, consumers use grep + LLM)
