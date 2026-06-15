"""Single source of truth for the `haikai-profiles/` directory path.

Before this module existed, every chat executor (`claude`, `kiro`,
`oauth`, `openai`) reconstructed the path independently with
`Path(__file__).parent.parent.parent / "haikai-profiles"`. The
sibling-missed risk is real: any future move of the profiles
directory (e.g. into `vendor/`, a different layout in Docker, a
test-fixture override) would need every clone updated.

Importers MUST use the constant rather than recomputing the path —
the anti-pattern guard
`tests/test_anti_pattern_guards.py:TestNoInlineHaikaiProfilesReconstruction`
greps `src/chat/` for the inline pattern and asserts the only
remaining occurrence is the one in this file.

This module deliberately does NOT cover the deeper `... /
"haikai-profiles" / "default"` sites or the `src/ast/`
discoverer constants — those have separate evolution pressures.
The chat-executor cluster is the dense cluster the audit (B-N5)
flagged; scope-creeping to every site would silently broaden the
fix beyond what was reviewed.
"""
from __future__ import annotations

from pathlib import Path

# Repo-relative anchor: this file lives at
#   <repo>/src/chat/profiles_path.py
# so three .parent hops land at <repo>/.
HAIKAI_PROFILES_ROOT: Path = Path(__file__).parent.parent.parent / "haikai-profiles"
"""Filesystem path to `<repo>/haikai-profiles/`.

Used as Claude's `--add-dir` entry, the `HAIKAI_PROFILES_PATH` env
var, and the root for every `default/commands/...` template lookup.
"""
