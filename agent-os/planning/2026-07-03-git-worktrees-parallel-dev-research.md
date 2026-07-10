# Git Worktrees for Parallel Implement/Develop — Research

Date: 2026-07-03. Status: research complete; scope decided (see §6).
Sources: 4 parallel investigations — (1) ivs git/workspace layer, (2) in-house
worktree prior art, (3) ivs concurrency constraints beyond git, (4) external
web research (git mechanics, Windows, 2025-26 agent-orchestrator patterns).

## 1. Why parallelism is blocked today (ivs)

The workspace is a **single, persistent, shared checkout per (company,
project)** — cloned exactly once at `POST /projects/init`
(`src/api/routes/projects.py:104-200`) into
`API_WORKSPACE_DIR/<company>/<project>` and reused by every subsequent job.
Nothing re-clones. Every job type runs its Claude CLI session and its git
mutations directly on that live tree:

- orchestration: `run_orchestration` → orchestrator `project_dir` =
  the live checkout (`haikai_orchestrator.py:147`); commits mutate it.
- verify: `run_verify_task_group` → CLI cwd = live project dir
  (`tasks.py:955`).
- repair: `run_bug_investigation` → `/haikai:debug`+`/haikai:fix` with cwd =
  live checkout (`tasks.py:1456`); success corroborated by `git status
  --porcelain` on that tree.

Because of this, same-project parallelism is **prevented by design**:
`_project_git_lock` (`tasks.py:133-144`, lock file at
`<workspace>/.locks/orch-git-<sha256(company/project)[:16]>.lock`, held over
the ENTIRE generate+commit phase at `tasks.py:738-760`). The R8 rationale in
code: two same-project orchestration jobs "would race on that tree and
cross-contaminate commits." Second job blocks up to 60s → `TimeoutError`.

Artifacts of the shared-tree design that a worktree model dissolves:
`create_feature_branch` rescuing untracked-file conflicts from prior runs
(`git_manager.py:265-307`), `checkout_back_to_default` between specs
(`git_manager.py:470`), stale `.git/index.lock` removal
(`git_manager.py:346-350`).

### Serialization points ranked (beyond the working tree)

HARD (same project only — different projects are already parallel-safe):
1. **One active Claude CLI session per project** — `session_store.py:1-4`
   docstring says so explicitly; `active_session.json` at
   `<project>/.claude/active_session.json`, CLI session jsonl keyed by
   *encoded project_dir* at `~/.claude/projects/<encoded>/<uuid>.jsonl`
   (`claude_chat_executor.py:1416`). Two same-project runs clobber one
   conversation. **Key insight: because the session path is keyed off
   project_dir, giving each run its own worktree directory forks the session
   identity for free** — one move solves both the tree race and the session
   race.
2. `_project_git_lock` itself (the current serializer; the seam to replace).
3. CLI cwd = the one workspace repo for that project
   (`claude_cli_executor.py:294`).

SOFT:
4. **jobs.db has NO busy_timeout / no WAL** (`job_storage.py:21-36`) —
   concurrent writers get instant `database is locked`. The verification
   store got the fix (`store.py:163` busy_timeout=5000, WAL deliberately
   dropped per R5); jobs.db did not. Must be hardened before parallel-N.
5. Verification/graph store: IMMEDIATE + busy_timeout=5000, emitters
   best-effort try/except and self-healing — concurrency-tolerant.
6. Worker `_reload_modules` global rebind (`worker.py:57-90`) — unsafe only
   if jobs multiplex into one process via threads.
7. `os.environ["PYTHONPATH"]` global mutation (`tasks.py:943-945`) — should
   move to the subprocess env dict under any shared-process parallelism.

FINE AS-IS / READY:
8. **Atomic multi-worker job claim ALREADY EXISTS**:
   `claim_next_queued_job(worker_id)` (`job_storage.py:144-184`, IMMEDIATE
   txn + re-check + lost-race retry) — but `worker.py:99` calls the
   deprecated single-worker shim `get_next_queued_job()`. Multi-worker is
   one line away. `WORKER_ID` env already plumbed (`worker.py:46`).
9. No in-process LLM serialization: executor rate-limit machinery is
   per-instance preflight backoff only (`rate_limit_backoff.py`); two CLI
   processes can run simultaneously — the only shared limiter is the
   external Anthropic quota.
10. `~/.claude/commands`+`agents` copy on executor init is idempotent
    copy-if-absent (`claude_cli_executor.py:98-193`).

Also note: orchestration already runs concurrently across paths today —
worker process + API in-process background task (`jobs.py:292` →
`api/__init__.py:603-634`) + recovery threads (`recovery.py:245`). The
parallel design must make the API path respect the same worktree/lock model
(or hand off to the queue).

## 2. In-house prior art

- **Production template — `consolidate_and_deploy`** (`tasks.py:1192-1247`):
  isolated **detached** worktree in a tempdir (`git worktree add --detach
  <tmp>/wt <default_branch>`), merges spec branches into it, deploys, then
  `finally:` `git worktree remove --force` + rmtree. Docstring principle:
  "the integration tree is built in an ISOLATED, detached git worktree …
  NEVER by mutating the live repo." Tests assert **zero leftover**
  `.git/worktrees/` registrations (`test_consolidate_deploy.py`), and two
  e2e suites re-verify "worktree reclaimed (L1)". Strongest established
  invariant: **always reclaim, verify no leak**.
- **haikai:fix worktree-per-group** (skill `references/fix.md:73-95`,
  `subagent-dispatch.md:92-107`): one branch + sibling worktree per
  independent error group (`git worktree add "../fix-worktree-{group}" -b
  <branch>-{group}`), one subagent per worktree with cwd = worktree, per-group
  verify, sequential local merge-back, global re-verify, remove worktrees.
  Gate: ≤3 groups → don't fan out. NOTE: branch-prefix drift between the two
  files (`haikai-fix-<epoch>` vs `autoresearch/<epoch>`) — normalize.
- **haikai regression baseline**: `git worktree add --detach <sha>` (detach
  avoids "branch already checked out" when base==HEAD), per-worktree
  `git submodule update --init` + dep install, remove+prune on completion or
  crash.
- **Polyrepo-analysis conversation**
  (`implement-verify-service/haikai/specs/2026-05-25-polyrepo-analysis/thread/conversation.md`):
  the design debate that recommended "one worktree per repo per spec" (line
  236) but was never built; Ozzie's brownfield caveat at line 242 — target
  projects may not be worktree-friendly; worktrees solve the write side only.

Gap the new feature fills: everything above is short-lived,
merge-then-destroy, local, single-repo, POSIX-assumed. Nothing covers
**long-lived parallel development, push/MR per worktree, polyrepo, or
Windows**.

## 3. External research (condensed)

Mechanics: all worktrees share one object store + refs namespace + repo
config; per-worktree HEAD/index/MERGE_HEAD and `.git/worktrees/<id>/`
metadata; a linked worktree's root has a `.git` *file* pointing back. One
`git fetch` serves all worktrees. **One-branch rule**: a branch can be
checked out in only one worktree — for automation this is a free per-task
mutex; use branch-per-worktree (`add -b <branch> <path> <base>`) or
`--detach` for read-only runs; never `--force`. `worktree prune` clears
orphaned metadata after a manual rm; `worktree repair` fixes moved trees;
`worktree lock` protects in-flight runs from sweeps. `extensions.worktreeConfig`
enables per-worktree config.

Pitfalls: submodule support "incomplete/experimental" (init per worktree;
`remove` needs `--force`); hooks shared via `$GIT_COMMON_DIR/hooks` but
relative `core.hooksPath` (Husky) resolves per-worktree; **untracked/ignored
artifacts don't travel** — per-worktree node_modules/venv/.env is the
dominant cost of the whole pattern (mitigate: pnpm hardlinked store,
`.worktreeinclude`-style copy lists, setup hook); IDE watcher multiplication.

**Windows (critical for this host)**:
- MAX_PATH bites early → keep worktree roots SHORT, set
  `core.longpaths=true` + LongPathsEnabled policy.
- **Open file handles block `worktree remove`** — the #1 documented failure
  in agent harnesses (claude-code#41740, #32747): node/dev-server/MCP child
  processes with cwd inside the worktree. Rule: **kill children before
  remove**; on failure retry-with-backoff → `remove --force` → delete
  contents → `prune`.
- Defender real-time scanning transiently locks `.git` files and slows
  checkout/install → exclusions for the worktree root.

Orchestrator patterns (2025-26): a nine-orchestrator survey found ALL
converge on **worktree-per-agent** (Claude Squad, Vibe Kanban, Agent
Orchestrator, Cursor parallel agents, Claude Code `--worktree` /
`isolation: worktree`). Converged conventions: branch-per-agent naming
(`agent/<task>`), placement either gitignored-in-repo
(`.claude/worktrees/`) or short external dirs (better on Windows), dominant
merge-back = **branch-per-agent → push → PR each, CI-gated** (secondary:
local apply of the diff), rebase onto fresh base before PR, per-worktree dep
install accepted as cost, `worktree lock` while an agent runs, practical
ceiling ~4-8 concurrent worktrees (bottleneck is review, not compute).
Counterpoint: Trigger.dev abandoned worktrees for GitButler virtual branches
citing env-duplication overhead — the tax is environment setup, not git.

Alternatives: worktree (fastest post-clone, one object store) vs local clone
(hardest isolation, hardlinked objects on same volume) vs
`--reference/--shared` (dangerous in automation unless `--dissociate`) vs
shallow/blobless (cold-start CI only). Same machine + same repo +
parallel tasks → worktrees win.

## 4. Design implications (candidate shape, NOT yet agreed)

If the target is **parallel ivs jobs per (company, project)**:

1. `worktree add -b <run-branch> <workspace>/<company>/<project>/.wt/<run_id>
   <base>` — or better a SHORT external root like
   `<workspace>/wt/<run_id>/<folder>` (Windows path budget). Polyrepo: one
   worktree per repo folder per run.
2. Point orchestrator/executor `project_dir` and `GitManager` at the
   worktree path — this simultaneously forks the CLI session identity
   (keyed on project_dir) and the cwd, dissolving hard blockers 1-3.
3. Session/spec coupling: worktree contains `haikai/specs/...` from its
   branch, so `restore_session_from_spec`/recovery keep working IF they
   resolve the run's worktree path (jobs must persist their worktree path;
   `job.logs_path` precedent exists).
4. Branch namespace per run (`feature/<batch|spec>` today would collide
   across parallel runs → embed run-id or rely on the one-branch mutex).
5. Keep a lock ONLY around shared-`.git` mutations (`worktree add/remove`
   touch `.git/worktrees/`) — re-key `_project_git_lock` or narrow it;
   `.locks/` stays outside repos.
6. Merge-back = the existing flow: push + PR/MR per run branch (the code
   already does push/PR per branch; `consolidate_and_deploy` already
   integrates N spec branches in a detached worktree for deploy).
7. Lifecycle discipline (extends the proven L1 invariant): `worktree lock`
   while the job runs; on completion kill CLI children → remove → prune;
   sweeper for crash debris; tests assert zero leftover registrations.
8. Scale the worker: N worker processes using the already-built
   `claim_next_queued_job(worker_id)`; harden jobs.db with busy_timeout
   first. API in-process path hands off to the queue or adopts the same
   model.
9. File-sync nuance: `_git_one_spec` copies generated files from the product
   root into repo subdirs (`tasks.py:381-390`) — the product-root-vs-repo
   split must be reproduced inside the per-run worktree set.
10. Run Flow Graph tie-in: parallel runs are separate `orchestrate_id`s and
    already render as separate graphs; nothing in graph_events assumes
    serial execution (concurrency-tolerant by design).

If the target is **our own dev workflow** (parallel feature development on
this monorepo with Claude Code): the harness support already exists
(`--worktree`, `isolation: worktree`, EnterWorktree) — the work is
conventions + Windows hygiene (short root, gitignore, `.worktreeinclude`
for env files, kill-before-remove) rather than new code.

## 5. Open questions for requirements

1. Which parallelism is the feature: parallel ivs jobs (same-project
   orchestrate/repair concurrency), our own dev workflow, or both?
2. Merge-back model: branch-per-run → push → MR each (industry + current
   code default) vs local integration?
3. v1 scope: orchestration jobs only, or also parallel repair
   (bug-investigation) jobs against the same project?
4. Worktree placement + retention: ephemeral per-job (remove on completion,
   like deploy) vs long-lived per-feature (survives across sessions)?
5. Worker scaling: N worker containers vs in-process pool (pool requires
   fixing `_reload_modules` + PYTHONPATH mutation)?

## 6. Scope decisions (user, 2026-07-03)

1. **Target: parallel ivs jobs.** Worktree-per-job inside
   implement-verify-service so multiple jobs on the SAME (company, project)
   run concurrently.
2. **v1 scope: orchestrate + repair.** Both `run_orchestration` and
   `run_bug_investigation` get per-run worktrees; repair jobs are the prime
   concurrent citizens (the self-repair loop already dispatches them async).
3. **Merge-back: must honor the multi-spec batch model** (user: "remember
   how we handled multiple shape specs — consider this in the design").
   Reference: `agent-os/specs/2026-06-24-multi-spec-batch-single-mr` —
   N COUPLED specs → N commits on ONE branch → ONE MR, finalized by
   `_finalize_batch_git`, integrated for deploy by `consolidate_and_deploy`.
   Design consequence: the unit of parallelism is the RUN (job), not the
   spec. A batch run keeps its N coupled specs SEQUENTIAL inside one
   worktree on one `feature/<batch_name>` branch → one MR, exactly as
   today; parallelism happens ACROSS independent runs/batches, each in its
   own worktree with its own branch → its own MR. Coupled specs never split
   across worktrees. `consolidate_and_deploy`'s N-branch integration
   worktree remains the convergence point when several parallel runs' work
   deploys together — batch-branch naming must stay unique per run so
   parallel batches on the same repo can't collide on
   `feature/<batch_name>`.
4. **Lifetime: ephemeral per job.** Created at job start, reclaimed at job
   end (kill CLI children → remove → prune), sweeper for crash debris —
   extends the tested L1 always-reclaimed invariant. Resume/recovery
   re-creates the worktree from the run's pushed/local branch.
