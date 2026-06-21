# Inbound gateway (verification webhook re-entry)

The irreducible-I/O surface that lets the **stateless, one-shot**
[[async-verification-orchestration|verification-loop]] resume when an async
verdict (`ci-trigger` / `observe`) lands minutes-to-days after the loop exited.
Lives in `src/api/routes/inbound.py`; mounted in `src/api/__init__.py:553`
**without** `verify_api_key` — CI providers can't carry the API Bearer token, so
the webhook authenticates by signature instead (D10.4). The four endpoints are
catalogued in [[endpoint-reference]] § "Verification gateway".

## Why it can't be the agent

A stable URL must stay reachable regardless of which agent (if any) is running.
The verification-loop is parked-by-absence — when a cell is `pending`, the loop
has *exited*, not blocked. So re-entry needs a process that is always up: a
FastAPI route. It **routes; it decides nothing** — every judgement stays in the
loop ([[../decisions/verification-is-agentic-not-runtime]], D10).

## The receipt contract — `POST /api/v2/inbound/{provider}/{ingress_token}`

Eight steps (inbound.py:124-196), each a guard:

1. **Authenticate** — path `ingress_token` vs `SX_INGRESS_TOKEN_{PROVIDER}`
   (constant-time), then provider signature: GitHub HMAC-SHA256
   `x-hub-signature-256` over the body keyed by `SX_WEBHOOK_SECRET_{PROVIDER}`;
   GitLab `x-gitlab-token`.
2. **Dedup** — `store.delivery_seen(provider, delivery_id)` on `x-github-delivery`
   / `x-gitlab-event-uuid`. Seen → `200 duplicate` (idempotent).
3. **Parse** — extract `head_sha` + status + conclusion. Non-verdict payload
   (e.g. a queued run) → `202 ignored`.
4. **Correlate** — `store.lookup_binding(head_sha, provider)` resolves the
   **authenticated SHA→cell binding** recorded at CI-trigger time (D10.4 — *not*
   grepped from commit trailers). No binding → **`409`** (SHA never saw a
   verify-task-group).
5. **Map** — connector YAML (`github-actions.yml` / `gitlab-ci.yml`, the single
   source of truth, D9.1a) maps `(status, conclusion)` → verdict
   (`completed+success` → `pass`, `completed+failure` → `fail`, …).
6. **Record** — `recorder.record_verdict_with_delivery()`: the delivery-dedup
   mark and the verdict commit in **one transaction** (R7), so a crash can't
   leave one without the other.
7. **Re-invoke** — `_enqueue_reinvoke(binding)` (inbound.py:87) enqueues a
   **fresh** `VERIFY_TASK_GROUP` job to `jobs.db` (`verify-{orch}-{group}-{rand}`).
   Never a resumed session (D10.2). Best-effort: a queue hiccup logs
   `reinvoke_failed` but the verdict is already durable — the TTL sweeper is the
   backstop.
8. **Respond** — `202` with `{verdict, cell, reinvoke_job, reinvoke}`.

The worker then runs `run_verify_task_group` → `/verify-task-group …
verification_db=…`; the loop **reconstructs all state from `verification_db`**
and re-evaluates the D5 gate with the now-complete verdicts. Same verdicts in →
same branch out: re-entry is idempotent.

## The other three routes

- **`POST /api/v2/reconciliation`** (Bearer-auth, C13) — frontend/Haikai posts
  findings (`bug` / `reconciliation_diff`). Records via `store.record_finding`
  and, when a finding carries a verdict + cell keys, calls
  `recorder.supersede_pending()` (R1: replace a `pending` haibox verdict only if
  it's still pending — atomic, idempotent). Box release is best-effort, outside
  the txn.
- **`GET /api/v2/reconciliation/{orchestrate_id}/findings`** — list, `?status=`.
- **`GET /api/v2/verification/{orchestrate_id}/events`** — the D6 progress
  projection; `?stream=true` yields SSE (`id:`/`event:`/`data:`). How a human
  watches a run live and the cost backstop for a runaway repair loop.

## Bug intake is the sibling pattern

`POST /api/v2/bugs/` (routes/bugs.py:91) is the *non-webhook* async entry: Bearer
auth, enqueues a `BUG_INVESTIGATION` job (`/haikai:debug` + `/haikai:fix`) and
returns `{bug_id, job_id, status:accepted}`; the job POSTs its outcome to the
caller's `callback_url`. `target.command` is **trusted** (S2 — only an
authenticated co-located Haikai may set it). Same enqueue-and-walk-away shape as
the inbound re-invoke, different trigger.

## Guarded writes it depends on

All in `src/verification/recorder.py` — the gateway calls them but never
bypasses a guard:

| Tool | Guard |
|---|---|
| `record_verdict_with_delivery` | R7: delivery-mark + verdict in one txn |
| `supersede_pending` | R1: write only if latest verdict is `pending`/none |
| `advance` | refuse red-gate advance + double-advance |
| `open_repair` | refuse `attempt > 3` (ATTEMPT_CAP) |
| `record_hook` | side-effect only — never gates |

## Cross-references

- [[async-verification-orchestration]] — the loop this re-enters; the cell/gate model
- [[endpoint-reference]] — the four routes in the full census
- [[job-queue]] — `VERIFY_TASK_GROUP` / `BUG_INVESTIGATION` jobs land here
- [[../decisions/verification-is-agentic-not-runtime]] — why the gateway decides nothing
- [[api-layer]] — why this is the one unauthenticated (by Bearer) router

## Sources

- `src/api/routes/inbound.py`, `src/api/routes/bugs.py`
- `src/verification/{recorder,store,sweeper}.py`
- `src/verification/connectors/{github_actions,gitlab_ci,loader}.py`
- [[../../raw/2026-06-21_verify-service-endpoint-deep-dive]]
- [[../../raw/2026-05-31_async-verification-self-repair]]
</content>
