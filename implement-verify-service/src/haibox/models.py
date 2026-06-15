"""haibox data model — backend-agnostic.

`BoxSpec` is what a caller asks for; `Box` is the registry record. Neither knows
anything about subprocesses, Docker, or SSH — that lives entirely in a Backend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


def _now() -> datetime:
    return datetime.now(timezone.utc)


class BoxState(str, Enum):
    STARTING = "starting"   # launched, not yet health-green
    READY = "ready"         # serving; base_url is replay-able
    FAILED = "failed"       # never became healthy (terminated, kept for inspection)
    STOPPED = "stopped"     # torn down (released or reaped)


# Health-check kinds a backend-agnostic prober understands.
HEALTH_HTTP = "http"
HEALTH_TCP = "tcp"


@dataclass
class BoxSpec:
    """What to run and how to know it's ready.

    `command` is the process to start; the allocated port is injected into the
    environment as `port_env` (default PORT) so the target binds it. Health is a
    transport-agnostic readiness probe against the resulting base_url.
    """

    command: list[str] | str
    setup: list[str] | str | None = None   # optional build/deps step run BEFORE command (must exit 0)
    setup_timeout: float = 300.0           # hard cap on the setup step (N2: an unbounded build can't hang launch)
    source_dir: str | None = None          # copied into the box workdir; None = bare workdir
    env: dict[str, str] = field(default_factory=dict)
    port_env: str = "PORT"
    health_type: str = HEALTH_HTTP         # "http" | "tcp"
    health_path: str = "/"                 # for http
    readiness_timeout: float = 30.0        # seconds to reach ready before failing
    ttl_seconds: float = 1800.0            # hard lifetime cap
    idle_seconds: float = 600.0            # reaped if untouched this long
    name: str | None = None                # optional human label
    image: str | None = None               # container image — REQUIRED by the docker backend,
                                            # ignored by the local-subprocess backend
    host: str | None = None                 # ssh target (user@host[:port]) — REQUIRED by the
                                            # remote-ssh backend, ignored by local/docker

    def __post_init__(self) -> None:
        if not self.command:
            raise ValueError("BoxSpec.command is required")
        if self.health_type not in (HEALTH_HTTP, HEALTH_TCP):
            raise ValueError(f"unknown health_type {self.health_type!r}")
        if self.readiness_timeout <= 0 or self.ttl_seconds <= 0 or self.idle_seconds <= 0:
            raise ValueError("timeouts/ttl/idle must be positive")


class RunState(str, Enum):
    QUEUED = "queued"           # accepted, not yet started
    RUNNING = "running"         # command executing
    SUCCEEDED = "succeeded"     # exited 0
    FAILED = "failed"           # exited non-zero (or never started)
    TIMEOUT = "timeout"         # exceeded timeout_seconds, killed
    INTERRUPTED = "interrupted" # service restarted while running (exit unknown)

    @property
    def terminal(self) -> bool:
        return self in (RunState.SUCCEEDED, RunState.FAILED, RunState.TIMEOUT, RunState.INTERRUPTED)


@dataclass
class RunSpec:
    """An ephemeral command/suite to execute on a box (crabbox-style): run it,
    stream stdout/stderr, capture the exit code. No long-lived server, no port."""

    command: list[str] | str
    setup: list[str] | str | None = None
    setup_timeout: float = 300.0
    source_dir: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    timeout_seconds: float = 1800.0       # hard cap on the run; killed past this
    name: str | None = None
    image: str | None = None              # container image — REQUIRED by the docker backend
    host: str | None = None               # ssh target — REQUIRED by the remote-ssh backend

    def __post_init__(self) -> None:
        if not self.command:
            raise ValueError("RunSpec.command is required")
        if self.timeout_seconds <= 0 or self.setup_timeout <= 0:
            raise ValueError("timeouts must be positive")


@dataclass
class Run:
    """Durable record of one ephemeral execution."""

    run_id: str
    spec: RunSpec
    backend: str
    state: RunState = RunState.QUEUED
    exit_code: int | None = None
    handle: dict[str, Any] = field(default_factory=dict)
    log_path: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    def to_public(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "name": self.spec.name,
            "command": self.spec.command,
            "backend": self.backend,
            "state": self.state.value,
            "exit_code": self.exit_code,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


@dataclass
class Box:
    """Registry record for one running (or finished) box."""

    box_id: str
    spec: BoxSpec
    backend: str
    state: BoxState = BoxState.STARTING
    base_url: str | None = None
    handle: dict[str, Any] = field(default_factory=dict)  # backend-private (pid/workdir/container id…)
    error: str | None = None
    created_at: datetime = field(default_factory=_now)
    ready_at: datetime | None = None
    last_touched_at: datetime = field(default_factory=_now)

    def touch(self, now: datetime | None = None) -> None:
        self.last_touched_at = now or _now()

    def expires_at(self) -> datetime:
        """TTL cap OR idle timeout, whichever is sooner (the crabbox formula)."""
        from datetime import timedelta

        ttl_deadline = self.created_at + timedelta(seconds=self.spec.ttl_seconds)
        idle_deadline = self.last_touched_at + timedelta(seconds=self.spec.idle_seconds)
        return min(ttl_deadline, idle_deadline)

    def is_expired(self, now: datetime | None = None) -> bool:
        return (now or _now()) >= self.expires_at()

    def to_public(self) -> dict[str, Any]:
        """JSON-safe view for API responses — never leaks backend internals
        beyond what a caller needs (port/workdir are operational, not secret)."""
        return {
            "box_id": self.box_id,
            "name": self.spec.name,
            "backend": self.backend,
            "state": self.state.value,
            "base_url": self.base_url,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "ready_at": self.ready_at.isoformat() if self.ready_at else None,
            "last_touched_at": self.last_touched_at.isoformat(),
            "expires_at": self.expires_at().isoformat(),
        }
