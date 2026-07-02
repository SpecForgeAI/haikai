# CONTEXT — canonical terms (implement-verify-service)

Created by the 2026-07-02 grill of the run-flow-graph spec. One entry per
term; keep entries short; link the spec that owns the full definition.

| Term | Canonical meaning | Owner |
|---|---|---|
| **run** | One orchestration run, anchored on `orchestrate_id` (== the orchestration job id; the key `_record_ci_binding` uses). Repair orchestrations are part of their PARENT run, never runs of their own. | specs/2026-07-02-run-flow-graph (D2, D2c) |
| **command** (node) | One concrete orchestrator command executed by `run_orchestration` — the real chain is `/write-spec, /create-tasks, /implement-tasks, /git-commit-preparation` (haikai_orchestrator.py:108-113). NOT "phase": verification is never a command of the run job. | run-flow-graph D4/D10 |
| **group** | In the SHIPPED runtime, the verification scope of one spec: `task_group_id` IS the spec name (tasks.py:293). `group_model: spec_as_group`. The two-level `spec → task_group` hierarchy exists only in the future orchestration.yml design (`runtime_model: orchestration_dag.v1`) and is never synthesised. | run-flow-graph D2a |
| **cell** | `(orchestrate_id, task_group_id, repo, verifier)` — the D1 verification unit (recorder.py:57). | 2026-05-20 spec |
| **repair target identity** | The complete key a repair job must carry: `orchestrate_id, task_group_id, repo, verifier` (+ `attempt`/`repair_id`). `repair_of` without `verifier` is under-specified (ambiguous when a repo has multiple verifiers). Agent-provided, runtime-validated against the open_repair record; never guessed. | run-flow-graph D2b/D6, I16 |
| **repair attempt** | Logical unit of one repair cycle: protocol-explicit node `…/repair/attempt/{n}`, collapsed in UI behind a badge. A repair orchestration is *physically* a job, *logically* an attempt (D2c). Its internal commands are evidence, not structure (D10a). | run-flow-graph D6 |
| **evidence** | Referenced attachment (`{evidence_kind, ref}`) on a graph node — logs, verdicts, diffs, MR/pipeline URLs, traces. Never inlined, never drives layout, summarised (not enumerated) in snapshots. | run-flow-graph D1/D14 |
| **graph_events** | Dedicated table in the SAME verification SQLite store (NOT extra kinds in `verification_events` — those would leak raw into D6 consumers via the pass-through frame mapper, inbound.py:380-401). Unique indexes make declaration idempotency a DB constraint. | run-flow-graph D3 |
