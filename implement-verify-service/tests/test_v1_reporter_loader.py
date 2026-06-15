"""Regression tests for V1's `_try_load_from_file` reporter loader.

Each fixture in `tests/fixtures/v1_reporter/` is a `claude_endpoints.json`
shape that the V1 agent might write. The loader must report the right count
for each — most importantly, it must NOT report 0 just because the file has
a UTF-8 BOM (the bug we found running V1 on Kibana).

`manifest.json` lists each fixture and its expected endpoint count.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.ast.endpoint_discoverer import _try_load_from_file

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "v1_reporter"


def _manifest() -> list[dict]:
    return json.loads((FIXTURES_DIR / "manifest.json").read_text(encoding="utf-8"))["fixtures"]


def _fake_response_for(path: Path) -> str:
    """Build the response text the loader expects: contains a {"file": "..."} pointer."""
    fwd = str(path).replace("\\", "/")
    return f'FINAL_ANSWER {{"file": "{fwd}", "count": 0}}'


@pytest.mark.parametrize("entry", _manifest(), ids=lambda e: e["name"])
def test_loader_count(entry: dict, tmp_path: Path):
    name = entry["name"]
    expected = entry["expected"]

    src = FIXTURES_DIR / f"{name}.json"
    if name == "missing_file":
        # Simulate Claude writing to a path that no longer exists.
        loaded = _try_load_from_file(_fake_response_for(tmp_path / "ghost.json"))
    else:
        assert src.exists(), f"fixture {src} missing"
        loaded = _try_load_from_file(_fake_response_for(src))

    if expected == 0:
        # Either None (loader rejected) or [] (parsed as empty) is acceptable.
        assert loaded is None or len(loaded) == 0, \
            f"{name}: expected 0, got {len(loaded) if loaded else 'None'}"
    else:
        assert loaded is not None, f"{name}: expected {expected}, got None (loader rejected)"
        assert len(loaded) == expected, f"{name}: expected {expected}, got {len(loaded)}"
