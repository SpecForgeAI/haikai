"""Anti-SSRF + signing for the outbound bug callback (predict C1)."""

from __future__ import annotations

import hashlib
import hmac
import json

import pytest

from src.verification import callback as cb


class TestUrlValidation:
    def test_rejects_non_https_by_default(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_INSECURE", raising=False)
        with pytest.raises(cb.CallbackRejected):
            cb.validate_callback_url("http://example.com/cb")

    def test_rejects_loopback_and_metadata(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        for url in ("https://127.0.0.1/cb", "https://localhost/cb", "https://169.254.169.254/latest"):
            with pytest.raises(cb.CallbackRejected):
                cb.validate_callback_url(url)

    def test_rejects_private_rfc1918(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        with pytest.raises(cb.CallbackRejected):
            cb.validate_callback_url("https://10.0.0.5/cb")

    def test_allows_public_https(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        # 8.8.8.8 is public — validation passes (no network call made here)
        cb.validate_callback_url("https://8.8.8.8/cb")

    def test_private_allowed_in_dev_mode(self, monkeypatch):
        monkeypatch.setenv("SX_CALLBACK_ALLOW_PRIVATE", "1")
        monkeypatch.setenv("SX_CALLBACK_ALLOW_INSECURE", "1")
        cb.validate_callback_url("http://localhost:9000/cb")  # no raise


class TestAllowlistedHost:
    # S1: the co-located Haikai is reachable at http://127.0.0.1:<port>. A
    # server-set host allowlist exempts it from the https + private-host checks
    # WITHOUT a blanket SSRF disable.
    def test_allowlisted_loopback_http_is_delivered(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        monkeypatch.delenv("SX_CALLBACK_ALLOW_INSECURE", raising=False)
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "127.0.0.1, haikai.internal")
        cb.validate_callback_url("http://127.0.0.1:8792/build-results")  # no raise
        cb.validate_callback_url("http://haikai.internal:9000/cb")       # no raise

    def test_offlist_private_host_still_rejected(self, monkeypatch):
        # Only the named hosts are exempt — a different private host is still SSRF.
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "127.0.0.1")
        for url in ("https://10.0.0.5/cb", "https://169.254.169.254/latest", "http://192.168.1.9/cb"):
            with pytest.raises(cb.CallbackRejected):
                cb.validate_callback_url(url)

    def test_public_host_unaffected_by_allowlist(self, monkeypatch):
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "127.0.0.1")
        cb.validate_callback_url("https://8.8.8.8/cb")  # still fine

    def test_empty_allowlist_is_noop(self, monkeypatch):
        monkeypatch.delenv("SX_CALLBACK_ALLOW_PRIVATE", raising=False)
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "")
        with pytest.raises(cb.CallbackRejected):
            cb.validate_callback_url("http://127.0.0.1:8792/cb")


class _Resp:
    status_code = 200


class TestPost:
    def test_rejected_url_returns_false_no_request(self, monkeypatch):
        sent = {"n": 0}
        monkeypatch.setattr(cb.requests if hasattr(cb, "requests") else __import__("requests"),
                            "post", lambda *a, **k: sent.__setitem__("n", sent["n"] + 1) or _Resp())
        assert cb.post_callback("https://127.0.0.1/cb", {"x": 1}) is False
        assert sent["n"] == 0

    def test_signs_body_and_disables_redirects(self, monkeypatch):
        monkeypatch.setenv("SX_CALLBACK_ALLOW_PRIVATE", "1")
        monkeypatch.setenv("SX_CALLBACK_SIGNING_SECRET", "shh")
        captured = {}
        import requests
        def fake_post(url, data=None, headers=None, timeout=None, allow_redirects=None):
            captured.update(url=url, data=data, headers=headers, allow_redirects=allow_redirects)
            return _Resp()
        monkeypatch.setattr(requests, "post", fake_post)
        ok = cb.post_callback("https://10.0.0.9/cb", {"bugId": "b1", "status": "success"})
        assert ok is True
        assert captured["allow_redirects"] is False
        expected = "sha256=" + hmac.new(b"shh", captured["data"], hashlib.sha256).hexdigest()
        assert captured["headers"]["X-SX-Signature"] == expected
        assert json.loads(captured["data"])["bugId"] == "b1"

    def test_service_token_header_rides_along_when_configured(self, monkeypatch):
        # 2026-07-28 live: the Haikai gateway's build-results door fail-closes
        # without a matching token — the first callback ever delivered came
        # back 401. SX_CALLBACK_SERVICE_TOKEN must ride as X-Service-Token.
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "localhost")
        monkeypatch.setenv("SX_CALLBACK_SERVICE_TOKEN", "shared-secret")
        monkeypatch.delenv("SX_CALLBACK_SIGNING_SECRET", raising=False)
        captured = {}
        import requests
        def fake_post(url, data=None, headers=None, timeout=None, allow_redirects=None):
            captured.update(url=url, headers=headers)
            return _Resp()
        monkeypatch.setattr(requests, "post", fake_post)

        ok = cb.post_callback(
            "http://localhost:8081/api/implementation/build-results", {"job_id": "j1"}
        )

        assert ok is True
        assert captured["headers"]["X-Service-Token"] == "shared-secret"

    def test_no_token_header_when_unconfigured(self, monkeypatch):
        monkeypatch.setenv("SX_CALLBACK_ALLOWED_HOSTS", "localhost")
        monkeypatch.delenv("SX_CALLBACK_SERVICE_TOKEN", raising=False)
        captured = {}
        import requests
        def fake_post(url, data=None, headers=None, timeout=None, allow_redirects=None):
            captured.update(headers=headers)
            return _Resp()
        monkeypatch.setattr(requests, "post", fake_post)

        cb.post_callback("http://localhost:8081/cb", {"job_id": "j1"})

        assert "X-Service-Token" not in captured["headers"]
