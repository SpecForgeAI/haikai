---
description: Per-batch sanity check before any work runs.
type: check
io: stdin=batch, stdout=json, exit=verdict
version: 1.0
encoding: UTF-8
---

# Batch Plan Check (spec)

> See [`../architecture.md`](../architecture.md) — first box inside the per-batch loop.

<ai_meta>
  <rules>No LLM. Decision only — never modifies the batch.</rules>
</ai_meta>

<input_schema>
  batch := { id, kind, scope: {files: glob[]}, ast_filter }
</input_schema>

<output_schema>
  { "ok": bool, "reason": string }
</output_schema>

<refuse_when>
  - ast_filter is empty
  - kind not in registered kinds
  - scope resolves to >2000 AST nodes
  - scope resolves to 0 files
</refuse_when>

<process_flow>

<step number="1" name="check">
  <instructions>Evaluate refuse_when conditions in order. First match wins.</instructions>
</step>

<step number="2" name="emit">
  <instructions>Write { ok, reason } to stdout. Set exit code per verdict.</instructions>
</step>

</process_flow>

<exit_codes>
  - 0: proceed
  - 1: refuse (orchestrator records batch skipped with reason)
</exit_codes>
