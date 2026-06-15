---
description: Pipeline orchestration architecture diagram.
version: 1.0
encoding: UTF-8
---

# Architecture

The canonical box-and-arrow view of the pipeline. Every spec in this folder is built around this diagram. If you change the diagram, change the corresponding spec.

```
 ┌──────────────────────┐
 │   orchestrator.py    │  ← entry point
 │   load_config()      │
 └──────────┬───────────┘
            │
            ▼
 ┌─────────────────────────────┐
 │ [CHECK] bootstrap_check.py   │  deterministic
 │  verify: checks, schemas,    │  ── exit 0   ──►
 │  models, repo, out          │  ── exit !=0 ──► abort
 └──────────────┬──────────────┘
                │
                ▼
 ┌──────────────────────────────┐
 │   ast_index_builder.py       │  no LLM
 │   tree_sitter.parse_all()    │  writes
 │   → out/ast/repo.idx         │  queryable index
 └──────────────┬───────────────┘
                │
                ▼
 ┌────────────────────────────────────────────────┐
 │ plan_batches(kinds=[endpoints, data_mv, query])  │
 │ → [batch_1 .. batch_M]                           │
 └─────────────────────┬──────────────────────────┘
                       │
 ┌─────────────────────┴─────────────────────────┐
 │            PER-BATCH LOOP (parallel)           │
 │                                               │
 │  ┌─────────────────────────────────────┐      │
 │  │ [CHECK] batch_plan_check.py           │      │
 │  │  refuse impossible batches            │      │
 │  └──────────────┬──────────────────────┘      │
 │                 ▼                             │
 │  ┌─────────────────────────────────────┐      │
 │  │ [TOOL] ast_query(filter, index)     │ ◄── code path A
 │  │  deterministic, no LLM              │     (structured)
 │  │  filter uses MECHANICAL kinds only  │      │
 │  │  (function_declaration, decorator…) │      │
 │  │  returns: mechanical AST candidates │      │
 │  └──────────────┬──────────────────────┘      │
 │                 ▼                             │
 │  ┌─────────────────────────────────────┐      │
 │  │ [CHECK] pre_check.py                  │      │
 │  │  skip if candidates empty + lang    │      │
 │  │  has no fallback support            │      │
 │  └──────────────┬──────────────────────┘      │
 │                 ▼                             │
 │  ┌─────────────────────────────────────┐      │
 │  │ agent.invoke(spec, attempt=k)       │      │
 │  │  tools available to model:          │      │
 │  │   - ast_query(node_filter)          │      │
 │  │   - read_span(file, lines)          │ ◄── code path B
 │  │   - cross_ref(record, index)        │     (LLM, narrow)
 │  │  model emits: records[] (json)      │      │
 │  └──────────────┬──────────────────────┘      │
 │                 ▼                             │
 │  ┌─────────────────────────────────────┐      │
 │  │ [CHECK] post_check.py ── SELF-VERIFY  │      │
 │  │  1. schema_validate(records)        │      │
 │  │  2. for r in records:               │      │
 │  │       assert ast_index.has(r.loc)   │      │
 │  │  3. dedupe + normalise              │      │
 │  │  exit 0 = pass                      │      │
 │  │  exit 1 = retry (stderr → prompt)   │      │
 │  └──────────────┬──────────────────────┘      │
 │                 │                             │
 │      pass ◄─────┴─────► fail                  │
 │       │                  │                    │
 │       │                  ▼                    │
 │       │          k < max_attempts?            │
 │       │            yes → loop back to agent   │
 │       │                  with {{prior_failure}}│
 │       │            no  → mark gave_up         │
 │       ▼                                       │
 │  ┌─────────────────────────────────────┐      │
 │  │ [CHECK] ledger_write.py                 │      │
 │  │  write batch ledger row:             │      │
 │  │   status: done | gave_up            │      │
 │  │   records[], attempts, cost         │      │
 │  └─────────────────────────────────────┘      │
 └───────────────────────┬───────────────────────┘
                         │
                         ▼
            ┌──────────────────────────────────┐
            │ [CHECK] merge_check.py            │
            │  cross-batch dedupe + conflict    │
            │  detection                       │
            └──────────────┬───────────────────┘
                           │
                           ▼
            ┌──────────────────────────────────┐
            │ [CHECK] final_gate.py             │
            │  invariants across whole run     │
            │  (e.g. every endpoint has a      │
            │   handler ref that resolves)     │
            └──────────────┬───────────────────┘
                           │
                           ▼
                  out/catalog.json
                  out/batch_ledger.jsonl
                  out/logs/*.jsonl
```

## Legend

- `[CHECK]` — deterministic script. `stdin=json`, `stdout=json`, `exit code = verdict`.
- `[TOOL]` — callable surface. Same code, can be invoked by orchestrator or inner agent.
- *Code path A* — structured-first (cheap, exhaustive recall).
- *Code path B* — LLM with narrow tools (only after `ast_query`; never reads raw repo).
- *Self-verification* — `post_check`. The LLM cannot mark its own work done. Every record must round-trip through `ast_index.has(loc)` before it ships.

## Hard rules implied by the diagram

1. *Generative extraction runs in one box.* `agent.invoke` is the one generative call per batch attempt; the orchestrator additionally dispatches predict() ambiguity resolution (5.4b) and the optional merge adjudication (6/3.5) at depth 0.
2. *Checks are deterministic.* No check calls the LLM. Checks gate behaviour via exit code.
3. *Self-verify is not the agent's job.* `post_check` is the only authority on whether records pass.
4. *Failures repair, they do not regenerate.* Retry feeds stderr → next attempt's `prior_failures` (accumulated, per haikai subagent-dispatch); the agent fixes what failed, keeps what passed.
5. *The ledger is the source of truth for batch status.* Every batch ends with exactly one `ledger_write` ledger row.
6. *AST layer is framework-agnostic. LLM layer does framework interpretation.* Per CLAUDE.md: `ast_query` and `plan_batches` deal in mechanical AST primitives only (function_declaration, decorator, method_call, …). The agent inside `agent.invoke` is the one that says "this `@GetMapping`-decorated function is a REST endpoint." Adding framework-specific patterns to `ast_query` or `plan_batches` is forbidden — new framework support comes for free because the LLM already knows the framework.
