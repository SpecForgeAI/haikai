"""End-to-end pipeline test over the REAL subprocess contract (closes C6).

Every step runs as `python -m ...` with stdin/stdout/stderr/exit-code framing
and cwd = repo root — exactly what the pipeline-orchestrator agent does. The
generative step is a stub: records a real extractor would emit, including one
hallucination to prove the retry framing.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

INDEX_TSV = """# file\tkind\tname\tscope\tsignature\tline\tflags
app/users.py\tfunction\tget_users\t-\t()\t10\tdecorated
app/users.py\tmethod\tsave\tUserRepo\t(self, user)\t25\t-
app/orders.py\tfunction\tcreate_order\t-\t(req)\t5\tdecorated
"""

CALLS_TSV = """# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence
app/orders.py\tcreate_order\t-\tdb.execute\t8\t0.90
"""


def run_module(module: str, args: list[str] | None = None, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", module, *(args or [])],
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(REPO_ROOT),
        timeout=120,
    )


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "_index.txt").write_text(INDEX_TSV, encoding="utf-8")
    (snap / "_calls.txt").write_text(CALLS_TSV, encoding="utf-8")
    (snap / "_meta.yaml").write_text("repo: e2e\nsymbol_count: 3\n", encoding="utf-8")
    return snap


def test_full_chain_through_subprocess_contract(snapshot, tmp_path):
    out_dir = tmp_path / "out"
    config = {
        "snapshot_path": str(snapshot),
        "out_dir": str(out_dir),
        "kinds": ["endpoints"],
        "max_attempts": 3,
        "parallelism": 2,
    }

    # 1. bootstrap_check
    proc = run_module("src.pipeline.checks.bootstrap_check", stdin=json.dumps(config))
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["verdict"] == "proceed"

    # 2. plan_batches
    batches_file = out_dir / "batches.json"
    proc = run_module(
        "src.pipeline.tools.plan_batches",
        ["--index", str(snapshot), "--kinds", "endpoints", "--out", str(batches_file)],
    )
    assert proc.returncode == 0, proc.stderr
    batches = json.loads(batches_file.read_text(encoding="utf-8"))
    assert len(batches) == 1
    batch = batches[0]

    # 3. batch_plan_check
    proc = run_module("src.pipeline.checks.batch_plan_check", stdin=json.dumps(batch))
    assert proc.returncode == 0, proc.stdout

    # 4. ast_query (code path A — mechanical candidates)
    proc = run_module(
        "src.pipeline.tools.ast_query",
        ["--index", str(snapshot), "--filter", json.dumps({"has_decorator": True})],
    )
    assert proc.returncode == 0, proc.stderr
    candidates = json.loads(proc.stdout)
    assert {c["name"] for c in candidates} == {"get_users", "create_order"}

    # 4b. semantic filter values exit 2 by design (D1)
    proc = run_module(
        "src.pipeline.tools.ast_query",
        ["--index", str(snapshot), "--filter", json.dumps({"node_kinds": ["endpoint"]})],
    )
    assert proc.returncode == 2

    # 5. pre_check
    proc = run_module(
        "src.pipeline.checks.pre_check",
        stdin=json.dumps({"batch": batch, "candidates": candidates}),
    )
    assert proc.returncode == 0

    # 6. STUB extractor attempt 1: one grounded record + one hallucination
    good = {
        "type": "REST", "path": "/users", "operation": "GET",
        "handler_class": "UsersController", "handler_method": "get_users",
        "file": "app/users.py", "line": 10,
    }
    hallucinated = dict(good, path="/ghost", line=999)
    proc = run_module(
        "src.pipeline.checks.post_check",
        stdin=json.dumps({"batch": batch, "records": [good, hallucinated], "snapshot_path": str(snapshot)}),
    )
    assert proc.returncode == 1
    # stderr framing: JSON lines, each {"record": i, "reason": ...} — the
    # retry feedback the orchestrator appends to prior_failures.
    stderr_lines = [json.loads(l) for l in proc.stderr.splitlines() if l.strip()]
    assert any(f["reason"] == "loc_not_in_index" and f["record"] == 1 for f in stderr_lines)

    # attempt 2: repaired (hallucination dropped)
    proc = run_module(
        "src.pipeline.checks.post_check",
        stdin=json.dumps({"batch": batch, "records": [good], "snapshot_path": str(snapshot)}),
    )
    assert proc.returncode == 0
    valid_records = json.loads(proc.stdout)["valid_records"]
    assert len(valid_records) == 1

    # 7. ledger_write — once, then duplicate refused
    ledger_payload = {
        "out_dir": str(out_dir), "batch_id": batch["id"], "status": "done",
        "records": valid_records, "attempts": 2, "cost_usd": None, "duration_ms": 1200,
    }
    proc = run_module("src.pipeline.checks.ledger_write", stdin=json.dumps(ledger_payload))
    assert proc.returncode == 0, proc.stdout
    proc = run_module("src.pipeline.checks.ledger_write", stdin=json.dumps(ledger_payload))
    assert proc.returncode == 1  # exactly one row per batch (D12)

    # 8. merge_check
    proc = run_module("src.pipeline.checks.merge_check", stdin=json.dumps({"out_dir": str(out_dir)}))
    assert proc.returncode == 0
    assert (out_dir / "catalog.json").exists()

    # 9. final_gate — ship
    proc = run_module(
        "src.pipeline.checks.final_gate",
        stdin=json.dumps({"out_dir": str(out_dir), "snapshot_path": str(snapshot)}),
    )
    assert proc.returncode == 0, (out_dir / "blockers.jsonl").read_text(encoding="utf-8")
    assert json.loads(proc.stdout)["verdict"] == "ship"

    # 10. backfill — the shipped catalog lands in the store (D8)
    proc = run_module(
        "src.pipeline.backfill",
        ["--out-dir", str(out_dir), "--snapshot", str(snapshot)],
    )
    assert proc.returncode == 0, proc.stderr
    endpoints_txt = (snapshot / "_endpoints.txt").read_text(encoding="utf-8")
    assert "/users" in endpoints_txt and "get_users" in endpoints_txt


def test_backfill_refuses_blocked_run(snapshot, tmp_path):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "catalog.json").write_text(json.dumps({"records": {}}), encoding="utf-8")
    (out_dir / "blockers.jsonl").write_text('{"invariant": "x"}\n', encoding="utf-8")
    proc = run_module("src.pipeline.backfill", ["--out-dir", str(out_dir), "--snapshot", str(snapshot)])
    assert proc.returncode == 1
    assert "blocked" in json.loads(proc.stdout)["reason"]


def test_read_span_cap_enforced(tmp_path):
    target = tmp_path / "big.py"
    target.write_text("\n".join(f"line{i}" for i in range(1, 400)), encoding="utf-8")
    proc = run_module(
        "src.pipeline.tools.read_span",
        ["--project-root", str(tmp_path), "--file", "big.py", "--start", "1", "--end", "300"],
    )
    assert proc.returncode == 2  # over the 200-line cap (D11)
    proc = run_module(
        "src.pipeline.tools.read_span",
        ["--project-root", str(tmp_path), "--file", "big.py", "--start", "5", "--end", "10"],
    )
    assert proc.returncode == 0
    assert "line5" in proc.stdout


def test_cross_ref_returns_definitions(snapshot):
    proc = run_module(
        "src.pipeline.tools.cross_ref",
        ["--snapshot", str(snapshot), "--symbol", "get_users", "--direction", "callers"],
    )
    assert proc.returncode == 0, proc.stderr
    body = json.loads(proc.stdout)
    assert body["definitions"][0]["file"] == "app/users.py"
    assert body["definitions"][0]["line"] == 10
