"""F4/W1/W2/W3 — async orchestration deploy_on_complete + build-results callback.

W1: the four optional fields flow through OrchestrationRequest into the job payload.
W2/F2: _deploy_completed_run consolidates the run's spec branches and deploys.
W3/D2: _emit_orchestration_callback maps the outcome enum (implemented|deployed|failed)
       and POSTs snake_case keys to callback_url.

run_workflow's LLM leg is not unit-testable here; these cover the deploy/callback
seam directly (the part F4/W1/W3 added)."""

from __future__ import annotations

import subprocess
import types

import pytest

from src.haikai_models import OrchestrationRequest, SpecIntent
from src.job_queue import tasks


# ---- W1: model carries the new optional fields (default-off) -----------------

def test_w1_fields_default_off():
    req = OrchestrationRequest(company="acme", project="ledger",
                               spec_intents=[SpecIntent(spec_name="add-widgets")])
    assert req.deploy_on_complete is False
    assert req.target is None and req.callback_url is None and req.integrate_branches is None
    # they survive a model_dump round-trip (how jobs.py carries them into the payload)
    assert "deploy_on_complete" in req.model_dump()


def test_w1_fields_accepted_and_roundtrip():
    req = OrchestrationRequest(
        company="acme", project="ledger",
        spec_intents=[SpecIntent(spec_name="add-widgets")],
        deploy_on_complete=True, target={"command": ["python", "app.py"]},
        callback_url="https://gary.example/build-results",
        integrate_branches=["feature/x"],
    )
    rebuilt = OrchestrationRequest(**req.model_dump())
    assert rebuilt.deploy_on_complete is True
    assert rebuilt.target == {"command": ["python", "app.py"]}
    assert rebuilt.callback_url == "https://gary.example/build-results"
    assert rebuilt.integrate_branches == ["feature/x"]


# ---- a minimal response stand-in (mirrors OrchestrationResponse fields used) --

def _resp(errors=None, pr_url=None, spec_names=("add-widgets",)):
    return types.SimpleNamespace(
        errors=list(errors or []), success=not errors,
        pr_url=pr_url, spec_names=list(spec_names),
    )


# ---- W3/D2: callback outcome mapping ----------------------------------------

def _capture(monkeypatch):
    sent = []
    monkeypatch.setattr(tasks, "_post_callback", lambda url, payload: sent.append((url, payload)) or True)
    return sent


def _req(**over):
    base = dict(company="acme", project="ledger",
                spec_intents=[SpecIntent(spec_name="add-widgets")],
                callback_url="https://cb/x")
    base.update(over)
    return OrchestrationRequest(**base)


def test_callback_deployed_when_deploy_has_url(monkeypatch):
    sent = _capture(monkeypatch)
    deploy = {"base_url": "http://127.0.0.1:9", "box_id": "box-1", "merged": ["feature/a", "feature/b"]}
    tasks._emit_orchestration_callback(_req(deploy_on_complete=True), "job-1", _resp(pr_url="http://pr/1"), deploy)
    _, p = sent[0]
    assert p["outcome"] == "deployed"
    assert p["target_base_url"] == "http://127.0.0.1:9" and p["box_id"] == "box-1"
    assert p["job_id"] == "job-1" and p["pr_url"] == "http://pr/1"
    assert p["merged_branches"] == ["feature/a", "feature/b"]  # C2: merged, not a fake branch
    assert "integration_branch" not in p


def test_c3_record_always_has_outcome_for_folding(monkeypatch):
    # C3: with NO deploy_on_complete and NO callback_url, the build-results record
    # (which run_orchestration now ALWAYS folds into job.result) still carries
    # `outcome` — a poller can always read it, not present-or-absent by config.
    _capture(monkeypatch)
    rec = tasks._emit_orchestration_callback(_req(callback_url=None), "job-x", _resp(), None)
    assert rec["outcome"] == "implemented"
    assert {"job_id", "company", "project", "outcome", "spec_names", "errors"}.issubset(rec)


def test_c4_committed_with_nonfatal_error_is_implemented_not_error(monkeypatch):
    # C4: specs were built + committed but a non-fatal git step failed (e.g. PR
    # push) -> IMPLEMENTED with the error attached as a warning, NOT ERROR.
    sent = _capture(monkeypatch)
    spec_git = [{"spec": "s1", "repo": None, "branch": "feature/s1",
                 "commit_sha": "aaa", "pr_url": None, "error": "PR creation failed"}]
    tasks._emit_orchestration_callback(_req(), "job-1", _resp(errors=["PR creation failed"]),
                                       None, spec_git=spec_git)
    _, p = sent[0]
    assert p["outcome"] == "implemented"
    assert p["errors"] == ["PR creation failed"]  # carried as a warning


def test_c4_nothing_built_with_errors_is_error(monkeypatch):
    # C4: genuine failure (no spec committed) still maps to ERROR.
    sent = _capture(monkeypatch)
    spec_git = [{"spec": "s1", "repo": None, "branch": None, "commit_sha": None,
                 "pr_url": None, "error": "git config error"}]
    tasks._emit_orchestration_callback(_req(), "job-1", _resp(errors=["git config error"]),
                                       None, spec_git=spec_git)
    _, p = sent[0]
    assert p["outcome"] == "error"


def test_callback_carries_per_spec_git_list(monkeypatch):
    # C1/L3: a multi-spec run reports ALL branches/PRs, not just the last.
    sent = _capture(monkeypatch)
    spec_git = [
        {"spec": "s1", "repo": None, "branch": "feature/s1", "commit_sha": "aaa", "pr_url": "http://pr/1", "error": None},
        {"spec": "s2", "repo": None, "branch": "feature/s2", "commit_sha": "bbb", "pr_url": "http://pr/2", "error": None},
    ]
    tasks._emit_orchestration_callback(_req(), "job-1", _resp(pr_url="http://pr/2"), None, spec_git=spec_git)
    _, p = sent[0]
    assert [r["branch"] for r in p["spec_git"]] == ["feature/s1", "feature/s2"]
    assert [r["pr_url"] for r in p["spec_git"]] == ["http://pr/1", "http://pr/2"]


def test_callback_implemented_when_no_deploy(monkeypatch):
    sent = _capture(monkeypatch)
    tasks._emit_orchestration_callback(_req(), "job-1", _resp(pr_url="http://pr/1"), None)
    _, p = sent[0]
    assert p["outcome"] == "implemented" and "target_base_url" not in p


def test_callback_error_when_errors(monkeypatch):
    sent = _capture(monkeypatch)
    tasks._emit_orchestration_callback(_req(deploy_on_complete=True), "job-1",
                                       _resp(errors=["git push failed"]), None)
    _, p = sent[0]
    assert p["outcome"] == "error" and p["errors"] == ["git push failed"]


def test_pr_url_carried_even_on_error(monkeypatch):
    # L4: a run can error AFTER PRs were raised; the error payload still carries pr_url.
    sent = _capture(monkeypatch)
    tasks._emit_orchestration_callback(_req(deploy_on_complete=True), "job-1",
                                       _resp(errors=["deploy failed"], pr_url="http://pr/9"), None)
    _, p = sent[0]
    assert p["outcome"] == "error" and p["pr_url"] == "http://pr/9"


def test_no_post_when_url_absent_but_record_returned(monkeypatch):
    # C5: with no callback_url we DON'T POST, but we still RETURN the build-results
    # record (so the caller can fold it into job.result for the poll fallback).
    sent = _capture(monkeypatch)
    rec = tasks._emit_orchestration_callback(_req(callback_url=None), "job-1", _resp(), None)
    assert sent == []
    assert rec["outcome"] == "implemented" and rec["callback_delivered"] is None


def test_callback_delivered_flag_captured(monkeypatch):
    # L10: _post_callback's bool is captured, not discarded.
    monkeypatch.setattr(tasks, "_post_callback", lambda url, payload: False)
    rec = tasks._emit_orchestration_callback(_req(), "job-1", _resp(), None)
    assert rec["callback_delivered"] is False


# ---- Theme A: box-leak backstop on un-acked deployed callback ----------------

def test_backstop_releases_box_when_deployed_not_acked(monkeypatch):
    released = []
    monkeypatch.setattr("src.haibox.client.HaiboxClient",
                        type("HB", (), {"__init__": lambda s, *a, **k: None,
                                        "release": lambda s, bid: released.append(bid)}))
    rec = {"outcome": "deployed", "box_id": "box-leak"}
    tasks._backstop_release_unacked_box(rec, outcome="deployed", delivered=False, box_id="box-leak")
    assert released == ["box-leak"] and rec["box_released"] is True


def test_backstop_noop_when_callback_acked(monkeypatch):
    released = []
    monkeypatch.setattr("src.haibox.client.HaiboxClient",
                        type("HB", (), {"__init__": lambda s, *a, **k: None,
                                        "release": lambda s, bid: released.append(bid)}))
    rec = {"outcome": "deployed", "box_id": "box-ok"}
    tasks._backstop_release_unacked_box(rec, outcome="deployed", delivered=True, box_id="box-ok")
    assert released == [] and "box_released" not in rec


def test_backstop_noop_when_not_deployed():
    # implemented/error/fix_unserved have no live box to reclaim here.
    rec = {"outcome": "implemented", "box_id": None}
    tasks._backstop_release_unacked_box(rec, outcome="implemented", delivered=None, box_id=None)
    assert "box_released" not in rec


def test_backstop_release_failure_recorded_false(monkeypatch):
    def boom(self, bid):
        raise RuntimeError("haiboxd down")
    monkeypatch.setattr("src.haibox.client.HaiboxClient",
                        type("HB", (), {"__init__": lambda s, *a, **k: None, "release": boom}))
    rec = {"outcome": "deployed", "box_id": "box-x"}
    tasks._backstop_release_unacked_box(rec, outcome="deployed", delivered=False, box_id="box-x")
    assert rec["box_released"] is False


# ---- W2/F2: deploy gate + branch derivation ---------------------------------

def _git_repo(tmp_path):
    """A single-repo product root (.git at root) with a base commit + two feature branches."""
    root = tmp_path / "acme" / "ledger"
    root.mkdir(parents=True)

    def g(*a):
        return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)

    g("init", "-q", "-b", "main")
    (root / "base.txt").write_text("base\n")
    g("add", "-A")
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
    for name, fname in [("feature/add-widgets", "w.txt"), ("feature/add-gadgets", "g.txt")]:
        g("checkout", "-q", "-b", name, "main")
        (root / fname).write_text("x\n")
        g("add", "-A")
        g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name)
        g("checkout", "-q", "main")
    return root


def test_deploy_off_by_default_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    deploy = tasks._deploy_completed_run(_req(), str(tmp_path), _resp())
    assert deploy is None


def test_deploy_skipped_when_run_had_errors(tmp_path):
    deploy = tasks._deploy_completed_run(
        _req(deploy_on_complete=True, target={"command": ["python", "app.py"]}),
        str(tmp_path), _resp(errors=["boom"]))
    assert deploy is None


def test_deploy_without_target_records_error(tmp_path):
    resp = _resp()
    deploy = tasks._deploy_completed_run(_req(deploy_on_complete=True), str(tmp_path), resp)
    assert deploy is None and any("no target" in e for e in resp.errors)


def test_deploy_consolidates_spec_branches_and_returns_box(tmp_path, monkeypatch):
    _git_repo(tmp_path)
    monkeypatch.setattr("src.haibox.integration.provision_for_job",
                        lambda payload, client=None: {"base_url": "http://127.0.0.1:9", "box_id": "box-int"})
    # default_branch comes from load_git_config(); pin it to main for the test repo
    monkeypatch.setattr(tasks, "load_git_config",
                        lambda: types.SimpleNamespace(default_branch="main"))
    req = _req(deploy_on_complete=True, target={"command": ["python", "app.py"]},
               spec_intents=[SpecIntent(spec_name="add-widgets"), SpecIntent(spec_name="add-gadgets")])
    resp = _resp(spec_names=("add-widgets", "add-gadgets"))
    deploy = tasks._deploy_completed_run(req, str(tmp_path), resp)
    assert deploy["base_url"] == "http://127.0.0.1:9" and deploy["box_id"] == "box-int"
    assert deploy["merged"] == ["feature/add-widgets", "feature/add-gadgets"]
    assert resp.errors == []


def test_deploy_merge_conflict_reports_failed(tmp_path, monkeypatch):
    root = tmp_path / "acme" / "ledger"
    root.mkdir(parents=True)

    def g(*a):
        return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)

    g("init", "-q", "-b", "main")
    (root / "base.txt").write_text("base\n")
    g("add", "-A"); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
    for name in ("feature/add-widgets", "feature/add-gadgets"):  # both edit base.txt -> conflict
        g("checkout", "-q", "-b", name, "main")
        (root / "base.txt").write_text(f"{name}\n")
        g("add", "-A"); g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name)
        g("checkout", "-q", "main")
    monkeypatch.setattr("src.haibox.integration.provision_for_job",
                        lambda payload, client=None: {"base_url": "u", "box_id": "b"})
    monkeypatch.setattr(tasks, "load_git_config", lambda: types.SimpleNamespace(default_branch="main"))
    req = _req(deploy_on_complete=True, target={"command": ["python", "app.py"]},
               spec_intents=[SpecIntent(spec_name="add-widgets"), SpecIntent(spec_name="add-gadgets")])
    resp = _resp(spec_names=("add-widgets", "add-gadgets"))
    deploy = tasks._deploy_completed_run(req, str(tmp_path), resp)
    assert deploy is None
    assert resp.success is False and any("deploy failed" in e for e in resp.errors)
