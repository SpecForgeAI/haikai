---
description: Pipeline Orchestration Spec — Index
version: 1.0
encoding: UTF-8
status: DESIGN
---

# Pipeline Orchestration (2026-06-09)

This spec defines the standards-extractor pipeline as a deterministic orchestration with one generative extraction call per batch attempt. It is structured for the Haikai pattern: a small number of *runtime workflows* (orchestrator + inner agent) read at runtime by an agent, and a larger number of *specs* describing deterministic checks and tools.

## Start here

1. Read [`architecture.md`](./architecture.md) — the box-and-arrow diagram that every other file in this folder builds on.
2. Read [`orchestrator.md`](./orchestrator.md) — the runtime workflow an agent executes to drive the whole pipeline.
3. Read [`agent.md`](./agent.md) — the runtime workflow the *inner* agent follows inside `agent.invoke`.
4. Read the check and tool specs as needed when implementing.

## File map

| File | Kind | Read at runtime? |
|---|---|---|
| `spec.md` | decisions record (D1–D7) | no |
| `architecture.md` | reference diagram | no |
| `orchestrator.md` | runtime workflow | yes — by orchestrator agent (moves to `haikai-profiles/default/` at build time, D7) |
| `agent.md` | runtime workflow | yes — by inner agent inside `agent.invoke` (moves with it, D7) |
| `checks/bootstrap_check.md` | spec | no — implemented as `.py` |
| `checks/batch_plan_check.md` | spec | no |
| `checks/pre_check.md` | spec | no |
| `checks/post_check.md` | spec | no |
| `checks/ledger_write.md` | spec | no |
| `checks/merge_check.md` | spec | no |
| `checks/final_gate.md` | spec | no |
| `tools/ast_index_builder.md` | spec | no |
| `tools/plan_batches.md` | spec | no |
| `tools/ast_query.md` | spec | no |

## Status

**IMPLEMENTED (mechanism) 2026-06-10.** The deterministic substrate is built and tested
(`tests/test_pipeline_tools.py`, `tests/test_pipeline_checks.py` — 30 tests). The generative
layer (`batch-extractor`) is an agent prompt, exercised at runtime.

| Spec file | Implementation | Tests |
|---|---|---|
| `tools/ast_query.md` + `ast_index_builder.md` | `src/pipeline/index.py` (`AstIndex` over the structural store, D9), `src/pipeline/tools/ast_query.py` | `test_pipeline_tools.py` |
| `tools/plan_batches.md` | `src/pipeline/tools/plan_batches.py` (D13) | `test_pipeline_tools.py` |
| `checks/*.md` (7) | `src/pipeline/checks/*.py` (`_io.py` shared contract) | `test_pipeline_checks.py` |
| record schemas | `src/pipeline/schemas/{endpoints,data_movements,queries}.json` (D10) | validated in `post_check` |
| `orchestrator.md` / `agent.md` | `haikai-profiles/default/{commands/run-pipeline,agents/pipeline-orchestrator,agents/batch-extractor}` (D7) | runtime |

Build order (historical):

0. *Author-time gate:* `@haikai-skills/grill.md` — ran 2026-06-09 (`grill/260609-2340-pipeline-orchestration-spec/`, six decisions folded in) + the codebase-gap grill 2026-06-10 (D8–D13).
1. `index.py` + `ast_query.py` (foundation — the index IS the structural store, D9).
2. `bootstrap_check` + `plan_batches`.
3. `batch_plan_check`, `pre_check`, `post_check`, `ledger_write` (per-batch gates).
4. `pipeline-orchestrator` + `batch-extractor` agents (the generative call); retry-feedback per `@haikai-skills/subagent-dispatch.md`.
5. `merge_check`, `final_gate` (cross-batch + whole-run); optional adjudication via `@haikai-skills/reason.md`, gated by `config.merge.adjudicate`.

There is no `orchestrator.py` — the **orchestrator is an agent** executing
`agents/pipeline-orchestrator.md` (same idiom as the verification spec's `verification-loop`).
`ledger_write` is the one code-guarded write (D12): it refuses a duplicate `batch_id` row, pre-empting the D10.1 retrofit where it costs one UNIQUE check.

## Haikai integration map

| Pipeline component | Haikai primitive | Role |
|---|---|---|
| `agent.md` retry loop | `subagent-dispatch.md` | Accumulated retry-feedback protocol (ALL prior failures, not just last). |
| `orchestrator.md` Step 5.4b | `predict.md` | Multi-persona vote on records the inner agent marked `ambiguous: true` — *only* for `data_movements` batches. Forbidden for endpoints + queries. Runs at depth 0 (orchestrator), never inside the inner agent: subagents cannot spawn subagents. |
| `tools/plan_batches.md` | `learn.md` | Parallel-readers + merge shape for AST-agnostic structural walkers (import-graph, package boundaries, test-proximity). NOT framework readers — that would violate AST-vs-LLM separation. |
| `checks/merge_check.md` | `reason.md` | Optional conflict adjudication (N generators → critic → judge). Gated by `config.merge.adjudicate`. |
| Build order step 0 | `grill.md` | Author-time gate — stress-test the spec against the target codebase before runtime. |

## Schemas vs rubrics

- *Extraction (this pipeline):* JSON Schema. Records have structural ground truth in the AST index; `post_check` enforces schema + `ast_index.has(loc)` round-trip.
- *Verification (downstream):* haikai rubric format (When-to-invoke · How-to-report · paired detect/fix digraphs · qualitative signals). Different shape because verification is judgement, not ground truth.

Do not adopt rubrics for extraction. Do not adopt schemas for verification.

## Seam to the verification design

A pipeline run is a **task group** under
`haikai/specs/2026-05-20-async-verification-orchestration/` (its D11).
`final_gate`'s exit code is the cell verdict for the
`(task_group, repo, inline)` slot — exit 0 → `pass`, exit 1 → `fail` —
and `out/blockers.jsonl` is the `failure_log` the `repair-engine` reads
(untrusted external text per that spec's D10.7). The pipeline
self-checks *inside* the cell; the verification gate folds it like any
other. Term ownership: **"cell" and "hook" are verification-owned** —
this spec's unit is a *batch*, its gating scripts are *checks*.

## Hard rules

- The only **generative** call is `agent.invoke` (the orchestrator itself is an agent executing `orchestrator.md`, but it generates nothing — it dispatches checks and records outcomes). Two scoped exceptions, both run BY the orchestrator at depth 0, never by the inner agent: (a) `predict()` ambiguity resolution for `data_movements` (Step 5.4b), (b) the *optional* `merge_check` Step 3.5 adjudication, off by default. Subagents cannot spawn subagents — the inner agent never dispatches anything.
- Checks are deterministic. `stdin=json`, `stdout=json`, `exit code = verdict`.
- `post_check` is the only authority on whether records pass — the LLM never marks its own work done.
- Every shipped record round-trips through `ast_index.has(loc)`. No exceptions.
- Every batch ends with exactly one `ledger_write` ledger row.
- Retry feedback ACCUMULATES across attempts (per haikai subagent-dispatch). It never overwrites.
- *AST layer is framework-agnostic; framework interpretation lives in the LLM.* Per CLAUDE.md (Architecture Principle: AST vs LLM Responsibilities): `ast_query` and `plan_batches` work in mechanical primitives only (`function_declaration`, `decorator`, `method_call`, …). `agent.invoke` is the one that decides "this `@GetMapping`-decorated function is a REST endpoint." NEVER add framework-specific pattern matching to the AST tools — new framework support is free because the LLM already knows the framework.
