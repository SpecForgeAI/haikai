"""HaiboxClient — request-timeout vs readiness (G7), logs (G1), error mapping."""

from __future__ import annotations

import pytest

from src.haibox.client import HaiboxClient, HaiboxError


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = b"{}"
        self.text = str(self._payload)

    def json(self):
        return self._payload


def test_serve_request_timeout_exceeds_readiness(monkeypatch):
    # G7: a long readiness_timeout must not be cut off by the client's own timeout.
    captured = {}

    def fake_request(method, url, **kw):
        captured.update(kw)
        return _Resp(201, {"box_id": "b", "base_url": "http://127.0.0.1:1"})

    monkeypatch.setattr("requests.request", fake_request)
    HaiboxClient(base_url="http://x", api_key="k").serve(["cmd"], readiness_timeout=120)
    assert captured["timeout"] >= 135  # readiness + buffer


def test_logs_returns_log_string(monkeypatch):
    monkeypatch.setattr("requests.request",
                        lambda *a, **k: _Resp(200, {"box_id": "b", "log": "hello-from-box"}))
    assert HaiboxClient(base_url="http://x").logs("b") == "hello-from-box"


def test_error_status_raises_haiboxerror(monkeypatch):
    monkeypatch.setattr("requests.request", lambda *a, **k: _Resp(429, {"detail": "at capacity"}))
    with pytest.raises(HaiboxError) as ei:
        HaiboxClient(base_url="http://x").list()
    assert "at capacity" in str(ei.value)


def test_bearer_header_set_when_key_present(monkeypatch):
    seen = {}

    def fake_request(method, url, **kw):
        seen.update(kw.get("headers") or {})
        return _Resp(200, {"boxes": []})

    monkeypatch.setattr("requests.request", fake_request)
    HaiboxClient(base_url="http://x", api_key="secret").list()
    assert seen.get("Authorization") == "Bearer secret"
