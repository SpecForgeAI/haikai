"""HaiboxClient — a thin HTTP client for haiboxd.

Shared by the CLI (`src.haibox.cli`) and the verification worker, so there's one
place that knows the wire shape. Uses `requests` (already a dep).
"""

from __future__ import annotations

import os
from typing import Any, Optional


class HaiboxError(RuntimeError):
    pass


class HaiboxClient:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None,
                 timeout: float = 60.0) -> None:
        self.base_url = (base_url or os.getenv("HAIBOX_URL", "http://127.0.0.1:8780")).rstrip("/")
        self.api_key = api_key or os.getenv("STANDARDS_API_KEY", "")
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def _req(self, method: str, path: str, timeout: float | None = None, **kw) -> Any:
        import requests

        url = self.base_url + path
        try:
            resp = requests.request(method, url, headers=self._headers(),
                                    timeout=timeout or self.timeout, **kw)
        except requests.RequestException as exc:
            raise HaiboxError(f"haiboxd unreachable at {self.base_url}: {exc}") from exc
        if resp.status_code >= 400:
            detail = resp.text
            try:
                detail = resp.json().get("detail", detail)
            except Exception:
                pass
            raise HaiboxError(f"{method} {path} -> {resp.status_code}: {detail}")
        return resp.json() if resp.content else None

    # ── operations ───────────────────────────────────────────────────────
    def serve(self, command, *, setup=None, setup_timeout: float = 300.0,
              source_dir: str | None = None,
              env: dict | None = None, health_type: str = "http", health_path: str = "/",
              port_env: str = "PORT", readiness_timeout: float = 30.0,
              ttl_seconds: float = 1800.0, idle_seconds: float = 600.0,
              name: str | None = None, image: str | None = None,
              backend: str | None = None, host: str | None = None) -> dict:
        """Launch a box and block until it's healthy; returns its public record
        (with base_url). Raises HaiboxError on capacity/launch failure."""
        body = {
            "command": command, "setup": setup, "setup_timeout": setup_timeout,
            "source_dir": source_dir, "env": env or {},
            "health_type": health_type, "health_path": health_path, "port_env": port_env,
            "readiness_timeout": readiness_timeout, "ttl_seconds": ttl_seconds,
            "idle_seconds": idle_seconds, "name": name, "image": image, "backend": backend,
            "host": host,
        }
        # G7: the launch is synchronous server-side (up to setup_timeout +
        # readiness_timeout), so the request timeout MUST exceed it or the client
        # gives up early while the box keeps starting.
        req_timeout = max(self.timeout, setup_timeout + readiness_timeout + 15.0)
        return self._req("POST", "/boxes", json=body, timeout=req_timeout)

    def logs(self, box_id: str, tail: int = 65536) -> str:
        return self._req("GET", f"/boxes/{box_id}/logs", params={"tail": tail})["log"]

    # ── runs (async ephemeral execution) ─────────────────────────────────
    def submit_run(self, command, *, setup=None, setup_timeout: float = 300.0,
                   source_dir: str | None = None, env: dict | None = None,
                   timeout_seconds: float = 1800.0, name: str | None = None,
                   image: str | None = None, backend: str | None = None,
                   host: str | None = None) -> dict:
        """Submit a command/suite; returns IMMEDIATELY with a run record (run_id,
        state=queued). The command runs in the background."""
        body = {"command": command, "setup": setup, "setup_timeout": setup_timeout,
                "source_dir": source_dir, "env": env or {},
                "timeout_seconds": timeout_seconds, "name": name, "image": image,
                "backend": backend, "host": host}
        return self._req("POST", "/runs", json=body)

    def run_status(self, run_id: str) -> dict:
        return self._req("GET", f"/runs/{run_id}")

    def run_logs(self, run_id: str, tail: int = 1_000_000) -> str:
        return self._req("GET", f"/runs/{run_id}/logs", params={"tail": tail})["log"]

    def list_runs(self) -> list[dict]:
        return self._req("GET", "/runs")["runs"]

    def delete_run(self, run_id: str) -> None:
        self._req("DELETE", f"/runs/{run_id}")

    def run_and_wait(self, command, *, poll: float = 0.5, on_log=None, **spec) -> dict:
        """Submit a run and block until it's terminal; returns the final record
        (with exit_code). If on_log is given, it's called with each new log chunk
        as the run streams (a simple poll-delta, not SSE)."""
        import time as _time
        rec = self.submit_run(command, **spec)
        run_id = rec["run_id"]
        sent = 0
        while True:
            rec = self.run_status(run_id)
            if on_log:
                full = self.run_logs(run_id)
                if len(full) > sent:
                    on_log(full[sent:])
                    sent = len(full)
            if rec["state"] in ("succeeded", "failed", "timeout", "interrupted"):
                return rec
            _time.sleep(poll)

    def list(self) -> list[dict]:
        return self._req("GET", "/boxes")["boxes"]

    def inspect(self, box_id: str) -> dict:
        return self._req("GET", f"/boxes/{box_id}")

    def heartbeat(self, box_id: str) -> dict:
        return self._req("POST", f"/boxes/{box_id}/heartbeat")

    def release(self, box_id: str) -> None:
        self._req("DELETE", f"/boxes/{box_id}")

    def healthz(self) -> dict:
        return self._req("GET", "/healthz")
