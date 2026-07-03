"""Run Flow Graph API (D8) — real router + real store via TestClient.

Covers: bearer auth, run list, snapshot shape, at_seq replay equals the
prefix fold (the D7 invariant through the HTTP surface), and SSE framing
with from_seq resume.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.verification import flow_graph as fg
from src.verification import recorder

BEARER = "graph-key"
RUN = "orch-api"
SPEC = "add-numbers"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", BEARER)
    import src.api.routes.runs as runs
    app = FastAPI()
    app.include_router(runs.router)
    return TestClient(app)


def _seed():
    conn = fg.connect()
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")
    recorder.advance(conn, RUN, SPEC)
    conn.close()


def _get(client, path, **params):
    return client.get(path, params=params,
                      headers={"Authorization": f"Bearer {BEARER}"})


def test_bearer_required(client):
    assert client.get(f"/api/v2/runs/{RUN}/graph").status_code in (401, 403)
    assert client.get("/api/v2/runs").status_code in (401, 403)


def test_list_runs(client):
    _seed()
    r = _get(client, "/api/v2/runs")
    assert r.status_code == 200
    runs = r.json()["runs"]
    assert [x["run_id"] for x in runs] == [RUN]
    assert runs[0]["events"] > 0


def test_snapshot_shape_and_states(client):
    _seed()
    snap = _get(client, f"/api/v2/runs/{RUN}/graph").json()
    assert snap["run"]["root_node_id"] == f"run/{RUN}"
    assert snap["states"][fg.gate_node_id(RUN, SPEC)]["state"] == "pass"
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert snap["states"][att]["state"] == "pass"  # re-folded by attempt 2
    assert "evidence_summary" in snap and "edges" in snap


def test_at_seq_replay_equals_prefix_fold(client):
    """D7 through the HTTP surface: ?at_seq=n == fold(events[..n])."""
    _seed()
    conn = fg.connect()
    events = fg.events_since(conn, RUN)
    conn.close()
    for n in (0, len(events) // 2, len(events)):
        at = events[n - 1]["seq"] if n else 0
        via_api = _get(client, f"/api/v2/runs/{RUN}/graph", at_seq=at).json()
        assert via_api == fg.fold_events(RUN, events[:n])


def _serve(app):
    """Real uvicorn on an ephemeral port in a daemon thread — the repo's
    proven pattern for streaming endpoints (TestClient buffers/hangs on an
    unbounded SSE generator; a real server + a read-timeout client doesn't)."""
    import socket
    import threading
    import time

    import uvicorn

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port,
                                           log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    return server, f"http://127.0.0.1:{port}"


def _stream_frames(base: str, want: int, **params) -> list[str]:
    import httpx

    frames: list[str] = []
    buf = ""
    with httpx.stream("GET", f"{base}/api/v2/runs/{RUN}/graph",
                      params={"stream": "true", **params},
                      headers={"Authorization": f"Bearer {BEARER}"},
                      timeout=10) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for chunk in r.iter_text():
            buf += chunk
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                if frame.strip():
                    frames.append(frame)
            if len(frames) >= want:
                return frames
    return frames


def test_sse_stream_frames_and_resume(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", BEARER)
    _seed()
    from fastapi import FastAPI

    import src.api.routes.runs as runs
    app = FastAPI()
    app.include_router(runs.router)
    server, base = _serve(app)
    try:
        frames = _stream_frames(base, 5, from_seq=0)
        first = frames[0].splitlines()
        assert first[0].startswith("id: ")
        assert first[1].startswith("event: graph_")
        data = json.loads(first[2][len("data: "):])
        assert data["protocol_version"] == fg.PROTOCOL_VERSION
        assert data["run_id"] == RUN
        # resume: from_seq past the first frame skips it
        first_seq = int(first[0][4:])
        frames2 = _stream_frames(base, 1, from_seq=first_seq)
        assert int(frames2[0].splitlines()[0][4:]) > first_seq
    finally:
        server.should_exit = True
