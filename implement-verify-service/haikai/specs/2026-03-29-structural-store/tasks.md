# Task Breakdown: Persistent Structural Store (File-Based)

## Overview
Total Tasks: 4 task groups, 20 sub-tasks

**Goal:** Persist ctags + LSP structural analysis as a grepable file tree under `.specforge/structural/`. No database — just files and directories. Analysis runs once per repo+commit, writes everything to disk, and consumers (standards extraction, Q&A, diagrams) read files.

**Key Design Principles:**
1. **Files over database.** All output is plain text — tab-separated index files and human-readable .struct files.
2. **Mirror the project.** Directory structure inside the snapshot mirrors the analyzed codebase.
3. **Grep is the query engine.** `grep -r "pattern" .specforge/structural/latest/` just works.
4. **LLM-friendly.** Files are sized for context windows — `.struct` files are compact per-file summaries.

**Reference Documents:**
- Spec: `spec.md`
- Requirements: `planning/requirements.md`

## Task List

### File Store Layer

#### Task Group 1: FileStore + Writers
**Dependencies:** Existing `src/ast/models.py`, `src/ast/provider.py`

- [x] 1.0 Complete FileStore implementation
  - [x] 1.1 Create `src/ast/store.py` — FileStore class
    - `__init__` with configurable base_path, max_snapshots, diagram auto-generation
    - `write_snapshot()` orchestrating all file writes
    - `get_latest_path()`, `list_snapshots()`
    - Git metadata extraction via `get_git_info()`
  - [x] 1.2 Implement index writers
    - `write_index()` — `_index.txt` tab-separated: file, kind, name, scope, signature, line, flags
    - `write_inheritance()` — `_inheritance.txt` tab-separated: child, rel, parent, file
    - `write_imports()` — `_imports.txt` tab-separated: file, module, names
    - `write_patterns()` — `_patterns.txt` with design pattern detection
    - `write_stats()` — `_stats.txt` aggregate statistics
    - `write_meta()` — `_meta.yaml` snapshot metadata
  - [x] 1.3 Implement per-file `.struct` writer
    - Mirrors project directory structure
    - Contains: file path, language, imports, symbol tree, inheritance
    - Human-readable format
  - [x] 1.4 Implement latest pointer management
    - `latest.txt` file (Windows-safe) + symlink where possible
  - [x] 1.5 Implement snapshot pruning
    - Configurable max_snapshots, oldest removed
  - [x] 1.6 Write tests: `tests/ast/test_store.py`
    - Snapshot creation, directory structure, file contents
    - Index format validation (tab-separated, correct field count)
    - Grepability tests (class, async, extends queries)
    - Latest pointer, pruning, pattern detection

**Acceptance Criteria:**
- All snapshot files created with correct format
- `_index.txt` grepable for classes, methods, async, extends
- `_inheritance.txt` grepable for parent/child relationships
- Per-file `.struct` files mirror project structure
- Latest pointer updated, snapshots pruned

---

### Diagram Generation

#### Task Group 2: DiagramGenerator
**Dependencies:** Task Group 1

- [x] 2.0 Complete diagram generation
  - [x] 2.1 Create `src/ast/diagram_generator.py`
    - Reads index files (NOT analysis models directly)
    - Generates Mermaid syntax
  - [x] 2.2 Implement diagram types
    - UML class diagram from `_index.txt` + `_inheritance.txt`
    - Inheritance tree from `_inheritance.txt`
    - Module dependency graph from `_imports.txt`
    - Component diagram from `_imports.txt` (grouped by directory)
    - Pattern map from `_patterns.txt` + `_index.txt`
  - [x] 2.3 Write tests: `tests/ast/test_diagram_generator.py`
    - Valid Mermaid syntax output
    - Correct diagram types generated
    - Class diagram shows methods, inheritance, visibility
    - Empty snapshot handling

**Acceptance Criteria:**
- All diagram types generated as `.mmd` files in `diagrams/` subdirectory
- Valid Mermaid syntax (classDiagram, graph TD, graph LR)
- Class diagrams include methods and inheritance relationships
- Graceful handling of empty data

---

### Structural Diffs

#### Task Group 3: StructuralDiff
**Dependencies:** Task Group 1

- [x] 3.0 Complete structural diff
  - [x] 3.1 Create `src/ast/structural_diff.py`
    - Compares `_index.txt` between snapshots
    - Compares `_inheritance.txt` between snapshots
    - Compares `_imports.txt` between snapshots
  - [x] 3.2 Implement `_diff.txt` writer
    - Added Symbols, Removed Symbols, Modified Signatures
    - Added/Removed Inheritance, Added/Removed Imports
    - Summary line
  - [x] 3.3 Auto-diff on new snapshot creation
  - [x] 3.4 Write tests: `tests/ast/test_structural_diff.py`
    - Added symbols, removed symbols, modified signatures
    - Inheritance changes, import changes
    - No-change scenario, file output, header validation

**Acceptance Criteria:**
- `_diff.txt` generated when previous snapshot exists
- All change types detected correctly
- Grepable format (tab-separated)
- Summary counts accurate

---

### Pipeline Integration

#### Task Group 4: Wire into file_analyzer.py + Config
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete pipeline integration
  - [x] 4.1 Modify `src/file_analyzer.py`
    - Import `FileStore`, `get_git_info`
    - Add `_init_file_store()` method with config loading
    - Add `FileStore.write_snapshot()` call in `analyze_batch()` after structural analysis
    - Zero impact when store disabled (`AST_STORE_ENABLED=false`)
  - [x] 4.2 Create `config/structural_store.yaml`
    - store.enabled, store.path, auto_snapshot, max_snapshots
    - diagrams.auto_generate, diagrams.format

**Acceptance Criteria:**
- Store integration in analyze_batch is one call after existing structural analysis
- Config file controls all store behavior
- Disabled store has zero performance impact
- Existing pipeline unchanged — store is additive

---

## Execution Order

1. **Task Group 1: FileStore + Writers** — core persistence layer
2. **Task Group 2: DiagramGenerator** — reads from store files
3. **Task Group 3: StructuralDiff** — reads from store files
4. **Task Group 4: Pipeline Integration** — wires store into existing flow

## Completion Criteria

Feature is complete when ALL of the following are true:
- All 4 task groups implemented with passing tests
- Snapshot creates correct directory structure mirroring project
- All index files (`_index.txt`, `_inheritance.txt`, `_imports.txt`, `_patterns.txt`, `_stats.txt`) grepable
- Per-file `.struct` files human-readable and LLM-consumable
- Mermaid diagrams generated automatically
- Structural diffs computed between consecutive snapshots
- Pipeline integration is additive — existing behavior unchanged
- Config file and env vars control all store behavior
