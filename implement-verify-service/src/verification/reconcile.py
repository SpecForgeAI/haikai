"""Replay + diff — the reconciler, runnable on THIS side.

Like-for-like migration check: replay captured operations against a deployed
target and compare each response to the expected (current-state oracle) one. Any
difference is a *break*. This is the same comparison Haikai's reconciler does;
exposing it here lets Haikai EITHER replay itself (we just serve the target) OR
hand us the captured ops and have us replay (see run_haibox_verify `replay`).

Pure + dependency-light (httpx only) so it's unit-testable without a server.
"""

from __future__ import annotations

from typing import Any


def diff_json(expected: Any, actual: Any, match: str = "exact", path: str = "$") -> list[str]:
    """Structural diff of expected vs actual JSON. Returns human-readable
    difference descriptions (empty = identical under `match`).

    match="exact"  — any structural difference is a break (true like-for-like),
                     including keys present in actual but not expected.
    match="subset" — only the keys/values present in `expected` must match;
                     extra keys in actual are ignored (tolerant of additive change).
    """
    diffs: list[str] = []
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path}: expected object, got {type(actual).__name__}"]
        for k, ev in expected.items():
            kp = f"{path}.{k}"
            if k not in actual:
                diffs.append(f"{kp}: missing (expected {ev!r})")
            else:
                diffs += diff_json(ev, actual[k], match, kp)
        if match == "exact":
            for k in actual:
                if k not in expected:
                    diffs.append(f"{path}.{k}: unexpected (got {actual[k]!r})")
    elif isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{path}: expected array, got {type(actual).__name__}"]
        if len(expected) != len(actual):
            diffs.append(f"{path}: length expected {len(expected)} got {len(actual)}")
        for i, (ev, av) in enumerate(zip(expected, actual)):
            diffs += diff_json(ev, av, match, f"{path}[{i}]")
    else:
        if expected != actual:
            diffs.append(f"{path}: expected {expected!r} got {actual!r}")
    return diffs


def replay_and_diff(base_url: str, operations: list[dict], match: str = "exact",
                    timeout: float = 15.0) -> list[dict]:
    """Replay each captured operation against `base_url` and diff the response
    against its expected (oracle) response. Returns a list of BREAKS (empty =
    everything matched).

    Operation shape (tolerant):
        { "operation": "GET /api/x",                # optional label
          "request": {"method": "GET", "path": "/api/x", "headers": {}, "json": {}},
          "expected_response": {"status": 200, "json": {...}} }   # or "expected"
    """
    import httpx

    breaks: list[dict] = []
    for op in operations:
        req = op.get("request") or {}
        method = (req.get("method") or op.get("method") or "GET").upper()
        rel = req.get("path") or op.get("path") or "/"
        url = base_url.rstrip("/") + "/" + str(rel).lstrip("/")
        expected = op.get("expected_response") or op.get("expected") or {}
        label = op.get("operation") or f"{method} {rel}"
        try:
            resp = httpx.request(method, url, headers=req.get("headers"),
                                 json=req.get("json"), content=req.get("body"), timeout=timeout)
        except Exception as exc:
            breaks.append({"operation": label, "diff": [f"request failed: {exc}"]})
            continue
        try:
            actual_body: Any = resp.json()
        except Exception:
            actual_body = resp.text

        diffs: list[str] = []
        if expected.get("status") is not None and resp.status_code != expected["status"]:
            diffs.append(f"status: expected {expected['status']} got {resp.status_code}")
        if "json" in expected or "body" in expected:
            exp_body = expected.get("json", expected.get("body"))
            diffs += diff_json(exp_body, actual_body, match)
        if diffs:
            breaks.append({
                "operation": label,
                "expected": expected,
                "actual": {"status": resp.status_code, "body": actual_body},
                "diff": diffs,
            })
    return breaks
