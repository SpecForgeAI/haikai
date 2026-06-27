"""Git-provider strategies — Strategy pattern replacing
`if self.provider == ...` switches in `GitManager`.

Before this module existed, `GitManager._build_authenticated_url`
and `GitManager.create_pull_request` each carried a 3-arm
if/elif/elif chain on `self.provider`. Adding a new provider was a
2-site, shotgun-surgery change; the GitLab arm reused
`github_token` (documented in `git/config.py`) which was a leaking
implementation detail.

Each strategy holds the auth credentials it actually needs. The
GitLab strategy owns its own `gitlab_token` field rather than
sharing the github one — both fields exist at the boundary
(`GitConfig`) for backwards compatibility, but inside the strategy
they're distinct.

`GitManager` builds a strategy via `GitConfig.get_provider_strategy()`
(one-time dispatch) and forwards URL-building and PR-creation calls
to it. New providers add a class here + a dispatch arm in
`GitConfig.get_provider_strategy()` — nothing else changes.

Spec: pass-3 deep-src-smells findings D-O1 (switch) and D-B3
(anemic GitConfig).
"""
from __future__ import annotations

from typing import Optional, Protocol
from urllib.parse import quote, urlparse

import httpx


class GitProviderStrategyError(Exception):
    """Raised when a strategy can't complete its operation."""
    pass


def _parse_host_path(repo_url: str) -> tuple[str, str]:
    """Extract `(host, path-without-.git)` from a repo URL."""
    parsed = urlparse(repo_url)
    host = parsed.hostname or ""
    path = parsed.path
    if path.endswith(".git"):
        path = path[:-4]
    return host, path


def _parse_owner_repo(repo_url: str) -> tuple[str, str]:
    """Extract `(owner, repo)` from a repo URL."""
    parsed = urlparse(repo_url)
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    parts = path.split("/")
    if len(parts) < 2:
        raise GitProviderStrategyError(
            f"Cannot parse owner/repo from URL: {repo_url}"
        )
    return parts[-2], parts[-1]


class GitProviderStrategy(Protocol):
    """Protocol implemented by every provider strategy.

    Strategies are stateless w.r.t. the working tree; they hold only
    the auth credentials needed to talk to the provider's API and to
    build authenticated clone URLs.
    """

    def build_authenticated_url(self, repo_url: str) -> str:
        """Return `repo_url` with credentials embedded, or the original
        URL if no credentials are set (best-effort for public repos)."""
        ...

    def create_pull_request(
        self,
        repo_url: str,
        title: str,
        branch: str,
        base_branch: str,
        body: str,
    ) -> str:
        """POST a PR to the provider's REST API. Returns the PR's web URL."""
        ...


class GitHubStrategy:
    """github.com over HTTPS with a personal-access-token."""

    def __init__(self, token: Optional[str]) -> None:
        self.token = token

    def build_authenticated_url(self, repo_url: str) -> str:
        if not self.token:
            return repo_url
        # Tokens are only meaningful for HTTPS URLs against the provider.
        # For file://, ssh://, or git@host:owner/repo shorthand, return
        # the URL unchanged — injecting a token here would either mangle
        # the URL (file://) or be meaningless (ssh has its own auth).
        if not repo_url.startswith(("https://", "http://")):
            return repo_url
        host, path = _parse_host_path(repo_url)
        # Put the token in the PASSWORD slot with a fixed username -- NOT the
        # username slot. `https://<token>@host` leaves the password empty, so git
        # prompts for one, which dies with "could not read Password ... No such
        # device or address" on `git push` in a headless container (no TTY).
        # `x-access-token:<token>` is GitHub's documented token-auth form and
        # supplies both halves, so git never prompts. (Clone of a *public* repo
        # worked before only because public reads need no auth; push does.)
        return f"https://x-access-token:{self.token}@{host}{path}.git"

    def create_pull_request(
        self,
        repo_url: str,
        title: str,
        branch: str,
        base_branch: str,
        body: str,
    ) -> str:
        owner, repo = _parse_owner_repo(repo_url)
        url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
        }
        payload = {
            "title": title,
            "head": branch,
            "base": base_branch,
            "body": body,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                return resp.json()["html_url"]
        except httpx.HTTPStatusError as e:
            detail = e.response.text[:500] if e.response.text else ""
            raise GitProviderStrategyError(
                f"GitHub API error {e.response.status_code}: {detail}"
            ) from e
        except httpx.RequestError as e:
            raise GitProviderStrategyError(
                f"GitHub API request failed: {e}"
            ) from e


class BitbucketStrategy:
    """bitbucket.org over HTTPS with username + app password."""

    def __init__(
        self, username: Optional[str], app_password: Optional[str]
    ) -> None:
        self.username = username
        self.app_password = app_password

    def build_authenticated_url(self, repo_url: str) -> str:
        if not (self.username and self.app_password):
            return repo_url
        # See GitHubStrategy.build_authenticated_url — credentials only
        # apply to HTTPS URLs; pass non-HTTP(S) through unchanged.
        if not repo_url.startswith(("https://", "http://")):
            return repo_url
        host, path = _parse_host_path(repo_url)
        return f"https://{self.username}:{self.app_password}@{host}{path}.git"

    def create_pull_request(
        self,
        repo_url: str,
        title: str,
        branch: str,
        base_branch: str,
        body: str,
    ) -> str:
        workspace, repo = _parse_owner_repo(repo_url)
        url = (
            f"https://api.bitbucket.org/2.0/repositories/"
            f"{workspace}/{repo}/pullrequests"
        )
        auth = (self.username, self.app_password)
        payload = {
            "title": title,
            "source": {"branch": {"name": branch}},
            "destination": {"branch": {"name": base_branch}},
            "description": body,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=payload, auth=auth)
                resp.raise_for_status()
                return resp.json()["links"]["html"]["href"]
        except httpx.HTTPStatusError as e:
            detail = e.response.text[:500] if e.response.text else ""
            raise GitProviderStrategyError(
                f"Bitbucket API error {e.response.status_code}: {detail}"
            ) from e
        except httpx.RequestError as e:
            raise GitProviderStrategyError(
                f"Bitbucket API request failed: {e}"
            ) from e


class GitLabStrategy:
    """gitlab.com (or self-hosted) over HTTPS with an `oauth2:<token>` scheme.

    Merge-request creation posts to `POST /api/v4/projects/:id/merge_requests`
    on the same host the repo lives on (so self-hosted instances work without
    extra config). The project id is the URL-encoded `group/name` path.
    """

    def __init__(self, token: Optional[str]) -> None:
        self.token = token

    def build_authenticated_url(self, repo_url: str) -> str:
        if not self.token:
            return repo_url
        # See GitHubStrategy.build_authenticated_url — pass non-HTTP(S)
        # URLs through unchanged.
        if not repo_url.startswith(("https://", "http://")):
            return repo_url
        parsed = urlparse(repo_url)
        path = parsed.path[:-4] if parsed.path.endswith(".git") else parsed.path
        # Preserve the ORIGINAL scheme + host:port. gitlab.com is https:443, but a
        # self-hosted GitLab may be on http and/or a non-default port — hardcoding
        # https and dropping the port (the old `https://{host}...`) broke those.
        host = parsed.hostname or ""
        netloc = f"{host}:{parsed.port}" if parsed.port else host
        return f"{parsed.scheme}://oauth2:{self.token}@{netloc}{path}.git"

    def create_pull_request(
        self,
        repo_url: str,
        title: str,
        branch: str,
        base_branch: str,
        body: str,
    ) -> str:
        if not self.token:
            raise GitProviderStrategyError(
                "GitLab merge-request creation needs a token (set GITLAB_TOKEN)."
            )
        parsed = urlparse(repo_url)
        path = parsed.path[:-4] if parsed.path.endswith(".git") else parsed.path
        project = quote(path.strip("/"), safe="")  # URL-encoded group/name path
        # Same scheme+port preservation as build_authenticated_url — hit the API on
        # the host the repo actually lives on (self-hosted http/non-443 included).
        host = parsed.hostname or ""
        netloc = f"{host}:{parsed.port}" if parsed.port else host
        url = f"{parsed.scheme}://{netloc}/api/v4/projects/{project}/merge_requests"
        headers = {"PRIVATE-TOKEN": self.token}
        payload = {
            "source_branch": branch,
            "target_branch": base_branch,
            "title": title,
            "description": body,
        }
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                return resp.json()["web_url"]
        except httpx.HTTPStatusError as e:
            detail = e.response.text[:500] if e.response.text else ""
            raise GitProviderStrategyError(
                f"GitLab API error {e.response.status_code}: {detail}"
            ) from e
        except httpx.RequestError as e:
            raise GitProviderStrategyError(
                f"GitLab API request failed: {e}"
            ) from e
