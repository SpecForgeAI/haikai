"""Real-seam tests for the project-scoped areas (pipelines, MRs, environments).

No mocks — these hit a live GitLab project. They auto-skip unless BOTH a token
and a project are provided:

    GITLAB_TEST_TOKEN     PAT (api scope)
    GITLAB_TEST_PROJECT   a project id or 'group/name' path you can read
    GITLAB_TEST_URL       (optional) base URL; defaults to gitlab.com

Only read-only LIST verbs run here, so they're safe against any project (they
return [] for an empty project, which still proves the call + normalization).
"""

import os

import pytest

from src.connectors.gitlab import environments, merge_requests, pipelines
from src.connectors.gitlab.client import build_client

pytestmark = pytest.mark.skipif(
    not (os.getenv("GITLAB_TEST_TOKEN") and os.getenv("GITLAB_TEST_PROJECT")),
    reason="set GITLAB_TEST_TOKEN and GITLAB_TEST_PROJECT to run live project-seam tests",
)


@pytest.fixture
def gl():
    return build_client(token=os.environ["GITLAB_TEST_TOKEN"], url=os.getenv("GITLAB_TEST_URL"))


@pytest.fixture
def project():
    return os.environ["GITLAB_TEST_PROJECT"]


def test_list_pipelines(gl, project):
    assert isinstance(pipelines.list_pipelines(project, gl=gl), list)


def test_list_merge_requests(gl, project):
    assert isinstance(merge_requests.list_merge_requests(project, gl=gl), list)


def test_list_environments(gl, project):
    assert isinstance(environments.list_environments(project, gl=gl), list)
