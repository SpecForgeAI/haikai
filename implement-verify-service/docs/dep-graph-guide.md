# Dependency Graph Guide

> Implementation of `haikai/specs/2026-04-25-deep-dependency-analysis/spec.md`.
> Lives in `src/dep/`.

## Overview

The dependency-graph layer projects existing AST outputs (ctags + tree-sitter
TSVs) into a per-snapshot SQLite database, then exposes four analyses:

| Analysis | Question it answers |
|---|---|
| **impact** | If I change symbol X, what else might break? |
| **flow**   | How does feature Y work end-to-end? |
| **context** | Show me everything I need to know about symbol X. |
| **processes** | What logical processes (clusters of endpoints) does this app implement? |

It is **strictly downstream** of extraction. It runs after Step 8 of
`pipeline.py` and writes `<snapshot>/_depgraph.sqlite` next to the existing
TSV outputs.

## Architecture

```
AST pipeline → 6 TSVs in <snapshot>/
                    │
                    ▼
        src/dep/builder.py::run()
                    │
                    ▼
       <snapshot>/_depgraph.sqlite        (7 tables)
       <snapshot>/_depgraph.meta.json     (row counts)
                    │
                    ▼
       src/dep engines (impact, flow, context, processes)
                    │
            ┌───────┼────────┐
            ▼       ▼        ▼
        skills    REST    Python API
```

## 7-table schema

| Table | What's in it |
|---|---|
| `files` | one row per source file (path, language, byte_size, n_symbols) |
| `symbols` | every symbol from `_index.txt` (class/function/method/etc.) |
| `imports` | one row per (file, package, imported_name) from `_imports.txt` |
| `calls` | edge: caller_symbol → callee_qualified_name (+ optional callee_symbol_id) |
| `inheritance` | edge: child_symbol → parent (extends/implements) |
| `endpoints` | one row per endpoint, links to handler symbol |
| `interactions` | one row per outbound interaction (db, http, queue, ...) |

Indices on every common query path. See `src/dep/schema.sql` for the full DDL.

## Build

The graph is rebuilt automatically as the last step of the AST pipeline.
Opt out with:

```bash
AST_SKIP_DEPGRAPH=true python scripts/run_v2_50_repos.py
```

Manual rebuild:

```python
from src.dep import DepGraph
DepGraph.open_or_build("/path/to/snapshot", force_rebuild=True)
```

The builder is **idempotent**: same input TSVs → same SQLite DB. It also
short-circuits when the SQLite is newer than every input TSV.

## Python API

```python
from src.dep import DepGraph, impact_of, trace_from, context_of, processes_in

graph = DepGraph.open_or_build(snapshot_path)

# What changes if I edit OwnerController.list?
report = impact_of(graph, "OwnerController.list", depth=5)
print(report.summary())
for c in report.direct_callers:
    print(f"  ← {c.qualified_name}")

# Trace flow from an endpoint
fg = trace_from(graph, "GET /owners")
print(to_mermaid(fg))

# 360° view
ctx = context_of(graph, "OwnerController")
print(ctx.as_markdown())

# Cluster endpoints by shared call paths
for proc in processes_in(graph, min_size=2):
    print(f"{proc.name}: {len(proc.endpoints)} endpoints")
```

## Haikai skills

All under `haikai-profiles/default/commands/`:

| Skill | Engine | LLM |
|---|---|---|
| `/analyze-impact <symbol>` | `impact_of` | optional (narrates report) |
| `/trace-dependencies <seed>` | `trace_from` | optional (writes prose) |
| `/show-context <symbol>` | `context_of` | optional (1-paragraph preamble) |
| `/find-processes [filter]` | `processes_in` | optional (names + describes each process) |

LLM is purely for narration; engine output is the source of truth.

## REST endpoints

Mounted under `/api/dep` (registered in `src/api.py`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dep/impact?snapshot=&symbol=&depth=&include_endpoints=` | impact report |
| GET | `/api/dep/trace?snapshot=&seed=&format=&max_depth=` | flow graph (json or mermaid) |
| GET | `/api/dep/context?snapshot=&symbol=` | 360° context |
| GET | `/api/dep/processes?snapshot=&min_size=&framework_filter=` | clusters |
| POST | `/api/dep/rebuild` body=`{snapshot, force}` | rebuild SQLite from TSVs |

## Performance

Build times observed (on dev box, AST_SKIP_CALLS=true):

| Snapshot | Files | Symbols | Calls | Build (s) |
|---|---|---|---|---|
| akeneo-pim | 494 | 6,310 | 0 | 0.2 |
| discourse | 500 | 6,187 | 36,929 | 0.5 |

Memory footprint is bounded by `_calls.txt` size (the dominant table).

## Limitations

- **Single snapshot only.** No cross-snapshot or cross-repo joins (deferred
  to Spec 3).
- **Bare-name resolution is best-effort.** When the user asks about
  `validate_user`, the engine picks the most-referenced symbol with that name
  and notes the choice in the report.
- **Inheritance overrides are simple substring on `Class.method`** — virtual
  dispatch in dynamic languages (Python `super()`, Ruby `method_missing`) is
  not modelled.
- **Process clustering is greedy Jaccard** — similar features may cluster
  separately if their flows diverge slightly. Tweak the threshold in
  `processes.py` for your codebase if needed.

## Testing the build

```python
from src.dep import DepGraph
graph = DepGraph.open_or_build("path/to/petclinic-snapshot")

# Sanity counts
for tbl in ("files","symbols","imports","calls","inheritance","endpoints","interactions"):
    n = graph.query_one(f"SELECT COUNT(*) AS c FROM {tbl}")["c"]
    print(f"{tbl}: {n}")
```

Expected on petclinic: `endpoints == 17`, `symbols >= 50`, `inheritance >= 5`.
