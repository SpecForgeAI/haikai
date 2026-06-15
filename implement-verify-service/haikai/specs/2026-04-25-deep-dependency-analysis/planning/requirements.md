# Requirements — Deep Dependency Analysis

## Functional

### F1: SQLite graph build
- Read all six AST output TSVs from a snapshot directory
- Project into 7-table SQLite schema co-located with the snapshot
- Idempotent (rebuilding the same input yields the same DB content)
- Skips work when SQLite is newer than every input TSV

### F2: Impact analysis
- Given a symbol (qualified name OR bare name), return:
  - direct + transitive callers (default depth=5)
  - direct + transitive callees (default depth=5)
  - subclass methods (when symbol is a class or method)
  - endpoints whose handler chain transitively touches the symbol
- Returns a structured report; LLM summary optional

### F3: Execution flow tracing
- Given a seed (symbol or endpoint id), produce a graph of:
  - call edges from seed forward
  - inheritance overrides folded in
  - terminating at interaction sinks (DB writes, HTTP outbound, queue publishes)
- Render as Mermaid OR JSON

### F4: 360° symbol context
- Given a symbol, return:
  - definition (file, line, signature)
  - 1-hop callers + callees
  - class hierarchy (parents + children)
  - endpoints handled
  - outbound interactions
  - imports the symbol relies on

### F5: Process discovery
- For each endpoint in the snapshot, compute its execution flow
- Cluster endpoints whose flows share ≥80% of their internal symbols
- Each cluster = one "process" with a name, member endpoints, key symbols, downstream interactions

### F6: Surfaces
- 4 Haikai skills (`/analyze-impact`, `/trace-dependencies`, `/show-context`, `/find-processes`)
- 5 REST endpoints under `/api/dep/`
- Importable Python API (`src.dep`)

## Non-functional

### N1: Performance
- Build ≤ 30s on petclinic; ≤ 2 min on alfresco/keycloak
- Engine queries return in <1s for typical inputs
- Memory peak ≤ 1 GB on the largest snapshot

### N2: No new infra dependencies
- Only stdlib `sqlite3` + already-present `networkx`
- No PostgreSQL / Redis / S3 / Neo4j
- No new background services

### N3: No regressions
- AST extraction (`src/ast/`, `src/ast/v2/`, playbooks) untouched
- V2 50-repo benchmark numbers unchanged

### N4: No LLM in build path
- Build is pure SQL projection
- LLM only at skill / surface layer, optional

### N5: Per-snapshot lifecycle
- Graph file lives at `<snapshot>/_depgraph.sqlite`
- Deleted when its snapshot is deleted
- No central registry, no cross-snapshot joins

## Constraints

### C1: Spec scope
- Only what's described in `spec.md` for this phase
- Spec 2 (refactoring impact + git diff) and Spec 3 (multi-tenant deployment) are deliberately out of scope

### C2: Engine determinism
- Each engine must produce identical output for identical inputs
- `processes.py` Louvain seed pinned

### C3: Identity
- Use `qualified_name` as the canonical symbol identifier
- API surface accepts bare names but resolves them internally

### C4: Backwards compat
- Adding the build step to `pipeline.py` must be opt-out via env var (`AST_SKIP_DEPGRAPH=true`)
- All existing REST endpoints, CLI commands, skills continue to work unchanged

## Inputs (consumed, not modified)

- `<snapshot>/_index.txt` — symbols
- `<snapshot>/_imports.txt` — imports
- `<snapshot>/_calls.txt` — call edges
- `<snapshot>/_inheritance.txt` — class relationships
- `<snapshot>/_endpoints.txt` — endpoint → handler
- `<snapshot>/_interactions.txt` — outbound interactions

## Outputs

- `<snapshot>/_depgraph.sqlite` — primary
- `<snapshot>/_depgraph.meta.json` — row counts, checksums (for diffing)

## Success criteria (mapped from spec.md)

1. Build correctness — same input → byte-identical SQLite (after VACUUM)
2. Performance — within budgets above
3. Engine accuracy — petclinic regression fixtures pass
4. Skill UX — sub-2s LLM-summary mode, sub-100ms structured mode
5. Zero regression on V2 50-repo benchmark
