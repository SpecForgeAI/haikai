"""diff_json + replay_and_diff — the like-for-like reconciler."""

from __future__ import annotations

from src.verification.reconcile import diff_json, replay_and_diff


def test_diff_identical_is_clean():
    assert diff_json({"a": 1, "b": [1, 2]}, {"a": 1, "b": [1, 2]}) == []


def test_diff_exact_flags_changed_missing_and_extra():
    d = diff_json({"name": "View 2", "x": 1}, {"name": None, "y": 9}, match="exact")
    joined = " ".join(d)
    assert "name" in joined and "expected 'View 2'" in joined   # changed
    assert any("x" in s and "missing" in s for s in d)          # missing
    assert any(".y" in s and "unexpected" in s for s in d)      # extra (exact only)


def test_diff_subset_ignores_extra_keys():
    assert diff_json({"a": 1}, {"a": 1, "extra": 2}, match="subset") == []
    # but a real mismatch still shows
    assert diff_json({"a": 1}, {"a": 2}, match="subset")


def test_diff_list_length_and_elements():
    assert diff_json([1, 2], [1]) and "length" in " ".join(diff_json([1, 2], [1]))
    assert diff_json([1, 2], [1, 3])


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body
    @property
    def text(self):
        return str(self._body)


def test_replay_all_match_no_breaks(monkeypatch):
    routes = {
        "http://t/": _Resp(200, {"message": "Hello World"}),
        "http://t/items/42": _Resp(200, {"item_id": 42, "q": "x"}),
    }
    monkeypatch.setattr("httpx.request", lambda method, url, **k: routes[url])
    ops = [
        {"operation": "GET /", "request": {"path": "/"},
         "expected_response": {"status": 200, "json": {"message": "Hello World"}}},
        {"operation": "GET /items/42", "request": {"path": "/items/42"},
         "expected_response": {"status": 200, "json": {"item_id": 42, "q": "x"}}},
    ]
    assert replay_and_diff("http://t", ops) == []


def test_replay_reports_break_on_mismatch(monkeypatch):
    monkeypatch.setattr("httpx.request",
                        lambda method, url, **k: _Resp(200, {"message": "Goodbye"}))
    ops = [{"operation": "GET /", "request": {"path": "/"},
            "expected_response": {"status": 200, "json": {"message": "Hello World"}}}]
    breaks = replay_and_diff("http://t", ops)
    assert len(breaks) == 1
    assert breaks[0]["operation"] == "GET /"
    assert any("Hello World" in d for d in breaks[0]["diff"])
    assert breaks[0]["actual"]["status"] == 200


def test_replay_status_mismatch_is_a_break(monkeypatch):
    monkeypatch.setattr("httpx.request", lambda method, url, **k: _Resp(500, {}))
    ops = [{"request": {"path": "/x"}, "expected_response": {"status": 200}}]
    breaks = replay_and_diff("http://t", ops)
    assert len(breaks) == 1 and any("status" in d for d in breaks[0]["diff"])
