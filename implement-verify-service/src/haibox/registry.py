"""haibox in-memory registry — owns box lifetime independently of any caller.

This is the "coordinator" role, shrunk to one machine: it holds the set of live
boxes, enforces a concurrency cap, and reaps boxes past their TTL/idle deadline.
Thread-safe because the FastAPI endpoints run in a threadpool.

State is intentionally in-memory: a single-machine dev runner doesn't need a
durable lease DB. If you ever need restart-survival, persist `Box.to_public()`
rows — but that's a backend/scale concern, not a today concern.
"""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Callable

from .backends import Backend, wait_healthy
from .models import Box, BoxSpec, BoxState


class CapacityError(RuntimeError):
    """The concurrency cap is reached — caller should back off / 429."""


class LaunchError(RuntimeError):
    """The box was launched but never became healthy (already torn down)."""


class Registry:
    def __init__(self, backend, work_root: str, max_boxes: int = 8,
                 default: str | None = None) -> None:
        # Accept a single backend (back-compat) OR a {name: backend} map. A lone
        # backend wraps into a one-entry map so every per-box op routes uniformly.
        if isinstance(backend, dict):
            self.backends: dict[str, Backend] = dict(backend)
            self.default_backend = default or next(iter(self.backends))
        else:
            self.backends = {backend.name: backend}
            self.default_backend = backend.name
        self.work_root = work_root
        self.max_boxes = max_boxes
        self._boxes: dict[str, Box] = {}
        self._lock = threading.RLock()

    @property
    def backend(self) -> Backend:
        """The DEFAULT backend — back-compat for callers/tests that read
        `registry.backend` (e.g. /healthz, _build_run_manager)."""
        return self.backends[self.default_backend]

    def _backend_for(self, box: Box) -> Backend:
        """Route a per-box op to the backend the box was created with."""
        return self.backends.get(box.backend, self.backend)

    def sweep_orphans(self) -> list[str]:
        """Reclaim orphans across ALL registered backends (pids + containers)."""
        swept: list[str] = []
        for be in self.backends.values():
            try:
                swept += be.sweep_orphans(self.work_root)
            except Exception:  # noqa: BLE001 — best-effort startup cleanup
                pass
        return swept

    # ── queries ──────────────────────────────────────────────────────────
    def get(self, box_id: str) -> Box | None:
        with self._lock:
            return self._boxes.get(box_id)

    def list(self) -> list[Box]:
        with self._lock:
            return list(self._boxes.values())

    def _active_count(self) -> int:
        return sum(1 for b in self._boxes.values()
                   if b.state in (BoxState.STARTING, BoxState.READY))

    def touch(self, box_id: str, now: datetime | None = None) -> Box | None:
        with self._lock:
            box = self._boxes.get(box_id)
            if box:
                box.touch(now)
            return box

    # ── lifecycle ────────────────────────────────────────────────────────
    def create(self, spec: BoxSpec, backend: str | None = None) -> Box:
        """Reserve a slot, launch via the CHOSEN backend (arg or the default),
        wait until healthy.

        On readiness failure the box is terminated and a LaunchError is raised
        — a half-up target never lingers. Raises CapacityError when full.
        """
        name = backend or self.default_backend
        if name not in self.backends:
            raise ValueError(f"unknown backend {name!r} (have {sorted(self.backends)})")
        be = self.backends[name]
        box_id = "box-" + uuid.uuid4().hex[:12]
        with self._lock:
            if self._active_count() >= self.max_boxes:
                raise CapacityError(
                    f"at capacity ({self.max_boxes} active boxes); release one first"
                )
            box = Box(box_id=box_id, spec=spec, backend=name)
            self._boxes[box_id] = box  # reserve the slot before the slow launch

        try:
            handle = be.launch(box_id, spec, self.work_root)
        except Exception as exc:  # launch itself blew up
            with self._lock:
                box.state = BoxState.FAILED
                box.error = f"launch failed: {exc}"
            raise LaunchError(box.error) from exc

        with self._lock:
            box.handle = handle
            box.base_url = handle.get("base_url")

        healthy = wait_healthy(
            box.base_url, spec,
            is_alive=lambda: be.is_alive(box.handle),
            port=int(handle.get("port", 0)),
        )
        if not healthy:
            # G1: keep the workdir/log and capture the tail so the caller can see
            # WHY it failed (GET /boxes/{id}/logs, and box.error). stop() kills the
            # process but does NOT delete the workspace — the reaper/release cleans
            # it later by TTL.
            be.stop(handle)
            tail = be.read_log(box.handle, 4000)
            with self._lock:
                box.state = BoxState.FAILED
                box.error = ("target did not become healthy before readiness_timeout"
                             + (f"\nlog tail:\n{tail}" if tail else ""))
            raise LaunchError(box.error)

        with self._lock:
            box.state = BoxState.READY
            from datetime import datetime as _dt, timezone as _tz
            box.ready_at = _dt.now(_tz.utc)
            box.touch()
        return box

    def release(self, box_id: str) -> bool:
        """Terminate + drop a box. Returns False if unknown. Idempotent."""
        with self._lock:
            box = self._boxes.get(box_id)
            if not box:
                return False
        if box.handle:
            be = self._backend_for(box)
            be.stop(box.handle)
            be.cleanup(box.handle)
        with self._lock:
            box.state = BoxState.STOPPED
            self._boxes.pop(box_id, None)
        return True

    def read_log(self, box_id: str, max_bytes: int = 65536) -> str | None:
        """Tail of a box's combined stdout/stderr, or None if unknown (G1)."""
        box = self.get(box_id)
        if not box or not box.handle:
            return None
        return self._backend_for(box).read_log(box.handle, max_bytes)

    def reap(self, now: datetime | None = None) -> list[str]:
        """Terminate every box past its TTL/idle deadline OR whose process has
        died. Returns the reaped ids. Safe to call on a timer or by hand."""
        with self._lock:
            doomed = [
                b for b in self._boxes.values()
                if b.is_expired(now)
                or (b.state == BoxState.READY and not self._backend_for(b).is_alive(b.handle))
            ]
        reaped = []
        for box in doomed:
            if self.release(box.box_id):
                reaped.append(box.box_id)
        return reaped

    def shutdown(self) -> None:
        """Tear down everything (process exit / lifespan close)."""
        for box_id in [b.box_id for b in self.list()]:
            self.release(box_id)


def make_reaper(registry: Registry, interval: float = 15.0) -> Callable[[], None]:
    """A blocking reap loop for a background thread (the service starts one)."""
    stop = threading.Event()

    def _loop() -> None:
        while not stop.wait(interval):
            try:
                registry.reap()
            except Exception:  # a reaper must never die on one bad box
                pass

    _loop.stop = stop  # type: ignore[attr-defined]
    return _loop
