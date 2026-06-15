"""POST /api/v2/bugs/ intake + the bug-investigation worker job (Gary's contract)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from src.verification import store

API_KEY = "test-api-key"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", API_KEY)
    from src.api.routes.bugs import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _body(**over):
    b = {
        "bugDescription": "reconciliation: 50 rows where actual != desired",
        "bugType": "reconciliation",
        "callbackUrl": "https://gary.example/callback",
        "company": "acme",
        "project": "ledger",
    }
    b.update(over)
    return b


class TestIntake:
    def test_requires_auth(self, client):
        assert client.post("/api/v2/bugs/", json=_body()).status_code in (401, 403)

    def test_accepts_and_enqueues(self, client, tmp_path):
        r = client.post("/api/v2/bugs/", json=_body(attachments=[{"url": "https://x/diff.csv"}]),
                        headers={"Authorization": f"Bearer {API_KEY}"})
        assert r.status_code == 202
        body = r.json()
        assert body["bug_id"].startswith("bug-") and body["job_id"].startswith("investigate-")
        # persisted
        conn = store.connect()
        bug = store.get_bug(conn, body["bug_id"]); conn.close()
        assert bug["bug_type"] == "reconciliation" and bug["status"] == "accepted"
        assert bug["attachments"][0]["url"] == "https://x/diff.csv"
        # enqueued
        q = JobStorage(str(tmp_path / "jobs.db"))
        assert q.get_job(body["job_id"]).type == JobType.BUG_INVESTIGATION.value

    def test_snake_case_body_also_accepted(self, client):
        # F6: snake_case is canonical; camelCase still accepted via aliases.
        snake = {"bug_description": "x", "bug_type": "crash", "callback_url": "https://cb/x"}
        assert client.post("/api/v2/bugs/", json=snake,
                           headers={"Authorization": f"Bearer {API_KEY}"}).status_code == 202

    def test_missing_field_422(self, client):
        bad = _body(); del bad["callbackUrl"]
        assert client.post("/api/v2/bugs/", json=bad, headers={"Authorization": f"Bearer {API_KEY}"}).status_code == 422

    def test_reconciliation_requires_company_project(self, client):
        h = {"Authorization": f"Bearer {API_KEY}"}
        bad = _body(); del bad["company"]
        assert client.post("/api/v2/bugs/", json=bad, headers=h).status_code == 422
        # a non-reconciliation kind does NOT require them
        ok = _body(bugType="crash"); del ok["company"]; del ok["project"]
        assert client.post("/api/v2/bugs/", json=ok, headers=h).status_code == 202

    def test_reconciliation_match_is_case_and_space_insensitive(self, client):
        # predict R5: an exact match let "Reconciliation" / trailing-space
        # variants bypass the company/project requirement.
        h = {"Authorization": f"Bearer {API_KEY}"}
        for variant in ("Reconciliation", "RECONCILIATION", "reconciliation "):
            bad = _body(bugType=variant); del bad["company"]; del bad["project"]
            assert client.post("/api/v2/bugs/", json=bad, headers=h).status_code == 422, variant


def _make_executor(repo_path, change: bool, verdict: str = "FIXED"):
    class _Executor:
        def __init__(self, project_dir, anthropic_api_key):
            self.project_dir = project_dir
        def execute(self, command, system_prompt=None, timeout=None):
            # A real haikai run edits files DURING the session and ends with a VERDICT line.
            if change:
                (repo_path / "f.py").write_text("x = 2  # fixed by haikai\n", encoding="utf-8")
            return {"success": True, "stdout": f"...haikai:fix ran...\nVERDICT={verdict}\n", "return_code": 0}
    return _Executor


class TestInvestigationJob:
    def _setup_repo(self, tmp_path):
        import subprocess
        repo = tmp_path / "acme" / "proj"; repo.mkdir(parents=True)  # workspace/company/project
        (repo / "f.py").write_text("x = 1\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=repo)
        subprocess.run(["git", "add", "-A"], cwd=repo)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], cwd=repo)
        return repo

    def _run(self, tmp_path, monkeypatch, change: bool, callbacks: list,
             verdict: str = "FIXED", company="acme", project="proj", target=None):
        from src.job_queue import tasks
        repo = self._setup_repo(tmp_path)
        monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
        monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor",
                            _make_executor(repo, change, verdict))
        monkeypatch.setattr(tasks, "_post_callback", lambda url, payload: callbacks.append(payload) or True)
        if target is not None:  # mock the redeploy so a FIXED bug reaches `deployed`
            monkeypatch.setattr("src.haibox.integration.provision_for_job",
                                lambda payload, client=None: {"base_url": "http://127.0.0.1:9", "box_id": "box-rd"})

        conn = store.connect()
        store.record_bug(conn, "bug-1", "reconciliation", "desc", "https://cb.example/x",
                         company=company, project=project)
        conn.close()
        monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
        storage = JobStorage(str(tmp_path / "jobs.db"))
        storage.save_job(Job(job_id="investigate-bug-1", type=JobType.BUG_INVESTIGATION,
                             status=JobStatus.QUEUED, company="acme", project="proj",
                             created_at=datetime.now(timezone.utc),
                             request_payload={"bug_id": "bug-1", "target": target}))
        tasks.run_bug_investigation("investigate-bug-1", storage)
        return storage.get_job("investigate-bug-1")

    def test_fixed_and_redeployed_is_deployed(self, tmp_path, monkeypatch):
        # D2: FIXED (verdict AND change) + redeploy -> outcome `deployed` + url/box.
        cb = []
        job = self._run(tmp_path, monkeypatch, change=True, verdict="FIXED",
                        target={"command": ["python", "app.py"], "health_path": "/"}, callbacks=cb)
        assert job.status == JobStatus.COMPLETED.value
        assert job.result["outcome"] == "deployed"
        assert cb[0]["outcome"] == "deployed" and cb[0]["changed_files"] and cb[0]["haikai_verdict"] == "FIXED"
        assert cb[0]["target_base_url"] == "http://127.0.0.1:9" and cb[0]["box_id"] == "box-rd"

    def test_change_without_fix_verdict_is_not_fixed(self, tmp_path, monkeypatch):
        # a file moved but VERDICT=NOFIX -> not_fixed (the corroboration guard)
        cb = []
        job = self._run(tmp_path, monkeypatch, change=True, verdict="NOFIX", callbacks=cb)
        assert job.result["outcome"] == "not_fixed" and cb[0]["haikai_verdict"] == "NOFIX"

    def test_not_a_bug_is_rejected(self, tmp_path, monkeypatch):
        # D2: haikai judged the target correct -> outcome `rejected` (human review)
        cb = []
        job = self._run(tmp_path, monkeypatch, change=False, verdict="NOTABUG", callbacks=cb)
        assert job.result["outcome"] == "rejected" and cb[0]["haikai_verdict"] == "NOTABUG"
        assert "target_base_url" not in cb[0]

    def test_fixed_but_no_target_is_fix_unserved(self, tmp_path, monkeypatch):
        # fix kept but no serve spec -> can't redeploy -> fix_unserved (HUMAN; fix exists)
        cb = []
        job = self._run(tmp_path, monkeypatch, change=True, verdict="FIXED", callbacks=cb)
        assert job.result["outcome"] == "fix_unserved" and "target_base_url" not in cb[0]
        assert "redeploy_error" in cb[0]

    def test_unsafe_company_project_fails_without_session(self, tmp_path, monkeypatch):
        from src.job_queue import tasks
        monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
        monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
        called = {"n": 0}
        class _Boom:
            def __init__(self, *a): called["n"] += 1
            def execute(self, *a, **k): return {"success": True, "stdout": "VERDICT=FIXED"}
        monkeypatch.setattr("src.claude_cli_executor.ClaudeCLIExecutor", _Boom)
        cb = []
        monkeypatch.setattr(tasks, "_post_callback", lambda u, p: cb.append(p) or True)
        conn = store.connect()
        store.record_bug(conn, "bug-1", "reconciliation", "d", "https://cb/x",
                         company="..", project="etc")
        conn.close()
        storage = JobStorage(str(tmp_path / "jobs.db"))
        storage.save_job(Job(job_id="investigate-bug-1", type=JobType.BUG_INVESTIGATION,
                             status=JobStatus.QUEUED, company="x", project="y",
                             created_at=datetime.now(timezone.utc), request_payload={"bug_id": "bug-1"}))
        tasks.run_bug_investigation("investigate-bug-1", storage)
        assert called["n"] == 0  # never launched a session for an unsafe path
        assert cb[0]["outcome"] == "error"

    def test_not_fixed_when_no_change(self, tmp_path, monkeypatch):
        cb = []
        job = self._run(tmp_path, monkeypatch, change=False, verdict="NOFIX", callbacks=cb)
        assert job.result["outcome"] == "not_fixed"
        assert cb and cb[0]["outcome"] == "not_fixed" and cb[0]["changed_files"] == []

    def test_callback_payload_shape(self, tmp_path, monkeypatch):
        cb = []
        self._run(tmp_path, monkeypatch, change=True,
                  target={"command": ["python", "app.py"]}, callbacks=cb)
        p = cb[0]
        assert set(["bug_id", "bug_type", "outcome", "changed_files"]).issubset(p.keys())

    def test_changed_files_parsed_correctly(self, tmp_path):
        # real-run finding: porcelain.strip() ate the first line's leading space
        # (' M src/x.py' -> 'rc/x.py') and pycache leaked in.
        import subprocess
        from src.job_queue.tasks import _git_changed_files
        from pathlib import Path as _P
        repo = tmp_path / "r"; repo.mkdir()
        (repo / "src").mkdir(); (repo / "src" / "x.py").write_text("a=1\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=repo)
        subprocess.run(["git", "add", "-A"], cwd=repo)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i"], cwd=repo)
        (repo / "src" / "x.py").write_text("a=2\n", encoding="utf-8")
        (repo / "src" / "__pycache__").mkdir()  # noise that must be filtered
        (repo / "src" / "__pycache__" / "x.pyc").write_text("", encoding="utf-8")
        changed, files = _git_changed_files(_P(repo))
        assert changed is True
        assert files == ["src/x.py"]  # exact path, no leading-char loss, no pycache
