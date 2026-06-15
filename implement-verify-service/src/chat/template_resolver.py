"""Shared `{{...}}` template resolver for Haikai markdown commands.

Before this module existed, the resolver was copy-pasted into 5 files:
`claude_chat_executor.py`, `kiro_chat_executor.py`, `oauth_chat_executor.py`,
`api_command_executor.py`, and `kiro_cli_executor.py`. Each copy had
the same body with cosmetic differences and a dead `base_dir`
parameter. The anti-pattern guard
(`tests/test_anti_pattern_guards.py:TestResolveTemplateSingleSource`)
prevents the duplication from coming back.

The resolver understands these placeholder forms:

- `{{PHASE N: @haikai/commands/path/file.md}}` → inline file content
- `{{workflows/specification/file}}` → inline from a known subdir
- `{{standards/global/*}}` → inline every `*.md` under a directory
- `{{UNLESS flag}}...{{ENDUNLESS flag}}` → strip the conditional block
  (we always compile in `compiled_single_command=True,
  standards_as_claude_code_skills=True` mode).
"""

from __future__ import annotations

import re
from pathlib import Path


_MAX_DEPTH = 5
_UNLESS_BLOCK = re.compile(
    r"\{\{UNLESS\s+\w+\}\}.*?\{\{ENDUNLESS\s+\w+\}\}",
    flags=re.DOTALL,
)
_PLACEHOLDER = re.compile(r"\{\{([^}]+)\}\}")
_HAIKAI_REF = re.compile(r"@haikai/(.+)")


def resolve_template(content: str, profiles_dir: Path, depth: int = 0) -> str:
    """Expand `{{...}}` placeholders by inlining referenced markdown files.

    Args:
        content: The template text to expand.
        profiles_dir: Root of the haikai profile (e.g.
            `<repo>/haikai-profiles/default`). Used to resolve every
            `@haikai/...` and `workflows/...` reference.
        depth: Recursion depth — internal use; callers pass 0.

    Returns:
        The expanded text. Unresolved references are surfaced as
        `[Unresolved: <ref>]` so they're visible to the LLM rather than
        silently dropped.
    """
    if depth > _MAX_DEPTH:
        return content

    content = _UNLESS_BLOCK.sub("", content)

    def resolve_ref(match: re.Match[str]) -> str:
        ref = match.group(1).strip()

        # `{{PHASE N: @haikai/commands/path/file.md}}` style
        if "@haikai/" in ref:
            path_part = _HAIKAI_REF.search(ref)
            if path_part:
                rel_path = path_part.group(1)
                file_path = profiles_dir / rel_path
                if not file_path.exists():
                    # CLI convention: commands live under a `single-agent/`
                    # subdir; try it before giving up.
                    file_path = file_path.parent / "single-agent" / file_path.name
                if file_path.exists():
                    child = file_path.read_text(encoding="utf-8")
                    return resolve_template(child, profiles_dir, depth + 1)
            return f"[Unresolved: {ref}]"

        # `{{workflows/specification/file}}` style (slash-pathed, no glob, no PHASE prefix)
        if "/" in ref and not ref.startswith("PHASE") and "*" not in ref:
            file_path = profiles_dir / f"{ref}.md"
            if file_path.exists():
                child = file_path.read_text(encoding="utf-8")
                return resolve_template(child, profiles_dir, depth + 1)
            return f"[Unresolved: {ref}]"

        # `{{standards/global/*}}` style — inline every .md in the directory
        if "*" in ref:
            parent = (profiles_dir / ref).parent
            if parent.exists():
                parts = [
                    f.read_text(encoding="utf-8")
                    for f in sorted(parent.glob("*.md"))
                ]
                if parts:
                    return "\n\n".join(parts)
            return ""

        return match.group(0)

    return _PLACEHOLDER.sub(resolve_ref, content)
