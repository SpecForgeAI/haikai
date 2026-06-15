"""Regression tests for the autoresearch:debug 260504-0934 fixes (#1-#3).

Findings (skipping #4 — the .dockerignore/CLAUDE.md whitelist — per user
direction):

- #1 (HIGH): TSV-escape gap in store.py writers (8 sites). The 7af0c83
  fix to interaction_classifier was silently neutralized when
  store.write_interactions() overwrote the file unescaped. Fix lifts
  _tsv_safe to module level in store.py and applies it everywhere.
- #2 (MEDIUM): chat executors lack defense-in-depth safe_segment.
  Fix adds the validation in __init__ of all 3 chat executors so
  any future caller is safe by construction.
- #3 (LOW): unparseable repo_url returned 500 instead of 400. Fix wraps
  parse_repo_url in try/except → HTTPException(400).
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest


# ─── #1: store.py TSV-escape across all writers ─────────────────────────────


class TestStoreTsvEscape:
    """All 8 TSV writers in store.py must escape \\t / \\n / \\r in field values
    so a malicious source file can't forge fake rows in _index.txt etc."""

    def _build_analysis(self, **sym_overrides):
        from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind
        sym = SymbolInfo(
            name=sym_overrides.get("name", "func"),
            kind=sym_overrides.get("kind", SymbolKind.FUNCTION),
            scope=sym_overrides.get("scope", "-"),
            line_start=10,
            signature=sym_overrides.get("signature", "()"),
        )
        return StructuralAnalysis(
            file_path="evil.py", language="python",
            symbols=[sym], provider_used="ctags",
        )

    def test_tsv_safe_helper_strips_separators(self):
        from src.ast.store import _tsv_safe
        assert _tsv_safe("a\tb\nc\rd") == "a b c d"
        assert _tsv_safe(None) == ""
        assert _tsv_safe(42) == "42"

    def test_write_index_blocks_row_forgery_via_signature_newline(self, tmp_path):
        """The autoresearch:debug 260504-0934 #1 reproducer: a signature
        with embedded \\n + tabs forged a fake row in _index.txt. After
        the fix the row count and column count both stay sane."""
        from src.ast.store import FileStore

        store = FileStore(base_path=str(tmp_path))
        # Signature that would forge a fake row pre-fix
        analysis = self._build_analysis(
            name="line_break_attack",
            signature="()\nFAKE_ROW\tfunction\thidden\t-\t-\t999\t-",
        )
        snap = tmp_path / "snap"
        snap.mkdir()
        store.write_index(snap, {"evil.py": analysis})

        content = (snap / "_index.txt").read_text(encoding="utf-8")
        rows = [r for r in content.split("\n") if r.strip()]
        # Header + 1 sym row, no forged row
        assert len(rows) == 2, f"expected 2 rows, got {len(rows)}: {rows}"
        # The sole data row must have exactly 7 columns (the schema width)
        data_row = rows[1]
        cols = data_row.split("\t")
        assert len(cols) == 7, f"row has {len(cols)} cols, schema is 7: {cols}"
        # And the forged row must NOT appear as a separate line
        assert "FAKE_ROW" in data_row, "fake content should be inlined into the signature col, not promoted to its own row"
        assert "\nFAKE_ROW" not in content

    def test_write_index_strips_tab_in_signature(self, tmp_path):
        from src.ast.store import FileStore

        store = FileStore(base_path=str(tmp_path))
        analysis = self._build_analysis(signature="(a,\tb)")
        snap = tmp_path / "snap"
        snap.mkdir()
        store.write_index(snap, {"evil.py": analysis})

        content = (snap / "_index.txt").read_text(encoding="utf-8")
        rows = [r for r in content.split("\n") if r.strip()]
        assert len(rows[1].split("\t")) == 7

    def test_write_endpoints_blocks_path_newline_forgery(self, tmp_path):
        """Endpoints are LLM-generated — most exposed to prompt injection.
        A path like '/users\\nINJECTED\\trow' must not split the row."""
        from src.ast.store import FileStore
        from src.ast.models import StructuralAnalysis, EndpointInfo

        analysis = StructuralAnalysis(
            file_path="api.py", language="python", provider_used="ctags",
        )
        analysis.endpoints = [EndpointInfo(
            type="HTTP", path="/users\nINJECTED\trow",
            operation="GET", handler_class="UserCtl",
            handler_method="list", file="api.py", line=10,
            direction="INBOUND", protocol="REST",
            framework="fastapi", confidence=0.9,
        )]
        store = FileStore(base_path=str(tmp_path))
        snap = tmp_path / "snap"
        snap.mkdir()
        store.write_endpoints(snap, {"api.py": analysis})

        content = (snap / "_endpoints.txt").read_text(encoding="utf-8")
        rows = [r for r in content.split("\n") if r.strip()]
        assert len(rows) == 2, f"expected header + 1 row, got {len(rows)}"
        # The data row must have exactly 11 cols (the endpoint schema)
        assert len(rows[1].split("\t")) == 11

    def test_write_interactions_blocks_target_newline_forgery(self, tmp_path):
        """Interactions are also LLM-generated. Same defense."""
        from src.ast.store import FileStore
        from src.ast.models import StructuralAnalysis, InteractionInfo

        analysis = StructuralAnalysis(
            file_path="svc.py", language="python", provider_used="ctags",
        )
        analysis.interactions = [InteractionInfo(
            source_class="Svc", source_method="send",
            target="orders\nFORGED\trow", target_type="QUEUE",
            direction="PUBLISH", mechanism="kafka",
            data_hint="OrderEvent", file="svc.py",
            line=42, confidence=0.95,
        )]
        store = FileStore(base_path=str(tmp_path))
        snap = tmp_path / "snap"
        snap.mkdir()
        store.write_interactions(snap, {"svc.py": analysis})

        content = (snap / "_interactions.txt").read_text(encoding="utf-8")
        rows = [r for r in content.split("\n") if r.strip()]
        assert len(rows) == 2
        assert len(rows[1].split("\t")) == 10  # interaction schema width


# ─── #2: chat executor defense-in-depth safe_segment ─────────────────────────


class TestChatExecutorSafeSegment:
    """All 3 chat executors must reject ../ company/project at __init__,
    not rely on upstream session_store to pre-validate."""

    def test_claude_chat_executor_rejects_dotdot_company(self, tmp_path):
        from src.chat.claude_chat_executor import ClaudeChatExecutor
        with pytest.raises(ValueError, match="unsafe company"):
            ClaudeChatExecutor(
                company="..",
                project="attacker",
                workspace_dir=tmp_path,
                anthropic_api_key="fake-key",
            )
        # And the escape directory was NOT created
        assert not (tmp_path.parent / "attacker").exists()

    def test_claude_chat_executor_rejects_dotdot_project(self, tmp_path):
        from src.chat.claude_chat_executor import ClaudeChatExecutor
        with pytest.raises(ValueError, match="unsafe project"):
            ClaudeChatExecutor(
                company="acme",
                project="../escape",
                workspace_dir=tmp_path,
                anthropic_api_key="fake-key",
            )

    def test_oauth_chat_executor_rejects_dotdot(self, tmp_path):
        from src.chat.oauth_chat_executor import OAuthChatExecutor
        with pytest.raises(ValueError, match="unsafe (company|project)"):
            OAuthChatExecutor(
                company="..",
                project="attacker",
                workspace_dir=tmp_path,
                anthropic_api_key="sk-ant-oat01-fake",
            )

    def test_openai_chat_executor_rejects_dotdot(self, tmp_path):
        from src.chat.openai_chat_executor import OpenAIChatExecutor
        with pytest.raises(ValueError, match="unsafe (company|project)"):
            OpenAIChatExecutor(
                company="..",
                project="attacker",
                workspace_dir=tmp_path,
                openai_api_key="sk-fake",
                model="gpt-4",
            )


# ─── #3: parse_repo_url ValueError → HTTPException 400 ──────────────────────


class TestUnparseableRepoUrlIs400:
    def test_unparseable_url_raises_400_not_500(self):
        from fastapi import HTTPException
        from src.structural_endpoints import _clone_repo

        with pytest.raises(HTTPException) as exc:
            _clone_repo("not-a-url-at-all")
        assert exc.value.status_code == 400
        assert "not-a-url-at-all" in exc.value.detail

    def test_unparseable_url_through_api_returns_400(self):
        """End-to-end check via TestClient: unparseable repo_url returns
        a 400 response, not a 500."""
        from fastapi.testclient import TestClient

        prior = os.environ.get("STANDARDS_API_KEY")
        os.environ["STANDARDS_API_KEY"] = "test-key"
        try:
            from src.api import app
            client = TestClient(app)
            r = client.post(
                "/api/v1/structural/analyze",
                json={"repo_url": "garbage-not-a-url"},
                headers={"Authorization": "Bearer test-key"},
            )
            assert r.status_code == 400, (
                f"expected 400, got {r.status_code}: {r.text[:200]}"
            )
            assert "garbage-not-a-url" in r.json()["detail"]
        finally:
            # Restore — popping unconditionally would leak across test
            # files. See fix/260504-1127-full-repo-green for incident.
            if prior is None:
                os.environ.pop("STANDARDS_API_KEY", None)
            else:
                os.environ["STANDARDS_API_KEY"] = prior
