"""Verification service end-to-end — REAL repos, real subprocesses, real HMAC.

The full story the spec promises (D1–D11), with only the network hop
simulated:

  1. an INLINE verifier really runs (compileall over the real
     test-repos/fastapi-sqlalchemy checkout) and its verdict is recorded
     through the guarded recorder CLI — the exact contract the
     verification-loop agent uses via Bash
  2. a CI verdict arrives as a real HMAC-signed GitHub webhook through the
     inbound-gateway: binding → pending → gate refuses → success → pass
  3. the D5 AND-gate advances only when every cell is green; double advance
     refused; the repair loop caps at 3 (D4)
  4. the SSE projection shows the whole story in order
"""

from __future__ import annotations

import hashlib
import hmac
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes.inbound import router
from src.verification import recorder, store
from src.verification.inline_runner import run_inline

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REAL_REPO = Path("D:/Work/Gary/test-repos/fastapi-sqlalchemy")

SECRET = "e2e-secret"
INGRESS = "e2e-ingress"

needs_real_repo = pytest.mark.skipif(
    not REAL_REPO.exists(), reason="real test repo checkout not present"
)


@pytest.fixture
def env(tmp_path, monkeypatch):
    db = str(tmp_path / "verify.db")
    monkeypatch.setenv("VERIFICATION_DB_PATH", db)
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITHUB", INGRESS)
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITHUB", SECRET)
    monkeypatch.setenv("STANDARDS_API_KEY", "e2e-key")  # events read is bearer-auth now
    app = FastAPI()
    app.include_router(router)
    return {"db": db, "client": TestClient(app)}


def _recorder_cli(db: str, tool: str, payload: dict) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, "-m", "src.verification.recorder", tool, "--db", db,
         "--json", json.dumps(payload)],
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=120,
    )
    return proc.returncode, json.loads(proc.stdout)


def _signed_webhook(client, payload: dict, delivery: str):
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    return client.post(
        f"/api/v2/inbound/github/{INGRESS}",
        content=body,
        headers={"X-Hub-Signature-256": sig, "X-GitHub-Delivery": delivery,
                 "Content-Type": "application/json"},
    )


@needs_real_repo
class TestFullLoopAgainstRealRepo:
    ORCH, GROUP, REPO = "orch-e2e", "g1", "fastapi-sqlalchemy"

    def test_the_whole_story(self, env):
        db, client = env["db"], env["client"]

        # ── 1. INLINE verifier: REAL run over the REAL checkout ────────────
        result = run_inline(
            [[sys.executable, "-m", "compileall", "-q", "fastapi_sqlalchemy"]],
            cwd=str(REAL_REPO),
        )
        assert result["verdict"] == "pass", result
        code, out = _recorder_cli(db, "record_verdict", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "repo": self.REPO, "verifier": "inline",
            "verdict": result["verdict"],
            "detail": {"commands": [r["command"] for r in result["results"]]},
        })
        assert code == 0 and out["ok"]

        # ── 2. CI verdict via real signed webhook ──────────────────────────
        conn = store.connect(db)
        assert store.record_binding(conn, "e2esha1", "github", self.ORCH, self.GROUP, self.REPO)
        conn.close()

        # in_progress arrives first → pending
        resp = _signed_webhook(client, {"workflow_run": {
            "head_sha": "e2esha1", "status": "in_progress", "conclusion": None}}, "e2e-d1")
        assert resp.status_code == 202 and resp.json()["verdict"] == "pending"

        # gate refuses while CI is pending (D5)
        code, out = _recorder_cli(db, "advance", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "expected_cells": [[self.REPO, "inline"], [self.REPO, "ci-trigger"]],
        })
        assert code == 1 and "pending" in out["reason"]

        # CI completes green → pass (attempt 2, last-writer)
        resp = _signed_webhook(client, {"workflow_run": {
            "head_sha": "e2esha1", "status": "completed", "conclusion": "success"}}, "e2e-d2")
        assert resp.status_code == 202 and resp.json()["verdict"] == "pass"

        # ── 3. gate folds green → advance; double advance refused ─────────
        code, out = _recorder_cli(db, "advance", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "expected_cells": [[self.REPO, "inline"], [self.REPO, "ci-trigger"]],
        })
        assert code == 0 and out["ok"], out
        code, out = _recorder_cli(db, "advance", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
        })
        assert code == 1 and "double advance" in out["reason"]

        # ── 4. SSE projection tells the story in order ─────────────────────
        events = client.get(f"/api/v2/verification/{self.ORCH}/events",
                            headers={"Authorization": "Bearer e2e-key"}).json()["events"]
        kinds = [e["kind"] for e in events]
        assert kinds.index("verdict_recorded") < kinds.index("advanced")
        assert "reinvoke_requested" in kinds


@needs_real_repo
class TestRealFailureAndRepairLoop:
    ORCH, GROUP, REPO = "orch-e2e-fail", "g2", "broken-repo"

    def test_real_failing_verifier_drives_the_repair_cap(self, env, tmp_path):
        db = env["db"]

        # a REAL failing run: a repo checkout with a genuine syntax error
        bad_repo = tmp_path / "broken-repo"
        bad_repo.mkdir()
        (bad_repo / "broken.py").write_text("def broken(:\n    pass\n", encoding="utf-8")
        result = run_inline(
            [[sys.executable, "-m", "compileall", "-q", "."]], cwd=str(bad_repo)
        )
        assert result["verdict"] == "fail"
        assert "broken.py" in result["results"][0]["log_tail"]  # the failure_log for repair-engine

        code, out = _recorder_cli(db, "record_verdict", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "repo": self.REPO, "verifier": "inline", "verdict": "fail",
        })
        assert code == 0

        # red gate → advance refused
        code, out = _recorder_cli(db, "advance", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP})
        assert code == 1 and "red-gate" in out["reason"]

        # repair attempts 1..3 open; 4 refused (D4 cap) → escalation point
        for attempt in (1, 2, 3):
            code, out = _recorder_cli(db, "open_repair", {
                "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
                "repo": self.REPO, "verifier": "inline", "attempt": attempt})
            assert code == 0, out
        code, out = _recorder_cli(db, "open_repair", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "repo": self.REPO, "verifier": "inline", "attempt": 4})
        assert code == 1 and "cap" in out["reason"]

        # a successful repair flips the cell; gate opens (last-writer D10.6)
        code, _ = _recorder_cli(db, "record_verdict", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP,
            "repo": self.REPO, "verifier": "inline", "verdict": "pass", "attempt": 2})
        assert code == 0
        code, out = _recorder_cli(db, "advance", {
            "orchestrate_id": self.ORCH, "task_group_id": self.GROUP})
        assert code == 0 and out["ok"]
