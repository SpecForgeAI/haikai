# Swap-over runbook (persistence tier)

One-way side-by-side migration mssql → postgres. Run this ordered checklist inside the agreed cutover window. Every gate is mechanical — do not proceed past a failed gate.

1. **Freeze source writes** (application maintenance mode / revoke app logins).
2. **Final delta**: run `sync/run-incremental-sync.sh` one last time inside the window.
3. **Zero-drift gate**: `reconcile/build-report.sh` must exit 0. A DRIFT exit blocks the swap.
4. **Seed sequences/identities**: apply the post-load Liquibase context (`liquibase/changesets/040-sequences-seed.sql`) NOW — not at bulk load; the source high-water advanced during side-by-side running (4 sequence(s)/identities recorded in the pack).
5. **Scheduled jobs**: none recorded in the pack manifest.
6. **Switch connection strings** to the target and lift maintenance mode.
7. **Verify**: the pack's expected-schema diff is green against the live target; run one more reconciliation pass (should be trivially clean with the source frozen); smoke the API reconciliation loop.
8. **Keep the source read-only** for the agreed fallback period before decommission planning.
