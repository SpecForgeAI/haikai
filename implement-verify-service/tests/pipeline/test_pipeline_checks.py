"""Tests for src/pipeline checks — the stdin=json / exit-code contract (D10/D12)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.pipeline.checks.batch_plan_check import run as batch_plan_check
from src.pipeline.checks.bootstrap_check import run as bootstrap_check
from src.pipeline.checks.final_gate import run as final_gate
from src.pipeline.checks.ledger_write import run as ledger_write
from src.pipeline.checks.merge_check import run as merge_check
from src.pipeline.checks.post_check import run as post_check
from src.pipeline.checks.pre_check import run as pre_check

INDEX_TSV = """# file\tkind\tname\tscope\tsignature\tline\tflags
app/users.py\tfunction\tget_users\t-\t()\t10\tdecorated
app/orders.py\tfunction\tcreate_order\t-\t(req)\t5\tdecorated
"""

CALLS_TSV = """# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence
app/orders.py\tcreate_order\t-\tdb.execute\t8\t0.90
"""


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_index.txt").write_text(INDEX_TSV, encoding="utf-8")
    (snap / "_calls.txt").write_text(CALLS_TSV, encoding="utf-8")
    return snap


def _endpoint(line=10, **overrides) -> dict:
    record = {
        "type": "REST",
        "path": "/users",
        "operation": "GET",
        "handler_class": "UsersController",
        "handler_method": "get_users",
        "file": "app/users.py",
        "line": line,
    }
    record.update(overrides)
    return record


class TestBootstrapCheck:
    def test_passes_with_valid_context(self, snapshot, tmp_path):
        code, payload = bootstrap_check(
            {
                "snapshot_path": str(snapshot),
                "out_dir": str(tmp_path / "out"),
                "kinds": ["endpoints"],
                "max_attempts": 3,
                "parallelism": 2,
            }
        )
        assert code == 0 and payload["verdict"] == "proceed"

    def test_aborts_on_missing_snapshot_and_bad_kind(self, tmp_path):
        code, payload = bootstrap_check(
            {
                "snapshot_path": str(tmp_path / "missing"),
                "out_dir": str(tmp_path / "out"),
                "kinds": ["nope"],
                "max_attempts": 0,
                "parallelism": 1,
            }
        )
        assert code == 1
        joined = " ".join(payload["problems"])
        assert "snapshot" in joined and "nope" in joined and "max_attempts" in joined


class TestBatchPlanCheck:
    def test_proceeds_on_valid_batch(self):
        code, _ = batch_plan_check(
            {"id": "endpoints-abc", "kind": "endpoints", "scope": {"files": ["a.py"]}, "candidate_count": 60}
        )
        assert code == 0

    def test_refuses_empty_and_oversized(self):
        code, payload = batch_plan_check({"id": "x", "kind": "endpoints", "scope": {"files": []}, "candidate_count": 0})
        assert code == 1 and payload["verdict"] == "refused"
        code, _ = batch_plan_check(
            {"id": "x", "kind": "endpoints", "scope": {"files": ["a.py"]}, "candidate_count": 999}
        )
        assert code == 1


class TestPreCheck:
    def test_skip_on_no_candidates(self):
        code, payload = pre_check({"batch": {}, "candidates": []})
        assert code == 2 and payload["verdict"] == "no_candidates"

    def test_proceed_with_candidates(self):
        code, _ = pre_check({"batch": {}, "candidates": [{"file": "a.py"}]})
        assert code == 0


class TestPostCheck:
    def test_pass_normalises_and_dedupes(self, snapshot):
        records = [_endpoint(), _endpoint(file="app\\users.py")]  # duplicate after normalise
        code, payload, failures = post_check(
            {"batch": {"kind": "endpoints"}, "records": records, "snapshot_path": str(snapshot)}
        )
        assert code == 0 and not failures
        assert len(payload["valid_records"]) == 1
        valid = payload["valid_records"][0]
        assert valid["file"] == "app/users.py"
        assert valid["confidence"] == 0.8  # default applied

    def test_fabricated_handler_on_real_anchor_fails(self, snapshot):
        # C1: has() accepted ANY known line — a fabricated endpoint placed on a
        # real anchor shipped. The symbol at the anchor must BE the handler.
        code, _, failures = post_check(
            {
                "batch": {"kind": "endpoints"},
                "records": [_endpoint(handler_method="totally_invented", handler_class="NopeController")],
                "snapshot_path": str(snapshot),
            }
        )
        assert code == 1
        assert any("handler_not_at_anchor" in f["reason"] for f in failures)

    def test_endpoint_anchored_at_call_line_fails(self, snapshot):
        # C1: an endpoint must anchor at its handler SYMBOL, not at some call
        # site that happens to be in _calls.txt (line 8 is a call in the fixture).
        code, _, failures = post_check(
            {
                "batch": {"kind": "endpoints"},
                "records": [_endpoint(file="app/orders.py", line=8)],
                "snapshot_path": str(snapshot),
            }
        )
        assert code == 1
        assert any("endpoint_anchor" in f["reason"] or "handler_not_at_anchor" in f["reason"] for f in failures)

    def test_handler_class_scope_match_passes(self, snapshot):
        # The symbol's scope may carry the class; handler_class==scope grounds too.
        record = _endpoint(file="app/orders.py", line=5, handler_class="-", handler_method="create_order")
        code, payload, failures = post_check(
            {"batch": {"kind": "endpoints"}, "records": [record], "snapshot_path": str(snapshot)}
        )
        assert code == 0, failures

    def test_loc_not_in_index_is_a_failure(self, snapshot):
        code, _, failures = post_check(
            {"batch": {"kind": "endpoints"}, "records": [_endpoint(line=999)], "snapshot_path": str(snapshot)}
        )
        assert code == 1
        assert any(f["reason"] == "loc_not_in_index" for f in failures)

    def test_schema_violations_reported_per_record(self, snapshot):
        bad = _endpoint(operation="YEET")
        del bad["handler_class"]
        code, _, failures = post_check(
            {"batch": {"kind": "endpoints"}, "records": [bad], "snapshot_path": str(snapshot)}
        )
        assert code == 1
        reasons = " | ".join(f["reason"] for f in failures)
        assert "handler_class" in reasons and "YEET" in reasons

    def test_unresolved_ambiguity_fails(self, snapshot):
        movement = {
            "source_class": "OrderService",
            "source_method": "create",
            "target": "orders",
            "target_type": "DATABASE",
            "direction": "WRITE",
            "mechanism": "JPA",
            "file": "app/orders.py",
            "line": 8,
            "ambiguous": True,
            "alternatives": [{"direction": "READ"}],
        }
        code, _, failures = post_check(
            {"batch": {"kind": "data_movements"}, "records": [movement], "snapshot_path": str(snapshot)}
        )
        assert code == 1
        assert any("ambiguous" in f["reason"] for f in failures)

    def test_movement_dedupe_keeps_distinct_sites_and_directions(self, snapshot, tmp_path):
        # P1b: key omitted file/line/direction — distinct call sites and a
        # READ vs WRITE of the same target deduped silently.
        base = {
            "source_class": "OrderService",
            "source_method": "create",
            "target": "orders",
            "target_type": "DATABASE",
            "mechanism": "JPA",
            "file": "app/orders.py",
        }
        # snapshot fixture has call line 8 and symbol line 5 in app/orders.py
        records = [
            {**base, "direction": "WRITE", "line": 8},
            {**base, "direction": "WRITE", "line": 5},   # distinct site
            {**base, "direction": "READ", "line": 8},    # distinct direction
            {**base, "direction": "WRITE", "line": 8},   # true duplicate -> deduped
        ]
        code, payload, failures = post_check(
            {"batch": {"kind": "data_movements"}, "records": records, "snapshot_path": str(snapshot)}
        )
        assert code == 0 and not failures
        assert len(payload["valid_records"]) == 3

    def test_ambiguous_forbidden_for_endpoints(self, snapshot):
        code, _, failures = post_check(
            {"batch": {"kind": "endpoints"}, "records": [_endpoint(ambiguous=True)], "snapshot_path": str(snapshot)}
        )
        assert code == 1
        assert any("not allowed" in f["reason"] for f in failures)


class TestOutDirContainment:
    """P3a: out_dir arrives via stdin JSON; checks must refuse traversal and,
    when SX_PIPELINE_ROOT is set, any path outside it (truncating writes)."""

    def test_parent_traversal_refused(self, tmp_path):
        code, payload = ledger_write(
            {"out_dir": str(tmp_path) + "/../escape", "batch_id": "endpoints-x", "status": "done"}
        )
        assert code == 1 and "out_dir" in payload["reason"]

    def test_outside_pipeline_root_refused(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SX_PIPELINE_ROOT", str(tmp_path / "allowed"))
        code, payload = ledger_write(
            {"out_dir": str(tmp_path / "elsewhere"), "batch_id": "endpoints-x", "status": "done"}
        )
        assert code == 1 and "out_dir" in payload["reason"]
        # inside the root proceeds
        code, _ = ledger_write(
            {"out_dir": str(tmp_path / "allowed" / "run1"), "batch_id": "endpoints-x", "status": "done"}
        )
        assert code == 0

    def test_merge_and_gate_refuse_traversal(self, tmp_path):
        code, payload = merge_check({"out_dir": str(tmp_path) + "/../m"})
        assert payload.get("verdict") in ("error", "refused")
        code, payload = final_gate({"out_dir": str(tmp_path) + "/../g", "snapshot_path": str(tmp_path)})
        assert code == 1 and payload["verdict"] in ("blocked", "refused")


class TestLedgerWrite:
    def test_writes_then_refuses_duplicate(self, tmp_path):
        payload = {"out_dir": str(tmp_path), "batch_id": "endpoints-abc", "status": "done", "records": [], "attempts": 1}
        code, result = ledger_write(payload)
        assert code == 0
        code, result = ledger_write(payload)
        assert code == 1 and "duplicate" in result["reason"]
        rows = (tmp_path / "batch_ledger.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(rows) == 1  # exactly one row per batch (D12)

    def test_refuses_bad_status(self, tmp_path):
        code, result = ledger_write({"out_dir": str(tmp_path), "batch_id": "x", "status": "victory"})
        assert code == 1

    def test_duplicate_refusal_holds_under_concurrency(self, tmp_path):
        # C3: read-then-append raced under the parallelism the orchestrator
        # mandates — exactly ONE row per batch_id must survive N concurrent writers.
        from concurrent.futures import ThreadPoolExecutor

        payload = {"out_dir": str(tmp_path), "batch_id": "endpoints-race", "status": "done", "records": []}
        with ThreadPoolExecutor(max_workers=8) as pool:
            codes = list(pool.map(lambda _: ledger_write(dict(payload))[0], range(8)))
        rows = [
            json.loads(l)
            for l in (tmp_path / "batch_ledger.jsonl").read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        assert sum(1 for r in rows if r["batch_id"] == "endpoints-race") == 1
        assert codes.count(0) == 1 and codes.count(1) == 7


class TestMergeAndFinalGate:
    def _write_ledger(self, out_dir: Path, rows: list[dict]) -> None:
        with (out_dir / "batch_ledger.jsonl").open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")

    def test_merge_dedupes_conflicts_and_reports_skips(self, tmp_path):
        a = _endpoint(confidence=0.9)
        b = _endpoint(confidence=0.5)  # same (kind,file,line) — deduped, keep a
        rival = _endpoint(handler_class="OtherController", file="app/orders.py", line=5)  # same GET /users → conflict
        self._write_ledger(
            tmp_path,
            [
                {"batch_id": "endpoints-one", "status": "done", "records": [a, b]},
                {"batch_id": "endpoints-two", "status": "done", "records": [rival]},
                {"batch_id": "endpoints-three", "status": "gave_up", "records": []},
            ],
        )
        code, payload = merge_check({"out_dir": str(tmp_path)})
        assert code == 0
        assert payload["conflicts"] == 1
        assert payload["batches_skipped"] == {"gave_up": ["endpoints-three"]}  # no silent drops
        catalog = json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8"))
        # conflicted records stay OUT of the catalog
        assert catalog["records"] == {} or "endpoints" not in catalog["records"]

    def test_final_gate_blocks_then_ships(self, snapshot, tmp_path):
        self._write_ledger(tmp_path, [{"batch_id": "endpoints-one", "status": "done", "records": [_endpoint()]}])
        merge_check({"out_dir": str(tmp_path)})
        code, payload = final_gate({"out_dir": str(tmp_path), "snapshot_path": str(snapshot)})
        assert code == 0 and payload["verdict"] == "ship"

        # poison the catalog with an unknown location → blocked
        catalog = json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8"))
        catalog["records"]["endpoints"][0]["line"] = 999
        (tmp_path / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
        code, payload = final_gate({"out_dir": str(tmp_path), "snapshot_path": str(snapshot)})
        assert code == 1 and payload["verdict"] == "blocked"
        blockers = (tmp_path / "blockers.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert any("loc_resolves" in line for line in blockers)

    def test_merge_tolerates_malformed_ledger_rows(self, tmp_path):
        # P1f: a done row without batch_id must not KeyError ("exit 0 always");
        # a dash-less batch_id must not silently bucket under a bogus kind.
        self._write_ledger(
            tmp_path,
            [
                {"status": "done", "records": [_endpoint()]},  # no batch_id
                {"batch_id": "weird", "status": "done", "records": [_endpoint()]},  # no '-'
                {"batch_id": "endpoints-ok1", "status": "done", "records": [_endpoint()]},
            ],
        )
        code, payload = merge_check({"out_dir": str(tmp_path)})
        assert code == 0
        assert payload["batches_skipped"].get("malformed") is not None
        catalog = json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8"))
        assert set(catalog["records"].keys()) <= {"endpoints", "data_movements", "queries"}

    def test_final_gate_blocked_not_traceback_on_corrupt_files(self, snapshot, tmp_path):
        # P1f: corrupt catalog.json / conflicts.jsonl -> blocked verdict, not crash.
        (tmp_path / "catalog.json").write_text("{not json", encoding="utf-8")
        (tmp_path / "conflicts.jsonl").write_text("also not json\n", encoding="utf-8")
        code, payload = final_gate({"out_dir": str(tmp_path), "snapshot_path": str(snapshot)})
        assert code == 1 and payload["verdict"] == "blocked"
        blockers = (tmp_path / "blockers.jsonl").read_text(encoding="utf-8")
        assert "unreadable" in blockers

    def test_final_gate_blocks_on_unresolved_conflict(self, snapshot, tmp_path):
        self._write_ledger(tmp_path, [{"batch_id": "endpoints-one", "status": "done", "records": []}])
        merge_check({"out_dir": str(tmp_path)})
        (tmp_path / "conflicts.jsonl").write_text(
            json.dumps({"logical_id": ["endpoints", "GET", "/users"], "sides": []}) + "\n", encoding="utf-8"
        )
        code, payload = final_gate({"out_dir": str(tmp_path), "snapshot_path": str(snapshot)})
        assert code == 1
