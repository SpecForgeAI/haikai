"""Parallel-worktrees S3 — allocator module (D2/D4/D14, W3/W5/W8).

REAL git repos in tmp dirs; zero-leftover L1 parity asserted via
`git worktree list`.
"""

import subprocess
from pathlib import Path

import pytest

from src.git import worktree_runs as wr
from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage


def _run(cwd, *args):
    cp = subprocess.run(["git", "-C", str(cwd), *args],
                        capture_output=True, text=True)
    assert cp.returncode == 0, cp.stderr
    return cp.stdout


@pytest.fixture
def live_repo(tmp_path):
    repo = tmp_path / "live"
    repo.mkdir()
    _run(repo, "init", "-b", "main")
    _run(repo, "config", "user.email", "t@t")
    _run(repo, "config", "user.name", "t")
    (repo / "a.txt").write_text("a")
    _run(repo, "add", "-A")
    _run(repo, "commit", "-m", "init")
    return repo


def _worktree_names(repo):
    out = _run(repo, "worktree", "list", "--porcelain")
    return [l.split(" ", 1)[1] for l in out.splitlines() if l.startswith("worktree ")]


def test_add_worktree_creates_branch_when_absent(live_repo, tmp_path):
    wt = tmp_path / "wt1"
    wr.add_worktree(live_repo, wt, "feature/x", "main", job_id="j1")
    assert (wt / "a.txt").exists()
    assert "feature/x" in _run(wt, "branch", "--show-current")


def test_add_worktree_reuses_free_existing_branch(live_repo, tmp_path):
    wt1 = tmp_path / "wt1"
    wr.add_worktree(live_repo, wt1, "feature/x", "main")
    (wt1 / "b.txt").write_text("b")
    _run(wt1, "add", "-A")
    _run(wt1, "commit", "-m", "work")
    wr.remove_worktree(live_repo, wt1)  # branch survives, now free
    wt2 = tmp_path / "wt2"
    wr.add_worktree(live_repo, wt2, "feature/x", "main")
    assert (wt2 / "b.txt").exists()  # attached to EXISTING branch, not re-created


def test_add_worktree_fails_clearly_when_branch_active_elsewhere(live_repo, tmp_path):
    wr.add_worktree(live_repo, tmp_path / "wt1", "feature/x", "main", job_id="run-A")
    with pytest.raises(wr.WorktreeAllocationError, match="active in another worktree"):
        wr.add_worktree(live_repo, tmp_path / "wt2", "feature/x", "main", job_id="run-B")


def test_add_worktree_refuses_submodule_repos(live_repo, tmp_path):
    (live_repo / ".gitmodules").write_text("[submodule]")
    with pytest.raises(wr.WorktreeAllocationError, match="submodules"):
        wr.add_worktree(live_repo, tmp_path / "wt", "feature/x", "main")


def test_create_branch_in_worktree_never_touches_default(live_repo, tmp_path):
    """The git_manager two-step crash: checkout <default> fails in a linked
    worktree because the live checkout holds it. Single-command creation
    must succeed with main still checked out in the live repo."""
    wt = tmp_path / "wt"
    wr.add_worktree(live_repo, wt, None, "main")  # detached
    wr.create_branch_in_worktree(wt, "feature/y", "main")
    assert "feature/y" in _run(wt, "branch", "--show-current")
    assert "main" in _run(live_repo, "branch", "--show-current")
    wr.detach_to(wt, "main")
    assert _run(wt, "branch", "--show-current").strip() == ""


def test_seed_run_root_scoped_and_fail_fast(tmp_path):
    product = tmp_path / "product"
    (product / "haikai" / "specs" / "spec-a" / "planning").mkdir(parents=True)
    (product / "haikai" / "specs" / "spec-a" / "planning" / "requirements.md").write_text("r")
    (product / "haikai" / "specs" / "OTHER" / "planning").mkdir(parents=True)
    (product / "coordination.yaml").write_text("c")
    (product / ".claude").mkdir()
    (product / ".claude" / "active_session.json").write_text("{}")
    dest = tmp_path / "dest"
    seeded = wr.seed_run_root(product, dest, ["spec-a"])
    assert (dest / "haikai" / "specs" / "spec-a" / "planning" / "requirements.md").exists()
    assert not (dest / "haikai" / "specs" / "OTHER").exists()  # SCOPED copy
    assert "coordination.yaml" in seeded and ".claude/active_session.json" in seeded
    with pytest.raises(wr.WorktreeAllocationError, match="shape-spec"):
        wr.seed_run_root(product, dest, ["missing-spec"])


def test_transplant_session_dir_copies_directory_verbatim(tmp_path):
    home = tmp_path / "projects"
    old_dir, new_dir = r"C:\ws\acme\app", r"C:\ws\wt\abc12345"
    src = home / wr.encode_project_dir(old_dir)
    (src / "subagents").mkdir(parents=True)
    (src / "s.jsonl").write_text("line")
    (src / "subagents" / "x.jsonl").write_text("side")
    dst = wr.transplant_session_dir(old_dir, new_dir, claude_home=home)
    assert dst == home / wr.encode_project_dir(new_dir)
    assert (dst / "s.jsonl").read_text() == "line"
    assert (dst / "subagents" / "x.jsonl").exists()  # sidecars travel


def test_sha256_tree_detects_tamper(tmp_path):
    (tmp_path / "planning").mkdir()
    f = tmp_path / "planning" / "requirements.md"
    f.write_text("fix urllib3")
    h1 = wr.sha256_tree(tmp_path, ["planning/requirements.md"])
    f.write_text("TAMPERED")
    assert wr.sha256_tree(tmp_path, ["planning/requirements.md"]) != h1


def test_remove_worktree_zero_leftover(live_repo, tmp_path):
    wt = tmp_path / "wt"
    wr.add_worktree(live_repo, wt, "feature/x", "main", job_id="j1")
    assert len(_worktree_names(live_repo)) == 2
    wr.remove_worktree(live_repo, wt)
    assert len(_worktree_names(live_repo)) == 1  # L1: no leftover registration
    assert not wt.exists()


def test_reclaim_allowed_predicate(tmp_path):
    storage = JobStorage(str(tmp_path / "jobs.db"))
    running = Job(type=JobType.ORCHESTRATION, company="a", project="p",
                  request_payload={}, status=JobStatus.RUNNING)
    storage.save_job(running)
    ok, why = wr.reclaim_allowed(running, storage)
    assert not ok and "not terminal" in why
    cancelling = running.model_copy(update={"status": JobStatus.CANCELLING})
    assert not wr.reclaim_allowed(cancelling, storage)[0]
    resumable = running.model_copy(update={"status": JobStatus.QUEUED_FOR_RESUME,
                                           "resume_from_step": 2})
    assert not wr.reclaim_allowed(resumable, storage)[0]
    done = Job(type=JobType.ORCHESTRATION, company="a", project="p",
               request_payload={}, status=JobStatus.COMPLETED)
    storage.save_job(done)
    assert wr.reclaim_allowed(done, storage)[0]
    # terminal but heartbeat FRESH (live cancelled process) → protected
    storage.beat(done.job_id)
    ok, why = wr.reclaim_allowed(done, storage)
    assert not ok and "heartbeat fresh" in why


def test_sweep_respects_predicate_and_ttl(live_repo, tmp_path):
    ws = tmp_path / "ws"
    storage = JobStorage(str(tmp_path / "jobs.db"))
    # protected run: RUNNING job owning wt/<id8>
    prot = Job(type=JobType.ORCHESTRATION, company="a", project="p",
               request_payload={}, status=JobStatus.RUNNING)
    prot_root = wr.run_root(str(ws), prot.job_id)
    wr.add_worktree(live_repo, prot_root / "repo", "feature/prot", "main")
    prot = prot.model_copy(update={"worktree_root": str(prot_root)})
    storage.save_job(prot)
    # reclaimable run: COMPLETED, stale
    done = Job(type=JobType.ORCHESTRATION, company="a", project="p",
               request_payload={}, status=JobStatus.COMPLETED)
    done_root = wr.run_root(str(ws), done.job_id)
    wr.add_worktree(live_repo, done_root / "repo", "feature/done", "main")
    done = done.model_copy(update={"worktree_root": str(done_root)})
    storage.save_job(done)
    # orphan dir with no job record (young → kept)
    orphan = ws / "wt" / "orphan01"
    orphan.mkdir(parents=True)

    def resolver(job):
        return [(live_repo, Path(job.worktree_root) / "repo")]

    reclaimed = wr.sweep(storage, str(ws), resolver, ttl_seconds=3600)
    assert Path(done_root).exists() is False
    assert Path(prot_root).exists() is True          # protected survived
    assert orphan.exists() is True                   # young orphan kept
    assert done.job_id[:8] in reclaimed and prot.job_id[:8] not in reclaimed
    assert len(_worktree_names(live_repo)) == 2      # live + protected only


def test_repo_index_lock_path_linked_worktree(live_repo, tmp_path):
    wt = tmp_path / "wt"
    wr.add_worktree(live_repo, wt, "feature/x", "main")
    p = wr.repo_index_lock_path(wt)
    # NOT the naive <wt>/.git/index.lock (.git is a FILE in a linked worktree)
    assert ".git" in str(p)
    assert "worktrees" in str(p)
