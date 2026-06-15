# haibox-side reconciliation (replay + diff) — both styles, e2e-verified

Gap addressed: reconciliation can happen TWO ways, and both are now supported.

1. **Haikai replays** (already): `run_haibox_verify` with `target` alone serves
   the target, returns `base_url`, marks the cell `pending`, and leaves the box
   up. Haikai replays against it and reports findings via `/reconciliation` + `/bugs`.
2. **Haikai instructs US to replay** (new): `run_haibox_verify` with `target` +
   `replay` deploys the target, replays the supplied captured operations against
   it, diffs each response vs the expected (oracle), records a real verdict
   (no breaks → pass, any break → fail) plus each break as a reconciliation
   finding, then releases the box.

## What was added
- `src/verification/reconcile.py` — `diff_json(expected, actual, match)` (exact |
  subset structural diff) + `replay_and_diff(base_url, operations, match)` (httpx
  replay → list of breaks). Pure + unit-tested.
- `run_haibox_verify` gains a `replay` block (requires `target`); records breaks
  as `reconciliation_diff` findings so they surface in
  `GET /api/v2/reconciliation/{orchestrate_id}/findings`.

## Full e2e (real repo, real services)
Booted the real `haiboxd` + worker; enqueued two `HAIBOX_VERIFY` jobs targeting
`render-examples/fastapi` with a `replay` block (`match=exact`):

| Case | Ops | Worker log | Verdict |
|---|---|---|---|
| MATCH | `GET /` → `{message:"Hello World"}`, `GET /items/7?q=live` → `{item_id:7,q:"live"}` | `cell (fastapi,reconciliation) -> pass` | **pass**, break_count 0 |
| MISMATCH | `GET /` expected `{message:"Goodbye World"}` (target says "Hello World") | `cell (fastapi,reconciliation) -> fail` | **fail**, break_count 1, finding `('GET /','reconciliation_diff')` |

The worker deployed the real FastAPI app via haibox, replayed the captured ops
against its `base_url`, diffed vs the oracle, recorded the verdict into the
verification store, and (on fail) recorded the break as a finding. Driver:
`e2e_reconcile.py`.

## Tests
6 reconcile unit tests (diff exact/subset/list/scalar; replay match/mismatch/
status) + 4 new verify-job tests (replay pass→release, replay fail→breaks+
findings, replay-without-target→fail). Plus the live e2e above.
