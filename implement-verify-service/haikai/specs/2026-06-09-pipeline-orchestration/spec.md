---
description: Pipeline Orchestration — decisions record
date: 2026-06-09
status: DESIGN
---

# Pipeline Orchestration — Decisions

Companion to [`README.md`](./README.md) (index) and
[`architecture.md`](./architecture.md) (diagram). Decisions follow the
repo convention: inline D-numbers with rationale; revisit when the
assumption breaks. D1–D6 come from the 2026-06-09 `:grill` pass; D7 from the layout
review the same day
(`grill/260609-2340-pipeline-orchestration-spec/` — transcript +
refined plan).

- **D1 — AST layer stays framework-agnostic; the inner agent IS the
  framework-interpretation layer.** `plan_batches` partitions
  mechanically only (import-graph components, package boundaries,
  test-proximity, 50–200-node size normalisation) — a batch is a budget
  boundary, not a framework claim. `ast_query` accepts mechanical
  tree-sitter kinds only (`function_declaration`, `decorator`, …);
  semantic filter values (`endpoint`, `route`, `handler`, …) are
  forbidden. Framework knowledge enters at runtime as LLM-supplied
  `node_filter`s — the inner agent knows `@GetMapping`/`urls.py`/
  `app.get`; the tool just executes. Per CLAUDE.md (AST vs LLM
  Responsibilities); the named framework readers in the original draft
  (`nextjs_reader`, `django_reader`, …) were the
  code-change-per-framework treadmill that principle forbids.
  *(Implemented in e3ee838.)*

- **D2 — The orchestrator is an agent, not a Python runtime.** An agent
  executes `orchestrator.md` top to bottom (same idiom as the
  verification spec's `verification-loop`). There is no
  `orchestrator.py`. The "only LLM call" claim rewords honestly: the
  only **generative** call is `agent.invoke`, plus two orchestrator-
  dispatched exceptions (D5). Accepted risk: ledger/retry invariants
  are prompt-enforced — a duplicate ledger row or blown retry cap in
  practice is the trigger to retrofit guarded writes (verification
  D10.1 pattern: UNIQUE batch_id row, cap-refusing counter).

- **D3 — The unit is a "batch"; "cell" is verification-owned.** The
  verification spec's cell = `(task_group, repo, verifier)` verdict
  slot predates this spec across ~15 artifacts (D-numbers, agents,
  commands, diagrams + mirror). This spec's 50–200-node unit is
  literally a size-bounded batch; renamed accordingly (`plan_batches`,
  `batch_ledger.jsonl`, `batch_plan_check`, `batches.json`).

- **D4 — Gating scripts are "checks"; "hook" is verification-owned.**
  Verification hooks are side-effect-only and never gate; this spec's
  scripts gate via exit code — the inverted contract under the same
  word. Renamed: `pre_check`, `post_check`, and `ledger_write`
  (ex-`gate_hook`, which never gated — it writes the ledger row). The
  family was already 4/7 `*_check`-named.

- **D5 — All agent dispatch happens at the orchestrator (depth 0);
  subagents cannot spawn subagents.** The inner agent (a subagent)
  cannot run `predict()` — platform constraint, not convention.
  Ambiguous `data_movements` records are emitted with
  `ambiguous: true` + `alternatives[]`; the orchestrator resolves them
  via `predict()` at Step 5.4b (≤3 per batch) before `post_check`.
  Likewise `merge_check` Step 3.5 adjudication is orchestrator-run
  (Step 6b) — a deterministic check script cannot dispatch agents.
  `predict()` stays forbidden for endpoints + queries.

- **D6 — Seam to verification: a pipeline run is a task group;
  `final_gate` is its inline verifier.** `final_gate`'s exit code is
  the cell verdict for the `(task_group, repo, inline)` slot;
  `blockers.jsonl` is the `failure_log` the `repair-engine` reads
  (untrusted external text). Counterpart decision: D11 in
  `haikai/specs/2026-05-20-async-verification-orchestration/spec.md`.
  No new verification machinery on either side.

- **D7 — Runtime workflows live in `haikai-profiles/default/`
  (decided 2026-06-09).** When built, `orchestrator.md` and `agent.md`
  move to the repo's established home for agent-read runtime
  workflows — `commands/run-pipeline/run-pipeline.md` (entry, like
  `/orchestrate-tasks`) + `agents/pipeline-orchestrator.md` and
  `agents/batch-extractor.md` (like `verification-loop` /
  `inline-runner`). NOT `.haikai/pipeline/` — that would introduce a
  second runtime-workflow home alongside the profile, a directory-level
  collision. Check/tool specs stay here; implementations land in
  `src/pipeline/{checks,tools}/*.py` mirroring the spec layout (no
  `orchestrator.py` per D2).

- **D8 — The pipeline is the next-gen discovery engine; it reuses the
  structural store and the shipped record models (decided 2026-06-10,
  codebase audit).** `batch-extractor` supersedes the single-run
  discovery loops (`endpoint_discoverer.py` / `interaction_discoverer.py`
  — whole-repo, 30–60-turn runs) for kinds endpoints / data_movements /
  queries. It fixes their audited weaknesses: no batching (whole repo in
  one context), grep-only verification with documented blind spots
  (discovery_loop.py:736–758), file-mismatch records dropped-not-retried
  (pipeline.py:244–250), no ledger. Outputs remain `EndpointInfo` /
  `InteractionInfo` written to `_endpoints.txt` / `_interactions.txt`
  via `FileStore` — downstream consumers (pipeline steps 4/5, diagrams,
  standards synthesis) unchanged. Coexist-then-retire: `run-pipeline`
  is a new mode; the discoverers stay until the pipeline beats them on
  the endpoint benchmark.

- **D9 — `repo.idx` IS the existing structural store snapshot; no
  SQLite.** `ast_index_builder` = the existing structural pipeline
  (`FileStore.write_snapshot` → `.specforge/structural/{repo}/{sha}/`).
  "Designed for grep, not SQL" (store.py:4) stands. `ast_index.has(loc)`
  = file+line lookup against `_index.txt` symbol ranges
  (`line_start..line_end`) and `_calls.txt` caller lines — implemented
  in `src/pipeline/index.py::AstIndex`. `ast_query` is a thin mechanical
  wrapper over the snapshot TSVs; the architecture diagram's
  "SELECT count(*) FROM nodes > 0" reads as `_meta.yaml symbol_count > 0`.

- **D10 — Record schemas derive from the shipped dataclasses.**
  `schemas/endpoints.json` ≡ `EndpointInfo` (models.py:74–86),
  `schemas/data_movements.json` ≡ `InteractionInfo` (models.py:90–102 —
  interactions ARE data movements; store filename kept),
  `schemas/queries.json` is new ({target, statement_kind, mechanism,
  file, line, confidence}). Location fields follow the dataclasses:
  `file` + `line` (not start_line/end_line — the store records symbol
  ranges, the records record anchors). Pipeline envelope adds
  `ambiguous: bool` + `alternatives[]` (D5) and requires `confidence`.
  Validation is stdlib (required/enum/type checks in `post_check`) — no
  jsonschema dependency.

- **D11 — `read_span` and `cross_ref` reuse `enrichment_tools`.**
  `read_span` = `read_source` (enrichment_tools.py:101) with the spec's
  200-line cap; `cross_ref` = `query_callers`/`query_callees` (dep
  graph) + the symbol's `_index.txt` row. No new read paths; the
  scope-protection (`..` rejection) carries over.

- **D12 — Invocation mechanics.** `run-pipeline` (command) → the
  `pipeline-orchestrator` agent → one Task per batch running
  `batch-extractor`; records come back as the subagent's final-message
  JSON. Checks run via Bash: `python -m src.pipeline.checks.<name>`
  (stdin=json, exit=verdict). `cost_usd` in the ledger is nullable —
  the repo tracks no per-call cost today (no aggregation layer; audit
  finding). Parallelism = the orchestrator dispatches up to
  `config.parallelism` Tasks per message. `ledger_write` and the
  duplicate-row refusal are CODE (the check refuses a duplicate
  `batch_id`) — the D2 retrofit trigger is pre-empted where it costs
  one UNIQUE check.

- **D13 — `plan_batches` algorithm (mechanical, deterministic).**
  Candidate count per file = symbols + calls rows for that file.
  Partition: group files by top-level package directory; split any
  group > 200 candidates by sub-directory then by file; merge sibling
  groups < 50 candidates (same parent dir) until ≥ 50 or no siblings.
  `batch_id = f"{kind}-{sha1(kind + ':' + ','.join(sorted(files)))[:10]}"` —
  stable across runs for the same snapshot. Ledger and catalog key off
  it.

## Mechanical follow-ups (no decision)

- Folder rename to `haikai/specs/pipeline-orchestration/` (drop date
  prefix per repo convention; date lives in this header). Deferred to a
  quiet moment — the dated path is referenced by in-flight branches.
