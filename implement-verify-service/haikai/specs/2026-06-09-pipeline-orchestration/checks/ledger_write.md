---
description: Writes the per-batch ledger row.
type: check
io: stdin=json, exit=verdict
version: 1.0
encoding: UTF-8
---

# Ledger Write (spec)

> See [`../architecture.md`](../architecture.md) — bottom of the per-batch loop. The ledger is the only source of truth for batch status.

<ai_meta>
  <rules>
    Never modifies records.
    Never re-runs validation — post_check already did.
    If status != "done", ship the row anyway with empty/partial records.
  </rules>
</ai_meta>

<input_schema>
  { batch_id, status: "done"|"gave_up"|"refused"|"no_candidates", records, attempts, cost_usd, duration_ms }
</input_schema>

<process_flow>

<step number="1" name="append">
  <instructions>Append one JSONL line to out/batch_ledger.jsonl.</instructions>
</step>

</process_flow>

<exit_codes>
  - 0: ledger row written
  - non-zero: surface to orchestrator — the run cannot trust its own bookkeeping
</exit_codes>
