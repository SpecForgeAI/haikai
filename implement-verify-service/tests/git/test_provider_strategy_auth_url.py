"""
Regression test for the GitHub push-auth URL construction bug (Bug 3).

`GitHubStrategy.build_authenticated_url` once returned
`https://<token>@host/path.git` -- the token in the *username* slot with no
password. git then tried to prompt for a password, which dies with
"could not read Password ... No such device or address" on `git push` in a
headless container (no TTY). Clone of a *public* repo worked only because public
reads need no auth; push does.

The fix puts the token in the *password* slot (`x-access-token:<token>`) so the
credential is complete and git never prompts. The load-bearing assertion is that
the authenticated URL carries BOTH a username and a password.
"""

from urllib.parse import urlsplit

import pytest

from src.git.provider_strategy import GitHubStrategy


TOKEN = "github_pat_EXAMPLE0000"


def test_authenticated_url_supplies_both_username_and_password():
    url = GitHubStrategy(TOKEN).build_authenticated_url("https://github.com/owner/repo")
    parts = urlsplit(url)
    # The fix: both halves present, so git does NOT prompt for a password.
    assert parts.username, "missing username -> git would prompt"
    assert parts.password == TOKEN, "token must live in the password slot"
    assert parts.hostname == "github.com"
    assert "owner/repo" in parts.path


def test_not_the_old_prompt_inducing_form():
    # The original bug: token as the bare username with an empty password.
    parts = urlsplit(
        GitHubStrategy(TOKEN).build_authenticated_url("https://github.com/owner/repo")
    )
    assert parts.password is not None, "empty password -> git prompts -> push fails headless"
    assert parts.username != TOKEN, "token must not be the bare username"


def test_no_token_returns_url_unchanged():
    url = "https://github.com/owner/repo"
    assert GitHubStrategy(None).build_authenticated_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "git@github.com:owner/repo.git",
        "ssh://git@github.com/owner/repo.git",
        "file:///tmp/repo",
    ],
)
def test_non_https_urls_returned_unchanged(url):
    # Token injection is only meaningful for https; ssh/file are left alone.
    assert GitHubStrategy(TOKEN).build_authenticated_url(url) == url
