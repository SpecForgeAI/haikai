"""The inbound-gateway (verification spec D9.1) — the single inbound endpoint
that authenticates an external event, classifies its kind, and routes it.

POST /api/v2/inbound/{provider}/{ingress_token}

Receipt contract (decided 2026-06-01): 1 authenticate (ingress token →
per-provider secret, then the provider signature over the body) →
2 dedup (delivery id) → 3 parse (head SHA + status) → 4 correlate (the
D10.4 authenticated SHA→cell binding; no binding → 409) → 5 map status
(connector YAML, the #9a single source of truth) → 6 record_verdict
(guarded, D10.1) → 7 re-invoke (enqueue a fresh verify-task-group run,
D10.2 — never a resumed session) → 8 respond 202.

The gateway decides NOTHING — it routes. The only reason it isn't the
agent: a URL must stay reachable regardless of which agent is running.

Env:
  SX_INGRESS_TOKEN_{PROVIDER}   the path-segment token (auth step 1)
  SX_WEBHOOK_SECRET_{PROVIDER}  HMAC secret (github) / header token (gitlab)
  VERIFICATION_DB_PATH          store override (defaults to JOBS_DB_PATH)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from src.api_auth import verify_api_key
from src.verification import recorder, store
from src.verification.connectors.loader import ConnectorDefError, load_connector

logger = logging.getLogger(__name__)

router = APIRouter(tags=["verification-inbound"])

PROVIDERS = {"github": "github-actions", "gitlab": "gitlab-ci"}


def _secret(name: str) -> str | None:
    return os.environ.get(name)


def _authenticate(provider: str, ingress_token: str, body: bytes, headers) -> str | None:
    """Returns an error string, or None when authenticated. Token selects the
    secret BEFORE the body is trusted (D10.4)."""
    expected = _secret(f"SX_INGRESS_TOKEN_{provider.upper()}")
    if not expected or not secrets.compare_digest(ingress_token, expected):
        return "unknown ingress token"
    secret = _secret(f"SX_WEBHOOK_SECRET_{provider.upper()}")
    if not secret:
        return "no webhook secret configured"
    if provider == "github":
        sig = headers.get("x-hub-signature-256", "")
        digest = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if not secrets.compare_digest(sig, digest):
            return "bad signature"
    elif provider == "gitlab":
        if not secrets.compare_digest(headers.get("x-gitlab-token", ""), secret):
            return "bad token"
    return None


def _parse(provider: str, payload: dict) -> tuple[str | None, str, str | None]:
    """→ (head_sha, status, conclusion). Unknown shapes → (None, '', None)."""
    if provider == "github":
        run = payload.get("workflow_run") or {}
        return run.get("head_sha"), run.get("status", ""), run.get("conclusion")
    if provider == "gitlab":
        attrs = payload.get("object_attributes") or {}
        return attrs.get("sha"), attrs.get("status", ""), None
    return None, "", None


def _delivery_id(provider: str, headers) -> str:
    if provider == "github":
        return headers.get("x-github-delivery", "")
    return headers.get("x-gitlab-event-uuid", "")


def _enqueue_reinvoke(binding: dict) -> str | None:
    """D10.2: a fresh verify-task-group run per inbound event. Best-effort —
    the durable record is the verdict row, so a queue hiccup must not 500 the
    webhook. Returns None on failure.

    Honest failure semantics (predict R4): there is NO automatic re-drive of a
    lost re-invoke. The verdict is already durable; if the enqueue fails the
    re-invoke is dropped and a `reinvoke_failed` event is recorded so it's
    visible. The only backstop is the TTL sweeper (D10.5), which after the TTL
    marks a still-pending cell `timeout` (a FAILED gate, not a re-drive)."""
    try:
        from src.job_queue.job_models import Job, JobStatus, JobType
        from src.job_queue.job_queue import JobQueue

        job = Job(
            job_id=f"verify-{binding['orchestrate_id']}-{binding['task_group_id']}-{os.urandom(4).hex()}",
            type=JobType.VERIFY_TASK_GROUP,
            status=JobStatus.QUEUED,
            company="verification",
            project=binding["repo"],
            request_payload={
                "orchestrate_id": binding["orchestrate_id"],
                "task_group_id": binding["task_group_id"],
                "repo": binding["repo"],
            },
        )
        # The WORKER polls the jobs db — enqueue THERE, not the verification db
        # (store.db_path() prefers VERIFICATION_DB_PATH; when the two differ the
        # job would sit invisible forever — live-run finding). jobs_db_path() is
        # the one resolver shared with the worker and the app queue (predict R2).
        from src.safe_paths import jobs_db_path
        return JobQueue(jobs_db_path()).enqueue_job(job)
    except Exception as exc:  # pragma: no cover — queue optional in tests
        logger.warning("re-invoke enqueue failed (poll fallback will re-drive): %s", exc)
        return None


@router.post("/api/v2/inbound/{provider}/{ingress_token}")
async def inbound(provider: str, ingress_token: str, request: Request) -> Response:
    if provider not in PROVIDERS:
        return JSONResponse({"error": f"unknown provider '{provider}'"}, status_code=404)
    body = await request.body()

    # 1. authenticate
    err = _authenticate(provider, ingress_token, body, request.headers)
    if err:
        return JSONResponse({"error": err}, status_code=401)

    conn = store.connect()
    try:
        # 2. dedup (read-only short-circuit; the DURABLE delivery mark is made
        # atomically with the verdict at step 6, R7 — so a crash can't mark the
        # delivery seen without the verdict and lose it on retry).
        delivery = _delivery_id(provider, request.headers)
        if not delivery:
            return JSONResponse({"error": "missing delivery id"}, status_code=400)
        if store.delivery_seen(conn, provider, delivery):
            return JSONResponse({"status": "duplicate delivery — already processed"}, status_code=200)

        # 3. parse
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            return JSONResponse({"error": "body is not json"}, status_code=400)
        head_sha, status_str, conclusion = _parse(provider, payload)
        if not head_sha:
            # Reserved non-verdict kinds route elsewhere later (D9.1); today: acknowledged, ignored.
            return JSONResponse({"status": "no verdict-bearing payload — ignored"}, status_code=202)

        # 4. correlate — the authenticated SHA→cell binding (D10.4), never trailer-grep
        binding = store.lookup_binding(conn, head_sha, provider)
        if binding is None:
            return JSONResponse({"error": f"no ci_binding for sha {head_sha}"}, status_code=409)

        # 5. map via the connector YAML (#9a)
        try:
            conn_def = load_connector(PROVIDERS[provider])
        except ConnectorDefError as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        verdict = conn_def.map_status(status_str, conclusion) if provider == "github" else conn_def.map_status(status_str)

        # 6. record (guarded) — mark the delivery + record the verdict ATOMICALLY
        # (R7), attempt derived atomically by the recorder (R3).
        rec_status, reason = recorder.record_verdict_with_delivery(
            conn, binding["orchestrate_id"], binding["task_group_id"],
            binding["repo"], binding["verifier"], verdict,
            provider=provider, delivery=delivery,
            detail={"provider": provider, "delivery": delivery, "status": status_str, "conclusion": conclusion},
        )
        if rec_status == "duplicate":  # a concurrent delivery won the race
            return JSONResponse({"status": "duplicate delivery — already processed"}, status_code=200)
        if rec_status != "recorded":
            return JSONResponse({"error": reason}, status_code=409)

        # 7. re-invoke (fresh run, D10.2). A failed enqueue is NOT silently
        # swallowed: record a distinct reinvoke_failed event so the dropped
        # re-invoke is observable (predict R4) — the verdict above is durable.
        job_id = _enqueue_reinvoke(binding)
        kind = "reinvoke_requested" if job_id else "reinvoke_failed"
        store.append_event(conn, binding["orchestrate_id"], binding["task_group_id"],
                           kind, {"job_id": job_id, "trigger": "webhook"}, binding["repo"])

        # 8. 202
        return JSONResponse(
            {"status": "accepted", "verdict": verdict,
             "cell": [binding["repo"], binding["verifier"]],
             "reinvoke_job": job_id, "reinvoke": "queued" if job_id else "failed"},
            status_code=202,
        )
    finally:
        conn.close()


@router.post("/api/v2/reconciliation")
async def reconciliation_intake(request: Request,
                                authenticated: bool = Depends(verify_api_key)) -> Response:
    """Bug / reconciliation-diff intake (D9.1 reserved non-verdict kind).

    Durable, dedup'd intake for externally-reported findings (e.g. the Haikai
    frontend). v0 contract — permissive item shape, to be tightened once the
    sender's schema is fixed:

        { "source": "haikai-frontend",          # required: who sent it
          "delivery_id": "...",                 # optional: dedup the whole batch
          "findings": [                         # one or many (a bare object also ok)
            { "external_id": "BUG-123",         # optional: per-item dedup
              "orchestrate_id": "...",          # optional: correlate to a cell
              "task_group_id": "...", "repo": "...",
              "verifier": "reconciliation",     # optional: which cell (default reconciliation)
              "verdict": "pass|fail",           # optional: the FINAL reconciliation verdict —
                                                #   recorded on the cell, supersedes haibox `pending`
              "kind": "bug|reconciliation_diff",
              "title": "...",
              "detail": { ... } | "diff": "..." # free-form payload
            } ] }

    snake_case throughout (resolves the migration-reconciliation contract drift
    for the pending->final round-trip: Haikai reports its result here, not via a
    camelCase build-results door).

    Auth: standard API bearer key (C13 — one consumer-facing scheme; the
    previous URL-path token was dropped). Findings are UNTRUSTED external text
    (D10.7) — stored as data, never run.
    """

    body = await request.body()
    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError:
        return JSONResponse({"error": "body is not json"}, status_code=400)

    source = payload.get("source")
    if not source:
        return JSONResponse({"error": "source is required"}, status_code=400)
    findings = payload.get("findings")
    if findings is None:
        # accept a bare single finding for convenience
        findings = [payload] if (payload.get("title") or payload.get("detail") or payload.get("diff")) else []
    if not isinstance(findings, list) or not findings:
        return JSONResponse({"error": "no findings to record"}, status_code=400)

    conn = store.connect()
    try:
        # optional batch-level dedup
        delivery = payload.get("delivery_id")
        if delivery and not store.record_delivery(conn, f"reconciliation:{source}", delivery):
            return JSONResponse({"status": "duplicate delivery — already processed"}, status_code=200)

        recorded, duplicates, skipped, verdicts, superseded, ids = 0, 0, 0, 0, 0, []
        boxes_to_release: list[str] = []  # F1: serve-for-Haikai boxes to tear down
        for f in findings:
            if not isinstance(f, dict):
                # Malformed item — count it so the caller sees the mismatch
                # (silent skips were a silent-data-loss bug, predict R3).
                skipped += 1
                continue
            ok, row_id = store.record_finding(conn, source, f)
            if ok:
                recorded += 1
                ids.append(row_id)
                store.append_event(
                    conn, f.get("orchestrate_id", ""), f.get("task_group_id", ""),
                    "finding_received",
                    {"id": row_id, "source": source, "kind": f.get("kind", "bug"), "title": str(f.get("title", ""))[:200]},
                    f.get("repo", ""),
                )
            else:
                duplicates += 1
            # The pending->final round-trip: when a finding carries a `verdict`
            # and the cell keys, record it so it supersedes the `pending` haibox
            # left on that (repo, verifier) cell. This is how Haikai reports its
            # reconciliation result back to us.
            v = f.get("verdict")
            if v in store.VERDICTS and f.get("orchestrate_id") and f.get("task_group_id") and f.get("repo"):
                verifier = f.get("verifier", "reconciliation")
                # R1/C7/S5: ONE atomic statement records the verdict iff the cell's
                # latest is `pending` (or none) — so two concurrent retries can't
                # both supersede + both release. The box to release is the one the
                # SERVER recorded on the pending verdict (never the caller's
                # box_id), returned by the recorder.
                recorded, owned_box = recorder.supersede_pending(
                    conn, f["orchestrate_id"], f["task_group_id"], f["repo"], verifier, v,
                    detail=(f.get("detail") if isinstance(f.get("detail"), dict)
                            else {"source": source}),
                )
                if recorded:
                    verdicts += 1
                    if owned_box:  # F1: a verdict closes the reconciliation -> release
                        boxes_to_release.append(owned_box)
                else:
                    superseded += 1  # cell already terminal — idempotent no-op
        response = {"status": "accepted", "recorded": recorded, "duplicates": duplicates,
                    "skipped": skipped, "verdicts": verdicts, "superseded": superseded, "ids": ids}
    finally:
        conn.close()

    # Release reconciled boxes outside the db txn (HTTP to haiboxd). Best-effort:
    # a release hiccup can't fail the verdict — the box's TTL is the backstop (F1).
    if boxes_to_release:
        from src.haibox.client import HaiboxClient
        client = HaiboxClient()
        released, failed = [], []
        for bid in boxes_to_release:
            try:
                client.release(bid)
                released.append(bid)
            except Exception:
                # C6/L8: don't let a failed release vanish into a missing list
                # entry — surface it so the box leak is attributable, not inferred.
                failed.append(bid)
        response["released_boxes"] = released
        if failed:
            response["failed_releases"] = failed
    return JSONResponse(response, status_code=202)


@router.get("/api/v2/reconciliation/{orchestrate_id}/findings")
async def reconciliation_list(orchestrate_id: str, status: str | None = None,
                              authenticated: bool = Depends(verify_api_key)):
    """Retrieve recorded findings for an orchestration (read-only, bearer-auth)."""
    conn = store.connect()
    try:
        return JSONResponse({"findings": store.list_findings(conn, orchestrate_id, status)})
    finally:
        conn.close()


@router.get("/api/v2/verification/{orchestrate_id}/events")
async def verification_events(orchestrate_id: str, after: int = 0, stream: bool = False,
                              authenticated: bool = Depends(verify_api_key)):
    """D6 projection: the event store, as JSON (default) or SSE (stream=true). Bearer-auth."""
    if not stream:
        conn = store.connect()
        try:
            return JSONResponse({"events": store.events_since(conn, orchestrate_id, after)})
        finally:
            conn.close()

    async def _sse():
        import asyncio

        last = after
        for _ in range(3600):  # bounded long-poll loop
            conn = store.connect()
            try:
                events = store.events_since(conn, orchestrate_id, last)
            finally:
                conn.close()
            for event in events:
                last = event["id"]
                yield f"id: {event['id']}\nevent: {event['kind']}\ndata: {json.dumps(event)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(_sse(), media_type="text/event-stream")
