# Planning Decisions

## Context

The original GitNexus-inspired blueprint at `specs/dependency-analysis/spec-2-refactoring-impact-analysis.md` (1,708 lines) covers refactoring tooling but bundles enterprise scaffolding — pre-commit hook auto-installation, conflict-resolution heuristics, and CI integration patterns — that pull more weight than the actual core (git diff → impact, multi-file rename, staleness check).

This Haikai spec extracts the **dependency-graph-driven refactoring subset** of that blueprint and reframes it to fit how this repo actually works:

- Builds strictly on Spec 1's `<snapshot>/_depgraph.sqlite` (no parallel symbol index).
- Uses subprocess `git` (no GitPython / pygit2 dependency).
- Defers enterprise pieces (PostgreSQL registries, multi-repo joins) to Spec 3.
- Treats file mutation as a separate, opt-in concern with audit trail.

## In scope

- **Git diff → impacted symbols → blast radius** (`change_detector.py`)
- **Graph-aware multi-file rename with text-search safety net** (`rename_engine.py`)
- **Snapshot vs working-tree staleness comparison** (`staleness.py`)
- 3 Haikai skills + 4 REST endpoints + Python API
- Append-only audit log on apply

## Out of scope (deferred or intentionally dropped)

| Dropped | Why | Where it goes |
|---|---|---|
| Pre-commit hook auto-install | High blast radius (modifies user's git config); per-user concern | User installs manually; we provide the engine only |
| Auto-conflict resolution during apply | Subtle, error-prone, encourages risky patterns | If a patch fails, abort + report. User resolves. |
| Cross-repo / cross-snapshot rename | Requires multi-snapshot orchestration | Spec 3 (enterprise) |
| Refactorings beyond rename (extract method, move class) | Each is its own spec; rename is the highest-value, lowest-risk start | Future spec |
| Heavy git library (GitPython, pygit2) | Subprocess `git` covers everything we need; one less dependency | N/A |
| Pre-commit CI integration patterns | Out of band of the analysis tool itself | Separate ops/CI spec |

## Architectural decisions

### Decision: nearest-preceding-symbol heuristic for hunk → symbol mapping (no `end_line` schema change)

**Why:** A `git diff --unified=0` hunk gives line ranges in the new file. To attribute a hunk to a symbol, we need to know which symbol's body contains that line. The dep-graph schema records only `line` (definition site), not `end_line` or `span`. Naive `WHERE line BETWEEN ? AND ?` only catches hunks that hit the def line — useless for in-method edits.

Two options were considered:
1. **Add `end_line` to `symbols` table** — touches Spec 1's schema. Spec 1's tasks are all checked done; existing `_depgraph.sqlite` files would need migration. Violates this spec's "no changes to dep-graph schema" constraint.
2. **Nearest-preceding-symbol heuristic** — for line `L` in file `F`, the enclosing symbol is the one with the largest `line ≤ L` in that file. SQL: `SELECT * FROM symbols WHERE file=? AND line<=? ORDER BY line DESC LIMIT 1`.

**Chosen: #2.** It's how IDEs do "go to symbol containing line" lookup. Failure mode is small over-attribution (whitespace / comments between symbols attribute to the preceding symbol). No under-attribution. Acceptable.

**Trade-off:** for symbols that are nested (inner classes / lambdas), the heuristic attributes inner-symbol edits to the inner symbol (correct), but if the inner symbol isn't in the index for some reason, the edit attributes to the outer container (acceptable fallback). True span-based lookup would be a follow-up that updates Spec 1's schema; documented in the risk register.

### Decision: rename takes qualified names, with bare-name UX shortcut

**Why:** Bare names are massively ambiguous — `User` could be a class, a method on multiple classes, a variable, a function parameter. The dep-graph stores `qualified_name` precisely so we can disambiguate. Letting rename take bare names without a contract means the engine guesses which `User` you meant, which is exactly the kind of silent destruction this spec is designed to prevent.

**Pattern:** `old_qname` parameter. Accepts:
1. A fully qualified name (`pkg.module.Class.method`) — resolves directly.
2. A bare name — resolves only if exactly one symbol in the entire `symbols` table has that bare name; otherwise returns an `ambiguous=True` plan with `ambiguity_candidates[]` listing all matches and their qualified names.

`new_name` is always bare — it's the new identifier.

**Trade-off:** users have to know how to spell qualified names. Mitigation: skill prompts can call `dep.context_of()` first to surface the qualified form, or the ambiguity report itself enumerates candidates so the user can re-invoke with the correct one.

### Decision: imports table is a first-class reference source for rename

**Why:** `from foo import OldName` is a real reference that needs updating. The dep-graph stores it in the `imports` table, separate from `calls` and `inheritance`. If the rename engine only walks calls + inheritance (as the original draft did), import statements end up stale — every `import` line breaks at runtime even though every call site renames cleanly.

**Pattern:** `_import_refs(depgraph, old_symbol)` is a peer step alongside `_graph_refs` and `_text_refs`. It queries `imports WHERE imported_name == old.name` and filters to imports whose `package` matches the symbol's module path (avoids matching unrelated modules that happen to export the same name).

**Trade-off:** the imports table can have language-specific quirks (Python `from x import *` doesn't enumerate names, JS `import * as foo` aliases). For the V1 cut we handle named imports only; star imports would need symbol-resolution at import-resolution time, which is Spec 1 territory. Document as "star imports may produce false negatives" in the rename engine's docstring.

### Decision: subprocess git over GitPython

**Why:** We use git for diff parsing, rev-parse, status, grep. Subprocess + `git` binary is already required for any contributor. Adding GitPython doubles the dep tree for capability we don't need (object access, low-level refs, packfile reading).

**Trade-off:** subprocess parsing is slightly more brittle; we mitigate with `--unified=0` (no context lines) and tested regex on the standard `@@` hunk header.

### Decision: dry-run is the default, always

**Why:** This spec writes to source files. The original blueprint had auto-apply paths gated behind config flags; that's too easy to fire by accident.

**Pattern:** every public function returns a `*Plan` object first. A separate `*_apply` function consumes the plan and writes. REST endpoints split similarly: `rename-preview` (GET) vs `rename-apply` (POST with `confirm: true` required).

**Trade-off:** two-step UX. Acceptable — the second step is cheap (just write the patch list), and the safety dominates.

### Decision: graph-only refs are wrong by themselves; always cross-check with text grep

**Why:** Symbol references in comments, docstrings, string literals, generated docs, README examples — none of these appear in the dep-graph. A graph-only rename leaves dead names everywhere they're mentioned outside compiled code.

**Pattern:** `_graph_refs` (precise, code-only) and `_text_refs` (broad, includes comments) both populate the plan. We surface `graph_only` and `text_only` partitions so the user sees what each method missed.

**Trade-off:** more user judgment required. Explicit by design — automatic merge would silently rename strings that shouldn't be renamed (e.g. an `OldName` literal in a `bin/migrate.sh` shell script).

### Decision: audit log on apply, snapshot SHA pinning

**Why:** Refactoring tools that modify source files MUST be auditable. If something breaks two days later, the user needs to know exactly what was changed and from what state.

**Pattern:** `_refactoring_log.jsonl` is append-only. Every apply records timestamp, operation, names, files changed, `sha_before`. Replay = re-apply same patch list against `sha_before`; should produce same result.

### Decision: refuse apply on dirty working tree (override flag)

**Why:** Apply on a dirty tree means the user has uncommitted work that won't be in `sha_before`. Audit log lies; rollback is messy.

**Pattern:** default `apply()` checks `working_tree_dirty()` and refuses. Explicit `--force-dirty` flag overrides, with a warning logged.

## Dependencies on Spec 1

This spec **only** works once Spec 1 is in place:
- Reads `<snapshot>/_depgraph.sqlite` schema (symbols, calls, inheritance, endpoints)
- Reuses `dep.impact_of` directly for the change-detector's impact step
- Reuses `dep.context_of` for rename ambiguity-disambiguation (when `old_qname` matches multiple symbols)

No changes to Spec 1's code or schema. If Spec 1 changes, this spec inherits whatever the new contract is.

## Dependencies on nothing else new

- No new pip dependencies
- No new external services
- No changes to `src/ast/`, `src/ast/v2/`, playbooks, or extraction logic
- No changes to existing FastAPI routes (only adds a new router)

## Risk register

| Risk | Mitigation |
|---|---|
| Multi-line diff hunk maps to multiple symbols, some unrelated | Conservative: include all symbols in the hunk's line range. False positives are noisy but safe; false negatives are dangerous. |
| Rename hits a string literal that's actually a class name reference (Java reflection, Python `getattr`) | Text-search catches it. Graph misses it. We surface `text_only` partition for user review. |
| Snapshot is for SHA X, but user has rebased to Y; staleness check returns `outdated` | By design. Re-run the AST pipeline. |
| Apply on a Windows path with backslashes vs git's forward slashes | `os.path` for in-process; convert to forward-slash for `git grep` arguments. Test on Windows specifically. Use `os.replace(tmp, target)` for atomic apply (cross-platform; on Windows behaves atomically on same volume). |
| Spec 1's dep-graph schema evolves (e.g. adds `end_line`) while this spec is in flight | This spec's nearest-preceding-symbol heuristic is forward-compatible — when `end_line` exists, switch the SQL to `WHERE line<=? AND end_line>=?`. Single-line code change. |
| Star imports (`from x import *`, `import * as foo`) hide which names came from where | V1 handles named imports only. Star imports may cause false negatives in `_import_refs`; documented as a known limitation in the rename engine docstring. Resolution is Spec 1 territory (would need import-time symbol resolution). |
| User runs `rename-apply` with `confirm: true` by mistake in a script | The audit log + `sha_before` makes it recoverable: `git reset --hard <sha_before>` on the affected files. |

## Done criteria (mirrors `tasks.md` Phase 9)

1. Detect-changes regression on petclinic matches Spec 1 blast-radius fixture
2. Rename preview on petclinic finds expected ref count within ±2 of `git grep`
3. Apply path: zero unintended writes from full test suite (verified by repo-snapshot diff)
4. Staleness honest: edited file → `stale` with that file enumerated
5. V2 50-repo benchmark + Spec 1 dep-graph builds unchanged
