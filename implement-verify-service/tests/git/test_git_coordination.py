"""Tests for src.git.coordination — coordination.yaml read/write.

Covers Phase 1 of haikai/specs/2026-05-25-polyrepo-analysis/tasks.md
(T1.3, T1.4, T1.5).
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import pytest
import yaml

from src.git.coordination import (
    COORDINATION_FILENAME,
    CoordinationError,
    coordination_path,
    read_coordination,
    write_coordination,
)


@pytest.fixture
def product_root():
    d = Path(tempfile.mkdtemp(prefix="coord-test-"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


# ── read_coordination ────────────────────────────────────────────────────────


def test_read_missing_file_raises(product_root):
    with pytest.raises(CoordinationError, match="not found"):
        read_coordination(product_root)


def test_read_empty_file_raises(product_root):
    coordination_path(product_root).write_text("", encoding="utf-8")
    with pytest.raises(CoordinationError, match="empty"):
        read_coordination(product_root)


def test_read_malformed_yaml_raises(product_root):
    coordination_path(product_root).write_text(
        "backend: [unterminated\n", encoding="utf-8"
    )
    with pytest.raises(CoordinationError, match="parse"):
        read_coordination(product_root)


def test_read_non_map_top_level_raises(product_root):
    # A list, not a map
    coordination_path(product_root).write_text(
        "- backend\n- frontend\n", encoding="utf-8"
    )
    with pytest.raises(CoordinationError, match="flat YAML map"):
        read_coordination(product_root)


def test_read_non_string_value_raises(product_root):
    coordination_path(product_root).write_text(
        "backend: 12345\n", encoding="utf-8"
    )
    with pytest.raises(CoordinationError, match="non-string"):
        read_coordination(product_root)


def test_read_single_entry(product_root):
    coordination_path(product_root).write_text(
        "app: https://github.com/acme/app.git\n", encoding="utf-8"
    )
    assert read_coordination(product_root) == {
        "app": "https://github.com/acme/app.git",
    }


def test_read_multi_entry(product_root):
    coordination_path(product_root).write_text(
        "backend: https://github.com/acme/backend.git\n"
        "frontend: https://github.com/acme/frontend.git\n"
        "shared: git@github.com:acme/shared.git\n",
        encoding="utf-8",
    )
    assert read_coordination(product_root) == {
        "backend": "https://github.com/acme/backend.git",
        "frontend": "https://github.com/acme/frontend.git",
        "shared": "git@github.com:acme/shared.git",
    }


# ── write_coordination ───────────────────────────────────────────────────────


def test_write_empty_map_rejected(product_root):
    with pytest.raises(CoordinationError, match="empty"):
        write_coordination(product_root, {})


def test_write_single_entry_round_trip(product_root):
    repos = {"app": "https://github.com/acme/app.git"}
    write_coordination(product_root, repos)
    assert read_coordination(product_root) == repos


def test_write_multi_entry_round_trip(product_root):
    repos = {
        "frontend": "https://github.com/acme/frontend.git",
        "backend": "https://github.com/acme/backend.git",
        "shared": "git@github.com:acme/shared.git",
    }
    write_coordination(product_root, repos)
    assert read_coordination(product_root) == repos


def test_write_sorts_keys_for_deterministic_diffs(product_root):
    # Insertion order intentionally unsorted
    repos = {
        "zeta": "https://github.com/acme/zeta.git",
        "alpha": "https://github.com/acme/alpha.git",
        "mu": "https://github.com/acme/mu.git",
    }
    write_coordination(product_root, repos)
    # File should have keys in alphabetical order
    raw = coordination_path(product_root).read_text(encoding="utf-8")
    keys_in_file = [
        line.split(":", 1)[0] for line in raw.strip().splitlines() if line
    ]
    assert keys_in_file == sorted(repos.keys())


def test_write_overwrites_existing(product_root):
    write_coordination(product_root, {"app": "https://github.com/acme/v1.git"})
    write_coordination(product_root, {"app": "https://github.com/acme/v2.git"})
    assert read_coordination(product_root) == {
        "app": "https://github.com/acme/v2.git",
    }


def test_write_leaves_no_temp_files_on_success(product_root):
    write_coordination(
        product_root, {"app": "https://github.com/acme/app.git"}
    )
    leftovers = [
        p
        for p in product_root.iterdir()
        if p.name.startswith(f".{COORDINATION_FILENAME}.")
    ]
    assert leftovers == [], f"temp files left behind: {leftovers}"


def test_write_creates_product_root_if_missing(tmp_path):
    # product_root doesn't exist yet
    missing_root = tmp_path / "company-a" / "project-x"
    assert not missing_root.exists()
    write_coordination(
        missing_root, {"app": "https://github.com/acme/app.git"}
    )
    assert missing_root.exists()
    assert coordination_path(missing_root).exists()


def test_write_is_atomic_under_yaml_round_trip(product_root):
    """End-to-end: write then verify the raw file parses as the expected map."""
    repos = {
        "backend": "https://github.com/acme/backend.git",
        "frontend": "https://github.com/acme/frontend.git",
    }
    write_coordination(product_root, repos)
    raw = yaml.safe_load(
        coordination_path(product_root).read_text(encoding="utf-8")
    )
    assert raw == repos
