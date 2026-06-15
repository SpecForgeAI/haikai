---
description: Cross-batch dedupe + conflict detection.
type: check
version: 1.0
encoding: UTF-8
---

# Merge Check (spec)

> See [`../architecture.md`](../architecture.md) — runs once after all batches complete.

<ai_meta>
  <rules>
    Structural merge is deterministic (steps 1, 2, 4).
    Conflict adjudication (step 3.5) is OPTIONAL and LLM-driven — gated by config.merge.adjudicate=true.
    Step 3.5 is NOT executed by this script — merge_check.py is deterministic. The ORCHESTRATOR runs 3.5 (depth-0 agent dispatch, orchestrator.md Step 6) between this check's conflict emission and the catalog write; a check script cannot dispatch agents.
    When adjudication is off, conflicts are emitted to conflicts.jsonl with no winner, and the catalog row is omitted (current safe default).
  </rules>
</ai_meta>

<haikai_references>
  - @haikai-skills/reason.md — adversarial generate → critique → synthesize → judge. Used as the adjudication protocol when two batches emit competing handler refs for the same logical id.
</haikai_references>

<inputs>out/batch_ledger.jsonl — rows missing batch_id or with an unknown kind prefix are reported under batches_skipped["malformed"], never crash (P1f)</inputs>
<produces>out/catalog.json, out/conflicts.jsonl</produces>

<process_flow>

<step number="1" name="collect">
  <instructions>Concatenate records from all batches with status = "done".</instructions>
</step>

<step number="2" name="dedupe">
  <instructions>Group by (kind, file, line); keep highest-confidence record. (D10: records anchor at file+line.)</instructions>
</step>

<step number="3" name="conflicts">
  <instructions>
    Same logical id (e.g. endpoint path+method) with different handler refs → emit row to conflicts.jsonl.
    KEEP both sides — do not silently drop either.
  </instructions>
</step>

<step number="3.5" name="adjudicate" optional="true" gated_by="config.merge.adjudicate">

### Step 3.5: Adjudicate Conflicts (haikai:reason)

  <instructions>
    PRECONDITION: config.merge.adjudicate == true. Otherwise skip.
    FOR each conflict row in conflicts.jsonl:
      INVOKE @haikai-skills/reason.md with:
        - N generators = the conflicting batch records (one per side)
        - critic role = "flag weak evidence: missing refs, low-confidence signature, ambiguous decorator"
        - judge role = "pick the record best supported by ast_index refs"
      RESULT: { winner: record, loser: record, justification: string }
      ACTION:
        - Promote winner into catalog.json (Step 4).
        - Append { winner_id, loser_id, justification } to conflicts.jsonl/resolved (do not delete the original conflict row — keep both for audit).
    HARD RULE: adjudication may NEVER invent a third record. Winner must be one of the two sides verbatim.
  </instructions>

</step>

<step number="4" name="emit">
  <instructions>
    Write out/catalog.json.
    Records selected: dedupe survivors + (if adjudication ran) winners from Step 3.5.
    Unresolved conflicts (adjudication off, or judge inconclusive) are NOT in catalog.json — final_gate will block on them.
  </instructions>
</step>

</process_flow>

<exit_codes>
  - 0 always — final_gate decides whether to ship.
</exit_codes>
