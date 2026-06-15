"""Portable inter-process exclusive file lock (msvcrt on Windows, fcntl elsewhere).

Lifted from the per-ledger lock in pipeline/checks/ledger_write.py so other call
sites (e.g. the orchestration git phase, R8) can share one tested primitive."""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_TIMEOUT_S = 60.0


@contextmanager
def exclusive_lock(lock_path, timeout_s: float = DEFAULT_TIMEOUT_S):
    """Hold an inter-process exclusive lock on ``lock_path`` for the block.
    Sidecar lock file; msvcrt (Windows) / fcntl (POSIX). Raises TimeoutError on
    Windows if the lock can't be taken within ``timeout_s`` (POSIX flock blocks)."""
    lock_path = Path(lock_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR)
    try:
        if os.name == "nt":
            import msvcrt

            deadline = time.monotonic() + timeout_s
            while True:
                try:
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"lock timeout: {lock_path}")
                    time.sleep(0.05)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
