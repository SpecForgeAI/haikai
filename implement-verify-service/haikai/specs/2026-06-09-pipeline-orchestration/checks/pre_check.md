---
description: Skip a batch with nothing to extract.
type: check
io: stdin=json, stdout=json, exit=verdict
version: 2.0
encoding: UTF-8
---

# Pre Check (spec)

> Implemented as `src/pipeline/checks/pre_check.py`. Updated 2026-06-10: the
> draft's "language fallback support" branch (proceed with zero candidates if
> a `language_config` marks the language fallback-capable) was dropped — no
> such config exists in the codebase. Zero candidates always skips. If a
> fallback path is ever wanted, the config must be designed first.

<input_schema>
  { batch, candidates: [..] }
</input_schema>

<exit_codes>
  - 0: proceed to agent.invoke — stdout {"verdict": "proceed", "candidate_count": N}
  - 2: skip — stdout {"verdict": "no_candidates"}; the orchestrator writes
    ledger row {status: "no_candidates"} and skips the remaining sub-steps
</exit_codes>
