#!/usr/bin/env python
"""Scenario: trigger a GitLab pipeline, then LISTEN (webhook path) for it to finish.

This wires the pieces we built end-to-end against the service's own inbound
gateway:

    trigger_and_bind ──► record SHA→cell binding (D10.4) ──► fire pipeline
                                                                   │
        GitLab runs CI … (minutes) … pipeline finishes            ▼
    POST /api/v2/inbound/gitlab/{ingress_token}  ◄── GitLab webhook
        gateway: auth → correlate by SHA → record verdict → re-invoke
                                                                   │
    a consumer polling GET /api/v2/verification/{orch}/events  ◄───┘
        sees: verdict_recorded + reinvoke_requested  → "pipeline finished"

It runs the gateway router on a real localhost HTTP server (uvicorn), so the
"listen" is a genuine inbound HTTP receipt, not an in-process call.

Modes
-----
--simulate   (works with no external infra): after binding, this process
             delivers the signed completion webhook to the local gateway itself,
             standing in for GitLab. Proves the full path locally.

live         (default): does a real trigger_and_bind against GitLab and then
             waits for a REAL webhook. For GitLab to reach this gateway you must
             (1) expose this URL publicly (tunnel / deployed service) and
             (2) add a *Pipeline events* webhook on the project pointing at
                 https://<public-host>/api/v2/inbound/gitlab/<INGRESS_TOKEN>
                 with the secret token set to SX_WEBHOOK_SECRET_GITLAB.
             Env: GITLAB_TOKEN (+ GITLAB_URL for self-hosted), and a --project.

Env (gateway):
    SX_INGRESS_TOKEN_GITLAB   path-segment token (defaults to a demo value)
    SX_WEBHOOK_SECRET_GITLAB  webhook secret / x-gitlab-token (defaults likewise)
    STANDARDS_API_KEY         bearer key for the events projection (defaults)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
import time

import requests

# Demo defaults so --simulate runs with zero setup; override via env for live.
INGRESS = os.environ.setdefault("SX_INGRESS_TOKEN_GITLAB", "demo-ingress-token")
SECRET = os.environ.setdefault("SX_WEBHOOK_SECRET_GITLAB", "demo-webhook-secret")
BEARER = os.environ.setdefault("STANDARDS_API_KEY", "demo-events-key")


def _start_gateway(port: int) -> threading.Thread:
    """Serve the real inbound-gateway router on localhost:port (uvicorn thread)."""
    import uvicorn
    from fastapi import FastAPI

    import src.api.routes.inbound as inbound

    app = FastAPI()
    app.include_router(inbound.router)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    # wait until it answers (404 on / is fine — it means the server is up)
    for _ in range(100):
        try:
            requests.get(f"http://127.0.0.1:{port}/", timeout=1.0)
            break
        except requests.exceptions.RequestException:
            time.sleep(0.1)
    return t


def _deliver_webhook(base: str, head_sha: str, status: str) -> int:
    """Stand in for GitLab: POST a signed pipeline-completion webhook."""
    payload = {"object_attributes": {"sha": head_sha, "status": status}}
    resp = requests.post(
        f"{base}/api/v2/inbound/gitlab/{INGRESS}",
        data=json.dumps(payload).encode(),
        headers={"X-Gitlab-Token": SECRET, "X-Gitlab-Event-UUID": f"sim-{head_sha[:8]}",
                 "Content-Type": "application/json"},
        timeout=10,
    )
    return resp.status_code


def _listen(base: str, orchestrate_id: str, timeout: float) -> dict | None:
    """Poll the events projection until the verdict lands (or timeout)."""
    deadline = time.time() + timeout
    seen: set[int] = set()
    while time.time() < deadline:
        r = requests.get(
            f"{base}/api/v2/verification/{orchestrate_id}/events",
            headers={"Authorization": f"Bearer {BEARER}"}, timeout=10,
        )
        for ev in r.json().get("events", []):
            if ev["id"] in seen:
                continue
            seen.add(ev["id"])
            print(f"   · event: {ev['kind']}")
            if ev["kind"] == "verdict_recorded":
                return ev
        time.sleep(1)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", help="GitLab project id or group/name path (live mode)")
    ap.add_argument("--ref", default="main", help="branch/tag/sha to build (default: main)")
    ap.add_argument("--orchestrate-id", default="scenario-orch")
    ap.add_argument("--task-group-id", default="g1")
    ap.add_argument("--repo", default="scenario-repo")
    ap.add_argument("--simulate", action="store_true",
                    help="deliver the completion webhook locally instead of waiting for GitLab")
    ap.add_argument("--sim-status", default="success", choices=["success", "failed"])
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--timeout", type=float, default=120.0)
    args = ap.parse_args()

    # Isolated DBs so a demo never touches a real jobs.db.
    tmp = tempfile.mkdtemp(prefix="scenario-")
    os.environ.setdefault("VERIFICATION_DB_PATH", os.path.join(tmp, "verify.db"))
    os.environ.setdefault("JOBS_DB_PATH", os.path.join(tmp, "jobs.db"))

    sys.path.insert(0, os.getcwd())
    from src.connectors.gitlab import verification_bridge as VB

    base = f"http://127.0.0.1:{args.port}"
    print(f"[1/3] starting gateway on {base} …")
    _start_gateway(args.port)

    print("[2/3] triggering pipeline + recording SHA→cell binding …")
    if args.simulate and not args.project:
        # No project needed to prove the path: bind a synthetic SHA, skip the fire.
        import hashlib
        head_sha = hashlib.sha1(f"{args.orchestrate_id}{time.time()}".encode()).hexdigest()
        from src.verification import store
        conn = store.connect()
        store.record_binding(conn, head_sha, "gitlab", args.orchestrate_id,
                             args.task_group_id, args.repo)
        conn.close()
        print(f"      bound synthetic SHA {head_sha[:12]} (no project given) → cell "
              f"[{args.repo}, ci-trigger]")
    else:
        if not args.project:
            print("ERROR: live mode needs --project (a GitLab project id or path).")
            return 2
        res = VB.trigger_and_bind(args.project, args.ref,
                                  orchestrate_id=args.orchestrate_id,
                                  task_group_id=args.task_group_id, repo=args.repo)
        head_sha = res["head_sha"]
        print(f"      head_sha={head_sha[:12]} bound={res['bound']} "
              f"trigger_error={res['trigger_error']}")

    print("[3/3] listening for the pipeline to finish (webhook → gateway → verdict) …")
    if args.simulate:
        code = _deliver_webhook(base, head_sha, args.sim_status)
        print(f"      (simulated GitLab webhook delivered, HTTP {code})")
    else:
        print(f"      waiting for a REAL webhook at {base}/api/v2/inbound/gitlab/{INGRESS}")
        print("      → expose this URL publicly and add a Pipeline-events webhook on the "
              "project (secret token = SX_WEBHOOK_SECRET_GITLAB).")

    verdict_ev = _listen(base, args.orchestrate_id, args.timeout)
    if verdict_ev is None:
        print("\nTIMED OUT — no verdict observed. (Live: check the webhook reached the gateway.)")
        return 1

    try:
        detail = json.loads(verdict_ev.get("payload_json") or "{}")
    except (TypeError, ValueError):
        detail = {}
    print("\n✅ PIPELINE FINISHED")
    print(f"   verdict : {detail.get('verdict', '?')}")
    print(f"   cell    : [{args.repo}, ci-trigger]")
    print(f"   a fresh verify-task-group run was enqueued (D10.2).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
