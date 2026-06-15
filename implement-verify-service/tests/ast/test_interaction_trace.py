"""Regression test: interaction_discoverer must write a trace file.

Before fix: `interaction_discoverer` ran its own loop and never called any
trace writer. The CLI/API both advertised `discovery=interaction` as a valid
trace target, so `show-trace --discovery interaction` always 404'd.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest


class _FakeLLM:
    provider = "openai"
    model = "test-trace-model"
    log_dir = None

    def generate(self, messages, **kw):
        return "FINAL_ANSWER []"


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_index.txt").write_text("# fake", encoding="utf-8")
    return snap


def test_interaction_discoverer_writes_trace(snapshot, tmp_path):
    from src.ast.interaction_discoverer import discover_interactions

    expected = Path(tempfile.gettempdir()) / "interaction_trace_test-trace-model.json"
    if expected.exists():
        expected.unlink()

    discover_interactions(_FakeLLM(), project_root=str(snapshot), snapshot_path=str(snapshot))

    assert expected.exists(), f"interaction trace not written at {expected}"
    content = json.loads(expected.read_text(encoding="utf-8"))
    assert isinstance(content, list)
    assert len(content) >= 1
    assert content[0]["role"] == "user"
    expected.unlink()
