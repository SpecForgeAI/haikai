# Parallel Runs via Git Worktrees — worktree-per-job for orchestrate + repair

**Status: GRILLED against code 2026-07-03 (transcript
`.haikai/grill/260703-2218-parallel-worktrees/`). Four corrections: verify
jobs get detached worktrees at the bound SHA (D11 — also fixes a
PRE-EXISTING wrong-tree verdict bug); D8's "branch under repair" premise was
wrong (repair orchestrations are just runs; BUG_INVESTIGATION excluded +
gains the project lock); session transplant needs re-homing code
(restore_session_from_spec is hardwired — D7 revised, copy-as-is);
worktree mode is default ON with `WORKTREE_RUNS=off` escape (D12).
Research: agent-os/planning/2026-07-03-git-worktrees-parallel-dev-research.md
(scope decisions §6). Ready to shape.**

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

- **BUG_INVESTIGATION worktrees.** `run_bug_investigation` fixes the live
  tree in place, uncommitted (tasks.py:1419-1468) — an ephemeral worktree
  would destroy its output at reclaim. It stays on the live checkout but
  GAINS the project git lock (grill Q2: today it holds NO lock and races
  concurrent orchestrations — a pre-existing hazard this spec closes).
  Its in-place/no-commit/haibox-callback semantics are untouched.
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
   target; `git worktree lock --reason "run <job_id> active"`. Allocation
   also SEEDS the untracked live-checkout state a fresh worktree lacks
   (grill-verified): `.haikai/config.json` (gitignored via
   gitignore_patterns.yml:5-10; without it `GitManager.load_config`
   raises "Project config not found", git_manager.py:218-223), the
   product-root `coordination.yaml` copy (polyrepo), and the
   active-session pointer + transcript (D7).
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

Grill corrections (the lock's true extent today — tasks.py:745 is its ONLY
call site):

- **`consolidate_and_deploy` joins the narrowed lock** for its own
  `worktree add`/`remove` (tasks.py:1223, 1246): it runs deliberately
  OUTSIDE the current lock ("Deploy runs after, on an isolated worktree",
  tasks.py:743-744), which was safe when nothing else touched
  `.git/worktrees/` — under parallel runs its registry mutations must
  serialize with allocation/reclaim. (Its unlocked merge base — default
  branch at `worktree add` time — is a PRE-EXISTING race, unchanged by
  this spec; noted, not fixed.)
- **`run_bug_investigation` acquires the lock too** (see Non-goals): today
  it mutates the live tree with no lock at all.
- **Linked-worktree `.git`-file fix**: `prepare_for_commit`'s stale-lock
  removal hardcodes `project_dir/.git/index.lock`
  (git_manager.py:346-350) — in a linked worktree `.git` is a FILE and the
  real index lock lives at `<main>/.git/worktrees/<name>/index.lock`, so
  the cleanup silently no-ops. Resolve via
  `git rev-parse --git-path index.lock` instead of path concatenation.

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

### D7 — Session identity and state coupling (REVISED per grill Q3)

- The CLI executor's `project_dir` (and cwd, claude_cli_executor.py:294)
  points at the run root — which automatically forks the Claude CLI
  session store (`~/.claude/projects/<encoded project_dir>/`,
  claude_chat_executor.py:1416) and `.claude/active_session.json`
  (session_store.py:21-26). The "one active session per project"
  singleton becomes one per RUN with no session-store rewrite.
- **Session transplant needs NEW re-homing code** (grill-verified: the
  original "the transplant primitive already exists" claim was FALSE).
  `restore_session_from_spec` (claude_chat_executor.py:1451-1492) is
  hardwired to `self.project_dir = workspace_dir/company/project`
  (line 168) on BOTH ends — no target parameter exists. Required changes:
  the executor gains an explicit `project_dir` override (the worktree run
  root), and the restore/copy targets the WORKTREE's encoded session dir
  (`get_session_file` encoding, lines 1404-1414). Transplant = copy the
  transcript jsonl + active-session pointer into the run root's encoded
  dir and `.claude/`, then `--resume <session_uuid>` with cwd = run root.
- **Copy AS-IS (grill Q3 decision)**: the transcript's historical records
  keep the shared checkout's absolute `cwd`/paths — accepted; new tool
  calls resolve against the new cwd, the transcript stays a faithful
  record (the spec-folder backup keeps the original), and a field-level
  rewriter is a later hardening option only if stale-path references
  actually bite.
- **The job record persists `worktree_root`** (like `logs_path`,
  tasks.py:638; migration precedent `resume_from_step`,
  job_storage.py:75-81 — NB `save_job`'s positional 15-placeholder
  `INSERT` must be bumped in lockstep). Recovery (`recovery.py:174-178`
  reads `haikai/specs/<spec>/active_session.json`), cancel, and the
  sweeper resolve the run's tree from the job record — never from
  convention.

### D8 — Repair orchestrations are runs; no "branch under repair"
(REWRITTEN per grill — the original premise was wrong)

The sanctioned repair path is a fresh repair ORCHESTRATION dispatched by
`enqueue_cli` with a validated `repair_of` (verify-task-group.md:50
explicitly forbids routing `real` repairs through `/haikai:fix`/
bug-investigation — that path never re-runs CI, so the gate can never
re-fold). A repair orchestration creates a NEW `feature/<spec>-repair-…`
branch via `_git_one_spec` (tasks.py:423-426, `source="repair"` CI
binding); it never checks out the failing run's branch. Therefore:

- **Repair jobs need no special worktree logic**: a repair orchestration
  is `run_orchestration` in repair mode and gets a run worktree under D1/D2
  exactly like any other run. The "branch under repair" concept is
  dissolved, and with it the branch-resolution gap (no table stores a
  branch; `ci_bindings` has `head_sha` only, store.py:49-58 — irrelevant
  now for repair, still used by D11 verify pinning).
- **BUG_INVESTIGATION jobs are excluded** from worktree mode and gain the
  project git lock (see Non-goals; grill Q2).

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
concerns. The one consumer that DID depend on the live tree's incidental
state is inline verify — resolved by D11.

### D11 — Verify jobs get a detached worktree at the bound SHA
(ADDED per grill Q1 — also fixes a PRE-EXISTING bug)

Grill evidence: inline verifiers execute pinned repo commands against
whatever the tree at `cwd` currently holds (`inline_runner.py:81-135`
never inspects or sets branch/commit; the inline session path
verify-task-group.md:23 shells out in the repo tree), and
`run_verify_task_group` never positions the tree (tasks.py:922-955 — the
command line carries correlation keys only). Today the live tree is left
on `feature/<batch>` after batch runs but reset to DEFAULT after
single-spec runs (tasks.py:406, git_workflow.py:118) — **single-spec
inline verdicts already score the wrong tree**. Under W1 every inline
verdict would score default.

v1 therefore pins verify:

- `run_verify_task_group` resolves the cell's bound SHA
  (`ci_bindings.head_sha` via `get_binding_for_cell`, store.py:422-425)
  and allocates a READ-ONLY detached worktree:
  `git worktree add --detach <verify_root> <head_sha>` (the
  `consolidate_and_deploy` pattern), reclaimed after the session — same
  W3 ladder, same lock (D5) for add/remove.
- The verify CLI session's cwd = that verify worktree; inline verifier
  commands now deterministically score the commit whose CI verdict opened
  the gate.
- No binding / SHA unknown → run on the live checkout as today and record
  the fact as evidence (explicitly visible, not silent) — a cell that
  never had CI bound has no pinned commit to score.
- ADR 0001 records the verdict-semantics change.

### D12 — Rollout: default ON, explicit off-switch (grill Q4)

Worktree mode is the standard path for orchestrate/repair/verify jobs.
`WORKTREE_RUNS=off` is an explicit per-deployment escape (brownfield
projects) that restores today's serialized live-tree behavior including
the full-phase `_project_git_lock`. Under worktree mode, unsupported
repos (submodules) FAIL FAST with a clear error — never a silent fallback
to the live tree (W5; matches the no-fallback CHAT_EXECUTOR philosophy).

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
- **W10.** Inline verify verdicts are pinned: the verify session scores a
  detached worktree at the cell's bound `head_sha`, never incidental live
  tree state (D11; unpinnable cells run live and say so in evidence).
- **W11.** Worktree mode is default ON; `WORKTREE_RUNS=off` is the only
  escape, and unsupported repos fail fast under worktree mode (D12).

## Grill resolutions (2026-07-03, transcript
`.haikai/grill/260703-2218-parallel-worktrees/`)

- **G1 → D11/W10.** Verified: inline verify scores incidental tree state;
  single-spec runs already verify the WRONG tree (default) today.
  Decision: detached verify worktree at `ci_bindings.head_sha` (ADR 0001).
- **G2 → D7 revised.** Verified FALSE: `restore_session_from_spec` cannot
  re-home (hardwired project_dir both ends, claude_chat_executor.py:168,
  1451-1492). Decision: parameterize + copy transcript AS-IS into the
  worktree's encoded dir; stale historical paths accepted.
- **G3 → D12.** Default ON + `WORKTREE_RUNS=off`; fail-fast, no fallback.
- **G4 → D2 allocation seeding.** Verified: `.haikai/config.json`,
  `coordination.yaml`, `.claude/active_session.json` are ALL untracked
  live-checkout state a fresh worktree lacks (config.json absence makes
  `GitManager.load_config` raise). Allocation seeds them. No durable
  records leak worktree paths (ci_bindings/verdicts/repairs store keys +
  SHA only); `worktree_root` on the job record is deliberate.
- **G5 → D5 corrections.** Verified: shared refs mean deploy FINDS
  worktree-created branches (no fetch needed), but its own
  `worktree add/remove` runs outside any lock today → joins the narrowed
  lock. Its merge-base race is pre-existing and out of scope.
- **Bonus findings folded in:** repair premise rewrite (D8);
  BUG_INVESTIGATION excluded + locked (Non-goals); linked-worktree
  `.git`-file `index.lock` fix (D5); `save_job` positional-INSERT footgun
  (D7).

## Implementation sequence (revised post-grill)

1. **Queue hardening** — jobs.db `busy_timeout`, worker
   `claim_next_queued_job(worker_id)`; regression tests for concurrent
   heartbeat/progress writers.
2. **Worktree allocator module** (`src/git/worktree_runs.py`) —
   allocate/reclaim/sweep, untracked-state seeding (config.json /
   coordination.yaml / session pointer), narrowed lock, Windows removal
   ladder, linked-worktree `index.lock` fix
   (`git rev-parse --git-path`), L1-parity tests (zero leftover
   registrations, reclaim-on-failure). `consolidate_and_deploy`'s
   worktree ops join the lock; `run_bug_investigation` acquires it.
3. **Session re-homing** — executor `project_dir` override + transplant
   copy into the worktree's encoded session dir (copy as-is);
   `worktree_root` on the job record (model + PRAGMA migration +
   positional INSERT bump + `_row_to_job`).
4. **Orchestration integration** — `run_orchestration` allocates (normal
   AND repair mode — D8), points orchestrator/GitManager/executor at the
   run root, persists `worktree_root`, transplants the session; reclaim
   in finally; `WORKTREE_RUNS` knob.
5. **Batch + polyrepo parity** — `_git_one_spec`/`_finalize_batch_git`
   inside the run root; product-root→repo-subdir sync unchanged;
   branch-collision fail-fast.
6. **Verify pinning (D11)** — `run_verify_task_group` detached worktree
   at `ci_bindings.head_sha`; unpinnable-cell evidence; ADR 0001.
7. **Recovery/cancel/sweeper** — resolve trees from `worktree_root`;
   cancel triggers reclaim; startup + periodic sweep.
8. **Parallel evidence** — N workers up; two same-project runs
   concurrently → two MRs, live tree untouched, `git worktree list` clean
   after; both runs live on the Run Flow Graph.
9. **Graph evidence emission** — worktree allocated/reclaimed evidence on
   run root / repair attempt.
