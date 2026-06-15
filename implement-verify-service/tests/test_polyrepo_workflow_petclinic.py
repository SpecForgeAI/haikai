"""End-to-end workflow integration test: petclinic pair → polyrepo session.

Walks the *full implemented spine* from `POST /projects/init` through the
orchestrator session-build step, against the real petclinic pair:

  spring-petclinic-rest (Java/Spring/OpenAPI)
  spring-petclinic-vue  (Vue 3/TS/axios wrapper)

What this covers:

* **Phase 1 + 2** — real two-repo init produces an on-disk product
  workspace with two `.git/` clones and a `coordination.yaml`.
* **Phase 4** — `_build_chat_executor` reads `coordination.yaml` and
  computes the per-folder `--add-dir` mount list. The resulting
  `ClaudeChatExecutor` is wired with `extra_dirs` containing both
  cloned repo paths. The CLI argv carries the extra mounts in
  alphabetical order.

What this does *not* cover (Phases 5/6/7 — blocked on OD-1/2/3):

* the LLM-driven `write-spec` step doesn't yet emit a per-repo
  `paths_touched` map (OD-1, OD-2);
* `create-tasks` doesn't yet emit `[@repo:<alias>]` annotations (OD-3);
* `implement-tasks` doesn't yet fan out `apply_git_workflow` per repo
  (consumer of OD-3).

A meaningful "shape-spec touches both repos → 2 PRs" test requires those
phases. This test demonstrates that the *spine* (clone, mount,
coordination) is wired correctly for them to plug into.

Gated by `RUN_NETWORK_TESTS=1` + `@pytest.mark.network` so the default
suite doesn't hit GitHub.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
os.environ.setdefault("GIT_PROVIDER", "github")
os.environ.setdefault("GITHUB_TOKEN", "petclinic-public-clone-no-auth-needed")
os.environ.setdefault("CHAT_EXECUTOR", "claude")

# Best-effort: set API_WORKSPACE_DIR before src.api import so if we're the
# *first* test module to load it, the API uses a clean tempdir. If another
# test module imported src.api first, its env value won wins instead — and
# we deliberately honour that below by re-pinning _WORKSPACE to the API's
# *actual* baked-in constant. This makes the two integration tests safe to
# run in any order together.
_WORKSPACE_REQUEST = Path(tempfile.mkdtemp(prefix="petclinic-workflow-"))
os.environ.setdefault("API_WORKSPACE_DIR", str(_WORKSPACE_REQUEST))

from fastapi.testclient import TestClient

from src.haikai_orchestrator import _build_chat_executor, _polyrepo_extra_dirs
from src.api import API_WORKSPACE_DIR as _WORKSPACE
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
    if _WORKSPACE.exists():
        shutil.rmtree(_WORKSPACE, ignore_errors=True)
    _WORKSPACE.mkdir(parents=True, exist_ok=True)
    yield
    shutil.rmtree(_WORKSPACE, ignore_errors=True)


def test_petclinic_workflow_spine(client):
    """Init both petclinic repos and verify the orchestrator session mounts
    the cloned repos correctly.

    This is the realistic boundary of what's testable post-Phase-4. The
    LLM-driven write-spec / create-tasks / implement-tasks fan-out
    requires Phases 5–7 (blocked on OD-1/2/3).
    """

    # ── Phase 1 + 2: real two-repo init ──────────────────────────────────
    resp = client.post(
        "/projects/init",
        json={
            "company": "spring-petclinic",
            "project": "petclinic",
            "repos": PETCLINIC_REPOS,
        },
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.json()
    init_payload = resp.json()
    assert init_payload["mode"] == "polyrepo"
    assert len(init_payload["repos"]) == 2

    product_root = _WORKSPACE / "spring-petclinic" / "petclinic"
    assert (product_root / "coordination.yaml").exists()
    assert (product_root / "backend" / ".git").exists()
    assert (product_root / "frontend" / ".git").exists()
    # Marker files matching analysis.md's description of the pair
    assert (product_root / "backend" / "pom.xml").exists()
    assert (product_root / "frontend" / "package.json").exists()

    # ── Phase 4: coordination.yaml round-trip → extra_dirs ──────────────
    coord = read_coordination(product_root)
    assert coord == PETCLINIC_REPOS

    extra_dirs = _polyrepo_extra_dirs(_WORKSPACE, "spring-petclinic", "petclinic")
    assert extra_dirs == [
        product_root / "backend",
        product_root / "frontend",
    ]

    # ── Phase 4: chat-executor build forwards extra_dirs ───────────────
    # Patch the shim so we can capture the kwargs without needing the
    # Claude CLI on disk. This is the same boundary the unit tests in
    # test_polyrepo_orchestrator.py poke; here we run it after real
    # clones have produced a real coordination.yaml.
    with patch(
        "src.backend_registry._build_claude_chat_executor_shim"
    ) as mock_shim:
        _build_chat_executor(
            company="spring-petclinic",
            project="petclinic",
            workspace_dir=_WORKSPACE,
            anthropic_api_key="sk-ant-test",
        )
        assert mock_shim.called, "chat-executor factory should have been invoked"
        kwargs = mock_shim.call_args.kwargs
        assert "extra_dirs" in kwargs
        assert kwargs["extra_dirs"] == extra_dirs, (
            f"extra_dirs mismatch — expected {extra_dirs}, got "
            f"{kwargs['extra_dirs']}"
        )

    # ── Phase 4: argv shape with the real cloned paths ────────────────
    # Bypass ClaudeChatExecutor.__init__ (which needs the Claude CLI on
    # disk) and exercise _build_cli_command directly with the cloned
    # paths to confirm the per-repo --add-dir flags actually land.
    from src.chat.claude_chat_executor import ClaudeChatExecutor

    exe = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
    exe.claude_cli_path = Path("/usr/local/bin/claude")
    exe.session_uuid = "petclinic-test-session"
    exe.project_dir = product_root
    exe.extra_dirs = list(extra_dirs)
    exe._haikai_profiles_path = lambda: _WORKSPACE / "_profiles"

    argv = exe._build_cli_command(
        prompt="/write-spec demo-spec touching both repos",
        is_new_session=True,
    )

    # Default mounts (project_dir + haikai-profiles) + 2 per-repo mounts
    assert argv.count("--add-dir") == 4
    cloned_backend = str(product_root / "backend").replace("\\", "/")
    cloned_frontend = str(product_root / "frontend").replace("\\", "/")
    assert cloned_backend in argv, "backend clone should be a --add-dir target"
    assert cloned_frontend in argv, "frontend clone should be a --add-dir target"

    # ── Re-init protection still works after the full workflow setup ──
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


def test_petclinic_workflow_phase567_gap_is_explicit(client):
    """Document the gap where Phases 5/6/7 plug in.

    With Phase 4 wiring the chat session at the product root, an LLM
    invoked against the petclinic pair *sees* both repos. What's missing:

    1. write-spec doesn't yet attribute changes to a specific repo
       (OD-1/OD-2 will fix this — Phase 5).
    2. create-tasks doesn't yet emit per-group `[@repo:<alias>]`
       annotations (OD-3 — Phase 6).
    3. implement-tasks doesn't yet loop `apply_git_workflow` per touched
       repo (Phase 7, consumer of OD-3).

    This test deliberately fails *only* if anyone claims those phases
    have landed when they haven't — by asserting the spec's tasks.md
    still flags them as BLOCKED. If/when the phases land, update the
    expected status string at the same time the task checkboxes flip.
    """
    tasks_md = (
        Path(__file__).resolve().parent.parent
        / "haikai"
        / "specs"
        / "2026-05-25-polyrepo-analysis"
        / "tasks.md"
    )
    assert tasks_md.exists()
    body = tasks_md.read_text(encoding="utf-8")
    # If these strings ever disappear, the test wants to know — either the
    # phases landed (great, update this guard) or the spec's status header
    # drifted (bad, restore the truth).
    assert "Phase 5: write-spec nearest-neighbour repo attribution  *— BLOCKED" in body
    assert "Phase 6: create-tasks repo annotation + cross-repo deps  *— BLOCKED" in body
    assert "Phase 7: implement-tasks fan-out  *— BLOCKED" in body
