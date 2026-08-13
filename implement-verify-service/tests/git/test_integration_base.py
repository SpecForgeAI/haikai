"""Integration base (2026-08-12) — the third base behaviour for STAGE
continuation.

The live Stage-2 start failure: cross-run `base_spec` chaining picked the
prior run's highest-sequence implemented item — a zero-diff no-op spec whose
branch never existed — and allocation fail-fasted "resolves no branch". Even
with a live branch, a single lineage cannot carry the prior stage's 21
sibling branches. The integration base builds, per repo target, a branch off
the freshly-fetched default with EVERY remote `feature/*` branch for the
target merged in: specs accumulate onto ALL prior work and a missing branch
is simply absent.

REAL git repos in tmp dirs, mirroring test_run_branch_chaining.py.
"""

import subprocess

import pytest

from src.git import worktree_runs as wr


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


@pytest.fixture
def origin(tmp_path, live_repo):
    """Bare origin wired as live_repo's remote."""
    bare = tmp_path / "origin.git"
    _run(live_repo, "clone", "--bare", str(live_repo), str(bare))
    _run(live_repo, "remote", "add", "origin", str(bare))
    _run(live_repo, "fetch", "origin")
    return bare


def _push_branch(live_repo, branch, filename, content=None):
    """Create `branch` off main with one commit adding `filename`, push it to
    origin, then delete the local copy (the stage-boundary shape: prior-stage
    branches live on origin)."""
    wt = live_repo.parent / f"tmp-{branch.replace('/', '-')}"
    _run(live_repo, "branch", branch, "main")
    _run(live_repo, "worktree", "add", str(wt), branch)
    (wt / filename).write_text(content if content is not None else filename)
    _run(wt, "add", "-A")
    _run(wt, "commit", "-m", filename)
    _run(live_repo, "worktree", "remove", str(wt))
    _run(live_repo, "push", "origin", branch)
    _run(live_repo, "branch", "-D", branch)


def _files_at(live_repo, ref):
    return set(_run(live_repo, "ls-tree", "-r", "--name-only", ref).split())


def test_merges_every_remote_feature_branch_for_the_root_target(live_repo, origin):
    _push_branch(live_repo, "feature/spec-1", "spec1.txt")
    _push_branch(live_repo, "feature/spec-2", "spec2.txt")

    base = wr.integration_base(live_repo, None, "main", "stage-2")

    assert base == "integration/stage-2"
    files = _files_at(live_repo, base)
    assert {"a.txt", "spec1.txt", "spec2.txt"} <= files


def test_no_feature_branches_means_the_plain_fresh_default_base(live_repo, origin):
    # The "missing branch is simply absent" guarantee taken to its limit:
    # nothing to integrate is NOT an error — it is the fresh default base.
    base = wr.integration_base(live_repo, None, "main", "stage-2")
    assert base == "origin/main"


def test_folder_targets_merge_only_their_suffixed_branches(live_repo, origin):
    _push_branch(live_repo, "feature/spec-1", "root.txt")
    _push_branch(live_repo, "feature/spec-1--api", "api.txt")

    api_base = wr.integration_base(live_repo, "api", "main", "stage-2")
    assert api_base == "integration/stage-2--api"
    api_files = _files_at(live_repo, api_base)
    assert "api.txt" in api_files
    assert "root.txt" not in api_files

    root_base = wr.integration_base(live_repo, None, "main", "stage-2")
    root_files = _files_at(live_repo, root_base)
    assert "root.txt" in root_files
    assert "api.txt" not in root_files


def test_conflicting_branches_fail_LOUD_with_the_conflicted_paths(live_repo, origin):
    _push_branch(live_repo, "feature/spec-1", "shared.txt", content="one")
    _push_branch(live_repo, "feature/spec-2", "shared.txt", content="two")

    with pytest.raises(wr.IntegrationBaseConflict) as err:
        wr.integration_base(live_repo, None, "main", "stage-2")
    assert "shared.txt" in str(err.value)
    assert "resolve" in str(err.value)
    # The temp merge worktree is cleaned up even on failure.
    assert "integration" not in _run(live_repo, "worktree", "list")


def test_the_live_checkout_is_never_touched(live_repo, origin):
    _push_branch(live_repo, "feature/spec-1", "spec1.txt")
    head_before = _run(live_repo, "rev-parse", "HEAD").strip()
    branch_before = _run(live_repo, "rev-parse", "--abbrev-ref", "HEAD").strip()

    wr.integration_base(live_repo, None, "main", "stage-2")

    assert _run(live_repo, "rev-parse", "HEAD").strip() == head_before
    assert _run(live_repo, "rev-parse", "--abbrev-ref", "HEAD").strip() == branch_before
    assert (live_repo / "a.txt").read_text() == "a"
    assert not (live_repo / "spec1.txt").exists()


def test_a_worktree_created_from_the_integration_base_sees_all_prior_work(
        live_repo, origin, tmp_path):
    _push_branch(live_repo, "feature/spec-1", "spec1.txt")
    _push_branch(live_repo, "feature/spec-2", "spec2.txt")

    base = wr.integration_base(live_repo, None, "main", "stage-2")
    dest = tmp_path / "wt" / "stage2-spec-a"
    wr.add_worktree(live_repo, dest, "feature/stage2-spec-a", base)

    assert (dest / "spec1.txt").is_file()
    assert (dest / "spec2.txt").is_file()
    assert (dest / "a.txt").is_file()
    _run(live_repo, "worktree", "remove", "--force", str(dest))
