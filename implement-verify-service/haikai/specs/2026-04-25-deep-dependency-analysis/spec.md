# Specification: Deep Dependency Analysis

## Summary

Build a complete code-dependency graph from the existing AST outputs (ctags `_index.txt`, tree-sitter `_calls.txt`, `_imports.txt`, `_inheritance.txt`). Persist it in a per-snapshot SQLite database. Expose four analyses — **impact (blast radius)**, **execution flow tracing**, **360° symbol context**, **process discovery** — through Haikai skills, REST endpoints, and a thin Python API.

This is **strictly downstream** of the AST + interaction + endpoint pipeline. No changes to extraction logic, query types, or playbooks.

## Core Principle

> AST = mechanical extraction. LLM = interpretation. **Graph = relational projection of AST.**

The dependency graph is a deterministic projection of what's already in the structural store. No LLM is required to build it; an LLM is optional during *use* to summarise / explain / propose refactors.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Existing pipeline                         │
│                                                                  │
│  Step 1: ctags                  → _index.txt                     │
│  Step 2: tree-sitter            → _imports.txt, _calls.txt,      │
│                                   _inheritance.txt               │
│  Step 3: interaction class.     → _interactions.txt              │
│  Step 4: endpoint discovery     → _endpoints.txt                 │
│  Step 5–7: enrichment, etc.                                      │
│                                                                  │
│  Step 8a: mechanical diagrams                                    │
│  Step 8b: agentic diagrams                                       │
│                                                                  │
│  Step 9: DEPENDENCY GRAPH BUILD  (NEW — this spec)               │
│    └── reads _index/_calls/_imports/_inheritance/_endpoints      │
│        /_interactions → builds SQLite graph at                   │
│        <snapshot>/_depgraph.sqlite                               │
└──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Analysis API (this spec)                     │
│                                                                  │
│  src/dep/                                                        │
│    schema.sql           — 7-table SQLite schema                  │
│    builder.py           — projects AST files → SQLite            │
│    impact.py            — blast radius (forward + reverse)       │
│    flow.py              — execution flow tracing                 │
│    context.py           — 360° symbol context                    │
│    processes.py         — process / API-flow discovery           │
│                                                                  │
│  Surfaces:                                                       │
│    - Haikai skills (4)   — /analyze-impact, /trace-deps,       │
│                              /show-context, /find-processes      │
│    - REST endpoints (5)    — /api/dep/{impact,trace,context,    │
│                              processes,rebuild}                  │
│    - Python API            — direct import for tests/scripts     │
└──────────────────────────────────────────────────────────────────┘
```

## Storage: SQLite per snapshot

One file per snapshot: `<snapshot>/_depgraph.sqlite`. Co-located with the existing TSV outputs so the graph lifecycle matches the snapshot's. Build is idempotent — same input files produce the same DB.

### 7-table schema (referenced from `src/dep/schema.sql`)

| Table | Purpose | Key columns |
|---|---|---|
| `symbols` | Every symbol from `_index.txt` (class / function / method / variable) | `id, name, qualified_name, kind, file, line, language` |
| `files` | One row per source file | `path, language, byte_size, n_symbols` |
| `imports` | Import edges from `_imports.txt` | `id, file_id, package, imported_name` |
| `calls` | Call edges from `_calls.txt` | `id, caller_symbol_id, callee_symbol_id, callee_qualified_name, confidence` |
| `inheritance` | Class-extends-class / implements edges | `id, child_symbol_id, parent_symbol_id, kind` |
| `endpoints` | Endpoint → handler symbol from `_endpoints.txt` | `id, operation, path, framework, handler_symbol_id` |
| `interactions` | Outbound interactions from `_interactions.txt` | `id, source_symbol_id, target, mechanism, direction` |

All `*_symbol_id` columns are FK into `symbols.id`. Cross-row navigation is plain SQL — no graph DB required for the volumes we're targeting (≤500k edges per snapshot).

Indices: `(qualified_name)`, `(file)`, `(caller_symbol_id)`, `(callee_qualified_name)`, `(handler_symbol_id)`, `(source_symbol_id)`.

## Analysis engines

### `impact.py` — blast radius
> "If I change symbol X, what else might break?"

- **Forward**: callees of X, transitively, capped at depth N (default 5).
- **Reverse**: callers of X, transitively. Reverse is the headline blast-radius signal.
- **Inheritance**: when X is a class, include subclasses (and their methods that override X's).
- **Endpoint reach**: every endpoint whose handler chain transitively touches X.
- **Output**: `ImpactReport(symbol, direct_callers[], transitive_callers[], affected_endpoints[], notes[])`.

### `flow.py` — execution flow tracing
> "How does feature Y work end-to-end?"

- Start from a seed (endpoint, handler, or arbitrary symbol).
- Walk callees breadth-first, follow inheritance overrides.
- Stop at sinks: external interactions (DB write, HTTP outbound, queue publish).
- **Output**: `FlowGraph` (nodes = symbols, edges = calls + interactions), serialisable to Mermaid.

### `context.py` — 360° symbol context
> "Show me everything I should know about symbol X."

- Definition site (file:line), signature.
- Direct callers + callees (1-hop).
- Class hierarchy (parents + children) when applicable.
- Endpoints handled.
- Outbound interactions.
- File-level imports the symbol relies on.
- **Output**: structured `SymbolContext` dict — formatted by skills/CLI for display.

### `processes.py` — process / API-flow discovery
> "List all logical processes (e.g. all REST flows from request to response sink)."

- For each endpoint, run `flow.py` from its handler.
- Group endpoints whose flows share ≥80% of their internal symbols (Louvain-lite clustering on the call subgraph) → "processes".
- **Output**: `list[Process]` — each with name (best-guess from controller class), endpoints, key symbols, downstream interactions.

## Surfaces

### Haikai skills (4)

Following the same pattern as `discover-endpoints` and `discover-diagrams`. Skill files in `haikai-profiles/default/commands/<name>/`.

| Skill | Behaviour |
|---|---|
| `/analyze-impact <symbol>` | Calls `impact.py`. LLM optional: when present, it summarises affected endpoints in plain English, suggests test scope. When absent, raw `ImpactReport`. |
| `/trace-dependencies <symbol-or-endpoint>` | Calls `flow.py`. Renders Mermaid + textual narration. |
| `/show-context <symbol>` | Calls `context.py`. LLM formats the bundle into a tight markdown view. |
| `/find-processes [filter]` | Calls `processes.py`. LLM names each process and writes a one-paragraph description. |

LLM use is **optional** — the engines themselves return structured data. Skills add interpretation when an LLM client is available.

### REST endpoints (5)

Mounted under `/api/dep/`. All accept `?snapshot=<repo>/<sha>` (default = latest snapshot per repo).

| Endpoint | Method | Body / Query |
|---|---|---|
| `/api/dep/impact` | GET | `symbol`, `depth`, `include_endpoints` |
| `/api/dep/trace` | GET | `seed` (symbol or endpoint id), `format=json|mermaid` |
| `/api/dep/context` | GET | `symbol` |
| `/api/dep/processes` | GET | `min_size`, `framework_filter` |
| `/api/dep/rebuild` | POST | `repo`, `commit_sha` — re-projects from existing TSV files into SQLite (no AST re-run) |

### Python API

`src/dep/__init__.py` exposes:

```python
from src.dep import (
    DepGraph,            # opens or builds the SQLite for a snapshot
    impact_of,           # high-level wrapper around impact.py
    trace_from,          # wrapper around flow.py
    context_of,          # wrapper around context.py
    processes_in,        # wrapper around processes.py
)

graph = DepGraph.open_or_build(snapshot_path)
report = impact_of(graph, "src.auth.validate_user")
```

## Constraints (non-negotiable)

1. **No changes to AST extraction.** `src/ast/`, `src/ast/v2/`, playbooks, `.scm` files are off-limits. This spec consumes their output.
2. **Builder must be idempotent.** Same TSVs in → same SQLite out. Re-runs are safe.
3. **No LLM in the build path.** LLM only at the skill / surface layer, optional.
4. **No new external dependencies for the build.** Stdlib `sqlite3` + existing `networkx` (already in `requirements.txt`). Avoid PostgreSQL / Redis / Neo4j here — that's Spec 3 territory.
5. **One graph per snapshot.** No cross-snapshot or cross-repo joins in this spec (defer to Spec 3).
6. **Per-symbol qualified names, not just bare names.** Use the `qualified_name` already produced by ctags + tree-sitter resolver to disambiguate `validate_user` across files/modules.

## Outputs of this spec

| Artifact | Lives in | Status |
|---|---|---|
| 7-table SQLite schema | `src/dep/schema.sql` | new |
| Builder | `src/dep/builder.py` | new |
| Engines (impact / flow / context / processes) | `src/dep/{impact,flow,context,processes}.py` | new |
| Public API | `src/dep/__init__.py` | new |
| Skills | `haikai-profiles/default/commands/{analyze-impact, trace-dependencies, show-context, find-processes}/` | new |
| REST endpoints | extend existing FastAPI app (likely `src/api/dep_routes.py`) | new |
| Pipeline integration | one call to `DepGraph.open_or_build(snapshot_path)` at end of `pipeline.py` | tiny edit |

## Out of scope (covered by later specs)

- Git diff → impact mapping (Spec 2: Refactoring Impact Analysis)
- Multi-file rename orchestration (Spec 2)
- PostgreSQL multi-project registry (Spec 3)
- Org-wide standards merging (Spec 3)
- Cross-project dependency joins (Spec 3)

## Success criteria

- **Build correctness**: identical SQLite for the same snapshot run twice.
- **Performance budget**: build completes in ≤30s on the petclinic snapshot, ≤2 min on alfresco/keycloak-class snapshots.
- **Engine accuracy**: blast radius for `OwnerController.list` on petclinic returns the 1 endpoint and the 3 helper methods we expect (regression-fixturable).
- **Skill UX**: `/analyze-impact` on a leaf method returns a 1-paragraph summary in <2s when LLM is available; <100ms structured output without LLM.
- **No regression**: V2 50-repo benchmark numbers unchanged (same TSVs, just an extra DB written next to them).
