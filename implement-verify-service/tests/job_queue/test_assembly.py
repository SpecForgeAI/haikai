"""Run assembly (WS2 DB-plane execution chain, 2026-07-31).

Merges the run's spec branches into one assembled branch, overlays the
complete pack from the request, validates the runnable-pack invariants
(manifest present + JSON + BOM-free, master changelog well-formed XML,
includes resolve, changeset ids parser-safe), then push + MR.
"""
from __future__ import annotations

import types
from pathlib import Path

import pytest

from src.haikai_models import AssemblePackFile, AssembleRunRequest
from src.job_queue.assembly import (
    AssemblyError,
    _safe_relpath,
    assemble_run,
    run_assembly,
    validate_pack_on_disk,
)
from src.job_queue.job_models import JobStatus


# ---------------------------------------------------------------------------
# _safe_relpath
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,expected",
    [
        ("liquibase/db.changelog-master.xml", Path("liquibase/db.changelog-master.xml")),
        ("liquibase\\changesets\\000-schemas.sql", Path("liquibase/changesets/000-schemas.sql")),
        ("manifest.json", Path("manifest.json")),
    ],
)
def test_safe_relpath_accepts_repo_relative(path, expected):
    assert _safe_relpath(path) == expected


@pytest.mark.parametrize(
    "path",
    ["/etc/passwd", "C:/evil.txt", "c:\\evil.txt", "../outside.txt", "a/../../b", "", "a/\x00b"],
)
def test_safe_relpath_rejects_escapes(path):
    assert _safe_relpath(path) is None


# ---------------------------------------------------------------------------
# validate_pack_on_disk
# ---------------------------------------------------------------------------


GOOD_MASTER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n'
    '  <!-- Structural phase: run with contexts=structural. -->\n'
    '  <include file="changesets/000-schemas.sql" relativeToChangelogFile="true"/>\n'
    "</databaseChangeLog>\n"
)
GOOD_CHANGESET = (
    "--liquibase formatted sql logicalFilePath:liquibase/changesets/000-schemas.sql\n"
    "--changeset db-migration-pack:schemas context:structural splitStatements:false\n"
    'CREATE SCHEMA IF NOT EXISTS "dbo";\n'
)


def _write(repo: Path, rel: str, content: str, encoding: str = "utf-8") -> AssemblePackFile:
    dest = repo / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content.encode(encoding))
    return AssemblePackFile(path=rel, content=content)


def test_validation_passes_a_good_pack(tmp_path):
    files = [
        _write(tmp_path, "liquibase/db.changelog-master.xml", GOOD_MASTER),
        _write(tmp_path, "liquibase/changesets/000-schemas.sql", GOOD_CHANGESET),
        _write(tmp_path, "manifest.json", '{"expected_schema": {}}'),
    ]
    assert validate_pack_on_disk(tmp_path, files) == []


def test_validation_rejects_double_dash_in_xml_comment(tmp_path):
    bad = GOOD_MASTER.replace("contexts=structural", "--contexts=structural")
    files = [_write(tmp_path, "liquibase/db.changelog-master.xml", bad)]
    problems = validate_pack_on_disk(tmp_path, files)
    assert any("not well-formed XML" in p for p in problems)


def test_validation_rejects_dangling_include(tmp_path):
    files = [_write(tmp_path, "liquibase/db.changelog-master.xml", GOOD_MASTER)]
    # 000-schemas.sql deliberately NOT written
    problems = validate_pack_on_disk(tmp_path, files)
    assert any("dangling include" in p for p in problems)


def test_validation_rejects_double_dash_changeset_id(tmp_path):
    bad = GOOD_CHANGESET.replace(":schemas ", ":table--dbo.arm_version ")
    files = [
        _write(tmp_path, "liquibase/db.changelog-master.xml", GOOD_MASTER),
        _write(tmp_path, "liquibase/changesets/000-schemas.sql", bad),
    ]
    problems = validate_pack_on_disk(tmp_path, files)
    assert any("not parser-safe" in p for p in problems)


def test_validation_rejects_bom_manifest(tmp_path):
    files = [
        _write(tmp_path, "liquibase/db.changelog-master.xml", GOOD_MASTER),
        _write(tmp_path, "liquibase/changesets/000-schemas.sql", GOOD_CHANGESET),
    ]
    dest = tmp_path / "manifest.json"
    dest.write_bytes(b"\xef\xbb\xbf" + b'{"ok": true}')
    files.append(AssemblePackFile(path="manifest.json", content='{"ok": true}'))
    problems = validate_pack_on_disk(tmp_path, files)
    assert any("BOM" in p for p in problems)


# ---------------------------------------------------------------------------
# assemble_run (fake GitManager; real overlay + validation on disk)
# ---------------------------------------------------------------------------


class _FakeGitManager:
    def __init__(self, *, known_refs=(), merge_fails=False, **kwargs):
        from src.git.git_manager import GitManagerError

        self._error = GitManagerError
        self.kwargs = kwargs
        self.known_refs = set(known_refs)
        self.merge_fails = merge_fails
        self.merged: list = []
        self.aborted = 0
        self.commits: list = []
        self.default_checkouts = 0
        self.default_branch = kwargs.get("default_branch", "main")

    def fetch_origin(self):
        pass

    def ref_exists(self, ref):
        return ref in self.known_refs

    def checkout_new_branch_from(self, branch, base):
        self.branch_created = (branch, base)

    def merge_no_ff(self, ref, message):
        if self.merge_fails:
            self.aborted += 1
            raise self._error(f"merge of {ref} failed: CONFLICT")
        self.merged.append(ref)

    def commit_all(self, message):
        self.commits.append(message)
        return "abc123"

    def checkout_default_branch(self):
        self.default_checkouts += 1
        return True


def _request(**overrides):
    base = dict(
        company="acme",
        project="proj",
        branch_name="db-migration/run1234",
        spec_names=["2026-07-31-spec-a-uid1", "2026-07-31-spec-b-uid2"],
        pack_files=[
            AssemblePackFile(path="liquibase/db.changelog-master.xml", content=GOOD_MASTER),
            AssemblePackFile(path="liquibase/changesets/000-schemas.sql", content=GOOD_CHANGESET),
            AssemblePackFile(path="manifest.json", content='{"expected_schema": {}}'),
        ],
    )
    base.update(overrides)
    return AssembleRunRequest(**base)


@pytest.fixture()
def wired(monkeypatch, tmp_path):
    """Wire a fake repo target + GitManager + push/MR helper; return (repo, holder)."""
    repo = tmp_path / "ws" / "acme" / "proj"
    repo.mkdir(parents=True)
    config = types.SimpleNamespace(
        provider="gitlab", default_branch="main", github_token=None,
        bitbucket_username=None, bitbucket_app_password=None,
    )
    monkeypatch.setattr(
        "src.job_queue.tasks._resolve_git_targets",
        lambda request, ws: ((config, [(None, repo)]), None),
    )
    holder: dict = {
        "gm": None, "known_refs": set(), "merge_fails": False,
        "push_pr_calls": [], "push_errors": [],
    }

    def _factory(**kwargs):
        gm = _FakeGitManager(
            known_refs=holder["known_refs"], merge_fails=holder["merge_fails"], **kwargs
        )
        holder["gm"] = gm
        return gm

    monkeypatch.setattr("src.job_queue.assembly.GitManager", _factory)

    # Push + MR go through apply_git_workflow (push_pr_only) — fake it here.
    def _fake_apply(gm, git_config, branch, commit_msg, pr_title=None, pr_body=None,
                    response_obj=None, *, commit_only=False,
                    checkout_back_to_default=False, push_pr_only=False,
                    error_label=None):
        holder["push_pr_calls"].append(
            {"branch": branch, "pr_title": pr_title, "push_pr_only": push_pr_only}
        )
        if holder["push_errors"]:
            response_obj.errors.extend(holder["push_errors"])
            return
        response_obj.pr_url = (
            "https://gitlab.example.com/mr/42" if pr_title is not None else None
        )

    monkeypatch.setattr("src.api.git_workflow.apply_git_workflow", _fake_apply)
    return repo, holder


def test_assemble_happy_path(wired, tmp_path):
    repo, holder = wired
    holder["known_refs"] = {
        "origin/main",
        "feature/2026-07-31-spec-a-uid1",
        "origin/feature/2026-07-31-spec-b-uid2",
    }
    result = assemble_run(_request(), str(tmp_path / "ws"))

    assert result["success"] is True
    assert result["branch"] == "db-migration/run1234"
    assert result["mr_url"] == "https://gitlab.example.com/mr/42"
    # Local ref preferred for spec-a; origin fallback for spec-b.
    assert result["merged_branches"] == [
        "feature/2026-07-31-spec-a-uid1",
        "origin/feature/2026-07-31-spec-b-uid2",
    ]
    assert result["overlaid_files"] == 3
    gm = holder["gm"]
    # Push + MR routed through apply_git_workflow(push_pr_only=True).
    assert holder["push_pr_calls"] == [
        {"branch": "db-migration/run1234", "pr_title":
         "DB migration pack — assembled run (2 specs)", "push_pr_only": True}
    ]
    assert gm.commits and gm.commits[0].startswith("Assemble DB migration pack")
    assert gm.default_checkouts == 1  # tree restored even on success
    # The overlay really landed on disk, BOM-free.
    manifest = (repo / "manifest.json").read_bytes()
    assert not manifest.startswith(b"\xef\xbb\xbf")


def test_missing_spec_branch_is_a_named_failure(wired, tmp_path):
    repo, holder = wired
    holder["known_refs"] = {"origin/main"}  # no spec branches at all
    with pytest.raises(AssemblyError, match="no branch found for spec"):
        assemble_run(_request(), str(tmp_path / "ws"))
    assert holder["push_pr_calls"] == []


def test_merge_conflict_aborts_and_fails(wired, tmp_path):
    repo, holder = wired
    holder["known_refs"] = {
        "origin/main",
        "feature/2026-07-31-spec-a-uid1",
        "feature/2026-07-31-spec-b-uid2",
    }
    holder["merge_fails"] = True
    with pytest.raises(AssemblyError, match="merge conflict"):
        assemble_run(_request(), str(tmp_path / "ws"))
    gm = holder["gm"]
    assert gm.aborted == 1  # the fake raises after recording the abort
    assert holder["push_pr_calls"] == []


def test_validation_failure_blocks_the_push(wired, tmp_path):
    repo, holder = wired
    holder["known_refs"] = {"origin/main", "feature/2026-07-31-spec-a-uid1",
                            "feature/2026-07-31-spec-b-uid2"}
    bad_master = GOOD_MASTER.replace(
        'file="changesets/000-schemas.sql"', 'file="changesets/050-translations.sql"'
    )
    request = _request(pack_files=[
        AssemblePackFile(path="liquibase/db.changelog-master.xml", content=bad_master),
        AssemblePackFile(path="liquibase/changesets/000-schemas.sql", content=GOOD_CHANGESET),
    ])
    with pytest.raises(AssemblyError, match="dangling include"):
        assemble_run(request, str(tmp_path / "ws"))
    assert holder["push_pr_calls"] == []


def test_push_failure_is_a_named_failure(wired, tmp_path):
    repo, holder = wired
    holder["known_refs"] = {"origin/main", "feature/2026-07-31-spec-a-uid1",
                            "feature/2026-07-31-spec-b-uid2"}
    holder["push_errors"] = ["Git push failed: 403"]
    with pytest.raises(AssemblyError, match="push/MR failed"):
        assemble_run(_request(), str(tmp_path / "ws"))


def test_unsafe_branch_name_is_rejected(wired, tmp_path):
    with pytest.raises(AssemblyError, match="branch name not safe"):
        assemble_run(_request(branch_name="-evil"), str(tmp_path / "ws"))


# ---------------------------------------------------------------------------
# run_assembly job wrapper
# ---------------------------------------------------------------------------


class _FakeStorage:
    def __init__(self, job):
        self.job = job

    def get_job(self, job_id):
        return self.job

    def save_job(self, job):
        self.job = job


def test_run_assembly_records_result(monkeypatch, tmp_path):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "src.job_queue.assembly.assemble_run",
        lambda request, ws: {"success": True, "branch": "b", "mr_url": "u",
                             "merged_branches": [], "overlaid_files": 0},
    )
    job = types.SimpleNamespace(
        job_id="j1", status=JobStatus.RUNNING, started_at=None, completed_at=None,
        result=None, error=None,
        request_payload=_request().model_dump(),
    )
    storage = _FakeStorage(job)

    run_assembly("j1", storage)

    assert storage.job.status == JobStatus.COMPLETED
    assert storage.job.result["branch"] == "b"


def test_run_assembly_records_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))

    def _boom(request, ws):
        raise AssemblyError("merge conflict assembling 'feature/x'")

    monkeypatch.setattr("src.job_queue.assembly.assemble_run", _boom)
    job = types.SimpleNamespace(
        job_id="j2", status=JobStatus.RUNNING, started_at=None, completed_at=None,
        result=None, error=None,
        request_payload=_request().model_dump(),
    )
    storage = _FakeStorage(job)

    run_assembly("j2", storage)

    assert storage.job.status == JobStatus.FAILED
    assert "merge conflict" in storage.job.error
