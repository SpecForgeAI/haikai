"""Integration test: polyrepo init against the spring-petclinic pair.

End-to-end exercise of Phase 2 (init route → N GitManager instances →
coordination.yaml) using *real* git clones, not mocks. The pair is the
one from `haikai/specs/2026-05-25-polyrepo-analysis/analysis.md`:
spring-petclinic-rest (Java/Spring Boot + OpenAPI) and
spring-petclinic-vue (Vue 3/TS + axios wrapper).

Closes T2.7 of `haikai/specs/2026-05-25-polyrepo-analysis/tasks.md`.

Slow + network-gated — only runs explicitly. The default test suite
should not hit GitHub. Invoke with::

    pytest tests/test_polyrepo_petclinic_integration.py -m network

or set ``RUN_NETWORK_TESTS=1`` and run normally.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Set env vars BEFORE importing the app module.
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
# load_git_config requires GIT_PROVIDER + GITHUB_TOKEN. Public petclinic
# clones don't need a real token — the bare URL works fine — but the
# config loader refuses to construct itself without a non-empty value.
os.environ.setdefault("GIT_PROVIDER", "github")
os.environ.setdefault("GITHUB_TOKEN", "petclinic-public-clone-no-auth-needed")
# Use a dedicated workspace so this test can't pollute API_WORKSPACE_DIR.
# Use setdefault — if another test module imported src.api first, its env
# value wins. We re-pin _PETCLINIC_WORKSPACE below to the API's actual
# baked-in constant so assertions don't drift apart from where files
# actually land.
_PETCLINIC_WORKSPACE_REQUEST = Path(
    tempfile.mkdtemp(prefix="petclinic-poly-")
)
os.environ.setdefault("API_WORKSPACE_DIR", str(_PETCLINIC_WORKSPACE_REQUEST))

from fastapi.testclient import TestClient

from src.api import API_WORKSPACE_DIR as _PETCLINIC_WORKSPACE
from src.api import app
from src.git.coordination import read_coordination

AUTH = {"Authorization": "Bearer test-key"}

PETCLINIC_REPOS = {
    "backend": "https://github.com/spring-petclinic/spring-petclinic-rest.git",
    "frontend": "https://github.com/spring-petclinic/spring-petclinic-vue.git",
}


pytestmark = [
    pytest.mark.network,
    pytest.mark.slow,
    pytest.mark.skipif(
        not os.getenv("RUN_NETWORK_TESTS"),
        reason="network test — set RUN_NETWORK_TESTS=1 to enable",
    ),
]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean_workspace():
    """Wipe and recreate the dedicated petclinic workspace per test."""
    if _PETCLINIC_WORKSPACE.exists():
        shutil.rmtree(_PETCLINIC_WORKSPACE, ignore_errors=True)
    _PETCLINIC_WORKSPACE.mkdir(parents=True, exist_ok=True)
    yield
    shutil.rmtree(_PETCLINIC_WORKSPACE, ignore_errors=True)


def test_petclinic_pair_init_end_to_end(client):
    """Real two-repo init against the petclinic pair."""
    resp = client.post(
        "/projects/init",
        json={
            "company": "spring-petclinic",
            "project": "petclinic",
            "repos": PETCLINIC_REPOS,
        },
        headers=AUTH,
        # Real clones take a while; give the test client a generous timeout.
        # FastAPI's TestClient doesn't expose a single timeout knob — the
        # underlying request goes synchronously through the route, so the
        # subprocess `git clone` calls block here directly.
    )
    assert resp.status_code == 200, resp.json()
    data = resp.json()

    # Top-level shape
    assert data["success"] is True
    assert data["mode"] == "polyrepo"
    assert len(data["repos"]) == 2

    # Per-repo entries — sorted by folder alias (Phase 2 contract)
    folders = [r["folder"] for r in data["repos"]]
    assert folders == ["backend", "frontend"]
    for entry in data["repos"]:
        assert entry["mode"] == "brownfield", entry  # both are real repos

    # On-disk: product root + two repo sub-dirs + coordination.yaml
    product_root = _PETCLINIC_WORKSPACE / "spring-petclinic" / "petclinic"
    assert product_root.exists()
    assert (product_root / "coordination.yaml").exists()

    backend_dir = product_root / "backend"
    frontend_dir = product_root / "frontend"
    assert backend_dir.exists()
    assert frontend_dir.exists()
    assert (backend_dir / ".git").exists()
    assert (frontend_dir / ".git").exists()

    # Sanity check the cloned content matches the pair from analysis.md.
    # spring-petclinic-rest is a Maven project — `pom.xml` is at the root.
    assert (backend_dir / "pom.xml").exists()
    # spring-petclinic-vue is a Vue/Node project — `package.json` is at the root.
    assert (frontend_dir / "package.json").exists()

    # coordination.yaml content round-trips through read_coordination
    coord = read_coordination(product_root)
    assert coord == PETCLINIC_REPOS

    # Re-init protection: a second call returns 400 with the right gate.
    resp2 = client.post(
        "/projects/init",
        json={
            "company": "spring-petclinic",
            "project": "petclinic",
            "repos": PETCLINIC_REPOS,
        },
        headers=AUTH,
    )
    assert resp2.status_code == 400
    assert "already initialised" in resp2.json()["detail"].lower()
