"""Shared real-git test harness — NO mocks of the git/orchestrator seams.

Factored out of `tests/integration/test_v2_orchestration_end_to_end_local_bare.py`
so de-mocked tests stay tiny. Everything here drives REAL git against a LOCAL bare
repo (zero network, zero token). The only thing any caller may stub is the LLM leg
(`stub_llm`) — there is no real Claude CLI in a test run; the stub writes REAL files
that REAL git then commits.

Helpers:
- `run_git(args, cwd)`              — a subprocess git call, raising with output on failure
- `set_git_env(monkeypatch, ...)`   — real GIT_* env + author identity (no stand-in config)
- `real_git_config(monkeypatch,...)`— set env then return a REAL GitConfig via load_git_config
- `seed_bare_remote(dir)`           — a bare repo seeded with one commit on main (a real "remote")
- `local_repo_with_base(dir)`       — a real working repo with one base commit, no remote
- `init_single_repo(...)`           — REAL clone into product_root/<folder> + coordination.yaml
- `init_polyrepo(...)`              — the same for N repos
- `branch_files(repo, branch)`      — files present on a branch (the real-effect assertion)
- `stub_llm(monkeypatch, writer)`   — the ONE allowed stand-in: replace the LLM step + executor build
"""
from __future__ import annotations

import subprocess
import types
from pathlib import Path


def file_url(path) -> str:
    """`file:///...` URL for a local repo path (passes ProjectInitRequest's URL
    validator, which accepts file:// but not bare OS paths). git clones it natively."""
    return Path(path).resolve().as_uri()


def run_git(args, cwd) -> str:
    """Run `git <args>` in `cwd`; return stdout, raising with captured output on failure."""
    proc = subprocess.run(
        ["git", *args], cwd=str(cwd),
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"git {' '.join(args)} (cwd={cwd}) failed [{proc.returncode}]:\n"
            f"{proc.stdout}\n{proc.stderr}"
        )
    return proc.stdout


def set_git_env(
    monkeypatch,
    *,
    provider: str = "github",
    token: str = "dummy-local-no-auth",
    default_branch: str = "main",
    auto_push: bool = True,
    auto_pr: bool = False,
) -> None:
    """Configure git via REAL env vars (so `load_git_config()` returns the real thing).

    `token` is never used against a local-path remote (provider_strategy leaves
    non-http(s) URLs untouched). `auto_pr` defaults False: a PR creation would hit
    the provider REST API, which is the one thing a local bare repo can't serve.
    """
    monkeypatch.setenv("GIT_PROVIDER", provider)
    monkeypatch.setenv("GITHUB_TOKEN", token)
    monkeypatch.setenv("GIT_DEFAULT_BRANCH", default_branch)
    monkeypatch.setenv("GIT_AUTO_PUSH", "true" if auto_push else "false")
    monkeypatch.setenv("GIT_AUTO_PR", "true" if auto_pr else "false")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Test Bot")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "test@example.com")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "Test Bot")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "test@example.com")


def real_git_config(monkeypatch, **kw):
    """Set env then return a REAL GitConfig (no SimpleNamespace stand-in, no patch)."""
    set_git_env(monkeypatch, **kw)
    from src.git.config import load_git_config
    return load_git_config()


def seed_bare_remote(parent: Path, name: str = "remote.git") -> Path:
    """Create a bare repo seeded with one commit on `main` — a realistic remote."""
    bare = parent / name
    seed = parent / f"{name}.seed"
    run_git(["init", "--bare", "--initial-branch=main", str(bare)], cwd=parent)
    run_git(["init", "--initial-branch=main", str(seed)], cwd=parent)
    (seed / "README.md").write_text("# seed\n", encoding="utf-8")
    run_git(["add", "-A"], cwd=seed)
    run_git(["-c", "user.email=t@e.co", "-c", "user.name=t", "commit", "-m", "seed"], cwd=seed)
    run_git(["remote", "add", "origin", str(bare)], cwd=seed)
    run_git(["push", "origin", "main"], cwd=seed)
    return bare


def local_repo_with_base(repo_dir: Path, branch: str = "main") -> Path:
    """A real working git repo with one base commit and no remote (auto_push=False tests)."""
    repo_dir.mkdir(parents=True, exist_ok=True)
    run_git(["init", "-q", "-b", branch, str(repo_dir)], cwd=repo_dir.parent)
    (repo_dir / "base.txt").write_text("base\n", encoding="utf-8")
    run_git(["add", "-A"], cwd=repo_dir)
    run_git(["-c", "user.email=t@e.co", "-c", "user.name=t", "commit", "-qm", "init"], cwd=repo_dir)
    return repo_dir


def init_single_repo(workspace: Path, company: str, project: str, folder: str, remote: Path) -> Path:
    """Init the way POST /projects/init does: REAL clone into product_root/<folder>
    + coordination.yaml at the product root. Returns the repo dir."""
    return init_polyrepo(workspace, company, project, {folder: remote})[folder]


def init_polyrepo(workspace: Path, company: str, project: str, remotes: dict) -> dict:
    """REAL clone of each `{folder: remote}` into product_root/<folder>, then write
    coordination.yaml. Returns `{folder: repo_dir}`."""
    from src.git.git_manager import GitManager
    from src.git.coordination import write_coordination

    product_root = (workspace / company / project).resolve()
    product_root.mkdir(parents=True, exist_ok=True)
    repo_dirs = {}
    for folder, remote in remotes.items():
        repo_dir = product_root / folder
        GitManager(
            project_dir=repo_dir, provider="github",
            default_branch="main", github_token="dummy-local-no-auth",
        ).init_project(str(remote))
        repo_dirs[folder] = repo_dir
    write_coordination(product_root, {f: str(r) for f, r in remotes.items()})
    return repo_dirs


def branch_files(repo: Path, branch: str) -> list:
    """Files tracked on `branch` (works on a working repo or a bare remote)."""
    return run_git(["ls-tree", "-r", "--name-only", branch], cwd=repo).split()


def stub_llm(monkeypatch, writer):
    """The ONE allowed stand-in: replace the LLM step + chat-executor build.

    `writer(self, step, command, spec_name, repo_dir_hint)` is called per step and
    should write any REAL files the subsequent REAL git commit must capture. There is
    no real Claude CLI in a test run, so this is a stand-in, not a seam mock — every
    git op around it stays real.
    """
    import src.haikai_orchestrator as orch_mod
    from src.haikai_orchestrator import HaikaiOrchestrator
    from src.haikai_models import StepResult

    def _step(self, chat_executor, step, command, spec_name):
        writer(self, step, command, spec_name)
        return StepResult(
            step=step, command=command, status="success",
            output_paths=[], execution_time_seconds=0.0, log_file="stub.log",
        )

    monkeypatch.setattr(HaikaiOrchestrator, "_execute_step_with_session", _step)
    monkeypatch.setattr(
        orch_mod, "_build_chat_executor",
        lambda **kw: types.SimpleNamespace(session_uuid=kw.get("session_uuid") or "sess"),
    )
