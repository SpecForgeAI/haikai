"""Tests for the verification store (D2) + the 5 guarded recorder tools (D10.1).

Every guard has a refusal test, and the count==0 write-path guard asserts the
recorder is the ONLY module writing the guarded tables (CLAUDE.md convention).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from src.verification import recorder, store

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


@pytest.fixture
def conn(tmp_path):
    c = store.connect(str(tmp_path / "verify.db"))
    yield c
    c.close()


CELL = dict(orchestrate_id="orch-1", task_group_id="g1")


class TestConnect:
    def test_busy_timeout_set_and_wal_dropped(self, tmp_path):
        # R5: busy_timeout fixes the instant-lock; WAL was dropped (no -wal sidecars).
        c = store.connect(str(tmp_path / "c.db"))
        try:
            assert c.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
            assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal"
        finally:
            c.close()

    def test_sentinel_is_the_last_created_table(self):
        # R6: the schema-present sentinel must be the LAST CREATE in SCHEMA, so it
        # can't go true mid-executescript for a concurrent connection.
        creates = re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", store.SCHEMA)
        assert store._SCHEMA_SENTINEL == creates[-1]

    def test_incomplete_schema_is_completed_not_skipped(self, tmp_path):
        # R6: an early table present but the sentinel absent (the partial-batch
        # state a racing connection could observe) must trigger a full re-run —
        # the old 'verdicts' sentinel would have skipped and left later tables missing.
        import sqlite3
        p = str(tmp_path / "partial.db")
        raw = sqlite3.connect(p)
        raw.execute("CREATE TABLE verdicts (id INTEGER)")  # an early table only
        raw.commit(); raw.close()
        conn = store.connect(p)
        try:
            assert conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name=?", (store._SCHEMA_SENTINEL,)
            ).fetchone(), "schema not completed — later tables missing (R6)"
        finally:
            conn.close()


class TestStore:
    def test_binding_unique_per_sha_provider(self, conn):
        assert store.record_binding(conn, "sha1", "github", "orch-1", "g1", "app")
        assert not store.record_binding(conn, "sha1", "github", "orch-2", "g9", "app")  # refused
        assert store.record_binding(conn, "sha1", "gitlab", "orch-1", "g1", "app")  # other provider OK
        binding = store.lookup_binding(conn, "sha1", "github")
        assert binding["task_group_id"] == "g1"

    def test_delivery_dedup(self, conn):
        assert store.record_delivery(conn, "github", "d-123")
        assert not store.record_delivery(conn, "github", "d-123")  # replay

    def test_events_append_and_read(self, conn):
        store.append_event(conn, "orch-1", "g1", "verdict_recorded", {"x": 1})
        store.append_event(conn, "orch-1", "g1", "advanced")
        events = store.events_since(conn, "orch-1")
        assert [e["kind"] for e in events] == ["verdict_recorded", "advanced"]
        assert store.events_since(conn, "orch-1", after_id=events[0]["id"]) == events[1:]


class TestSupersedeIfPending:
    def test_supersedes_pending_then_is_idempotent(self, conn):
        recorder.record_verdict(conn, **CELL, repo="svc", verifier="reconciliation",
                                verdict="pending", detail={"box_id": "box-1"})
        rec, box = recorder.supersede_pending(conn, **CELL, repo="svc",
                                                 verifier="reconciliation", verdict="pass")
        assert rec is True and box == "box-1"
        # cell now terminal -> a retry is a no-op (R1/C7), no box returned
        rec2, box2 = recorder.supersede_pending(conn, **CELL, repo="svc",
                                                   verifier="reconciliation", verdict="fail")
        assert rec2 is False and box2 is None
        assert store.latest_verdicts(conn, **CELL)[("svc", "reconciliation")]["verdict"] == "pass"

    def test_first_time_report_records_no_box(self, conn):
        rec, box = recorder.supersede_pending(conn, **CELL, repo="svc",
                                                 verifier="reconciliation", verdict="pass")
        assert rec is True and box is None  # no prior pending -> nothing to release

    def test_concurrent_supersede_only_one_wins(self, tmp_path):
        # R1: the headline race. Two concurrent supersedes of the SAME pending cell
        # must NOT both record + both release. The single-statement conditional
        # INSERT under BEGIN IMMEDIATE serializes them: exactly one records (and
        # gets the box), the other is a no-op.
        import threading
        db = str(tmp_path / "race.db")
        seed = store.connect(db)
        recorder.record_verdict(seed, **CELL, repo="svc", verifier="reconciliation",
                                verdict="pending", detail={"box_id": "box-1"})
        seed.close()

        results = []
        barrier = threading.Barrier(2)

        def worker(verdict):
            c = store.connect(db)
            try:
                barrier.wait()  # maximize the overlap
                results.append(recorder.supersede_pending(
                    c, **CELL, repo="svc", verifier="reconciliation", verdict=verdict))
            finally:
                c.close()

        t1 = threading.Thread(target=worker, args=("pass",))
        t2 = threading.Thread(target=worker, args=("fail",))
        t1.start(); t2.start(); t1.join(); t2.join()

        recorded = [r for r in results if r[0]]
        boxes = [r[1] for r in results if r[0] and r[1]]
        assert len(recorded) == 1, f"expected exactly one winner, got {results}"
        assert boxes == ["box-1"], f"box released exactly once, got {boxes}"


class TestRecordVerdictReturnAttempt:
    def test_return_attempt_is_this_writes_attempt_not_last_writer(self, conn):
        # R3: return_attempt yields the attempt of THIS write, captured at write
        # time — not a re-read of latest_verdicts (which would return a later
        # interleaving writer's attempt).
        ok, _r, a1 = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline",
                                             verdict="pass", return_attempt=True)
        assert ok and a1 == 1
        # a later writer on the SAME cell bumps the max to 2 ...
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="fail")
        assert a1 == 1  # ... but the first write's reported attempt is unchanged

    def test_return_attempt_none_on_refusal(self, conn):
        ok, _r, att = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline",
                                              verdict="bogus", return_attempt=True)
        assert ok is False and att is None

    def test_default_return_is_two_tuple(self, conn):
        # backward-compat: without the flag, the 2-tuple contract is unchanged.
        res = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass")
        assert len(res) == 2 and res[0] is True


class TestRecordVerdictWithDelivery:
    def test_marks_delivery_and_records_verdict(self, conn):
        st, _r = recorder.record_verdict_with_delivery(
            conn, **CELL, repo="app", verifier="ci-trigger", verdict="pass",
            provider="github", delivery="d1")
        assert st == "recorded"
        assert store.delivery_seen(conn, "github", "d1")
        assert store.latest_verdicts(conn, **CELL)[("app", "ci-trigger")]["verdict"] == "pass"

    def test_duplicate_delivery_does_not_double_record(self, conn):
        recorder.record_verdict_with_delivery(conn, **CELL, repo="app", verifier="ci-trigger",
                                              verdict="pass", provider="github", delivery="d1")
        st, _r = recorder.record_verdict_with_delivery(
            conn, **CELL, repo="app", verifier="ci-trigger", verdict="fail",
            provider="github", delivery="d1")
        assert st == "duplicate"
        n = conn.execute(
            "SELECT COUNT(*) FROM verdicts WHERE orchestrate_id=? AND task_group_id=? "
            "AND repo='app' AND verifier='ci-trigger'",
            (CELL["orchestrate_id"], CELL["task_group_id"])).fetchone()[0]
        assert n == 1  # the duplicate did NOT record a second verdict

    def test_refused_verdict_leaves_delivery_unmarked(self, conn):
        # R7 atomicity: a non-committing path (refused verdict) must NOT mark the
        # delivery, so a corrected retry can still succeed (the verdict isn't lost).
        st, _r = recorder.record_verdict_with_delivery(
            conn, **CELL, repo="app", verifier="ci-trigger", verdict="bogus",
            provider="github", delivery="d2")
        assert st == "refused"
        assert not store.delivery_seen(conn, "github", "d2")


class TestRecordVerdict:
    def test_auto_attempt_increments_atomically(self, conn):
        # R3: with attempt=None the recorder derives MAX(attempt)+1 inside the
        # write txn — two legitimate verdicts for one cell BOTH land (1 then 2),
        # they do NOT collide on a guessed counter and get dropped as duplicates.
        ok, _ = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass")
        assert ok
        ok, _ = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="fail")
        assert ok  # second call -> attempt 2, not a false duplicate
        rows = store.latest_verdicts(conn, **CELL)
        assert rows[("app", "inline")]["attempt"] == 2 and rows[("app", "inline")]["verdict"] == "fail"

    def test_explicit_duplicate_attempt_still_refused(self, conn):
        # The dedup guard still protects an EXPLICIT same-attempt re-record
        # (repair flows pass an explicit attempt).
        ok, _ = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass", attempt=1)
        assert ok
        ok, reason = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="fail", attempt=1)
        assert not ok and "duplicate" in reason

    def test_refuses_unknown_verdict(self, conn):
        ok, reason = recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="victory")
        assert not ok and "victory" in reason

    def test_refuses_incomplete_cell_key(self, conn):
        ok, reason = recorder.record_verdict(conn, "orch-1", "g1", "", "inline", "pass")
        assert not ok and "required" in reason


class TestAdvanceGuards:
    def test_red_gate_advance_refused(self, conn):
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="fail")
        ok, reason = recorder.advance(conn, **CELL)
        assert not ok and "red-gate" in reason

    def test_pending_blocks_advance(self, conn):
        recorder.record_verdict(conn, **CELL, repo="app", verifier="ci-trigger", verdict="pending")
        ok, reason = recorder.advance(conn, **CELL)
        assert not ok and "pending" in reason

    def test_advance_on_all_green_then_double_refused(self, conn):
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass")
        recorder.record_verdict(conn, **CELL, repo="app", verifier="ci-trigger", verdict="skipped")
        ok, _ = recorder.advance(conn, **CELL)
        assert ok
        ok, reason = recorder.advance(conn, **CELL)
        assert not ok and "double advance" in reason

    def test_expected_cell_missing_verdict_refused(self, conn):
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass")
        ok, reason = recorder.advance(conn, **CELL, expected_cells=[["app", "inline"], ["app", "ci-trigger"]])
        assert not ok and "no verdict" in reason

    def test_no_verdicts_at_all_refused(self, conn):
        ok, reason = recorder.advance(conn, **CELL)
        assert not ok and "no verdicts" in reason

    def test_latest_verdict_wins(self, conn):
        # fail attempt 1, pass attempt 2 -> latest is pass -> advance allowed (D10.6 last-writer)
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="fail", attempt=1)
        recorder.record_verdict(conn, **CELL, repo="app", verifier="inline", verdict="pass", attempt=2)
        ok, _ = recorder.advance(conn, **CELL)
        assert ok


class TestRepairCap:
    def test_caps_at_three(self, conn):
        for attempt in (1, 2, 3):
            ok, _ = recorder.open_repair(conn, **CELL, repo="app", verifier="inline", attempt=attempt)
            assert ok
        ok, reason = recorder.open_repair(conn, **CELL, repo="app", verifier="inline", attempt=4)
        assert not ok and "cap" in reason

    def test_duplicate_attempt_refused(self, conn):
        recorder.open_repair(conn, **CELL, repo="app", verifier="inline", attempt=1)
        ok, reason = recorder.open_repair(conn, **CELL, repo="app", verifier="inline", attempt=1)
        assert not ok and "already open" in reason


class TestChecklistAndHook:
    def test_checklist_upserts(self, conn):
        recorder.update_checklist(conn, **CELL, item="tests", status="pending")
        recorder.update_checklist(conn, **CELL, item="tests", status="done")
        row = conn.execute("SELECT status FROM checklist WHERE item = 'tests'").fetchone()
        assert row["status"] == "done"

    def test_hook_is_side_effect_only(self, conn):
        ok, _ = recorder.record_hook(conn, **CELL, transition="post_implement", handler="tool:notify")
        assert ok
        # firing a hook must never create gate state
        assert store.group_state(conn, "orch-1", "g1") is None


class TestRecorderCLI:
    def test_cli_refusal_exits_1(self, tmp_path):
        db = str(tmp_path / "v.db")
        proc = subprocess.run(
            [sys.executable, "-m", "src.verification.recorder", "advance",
             "--db", db, "--json", json.dumps(CELL)],
            capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=60,
        )
        assert proc.returncode == 1
        assert "red-gate" in proc.stdout or "no verdicts" in proc.stdout

    def test_cli_records_verdict(self, tmp_path):
        db = str(tmp_path / "v.db")
        payload = {**CELL, "repo": "app", "verifier": "inline", "verdict": "pass"}
        proc = subprocess.run(
            [sys.executable, "-m", "src.verification.recorder", "record_verdict",
             "--db", db, "--json", json.dumps(payload)],
            capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=60,
        )
        assert proc.returncode == 0 and json.loads(proc.stdout)["ok"]


class TestWritePathGuard:
    """count == 0: recorder.py is the ONLY module that writes the guarded
    tables. A second write path is the bypass D10.1 exists to prevent."""

    GUARDED = re.compile(r"INSERT INTO (verdicts|task_group_state|repairs)\b", re.IGNORECASE)

    def test_only_recorder_writes_guarded_tables(self):
        offenders = []
        for path in (REPO_ROOT / "src").rglob("*.py"):
            if "__pycache__" in path.parts or path.name == "recorder.py":
                continue
            for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if self.GUARDED.search(line):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{i}")
        assert offenders == [], f"guarded-table writes outside recorder.py (D10.1 bypass): {offenders}"
