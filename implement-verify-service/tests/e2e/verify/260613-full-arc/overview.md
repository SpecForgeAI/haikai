# Full-arc e2e + Style-1 round-trip + contract fix — one continuous pass

Goal: prove the whole diagram end-to-end on a real repo, close the pending→final
verdict round-trip (Style-1, Haikai replays + reports back), and resolve the
contract drift for that round-trip.

## Approach (per decision): locally-stitched, real code paths
Real code everywhere on a real repo; only the two genuinely-external drivers are
faithful stand-ins — GitHub Actions running CI (we deliver a REAL HMAC-signed
webhook) and Haikai's reconciler (a replayer that hits the real base_url and
reports back). The LLM-driven legs (orchestrate-implement, verify-agent) are
represented by their real downstream code (a real git commit; direct recorder
verdicts + `advance`).

## Contract fix (the missing piece)
`/api/v2/reconciliation` now accepts an optional per-cell `verdict` (snake_case):
when a finding carries `verdict` + cell keys, it's recorded through the GUARDED
recorder, **superseding the `pending`** haibox left on that `(repo, verifier)`
cell. This is how Haikai reports its reconciliation result back — resolving the
drift by standardising the round-trip on snake_case `/reconciliation` (not a
camelCase build-results door). Tests: `test_reconciliation_intake.py::TestVerdictRoundTrip`.

## The continuous run (verify/260613-full-arc/e2e_full_arc.py) — ARC_OK

| Phase | Real code exercised | Result |
|---|---|---|
| 1 init | real repo clone in workspace | `.git ✓` |
| 2 commit | real `git commit` (LLM-implement stubbed) | SHA `9659f287…` |
| 3 CI | REAL HMAC-signed `workflow_run` → `/inbound` → connector map → `record_verdict` | `202 pass (fastapi, ci-trigger)` |
| 4 cells | `record_verdict` inline + rubric (verify-agent stubbed) | pass, pass |
| 4.5 **gate blocks** | `recorder.advance(expected_cells=…)` with reconciliation unrecorded | **refused: red-gate (D5)** ✓ |
| 5 haibox | `run_haibox_verify` serve-only → deploy fastapi via live haiboxd | cell `pending`, base_url `:63770` |
| 6 **Haikai replay (Style-1)** | `replay_and_diff` vs real base_url (2 ops, 200/200) → POST `/reconciliation` w/ verdict | 0 breaks → `pass`, `verdicts=1` |
| 7 **gate advances** | all 4 cells pass → `recorder.advance` | **advanced** ✓ |

The gate **blocked on `pending`** and **advanced after the final verdict** — the
full deploy→pending→reconcile→advance loop, continuous, on a real repo.

## Honest boundary
- The two external hops are faithful stand-ins by necessity (we don't run GitHub
  Actions or Haikai's codebase here): a real-signed webhook stands in for the
  former, a real-HTTP replayer for the latter. Every standards-extractor code
  path (inbound, recorder, gate, haibox deploy+serve, reconciliation verdict) is
  real.
- LLM-driven legs (orchestrate-implement, the verify-agent that folds the gate)
  are represented by their real downstream code; the LLM driving itself is
  exercised separately (the earlier integration campaign).
