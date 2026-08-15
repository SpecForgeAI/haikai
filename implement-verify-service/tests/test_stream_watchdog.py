"""GuardedProcess stall watchdog (2026-08-15).

Pins the fix for the overnight spec deaths: a CLI child whose stdout pipe
goes silent (dead-but-unreaped wsl.exe holding it open) must NOT hang the
step forever — the tree is killed and a retry-classified StreamStallError
is raised, so the orchestrator's bounded step retry finally applies.

Uses REAL python child processes (no mocks) so the pipe/thread semantics
are the production ones.
"""
import subprocess
import sys
import time

import pytest

from src.chat.stream_watchdog import (
    GuardedProcess,
    StreamStallError,
    stream_stall_timeout_seconds,
)
from src.chat.transient_failure import classify_step_failure, FAILURE_CLASS_TRANSIENT


def _spawn(code: str) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-u", "-c", code],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace",
    )


class TestHappyPath:
    def test_lines_stderr_and_returncode_flow_through(self):
        guard = GuardedProcess(
            _spawn(
                "import sys;"
                "print('line-1'); print('line-2');"
                "sys.stderr.write('warn-1\\n')"
            ),
            label="test-cli",
            stall_timeout_s=30,
        )
        lines = [ln.strip() for ln in guard.stdout]
        assert lines == ["line-1", "line-2"]
        assert guard.wait(timeout=30) == 0
        assert guard.returncode == 0
        # stderr was drained CONCURRENTLY; read() returns the text.
        time.sleep(0.2)
        assert "warn-1" in guard.stderr.read()

    def test_large_stderr_no_longer_deadlocks(self):
        # Pre-fix: >64KB of stderr filled the OS pipe buffer while the parent
        # blocked on stdout — a mutual pipe deadlock. The concurrent drain
        # makes this complete promptly.
        guard = GuardedProcess(
            _spawn(
                "import sys;"
                "sys.stderr.write('x' * 300000);"
                "print('done')"
            ),
            label="test-cli",
            stall_timeout_s=30,
        )
        lines = [ln.strip() for ln in guard.stdout]
        assert lines == ["done"]
        assert guard.wait(timeout=30) == 0
        time.sleep(0.2)
        assert len(guard.stderr.read()) >= 300000

    def test_wait_is_bounded_and_kills_a_lingering_child(self):
        # A child that never exits: the pre-fix bare wait() would block for
        # the full sleep; the guarded wait kills the tree at the bound.
        guard = GuardedProcess(
            _spawn("import time; time.sleep(120)"),
            label="test-cli",
            stall_timeout_s=30,
        )
        start = time.monotonic()
        guard.wait(timeout=2)
        assert time.monotonic() - start < 60
        # The tree is dead: a follow-up wait returns immediately.
        assert guard.wait(timeout=10) is not None


class TestStall:
    def test_silent_pipe_raises_retry_classified_stall_error(self):
        # One line, then eternal silence WITH the pipe held open — the exact
        # overnight death shape.
        guard = GuardedProcess(
            _spawn("import time; print('alive'); time.sleep(600)"),
            label="kiro-cli",
            stall_timeout_s=2,
        )
        it = iter(guard.stdout)
        assert next(it).strip() == "alive"
        start = time.monotonic()
        with pytest.raises(StreamStallError) as exc:
            next(it)
        # The stall fired at ~the deadline, not after the child's sleep.
        assert time.monotonic() - start < 60
        # The tree was killed (the child cannot outlive the stall).
        assert guard.wait(timeout=30) is not None
        # The message classifies as TRANSIENT — the orchestrator's bounded
        # step retry applies instead of a permanent silent hang.
        assert classify_step_failure([str(exc.value)]) == FAILURE_CLASS_TRANSIENT
        assert "stream stalled" in str(exc.value)
        assert "timed out" in str(exc.value)
        assert guard.stalled is True


class TestStderrLiveness:
    def test_stderr_activity_defers_the_stall_kill(self):
        # A child that is stdout-silent but STREAMS stderr (maven-style
        # progress) is alive — it must NOT be killed as stalled (2026-08-15).
        guard = GuardedProcess(
            _spawn(
                "import sys, time\n"
                "print('alive')\n"
                "for _ in range(30):\n"
                "    sys.stderr.write('progress\\n'); sys.stderr.flush()\n"
                "    time.sleep(0.2)\n"
                "print('done')\n"
            ),
            label="test-cli",
            stall_timeout_s=2,  # far below the ~6s stdout gap
        )
        lines = [ln.strip() for ln in guard.stdout]  # no StreamStallError
        assert lines == ["alive", "done"]
        assert guard.wait(timeout=30) == 0

    def test_total_silence_on_both_pipes_still_kills(self):
        guard = GuardedProcess(
            _spawn("import time; print('alive'); time.sleep(600)"),
            label="test-cli",
            stall_timeout_s=2,
        )
        it = iter(guard.stdout)
        assert next(it).strip() == "alive"
        with pytest.raises(StreamStallError):
            next(it)


class TestStderrTailFlush:
    def test_stderr_read_right_after_wait_sees_the_final_burst(self):
        # The failure-classification shape (2026-08-15): the child writes its
        # diagnosis to stderr in the FINAL burst and exits non-zero; the
        # caller does wait() then stderr.read() immediately. The read must
        # join the drain so the transient signature is never lost to a race.
        for _ in range(5):  # scheduling-dependent pre-fix — hammer it
            guard = GuardedProcess(
                _spawn(
                    "import sys;"
                    "sys.stderr.write('InternalServerException: throttled\\n');"
                    "sys.exit(3)"
                ),
                label="test-cli",
                stall_timeout_s=30,
            )
            list(guard.stdout)
            guard.wait(timeout=30)
            text = guard.stderr.read()  # NO sleep — the join does the flush
            assert "InternalServerException" in text
            assert classify_step_failure([text]) == FAILURE_CLASS_TRANSIENT


class TestDoubleTimeoutWait:
    def test_unreapable_child_raises_transient_stall_error(self, monkeypatch):
        # Simulate a child that survives even the post-kill re-wait: wait()
        # must RAISE (message carrying "timed out" -> transient retry), not
        # silently return -1 while .returncode stays None ("exited with code
        # None" carried no transient signature).
        guard = GuardedProcess(
            _spawn("print('x')"),
            label="test-cli",
            stall_timeout_s=30,
        )
        list(guard.stdout)

        def _always_timeout(timeout=None):
            raise subprocess.TimeoutExpired(cmd="test-cli", timeout=timeout or 0)

        monkeypatch.setattr(guard._process, "wait", _always_timeout)
        with pytest.raises(StreamStallError) as exc:
            guard.wait(timeout=1)
        assert "timed out" in str(exc.value)
        assert classify_step_failure([str(exc.value)]) == FAILURE_CLASS_TRANSIENT


class TestConfig:
    def test_env_default_and_override(self, monkeypatch):
        monkeypatch.delenv("STREAM_STALL_TIMEOUT_SECONDS", raising=False)
        assert stream_stall_timeout_seconds() == 1800
        monkeypatch.setenv("STREAM_STALL_TIMEOUT_SECONDS", "300")
        assert stream_stall_timeout_seconds() == 300
        monkeypatch.setenv("STREAM_STALL_TIMEOUT_SECONDS", "junk")
        assert stream_stall_timeout_seconds() == 1800
