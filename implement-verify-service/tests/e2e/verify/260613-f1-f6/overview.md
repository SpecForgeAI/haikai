# F1–F6 (reconciliation-handoff review) — resolution

What shipped (code), what's a documented decision, and what needs Gary.

## Shipped — code (test-gated)
- **F1 — box-lifecycle handshake.** The real defect: a serve-for-Haikai box had
  no keep-alive/release owner (reaped mid-replay, or leaked).
  - `run_haibox_verify` serve-only now gives the box a generous window
    (`idle_seconds=3600`, `ttl_seconds=7200` defaults) so the reaper can't kill
    the target while Haikai replays. `base_url` + `box_id` are surfaced.
  - `/api/v2/reconciliation` releases the box when the verdict report carries
    `box_id` (Haikai round-trips it back). Best-effort; TTL is the backstop.
  - Tests: `test_reconciliation_intake.py::test_verdict_with_box_id_releases_box`.
- **F5 — keep `/reconciliation` as the verdict channel.** Confirmed (not retired):
  the `pending → final` verdict round-trip lands here (built earlier). Break→fix
  is routed via `/bugs` (the existing bug contract) — the two are complementary,
  not redundant. No code change needed beyond documenting the split (here).
- **F4 — two orchestration endpoints (doc).** Added a docstring on the sync
  `POST /api/v2/orchestrations` clarifying it's synchronous/no-callback, and that
  the Haikai migration loop uses the async `POST /api/v2/jobs/orchestrations`.
  Non-breaking; the *which-does-Haikai-call* decision is Gary's.

## Documented decision / recommendation (needs Gary)
- **F2 — N-spec integration merge strategy.** Recommend **consolidate-at-deploy**:
  on the `deploy_on_complete` spec, merge all the run's per-spec branches into one
  integration branch and deploy from it (so the target serves all N specs, not
  just the last). Full W2 build (orchestration deploy leg) is a separate, larger
  effort — not "wiring" (F3).
- **F3 — estimation realism.** W2 (deploy + N-spec integration) and W6 (remote
  backend, if ever) are real design/build, not wiring. Flagged so the brief's
  "mostly wiring" line doesn't set the estimate.
- **F6 — one naming convention.** New surfaces are snake_case (the reconciliation
  verdict channel already is). Flipping `bugs.py` (camelCase `bugDescription/
  bugType/callbackUrl`) to snake_case is an **outward-facing contract change that
  would break Gary's frontend** — deliberately NOT done unilaterally. Decision for
  Gary: flip the bug contract to snake_case (one convention) vs keep camelCase as
  a documented exception for the bug-intake surface only.

## Update — Gary's decisions (2026-06-13) + what then shipped
- **D1 → fully automated.** Implemented (W4): a successful bug fix **redeploys**
  via haibox and the callback carries `target_base_url` + `box_id` for Haikai to
  re-reconcile. (commit 2c3c7d0)
- **F2 → consolidate at deploy time.** Implemented the endpoint-agnostic
  `consolidate_and_deploy(repo, spec_branches, serve_spec)` — merges the run's
  spec branches into one integration branch + deploys the integrated whole via
  haibox; raises on conflict. Real-git unit-tested. Endpoint wiring (sync vs
  async) deferred to the F4 decision.
- **F6 → snake_case.** Correction accepted: the documented contract IS snake_case;
  our camelCase `bugs.py` was the deviation. Flipped to snake_case **canonical
  with camelCase aliases** (both accepted, no breakage) + callback keys snaked.
  (commit 226f732)
- **F4 → "needs async" was wrong.** Conceded: the sync `/api/v2/orchestrations`
  works (block, get result); async is a robustness preference for long jobs, not
  a requirement; co-located + merging-soon (F7) makes sync/in-process simpler. So
  the consolidate-deploy mechanic is endpoint-agnostic; *which* endpoint Haikai
  calls remains the open F4 decision.
- **D4 → local sandbox now, extensible later.** Confirmed; the Backend protocol
  seam already makes this "add a class" (Docker/SSH/K8s) — W6 stays deferred, no
  code now.
- **F7 → merging soon.** So keep cross-hop ceremony thin; HTTP-over-loopback now,
  in-process collapse once the repos merge.
- **F4 → async POST /api/v2/jobs/orchestrations + D2 outcome enum.** Shipped
  (commit 98889bf). `OrchestrationRequest` gains 4 optional default-off fields
  (`deploy_on_complete`, `target`, `callback_url`, `integrate_branches`) — they
  ride the async job payload via `model_dump()`. After a clean run,
  `_maybe_deploy_orchestration` consolidates the run's per-spec feature branches
  (reuses F2's `consolidate_and_deploy`) onto one integration branch and serves
  the integrated whole on a haibox box; `_emit_orchestration_callback` POSTs the
  build-results outcome (`implemented | deployed | failed`, snake_case per F6) to
  `callback_url`. Single-repo deploys the first resolved target; polyrepo
  multi-box is Phase-2 (logged, not silently capped). Sync
  `/api/v2/orchestrations` keeps the documented no-deploy/no-callback behaviour
  (default-off). Tests: `tests/test_orchestration_deploy.py`.

## Why F2/F4/F6 weren't force-shipped (before Gary's decisions)
F4 (endpoint removal), F6 (external contract flip), and F2 (merge strategy +
heavy W2) hinge on decisions owned by the Haikai/Gary side. Shipping them
unilaterally would risk breaking the integration. The safe, non-breaking parts
(F1 code, F5 keep + doc, F4 doc, F6 snake-for-new) shipped; the rest are queued
as explicit decisions.
