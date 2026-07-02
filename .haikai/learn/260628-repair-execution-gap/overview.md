# Why the verify-loop doesn't execute a repair — and how to wire it

Check-mode trace (report only). Evidence: #10 CVE — verify-loop classified `real`, `open_repair`, wrote the exact fix, returned; no commit, no re-CI.

## Why (the gap, file:line)

- **`open_repair` has no consumer.** `grep "FROM repairs"` across `src/` = empty. The `repairs` row (`recorder.open_repair`) only enforces the attempt cap (`recorder.py` ATTEMPT_CAP); nothing reads it to act.
- **ORCHESTRATION jobs are created ONLY by the external API route** — `src/api/routes/jobs.py:76` and `:258` (`Job(type=JobType.ORCHESTRATION, request_payload=request.dict())`). No internal/repair caller.
- **The inbound gateway re-enqueues ONLY `VERIFY_TASK_GROUP`** — `src/api/routes/inbound.py:119` (`_enqueue_reinvoke`). It never enqueues an orchestration.
- **`repair-engine` is pure diagnosis** — `repair-engine.md:9`: "you RETURN a structured result; you do NOT enact routing… the `verification-loop`… acts on your classification." On `real` it only *writes a fix-task mini-spec*.
- **The verification-loop is *instructed* to execute but has no mechanism** — `verification-loop.md:78`: `real → "feed its fix-task mini-spec back into /orchestrate as a single-repo task group."` But the inline agent's tools are `Read, Bash, Task, <recorder tools>` — no orchestration-enqueue tool/endpoint, and it can't re-enter the `/orchestrate` slash-command from inside its own CLI session.
- **Impedance mismatch even if enqueued** — `run_orchestration` (`tasks.py:441`) consumes a *shaped* spec: `restore_session_from_spec` (`tasks.py:83`) + `_git_one_spec` per `spec_name` reading `haikai/specs/[spec]/...`. A fix-task mini-spec is not a shaped spec folder + session.

**Conclusion:** "feed into `/orchestrate`" is an agent instruction with **zero runtime wiring**. No path converts an open repair / fix-task into an ORCHESTRATION job. So the loop terminates at `open_repair` + a written plan. (Subagent path would `Task`→`repair-engine`, but that only *produces* the mini-spec — the same missing enqueue applies.)

## How (minimal closed loop)

What's already wired downstream: `_git_one_spec` (commit/push/PR), `ORCHESTRATE_CI_BIND` (binds the new SHA), inbound re-entry → `VERIFY_TASK_GROUP` re-enqueue (`inbound.py:119`) → idempotent gate re-eval (D10.2), `open_repair` cap. Only the **repair→orchestration enqueue** + **mini-spec→spec consumption** are missing.

1. **Enqueue path (the core fix).** Add a Bash-callable dispatch the inline verify agent runs on `real` after `open_repair` — mirror the recorder-CLI idiom: `python -m src.verification.dispatch_repair --json '<fix-task>'`. It creates `Job(type=ORCHESTRATION, ...)` for the single repo via the existing queue (reuse `jobs.py:76` logic). Add the invocation to the `{{UNLESS use_claude_code_subagents}}` branch of `verify-task-group.md` (and the subagent branch after the `repair-engine` Task returns `real`).
2. **Make orchestration consume a fix-task mini-spec.** Simplest reuse: the dispatch writes a minimal spec folder (`haikai/specs/<repair-spec>/planning/{initialization,requirements}.md`) from the mini-spec so the existing `run_orchestration` consumes it unchanged. Resolve the session impedance — `_restore_session`/`restore_session_from_spec` (`tasks.py:83`) expects a prior session; a repair spec has none, so add a fresh-session (new `--session-id`) path for repair orchestrations (the implement step doesn't need to resume shape-spec context).
3. **Loop closes for free.** Fix orchestration → commit → push → `ORCHESTRATE_CI_BIND` binds the new SHA → CI verdict → `inbound.py:_enqueue_reinvoke` re-enters the verify-loop → idempotent re-eval → pass → `advance`. The cap is already enforced by `open_repair`.

Scope: NEW `src/verification/dispatch_repair.py` (~recorder-sized); edit `verify-task-group.md` (both branches); a repair-mode/fresh-session path in `run_orchestration` (`tasks.py`). This is the "Phase 2 (gate+repair)" build, not a config flag.
