---
description: Run preconditions — refuse a doomed run before any batch starts.
type: check
io: stdin=json, stdout=json, exit=verdict
version: 2.0
encoding: UTF-8
---

# Bootstrap Check (spec)

> Implemented as `src/pipeline/checks/bootstrap_check.py`. Updated 2026-06-10
> to the shipped contract (D9 made the index the existing structural-store
> snapshot; D10 made validation stdlib; D2 removed the runtime model from the
> deterministic layer — the original 5-step ritual referenced none of these).

<input_schema>
  { snapshot_path, out_dir, kinds: [..], max_attempts: int, parallelism: int }
</input_schema>

<checks>
  1. snapshot_path points at a structural-store snapshot (`_index.txt` present).
     There is no index BUILD step — the index IS the snapshot (D9); if it is
     missing, the structural pipeline must run first.
  2. out_dir is creatable and writable (write-probe).
  3. every kind ∈ {endpoints, data_movements, queries} and its schema file
     exists under src/pipeline/schemas/.
  4. max_attempts and parallelism are positive integers.
</checks>

<exit_codes>
  - 0: proceed — stdout {"verdict": "proceed"}
  - 1: abort — stdout {"verdict": "abort", "problems": [..]} (all problems
    reported at once, not first-failure)
</exit_codes>
