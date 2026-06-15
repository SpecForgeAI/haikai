# Requirements: Multi-Repo Product Support

**Status:** PROPOSED
**Source spec:** `../spec.md`
**Diagram:** `../flow-diagram/` (interactive React Flow walkthrough of the 5 CRUD scenarios)
**UI clarifications:** `../ui-concerns.md`
**Open decisions blocking Phases 5/6/7:** `open-decisions.md`

---

## Functional Requirements

### FR-1: KV-map data model
- A product's repository topology is a key-value map: `folder name → git remote URL`.
- The map is the *only* place where the mono/poly distinction lives. Everything downstream iterates over it.
- Both keys (folder names) and values (URLs) are unique within a product.
- Folder name is the stable identifier — it is *not* updatable after init.

### FR-2: `coordination.yaml` at product root
- Persisted at `workspace/{company}/{project}/coordination.yaml`.
- Flat YAML map (`folder: url`) — human-readable, version-controllable.
- No inferred metadata, no stack flags, no dependency declarations — only the user's KV pairs.
- Written at init and rewritten on every CRUD mutation (atomic temp-file + rename).

### FR-3: `POST /projects/init` accepts a KV map
- Request body carries `company`, `project`, and `repos: Dict[str, str]` (folder → URL).
- Both uniqueness constraints validated *before* any filesystem operation.
- Init is atomic across N repos: if any clone fails, the entire workspace is rolled back — no partial state on disk.
- Returns the product workspace root path plus a per-repo result list (`{folder, dir, mode}`).
- Backward-compatibility shim: a body with the legacy `repo_url: str` field is accepted and internally promoted to `{<project>: <repo_url>}`.

### FR-4: CRUD endpoints on `/repos`
- `GET    /projects/{c}/{p}/repos` — returns the current map.
- `POST   /projects/{c}/{p}/repos` — adds a `{folder, url}` entry; both uniqueness constraints enforced.
- `PUT    /projects/{c}/{p}/repos/{folder}` — updates the URL for an existing folder. Tears down the existing clone in `product_root/{folder}/` and re-clones from the new URL. Folder alias is not renamable.
- `DELETE /projects/{c}/{p}/repos/{folder}` — removes an entry. The last entry cannot be removed (a product must always have ≥1 repo).
- Every mutation rewrites `coordination.yaml` and (for POST/PUT) reinitialises the affected GitManager.

### FR-5: Orchestrator `project_dir` = product workspace root
- `HaikaiOrchestrator.project_dir` resolves to the product workspace root (the parent of all repo sub-directories), *not* a single repo's root.
- The Claude session is started with `cwd=project_dir`. Each repo sub-directory is added via `--add-dir`. One `--add-dir` for mono, N for poly.
- The orchestrator's own logic does not branch on entry count. The only difference between mono and poly is the length of the `--add-dir` list.

### FR-6: `write-spec` nearest-neighbour repo attribution — *OBSOLETED 2026-05-27*
- Empirical trial (`haikai/specs/2026-05-27-od2-empirical-test/findings.md`) showed the LLM produces fully coherent cross-repo work without any NN attribution scaffolding when every repo is mounted via `--add-dir`. NN attribution is not a correctness gate at the tested scale (1 feature, 2 repos).
- `paths_touched` (and its persistence location, OD-1) is therefore also obsoleted — there is nothing to persist.
- Re-open only if a future feature surfaces evidence the LLM cannot coherently route work without explicit attribution (e.g., N > 2 repos, typed cross-repo contracts, larger non-localised features).

### FR-7: `create-tasks` per-group repo annotation
- Each task group in `tasks.md` carries a `[@repo:<alias>]` annotation when N > 1.
- Mono (N = 1) does not require the annotation but accepts it harmlessly.
- Cross-repo dependencies are declared explicitly; *the exact syntax is not yet decided* — see `open-decisions.md` (OD-3). Phase 6 is blocked until that decision lands.
- If any task group is missing its `[@repo:]` annotation under N > 1, the pipeline rejects the task list and reports which groups failed, before any implementation work begins.

### FR-8: `implement-tasks` commit fan-out
- The orchestrator iterates over the set of repos touched by the spec (derived from task-group annotations).
- For each touched repo, `apply_git_workflow(gm, spec_id)` is called once.
- The `apply_git_workflow` helper itself is unchanged — multiplicity comes from the caller's loop, not from changes to the helper.
- Untouched repos are not branched, not committed to, not PR'd.

### FR-9: Atomic failure on partial fan-out
- If any per-repo commit/push/PR call in the fan-out fails, the entire run is marked failed.
- Any PRs already opened in the same run are flagged for manual close (they are not auto-closed — that's a follow-up).
- Rationale: shape-specs produce cross-cutting features; partial PR delivery is incoherent by definition (closed Open Question #3 from spec.md).

### FR-10: Mapping snapshot at run start
- The orchestrator snapshots `coordination.yaml` at the start of each pipeline run.
- CRUD mutations during a run apply to the *next* run, not the current one.
- Eliminates a race where adding/removing repos mid-run could corrupt fan-out.

### FR-11: No mode flag anywhere in code
- The system never reads a `mode` field, an `is_monorepo` flag, or a sentinel key.
- Mono vs poly is inferred purely from the length of the KV map.
- UI surfaces a `Monorepo` / `Polyrepo` badge derived from `len(coordination.yaml)`; this is presentation-only.

---

## Non-Functional Requirements

### NFR-1: N = 1 is the degenerate case of N ≥ 1
- No `if N == 1: ... else: ...` branches anywhere in pipeline code.
- The same code path executes for single-repo and multi-repo products.
- Adding a `mode`/`is_polyrepo` branch anywhere is a smell — flagged in code review.

### NFR-2: Backward compatibility for existing single-repo projects
- Projects initialised before this spec landed continue to work.
- On first read of a legacy project (no `coordination.yaml` present), the system synthesises one from the existing `.git-config` and the project name as the default folder alias.
- No re-clone required for legacy projects.

### NFR-3: `GitManager` class is unchanged
- All git operations remain scoped to a single repo directory.
- Multiplicity is achieved by instantiating N `GitManager` objects in the init route — not by modifying the class.
- This is a hard constraint per the `gm` explain panel in `flow-diagram/`.

### NFR-4: `apply_git_workflow` helper is unchanged
- The helper continues to take a single `GitManager` and a single spec ID.
- The fan-out loop lives in the orchestrator, not in the helper.
- This is a hard constraint per the `pr` explain panel in `flow-diagram/`.

### NFR-5: Test grounding on the petclinic pair
- Integration tests use `spring-petclinic-rest` (Java/Spring/OpenAPI) + `spring-petclinic-vue` (Vue/TS/axios wrapper) — the cross-language pair from `analysis.md`.
- Validates the two findings that motivate this work: backend routes live in `openapi.yml` (not `@GetMapping`); frontend HTTP goes through a single `api.js` wrapper.

### NFR-6: All-or-nothing init
- N-repo init either succeeds wholly or leaves the filesystem in its pre-init state.
- No "partial workspace" recovery path — the user retries init after fixing the broken repo.

### NFR-7: CRUD atomicity
- Each mutation (POST/PUT/DELETE) either succeeds entirely (filesystem + `coordination.yaml` + affected GitManager state aligned) or fails leaving prior state intact.
- `coordination.yaml` writes use temp-file + rename to avoid torn writes.

---

## Open Question Resolutions

The three open questions in `spec.md` are resolved as follows (confirmed in-thread):

- **OQ #1: Role field per entry** — *deferred*. Folder alias is sufficient for routing in v1. A `role` field only helps the LLM reason about repo semantics, which is orthogonal to the orchestration spine. Revisit after N=1↔N>1 is proven.
- **OQ #2: Folder rename after init** — *closed: immutable*. The folder alias is the stable identifier. Rename would require moving the cloned directory on disk and updating every task annotation that references the old alias — too much surface for the value.
- **OQ #3: Partial commit failure recovery** — *closed: atomic, whole-run-fails*. Shape-specs produce cross-cutting features, partial delivery is incoherent. Successful PRs from the failed run are flagged for manual close.

### Implementation-detail open items

Items surfaced during planning. See `open-decisions.md`:

- **OD-1** — Where `paths_touched` is persisted. *Obsoleted 2026-05-27* (no `paths_touched` to persist — see OD-2 resolution).
- **OD-2** — NN attribution granularity. **RESOLVED 2026-05-27: NOT REQUIRED** at tested scale (`haikai/specs/2026-05-27-od2-empirical-test/findings.md`).
- **OD-3** — Cross-repo dependency declaration syntax. *Still open* — defer until a real feature surfaces the need.

Phases 1–4 + Phase 8 are landed. Phase 5 substantively complete via the empirical trial. Phases 6/7 defer-until-needed.

---

## Scope Boundaries

The following are explicitly out of scope, per `spec.md`:

- Cross-repo standards enforcement
- Contract-impact analysis (detecting when a change in one repo breaks a contract consumed by another)
- Atomic cross-repo merges
- Per-repo standards overlays
- Fleet management (managing repos that are *not* part of a single product)

These remain open for follow-up specs once the orchestration spine lands.
