# Tasks: Multi-Repo Product Support

**Status:** PARTIAL — Phases 1–4 + 8 LANDED. Phases 5/6/7 BLOCKED.
**Source spec:** `spec.md`
**Requirements:** `planning/requirements.md`
**Open decisions blocking Phases 5/6/7:** `planning/open-decisions.md`
**Diagram:** `flow-diagram/` (interactive walkthrough)
**User-facing reference:** `../../../docs/POLYREPO.md`

Phases 1–4 and Phase 8 have landed on `spec/multi-repo-product-orchestration` and ship the data layer, the CRUD surface, the orchestrator session-mount changes, and the convention + docs. OD-2 was resolved 2026-05-27 as **NOT REQUIRED** by empirical trial (see `haikai/specs/2026-05-27-od2-empirical-test/findings.md`); Phase 5 is substantively complete via that trial. OD-1 is also obsoleted as a cascade (without NN attribution there is no `paths_touched` to persist). Phases 6/7 remain paused pending OD-3 in `planning/open-decisions.md`, defer-until-needed.

Each phase is self-contained — landed as its own commit on the spec branch (see git log).

---

## Phase 1: Data Model & coordination.yaml

- [x] T1.1 Add `repos: Dict[str, str]` field to `ProjectInitRequest` in `src/git/models.py`. Validators: non-empty, folder name regex (`^[a-z][a-z0-9_-]*$`), URL well-formed, all folders unique (free), all URLs unique (explicit validator).
- [x] T1.2 Accept legacy `repo_url: str` body; promote internally to `{<project>: <repo_url>}` for backward compat.
- [x] T1.3 Create `src/git/coordination.py` with `read_coordination(product_root) -> Dict[str, str]` and `write_coordination(product_root, repos)` using temp-file + rename for atomic writes.
- [x] T1.4 Define `CoordinationError` for malformed/missing files; surface as `400` from API routes.
- [x] T1.5 Unit tests: dup-folder rejected (post-Pydantic), dup-URL rejected, single-entry round-trip, multi-entry round-trip, malformed YAML surfaces `CoordinationError`.
- [x] T1.6 Unit tests: legacy `repo_url` body produces a one-entry KV map with project-name folder.

## Phase 2: GitManager × N from init route

- [x] T2.1 Refactor `POST /projects/init` in `src/api/routes/projects.py` to: validate map → create product root → loop entries → instantiate `GitManager(product_root / folder)` per entry → call `gm.init_project(url)` → on any failure, roll back the whole workspace.
- [x] T2.2 `_safe_project_dir(company, project)` semantics shift: returns the product workspace root (parent of all repo sub-dirs). No call-site change required since the parent dir is already what callers used as `project_dir`.
- [x] T2.3 After all clones succeed, write `coordination.yaml` at the product root.
- [x] T2.4 Response shape: `ProjectInitResponse` carries `project_dir` (product root) plus `repos: List[{folder, dir, mode}]`. Keep top-level `mode` field for backward compat: equals the single repo's mode when N=1, else `"polyrepo"`.
- [x] T2.5 Confirm `GitManager` itself remains unchanged (per NFR-3). Any diff to `git_manager.py` in this phase is a smell.
- [x] T2.6 Unit tests: N=1 path identical to today's `init_project` behaviour; N=3 all-clone success populates 3 sub-dirs + 1 `coordination.yaml`; N=3 with one unreachable URL → workspace fully cleaned, no `coordination.yaml` written.
- [x] T2.7 Integration test: init a 2-repo product from the petclinic pair (`spring-petclinic-rest` + `spring-petclinic-vue`), verify both sub-dirs cloned and `coordination.yaml` has both entries. *Landed in `tests/test_polyrepo_petclinic_integration.py` — network-gated (`@pytest.mark.network` + `RUN_NETWORK_TESTS=1`), real clones via `git`, asserts `pom.xml` + `package.json` + brownfield mode + re-init guard. ~5s runtime.*

## Phase 3: CRUD endpoints with re-init on PUT

- [x] T3.1 `GET /projects/{c}/{p}/repos` — read `coordination.yaml`, return the map.
- [x] T3.2 `POST /projects/{c}/{p}/repos` body `{folder, url}` — validate both uniqueness constraints against the current map, clone into `product_root/{folder}`, rewrite `coordination.yaml`.
- [x] T3.3 `PUT /projects/{c}/{p}/repos/{folder}` body `{url}` — validate URL uniqueness, *tear down `product_root/{folder}/`*, re-clone from the new URL, rewrite `coordination.yaml`. Folder alias is *not* renamable.
- [x] T3.4 `DELETE /projects/{c}/{p}/repos/{folder}` — reject if it would leave the map empty. Otherwise remove `product_root/{folder}/`, rewrite `coordination.yaml`.
- [x] T3.5 All four endpoints share a small `_load_or_404` helper that errors `404` if the product root has no `coordination.yaml`.
- [x] T3.6 Unit tests, one per CRUD scenario in `flow-diagram/`: mono-init, mono-to-poly, poly-add, poly-remap, constraint-violations (dup folder, dup URL, last-entry delete).
- [x] T3.7 Integration test for PUT re-init: PUT changes `backend` from repo-A to repo-B → `product_root/backend/` reflects repo-B, no stale repo-A history. *(covered with sentinel-file check in test_polyrepo_crud.py::TestUpdateRepo::test_update_re_clones.)*

## Phase 4: Orchestrator project_dir + --add-dir

- [x] T4.1 In `src/haikai_orchestrator.py`, resolve `project_dir` to the product workspace root (already the case after Phase 2 — verify no caller hard-codes the single-repo path).
- [x] T4.2 Compute `--add-dir` list as `[product_root / folder for folder in coordination_map]`.
- [x] T4.3 Add `extra_dirs: List[Path]` kwarg to `_build_chat_executor` and downstream chat-executor factories; forward to the Claude CLI invocation as repeated `--add-dir` flags.
- [x] T4.4 Snapshot `coordination.yaml` into the orchestration request at run start (FR-10). Mid-run mutations apply to the next run.
- [x] T4.5 Unit test: N=1 orchestration emits one `--add-dir`; identical CLI argv to today.
- [x] T4.6 Unit test: N=3 orchestration emits three `--add-dir` mounts; argv contains them in folder-alias-sorted order (determinism).
- [ ] T4.7 Integration test: petclinic pair, write-spec session sees both sub-dirs via `--add-dir` mounts. *(deferred — network + live LLM gated; argv-shape coverage via test_polyrepo_orchestrator.py instead.)*

## Phase 5: write-spec nearest-neighbour repo attribution  *— OBSOLETED by empirical trial 2026-05-27*

The empirical trial (`haikai/specs/2026-05-27-od2-empirical-test/findings.md`) showed the LLM produces fully coherent cross-repo work **without** explicit attribution scaffolding when every repo is mounted via `--add-dir` and git's working-directory boundaries handle per-repo commit attribution implicitly. NN attribution is not a correctness gate; the original Phase 5 task list is therefore stood down.

- [x] T5.6 (re-purposed) Integration test on the petclinic pair — **DONE** via the empirical trial above (Trial P: backend + frontend with exact cross-repo contract match, +268/−22, zero mis-attribution).
- [ ] T5.1–T5.5 Retained as **DEFER-UNTIL-NEEDED**. Re-open only if a future feature surfaces evidence the LLM cannot coherently route work without explicit attribution (e.g., N > 2 repos, typed contracts spanning 3+ files per repo, or a non-localised feature).

## Phase 6: create-tasks repo annotation + cross-repo deps  *— BLOCKED by OD-3*

The `[@repo:<alias>]` annotation on task groups is settled. The cross-repo dependency syntax is not — see OD-3. The dep-syntax tasks are placeholders pending that decision.

- [ ] T6.1 In `create-tasks` skill template, document the `[@repo:<alias>]` annotation format on task groups.
- [ ] T6.2 Document the cross-repo dependency syntax decided in OD-3 — *unimplemented, awaiting decision*.
- [ ] T6.3 Update `src/haikai_crud_models.py` task-group parsing to extract `[@repo:]` annotation and the cross-repo dependency field (shape pending OD-3).
- [ ] T6.4 Validator: under N > 1, any task group without `[@repo:]` annotation triggers a `400` listing the offending group titles. Pipeline halts before `implement-tasks`.
- [ ] T6.5 Unit tests: mono spec without annotation passes; poly spec with one missing annotation fails with the right error shape; cycle-detection test for cross-repo deps once OD-3 lands.

## Phase 7: implement-tasks fan-out  *— BLOCKED by OD-3 (annotation consumer)*

Fan-out logic is settled. What it consumes (the cross-repo dep grammar) is not — see OD-3. Phase 7 can start once Phase 6 is unblocked.

- [ ] T7.1 In `src/haikai_orchestrator.py` (implement-tasks step), derive the touched-repo set from task-group annotations.
- [ ] T7.2 For each touched repo: instantiate a `GitManager(product_root / folder)` (or reuse the cached one from init), pass to `apply_git_workflow(gm, spec_id)`. Helper itself unchanged (NFR-4).
- [ ] T7.3 Atomic failure path (FR-9): if any per-repo call raises, mark the run failed, leave already-opened PRs in place but flag them as `partial-failed-run` in the orchestration response. No auto-close in v1.
- [ ] T7.4 Unit tests: 2-repo touched set → 2 `apply_git_workflow` calls in folder-alias-sorted order; failure on the second → run marked failed, first PR flagged.
- [ ] T7.5 Integration test on petclinic pair: spec touching both repos produces exactly 2 PRs on the two correct remotes; spec touching only one repo produces 1 PR; spec touching zero repos produces 0 PRs and no branches.

## Phase 8: Migration, convention enforcement, docs

- [ ] T8.1 Legacy projects: auto-synthesise `coordination.yaml` on first read. *(deferred — the legacy on-disk layout puts the repo at the product root, not in a sub-directory, so auto-synth would require relocating files. Documented as a manual procedure in `docs/POLYREPO.md` for v1; an explicit migration endpoint is a follow-up spec.)*
- [x] T8.2 Mono→poly migration test: covered by `test_polyrepo_crud.py::TestAddRepo::test_add_succeeds` — init with one entry, POST a second entry, verify the first sub-directory is untouched.
- [x] T8.3 Convention check: `tests/test_polyrepo_no_mode_branches.py` greps `src/` for forbidden mono/poly branches (`if len(repos) == 1`, `if is_monorepo`, `if mode == 'mono'`, etc.) and fails if any new ones land. Allowlist for documented exemptions sits at the top of the file.
- [x] T8.4 `docs/POLYREPO.md` lands as the user-facing reference — KV map shape, init body, CRUD surface, on-disk layout, failure semantics, migration guidance.
- [x] T8.5 `haikai/specs/2026-05-25-polyrepo-analysis/README.md` lands as the navigation index for the spec folder.
- [x] T8.6 Diagram cross-links: the spec README points at `flow-diagram/` and recommends opening the React Flow walkthrough as the first step for new readers.

---

## Verification gates between phases

- After Phase 2: a 2-repo product can be initialised via API and the workspace is laid out correctly. No pipeline work yet.
- After Phase 4: a pipeline run starts a Claude session mounted at the product root with N `--add-dir`s. No write-spec changes yet.
- After Phase 5: `write-spec` produces a `paths_touched` map. No tasks changes yet.
- After Phase 6: `tasks.md` carries `[@repo:]` annotations and validation fires correctly. No fan-out yet.
- After Phase 7: end-to-end petclinic spec run produces 2 correct PRs. Spec is feature-complete.
- After Phase 8: legacy projects auto-migrate; convention enforced; docs aligned.

Each verification gate is a logical PR boundary. Land them in order.
