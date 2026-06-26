"""Offline, real (no-mock) tests for client construction, URL/token resolution,
and the destructive-action guard. None of these touch the network: `build_client`
does not authenticate, and `require_confirm` rejects before any client is built.
"""

import gitlab
import pytest

from src.connectors.gitlab.client import (
    ConfirmationRequired,
    GitLabConnectorError,
    build_client,
    require_confirm,
    resolve_base_url,
)


def test_base_url_defaults_to_gitlab_com(monkeypatch):
    monkeypatch.delenv("GITLAB_URL", raising=False)
    assert resolve_base_url() == "https://gitlab.com"


def test_base_url_from_env_self_hosted(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://gitlab.corp.internal/")
    assert resolve_base_url() == "https://gitlab.corp.internal"


def test_base_url_explicit_arg_overrides_env(monkeypatch):
    monkeypatch.setenv("GITLAB_URL", "https://env.example.com")
    assert resolve_base_url("https://explicit.example.com") == "https://explicit.example.com"


def test_base_url_rejects_non_http():
    with pytest.raises(GitLabConnectorError):
        resolve_base_url("ssh://gitlab.corp.internal")


def test_build_client_uses_url_and_token_without_network(monkeypatch):
    monkeypatch.delenv("GITLAB_URL", raising=False)
    client = build_client(token="glpat-xxx")
    assert isinstance(client, gitlab.Gitlab)
    assert client.url == "https://gitlab.com"
    assert client.private_token == "glpat-xxx"


def test_build_client_missing_token_raises(monkeypatch):
    monkeypatch.delenv("GITLAB_TOKEN", raising=False)
    monkeypatch.delenv("DEFAULT_GITLAB_TOKEN", raising=False)
    with pytest.raises(GitLabConnectorError):
        build_client()


def test_require_confirm_blocks_without_opt_in():
    with pytest.raises(ConfirmationRequired):
        require_confirm("delete runner 1", False)


def test_require_confirm_passes_with_opt_in():
    require_confirm("delete runner 1", True)  # must not raise
