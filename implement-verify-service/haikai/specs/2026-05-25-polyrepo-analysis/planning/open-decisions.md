# Open Decisions — Not Spec'd Yet

**Status:** OD-2 RESOLVED 2026-05-27; OD-1 OBSOLETED (cascades from OD-2); OD-3 still open
**Source:** in-thread Slack discussion 2026-05-26
**Owner:** Ozzie

These items surfaced while drafting `planning/requirements.md`. The bot proposed defaults; those defaults were rejected pending a fuller spec pass. Whatever lands here must be designed before the affected phases of `tasks.md` can begin — they touch the write-spec → create-tasks → implement-tasks shape directly.

Do not start the affected phases until each item below has a decision recorded here.

---

## OD-1: Where does `paths_touched` live? — **OBSOLETED 2026-05-27**

Cascades from OD-2's resolution. OD-1 asked where to persist the `paths_touched` map produced by `write-spec`'s nearest-neighbour step. With OD-2 resolved as NOT REQUIRED (the LLM produces coherent cross-repo work without NN attribution scaffolding), there is no `paths_touched` map being produced in the first place — and so nothing to persist.

Re-open only if a future feature re-opens OD-2. Until then, the original three candidate shapes (frontmatter / side-car / inline annotation) are moot.

**Tasks affected:** T5.3 was contingent on this; obsoleted alongside Phase 5. T6.3 (the `create-tasks` parser consumer) only mattered if `paths_touched` existed; also obsoleted.

---

## OD-2: NN attribution granularity — **RESOLVED 2026-05-27: NOT REQUIRED**

Empirical trial against `spring-petclinic-rest` + `spring-petclinic-vue` (a cross-cutting REST endpoint + Vue UI feature) ran end-to-end with **zero attribution scaffolding** — no `paths_touched`, no per-repo task groups, no nearest-neighbour annotations — and produced fully coherent cross-repo output:

- Backend Java code landed only under `backend/`; Vue/JS code only under `frontend/`. Zero mis-attribution.
- Endpoint path matched character-for-character (`/owners/{ownerId}/preferred-vet`) between Spring `@GetMapping` and frontend `apiClient.get(...)`.
- Response DTO shape (`VetDto.firstName / lastName / specialties[]`) was correctly anticipated by the Vue template without any contract file.
- 404 + null-body states symmetrically handled on both sides.

With every repo mounted via `--add-dir` and git's working-directory boundaries doing per-repo commit attribution implicitly, NN attribution is *not a correctness gate* for the polyrepo system to ship.

**Caveats** (re-test before extrapolating):
- N > 2 repos untested — coherence may degrade as the LLM's working set grows.
- Larger / non-localised features untested (this trial: one endpoint + one UI panel).
- Typed cross-repo contracts untested (this feature was loosely coupled — no shared types).

**Evidence:** `haikai/specs/2026-05-27-od2-empirical-test/findings.md` (Trial M: 12 files, +126/−15 across 1 repo; Trial P: 13 files, +268/−22 across 2 repos with exact cross-repo contract match).

**Tasks affected:** T5.2 and T5.5 are now obsolete in the form they were drafted. T5.6 (integration test on the petclinic pair) is *already done* by the empirical trial above.

---

## OD-3: Cross-repo dependency declaration syntax — **DEFERRED 2026-05-27**

**Context.** `create-tasks` produces task groups that may declare cross-repo dependencies (FR-7). The annotation syntax for *intra-repo* deps already exists (`Dependencies: Task Group N`). Cross-repo deps need their own grammar — e.g., "frontend TG1 depends on backend TG3" — so a scheduler can build a DAG of task groups across repos and only release a group to a worker once its upstream deps are satisfied.

**Candidate syntaxes:**

- *`depends_on: [@repo:<alias>.task-group-<n>]`* — mirrors the `[@repo:<alias>]` group annotation. Risk: dotted path inside a tag is ugly.
- *`Dependencies: backend/Task Group 3`* — extends the existing `Dependencies:` line with a `<repo>/` prefix. Risk: forces every parser to handle the optional prefix.
- *Explicit YAML block per task group* — separates dependency declarations from the group's freeform body. Risk: more boilerplate in `tasks.md`.

**Why it's deferred.** OD-3 is only load-bearing once we want to *parallelise* implementation across repos. That requires more than a syntax — it requires the whole consumer stack:

| Piece | Status today |
|---|---|
| Nodes (per-repo task groups, annotated `[@repo:<alias>]`) | ✅ Phase 6 settled |
| Intra-repo edges (`Dependencies: Task Group N`) | ✅ exists |
| **Cross-repo edges** (the OD-3 grammar) | ❌ this decision |
| DAG builder (parse → topo-sort, detect cycles) | ❌ doesn't exist |
| Scheduler (release ready groups, fan in on completion) | ❌ doesn't exist |
| Per-repo agent supervision (one Claude session per repo, scoped `--add-dir`, commits on its own branch) | ❌ today it's one session over all repos |

OD-3 is the cheapest of the six rows — a grammar choice. The expensive rows are the DAG builder + scheduler + per-repo agent supervision. So OD-3 is the *gate*, not the bulk of the work, and gating prematurely doesn't unlock anything.

Today the single-session approach is sufficient: `/implement-tasks` runs one Claude session with all repos mounted via `--add-dir`, Claude plans the order internally (Trial P did backend-then-frontend correctly with zero attribution scaffolding), and the work lands in 14 minutes wall-clock with perfect cross-repo coherence.

**Re-open OD-3 when ANY of these holds:**

- A feature exceeds one session's context budget (forces multi-session orchestration).
- Wall-clock matters enough that parallel-per-repo agents (e.g., saving a 26 min single-session run by running 2 repos concurrently in ~13 min) is worth the orchestration complexity.
- The flow diagram or another consumer needs to render the cross-repo dependency graph.
- N >> 2 repos — at which point the LLM's implicit ordering may break down.

Whichever syntax lands becomes the LLM's contract; changing it later is a migration. So design OD-3 alongside the DAG-builder + scheduler in the same spec, not separately.

**Affected tasks:** T6.2, T6.3, T6.5 — all stay open and on hold.

---

## Process

Each open decision blocks at least one of Phases 5, 6, or 7. To unblock:

1. A short design doc lands here (or replaces this file) with the chosen shape and one paragraph of "why not the alternatives".
2. `planning/requirements.md` FR-6 / FR-7 are amended to reference the decided shape.
3. The affected tasks in `tasks.md` are unchecked-then-rewritten against the decided shape.

Status: Phases 1–4 + Phase 8 are landed. OD-2 resolved 2026-05-27 (NOT REQUIRED); Phase 5 is now substantively complete via the empirical trial. OD-1 obsoleted as a cascade (nothing left to persist without NN attribution). OD-3 (cross-repo dependency syntax) remains open but defer-until-needed — no real feature has surfaced the need yet.
