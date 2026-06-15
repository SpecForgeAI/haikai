"""Shared HTTP auth for the FastAPI surface.

Lives outside `src.api` so non-web callers (CLI, tests) can import it
without dragging in the API package's import-time side effects (workspace
mkdir, jobs.db open, log file creation).

Reads `STANDARDS_API_KEY` from the environment on every request — this lets
tests rotate keys per-test via `monkeypatch.setenv` without reimporting
the FastAPI app.
"""
from __future__ import annotations

import os
import secrets

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()


def verify_api_key(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> bool:
    """Verify the Bearer token against the `STANDARDS_API_KEY` env var.

    Fails closed: if the env var is unset, every request returns 500. The
    comparison is constant-time to prevent timing attacks.
    """
    api_key = os.getenv("STANDARDS_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API key not configured on server",
        )

    if not secrets.compare_digest(
        credentials.credentials.encode("utf-8"), api_key.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    return True
