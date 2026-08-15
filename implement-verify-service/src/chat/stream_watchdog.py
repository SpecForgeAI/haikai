"""Stall-guarded subprocess streaming (2026-08-15).

Root cause of two overnight job deaths (spec 8, then spec 4 — identical
mode): both CLI chat executors consumed the child's stdout with a BLOCKING,
UNBOUNDED ``for line in process.stdout`` and never drained stderr while
streaming. Failure chain observed live:

  1. the CLI (kiro inside WSL) dies or wedges mid-run; the Windows-side
     ``wsl.exe`` pipe holder survives, holding stdout OPEN but silent;
  2. the executor blocks forever on the pipe read — no timeout, no
     inactivity guard, no exception, so the step never "fails";
  3. the worker's heartbeat keeps beating (it proves the THREAD is alive,
     not the child), so startup recovery skips the job and the submit dedup
     hands every Resume the same corpse. Deadlock.

  (The undrained-stderr side is its own kill mode: a chatty CLI fills the
  OS stderr pipe buffer, the child blocks writing stderr while we block
  reading stdout — a classic mutual pipe deadlock, most likely on the
  LONGEST steps, which is exactly where both specs died.)

:class:`GuardedProcess` closes the whole class. It wraps a live ``Popen``:

  - a pump thread moves stdout lines into a queue; the consumer iterates
    with an INACTIVITY deadline (``STREAM_STALL_TIMEOUT_SECONDS``, default
    1800s of total silence). On stall the process TREE is killed and
    :class:`StreamStallError` is raised — whose message carries the
    "timed out" / "stream stalled" signatures ``transient_failure``
    classifies as retryable, so the orchestrator's existing bounded step
    retry (cool-off then re-run) finally gets to do its job;
  - a drain thread consumes stderr concurrently (deadlock class gone);
    ``.stderr.read()`` returns the drained text;
  - ``.wait()`` is BOUNDED (kill tree + return on overrun) — a lingering
    pipe holder can no longer hang the tail of a step.

Drop-in: exposes ``.stdout`` (iterable of lines), ``.stderr.read()``,
``.wait()``, ``.returncode``, ``.pid`` — the exact surface the executors
use, so call sites keep their shape.
"""

import logging
import os
import queue
import subprocess
import threading
from typing import Iterator, List, Optional

from src.job_queue.process_tracking import kill_tree

logger = logging.getLogger(__name__)

# Default: 30 minutes of TOTAL silence (no stdout line at all) kills the run.
# Long implement steps emit tool/progress lines continuously; half an hour of
# nothing is a wedged pipe, not thinking.
DEFAULT_STALL_TIMEOUT_SECONDS = 1800

# Bounded tail-wait after EOF/stall: a healthy child exits promptly once its
# stdout closes; a lingering wsl.exe gets killed instead of hanging the step.
DEFAULT_WAIT_TIMEOUT_SECONDS = 120


def stream_stall_timeout_seconds() -> int:
    """``STREAM_STALL_TIMEOUT_SECONDS`` (int, seconds), default 1800; 0/neg
    disables the guard (unbounded — NOT recommended, kept for escape hatch)."""
    raw = os.getenv("STREAM_STALL_TIMEOUT_SECONDS", str(DEFAULT_STALL_TIMEOUT_SECONDS))
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        logger.warning(
            "STREAM_STALL_TIMEOUT_SECONDS=%r is not numeric; using %s",
            raw, DEFAULT_STALL_TIMEOUT_SECONDS)
        return DEFAULT_STALL_TIMEOUT_SECONDS


class StreamStallError(RuntimeError):
    """Raised (after the tree is killed) when the child's stdout goes silent
    past the stall deadline. The message deliberately carries the transient
    signatures ("stream stalled", "timed out") so
    ``transient_failure.classify_step_failure`` marks the step retryable."""

    def __init__(self, label: str, stall_seconds: int, pid: Optional[int]):
        super().__init__(
            f"{label} stream stalled: no output for {stall_seconds}s "
            f"(timed out waiting on pid {pid}); process tree killed. "
            "The step can be retried."
        )


class _DrainedStderr:
    """`.stderr` shim: `.read()` returns the concurrently-drained text."""

    def __init__(self, guard: "GuardedProcess"):
        self._guard = guard

    def read(self) -> str:
        return self._guard.stderr_text()


_EOF = object()


class GuardedProcess:
    """Stall-guarded, drain-safe wrapper around a live ``Popen``."""

    def __init__(
        self,
        process: "subprocess.Popen",
        label: str = "cli",
        stall_timeout_s: Optional[int] = None,
    ):
        self._process = process
        self._label = label
        self._stall_timeout_s = (
            stream_stall_timeout_seconds() if stall_timeout_s is None else stall_timeout_s
        )
        self._queue: "queue.Queue" = queue.Queue()
        self._stderr_parts: List[str] = []
        self._stderr_lock = threading.Lock()
        self._stalled = False

        if process.stdout is not None:
            t = threading.Thread(target=self._pump_stdout, daemon=True)
            t.start()
        else:
            self._queue.put(_EOF)
        if process.stderr is not None:
            t = threading.Thread(target=self._drain_stderr, daemon=True)
            t.start()

        # Drop-in surface.
        self.stdout = self
        self.stderr = _DrainedStderr(self)

    # -- thread bodies ------------------------------------------------------

    def _pump_stdout(self) -> None:
        try:
            for line in self._process.stdout:  # type: ignore[union-attr]
                self._queue.put(line)
        except Exception:
            logger.debug("%s stdout pump ended with error", self._label, exc_info=True)
        finally:
            self._queue.put(_EOF)

    def _drain_stderr(self) -> None:
        try:
            for line in self._process.stderr:  # type: ignore[union-attr]
                with self._stderr_lock:
                    self._stderr_parts.append(line)
        except Exception:
            logger.debug("%s stderr drain ended with error", self._label, exc_info=True)

    # -- drop-in surface ----------------------------------------------------

    @property
    def pid(self) -> int:
        return self._process.pid

    @property
    def returncode(self):
        return self._process.returncode

    def __iter__(self) -> Iterator[str]:
        """Iterate stdout lines; raise :class:`StreamStallError` (after
        killing the tree) when the stall deadline passes with no line."""
        unbounded = self._stall_timeout_s <= 0
        while True:
            try:
                item = self._queue.get(
                    timeout=None if unbounded else self._stall_timeout_s
                )
            except queue.Empty:
                self._stalled = True
                logger.error(
                    "%s stream stalled (no output for %ss, pid=%s) — killing tree",
                    self._label, self._stall_timeout_s, self._process.pid,
                )
                kill_tree(self._process.pid)
                raise StreamStallError(
                    self._label, self._stall_timeout_s, self._process.pid
                )
            if item is _EOF:
                return
            yield item

    def stderr_text(self) -> str:
        # Give the drain thread a beat to flush the tail after exit.
        with self._stderr_lock:
            return "".join(self._stderr_parts).strip()

    def wait(self, timeout: Optional[float] = None):
        """BOUNDED wait (default {DEFAULT_WAIT_TIMEOUT_SECONDS}s): a healthy
        child exits promptly once stdout closes; a lingering pipe holder is
        killed rather than allowed to hang the step tail."""
        bound = DEFAULT_WAIT_TIMEOUT_SECONDS if timeout is None else timeout
        try:
            return self._process.wait(timeout=bound)
        except subprocess.TimeoutExpired:
            logger.error(
                "%s did not exit within %ss after stream end (pid=%s) — killing tree",
                self._label, bound, self._process.pid,
            )
            kill_tree(self._process.pid)
            try:
                return self._process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                return self._process.returncode if self._process.returncode is not None else -1

    def kill(self) -> None:
        kill_tree(self._process.pid)

    @property
    def stalled(self) -> bool:
        return self._stalled
