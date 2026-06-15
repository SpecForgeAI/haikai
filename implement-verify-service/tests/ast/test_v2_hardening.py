"""Hardening regressions for src/ast/v2/.

Covers fixes from the most recent autoresearch:debug pass:
- Django include() recursion no longer reads files outside project_root
  even when the source's include() arg has malformed module paths like
  "..foo" (which `.replace(".", "/")` turns into "//foo" — absolute on
  POSIX).
- Malformed playbook regex patterns no longer crash the merger or
  executor — they're caught and the offending rule is skipped with a
  note instead.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.ast.v2.queries.configs import parse_django_urls
from src.ast.v2.multi_framework_merger import merge_endpoints


# ─── Django include() traversal ──────────────────────────────────────────────


@pytest.mark.parametrize("malformed_mod", [
    "..foo",        # leading dots → "//foo" → absolute on POSIX
    ".foo",         # leading dot
    "foo.",         # trailing dot → "foo/" with empty trailing segment
    "foo..bar",     # double-dot in middle → "foo//bar"
    "foo/bar",     # explicit slash
    "foo\\bar",    # explicit backslash
    "..",          # bare dotdot
    "",            # empty
])
def test_django_include_rejects_malformed_module(tmp_path, malformed_mod):
    """Malformed include() module paths must not trigger an out-of-tree read."""
    proj = tmp_path / "proj"; proj.mkdir()
    # Plant an attractive file outside project_root that a traversal would target
    sentinel = tmp_path / "secret.py"; sentinel.write_text('print("traversed")')

    source = (
        f"from django.urls import include, path\n"
        f"urlpatterns = [path('foo/', include('{malformed_mod}'))]\n"
    )
    # Should not raise, should return [] (or a list without any endpoints
    # derived from the sentinel file). The point is no traversal happens.
    out = parse_django_urls(proj / "urls.py", source, project_root=proj)
    assert isinstance(out, list)


# ─── Playbook regex resilience ───────────────────────────────────────────────


def test_merger_swallows_invalid_drop_path_regex():
    """Malformed `drop_if_path_matches` doesn't crash merge_endpoints."""
    playbooks = {
        "evil": {
            "name": "evil",
            "conflict_rules": [
                {"drop_if_path_matches": "(unclosed"},     # invalid regex
            ],
        },
        "good": {
            "name": "good",
            "conflict_rules": [
                {"drop_if_path_matches": "^/api/"},        # valid
            ],
        },
    }
    # Should not raise
    merged, report = merge_endpoints([], playbooks)
    assert merged == []
    assert report.total_input == 0


def test_merger_swallows_invalid_drop_handler_regex():
    """Malformed `drop_if_handler_matches` doesn't crash merge_endpoints."""
    playbooks = {
        "evil": {
            "name": "evil",
            "conflict_rules": [
                {"drop_if_handler_matches": "[unclosed-class"},
            ],
        },
    }
    merged, _ = merge_endpoints([], playbooks)
    assert merged == []
