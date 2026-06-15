# Refactoring engines

**Module:** `src/refactoring/`
**Spec:** [[../../../haikai/specs/2026-04-27-refactoring-impact]]
**Shipped:** 2026-05-01 (commit 3f6ad2f)

## What it is

A trio of engines that sit on top of V2's dep-graph and turn it from a passive query target into an active tool for code change:

| Engine | File | Question it answers |
|---|---|---|
| `change_detector` | `src/refactoring/change_detector.py` | "What does this `git diff <ref1>..<ref2>` impact — which symbols, files, routes?" |
| `rename_engine` | `src/refactoring/rename_engine.py` | "Rename symbol X to Y everywhere — what would change, and can I do it safely?" |
| `staleness` | `src/refactoring/staleness.py` | "Is this dep-graph snapshot still consistent with HEAD, or has the code drifted?" |

Plus `git_repo.py` as a shared git interface.

## Design choices that matter

- **Dry-run by default.** Every operation that *could* mutate files first reports what it would do; `--apply` (or `apply=True`) is required to act.
- **Refuses on dirty working tree.** No mutation operation runs against uncommitted changes — the user is forced to commit or stash first. Prevents the "ate my unsaved work" failure mode.
- **Audit log.** Every applied operation writes a JSON record (target paths, old/new values, timestamp, dep-graph SHA at time of run). Replayable for forensics.
- **Graph-aware + text-search.** Rename uses the dep-graph to find structural references (call sites, import statements) and follows up with a targeted text search for stragglers (string literals containing the symbol name, etc.). Each result is annotated with confidence.
- **Staleness uses commit_sha when available.** If the dep-graph snapshot was built after [[depgraph-commit-sha]] shipped, staleness compares git's tree against the snapshot's pinned SHA. Otherwise it falls back to file mtimes — less precise but always works.

## Surface area

| Surface | Where |
|---|---|
| Python API | `from src.refactoring import ...` (re-exported in `__init__.py`) |
| REST endpoints | `src/api/refactor_routes.py` — 4 routes registered in `src/api.py` |
| Skills | `haikai-profiles/default/commands/{check-staleness,detect-changes,rename-symbol}/` |
| Documentation | `docs/refactoring-guide.md` |
| Tests | `tests/test_refactoring_*.py` (6 files, ~1,000 LOC) |

## What this unlocks downstream

- **api_impact** (spec [[../../../haikai/specs/2026-04-28-api-impact-routes]]) becomes implementable: change_detector + the OpenAPI route map + the dep-graph means we can answer "what API consumers does this PR break?"
- **route_map** has the impact half built; the route abstraction half is still pending.
- **Cross-repo groups** (spec #90) gets a building block: rename across a group of repos becomes "run rename_engine in each member with shared symbol context".

## Distinguishing from existing tools

- **Not an IDE refactor.** IntelliJ/PyCharm rename in-process at edit time. This operates on a snapshot of the graph, supports cross-repo workflows, and runs server-side with audit.
- **Not jscodeshift / codemods.** Codemods are AST-transform scripts you write per-refactor. This is a generic engine over the dep-graph; the user describes intent (`rename X to Y`), not the AST surgery.
- **Not LSP rename.** LSP rename requires a language server per language. Our engine works wherever V2's structural store has data, which is broader.

## Open questions

- How does rename behave when the same name resolves to multiple symbols across files? (Disambiguation prompt? Refuse? Apply to all matching scope?)
- What's the right granularity for `change_detector` output — symbol-level, file-level, or route-level? Currently emits all three.

## Sources

- [[../../raw/2026-05-01_commit-batch]]
- [[../../../haikai/specs/2026-04-27-refactoring-impact/spec]]
- [[depgraph-commit-sha]]
