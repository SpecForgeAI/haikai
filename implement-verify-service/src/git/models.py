"""Pydantic models for git integration endpoints."""

from __future__ import annotations

import re
from typing import Dict, List, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator


# Folder alias grammar: lowercase letter, then alphanumerics / dash / underscore.
# Matches what the polyrepo spec calls a "folder name" — see
# haikai/specs/2026-05-25-polyrepo-analysis/spec.md.
_FOLDER_RE = re.compile(r"^[a-z][a-z0-9_-]*$")


def _is_well_formed_url(url: str) -> bool:
    """Loose URL well-formedness check.

    Accepts `https://host/owner/repo.git`, SSH shorthand
    `git@host:owner/repo.git`, and `file:///path/to/repo.git` for local
    sandbox use (bare-local origins, test harnesses). Anything else is
    rejected. We do not contact the remote here — that is the
    GitManager's job at clone time, and is allowed to fail
    post-validation.
    """
    if not url or not isinstance(url, str):
        return False
    # SSH shorthand
    if url.startswith("git@") and ":" in url:
        return True
    parsed = urlparse(url)
    if parsed.scheme in {"http", "https", "ssh", "git"} and parsed.netloc:
        return True
    # `file://` for local-only origins (sandbox, bare-local tests). Path
    # must be present; netloc is conventionally empty for `file:///abs/path`.
    if parsed.scheme == "file" and parsed.path:
        return True
    return False


class ProjectInitRequest(BaseModel):
    """Request model for ``POST /projects/init``.

    Two shapes are accepted:

    * **Multi-repo (preferred):** pass ``repos`` as a ``{folder → URL}`` map.
      The map drives the workspace layout: one sub-directory per entry under
      ``workspace/{company}/{project}/``. See the polyrepo spec for details.

    * **Single-repo (legacy):** pass ``repo_url`` as a single string. This is
      promoted internally to a one-entry map ``{<project>: <repo_url>}`` so
      every downstream code path can treat it uniformly. New callers should
      prefer ``repos``.

    Exactly one of ``repos`` or ``repo_url`` must be set.
    """

    company: str = Field(..., description="Company name")
    project: str = Field(..., description="Project name")

    # New polyrepo field. Folder names are the keys (must match ``_FOLDER_RE``);
    # repo URLs are the values (must be unique within the map).
    repos: Optional[Dict[str, str]] = Field(
        default=None,
        description=(
            "Folder name → git remote URL. Each key becomes a sub-directory "
            "under the product workspace root. Both keys (folder names) and "
            "values (URLs) must be unique within the map."
        ),
    )

    # Legacy single-repo field. Kept for backward compatibility with callers
    # that predate the polyrepo work. New callers should use ``repos``.
    repo_url: Optional[str] = Field(
        default=None,
        description=(
            "Legacy single-repo URL. If set without ``repos``, it is promoted "
            "internally to a one-entry map keyed by the project name."
        ),
    )

    # Workspace-wide git provider. When supplied it overrides the
    # ``GIT_PROVIDER`` environment variable for THIS init (the provider's
    # auth token is still read from the environment). Optional so existing
    # env-configured single-provider deployments keep working unchanged.
    git_provider: Optional[str] = Field(
        default=None,
        description=(
            "Git provider for the workspace: 'github', 'gitlab', or "
            "'bitbucket'. Overrides the GIT_PROVIDER env var when set."
        ),
    )

    @field_validator("git_provider")
    @classmethod
    def _validate_git_provider(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        normalized = v.strip().lower()
        if normalized not in ("github", "gitlab", "bitbucket"):
            raise ValueError(
                f"git_provider must be 'github', 'gitlab', or 'bitbucket', got {v!r}"
            )
        return normalized

    @field_validator("repos")
    @classmethod
    def _validate_repos(cls, v: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
        if v is None:
            return v
        if not v:
            raise ValueError("repos must contain at least one entry")
        # Folder name grammar
        for folder in v.keys():
            if not _FOLDER_RE.match(folder):
                raise ValueError(
                    f"Invalid folder alias '{folder}': must match {_FOLDER_RE.pattern}"
                )
        # URL well-formedness
        for folder, url in v.items():
            if not _is_well_formed_url(url):
                raise ValueError(f"Invalid repo URL for folder '{folder}': {url!r}")
        # Value (URL) uniqueness — key uniqueness is free from dict semantics.
        seen: Dict[str, str] = {}
        for folder, url in v.items():
            if url in seen:
                raise ValueError(
                    f"Duplicate repo URL {url!r}: claimed by folders "
                    f"'{seen[url]}' and '{folder}'. Each repo URL must appear "
                    f"at most once."
                )
            seen[url] = folder
        return v

    @model_validator(mode="after")
    def _resolve_repos(self) -> "ProjectInitRequest":
        """Reconcile ``repos`` and the legacy ``repo_url`` shorthand.

        * Both set → reject (ambiguous).
        * Neither set → reject (must specify at least one repo).
        * Only ``repo_url`` → promote to ``{project: repo_url}``.
        * Only ``repos`` → leave as-is.
        """
        if self.repos is not None and self.repo_url is not None:
            raise ValueError(
                "Specify either 'repos' (preferred) or 'repo_url' (legacy), not both."
            )
        if self.repos is None and self.repo_url is None:
            raise ValueError("Must specify 'repos' or 'repo_url'.")
        if self.repos is None and self.repo_url is not None:
            # Promote single URL to a one-entry KV map keyed by project name.
            # Folder regex enforced here too — the project name itself must be
            # a valid folder alias for the promoted shape to make sense.
            folder = self.project
            if not _FOLDER_RE.match(folder):
                raise ValueError(
                    f"Cannot promote legacy 'repo_url' for project {folder!r}: "
                    f"project name must match folder alias grammar "
                    f"{_FOLDER_RE.pattern} when promoted. Use 'repos' "
                    f"with an explicit folder name instead."
                )
            if not _is_well_formed_url(self.repo_url):
                raise ValueError(f"Invalid repo_url: {self.repo_url!r}")
            # Mutate in place — pydantic v2 supports this in @model_validator(mode='after').
            object.__setattr__(self, "repos", {folder: self.repo_url})
        return self


class RepoInitResult(BaseModel):
    """Per-repo outcome of a multi-repo init."""

    folder: str = Field(..., description="Folder alias for this repo")
    dir: str = Field(..., description="Absolute path to the cloned sub-directory")
    mode: str = Field(..., description="'brownfield' or 'greenfield'")


class ProjectInitResponse(BaseModel):
    """Response model for ``POST /projects/init``.

    ``project_dir`` is the *product workspace root* — the parent directory
    that contains one sub-directory per repo. For a one-entry init it is the
    parent of the single cloned repo; for an N-entry init it is the parent of
    N sub-directories.

    ``repos`` carries the per-repo outcome.

    ``mode`` is retained at the top level for backward compatibility with the
    pre-polyrepo response shape. For a one-entry init it equals the single
    repo's mode (``'brownfield'`` or ``'greenfield'``). For an N-entry init it
    is the literal string ``'polyrepo'`` — callers that care about per-repo
    modes should read ``repos[i].mode`` instead.
    """

    success: bool = Field(..., description="Whether initialization succeeded")
    message: str = Field(..., description="Human-readable result message")
    project_dir: str = Field(
        ...,
        description=(
            "Path to the product workspace root (parent of all repo sub-dirs)."
        ),
    )
    mode: str = Field(
        ...,
        description=(
            "'brownfield', 'greenfield' (one-entry init), or 'polyrepo' (N-entry init)."
        ),
    )
    repos: List[RepoInitResult] = Field(
        default_factory=list,
        description="Per-repo init results. One entry per folder in the KV map.",
    )
