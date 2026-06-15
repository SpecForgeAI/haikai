"""Tests for src.git.models — ProjectInitRequest validation.

Covers Phase 1 of haikai/specs/2026-05-25-polyrepo-analysis/tasks.md
(T1.1, T1.2, T1.5, T1.6).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.git.models import ProjectInitRequest


# ── happy paths ──────────────────────────────────────────────────────────────


def test_repos_single_entry_accepted():
    req = ProjectInitRequest(
        company="acme",
        project="petclinic",
        repos={"app": "https://github.com/acme/app.git"},
    )
    assert req.repos == {"app": "https://github.com/acme/app.git"}
    assert req.repo_url is None


def test_repos_multi_entry_accepted():
    repos = {
        "backend": "https://github.com/acme/backend.git",
        "frontend": "https://github.com/acme/frontend.git",
        "shared": "git@github.com:acme/shared.git",
    }
    req = ProjectInitRequest(
        company="acme", project="petclinic", repos=repos
    )
    assert req.repos == repos


# ── legacy repo_url promotion (T1.2 / T1.6) ──────────────────────────────────


def test_legacy_repo_url_promoted_to_one_entry_map():
    req = ProjectInitRequest(
        company="acme",
        project="petclinic",
        repo_url="https://github.com/acme/petclinic.git",
    )
    # After model_validator, repos is populated keyed by project name
    assert req.repos == {
        "petclinic": "https://github.com/acme/petclinic.git",
    }


def test_legacy_repo_url_promotion_rejects_invalid_project_name():
    # Project name with capitals fails folder regex
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="PetClinic",  # capitals — not a valid folder alias
            repo_url="https://github.com/acme/petclinic.git",
        )
    assert "folder alias grammar" in str(ei.value)


def test_legacy_repo_url_promotion_rejects_invalid_url():
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repo_url="not-a-url",
        )
    assert "Invalid repo_url" in str(ei.value)


# ── both / neither (T1.6) ────────────────────────────────────────────────────


def test_both_repos_and_repo_url_rejected():
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repos={"app": "https://github.com/acme/app.git"},
            repo_url="https://github.com/acme/legacy.git",
        )
    assert "either 'repos' (preferred) or 'repo_url'" in str(ei.value)


def test_neither_repos_nor_repo_url_rejected():
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(company="acme", project="petclinic")
    assert "Must specify 'repos' or 'repo_url'" in str(ei.value)


# ── uniqueness (T1.1 / T1.5) ─────────────────────────────────────────────────


def test_duplicate_url_in_repos_rejected():
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repos={
                "backend": "https://github.com/acme/shared.git",
                "shared": "https://github.com/acme/shared.git",
            },
        )
    assert "Duplicate repo URL" in str(ei.value)


def test_empty_repos_map_rejected():
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repos={},
        )
    assert "at least one entry" in str(ei.value)


# ── folder grammar ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "bad_folder",
    [
        "Backend",  # capitals
        "1backend",  # starts with digit
        "back end",  # space
        "back.end",  # dot
        "back/end",  # slash
        "-backend",  # starts with dash
        "_backend",  # starts with underscore
        "",  # empty
    ],
)
def test_invalid_folder_alias_rejected(bad_folder):
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repos={bad_folder: "https://github.com/acme/app.git"},
        )
    assert "Invalid folder alias" in str(ei.value)


@pytest.mark.parametrize(
    "good_folder",
    ["app", "backend", "frontend-api", "shared_lib", "v2", "a", "a1b2c3"],
)
def test_valid_folder_aliases_accepted(good_folder):
    req = ProjectInitRequest(
        company="acme",
        project="petclinic",
        repos={good_folder: "https://github.com/acme/app.git"},
    )
    assert good_folder in req.repos


# ── URL well-formedness ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "good_url",
    [
        "https://github.com/acme/app.git",
        "http://gitlab.internal/group/app.git",
        "git@github.com:acme/app.git",
        "ssh://git@github.com/acme/app.git",
        "file:///tmp/repos/app.git",  # local-only origins supported since a56023b
    ],
)
def test_valid_urls_accepted(good_url):
    req = ProjectInitRequest(
        company="acme",
        project="petclinic",
        repos={"app": good_url},
    )
    assert req.repos["app"] == good_url


@pytest.mark.parametrize(
    "bad_url",
    [
        "not-a-url",
        "",
        "://nothing",
        "file://",  # file scheme requires a path (models.py: path must be present)
    ],
)
def test_invalid_urls_rejected(bad_url):
    with pytest.raises(ValidationError) as ei:
        ProjectInitRequest(
            company="acme",
            project="petclinic",
            repos={"app": bad_url},
        )
    assert "Invalid repo URL" in str(ei.value)
