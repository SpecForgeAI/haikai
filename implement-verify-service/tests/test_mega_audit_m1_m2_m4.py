"""Tests for M1/M2/M4 from autoresearch:debug 260504-1448 mega audit.

- M1 (HIGH): GITHUB_TOKEN must not leak in clone-error responses.
- M2 (MEDIUM): Server token only attached to allowlisted owners.
- M4 (LOW): OperationResponse.output_dir is workspace-relative.

(M3 is intentionally not implemented — see
haikai/specs/2026-05-04-standards-resource-limits/spec.md.)
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest


REPO_ROOT = Path(__file__).parent.parent


# ─── M1: token never appears in clone-error text ────────────────────────────


class TestNoTokenInCloneErrors:
    """Both clone sites (standards_orchestrator + structural_endpoints)
    must catch TimeoutExpired and CalledProcessError without putting
    the auth_url (which embeds the token) in the user-facing message.
    """

    def test_standards_orchestrator_timeout_msg_omits_clone_url(self):
        """Source-grep guard: the timeout exception path must not
        f-string {clone_url}."""
        text = (REPO_ROOT / "src" / "standards_orchestrator.py").read_text(
            encoding="utf-8"
        )
        # Find lines that build a RuntimeError around timeout, then
        # assert clone_url is NOT inside the f-string template.
        bad_lines = [
            f"line {i+1}: {l.strip()}"
            for i, l in enumerate(text.split("\n"))
            if "RuntimeError" in l and "{clone_url}" in l
        ]
        assert bad_lines == [], (
            "Found RuntimeError with {clone_url} in template — token leak:\n"
            + "\n".join(f"  {b}" for b in bad_lines)
        )

    def test_structural_endpoints_timeout_caught_explicitly(self):
        """The subprocess.run in _clone_repo must be wrapped in
        try/except TimeoutExpired so the cmd argv (with embedded
        token) doesn't leak via the default exception repr."""
        text = (REPO_ROOT / "src" / "structural_endpoints.py").read_text(
            encoding="utf-8"
        )
        # Look for the subprocess.run inside _clone_repo
        assert "except subprocess.TimeoutExpired" in text, (
            "structural_endpoints._clone_repo must catch TimeoutExpired "
            "explicitly to prevent the cmd argv (which embeds the token) "
            "from appearing in the default exception repr"
        )


# ─── M2: github owner allowlist ─────────────────────────────────────────────


class TestGithubOwnerAllowlist:
    """Server's GITHUB_TOKEN is only applied when owner matches the
    operator-configured allowlist."""

    def test_default_no_allowlist_means_token_not_used(self):
        from src.standards_orchestrator import _owner_in_allowlist
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("STANDARDS_GITHUB_OWNER_ALLOWLIST", None)
            assert _owner_in_allowlist("any-owner") is False
            assert _owner_in_allowlist("torvalds") is False

    def test_wildcard_allows_all_owners(self):
        from src.standards_orchestrator import _owner_in_allowlist
        with patch.dict(os.environ, {"STANDARDS_GITHUB_OWNER_ALLOWLIST": "*"}):
            assert _owner_in_allowlist("any") is True
            assert _owner_in_allowlist("torvalds") is True

    def test_specific_owners_only(self):
        from src.standards_orchestrator import _owner_in_allowlist
        with patch.dict(
            os.environ,
            {"STANDARDS_GITHUB_OWNER_ALLOWLIST": "acme-org, my-company"},
        ):
            assert _owner_in_allowlist("acme-org") is True
            assert _owner_in_allowlist("my-company") is True
            assert _owner_in_allowlist("attacker-org") is False

    def test_case_insensitive(self):
        from src.standards_orchestrator import _owner_in_allowlist
        with patch.dict(
            os.environ, {"STANDARDS_GITHUB_OWNER_ALLOWLIST": "AcmeOrg"}
        ):
            assert _owner_in_allowlist("acmeorg") is True
            assert _owner_in_allowlist("ACMEORG") is True

    def test_empty_string_treated_as_no_allowlist(self):
        from src.standards_orchestrator import _owner_in_allowlist
        with patch.dict(os.environ, {"STANDARDS_GITHUB_OWNER_ALLOWLIST": "  "}):
            assert _owner_in_allowlist("any") is False


# ─── M4: workspace-relative output_dir serialization ─────────────────────────


class TestOutputDirRelative:
    """OperationResponse.output_dir should be workspace-relative when
    API_WORKSPACE_DIR is set, falling back to absolute POSIX otherwise."""

    def test_paths_inside_workspace_become_relative(self, tmp_path):
        from src.models import OperationResponse, OperationMode

        with patch.dict(os.environ, {"API_WORKSPACE_DIR": str(tmp_path)}):
            project_dir = tmp_path / "acme" / "backend" / "haikai" / "product"
            project_dir.mkdir(parents=True)
            resp = OperationResponse(
                success=True,
                mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
                output_dir=project_dir,
                outputs=[project_dir / "tech-stack.md"],
                message="ok",
            )
            data = resp.model_dump()
            assert data["output_dir"] == "acme/backend/haikai/product"
            assert data["outputs"] == ["acme/backend/haikai/product/tech-stack.md"]

    def test_paths_outside_workspace_stay_absolute(self, tmp_path):
        """CLI mode / explicit external output_dir gets absolute fallback."""
        from src.models import OperationResponse, OperationMode

        with patch.dict(os.environ, {"API_WORKSPACE_DIR": str(tmp_path)}):
            external = tmp_path.parent / "outside-workspace"
            external.mkdir(exist_ok=True)
            resp = OperationResponse(
                success=True,
                mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
                output_dir=external,
                outputs=[],
                message="ok",
            )
            data = resp.model_dump()
            # Stays absolute because path doesn't sit under workspace
            assert data["output_dir"] == external.as_posix()

    def test_no_workspace_env_falls_back_to_absolute(self, tmp_path):
        from src.models import OperationResponse, OperationMode

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("API_WORKSPACE_DIR", None)
            resp = OperationResponse(
                success=True,
                mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
                output_dir=tmp_path / "x",
                outputs=[],
                message="ok",
            )
            data = resp.model_dump()
            # Absolute path preserved when no workspace anchor
            assert data["output_dir"] == (tmp_path / "x").as_posix()
