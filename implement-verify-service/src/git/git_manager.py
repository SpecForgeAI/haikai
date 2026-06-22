"""
Git Manager for Haikai version control integration.

Handles project initialization (brownfield/greenfield), feature branching,
committing, pushing, and PR creation for GitHub and Bitbucket.
"""

import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from .provider_strategy import (
    BitbucketStrategy,
    GitHubStrategy,
    GitLabStrategy,
    GitProviderStrategy,
    GitProviderStrategyError,
)

logger = logging.getLogger(__name__)


class GitManagerError(Exception):
    """Base exception for GitManager operations."""
    pass


def _build_strategy_from_creds(
    provider: str,
    github_token: Optional[str],
    bitbucket_username: Optional[str],
    bitbucket_app_password: Optional[str],
    gitlab_token: Optional[str],
) -> GitProviderStrategy:
    """Construct a provider strategy from the loose constructor args
    `GitManager.__init__` accepts. Kept here (not on `GitConfig`) so
    callers that build `GitManager` without a `GitConfig` (notably
    the tests in `tests/test_git_manager.py`) still get the strategy.
    """
    if provider == "github":
        return GitHubStrategy(github_token)
    if provider == "bitbucket":
        return BitbucketStrategy(bitbucket_username, bitbucket_app_password)
    if provider == "gitlab":
        return GitLabStrategy(gitlab_token or github_token)
    raise GitManagerError(f"Unsupported provider: {provider}")


class GitManager:
    """Manages git operations for a project workspace."""

    def __init__(
        self,
        project_dir: Path,
        provider: str = "github",
        default_branch: str = "main",
        github_token: Optional[str] = None,
        bitbucket_username: Optional[str] = None,
        bitbucket_app_password: Optional[str] = None,
        gitlab_token: Optional[str] = None,
    ):
        self.project_dir = Path(project_dir)
        self.provider = provider
        self.default_branch = default_branch
        self.github_token = github_token
        self.bitbucket_username = bitbucket_username
        self.bitbucket_app_password = bitbucket_app_password
        self.gitlab_token = gitlab_token

        # Strategy carries only the credentials the provider actually
        # needs. Selection is the one-shot dispatch documented in
        # `GitConfig.get_provider_strategy`; per-call code paths never
        # branch on `self.provider` again.
        self._strategy: GitProviderStrategy = _build_strategy_from_creds(
            provider=provider,
            github_token=github_token,
            bitbucket_username=bitbucket_username,
            bitbucket_app_password=bitbucket_app_password,
            gitlab_token=gitlab_token,
        )

        logger.info(
            "GitManager initialized: project_dir=%s, provider=%s, branch=%s",
            self.project_dir, self.provider, self.default_branch,
        )

    # ------------------------------------------------------------------
    # Project Initialization
    # ------------------------------------------------------------------

    def init_project(self, repo_url: str) -> str:
        """Initialize a project from a repo URL.

        - If .git/ already exists, raise error (one-off operation).
        - If remote has content (brownfield): clone into project_dir.
        - If remote is empty (greenfield): git init, scaffold, commit, push.

        Returns:
            "brownfield" or "greenfield" indicating the init mode.
        """
        if (self.project_dir / ".git").exists():
            raise GitManagerError(
                f"Project already initialized at {self.project_dir}"
            )

        self.project_dir.mkdir(parents=True, exist_ok=True)

        auth_url = self._build_authenticated_url(repo_url)

        # Check if remote exists and has content
        has_content = self._remote_has_content(auth_url)

        if has_content:
            mode = self._init_brownfield(auth_url)
        else:
            mode = self._init_greenfield(auth_url, repo_url)

        # Persist project config
        self._save_config(repo_url)

        logger.info("Project initialized: mode=%s, dir=%s", mode, self.project_dir)
        return mode

    def _remote_has_content(self, auth_url: str) -> bool:
        """Check if remote repo exists and has commits."""
        # `--` separates options from positional args so a hostile auth_url
        # starting with `-` can't be smuggled as a git option.
        result = self._run_git(
            ["git", "ls-remote", "--heads", "--", auth_url],
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "not found" in stderr.lower() or "repository not found" in stderr.lower():
                raise GitManagerError(f"Repository not found or unreachable: {stderr}")
            if "authentication" in stderr.lower() or "403" in stderr or "401" in stderr:
                raise GitManagerError(f"Authentication failed: {stderr}")
            raise GitManagerError(f"Cannot reach remote repository: {stderr}")
        return bool(result.stdout.strip())

    def _init_brownfield(self, auth_url: str) -> str:
        """Clone an existing repo into project_dir."""
        # `--` blocks argv-injection via a hostile auth_url starting with `-`.
        self._run_git(["git", "clone", "--", auth_url, "."], check=True)
        self._run_git(["git", "checkout", self.default_branch], check=False)
        logger.info("Brownfield clone complete")
        return "brownfield"

    def _init_greenfield(self, auth_url: str, repo_url: str) -> str:
        """Initialize a new repo with scaffold and push."""
        self._run_git(["git", "init"], check=True)
        self._run_git(
            ["git", "remote", "add", "origin", auth_url], check=True
        )

        # Create scaffold
        readme = self.project_dir / "README.md"
        readme.write_text(
            f"# {self.project_dir.name}\n\nProject initialized by Haikai.\n",
            encoding="utf-8",
        )
        haikai_dir = self.project_dir / "haikai"
        haikai_dir.mkdir(exist_ok=True)
        (haikai_dir / ".gitkeep").touch()

        self._run_git(["git", "add", "-A"], check=True)
        self._run_git(
            ["git", "commit", "-m", "Initial scaffold"], check=True
        )
        self._run_git(
            ["git", "branch", "-M", self.default_branch], check=True
        )
        self._run_git(
            ["git", "push", "-u", "origin", self.default_branch], check=True
        )
        logger.info("Greenfield init + push complete")
        return "greenfield"

    # ------------------------------------------------------------------
    # State Checks
    # ------------------------------------------------------------------

    def ensure_initialized(self) -> bool:
        """Return True if project_dir is an initialized project.

        Two valid init shapes:
          * Legacy single-repo: ``project_dir/.git`` exists (the project_dir
            IS the cloned git repo).
          * Polyrepo product root: ``project_dir/coordination.yaml`` exists
            (the project_dir is a product root containing N cloned repos
            as subdirs; each subdir has its own ``.git/``).

        The polyrepo branch was shipping with V2 endpoint gates that
        rejected polyrepo-initialized projects because this check only
        recognized the legacy single-repo shape. See
        ``haikai/specs/2026-05-27-od2-empirical-test/findings.md`` for
        the empirical trial that surfaced it.

        Note: in polyrepo mode the returned GitManager points at the
        product root (NOT a git repo). Downstream callers that invoke
        ``gm.pull_latest()`` / ``gm.create_feature_branch()`` directly on
        the returned manager will still crash — those need per-repo gms
        from the coordination map. This change only unblocks the gate.
        """
        if (self.project_dir / ".git").exists():
            return True
        # Polyrepo: presence of coordination.yaml at the product root
        # signals a valid (multi-repo) init. We don't parse the file
        # here — read_coordination would raise on a malformed one, but
        # the gate only needs the existence check.
        return (self.project_dir / "coordination.yaml").exists()

    def load_config(self) -> dict:
        """Load .haikai/config.json from the project directory."""
        config_path = self.project_dir / ".haikai" / "config.json"
        if not config_path.exists():
            raise GitManagerError(f"Project config not found: {config_path}")
        return json.loads(config_path.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------
    # Branch & Commit Operations
    # ------------------------------------------------------------------

    def pull_latest(self):
        """Pull latest from default branch. Called before shape-spec."""
        self._run_git(["git", "checkout", self.default_branch], check=True)
        self._run_git(
            ["git", "pull", "origin", self.default_branch], check=True
        )
        logger.info("Pulled latest from %s", self.default_branch)

    def create_feature_branch(self, branch_name: str) -> str:
        """Create and checkout a feature branch. Switches to it if it already exists."""
        # Use `git show-ref --verify --quiet refs/heads/<branch>` for an exact
        # branch lookup. Avoids the prior `git branch --list <branch>` pattern
        # which (a) treats glob chars in branch_name as wildcards and (b) only
        # checked substring presence in stdout — both could misfire on names
        # like "feature*" or single-letter names.
        check = self._run_git(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch_name}"],
            check=False,
        )
        if check.returncode == 0:
            self._run_git(["git", "checkout", branch_name], check=True)
            logger.info("Switched to existing feature branch: %s", branch_name)
        else:
            self._run_git(["git", "checkout", self.default_branch], check=True)
            self._run_git(["git", "checkout", "-b", branch_name], check=True)
            logger.info("Created feature branch: %s", branch_name)
        return branch_name

    # ------------------------------------------------------------------
    # Commit Preparation
    # ------------------------------------------------------------------

    HAIKAI_MARKER = "# --- Added by Haikai ---"

    @staticmethod
    def _load_gitignore_patterns() -> list[str]:
        """Load critical .gitignore patterns from gitignore_patterns.yml.

        Returns a flat list of patterns with category comments, suitable
        for writing directly into a .gitignore file.
        """
        import yaml

        patterns_file = Path(__file__).parent / "gitignore_patterns.yml"
        data = yaml.safe_load(patterns_file.read_text(encoding="utf-8"))

        lines: list[str] = []
        for category, patterns in data.items():
            heading = category.replace("_", " ").title()
            lines.append(f"# {heading}")
            lines.extend(patterns)
            lines.append("")
        return lines

    def prepare_for_commit(self):
        """Prepare working tree for a clean commit.

        1. Remove stale .git/index.lock
        2. Ensure .gitignore has critical patterns
        3. Unstage any newly-ignored tracked files

        Called automatically by commit_all() before staging.
        Makes no network calls and no LLM calls.
        """
        # 1. Remove stale index.lock
        index_lock = self.project_dir / ".git" / "index.lock"
        if index_lock.exists():
            try:
                index_lock.unlink()
                logger.warning("Removed stale .git/index.lock")
            except OSError as e:
                logger.warning("Could not remove index.lock: %s", e)

        # 2. Ensure .gitignore has critical patterns
        gitignore_path = self.project_dir / ".gitignore"
        gitignore_updated = False
        critical_patterns = self._load_gitignore_patterns()

        if not gitignore_path.exists():
            # Create new .gitignore with full template
            lines = [self.HAIKAI_MARKER] + critical_patterns
            gitignore_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            gitignore_updated = True
            logger.info("Created .gitignore with critical patterns")
        else:
            # Append missing critical patterns
            existing = gitignore_path.read_text(encoding="utf-8")
            existing_lines = set(existing.splitlines())

            missing = []
            for pattern in critical_patterns:
                # Skip empty lines and comments for matching
                if not pattern or pattern.startswith("#"):
                    continue
                if pattern not in existing_lines:
                    missing.append(pattern)

            if missing and self.HAIKAI_MARKER not in existing:
                # First time appending — add marker + all missing
                append_block = "\n\n" + self.HAIKAI_MARKER + "\n" + "\n".join(missing) + "\n"
                gitignore_path.write_text(existing + append_block, encoding="utf-8")
                gitignore_updated = True
                logger.info("Appended %d missing patterns to .gitignore", len(missing))
            elif missing:
                # Marker exists — append only new missing patterns after it
                append_block = "\n".join(missing) + "\n"
                gitignore_path.write_text(existing + append_block, encoding="utf-8")
                gitignore_updated = True
                logger.info("Appended %d additional patterns to .gitignore", len(missing))

        # 3. Unstage tracked files that are now ignored
        # Use `git ls-files -ci --exclude-standard` to find tracked files
        # that match gitignore rules, then selectively unstage only those.
        if gitignore_updated:
            result = self._run_git(
                ["git", "ls-files", "-ci", "--exclude-standard"],
                check=False,
            )
            ignored_tracked = [
                f.strip() for f in (result.stdout or "").splitlines() if f.strip()
            ]
            if ignored_tracked:
                # Unstage only the files that are now ignored
                self._run_git(
                    ["git", "rm", "-r", "--cached", "--ignore-unmatch"] + ignored_tracked,
                    check=False,
                )
                logger.info("Unstaged %d newly-ignored files from index: %s",
                            len(ignored_tracked), ignored_tracked[:5])

    def commit_all(self, message: str) -> str:
        """Stage all changes and commit. Returns commit SHA."""
        self.prepare_for_commit()
        self._run_git(["git", "add", "-A"], check=True, timeout=300)

        # Check if there's anything to commit
        status = self._run_git(
            ["git", "status", "--porcelain"], check=True
        )
        if not status.stdout.strip():
            logger.info("Nothing to commit")
            return ""

        self._run_git(["git", "commit", "-m", message], check=True)

        # Get commit SHA
        result = self._run_git(
            ["git", "rev-parse", "HEAD"], check=True
        )
        sha = result.stdout.strip()
        logger.info("Committed: %s (%s)", message, sha[:8])
        return sha

    def push_branch(self, branch: str):
        """Push branch to origin (refreshing the authenticated remote first)."""
        self._refresh_origin_auth_url()
        self._run_git(
            ["git", "push", "origin", branch], check=True
        )
        logger.info("Pushed branch: %s", branch)

    def _refresh_origin_auth_url(self) -> None:
        """Rewrite `origin` to the current authenticated URL before pushing.

        Existing clones can carry a stale/legacy auth URL -- e.g. a token in the
        username slot with no password (``https://<token>@host``), which makes git
        prompt for a password and fail in a headless container (no TTY). The fix
        in the provider strategy only takes effect at *clone* time, so repos
        cloned earlier stay broken. ``_build_authenticated_url`` is idempotent
        (host/path come from ``urlparse``, which ignores embedded credentials and
        strips ``.git``), so re-deriving from the current origin and updating it
        self-heals the remote regardless of when the repo was cloned.

        Best-effort: a missing origin or a non-https remote (ssh/file, which the
        strategy leaves alone) is left untouched, and a failed rewrite never
        blocks the push attempt itself.
        """
        result = self._run_git(["git", "remote", "get-url", "origin"], check=False)
        if result.returncode != 0:
            return
        current = result.stdout.strip()
        if not current.startswith(("https://", "http://")):
            return
        refreshed = self._build_authenticated_url(current)
        if refreshed and refreshed != current:
            self._run_git(
                ["git", "remote", "set-url", "origin", refreshed], check=False
            )

    def checkout_default_branch(self) -> bool:
        """Check out the configured default branch (`self.default_branch`).

        Returns True on success, False otherwise. Best-effort —
        non-raising — because per-spec loops in V2 endpoints call this
        between iterations only to leave the working tree on a known
        branch; failure shouldn't poison the whole batch. Replaces the
        previous `gm._run_git(["git", "checkout", gm.default_branch],
        check=False)` callers in `routes/orchestration.py` and
        `job_queue/tasks.py` (deep-src-smells finding D-D3).
        """
        try:
            self._run_git(
                ["git", "checkout", self.default_branch], check=False
            )
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Pull Request Creation
    # ------------------------------------------------------------------

    def create_pull_request(
        self, title: str, branch: str, body: str
    ) -> str:
        """Create a PR via the provider's REST API. Returns the PR's web URL."""
        config = self.load_config()
        try:
            pr_url = self._strategy.create_pull_request(
                repo_url=config["repo_url"],
                title=title,
                branch=branch,
                base_branch=self.default_branch,
                body=body,
            )
        except GitProviderStrategyError as e:
            raise GitManagerError(str(e)) from e
        logger.info("%s PR created: %s", self.provider.title(), pr_url)
        return pr_url

    # ------------------------------------------------------------------
    # Internal Helpers
    # ------------------------------------------------------------------

    def _build_authenticated_url(self, repo_url: str) -> str:
        """Build an authenticated git URL from a plain repo URL.

        Delegates to the provider strategy; falls back to the plain
        URL when no credentials are configured (best-effort for
        public repos).
        """
        return self._strategy.build_authenticated_url(repo_url)

    def _parse_owner_repo(self, repo_url: str) -> tuple:
        """Extract (owner, repo) from a repo URL."""
        parsed = urlparse(repo_url)
        path = parsed.path.strip("/")
        if path.endswith(".git"):
            path = path[:-4]
        parts = path.split("/")
        if len(parts) < 2:
            raise GitManagerError(f"Cannot parse owner/repo from URL: {repo_url}")
        return parts[-2], parts[-1]

    def _save_config(self, repo_url: str):
        """Persist project config to .haikai/config.json."""
        config_dir = self.project_dir / ".haikai"
        config_dir.mkdir(parents=True, exist_ok=True)
        config = {
            "repo_url": repo_url,
            "provider": self.provider,
            "default_branch": self.default_branch,
            "initialized_at": datetime.now(timezone.utc).isoformat(),
        }
        (config_dir / "config.json").write_text(
            json.dumps(config, indent=2), encoding="utf-8"
        )
        logger.info("Saved project config: %s", config_dir / "config.json")

    def _run_git(self, cmd: list, check: bool = True, timeout: int = 120) -> subprocess.CompletedProcess:
        """Run a git command in the project directory."""
        logger.debug("git cmd: %s", " ".join(cmd))
        # encoding="utf-8" with errors="replace": git output (commit messages,
        # filenames) may contain UTF-8 that the Windows default cp1252 codec
        # can't decode. Without this, _run_git crashes on non-ASCII repos.
        result = subprocess.run(
            cmd,
            cwd=self.project_dir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if check and result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip()
            raise GitManagerError(
                f"Git command failed: {' '.join(cmd)}\n{error_msg}"
            )
        return result
