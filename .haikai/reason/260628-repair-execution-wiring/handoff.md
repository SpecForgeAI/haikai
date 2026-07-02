# Repair-execution wiring — corrected plan (haikai:reason output)

Task: close the verify-loop self-repair loop in implement-verify-service.
Method: haikai:reason, 2 independent cold authors (validator + breaker), domain=software.
Lineage: BOTH authors independently → **refute** B+B1+I2, same code-grounded evidence → convergent (no judge tie to break).

## Verdict: REFUTE the `run_bug_investigation` / `haikai:fix` approach (DIM3=I2)

It is factually wrong about the code:

1. **Wrong world (decisive).** `run_bug_investigation` does NOT commit/push/trigger CI. It drives `/haikai:fix` on a dirty tree, provisions a haibox from that checkout (`tasks.py:1333-1336`), and POSTs to `bug.callback_url` (`tasks.py:1367`). No `git push`, no `_record_ci_binding` in 1201-1380. ⇒ no CI verdict ⇒ inbound never correlates a SHA ⇒ the D5 gate never re-folds. The cell stalls until the inbound TTL sweep marks it `timeout` → mis-routed as `infra` (`verification-loop.md:81`, D10.5).
2. **Metric hardcoded.** The runner pins "the repository's own test suite" (`tasks.py:1266-1268`; `_repair_spec` likewise `360-366`). No parameter for `pip-audit` / an arbitrary verifier command. A `requirements.txt` bump has no failing pytest, so the haikai:fix regression gate neither proves nor protects the CVE fix.
3. **Surface.** The inline verify agent has no enqueue verb (recorder CLIs only, `recorder.py:267-273`); `run_bug_investigation` is keyed on a `bug` row it hard-fails without (`tasks.py:1228`). ⇒ a synthetic bug row + a new enqueue CLI + a callback that re-enters verify. Large new surface, negative value. Bolting it beside the existing path also yields two repair mechanisms per cell.

## Correct design: the already-spec'd `real → mini-spec → /orchestrate` path (DIM3=I1)

`verification-loop.md:76-78`: on `real`, "feed its fix-task mini-spec back into `/orchestrate` as a single-repo task group; only that repo's implementer re-runs, sibling verdicts stay pinned." The mini-spec already gets written by `repair-engine.md:54-69` (`fix-tasks/[group]__[repo]__attempt[N].md`, `touched_repos:[repo]`, "reuse the SAME rubric/tests that failed").

Why it beats I2 on every flaw:
- **Same world** — implementer re-runs in the orchestrate workspace (`inbound.py:108-115` exists *specifically* "so a repair can actually re-implement") → commits → CI fires at commit time (D9) → `inbound.py:117-129` correlates the new SHA→cell → enqueues a fresh `VERIFY_TASK_GROUP`. The fix reaches the blocked gate.
- **Metric free** — the new commit re-runs the SAME CI, i.e. the same `pip-audit` cell. No parameterization for CI-bound cells.
- **Cap honored** — each re-entry calls `open_repair` → `ATTEMPT_CAP` (`recorder.py:238`), even across cold re-entries (`verification-loop.md:85`).

This is the unimplemented "post-repair → implementer (loop back, capped)" edge in `diagrams/client/src/data/diagram07.ts` (fail-path edges, lines 223-231).

## Minimal change list (concrete)

1. **Agent-callable enqueue CLI — NEW, separate from the recorder.**
   `python -m src.job_queue.enqueue_cli orchestration --json '<single-repo task-group payload>'` wrapping `JobQueue(jobs_db_path()).enqueue_job(...)`. Keep `recorder.py` untouched (its contract is guarded verification writes only). Reference it from `verify-task-group.md` so BOTH the subagent and `{{UNLESS use_claude_code_subagents}}` inline branches have one idiom to dispatch the scoped re-orchestration on `real`.
2. **Attempt anchored to the verdict ordinal.** In the `real` branch, derive the `open_repair` attempt from the cell's atomic verdict ordinal (`recorder.py:61-74`), not a hand-counted value, so a never-fixable CVE deterministically hits `attempt > 3` and escalates (`recorder.py:238`). Sound because the I1 path produces a fresh verdict each cycle.
3. **(Optional — inline-only cells.)** Parameterize `verifier_cmd` into `_repair_spec` (`tasks.py:360-366`) to settle an `inline`-runner cell locally. NOT needed for `ci-trigger`/`observe` cells, which require the commit→real-SHA→CI round-trip the I1 path already gives.

## Reuse map (already shipped — do not rebuild)
- `run_orchestration` single-repo task group + `_git_one_spec` (commits only on pass, `tasks.py:550-564`) + `_record_ci_binding` (registers SHA for inbound re-entry, `tasks.py:171-183`, `ORCHESTRATE_CI_BIND`).
- `inbound.py:117-129` SHA→cell correlation → fresh `VERIFY_TASK_GROUP`.
- `open_repair`/`ATTEMPT_CAP` cap; D10.2 idempotent re-entry.

## Explicitly DON'T
- Do not route the verify gate through `run_bug_investigation`/haibox/callbacks.
- Do not add an enqueue verb to `recorder.py`.
- Do not have repair-engine enact routing/writes — it returns classification + mini-spec only (`repair-engine.md:14-17`).
