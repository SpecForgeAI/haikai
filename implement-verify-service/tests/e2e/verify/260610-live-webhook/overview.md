# Live webhook — real GitHub repo, real CI, real internet delivery

The last untested hop is closed. Setup: local API (uvicorn :8744) exposed via
a cloudflared quick tunnel; real public repo
`OzzieBelazi/sx-verification-live-demo` with a real Actions workflow
(`compileall` on push); webhook (workflow_run events) signed with a generated
secret, pointed at `/api/v2/inbound/github/{ingress_token}` through the
tunnel; the D10.4 SHA→cell binding recorded BEFORE the push (trigger time).

## What actually happened

1. `git push` → GitHub Actions ran for real → **success**.
2. GitHub delivered **4 real webhooks over the internet** (ping, requested,
   in_progress, completed) — every one answered **HTTP 202** by the gateway
   (GitHub's own delivery log confirms).
3. The gateway authenticated each delivery (real HMAC-sha256), deduped by
   delivery id, correlated via the ci_binding, mapped through the connector
   YAML, and recorded: `pending → pending → pass` (attempts 1→2→3,
   last-writer projection D10.6).
4. Each verdict enqueued a fresh verify-task-group run (D10.2) —
   `reinvoke_requested` ×3 in the event trail.
5. `advance` on the live verdicts: **gate opened**.

## Live-run finding (fixed in the same session)

The 3 re-invoke jobs were enqueued into VERIFICATION_DB_PATH instead of the
worker's JOBS_DB_PATH — with split dbs the worker would never see them.
Fixed in `inbound.py` (+ regression test
`test_reinvoke_lands_in_jobs_db_not_verification_db`).

## Teardown

Webhook deleted; tunnel + API stopped; generated credentials deleted.
The demo repo remains (README marks it safe to delete):
https://github.com/OzzieBelazi/sx-verification-live-demo
