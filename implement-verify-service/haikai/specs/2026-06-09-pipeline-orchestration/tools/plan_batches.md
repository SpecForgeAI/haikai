---
description: Carves the snapshot into bounded LLM-sized batches.
type: function
version: 2.0
encoding: UTF-8
---

# Plan Batches (spec)

> Implemented as `src/pipeline/tools/plan_batches.py`
> (`python -m src.pipeline.tools.plan_batches --index <snapshot> --kinds <k,..> --out <batches.json>`).
> Updated 2026-06-10 to the shipped D13 algorithm.

<ai_meta>
  <rules>
    No LLM in planning. A batch is a BUDGET boundary, not a framework claim
    (D1/D3) — partitioning is purely positional/size-based.
  </rules>
</ai_meta>

<algorithm decided="D13">
  - candidate count per file = symbol rows + call rows in the snapshot
  - group files by top-level package directory
  - split any group > 200 candidates by sub-directory, then file-greedy
  - merge sibling groups < 50 candidates (same top-level package)
  - a SINGLE file over 2×200 cannot be split: planned with oversize: true and
    admitted by batch_plan_check in exactly that shape (C5 — refusing it was
    a deterministic dead-end)
  - batch_id = "{kind}-{sha1(kind + ':' + sorted files)[:10]}" — stable per
    snapshot; ledger and catalog key off it
</algorithm>

<output_schema>
  batch := { id, kind, scope: {files: [..]}, candidate_count, oversize?: true }
</output_schema>

## Benchmark-gated follow-up (deliberately NOT built)

The original draft proposed two relational heuristics that D13 dropped for
v1: **import-graph components** (batch files that import each other so
cross-file context lands in one batch — `_imports.txt` + ImportsQuery already
provide the edges) and **test-proximity** (pull a module's tests into its
batch — tests name endpoints/tables explicitly). Revisit ONLY if the
endpoint-benchmark run shows directory batching hurting recall on cross-file
kinds (data_movements first). Do not build on a hunch.
