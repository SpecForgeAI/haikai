# Parallel Runs via Git Worktrees — worktree-per-job for orchestrate + repair

**Status: SHAPED from research (agent-os/planning/
2026-07-03-git-worktrees-parallel-dev-research.md, scope decisions §6).
NOT yet grilled against code.**

## Product definition

> Every orchestration and repair job runs in its own ephemeral git worktree
> set, on its own branch, with its own CLI session identity — so multiple
> jobs against the SAME (company, project) execute concurrently without
> cross-contamination, each producing its own MR. The shared live checkout
> becomes a quiet clone anchor that no job mutates.

Core invariant the feature is shaped around:

> The unit of parallelism is the RUN. A run (single-spec or multi-spec
> batch) owns one worktree set, one branch namespace, one CLI session, one
> MR. Coupled specs inside a batch stay sequential inside that one run;
> parallelism happens ACROSS independent runs.

This replaces serialization-by-lock with isolation-by-worktree. Today
`_project_git_lock` (tasks.py:133-144, held over the entire generate+commit
phase at tasks.py:738-760) exists precisely because two same-project jobs
"would race on that tree and cross-contaminate commits" (R8). Worktrees
dissolve the race instead of queueing behind it.

## Prior art (this repo)

- **`consolidate_and_deploy`** (tasks.py:1192-1247) — the production
  template: isolated detached worktree in a tempdir, "NEVER by mutating the
  live repo", `finally:` remove --force + rmtree; tests assert ZERO leftover
  `.git/worktrees/` registrations (test_consolidate_deploy.py, e2e L1).
- **haikai:fix worktree-per-group** (skill references/fix.md:73-95) — one
  branch + worktree per independent group, one agent per worktree,
  sequential merge-back, remove after.
- **Multi-spec batch** (agent-os/specs/2026-06-24-multi-spec-batch-single-mr)
  — N coupled specs → N commits on ONE branch (`feature/<batch_name>`) →
  one MR via `_finalize_batch_git` (tasks.py:431-487). This model is
  PRESERVED: a batch is one run, one worktree set, one MR.
- **Multi-worker claim already built**: `claim_next_queued_job(worker_id)`
  (job_storage.py:144-184, IMMEDIATE txn + lost-race retry) — unused; the
  worker calls the deprecated single-worker shim (worker.py:99).
- **Cross-platform inter-process lock**: `src/file_lock.py` (msvcrt/fcntl)
  with lock files at `<workspace>/.locks/` outside any repo.
- External convergence (2025-26): all surveyed agent orchestrators use
  worktree-per-agent, branch-per-run → push → MR each. Windows criticals:
  kill child processes BEFORE `worktree remove`; short worktree roots;
  `core.longpaths`.

## Non-goals (v1)

- **Verify-task-group worktrees.** Verify reconstructs from the
  verification DB and CI verdicts; it keeps the live checkout in v1. (Its
  tree-state assumptions are a grill item, G1 below.)
- **Our own dev-workflow conventions** (Claude Code worktrees on this
  monorepo) — separate concern, harness support already exists.
- **Long-lived per-feature worktrees** — v1 worktrees are ephemeral per
  job; resume/recovery re-creates from the run's branch.
- **In-process job pool.** v1 scales with N worker PROCESSES; threading
  jobs into one process (needs `_reload_modules` + PYTHONPATH fixes,
  worker.py:57-90, tasks.py:943-945) is out.
- **Local integration / merge queue.** Merge-back is push + MR per run
  (today's flow); `consolidate_and_deploy` remains the deploy-time
  integration point.
- **Submodule support.** Target repos with submodules are out of v1 (git
  worktree submodule support is officially incomplete); explicitly refuse
  worktree mode for them rather than half-work (W5 no-guess).
- Virtual-branch systems (GitButler etc.) — rejected; worktrees compose
  with the existing branch/MR/CI machinery.

---

## Decisions

### D1 — Unit of parallelism: the run

One job = one run = one worktree set = one branch namespace = one MR.

- Single-spec run: one worktree (single-repo) or one worktree per repo
  folder (polyrepo), one `feature/<spec>` branch (per repo target), one PR/MR.
- **Multi-spec batch run: unchanged semantics.** N coupled specs execute
  SEQUENTIALLY inside the run's one worktree set, committing N commits onto
  the one `feature/<batch_name>` branch, finalized to one MR by
  `_finalize_batch_git`. Coupled specs are never split across worktrees or
  parallelized against each other — their coupling is why they share a
  branch.
- Parallelism = independent runs (different specs, different batches,
  repair jobs) each in their own worktree set, concurrently, same project.

### D2 — Worktree lifecycle: ephemeral, always reclaimed

Allocation at job start, reclamation at job end (success, fail, cancel),
extending the tested L1 invariant from `consolidate_and_deploy`:

1. **Allocate**: under the project git lock (narrowed, D5):
   `git worktree add <run_root>/<folder> -b <branch> <base>` per repo
   target; `git worktree lock --reason "run <job_id> active"`.
2. **Work**: everything the job does — CLI session, file generation,
   `_git_one_spec` commits, push — happens inside `<run_root>`.
3. **Reclaim** (in `finally`): kill any child processes with cwd inside the
   worktree (the CLI session subprocess tree) → `git worktree unlock` →
   `git worktree remove` → on Windows failure: retry with backoff →
   `remove --force` → delete contents → `git worktree prune`. Never a bare
   rmtree without prune.
4. **Sweep**: worker startup + periodic sweeper reclaims worktrees whose
   job is no longer RUNNING (crash debris), using the job-persisted
   worktree path (D7) — never by parsing directory names.

Commits are safe from reclamation by construction: worktrees share the one
object store and refs namespace, so a pushed (or even just committed)
branch survives worktree removal. Resume/recovery re-creates a worktree
from the run's branch instead of resuming a stale tree.

### D3 — Placement and naming (Windows path budget)

- Run root: `<API_WORKSPACE_DIR>/wt/<job_id_first8>/` — SHORT, outside any
  repo, sibling of the per-project checkouts. Polyrepo: one worktree per
  repo folder under it (`wt/<id8>/<folder>`), plus copies of product-root
  coordination files (`coordination.yaml`) so `_resolve_repo_targets` and
  the product-root→repo-subdir file sync (tasks.py:381-390) work unchanged
  inside the run root.
- `git config core.longpaths true` on the shared repo config at init;
  worktree dirs never nested under the checkout.
- Branch names: UNCHANGED (`feature/<spec>`, `feature/<batch_name>`,
  `--<folder>` polyrepo suffix). No run-id suffixes — see D4.

### D4 — Branch collision policy: fail fast, never guess

Two concurrent runs wanting the same branch name (same spec re-dispatched,
same batch name) is a USER error, not something to silently uniquify:

- `git worktree add -b <branch>` fails if the branch is checked out in
  another worktree — the one-branch rule is the free mutex. The job fails
  fast at allocation with an explicit "branch <x> is active in run <y>"
  error; nothing is enqueued as half-state.
- A branch that exists but is NOT checked out anywhere (previous completed
  run) is reused/reset by the existing `create_feature_branch` semantics —
  same behavior as today, now scoped to the run's worktree.

### D5 — Locking narrowed to shared-`.git` mutations

`_project_git_lock` stops guarding the generate+commit phase (worktree
isolation replaces it) and is retained ONLY around operations that mutate
the shared `.git`: `worktree add/remove/prune` and initial branch creation.
Held for seconds, not the length of a run. Commits/pushes from separate
worktrees rely on git's own per-ref locking (each worktree has its own
index; objects are content-addressed; concurrent pushes of different
branches are safe). Lock files stay at `<workspace>/.locks/` outside any
repo.

### D6 — Parallel-N prerequisites: jobs.db + worker claim

Before two jobs can run at once, harden the queue (the graph/verification
store is already concurrency-tolerant; jobs.db is not):

- `JobStorage._connect` gains `PRAGMA busy_timeout` (mirror
  store.py:163's 5000ms; jobs.db today fails instantly with "database is
  locked" — job_storage.py:21-36).
- `worker.py:99` switches from the deprecated `get_next_queued_job()` shim
  to `claim_next_queued_job(self.worker_id)` so N workers claim under
  distinct identities.
- Scale = N worker processes (`WORKER_ID` env already plumbed,
  worker.py:46; docker-compose service scales or local stack profile
  starts N).
- The API in-process background path (jobs.py:292 →
  api/__init__.py:603-634) needs no special-casing: allocation lives
  INSIDE `run_orchestration`/`run_bug_investigation`, so every execution
  path gets a worktree automatically.

### D7 — Session identity and state coupling

- The CLI executor's `project_dir` (and cwd, claude_cli_executor.py:294)
  points at the run root — which automatically forks the Claude CLI
  session store (`~/.claude/projects/<encoded project_dir>/`,
  claude_chat_executor.py:1416) and `.claude/active_session.json`
  (session_store.py:21-26). The "one active session per project"
  singleton becomes one per RUN with no session-store rewrite.
- **Session transplant**: orchestrate requires the shape-spec session
  (tasks.py:543-551), which was created against the SHARED checkout's
  project_dir. At allocation, the run root gets the active-session pointer
  copied in, and the session jsonl is restored into the worktree's encoded
  project dir via the existing `restore_session_from_spec` mechanism
  (claude_chat_executor.py:1419-1468) — the transplant primitive already
  exists.
- **The job record persists `worktree_root`** (like `logs_path`,
  tasks.py:638). Recovery (`recovery.py:174-178` reads
  `haikai/specs/<spec>/active_session.json`), cancel, and the sweeper
  resolve the run's tree from the job record — never from convention.

### D8 — Repair jobs: worktree on the branch under repair

`run_bug_investigation` (tasks.py:1375) allocates a worktree checked out
on the branch its `repair_of` target was built from (resolved from the
validated repair target / CI binding — never guessed, I16 parity). The
`/haikai:debug` + `/haikai:fix` session runs there; the fix commits+pushes
to that same branch; CI re-runs; the verdict re-folds the original cell —
the self-repair loop unchanged, minus the live-tree contention. If the
branch is still checked out by a live run's worktree, allocation fails
fast (D4) — repairing a branch mid-run is refused, not interleaved.

### D9 — Run Flow Graph tie-in

Worktree lifecycle is EVIDENCE, not structure (I14): allocation attaches
`{"evidence_kind":"artifact","ref":"worktree://<job_id>","label":"worktree
allocated <run_root>"}` to the run root (or repair attempt), reclamation
updates it. Parallel runs are separate `orchestrate_id`s and already render
as separate live graphs; graph_events is concurrency-tolerant by design
(IMMEDIATE + busy_timeout + idempotent declares).

### D10 — The live checkout becomes read-mostly

After v1, orchestrate/repair jobs never mutate
`<workspace>/<company>/<project>`: it stays on the default branch, serving
as clone anchor (`.git` host), shape-spec session home, and fetch target.
`checkout_back_to_default` between specs and the untracked-file rescue in
`create_feature_branch` (git_manager.py:265-307) become worktree-scoped
concerns. Anything else that assumed "the live tree holds the run branch
after orchestration" must be found and adjusted (grill item G1).

---

## Invariants

- **W1.** Orchestrate/repair jobs never mutate the live checkout; it stays
  on the default branch.
- **W2.** One run = one worktree set = one branch namespace = one MR;
  coupled batch specs stay sequential inside one run.
- **W3.** Every worktree is reclaimed (kill children → unlock → remove →
  prune) on every exit path; a sweeper reclaims crash debris; tests assert
  ZERO leftover `.git/worktrees/` registrations (L1 parity).
- **W4.** Shared-`.git` mutations (worktree add/remove/prune, branch
  creation) are serialized under the narrowed project lock; nothing else is.
- **W5.** Branch collisions and unsupported repos (submodules) fail fast
  with explicit errors — never silent uniquify, never guess, no fallback
  to the shared tree.
- **W6.** Each run has its own CLI session identity, forked by project_dir;
  shape sessions are transplanted via the existing restore mechanism.
- **W7.** The job record is the source of truth for the run's
  `worktree_root`; recovery/cancel/sweeper resolve paths from it only.
- **W8.** Windows discipline: short run roots, `core.longpaths`, kill
  child processes before removal, prune after any forced cleanup.
- **W9.** Parallel-N is gated on jobs.db `busy_timeout` + atomic
  per-worker claim landing first.
- **W10.** A repair worktree checks out exactly the validated branch under
  repair; mid-run branches are refused, not interleaved.

## Grill items (open questions to stress against code)

- **G1**: What does `run_verify_task_group` (and any inline verifier)
  actually assume about the live tree's checked-out state? Today the tree
  may hold the run branch post-orchestration; under W1 it never will.
- **G2**: Exact mechanics of the shape-spec session transplant — does
  `restore_session_from_spec` fully cover re-homing to a new encoded
  project dir, or does `--resume` need the session file pre-seeded?
- **G3**: Default-on vs opt-in env knob for worktree mode (brownfield
  caveat: target repos may not be worktree-friendly).
- **G4**: `_record_ci_binding`, MR URLs, and `.haikai/config.json`
  (git_manager.py:535-548) — any absolute paths or per-checkout state that
  leak the worktree path into durable records?
- **G5**: Does `consolidate_and_deploy`'s branch-merge integration need
  awareness of branches created in worktrees (it shouldn't — shared refs)?

## Implementation sequence

1. **Queue hardening** — jobs.db `busy_timeout`, worker
   `claim_next_queued_job(worker_id)`; regression tests for concurrent
   heartbeat/progress writers.
2. **Worktree allocator module** (`src/git/worktree_runs.py`) —
   allocate/reclaim/sweep, narrowed lock, Windows removal ladder,
   L1-parity tests (zero leftover registrations, reclaim-on-failure).
3. **Orchestration integration** — `run_orchestration` allocates, points
   orchestrator/GitManager/executor at the run root, persists
   `worktree_root`, session transplant; reclaim in finally.
4. **Batch + polyrepo parity** — `_git_one_spec`/`_finalize_batch_git`
   inside the run root; coordination.yaml copy; product-root→repo-subdir
   sync unchanged; branch-collision fail-fast.
5. **Repair integration** — `run_bug_investigation` worktree on the
   validated branch under repair.
6. **Recovery/cancel/sweeper** — resolve trees from `worktree_root`;
   cancel triggers reclaim; startup + periodic sweep.
7. **Parallel evidence** — N workers up; two same-project runs
   concurrently → two MRs, live tree untouched, `git worktree list` clean
   after; both runs live on the Run Flow Graph.
8. **Graph evidence emission** — worktree allocated/reclaimed evidence on
   run root / repair attempt.
