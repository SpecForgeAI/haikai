"""Unit tests for the shared `{{...}}` template resolver.

The resolver is the single point of failure for all backends' skill
loading (claude, kiro, oauth, openai, api_command all delegate to it).
Tests here exercise every placeholder shape against a minimal
in-memory fake `profiles_dir`, so a regression surfaces without
having to spin up a backend.

Closes finding L1 from debug/260518-0520-executor-refactor-review.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.chat.template_resolver import resolve_template


@pytest.fixture
def profiles(tmp_path: Path) -> Path:
    """Build a minimal `haikai-profiles/default` tree on disk.

    Layout (matches the real `haikai-profiles/default/` shape):

        commands/foo.md                              (direct resolution)
        commands/bar/single-agent/some-phase.md      (single-agent fallback)
        workflows/specification/check.md             (slash-pathed ref)
        standards/global/a.md                        (glob inline)
        standards/global/b.md
    """
    root = tmp_path / "default"
    (root / "commands").mkdir(parents=True)
    (root / "commands" / "foo.md").write_text("FOO_CONTENT", encoding="utf-8")
    (root / "commands" / "bar" / "single-agent").mkdir(parents=True)
    (root / "commands" / "bar" / "single-agent" / "some-phase.md").write_text(
        "PHASE_CONTENT", encoding="utf-8",
    )
    (root / "workflows" / "specification").mkdir(parents=True)
    (root / "workflows" / "specification" / "check.md").write_text(
        "CHECK_CONTENT", encoding="utf-8",
    )
    (root / "standards" / "global").mkdir(parents=True)
    (root / "standards" / "global" / "a.md").write_text("AAA", encoding="utf-8")
    (root / "standards" / "global" / "b.md").write_text("BBB", encoding="utf-8")
    return root


def test_haikai_ref_inlines_file(profiles: Path) -> None:
    out = resolve_template("before {{@haikai/commands/foo.md}} after", profiles)
    assert out == "before FOO_CONTENT after"


def test_haikai_ref_falls_back_to_single_agent_subdir(profiles: Path) -> None:
    # `commands/bar/some-phase.md` doesn't exist directly; the resolver
    # should fall back to `commands/bar/single-agent/some-phase.md`
    # (the CLI convention).
    out = resolve_template("X {{@haikai/commands/bar/some-phase.md}} Y", profiles)
    assert out == "X PHASE_CONTENT Y"


def test_slash_pathed_ref_inlines_workflow(profiles: Path) -> None:
    out = resolve_template("[{{workflows/specification/check}}]", profiles)
    assert out == "[CHECK_CONTENT]"


def test_glob_inlines_every_md_in_directory(profiles: Path) -> None:
    out = resolve_template("{{standards/global/*}}", profiles)
    # Files are read in sorted order, joined with two newlines.
    assert out == "AAA\n\nBBB"


def test_unless_block_is_stripped_regardless_of_flag(profiles: Path) -> None:
    # The resolver always strips UNLESS/ENDUNLESS blocks (the codebase
    # always compiles in `compiled_single_command=True` mode).
    src = "keep1 {{UNLESS flag}}DROP THIS{{ENDUNLESS flag}} keep2"
    assert resolve_template(src, profiles) == "keep1  keep2"


def test_unresolved_ref_surfaces_as_unresolved_marker(profiles: Path) -> None:
    out = resolve_template("{{@haikai/commands/does-not-exist.md}}", profiles)
    assert out == "[Unresolved: @haikai/commands/does-not-exist.md]"


def test_unresolved_slash_path_also_surfaces(profiles: Path) -> None:
    out = resolve_template("{{workflows/nope/missing}}", profiles)
    assert out == "[Unresolved: workflows/nope/missing]"


def test_unknown_placeholder_passes_through(profiles: Path) -> None:
    # Refs without `/` and without `*` and not `@haikai/...` aren't
    # any known shape — the resolver leaves them verbatim.
    out = resolve_template("plain {{NAKED}}", profiles)
    assert out == "plain {{NAKED}}"


def test_recursion_depth_limit_prevents_infinite_loop(tmp_path: Path) -> None:
    # Each file references itself — without the depth cap this would
    # recurse forever. The resolver bails at depth > 5.
    root = tmp_path / "default"
    (root / "commands").mkdir(parents=True)
    (root / "commands" / "loop.md").write_text(
        "L{{@haikai/commands/loop.md}}", encoding="utf-8",
    )
    out = resolve_template("{{@haikai/commands/loop.md}}", root)
    # Six expansions before the limit kicks in; the last reference
    # survives un-resolved because depth > 5 returns content as-is.
    assert out.startswith("L" * 6)
    assert "{{@haikai/commands/loop.md}}" in out


def test_no_placeholders_returns_input_unchanged(profiles: Path) -> None:
    assert resolve_template("plain text", profiles) == "plain text"


def test_nested_resolution_works(profiles: Path) -> None:
    # The single-agent fallback file references another placeholder —
    # verify recursion expands the inner ref too.
    (profiles / "commands" / "bar" / "single-agent" / "some-phase.md").write_text(
        "INNER {{@haikai/commands/foo.md}} END", encoding="utf-8",
    )
    out = resolve_template(
        "{{@haikai/commands/bar/some-phase.md}}", profiles,
    )
    assert out == "INNER FOO_CONTENT END"
