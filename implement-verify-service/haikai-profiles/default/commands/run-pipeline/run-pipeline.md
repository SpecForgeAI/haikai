# Run Pipeline

Run the standards-extraction pipeline against one repo snapshot: mechanical
batching → per-batch generative extraction → deterministic checks → merged,
gated catalog. Design: `haikai/specs/2026-06-09-pipeline-orchestration/`
(D1–D13).

Inputs (ask if missing):
- `snapshot_path` — a structural store snapshot
  (`.specforge/structural/{repo}/{sha}/`); run the structural pipeline first
  if absent (D9).
- `out_dir` — where `catalog.json`, `batch_ledger.jsonl`, `conflicts.jsonl`,
  `blockers.jsonl` land.
- `kinds` — subset of `endpoints, data_movements, queries`
  (default: all three).
- `max_attempts` (default 3), `parallelism` (default 4).

{{IF use_claude_code_subagents}}

Delegate the run to the **pipeline-orchestrator** subagent with the inputs
above. It plans batches, dispatches one **batch-extractor** per batch, runs
the checks, resolves ambiguity, merges, and reports the final-gate verdict.
Relay its report: shipped (catalog path) or blocked (blockers path).

{{ENDIF}}

{{UNLESS use_claude_code_subagents}}

Follow `haikai-profiles/default/agents/pipeline-orchestrator.md` Steps 1–5
inline. For each batch's extraction (Step 3.4), follow
`haikai-profiles/default/agents/batch-extractor.md` inline with the
batch's candidates, then continue the per-batch checks.

{{ENDUNLESS}}

When the run executes as a task group under verification, the final-gate
exit code is the `(task_group, repo, inline)` cell verdict and
`blockers.jsonl` is the repair-engine `failure_log` (D6 / verification D11).
