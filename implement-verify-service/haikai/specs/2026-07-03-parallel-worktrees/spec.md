# Parallel Runs via Git Worktrees — worktree-per-job for orchestrate + repair + pinned verify

**Status: v2 — GRILLED (2026-07-03, `.haikai/grill/260703-2218-parallel-worktrees/`)
then ADVERSARIALLY REVIEWED via reason run (2026-07-03/04,
`.haikai/reason/260703-worktrees-spec-review/final-review.md`, verdict
CONFIRM-WITH-CHANGES) and REVISED with the user's rulings 2026-07-04.
All review findings F1-F13 + amendments M1-M3 are folded in below.
READY TO IMPLEMENT.**

## Product definition

> Every orchestration and repair job runs in its own ephemeral git worktree
> set, on its own branch, with its own CLI session identity — so multiple
> jobs against the SAME (company, project) execute concurrently without
> cross-contamination. Verify jobs score a composite verify run-root pinned
> to each cell's bound CI SHA. The shared live checkout becomes a
> read-mostly clone anchor whose `haikai/` metadata tree is the durable
> metadata home.

Core rules the feature is shaped around:

> **Worktrees are execution sandboxes. They must not become accidental
> control-plane roots.** Ephemeral: repo checkout, CLI cwd, per-run session
> copy, dependency setup. Durable: jobs.db, verification db, logs, recovery
> metadata, canonical repair metadata, orchestration state.

> status ≠ filesystem safety · cancel ≠ reclaim · recovery-protected ≠
> disposable · observability copied out before deletion · durable
> control-plane paths never live under the worktree.

## Prior art (this repo)

- **`consolidate_and_deploy`** (tasks.py:1192-1247) — the production
  template: detached worktree in a tempdir, "NEVER by mutating the live
  repo", `finally:` remove --force + rmtree; tests assert ZERO leftover
  `.git/worktrees/` registrations (L1).
- **Multi-spec batch** (agent-os/specs/2026-06-24-multi-spec-batch-single-mr)
  — N coupled specs → N commits on ONE branch → one MR via
  `_finalize_batch_git`. Preserved unchanged (D1).
- **Atomic claim** `claim_next_queued_job` (job_storage.py:144-184) — live
  today (the deprecated shim DELEGATES to it, job_storage.py:188-189; the
  worker.py:99 change fixes identity attribution only — D6 wording fixed
  per review F9).
- **`inline_runner._kill_tree`** (inline_runner.py:63-78) — the proven kill
  idiom (`taskkill /F /T` / process-group kill) reused by D13.
- Cross-platform lock `src/file_lock.py`; locks at `<workspace>/.locks/`.
  NOTE (motivation): on Windows `exclusive_lock` raises `TimeoutError`
  after 60s — today a second same-project job FAILS, it does not queue.
  `WORKTREE_RUNS=off` restores that fail-not-queue behavior.

## Modes (D1 — unit of parallelism)

| Request shape (WORKTREE_RUNS=on) | Mode | Worktrees | Branches | MRs |
|---|---|---|---|---|
| single spec | single | 1 set | `feature/<spec>` | 1 |
| N specs + `batch_name` | **batch** (unchanged semantics) | 1 set | `feature/<batch_name>` | 1 |
| N specs, no `batch_name` | **per-spec (parallel)** | N sets: `wt/<run8>/<spec>/` | `feature/<spec>` each | N |

- **Batch**: coupled specs stay SEQUENTIAL inside one worktree set on one
  branch → one MR, exactly as today. Their coupling is why they share a
  branch.
- **Per-spec** (review F3 ruling): one orchestration run, N specs, N
  allocated worktree sets, N commits, N pushes, N MRs:
  ```
  run-123
    spec-a → wt/run-123/spec-a → feature/spec-a → MR A
    spec-b → wt/run-123/spec-b → feature/spec-b → MR B
    spec-c → wt/run-123/spec-c → feature/spec-c → MR C
  ```
  Specs execute **CONCURRENTLY** inside the run (N executor sessions; each
  spec worktree forks its own CLI session identity via its project_dir).
  Failure semantics are **INDEPENDENT** — a failed spec reports failed,
  the others push their MRs. Intra-run concurrency is bounded by
  `RUN_SPEC_CONCURRENCY` (default 2-3). Per-spec progress/resume
  bookkeeping is `(spec, step)` (D14).
- Repair orchestrations are runs (D8) and follow the single-spec row.
- Cross-run parallelism = independent jobs on N workers (D6).

## Decisions

### D2 — Worktree lifecycle: ephemeral, always reclaimed

1. **Allocate** (under the narrowed lock, D5), per repo target, using the
   D4 branch policy. Allocation SEEDS untracked live-checkout state:
   - `.haikai/config.json` (gitignored; without it `GitManager.load_config`
     raises, git_manager.py:218-223)
   - `coordination.yaml` copy (polyrepo)
   - the active-session pointer + session transplant (D7)
   - **the scoped spec tree `haikai/specs/<this run's specs>/**` +
     `coordination.lock.yaml`** (review F1 — shape-spec output is
     uncommitted live-checkout state; the orchestrator hard-fails without
     it, haikai_orchestrator.py:240-278). The SCOPED copy is the primary
     form (never the whole `haikai/` tree — avoids capturing an unrelated
     spec mid-write from a concurrent shape-spec session).
   Acceptance test: shape-spec on live checkout → orchestrate in worktree
   mode → orchestrator pre-check passes.
2. **Work**: everything the job does happens inside its worktree set.
3. **Reclaim** — gated by the D14 predicate, NEVER by job status alone.
   Order: confirm process tree dead (D13) → copy observability artifacts
   out (`<worktree>/chat_logs/` → `job.logs_path/chat_logs/`) →
   `git worktree unlock` → `remove` → Windows ladder (retry/backoff →
   `remove --force` → delete contents → `prune`). Never a bare rmtree
   without prune.
4. **Sweep**: startup + periodic sweeper applies the D14 predicate; plus
   TTL for `.git/worktrees/` registrations with no job record.

Commits survive reclamation by construction (shared object store + refs).

### D3 — Placement and naming (Windows path budget)

- Run root: `<API_WORKSPACE_DIR>/wt/<job_id8>/` — short, outside any repo.
  Per-spec mode: `wt/<job_id8>/<spec>/`. Polyrepo: repo folders under the
  spec/run root. Verify: `wt/<verify_id8>/` composite root (D11).
- `git config core.longpaths true` on the shared repo config at init.
- Branch names UNCHANGED (`feature/<spec>`, `feature/<batch_name>`,
  `--<folder>` polyrepo suffix).

### D4 — Branch policy (review F3 ruling, verbatim)

Allocation, per branch:

```
branch does not exist            → git worktree add -b <branch> <path> <base>
branch exists, active elsewhere  → FAIL CLEARLY ("branch <x> is active in
                                   run <y>" — wrapped error via
                                   `git worktree list --porcelain` pre-flight,
                                   never a raw git error or the
                                   _checkout_existing_keeping_untracked traceback)
branch exists, free              → git worktree add <path> <branch>   (no -b)
```

Worktree-safe branch creation NEVER checks out the default branch:
mid-run creation (if ever needed) uses the single command
`git checkout -b <branch> <default>` (start-point ref needs no
pre-checkout — kills the git_manager.py:260 crash, which fires in linked
worktrees because the live checkout holds default). `checkout_default_branch`
is made honest about failure (today `check=False` returns True
unconditionally, git_manager.py:481-487); worktree-mode resets use
`git checkout --detach <default>`. The legacy live-tree per-spec flow with
`checkout_back_to_default` exists only under `WORKTREE_RUNS=off`.

### D5 — Locking narrowed to shared-`.git` mutations

`_project_git_lock` (sole call site today: tasks.py:745) stops guarding
the generate+commit phase and is retained ONLY around shared-`.git`
mutations: `worktree add/remove/prune`. Held for seconds. Commits/pushes
from separate worktrees rely on git's per-ref locking.
- `consolidate_and_deploy` joins the lock for its worktree add/remove
  (today unlocked, tasks.py:1223/1246). Its merge-base race is
  pre-existing; out of scope.
- `run_bug_investigation` acquires the lock (today lockless on the live
  tree — pre-existing race closed; see Non-goals).
- Linked-worktree fix: `prepare_for_commit`'s
  `project_dir/.git/index.lock` path silently no-ops in a worktree
  (`.git` is a FILE) — resolve via `git rev-parse --git-path index.lock`.

### D6 — Parallel-N: queue, claim, workers

- `JobStorage._connect` gains `PRAGMA busy_timeout` (mirror store.py:163;
  jobs.db has none today).
- Claim wording corrected (review F9): `claim_next_queued_job` is LIVE
  (the shim delegates, job_storage.py:188-189); worker.py:99 switches to
  `claim_next_queued_job(self.worker_id)` for identity attribution.
- **API background path: enqueue-only under worker fleets** (preferred;
  CAS `UPDATE … SET status='RUNNING', claimed_by=?, claimed_at=? WHERE
  id=? AND status='QUEUED'`, proceed on rowcount==1, is the alternative
  for single-host mode). Today's unconditional RUNNING stamp + whole-row
  `INSERT OR REPLACE save_job` lets a double execution stomp live job
  rows (review F9/M-analysis).
- **Compose scaling fix (review M2)**: drop the pinned
  `container_name: standards-extractor-worker`, use replicas/`--scale`,
  derive `WORKER_ID` per replica (hostname); add an N-worker profile to
  the local stack scripts. D6's old "docker-compose service scales"
  sentence was false as written.
- Every execution path shares the same lease/heartbeat mechanism (D13/D14):
  worker, API-background, repair, verify.

### D7 — Session identity, transplant, and the ephemeral/durable split

- Executor/orchestrator `project_dir` (and cwd) point at the worktree —
  forking the CLI session store (keyed off encoded project_dir,
  claude_chat_executor.py:1404-1417) and `.claude/active_session.json`
  per RUN (per SPEC in per-spec mode) with no session-store rewrite.
- **Re-homing is NEW code** (grill G2): `restore_session_from_spec` is
  hardwired to `workspace/company/project` on both ends
  (claude_chat_executor.py:168, 1451-1492). The executor gains an explicit
  `project_dir` override; the transplant copies the **encoded session
  DIRECTORY verbatim** (sidecars included — `clear_session` treats
  sessions as directories, :1494-1517), never a single jsonl. Transcript
  content is copied AS-IS (stale historical cwd paths accepted; grill Q3).
- **Session UUIDs are project-scoped by design**
  (`uuid5(company_project)`, claude_chat_executor.py:156-157) — worktree
  isolation comes from per-run transcript/session directories, not unique
  UUIDs. **Restore MUST disambiguate by at least `(session_id,
  spec_name)`** and SHOULD include `run_id` once `active_session.json`
  carries it (review F11). Per-run uuids are follow-on hardening.
- **Session persistence canonicalized** (review F5): per-step persist
  targets the worktree spec folder AND copies back to the durable live
  spec folder; recovery reads the worktree first (via
  `job.worktree_root`), durable copy as fallback. Transcript backups are
  NEVER committed into user repos.
- **Override reach** (review F10 — the repo's helper-exists-sibling-missed
  rule applies): `HaikaiOrchestrator.project_dir` + ctor validation,
  every `create_chat_executor`/`_build_cli_executor` call site (incl.
  recovery.py:212-218, which today builds against `API_WORKSPACE_DIR` —
  wrong home for worktree jobs), polyrepo `extra_dirs`, executor-derived
  homes (`.claude/`, sessions, chat_logs).
- **Pinned globals**: jobs.db, verification store, `logs_path`/workspace
  logs, `job.logs_path`, resume/recovery evidence. Rule: *project_dir
  override is for execution-local state only; workspace_dir remains the
  durable control-plane root.* Guard test: NO durable job path resolves
  under `worktree_root`.
- **The job record persists `worktree_root`** (migration precedent
  `resume_from_step`, job_storage.py:75-81; NB `save_job`'s positional
  15-placeholder INSERT must be bumped in lockstep). Recovery, cancel,
  and the sweeper resolve paths from the job record only.

### D8 — Repair orchestrations are runs

The sanctioned repair path is a fresh repair orchestration dispatched by
`enqueue_cli` with a validated `repair_of` (verify-task-group.md:50). It
creates a NEW `feature/<spec>-repair-…` branch via `_git_one_spec`
(source="repair" CI binding) — no "branch under repair" concept. Repair
jobs get run worktrees under D1/D2 like any other run.

**Mini-spec hand-off (review F2 ruling)**: the verify session writes the
fix-task mini-spec to the **LIVE product root's `haikai/specs/`** — the
narrow, explicit W1 exception (metadata tree only, never repo code) — so
D2 seeding carries it into the repair worktree. The `enqueue_cli` repair
payload additionally carries a **sha256 checksum over the mini-spec's
planning files**; repair-run allocation re-hashes the seeded copy and
FAILS FAST on mismatch (verified hand-off; W5/I16-consistent).
BUG_INVESTIGATION jobs are excluded from worktree mode and gain the
project lock (see Non-goals).

### D9 — Run Flow Graph tie-in

Worktree lifecycle is EVIDENCE, not structure: allocation ATTACHES (not
"updates" — evidence is append-only; the fold's latest_by_kind handles
successive events) `artifact` evidence `worktree://<job_id>` on the run
root / repair attempt, emitted AFTER `_init_run_graph`; reclamation
attaches a second event. Per-spec mode: the graph gains per-spec command
chains under the one run root (one `orchestrate_id`, N four-command
sequences scoped per spec — node IDs gain the spec scope; protocol
unchanged, only emitters). Parallel runs are separate `orchestrate_id`s;
graph_events is concurrency-tolerant by design.

### D10 — The live checkout becomes read-mostly

Orchestrate/repair/verify jobs never mutate the live checkout's REPO
TREE: it stays on the default branch as clone anchor, shape-spec session
home, and fetch target. **The `haikai/` metadata tree at the product root
remains the durable metadata home** (the ONE deliberate W1 exception):
shape-spec specs, repair mini-specs (D8), session persist copy-backs
(D7). Only BUG_INVESTIGATION still edits the repo tree (under the lock).

### D11 — Verify: composite verify run-root pinned to bound SHAs
(review F7 + M3 rulings, verbatim rules)

> Polyrepo verification is not a repo worktree. It is a verify run-root
> containing (1) product-level context and (2) one detached worktree per
> repo. Do not make the product root itself a git worktree — in polyrepo
> the product root is a coordination/meta root, not a repo.

```
verify-root/<verify-run-id>/          ← session cwd
  context/
    coordination.yaml
    coordination.lock.yaml
    haikai/specs/<spec>/ (planning/, requirements.md, rubrics/, …)
  repos/
    repo-a/   # detached worktree at repo-a's bound head_sha
    repo-b/   # detached worktree at repo-b's bound head_sha
  evidence/
    setup/  command-results/  verdicts/
```

Each cell receives explicit paths: `repo_cwd = repos/<repo_id>`,
`context_dir`, `spec_dir`, `coordination_lock`. **Commands MUST NOT
assume the session cwd is a git repository.** No `haikai/` files are
copied into repo worktrees. Single-repo remains the simple case but
presents the same shape. Fetch-on-miss before
`worktree add --detach <head_sha>`. Same reclamation/protection rules as
run worktrees. This fixes the PRE-EXISTING wrong-tree verdict bug
(ADR 0001): inline verifiers score incidental tree state today —
single-spec runs verify DEFAULT.

**Pin precondition + unpinnable rule (M3 ruling): "No binding → no code
verification."**
- `ORCHESTRATE_CI_BIND` becomes **default-on when WORKTREE_RUNS=on**
  (bindings are GitLab-only today; other providers are follow-on).
- Cell requires repo code + has binding → detached worktree at bound SHA
  → verify.
- Cell requires repo code + NO binding → classified
  `UNPINNABLE`/`INFRA`: not executed, non-real, non-repairable —
  `open_repair` refused with "Cannot dispatch repair: verification cell
  has no bound repo SHA." Never fall back to the live checkout, default
  branch, branch tip, or current filesystem state.
- Context-only cells may run against `verify-root/context/` only.
- Guard before composing commands:
  `if cell.requires_repo and not binding_for_cell(cell): emit UNPINNABLE; skip`.

**Dependency bootstrap (review F6)**: per-repo pinned `setup_commands`
(beside the pinned `inline_commands`), run once at allocation,
lockfile-cache-keyed, output recorded under `evidence/setup/`; optional
fast path hardlinking dep dirs from the live checkout when lockfiles
match. Setup failure classifies the cell `infra`, never `real`.
Mandatory for verify roots; recommended for run worktrees.

**Verification db plumbing (review F8)**: the verify session command MUST
never carry a relative `--db`. `run_verify_task_group` absolutizes the
verification db path (env-anchored resolver à la `jobs_db_path`,
safe_paths.py:19-31) before composing the command — a relative default
under the new cwd would CREATE a fresh empty store inside the ephemeral
root and silently swallow guarded verdicts/repair dispatches. Guard test:
`Path(parsed_db_arg).is_absolute()`.

Acceptance tests (F7 ruling): (1) polyrepo verify never runs
`worktree add` from the product root; (2) each participating repo gets a
detached worktree at its bound head_sha; (3-4) `context/` contains
coordination.yaml + coordination.lock.yaml + spec tree + rubrics;
(5) inline commands resolve both repo cwd and spec context; (6) no
`haikai/` files inside repo worktrees; (7) a polyrepo verify cell runs
with no `.git` at the product root.

### D12 — Rollout: default ON, explicit off-switch, named retirement

Worktree mode is the standard path. `WORKTREE_RUNS=off` restores the
legacy live-tree behavior INCLUDING the full-phase lock and the
fail-after-60s-lock-timeout behavior (not queueing) — the off-switch
keeps a second code path and test matrix alive, which the spec
acknowledges explicitly with a **retirement condition**: after N green
worktree-mode releases across single/batch/per-spec/repair/verify flows,
`WORKTREE_RUNS=off` is deprecated and the legacy path removed.
Under worktree mode: unsupported repos (submodules) FAIL FAST; no silent
fallback (W5).

### D13 — Job lifecycle states + cancel semantics (review F4 ruling)

New/explicit states: `RUNNING → CANCELLING → CANCELLED`;
`RUNNING → RECOVERING → QUEUED_FOR_RESUME → RUNNING`;
`RESUMABLE_FAILED`, `FAILED_NON_RESUMABLE`, `ABANDONED` (recovery
retention expiry).

**Cancel requests termination. Reclaim follows only after process
liveness is cleared.** Flow:

```
DELETE /api/v1/jobs/{job_id}
→ mark CANCELLING
→ the JOB-OWNING process kills the tracked process tree   (M1: cancel is
  handled in the API process; the CLI subprocess may live in a different
  container — only the owner kills; cross-process liveness = heartbeat,
  never PID. Owner = worker watchdog on its heartbeat thread, or the API
  for its own in-process background jobs.)
→ confirm death → mark CANCELLED
→ copy observability artifacts → reclaim when eligible (D14)
```

Mechanism: CLI execution moves from blocking `subprocess.run` to
`Popen` + pid/process-group/Windows-JobObject tracked against `job_id`
(kill via the `_kill_tree` idiom: `taskkill /F /T /PID` on Windows,
`start_new_session=True` + process-group kill on POSIX). "Kill children
with cwd inside worktree" is REPLACED by "kill the tracked process tree
for the job" (per-spec mode: all live spec-session trees).
**Interim rule until tracking lands**: cancel is lazy — mark
CANCELLING/CANCELLED_REQUESTED, execution continues to cooperative
stop/finalize, and the sweeper must NOT reclaim solely from cancelled
status.

### D14 — Recovery / sweeper ownership model (review F5 ruling)

> Recovery decides job state. Liveness decides filesystem safety. The
> sweeper may reclaim only after both agree the worktree is disposable.

> Recovery owns resumable worktrees. When recovery identifies an orphaned
> but resumable job, it MUST mark it RECOVERING or QUEUED_FOR_RESUME
> before any sweep can reclaim its worktree. The sweeper MUST treat those
> worktrees as protected. A worktree may be reclaimed only after recovery
> has classified the job as terminal and non-resumable, or after the
> resume retention window expires.

**Reclaim predicate — ALL six required:**
1. job is terminal or abandoned;
2. job is not RUNNING, CANCELLING, RECOVERING, or QUEUED_FOR_RESUME;
3. no protected `resume_from_step` + `worktree_root` state;
4. tracked process tree dead, or heartbeat stale beyond threshold;
5. no active worker lease owns the worktree;
6. chat logs + required observability artifacts copied out.

Protected: `RUNNING, CANCELLING, RECOVERING, QUEUED_FOR_RESUME,
RESUMABLE_FAILED`. Reclaimable: `COMPLETED`, `FAILED_NON_RESUMABLE`,
`CANCELLED` after process death, `ABANDONED` after recovery expiry,
registrations with no job record after TTL.

Worktree lifecycle derives from: job status + process liveness +
heartbeat freshness + worker lease + resume eligibility + recovery
ownership + retention expiry — NEVER status alone.

**Resume**: reuse the surviving worktree when available and clean; else
re-create from the run branch at the last committed spec boundary.
Explicit limitation: *without checkpoint commits, mid-spec uncommitted
work is not recoverable after worktree loss.* Bookkeeping:
`(spec_idx, step)`, `last_committed_spec_idx`, `run_branch`,
`worktree_root`. Optional stronger mode (documented, not default):
checkpoint-commit each step + squash at finalize (lossless re-create).
Recovery is promoted to a periodic pass on the heartbeat discriminator;
the API-background path heartbeats (today only the worker beats,
worker.py:113); recovery's restore executor is constructed against
`job.worktree_root`, never `API_WORKSPACE_DIR`. Claude session dirs under
`~/.claude/projects/<encoded-run-root>/` are retained while the job is
resumable, cleaned only after terminal non-resumable state.

## Non-goals (v1)

- **BUG_INVESTIGATION worktrees** — in-place uncommitted fix on the live
  tree; it GAINS the project lock (closes its pre-existing lockless race,
  tasks.py:1417-1468) but keeps its semantics.
- **Legacy live-tree per-spec flow** — exists only under
  `WORKTREE_RUNS=off` (with named retirement, D12).
- Our own dev-workflow conventions; long-lived per-feature worktrees;
  in-process thread pools; local merge queues; submodule repos
  (fail-fast); GitHub/Bitbucket CI binding (follow-on); per-run session
  uuids (follow-on hardening); virtual-branch systems.

## Invariants (v2)

- **W1.** Jobs never mutate the live checkout's REPO TREE; it stays on
  default. The product-root `haikai/` metadata tree is the durable
  metadata home (the one explicit exception — D10).
- **W2.** Batch: one run = one worktree set = one branch = one MR.
  Per-spec: one run = N (spec × worktree × branch × MR) units, concurrent,
  independent, capped (D1). Coupled specs never split across worktrees.
- **W3.** Every worktree is reclaimed via the D14 predicate on every exit
  path; sweeper for crash debris; tests assert ZERO leftover
  registrations (L1 parity).
- **W4.** Shared-`.git` mutations (worktree add/remove/prune) serialize
  under the narrowed lock; nothing else does.
- **W5.** Fail fast, never guess, no silent fallback: branch collisions,
  submodule repos, unpinnable verify cells, mini-spec checksum
  mismatches.
- **W6.** Each run/spec has its own CLI session identity via its
  project_dir; transplants copy the session directory verbatim; restores
  disambiguate by `(session_id, spec_name[, run_id])`.
- **W7.** The job record (`worktree_root`, pid/lease, `(spec_idx, step)`,
  `last_committed_spec_idx`, `run_branch`) is the sole source of truth
  for recovery/cancel/sweep — never convention or path parsing.
- **W8.** Windows discipline: short roots, `core.longpaths`, tracked-tree
  kill before removal, prune after any forced cleanup.
- **W9.** Parallel-N is gated on jobs.db busy_timeout + identity-attributed
  atomic claim + enqueue-only (or CAS) API path.
- **W10.** Verify verdicts are pinned: composite verify root at bound
  SHAs; no binding → UNPINNABLE, blocked, non-repairable (D11; ADR 0001).
- **W11.** Worktree mode default ON; `WORKTREE_RUNS=off` is the only
  escape and carries a named retirement condition (D12).
- **W12.** Worktrees are execution sandboxes: no durable control-plane
  path (jobs.db, verification db, logs, recovery/repair metadata) ever
  resolves under a worktree root (guard-tested).

## Review resolutions (2026-07-04)

Reason run `.haikai/reason/260703-worktrees-spec-review/` (2 adversarial
rounds + convergence test; verdict CONFIRM-WITH-CHANGES). All findings
ruled by the user and folded in: F1→D2, F2→D8 (option a + payload
checksum), F3→D1/D4 (per-spec concurrent mode; three-way allocation
policy; legacy under off-switch only), F4/M1→D13, F5→D14, F6→D11
(setup_commands), F7/M3→D11 (composite verify root; no-binding-no-verify;
bind default-on), F8→D11 (absolute --db), F9→D6, F10→D7 (sandbox rule),
F11→D7 (restore disambiguation), F12→D12/D13 (retirement; tracked-tree
kill), F13→D2/D14 (observability copy-out; session-dir retention),
M2→D6 (compose scaling). Grill resolutions (2026-07-03) remain in
`.haikai/grill/260703-2218-parallel-worktrees/`.

## Implementation sequence (v2)

1. **Queue + claim hardening** — jobs.db busy_timeout; worker identity
   claim; API path enqueue-only under fleets (CAS single-host); compose
   scaling fix + local N-worker profile. (D6, M2)
2. **Job lifecycle + tracking** — new states (CANCELLING, RECOVERING,
   QUEUED_FOR_RESUME, RESUMABLE_FAILED, FAILED_NON_RESUMABLE, ABANDONED);
   Popen + tracked pid/process-group/JobObject per job; worker watchdog
   kill; API-path heartbeats; `worktree_root` + resume bookkeeping
   columns (positional INSERT bump). (D13, D7)
3. **Worktree allocator module** (`src/git/worktree_runs.py`) — D4 branch
   policy, D2 seeding (scoped spec tree + config + coordination + session
   dir transplant), D14 reclaim predicate + observability copy-out,
   Windows ladder, sweeper, `index.lock` via `git rev-parse --git-path`,
   L1-parity tests. Deploy + bug-investigation join the lock.
4. **Orchestration integration (single + batch)** — run_orchestration
   allocates, project_dir override fan-out (F10 site list + guard test),
   session re-homing, reclaim via D14; `WORKTREE_RUNS` knob; branch
   collision fail-fast; batch parity in the run root.
5. **Per-spec concurrent mode** — N spec worktrees, bounded concurrent
   executor sessions (`RUN_SPEC_CONCURRENCY`), independent failure,
   per-spec `(spec, step)` progress + resume, N pushes/MRs; graph
   emitters gain per-spec command chains. (D1, D9)
6. **Repair integration** — mini-spec to live `haikai/` + sha256 in the
   `enqueue_cli` payload + allocation-time verification; repair runs as
   normal runs. (D8)
7. **Verify: composite verify root** — verify allocator (context/ +
   repos/ + evidence/), per-cell explicit paths, setup_commands,
   absolute --db, UNPINNABLE guard + open_repair refusal,
   ORCHESTRATE_CI_BIND default-on under worktree mode, fetch-on-miss;
   the 7 acceptance tests; ADR 0001. (D11)
8. **Recovery/sweeper** — periodic recovery pass, protected states,
   reuse-if-alive, spec-boundary degraded resume, session persist
   copy-back, restore executor on `job.worktree_root`, terminal-state
   home-dir cleanup. (D14)
9. **Evidence** — N workers up; TWO same-project runs concurrently → two
   MRs, live tree untouched, `git worktree list` clean after; one
   per-spec run (3 specs) → 3 concurrent sessions → 3 MRs; a repair
   dispatch with checksum verification; a pinned polyrepo verify;
   cancel-mid-run → tracked-tree kill → clean reclaim; both runs live on
   the Run Flow Graph.
