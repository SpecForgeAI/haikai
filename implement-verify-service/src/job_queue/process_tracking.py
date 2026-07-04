"""Tracked-process kill + shared job liveness loop (spec v2 D13).

The job-OWNING process is the only killer: it spawned the CLI subprocess,
tracked its pid via JobStorage.track_process, and its liveness loop both
heartbeats the job and watches for CANCELLING. Cross-process, liveness is
heartbeat-based — a PID is meaningless (or dangerous) in another
container's namespace.

Kill idiom mirrors inline_runner._kill_tree: `taskkill /F /T` on Windows,
process-group kill on POSIX (executor spawns with start_new_session=True).
"""

import logging
import os
import signal
import subprocess
import sys
import time
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Beat this often; check for cancellation more often (cancel latency).
HEARTBEAT_INTERVAL_SECONDS = 30
CANCEL_POLL_SECONDS = 5


def kill_tree(pid: int) -> None:
    """Kill the full process tree rooted at `pid` (best-effort)."""
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, text=True, timeout=30,
            )
        else:
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            except PermissionError:
                os.kill(pid, signal.SIGKILL)
    except Exception:
        logger.warning("kill_tree(%s) failed", pid, exc_info=True)


def pid_alive(pid: int) -> bool:
    """Best-effort local liveness check for a pid THIS process may own."""
    if sys.platform == "win32":
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True, text=True, timeout=30,
        )
        return str(pid) in (out.stdout or "")
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def wait_dead(pid: int, timeout_s: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not pid_alive(pid):
            return True
        time.sleep(0.5)
    return not pid_alive(pid)


def job_liveness_loop(storage, job_id: str, stop: "threading.Event",
                      owner: str = "") -> None:
    """Heartbeat + cancel watchdog for one executing job.

    Runs in the OWNING process (worker or API-background). Beats every
    HEARTBEAT_INTERVAL_SECONDS; every CANCEL_POLL_SECONDS checks for
    CANCELLING and, if seen, kills the job's tracked process tree, waits
    for confirmed death, and marks the job CANCELLED (D13: cancel requests
    termination; reclaim follows only after liveness is cleared).
    """
    from .job_models import JobStatus

    last_beat = 0.0
    while not stop.wait(CANCEL_POLL_SECONDS):
        now = time.monotonic()
        if now - last_beat >= HEARTBEAT_INTERVAL_SECONDS:
            try:
                storage.beat(job_id)
                last_beat = now
            except Exception:
                logger.debug("heartbeat failed for %s", job_id, exc_info=True)
        try:
            job = storage.get_job(job_id)
            status = getattr(job, "status", None)
            status = status.value if hasattr(status, "value") else status
            if job and status == JobStatus.CANCELLING.value:
                pid = storage.tracked_pid(job_id)
                if pid is not None:
                    logger.info("job %s CANCELLING (%s): killing tracked tree pid=%s",
                                job_id, owner, pid)
                    kill_tree(pid)
                    wait_dead(pid)
                    storage.clear_process(job_id)
                # Confirm only after the tree is dead (or none was tracked —
                # interim lazy-cancel path: cooperative stop at boundaries).
                if pid is not None or storage.tracked_pid(job_id) is None:
                    storage.mark_cancelled(job_id)
                return
        except Exception:
            logger.warning("cancel watchdog error for %s", job_id, exc_info=True)
