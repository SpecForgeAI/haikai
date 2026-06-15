# Refactoring Guide

The `src/refactoring/` package builds three engines on top of the
dependency graph (Spec 1):

1. **Change detection** — git diff → impacted symbols → blast radius
2. **Multi-file rename** — graph-aware + text-search safety net
3. **Staleness tracking** — snapshot vs working-tree state

Spec: `haikai/specs/2026-04-27-refactoring-impact/`.

---

## Quick start (Python)

```python
from src.dep import DepGraph
from src.refactoring import (
    detect_changes,
    rename_preview,
    rename_apply,
    check_staleness,
)

graph = DepGraph.open_or_build("path/to/snapshot")

# 1. What's at risk in the current `git diff`?
report = detect_changes("/path/to/repo", graph, scope="staged")
print(report.risk.level, report.risk.score)
for f in report.files:
    print(f"  {f.path} ({f.status})")
for ep in report.affected_endpoints:
    print(f"  ! {ep.operation} {ep.path}")

# 2. Plan a rename (preview by default — never writes)
plan = rename_preview("/path/to/repo", graph, "lib.Greeter", "Salutator")
if plan.ambiguous:
    for c in plan.ambiguity_candidates:
        print(f"  candidate: {c.qualified_name} ({c.kind}) at {c.file}:{c.line}")
else:
    print(f"{len(plan.patches)} patches across "
          f"{len(set(p.file for p in plan.patches))} file(s)")

# 3. Apply (writes files, refuses on dirty tree)
applied = rename_apply("/path/to/repo", graph, plan)
print("applied:" , applied.applied)

# 4. Is the snapshot still trustworthy?
sr = check_staleness("path/to/snapshot", "/path/to/repo")
print(sr.level)  # fresh | stale | outdated | unknown
```

---

## Naming convention

`old_qname` is **always a qualified name** (e.g. `org.acme.Foo`,
`pkg.module.Class.method`). A bare name is a UX shortcut: it works only
when the bare name resolves to exactly one symbol in the entire
`symbols` table. Otherwise the engine returns a plan with
`ambiguous=True` and a list of `ambiguity_candidates` for the user to
disambiguate.

`new_name` is **always bare** — just the new identifier.

---

## Reference partitions: graph_only / text_only / both

The rename engine never auto-merges graph and text references. It
collects three partitions:

- `graph_only` — files where the dep-graph found a reference but
  `git grep` did not. Usually means the graph saw an unresolved-callee
  text edge but the file no longer contains the bare name.
- `text_only` — files where `git grep` found the bare name but the
  graph did not. Usually a comment, docstring, string literal, README
  example, or a reference in a file the AST scanner ignored.
- `both` — files in both sets. **Patches default to this partition only.**

Pass `include_text_only=True` to also patch the `text_only` files when
you've reviewed them and confirmed they should be renamed.

---

## Audit log

Every successful `rename_apply` appends one JSONL record to
`<snapshot>/_refactoring_log.jsonl`:

```json
{
  "timestamp": "2026-04-27T13:14:15Z",
  "op": "rename",
  "old_qname": "lib.Greeter",
  "new_name": "Salutator",
  "kind": "class",
  "files_changed": ["lib.py", "main.py"],
  "sha_before": "abc1234...40chars",
  "triggered_by": "python_api",
  "tool_version": "0.1.0"
}
```

To recover from a bad apply: `git reset --hard <sha_before> -- <files_changed>`.

---

## Safety defaults

| Default | Override |
|---|---|
| `apply=False` (preview only) | `rename_apply(...)` is the explicit write path |
| Refuse on dirty working tree | `force_dirty=True` |
| Patch only `both` partition | `include_text_only=True` |
| Text-grep restricted to symbol's language | `all_languages=True` |
| REST `rename-apply` requires `confirm: true` | (no override — by design) |

---

## REST endpoints

Mounted at `/api/refactor/`:

| Method | Path | Body / Query |
|---|---|---|
| GET  | `/api/refactor/detect` | `snapshot`, `repo`, `scope`, `commit?` |
| GET  | `/api/refactor/rename-preview` | `snapshot`, `repo`, `old_name`, `new_name`, `all_languages?`, `include_text_only?` |
| POST | `/api/refactor/rename-apply` | JSON: `{snapshot, repo, old_name, new_name, confirm: true, force_dirty?, all_languages?, include_text_only?}` |
| GET  | `/api/refactor/staleness` | `snapshot`, `repo` |

`POST /api/refactor/rename-apply` returns 400 if `confirm` is not exactly
`true`.
