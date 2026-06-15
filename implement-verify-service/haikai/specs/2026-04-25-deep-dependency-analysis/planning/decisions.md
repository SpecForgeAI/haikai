# Planning notes — Deep Dependency Analysis

## Context

The original GitNexus-inspired blueprint (`specs/dependency-analysis/spec-1-deep-dependency-analysis.md`, 94 KB / 1,900 lines) is comprehensive but bundles infrastructure choices that pull in PostgreSQL, Redis, S3, and big enterprise scaffolding. That belongs in Spec 3 (enterprise deployment), not here.

This Haikai spec takes the **dependency-graph subset** of that blueprint and reframes it to fit how this repo actually works:
- one snapshot at a time
- no new infra (sqlite + stdlib + networkx already present)
- no LLM in the build path
- engines are pure-Python wrappers on a SQLite query

## Key decisions

### D1: SQLite per snapshot, not a central graph DB
**Rationale:** snapshots are already filesystem artifacts. Putting the graph next to the TSVs in the same `<repo>/<sha>/` directory means lifecycle is automatic — delete a snapshot, the graph dies with it. PostgreSQL would force us to invent a snapshot registry today (Spec 3's job).
**Alternative considered:** Neo4j / LadybugDB — overkill for ≤500k edges; serialisation cost dominates query cost at this scale.

### D2: Build is pure projection — no LLM
**Rationale:** the AST pipeline already did the hard interpretive work (resolving call targets, classifying interactions, discovering endpoints). The graph just *re-shapes* that data into queryable form. Adding LLM here would re-introduce the cost and variance V2 was designed to remove.
**Alternative considered:** call-target resolution via LLM during build — rejected.

### D3: Engines return structured data; LLM only at the surface layer
**Rationale:** keeps engines testable and deterministic. Skills layer can wrap LLM around the structured output for narration ("explain in plain English"), but the underlying analysis stays mechanical.
**Implication:** every engine method has a unit test on a fixture snapshot.

### D4: One graph per snapshot; no cross-snapshot joins
**Rationale:** Spec 3 introduces multi-project / cross-snapshot. Building cross-snapshot joins now would force premature schema choices about identity (how to keep symbol IDs stable across SHAs?). Defer.

### D5: Use `qualified_name`, not bare name, as the canonical identifier
**Rationale:** call-graph resolution already produces qualified names (e.g. `org.springframework.samples.petclinic.owner.OwnerController.list`). Using bare names would conflate `validate_user` across files. Engines accept either at the API surface and resolve internally.

### D6: Process clustering uses `networkx` Louvain (not custom)
**Rationale:** `networkx` is already a dependency. Louvain is well-understood, deterministic, no tuning needed for our scale.
**Alternative considered:** hand-rolled Jaccard clustering — simpler but gives worse partitions on real codebases.

### D7: No new external services
**Rationale:** want this to ship before Spec 3. Adding even Redis here means a deployment-config delta. Stdlib `sqlite3` + existing `networkx` only.

### D8: Skills wrap engines, not the other way around
**Rationale:** the engines are the contract. Skills are a UX over the engines, like CLI is a UX over a library. This means the same engine code powers REST endpoints, skills, tests, and direct Python use — single source of truth.

## Risks tracked

| Risk | Likelihood | Mitigation |
|---|---|---|
| Build-time blow-up on huge multi-module repos (alfresco, keycloak) | Medium | per-table batched inserts in single transaction; benchmark gate at Phase 11 |
| Call-graph resolution gaps from V1 propagate into the graph | High | document as known limitation; engines treat unresolved callees as text-only references and don't fail |
| Engine semantics drift from what users expect ("blast radius" means different things) | Medium | freeze definitions in spec.md; regression-test on fixed petclinic fixtures |
| SQLite contention if multiple processes write the same snapshot | Low | builder takes a file-lock; idempotent so concurrent builds are safe |
| `networkx` Louvain non-deterministic between runs | Medium | seed PRNG; if still flaky, switch to label-propagation |

## Sequencing rationale

Phases 1–2 (schema + builder) ship a queryable graph but no analysis. That's the smallest useful checkpoint — at end of Phase 2 you can `sqlite3 _depgraph.sqlite` and run ad-hoc SQL.

Phases 3–6 add the four engines. Each is independent; they can be tackled in parallel by separate sessions if needed. Recommended order: impact → flow → context → processes (each builds on the previous's traversal helpers).

Phase 7 wires the build into `pipeline.py`. Single line; do this only after Phase 2 is green.

Phases 8–9 (skills + REST) are the user-facing surface. Both depend on engines being stable (Phase 6 done).

Phase 10–12 are docs + hardening + done-criteria gates.

## Estimated effort (one engineer, focused)

| Phase | Effort | Notes |
|---|---|---|
| 1 | 1 day | Schema + DB wrapper |
| 2 | 2–3 days | Six TSV loaders + idempotency + tests |
| 3 | 1.5 days | Impact engine |
| 4 | 1.5 days | Flow engine |
| 5 | 1 day | Context engine (smaller; mostly aggregation) |
| 6 | 2 days | Process clustering — needs Louvain integration |
| 7 | 0.5 day | Pipeline integration |
| 8 | 2 days | 4 skills × 0.5 day each |
| 9 | 1 day | 5 REST routes |
| 10 | 0.5 day | Docs |
| 11 | 1 day | Benchmarks + memory profile |
| 12 | 0.5 day | Done-criteria checks |
| **Total** | **~14 days** | matches the 6-week range in the parent blueprint when accounting for review/iteration |

## Open items

- **O1**: Should `processes.py` produce stable IDs across rebuilds, or are processes ephemeral? → suggest ephemeral for now; revisit when refactoring spec needs them.
- **O2**: Confidence scores on call edges — surface in `ImpactReport` or hide? → surface; let skills filter.
- **O3**: Mermaid output node limit — 100? 200? → cap at 100, paginate larger flows.
- **O4**: Where do REST endpoints mount in the existing FastAPI tree? → confirm with the API maintainer; default `/api/dep/`.
- **O5**: Should the builder write a `_depgraph.meta.json` with row counts + checksums for diffing? → yes, costs nothing and helps debugging.
