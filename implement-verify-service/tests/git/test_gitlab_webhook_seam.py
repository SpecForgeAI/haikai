"""B5 — live GitLab INBOUND WEBHOOK seam: GitLab itself POSTs our gateway when a
pipeline event fires (no simulated POST, no tunnel).

Double-gated and opt-in, because it needs (a) a GitLab with a runner AND (b) the
gateway reachable FROM GitLab — which on a local Docker setup means GitLab can
hit the host (host.docker.internal) and the host firewall allows it. That second
condition is environment-fragile, so it only runs when GITLAB_WEBHOOK_TEST=1.

Run against the local rig (scripts/local_gitlab.sh up):
    GITLAB_WEBHOOK_TEST=1 GITLAB_RUNNER_TEST_TOKEN=<pat> \
      python -m pytest tests/git/test_gitlab_webhook_seam.py
"""

from __future__ import annotations

import os
import threading
import time
import uuid

import pytest

URL = os.getenv("GITLAB_RUNNER_TEST_URL", "http://localhost:8929")
TOKEN = os.getenv("GITLAB_RUNNER_TEST_TOKEN", "")
# how GitLab (in its container) reaches the gateway running on the host
GATEWAY_HOST = os.getenv("GITLAB_WEBHOOK_GATEWAY_HOST", "host.docker.internal")
PORT = int(os.getenv("GITLAB_WEBHOOK_PORT", "8810"))
INGRESS, SECRET = "b5-ingress-token", "b5-webhook-secret"

pytestmark = pytest.mark.skipif(
    not (TOKEN and os.getenv("GITLAB_WEBHOOK_TEST") == "1"),
    reason="set GITLAB_WEBHOOK_TEST=1 + GITLAB_RUNNER_TEST_TOKEN — needs GitLab able to reach the host gateway",
)


def _gl():
    import gitlab
    return gitlab.Gitlab(url=URL, private_token=TOKEN, keep_base_url=True)


def test_b5_real_gitlab_webhook_drives_verdict(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", SECRET)
    monkeypatch.setenv("STANDARDS_API_KEY", "b5-key")

    import requests
    import uvicorn
    from fastapi import FastAPI

    import src.api.routes.inbound as inbound
    from src.verification import store

    gl = _gl()
    gl.auth()
    # webhooks to local addresses are blocked by default (SSRF guard)
    s = gl.settings.get()
    s.allow_local_requests_from_web_hooks_and_services = True
    s.save()

    # gateway on 0.0.0.0 so the GitLab container can reach it via GATEWAY_HOST
    app = FastAPI()
    app.include_router(inbound.router)
    srv = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(80):
        try:
            requests.get(f"http://127.0.0.1:{PORT}/", timeout=0.5)
            break
        except requests.exceptions.RequestException:
            time.sleep(0.1)

    proj = gl.projects.create({"name": f"b5-{uuid.uuid4().hex[:8]}", "initialize_with_readme": True})
    try:
        proj.files.create({"file_path": ".gitlab-ci.yml", "branch": "main",
                           "content": "test:\n  script:\n    - echo ok\n", "commit_message": "ci"})
        path = proj.path_with_namespace
        head_sha = proj.commits.get("main").id

        hook_url = f"http://{GATEWAY_HOST}:{PORT}/api/v2/inbound/gitlab/{INGRESS}"
        proj.hooks.create({"url": hook_url, "token": SECRET,
                           "pipeline_events": True, "enable_ssl_verification": False})

        orch, tg = f"b5-{uuid.uuid4().hex[:6]}", "g1"
        conn = store.connect()
        store.record_binding(conn, head_sha, "gitlab", orch, tg, path)
        conn.close()

        proj.pipelines.create({"ref": "main"})  # fires the webhooks at our gateway

        verdict = None
        deadline = time.time() + 300
        while time.time() < deadline:
            conn = store.connect()
            cell = store.latest_verdicts(conn, orch, tg).get((path, "ci-trigger"))
            conn.close()
            if cell and cell["verdict"] in ("pass", "fail"):
                verdict = cell["verdict"]
                break
            time.sleep(5)

        assert verdict == "pass", f"real GitLab webhook should have driven a pass verdict, got {verdict}"
    finally:
        try:
            proj.delete()
        except Exception:
            pass
