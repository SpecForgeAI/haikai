"""jobs_db_path() — the single source of truth so every enqueue site and the
worker that polls resolve to the same job-queue file (predict R2)."""

from __future__ import annotations

from pathlib import Path

from src.safe_paths import jobs_db_path


def test_explicit_env_wins(monkeypatch):
    monkeypatch.setenv("JOBS_DB_PATH", "/srv/data/custom-jobs.db")
    assert jobs_db_path() == "/srv/data/custom-jobs.db"


def test_defaults_under_workspace(monkeypatch, tmp_path):
    monkeypatch.delenv("JOBS_DB_PATH", raising=False)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    assert jobs_db_path() == str(tmp_path.resolve() / "jobs.db")


def test_empty_env_falls_through_to_default(monkeypatch, tmp_path):
    # An empty JOBS_DB_PATH must not win over the workspace default — otherwise
    # enqueue/poll would point at "" (cwd-ambiguous).
    monkeypatch.setenv("JOBS_DB_PATH", "")
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    assert jobs_db_path() == str(tmp_path.resolve() / "jobs.db")
