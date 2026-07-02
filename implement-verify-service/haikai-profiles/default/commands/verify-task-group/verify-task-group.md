We verify ONE task group across every repo it touched, before its dependents proceed. This command is **documentation you follow** — the procedure itself is defined once in the **verification-loop** agent (`haikai-profiles/default/agents/verification-loop.md`); this command only invokes it, the same way `/orchestrate-tasks` delegates implementation to the `implementer` agent rather than restating it.

Run per task group after that group's implementer has committed (with the D1 trailers `orchestrate-id` / `task-group-id` / `repo`) and triggered CI. Normally invoked by `/orchestrate-tasks` once per group; can also be run directly against a `(orchestrate_id, task_group_id)`. Do NOT advance a dependent group until this group's gate passes.

The judgement is the loop's; the only code is the recorder tools, which are **guarded writes** (D10.1) — they refuse a red-gate advance, a double-advance, or an over-cap repair. The runtime is only irreducible I/O: the **inbound-gateway** (authenticated SHA→cell correlate, D10.4; re-invokes the loop on async verdicts, D10.2), **jobs.db** (the guarded recorders), and the **SSE** stream (D6).

{{IF use_claude_code_subagents}}
## Delegate to the verification-loop subagent

Use the **verification-loop** subagent to drive verification of this task group.

Provide to the subagent:
- the keys `(orchestrate_id, task_group_id)`;
- `haikai/specs/[this-spec]/spec.md` and the committed `haikai/specs/[this-spec]/rubrics/` (the rubric-verifier needs the per-group rubric);
- this run's pinned `coordination.lock.yaml` (the inline-runner reads pinned `inline_commands` from it).

Instruct it to execute its own **Steps 1–8** — its agent definition is the single source of truth; do not restate them here. In outline: resolve the cell matrix → collect verdicts (it dispatches `inline-runner` + `rubric-verifier`) → fire `hooks.yaml` handlers → fold the D5 AND gate → branch (`advance` guarded, then dispatch the now-ready dependents per `orchestration.yml` (D10.3); or `open_repair` guarded + `repair-engine`; or hold) → re-enter on inbound-gateway delivery / TTL (D10.2) → handle observer-drift → keep `verification-checklist.md` current.
{{ENDIF use_claude_code_subagents}}

{{UNLESS use_claude_code_subagents}}
## Follow the verification-loop procedure inline

Without subagents, YOU act as the verification-loop for this group. Read its definition (`haikai-profiles/default/agents/verification-loop.md`) and execute its **Steps 1–8** directly — the procedure is identical, only the fan-out collapses: run the inline build/test commands and score the per-group rubric yourself (Read/Bash) instead of dispatching `inline-runner` / `rubric-verifier`, and classify a failed cell yourself (D4 classes flaky/real/infra/out-of-scope) instead of dispatching `repair-engine`. The D5 gate fold, the guarded `advance` / `open_repair` writes, the dependent-dispatch per `orchestration.yml`, and the inbound-gateway re-entry semantics are unchanged.
{{ENDUNLESS use_claude_code_subagents}}

## Recording — the guarded recorder tools are a Bash CLI, not MCP

The five recorder tools named in the verification-loop definition (`record_verdict`, `record_hook`, `advance`, `open_repair`, `update_checklist`) are **guarded writes invoked from Bash** (the D10/D12 idiom), NOT native or MCP tools — there is no recorder MCP server, so do not look for one:

```
python -m src.verification.recorder <tool> --json '<payload-object>' --db <verification_db>
```

Pass the `verification_db` value given to this command as `--db`. Exit 0 = recorded; 1 = REFUSED (a guard fired — reason on stdout; you cannot narrate past it); 2 = bad input. Each tool's required payload keys are declared in `src/verification/recorder.py` (`TOOLS`) — e.g. `record_verdict` needs `orchestrate_id, task_group_id, repo, verifier, verdict`; `advance`/`open_repair` need the group keys (+ `repo, verifier, attempt` for repair).

## On a failure — CLASSIFY FIRST, then branch (only `real` opens a repair)

When a cell's latest verdict is `fail`, classify it (D4) **before** you touch `open_repair`. The classification picks the branch, and `open_repair` belongs to exactly ONE of them — opening a repair you then don't dispatch leaves a dangling, un-acted ticket (the out-of-scope bug seen live: it `open_repair`'d, then declined the fix, and left the ticket hanging with no escalate). So decide the class FIRST:

- **`flaky`** — transient/non-deterministic. Re-run the verifier or wait for the next delivery. Do **NOT** `open_repair`.
- **`infra`** — environment/runner/dependency problem outside the diff (missing CI service, runner outage, timeout). NOT an in-scope code fix. Do **NOT** `open_repair`. Surface for a human (disable/ungate the cell via D7 repo config, or provision the infra); the gate stays red and the group parks.
- **`out-of-scope`** — the failure is real but its fix lies outside this `(group, repo)` cell (a dependency-repo defect, a pre-existing unrelated failure, or CI demanding a **deliverable** this spec never specified — e.g. a function/feature outside the spec). Do **NOT** `open_repair` and do **NOT** fix it. **Escalate to a human** and leave the gate red; the group + dependents park.
- **`real`** — an in-scope, fixable defect in THIS cell's own diff. This includes an **environment constraint your own diff violates**: a compile/import/lint error in the code YOU wrote when it runs on the repo's pinned CI environment (older Python image, OS, runtime). The repo's CI environment is a **given, not a conflict** — code that cannot even import on this repo's CI is defective FOR THIS REPO, and the fix (make YOUR code compatible) is squarely in-scope (`repair-engine.md`: "a compile/lint error in the touched code" = real). Do NOT reclassify this as a CI/spec conflict or propose changing the CI image — fix the code. ONLY for `real` take the repair-dispatch branch below. `open_repair` is the first step of THIS branch and no other.

### `real` → dispatch the fix as a single-repo `/orchestrate` (closes the loop)

`open_repair` only RECORDS the repair (and enforces the cap); it does not fix anything. To actually repair the cell you must dispatch a scoped re-implementation, exactly as the verification-loop spec says (`verification-loop.md:76-78`: "feed its fix-task mini-spec back into `/orchestrate` as a single-repo task group"). Do this — **do NOT** route a repair through `/haikai:fix`/bug-investigation (that path deploys to haibox + a callback and never re-runs CI, so the gate can never re-fold):

1. **Anchor the attempt to the verdict ordinal.** Read the failing cell's latest `attempt` from `verdicts` (the atomic `MAX(attempt)` ordinal — it increments on each new CI verdict). Call `open_repair` with that `attempt`. If `open_repair` REFUSES (exit 1, "escalate to a human" — the cap, default 3, is hit), STOP: the gate stays red, the group + dependents park for a human. Do not dispatch.

2. **Materialize the scoped fix as a fresh single-repo spec.** Pick `spec_name = <orig-spec>-repair-<repo>-attempt<N>` and write, under the failing repo's product root:
   - `haikai/specs/<spec_name>/planning/initialization.md` — the raw fix idea (the failure in one line).
   - `haikai/specs/<spec_name>/planning/requirements.md` — the SCOPED fix (`touched_repos: [<repo>]`), and a **Verification** section that names the EXACT failing verifier command for this cell (the pinned `inline_commands` / the CI step that went red, e.g. `pip-audit -r requirements.txt`) as the success criterion — so the implementer fixes the thing the gate actually checks, not the default test suite.

3. **Dispatch via the enqueue CLI** (the verify-loop agent has no enqueue tool; this is the one sanctioned way — it only writes an ORCHESTRATION job to the jobs db the worker polls). You MUST include `repair_of` = THIS failing cell, so the repair commit's CI verdict binds back to THIS gate (not a disconnected new run) and re-enters you:
   ```
   python -m src.job_queue.enqueue_cli orchestration --json '{"company":"<company>","project":"<project>","spec_intents":[{"spec_name":"<spec_name>"}],"repair_of":{"orchestrate_id":"<orchestrate_id>","task_group_id":"<task_group_id>","repo":"<repo>"}}'
   ```
   Exit 0 prints `{"ok": true, "job_id": "..."}`.

4. **Return.** You do NOT wait. The worker runs `/orchestrate` for the fix → the implementer re-implements in the repo → commits (D1 trailers) → CI fires at commit time (D9) → the inbound-gateway correlates the new SHA to this cell and re-invokes you with a fresh verdict. On that re-entry, reconcile against `jobs.db` and re-fold the gate (idempotent — D10.2). The loop is bounded by the `open_repair` cap in step 1.

<!-- NOTE: This is the async cross-repo verification GATE — per-`(group, repo)` cells folded by the D5 AND gate. It is NOT the single-spec box-check at workflows/implementation/verification/verify-tasks.md (which confirms tasks.md checkboxes for /implement-tasks). Different concerns; don't conflate. -->
