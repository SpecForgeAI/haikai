"""
Git configuration loader.

Loads and validates git-related environment variables for v2 endpoints.
"""

import json
import os
import logging
from pathlib import Path
from typing import Iterable, Optional

from .provider_strategy import (
    BitbucketStrategy,
    GitHubStrategy,
    GitLabStrategy,
    GitProviderStrategy,
)

logger = logging.getLogger(__name__)


class GitConfigError(Exception):
    """Raised when required git configuration is missing."""
    pass


class GitConfig:
    """Validated git configuration from environment variables.

    The provider-specific token fields (`github_token`, `gitlab_token`,
    `bitbucket_username`, `bitbucket_app_password`) are kept as the
    public boundary so external callers and tests can construct
    `GitManager(..., github_token=..., bitbucket_username=...)`
    directly. Internally, prefer `get_provider_strategy()` which
    returns the concrete `GitProviderStrategy` carrying only the
    credentials that provider needs.
    """

    def __init__(
        self,
        provider: str,
        default_branch: str,
        auto_push: bool,
        auto_pr: bool,
        github_token: Optional[str],
        bitbucket_username: Optional[str],
        bitbucket_app_password: Optional[str],
        gitlab_token: Optional[str] = None,
    ):
        self.provider = provider
        self.default_branch = default_branch
        self.auto_push = auto_push
        self.auto_pr = auto_pr
        self.github_token = github_token
        self.bitbucket_username = bitbucket_username
        self.bitbucket_app_password = bitbucket_app_password
        self.gitlab_token = gitlab_token

    def get_provider_strategy(self) -> GitProviderStrategy:
        """Single-dispatch factory: return the strategy for `self.provider`.

        This is the ONLY switch on `self.provider` in the codebase
        (enforced by `tests/test_anti_pattern_guards.py:
        TestNoProviderSwitchOutsideProviderStrategy`). Every other
        site asks the strategy what to do.
        """
        if self.provider == "github":
            return GitHubStrategy(self.github_token)
        if self.provider == "bitbucket":
            return BitbucketStrategy(
                self.bitbucket_username, self.bitbucket_app_password
            )
        if self.provider == "gitlab":
            # GitLab tokens were historically stuffed into github_token
            # (see load_git_config). Prefer gitlab_token if set, else
            # fall back to github_token for backwards compatibility
            # with older tests / callers.
            token = self.gitlab_token or self.github_token
            return GitLabStrategy(token)
        raise GitConfigError(f"Unsupported provider: {self.provider}")


def load_git_config(provider_override: Optional[str] = None) -> GitConfig:
    """Load git configuration from environment variables.

    Raises GitConfigError if required variables are missing.

    Supported providers: github, bitbucket, gitlab. The GitLab token
    is read into its own `gitlab_token` field (the historical
    `github_token`-as-gitlab-token hack is fixed); the value is also
    mirrored into `github_token` so old call sites that pass it
    through to `GitManager(github_token=...)` keep working.

    ``provider_override`` lets a caller (e.g. the per-request
    ``POST /projects/init`` body) select the provider instead of the
    ``GIT_PROVIDER`` environment variable. When provided it takes
    precedence; the env var remains the fallback so existing
    single-provider deployments are unchanged. The provider-specific
    auth token is still sourced from the environment either way.
    """
    provider = (provider_override or os.getenv("GIT_PROVIDER", "")).strip().lower()
    if not provider:
        raise GitConfigError("GIT_PROVIDER is required (set to 'github', 'bitbucket', or 'gitlab')")
    if provider not in ("github", "bitbucket", "gitlab"):
        raise GitConfigError(
            f"GIT_PROVIDER must be 'github', 'bitbucket', or 'gitlab', got '{provider}'"
        )

    default_branch = os.getenv("GIT_DEFAULT_BRANCH", "main").strip()
    auto_push = os.getenv("GIT_AUTO_PUSH", "true").strip().lower() == "true"
    auto_pr = os.getenv("GIT_AUTO_PR", "true").strip().lower() == "true"

    github_token = os.getenv("GITHUB_TOKEN", "").strip() or None
    gitlab_token = os.getenv("GITLAB_TOKEN", "").strip() or None
    bitbucket_username = os.getenv("BITBUCKET_USERNAME", "").strip() or None
    bitbucket_app_password = os.getenv("BITBUCKET_APP_PASSWORD", "").strip() or None

    # Validate auth for the chosen provider
    if provider == "github" and not github_token:
        raise GitConfigError("GITHUB_TOKEN is required when GIT_PROVIDER=github")
    if provider == "gitlab" and not gitlab_token:
        raise GitConfigError("GITLAB_TOKEN is required when GIT_PROVIDER=gitlab")
    if provider == "bitbucket":
        if not bitbucket_username:
            raise GitConfigError("BITBUCKET_USERNAME is required when GIT_PROVIDER=bitbucket")
        if not bitbucket_app_password:
            raise GitConfigError("BITBUCKET_APP_PASSWORD is required when GIT_PROVIDER=bitbucket")

    # Backwards compatibility: when provider=gitlab and only GITLAB_TOKEN
    # is set, also expose it via github_token so older callers that pass
    # `github_token=git_config.github_token` to GitManager keep working.
    effective_github_token = github_token
    if provider == "gitlab" and gitlab_token and not github_token:
        effective_github_token = gitlab_token

    config = GitConfig(
        provider=provider,
        default_branch=default_branch,
        auto_push=auto_push,
        auto_pr=auto_pr,
        github_token=effective_github_token,
        bitbucket_username=bitbucket_username,
        bitbucket_app_password=bitbucket_app_password,
        gitlab_token=gitlab_token,
    )
    logger.info("Git config loaded: provider=%s, branch=%s, auto_push=%s, auto_pr=%s",
                provider, default_branch, auto_push, auto_pr)
    return config


# ---------------------------------------------------------------------------
# Saved-project-config fallback (2026-07-27).
#
# `POST /projects/init` accepts a PER-REQUEST `git_provider` and persists it
# into each cloned repo's `<repo_dir>/.haikai/config.json` — precisely so
# later operations can run without a workspace-wide GIT_PROVIDER env var. But
# every downstream call site loaded the env-only `load_git_config()`, so a
# gitlab-initialised project 400'd with "GIT_PROVIDER is required" the moment
# the first v2 request arrived (live-confirmed on the first Stage-1
# dispatch: init 200 + "provider=gitlab" saved, then shape-spec 400).
#
# These helpers close the gap for EVERY call site (the
# helper-exists-sibling-missed doctrine): env config first — existing
# single-provider deployments are unchanged — falling back to the provider
# the init saved when the env is incomplete.
# ---------------------------------------------------------------------------

def _saved_project_provider(repo_dir: Path) -> Optional[str]:
    """Read the `provider` persisted by project init at
    `<repo_dir>/.haikai/config.json`. Tolerant: missing/malformed -> None."""
    try:
        config_path = Path(repo_dir) / ".haikai" / "config.json"
        if not config_path.exists():
            return None
        data = json.loads(config_path.read_text(encoding="utf-8"))
        provider = str(data.get("provider") or "").strip().lower()
        return provider or None
    except Exception:
        return None


def _saved_project_default_branch(repo_dir: Path) -> Optional[str]:
    """Read the `default_branch` persisted by project init. Tolerant."""
    try:
        config_path = Path(repo_dir) / ".haikai" / "config.json"
        if not config_path.exists():
            return None
        data = json.loads(config_path.read_text(encoding="utf-8"))
        branch = str(data.get("default_branch") or "").strip()
        return branch or None
    except Exception:
        return None


def load_git_config_with_project_fallback(
    candidate_repo_dirs: Iterable[Path],
) -> GitConfig:
    """Env-first git config; on an incomplete env (GitConfigError), retry
    with the provider saved by project init in the FIRST candidate repo dir
    that has one. Re-raises the ORIGINAL env error when no candidate carries
    a saved provider; raises the retry error when the saved provider itself
    cannot be satisfied (e.g. its token is missing from the env).
    """
    try:
        return load_git_config()
    except GitConfigError as env_error:
        for repo_dir in candidate_repo_dirs:
            provider = _saved_project_provider(Path(repo_dir))
            if not provider:
                continue
            config = load_git_config(provider_override=provider)
            logger.info(
                "Git config: env incomplete (%s); using provider %r saved by "
                "project init at %s",
                env_error, provider, Path(repo_dir) / ".haikai" / "config.json",
            )
            return config
        raise


def load_git_config_for_product_root(product_root: Path) -> GitConfig:
    """`load_git_config_with_project_fallback` over every repo cloned under
    the product root (any `<product_root>/*/.haikai/config.json`)."""
    candidates = sorted(
        p.parent.parent for p in Path(product_root).glob("*/.haikai/config.json")
    )
    return load_git_config_with_project_fallback(candidates)


def git_default_branch(repo_dir: Optional[Path] = None) -> str:
    """The default branch WITHOUT the provider gate — for call sites that
    only need the branch name (deploy consolidation). Order: the
    GIT_DEFAULT_BRANCH env var, else the branch saved by project init for
    `repo_dir`, else 'main'. NEVER raises."""
    env_branch = os.getenv("GIT_DEFAULT_BRANCH", "").strip()
    if env_branch:
        return env_branch
    if repo_dir is not None:
        saved = _saved_project_default_branch(repo_dir)
        if saved:
            return saved
    return "main"
