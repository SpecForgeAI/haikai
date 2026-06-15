---
description: Standards Extractor Pipeline Orchestration
globs:
alwaysApply: false
version: 1.0
encoding: UTF-8
---

# Standards Extractor Pipeline Orchestration

> *Read [`architecture.md`](./architecture.md) first.* This file is the runtime workflow that drives the diagram. An agent executes it top to bottom each run.

<ai_meta>
  <rules>
    You are the orchestrator agent. Execute steps sequentially.
    Generative calls happen ONLY at Step 5.4 (agent.invoke), Step 5.4b (predict, data_movements ambiguity), and Step 6's optional 3.5 adjudication. You dispatch all of them — the inner agent dispatches nothing (subagents cannot spawn subagents).
    Do NOT skip gate steps.
    Every batch must end with exactly one ledger_write ledger row.
    Checks are deterministic scripts — never replace their output with your own judgement.
  </rules>
  <context_check>
    Verify config path provided on argv. Confirm out_dir writable.
  </context_check>
</ai_meta>

## Overview

<purpose>
  - Execute the standards-extraction pipeline against repo_path.
  - Coordinate deterministic checks and one generative extraction call per batch attempt.
  - Emit out/catalog.json + out/batch_ledger.jsonl.
</purpose>

<context>
  - Checks live at @checks/*.md (spec) → implemented as src/.../checks/*.py
  - Tools live at @tools/*.md (spec) → implemented as src/.../tools/*.py
  - Inner agent spec at @agent.md
  - You may shell out via Bash. You may NOT read source files directly.
</context>

<process_flow>

<step number="1" name="load_config">

### Step 1: Load Configuration

<step_metadata>
  <inputs>config_path from argv</inputs>
  <produces>ctx = { snapshot_path, out_dir, kinds, max_attempts, parallelism }</produces>
</step_metadata>

<instructions>
  ACTION: Bash → cat "$CONFIG_PATH" and parse as JSON (written by `python -m src.cli run-pipeline`, D12).
  VALIDATE: Required keys present: snapshot_path, out_dir, kinds, max_attempts, parallelism.
  BLOCK: If any key missing, exit 2 with reason. Do not proceed.
</instructions>

</step>

<step number="2" name="bootstrap_check">

### Step 2: Bootstrap Check

<step_metadata>
  <invokes>$CHECK_DIR/bootstrap_check.py</invokes>
  <gate>true</gate>
</step_metadata>

<instructions>
  ACTION: Bash → echo "$CTX_JSON" | "$CHECK_DIR/bootstrap_check.py"
  VALIDATE: exit code == 0.
  BLOCK: On non-zero, surface stdout to operator and abort run.
</instructions>

</step>

<step number="3" name="build_index">

### Step 3: Resolve AST Index (D9 — the index IS the structural-store snapshot)

<step_metadata>
  <produces>$SNAPSHOT_PATH (already built by the structural pipeline)</produces>
</step_metadata>

<instructions>
  ACTION: Confirm "$SNAPSHOT_PATH/_index.txt" exists and _meta.yaml symbol_count > 0.
  BLOCK: If missing, abort with reason "no snapshot — run the structural pipeline (analyze) first".
  NOTE: There is no index builder in this pipeline; bootstrap_check (Step 2) already verified this.
</instructions>

</step>

<step number="4" name="plan_batches">

### Step 4: Plan Batches

<step_metadata>
  <invokes>$TOOL_DIR/plan_batches.py</invokes>
  <produces>batches[]</produces>
</step_metadata>

<instructions>
  ACTION: Bash → python -m src.pipeline.tools.plan_batches --index "$SNAPSHOT_PATH" --kinds "$KINDS" --out "$OUT_DIR/batches.json"
  VALIDATE: 50 ≤ candidate count ≤ 200 per batch, EXCEPT single-file batches marked oversize: true (C5 — unsplittable, admitted).
  CORRECT: Multi-file oversize means a stale plan — re-run plan_batches.
</instructions>

</step>

<step number="5" name="run_batches">

### Step 5: Per-Batch Pipeline

<step_metadata>
  <parallelism>bounded by config.parallelism</parallelism>
  <sub_steps>5.1 → 5.6</sub_steps>
</step_metadata>

<instructions>
  ACTION: For each batch in batches[], execute sub-steps 5.1–5.6.
  PARALLEL: Up to config.parallelism batches in flight.
  DEGRADE: Batch-level failures DO NOT abort the run.
</instructions>

<step number="5.1" name="batch_plan_check">

### Step 5.1: Batch Plan Check

<instructions>
  ACTION: Bash → echo "$BATCH_JSON" | "$CHECK_DIR/batch_plan_check.py"
  CONDITIONAL_BLOCK:
    IF exit 0 → proceed to 5.2
    IF exit 1 → write ledger { status: "refused", reason: stdout.reason }; skip remaining sub-steps
</instructions>

</step>

<step number="5.2" name="ast_query">

### Step 5.2: AST Query (Code Path A)

<instructions>
  ACTION: Bash → python -m src.pipeline.tools.ast_query --index "$SNAPSHOT_PATH" --filter '<mechanical-json>'
  STORE: candidates = stdout JSON array, scoped to the batch's files (file_glob).
  NOTE: filters are MECHANICAL only (node_kinds/name_regex/file_glob/has_decorator) — there is no --kind flag; semantic values exit 2 (D1).
</instructions>

</step>

<step number="5.3" name="pre_check">

### Step 5.3: Pre Check

<instructions>
  ACTION: Bash → echo '{"batch":'"$BATCH_JSON"',"candidates":'"$CANDIDATES"'}' | "$CHECK_DIR/pre_check.py"
  CONDITIONAL_BLOCK:
    IF exit 0 → proceed to 5.4
    IF exit 2 → write ledger { status: "no_candidates" }; skip remaining sub-steps
</instructions>

</step>

<step number="5.4" name="agent_invoke">

### Step 5.4: Agent Invoke (the generative extraction call)

<step_metadata>
  <llm>true</llm>
  <spec>@agent.md</spec>
  <retry_loop>max_attempts from config</retry_loop>
</step_metadata>

<instructions>
  INIT: attempt = 0, prior_failures = [], status = null

  LOOP:
    attempt += 1
    ACTION: Invoke inner agent per agent.md with { batch, candidates, attempt, prior_failures }.
    CONSTRAINT: Inner agent may only use tools listed in agent.md. It cannot dispatch agents.
    STORE: records = inner_agent.output.records

    ACTION (Step 5.4b — ambiguity resolution, depth 0):
      IF batch.kind == "data_movements" AND any record has ambiguous == true:
        FOR each ambiguous record (max 3 per batch):
          INVOKE predict(record, personas=3) per @haikai-skills/predict.md — dispatched by YOU, the orchestrator. The inner agent cannot do this (subagents cannot spawn subagents).
          REPLACE the record's classification with the winning persona's choice from record.alternatives; drop the ambiguous/alternatives fields.
        IF more than 3 ambiguous records → resolve the first 3; for the rest take the FIRST alternative, set confidence: 0.3, drop the ambiguous/alternatives fields (post_check rejects surviving ambiguous:true and non-numeric confidence).

    ACTION (Step 5.5 — post check): Bash → echo '{"batch":'"$BATCH"',"records":'"$RECORDS"'}' | "$CHECK_DIR/post_check.py"

    CONDITIONAL_BLOCK:
      IF post_check exit 0:
        status = "done"
        valid_records = stdout.valid_records
        BREAK
      ELIF attempt < max_attempts:
        prior_failures.append({ attempt: attempt, stderr: stderr })
        # Accumulated-feedback protocol per @haikai-skills/subagent-dispatch.md.
        # Never overwrite; the inner agent must see ALL prior attempts' failures.
        CONTINUE
      ELSE:
        status = "gave_up"
        valid_records = []
        BREAK
</instructions>

</step>

<step number="5.6" name="ledger_write">

### Step 5.6: Ledger Write

<instructions>
  ACTION: Bash → echo '{batch_id, status, records: valid_records, attempts, cost_usd, duration_ms}' | "$CHECK_DIR/ledger_write.py"
  VALIDATE: exit 0; one new line in $OUT_DIR/batch_ledger.jsonl.
  BLOCK: On non-zero, surface — ledger is the only source of truth for batch status.
</instructions>

</step>

</step>

<step number="6" name="merge">

### Step 6: Merge Across Batches

<step_metadata>
  <invokes>$CHECK_DIR/merge_check.py</invokes>
  <produces>$OUT_DIR/catalog.json, $OUT_DIR/conflicts.jsonl</produces>
</step_metadata>

<instructions>
  ACTION: Bash → "$CHECK_DIR/merge_check.py" --ledger "$OUT_DIR/batch_ledger.jsonl" --out "$OUT_DIR/catalog.json"
  VALIDATE: catalog.json exists.

  ACTION (Step 6b — optional adjudication, depth 0):
    IF config.merge.adjudicate == true AND conflicts.jsonl non-empty:
      FOR each conflict row: run the @haikai-skills/reason.md panel per checks/merge_check.md Step 3.5 — dispatched by YOU (merge_check.py is deterministic and cannot dispatch agents).
      Promote winners into catalog.json; append resolutions per the check spec.
</instructions>

</step>

<step number="7" name="final_gate">

### Step 7: Final Gate

<step_metadata>
  <invokes>$CHECK_DIR/final_gate.py</invokes>
  <gate>true</gate>
</step_metadata>

<instructions>
  ACTION: Bash → echo '{"out_dir": "$OUT_DIR", "snapshot_path": "$SNAPSHOT_PATH"}' | python -m src.pipeline.checks.final_gate
  CONDITIONAL_BLOCK:
    IF exit 0 → run ships; emit success to operator
    IF exit 1 → run blocked; surface $OUT_DIR/blockers.jsonl
</instructions>

</step>

</process_flow>

## Execution Checklist

<checklist>
  - [ ] Config loaded and validated
  - [ ] Bootstrap check passed
  - [ ] AST index built (nodes > 0)
  - [ ] All batches reached ledger_write (status ∈ {done, gave_up, refused, no_candidates})
  - [ ] batch_ledger.jsonl row count == batches planned
  - [ ] merge_check emitted catalog.json
  - [ ] final_gate verdict reached
</checklist>

## Error Handling

<error_template>
  STAGE: [bootstrap | index | plan | batch.{id}.{sub_step} | merge | final]
  BATCH_ID: [if applicable]
  REASON: [...]
  RECOVERY: [abort | degrade | retry]
</error_template>

## Operator Output

<on_success>
  "Pipeline shipped. Catalog at $OUT_DIR/catalog.json. Ledger at $OUT_DIR/batch_ledger.jsonl."
</on_success>

<on_block>
  "Pipeline blocked at $STAGE. See $OUT_DIR/blockers.jsonl."
</on_block>
