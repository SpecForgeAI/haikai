# Verification flow during an Implement run

How verification actually works when you run an orchestration ("Implement"), and how
**batch mode** changes it. Every statement here was traced to code (file:line).

## TL;DR

There are **two separate verification systems that are NOT wired together**:

1. **Per-spec self-verification** — runs *inside* the production Implement path. The
   implementer checks its own work (runs the tests, writes a report). **Advisory only:**
   the orchestrator never reads the pass/fail — it only checks the report *file exists*.
2. **The independent `verify-task-group` "D5 gate"** — a separate, stronger system (own
   build/test + rubric + real CI + auto-repair). **`run_orchestration` never calls it.**

So an Implement run today can finish "successfully" with **red tests**, and the strong
independent gate simply doesn't fire.

## The Implement path (system 1)

```
worker (JobType.ORCHESTRATION)               worker.py:98-99
  └─ run_orchestration                        tasks.py:342
       └─ HaikaiOrchestrator.run_workflow     tasks.py:470
            └─ for each spec, run 4 COMMANDS  haikai_orchestrator.py:108-113
                 1. /write-spec
                 2. /create-tasks
                 3. /implement-tasks  ── includes MANDATORY Phase 3 ──┐
                 4. /git-commit-preparation  (non_fatal)             │
                                                                      ▼
   Phase 3 self-verification (implement-tasks):        3-verify-implementation.md:3
     - run the WHOLE test suite                        run-all-tests.md
       → "DO NOT fix failing tests, just note them"    run-all-tests.md:5
     - write verification/final-verification.md        create-verification-report.md
       with  **Status:** ✅ Passed | ⚠️ | ❌ Failed     create-verification-report.md:11
       and Total/Passing/Failing/Errors counts         :69-73

   Did step 3 "succeed"?  →  ONLY checks the file EXISTS:
       missing = [p for p in output_paths if not Path(p).exists()]   haikai_orchestrator.py:483-484
       (nothing reads the Status line or test counts — grep finds only :562,567)

            ▼  after a spec's steps finish:
       on_spec_complete → _git_one_spec  commits the spec   tasks.py:379, 171
```

**Key fact:** a spec whose report says `❌ Failed` still counts as a successful step,
because success = "the report file was written," not "the tests passed."

## The independent system (system 2) — separate, not involved

```
worker (JobType.VERIFY_TASK_GROUP)           worker.py:114-115   ← different job type
  └─ run_verify_task_group                    tasks.py:587
       └─ /verify-task-group CLI session       tasks.py:639-646
            → verification-loop agent: inline-runner + rubric-verifier + ci-trigger
              cells → D5 AND gate → guarded recorders (jobs.db) → repair-engine
              (ATTEMPT_CAP = 3)                 recorder.py:30
```

`run_orchestration` and `haikai_orchestrator.py` contain **zero** references to
`verify-task-group` / `verification-loop` / `recorder` / `advance` / `open_repair`
(grep: no matches). The two are different job types with different entry points that
never call each other.

## What batch mode changes (and doesn't)

Batch mode (`batch_name` set) only changes **git branching** — it does **not** touch
verification. In `_git_one_spec` it passes `checkout_back_to_default = not batch`
(`tasks.py:228`):

- **Legacy** (`batch_name` unset): tree is reset to default between specs → each spec is
  implemented and self-verified **in isolation**.
- **Batch** (`batch_name` set): no reset → specs **accumulate** on one branch, so each
  later spec is implemented and self-verified against the **accumulated** working tree.
  The last spec's Phase-3 test run therefore exercises the **whole vertical slice**
  together (UI + service + DB + permissions). Still advisory — nothing gates on it.

## The gap (deliberately not built yet)

"Open the PR only if verification passed, else auto-repair" is **not** in the Implement
path. To get it you either:
- **read the self-verification verdict** (parse `final-verification.md` Status / counts —
  it's produced, just unread) and gate the PR + trigger repair, or
- **wire in system 2** (the independent `verify-task-group` gate) — bigger integration.

## Sources
`src/job_queue/tasks.py`, `src/haikai_orchestrator.py`, `src/job_queue/worker.py`,
`src/job_queue/job_models.py`, `src/verification/recorder.py`,
`haikai-profiles/default/commands/implement-tasks/`,
`haikai-profiles/default/workflows/implementation/verification/`,
`haikai-profiles/default/commands/verify-task-group/`.
</content>
