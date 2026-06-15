---
description: SELF-VERIFY — the only authority on whether records pass.
type: check
io: stdin=json, stdout=json+stderr-jsonl, exit=verdict
version: 2.0
encoding: UTF-8
---

# Post Check (spec)

> Implemented as `src/pipeline/checks/post_check.py`. Updated 2026-06-10 to
> the shipped contract: records anchor at `file`+`line` (D10 — derived from
> the shipped EndpointInfo/InteractionInfo dataclasses; the draft's
> start_line/end_line range never existed in the store), and endpoints get
> RECORD-level grounding (C1).

<input_schema>
  { batch: {id, kind, ..}, records: [..], snapshot_path }
</input_schema>

<checks in_order="true">
  1. schema_validate per src/pipeline/schemas/<kind>.json — stdlib
     required/enum/type/range/forbid (D10; no jsonschema dependency).
  2. ast_index.has(file, line) — the anchor must be a known symbol start line
     or call line in the snapshot ("loc_not_in_index" = hallucination).
  2b. endpoints only: the symbol AT the anchor must BE the claimed handler —
      handler_method == symbol.name OR handler_class ∈ {symbol.name,
      symbol.scope} ("handler_not_at_anchor"). Anchoring at a call line fails
      ("endpoint_anchor_not_a_symbol"). data_movements/queries anchor at the
      executing call site or enclosing symbol line; their semantic fields are
      the LLM's judgement layer — mechanically ungroundable, by design.
  3. ambiguous:true must not survive — the orchestrator resolves ambiguity at
     5.4b BEFORE this check.
  4. normalise (forward slashes via prefix-strip _norm, schema defaults) +
     dedupe. Keys: endpoints (operation, path, file, line); data_movements
     (source_class, source_method, target, target_type, direction, file,
     line); queries (target, file, line). Duplicates are dropped silently —
     they are not failures.
</checks>

<exit_codes>
  - 0: pass — stdout {"verdict": "pass", "valid_records": [..]}
  - 1: retry — stderr is JSON LINES, each {"record": i, "reason": ".."};
    the orchestrator APPENDS them to prior_failures (accumulated, never
    overwritten) and re-invokes the extractor up to max_attempts
</exit_codes>
