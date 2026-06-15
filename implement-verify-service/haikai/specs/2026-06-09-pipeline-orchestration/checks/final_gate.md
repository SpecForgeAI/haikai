---
description: Whole-run invariants. Decides whether the catalog ships.
type: check
version: 1.0
encoding: UTF-8
---

# Final Gate (spec)

> See [`../architecture.md`](../architecture.md) — last check in the pipeline.

<ai_meta>
  <rules>No LLM. Pure invariant checks against the catalog and the AST index.</rules>
</ai_meta>

<inputs>out/catalog.json, out/conflicts.jsonl, ast_index</inputs>

<invariants>
  - Every endpoint has a handler ref that resolves in ast_index.
  - Every data_movement has source AND sink resolving in ast_index.
  - Every query has a table/collection identifier that resolves (where the language allows).
  - conflicts.jsonl is empty OR every conflict has a resolution annotation.
</invariants>

<process_flow>

<step number="1" name="check">
  <instructions>
    ACTION: Evaluate each invariant against the catalog.
    ON_FAIL: append row to out/blockers.jsonl with { invariant, record_id, reason }.
  </instructions>
</step>

<step number="2" name="verdict">
  <conditional_block task="ship_decision">
    IF blockers.jsonl empty → exit 0 (ship).
    ELSE → exit 1 (blocked).
  </conditional_block>
</step>

</process_flow>

<exit_codes>
  - 0: ship
  - 1: blocked — see out/blockers.jsonl
</exit_codes>
