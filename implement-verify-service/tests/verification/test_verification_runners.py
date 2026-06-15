"""Tests for src/verification — inline runner + CI connectors (spec D3/D9.1/D10.4)."""

from __future__ import annotations

import sys

import pytest

from src.verification import inline_runner
from src.verification.connectors import github_actions, gitlab_ci, resolve_token


class TestInlineRunner:
    def test_pass_when_all_commands_succeed(self, tmp_path):
        result = inline_runner.run_inline(
            [[sys.executable, "-c", "print('ok')"]], cwd=str(tmp_path)
        )
        assert result["verdict"] == "pass"
        assert result["results"][0]["exit_code"] == 0
        assert "ok" in result["results"][0]["log_tail"]

    def test_fail_on_nonzero_exit(self, tmp_path):
        result = inline_runner.run_inline(
            [
                [sys.executable, "-c", "print('fine')"],
                [sys.executable, "-c", "import sys; sys.exit(3)"],
            ],
            cwd=str(tmp_path),
        )
        assert result["verdict"] == "fail"
        assert result["results"][1]["exit_code"] == 3

    def test_fail_on_missing_binary_and_missing_cwd(self, tmp_path):
        result = inline_runner.run_inline([["definitely-not-a-real-binary-xyz"]], cwd=str(tmp_path))
        assert result["verdict"] == "fail"
        result = inline_runner.run_inline([["echo", "hi"]], cwd=str(tmp_path / "missing"))
        assert result["verdict"] == "fail"

    def test_no_commands_is_fail_not_vacuous_pass(self, tmp_path):
        assert inline_runner.run_inline([], cwd=str(tmp_path))["verdict"] == "fail"

    def test_utf8_output_does_not_crash(self, tmp_path):
        # P1c: text=True without encoding used the locale codec (cp1252 on
        # Windows) -> UnicodeDecodeError on UTF-8 tool output.
        result = inline_runner.run_command(
            [sys.executable, "-X", "utf8", "-c", "print('\\u2713 passed \\u2014 ok')"],
            cwd=str(tmp_path),
        )
        assert result["exit_code"] == 0
        assert "passed" in result["log_tail"]

    def test_timeout_kills_process_tree(self, tmp_path):
        # P1c: a grandchild holding the output pipes must not block past the
        # timeout (pytest-xdist-style workers).
        import time as _time

        spawner = (
            "import subprocess,sys,time;"
            "subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
            "time.sleep(60)"
        )
        started = _time.monotonic()
        result = inline_runner.run_command(
            [sys.executable, "-c", spawner], cwd=str(tmp_path), timeout_s=2
        )
        elapsed = _time.monotonic() - started
        assert result["timed_out"] is True
        assert elapsed < 20, f"hung {elapsed:.0f}s past the 2s timeout (grandchild held the pipe)"

    def test_string_command_split_windows_safe(self):
        argv = inline_runner._split('"C:\\Program Files\\python.exe" -c "print(1)"')
        assert argv == ["C:\\Program Files\\python.exe", "-c", "print(1)"]

    def test_split_preserves_embedded_quotes(self):
        # C7: '--name="a b"' must stay ONE token with value 'a b'
        assert inline_runner._split('tool --name="a b"') == ["tool", "--name=a b"]
        assert inline_runner._split('pytest -k "not slow" -q') == ["pytest", "-k", "not slow", "-q"]
        assert inline_runner._split("ruff check .") == ["ruff", "check", "."]
        assert inline_runner._split('echo "" x') == ["echo", "", "x"]


class TestTokenResolution:
    def test_specific_token_wins_over_fallback(self, monkeypatch):
        monkeypatch.setenv("SHOP_API_GITHUB_TOKEN", "specific")
        monkeypatch.setenv("GITHUB_TOKEN", "generic")
        assert resolve_token("shop-api", "GITHUB", "GITHUB_TOKEN") == "specific"

    def test_fallback_used_when_no_specific(self, monkeypatch):
        monkeypatch.delenv("SHOP_API_GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_TOKEN", "generic")
        assert resolve_token("shop-api", "GITHUB", "GITHUB_TOKEN") == "generic"

    def test_invalid_repo_key_raises(self):
        # P3b: a garbage/empty repo_key built a garbage env-var name silently.
        import pytest as _pytest

        for bad in ("", "  ", "shop api", "shop/api", "a" * 65):
            with _pytest.raises(ValueError):
                resolve_token(bad, "GITHUB", "GITHUB_TOKEN")

    def test_broad_fallback_is_logged(self, monkeypatch, caplog):
        # P3b: falling back to the broad-scope token must be LOUD — a
        # misspelled per-repo key silently widened privilege.
        import logging

        monkeypatch.delenv("SHOP_API_GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_TOKEN", "generic")
        with caplog.at_level(logging.WARNING):
            resolve_token("shop-api", "GITHUB", "GITHUB_TOKEN")
        assert any("SHOP_API_GITHUB_TOKEN" in r.message and "GITHUB_TOKEN" in r.message for r in caplog.records)


class TestConnectorLoader:
    """#9 option (a): the YAML is the single source of truth; modules obey it."""

    def test_yaml_drives_github_mapping(self):
        from src.verification.connectors.loader import load_connector

        d = load_connector("github-actions")
        assert d.map_status("completed", "success") == "pass"
        assert d.map_status("completed", "action_required") == "fail"
        assert d.map_status("completed", "skipped") == "skipped"
        assert d.map_status("queued", None) == "pending"
        assert d.map_status("completed", "never_heard_of_it") == "pending"  # unknown -> pending
        assert d.fold({"pass", "fail"}) == "fail"
        assert d.fold({"skipped"}) == "skipped"

    def test_yaml_drives_gitlab_mapping(self):
        from src.verification.connectors.loader import load_connector

        d = load_connector("gitlab-ci")
        assert d.map_status("success") == "pass"
        assert d.map_status("skipped") == "skipped"
        assert d.map_status("manual") == "pending"

    def test_no_hardcoded_status_tables_remain(self):
        # Drift guard (count == 0): a status set hardcoded in a module is the
        # second source of truth that INT-6 caught drifting.
        import re
        from pathlib import Path

        connectors_dir = Path(__file__).resolve().parent.parent.parent / "src" / "verification" / "connectors"
        offenders = []
        for path in (connectors_dir / "github_actions.py", connectors_dir / "gitlab_ci.py"):
            for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"_(FAIL|SKIP|PENDING)\w*\s*=\s*\{", line):
                    offenders.append(f"{path.name}:{i}: {line.strip()}")
        assert offenders == [], f"hardcoded status tables (use the connector YAML): {offenders}"


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.ok = status_code < 400
        self.text = str(payload)

    def json(self):
        return self._payload


class TestGitHubActions:
    def test_status_map(self):
        assert github_actions.map_status("queued", None) == "pending"
        assert github_actions.map_status("in_progress", None) == "pending"
        assert github_actions.map_status("completed", "success") == "pass"
        assert github_actions.map_status("completed", "failure") == "fail"
        assert github_actions.map_status("completed", "timed_out") == "fail"

    def test_completed_skipped_is_skipped_not_pending_forever(self):
        # C4: completed+skipped/neutral/stale wedged the cell at pending with
        # no TTL sweeper built. Spec vocabulary has "skipped" (D5: gate passes
        # on pass|skipped) — use it.
        assert github_actions.map_status("completed", "skipped") == "skipped"
        assert github_actions.map_status("completed", "neutral") == "skipped"
        assert github_actions.map_status("completed", "stale") == "skipped"

    def test_fold_all_skipped_is_skipped(self, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        runs = {"workflow_runs": [{"id": 1, "status": "completed", "conclusion": "skipped"}]}
        monkeypatch.setattr(github_actions.requests, "get", lambda *a, **k: _FakeResponse(200, runs))
        assert github_actions.poll("o", "r", "abc", "repo")["verdict"] == "skipped"

    def test_poll_paginates_past_first_page(self, monkeypatch):
        # C4: default 30/page — a failing run beyond page 1 folded to pass.
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        page1 = {"workflow_runs": [
            {"id": i, "status": "completed", "conclusion": "success"} for i in range(100)
        ]}
        page2 = {"workflow_runs": [{"id": 999, "status": "completed", "conclusion": "failure"}]}

        def fake_get(url, headers=None, params=None, timeout=None):
            return _FakeResponse(200, page1 if params.get("page", 1) == 1 else page2)

        monkeypatch.setattr(github_actions.requests, "get", fake_get)
        result = github_actions.poll("o", "r", "abc", "repo")
        assert result["verdict"] == "fail"
        assert len(result["runs"]) == 101

    def test_poll_folds_like_the_and_gate(self, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        runs = {
            "workflow_runs": [
                {"id": 1, "name": "lint", "status": "completed", "conclusion": "success"},
                {"id": 2, "name": "test", "status": "in_progress", "conclusion": None},
            ]
        }
        monkeypatch.setattr(
            github_actions.requests, "get", lambda *a, **k: _FakeResponse(200, runs)
        )
        result = github_actions.poll("o", "r", "abc123", "repo")
        assert result["verdict"] == "pending"  # any pending → pending

        runs["workflow_runs"][1] = {"id": 2, "name": "test", "status": "completed", "conclusion": "failure"}
        result = github_actions.poll("o", "r", "abc123", "repo")
        assert result["verdict"] == "fail"  # any fail → fail

    def test_poll_no_runs_is_pending(self, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        monkeypatch.setattr(
            github_actions.requests, "get", lambda *a, **k: _FakeResponse(200, {"workflow_runs": []})
        )
        assert github_actions.poll("o", "r", "abc", "repo")["verdict"] == "pending"

    def test_trigger_records_head_sha_binding(self, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        monkeypatch.setattr(github_actions.requests, "post", lambda *a, **k: _FakeResponse(204))
        monkeypatch.setattr(
            github_actions.requests, "get", lambda *a, **k: _FakeResponse(200, {"sha": "deadbeef"})
        )
        result = github_actions.trigger("o", "r", "ci.yml", "main", "repo")
        assert result["head_sha"] == "deadbeef"  # D10.4 SHA→cell binding payload

    def test_missing_token_raises(self, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.delenv("REPO_GITHUB_TOKEN", raising=False)
        with pytest.raises(github_actions.GitHubActionsError):
            github_actions.poll("o", "r", "abc", "repo")


class TestGitLabCI:
    def test_status_map(self):
        assert gitlab_ci.map_status("running") == "pending"
        assert gitlab_ci.map_status("manual") == "pending"
        assert gitlab_ci.map_status("success") == "pass"
        assert gitlab_ci.map_status("failed") == "fail"
        assert gitlab_ci.map_status("canceled") == "fail"
        # C4: align with GitHub — a skipped pipeline is "skipped", not fail.
        assert gitlab_ci.map_status("skipped") == "skipped"

    def test_poll_folds(self, monkeypatch):
        monkeypatch.setenv("GITLAB_TOKEN", "t")
        pipelines = [{"id": 1, "status": "success"}, {"id": 2, "status": "failed"}]
        monkeypatch.setattr(gitlab_ci.requests, "get", lambda *a, **k: _FakeResponse(200, pipelines))
        assert gitlab_ci.poll("https://gitlab.example.com", "grp/proj", "abc", "repo")["verdict"] == "fail"

    def test_trigger_returns_binding(self, monkeypatch):
        monkeypatch.setenv("GITLAB_TOKEN", "t")
        monkeypatch.setattr(
            gitlab_ci.requests, "post", lambda *a, **k: _FakeResponse(201, {"id": 7, "sha": "cafe"})
        )
        result = gitlab_ci.trigger("https://gitlab.example.com", "grp/proj", "main", "repo")
        assert result["pipeline_id"] == 7 and result["head_sha"] == "cafe"
