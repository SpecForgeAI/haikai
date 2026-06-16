# Migration Reconciliation Integration Contract

**Status:** pinned (post-merge). This is the wire contract between the **gateway**
(Migration Execution Driver + Reconciler, `gateway/`) and the
**implement-verify-service** (the Python/FastAPI implement/deploy/verify service,
`implement-verify-service/`, internal container names `standards-extractor-*`).

Before the two repos were merged this contract lived only as prose in two
codebases and had **drifted** (see [Change log](#change-log)). This document is
the single source of truth for the seam; when in doubt, the **code referenced
inline wins**, and any change here must be made on both sides in the same change.

> Machine-readable companion: [`migration-reconciliation-integration.openapi.yaml`](./migration-reconciliation-integration.openapi.yaml).
> The implement-verify-service is FastAPI; its live `/openapi.json` is the
> authoritative generator for that side and should be diffed against this file.

---

## 1. Topology

```
                 POST /api/implementation/build-results   (snake_case, camelCase-tolerant)
   ┌────────────┐  ◄────────────────────────────────────  ┌───────────────────────────┐
   │  gateway   │      outcome callbacks (job + bug)       │ implement-verify-service  │
   │  (8081)    │                                          │  api (8000) + haiboxd     │
   │  Driver +  │  ────────────────────────────────────►  │  (8780)                   │
   │  Reconciler│   POST /api/v2/reconciliation  (snake)   └───────────────────────────┘
   └────────────┘      verdict round-trip (releases haibox boxes)
```

- **Inbound to the gateway** — the implement-verify-service calls
  `POST /api/implementation/build-results` after every unit of work (spec
  implemented/deployed, or a bug fix attempt).
- **Inbound to the implement-verify-service** — the gateway calls
  `POST /api/v2/reconciliation` with the **final reconciliation verdict** for a
  deployed target; this supersedes the haibox `pending` verdict and **releases
  the serving box**. See [§4](#4-reconciliation-verdict-round-trip-gateway--service).

---

## 2. Outcome enum (shared, reconciled)

Defined authoritatively in `implement-verify-service/src/verification/outcomes.py`
and accepted by `gateway/src/services/buildResultsReceiver.ts` (`VALID_OUTCOMES`).

| value          | path        | meaning                                                            | gateway action                          |
|----------------|-------------|--------------------------------------------------------------------|-----------------------------------------|
| `implemented`  | job         | specs built + PR raised, **not** deployed                          | advance run, dispatch next spec         |
| `deployed`     | job & bug   | a serving target exists at `target_base_url`                       | job: mark deployed + kick reconcile · bug: scoped re-reconcile |
| `error`        | job & bug   | nothing built (infra/build error)                                  | halt run-item (`FAILED`) / escalate     |
| `rejected`     | job & bug   | work rejected (e.g. not reproducible / out of scope)               | halt run-item (`REJECTED`) / escalate   |
| `fix_unserved` | bug         | a bug fix was kept (tests green) but the redeploy failed — **the fix exists**, a human must rescue it | escalate to human review |
| `not_fixed`    | bug         | no fix kept — human review / re-file                               | escalate to human review                |
| `failed`       | (back-compat) | legacy collapsed failure; retained so older senders don't 422    | halt run-item (`FAILED`) / escalate     |

**Why the split:** the implement-verify-service deliberately split the old
`failed` into `error` / `fix_unserved` / `not_fixed` because collapsing them
destroyed the load-bearing distinction between *"a fix exists but isn't served"*
(rescuable) and *"no fix"* (re-file). The gateway preserves the **raw** value on
the run-item / break record even though several values route to the same
halt/escalate branch.

> **Merge-drift note:** pre-merge, the gateway only accepted
> `{implemented, deployed, failed, rejected}` and **422'd** the three new values,
> silently dropping `fix_unserved` callbacks — the one state you most need to
> escalate. Reconciled 2026-06-15.

---

## 3. Build-results callback (service → gateway)

`POST /api/implementation/build-results`

- **Auth (inbound):** a service token via `Authorization: Bearer <token>` **or**
  `X-Service-Token: <token>`. Fail-closed: an unset token rejects all callers
  (401). Gateway config: `buildResultsServiceToken`
  (`BUILD_RESULTS_SERVICE_TOKEN`).
- **Encoding:** snake_case on the wire; the receiver is camelCase-tolerant
  (`job_id`/`jobId`, `target_base_url`/`targetBaseUrl`, …).

### Request body

| field             | type     | required                          | notes                                            |
|-------------------|----------|-----------------------------------|--------------------------------------------------|
| `company`         | string   | yes                               | traceability only                                |
| `project`         | string   | yes                               | traceability only (authoritative project is recovered from the run) |
| `outcome`         | enum     | yes                               | see [§2](#2-outcome-enum-shared-reconciled)      |
| `job_id`          | string   | **exactly one** of job_id/bug_id  | spec correlation (orchestration run-item)        |
| `bug_id`          | string   | **exactly one** of job_id/bug_id  | bug-fix correlation (reconciliation break set)   |
| `target_base_url` | string   | **required when `outcome=deployed`** | the served target the Reconciler replays against |
| `pr_url`          | string   | no                                | recorded on the run-item                         |
| `summary`         | string   | no                                | free text; preserved on the record               |

`deploy_on_complete` is **not** a callback field — it is set by the gateway on
the *dispatch* of the final spec in a big-bang run, and the service deploys the
integrated whole exactly once when that flag is set (so the gateway receives a
single `deployed` callback for the run, not one per spec).

### Responses

| status | when                                                              |
|--------|-------------------------------------------------------------------|
| `202`  | `{ "acknowledged": true }` — accepted (incl. idempotent no-op for an already-terminal item) |
| `401`  | bad / missing inbound service token                               |
| `404`  | unknown `job_id` for the workspace                                |
| `422`  | neither/both ids · unknown `outcome` · `deployed` without `target_base_url` |

Idempotency: a duplicate callback for an already-terminal run-item or
break-set is a no-op `202`.

---

## 4. Reconciliation verdict round-trip (gateway → service)

`POST /api/v2/reconciliation` — **this is how a haibox serving box is released.**

> **Implementation status (2026-06-15):** the **service side is built**
> (`implement-verify-service/src/api/routes/inbound.py:200`). The **gateway side
> is NOT yet built** — `triggerFullBaselineReconcile` ends by marking the run
> `RECONCILED` and does not POST the verdict, and the `deployed` build-results
> callback does **not** capture the `orchestrate_id` / `task_group_id` / `repo`
> correlation keys this call requires. Until both are added, every reconcile
> leaks the served box (released only by its TTL backstop). This section is the
> contract the gateway must satisfy.

- **Auth:** standard bearer API key (`STANDARDS_API_KEY`). Single consumer-facing
  scheme; the older URL-path token was removed.
- **Encoding:** snake_case throughout (this endpoint exists specifically so the
  result is reported snake_case here, not via the camelCase build-results door).

### Request body

| field         | type             | required | notes                                                |
|---------------|------------------|----------|------------------------------------------------------|
| `source`      | string           | yes      | who sent it, e.g. `"haikai-frontend"` (400 if absent) |
| `delivery_id` | string           | no       | batch-level idempotency key                          |
| `findings`    | array of finding | yes      | one or many (a bare single finding object is also accepted) |

**finding:**

| field            | type            | required for a verdict | notes                                            |
|------------------|-----------------|------------------------|--------------------------------------------------|
| `verdict`        | `pass` \| `fail`| yes                    | the FINAL reconciliation verdict; supersedes the cell's haibox `pending` |
| `orchestrate_id` | string          | yes                    | correlation key (the orchestration)              |
| `task_group_id`  | string          | yes                    | correlation key (the cell)                       |
| `repo`           | string          | yes                    | correlation key (the cell)                       |
| `verifier`       | string          | no                     | which cell; defaults to `"reconciliation"`       |
| `external_id`    | string          | no                     | per-item dedup                                   |
| `kind`           | string          | no                     | `bug` \| `reconciliation_diff` \| `reconciliation_result` |
| `title`          | string          | no                     | free text                                        |
| `detail`         | object          | no                     | free-form payload (or `diff`: string)            |

### Box release semantics (important)

Release is **server-derived, not caller-directed**. When a finding carries a
`verdict` plus all three correlation keys, the service atomically records it iff
the cell's latest verdict is `pending` (or none), and releases **the box the
server itself recorded on that pending verdict** — a caller-supplied `box_id` is
**deliberately ignored** (IDOR defense). So the gateway never names boxes to tear
down; it reports verdicts keyed by `(orchestrate_id, task_group_id, repo)` and
the service releases the box it owns. A failed release is surfaced (never silently
dropped); the box's TTL is the backstop.

### Response — `202`

```json
{
  "status": "accepted",
  "recorded": 1, "duplicates": 0, "skipped": 0,
  "verdicts": 1, "superseded": 0,
  "ids": ["..."],
  "released_boxes": ["box-..."],
  "failed_releases": ["box-..."]
}
```

`400` if `source` is missing or there are no findings to record.

---

## 5. Correlation keys — summary

| flow                       | key the gateway holds            | key the service holds       |
|----------------------------|----------------------------------|-----------------------------|
| spec dispatch → callback   | `job_id` (run-item)              | `job_id`                    |
| bug send → callback        | `bug_id` (break set)             | `bug_id`                    |
| deploy → **verdict release** | `(orchestrate_id, task_group_id, repo)` — **must be captured from the `deployed` callback (gap)** | the box recorded on the cell's `pending` verdict |

---

## Change log

- **2026-06-15** — Contract pinned post-merge. Reconciled the outcome enum
  (gateway now accepts the full 7-value set the service emits; previously 422'd
  `error` / `fix_unserved` / `not_fixed`). Documented the verdict round-trip and
  flagged the two remaining gateway-side gaps (capture correlation keys; POST the
  verdict).
