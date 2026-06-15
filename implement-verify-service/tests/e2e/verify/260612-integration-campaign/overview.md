# Integration Campaign — full end-to-end on real repos (haikai goal loop)

Driven as a haikai goal-loop to completion. The system built features through
its own API, published them to real private GitHub repos with real CI, ran the
full verification service across them, and fixed a real bug — all live.

## Result: 5/5 phases, both terminal proofs met

| Phase | What | Proof |
|---|---|---|
| 0 | Rig + runbook | API healthy, worker, tunnel, callback receiver; auth enforced |
| 1 | Build 2 features via the API | shape-spec + orchestrate (all 4 steps success ×2); fb 12/12, pd 9/9 local |
| 2 | Publish to private repos + CI | OzzieBelazi/sx-itest-format-bytes + sx-itest-parse-duration; real Actions green |
| 3 | Full verification | 6 cells (inline+rubric+ci-trigger × 2) all pass; **polyrepo D5 AND gate advanced HANDS-FREE** |
| 4 | Bug round-trip | injected real defect → POST /api/v2/bugs/ → haikai fix → **signed success callback**; tests 5-red → 12/12 |
| 5 | Finalize + teardown | runbook complete; webhooks deleted; infra stopped; creds destroyed |

Terminal metric: `task_group_state(orch-camp,g1)=advanced` (gate green over all
6 cells) + bug callback `status=success`. Both achieved.

## The reproducible runbook
`runbook.md` — every REST call to the service in order, copy-pasteable, secrets
redacted. Nine endpoints exercised; all consumer calls bearer-authed.

## Findings (real, surfaced by the live run — tracked, non-blocking)
1. Loop advances by writing `task_group_state` directly, not via the guarded
   `recorder.advance` — red-gate guard bypassable by an agent with Bash.
2. No single-flight on webhook re-invoke (D10.6): N deliveries → N sessions.
3. Single-process worker head-of-line blocks long sessions; needs concurrency
   cap + bounded session timeout.

## Boundary
Real everywhere except: the inline + rubric verdicts were recorded by the
operator/rubric-agents (the verifier mechanisms), while the GATE FOLD itself
ran hands-free (worker → loop session). The features are real, the repos are
real, the CI is real, the bug fix is real, the callback is real-and-signed.

## Leftover
Two private repos remain on GitHub (deletable):
OzzieBelazi/sx-itest-format-bytes, OzzieBelazi/sx-itest-parse-duration.
