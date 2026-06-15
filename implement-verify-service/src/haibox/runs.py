"""haibox run manager — async ephemeral execution with durable, observable runs.

The crabbox "run a suite" half: submit a command, get a run_id back immediately,
the command executes in the background, stdout/stderr stream to a log, and the
exit code is captured. Run records are persisted to SQLite so they're pollable
and survive a service restart (the observability gap) — a run left `running`
when the service died is recovered as `interrupted`.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone

from .backends import Backend
from .models import Run, RunSpec, RunState
from .registry import CapacityError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


class RunStore:
    """SQLite-backed durable run records. Connect-per-op (thread-safe enough for
    a local control plane); IMMEDIATE so concurrent writers serialize cleanly."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._init()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, isolation_level="IMMEDIATE", timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS runs ("
                " run_id TEXT PRIMARY KEY, name TEXT, command TEXT, backend TEXT, state TEXT,"
                " exit_code INTEGER, log_path TEXT, error TEXT,"
                " created_at TEXT, started_at TEXT, finished_at TEXT)"
            )

    def save(self, run: Run) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO runs (run_id,name,command,backend,state,exit_code,log_path,error,"
                "created_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(run_id) DO UPDATE SET state=excluded.state,"
                " exit_code=excluded.exit_code, log_path=excluded.log_path,"
                " error=excluded.error, started_at=excluded.started_at,"
                " finished_at=excluded.finished_at",
                (run.run_id, run.spec.name, json.dumps(run.spec.command), run.backend,
                 run.state.value, run.exit_code, run.log_path, run.error,
                 _iso(run.created_at), _iso(run.started_at), _iso(run.finished_at)),
            )

    def all_rows(self) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM runs ORDER BY created_at")]

    def mark_interrupted_on_startup(self) -> list[dict]:
        """Any run still queued/running when we start was orphaned by a previous
        service death. Mark it interrupted; return rows (for workdir cleanup)."""
        with self._conn() as c:
            rows = [dict(r) for r in c.execute(
                "SELECT * FROM runs WHERE state IN ('queued','running')")]
            c.execute("UPDATE runs SET state='interrupted', finished_at=?"
                      " WHERE state IN ('queued','running')", (_iso(_now()),))
        return rows

    def delete(self, run_id: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM runs WHERE run_id = ?", (run_id,))


class RunManager:
    def __init__(self, backend, work_root: str, store: RunStore,
                 max_concurrent: int = 8, poll: float = 0.25, default: str | None = None) -> None:
        # Single backend (back-compat) OR a {name: backend} map + default, mirroring
        # Registry — each run routes to the backend it was submitted with.
        if isinstance(backend, dict):
            self.backends: dict[str, Backend] = dict(backend)
            self.default_backend = default or next(iter(self.backends))
        else:
            self.backends = {backend.name: backend}
            self.default_backend = backend.name
        self.work_root = work_root
        self.store = store
        self.max_concurrent = max_concurrent
        self.poll = poll
        self._runs: dict[str, Run] = {}
        self._lock = threading.RLock()
        self._recover()

    @property
    def backend(self) -> Backend:
        """The DEFAULT backend (back-compat for direct reads)."""
        return self.backends[self.default_backend]

    def _backend_for(self, run: Run) -> Backend:
        return self.backends.get(run.backend, self.backend)

    # ── recovery on startup (durability + observability across restart) ──
    def _row_to_run(self, row: dict) -> Run:
        try:
            command = json.loads(row["command"]) if row.get("command") else "(unknown)"
        except (ValueError, TypeError):
            command = row.get("command") or "(unknown)"
        spec = RunSpec(command=command, name=row.get("name"))
        run = Run(run_id=row["run_id"], spec=spec, backend=row.get("backend") or "?",
                  state=RunState(row["state"]), exit_code=row.get("exit_code"),
                  log_path=row.get("log_path"), error=row.get("error"))
        for attr in ("created_at", "started_at", "finished_at"):
            val = row.get(attr)
            if val:
                try:
                    setattr(run, attr, datetime.fromisoformat(val))
                except ValueError:
                    pass
        return run

    def _recover(self) -> None:
        """Load persisted runs back into memory so they stay pollable after a
        restart; mark any that were mid-flight (process gone) as interrupted and
        reclaim their workdirs."""
        import shutil
        from pathlib import Path
        interrupted = {r["run_id"] for r in self.store.mark_interrupted_on_startup()}
        for row in self.store.all_rows():
            run = self._row_to_run(row)
            if row["run_id"] in interrupted:
                run.state = RunState.INTERRUPTED
                if run.log_path:  # orphaned workdir from the dead session
                    shutil.rmtree(Path(run.log_path).parent, ignore_errors=True)
            self._runs[run.run_id] = run

    # ── queries ──────────────────────────────────────────────────────────
    def get(self, run_id: str) -> Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def list(self) -> list[Run]:
        with self._lock:
            return list(self._runs.values())

    def _active(self) -> int:
        return sum(1 for r in self._runs.values()
                   if r.state in (RunState.QUEUED, RunState.RUNNING))

    def read_log(self, run: Run, max_bytes: int = 1_000_000) -> str:
        # Live run -> route to its backend with the real handle (docker needs the
        # container id; local uses log_path). Restart-recovered run (no handle) ->
        # local log_path fallback.
        handle = run.handle or ({"log_path": run.log_path} if run.log_path else None)
        if not handle:
            return ""
        return self._backend_for(run).read_log(handle, max_bytes)

    # ── lifecycle ──────────────────────────────────────────────────────────
    def submit(self, spec: RunSpec, backend: str | None = None) -> Run:
        name = backend or self.default_backend
        if name not in self.backends:
            raise ValueError(f"unknown backend {name!r} (have {sorted(self.backends)})")
        run_id = "run-" + uuid.uuid4().hex[:12]
        with self._lock:
            if self._active() >= self.max_concurrent:
                raise CapacityError(f"at capacity ({self.max_concurrent} active runs)")
            run = Run(run_id=run_id, spec=spec, backend=name)
            self._runs[run_id] = run
        self.store.save(run)
        threading.Thread(target=self._execute, args=(run,), name=f"haibox-run-{run_id}",
                         daemon=True).start()
        return run

    def _execute(self, run: Run) -> None:
        be = self._backend_for(run)
        try:
            handle = be.start_run(run.run_id, run.spec, self.work_root)
        except Exception as exc:  # setup/spawn failure — tail is in the message
            with self._lock:
                run.state = RunState.FAILED
                run.error = str(exc)
                run.finished_at = _now()
            self.store.save(run)
            return
        with self._lock:
            run.handle = handle
            run.log_path = handle.get("log_path")
            run.state = RunState.RUNNING
            run.started_at = _now()
        self.store.save(run)

        deadline = time.monotonic() + run.spec.timeout_seconds
        while True:
            rc = be.returncode(handle)
            if rc is not None:
                with self._lock:
                    run.exit_code = rc
                    run.state = RunState.SUCCEEDED if rc == 0 else RunState.FAILED
                    run.finished_at = _now()
                break
            if time.monotonic() >= deadline:
                be.stop(handle)
                with self._lock:
                    run.state = RunState.TIMEOUT
                    run.error = f"exceeded timeout_seconds ({run.spec.timeout_seconds})"
                    run.finished_at = _now()
                break
            time.sleep(self.poll)
        self.store.save(run)  # workdir/log kept for retrieval until delete()

    def delete(self, run_id: str) -> bool:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                return False
        if run.handle:
            be = self._backend_for(run)
            be.stop(run.handle)
            be.cleanup(run.handle)
        self.store.delete(run_id)
        with self._lock:
            self._runs.pop(run_id, None)
        return True

    def shutdown(self) -> None:
        for run in self.list():
            if run.state == RunState.RUNNING and run.handle:
                self._backend_for(run).stop(run.handle)
