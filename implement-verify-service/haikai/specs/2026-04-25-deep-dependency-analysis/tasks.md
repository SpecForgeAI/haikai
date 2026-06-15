# Tasks: Deep Dependency Analysis

## Phase 1 — SQLite schema + builder skeleton

- [x] T1.1: Create `src/dep/schema.sql` with the 7 tables + indices defined in the spec
- [x] T1.2: Create `src/dep/__init__.py` and `src/dep/db.py` — `DepGraph` class wrapping a `sqlite3.Connection`
- [x] T1.3: `DepGraph.open_or_build(snapshot_path)` — opens existing `_depgraph.sqlite` if present, else builds via `builder.run`
- [x] T1.4: `DepGraph.execute()` / `query()` thin helpers
- [x] T1.5: Idempotency test — build → modify metadata → rebuild → SQLite hash unchanged for the data rows

## Phase 2 — Builder (TSV → SQLite projection)

- [x] T2.1: `src/dep/builder.py::run(snapshot_path) -> Path` — orchestrator
- [x] T2.2: Sub-builders, one per source TSV:
  - `_load_files(...)` from snapshot file walk
  - `_load_symbols(...)` from `_index.txt`
  - `_load_imports(...)` from `_imports.txt`
  - `_load_calls(...)` from `_calls.txt` (resolves caller/callee to `symbol_id` where possible; falls back to `qualified_name` text)
  - `_load_inheritance(...)` from `_inheritance.txt`
  - `_load_endpoints(...)` from `_endpoints.txt`
  - `_load_interactions(...)` from `_interactions.txt`
- [x] T2.3: Single transaction per build
- [x] T2.4: Skip the build if SQLite is newer than every input TSV (fast no-op rebuild)
- [x] T2.5: Unit tests on a synthetic snapshot (≤10 files) covering each loader
- [x] T2.6: Integration test on the petclinic snapshot — assert row counts (`symbols ≥ 50`, `calls ≥ 30`, `endpoints == 17`)

## Phase 3 — Engine: impact (blast radius)

- [x] T3.1: `src/dep/impact.py::ImpactReport` dataclass
- [x] T3.2: `impact.forward(graph, symbol, depth=5)` — BFS through `calls` table
- [x] T3.3: `impact.reverse(graph, symbol, depth=5)` — BFS in reverse direction
- [x] T3.4: `impact.through_inheritance(graph, symbol)` — when `symbol.kind=class`, fold in subclass methods
- [x] T3.5: `impact.affected_endpoints(graph, symbol)` — endpoints whose handler chain transitively touches `symbol`
- [x] T3.6: `impact_of(graph, symbol_or_qname) -> ImpactReport` — public top-level wrapper
- [x] T3.7: Petclinic regression: `impact_of(graph, "OwnerController.list")` matches a frozen fixture

## Phase 4 — Engine: flow (execution flow tracing)

- [x] T4.1: `src/dep/flow.py::FlowGraph` (nodes + edges as dataclasses)
- [x] T4.2: `trace_from(graph, seed, max_depth=10)` — BFS callees, follow inheritance overrides, halt at interaction sinks
- [x] T4.3: `flow.to_mermaid(flow_graph) -> str`
- [x] T4.4: Petclinic regression: `trace_from(graph, "GET /owners")` produces ≤15 nodes incl. the repository call

## Phase 5 — Engine: context (360° symbol view)

- [x] T5.1: `src/dep/context.py::SymbolContext` dict shape
- [x] T5.2: `context_of(graph, symbol)` — definition + 1-hop callers/callees + class hierarchy + endpoints handled + outbound interactions + relevant imports
- [x] T5.3: Skill formatter helpers (`as_markdown`, `as_text`)

## Phase 6 — Engine: processes (cluster discovery)

- [x] T6.1: `src/dep/processes.py::Process` dataclass
- [x] T6.2: `processes_in(graph)` — for each endpoint, run `flow.trace_from`; cluster endpoints by ≥80% symbol-set overlap
- [x] T6.3: Use `networkx` Louvain / community detection (already in `requirements.txt`)
- [x] T6.4: Process naming: heuristic from controller class / common ancestor file
- [x] T6.5: Petclinic regression: returns ~3 processes (owners, vets, visits)

## Phase 7 — Pipeline integration

- [x] T7.1: After Step 8 (diagrams), call `DepGraph.open_or_build(snapshot_path)`
- [x] T7.2: Respect `AST_SKIP_DEPGRAPH=true` env var so users can opt out
- [x] T7.3: Verify V2 50-repo runner still matches baseline counts (no regression)

## Phase 8 — Haikai skills (4)

For each skill:
- Skill file at `haikai-profiles/default/commands/<skill>/single-agent/<skill>.md`
- Skill discovers the active snapshot path, opens `DepGraph`, calls the engine, formats output
- LLM client is optional — when present, used purely for narration / summary

- [x] T8.1: `/analyze-impact <symbol> [--depth N] [--no-endpoints]`
- [x] T8.2: `/trace-dependencies <symbol-or-endpoint> [--format json|mermaid]`
- [x] T8.3: `/show-context <symbol>`
- [x] T8.4: `/find-processes [--filter framework] [--min-size N]`

## Phase 9 — REST endpoints (5)

- [x] T9.1: `src/api/dep_routes.py` — FastAPI router
- [x] T9.2: `GET /api/dep/impact?snapshot=&symbol=&depth=&include_endpoints=`
- [x] T9.3: `GET /api/dep/trace?snapshot=&seed=&format=`
- [x] T9.4: `GET /api/dep/context?snapshot=&symbol=`
- [x] T9.5: `GET /api/dep/processes?snapshot=&min_size=&framework_filter=`
- [x] T9.6: `POST /api/dep/rebuild` body=`{repo, commit_sha}` — re-projects existing TSVs (no AST re-run)
- [x] T9.7: Mount router in main FastAPI app
- [x] T9.8: Smoke tests with TestClient on each route

## Phase 10 — Public Python API + docs

- [x] T10.1: `src/dep/__init__.py` re-exports `DepGraph`, `impact_of`, `trace_from`, `context_of`, `processes_in`
- [x] T10.2: `docs/dep-graph-guide.md` — schema reference, engine usage, examples
- [x] T10.3: README section on `src/dep/` for new contributors

## Phase 11 — Hardening + benchmarks

- [x] T11.1: Build-time timer logging per snapshot
- [x] T11.2: Benchmark on petclinic / redmine / drupal / fineract / keycloak; record build times
- [x] T11.3: Memory profile on the largest snapshot
- [x] T11.4: Confirm V2 50-repo benchmark unchanged

## Phase 12 — Done criteria

- [x] T12.1: All 4 skills callable end-to-end
- [x] T12.2: All 5 REST endpoints return 200 on petclinic
- [x] T12.3: `impact_of("OwnerController.list")` matches fixture
- [x] T12.4: Build < 30s on petclinic; < 2 min on keycloak/alfresco
- [x] T12.5: V2 benchmark numbers unchanged
