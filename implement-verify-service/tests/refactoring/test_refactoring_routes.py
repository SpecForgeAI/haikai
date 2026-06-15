"""Smoke tests for /api/refactor REST endpoints.

Uses FastAPI TestClient on the same router. Each test wires a synthetic
git repo + dep-graph + snapshot dir.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.refactor_routes import router
from src.dep.db import DepGraph


def _git(repo: Path, *args: str) -> str:
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "Test")
    env.setdefault("GIT_AUTHOR_EMAIL", "test@example.com")
    env.setdefault("GIT_COMMITTER_NAME", "Test")
    env.setdefault("GIT_COMMITTER_EMAIL", "test@example.com")
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True,
        env=env, check=True,
    ).stdout


@pytest.fixture
def harness(tmp_path: Path):
    repo = tmp_path / "repo"
    snap = tmp_path / "snap"
    repo.mkdir(); snap.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "commit.gpgsign", "false")
    (repo / "lib.py").write_text(
        "class Greeter:\n"
        "    def hello(self):\n"
        "        return 'hi'\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")
    head = _git(repo, "rev-parse", "HEAD").strip()

    # Build minimal graph
    g = DepGraph.create_empty(snap / "_depgraph.sqlite")
    g.execute("INSERT INTO files(id, path, language) VALUES (1, 'lib.py', 'python')")
    g.execute(
        "INSERT INTO symbols(id, name, qualified_name, kind, file_id, line, language) "
        "VALUES (?,?,?,?,?,?,?)",
        (1, "Greeter", "lib.Greeter", "class", 1, 1, "python"),
    )
    g.commit()
    g.close()
    # Mark snapshot SHA so staleness check works
    (snap / "_meta.json").write_text(json.dumps({"commit_sha": head}), encoding="utf-8")

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    yield client, repo, snap, head


def test_detect_endpoint_no_changes(harness):
    client, repo, snap, _ = harness
    r = client.get("/api/refactor/detect", params={
        "snapshot": str(snap), "repo": str(repo), "scope": "unstaged",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "unstaged"
    assert body["files"] == []


def test_rename_preview_endpoint(harness):
    client, repo, snap, _ = harness
    r = client.get("/api/refactor/rename-preview", params={
        "snapshot": str(snap), "repo": str(repo),
        "old_name": "lib.Greeter", "new_name": "Salutator",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["old_qname"] == "lib.Greeter"
    assert body["new_name"] == "Salutator"
    assert body["kind"] == "class"
    assert body["ambiguous"] is False


def test_rename_apply_requires_confirm(harness):
    client, repo, snap, _ = harness
    r = client.post("/api/refactor/rename-apply", json={
        "snapshot": str(snap), "repo": str(repo),
        "old_name": "lib.Greeter", "new_name": "Salutator",
        "confirm": False,
    })
    assert r.status_code == 400


def test_rename_apply_with_confirm(harness):
    client, repo, snap, _ = harness
    r = client.post("/api/refactor/rename-apply", json={
        "snapshot": str(snap), "repo": str(repo),
        "old_name": "lib.Greeter", "new_name": "Salutator",
        "confirm": True,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"] is True
    assert "Salutator" in (repo / "lib.py").read_text(encoding="utf-8")


def test_staleness_endpoint_fresh(harness):
    client, repo, snap, _ = harness
    r = client.get("/api/refactor/staleness", params={
        "snapshot": str(snap), "repo": str(repo),
    })
    assert r.status_code == 200, r.text
    assert r.json()["level"] == "fresh"


def test_staleness_endpoint_404_on_missing_snapshot(harness):
    client, repo, _, _ = harness
    r = client.get("/api/refactor/staleness", params={
        "snapshot": "/nope", "repo": str(repo),
    })
    assert r.status_code == 404
