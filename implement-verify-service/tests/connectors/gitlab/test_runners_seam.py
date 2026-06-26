"""Real-seam tests — drive python-gitlab against a live throwaway gitlab.com
project. No mocks: these exercise the actual HTTP seam per the no-mock policy.

They auto-skip unless creds are present (same idea as the repo's `real_llm`
auto-skip). To run them, set:

    GITLAB_TEST_TOKEN   personal access token for a throwaway gitlab.com account
    GITLAB_TEST_URL     (optional) base URL; defaults to gitlab.com
    GITLAB_TEST_RUNNER  (optional) a runner id you own, for the pause/resume round-trip
"""

import os

import pytest

from src.connectors.gitlab import runners
from src.connectors.gitlab.client import build_client

pytestmark = pytest.mark.skipif(
    not os.getenv("GITLAB_TEST_TOKEN"),
    reason="set GITLAB_TEST_TOKEN to run the live gitlab.com seam tests",
)


@pytest.fixture
def gl():
    return build_client(
        token=os.environ["GITLAB_TEST_TOKEN"],
        url=os.getenv("GITLAB_TEST_URL"),
    )


def test_list_runners_returns_dicts(gl):
    result = runners.list_runners(gl=gl)
    assert isinstance(result, list)
    for r in result:
        assert "id" in r and "status" in r


def test_pause_then_resume_round_trip(gl):
    runner_id = os.getenv("GITLAB_TEST_RUNNER")
    if not runner_id:
        pytest.skip("set GITLAB_TEST_RUNNER (a runner id you own) for the round-trip")
    rid = int(runner_id)
    paused = runners.pause_runner(rid, confirm=True, gl=gl)
    assert paused["paused"] is True
    resumed = runners.resume_runner(rid, gl=gl)
    assert resumed["paused"] is False
