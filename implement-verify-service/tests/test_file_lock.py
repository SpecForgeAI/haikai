"""Portable inter-process file lock (R8) — mutual exclusion + per-project keying."""

from __future__ import annotations

import threading
import time

import pytest

from src.file_lock import exclusive_lock


def test_exclusive_lock_serializes_holders(tmp_path):
    # Two threads contending for the same lock must NOT overlap in the critical
    # section — the second waits for the first to release.
    lock_path = tmp_path / "x.lock"
    order = []
    in_section = []
    overlap = []

    def worker(tag):
        with exclusive_lock(lock_path, timeout_s=10):
            in_section.append(tag)
            if len(in_section) > 1:
                overlap.append(tuple(in_section))
            order.append(tag)
            time.sleep(0.2)
            in_section.remove(tag)

    t1 = threading.Thread(target=worker, args=("a",))
    t2 = threading.Thread(target=worker, args=("b",))
    t1.start(); time.sleep(0.02); t2.start()
    t1.join(); t2.join()
    assert overlap == [], f"critical sections overlapped: {overlap}"
    assert sorted(order) == ["a", "b"]  # both ran, one after the other


def test_lock_released_after_block(tmp_path):
    lock_path = tmp_path / "y.lock"
    with exclusive_lock(lock_path, timeout_s=5):
        pass
    # immediately re-acquirable (was released)
    with exclusive_lock(lock_path, timeout_s=5):
        pass


def test_project_git_lock_keys_by_company_project(tmp_path):
    from src.job_queue.tasks import _project_git_lock
    # Same (company, project) -> same lock file; serialized.
    a = _project_git_lock(str(tmp_path), "acme", "proj")
    b = _project_git_lock(str(tmp_path), "acme", "proj")
    # Distinct projects -> distinct lock files (no false contention).
    with a:
        # a held; a DIFFERENT project's lock is independently acquirable
        with _project_git_lock(str(tmp_path), "acme", "other"):
            pass
    with b:  # same key, re-acquirable once a released
        pass
