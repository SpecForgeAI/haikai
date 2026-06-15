# Worker auto-dispatch — verify-task-group runs hands-free

Closed the one genuinely-unbuilt piece: the worker now LAUNCHES the
verification-loop session when it claims a verify-task-group job, so the
gateway→enqueue→worker→loop→gate chain runs with zero hand-dispatch. First
of the eight job types fully wired (the other seven remain Phase 2+).

## What changed

- src/job_queue/tasks.py::run_verify_task_group — was a NotImplementedError
  stub; now resolves the project dir, launches a fresh /verify-task-group
  session via ClaudeCLIExecutor (correlation keys + db path on the command
  line; the loop reconstructs from the db, D10.2), and records job outcome.
  The worker is an ordinary process, so the session it spawns is TOP-LEVEL
  and may dispatch repair-engine itself — the depth-legal production shape.

## Live-run finding (fixed same commit)

ClaudeCLIExecutor set ANTHROPIC_API_KEY directly with no OAuth branch, while
ClaudeChatExecutor had it — helper-exists-sibling-missed. An OAuth token
(sk-ant-oat, from .env.session) was rejected ("Invalid API key") on the first
worker run. Ported the branching (sk-ant-oat -> CLAUDE_CODE_OAUTH_TOKEN +
blank ANTHROPIC_API_KEY) + added a count==0 guard test asserting every
executor that sets the key handles OAuth.

## Live proof

Enqueued a real verify-task-group job (orch-poly2/g2, one green inline cell)
into jobs.db; ran the REAL worker:
- worker claimed the job, launched the session ("Using CLAUDE_CODE_OAUTH_TOKEN")
- the session ran /verify-task-group, folded the D5 gate, advanced g2
- db: task_group_state g2 = advanced; events verdict_recorded -> advanced
- NO dispatch from the operator — the worker did it all.

(First attempt was killed by a 300s test-wrapper SIGTERM mid-session — the
auth fix was already confirmed in that run's log; the clean re-run advanced.)

## Tests

tests/test_verify_task_group_job.py — 5 (dispatch, fail path, bad payload,
cancelled, missing job). Plus the OAuth count==0 guard. Full suite 1524 green.
