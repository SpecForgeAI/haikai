"""
Integration tests for prepare_for_commit() using real git operations.

No mocks — creates actual git repos, runs real git commands, verifies real outcomes.
"""

import subprocess
import pytest
from pathlib import Path


@pytest.fixture
def git_repo(tmp_path):
    """Create a real git repository with an initial commit."""
    repo = tmp_path / "project"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=repo, capture_output=True)

    # Initial commit so we have a HEAD
    (repo / "README.md").write_text("# Test Project\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=repo, capture_output=True)

    return repo


def _tracked_files(repo: Path) -> set:
    """Get the set of files tracked by git."""
    result = subprocess.run(
        ["git", "ls-files"], cwd=repo, capture_output=True, text=True
    )
    return set(result.stdout.strip().splitlines())


def _committed_files(repo: Path) -> set:
    """Get files in the latest commit."""
    result = subprocess.run(
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
        cwd=repo, capture_output=True, text=True,
    )
    return set(result.stdout.strip().splitlines())


class TestNodeModulesScenario:
    """The real incident: node_modules exists, commit_all should not stage it."""

    def test_node_modules_excluded_from_commit(self, git_repo):
        """node_modules/ is excluded even when no .gitignore existed before."""
        from src.git.git_manager import GitManager

        # Simulate npm install creating node_modules
        nm = git_repo / "node_modules" / "express"
        nm.mkdir(parents=True)
        (nm / "package.json").write_text('{"name": "express"}')
        (nm / "index.js").write_text("module.exports = {}")

        # Also add real project files
        (git_repo / "src").mkdir()
        (git_repo / "src" / "app.js").write_text("console.log('hello')")

        gm = GitManager(project_dir=git_repo)
        sha = gm.commit_all("feature: add app")

        assert sha, "Should have committed something"

        tracked = _tracked_files(git_repo)
        assert "src/app.js" in tracked
        assert not any("node_modules" in f for f in tracked), \
            f"node_modules should NOT be tracked. Tracked files: {tracked}"

    def test_gitignore_created_with_critical_patterns(self, git_repo):
        """commit_all creates .gitignore with all critical patterns."""
        from src.git.git_manager import GitManager

        (git_repo / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        gitignore = git_repo / ".gitignore"
        assert gitignore.exists()
        content = gitignore.read_text()
        assert "node_modules/" in content
        assert "__pycache__/" in content
        assert ".env" in content
        assert "!package-lock.json" in content


class TestEnvFileScenario:
    """Secrets in .env files should not be committed."""

    def test_env_file_excluded_from_commit(self, git_repo):
        """A .env file with secrets is not committed."""
        from src.git.git_manager import GitManager

        (git_repo / ".env").write_text("OPENAI_API_KEY=sk-proj-abc123\nDB_HOST=localhost\n")
        (git_repo / ".env.example").write_text("OPENAI_API_KEY=\nDB_HOST=\n")
        (git_repo / "app.py").write_text("import os\n")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        tracked = _tracked_files(git_repo)
        assert "app.py" in tracked
        assert ".env" not in tracked, f".env should NOT be tracked. Tracked: {tracked}"
        # .env.example SHOULD be tracked (allowlisted via !.env.example)
        assert ".env.example" in tracked


class TestExistingGitignoreScenario:
    """Project already has a .gitignore — we append, never clobber."""

    def test_appends_without_clobbering(self, git_repo):
        """Existing .gitignore content is preserved, missing patterns appended."""
        from src.git.git_manager import GitManager

        # User's existing .gitignore
        (git_repo / ".gitignore").write_text("# My project\n*.tmp\nlogs/\n")
        subprocess.run(["git", "add", ".gitignore"], cwd=git_repo, capture_output=True)
        subprocess.run(["git", "commit", "-m", "add gitignore"], cwd=git_repo, capture_output=True)

        (git_repo / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        content = (git_repo / ".gitignore").read_text()
        # Original content preserved
        assert "# My project" in content
        assert "*.tmp" in content
        assert "logs/" in content
        # Critical patterns appended
        assert "node_modules/" in content
        assert "# --- Added by Haikai ---" in content

    def test_existing_gitignore_with_node_modules_no_duplicate(self, git_repo):
        """If .gitignore already has node_modules/, don't add it again."""
        from src.git.git_manager import GitManager

        (git_repo / ".gitignore").write_text("node_modules/\n")
        subprocess.run(["git", "add", ".gitignore"], cwd=git_repo, capture_output=True)
        subprocess.run(["git", "commit", "-m", "add gitignore"], cwd=git_repo, capture_output=True)

        (git_repo / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        content = (git_repo / ".gitignore").read_text()
        assert content.count("node_modules/") == 1


class TestStaleLockScenario:
    """Stale index.lock from a previous crashed git operation."""

    def test_stale_lock_removed_and_commit_succeeds(self, git_repo):
        """commit_all succeeds even with a stale index.lock present."""
        from src.git.git_manager import GitManager

        # Simulate stale lock from a crashed git process
        lock = git_repo / ".git" / "index.lock"
        lock.write_text("stale lock")

        (git_repo / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        sha = gm.commit_all("add app")

        assert sha, "Commit should succeed after lock removal"
        assert not lock.exists(), "Lock file should be removed"


class TestAlreadyTrackedFilesScenario:
    """Files that were already tracked before .gitignore was updated."""

    def test_previously_tracked_env_gets_unstaged(self, git_repo):
        """.env committed before prepare_for_commit existed gets unstaged."""
        from src.git.git_manager import GitManager

        # Commit .env before any .gitignore
        (git_repo / ".env").write_text("SECRET=abc123\n")
        subprocess.run(["git", "add", "-A"], cwd=git_repo, capture_output=True)
        subprocess.run(["git", "commit", "-m", "oops committed .env"], cwd=git_repo, capture_output=True)

        # Verify .env is tracked
        assert ".env" in _tracked_files(git_repo)

        # Now make a new change and commit via GitManager
        (git_repo / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        # .env should be unstaged now
        tracked = _tracked_files(git_repo)
        assert ".env" not in tracked, f".env should be unstaged. Tracked: {tracked}"


class TestBuildOutputScenario:
    """Build output directories present in workspace."""

    def test_pycache_excluded(self, git_repo):
        """__pycache__/ directories are not committed."""
        from src.git.git_manager import GitManager

        pycache = git_repo / "src" / "__pycache__"
        pycache.mkdir(parents=True)
        (pycache / "app.cpython-312.pyc").write_bytes(b"\x00" * 100)
        (git_repo / "src" / "app.py").write_text("print('hello')")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        tracked = _tracked_files(git_repo)
        assert "src/app.py" in tracked
        assert not any("__pycache__" in f for f in tracked)

    def test_dist_excluded(self, git_repo):
        """dist/ build output is not committed."""
        from src.git.git_manager import GitManager

        dist = git_repo / "dist"
        dist.mkdir()
        (dist / "bundle.js").write_text("// compiled")
        (git_repo / "src").mkdir(exist_ok=True)
        (git_repo / "src" / "index.ts").write_text("export default {}")

        gm = GitManager(project_dir=git_repo)
        gm.commit_all("add app")

        tracked = _tracked_files(git_repo)
        assert not any("dist/" in f for f in tracked)


class TestIdempotency:
    """Running commit_all multiple times shouldn't cause issues."""

    def test_multiple_commits_no_gitignore_duplication(self, git_repo):
        """Running commit_all 3 times doesn't duplicate .gitignore patterns."""
        from src.git.git_manager import GitManager

        gm = GitManager(project_dir=git_repo)

        (git_repo / "file1.py").write_text("# v1")
        gm.commit_all("commit 1")

        (git_repo / "file2.py").write_text("# v2")
        gm.commit_all("commit 2")

        (git_repo / "file3.py").write_text("# v3")
        gm.commit_all("commit 3")

        content = (git_repo / ".gitignore").read_text()
        assert content.count("node_modules/") == 1
        assert content.count("# --- Added by Haikai ---") == 1
