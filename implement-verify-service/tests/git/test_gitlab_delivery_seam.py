"""Real-GitLab delivery seam tests — the GitLab arm of the git workflow,
end-to-end against a live gitlab.com remote (not a local bare repo).

No mocks: real GitManager + GitLabStrategy + apply_git_workflow drive a real
clone (oauth2:token auth) → branch → commit → push → open merge request against
a throwaway project that's created and deleted per test.

Token-gated like the other seam tests — set GITLAB_TEST_TOKEN (api scope) to run;
skips otherwise. GITLAB_TEST_URL optional (defaults gitlab.com).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("GITLAB_TEST_TOKEN"),
    reason="set GITLAB_TEST_TOKEN (api scope) to run the live GitLab delivery seam",
)

TOKEN = os.getenv("GITLAB_TEST_TOKEN", "")


def _gl():
    import gitlab
    return gitlab.Gitlab(url=os.getenv("GITLAB_TEST_URL", "https://gitlab.com"), private_token=TOKEN)


def _set_gitlab_env(monkeypatch, *, auto_pr=True):
    monkeypatch.setenv("GIT_PROVIDER", "gitlab")
    monkeypatch.setenv("GITLAB_TOKEN", TOKEN)
    monkeypatch.setenv("GIT_DEFAULT_BRANCH", "main")
    monkeypatch.setenv("GIT_AUTO_PUSH", "true")
    monkeypatch.setenv("GIT_AUTO_PR", "true" if auto_pr else "false")
    for k, v in {"GIT_AUTHOR_NAME": "Test Bot", "GIT_AUTHOR_EMAIL": "test@example.com",
                 "GIT_COMMITTER_NAME": "Test Bot", "GIT_COMMITTER_EMAIL": "test@example.com"}.items():
        monkeypatch.setenv(k, v)


@pytest.fixture
def gl():
    client = _gl()
    client.auth()
    return client


@pytest.fixture
def gitlab_project(gl):
    """A throwaway gitlab.com project seeded with `main` — deleted after the test."""
    proj = gl.projects.create({"name": f"haikai-deliver-{uuid.uuid4().hex[:10]}",
                               "initialize_with_readme": True})
    try:
        yield proj
    finally:
        try:
            proj.delete()
        except Exception:
            pass


def test_a1_full_delivery_clone_branch_commit_push_mr(gitlab_project, tmp_path, monkeypatch):
    from src.api.git_workflow import apply_git_workflow
    from src.git.config import load_git_config
    from src.git.git_manager import GitManager
    import types

    _set_gitlab_env(monkeypatch, auto_pr=True)
    git_config = load_git_config()
    assert git_config.provider == "gitlab" and git_config.gitlab_token

    # REAL clone of the GitLab repo into the workspace (oauth2:token auth).
    repo_dir = tmp_path / "acme" / "shop" / "app"
    gm = GitManager(project_dir=repo_dir, provider="gitlab",
                    default_branch="main", gitlab_token=TOKEN)
    gm.init_project(gitlab_project.http_url_to_repo)
    assert (repo_dir / ".git").exists()

    # Generated work lands in the tree, then the real workflow ships it.
    (repo_dir / "feature.txt").write_text("hello from A1\n", encoding="utf-8")
    branch = f"feature/a1-{uuid.uuid4().hex[:8]}"
    resp = types.SimpleNamespace(errors=[], commit_sha=None, branch=None, pr_url=None)
    apply_git_workflow(
        gm=gm, git_config=git_config, branch=branch,
        commit_msg="A1: add feature.txt",
        pr_title="A1 delivery proof", pr_body="real GitLab delivery seam",
        response_obj=resp,
    )

    # The workflow itself reports success: branch set, no errors, a real MR URL.
    assert resp.errors == []
    assert resp.branch == branch
    assert resp.commit_sha
    assert resp.pr_url and "/merge_requests/" in resp.pr_url

    # And it's REAL on GitLab: the branch was pushed and the MR exists.
    pushed = gitlab_project.branches.get(branch)
    assert pushed.name == branch
    mrs = gitlab_project.mergerequests.list(source_branch=branch, get_all=True)
    assert len(mrs) == 1
    assert mrs[0].target_branch == "main"
    # the pushed branch carries the generated file
    files = [f["path"] for f in gitlab_project.repository_tree(ref=branch, get_all=True)]
    assert "feature.txt" in files


def test_a2_batch_specs_accumulate_one_branch_one_mr(gitlab_project, tmp_path, monkeypatch):
    """Batch mode: N specs commit onto ONE branch (commit_only) and open exactly
    ONE merge request (push_pr_only) — against real GitLab."""
    from src.api.git_workflow import apply_git_workflow
    from src.git.config import load_git_config
    from src.git.git_manager import GitManager
    import types

    _set_gitlab_env(monkeypatch, auto_pr=True)
    git_config = load_git_config()
    repo_dir = tmp_path / "acme" / "shop" / "app"
    gm = GitManager(project_dir=repo_dir, provider="gitlab",
                    default_branch="main", gitlab_token=TOKEN)
    gm.init_project(gitlab_project.http_url_to_repo)

    batch = f"feature/batch-{uuid.uuid4().hex[:8]}"

    def _commit_spec(name):
        (repo_dir / f"{name}.txt").write_text(f"{name}\n", encoding="utf-8")
        r = types.SimpleNamespace(errors=[], commit_sha=None, branch=None, pr_url=None)
        apply_git_workflow(gm=gm, git_config=git_config, branch=batch,
                           commit_msg=name, commit_only=True, response_obj=r)
        assert r.errors == []
        return r

    _commit_spec("spec1")          # creates the batch branch + commit 1 (no push)
    _commit_spec("spec2")          # SAME branch, accumulate commit 2 (no reset between)

    # finalize: push the one branch + open ONE MR
    rf = types.SimpleNamespace(errors=[], commit_sha=None, branch=None, pr_url=None)
    apply_git_workflow(gm=gm, git_config=git_config, branch=batch, commit_msg="",
                       pr_title="batch: N specs", pr_body="one MR for the slice",
                       response_obj=rf, push_pr_only=True)

    assert rf.errors == [] and rf.pr_url and "/merge_requests/" in rf.pr_url
    # EXACTLY ONE MR for the batch branch
    mrs = gitlab_project.mergerequests.list(source_branch=batch, get_all=True)
    assert len(mrs) == 1 and mrs[0].target_branch == "main"
    # both specs accumulated on the one branch (two commits beyond main)
    files = [f["path"] for f in gitlab_project.repository_tree(ref=batch, get_all=True)]
    assert "spec1.txt" in files and "spec2.txt" in files
    msgs = [c.message.strip() for c in gitlab_project.commits.list(ref_name=batch, get_all=True)]
    assert "spec1" in msgs and "spec2" in msgs


def test_a3_polyrepo_routes_each_spec_to_its_repo(gl, tmp_path, monkeypatch):
    """Polyrepo/target-repo routing: a spec for the `api` repo lands in the api
    GitLab project, a spec for `web` lands in web — never crossed."""
    from src.api.git_workflow import apply_git_workflow
    from src.git.config import load_git_config
    from src.git.git_manager import GitManager
    import types

    _set_gitlab_env(monkeypatch, auto_pr=True)
    git_config = load_git_config()
    product_root = tmp_path / "acme" / "multi"
    projects, gms = {}, {}
    try:
        for folder in ("api", "web"):
            proj = gl.projects.create({"name": f"haikai-{folder}-{uuid.uuid4().hex[:8]}",
                                       "initialize_with_readme": True})
            projects[folder] = proj
            gm = GitManager(project_dir=product_root / folder, provider="gitlab",
                            default_branch="main", gitlab_token=TOKEN)
            gm.init_project(proj.http_url_to_repo)
            gms[folder] = gm

        def _deliver(folder, fname):
            (product_root / folder / fname).write_text(f"{folder}\n", encoding="utf-8")
            r = types.SimpleNamespace(errors=[], commit_sha=None, branch=None, pr_url=None)
            apply_git_workflow(gm=gms[folder], git_config=git_config,
                               branch=f"feature/{folder}-spec", commit_msg=f"{folder} spec",
                               pr_title=f"{folder} spec", pr_body="", response_obj=r)
            assert r.errors == [] and r.pr_url and "/merge_requests/" in r.pr_url

        _deliver("api", "api_change.txt")
        _deliver("web", "web_change.txt")

        api_files = [f["path"] for f in projects["api"].repository_tree(ref="feature/api-spec", get_all=True)]
        web_files = [f["path"] for f in projects["web"].repository_tree(ref="feature/web-spec", get_all=True)]
        # each change landed in its OWN repo, and NOT in the other
        assert "api_change.txt" in api_files and "web_change.txt" not in api_files
        assert "web_change.txt" in web_files and "api_change.txt" not in web_files
    finally:
        for proj in projects.values():
            try:
                proj.delete()
            except Exception:
                pass
