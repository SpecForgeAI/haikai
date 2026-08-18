"""SCL first-commit delivery tests (2026-08-18) — REAL git against temp repos
(the house idiom: tests/_realgit.py — no mocks of the git seam; every
assertion is a real repository effect).

Covers:
  * files written + committed as ONE commit with the given message, staged
    paths ONLY (seeded spec folders never swept in);
  * fail-closed contract (empty files / missing message / path traversal);
  * branch file hashes: sha256 over the exact committed bytes, manifest-derived
    path set, sidecar contents, missing-path -> sha256 None.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from src.job_queue.initial_commit import (
    InitialCommitError,
    collect_branch_file_hashes,
    write_initial_commit_files,
)


def run_git(args, cwd) -> str:
    # encoding="utf-8": commit messages carry non-ASCII (em-dash); the Windows
    # default cp1252 decode would mojibake the read-back.
    proc = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, encoding="utf-8"
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"git {' '.join(args)} failed [{proc.returncode}]:\n{proc.stdout}\n{proc.stderr}"
        )
    return proc.stdout


@pytest.fixture
def repo(tmp_path) -> Path:
    """A real single-repo product root: one base commit, identity configured."""
    root = tmp_path / "acme" / "shop"
    root.mkdir(parents=True)
    run_git(["init"], root)
    run_git(["config", "user.email", "svc@example.com"], root)
    run_git(["config", "user.name", "Implement Verify Service"], root)
    (root / "README.md").write_text("base\n", encoding="utf-8")
    run_git(["add", "-A"], root)
    run_git(["commit", "-m", "base"], root)
    return root


SUITE_FILE = "src/test/java/com/example/app/behaviour/FooBehaviourTest.java"
SUITE_CONTENT = "package com.example.app.behaviour;\n\nclass FooBehaviourTest {\n}\n"
MANIFEST_CONTENT = json.dumps(
    {"files": [{"path": SUITE_FILE, "sha256": "ignored-here"}]}, indent=2
) + "\n"


def test_writes_files_and_makes_one_commit_with_message(repo):
    # A seeded (uncommitted) spec folder must NOT ride the shipped commit.
    seeded = repo / "haikai" / "specs" / "s1" / "planning" / "requirements.md"
    seeded.parent.mkdir(parents=True)
    seeded.write_text("# seeded\n", encoding="utf-8")

    result = write_initial_commit_files(
        repo,
        [
            {"path": SUITE_FILE, "content": SUITE_CONTENT},
            {"path": "scl-suite-manifest.json", "content": MANIFEST_CONTENT},
        ],
        "SCL generated behaviour suite (red) — do not modify shipped tests",
    )

    assert (repo / SUITE_FILE).read_text(encoding="utf-8") == SUITE_CONTENT
    assert result["repo"] is None  # single-repo product root
    assert sorted(result["files"]) == sorted([SUITE_FILE, "scl-suite-manifest.json"])

    # Exactly ONE new commit, carrying the given message and ONLY the shipped
    # paths (the seeded requirements.md stays uncommitted).
    assert run_git(["rev-list", "--count", "HEAD"], repo).strip() == "2"
    assert (
        run_git(["log", "-1", "--pretty=%s"], repo).strip()
        == "SCL generated behaviour suite (red) — do not modify shipped tests"
    )
    committed = run_git(
        ["show", "--name-only", "--pretty=format:", "HEAD"], repo
    ).split()
    assert sorted(committed) == sorted([SUITE_FILE, "scl-suite-manifest.json"])
    status = run_git(["status", "--porcelain", "-uall"], repo)
    assert "haikai/specs/s1/planning/requirements.md" in status  # still uncommitted


def test_idempotent_on_resume_when_files_already_committed(repo):
    """A job re-created from its run branch already carries the shipped
    commit — the second delivery must be a no-op, never a git failure."""
    files = [{"path": SUITE_FILE, "content": SUITE_CONTENT}]
    first = write_initial_commit_files(repo, files, "shipped")
    again = write_initial_commit_files(repo, files, "shipped")
    assert again["commit_sha"] == first["commit_sha"]
    assert run_git(["rev-list", "--count", "HEAD"], repo).strip() == "2"  # base + one


def test_fail_closed_on_empty_files_and_missing_message(repo):
    with pytest.raises(InitialCommitError):
        write_initial_commit_files(repo, [], "msg")
    with pytest.raises(InitialCommitError):
        write_initial_commit_files(repo, [{"path": "a.txt", "content": "x"}], "  ")


def test_rejects_path_traversal(repo):
    with pytest.raises(InitialCommitError):
        write_initial_commit_files(
            repo, [{"path": "../outside.txt", "content": "x"}], "msg"
        )
    assert not (repo.parent / "outside.txt").exists()


def test_no_repo_target_is_an_error(tmp_path):
    bare = tmp_path / "acme" / "empty"
    bare.mkdir(parents=True)
    with pytest.raises(InitialCommitError):
        write_initial_commit_files(bare, [{"path": "a.txt", "content": "x"}], "msg")


def test_collect_branch_file_hashes_manifest_derived(repo):
    write_initial_commit_files(
        repo,
        [
            {"path": SUITE_FILE, "content": SUITE_CONTENT},
            {"path": "scl-suite-manifest.json", "content": MANIFEST_CONTENT},
            {"path": "scl-quarantine.json", "content": '{"version":1,"entries":[]}\n'},
        ],
        "SCL generated behaviour suite (red) — do not modify shipped tests",
    )
    branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], repo).strip()

    result = collect_branch_file_hashes(repo, branch)  # no explicit paths

    # Path set derived from the branch's manifest; sha over exact bytes.
    assert result["branch"] == branch
    assert result["hashes"] == [
        {
            "path": SUITE_FILE,
            "sha256": hashlib.sha256(SUITE_CONTENT.encode("utf-8")).hexdigest(),
        }
    ]
    assert json.loads(result["manifest"])["files"][0]["path"] == SUITE_FILE
    assert json.loads(result["quarantine"]) == {"version": 1, "entries": []}


def test_collect_branch_file_hashes_explicit_paths_and_missing(repo):
    write_initial_commit_files(
        repo, [{"path": SUITE_FILE, "content": SUITE_CONTENT}], "shipped"
    )
    branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"], repo).strip()

    result = collect_branch_file_hashes(
        repo, branch, [SUITE_FILE, "src/test/java/Absent.java"]
    )

    by_path = {h["path"]: h["sha256"] for h in result["hashes"]}
    assert by_path[SUITE_FILE] == hashlib.sha256(SUITE_CONTENT.encode("utf-8")).hexdigest()
    assert by_path["src/test/java/Absent.java"] is None
    assert result["manifest"] is None  # no manifest shipped in this repo
    assert result["quarantine"] is None
