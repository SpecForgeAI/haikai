# Specification: Refactoring Impact

## Summary

Build refactoring-aware tools on top of the existing dependency graph (`<snapshot>/_depgraph.sqlite`, Spec 1). Three engines:

1. **Change detection** — `git diff` (staged/unstaged/commit-range) → list of impacted symbols → blast radius via `dep.impact`.
2. **Multi-file rename** — graph-driven find-all-references (precise) plus a text-search safety net (catches strings/comments). Always dry-run by default; explicit `--apply` to write.
3. **Staleness tracking** — compare snapshot's commit SHA to current `git HEAD`; warn when the dep-graph is out of date relative to the working tree.

Strictly downstream of Spec 1. No changes to AST extraction, playbooks, or the dep-graph schema.

## Core Principle

> **Graph = relational projection of AST. Refactoring = graph + git diff.**

The dep-graph already encodes everything we need to answer "if I rename / change / delete symbol X, what else moves?". This spec adds the git layer that turns that capability into a workflow tool.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│   Existing pipeline → snapshot/_depgraph.sqlite (Spec 1)         │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                 src/refactoring/  (this spec)                    │
│                                                                  │
│   git_repo.py          — subprocess wrapper around git           │
│   change_detector.py   — git diff → impacted symbols → impact    │
│   rename_engine.py     — graph + text-search → preview / apply   │
│   staleness.py         — snapshot SHA vs HEAD comparison         │
│                                                                  │
│   Surfaces:                                                      │
│     - Haikai skills (3) — /detect-changes, /rename-symbol,     │
│                              /check-staleness                    │
│     - REST endpoints (4)  — /api/refactor/{detect,rename-preview,│
│                              rename-apply,staleness}             │
│     - Python API          — direct import for tests/scripts      │
└──────────────────────────────────────────────────────────────────┘
```

## Data — what's read, what's persisted

**Read-only inputs:**
- `<snapshot>/_depgraph.sqlite` (Spec 1)
- `git` working tree at `<repo_root>` — diff, blame, rev-parse via subprocess

**Persisted outputs:**
- **None on disk by default.** Engines return structured Python objects.
- Optional: `<snapshot>/_refactoring_log.jsonl` appended on every `--apply` (audit trail of mutations).

The rename engine **does** mutate source files when `--apply` is set — that's the only write path in this spec, gated behind explicit opt-in.

## Engines

### `change_detector.py` — git diff → impact

> "If I commit what's currently staged, what else might break?"

- Inputs: `repo_root`, `scope` ∈ {`staged`, `unstaged`, `all`, `commit:<sha>`}, `depgraph`
- Steps:
  1. `git diff --unified=0 <scope>` → `[FileDiff{path, hunks[{old_start, new_start, lines[]}], status}]`
  2. For each hunk line `L` in file `F`, map to the **enclosing symbol** via the *nearest-preceding-symbol* heuristic:
     `SELECT * FROM symbols WHERE file = F AND line <= L ORDER BY line DESC LIMIT 1`.
     This works because the dep-graph schema records only `line` (definition site), not `end_line` — see decision in `planning/decisions.md`. Limitation: edits to module-level whitespace between symbols attribute to the preceding symbol; acceptable (small over-attribution, no under-attribution).
  3. Special cases:
     - **Added file**: no impact (new symbols don't exist in the graph yet); list new file, return.
     - **Deleted file**: impact is the union of every symbol that was in `<file>` per the snapshot; treat each as if it were edited.
     - **Renamed file** (`status='renamed'`): treat hunks as if applied to the *new* path; the old path's symbols are also flagged as "moved" (not deleted).
  4. For each impacted symbol, call `impact_of(depgraph, symbol)` (Spec 1's `impact.py`).
  5. Aggregate: union of affected callers + endpoints. **Risk score is a placeholder** (`len(callers) + 5*len(endpoints)` → low<10, medium<50, high≥50); will be tuned with real-world data, exposed via `risk.score` and `risk.level` so callers can ignore the level if they prefer the raw score.
- Output: `ChangeImpactReport(scope, files[], impacted_symbols[], affected_callers[], affected_endpoints[], risk: {score: int, level: low|medium|high})`

### `rename_engine.py` — graph-aware multi-file rename

> "Rename symbol X to Y everywhere that's actually a reference to X."

- Inputs: `repo_root`, `depgraph`, `old_qname` (qualified name, see "Naming convention" below), `new_name` (bare name — the new identifier), `apply: bool = False`, `kind: str | None = None` (override symbol kind for filtering; usually inferred)
- **Naming convention (load-bearing):**
  - `old_qname` MUST be a fully qualified name as stored in `symbols.qualified_name` (e.g. `pkg.module.Class.method`). Bare names (`User`) are accepted only when they resolve uniquely across the entire `symbols` table; otherwise the engine returns a 1-line "ambiguous, please qualify" plan listing all matches.
  - `new_name` is always bare (just the new identifier). The engine writes it in place wherever the bare-name part of `old_qname` appears as a real reference.
- Steps:
  1. **Resolve `old_qname` to one symbol row** (`SELECT * FROM symbols WHERE qualified_name = ?`). If 0 rows: error. If `old_qname` was bare and matches >1 row: return ambiguity report.
  2. Bind `kind` from the resolved row (or use the `kind` override).
  3. **Graph references** (precise, kind-filtered):
     - **Calls**: `calls WHERE callee_symbol_id == old.id` (when `kind` is method/function), OR `calls WHERE callee_qualified_name == old.qualified_name` (text fallback for unresolved callees).
     - **Inheritance**: `inheritance WHERE parent_symbol_id == old.id` (when `kind == class`).
     - **Imports**: `imports WHERE imported_name == old.name AND package == old.module_path` — these are import-statement references that need updating too. Without this step, every `from foo import OldName` line gets stale.
  4. **Text references** (safety net): `git grep -nE "\\b<bare_old_name>\\b" -- <ext-glob-for-old.language>` → file:line:line-text. Restricting to the symbol's language by default; `--all-languages` flag opens this up (e.g. for Java app with cross-lang config files).
  5. **Partition** the union of references into `{graph_only, text_only, both}`. Each partition is presented to the user; the engine doesn't auto-merge (a `text_only` ref might be in a string literal that should NOT be renamed).
  6. **Build patch list** for the `both` partition by default (`--include-text-only` to also patch text-only refs). Each patch: `(file, line, before_text, after_text)`. The text replacement is a precise word-boundary replacement, not a regex on whole line.
  7. Dry-run: return plan unapplied. Apply: see safety rules in Phase 8 (atomic write, dirty-tree refusal, audit log).
- Output: `RenamePlan(old: SymbolRow, new_name: str, kind: str, graph_refs[], import_refs[], text_refs[], partitions: {graph_only, text_only, both}, patches[], applied: bool, ambiguous: bool, ambiguity_candidates[])`
- **Always dry-run unless `apply=True`.**

### `staleness.py` — snapshot vs working tree

> "Is this snapshot still trustworthy?"

- Inputs: `snapshot_path`, `repo_root`
- Steps:
  1. Read snapshot's commit SHA from `<snapshot>/_meta.json` (or sibling)
  2. `git rev-parse HEAD` and `git status --porcelain` for working-tree state
  3. Compare: stale if `head != snapshot.sha` OR working tree dirty OR snapshot file mtimes older than any source file
- Output: `StalenessReport(snapshot_sha, head_sha, working_tree_dirty, modified_files_since[], age_seconds, level: fresh|stale|outdated)`

## Surfaces

### Haikai skills (3)

| Skill | Behaviour |
|---|---|
| `/detect-changes [--scope staged\|unstaged\|all\|commit:<sha>]` | Runs `change_detector`. Without LLM: structured report. With LLM: 1-paragraph risk summary + suggested test scope. |
| `/rename-symbol <old> <new> [--apply]` | Runs `rename_engine`. Always shows preview first. `--apply` writes changes. LLM optional for naming conflict review. |
| `/check-staleness` | Runs `staleness`. With LLM: tells the user whether they need to re-run the AST pipeline. |

### REST endpoints (4)

Mounted under `/api/refactor/`. All accept `?snapshot=<repo>/<sha>`.

| Endpoint | Method | Body / Query |
|---|---|---|
| `/api/refactor/detect` | GET | `scope`, `commit?` |
| `/api/refactor/rename-preview` | GET | `old_name`, `new_name` |
| `/api/refactor/rename-apply` | POST | `{old_name, new_name, confirm: true}` (`confirm` required, no default) |
| `/api/refactor/staleness` | GET | (snapshot path only) |

### Python API

`src/refactoring/__init__.py` re-exports:

```python
from src.refactoring import (
    detect_changes,
    rename_preview,
    rename_apply,
    check_staleness,
    RenamePlan,
    ChangeImpactReport,
    StalenessReport,
)

report = detect_changes(repo_root, depgraph, scope="staged")
plan = rename_preview(repo_root, depgraph, "OldName", "NewName")
if plan.safe:
    rename_apply(repo_root, depgraph, plan)
```

## Constraints (non-negotiable)

1. **No changes to AST extraction or dep-graph schema.** Both are read-only inputs.
2. **No file mutations without explicit opt-in.** `apply=False` is the default everywhere; REST `rename-apply` requires `confirm: true` in the body.
3. **No new external dependencies.** Stdlib `subprocess` for git, existing `sqlite3` + `networkx`. No GitPython, no pygit2.
4. **Snapshot/SHA pairing is the unit of analysis.** All operations bind to one snapshot at a time. Cross-snapshot diffs deferred to Spec 3.
5. **Audit trail on every apply.** `_refactoring_log.jsonl` records `{timestamp, op, old_qname, new_name, kind, files_changed[], sha_before, sha_after?, triggered_by: skill|rest|python_api, tool_version}`. Replay-safe.
6. **Text-search safety net stays.** Graph-only rename misses comments, string literals, doc references. We always cross-check with `git grep` and surface the partition diff (`graph_only` / `text_only` / `both`) — never auto-merge.
7. **Qualified names are the ground truth.** Every reference to a symbol in this spec uses the dep-graph's `qualified_name` form. Bare names are a UX convenience that resolves to qualified-or-error.
8. **Atomic apply.** Patches are written to temp files in the same directory, then `os.replace()` to commit (cross-platform; on Windows preserves `os.replace`'s atomic semantics on the same volume). If any patch fails to write, abort all (no partial application).

## Outputs of this spec

| Artifact | Lives in | Status |
|---|---|---|
| Git wrapper | `src/refactoring/git_repo.py` | new |
| Change detector | `src/refactoring/change_detector.py` | new |
| Rename engine | `src/refactoring/rename_engine.py` | new |
| Staleness tracker | `src/refactoring/staleness.py` | new |
| Public API | `src/refactoring/__init__.py` | new |
| Skills | `haikai-profiles/default/commands/{detect-changes, rename-symbol, check-staleness}/` | new |
| REST endpoints | `src/api/refactor_routes.py` (mounted in main app) | new |
| Audit log format | `<snapshot>/_refactoring_log.jsonl` (append-only) | new (created on first apply) |

## Out of scope

- **Cross-repo / cross-snapshot rename** — Spec 3 territory.
- **Automatic conflict resolution during apply** — if patch fails, abort and report; we don't try to merge.
- **Refactoring beyond rename** — extract method, move class, change signature. Future work.
- **PostgreSQL / Redis registries** — Spec 3.
- **CI integration / pre-commit hook auto-install** — separate concern; this spec just provides the engine.

## Success criteria

1. **Change detection on petclinic**: editing `OwnerController.list` → `change_detector` reports the 1 endpoint affected (matches Spec 1's blast-radius fixture).
2. **Rename precision**: `rename_preview("OwnerController", "OwnerCtrl")` on petclinic finds all class references in graph + matches git-grep text count within ±2 (allowing for comments/docstrings the graph doesn't track).
3. **Staleness honesty**: when working tree has 1 modified file not in the snapshot, `check_staleness` returns `stale` with that file in `modified_files_since`.
4. **No accidental writes**: full test suite runs zero file mutations. Only `apply=True` paths write — verified by snapshot of repo before/after suite.
5. **Audit completeness**: every `--apply` invocation produces exactly one `_refactoring_log.jsonl` line that round-trips back to the same patch on replay.
6. **No regression**: V2 50-repo benchmark + Spec 1 dep-graph builds unchanged.
