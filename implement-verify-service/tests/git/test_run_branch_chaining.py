"""Run-branch chaining (2026-08-06): base_spec resolution, fresh-origin
default base, inline dead-holder reclaim, and MR suppression.

Sequential multi-spec runs previously branched EVERY spec from pristine
default — spec N could not see specs 1..N-1. Each spec's worktree now starts
from the previous successful spec's commit (`base_spec`), so the chain's
final branch carries the whole stage's diff and opens the ONE MR.

REAL git repos in tmp dirs, mirroring test_worktree_runs.py.
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


def _commit_on_branch(repo, branch, base, filename):
    _run(repo, "branch", branch, base)
    wt = repo.parent / f"tmp-{branch.replace('/', '-')}"
    _run(repo, "worktree", "add", str(wt), branch)
    (wt / filename).write_text(filename)
    _run(wt, "add", "-A")
    _run(wt, "commit", "-m", filename)
    _run(repo, "worktree", "remove", str(wt))


@pytest.fixture
def origin(tmp_path, live_repo):
    """Bare origin wired as live_repo's remote."""
    bare = tmp_path / "origin.git"
    _run(live_repo, "clone", "--bare", str(live_repo), str(bare))
    _run(live_repo, "remote", "add", "origin", str(bare))
    _run(live_repo, "fetch", "origin")
    return bare


# ── resolve_base_ref ────────────────────────────────────────────────────────

def test_resolve_base_ref_prefers_folder_suffixed_branch(live_repo):
    _commit_on_branch(live_repo, "feature/spec-a", "main", "root.txt")
    _commit_on_branch(live_repo, "feature/spec-a--api", "main", "api.txt")
    assert wr.resolve_base_ref(live_repo, "spec-a", "api", "main") == \
        "feature/spec-a--api"
    assert wr.resolve_base_ref(live_repo, "spec-a", None, "main") == \
        "feature/spec-a"


def test_resolve_base_ref_falls_back_to_origin(live_repo, origin):
    # Branch exists ONLY on origin (machine-swap shape).
    _commit_on_branch(live_repo, "feature/spec-b", "main", "b.txt")
    _run(live_repo, "push", "origin", "feature/spec-b")
    _run(live_repo, "branch", "-D", "feature/spec-b")
    ref = wr.resolve_base_ref(live_repo, "spec-b", None, "main")
    assert ref == "origin/feature/spec-b"


def test_resolve_base_ref_fails_fast_when_missing(live_repo):
    with pytest.raises(wr.WorktreeAllocationError, match="base_spec"):
        wr.resolve_base_ref(live_repo, "never-existed", None, "main")


def test_worktree_chained_from_base_spec_sees_prior_work(live_repo, tmp_path):
    """The core guarantee: spec N's worktree physically contains spec N-1's
    committed code."""
    _commit_on_branch(live_repo, "feature/spec-1", "main", "spec1.txt")
    base = wr.resolve_base_ref(live_repo, "spec-1", None, "main")
    wt = tmp_path / "wt-spec2"
    wr.add_worktree(live_repo, wt, "feature/spec-2", base)
    assert (wt / "spec1.txt").exists()      # chained, not pristine main
    assert (wt / "a.txt").exists()


# ── fresh_default_base ──────────────────────────────────────────────────────

def test_fresh_default_base_prefers_origin(live_repo, origin):
    assert wr.fresh_default_base(live_repo, "main") == "origin/main"


def test_fresh_default_base_offline_falls_back_to_local(live_repo):
    # No remote configured: the best-effort fetch fails silently.
    assert wr.fresh_default_base(live_repo, "main") == "main"


def test_fresh_default_base_picks_up_new_origin_commits(live_repo, origin,
                                                        tmp_path):
    """Checkbox B ('start from main — previous stage merged'): the base must
    see a merge that ONLY origin knows about yet."""
    clone = tmp_path / "clone"
    _run(live_repo, "clone", str(origin), str(clone))
    _run(clone, "config", "user.email", "t@t")
    _run(clone, "config", "user.name", "t")
    (clone / "merged.txt").write_text("stage-1 merged")
    _run(clone, "add", "-A")
    _run(clone, "commit", "-m", "stage-1 merge")
    _run(clone, "push", "origin", "main")
    base = wr.fresh_default_base(live_repo, "main")
    assert base == "origin/main"
    wt = tmp_path / "wt-fresh"
    wr.add_worktree(live_repo, wt, "feature/stage2-spec", base)
    assert (wt / "merged.txt").exists()


# ── explicit_branch_base + force_base (2026-08-15, "start from the MR") ─────

def test_explicit_branch_base_resolves_origin_ref(live_repo, origin):
    _commit_on_branch(live_repo, "db-migration/abc12345", "main", "db.txt")
    _run(live_repo, "push", "origin", "db-migration/abc12345")
    ref = wr.explicit_branch_base(live_repo, "db-migration/abc12345")
    assert ref == "origin/db-migration/abc12345"


def test_explicit_branch_base_fail_closed_when_absent(live_repo, origin):
    with pytest.raises(wr.WorktreeAllocationError, match="does not resolve"):
        wr.explicit_branch_base(live_repo, "db-migration/never1234")


def test_force_base_resets_stale_free_branch_to_explicit_base(live_repo,
                                                              origin,
                                                              tmp_path):
    """Same-day Re-start shape: the deterministic spec name reuses the
    abandoned attempt's branch. Without force_base the worktree silently
    attaches to the wreckage; with it the FREE branch is reset to the
    operator's explicit MR base."""
    # The MR base: a DB assembly branch on origin carrying db.txt.
    _commit_on_branch(live_repo, "db-migration/abc12345", "main", "db.txt")
    _run(live_repo, "push", "origin", "db-migration/abc12345")
    # The abandoned attempt: same spec branch based on plain main, with
    # wreckage committed — and its worktree already reclaimed (branch free).
    _commit_on_branch(live_repo, "feature/spec-x", "main", "wreckage.txt")

    base = wr.explicit_branch_base(live_repo, "db-migration/abc12345")
    wt = tmp_path / "wt-restart"
    wr.add_worktree(live_repo, wt, "feature/spec-x", base, force_base=True)

    assert (wt / "db.txt").exists()            # sits on the MR base
    assert not (wt / "wreckage.txt").exists()  # wreckage discarded
    # The reset moved the LOCAL ref only; origin is untouched.
    assert (wt / "a.txt").exists()


def test_force_base_leaves_live_holder_failure_intact(live_repo, tmp_path):
    """force_base never overrides the active-elsewhere rule: a branch held by
    a live worktree still fails loudly."""
    wr.add_worktree(live_repo, tmp_path / "wt-a", "feature/spec-y", "main",
                    job_id="run-A")
    with pytest.raises(wr.WorktreeAllocationError, match="active in another"):
        wr.add_worktree(live_repo, tmp_path / "wt-b", "feature/spec-y",
                        "main", job_id="run-B", force_base=True)


def test_without_force_base_existing_branch_still_attaches(live_repo,
                                                           tmp_path):
    """The D4 attach rule is unchanged for non-explicit bases (resume flows
    depend on it)."""
    _commit_on_branch(live_repo, "feature/spec-z", "main", "kept.txt")
    wt = tmp_path / "wt-resume"
    wr.add_worktree(live_repo, wt, "feature/spec-z", "main")
    assert (wt / "kept.txt").exists()


# ── free_branch_holder_if_dead ──────────────────────────────────────────────

def _job_with_worktree(storage, ws, live_repo, branch, status):
    job = Job(type=JobType.ORCHESTRATION, company="a", project="p",
              request_payload={}, status=status)
    root = wr.run_root(str(ws), job.job_id)
    wr.add_worktree(live_repo, root / "repo", branch, "main")
    job = job.model_copy(update={"worktree_root": str(root)})
    storage.save_job(job)
    return job, root


def test_free_branch_holder_reclaims_dead_terminal_job(live_repo, tmp_path):
    ws = tmp_path / "ws"
    storage = JobStorage(str(tmp_path / "jobs.db"))
    _job, root = _job_with_worktree(storage, ws, live_repo, "feature/x",
                                    JobStatus.COMPLETED)
    assert wr.branch_checked_out_at(live_repo, "feature/x") is not None
    assert wr.free_branch_holder_if_dead(live_repo, "feature/x", storage,
                                         str(ws)) is True
    assert wr.branch_checked_out_at(live_repo, "feature/x") is None
    # The follow-on allocation can now attach to the freed branch.
    wt2 = tmp_path / "wt2"
    wr.add_worktree(live_repo, wt2, "feature/x", "main")


def test_free_branch_holder_refuses_live_job(live_repo, tmp_path):
    ws = tmp_path / "ws"
    storage = JobStorage(str(tmp_path / "jobs.db"))
    _job, root = _job_with_worktree(storage, ws, live_repo, "feature/y",
                                    JobStatus.RUNNING)
    assert wr.free_branch_holder_if_dead(live_repo, "feature/y", storage,
                                         str(ws)) is False
    assert wr.branch_checked_out_at(live_repo, "feature/y") is not None


def test_free_branch_holder_never_touches_paths_outside_wt(live_repo, tmp_path):
    """The LIVE checkout holds its own branch — never a reclaim candidate."""
    ws = tmp_path / "ws"
    storage = JobStorage(str(tmp_path / "jobs.db"))
    current = _run(live_repo, "branch", "--show-current").strip()
    assert wr.free_branch_holder_if_dead(live_repo, current, storage,
                                         str(ws)) is False
    assert (live_repo / "a.txt").exists()


def test_free_branch_holder_keeps_recordless_debris(live_repo, tmp_path):
    """No job record → the TTL sweeper's business, not inline reclaim."""
    ws = tmp_path / "ws"
    storage = JobStorage(str(tmp_path / "jobs.db"))
    orphan = ws / "wt" / "0123456789abcdef" / "repo"
    wr.add_worktree(live_repo, orphan, "feature/z", "main")
    assert wr.free_branch_holder_if_dead(live_repo, "feature/z", storage,
                                         str(ws)) is False
    assert wr.branch_checked_out_at(live_repo, "feature/z") is not None


# ── request model + MR suppression ──────────────────────────────────────────

def test_orchestration_request_chaining_defaults():
    from src.haikai_models import OrchestrationRequest
    req = OrchestrationRequest(company="a", project="p",
                               spec_intents=[{"spec_name": "spec-long-name"}])
    assert req.base_spec is None
    assert req.open_merge_request is True
    req2 = OrchestrationRequest(company="a", project="p",
                                spec_intents=[{"spec_name": "spec-long-name"}],
                                base_spec="2026-08-06-prior-spec",
                                open_merge_request=False)
    assert req2.base_spec == "2026-08-06-prior-spec"
    assert req2.open_merge_request is False


def test_git_one_spec_suppresses_pr_title_when_open_mr_false(monkeypatch,
                                                             tmp_path):
    from src.job_queue import tasks as t

    calls = []

    class _GM:
        def __init__(self, **kwargs):
            pass

    def _capture(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr("src.job_queue.tasks.GitManager", _GM)
    monkeypatch.setattr("src.api.git_workflow.apply_git_workflow", _capture)

    class _Cfg:
        provider = "github"
        default_branch = "main"
        github_token = "t"
        bitbucket_username = None
        bitbucket_app_password = None

    targets = [(None, tmp_path)]
    t._git_one_spec(_Cfg(), targets, [], "spec-x", open_mr=False)
    t._git_one_spec(_Cfg(), targets, [], "spec-x", open_mr=True)
    assert calls[0]["pr_title"] is None            # chained: push, no MR
    assert calls[1]["pr_title"] == "feature: spec-x"
