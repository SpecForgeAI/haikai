"""CI connectors — trigger and poll external CI by head SHA (D3/D10.4).

Each connector maps provider status → the spec verdict vocabulary:
pass | fail | pending | skipped (via the connector YAML, #9a). Tokens are
resolved per (repo, connector) from the environment using the D3 template
"{REPO_KEY}_{CONN}_TOKEN" with a generic fallback, and are never persisted.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger(__name__)

_REPO_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def resolve_token(repo_key: str, connector: str, fallback_env: str) -> str | None:
    """D3 token resolution: {REPO_KEY}_{CONN}_TOKEN, then the generic env var.

    P3b hardening: repo_key must be a sane identifier (a garbage key would
    silently build a garbage env-var name), and the broad-scope fallback is
    LOGGED — a misspelled per-repo key must never widen privilege invisibly.
    """
    if not repo_key or not _REPO_KEY_RE.match(repo_key):
        raise ValueError(
            f"invalid repo_key {repo_key!r}: expected [A-Za-z0-9][A-Za-z0-9_-]{{0,63}}"
        )
    specific = f"{repo_key}_{connector}_TOKEN".upper().replace("-", "_")
    token = os.environ.get(specific)
    if token:
        return token
    fallback = os.environ.get(fallback_env)
    if fallback:
        logger.warning(
            "per-repo token %s not set — falling back to broad-scope %s "
            "(verify the repo key if this is unexpected)",
            specific,
            fallback_env,
        )
    return fallback
