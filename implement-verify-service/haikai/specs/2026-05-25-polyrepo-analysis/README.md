# Polyrepo / Multi-Repo Product Support

This spec folder is the source of truth for the multi-repo product
orchestration work on branch `spec/multi-repo-product-orchestration`.

## Documents

| File                                | Purpose                                                            |
|-------------------------------------|--------------------------------------------------------------------|
| `spec.md`                           | Core design — KV map, init, CRUD, pipeline fan-out, failure modes. |
| `planning/requirements.md`          | 11 functional + 7 non-functional requirements. References the open decisions where shapes are not yet fixed. |
| `planning/open-decisions.md`        | OD-1 (obsoleted) / OD-2 (resolved 2026-05-27 — NOT REQUIRED) / OD-3 (still open, defer-until-needed). |
| `tasks.md`                          | 8 phases with checkbox tasks. Status per phase (unblocked / blocked) is at the top. |
| `analysis.md`                       | Pre-spec study using the `spring-petclinic-rest` + `spring-petclinic-vue` pair. |
| `multi_repos_2_options.md`          | Earlier solution comparison (kept for context).                    |
| `ui-concerns.md`                    | Four UI edge cases resolved — monorepo identification, sub-dir naming, etc. |
| `flow-diagram/`                     | Standalone React Flow app — interactive walkthrough of the 5 CRUD scenarios and explain-panels on every node. Build with `pnpm install && pnpm run build` under `flow-diagram/client/`. |
| `thread/`                           | Original Slack thread transcripts.                                 |

## User-facing reference

See `docs/POLYREPO.md` at the repo root for the API + on-disk layout
reference.

## Status

- **Phase 1** Data Model & `coordination.yaml` — landed.
- **Phase 2** GitManager × N from init route, atomic rollback — landed.
- **Phase 3** CRUD endpoints with re-init on PUT — landed.
- **Phase 4** Orchestrator `project_dir` + `--add-dir` per repo — landed.
- **Phase 5** write-spec NN repo attribution — **obsoleted** by OD-2 empirical trial (2026-05-27): the LLM produces coherent cross-repo work without attribution scaffolding at tested scale. See `haikai/specs/2026-05-27-od2-empirical-test/findings.md`.
- **Phase 6** create-tasks `[@repo:]` + cross-repo deps — **defer-until-needed** (OD-3 still open; no real feature has surfaced the need).
- **Phase 7** implement-tasks fan-out — **defer-until-needed** (consumer of OD-3).
- **Phase 8** Migration, convention, docs — landed.

## Reading order

If you're new to the work:

1. `flow-diagram/` — load `client/dist/index.html` in a browser, walk the
   five scenarios, and click every node for the explain panels. These
   panels reference real files in `src/` and are the most concrete view
   of the target state.
2. `spec.md` — the design rationale in prose.
3. `planning/requirements.md` — the formal FR/NFR breakdown.
4. `tasks.md` — what's been built and what's still open.
5. `planning/open-decisions.md` — OD-2 resolved; OD-1 obsoleted; OD-3 deferred.
