"""Client construction, base-URL/token resolution, and the destructive-action guard.

Auth reuses the connector token convention
(`src/verification/connectors.resolve_token`): a per-repo
`{REPO_KEY}_GITLAB_TOKEN` overrides the generic `GITLAB_TOKEN` fallback. The
instance base URL comes from `GITLAB_URL` (defaults to gitlab.com SaaS) — set it
to your self-hosted host.

`build_client` constructs the `gitlab.Gitlab` object but does NOT authenticate
(no `.auth()` call), so it performs no network I/O until a verb makes a request.
"""

from __future__ import annotations

import os
from typing import Optional

import gitlab

from src.verification.connectors import resolve_token

CONNECTOR = "GITLAB"
FALLBACK_ENV = "GITLAB_TOKEN"
DEFAULT_URL = "https://gitlab.com"


class GitLabConnectorError(Exception):
    """Any failure building or talking to the GitLab control plane."""


class ConfirmationRequired(GitLabConnectorError):
    """A destructive verb was called without `confirm=True`."""


def resolve_base_url(explicit: Optional[str] = None) -> str:
    """`explicit` arg → `GITLAB_URL` env → gitlab.com. Must be http(s)."""
    url = (explicit or os.getenv("GITLAB_URL") or DEFAULT_URL).strip()
    if not url.startswith(("http://", "https://")):
        raise GitLabConnectorError(
            f"GITLAB_URL must start with http:// or https:// — got {url!r}"
        )
    return url.rstrip("/")


def build_client(
    repo_key: str = "default",
    *,
    url: Optional[str] = None,
    token: Optional[str] = None,
) -> gitlab.Gitlab:
    """Build an unauthenticated-yet `gitlab.Gitlab` (no network until first call)."""
    base = resolve_base_url(url)
    tok = token or resolve_token(repo_key, CONNECTOR, FALLBACK_ENV)
    if not tok:
        raise GitLabConnectorError(
            f"no token: set {repo_key.upper()}_{CONNECTOR}_TOKEN or {FALLBACK_ENV}"
        )
    return gitlab.Gitlab(url=base, private_token=tok)


def require_confirm(action: str, confirm: bool) -> None:
    """Guard every destructive verb — it hits live infra, so callers must opt in."""
    if not confirm:
        raise ConfirmationRequired(
            f"refusing to {action} without confirm=True "
            f"(destructive — acts on the live GitLab instance)"
        )
