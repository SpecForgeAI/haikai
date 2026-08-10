"""Zero-diff no-op split (2026-08-10, work-machine port).

A clean run whose implement step produced an EMPTY diff used to report
`error` unconditionally (gold standard 2026-08-07: nothing-committed !=
implemented). The live 20/21 halt showed the missing case: the sequences
changeset had already been committed byte-identical by the post-load spec,
so the repo genuinely held the deliverable. The split:

  - repo(s) already hold committed work (HEAD is a real commit with tracked
    files)                                        -> implemented (no-op)
  - empty/unborn HEAD, unverifiable records       -> error, as before
  - git errors / failed workflow steps            -> NEVER a no-op

`_all_targets_carry_committed_artefacts` is exercised against REAL git
repos on disk (the check is subprocess git — no mock at the seam).
"""
from __future__ import annotations

import subprocess
from types import SimpleNamespace

from src.job_queue.tasks import (
    _all_targets_carry_committed_artefacts,
    _emit_orchestration_callback,
)
from src.verification import outcomes


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _repo_with_commit(tmp_path, name="repo"):
    d = tmp_path / name
    d.mkdir()
    _git(d, "init", "-q")
    _git(d, "config", "user.email", "t@t")
    _git(d, "config", "user.name", "t")
    (d / "artefact.sql").write_text("SELECT 1;\n")
    _git(d, "add", "-A")
    _git(d, "commit", "-q", "-m", "artefact")
    return d


def _unborn_repo(tmp_path, name="unborn"):
    d = tmp_path / name
    d.mkdir()
    _git(d, "init", "-q")
    return d


def _record(repo_dir=None, commit_sha=None, error=None):
    return {"spec": "s", "repo": None, "branch": "feature/s",
            "commit_sha": commit_sha, "pr_url": None, "error": error,
            **({"repo_dir": str(repo_dir)} if repo_dir else {})}


# --- _all_targets_carry_committed_artefacts ---------------------------------

def test_repo_with_real_commit_and_tracked_files_passes(tmp_path):
    repo = _repo_with_commit(tmp_path)
    assert _all_targets_carry_committed_artefacts([_record(repo)]) is True


def test_unborn_head_fails(tmp_path):
    repo = _unborn_repo(tmp_path)
    assert _all_targets_carry_committed_artefacts([_record(repo)]) is False


def test_commit_with_no_tracked_files_fails(tmp_path):
    d = tmp_path / "emptyc"
    d.mkdir()
    _git(d, "init", "-q")
    _git(d, "config", "user.email", "t@t")
    _git(d, "config", "user.name", "t")
    _git(d, "commit", "-q", "--allow-empty", "-m", "empty")
    assert _all_targets_carry_committed_artefacts([_record(d)]) is False


def test_non_git_dir_fails(tmp_path):
    d = tmp_path / "plain"
    d.mkdir()
    assert _all_targets_carry_committed_artefacts([_record(d)]) is False


def test_no_records_or_missing_repo_dir_fail_closed(tmp_path):
    repo = _repo_with_commit(tmp_path)
    assert _all_targets_carry_committed_artefacts([]) is False
    assert _all_targets_carry_committed_artefacts(None) is False
    # A record WITHOUT repo_dir cannot be verified — the whole check closes.
    assert _all_targets_carry_committed_artefacts(
        [_record(repo), _record(None)]) is False


def test_every_target_must_pass_not_just_one(tmp_path):
    good = _repo_with_commit(tmp_path, "good")
    bad = _unborn_repo(tmp_path, "bad")
    assert _all_targets_carry_committed_artefacts(
        [_record(good), _record(bad)]) is False


# --- outcome split through _emit_orchestration_callback ---------------------

def _emit(spec_git, *, success=True, errors=None, deploy=None):
    request = SimpleNamespace(company="c", project="p", callback_url=None)
    response = SimpleNamespace(success=success, errors=list(errors or []),
                               spec_names=["s"], pr_url=None)
    return _emit_orchestration_callback(request, "job-1", response, deploy,
                                        spec_git=spec_git), response


def test_zero_diff_with_committed_artefacts_is_implemented(tmp_path):
    repo = _repo_with_commit(tmp_path)
    payload, response = _emit([_record(repo)])
    assert payload["outcome"] == outcomes.IMPLEMENTED
    assert response.errors == []  # a clean claim carries no errors


def test_zero_diff_with_unborn_head_stays_error(tmp_path):
    repo = _unborn_repo(tmp_path)
    payload, response = _emit([_record(repo)])
    assert payload["outcome"] == outcomes.ERROR
    assert any("NOTHING was committed" in e for e in response.errors)


def test_git_error_can_never_become_a_noop(tmp_path):
    repo = _repo_with_commit(tmp_path)
    payload, _ = _emit([_record(repo, error="push failed: boom")])
    assert payload["outcome"] == outcomes.ERROR


def test_failed_workflow_step_can_never_become_a_noop(tmp_path):
    repo = _repo_with_commit(tmp_path)
    payload, response = _emit([_record(repo)], success=False)
    assert payload["outcome"] == outcomes.ERROR
    assert response.errors  # the folded-in step-failure reason


def test_real_commit_still_reports_implemented(tmp_path):
    repo = _repo_with_commit(tmp_path)
    payload, _ = _emit([_record(repo, commit_sha="abc123")])
    assert payload["outcome"] == outcomes.IMPLEMENTED


def test_zero_diff_noop_with_deploy_reports_deployed(tmp_path):
    repo = _repo_with_commit(tmp_path)
    payload, _ = _emit([_record(repo)], deploy={"base_url": "http://t", "box_id": "b",
                                                "merged": []})
    assert payload["outcome"] == outcomes.DEPLOYED
