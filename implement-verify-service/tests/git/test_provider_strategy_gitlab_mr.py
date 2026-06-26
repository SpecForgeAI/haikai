"""GitLab merge-request creation (the filled-in stub). Offline real test of the
no-token guard; the live POST is exercised by the connector seam tests.
"""

import pytest

from src.git.provider_strategy import GitLabStrategy, GitProviderStrategyError


def test_create_pull_request_without_token_raises():
    strat = GitLabStrategy(token=None)
    with pytest.raises(GitProviderStrategyError):
        strat.create_pull_request(
            "https://gitlab.com/group/proj",
            title="t", branch="feat", base_branch="main", body="b",
        )


def test_create_pull_request_no_longer_a_stub():
    # Regression guard: it used to raise "not implemented yet" unconditionally,
    # even with a token. With a token it must attempt the real call instead.
    strat = GitLabStrategy(token="glpat-xxx")
    with pytest.raises(GitProviderStrategyError) as exc:
        # Unroutable host → RequestError → GitProviderStrategyError (a real
        # network attempt was made, proving it's no longer a hardcoded stub).
        strat.create_pull_request(
            "https://gitlab.invalid.localhost/group/proj",
            title="t", branch="feat", base_branch="main", body="b",
        )
    assert "not implemented" not in str(exc.value).lower()
