"""Executor-agnostic worktree prep — dispatch per CHAT_EXECUTOR.

Claude seeds ~/.claude.json trust; Kiro seeds NOTHING (trusts via
--trust-all-tools, sessions keyed by cwd). The allocator must not hardcode
either CLI.
"""
import json

import pytest

from src.chat import worktree_prep as wp


def test_dispatch_routes_by_backend(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(wp, "_claude_prepare",
                        lambda pd, lp: calls.append(("claude", str(pd), lp)))
    monkeypatch.setattr(wp, "_kiro_prepare",
                        lambda pd, lp: calls.append(("kiro", str(pd), lp)))
    wp.prepare_worktree(tmp_path / "p", live_product=tmp_path / "live",
                        backend="claude")
    wp.prepare_worktree(tmp_path / "p", backend="kiro")
    assert [c[0] for c in calls] == ["claude", "kiro"]


def test_active_backend_reads_env(monkeypatch):
    monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
    assert wp._active_backend() == "kiro"
    monkeypatch.delenv("CHAT_EXECUTOR", raising=False)
    assert wp._active_backend() == "claude"  # safe default (no HTTPException)


def _home(monkeypatch, tmp_path):
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))


def test_claude_seeds_trust_forward_slash(monkeypatch, tmp_path):
    _home(monkeypatch, tmp_path)
    pdir = tmp_path / "wt" / "abc" / "co" / "proj"
    pdir.mkdir(parents=True)
    wp.prepare_worktree(pdir, backend="claude")
    data = json.loads((tmp_path / ".claude.json").read_text())
    keys = list(data["projects"])
    # both slash forms seeded, all trusted; the CLI keys by forward slash
    assert any("/" in k and "\\" not in k for k in keys)
    assert all(v.get("hasTrustDialogAccepted") for v in data["projects"].values())


def test_kiro_writes_no_trust_file(monkeypatch, tmp_path):
    _home(monkeypatch, tmp_path)
    pdir = tmp_path / "wt" / "abc" / "co" / "proj"
    pdir.mkdir(parents=True)
    wp.prepare_worktree(pdir, backend="kiro")
    assert not (tmp_path / ".claude.json").exists()  # kiro seeds nothing


def test_unknown_backend_is_noop(monkeypatch, tmp_path):
    _home(monkeypatch, tmp_path)
    wp.prepare_worktree(tmp_path / "p", backend="borg")  # no raise
    assert not (tmp_path / ".claude.json").exists()
