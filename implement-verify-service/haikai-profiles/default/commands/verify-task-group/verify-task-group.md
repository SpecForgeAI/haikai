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

<!-- NOTE: This is the async cross-repo verification GATE — per-`(group, repo)` cells folded by the D5 AND gate. It is NOT the single-spec box-check at workflows/implementation/verification/verify-tasks.md (which confirms tasks.md checkboxes for /implement-tasks). Different concerns; don't conflate. -->
