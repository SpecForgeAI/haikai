"""Live GitLab CI verdict-gate seam — requires a GitLab instance WITH A RUNNER
(so pipelines actually execute). Proves the two connector verbs that gitlab.com's
identity gate blocked (trigger/retry) and the GREEN D5 verdict-gate end-to-end:

    trigger a real pipeline -> it PASSES -> poll-fallback folds 'pass' ->
    record the cell -> recorder.advance() CLEARS the gate.

Gated on GITLAB_RUNNER_TEST_TOKEN (+ GITLAB_RUNNER_TEST_URL); skips otherwise.
Throwaway project per test, deleted after.
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

URL = os.getenv("GITLAB_RUNNER_TEST_URL", "http://localhost:8929")
TOKEN = os.getenv("GITLAB_RUNNER_TEST_TOKEN", "")

pytestmark = pytest.mark.skipif(
    not TOKEN,
    reason="set GITLAB_RUNNER_TEST_TOKEN (+ _URL) — needs a GitLab with a runner so CI runs",
)


def _gl():
    import gitlab
    return gitlab.Gitlab(url=URL, private_token=TOKEN, keep_base_url=True)


@pytest.fixture
def gl():
    c = _gl()
    c.auth()
    return c


@pytest.fixture
def ci_project(gl):
    """A throwaway project with a trivially-passing .gitlab-ci.yml."""
    proj = gl.projects.create({"name": f"haikai-cigate-{uuid.uuid4().hex[:8]}",
                               "initialize_with_readme": True})
    proj.files.create({"file_path": ".gitlab-ci.yml", "branch": "main",
                       "content": "test-job:\n  script:\n    - echo green\n",
                       "commit_message": "ci"})
    try:
        yield proj
    finally:
        try:
            proj.delete()
        except Exception:
            pass


def _wait(proj, pid, timeout=240):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = proj.pipelines.get(pid).status
        if last in ("success", "failed", "canceled", "skipped"):
            return last
        time.sleep(5)
    return f"timeout(last={last})"


def _set_env(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", URL)
    monkeypatch.setenv("GITLAB_TOKEN", TOKEN)


def test_c1_trigger_and_retry_pipeline_live(ci_project, monkeypatch):
    from src.connectors.gitlab import pipelines
    _set_env(monkeypatch)
    path = ci_project.path_with_namespace

    # trigger_pipeline — the verb gitlab.com blocked. Now it runs to success.
    res = pipelines.trigger_pipeline(path, "main")
    assert res["id"] and res["status"]
    assert _wait(ci_project, res["id"]) == "success"

    # retry_pipeline reaches GitLab and is accepted (returns the pipeline).
    retried = pipelines.retry_pipeline(path, res["id"])
    assert retried["id"] == res["id"]


def test_c2_green_verdict_gate_end_to_end(ci_project, monkeypatch, tmp_path):
    from src.connectors.gitlab import pipelines
    from src.verification import recorder, store
    from src.verification.connectors import gitlab_ci
    _set_env(monkeypatch)
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    path = ci_project.path_with_namespace

    # 1. trigger a REAL pipeline (the SHA may carry >1 pipeline: the auto one
    #    from the ci commit + this trigger).
    res = pipelines.trigger_pipeline(path, "main")
    head_sha = res["sha"]

    # 2. poll-fallback until the SHA SETTLES (all pipelines terminal) — this is
    #    how the fallback is meant to be used. Fold is fail>pending>pass>skipped,
    #    so it stays 'pending' until every pipeline for the SHA finishes.
    folded = None
    deadline = time.time() + 300
    while time.time() < deadline:
        folded = gitlab_ci.poll(URL, path, head_sha, "default")
        if folded["verdict"] in ("pass", "fail", "skipped"):
            break
        time.sleep(5)
    assert folded and folded["verdict"] == "pass", folded

    # 3. record the cell (bind + pending, then the real CI verdict).
    orch, tg = "orch-green", "g1"
    conn = store.connect()
    store.record_binding(conn, head_sha, "gitlab", orch, tg, path)
    recorder.record_verdict(conn, orch, tg, path, "ci-trigger", "pending")
    recorder.record_verdict(conn, orch, tg, path, "ci-trigger", folded["verdict"])

    # 4. the D5 gate CLEARS on green.
    ok, reason = recorder.advance(conn, orch, tg)
    conn.close()
    assert ok, f"green gate should advance: {reason}"


def test_c2_red_gate_refuses(tmp_path, monkeypatch):
    """Negative control: a failed cell must block the gate (no live CI needed)."""
    from src.verification import recorder, store
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    conn = store.connect()
    recorder.record_verdict(conn, "orch-red", "g1", "svc", "ci-trigger", "fail")
    ok, reason = recorder.advance(conn, "orch-red", "g1")
    conn.close()
    assert not ok and "red-gate" in reason
