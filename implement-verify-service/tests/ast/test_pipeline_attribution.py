"""Regression: pipeline._resolve_to_results_key + no silent mis-attribution.

Before fix: when an LLM-discovered endpoint's `file` didn't byte-match a
ctags_results key (very common — LLM emits "src/foo.py" while
ctags_results has the absolute path), the code attached the endpoint to
`next(iter(ctags_results))` — a random first key. Result: endpoints
silently ended up attributed to whichever file got analyzed first.

After fix: try several normalizations (exact, project_root-relative,
forward-slash, basename-unique). If still no match, drop and log a
warning. Never silently mis-attribute.

Same fix mirrored for the interactions path.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.ast.pipeline import _resolve_to_results_key


# ─── _resolve_to_results_key behavior ────────────────────────────────────────


def test_exact_match():
    results = {"D:/proj/src/foo.py": object(), "D:/proj/src/bar.py": object()}
    assert _resolve_to_results_key("D:/proj/src/foo.py", results, "D:/proj") == "D:/proj/src/foo.py"


def test_project_root_relative_match():
    """LLM emits 'src/foo.py' relative to project_root."""
    results = {"D:/proj/src/foo.py": object()}
    assert _resolve_to_results_key("src/foo.py", results, "D:/proj") == "D:/proj/src/foo.py"


def test_forward_slash_normalization_match():
    """ctags_results may have backslashes; LLM emits forward slashes (or vice versa)."""
    results = {r"D:\proj\src\foo.py": object()}
    assert _resolve_to_results_key("src/foo.py", results, "D:/proj") == r"D:\proj\src\foo.py"


def test_basename_unique_match():
    """When project_root resolution fails but basename is unique, accept it."""
    results = {"D:/somewhere/else/uniquely_named.py": object()}
    assert _resolve_to_results_key("uniquely_named.py", results, None) == "D:/somewhere/else/uniquely_named.py"


def test_basename_ambiguous_no_match():
    """Multiple files share the basename → ambiguous, return None."""
    results = {
        "D:/proj/a/foo.py": object(),
        "D:/proj/b/foo.py": object(),
    }
    assert _resolve_to_results_key("foo.py", results, None) is None


def test_no_match_returns_none_not_random():
    """The critical safety property: no fallback to a random key."""
    results = {"D:/proj/src/foo.py": object(), "D:/proj/src/bar.py": object()}
    assert _resolve_to_results_key("totally/unrelated.py", results, "D:/proj") is None
    assert _resolve_to_results_key("", results, "D:/proj") is None
    assert _resolve_to_results_key(None, results, "D:/proj") is None


# ─── interaction_classifier TSV escaping ─────────────────────────────────────


def test_tsv_escapes_tabs_and_newlines_in_llm_fields(tmp_path):
    """LLM-derived `target` / `source_class` etc with `\\t`/`\\n` must not break columns."""
    from src.ast.interaction_classifier import InteractionClassifier, ClassificationResult
    from src.ast.models import InteractionInfo

    interaction = InteractionInfo(
        target_type="HTTP",
        target="POST /users\nstuff",       # newline in field
        direction="outbound",
        mechanism="rest",
        data_hint="User\twith\ttabs",      # tabs in field
        source_class="UserService",
        source_method="create",
        file="src/foo.py",
        line=42,
        confidence=0.9,
    )
    result = ClassificationResult(
        pre_classified=[interaction],
        llm_classified=[],
        unclassified_batches=[],
        stats={},
    )

    InteractionClassifier.write_classified_interactions(tmp_path, result)
    written = (tmp_path / "_interactions.txt").read_text(encoding="utf-8")
    lines = [l for l in written.splitlines() if l and not l.startswith("#")]

    # Must be exactly one row (newline didn't split into two)
    assert len(lines) == 1, f"newline in field broke row: got {len(lines)} lines"

    # Must have exactly 11 columns (tabs in field didn't shift columns)
    cols = lines[0].split("\t")
    assert len(cols) == 11, f"tab in field shifted columns: got {len(cols)}"

    # The values are present (with separators replaced)
    assert "POST /users stuff" in cols[1]    # target — newline → space
    assert "User with with tabs" in cols[4] or "User with tabs" in cols[4]  # data_hint
