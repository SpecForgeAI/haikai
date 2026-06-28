"""Heartbeat liveness: a running job a live worker owns stamps a heartbeat;
recovery skips it (only genuinely-orphaned jobs — no/stale heartbeat — are
recovered). This is the fix for recovery racing a live worker and wrongly
marking an in-flight job failed.
"""

from src.api.recovery import RECOVERY_STALE_SECONDS
from src.job_queue.job_storage import JobStorage
from src.job_queue.worker import HEARTBEAT_INTERVAL_SECONDS


def test_beat_and_age_roundtrip(tmp_path):
    s = JobStorage(str(tmp_path / "jobs.db"))
    assert s.heartbeat_age_seconds("j1") is None      # never beat
    s.beat("j1")
    age = s.heartbeat_age_seconds("j1")
    assert age is not None and age < 5                # fresh


def test_stale_threshold_exceeds_heartbeat_interval():
    # recovery must wait longer than the worker's beat interval before declaring
    # a job orphaned, or it would recover live jobs between beats.
    assert RECOVERY_STALE_SECONDS > HEARTBEAT_INTERVAL_SECONDS


def test_recovery_skip_condition(tmp_path):
    s = JobStorage(str(tmp_path / "jobs.db"))
    s.beat("live")
    live_age = s.heartbeat_age_seconds("live")
    # exactly recovery's predicate: fresh heartbeat -> skip (leave to the worker)
    assert live_age is not None and live_age < RECOVERY_STALE_SECONDS
    # a genuinely orphaned job has no heartbeat -> NOT skipped (gets recovered)
    assert s.heartbeat_age_seconds("orphan") is None
